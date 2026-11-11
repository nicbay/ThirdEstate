// History of French presidential elections, 1848–2022: national results for every ballot, department
// results where an open source exists, and one verified media item (TV / radio / newsreel / newspaper) per
// election round. Historical data — run once, or again to refresh sources.
//
//   node scripts/sync-presidential-history.mjs                  # everything
//   node scripts/sync-presidential-history.mjs 1981 2022        # only these elections (index is rebuilt from disk)
//   node scripts/sync-presidential-history.mjs --verify-media   # also re-check every media URL online
//   PV_CACHE=<dir> node scripts/sync-presidential-history.mjs   # cache downloads (dev; avoids re-fetching)
//
// Sources (see docs/data-presidential-history.md for licences and coverage):
//   national  — fr.wikipedia results table of each election page (MediaWiki API, pinned revision), which
//               reproduces the Conseil constitutionnel / Journal officiel figures it cites (kept in `cites`)
//   departments
//     1848       — Cagé & Piketty, "Une histoire du conflit politique" (2023), commune-level data, summed
//     1965–2012  — Sciences Po CDSP via data.gouv.fr (ODbL), results by constituency, summed
//     2017       — Ministère de l'Intérieur via data.gouv.fr (Licence Ouverte), results by canton, summed
//     2022       — Ministère de l'Intérieur via data.gouv.fr, results by department
//   media     — curated in scripts/data/presidential-history-media.json (every entry verified by hand)
//
// Output: public/data/history/presidential/index.json and <election-id>.json (schema in the doc).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { unzipSync } from "fflate";

const OUT = new URL("../public/data/history/presidential/", import.meta.url);
const MEDIA = new URL("./data/presidential-history-media.json", import.meta.url);
const UA = { "User-Agent": "ThirdEstate/0.1 (open-data French election site; github.com/nicbay/ThirdEstate)" };
const CACHE = process.env.PV_CACHE ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------
// Catalogue. Dates are checked against the Wikipedia page text at sync time (a warning is printed if absent).
// ---------------------------------------------------------------------------------------------------------
const CONGRES = { fr: "Parlement réuni en Congrès (Assemblée nationale) à Versailles", en: "Parliament sitting as a Congress (National Assembly) at Versailles" };
const CONGRES_IV = { fr: "Parlement (Assemblée nationale et Conseil de la République) réuni en Congrès à Versailles", en: "Parliament (National Assembly and Council of the Republic) sitting as a Congress at Versailles" };
const SUD = { fr: "Suffrage universel direct", en: "Direct universal suffrage" };
const R3 = { id: "IIIe", fr: "IIIe République", en: "Third Republic" };
const R4 = { id: "IVe", fr: "IVe République", en: "Fourth Republic" };
const R5 = { id: "Ve", fr: "Ve République", en: "Fifth Republic" };

const ELECTIONS = [
  { id: "1848", page: "Élection présidentielle française de 1848", regime: { id: "IIe", fr: "IIe République", en: "Second Republic" },
    method: { fr: "Suffrage universel masculin direct", en: "Direct universal male suffrage" }, dates: ["1848-12-10"], dateEnd: "1848-12-11" },
  { id: "1873", page: "Élection présidentielle française de 1873", regime: R3,
    method: { fr: "Assemblée nationale (chambre unique) à Versailles", en: "National Assembly (single chamber) at Versailles" }, dates: ["1873-05-24"] },
  { id: "1879", page: "Élection présidentielle française de 1879", regime: R3, method: CONGRES, dates: ["1879-01-30"] },
  { id: "1885", page: "Élection présidentielle française de 1885", regime: R3, method: CONGRES, dates: ["1885-12-28"] },
  { id: "1887", page: "Élection présidentielle française de 1887", regime: R3, method: CONGRES, dates: ["1887-12-03", "1887-12-03"] },
  { id: "1894", page: "Élection présidentielle française de 1894", regime: R3, method: CONGRES, dates: ["1894-06-27"] },
  { id: "1895", page: "Élection présidentielle française de 1895", regime: R3, method: CONGRES, dates: ["1895-01-17", "1895-01-17"] },
  { id: "1899", page: "Élection présidentielle française de 1899", regime: R3, method: CONGRES, dates: ["1899-02-18"] },
  { id: "1906", page: "Élection présidentielle française de 1906", regime: R3, method: CONGRES, dates: ["1906-01-17"] },
  { id: "1913", page: "Élection présidentielle française de 1913", regime: R3, method: CONGRES, dates: ["1913-01-17", "1913-01-17"] },
  { id: "1920-01", page: "Élection présidentielle française de janvier 1920", regime: R3, method: CONGRES, dates: ["1920-01-17"] },
  { id: "1920-09", page: "Élection présidentielle française de septembre 1920", regime: R3, method: CONGRES, dates: ["1920-09-23"] },
  { id: "1924", page: "Élection présidentielle française de 1924", regime: R3, method: CONGRES, dates: ["1924-06-13"] },
  { id: "1931", page: "Élection présidentielle française de 1931", regime: R3, method: CONGRES, dates: ["1931-05-13", "1931-05-13"] },
  { id: "1932", page: "Élection présidentielle française de 1932", regime: R3, method: CONGRES, dates: ["1932-05-10"] },
  { id: "1939", page: "Élection présidentielle française de 1939", regime: R3, method: CONGRES, dates: ["1939-04-05"] },
  { id: "1947", page: "Élection présidentielle française de 1947", regime: R4, method: CONGRES_IV, dates: ["1947-01-16"] },
  { id: "1953", page: "Élection présidentielle française de 1953", regime: R4, method: CONGRES_IV,
    // one ballot per section; "Il a lieu le …" in each section of the page
    dates: ["1953-12-17", "1953-12-17", "1953-12-18", "1953-12-18", "1953-12-19", "1953-12-19", "1953-12-20", "1953-12-20", "1953-12-21", "1953-12-21", "1953-12-23", "1953-12-23", "1953-12-23"] },
  { id: "1958", page: "Élection présidentielle française de 1958", regime: R5,
    method: { fr: "Collège électoral (parlementaires, conseillers généraux, délégués des conseils municipaux…)", en: "Electoral college (MPs, departmental councillors, municipal delegates…)" }, dates: ["1958-12-21"] },
  ...[
    ["1965", "1965-12-05", "1965-12-19"], ["1969", "1969-06-01", "1969-06-15"], ["1974", "1974-05-05", "1974-05-19"],
    ["1981", "1981-04-26", "1981-05-10"], ["1988", "1988-04-24", "1988-05-08"], ["1995", "1995-04-23", "1995-05-07"],
    ["2002", "2002-04-21", "2002-05-05"], ["2007", "2007-04-22", "2007-05-06"], ["2012", "2012-04-22", "2012-05-06"],
    ["2017", "2017-04-23", "2017-05-07"], ["2022", "2022-04-10", "2022-04-24"],
  ].map(([id, t1, t2]) => ({ id, page: `Élection présidentielle française de ${id}`, regime: R5, method: SUD, dates: [t1, t2], direct: true })),
];
ELECTIONS[0].direct = true;

