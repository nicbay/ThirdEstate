// Presidential opinion polls, parsed from Wikipedia's poll tables (via the MediaWiki API).
// Wikipedia content is CC BY-SA 4.0 — the site credits and links the source pages.
//
//   npm run sync:polls
//
// Output (public/data/polls/<year>.json):
//   { source, fetchedAt, firstRound: Poll[], secondRound: Duel[] }
//   Poll  = { pollster, start, end, sample, url?, urlKind?, hyps: { [candidate]: pct }[] }   // one hyp per tested line-up
//           url = the poll's publication; urlKind = "pollster" (the firm's own release) | "commission"
//           (its notice at the Commission des sondages) | "press" (an article: nothing better was found)
//   Duel  = { pollster, start, end, sample, a, b, pa, pb }
// Also public/data/polls/notices-cache.json: the Commission notices already read (see "Commission des sondages lookup").

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateSync, constants as zc } from "node:zlib";
import { parse } from "node-html-parser";

const PAGES = {
  2027: "Opinion_polling_for_the_2027_French_presidential_election",
  2022: "Opinion_polling_for_the_2022_French_presidential_election",
  "legislatives-2024": "Opinion_polling_for_the_2024_French_legislative_election",
};
const UA = { "User-Agent": "ThirdEstate/0.1 (open-data French election site; github.com/nicbay/ThirdEstate)" };
const OUT = new URL("../public/data/polls/", import.meta.url);

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "21–22 Oct 2026", "28 Oct–3 Nov 2026", "30 Dec 2025–2 Jan 2026", "8 Apr 2022" → [start, end] ISO dates */
function parseDates(s) {
  const parts = s.replace(/\[.*?\]/g, "").split(/\s*[–—-]\s*/).map((p) => p.trim()).filter(Boolean);
  const read = (p) => {
    const m = p.match(/^(\d{1,2})?\s*([A-Za-z]{3,})?\.?\s*(\d{4})?$/);
    return m ? { d: m[1] ? Number(m[1]) : null, m: m[2] ? MONTHS[m[2].slice(0, 3).toLowerCase()] : null, y: m[3] ? Number(m[3]) : null } : null;
  };
  const end = read(parts.at(-1));
  if (!end || end.y == null || end.m == null) return null;
  const st = read(parts[0]) ?? end;
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d ?? 1)).toISOString().slice(0, 10);
  const sm = st.m ?? end.m;
  const sy = st.y ?? (sm > end.m ? end.y - 1 : end.y);
  return [iso(sy, sm, st.d ?? end.d), iso(end.y, end.m, end.d)];
}

