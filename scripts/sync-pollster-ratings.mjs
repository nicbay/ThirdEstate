// Pollster ratings: how close each French polling firm's final polls came to the actual results.
//
//   npm run sync:pollster-ratings            (fetches Wikipedia, ~15 pages, throttled)
//
// Inputs
//   - Poll tables: English Wikipedia "Opinion polling for the … election" pages, via the MediaWiki API
//     (CC BY-SA 4.0); parsing helpers in scripts/lib/wiki-polls.mjs.
//   - Results: the site's own files where they exist (public/data/history/presidential/<year>.json);
//     otherwise the official-result row Wikipedia prints at the top of the poll table
//     ("2009 election", "Ministry of the Interior"), or the results table of the election article.
//     Legislative results are cross-checked against public/data/history/legislative/<year>.json.
// Outputs
//   - public/data/polls/history/<election-id>.json   every parsed poll + the result
//   - public/data/polls/pollsters.json                grades (shape documented in docs/data-pollsters.md)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchWikiPage, footnoteResolver, flat, leadNum, num, pollTable, pollsterName, tablesWithHeadings, grid } from "./lib/wiki-polls.mjs";

const DATA = new URL("../public/data/", import.meta.url);
const OUT_HIST = new URL("polls/history/", DATA);
const readJson = async (rel) => JSON.parse(await readFile(new URL(rel, DATA), "utf8"));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const DAY = 86400000;
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ---------------------------------------------------------------- method parameters
const WINDOW_DAYS = 14; // final poll = latest poll whose fieldwork ends in the 14 days before the vote
const MIN_SHARE = 2; // candidates / lists under 2% of the actual vote are left out of the error
const TYPE_WEIGHT = (e) => (e.type === "presidential" && e.round === 1 ? 1 : 0.6);
const RECENCY = 0.85; // per 5-year election cycle back from the latest election rated
const SHRINK_K = 2; // score × n / (n + 2)
const GRADES = [
  // score = shrunk weighted mean of (firm's error − field's average error), in points; negative = better than the field
  { grade: "A+", min: null, max: -0.3, weight: 1.0 },
  { grade: "A", min: -0.3, max: -0.2, weight: 0.95 },
  { grade: "A-", min: -0.2, max: -0.12, weight: 0.9 },
  { grade: "B+", min: -0.12, max: -0.05, weight: 0.85 },
  { grade: "B", min: -0.05, max: 0.05, weight: 0.8 },
  { grade: "B-", min: 0.05, max: 0.12, weight: 0.75 },
  { grade: "C+", min: 0.12, max: 0.2, weight: 0.65 },
  { grade: "C", min: 0.2, max: 0.3, weight: 0.6 },
  { grade: "C-", min: 0.3, max: 0.45, weight: 0.55 },
  { grade: "D", min: 0.45, max: 0.65, weight: 0.4 },
  { grade: "F", min: 0.65, max: null, weight: 0.2 },
];
const gradeIdx = (g) => GRADES.findIndex((x) => x.grade === g);

// ---------------------------------------------------------------- elections
const PRES_PAGE = (y) => `Opinion_polling_for_the_${y}_French_presidential_election`;
const EURO_PAGE = (y) => `Opinion_polling_for_the_${y}_European_Parliament_election_in_France`;
const LEG_PAGE = (y) => `Opinion_polling_for_the_${y}_French_legislative_election`;
const SUB = /by (department|region|constituency|first round vote)|seat|projection|configuration/i;

