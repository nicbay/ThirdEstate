// Finds sitting MPs' social media accounts from free sources and records where each one came from.
//
// Output:
//   public/data/an/socials.json        { [mpId]: { [platform]: { url, handle, source, confidence, confirmedBy? } } }
//   public/data/an/socials-meta.json   coverage per platform after each source, conflicts, rejected candidates
//
// Sources, strongest first (a stronger source wins; weaker ones that agree are listed in `confirmedBy`):
//   override     data/socials-overrides.csv (always wins; an empty url removes a platform)
//   assemblee    what the MP declared to the Assemblée (already in deputes.json)
//   wikidata     Wikidata properties, matched on the Assemblée id (P4123)
//   site         links on the MP's own website (declared site or Wikidata P856)
//   group        the parliamentary group's "our MPs" pages
//   nosdeputes   what the MP declared in the previous term (NosDéputés.fr archive of the 16th legislature)
//   bluesky      Bluesky search, accepted only on a full-name match plus a French-MP role in the bio
//   ai           Claude Haiku 5.5 picks between ambiguous candidates (only if ANTHROPIC_API_KEY is set)
//
// Never scrapes LinkedIn, Instagram, X or Facebook: it only reads pages that link to them.
//
// Flags: --no-sites --no-groups --no-bluesky --no-ai --refresh (ignore the fetch cache)

import { readFile, writeFile, mkdir } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const DEPUTES = new URL("public/data/an/deputes.json", ROOT);
const OUT = new URL("public/data/an/socials.json", ROOT);
const OUT_META = new URL("public/data/an/socials-meta.json", ROOT);
const OVERRIDES = new URL("data/socials-overrides.csv", ROOT);
// committed: AI verdicts (so budget is never spent twice), domain-guess results, NosDéputés fallback
const CACHE = new URL("data/socials-cache.json", ROOT);
// not committed (.cache/ is git-ignored): links of fetched pages, kept CACHE_DAYS to make reruns fast
const FETCH_CACHE = new URL(".cache/socials-fetch.json", ROOT);

const args = new Set(process.argv.slice(2));
const UA = "ThirdEstate-socials/1.0 (+https://github.com/nicbay/projectview)";
const CACHE_DAYS = 7;
const PLATFORMS = ["twitter", "instagram", "linkedin", "facebook", "bluesky", "tiktok", "youtube", "mastodon", "website"];
const RANK = { override: 0, assemblee: 1, wikidata: 2, site: 3, group: 4, nosdeputes: 5, bluesky: 6, ai: 7 };