const num = (s) => {
  const m = s.replace(",", ".").match(/^<?\s*(\d+(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
};
const clean = (c) => {
  c.querySelectorAll("style, sup.reference").forEach((x) => x.remove());
  return c.text.replace(/\s+/g, " ").trim();
};

/** Expand rowspan/colspan into a rectangular grid of cells. */
let tableSeq = 0;
function grid(table) {
  const t = tableSeq++; // cell origins must be unique across tables, not just within one
  const out = [];
  table.querySelectorAll("tr").forEach((tr, r) => {
    out[r] ??= [];
    let c = 0;
    for (const cell of tr.querySelectorAll("th, td")) {
      while (out[r][c]) c++;
      const rs = Number(cell.getAttribute("rowspan") ?? 1);
      const cs = Number(cell.getAttribute("colspan") ?? 1);
      // the poll's sources: every direct external link in the cell and every footnote mark (read before clean() drops them)
      const ext = cell.querySelectorAll("a.external").map((a) => a.getAttribute("href")).filter(Boolean);
      const notes = cell.querySelectorAll("sup.reference a").map((a) => a.getAttribute("href")).filter(Boolean);
      const v = { el: cell, th: cell.tagName === "TH", text: clean(cell), origin: `${t}:${r}:${c}`, ext, notes };
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) ((out[r + i] ??= [])[c + j] = v);
      c += cs;
    }
  });
  return out;
}

function parseTable(table, { blocs = false, resolve = () => [] } = {}) {
  const g = grid(table);
  const firstData = g.findIndex((row) => row.some((c) => c && !c.th));
  if (firstData < 0) return null;
  const header = g.slice(0, firstData);
  const width = Math.max(...g.map((r) => r.length));
  const col = (name) => header[0]?.findIndex((c) => c?.text.toLowerCase().startsWith(name));
  const iFirm = col("polling firm"), iDate = col("fieldwork"), iSample = col("sample");
  if (iFirm < 0 || iDate < 0) return null;
  // candidate name per column: linked article title in any header row, else header text
  const names = [];
  for (let c = 0; c < width; c++) {
    if ([iFirm, iDate, iSample].includes(c)) continue;
    let name = null;
    // legislative tables: bloc abbreviation from the top header row ("NFP", "ENS", "RN and allies")
    if (blocs) name = header[0]?.[c]?.text.replace(/\[.*?\]/g, "").replace(/\s*\(.*\)$/, "").trim() || null;
    if (!blocs) for (const row of header) {
      const a = row[c]?.el.querySelector("a[title]");
      if (a) name = a.getAttribute("title").replace(/\s*\(.*\)$/, "");
    }
    name ??= header.map((row) => row[c]?.text).filter(Boolean).at(-1)?.replace(/\s*\(.*\)$/, "") ?? null;
    if (name && !/^(abstention|lead|others?|undecided|turnout)$/i.test(name)) names[c] = name;
  }
  const rows = [];
  for (const row of g.slice(firstData)) {
    const firm = row[iFirm]?.text ?? "";
    if (!firm || /election|result|ministry|interior/i.test(firm)) continue; // skip actual-result rows
    const dates = parseDates(row[iDate]?.text ?? "");
    if (!dates) continue;
    // A cell spanning several columns is one figure for the combined blocs ("ENS + DVC").
    const values = {};
    const seen = new Set();
    for (let c = 0; c < width; c++) {
      const cell = row[c];
      if (!cell || cell.th || seen.has(cell.origin)) continue;
      seen.add(cell.origin);
      const spanned = [...new Set(names.filter((n, i) => n && row[i] === cell))];
      const v = num(cell.text);
      if (spanned.length && v != null) values[spanned.join(" + ")] = v;
    }
    if (Object.keys(values).length < 2) continue;
    // Every citation of the row, firm and date cells first: direct links, then the footnotes' external links.
    const cites = [];
    const cells = [row[iFirm], row[iDate], row[iSample], ...row].filter((c, i, a) => c && a.indexOf(c) === i);
    for (const c of cells) for (const u of [...c.ext, ...c.notes.flatMap(resolve)]) if (!cites.includes(u)) cites.push(u);
    const pollster = firm.replace(/\[.*?\]/g, "").replace(/\s*Archived .*$/i, "").trim();
    rows.push({ key: `${row[iFirm].origin}|${row[iDate].origin}`, cites, pollster, start: dates[0], end: dates[1], sample: num((row[iSample]?.text ?? "").replace(/[,.\s](?=\d{3}\b)/g, "")) ?? null, values });
  }
  return rows;
}

// ── Poll sources ───────────────────────────────────────────────────────────────────────────────
// A poll dot links to the poll's own publication. Rank: (a) the pollster's own site or file host,
// (b) the notice filed with the Commission des sondages, (c) anything else (press, social posts).

/** Polling firms: how Wikipedia names them, the hosts they publish on, how the Commission titles their notices. */
const FIRMS = [
  { key: "ifop", name: /ifop/i, hosts: ["ifop.com", "ifop.fr"], files: [/^client-data-serenytics-com\.s3[\w.-]*\.amazonaws\.com\/IFOP\//i], search: ["ifop"] },
  { key: "elabe", name: /elabe/i, hosts: ["elabe.fr"], search: ["elabe"] },
  { key: "harris", name: /harris|toluna/i, hosts: ["harris-interactive.fr", "harris-interactive.com", "tolunacorporate.com", "toluna-group.com"], search: ["harris", "toluna"], title: /harris|toluna|\bthi\b/i },
  { key: "opinionway", name: /opinion\s*-?\s*way/i, hosts: ["opinion-way.com", "opinionway.com", "factoviz.com"], search: ["opinionway", "opinion way"], title: /opinion\s*way|opnionway|\bow\b/i },
  { key: "ipsos", name: /ipsos/i, hosts: ["ipsos.com", "ipsos.fr", "bva-group.com", "bva.fr"], search: ["ipsos"] },
  { key: "bva", name: /\bbva\b/i, hosts: ["bva-group.com", "bva.fr", "ipsos.com"], search: ["bva"] },
  { key: "odoxa", name: /odoxa/i, hosts: ["odoxa.fr"], search: ["odoxa"] },
  { key: "cluster17", name: /cluster\s*17/i, hosts: ["cluster17.com"], search: ["cluster"], title: /cluster\s*17/i },
  { key: "yougov", name: /yougov/i, hosts: [/(^|\.)yougov\.[a-z.]+$/], search: ["yougov"] },
  { key: "verian", name: /verian|kantar/i, hosts: ["veriangroup.com", "kantar.com", "kantarpublic.com"], search: ["verian", "kantar"], title: /verian|kantar/i },
  { key: "csa", name: /\bcsa\b/i, hosts: ["csa.eu"], search: ["csa"] },
  { key: "viavoice", name: /viavoice/i, hosts: ["institut-viavoice.com", "viavoice.fr"], search: ["viavoice"] },
  { key: "atlasintel", name: /atlas\s*intel/i, hosts: ["atlasintel.org"], search: ["atlas"], title: /atlas/i },
  { key: "redfield", name: /redfield/i, hosts: ["redfieldandwiltonstrategies.com"], search: [] },
];
const firmsOf = (pollster) => FIRMS.filter((f) => f.name.test(pollster));
const hostIs = (host, h) => (typeof h === "string" ? host === h || host.endsWith(`.${h}`) : h.test(host));
const COMMISSION = "commission-des-sondages.fr";

/** web.archive.org/web/<ts>/<original> → the original URL (classified by what was archived). */
const unwrap = (u) => u.match(/^https?:\/\/(?:web\.)?archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/)?.[1] ?? u;

function kindOf(url, firms) {
  let u;
  try { u = new URL(unwrap(url)); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)(wikipedia|wikimedia|wikidata)\.org$/.test(host)) return null;
  if (hostIs(host, COMMISSION)) return "commission";
  for (const f of firms) {
    if (f.hosts.some((h) => hostIs(host, h)) || f.files?.some((re) => re.test(host + u.pathname))) return "pollster";
  }
  return "press";
}

/** The best of a poll's citations → { url, urlKind } (or {} when it has none). */
function pickSource(cites, pollster) {
  const firms = firmsOf(pollster);
  const rank = { pollster: 0, commission: 1, press: 2 };
  const scored = cites
    .map((url, i) => ({ url, i, kind: kindOf(url, firms) }))
    .filter((c) => c.kind)
    // within a rank: direct links before archive copies, https before http, then citation order (firm/date cells first)
    .map((c) => ({ ...c, score: [rank[c.kind], unwrap(c.url) !== c.url ? 1 : 0, /^https:/.test(c.url) ? 0 : 1, c.i] }));
  scored.sort((a, b) => { for (let k = 0; k < 4; k++) if (a.score[k] !== b.score[k]) return a.score[k] - b.score[k]; return 0; });
  return scored[0] ? { url: scored[0].url, urlKind: scored[0].kind } : {};
}

// ── Commission des sondages lookup ─────────────────────────────────────────────────────────────
// Every published poll files a notice with the Commission (loi du 19 juillet 1977, art. 3). Its
// notices site has a title search (POST /notices/medias/fichiers/search) listing each notice as
// "<n°> <scrutin> <sujet> <INSTITUT> <média> <date de publication>" + " - <Mois> <Année>" (month filed),
// linking to /notices/medias/fichiers/add/<id>, which redirects to the PDF under
// /notices/files/notices/<année>/<mois>/<n°>-<slug>.pdf. A poll still left with a press link is
// matched on firm (title) and filing month, then the PDF is read and only accepted when its
// fieldwork ("Terrain du 12 au 15 octobre 2026", "Dates de réalisation : du 21 au 22 octobre 2026")
// ends within a day of the poll's. Results are cached in public/data/polls/notices-cache.json:
// notices never change, so each PDF is read once; misses are retried at most daily.

const CDS = "https://www.commission-des-sondages.fr";
const CACHE = new URL("notices-cache.json", OUT);
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const DAY = 864e5;
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const isoOf = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const MAX_PDFS = Number(process.env.POLLS_MAX_PDFS ?? 40); // per run, so a cold cache can't make the hourly sync heavy

let cache = { notices: {}, lookups: {} };
let pdfBudget = MAX_PDFS;
const searches = new Map(); // search term → listing entries (this run)
const today = new Date().toISOString().slice(0, 10);

async function get(url, init = {}) {
  return fetch(url, { ...init, headers: { ...UA, ...init.headers }, signal: AbortSignal.timeout(30000) });
}

/** Notices whose title matches a search term: [{ id, title, filed: [year, month] }], null if the search failed. */
async function searchNotices(term) {
  if (searches.has(term)) return searches.get(term);
  let out = null;
  try {
    const res = await get(`${CDS}/notices/medias/fichiers/search`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _method: "POST", searchterm: term }) });
    if (res.ok) {
      const html = await res.text();
      out = [];
      const re = /<a href="\/notices\/medias\/fichiers\/add\/(\d+)"[^>]*>([^<]*)<\/a>\s*-\s*([^\s<]+)\s+(\d{4})/g;
      for (let m; (m = re.exec(html)); ) {
        const month = MOIS.indexOf(fold(m[3]));
        if (month >= 0) out.push({ id: m[1], title: parse(m[2]).text.trim(), filed: [Number(m[4]), month] });
      }
    } else console.warn(`  ! Commission search "${term}": HTTP ${res.status}`);
  } catch (e) { console.warn(`  ! Commission search "${term}": ${e.message}`); }
  searches.set(term, out);
  return out;
}