const ELECTIONS = [];
for (const y of [2002, 2007, 2012, 2017, 2022]) {
  ELECTIONS.push({ id: `pres-${y}-r1`, type: "presidential", round: 1, year: y, page: PRES_PAGE(y), pick: (p) => p[0] === "First round" && !p.some((h) => SUB.test(h)) });
  ELECTIONS.push({ id: `pres-${y}-r2`, type: "presidential", round: 2, year: y, page: PRES_PAGE(y), pick: (p) => p[0] === "Second round" && !p.some((h) => SUB.test(h)) });
}
for (const [y, date] of [[2009, "2009-06-07"], [2014, "2014-05-25"], [2019, "2019-05-26"]]) {
  ELECTIONS.push({ id: `euro-${y}`, type: "european", round: 1, year: y, date, page: EURO_PAGE(y), pick: (p) => p[0] === "Voting intentions" && !p.some((h) => SUB.test(h)) });
}
// 2024: no separate polling article; the poll table sits in the election article, results in its "Results" table
ELECTIONS.push({
  id: "euro-2024", type: "european", round: 1, year: 2024, date: "2024-06-09", page: "2024_European_Parliament_election_in_France",
  pick: (p) => p[0] === "Opinion polling" && !p.some((h) => SUB.test(h)),
  // results-table party name → poll-table column label (lists ≥ 2% only; checked against the table at run time)
  resultMap: [[/^National Rally/, "RN"], [/^Renaissance/, "Ens."], [/^Socialist Party/, "PS–PP"], [/^La France Insoumise/, "LFI"], [/^The Republicans/, "LR"], [/^The Ecologists/, "EELV"], [/^Reconquête/, "REC"], [/^French Communist/, "PCF"], [/^Rural Alliance/, "AR"], [/^Animalist/, "PA"]],
});
for (const y of [2017, 2022, 2024]) {
  ELECTIONS.push({ id: `leg-${y}-r1`, type: "legislative", round: 1, year: y, page: LEG_PAGE(y), pick: (p) => p.includes("First round") && !p.some((h) => SUB.test(h)) });
}

const LABEL = {
  presidential: { fr: (e) => `Présidentielle ${e.year}, ${e.round === 1 ? "1er" : "2d"} tour`, en: (e) => `${e.year} presidential, ${e.round === 1 ? "first" : "second"} round` },
  european: { fr: (e) => `Européennes ${e.year}`, en: (e) => `${e.year} European election` },
  legislative: { fr: (e) => `Législatives ${e.year}, 1er tour`, en: (e) => `${e.year} legislative, first round` },
};

// ---------------------------------------------------------------- helpers
const EP_GROUP = /\s+(NI|Left|S&D|G\/EFA|Renew|EPP|ECR|ID|NI–ECR)$/;
const tidy = (s) => s.replace(/\[.*?\]/g, "").replace(/\s+/g, " ").replace(EP_GROUP, "").trim();
const FAR_RIGHT_LABEL = /^(FN|RN|REC|RN and allies|REC EXD)$/;

/** Union-find over column indexes. */
function unionFind() {
  const p = new Map();
  const find = (x) => { if (!p.has(x)) p.set(x, x); while (p.get(x) !== x) x = p.get(x); return x; };
  const union = (a, b) => p.set(find(a), find(b));
  return { find, union };
}

