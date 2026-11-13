// Helpers for reading Wikipedia opinion-poll tables (fetched through the MediaWiki API).
// Copied from scripts/sync-polls.mjs (date parsing, rowspan/colspan grid, cell cleaning) and
// generalised so other scripts can reuse them: the grid keeps every header row, and
// pollTable() returns each data row's figures per column instead of per candidate.
// Wikipedia content is CC BY-SA 4.0.

import { parse } from "node-html-parser";

export const UA = { "User-Agent": "ThirdEstate/0.1 (open-data French election site; github.com/nicbay/ThirdEstate)" };

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Parsed HTML of a Wikipedia page via action=parse. Retries when the API rate-limits (it answers in plain text). */
export async function fetchWikiPage(title, lang = "en", { tries = 5 } = {}) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text|revid&redirects=1&format=json&formatversion=2`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: UA });
    const txt = await res.text();
    if (res.ok && txt.startsWith("{")) {
      const j = JSON.parse(txt);
      if (j.error) throw new Error(`${title}: ${j.error.info}`);
      return {
        title: j.parse.title,
        revid: j.parse.revid,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(j.parse.title.replace(/ /g, "_"))}`,
        root: parse(j.parse.text),
      };
    }
    await sleep(5000 * (i + 1));
  }
  throw new Error(`${title}: Wikipedia API kept refusing (rate limit)`);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "21–22 Oct 2026", "28 Oct–3 Nov 2026", "30 Dec 2025–2 Jan 2026", "8 Apr 2022" → [start, end] ISO dates */
export function parseDates(s) {
  const parts = s.replace(/\[.*?\]/g, "").split(/\s*[–—-]\s*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const read = (p) => {
    const m = p.match(/^(\d{1,2})?\s*([A-Za-z]{3,})?\.?\s*(\d{4})?$/);
    return m ? { d: m[1] ? Number(m[1]) : null, m: m[2] ? MONTHS[m[2].slice(0, 3).toLowerCase()] ?? null : null, y: m[3] ? Number(m[3]) : null } : null;
  };
  const end = read(parts.at(-1));
  if (!end || end.y == null || end.m == null) return null;
  const st = read(parts[0]) ?? end;
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d ?? 1)).toISOString().slice(0, 10);
  const sm = st.m ?? end.m;
  const sy = st.y ?? (sm > end.m ? end.y - 1 : end.y);
  return [iso(sy, sm, st.d ?? end.d), iso(end.y, end.m, end.d)];
}