/** The notice's own fieldwork: the first date range in its text (later ones are earlier waves recalled in tables) → [start, end] ISO, or null. */
function fieldworkOf(text) {
  // text runs can split numbers ("20 2 6", "1 er"): rejoin years and ordinals first
  const t = fold(text).replace(/\s+/g, " ").replace(/\b2 ?0 ?(\d) ?(\d)\b/g, "20$1$2").replace(/(\d) ?er\b/g, "$1");
  const mo = (s) => MOIS.indexOf(s);
  const out = [];
  // "du 12 au 15 octobre 2026", "du 30 octobre au 2 novembre 2026", "du 30 decembre 2025 au 2 janvier 2026",
  // "les 21 et 22 octobre 2026", "du 17 octobre a partir de 20h au 19 octobre 2026"
  const M = MOIS.join("|");
  const D = "(\\d(?: ?\\d)?)"; // a day, possibly split in two runs ("2 1 septembre")
  const re = new RegExp(`\\b${D} ?(?:(${M}) ?(?:(\\d{4}) ?)?)?(?:[^.;:\\d]|\\d{1,2} ?h(?:\\d\\d)?){0,30}?(?:\\bau\\b|\\bet\\b|-|–) ?${D} (${M}) (\\d{4})`, "g");
  const day = (s) => Number(s.replace(" ", ""));
  for (let m; (m = re.exec(t)); ) {
    const em = mo(m[5]);
    if (em < 0 || (m[2] && mo(m[2]) < 0) || day(m[1]) > 31 || day(m[4]) > 31) continue;
    const ey = Number(m[6]);
    const sm = m[2] ? mo(m[2]) : em;
    const sy = m[3] ? Number(m[3]) : sm > em ? ey - 1 : ey;
    out.push([m.index, isoOf(sy, sm, day(m[1])), isoOf(ey, em, day(m[4]))]);
  }
  // "du 21/10/2026 au 22/10/2026"
  for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}) ?(?:au|et|-) ?(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g)) {
    const y = (s) => (s.length === 2 ? 2000 + Number(s) : Number(s));
    out.push([m.index, isoOf(y(m[3]), m[2] - 1, Number(m[1])), isoOf(y(m[6]), m[5] - 1, Number(m[4]))]);
  }
  // single-day fieldwork: "terrain réalisé le 8 avril 2022", "interrogées le 8 avril 2022"
  for (const m of t.matchAll(/(?:terrain|realise|interroge|interview|enquete)[^.]{0,60}? le (\d{1,2}) ([a-z]+) (\d{4})/g)) {
    if (mo(m[2]) >= 0) { const d = isoOf(Number(m[3]), mo(m[2]), Number(m[1])); out.push([m.index, d, d]); }
  }
  return out.sort((a, b) => a[0] - b[0])[0]?.slice(1) ?? null;
}