/** Surname matching of a poll-table column to a presidential candidate from the site's result file. */
function matchCandidate(col, cands) {
  if (col.title) {
    const hit = cands.find((c) => flat(c.name) === flat(col.title));
    if (hit) return hit;
  }
  const text = ` ${flat([col.title ?? "", ...col.path].join(" "))} `;
  const hits = cands.filter((c) => {
    const sur = c.name.split(" ").slice(1).filter((w) => !/^(de|d')$/i.test(w)).join(" ");
    return text.includes(` ${flat(sur)} `);
  });
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------- per election
const pageCache = new Map();
async function page(title) {
  if (!pageCache.has(title)) {
    if (pageCache.size) await sleep(3000); // be gentle with the API
    pageCache.set(title, await fetchWikiPage(title));
  }
  return pageCache.get(title);
}

const skipped = [];
const warnings = [];

async function loadElection(e) {
  const pg = await page(e.page);
  const resolve = footnoteResolver(pg.root);
  let result = null; // { unitKey(label) → pct } built below
  let resultSource = null;
  let cands = null; // presidential candidates of this round

  if (e.type === "presidential") {
    const f = await readJson(`history/presidential/${e.year}.json`);
    const round = f.rounds.find((r) => r.round === e.round);
    e.date = round.date;
    cands = round.candidates;
    resultSource = f.sources?.national?.page ?? null;
    e.resultFile = `public/data/history/presidential/${e.year}.json`;
  }
  if (e.type === "legislative") {
    const f = await readJson(`history/legislative/${e.year}.json`);
    e.date = f.dates.t1;
    e.siteNational = f.national.t1;
  }

  // collect the poll tables of the section
  const tables = [];
  for (const { table, path } of tablesWithHeadings(pg.root)) {
    if (!e.pick(path)) continue;
    const t = pollTable(table, { resolve });
    if (!t || !t.rows.length) continue;
    if (e.type === "presidential" && e.round === 2) {
      // only the table of the actual run-off pairing
      const fin = cands.map((c) => flat(c.name.split(" ").slice(1).join(" ")));
      if (!fin.every((s) => ` ${flat(path.join(" "))} `.includes(` ${s} `))) continue;
    }
    tables.push({ t, path });
  }
  if (!tables.length) return skip(e, `no poll table found under the expected heading on ${pg.url}`);

  // ------------------------------------------------------------ columns → keys
  // Column identity is per table; the key used for comparison is the candidate (presidential) or the label.
  const allPolls = [];
  let resultRow = null;
  for (const [ti, { t }] of tables.entries()) {
    const keyOf = new Map(); // column index → key
    const farRight = new Map();
    for (const col of t.columns) {
      if (cands) {
        const c = matchCandidate(col, cands);
        if (c) { keyOf.set(col.c, c.name); farRight.set(col.c, ["FN", "RN", "REC"].includes(c.party)); }
      } else {
        const top = tidy(col.path[0] ?? col.title ?? "");
        const leaf = tidy(col.path.at(-1) ?? top);
        keyOf.set(col.c, col.path.length > 1 && t.columns.filter((x) => tidy(x.path[0] ?? "") === top).length > 1 ? `${top} / ${leaf}` : top);
        farRight.set(col.c, FAR_RIGHT_LABEL.test(top) || (col.path.length > 1 && /^(RN|FN|REC)$/.test(leaf)));
      }
    }
    for (const row of t.rows) {
      const cells = row.cells
        .map((c) => ({ ...c, cols: c.cols.filter((x) => keyOf.has(x)) }))
        .filter((c) => c.cols.length);
      const rec = { table: ti, keyOf, farRight, row, cells };
      if (row.isResult) {
        if (row.dates[1] === e.date && !resultRow) resultRow = rec;
        continue;
      }
      allPolls.push(rec);
    }
  }

  // ------------------------------------------------------------ final polls (one per firm)
  const t0 = Date.parse(e.date);
  const inWindow = allPolls.filter((p) => {
    const end = Date.parse(p.row.dates[1]);
    return end < t0 && end >= t0 - WINDOW_DAYS * DAY;
  });
  // a poll split over several rows (one per tested line-up, firm/date cells rowspanned) → keep its first row
  const finals = new Map();
  for (const p of inWindow.sort((a, b) => b.row.dates[1].localeCompare(a.row.dates[1]))) {
    const firm = pollsterName(p.row.firm);
    if (!finals.has(firm)) finals.set(firm, p);
  }

  // ------------------------------------------------------------ result
  if (e.type === "presidential") {
    result = Object.fromEntries(cands.map((c) => [c.name, c.pct]));
    if (resultRow) {
      // cross-check the site's file against Wikipedia's result row
      for (const c of resultRow.cells) {
        if (c.cols.length !== 1) continue;
        const k = resultRow.keyOf.get(c.cols[0]);
        const v = leadNum(c.text);
        if (k && v != null && Math.abs(v - result[k]) > 0.05) warnings.push(`${e.id}: ${k} site ${result[k]} vs Wikipedia ${v}`);
      }
    }
  } else if (e.resultMap) {
    // results table of the election article
    const rt = [...tablesWithHeadings(pg.root)].find(({ path, table }) => path[0] === "Results" && /Party/.test(table.text) && /Votes/.test(table.text) && /National Rally/.test(table.text));
    if (!rt) return skip(e, "results table not found");
    const g = grid(rt.table);
    const hdr = g.find((r) => r?.some((c) => c?.th && c.text === "%"));
    const iPct = hdr?.findIndex((c) => c?.th && c.text === "%") ?? -1;
    if (iPct < 0) return skip(e, "results table has no % column");
    result = {};
    for (const [re, label] of e.resultMap) {
      const row = g.find((r) => r?.some((c) => c && !c.th && re.test(c.text)));
      const pct = row ? num(row[iPct]?.text ?? "") : null;
      if (pct == null) { warnings.push(`${e.id}: result for ${label} not found`); continue; }
      result[label] = pct;
    }
    resultSource = `${pg.url}#Results`;
  } else {
    if (!resultRow) return skip(e, `no official-result row dated ${e.date} in the poll table`);
    resultSource = `${pg.url} (official-result row "${resultRow.row.firm}" of the poll table)`;
  }

  // ------------------------------------------------------------ comparison units
  // Pollsters sometimes report several lists/blocs as one figure (a cell spanning several columns),
  // and the result row may do the same. Columns linked by any such cell — in any final poll or in the
  // result — are merged into one unit, so every firm in an election is scored on the same units.
  const uf = unionFind();
  const colKey = (rec, c) => `${rec.table}:${c}`;
  const keyToCols = new Map(); // presidential: candidate → col ids; others: label → col ids
  for (const rec of [...finals.values(), ...(resultRow ? [resultRow] : [])]) {
    for (const [c, k] of rec.keyOf) {
      // the same key in different tables (or the same table) is the same unit
      uf.union(colKey(rec, c), `key:${k}`);
      (keyToCols.get(k) ?? keyToCols.set(k, new Set()).get(k)).add(colKey(rec, c));
    }
    for (const cell of rec.cells) {
      if (num(cell.text) == null && leadNum(cell.text) == null) continue;
      for (const c of cell.cols.slice(1)) uf.union(colKey(rec, cell.cols[0]), colKey(rec, c));
    }
  }
  // result labels → poll keys ("AR" covers "AR / FNC NI" and "AR / R! NI"); merge them into one unit
  const keysFor = (label) => [...keyToCols.keys()].filter((k) => k === label || k.split(" / ")[0] === label);
  if (e.resultMap) {
    for (const label of Object.keys(result)) {
      const ks = keysFor(label);
      if (!ks.length) warnings.push(`${e.id}: result label ${label} has no poll column`);
      for (const k of ks.slice(1)) uf.union(`key:${ks[0]}`, `key:${k}`);
    }
  }
  const unitOf = (k) => uf.find(`key:${k}`);
  const unitKeys = new Map(); // unit id → [keys]
  for (const k of keyToCols.keys()) (unitKeys.get(unitOf(k)) ?? unitKeys.set(unitOf(k), []).get(unitOf(k))).push(k);
  const unitLabel = (u) => {
    const ks = unitKeys.get(u);
    const tops = [...new Set(ks.map((k) => k.split(" / ")[0]))];
    return tops.length === 1 ? tops[0] : tops.join(" + ");
  };

  /** A row's figure per unit: sum of its numeric cells in the unit; missing when no numeric cell. */
  const unitValues = (rec, reader = num) => {
    const out = new Map();
    for (const cell of rec.cells) {
      const v = reader(cell.text);
      if (v == null) continue;
      const u = uf.find(colKey(rec, cell.cols[0]));
      out.set(u, (out.get(u) ?? 0) + v);
    }
    return out;
  };

  let resUnits;
  if (e.type === "presidential" || e.resultMap) {
    resUnits = new Map();
    for (const [k, v] of Object.entries(result)) {
      const ks = keysFor(k);
      if (!ks.length) continue; // candidate never polled in the final window
      const u = unitOf(ks[0]);
      resUnits.set(u, (resUnits.get(u) ?? 0) + v);
    }
  } else {
    resUnits = unitValues(resultRow, leadNum);
    result = Object.fromEntries([...resUnits].map(([u, v]) => [unitLabel(u), r2(v)]));
  }
  const farRightUnit = (u) => {
    const ks = unitKeys.get(u);
    if (cands) return ks.every((k) => ["FN", "RN", "REC"].includes(cands.find((c) => c.name === k)?.party));
    return ks.every((k) => FAR_RIGHT_LABEL.test(k.split(" / ")[0]) || /\/ (RN|FN|REC)$/.test(k));
  };

  // ------------------------------------------------------------ errors
  const scored = [];
  for (const [firm, rec] of finals) {
    const vals = unitValues(rec);
    const total = [...vals.values()].reduce((a, b) => a + b, 0);
    if (total < 80 || total > 110) { warnings.push(`${e.id}: ${firm} final poll dropped (figures add up to ${total})`); continue; }
    const errs = [];
    let fr = 0, frRes = 0, frN = 0;
    for (const [u, res] of resUnits) {
      const v = vals.get(u);
      if (v == null) continue;
      if (res >= MIN_SHARE) errs.push(Math.abs(v - res));
      if (farRightUnit(u)) { fr += v; frRes += res; frN++; }
    }
    if (errs.length < 2) { warnings.push(`${e.id}: ${firm} final poll has <2 comparable units`); continue; }
    scored.push({
      firm, raw: rec.row.firm, mae: errs.reduce((a, b) => a + b, 0) / errs.length, units: errs.length,
      bias: frN ? fr - frRes : null, end: rec.row.dates[1], url: rec.row.url ?? null,
      windowPolls: inWindow.filter((p) => pollsterName(p.row.firm) === firm).length,
    });
  }
  if (scored.length < 2) return skip(e, `only ${scored.length} scorable final poll(s)`);
  const avg = scored.reduce((a, s) => a + s.mae, 0) / scored.length;
  for (const s of scored) s.rel = s.mae - avg;

  // ------------------------------------------------------------ history file
  // Every parsed poll; figures keyed by candidate (presidential) or by the table's column label
  // (one cell spanning several columns → "A + B").
  const polls = allPolls.map((rec) => {
    const values = {};
    for (const cell of rec.cells) {
      const v = num(cell.text);
      if (v == null) continue;
      const k = [...new Set(cell.cols.map((c) => rec.keyOf.get(c)))].join(" + ");
      values[k] = v;
    }
    return { pollster: pollsterName(rec.row.firm), start: rec.row.dates[0], end: rec.row.dates[1], sample: rec.row.sample, url: rec.row.url ?? null, values, _raw: rec.row.firm };
  }).filter((p) => Object.keys(p.values).length >= 2);
  const aliases = polls.map((p) => [p.pollster, p._raw]);
  for (const p of polls) delete p._raw;

  const hist = {
    id: e.id,
    source: pg.url,
    resultSource: e.resultFile ? `${resultSource} (via ${e.resultFile})` : resultSource,
    result: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, r2(v)])),
    polls,
  };
  await writeFile(new URL(`${e.id}.json`, OUT_HIST), JSON.stringify(hist, null, 1));

  // legislative: cross-check the far-right figure against the site's own result file
  if (e.siteNational) {
    const n = e.siteNational;
    const fn = (n.nuances.RN ?? n.nuances.FN ?? 0) / n.exprimes * 100;
    const k = Object.keys(result).find((x) => /^(RN|FN)$/.test(x) || /\/ (RN|FN)$/.test(x));
    if (k && Math.abs(result[k] - fn) > 0.1) warnings.push(`${e.id}: ${k} result ${result[k]} vs site file ${fn.toFixed(2)}`);
  }

  return {
    e, source: pg.url, resultSource: hist.resultSource, scored, avg, aliases, nPolls: polls.length,
  };
}