// ---------------------------------------------------------------------------------------------------------
// Political families (editorial classification, documented in the doc). side drives the colour convention:
// left = red/pink, right = blue.
// ---------------------------------------------------------------------------------------------------------
const FAMILY_SIDE = {
  "extreme-gauche": "left", gauche: "left", "centre-gauche": "left", ecologiste: "left",
  centre: "centre", "centre-droit": "right", droite: "right", "extreme-droite": "right", divers: "other",
};
// Labels exactly as the Wikipedia tables give them (footnote markers stripped).
const FAMILY = {
  // 1848
  "Bonapartiste": "droite", "Républicain modéré": "centre-gauche", "Républicain démocrate-socialiste": "gauche",
  "Socialiste": "extreme-gauche", "Républicain libéral": "centre", "Monarchiste": "droite", "Légitimiste": "droite",
  "Orléaniste": "droite", "Démocrate-socialiste": "gauche", "Union républicaine": "gauche", "Parti orléaniste": "droite", Ind: "divers", SFIC: "extreme-gauche", FRS: "droite", "Parti de l'Ordre": "droite",
  // IIIe République (positions relative to the chamber of the time)
  "Républicains modérés": "centre-gauche", "Républicains de gouvernement": "centre-gauche", "Républicains radicaux": "gauche",
  "Républicains ralliés": "centre-droit", "Extrême gauche": "extreme-gauche", "Sans étiquette": "divers", "Conservateur": "droite",
  "Républicains de gauche": "centre-gauche", "Républicains progressistes": "centre-droit", "Parti nationaliste": "extreme-droite",
  "Parti nationaliste / Groupe de la Défense nationale": "extreme-droite", "Gauche démocratique": "centre-gauche",
  ARD: "centre", RI: "centre-droit", PRRRS: "centre-gauche", RRRS: "centre-gauche", PRD: "centre-gauche", PR: "centre-gauche", PRS: "centre-gauche",
  PRDS: "centre", AD: "centre-droit", SFIO: "gauche", "PC-SFIC": "extreme-gauche", DVD: "droite", IND: "divers", FR: "droite", URD: "droite",
  // IVe République
  MRP: "centre", RGR: "centre-gauche", CNIP: "droite", RPF: "droite", PCF: "gauche", UDSR: "centre-gauche", PRL: "droite", PRS: "centre-gauche",
  // Ve République
  UNR: "droite", "UNR-UDT": "droite", UFD: "gauche", CIR: "gauche", PLE: "centre-droit", CTV: "extreme-droite", "Indépendant": "divers",
  UDR: "droite", CD: "centre", PSU: "extreme-gauche", LC: "extreme-gauche", PS: "gauche", FNRI: "centre-droit", LO: "extreme-gauche",
  ECO: "ecologiste", FN: "extreme-droite", MDSF: "centre", LCR: "extreme-gauche", NAF: "divers", MFE: "divers", PFE: "divers",
  UDF: "centre-droit", RPR: "droite", MRG: "centre-gauche", MEP: "ecologiste", LV: "ecologiste", NGSEA: "extreme-gauche", MPPT: "extreme-gauche",
  MPF: "droite", FNS: "divers", "Les Verts": "ecologiste", Verts: "ecologiste", "Les Verts (RP&S)": "ecologiste", PRG: "centre-gauche", MDC: "gauche", "Pôle républicain": "gauche",
  DL: "centre-droit", "Cap21": "ecologiste", CPNT: "divers", MNR: "extreme-droite", PT: "extreme-gauche", FDF: "droite", "UDF diss.": "droite",
  "UMP (PRV)": "droite", "PS (PRG, MRC)": "gauche", "UDF (Cap21, MÉI)": "centre", "FN (MNR)": "extreme-droite", "Divers gauche": "gauche",
  UMP: "droite", FG: "gauche", MoDem: "centre", EELV: "ecologiste", DLR: "droite", NPA: "extreme-gauche", SP: "divers",
  EM: "centre", LR: "droite", LFI: "gauche", FI: "gauche", DLF: "droite", UPR: "droite", RES: "divers", LREM: "centre", RN: "extreme-droite", REC: "extreme-droite",
  "Solidarité et progrès": "divers", SE: "divers", DIV: "divers", DVG: "gauche", EXD: "extreme-droite", MDE: "divers",
};