// ---------- helpers ----------
const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const alnum = (s) => fold(s).replace(/[^a-z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Name parts long enough to be meaningful in a handle ("Allegret-Pilot" -> ["allegret", "pilot", "allegretpilot"]). */
function nameParts(mp) {
  const parts = fold(mp.nom).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !["les", "des", "del", "van", "von"].includes(p));
  return [...new Set([...parts, alnum(mp.nom)])];
}
/** Does a handle / slug look like it belongs to this MP? */
function handleMatchesName(handle, mp) {
  const h = alnum(decodeURIComponent(handle ?? ""));
  if (!h) return false;
  return nameParts(mp).some((p) => h.includes(p));
}

// ---------- URL normalisation ----------
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
// The institution's and parties' own accounts, never an MP's
const INSTITUTIONAL = /^@?(assemblee-?nationale|assembleenat|assembleenationale|lcp|lcpan|senat|gouvernementfr|elysee|rnational_off|rassemblementnational|franceinsoumise|lafranceinsoumise|partisocialiste|renaissance|lesrepublicains|modem|horizons_|horizonsleparti|eelv|lesecologistes|pcf|udr)$/i;
const RESERVED = {
  twitter: /^(intent|share|home|hashtag|i|search|login|signup|explore|settings|privacy|tos|notifications|messages)$/i,
  instagram: /^(p|reel|reels|explore|stories|accounts|tv|direct|about|developer|legal)$/i,
  facebook: /^(sharer|sharer\.php|share|dialog|plugins|login|tr|events|groups|hashtag|watch|help|policies|privacy|pages\/category)$/i,
  tiktok: /^(tag|discover|music|embed|share)$/i,
};
const MASTODON_HOSTS = /^(mastodon\.(social|online|xyz|world)|piaille\.fr|mamot\.fr|framapiaf\.org|mastodon\.tedomum\.net|social\.sciences\.re|mstdn\.social|pouet\.chapril\.org|toot\.portes-ouvertes\.org|mastodon\.green|eldritch\.cafe|h4\.io|social\.vivaldi\.net)$/i;

/**
 * Turns a raw value (URL, @handle, bare handle, "/in/slug") into { url, handle } for a platform,
 * or { reason } when it can't be used.
 */
export function normalize(platform, raw) {
  let v = String(raw ?? "").trim();
  if (!v) return { reason: "empty" };
  v = v.replace(/^<|>$/g, "");
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
      h = h.split("@").pop().split(/[/?#]/)[0]; // "@X@handle", "handle/"
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
      // Assemblée values look like "/in/slug", sometimes with a whole URL pasted after it
      const m = [...v.matchAll(/\/in\/([^/?#\s]+)/gi)].pop() ?? (!/[\/\s]/.test(v) ? [null, v] : null);
      if (!m) return { reason: /linkedin\.com\/(company|school|showcase)/i.test(v) ? `not a personal profile: ${v}` : `not a LinkedIn profile: ${v}` };
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
      } else if (/^(profile\.php\?)?id=(\d+)$/.test(v)) {
        const id = v.match(/id=(\d+)/)[1];
        return { url: `https://www.facebook.com/profile.php?id=${id}`, handle: id };
      }
      const segs = path.replace(/^@/, "").split(/[?#]/)[0].split("/").filter(Boolean);
      if (segs[0] === "pg") segs.shift();
      // newer page URLs: /p/Name-123456 and /people/Name/123456
      if ((segs[0] === "p" && segs[1]) || (segs[0] === "people" && segs[2])) {
        const p = segs.slice(0, segs[0] === "p" ? 2 : 3).join("/");
        return { url: `https://www.facebook.com/${p}`, handle: decodeURIComponentSafe(segs[1]) };
      }
      if (segs[0] === "pages" && segs.length >= 2) {
        const p = segs.slice(0, 3).join("/");
        return { url: `https://www.facebook.com/${p}`, handle: segs[1] };
      }
      const h = (segs[0] ?? "").split(/[?#]/)[0];
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
      if (/(^|\.)(gouvernement\.fr|elysee\.fr|assemblee-nationale\.fr|senat\.fr|europarl\.europa\.eu|rassemblementnational\.fr|lafranceinsoumise\.fr|parti-socialiste\.fr|republicains\.fr|parti-renaissance\.fr|mlafrance\.fr)$/i.test(u.hostname)) return { reason: `institution or party site, not the MP's own: ${v}` };
      return { url: u.origin + (u.pathname === "/" ? "/" : u.pathname), handle: (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/+$/, "").toLowerCase() };
    }
  }
  return { reason: "unknown platform" };
}

/** Which platform a link points to (or null). */
export function platformOf(href) {
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

// ---------- HTTP with robots.txt, per-host politeness and a cache ----------
let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE, "utf8"));
} catch {}
cache.fetched = {};
try {
  cache.fetched = JSON.parse(await readFile(FETCH_CACHE, "utf8"));
} catch {}
const fresh = (e) => e && !args.has("--refresh") && Date.now() - Date.parse(e.at) < CACHE_DAYS * 864e5;

const robots = new Map();
const lastHit = new Map();
async function politeFetch(url, { timeout = 15000, accept = "text/html,application/xhtml+xml" } = {}) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + 1200 - Date.now();
  lastHit.set(host, Date.now() + Math.max(0, wait));
  if (wait > 0) await sleep(wait);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "fr" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  return res;
}
async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    robots.set(
      u.origin,
      (async () => {
        try {
          const r = await politeFetch(u.origin + "/robots.txt", { accept: "text/plain" });
          if (!r.ok) return [];
          return parseRobots(await r.text());
        } catch {
          return [];
        }
      })(),
    );
  }
  const rules = await robots.get(u.origin);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of rules) if (r.re.test(path) && (!best || r.path.length > best.path.length)) best = r;
  return !best || best.allow;
}
/** Rules that apply to us: our own group if present, else "*". */
function parseRobots(txt) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const [k, ...rest] = line.replace(/#.*/, "").split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && cur) {
      lastWasAgent = false;
      // robots.txt patterns: "*" = any characters, trailing "$" = end of URL
      if (val) cur.rules.push({ path: val, re: new RegExp("^" + val.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")), allow: key === "allow" });
    } else lastWasAgent = false;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && UA.toLowerCase().startsWith(a)));
  return (mine ?? groups.find((g) => g.agents.includes("*")))?.rules ?? [];
}
/** GET a page as text, honouring robots.txt; cached for CACHE_DAYS. Returns { status, finalUrl, html } or { error }. */
async function getPage(url) {
  const hit = cache.fetched[url];
  if (fresh(hit)) return hit;
  let out;
  try {
    if (!(await allowedByRobots(url))) out = { error: "robots.txt" };
    else {
      const r = await politeFetch(url);
      const type = r.headers.get("content-type") ?? "";
      out = { status: r.status, finalUrl: r.url, html: r.ok && /html|xml/.test(type) ? (await r.text()).slice(0, 600_000) : "" };
    }
  } catch (e) {
    out = { error: String(e.cause?.code ?? e.name ?? e.message) };
  }
  // keep only the links in the cache, not whole pages
  const links = out.html != null ? extractLinks(out.html, out.finalUrl ?? url) : [];
  // link-in-bio pages keep their links in embedded JSON, not in <a> tags
  if (out.html && HUB.test(new URL(out.finalUrl ?? url).hostname)) for (const href of urlsInText(out.html)) links.push({ href, rel: "", text: "" });
  const slim = { at: new Date().toISOString(), status: out.status, finalUrl: out.finalUrl, error: out.error, links };
  cache.fetched[url] = slim;
  return slim;
}
/** Link-in-bio services: a page the MP made to list their own accounts. */
const HUB = /^(www\.)?(linktr\.ee|lnk\.bio|linkin\.bio|beacons\.ai|bio\.link|campsite\.bio|taplink\.cc|linkbio\.co|solo\.to|carrd\.co)$/i;
/** URLs written as plain text or inside JSON ("https:\/\/…", "/"), with or without a scheme for known hosts. */
function urlsInText(text) {
  const t = text.replaceAll("\\u002F", "/").replaceAll("\\/", "/");
  const out = new Set();
  for (const m of t.matchAll(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:linktr\.ee|lnk\.bio|beacons\.ai|bio\.link|instagram\.com|linkedin\.com\/in|x\.com|twitter\.com|facebook\.com|tiktok\.com|youtube\.com|bsky\.app\/profile)\/[^\s"'<>\\)\]]+/gi)) {
    const u = m[0].replace(/[.,;!?]+$/, "");
    out.add(/^https?:/i.test(u) ? u : "https://" + u);
  }
  return [...out];
}
/** All absolute hrefs in a page, with their rel and visible text. */
function extractLinks(html, base) {
  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const raw = (href[2] ?? href[3] ?? href[4] ?? "").replace(/&amp;/g, "&").trim();
    if (!raw || /^(mailto|tel|javascript):|^#/.test(raw)) continue;
    let abs;
    try {
      abs = new URL(raw, base).href;
    } catch {
      continue;
    }
    const rel = attrs.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    links.push({ href: abs, rel, text });
  }
  // <link rel="me"> in the head (Mastodon verification)
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*\bme\b[^"']*["'][^>]*>/gi)) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) links.push({ href, rel: "me", text: "" });
  }
  return links;
}

/** Runs fn over items with a fixed number of workers. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    }),
  );
}

// ---------- state ----------
const deputes = JSON.parse(await readFile(DEPUTES, "utf8"));
const byId = new Map(deputes.map((d) => [d.id, d]));
/** result[mpId][platform] = { url, handle, source, confidence, confirmedBy?, evidence? } */
const result = Object.fromEntries(deputes.map((d) => [d.id, {}]));
const conflicts = [];
const rejected = [];
const ambiguous = []; // { mpId, platform, source, candidates: [...] } for the AI step
const coverageSteps = [];

/** Proposes an account. Stronger sources win; agreeing weaker sources are recorded as confirmations. */
function propose(mpId, platform, raw, source, confidence, evidence) {
  const n = normalize(platform, raw);
  if (!n.url) {
    rejected.push({ mpId, platform, source, value: String(raw), reason: n.reason });
    return false;
  }
  // a handle carrying another MP's full name is that MP's account (e.g. a colleague's page on a group site)
  if (platform !== "website" && source !== "assemblee" && source !== "override") {
    const h = alnum(decodeURIComponentSafe(n.handle));
    const own = alnum(byId.get(mpId).prenom + byId.get(mpId).nom);
    const other = !h.includes(own) && deputes.find((d) => d.id !== mpId && alnum(d.prenom + d.nom).length >= 8 && h.includes(alnum(d.prenom + d.nom)));
    if (other) {
      rejected.push({ mpId, platform, source, value: n.url, reason: `handle carries another MP's name (${other.prenom} ${other.nom})` });
      return false;
    }
  }
  const slot = result[mpId];
  const cur = slot[platform];
  const same = cur && sameAccount(platform, cur, n);
  if (!cur) {
    slot[platform] = { url: n.url, handle: n.handle, source, confidence, ...(evidence ? { evidence } : {}) };
    return true;
  }
  if (same) {
    if (cur.source !== source && !(cur.confirmedBy ?? []).includes(source)) (cur.confirmedBy ??= []).push(source);
    if (cur.confidence !== "high" && confidence === "high") cur.confidence = "high";
    else if (cur.confidence === "low" && confidence === "medium") cur.confidence = "medium";
    return false;
  }
  if (platform !== "website") conflicts.push({ mpId, platform, kept: { url: cur.url, source: cur.source }, other: { url: n.url, source } });
  return false;
}
function sameAccount(platform, a, b) {
  const k = (x) => (platform === "website" ? x.handle : fold(x.handle).replace(/^@/, "").replace(/\/$/, ""));
  return k(a) === k(b);
}
function coverage() {
  const c = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  let any = 0;
  for (const s of Object.values(result)) {
    for (const p of PLATFORMS) if (s[p]) c[p]++;
    if (PLATFORMS.some((p) => p !== "website" && s[p])) any++;
  }
  return { ...c, anySocial: any };
}
function step(name, extra = {}) {
  const c = coverage();
  coverageSteps.push({ after: name, ...c, ...extra });
  console.log(`✓ ${name.padEnd(12)} X ${c.twitter}  IG ${c.instagram}  LI ${c.linkedin}  FB ${c.facebook}  BS ${c.bluesky}  TT ${c.tiktok}  YT ${c.youtube}  web ${c.website}`);
}

// ---------- 1. Assemblée ----------
for (const d of deputes) for (const [p, v] of Object.entries(d.socials ?? {})) if (PLATFORMS.includes(p)) propose(d.id, p, v, "assemblee", "high");
step("assemblee");

// ---------- 2. Wikidata ----------
{
  const props = { P2002: "twitter", P2003: "instagram", P6634: "linkedin", P2013: "facebook", P12361: "bluesky", P7085: "tiktok", P2397: "youtube", P4033: "mastodon", P856: "website" };
  const values = deputes.map((d) => `"${d.id.replace(/^PA/, "")}"`).join(" ");
  const query = `SELECT ?id ?item ?prop ?val WHERE {
    VALUES ?id { ${values} }
    ?item wdt:P4123 ?id .
    VALUES ?prop { ${Object.keys(props).map((p) => "wdt:" + p).join(" ")} }
    ?item ?prop ?val .
  }`;
  let rows = [];
  for (let attempt = 1; attempt <= 3 && !rows.length; attempt++) {
    try {
      const r = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json", "User-Agent": UA },
        body: "query=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      rows = (await r.json()).results.bindings;
    } catch (e) {
      console.warn(`  wikidata attempt ${attempt} failed: ${e.message}`);
      await sleep(5000 * attempt);
    }
  }
  const qids = new Map();
  for (const b of rows) {
    const mpId = "PA" + b.id.value;
    if (!result[mpId]) continue;
    qids.set(mpId, b.item.value.split("/").pop());
    const p = props[b.prop.value.split("/").pop()];
    propose(mpId, p, b.val.value, "wikidata", "high", { wikidata: qids.get(mpId) });
  }
  step("wikidata", { rows: rows.length, mpsInWikidata: qids.size });
}

// ---------- 3. MPs' own websites ----------
// Accounts linked from several MPs' sites are party / group accounts, not the MP's own.
const SHARED_MIN = 2;
const CONTACT_LINK = /contact|a-propos|apropos|qui-suis|biographie|about|me-contacter|reseaux|suivez|mon-parcours/i;

/** Candidate social links on a page, grouped by platform. Share buttons and post links are dropped. */
function socialLinks(links) {
  const out = {};
  for (const l of links) {
    if (/sharer|share\?|intent\/|\/share\b|shareArticle|\/status\/|\/p\/[A-Za-z0-9_-]+|\/posts?\/|\/watch\?|\/videos?\/|\/reel\//i.test(l.href)) continue;
    const p = platformOf(l.href);
    if (!p) continue;
    const n = normalize(p, l.href);
    if (!n.url || INSTITUTIONAL.test(n.handle)) continue;
    (out[p] ??= new Map()).set(fold(n.handle), { ...n, raw: l.href, rel: l.rel });
  }
  return out;
}

const siteFindings = new Map(); // mpId -> { site, pages, links: {platform: Map} }
const hubs = new Map(); // link-in-bio page URL -> { mpId, url, why }
const safeHost = (href) => {
  try {
    return new URL(href).hostname;
  } catch {
    return "";
  }
};
function addHub(mpId, href, why) {
  const url = href.split(/[?#]/)[0].replace(/\/$/, "");
  if (!/^https?:\/\/[^/]+\/[A-Za-z0-9._-]+$/.test(url) || /\/(s|help|discover|marketplace)$/.test(url)) return; // profile pages only
  const prev = hubs.get(url);
  if (prev && prev.mpId !== mpId) prev.shared = true; // the same page on two MPs = a party page
  else hubs.set(url, { mpId, url, why });
}
// NosDéputés.fr archive of the previous term (2022–2024): a frozen file, so keep the rows we need in the
// cache and fall back to them when the site is slow (it often is).
let nd = [];
for (let attempt = 1; attempt <= 3 && !nd.length; attempt++) {
  try {
    const r = await fetch("https://www.nosdeputes.fr/deputes/json", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90000) });
    nd = (await r.json()).deputes.map((x) => x.depute);
  } catch (e) {
    console.warn(`  nosdeputes attempt ${attempt} failed: ${e.cause?.code ?? e.message}`);
    await sleep(5000 * attempt);
  }
}
if (nd.length) cache.nosdeputes = { at: new Date().toISOString(), rows: nd.filter((x) => result["PA" + x.id_an]).map(({ id_an, sites_web, twitter }) => ({ id_an, sites_web, twitter })) };
else if (cache.nosdeputes) {
  console.warn(`  nosdeputes: using cached copy from ${cache.nosdeputes.at}`);
  nd = cache.nosdeputes.rows;
}
// their websites, so the site step reads them
for (const x of nd) {
  const mpId = "PA" + x.id_an;
  if (result[mpId]) for (const { site } of x.sites_web ?? []) if (!platformOf(site) && /^https?:\/\//.test(site)) propose(mpId, "website", site, "nosdeputes", "medium");
}

// MPs with no known website: try the usual campaign domains and keep one only if its homepage
// carries the MP's full name and the word "député(e)".
const guessMeta = { tried: 0, found: 0 };
if (!args.has("--no-sites") && !args.has("--no-guess")) {
  const G = (cache.guess ??= {});
  const todo = deputes.filter((d) => !result[d.id].website);
  await pool(todo, 8, async (d) => {
    const p = alnum(d.prenom);
    const n = alnum(d.nom);
    const ph = fold(d.prenom).replace(/[^a-z0-9]+/g, "-");
    const nh = fold(d.nom).replace(/[^a-z0-9]+/g, "-");
    const domains = [...new Set([`${p}${n}.fr`, `${ph}-${nh}.fr`, `${p}${n}.com`, `${ph}-${nh}.com`])];
    for (const dom of domains) {
      const key = d.id + ":" + dom;
      let v = G[key] && Date.now() - Date.parse(G[key].at) < 30 * 864e5 && !args.has("--refresh") ? G[key] : null;
      if (!v) {
        guessMeta.tried++;
        v = { at: new Date().toISOString(), ok: false };
        try {
          const url = `https://${dom}/`;
          if (await allowedByRobots(url)) {
            const r = await politeFetch(url, { timeout: 8000 });
            const html = r.ok ? fold((await r.text()).slice(0, 400_000)) : "";
            const text = html.replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ");
            const full = fold(`${d.prenom} ${d.nom}`).replace(/[^a-z0-9]+/g, " ").trim();
            if (text.includes(full) && /\bdepute(e)?s?\b/.test(text) && !/domaine? (a vendre|est a vendre)|domain (is )?for sale|parked/.test(text)) v = { ...v, ok: true, url: new URL(r.url).origin + "/" };
          }
        } catch {}
        G[key] = v;
      }
      if (v.ok) {
        guessMeta.found++;
        propose(d.id, "website", v.url, "site", "medium", { why: "domain guessed from the MP's name; homepage names the MP as député(e)" });
        break;
      }
    }
  });
  console.log(`  guessed websites: ${guessMeta.found} found (${guessMeta.tried} domains tried)`);
}

// A "website" shared by several MPs is a party, government or link-service page, not the MP's own site.
{
  const byHandle = new Map();
  for (const [mpId, s] of Object.entries(result)) if (s.website) byHandle.set(s.website.handle, [...(byHandle.get(s.website.handle) ?? []), mpId]);
  for (const [h, ids] of byHandle)
    if (ids.length > 1)
      for (const mpId of ids) {
        rejected.push({ mpId, platform: "website", source: result[mpId].website.source, value: result[mpId].website.url, reason: `shared by ${ids.length} MPs (${h}): not the MP's own site` });
        delete result[mpId].website;
      }
}

if (!args.has("--no-sites")) {
  const jobs = [];
  for (const d of deputes) {
    const site = result[d.id].website;
    // a few "websites" are just the MP's Assemblée page: not the MP's own site
    if (site && !/assemblee-nationale\.fr$/i.test(site.handle)) jobs.push({ mpId: d.id, url: site.url, siteSource: site.source });
  }
  console.log(`  fetching ${jobs.length} MP websites…`);
  let done = 0;
  await pool(jobs, 10, async ({ mpId, url, siteSource }) => {
    const home = await getPage(url);
    const pages = [{ url, ...home }];
    // follow up to 2 same-site contact/about pages
    if (home.links?.length) {
      const origin = new URL(home.finalUrl ?? url).hostname.replace(/^www\./, "");
      const extra = [...new Set(home.links.filter((l) => CONTACT_LINK.test(new URL(l.href).pathname) && new URL(l.href).hostname.replace(/^www\./, "") === origin).map((l) => l.href.split("#")[0]))].slice(0, 2);
      for (const e of extra) pages.push({ url: e, ...(await getPage(e)) });
    }
    const found = {};
    for (const pg of pages) for (const [p, m] of Object.entries(socialLinks(pg.links ?? []))) for (const [k, v] of m) (found[p] ??= new Map()).set(k, { ...v, page: pg.url });
    for (const pg of pages) for (const l of pg.links ?? []) if (HUB.test(safeHost(l.href))) addHub(mpId, l.href, `linked from the MP's website ${pg.url}`);
    siteFindings.set(mpId, { site: url, siteSource, status: home.error ?? home.status, finalUrl: home.finalUrl, found });
    if (++done % 50 === 0) console.log(`  …${done}/${jobs.length}`);
  });

  // handles that appear on several MPs' sites = party / group accounts
  const seen = new Map();
  for (const [mpId, f] of siteFindings) for (const [p, m] of Object.entries(f.found)) for (const k of m.keys()) seen.set(p + ":" + k, (seen.get(p + ":" + k) ?? new Set()).add(mpId));
  const shared = new Set([...seen].filter(([, s]) => s.size >= SHARED_MIN).map(([k]) => k));

  for (const [mpId, f] of siteFindings) {
    const mp = byId.get(mpId);
    for (const [p, m] of Object.entries(f.found)) {
      let cands = [...m.entries()].filter(([k]) => !shared.has(p + ":" + k)).map(([, v]) => v);
      for (const [k, v] of m) if (shared.has(p + ":" + k)) rejected.push({ mpId, platform: p, source: "site", value: v.url, reason: `shared account (linked from ${seen.get(p + ":" + k).size} MPs' sites)` });
      if (!cands.length) continue;
      const named = cands.filter((c) => handleMatchesName(c.handle, mp));
      // one candidate, or one name-matching candidate among several: accept
      const pick = cands.length === 1 ? cands[0] : named.length === 1 ? named[0] : null;
      const evidence = { page: (pick ?? cands[0]).page };
      const named1 = pick && handleMatchesName(pick.handle, mp);
      const trustedSite = ["assemblee", "wikidata", "override"].includes(f.siteSource);
      if (pick && !named1 && !trustedSite) {
        // guessed or 2022-era site (could have changed hands): only accounts carrying the MP's name
        ambiguous.push({ mpId, platform: p, source: "site", context: `linked from ${f.site}, a website found by guessing the domain or from the previous term; the handle does not contain the MP's name`, candidates: [{ url: pick.url, handle: pick.handle, page: pick.page }] });
      } else if (pick && p === "linkedin" && !named1) {
        // LinkedIn links on MPs' sites that don't carry the MP's name are usually the web designer's or a staffer's
        rejected.push({ mpId, platform: p, source: "site", value: pick.url, reason: "LinkedIn profile on the MP's site without the MP's name (credit or staff link)" });
        ambiguous.push({ mpId, platform: p, source: "site", context: `the only LinkedIn profile linked from the MP's website ${f.site}; its slug does not contain the MP's name`, candidates: [{ url: pick.url, handle: pick.handle, page: pick.page }] });
      } else if (pick) {
        // The site is the evidence; a handle without the MP's name is kept at medium confidence.
        // high only if the site itself comes from the MP's declaration or Wikidata (not guessed or from the old term)
        const conf = named1 && ["assemblee", "wikidata", "override"].includes(f.siteSource) ? "high" : "medium";
        propose(mpId, p, pick.url, "site", conf, evidence);
      } else if (!result[mpId][p]) {
        ambiguous.push({ mpId, platform: p, source: "site", context: `links found on the MP's website ${f.site}`, candidates: cands.map((c) => ({ url: c.url, handle: c.handle, page: c.page })) });
      }
    }
  }
  step("site", { sitesFetched: jobs.length, sitesReached: [...siteFindings.values()].filter((f) => f.status === 200).length, sharedAccountsExcluded: shared.size });
} else step("site", { skipped: true });

// ---------- 4. parliamentary group pages ----------
// Groups whose "our MPs" pages link each MP's accounts in plain HTML (checked 2026-11-07; see docs/data-socials.md).
// Each source yields, in document order, MP markers and links; a link belongs to the latest marker before it.
// EPR, DR, DEM have no group site; SOC, ECOS, LFI and UDR list MPs without their accounts.
async function getHtml(url) {
  if (!(await allowedByRobots(url))) throw new Error("robots.txt");
  const r = await politeFetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return { html: await r.text(), finalUrl: r.url };
}
/** Walks html in order; marker(m) returns an mpId (or undefined) for each tag/heading match. */
function walk(html, base, markerRe, toMp) {
  const out = [];
  let cur = null;
  const re = new RegExp(markerRe.source + String.raw`|<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']`, "gi");
  for (const m of html.matchAll(re)) {
    const href = m[m.length - 1];
    const mm = m[0].match(markerRe); // a marker can itself be a link (an <a> to the MP's page)
    if (mm) cur = toMp(mm) ?? null;
    else if (href && cur) {
      try {
        out.push({ mpId: cur, href: new URL(href.replace(/&amp;/g, "&"), base).href });
      } catch {}
    }
  }
  return out;
}
const nameToId = new Map(deputes.map((d) => [alnum(d.prenom + d.nom), d.id]));
/** Exact full-name match, else the one MP of that group whose surname is in the name and whose first name starts the same ("thieery-perez", "emmanuel-tache-de-la-pagerie"). */
function findMp(name, groupe) {
  const k = alnum(name);
  if (nameToId.has(k)) return nameToId.get(k);
  const hits = deputes.filter((d) => d.groupe?.abrev === groupe && k.includes(alnum(d.nom)) && k.startsWith(alnum(d.prenom).slice(0, 2)));
  return hits.length === 1 ? hits[0].id : undefined;
}
const GROUP_SOURCES = [
  {
    name: "LIOT (groupeliot.fr)",
    groupe: "LIOT",
    exclude: /^@?groupeliot/i,
    async links() {
      const { html, finalUrl } = await getHtml("https://www.groupeliot.fr/");
      return walk(html, finalUrl, /href\s*=\s*["'][^"']*assemblee-nationale\.fr\/dyn\/deputes\/(PA\d+)[^"']*["']/i, (m) => (result[m[1]] ? m[1] : undefined)).map((l) => ({ ...l, page: finalUrl }));
    },
  },
  {
    name: "RN (deputes-rn.fr)",
    groupe: "RN",
    exclude: /^@?(groupern(_off)?|deputesrn|rnational_off|rassemblementnational(officiel)?|fnofficiel)$/i,
    async links() {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const url = `https://deputes-rn.fr/deputes?page=${page}`;
        const { html } = await getHtml(url);
        const found = walk(html, url, /href\s*=\s*["'][^"']*\/depute\/([a-z0-9-]+)["']/i, (m) => findMp(m[1], "RN") ?? (unmatched.add("rn:" + m[1]), undefined));
        if (!/\/depute\/[a-z0-9-]+/i.test(html)) break;
        all.push(...found.map((l) => ({ ...l, page: url })));
      }
      return all;
    },
  },
  {
    name: "Horizons (horizonsleparti.fr)",
    groupe: "HOR",
    exclude: /^@?(deputeshorizons|horizonsleparti|horizons_)$/i,
    async links() {
      const url = "https://horizonsleparti.fr/nos-parlementaires/";
      const { html } = await getHtml(url);
      const section = html.split(/Les d[ée]put[ée]s<\/h/i)[1]?.split(/Les s[ée]nateurs<\/h/i)[0] ?? "";
      return walk(section, url, /<h3\b[^>]*>([^<]+)<\/h3>/i, (m) => findMp(m[1].replace(/&#0?39;|&rsquo;/g, "'"), "HOR") ?? (unmatched.add("hor:" + m[1].trim()), undefined)).map((l) => ({ ...l, page: url }));
    },
  },
  {
    name: "GDR (groupe-communiste.assemblee-nationale.fr)",
    groupe: "GDR",
    exclude: /^@?(deputespcf|lesdeputescommunistes|UCe27I-_81PEpsG_GlYPEBog)$/i,
    async links() {
      const base = "https://groupe-communiste.assemblee-nationale.fr/";
      const { html } = await getHtml(base + "spip.php?page=auteurs");
      const slugs = [...new Set([...html.matchAll(/href=["'](?:\.\/|\/)?auteur\/([a-z0-9-]+)["']/gi)].map((m) => m[1]))];
      const out = [];
      for (const slug of slugs) {
        const mpId = findMp(slug, "GDR");
        if (!mpId) {
          unmatched.add("gdr:" + slug);
          continue;
        }
        const url = base + "auteur/" + slug;
        try {
          const pg = await getHtml(url);
          // only the MP's own links: the class='fb' button and the JSON-LD sameAs, not the footer
          for (const m of pg.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\b(fb|tw|twitter|insta|instagram|linkedin)\b/gi)) out.push({ mpId, href: m[1], page: url });
          for (const m of pg.html.matchAll(/"sameAs"\s*:\s*\[([^\]]*)\]/g)) for (const h of m[1].matchAll(/"([^"]+)"/g)) out.push({ mpId, href: h[1].replaceAll("\\/", "/"), page: url });
        } catch (e) {
          console.warn(`  gdr ${slug}: ${e.message}`);
        }
      }
      return out;
    },
  },
];
const unmatched = new Set();
const groupMeta = {};
if (!args.has("--no-groups")) {
  for (const g of GROUP_SOURCES) {
    let links = [];
    try {
      links = await g.links();
    } catch (e) {
      console.warn(`  ${g.name}: ${e.message}`);
      groupMeta[g.name] = { error: e.message };
      continue;
    }
    // per MP: candidate accounts by platform
    const per = new Map();
    for (const { mpId, href, page } of links) {
      if (/sharer|intent\/|share\?|\/status\//i.test(href)) continue;
      const p = platformOf(href);
      if (!p) continue;
      const n = normalize(p, href);
      if (!n.url || INSTITUTIONAL.test(n.handle) || g.exclude.test(n.handle)) continue;
      const slot = per.get(mpId) ?? per.set(mpId, {}).get(mpId);
      (slot[p] ??= new Map()).set(fold(n.handle), { ...n, page });
    }
    // an account repeated under several MPs is the group's own
    const count = new Map();
    for (const s of per.values()) for (const [p, m] of Object.entries(s)) for (const k of m.keys()) count.set(p + k, (count.get(p + k) ?? 0) + 1);
    let accepted = 0;
    for (const [mpId, s] of per) {
      const mp = byId.get(mpId);
      if (mp.groupe?.abrev !== g.groupe) continue; // the page may list former members
      for (const [p, m] of Object.entries(s)) {
        const cands = [...m.entries()].filter(([k]) => count.get(p + k) < 2).map(([, v]) => v);
        const named = cands.filter((c) => handleMatchesName(c.handle, mp));
        const pick = cands.length === 1 ? cands[0] : named.length === 1 ? named[0] : null;
        if (!pick) continue;
        if (p === "linkedin" && !handleMatchesName(pick.handle, mp)) continue;
        if (propose(mpId, p, pick.url, "group", handleMatchesName(pick.handle, mp) ? "high" : "medium", { page: pick.page })) accepted++;
      }
    }
    groupMeta[g.name] = { mps: per.size, newAccounts: accepted };
    console.log(`  ${g.name}: ${per.size} MPs with links, ${accepted} new accounts`);
  }
  step("group", { ...groupMeta, unmatchedNames: [...unmatched] });
} else step("group", { skipped: true });

// ---------- 5. NosDéputés (previous term) ----------
// (fetched before the website step so its website URLs get crawled; its accounts are proposed only here,
// after the current sources, because they may have been abandoned since 2024)
{
  let n = 0;
  for (const x of nd) {
    const mpId = "PA" + x.id_an;
    if (!result[mpId]) continue;
    n++;
    for (const { site } of x.sites_web ?? []) {
      const p = platformOf(site);
      if (!p) continue;
      // declared by the MP in 2022–2024: the MP's own account, but it may have been abandoned since
      propose(mpId, p, site, "nosdeputes", handleMatchesName(normalize(p, site).handle, byId.get(mpId)) ? "medium" : "low");
    }
    if (x.twitter) propose(mpId, "twitter", x.twitter, "nosdeputes", "medium");
  }
  step("nosdeputes", { returningMps: n });
}

// ---------- 6. Bluesky search ----------
const ROLE = /d[ée]put[ée]e?s?\b|assembl[ée]e nationale|circonscription|\b(RN|LFI|NFP|EPR|PS|LR|MoDem|Horizons|LIOT|GDR|PCF|UDR|[ée]cologistes?)\b/i;
const FOREIGN = /qu[ée]bec|canada|ottawa|montr[ée]al|belgi|wallon|bruxelles|f[ée]d[ée]ration wallonie|suisse|gen[eè]ve|vaud|luxembourg|s[ée]nat(eur|rice)|eurod[ée]put|d[ée]put[ée]e? europ[ée]en|parlement europ[ée]en|\bMEP\b|\bMNA\b|\bMP for\b|conseil national/i;
const FAN = /compte fan|fan account|fan ?club|\bfans? de\b|parodi|parody|non[- ]officiel|unofficial|\bfake\b|toute l.actualit[ée]|actu(alit[ée]s?)? (de|sur)\b|soutiens? (de|à)\b|comit[ée] de soutien/i;
const blueskyMeta = { searched: 0, accepted: 0, rejected: 0 };
if (!args.has("--no-bluesky")) {
  const todo = deputes.filter((d) => !result[d.id].bluesky);
  await pool(todo, 3, async (d) => {
    const q = `${d.prenom} ${d.nom}`;
    const key = "bsky:" + q;
    let actors = fresh(cache.fetched[key]) ? cache.fetched[key].actors : null;
    if (!actors) {
      try {
        await sleep(350);
        const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(q)}&limit=10`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        actors = ((await r.json()).actors ?? []).map((a) => ({ handle: a.handle, did: a.did, displayName: a.displayName ?? "", description: a.description ?? "", verified: a.verification?.verifiedStatus === "valid" }));
        cache.fetched[key] = { at: new Date().toISOString(), actors };
      } catch (e) {
        console.warn(`  bluesky ${q}: ${e.message}`);
        return;
      }
    }
    blueskyMeta.searched++;
    const full = alnum(d.prenom + d.nom);
    const nameMatch = actors.filter((a) => {
      const dn = alnum(a.displayName.replace(/\b(d[ée]put[ée]e?|officiel|official)\b/gi, ""));
      return dn.includes(full) || alnum(a.handle.split(".")[0]) === full;
    });
    const dept = d.departement ? fold(d.departement) : null;
    const strong = [];
    const weak = [];
    for (const a of nameMatch) {
      const bio = a.description;
      if (FAN.test(bio) || FAN.test(a.displayName)) {
        rejected.push({ mpId: d.id, platform: "bluesky", source: "bluesky", value: a.handle, reason: `fan / unofficial account: "${bio.slice(0, 80)}"` });
        blueskyMeta.rejected++;
        continue;
      }
      if (FOREIGN.test(bio) && !(dept && fold(bio).includes(dept))) {
        rejected.push({ mpId: d.id, platform: "bluesky", source: "bluesky", value: a.handle, reason: `foreign or other office in bio: "${bio.slice(0, 80)}"` });
        blueskyMeta.rejected++;
        continue;
      }
      const role = ROLE.test(bio) || ROLE.test(a.displayName);
      const local = dept && (fold(bio).includes(dept) || fold(a.displayName).includes(dept) || new RegExp(`\\b${d.numDepartement}\\b`).test(bio));
      // custom-domain handle on the MP's own website domain
      const ownDomain = result[d.id].website && a.handle.endsWith(result[d.id].website.handle);
      if (ownDomain || (role && local)) strong.push({ a, conf: "high", why: ownDomain ? "handle on the MP's own domain" : "full name + role + department in bio" });
      else if (role) strong.push({ a, conf: "medium", why: "full name + MP role in bio" });
      else weak.push(a);
    }
    if (strong.length === 1) {
      propose(d.id, "bluesky", strong[0].a.handle, "bluesky", strong[0].conf, { why: strong[0].why, bio: strong[0].a.description.slice(0, 140) });
      blueskyMeta.accepted++;
    } else if (strong.length > 1 || weak.length) {
      ambiguous.push({ mpId: d.id, platform: "bluesky", source: "bluesky", context: "Bluesky accounts whose display name matches the MP's full name", candidates: [...strong.map((s) => s.a), ...weak].map((a) => ({ url: `https://bsky.app/profile/${a.handle}`, handle: a.handle, displayName: a.displayName, bio: a.description.slice(0, 300) })) });
      for (const a of weak) rejected.push({ mpId: d.id, platform: "bluesky", source: "bluesky", value: a.handle, reason: `name match only, no MP role in bio: "${a.description.slice(0, 80)}"` });
    }
  });
  step("bluesky", blueskyMeta);
} else step("bluesky", { skipped: true });

// ---------- 6b. Bluesky bios and link-in-bio pages ----------
// The bio of an MP's Bluesky account (and any Linktree-style page the MP links from their bio or website)
// lists their other accounts in their own words.
const hubMeta = { bios: 0, fromBios: 0, hubs: 0, fromHubs: 0 };
if (!args.has("--no-bluesky")) {
  const withBs = deputes.filter((d) => result[d.id].bluesky);
  for (let i = 0; i < withBs.length; i += 25) {
    const batch = withBs.slice(i, i + 25);
    const actors = batch.map((d) => result[d.id].bluesky.handle.replace(/^@/, ""));
    const key = "bsky-profiles:" + actors.join(",");
    let profiles = fresh(cache.fetched[key]) ? cache.fetched[key].profiles : null;
    if (!profiles) {
      try {
        const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${actors.map((a) => "actors=" + encodeURIComponent(a)).join("&")}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        profiles = (await r.json()).profiles.map((p) => ({ handle: p.handle, did: p.did, description: p.description ?? "" }));
        cache.fetched[key] = { at: new Date().toISOString(), profiles };
      } catch (e) {
        console.warn(`  bluesky profiles: ${e.message}`);
        continue;
      }
    }
    for (const d of batch) {
      const h = result[d.id].bluesky.handle.replace(/^@/, "");
      const p = profiles.find((x) => x.handle === h || x.did === h);
      if (!p?.description) continue;
      hubMeta.bios++;
      for (const href of urlsInText(p.description)) {
        if (HUB.test(safeHost(href))) addHub(d.id, href, `linked from the MP's Bluesky bio @${p.handle}`);
        const plat = platformOf(href);
        if (!plat || plat === "bluesky") continue;
        const n = normalize(plat, href);
        if (!n.url || INSTITUTIONAL.test(n.handle)) continue;
        // a bio names many accounts (the party's too): only take ones carrying the MP's name
        if (handleMatchesName(n.handle, d) && propose(d.id, plat, n.url, "bluesky", "high", { bio: `@${p.handle}` })) hubMeta.fromBios++;
      }
    }
  }
}
if (hubs.size) {
  await pool([...hubs.values()].filter((h) => !h.shared), 4, async ({ mpId, url, why }) => {
    const pg = await getPage(url);
    hubMeta.hubs++;
    if (pg.error === "robots.txt") hubMeta.blockedByRobots = (hubMeta.blockedByRobots ?? 0) + 1;
    const mp = byId.get(mpId);
    for (const [p, m] of Object.entries(socialLinks(pg.links ?? []))) {
      const cands = [...m.values()];
      const named = cands.filter((c) => handleMatchesName(c.handle, mp));
      const pick = cands.length === 1 ? cands[0] : named.length === 1 ? named[0] : null;
      if (!pick || (p === "linkedin" && !handleMatchesName(pick.handle, mp))) continue;
      if (propose(mpId, p, pick.url, "site", handleMatchesName(pick.handle, mp) ? "high" : "medium", { page: url, via: why })) hubMeta.fromHubs++;
    }
  });
}
step("linkpages", hubMeta);

// ---------- 7. AI adjudication (optional) ----------
const aiMeta = { candidates: ambiguous.length, asked: 0, accepted: 0, cached: 0, skipped: null, spentUsd: 0 };
{
  const AI_CACHE = (cache.ai ??= {});
  const open = ambiguous.filter((a) => !result[a.mpId][a.platform]);
  // cached verdicts are free and apply even without a key
  const toAsk = [];
  for (const a of open) {
    const key = `${a.mpId}:${a.platform}:${a.candidates.map((c) => c.handle).sort().join(",")}`;
    a.key = key;
    if (AI_CACHE[key]) {
      aiMeta.cached++;
      const v = AI_CACHE[key];
      if (v.url) propose(a.mpId, a.platform, v.url, "ai", v.confidence ?? "medium", { why: v.why, from: a.source });
    } else toAsk.push(a);
  }
  if (args.has("--no-ai")) aiMeta.skipped = "--no-ai";
  else if (!process.env.ANTHROPIC_API_KEY) aiMeta.skipped = "ANTHROPIC_API_KEY not set";
  else if (toAsk.length) {
    const { ask, remainingBudget, BudgetExceededError } = await import("./lib/claude.mjs");
    const JOB_CAP_USD = 0.5; // at most this much per run, and never the last $2 of the shared monthly cap
    const before = await remainingBudget();
    if (before < 2) aiMeta.skipped = `only $${before.toFixed(2)} left this month`;
    else {
      const system =
        "You check whether a social media account belongs to a specific sitting member of the French Assemblée nationale. " +
        "You get the MP's identity and candidate accounts with the evidence the pipeline collected. " +
        "Pick a candidate only when the evidence clearly shows it is this MP's own personal account (not a namesake, not a party, group, staff or fan account, not a member of another country's parliament). " +
        "If the evidence is not clear, answer null. Never guess.";
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["choice", "confidence", "why"],
        properties: { choice: { type: ["integer", "null"], description: "index of the chosen candidate, or null" }, confidence: { type: "string", enum: ["high", "medium"] }, why: { type: "string" } },
      };
      for (const a of toAsk) {
        const spent = before - (await remainingBudget());
        if (spent >= JOB_CAP_USD) {
          aiMeta.skipped = `per-run cap $${JOB_CAP_USD} reached`;
          break;
        }
        const mp = byId.get(a.mpId);
        const user = JSON.stringify({
          mp: { name: `${mp.prenom} ${mp.nom}`, group: mp.groupe?.libelle, department: mp.departement, district: mp.numCirco, profession: mp.profession, born: mp.naissance, website: result[a.mpId].website?.url },
          platform: a.platform,
          context: a.context,
          candidates: a.candidates.map((c, i) => ({ index: i, ...c })),
        });
        try {
          const res = await ask({ system, messages: [{ role: "user", content: user }], max_tokens: 400, output_config: { effort: "low", format: { type: "json_schema", schema } } }, "socials");
          const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
          const v = JSON.parse(text);
          aiMeta.asked++;
          const c = Number.isInteger(v.choice) ? a.candidates[v.choice] : null;
          AI_CACHE[a.key] = { at: new Date().toISOString(), url: c?.url ?? null, confidence: v.confidence === "high" ? "high" : "medium", why: v.why };
          if (c) {
            aiMeta.accepted++;
            propose(a.mpId, a.platform, c.url, "ai", AI_CACHE[a.key].confidence, { why: v.why, from: a.source });
          }
        } catch (e) {
          if (e instanceof BudgetExceededError) {
            aiMeta.skipped = e.message;
            break;
          }
          console.warn(`  ai ${a.mpId} ${a.platform}: ${e.message}`);
        }
      }
      aiMeta.spentUsd = Math.round((before - (await remainingBudget())) * 1e4) / 1e4;
    }
  }
  if (aiMeta.skipped) console.log(`  ai: ${aiMeta.skipped} (${toAsk.length} ambiguous cases left undecided)`);
  step("ai", aiMeta);
}

// ---------- 8. manual overrides (always win) ----------
{
  let n = 0;
  let csv = "";
  try {
    csv = await readFile(OVERRIDES, "utf8");
  } catch {}
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  for (const line of lines.slice(1)) {
    const [mpId, platform, url = "", ...note] = parseCsvLine(line);
    if (!result[mpId] || !PLATFORMS.includes(platform)) {
      console.warn(`  override ignored (unknown MP or platform): ${line}`);
      continue;
    }
    n++;
    if (!url.trim()) {
      delete result[mpId][platform]; // empty url = known false positive, remove
      continue;
    }
    const nn = normalize(platform, url);
    if (!nn.url) {
      console.warn(`  override ignored (${nn.reason}): ${line}`);
      continue;
    }
    const prev = result[mpId][platform];
    const confirmedBy = prev && sameAccount(platform, prev, nn) ? [prev.source, ...(prev.confirmedBy ?? [])] : undefined;
    result[mpId][platform] = { url: nn.url, handle: nn.handle, source: "override", confidence: "high", ...(confirmedBy ? { confirmedBy } : {}), ...(note.join(",").trim() ? { note: note.join(",").trim() } : {}) };
  }
  step("override", { rows: n });
}
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// ---------- write ----------
const ordered = {};
for (const d of deputes) {
  const s = result[d.id];
  const o = {};
  for (const p of PLATFORMS) if (s[p]) o[p] = s[p];
  ordered[d.id] = o;
}
const bySource = {};
for (const s of Object.values(ordered)) for (const [p, v] of Object.entries(s)) ((bySource[p] ??= {})[v.source] = (bySource[p][v.source] ?? 0) + 1);
const byConfidence = {};
for (const s of Object.values(ordered)) for (const [p, v] of Object.entries(s)) ((byConfidence[p] ??= {})[v.confidence] = (byConfidence[p][v.confidence] ?? 0) + 1);

await mkdir(new URL("public/data/an/", ROOT), { recursive: true });
await writeFile(OUT, JSON.stringify(ordered) + "\n");
await writeFile(
  OUT_META,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mps: deputes.length,
      coverage: coverage(),
      steps: coverageSteps,
      bySource,
      byConfidence,
      conflicts,
      rejected: rejected.filter((r) => r.reason !== "empty"),
      undecided: ambiguous.filter((a) => !ordered[a.mpId][a.platform]).map(({ key, ...a }) => a),
    },
    null,
    1,
  ) + "\n",
);
// drop stale cache entries so the file doesn't grow forever
for (const [k, v] of Object.entries(cache.fetched)) if (Date.now() - Date.parse(v.at) > 30 * 864e5) delete cache.fetched[k];
await mkdir(new URL("data/", ROOT), { recursive: true });
await mkdir(new URL(".cache/", ROOT), { recursive: true });
const { fetched, ...kept } = cache;
await writeFile(FETCH_CACHE, JSON.stringify(fetched) + "\n");
await writeFile(CACHE, JSON.stringify(kept, null, 1) + "\n");

const c = coverage();
console.log(`✓ wrote socials.json: ${c.anySocial}/${deputes.length} MPs with at least one account; ${conflicts.length} conflicts, ${rejected.length} rejected candidates`);