function skip(e, why) {
  skipped.push({ id: e.id, why });
  console.warn(`✗ ${e.id}: ${why}`);
  return null;
}

// ---------------------------------------------------------------- methodology (sourced; see docs/data-pollsters.md)
const NOTICE = (n) => `https://www.commission-des-sondages.fr/notices/medias/fichiers/add/${n}`;
const ONLINE = { fr: "Questionnaire auto-administré en ligne (panel)", en: "Self-administered online questionnaire (panel)" };
const METHODOLOGY = {
  Ifop: {
    mode: ONLINE, sample: "≈1 500",
    notes: { fr: "Quotas (sexe, âge, profession) après stratification par région et catégorie d'agglomération ; redressement sociodémographique et sur les votes passés (présidentielle 2022, européennes et législatives 2024). Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation) after stratification by region and town size; weighted on demographics and past vote (2022 presidential, 2024 European and legislative). Files notices with the Commission des sondages." },
    url: NOTICE(2376),
  },
  Ipsos: {
    mode: { fr: "En ligne, Access panel Ipsos (auto-administré)", en: "Online, Ipsos access panel (self-administered)" }, sample: "≈1 500 ; ≈10 000–13 000 pour l'Enquête électorale (Le Monde)",
    notes: { fr: "Quotas (sexe, âge, profession, région, catégorie d'agglomération) ; redressement sur ces variables et le souvenir de vote (européennes 2024, présidentielle 2022). Opère sous le nom « Ipsos bva » depuis le rachat de BVA (2025). Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, region, town size); weighted on those and recalled vote (2024 European, 2022 presidential). Trades as \"Ipsos bva\" since buying BVA (2025). Files notices with the Commission des sondages." },
    url: NOTICE(2275),
  },
  OpinionWay: {
    mode: { fr: "Questionnaire auto-administré en ligne (CAWI)", en: "Self-administered online questionnaire (CAWI)" }, sample: "≈1 000",
    notes: { fr: "Quotas (sexe, âge, CSP, catégorie d'agglomération, région) ; redressement sociodémographique et sur les votes de 2022 (présidentielle) et 2024 (législatives). Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, town size, region); weighted on demographics and 2022 presidential / 2024 legislative vote. Files notices with the Commission des sondages." },
    url: NOTICE(2352),
  },
  "Harris Interactive": {
    mode: { fr: "En ligne, panel propriétaire Toluna Harris Interactive", en: "Online, Toluna Harris Interactive proprietary panel" }, sample: "≈1 700–2 100",
    notes: { fr: "Quotas et redressement : sexe, âge, CSP, région, comportement électoral passé. Notices déposées à la Commission des sondages.", en: "Quotas and weighting on sex, age, occupation, region and past voting behaviour. Files notices with the Commission des sondages." },
    url: NOTICE(2381),
  },
  Elabe: {
    mode: { fr: "En ligne", en: "Online" }, sample: "≈1 500–1 700",
    notes: { fr: "Quotas (sexe, âge, CSP, région, catégorie d'agglomération) ; redressement également sur le statut d'occupation du logement et les votes de 2022 et 2024. Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, region, town size); also weighted on housing tenure and 2022/2024 vote. Files notices with the Commission des sondages." },
    url: NOTICE(2339),
  },
  Odoxa: {
    mode: { fr: "Par internet (selon Public Sénat ; la notice ne le précise pas)", en: "Online (per Public Sénat; the notice does not say)" }, sample: "≈1 000 ; 12 005 pour une vague régionale (2026)",
    notes: { fr: "Quotas (sexe, âge, profession, département, catégorie d'agglomération) ; redressement sur les quotas et le vote à la présidentielle 2022. Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, département, town size); weighted on quotas and 2022 presidential vote. Files notices with the Commission des sondages." },
    url: NOTICE(2325),
  },
  Cluster17: {
    mode: { fr: "Questionnaire auto-administré en ligne (panel propriétaire depuis 2023)", en: "Self-administered online questionnaire (own panel since 2023)" }, sample: "≈1 200",
    notes: { fr: "Quotas (sexe, âge, CSP, taille de commune, région) ; redressement sociodémographique et politique (présidentielle 2022, européennes 2024), pondération par la probabilité de vote. Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, town size, region); weighted on demographics and past vote (2022 presidential, 2024 European) and by likelihood to vote. Files notices with the Commission des sondages." },
    url: NOTICE(2387),
  },
  YouGov: {
    mode: { fr: "En ligne, panel propriétaire YouGov", en: "Online, YouGov proprietary panel" }, sample: "≈1 000",
    notes: { fr: "Quotas (genre, âge, région, CSP, vote à la présidentielle 2022). Notices déposées à la Commission des sondages.", en: "Quotas on gender, age, region, occupation and 2022 presidential vote. Files notices with the Commission des sondages." },
    url: NOTICE(2384),
  },
  Verian: {
    mode: { fr: "En ligne, sur panel", en: "Online panel" }, sample: "≈1 000",
    notes: { fr: "Quotas (sexe, âge, profession, région) ; redressement sociodémographique et politique (présidentielle 2022, européennes 2024). Anciennement Sofres / TNS Sofres / Kantar Public. Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, region); weighted on demographics and past vote (2022 presidential, 2024 European). Formerly Sofres / TNS Sofres / Kantar Public. Files notices with the Commission des sondages." },
    url: NOTICE(2230),
  },
  CSA: {
    mode: { fr: "Par internet, panel en ligne CSA", en: "Online, CSA online panel" }, sample: "≈1 000",
    notes: { fr: "Quotas (sexe, âge, profession) après stratification par région et catégorie d'agglomération ; redressement sur le vote à la présidentielle 2022. Taille d'échantillon relevée sur un sondage politique (pas d'intentions de vote). Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation) after stratification by region and town size; weighted on 2022 presidential vote. Sample size taken from a political (not voting-intention) poll. Files notices with the Commission des sondages." },
    url: NOTICE(2374),
  },
  Viavoice: {
    mode: { fr: "Interviews en ligne", en: "Online interviews" }, sample: "≈2 000 (européennes 2024)",
    notes: { fr: "Quotas (sexe, âge, profession, région, catégorie d'agglomération) ; redressement sociodémographique et sur les comportements électoraux passés. Notices déposées à la Commission des sondages.", en: "Quotas (sex, age, occupation, region, town size); weighted on demographics and past voting behaviour. Files notices with the Commission des sondages." },
    url: "https://commission-des-sondages.fr/notices/medias/fichiers/add/1770",
  },
};

