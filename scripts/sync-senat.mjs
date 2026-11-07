// Sync official Sénat open data into small JSON files the website reads (mirrors sync-assemblee.mjs).
//
//   node scripts/sync-senat.mjs              # daily run: new votes, senators, socials (pages refreshed weekly)
//   node scripts/sync-senat.mjs --full       # refetch every vote page, not only new / recent ones
//   node scripts/sync-senat.mjs --refresh    # refetch senators' pages, their own sites and Wikidata now
//   flags: --no-sites --no-wikidata --no-elections
//
// Output (public/data/senat/):
//   meta.json            sync time, sources, checks (counts vs published totals), socials coverage
//   senateurs.json       one entry per sitting senator (identity, group + colour, constituency, commission,
//                        profession, HATVP, photo, official page, social accounts, vote stats)
//   scrutins.json        every public vote since FIRST_SESSION:
//                        [id, date, titre, sort, demandeur, pour, contre, abst, nppv, dossier]
//   votes/<matricule>.json  that senator's position on each vote: { "2026-56": "P" | "C" | "A" | "N" }
//   elections-2026.json  27 Sept 2026 senatorial elections (series 2) by department, Ministry of the Interior
// Cache (committed, refreshed weekly): data/senat-cache.json — parsed senator pages, own-site links, Wikidata rows.
//
// Sources: data.senat.fr (ODSEN exports) and www.senat.fr (senators API, vote pages and their JSON),
// both under the Sénat's open licence (Licence Ouverte); data.gouv.fr (Ministry of the Interior, Licence Ouverte 2.0);
// Wikidata (CC0).

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import { csvObjects } from "./lib/csv.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/senat/", ROOT);
const CACHE_FILE = new URL("data/senat-cache.json", ROOT);
const OVERRIDES = new URL("data/senat-socials-overrides.csv", ROOT); // optional, same format as the MPs' file

const args = new Set(process.argv.slice(2));
const FULL = args.has("--full");
const REFRESH = args.has("--refresh");
const UA = "ThirdEstate-senat/1.0 (+https://github.com/nicbay/projectview)";

// The Sénat has no legislature: it is renewed by half every three years (series 1 in 2023, series 2 in 2026).
// We keep every vote since the session that opened after the 2023 renewal, so every sitting senator's
// current mandate is covered (series 1 senators were elected in Sept 2023).
const FIRST_SESSION = 2023; // session 2023-2024
const PAGE_DAYS = 7; // senator pages, own sites and Wikidata are refreshed when the cache is older than this
const RECENT_DAYS = 14; // votes this recent are refetched every run (late corrections)

const SENAT = "https://www.senat.fr";
const SRC = {
  api: `${SENAT}/api-senat/senateurs.json`,
  general: "https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json",
  mandats: "https://data.senat.fr/data/senateurs/ODSEN_ELUSEN.json",
  commissions: "https://data.senat.fr/data/senateurs/ODSEN_CUR_COMS.json",
  home: `${SENAT}/`, // the hemicycle widget on the home page carries the groups' official colours
  scrutinsIndex: (s) => `${SENAT}/scrutin-public/scr${s}.html`,
  scrutinPage: (s, n) => `${SENAT}/scrutin-public/${s}/scr${s}-${n}.html`,
  scrutinVotes: (s, n) => `${SENAT}/scrutin-public/${s}/scr${s}-${n}.json`,
  elections: "https://www.data.gouv.fr/api/1/datasets/elections-senatoriales-2026-resultats/",
};

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const day = (s) => (s ? s.slice(0, 10).replaceAll("/", "-") : null); // "2026/10/06 00:00:00" -> "2026-10-06"
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const text = (html) => parse(`<p>${html}</p>`).text.replace(/\s+/g, " ").trim(); // strips tags, decodes entities
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const alnum = (s) => fold(s).replace(/[^a-z0-9]/g, "");
const fresh = (at, days) => !REFRESH && at && Date.now() - Date.parse(at) < days * 864e5;

