// Presidential opinion polls, parsed from Wikipedia's poll tables (via the MediaWiki API).
// Wikipedia content is CC BY-SA 4.0 — the site credits and links the source pages.
//
//   npm run sync:polls
//
// Output (public/data/polls/<year>.json):
//   { source, fetchedAt, firstRound: Poll[], secondRound: Duel[] }
//   Poll  = { pollster, start, end, sample, hyps: { [candidate]: pct }[] }   // one hyp per tested line-up
//   Duel  = { pollster, start, end, sample, a, b, pa, pb }

import { mkdir, writeFile } from "node:fs/promises";
import { parse } from "node-html-parser";

const PAGES = {
  2027: "Opinion_polling_for_the_2027_French_presidential_election",
  2022: "Opinion_polling_for_the_2022_French_presidential_election",
  "legislatives-2024": "Opinion_polling_for_the_2024_French_legislative_election",
};
const UA = { "User-Agent": "ProjectView/0.1 (open-data French election site; github.com/nicbay/projectview)" };
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
      const v = { el: cell, th: cell.tagName === "TH", text: clean(cell), origin: `${t}:${r}:${c}` };
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) ((out[r + i] ??= [])[c + j] = v);
      c += cs;
    }
  });
  return out;
}

function parseTable(table, { blocs = false } = {}) {
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
    rows.push({ key: `${row[iFirm].origin}|${row[iDate].origin}`, pollster: firm.replace(/\[.*?\]/g, "").replace(/\s*Archived .*$/i, "").trim(), start: dates[0], end: dates[1], sample: num((row[iSample]?.text ?? "").replace(/,/g, "")) ?? null, values });
  }
  return rows;
}

async function syncYear(year) {
  const page = PAGES[year];
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2`;
  console.log(`↓ ${page}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const root = parse((await res.json()).parse.text);

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
    const rows = parseTable(el, { blocs: String(year).startsWith("legislatives") });
    if (!rows) continue;
    for (const r of rows) {
      if (h2 === "first round") {
        // rows sharing the same (rowspan-merged) firm + date cells are line-ups of one poll
        const p = firstRound.get(r.key) ?? { pollster: r.pollster, start: r.start, end: r.end, sample: r.sample, hyps: [] };
        p.hyps.push(r.values);
        firstRound.set(r.key, p);
      } else {
        const [a, b] = Object.keys(r.values);
        if (a && b && Object.keys(r.values).length === 2) secondRound.push({ pollster: r.pollster, start: r.start, end: r.end, sample: r.sample, a, b, pa: r.values[a], pb: r.values[b] });
      }
    }
  }
  const fr = [...firstRound.values()].sort((x, y) => y.end.localeCompare(x.end));
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
for (const y of years) await syncYear(y);