// ---------------------------------------------------------------- run
await mkdir(OUT_HIST, { recursive: true });
const done = [];
for (const e of ELECTIONS) {
  try {
    const r = await loadElection(e);
    if (r) {
      done.push(r);
      console.log(`✓ ${e.id}: ${r.nPolls} polls, ${r.scored.length} firms scored (avg error ${r.avg.toFixed(2)})`);
    }
  } catch (err) {
    skip(e, String(err.message ?? err));
  }
}

const latestYear = Math.max(...done.map((d) => d.e.year));
const firms = new Map();
const aliasSets = new Map();
for (const d of done) {
  for (const [name, raw] of d.aliases) if (raw !== name) (aliasSets.get(name) ?? aliasSets.set(name, new Set()).get(name)).add(raw.replace(/\s+/g, " "));
  const w = TYPE_WEIGHT(d.e) * RECENCY ** ((latestYear - d.e.year) / 5);
  for (const s of d.scored) {
    const f = firms.get(s.firm) ?? firms.set(s.firm, { name: s.firm, rows: [] }).get(s.firm);
    f.rows.push({ ...s, w, e: d.e });
  }
}

function gradeFor(score, rows) {
  let i = GRADES.findIndex((g) => (g.min == null || score >= g.min) && (g.max == null || score < g.max));
  const n = rows.length;
  const better = rows.filter((r) => r.rel < 0).length / n;
  const worse = rows.filter((r) => r.rel > 0).length / n;
  // A+ needs a consistent record: ≥ 4 elections, better than the field in ≥ 75% of them
  if (i === gradeIdx("A+") && !(n >= 4 && better >= 0.75)) i = gradeIdx("A");
  // F needs a repeated record: ≥ 3 elections, worse than the field in ≥ 75% of them
  if (i === gradeIdx("F") && !(n >= 3 && worse >= 0.75)) i = gradeIdx("D");
  // a single election can't make a firm better than B+ or worse than C-
  if (n === 1) i = Math.min(Math.max(i, gradeIdx("B+")), gradeIdx("C-"));
  return GRADES[i];
}