// Per-host politeness: requests to one host are spaced by `gap` ms; retries on 429 / 5xx / network errors.
const nextSlot = new Map();
const GAP = { "www.senat.fr": 250, "data.senat.fr": 250 };
async function get(url, { tries = 4, timeout = 30000, accept } = {}) {
  const host = new URL(url).host;
  for (let i = 1; ; i++) {
    const gap = GAP[host] ?? 1200;
    const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + gap);
    if (at > Date.now()) await sleep(at - Date.now());
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr", ...(accept ? { Accept: accept } : {}) }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return Object.assign(res, { failed: true });
      return res;
    } catch (e) {
      if (i >= tries) throw new Error(`${e.message} for ${url}`);
      await sleep(3000 * i);
    }
  }
}
async function getText(url, opts) {
  const res = await get(url, opts);
  if (res.failed) throw new Error(`HTTP ${res.status} for ${url}`);
  return { body: await res.text(), lastModified: res.headers.get("last-modified") };
}
const getJson = async (url) => JSON.parse((await getText(url, { accept: "application/json" })).body);
/** Runs fn over items with at most `n` in flight. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) {
      const i = k++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
const readJson = async (u, fallback) => {
  try {
    return JSON.parse(await readFile(u, "utf8"));
  } catch {
    return fallback;
  }
};

const cache = await readJson(CACHE_FILE, {});
const meta = { syncedAt: new Date().toISOString(), firstSession: `${FIRST_SESSION}-${FIRST_SESSION + 1}`, sources: {}, checks: {} };

// ---------- social-account normalisation (same rules as scripts/sync-socials.mjs) ----------
const INSTITUTIONAL = /^@?(senat|senat_fr|senatfr|publicsenat|assemblee-?nationale|assembleenat|lcp|gouvernementfr|elysee|rnational_off|rassemblementnational|franceinsoumise|partisocialiste|renaissance|lesrepublicains|republicains|modem|horizonsleparti|eelv|lesecologistes|pcf|udr|udi_off)$/i;
const RESERVED = {
  twitter: /^(intent|share|home|hashtag|i|search|login|signup|explore|settings|privacy|tos|notifications|messages)$/i,
  instagram: /^(p|reel|reels|explore|stories|accounts|tv|direct|about|developer|legal)$/i,
  facebook: /^(sharer|sharer\.php|share|dialog|plugins|login|tr|events|groups|hashtag|watch|help|policies|privacy|notes|media|photo.php|story.php|permalink.php)$/i,
  tiktok: /^(tag|discover|music|embed|share)$/i,
};
const MASTODON_HOSTS = /^(mastodon\.(social|online|xyz|world)|piaille\.fr|mamot\.fr|framapiaf\.org|mastodon\.tedomum\.net|mstdn\.social|pouet\.chapril\.org|mastodon\.green|social\.vivaldi\.net)$/i;
const PLATFORMS = ["twitter", "instagram", "linkedin", "facebook", "bluesky", "tiktok", "youtube", "mastodon", "website"];

function normalize(platform, raw) {
  let v = String(raw ?? "").trim();
  if (!v) return { reason: "empty" };
  const asUrl = () => {
    try {
      return new URL(/^https?:\/\//i.test(v) ? v : "https://" + v.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  };
  switch (platform) {
    case "twitter": {
      let h = v;
      if (/twitter\.com|x\.com/i.test(v)) {
        const u = asUrl();
        h = u?.pathname.split("/").filter(Boolean)[0] ?? "";
        if (u?.hash.startsWith("#!/")) h = u.hash.slice(3).split("/")[0];
      }
      h = h.split("@").pop().split(/[/?#]/)[0];
      if (!/^[A-Za-z0-9_]{1,15}$/.test(h) || RESERVED.twitter.test(h)) return { reason: `not an X handle: ${v}` };
      return { url: `https://x.com/${h}`, handle: "@" + h };
    }
    case "instagram": {
      let h = v;
      if (/instagram\.com/i.test(v)) h = asUrl()?.pathname.split("/").filter(Boolean)[0] ?? "";
      h = h.replace(/^@/, "").split(/[/?#]/)[0];
      if (!/^[A-Za-z0-9._]{1,30}$/.test(h) || RESERVED.instagram.test(h)) return { reason: `not an Instagram handle: ${v}` };
      return { url: `https://www.instagram.com/${h}/`, handle: "@" + h };
    }
    case "linkedin": {
      const m = [...v.matchAll(/\/in\/([^/?#\s]+)/gi)].pop() ?? (!/[\/\s]/.test(v) ? [null, v] : null);
      if (!m) return { reason: `not a LinkedIn profile: ${v}` };
      let slug = m[1].replace(/\/+$/, "");
      try {
        slug = decodeURIComponent(slug);
      } catch {}
      if (/\s/.test(slug) || slug.length < 3) return { reason: `not a LinkedIn slug: ${v}` };
      return { url: `https://www.linkedin.com/in/${encodeURIComponent(slug).replace(/%2D/gi, "-")}/`, handle: slug };
    }
    case "facebook": {
      let path = v;
      if (/facebook\.com|fb\.com|fb\.me/i.test(v)) {
        const u = asUrl();
        if (!u) return { reason: `bad URL: ${v}` };
        if (/profile\.php/i.test(u.pathname)) {
          const id = u.searchParams.get("id");
          return id && /^\d+$/.test(id) ? { url: `https://www.facebook.com/profile.php?id=${id}`, handle: id } : { reason: `bad profile.php: ${v}` };
        }
        path = u.pathname;
      }
      const segs = path.replace(/^@/, "").split(/[?#]/)[0].split("/").filter(Boolean);
      if (segs[0] === "pg") segs.shift();
      if ((segs[0] === "p" && segs[1]) || (segs[0] === "people" && segs[2])) {
        return { url: `https://www.facebook.com/${segs.slice(0, segs[0] === "p" ? 2 : 3).join("/")}`, handle: segs[1] };
      }
      if (segs[0] === "pages" && segs.length >= 2) return { url: `https://www.facebook.com/${segs.slice(0, 3).join("/")}`, handle: segs[1] };
      const h = segs[0] ?? "";
      if (!/^[A-Za-z0-9.\-]{2,80}$/.test(h) || RESERVED.facebook.test(h)) return { reason: `not a Facebook page: ${v}` };
      return { url: `https://www.facebook.com/${h}`, handle: h };
    }
    case "bluesky": {
      let h = v;
      if (/bsky\.app/i.test(v)) h = asUrl()?.pathname.match(/\/profile\/([^/?#]+)/)?.[1] ?? "";
      h = h.replace(/^@/, "").toLowerCase();
      if (!/^(did:plc:[a-z0-9]+|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(h)) return { reason: `not a Bluesky handle: ${v}` };
      return { url: `https://bsky.app/profile/${h}`, handle: h.startsWith("did:") ? h : "@" + h };
    }
    case "tiktok": {
      let h = v;
      if (/tiktok\.com/i.test(v)) h = asUrl()?.pathname.split("/").filter(Boolean)[0] ?? "";
      h = h.replace(/^@/, "");
      if (!/^[A-Za-z0-9._]{2,24}$/.test(h) || RESERVED.tiktok.test(h)) return { reason: `not a TikTok handle: ${v}` };
      return { url: `https://www.tiktok.com/@${h}`, handle: "@" + h };
    }
    case "youtube": {
      if (/^UC[A-Za-z0-9_-]{22}$/.test(v)) return { url: `https://www.youtube.com/channel/${v}`, handle: v };
      const u = asUrl();
      if (!u || !/youtube\.com$/i.test(u.hostname.replace(/^(www|m)\./, ""))) return { reason: `not a YouTube channel: ${v}` };
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0]?.startsWith("@")) return { url: `https://www.youtube.com/${segs[0]}`, handle: segs[0] };
      if (["channel", "c", "user"].includes(segs[0]) && segs[1]) return { url: `https://www.youtube.com/${segs[0]}/${segs[1]}`, handle: segs[1] };
      return { reason: `not a YouTube channel: ${v}` };
    }
    case "mastodon": {
      let m = v.match(/^@?([A-Za-z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
      if (m) return { url: `https://${m[2].toLowerCase()}/@${m[1]}`, handle: `@${m[1]}@${m[2].toLowerCase()}` };
      const u = asUrl();
      m = u?.pathname.match(/^\/@([A-Za-z0-9_]+)\/?$/);
      if (u && m) return { url: `https://${u.hostname}/@${m[1]}`, handle: `@${m[1]}@${u.hostname}` };
      return { reason: `not a Mastodon account: ${v}` };
    }
    case "website": {
      const u = asUrl();
      if (!u || !u.hostname.includes(".")) return { reason: `bad URL: ${v}` };
      if (/(facebook|twitter|x|instagram|linkedin|youtube|tiktok|bsky)\.(com|app)$/i.test(u.hostname)) return { reason: `social link, not a website: ${v}` };
      if (/(^|\.)(gouvernement\.fr|elysee\.fr|assemblee-nationale\.fr|senat\.fr|europarl\.europa\.eu|rassemblementnational\.fr|lafranceinsoumise\.fr|parti-socialiste\.fr|republicains\.fr|parti-renaissance\.fr|linktr\.ee)$/i.test(u.hostname)) return { reason: `institution or party site, not the senator's own: ${v}` };
      return { url: u.origin + (u.pathname === "/" ? "/" : u.pathname), handle: (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/+$/, "").toLowerCase() };
    }
  }
  return { reason: "unknown platform" };
}
function platformOf(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|fr|fr-fr|web)\./, "");
  if (host === "twitter.com" || host === "x.com") return "twitter";
  if (host === "instagram.com") return "instagram";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return /\/in\//.test(u.pathname) ? "linkedin" : null;
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me") return "facebook";
  if (host === "bsky.app") return "bluesky";
  if (host === "tiktok.com") return "tiktok";
  if (host === "youtube.com") return "youtube";
  if (MASTODON_HOSTS.test(host)) return "mastodon";
  return null;
}
function nameParts(s) {
  const parts = fold(s.nom).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !["les", "des", "del", "van", "von"].includes(p));
  return [...new Set([...parts, alnum(s.nom)])];
}
const handleMatchesName = (handle, s) => {
  let h = handle ?? "";
  try {
    h = decodeURIComponent(h);
  } catch {}
  h = alnum(h);
  return !!h && nameParts(s).some((p) => h.includes(p));
};

// ---------- 1. senators ----------
console.log("Senators");
const [api, general, mandats, coms] = await Promise.all([getJson(SRC.api), getJson(SRC.general), getJson(SRC.mandats), getJson(SRC.commissions)]);
const gen = new Map(general.results.filter((r) => r.Etat === "ACTIF").map((r) => [r.Matricule, r]));
meta.checks.senators = { api: api.length, odsenActive: gen.size, expected: 348 };
if (api.length !== gen.size) console.warn(`  ! senators API lists ${api.length}, ODSEN_GENERAL ${gen.size} active`);

// group colours from the hemicycle widget on www.senat.fr
let groupColours = {};
try {
  const { body } = await getText(SRC.home);
  const attr = body.match(/<hemicycle-groups[\s\S]*?\sgroups="([^"]+)"/)?.[1];
  for (const g of JSON.parse(parse(`<p>${attr}</p>`).text)) groupColours[g.id] = { couleur: g.color, sieges: g.seats.length, nom: g.name };
} catch (e) {
  console.warn(`  ! group colours not found on ${SRC.home}: ${e.message}`);
}
meta.groupes = groupColours;

const mandatsBy = Map.groupBy(mandats.results, (r) => r.Matricule);
const comsBy = Map.groupBy(coms.results.filter((r) => !r.Fin_d_appartenance && !r.Fin_de_fonction), (r) => r.Matricule);
const APP = { N: "membre", A: "apparenté", R: "rattaché" };

const senateurs = api.map((a) => {
  const g = gen.get(a.matricule) ?? {};
  // current mandate, and the start of uninterrupted service (consecutive mandates with < 40 days between them)
  const ms = (mandatsBy.get(a.matricule) ?? []).filter((m) => m.Date_de_debut_de_mandat).sort((x, y) => x.Date_de_debut_de_mandat.localeCompare(y.Date_de_debut_de_mandat));
  const cur = ms.findLast((m) => !m.Date_de_fin_de_mandat) ?? ms.at(-1);
  let since = cur ? day(cur.Date_de_debut_de_mandat) : null;
  for (let i = ms.indexOf(cur) - 1; i >= 0 && ms[i].Date_de_fin_de_mandat; i--) {
    if (Date.parse(since) - Date.parse(day(ms[i].Date_de_fin_de_mandat)) > 40 * 864e5) break;
    since = day(ms[i].Date_de_debut_de_mandat);
  }
  const myComs = comsBy.get(a.matricule) ?? [];
  const perm = myComs.find((c) => c.Type_commission === "Commission permanente");
  const code = a.circonscription?.code ?? null;
  const gc = groupColours[a.groupe?.code];
  return {
    id: a.matricule,
    civ: a.civilite,
    prenom: a.prenom,
    nom: a.nom,
    alpha: a.nom,
    feminin: a.feminise,
    naissance: day(g.Date_naissance),
    profession: str(g.Description_de_la_profession),
    catSocPro: str(g.PCS_INSEE), // INSEE socio-professional category, as published by the Sénat
    categoriePro: str(g.Categorie_professionnelle) ?? str(a.categorieProfessionnelle?.libelle), // the Sénat's own grouping
    email: g.Courrier_electronique && g.Courrier_electronique.includes("@") ? g.Courrier_electronique : null,
    groupe: a.groupe ? { id: a.groupe.code, abrev: a.groupe.libelleCourt, libelle: a.groupe.libelle, couleur: gc?.couleur ?? null, appartenance: APP[a.groupe.codeTypeAppartenance] ?? a.groupe.codeTypeAppartenance ?? null } : null,
    circonscription: a.circonscription?.libelle ?? g.Circonscription ?? null,
    codeCirconscription: code,
    // department code shared with the rest of the site; "99" = French people living abroad (as for MPs)
    numDepartement: code === "997" || code === "998" ? "99" : code,
    serie: a.serie ? Number(a.serie) : null,
    siege: a.siege ?? null,
    commission: perm ? { libelle: perm.Nom_commission, fonction: perm.Fonction } : null,
    autresCommissions: myComs.filter((c) => c !== perm).map((c) => ({ libelle: c.Nom_commission, type: c.Type_commission, fonction: c.Fonction })),
    bureau: str(g.Fonction_au_Bureau_du_Senat),
    debutMandat: since && cur ? day(cur.Date_de_debut_de_mandat) : null,
    senateurDepuis: since,
    photo: a.urlAvatar ? SENAT + a.urlAvatar : null,
    url: a.url ? SENAT + a.url : null,
    hatvp: null,
    wikidata: null,
    socials: {},
  };
});
const byId = new Map(senateurs.map((s) => [s.id, s]));
console.log(`  ✓ ${senateurs.length} sitting senators`);

// ---------- 2. senators' pages on senat.fr (contact links, HATVP) — weekly ----------
cache.pages ??= {};
if (!fresh(cache.pagesAt, PAGE_DAYS) || senateurs.some((s) => !cache.pages[s.id])) {
  const todo = senateurs.filter((s) => s.url && (!fresh(cache.pagesAt, PAGE_DAYS) || !cache.pages[s.id]));
  console.log(`  ↓ ${todo.length} senator pages`);
  await pool(todo, 3, async (s) => {
    try {
      const { body } = await getText(s.url);
      const contact = body.match(/Contact&nbsp;:<\/dt>([\s\S]*?)<\/ul>/)?.[1] ?? "";
      const links = [...contact.matchAll(/<a href="([^"]+)"[^>]*title="([^"]*)"/g)].filter((m) => !m[1].startsWith("mailto:")).map((m) => ({ href: m[1], title: text(m[2]) }));
      const hatvp = body.match(/href="(https?:\/\/(?:www\.)?hatvp\.fr\/[^"]+)"/)?.[1]?.replace(/^http:/, "https:") ?? null;
      cache.pages[s.id] = { links, hatvp };
    } catch (e) {
      console.warn(`  ! ${s.id} ${e.message}`);
    }
  });
  if (!fresh(cache.pagesAt, PAGE_DAYS)) cache.pagesAt = meta.syncedAt;
}
for (const id of Object.keys(cache.pages)) if (!byId.has(id)) delete cache.pages[id];

// ---------- 3. socials ----------
const candidates = new Map(senateurs.map((s) => [s.id, []])); // { platform, url, handle, source, confidence, evidence }
const rejected = [];
function propose(id, platform, raw, source, confidence, evidence) {
  const s = byId.get(id);
  if (!s || !PLATFORMS.includes(platform)) return;
  const n = normalize(platform, raw);
  if (!n.url) return rejected.push({ id, nom: `${s.prenom} ${s.nom}`, platform, value: raw, source, reason: n.reason });
  if (INSTITUTIONAL.test(n.handle?.replace(/^@/, ""))) return rejected.push({ id, nom: `${s.prenom} ${s.nom}`, platform, value: raw, source, reason: "institutional account" });
  candidates.get(id).push({ platform, ...n, source, confidence, ...(evidence ? { evidence } : {}) });
}
const coverage = {};
const step = (name) => {
  const c = {};
  for (const p of PLATFORMS) c[p] = senateurs.filter((s) => candidates.get(s.id).some((x) => x.platform === p)).length;
  coverage[name] = c;
};
const TITLE = { twitter: "twitter", facebook: "facebook", linkedin: "linkedin", instagram: "instagram", bluesky: "bluesky", tiktok: "tiktok", youtube: "youtube", mastodon: "mastodon", "site perso": "website" };

// 3a. what the senator declared to the Sénat: API (X, Facebook) + contact links on the official page
for (const a of api) {
  if (a.twitter) propose(a.matricule, "twitter", a.twitter, "senat", "high");
  if (a.facebook) propose(a.matricule, "facebook", a.facebook, "senat", "high");
}
for (const s of senateurs) {
  const pg = cache.pages[s.id];
  if (!pg) continue;
  s.hatvp = pg.hatvp;
  for (const l of pg.links) {
    const t = fold(l.title).replace(/^sur\s+/, "").replace(/\.$/, "");
    const p = platformOf(l.href) ?? TITLE[t] ?? (/site|blog/.test(t) ? "website" : null);
    if (p) propose(s.id, p, l.href, "senat", "high", { page: s.url });
    else rejected.push({ id: s.id, nom: `${s.prenom} ${s.nom}`, platform: null, value: l.href, source: "senat", reason: `unknown link type "${l.title}"` });
  }
}
step("senat");

// 3b. Wikidata, joined on P1808 (Sénat id, "senateur/<slug>")
if (!args.has("--no-wikidata")) {
  if (!fresh(cache.wikidataAt, PAGE_DAYS) || !cache.wikidata) {
    const props = { P2002: "twitter", P2003: "instagram", P6634: "linkedin", P2013: "facebook", P12361: "bluesky", P7085: "tiktok", P2397: "youtube", P4033: "mastodon", P856: "website" };
    const slugs = senateurs.filter((s) => s.url).map((s) => s.url.match(/\/senateur\/([^/]+)\.html$/)?.[1]).filter(Boolean);
    const query = `SELECT ?id ?item ?prop ?val WHERE {
      VALUES ?id { ${slugs.map((x) => `"senateur/${x}" "${x}"`).join(" ")} }
      ?item wdt:P1808 ?id .
      OPTIONAL { VALUES ?prop { ${Object.keys(props).map((p) => "wdt:" + p).join(" ")} } ?item ?prop ?val . }
    }`;
    let rows = null;
    for (let attempt = 1; attempt <= 3 && !rows; attempt++) {
      try {
        const r = await fetch("https://query.wikidata.org/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json", "User-Agent": UA },
          body: "query=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(90000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        rows = (await r.json()).results.bindings.map((b) => ({ slug: b.id.value.replace(/^senateur\//, ""), qid: b.item.value.split("/").pop(), platform: b.prop ? props[b.prop.value.split("/").pop()] : null, value: b.val?.value ?? null }));
      } catch (e) {
        console.warn(`  ! wikidata attempt ${attempt}: ${e.message}`);
        await sleep(5000 * attempt);
      }
    }
    if (rows) {
      cache.wikidata = rows;
      cache.wikidataAt = meta.syncedAt;
    }
  }
  const bySlug = new Map(senateurs.map((s) => [s.url?.match(/\/senateur\/([^/]+)\.html$/)?.[1], s]));
  for (const r of cache.wikidata ?? []) {
    const s = bySlug.get(r.slug);
    if (!s) continue;
    s.wikidata = r.qid;
    if (r.platform) propose(s.id, r.platform, r.value, "wikidata", "high", { wikidata: r.qid });
  }
  step("wikidata");
}

// 3c. the senator's own website (declared on senat.fr, else Wikidata P856): homepage + one contact page
if (!args.has("--no-sites")) {
  cache.sites ??= {};
  const robots = new Map();
  const allowed = async (url) => {
    const u = new URL(url);
    if (!robots.has(u.origin)) {
      robots.set(u.origin, (async () => {
        try {
          const r = await get(u.origin + "/robots.txt", { tries: 1, timeout: 10000 });
          if (r.failed) return [];
          const lines = (await r.text()).split(/\r?\n/);
          const dis = [];
          let applies = false;
          for (const l of lines) {
            const [k, ...rest] = l.split(":");
            const v = rest.join(":").trim();
            if (/^user-agent$/i.test(k.trim())) applies = v === "*" || /thirdestate|projectview/i.test(v);
            else if (applies && /^disallow$/i.test(k.trim()) && v) dis.push(v);
          }
          return dis;
        } catch {
          return [];
        }
      })());
    }
    const dis = await robots.get(u.origin);
    return !dis.some((d) => u.pathname.startsWith(d.replace(/\*.*$/, "")));
  };
  const linksOf = (html, base) => {
    const out = [];
    for (const a of parse(html).querySelectorAll("a")) {
      try {
        out.push(new URL(a.getAttribute("href") ?? "", base).href);
      } catch {}
    }
    return out;
  };
  const siteOf = (s) => {
    const c = candidates.get(s.id).filter((x) => x.platform === "website");
    return (c.find((x) => x.source === "senat") ?? c[0])?.url ?? null;
  };
  const todo = senateurs.filter((s) => siteOf(s) && (!fresh(cache.sites[s.id]?.at, PAGE_DAYS) || cache.sites[s.id]?.url !== siteOf(s)));
  if (todo.length) console.log(`  ↓ ${todo.length} senators' own sites`);
  await pool(todo, 6, async (s) => {
    const url = siteOf(s);
    const entry = { url, at: meta.syncedAt, links: [], pages: [] };
    try {
      if (!(await allowed(url))) {
        entry.error = "robots.txt disallows";
      } else {
        const res = await get(url, { tries: 2, timeout: 15000, accept: "text/html" });
        if (res.failed) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const links = linksOf(html, res.url);
        entry.pages.push(res.url);
        const contact = links.find((h) => {
          try {
            return new URL(h).host === new URL(res.url).host && /contact|a-propos|apropos|qui-suis|biographie|me-contacter|reseaux|suivez/i.test(new URL(h).pathname);
          } catch {
            return false;
          }
        });
        if (contact && (await allowed(contact))) {
          const r2 = await get(contact, { tries: 1, timeout: 15000, accept: "text/html" });
          if (!r2.failed) {
            links.push(...linksOf(await r2.text(), r2.url));
            entry.pages.push(r2.url);
          }
        }
        entry.links = [...new Set(links)].filter((h) => platformOf(h) && !/sharer|share\?|intent\/|\/share\b|shareArticle|\/status\/|\/p\/[A-Za-z0-9_-]+|\/posts?\/|\/watch\?|\/videos?\/|\/reel\//i.test(h));
      }
    } catch (e) {
      entry.error = e.message.slice(0, 120);
    }
    cache.sites[s.id] = entry;
  });
  for (const id of Object.keys(cache.sites)) if (!byId.has(id)) delete cache.sites[id];
  // an account linked from two or more senators' sites is a party / group account
  const seen = new Map();
  for (const [id, e] of Object.entries(cache.sites)) for (const h of e.links) {
    const n = normalize(platformOf(h), h);
    if (n.url) seen.set(n.url, (seen.get(n.url) ?? new Set()).add(id));
  }
  for (const [id, e] of Object.entries(cache.sites)) {
    const s = byId.get(id);
    for (const h of e.links) {
      const p = platformOf(h);
      const n = normalize(p, h);
      if (!n.url) continue;
      if (seen.get(n.url).size > 1) {
        rejected.push({ id, nom: `${s.prenom} ${s.nom}`, platform: p, value: h, source: "site", reason: `linked from ${seen.get(n.url).size} senators' sites (party or group account)` });
        continue;
      }
      const named = handleMatchesName(n.handle, s);
      if (p === "linkedin" && !named) {
        rejected.push({ id, nom: `${s.prenom} ${s.nom}`, platform: p, value: h, source: "site", reason: "LinkedIn profile without the senator's name" });
        continue;
      }
      propose(id, p, h, "site", named ? "high" : "medium", { page: e.pages[0] });
    }
  }
  step("site");
}

// 3d. manual overrides (optional file): senator_id,platform,url,note — empty url removes the platform
const overrides = [];
try {
  for (const o of csvObjects(await readFile(OVERRIDES, "utf8"))) {
    const id = o.senator_id ?? o.mp_id;
    if (!byId.has(id) || !PLATFORMS.includes(o.platform)) continue;
    overrides.push({ id, platform: o.platform, url: o.url, note: o.note });
  }
} catch {}

// merge: strongest source wins, agreeing sources go to confirmedBy, disagreeing ones to conflicts
const RANK = { override: 0, senat: 1, wikidata: 2, site: 3 };
const CONF = { high: 0, medium: 1, low: 2 };
const conflicts = [];
for (const s of senateurs) {
  const list = candidates.get(s.id);
  for (const p of PLATFORMS) {
    const ov = overrides.find((o) => o.id === s.id && o.platform === p);
    if (ov && !ov.url) continue;
    const mine = list.filter((c) => c.platform === p);
    if (ov) {
      const n = normalize(p, ov.url);
      if (n.url) mine.unshift({ platform: p, ...n, source: "override", confidence: "high", ...(ov.note ? { evidence: { note: ov.note } } : {}) });
    }
    if (!mine.length) continue;
    mine.sort((x, y) => RANK[x.source] - RANK[y.source] || CONF[x.confidence] - CONF[y.confidence]);
    const best = mine[0];
    const key = (c) => c.url.toLowerCase();
    const confirmedBy = [...new Set(mine.filter((c) => c !== best && key(c) === key(best) && c.source !== best.source).map((c) => c.source))];
    const others = [...new Set(mine.filter((c) => key(c) !== key(best)).map((c) => `${c.source}: ${c.url}`))];
    if (others.length) conflicts.push({ id: s.id, nom: `${s.prenom} ${s.nom}`, platform: p, kept: `${best.source}: ${best.url}`, others });
    s.socials[p] = { url: best.url, handle: best.handle, source: best.source, confidence: confirmedBy.length && best.confidence === "medium" ? "high" : best.confidence, ...(confirmedBy.length ? { confirmedBy } : {}), ...(best.evidence && !confirmedBy.length ? { evidence: best.evidence } : {}) };
  }
}
{
  const c = {};
  for (const p of PLATFORMS) c[p] = senateurs.filter((s) => s.socials[p]).length;
  coverage.final = c;
}
meta.socials = { coverage, withAnyAccount: senateurs.filter((s) => Object.keys(s.socials).some((p) => p !== "website")).length, wikidataItems: senateurs.filter((s) => s.wikidata).length, conflicts, rejected, siteErrors: Object.entries(cache.sites ?? {}).filter(([, e]) => e.error).map(([id, e]) => ({ id, url: e.url, error: e.error })) };
console.log(`  ✓ socials: ${JSON.stringify(coverage.final)}`);

// ---------- 4. votes (scrutins publics) ----------
console.log("Votes");
const now = new Date();
const currentSession = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1; // sessions open on 1 October
const prevScrutins = FULL ? [] : await readJson(new URL("scrutins.json", OUT), []);
const prev = new Map(prevScrutins.map((s) => [s[0], s]));
// previous positions, read back from the per-senator files (only sitting senators matter)
const votes = new Map(senateurs.map((s) => [s.id, {}]));
if (!FULL) {
  for (const s of senateurs) {
    const v = await readJson(new URL(`votes/${s.id}.json`, OUT), null);
    if (v) votes.set(s.id, v);
  }
}
const recentCut = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
const ids = [];
for (let y = FIRST_SESSION; y <= currentSession; y++) {
  let body;
  try {
    ({ body } = await getText(SRC.scrutinsIndex(y)));
  } catch (e) {
    if (y === currentSession && /HTTP 404/.test(e.message)) continue; // new session, no vote yet
    throw e;
  }
  const nums = [...new Set([...body.matchAll(new RegExp(`scr${y}-(\\d+)\\.html`, "g"))].map((m) => Number(m[1])))].sort((a, b) => a - b);
  for (const n of nums) ids.push([y, n]);
  meta.checks[`session${y}`] = { listed: nums.length, max: nums.at(-1) ?? 0 };
}
const MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const LETTER = { p: "P", c: "C", a: "A", n: "N" };
cache.mismatches ??= {};
const unknownCodes = {};
const todo = ids.filter(([y, n]) => {
  const old = prev.get(`${y}-${n}`);
  return !old || old[1] >= recentCut || (cache.noNominative ?? []).includes(`${y}-${n}`);
});
console.log(`  ${ids.length} votes listed, ${todo.length} to fetch`);
let done = 0;
const failed = [];
const noNominative = [];
const fetched = await pool(todo, 3, async ([y, n]) => {
  const id = `${y}-${n}`;
  let html, js;
  try {
    ({ body: html } = await getText(SRC.scrutinPage(y, n)));
  } catch (e) {
    console.warn(`  ! ${id} skipped: ${e.message}`);
    failed.push(id);
    return null;
  }
  try {
    js = await getJson(SRC.scrutinVotes(y, n));
  } catch (e) {
    // a few vote pages have no machine-readable list (the names are only in the page text): keep the totals,
    // record the gap, and try again on every run
    if (!/HTTP 404/.test(e.message)) throw e;
    noNominative.push(id);
    js = { votes: [] };
  }
  if (++done % 100 === 0) console.log(`  … ${done}/${todo.length}`);
  const h1 = text(html.match(/<h1 class="page-title">([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const dm = fold(h1).match(/(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/);
  const date = dm && MONTHS[dm[2]] ? `${dm[3]}-${String(MONTHS[dm[2]]).padStart(2, "0")}-${dm[1].padStart(2, "0")}` : null;
  const titre = text(html.match(/<p class="page-lead">([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/^sur\s+/i, "");
  const badge = text(html.match(/<span class="badge rounded-pill[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "");
  const header = text(html.match(/R&eacute;sultat du scrutin<\/h2>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? "");
  const sort = (badge || (/n'a pas adopt/i.test(header) ? "rejeté" : /a adopt/i.test(header) ? "adopté" : "")).toLowerCase();
  const tot = {};
  const card = html.slice(html.indexOf("sultat du scrutin"), html.indexOf("Analyse par groupes") > 0 ? html.indexOf("Analyse par groupes") : undefined);
  for (const m of card.matchAll(/<strong class="display-4[^"]*">(\d+)<\/strong>\s*([^<]+)<\/li>/g)) tot[fold(text(m[2]))] = Number(m[1]);
  const abst = Number(card.match(/Abstention&nbsp;:\s*<span class="fw-semibold">(\d+)/)?.[1] ?? NaN);
  const nppv = Number(card.match(/pris part au vote&nbsp;:\s*<span class="fw-semibold">(\d+)/)?.[1] ?? NaN);
  const dossier = html.match(/<a href="([^"]*dossier-legislatif[^"]*)"/)?.[1] ?? null;
  const positions = {};
  const count = { P: 0, C: 0, A: 0, N: 0 };
  for (const v of arr(js.votes)) {
    const l = LETTER[v.vote];
    if (!l) {
      unknownCodes[v.vote] = (unknownCodes[v.vote] ?? 0) + 1;
      continue;
    }
    positions[v.matricule] = l;
    count[l]++;
  }
  const rec = [id, date, titre, sort, null, tot.pour ?? count.P, tot.contre ?? count.C, Number.isNaN(abst) ? count.A : abst, Number.isNaN(nppv) ? count.N : nppv, dossier ? new URL(dossier, SENAT).href : null];
  delete cache.mismatches[id];
  if (js.votes.length && (tot.pour !== count.P || tot.contre !== count.C || abst !== count.A)) {
    // A difference of one or two is a published correction ("mise au point") or a delegation detail: keep the
    // positions. A large one means the JSON file holds another vote's list (seen for 2023-98…100): drop it.
    const gap = Math.abs(tot.pour - count.P) + Math.abs(tot.contre - count.C) + Math.abs(abst - count.A);
    const dropped = gap > 5;
    cache.mismatches[id] = { id, published: { pour: tot.pour, contre: tot.contre, abstention: abst, nppv }, nominative: count, gap, positions: dropped ? "dropped" : "kept" };
    if (dropped) {
      for (const k of Object.keys(positions)) delete positions[k];
      noNominative.push(id);
    }
  }
  if (!date || !sort || tot.pour == null) console.warn(`  ! ${id}: could not read ${!date ? "date " : ""}${!sort ? "outcome " : ""}${tot.pour == null ? "totals" : ""}`);
  return { rec, positions };
});
const scrutins = new Map(ids.map(([y, n]) => [`${y}-${n}`, prev.get(`${y}-${n}`)]));
for (const { rec, positions } of fetched.filter(Boolean)) {
  scrutins.set(rec[0], rec);
  for (const [id, v] of votes) {
    if (positions[id]) v[rec[0]] = positions[id];
    else delete v[rec[0]];
  }
}
// drop positions on votes no longer listed (or outside the window)
for (const v of votes.values()) for (const k of Object.keys(v)) if (!scrutins.has(k)) delete v[k];
const scrutinList = [...scrutins.values()].filter(Boolean).sort((a, b) => {
  const [ya, na] = a[0].split("-").map(Number);
  const [yb, nb] = b[0].split("-").map(Number);
  return yb - ya || nb - na;
});
meta.checks.votes = { listed: ids.length, written: scrutinList.length, fetchedThisRun: fetched.filter(Boolean).length, failed, noNominativeList: [...new Set([...(cache.noNominative ?? []).filter((id) => !fetched.some((x) => x?.rec[0] === id)), ...noNominative])].sort(), totalsMismatches: Object.keys(cache.mismatches).length, unknownVoteCodes: unknownCodes };
for (const id of Object.keys(cache.mismatches)) if (!scrutins.has(id)) delete cache.mismatches[id];
meta.checks.totalsMismatches = Object.values(cache.mismatches);
cache.noNominative = meta.checks.votes.noNominativeList;
console.log(`  ✓ ${scrutinList.length} votes; ${Object.keys(cache.mismatches).length} with published totals that differ from the nominative list; ${cache.noNominative.length} without a usable nominative list`);

// stats: over the votes held while the senator was sitting (the Sénat lists every sitting senator on each vote)
for (const s of senateurs) {
  const v = votes.get(s.id);
  const c = { P: 0, C: 0, A: 0, N: 0 };
  for (const x of Object.values(v)) c[x]++;
  const held = c.P + c.C + c.A + c.N;
  const cast = c.P + c.C + c.A;
  s.stats = { pour: c.P, contre: c.C, abstention: c.A, nonVotant: c.N, scrutins: held, participation: held ? cast / held : 0, partPour: cast ? c.P / cast : 0, partContre: cast ? c.C / cast : 0, partAbstention: cast ? c.A / cast : 0 };
}
senateurs.sort((a, b) => a.alpha.localeCompare(b.alpha, "fr") || a.prenom.localeCompare(b.prenom, "fr"));

// ---------- 5. senatorial elections of 27 September 2026 (series 2) ----------
let elections = null;
if (!args.has("--no-elections")) {
  console.log("Elections 2026");
  try {
    const ds = await getJson(SRC.elections);
    const res = (re) => ds.resources.find((r) => re.test(r.title));
    const rElus = res(/[ée]lus/i);
    const rT1 = res(/T1/);
    const rT2 = res(/T2/);
    const csv = async (r) => (r ? csvObjects((await getText(r.url)).body, ";") : []);
    const [elus, t1, t2] = await Promise.all([csv(rElus), csv(rT1), csv(rT2)]);
    const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(/\s/g, "").replace("%", "").replace(",", ".")));
    const dep = (c) => (/^\d$/.test(c) ? "0" + c : c);
    const totals = (r) => ({ inscrits: num(r.Inscrits), votants: num(r.Votants), abstentions: num(r.Abstentions), exprimes: num(r["Exprimés"]), blancs: num(r.Blancs), nuls: num(r.Nuls) });
    const slots = (r) => {
      const out = [];
      for (let i = 1; `Nuance candidat ${i}` in r; i++) {
        const isList = r[`Libellé de liste ${i}`] || r[`Nuance liste ${i}`];
        if (isList) out.push({ nuance: r[`Nuance liste ${i}`] || null, liste: r[`Libellé de liste ${i}`], listeAbrege: r[`Libellé abrégé de liste ${i}`] || null, voix: num(r[`Voix ${i}`]), pctExprimes: num(r[`% Voix/exprimés ${i}`]), sieges: num(r[`Sièges ${i}`]) ?? 0 });
        else if (r[`Nom candidat ${i}`]) out.push({ nuance: r[`Nuance candidat ${i}`] || null, nom: r[`Nom candidat ${i}`], prenom: r[`Prénom candidat ${i}`], sexe: r[`Sexe candidat ${i}`]?.[0] ?? null, voix: num(r[`Voix ${i}`]), pctExprimes: num(r[`% Voix/exprimés ${i}`]), elu: !!r[`Elu ${i}`] });
      }
      return out.sort((a, b) => (b.voix ?? 0) - (a.voix ?? 0));
    };
    // link each winner to a sitting senator: same birth date and same name (accents / case / spaces ignored)
    const active = [...gen.values()];
    const findSen = (e) => active.find((g) => day(g.Date_naissance) === e.DATNAIPSN && alnum(g.Nom_usuel) === alnum(e.NOMPSN)) ?? active.find((g) => day(g.Date_naissance) === e.DATNAIPSN && alnum(g.Prenom_usuel) === alnum(e.PREPSN));
    const depts = new Map();
    for (const r of t1) {
      const lists = slots(r);
      depts.set(dep(r["Code département"]), { code: dep(r["Code département"]), nom: r["Libellé département"], mode: lists.some((x) => x.liste) ? "proportionnel" : "majoritaire", sieges: 0, tours: [{ tour: 1, ...totals(r), resultats: lists }], elus: [] });
    }
    for (const r of t2) depts.get(dep(r["Code département"]))?.tours.push({ tour: 2, ...totals(r), resultats: slots(r) });
    const unmatched = [];
    for (const e of elus) {
      const d = depts.get(dep(e.CODDPT));
      if (!d) {
        unmatched.push(`${e.PREPSN} ${e.NOMPSN} (département ${e.CODDPT} not in results)`);
        continue;
      }
      const g = findSen(e);
      if (!g) unmatched.push(`${e.PREPSN} ${e.NOMPSN} (${d.nom}): no sitting senator with that name and birth date`);
      d.elus.push({ nom: e.NOMPSN, prenom: e.PREPSN, sexe: e.SEXPSN || null, naissance: e.DATNAIPSN || null, nuance: e.CODE_NUA || null, tour: Number(e.TOUR_ELECTION?.match(/T(\d)/)?.[1]) || null, sortant: e.SORTANT === "OUI", personnalite: e.CODE_PERSONNALITE || null, senateur: g?.Matricule ?? null });
      d.sieges++;
    }
    const list = [...depts.values()].sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
    elections = {
      fetchedAt: meta.syncedAt,
      election: "Élections sénatoriales du 27 septembre 2026 (série 2)",
      date: "2026-09-27",
      serie: 2,
      source: { producer: "Ministère de l'Intérieur", dataset: ds.page, licence: ds.license, lastModified: ds.last_modified, files: [rElus, rT1, rT2].filter(Boolean).map((r) => ({ title: r.title, url: r.url, lastModified: r.last_modified })) },
      note: "Provisional results as published by the Ministry, subject to appeals before the Conseil constitutionnel. Nuances are the Ministry's codes.",
      sieges: list.reduce((n, d) => n + d.sieges, 0),
      departements: list,
    };
    meta.checks.elections = { departements: list.length, sieges: elections.sieges, elus: elus.length, linkedToSenator: elus.length - unmatched.filter((u) => u.includes("no sitting")).length, unmatched };
    console.log(`  ✓ ${list.length} departments, ${elections.sieges} seats, ${unmatched.length} winners not linked to a sitting senator`);
  } catch (e) {
    console.warn(`  ! elections skipped: ${e.message}`);
    meta.checks.elections = { error: e.message };
  }
}

// ---------- write ----------
await mkdir(new URL("votes/", OUT), { recursive: true });
for (const f of await readdir(new URL("votes/", OUT))) if (!byId.has(f.replace(/\.json$/, ""))) await rm(new URL(`votes/${f}`, OUT));
await writeFile(new URL("senateurs.json", OUT), JSON.stringify(senateurs));
await writeFile(new URL("scrutins.json", OUT), JSON.stringify(scrutinList));
for (const [id, v] of votes) {
  const sorted = Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  await writeFile(new URL(`votes/${id}.json`, OUT), JSON.stringify(sorted));
}
if (elections) await writeFile(new URL("elections-2026.json", OUT), JSON.stringify(elections));
meta.sources = { ...SRC, scrutinsIndex: SRC.scrutinsIndex("<session>"), scrutinPage: SRC.scrutinPage("<session>", "<n>"), scrutinVotes: SRC.scrutinVotes("<session>", "<n>"), licence: "Licence Ouverte (data.senat.fr/licence, www.senat.fr); Licence Ouverte 2.0 (data.gouv.fr); CC0 (Wikidata)" };
await writeFile(new URL("meta.json", OUT), JSON.stringify(meta, null, 1));
await mkdir(new URL("data/", ROOT), { recursive: true });
await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1) + "\n");
console.log("✓ wrote public/data/senat/ and data/senat-cache.json");