// ---------------------------------------------------------------------------------------------------------
// HTTP with optional disk cache and polite retries
// ---------------------------------------------------------------------------------------------------------
async function get(url, { type = "text", headers = {}, wait = 0 } = {}) {
  const key = CACHE ? `${CACHE}/${createHash("sha1").update(url).digest("hex")}` : null;
  if (key && existsSync(key)) { const b = await readFile(key); return type === "buffer" ? b : b.toString(type === "latin1" ? "latin1" : "utf8"); }
  for (let attempt = 0; ; attempt++) {
    if (wait) await sleep(wait);
    const res = await fetch(url, { headers: { ...UA, ...headers } });
    const buf = Buffer.from(await res.arrayBuffer());
    const busy = res.status === 429 || res.status >= 500 || (url.includes("wikipedia.org/w/api.php") && buf[0] !== 0x7b);
    if (res.ok && !busy) {
      if (key) { await mkdir(CACHE, { recursive: true }); await writeFile(key, buf); }
      return type === "buffer" ? buf : buf.toString(type === "latin1" ? "latin1" : "utf8");
    }
    if (attempt >= 5 || (res.status >= 400 && res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${url}`);
    await sleep(3000 * (attempt + 1));
  }
}

// ---------------------------------------------------------------------------------------------------------
// Wikipedia results tables
// ---------------------------------------------------------------------------------------------------------
const clean = (c) => {
  const x = parse(c.toString());
  x.querySelectorAll("style, sup.reference, .mw-ref").forEach((n) => n.remove());
  return x.text.replace(/\[[a-z0-9]{1,3}\]/gi, "").replace(/[\s  ]+/g, " ").trim();
};
const int = (s) => { const d = (s ?? "").replace(/[^\d]/g, ""); return d && /\d/.test(s) && !/%/.test(s) ? Number(d) : null; };
const pct = (s) => { const m = (s ?? "").replace(/\s/g, "").match(/^(\d+(?:[.,]\d+)?)%?$/); return m ? Number(m[1].replace(",", ".")) : null; };

let tableSeq = 0;
function grid(table) {
  const t = tableSeq++;
  const out = [];
  table.querySelectorAll("tr").forEach((tr, r) => {
    out[r] ??= [];
    let c = 0;
    for (const cell of tr.querySelectorAll("th, td")) {
      while (out[r][c]) c++;
      const rs = Number(cell.getAttribute("rowspan") ?? 1) || 1;
      const cs = Number(cell.getAttribute("colspan") ?? 1) || 1;
      const v = { el: cell, th: cell.tagName === "TH", text: clean(cell), origin: `${t}:${r}:${c}` };
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) ((out[r + i] ??= [])[c + j] = v);
      c += cs;
    }
  });
  return out;
}

const ORDINALS = ["premier", "deuxième", "troisième", "quatrième", "cinquième", "sixième", "septième", "huitième", "neuvième", "dixième", "onzième", "douzième", "treizième"];
const roundNo = (s) => {
  const t = s.toLowerCase();
  if (/second tour|2d tour|2e tour/.test(t)) return 2;
  const i = ORDINALS.findIndex((o) => t.startsWith(o) || t.includes(`${o} tour`));
  return i >= 0 ? i + 1 : null;
};

const SUMMARY = [
  [/^(votes valides|suffrages exprimés|exprimés)/i, "exprimes"],
  [/^(votes )?blancs (et|ou) nuls/i, "blancsNuls"],
  [/^votes blancs$/i, "blancs"],
  [/^votes nuls$/i, "nuls"],
  [/^(total|votants)/i, "votants"],
  [/^abstentions?/i, "abstention"],
  [/^inscrits/i, "inscrits"],
  [/^majorité (requise|absolue)/i, "majorite"],
];

/** Parse one results table into rounds: [{ round, candidates: [{name, party, votes, pct}], totals }] */
function parseResults(table, sectionRound) {
  const g = grid(table);
  const firstData = g.findIndex((row) => row.some((c) => c && !c.th && c.text));
  const header = g.slice(0, firstData);
  const width = Math.max(...g.map((r) => r.length));
  const top = header[0] ?? [];
  const colOf = (re) => { for (let c = width - 1; c >= 0; c--) if (top[c] && re.test(top[c].text)) return c; return -1; };
  const iName = colOf(/^candidat/i), iParty = colOf(/^(partis?|étiquettes?)/i);
  // round groups: header cells "Premier tour", "Second tour"… else one group from the section heading
  const groups = [];
  const seen = new Set();
  for (let c = 0; c < width; c++) {
    const h = top[c];
    if (!h || seen.has(h.origin)) continue;
    seen.add(h.origin);
    const n = roundNo(h.text);
    if (n) groups.push({ round: n, cols: [...Array(width).keys()].filter((k) => top[k] === h) });
  }
  if (!groups.length) {
    const cols = [...Array(width).keys()].filter((k) => /^(voix|votes|%)$/i.test(top[k]?.text ?? ""));
    groups.push({ round: sectionRound ?? 1, cols });
  }
  const sub = header.at(-1) ?? top;
  for (const gr of groups) {
    gr.iVotes = gr.cols.find((k) => /^(voix|votes)$/i.test(sub[k]?.text ?? ""));
    gr.iPct = gr.cols.find((k) => /^%$/.test(sub[k]?.text ?? ""));
    gr.candidates = [];
    gr.totals = {};
  }
  if (iName < 0 || groups.some((gr) => gr.iVotes == null)) return null;

  for (const row of g.slice(firstData)) {
    const label = row[iName]?.text ?? "";
    if (!label) continue;
    const kind = SUMMARY.find(([re]) => re.test(label))?.[1];
    for (const gr of groups) {
      const vCell = row[gr.iVotes], pCell = gr.iPct != null ? row[gr.iPct] : null;
      // a label cell that spans into the figures columns means "no figure for this round"
      if (!vCell || vCell === row[iName]) continue;
      const votes = int(vCell.text);
      const p = pCell && pCell !== vCell ? pct(pCell.text) : null;
      if (kind) {
        if (kind === "majorite") { const m = int(row.slice(iName + 1).find((c) => c && c !== row[iName])?.text); if (m) gr.totals.majorite = m; continue; }
        if (votes != null) gr.totals[kind] = votes;
        if (kind === "inscrits" && p != null && /participation/i.test(label)) gr.totals.participationPct = p;
        if (kind === "abstention" && p != null) gr.totals.abstentionPct = p;
        continue;
      }
      if (/^source/i.test(label) || votes == null) continue;
      const party = iParty >= 0 && row[iParty] && row[iParty] !== row[iName] ? row[iParty].text || null : null;
      gr.candidates.push({ label, party, votes, pct: p });
    }
  }
  return groups.map(({ round, candidates, totals }) => ({ round, candidates, totals }));
}

function citations(root, el) {
  const urls = [];
  for (const a of el.querySelectorAll("sup.reference a, a[href^='#cite_note']")) {
    const id = decodeURIComponent((a.getAttribute("href") ?? "").replace(/^#/, ""));
    const li = id && root.querySelector(`li[id="${id}"]`);
    if (!li) continue;
    for (const x of li.querySelectorAll("a.external, a[href^='http']")) {
      const href = x.getAttribute("href");
      if (href && !urls.some((u) => u.url === href)) urls.push({ url: href.replace(/^\/\//, "https://"), label: clean(li).slice(0, 240) });
    }
  }
  return urls;
}

const cleanName = (s) => s.replace(/\s+élu(e)?$/i, "").replace(/\s*\((non candidat|non-candidat)\)/i, "").trim();
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const frDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MONTHS_FR[m - 1]} ${y}`; };

async function national(e) {
  const api = `https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(e.page)}&prop=text|revid&redirects=1&format=json&formatversion=2&maxlag=5`;
  const j = JSON.parse(await get(api, { wait: 1200 }));
  if (!j.parse) throw new Error(`${e.id}: ${j.error?.info ?? "no page"}`);
  const root = parse(j.parse.text);
  const pageText = root.text.replace(/[\s ]+/g, " ");
  for (const d of new Set(e.dates)) if (!pageText.includes(frDate(d)) && !pageText.includes(frDate(d).replace(/^1er/, "1")))
    console.warn(`  ! ${e.id}: date ${frDate(d)} not found on the page`);

  const rounds = new Map();
  let heading = "";
  let cites = [];
  for (const el of root.querySelectorAll("div.mw-heading, table.wikitable")) {
    if (el.classList.contains("mw-heading")) { heading = el.text.replace(/\[modifier.*$/, "").trim(); continue; }
    const caption = el.querySelector("caption")?.text.replace(/\s+/g, " ").trim() ?? "";
    if (!/^Résultats/.test(caption) || /sociolog|commune|comptes|taux|exception/i.test(caption)) continue;
    if (/préparatoire|plénière|réunion|sondage/i.test(heading)) continue;
    const parsed = parseResults(el, roundNo(heading));
    if (!parsed) continue;
    const c = citations(root, el.querySelector("caption"));
    cites.push(...c.filter((x) => !cites.some((y) => y.url === x.url)));
    for (const r of parsed) if (r.candidates.length && !rounds.has(r.round)) rounds.set(r.round, r);
  }
  if (!rounds.size) throw new Error(`${e.id}: no results table found`);
  const permalink = `https://fr.wikipedia.org/w/index.php?title=${encodeURIComponent(j.parse.title.replace(/ /g, "_"))}&oldid=${j.parse.revid}`;
  return { rounds: [...rounds.values()].sort((a, b) => a.round - b.round), source: { name: "Wikipédia (fr)", page: `https://fr.wikipedia.org/wiki/${encodeURIComponent(j.parse.title.replace(/ /g, "_"))}`, permalink, revid: j.parse.revid, licence: "CC BY-SA 4.0", cites } };
}

// ---------------------------------------------------------------------------------------------------------
// Department results
// ---------------------------------------------------------------------------------------------------------
const normName = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z' -]/g, "").replace(/\s+/g, " ").trim();
const deptCode = (raw) => {
  let c = String(raw).trim().replace(/\.0$/, "");
  const Z = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZM: "976", ZN: "988", ZP: "987", ZS: "975", ZW: "986", ZX: "977", ZZ: "99" };
  if (Z[c]) return Z[c];
  if (c === "985") return "976"; // Mayotte, old code in CDSP files
  return /^\d$/.test(c) ? `0${c}` : c;
};

/** Accumulate { code: { name, inscrits, votants, exprimes, votes: { key: n } } } */
function acc(map, code, name, i, v, e, votes) {
  const d = (map[code] ??= { name, inscrits: 0, votants: 0, exprimes: 0, votes: {} });
  d.inscrits += i || 0; d.votants += v || 0; d.exprimes += e || 0;
  for (const [k, n] of Object.entries(votes)) d.votes[k] = (d.votes[k] ?? 0) + (n || 0);
}

function splitCsv(line, sep = ",") {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Sciences Po CDSP, results by constituency 1965–2012 (data.gouv dataset 54aeb906c751df6643de6534)
const CDSP_DATASET = "54aeb906c751df6643de6534";
let cdspResources;
async function cdsp(year, round) {
  cdspResources ??= JSON.parse(await get(`https://www.data.gouv.fr/api/1/datasets/${CDSP_DATASET}/`)).resources;
  const want = new RegExp(`circonscription ${year} ${round === 1 ? "1er" : "2nd"} tour`, "i");
  const res = cdspResources.find((r) => want.test(r.title) && /csv/i.test(r.format));
  if (!res) return null;
  const text = await get(res.url);
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = splitCsv(head);
  const cand = cols.map((c, i) => [i, c]).filter(([i]) => i >= 7);
  const map = {};
  for (const l of lines) {
    const r = splitCsv(l);
    acc(map, deptCode(r[0]), r[1], +r[3], +r[4], +r[5], Object.fromEntries(cand.map(([i, c]) => [c, +r[i]])));
  }
  return {
    rows: map, keys: cand.map(([, c]) => c), surname: (k) => k.replace(/\s*\(.*$/, "").replace(/\s+[A-Z0-9.&-]+\)\s*$/, ""), // "DE VILLIERS MPF)" in 2007 t1
    source: { name: "Sciences Po – CDSP (via data.gouv.fr)", dataset: `https://www.data.gouv.fr/datasets/${CDSP_DATASET}/`, resource: res.url, title: res.title, licence: "ODbL", unit: "circonscription législative, summed by department" },
  };
}

// Cagé & Piketty 2023 — 1848 commune-level reconstruction
async function cagePiketty1848() {
  const url = "https://conflit-politique-data.ams3.cdn.digitaloceanspaces.com/zip/pres1848_csv.zip";
  const files = unzipSync(new Uint8Array(await get(url, { type: "buffer" })));
  const name = Object.keys(files).find((k) => /pres1848comm\.csv$/.test(k) && !k.startsWith("__MACOSX"));
  const text = Buffer.from(files[name]).toString("utf8");
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = splitCsv(head);
  const ix = (c) => cols.indexOf(c);
  const cand = cols.filter((c) => /^voix[A-Z]+$/.test(c));
  const map = {};
  for (const l of lines) {
    const r = splitCsv(l);
    acc(map, r[ix("dep")], r[ix("nomdep")], +r[ix("inscrits")], +r[ix("votants")], +r[ix("exprimes")], Object.fromEntries(cand.map((c) => [c, +r[ix(c)] || 0])));
  }
  const SURNAME = { voixRASPAIL: "RASPAIL", voixLEDRUROLLIN: "LEDRU-ROLLIN", voixLAMARTINE: "LAMARTINE", voixCAVAIGNAC: "CAVAIGNAC", voixBONAPARTE: "BONAPARTE", voixCHANGARNIER: "CHANGARNIER" };
  return {
    rows: map, keys: cand, surname: (k) => SURNAME[k] ?? k.replace(/^voix/, ""),
    source: { name: "Julia Cagé & Thomas Piketty, Une histoire du conflit politique (Seuil, 2023) — données électorales", dataset: "https://unehistoireduconflitpolitique.fr/telecharger.html", resource: url, licence: "Free download with attribution (no formal licence stated)", unit: "commune, summed by department (1848 departments)" },
  };
}

// Ministère de l'Intérieur 2017 — by canton (xls read through the data.gouv tabular API)
const MI2017 = {
  1: { resource: "2776519f-a940-46f0-99f4-1a3a1374193b", dataset: "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-1er-tour-1" },
  2: { resource: "0e50ba6a-8175-4455-9e4a-09a7783dc547", dataset: "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-2nd-tour" },
};
async function mi2017(round) {
  const { resource, dataset } = MI2017[round];
  const api = `https://tabular-api.data.gouv.fr/api/resources/${resource}/data/`;
  const rows = [];
  for (let p = 1, pages = 1; p <= pages; p++) {
    const j = JSON.parse(await get(`${api}?page_size=200&page=${p}`, { wait: 200 }));
    pages = Math.ceil(j.meta.total / 200);
    rows.push(...j.data.map((r) => Object.values(r).slice(1))); // drop __id
  }
  const hi = rows.findIndex((r) => r[0] === "Code du département");
  const head = rows[hi];
  const iIns = head.indexOf("Inscrits"), iVot = head.indexOf("Votants"), iExp = head.indexOf("Exprimés");
  const first = head.indexOf("N°Panneau");
  const map = {}; const keys = new Set();
  for (const r of rows.slice(hi + 1)) {
    if (r[0] == null) continue;
    const votes = {};
    for (let k = first; k + 6 < r.length && r[k + 2]; k += 7) { votes[r[k + 2]] = Number(r[k + 4]); keys.add(r[k + 2]); }
    acc(map, deptCode(r[0]), r[1], Number(r[iIns]), Number(r[iVot]), Number(r[iExp]), votes);
  }
  return { rows: map, keys: [...keys], surname: (k) => k, source: { name: "Ministère de l'Intérieur (via data.gouv.fr)", dataset, resource: `https://www.data.gouv.fr/fr/datasets/r/${resource}`, licence: "Licence Ouverte / Etalab", unit: "canton, summed by department" } };
}

// Ministère de l'Intérieur 2022 — by department (txt, ; separated, latin-1)
const MI2022 = {
  1: { resource: "8b4d68f6-4490-4afc-b632-6c259073a4b9", dataset: "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour" },
  2: { resource: "8986f174-d47e-46e5-a499-5d352d9422b3", dataset: "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour" },
};
async function mi2022(round) {
  const { resource, dataset } = MI2022[round];
  const text = await get(`https://www.data.gouv.fr/fr/datasets/r/${resource}`, { type: "latin1" });
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const h = head.split(";");
  const iIns = h.indexOf("Inscrits"), iVot = h.indexOf("Votants"), iExp = h.indexOf("Exprimés"), first = h.indexOf("Sexe");
  const map = {}; const keys = new Set();
  for (const l of lines) {
    const r = l.split(";");
    const votes = {};
    for (let k = first; k + 3 < r.length && r[k + 1]; k += 6) { votes[r[k + 1]] = Number(r[k + 3]); keys.add(r[k + 1]); }
    acc(map, deptCode(r[0]), r[1], +r[iIns], +r[iVot], +r[iExp], votes);
  }
  return { rows: map, keys: [...keys], surname: (k) => k, source: { name: "Ministère de l'Intérieur (via data.gouv.fr)", dataset, resource: `https://www.data.gouv.fr/fr/datasets/r/${resource}`, licence: "Licence Ouverte / Etalab (licence field not set on data.gouv.fr; Ministry open data)", unit: "département" } };
}

async function departments(e, round) {
  if (e.id === "1848") return cagePiketty1848();
  const y = Number(e.id);
  if (y >= 1965 && y <= 2012) return cdsp(y, round);
  if (y === 2017) return mi2017(round);
  if (y === 2022) return mi2022(round);
  return null;
}

/** Map department-file candidate keys to national candidate ids by surname. */
function attachDepartments(round, dep) {
  const byKey = {};
  for (const k of dep.keys) {
    const s = normName(dep.surname(k));
    const c = round.candidates.find((c) => !c.other && (normName(c.name).endsWith(` ${s}`) || normName(c.name) === s));
    if (c) byKey[k] = c.id;
    else console.warn(`  ! ${round.id}: department column "${k}" matches no candidate`);
  }
  const rows = {};
  const sum = { inscrits: 0, votants: 0, exprimes: 0 };
  for (const [code, d] of Object.entries(dep.rows).sort(([a], [b]) => a.localeCompare(b))) {
    const votes = {};
    for (const [k, n] of Object.entries(d.votes)) { const id = byKey[k] ?? `?${k}`; votes[id] = (votes[id] ?? 0) + n; }
    rows[code] = { name: d.name, inscrits: d.inscrits, votants: d.votants, exprimes: d.exprimes, votes };
    sum.inscrits += d.inscrits; sum.votants += d.votants; sum.exprimes += d.exprimes;
  }
  const nat = round.totals.exprimes;
  return { source: dep.source, count: Object.keys(rows).length, sumExprimes: sum.exprimes, nationalExprimes: nat ?? null, coveragePct: nat ? Math.round((1000 * sum.exprimes) / nat) / 10 : null, rows };
}

// ---------------------------------------------------------------------------------------------------------
// Media (curated JSON) + optional live verification
// ---------------------------------------------------------------------------------------------------------
async function verifyMedia(m) {
  try {
    const yt = m.url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
    if (yt) {
      const o = JSON.parse(await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${yt[1]}&format=json`, { wait: 300 }));
      return { ok: true, title: o.title, publisher: o.author_name };
    }
    const ark = m.url.match(/ark:\/12148\/([a-z0-9]+)/i);
    if (ark && /gallica/.test(m.url)) {
      // Gallica answers automated clients with a Cloudflare 403 / bot check: report "not checkable" instead of failing.
      const x = await get(`https://gallica.bnf.fr/services/OAIRecord?ark=ark:/12148/${ark[1]}`, { wait: 1000 })
        .catch((err) => (/^403 /.test(err.message) ? null : Promise.reject(err)));
      if (x == null) return { ok: null, note: "Gallica blocks automated clients (403); verified manually in a browser on verifiedAt" };
      return { ok: /<dc:title>/.test(x), title: x.match(/<dc:title>([^<]+)/)?.[1] ?? null, date: x.match(/<dc:date>([^<]+)/)?.[1] ?? null };
    }
    const html = await get(m.url, { wait: 500 });
    return { ok: true, title: html.match(/<title>([^<]+)/i)?.[1]?.trim() ?? null };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

// ---------------------------------------------------------------------------------------------------------
async function build(e, media, verify) {
  console.log(`↓ ${e.id} — ${e.page}`);
  const nat = await national(e);
  const rounds = [];
  const last = nat.rounds.at(-1).round;
  for (const r of nat.rounds) {
    const id = `${e.id}-t${r.round}`;
    const candidates = r.candidates.map((c) => {
      const other = /^(autres|divers)/i.test(c.label) && !c.party;
      const name = cleanName(c.label);
      const party = c.party?.replace(/\s*\[.*?\]/g, "").trim() || null;
      const family = other ? "divers" : (FAMILY[party] ?? null);
      if (!other && party && !family) console.warn(`  ! ${id}: no family for party "${party}" (${name})`);
      return { id: other ? "autres" : slug(name), name, party, family, side: family ? FAMILY_SIDE[family] : null, votes: c.votes, pct: c.pct, ...(other ? { other: true } : {}) };
    }).sort((a, b) => b.votes - a.votes);
    const t = r.totals;
    if (t.blancsNuls == null && t.blancs != null && t.nuls != null) t.blancsNuls = t.blancs + t.nuls;
    if (t.exprimes == null) t.exprimes = candidates.reduce((s, c) => s + c.votes, 0);
    // computed from the figures (the table's own % is a fallback: it occasionally carries typos)
    const turnoutPct = t.inscrits && t.votants ? Math.round((10000 * t.votants) / t.inscrits) / 100 : (t.participationPct ?? null);
    // internal consistency of the source table, reported rather than "fixed"
    const checks = [];
    const sumVotes = candidates.reduce((s, c) => s + c.votes, 0);
    if (t.exprimes != null && sumVotes !== t.exprimes) checks.push(`candidate votes sum to ${sumVotes}, table gives ${t.exprimes} valid votes (${t.exprimes - sumVotes} unattributed)`);
    if (t.votants != null && t.blancsNuls != null && t.exprimes != null && t.votants !== t.exprimes + t.blancsNuls) checks.push(`votants ${t.votants} ≠ exprimés + blancs/nuls ${t.exprimes + t.blancsNuls}`);
    if (t.inscrits != null && t.votants != null && t.abstention != null && t.inscrits !== t.votants + t.abstention) checks.push(`inscrits ${t.inscrits} ≠ votants + abstention ${t.votants + t.abstention}`);
    if (t.participationPct != null && turnoutPct != null && Math.abs(t.participationPct - turnoutPct) > 0.05) checks.push(`table participation ${t.participationPct}% ≠ computed ${turnoutPct}%`);
    // the leader of the final ballot is elected; in Fifth Republic first rounds the top two qualify
    const top = candidates.filter((c) => !c.other);
    const decisive = r.round === last;
    if (decisive) top[0].elected = true;
    else if (e.direct) top.slice(0, 2).forEach((c) => (c.qualified = true));
    const date = e.dates[r.round - 1] ?? null;
    if (!date) console.warn(`  ! ${id}: no date in catalogue`);
    const round = {
      id, round: r.round, date, ...(e.dateEnd && r.round === 1 ? { dateEnd: e.dateEnd } : {}), decisive,
      totals: { inscrits: t.inscrits ?? null, votants: t.votants ?? null, abstention: t.abstention ?? null, blancsNuls: t.blancsNuls ?? null,
        ...(t.blancs != null ? { blancs: t.blancs, nuls: t.nuls } : {}), exprimes: t.exprimes, ...(t.majorite ? { majorite: t.majorite } : {}) },
      turnoutPct, candidates, winner: decisive ? top[0].id : null, checks,
      sources: { national: { ...nat.source, note: "Figures as tabulated on the pinned Wikipedia revision; `cites` are the references given for that table." } },
      departments: null,
      media: null,
    };
    const dep = await departments(e, r.round).catch((err) => { console.warn(`  ! ${id}: departments failed: ${err.message}`); return null; });
    if (dep) { round.departments = attachDepartments(round, dep); round.sources.departments = dep.source; }
    const m = media[id];
    if (m) {
      round.media = m.media ?? null;
      if (m.alternatives?.length) round.mediaAlternatives = m.alternatives;
      if (!m.media && m.searched) round.mediaSearched = m.searched;
      if (m.leads?.length) round.mediaLeads = m.leads; // NOT verified content — never show as the round's media
      if (verify) for (const x of [m.media, ...(m.alternatives ?? [])].filter(Boolean)) {
        const v = await verifyMedia(x);
        x.check = { ...v, at: new Date().toISOString().slice(0, 10) };
        console.log(`  ${v.ok ? "✓" : v.ok === null ? "?" : "✗"} media ${id}: ${v.title ?? v.note ?? v.error}`);
      }
    }
    rounds.push(round);
  }
  const winner = rounds.at(-1).candidates.find((c) => c.elected);
  const doc = {
    id: e.id, year: Number(e.id.slice(0, 4)), title: { fr: e.page, en: `${e.id.length > 4 ? (e.id.endsWith("01") ? "January " : "September ") : ""}${e.id.slice(0, 4)} French presidential election` },
    regime: e.regime, method: e.method, direct: !!e.direct,
    winner: { id: winner.id, name: winner.name, party: winner.party, family: winner.family, side: winner.side },
    rounds,
    sources: { national: nat.source },
    generatedAt: new Date().toISOString(),
  };
  // media for multi-ballot Congress votes is attached to the last ballot; mirror the election-level pointer
  doc.media = rounds.findLast((r) => r.media)?.media ?? null;
  return doc;
}

function summary(doc) {
  return {
    id: doc.id, year: doc.year, title: doc.title, regime: doc.regime.id, method: doc.method, direct: doc.direct, winner: doc.winner,
    file: `${doc.id}.json`,
    rounds: doc.rounds.map((r) => ({
      id: r.id, round: r.round, date: r.date, decisive: r.decisive, turnoutPct: r.turnoutPct, exprimes: r.totals.exprimes,
      top: r.candidates.filter((c) => !c.other).slice(0, r.decisive && doc.direct ? 2 : 3).map((c) => ({ id: c.id, name: c.name, party: c.party, side: c.side, pct: c.pct, votes: c.votes })),
      departments: r.departments ? r.departments.count : 0,
      media: r.media ? { type: r.media.type, url: r.media.url } : null,
    })),
  };
}

const args = process.argv.slice(2);
const verify = args.includes("--verify-media");
const only = args.filter((a) => !a.startsWith("--"));
const media = existsSync(MEDIA) ? Object.fromEntries(JSON.parse(await readFile(MEDIA, "utf8")).map((m) => [m.round, m])) : {};
await mkdir(OUT, { recursive: true });
for (const e of ELECTIONS) {
  if (only.length && !only.includes(e.id)) continue;
  const doc = await build(e, media, verify);
  await writeFile(new URL(`${e.id}.json`, OUT), JSON.stringify(doc));
  const w = doc.winner;
  console.log(`✓ ${e.id}: ${doc.rounds.length} round(s), elected ${w.name} (${w.party ?? "?"}); departments: ${doc.rounds.map((r) => r.departments?.count ?? 0).join("/")}; media: ${doc.rounds.map((r) => r.media?.type ?? "–").join("/")}`);
}
// index from whatever per-election files exist (so a partial run keeps the index complete)
const index = [];
for (const e of ELECTIONS) {
  const f = new URL(`${e.id}.json`, OUT);
  if (existsSync(f)) index.push(summary(JSON.parse(await readFile(f, "utf8"))));
}
await writeFile(new URL("index.json", OUT), JSON.stringify({
  generatedAt: new Date().toISOString(),
  doc: "docs/data-presidential-history.md",
  colours: { left: "red/pink", right: "blue", centre: "neutral", other: "grey" },
  elections: index,
}, null, 1));
console.log(`✓ index: ${index.length} elections`);