const ids2027 = new Set();
try {
  const p27 = await readJson("polls/2027.json");
  for (const p of [...p27.firstRound, ...p27.secondRound]) {
    const n = pollsterName(p.pollster);
    ids2027.add(n);
    if (n !== p.pollster) (aliasSets.get(n) ?? aliasSets.set(n, new Set()).get(n)).add(p.pollster);
  }
} catch { /* no 2027 file: rate historical firms only */ }

const out = [];
for (const f of firms.values()) {
  const rows = f.rows.sort((a, b) => b.e.date.localeCompare(a.e.date));
  const n = rows.length;
  const wsum = rows.reduce((a, r) => a + r.w, 0);
  const raw = rows.reduce((a, r) => a + r.w * r.rel, 0) / wsum;
  const score = raw * (n / (n + SHRINK_K));
  const g = gradeFor(score, rows);
  const biasRows = rows.filter((r) => r.bias != null);
  out.push({
    name: f.name,
    aliases: [...(aliasSets.get(f.name) ?? [])].sort(),
    grade: g.grade,
    weight: g.weight,
    score: r2(score),
    mae: r2(rows.reduce((a, r) => a + r.mae, 0) / n),
    elections: n,
    polls: rows.reduce((a, r) => a + r.windowPolls, 0),
    biasFarRight: biasRows.length ? r2(biasRows.reduce((a, r) => a + r.bias, 0) / biasRows.length) : null,
    history: rows.map((r) => ({ election: r.e.id, mae: r2(r.mae), rel: r2(r.rel), end: r.end, url: r.url })),
    methodology: METHODOLOGY[f.name] ?? null,
  });
}
out.sort((a, b) => a.score - b.score || b.elections - a.elections);
for (const name of [...ids2027].sort()) {
  if (out.some((p) => p.name === name)) continue;
  out.push({ name, aliases: [...(aliasSets.get(name) ?? [])].sort(), grade: null, weight: null, score: null, mae: null, elections: 0, polls: 0, biasFarRight: null, history: [], methodology: METHODOLOGY[name] ?? null });
}