/** "12.5%", "12,5", "<0.5%" → number ("<x" reads as x, as in sync-polls.mjs); else null */
export const num = (s) => {
  const m = s.replace(/\[.*?\]/g, "").replace(",", ".").trim().match(/^<?\s*(\d+(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
};
/** First figure in a cell, for result rows such as "25.66% (26.16%)" or "4.80% (Libertas)". */
export const leadNum = (s) => {
  const m = s.replace(/\[.*?\]/g, "").replace(",", ".").match(/^\s*(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : num(s);
};
/** Sample sizes: "1,000" / "10 425" → number */
export const sampleNum = (s) => {
  const m = (s ?? "").replace(/\[.*?\]/g, "").replace(/[,\s  ]/g, "").match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
};

export const clean = (c) => {
  c.querySelectorAll("style, sup.reference").forEach((x) => x.remove());
  return c.text.replace(/\s+/g, " ").trim();
};

/** Expand rowspan/colspan into a rectangular grid of cells. Each cell: { el, th, text, origin, ext, note, span }. */
let tableSeq = 0;
export function grid(table) {
  const t = tableSeq++; // cell origins must be unique across tables, not just within one
  const out = [];
  table.querySelectorAll("tr").forEach((tr, r) => {
    out[r] ??= [];
    let c = 0;
    for (const cell of tr.querySelectorAll("th, td")) {
      while (out[r][c]) c++;
      const rs = Number(cell.getAttribute("rowspan") ?? 1) || 1;
      const cs = Number(cell.getAttribute("colspan") ?? 1) || 1;
      // the poll's own source: a direct external link in the cell, or its footnote (read before clean() drops the footnote marks)
      const ext = cell.querySelector("a.external")?.getAttribute("href") ?? null;
      const note = cell.querySelector("sup.reference a")?.getAttribute("href") ?? null;
      const v = { el: cell, th: cell.tagName === "TH", text: clean(cell), origin: `${t}:${r}:${c}`, ext, note, cols: [] };
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) ((out[r + i] ??= [])[c + j] = v);
      for (let j = 0; j < cs; j++) v.cols.push(c + j);
      c += cs;
    }
  });
  return out;
}

/** Footnote href ("#cite_note-…") → first https external link of that reference. */
export function footnoteResolver(root) {
  return (href) => {
    if (!href?.startsWith("#")) return null;
    const u = root.getElementById(decodeURIComponent(href.slice(1)))?.querySelector("a.external")?.getAttribute("href");
    return u && /^https:\/\//.test(u) ? u : null;
  };
}

/** Walk a page's headings and wikitables in order: yields { table, path: [h2, h3, h4…] }. */
export function* tablesWithHeadings(root) {
  const path = [];
  for (const el of root.querySelectorAll("div.mw-heading, table.wikitable")) {
    if (el.classList.contains("mw-heading")) {
      const h = el.querySelector("h2, h3, h4, h5, h6");
      if (!h) continue;
      const lvl = Number(h.tagName[1]) - 2;
      path.length = lvl;
      path[lvl] = h.text.trim();
      continue;
    }
    yield { table: el, path: [...path] };
  }
}

const SKIP_COL = /^(abs\.?|abstention|turnout|lead|others?|undecided|sample size|polling firm|fieldwork date|date)$/i;

/**
 * Generic poll table: header rows (label path per column) and data rows.
 * Returns { columns: [{ c, path: [top…leaf], title }], rows: [{ firm, firmCell, dates, sample, url, isResult, cells: [{ cols, text }] }] }.
 * `isResult` marks the actual-result row Wikipedia puts at the top ("2022 election", "Ministry of the Interior").
 */
export function pollTable(table, { resolve = () => null } = {}) {
  const g = grid(table);
  const firstData = g.findIndex((row) => row?.some((c) => c && !c.th));
  if (firstData < 0) return null;
  const header = g.slice(0, firstData);
  const width = Math.max(...g.map((r) => r?.length ?? 0));
  const col = (re) => header[0]?.findIndex((c) => c && re.test(c.text));
  const iFirm = col(/^polling firm/i), iDate = col(/^(fieldwork|date)/i), iSample = col(/^sample/i);
  if (iFirm < 0 || iDate < 0) return null;
  const columns = [];
  for (let c = 0; c < width; c++) {
    if ([iFirm, iDate, iSample].includes(c)) continue;
    const path = [];
    let title = null;
    for (const row of header) {
      const cell = row[c];
      if (!cell) continue;
      const tx = cell.text.replace(/\[.*?\]/g, "").trim();
      if (tx && path.at(-1) !== tx) path.push(tx);
      const a = cell.el.querySelector("a[title]");
      if (a && !/^(Help|Wikipedia|Template):/.test(a.getAttribute("title"))) title = a.getAttribute("title");
    }
    if (!path.length && !title) continue;
    if (path.length && SKIP_COL.test(path[0])) continue;
    columns.push({ c, path, title });
  }
  const colSet = new Set(columns.map((x) => x.c));
  const rows = [];
  for (const row of g.slice(firstData)) {
    if (!row) continue;
    const firmCell = row[iFirm];
    const firm = (firmCell?.text ?? "").replace(/\[.*?\]/g, "").replace(/\s*Archived .*$/i, "").replace(/[*†]+$/, "").trim();
    if (!firm) continue;
    const dates = parseDates(row[iDate]?.text ?? "");
    if (!dates) continue;
    const isResult = /election|result|ministry|interior/i.test(firm);
    const seen = new Set();
    const cells = [];
    for (const c of colSet) {
      const cell = row[c];
      if (!cell || cell.th || seen.has(cell.origin)) continue;
      seen.add(cell.origin);
      if ([iFirm, iDate, iSample].includes(c)) continue;
      cells.push({ cols: cell.cols.filter((x) => colSet.has(x)), text: cell.text });
    }
    const url = firmCell.ext ?? resolve(firmCell.note) ?? resolve(row[iDate]?.note) ?? null;
    rows.push({ firm, firmCell, dateCell: row[iDate], dates, sample: iSample >= 0 ? sampleNum(row[iSample]?.text) : null, url, isResult, cells });
  }
  return { columns, rows };
}

/** One name per polling firm (same rule as pollsterName() in src/lib/polls.ts, plus the historical lineages). */
export const FIRMS = ["Ipsos", "OpinionWay", "Ifop", "Harris Interactive", "Elabe", "BVA", "Odoxa", "Kantar", "Verian", "YouGov", "Cluster17", "AtlasIntel", "Redfield & Wilton", "Toluna", "Viavoice", "CSA", "Sofres", "TNS", "LH2", "Louis Harris"];
/** Merges beyond polls.ts: firms that were renamed. Key = pollsterName() output, value = canonical name. */
export const LINEAGE = {
  Sofres: "Verian", TNS: "Verian", Kantar: "Verian", // Sofres → TNS Sofres → Kantar Sofres / Kantar Public → Verian (2023)
  Toluna: "Harris Interactive", // "Toluna Harris Interactive"
  "Louis Harris": "LH2", // Louis Harris France, renamed LH2 in 2005 (not related to Harris Interactive)
};
export const flat = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
export function pollsterName(raw) {
  const f = flat(raw);
  const base = FIRMS.find((n) => f === flat(n) || f.startsWith(`${flat(n)} `)) ?? raw.trim();
  return LINEAGE[base] ?? base;
}