/** Read a notice (cached forever): its PDF URL and fieldwork dates. null when unreachable this run. */
async function readNotice(id) {
  if (cache.notices[id]) return cache.notices[id];
  if (pdfBudget <= 0) return null;
  pdfBudget--;
  try {
    const r = await get(`${CDS}/notices/medias/fichiers/add/${id}`, { redirect: "manual" });
    const loc = r.headers.get("location");
    const gone = { url: null, fieldwork: null }; // no PDF behind this notice: remember, don't re-download
    if (!loc || !/\/notices\/files\/notices\/.+\.pdf$/i.test(loc)) return r.status >= 500 ? null : (cache.notices[id] = gone);
    const file = new URL(loc, CDS).href.replace(/^http:/, "https:"); // the Commission serves its files over https too
    const pdf = await get(file);
    if (pdf.status >= 500) return null;
    const buf = Buffer.from(await pdf.arrayBuffer());
    if (!pdf.ok || buf.subarray(0, 5).toString() !== "%PDF-") return (cache.notices[id] = gone);
    const text = pdfText(buf);
    const t = fold(text);
    // sample sizes the notice states ("échantillon de 1 393 personnes", "dont 976 sont inscrites"); runs may split digits
    const samples = [...new Set([...t.replace(/\s+/g, " ").replace(/(\d) (?=\d)/g, "$1").matchAll(/\b(\d{3,6})(?: [a-z']+){0,3}? ?(?:personnes|individus|repondants|interroge|inscrit|electeurs)/g)].map((m) => Number(m[1])))];
    const entry = { url: file, fieldwork: fieldworkOf(text), samples, iv: /intentions? de vote/.test(t), presidential: /presidentiel/.test(t), legislative: /legislativ/.test(t) };
    cache.notices[id] = entry;
    return entry;
  } catch (e) {
    console.warn(`  ! notice ${id}: ${e.message}`);
    return null;
  }
}

/** For each poll without its pollster's or the Commission's link, find its verified Commission notice. */
async function findNotices(polls, scope) {
  const taken = new Set(polls.filter((p) => p.urlKind === "commission").map((p) => p.url.replace(/^http:/, "https:")));
  for (const p of polls) {
    if (p.urlKind === "pollster" || p.urlKind === "commission") continue;
    const firms = firmsOf(p.pollster);
    if (!firms.length) continue;
    const key = `${scope}|${firms.map((f) => f.key).join("+")}|${p.start}|${p.end}`;
    const hit = cache.lookups[key];
    if (hit?.url) {
      if (!taken.has(hit.url)) { taken.add(hit.url); Object.assign(p, { url: hit.url, urlKind: "commission" }); }
      continue;
    }
    // misses: retry daily while the poll is recent (notices can be filed late), weekly after that
    const age = dayOf(today) - dayOf(p.end);
    if (hit && dayOf(today) - dayOf(hit.checked) < (age < 60 ? 1 : 7)) continue;
    try {
      const url = await lookup(p, firms, taken, scope);
      if (url === undefined) continue; // incomplete (budget or network): try again next run
      cache.lookups[key] = url ? { url } : { url: null, checked: today };
      if (url) { taken.add(url); Object.assign(p, { url, urlKind: "commission" }); console.log(`  + ${p.pollster} ${p.end} → ${url}`); }
    } catch (e) { console.warn(`  ! lookup ${p.pollster} ${p.end}: ${e.message}`); }
  }
}

/** → the notice URL, null when none matches, undefined when the search could not be completed. */
async function lookup(p, firms, taken, scope) {
  const end = dayOf(p.end);
  const entries = new Map();
  for (const f of firms) for (const term of f.search) {
    const list = await searchNotices(term);
    if (!list) return undefined;
    for (const e of list) if ((f.title ?? f.name).test(e.title)) entries.set(e.id, e);
  }
  const cands = [];
  for (const e of entries.values()) {
    // filed (month) from the day before fieldwork ended to ~7 weeks after (some releases come out weeks later)
    const [fy, fm] = e.filed;
    const from = Date.UTC(fy, fm, 1) / DAY, to = Date.UTC(fy, fm + 1, 1) / DAY - 1;
    if (to < end - 1 || from > end + 50) continue;
    // publication date in the title ("9 novembre", "1er juin") if any: must not precede the fieldwork
    const m = fold(e.title).match(/(\d{1,2})(?:er)? ?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/);
    let pub = null;
    if (m) {
      const mi = MOIS.indexOf(m[2]);
      pub = Date.UTC(mi > fm + 6 ? fy - 1 : mi < fm - 6 ? fy + 1 : fy, mi, Number(m[1])) / DAY;
      if (pub < end - 1 || pub > end + 45) continue;
    }
    // the notice must be for this election: titles open with the scrutin ("Pres", "Leg", "Mun", "Dep"…)
    const scrutin = fold(e.title).match(/^[\w-]+\s+([a-z]+)/)?.[1] ?? "";
    if (/^(mun|dep|reg|ref|euro?|cant|prim|tbd)/.test(scrutin) || (/^(pres|p|pdt)$/.test(scrutin) && scope !== "presidential") || (/^leg/.test(scrutin) && scope !== "legislative")) continue;
    const iv = /\biv\b|intention|1er tour|premier tour|barometre election|rolling|presitrack|legitrack/i.test(fold(e.title));
    cands.push({ ...e, iv, gap: pub == null ? 99 : pub - end });
  }
  cands.sort((a, b) => b.iv - a.iv || a.gap - b.gap);
  let incomplete = false;
  let best = null;
  for (const c of cands.slice(0, 12)) {
    const n = await readNotice(c.id);
    if (!n) { incomplete = true; continue; }
    if (taken.has(n.url)) continue;
    const diff = n.fieldwork ? Math.abs(dayOf(n.fieldwork[1]) - end) : Infinity;
    if (!(diff <= 1) || !(c.iv || n.iv) || !n[scope]) continue;
    // Unless the notice is titled as voting intentions and ends the very same day, both sides' sample sizes must
    // agree (catches e.g. a regional poll fielded the same days); a typo-sized gap (≤1%) only on the same day.
    const sameDayIV = diff === 0 && c.iv;
    if (!sameDayIV && p.sample && n.samples?.length && !n.samples.some((s) => s === p.sample || (diff === 0 && Math.abs(s - p.sample) <= p.sample / 100))) continue;
    const score = diff * 2 + (c.iv ? 0 : 1);
    if (!best || score < best.score) best = { url: n.url, score };
    if (score === 0) break;
  }
  return best ? best.url : incomplete ? undefined : null;
}

// ── Minimal PDF text extraction (no dependency) ────────────────────────────────────────────────
// Enough for the Commission's notices: Flate-compressed content streams, literal and hex strings,
// object streams, and each font's ToUnicode CMap (Office exports subset fonts with 2-byte codes).
function pdfText(buf) {
  const s = buf.toString("latin1");
  const objs = new Map(); // obj number → { dict, data? }
  for (const m of s.matchAll(/(?<![\d])(\d+)\s+\d+\s+obj\b/g)) {
    const start = m.index + m[0].length;
    const endobj = s.indexOf("endobj", start);
    if (endobj < 0) continue;
    const body = s.slice(start, endobj);
    const st = body.match(/stream\r?\n/);
    if (!st) { objs.set(m[1], { dict: body }); continue; }
    const ds = start + st.index + st[0].length;
    const de = s.indexOf("endstream", ds);
    objs.set(m[1], { dict: body.slice(0, st.index), data: buf.subarray(ds, de < 0 ? endobj : de) });
  }
  const decode = (o) => {
    if (!o?.data) return null;
    if (o._d !== undefined) return o._d;
    let d = null;
    try {
      if (/\/FlateDecode/.test(o.dict)) d = inflateSync(o.data, { finishFlush: zc.Z_SYNC_FLUSH }).toString("latin1");
      else if (!/\/Filter/.test(o.dict)) d = o.data.toString("latin1");
    } catch { d = null; }
    return (o._d = d);
  };
  // objects packed in object streams
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const d = decode(o);
    const first = Number(o.dict.match(/\/First\s+(\d+)/)?.[1]);
    if (!d || !first) continue;
    const nums = d.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      const a = first + nums[i + 1], b = i + 3 < nums.length ? first + nums[i + 3] : d.length;
      if (!objs.has(String(nums[i]))) objs.set(String(nums[i]), { dict: d.slice(a, b) });
    }
  }
  const ref = (str, key) => str.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`))?.[1];
  const inlineDict = (str, key) => {
    const i = str.search(new RegExp(`/${key}\\s*<<`));
    if (i < 0) return null;
    let depth = 0;
    for (let j = str.indexOf("<<", i); j < str.length; j++) {
      if (str.startsWith("<<", j)) { depth++; j++; } else if (str.startsWith(">>", j)) { depth--; j++; if (!depth) return str.slice(i, j + 1); }
    }
    return null;
  };
  const sub = (str, key) => inlineDict(str, key) ?? objs.get(ref(str, key))?.dict ?? null;
  const hexBytes = (h) => { h = h.replace(/\s/g, ""); if (h.length % 2) h += "0"; return Buffer.from(h, "hex"); };
  const utf16 = (b) => { let o = ""; for (let i = 0; i + 1 < b.length; i += 2) o += String.fromCharCode(b.readUInt16BE(i)); return o; };
  const cmaps = new Map();
  const cmapOf = (fontNum) => {
    if (cmaps.has(fontNum)) return cmaps.get(fontNum);
    let map = null;
    const font = objs.get(fontNum);
    const d = font && decode(objs.get(ref(font.dict, "ToUnicode")));
    if (d) {
      map = { bytes: 1, codes: new Map() };
      for (const blk of d.match(/beginbfchar[\s\S]*?endbfchar/g) ?? [])
        for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) { map.bytes = m[1].length / 2; map.codes.set(parseInt(m[1], 16), utf16(hexBytes(m[2]))); }
      for (const blk of d.match(/beginbfrange[\s\S]*?endbfrange/g) ?? [])
        for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
          map.bytes = m[1].length / 2;
          const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
          if (hi - lo > 0xffff) continue;
          if (m[3].startsWith("[")) [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].forEach((x, k) => map.codes.set(lo + k, utf16(hexBytes(x[1]))));
          else { const b = hexBytes(m[3].slice(1, -1)); for (let c = lo; c <= hi; c++) { const o = Buffer.from(b); o.writeUInt16BE((o.readUInt16BE(o.length - 2) + c - lo) & 0xffff, o.length - 2); map.codes.set(c, utf16(o)); } }
        }
    }
    cmaps.set(fontNum, map);
    return map;
  };
  const show = (bytes, map) => {
    if (!map) return bytes.toString("latin1");
    let o = "";
    for (let i = 0; i + map.bytes <= bytes.length; i += map.bytes) o += map.codes.get(map.bytes === 2 ? bytes.readUInt16BE(i) : bytes[i]) ?? "";
    return o;
  };
  const literal = (x) => Buffer.from(x.replace(/\\(\r?\n|[0-7]{1,3}|.)/g, (_, c) => (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8) & 255) : /^\r?\n$/.test(c) ? "" : { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] ?? c)), "latin1");

  let text = "";
  const pages = [...objs.values()].filter((o) => /\/Type\s*\/Page(?![s\w])/.test(o.dict));
  for (const page of pages) {
    // resources may be inherited from the page tree
    let res = null;
    for (let n = page, k = 0; n && !res && k < 10; n = objs.get(ref(n.dict, "Parent")), k++) res = sub(n.dict, "Resources");
    const fonts = {};
    const fd = res && sub(res, "Font");
    if (fd) for (const m of fd.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts[m[1]] = m[2];
    const contents = page.dict.match(/\/Contents\s*\[([^\]]*)\]/)?.[1].match(/(\d+)\s+\d+\s+R/g)?.map((r) => r.split(/\s+/)[0]) ?? [ref(page.dict, "Contents")].filter(Boolean);
    const cs = contents.map((n) => decode(objs.get(n)) ?? "").join("\n");
    let map = null;
    const tok = /\/([^\s/<>[\]()]+)\s+[-\d.]+\s+Tf|\[((?:[^\]\\]|\\[\s\S])*)\]\s*TJ|\(((?:[^)\\]|\\[\s\S])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]*)>\s*Tj|\b(?:Td|TD|T\*|ET)\b/g;
    for (const m of cs.matchAll(tok)) {
      if (m[1] !== undefined) map = fonts[m[1]] ? cmapOf(fonts[m[1]]) : null;
      else if (m[2] !== undefined) {
        for (const p of m[2].matchAll(/\(((?:[^)\\]|\\[\s\S])*)\)|<([0-9A-Fa-f\s]*)>|(-?\d+(?:\.\d+)?)/g)) {
          if (p[1] !== undefined) text += show(literal(p[1]), map);
          else if (p[2] !== undefined) text += show(hexBytes(p[2]), map);
          else if (Number(p[3]) < -200) text += " ";
        }
      } else if (m[3] !== undefined) text += show(literal(m[3]), map);
      else if (m[4] !== undefined) text += show(hexBytes(m[4]), map);
      else text += " ";
    }
    text += "\n";
  }
  return text;
}

async function syncYear(year) {
  const page = PAGES[year];
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2`;
  console.log(`↓ ${page}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const root = parse((await res.json()).parse.text);

  // footnote → every external link of the reference it points to (pollster release, Commission notice, press article, archive copy)
  const resolve = (href) => {
    if (!href?.startsWith("#")) return [];
    const ref = root.getElementById(decodeURIComponent(href.slice(1)));
    return ref ? ref.querySelectorAll("a.external").map((a) => a.getAttribute("href")).filter((u) => u && /^https?:\/\//.test(u)) : [];
  };
  const firstRound = new Map();
  const secondRound = [];
  let h2 = "";
  for (const el of root.querySelectorAll("div.mw-heading, table.wikitable")) {
    if (el.classList.contains("mw-heading")) {
      // "First round" / "Second round" is an h2 on presidential pages and an h3 on legislative ones
      const h = el.querySelector("h2, h3");
      const text = h?.text.trim().toLowerCase() ?? "";
      if (text === "first round" || text === "second round") h2 = text;
      else if (h?.tagName === "H2") h2 = text;
      continue;
    }
    if (h2 !== "first round" && h2 !== "second round") continue;
    const rows = parseTable(el, { blocs: String(year).startsWith("legislatives"), resolve });
    if (!rows) continue;
    for (const r of rows) {
      if (h2 === "first round") {
        // rows sharing the same (rowspan-merged) firm + date cells are line-ups of one poll
        const p = firstRound.get(r.key) ?? { pollster: r.pollster, start: r.start, end: r.end, sample: r.sample, hyps: [], cites: [] };
        p.hyps.push(r.values);
        for (const u of r.cites) if (!p.cites.includes(u)) p.cites.push(u);
        firstRound.set(r.key, p);
      } else {
        const [a, b] = Object.keys(r.values);
        if (a && b && Object.keys(r.values).length === 2) secondRound.push({ pollster: r.pollster, start: r.start, end: r.end, sample: r.sample, a, b, pa: r.values[a], pb: r.values[b] });
      }
    }
  }
  // Best source per poll (pollster's own release > Commission notice > press); then look up the notice for the rest.
  const fr = [...firstRound.values()].map(({ cites, hyps, ...p }) => ({ ...p, ...pickSource(cites, p.pollster), hyps }));
  await findNotices(fr, String(year).startsWith("legislatives") ? "legislative" : "presidential");
  fr.sort((x, y) => y.end.localeCompare(x.end));
  secondRound.sort((x, y) => y.end.localeCompare(x.end));

  // Party labels as Wikipedia's headers give them: "Arthaud (LO)" or "Philippe HOR" under a link to the person.
  const parties = {};
  for (const th of root.querySelectorAll("table.wikitable th")) {
    const a = th.querySelector("a[title]");
    if (!a) continue;
    const person = a.getAttribute("title").replace(/\s*\(.*\)$/, "");
    const text = th.text.replace(/\[.*?\]/g, "").replace(/\s+/g, " ").trim();
    const m = text.match(/\(([^()]+)\)\s*$/) ?? text.match(/\s([A-Z][A-Z!]{1,5})$/);
    if (m && /\s/.test(person) && !parties[person]) parties[person] = m[1];
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(new URL(`${year}.json`, OUT), JSON.stringify({ source: `https://en.wikipedia.org/wiki/${page}`, fetchedAt: new Date().toISOString(), firstRound: fr, secondRound, parties }));
  console.log(`✓ ${year}: ${fr.length} first-round polls, ${secondRound.length} runoff polls`);
}

const years = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
try { cache = { ...cache, ...JSON.parse(await readFile(CACHE, "utf8")) }; } catch { /* first run */ }
try {
  for (const y of years) await syncYear(y);
} finally {
  // keep what was looked up even if a page failed; sorted keys so the file only changes when a lookup does
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  await mkdir(OUT, { recursive: true });
  await writeFile(CACHE, JSON.stringify({ about: "Commission des sondages notices read by scripts/sync-polls.mjs (poll → notice lookups); safe to delete", notices: sorted(cache.notices), lookups: sorted(cache.lookups) }, null, 1));
}