const METHOD = {
  fr: `Pour chaque élection et chaque institut, on retient son dernier sondage dont le terrain s'achève dans les ${WINDOW_DAYS} jours précédant le scrutin. Erreur = écart absolu moyen (en points) entre ce sondage et le résultat, sur les candidats ou listes ayant obtenu au moins ${MIN_SHARE} % (législatives : partis et blocs tels que tabulés ; quand un institut ou le résultat regroupe plusieurs listes en un seul chiffre, ces listes sont regroupées pour tous les instituts de cette élection). Score relatif = cette erreur moins l'erreur moyenne de tous les instituts sur la même élection, pour qu'un scrutin difficile ne pénalise pas tout le monde. Note globale = moyenne pondérée des scores relatifs (1er tour de présidentielle : poids 1 ; autres scrutins : 0,6 ; ×${RECENCY} par cycle de cinq ans en arrière), multipliée par n/(n+${SHRINK_K}) (n = nombre d'élections notées) pour ramener vers 0 les instituts peu observés. Score négatif = plus précis que la moyenne. A+ exige au moins 4 élections dont 75 % meilleures que la moyenne ; F au moins 3 élections dont 75 % moins bonnes ; un institut noté sur une seule élection reste entre B+ et C-. Le biais « extrême droite » (sondage − résultat pour RN/FN et Reconquête réunis) est donné à titre d'information et n'entre pas dans la note. Sources : tableaux de sondages de Wikipédia (en anglais), résultats officiels.`,
  en: `For each election and firm we take its latest poll with fieldwork ending in the ${WINDOW_DAYS} days before the vote. Error = mean absolute difference (in points) between that poll and the result, over candidates or lists that won at least ${MIN_SHARE}% (legislative: parties and blocs as tabulated; when a firm or the result reports several lists as one figure, those lists are merged for every firm in that election). Relative score = that error minus the average error of all firms in the same election, so a hard election doesn't punish everyone. Overall score = weighted mean of relative scores (presidential first rounds weight 1, other elections 0.6, ×${RECENCY} per five-year cycle back), multiplied by n/(n+${SHRINK_K}) (n = elections rated) to pull thinly-observed firms toward 0. Negative = more accurate than the field. A+ needs at least 4 elections, 75% of them better than the field; F at least 3 elections, 75% of them worse; a firm rated on one election stays between B+ and C-. The far-right bias (poll − result for RN/FN and Reconquête combined) is shown for information only and does not enter the grade. Sources: Wikipedia (English) poll tables, official results.`,
};

const outFile = {
  updated: new Date().toISOString().slice(0, 10),
  method: METHOD,
  grades: GRADES,
  elections: done.map((d) => ({
    id: d.e.id, type: d.e.type, round: d.e.round, date: d.e.date,
    label: { fr: LABEL[d.e.type].fr(d.e), en: LABEL[d.e.type].en(d.e) },
    source: d.source, resultSource: d.resultSource, pollsters: d.scored.length, avgError: r2(d.avg),
  })).sort((a, b) => b.date.localeCompare(a.date) || a.round - b.round),
  pollsters: out,
};
await writeFile(new URL("polls/pollsters.json", DATA), JSON.stringify(outFile, null, 1));

for (const w of warnings) console.warn(`! ${w}`);
for (const s of skipped) console.warn(`skipped ${s.id}: ${s.why}`);
console.log(`\n${"firm".padEnd(20)} grade  score   mae  n  polls  biasFR`);
for (const p of out) console.log(`${p.name.padEnd(20)} ${(p.grade ?? "—").padEnd(5)} ${String(p.score ?? "").padStart(6)} ${String(p.mae ?? "").padStart(5)} ${String(p.elections).padStart(2)} ${String(p.polls).padStart(6)} ${String(p.biasFarRight ?? "").padStart(6)}`);
