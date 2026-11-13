// Presidential sponsorships ("parrainages"): to stand, a candidate needs 500 sponsorships from elected officials,
// from at least 30 departments or overseas collectivities, with no more than a tenth from any one of them
// (loi n° 62-1292 du 6 novembre 1962, art. 3). During the collection window the Conseil constitutionnel publishes
// the sponsorships it has validated, twice a week or more, as open data. This script aggregates the list per
// candidate (total, by department, by mandate, by publication date) and checks the spread rule.
//
//   node scripts/sync-parrainages.mjs                     # 2027: discover the official file, or write status "not-open"
//   node scripts/sync-parrainages.mjs --reference         # also rebuild the 2022 reference (done automatically if missing)
//   node scripts/sync-parrainages.mjs --source <url|file> --out <file>   # parse any list (testing a new format)
//   PARRAINAGES_URL=<url> node scripts/sync-parrainages.mjs              # force the 2027 source once it is announced
//
// Sources (see docs/data-parrainages.md):
//   2022 — https://presidentielle2022.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv
//          (same file on data.gouv.fr, dataset "Parrainages des candidats à l'élection présidentielle française de 2022")
//   2027 — no URL announced yet (2026-11-13). Discovery, in order: PARRAINAGES_URL; a 2027 "Parrainages" dataset
//          of the Conseil constitutionnel organisation on data.gouv.fr (API); the 2022 site pattern transposed to
//          presidentielle2027.conseil-constitutionnel.fr (unconfirmed guess, tried quietly).
//
// Output: public/data/2027/parrainages.json and public/data/2027/parrainages-2022.json. Exit 0 when nothing is
// published yet; exit 1 (previous file kept) when a file is found but cannot be parsed, so a format change is loud.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseCsv } from "./lib/csv.mjs";
import { UA } from "./lib/http-cache.mjs";

const OUT_DIR = new URL("../public/data/2027/", import.meta.url);
const OUT = new URL("parrainages.json", OUT_DIR);
const OUT_2022 = new URL("parrainages-2022.json", OUT_DIR);

const CC_ORG = "540f9a01a3a72928898af4a3"; // Conseil constitutionnel on data.gouv.fr
const SRC_2022 = {
  url: "https://presidentielle2022.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv",
  fallback: "https://static.data.gouv.fr/resources/parrainages-des-candidats-a-lelection-presidentielle-francaise-de-2022/20220307-183308/parrainagestotal.csv",
  dataset: "https://www.data.gouv.fr/datasets/parrainages-des-candidats-a-lelection-presidentielle-francaise-de-2022",
};
const GUESS_2027 = "https://presidentielle2027.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv";

const RULES = { threshold: 500, minDepartments: 30, maxShare: 0.1 };

// What is known of the 2027 calendar (checked 2026-11-13; docs/data-parrainages.md lists the sources).
const WINDOW_2027 = {
  firstRound: "2027-04-18",
  secondRound: "2027-05-02",
  roundsDecided: "2026-07-01", // Conseil des ministres
  opens: null, // the day after the decree convening the voters is published (not published yet)
  opensExpected: { fr: "fin janvier ou début février 2027, le lendemain de la publication du décret de convocation des électeurs", en: "late January or early February 2027, the day after the decree convening the voters is published" },
  deadline: "2027-03-12T18:00:00+01:00", // sixth Friday before the first round, 18:00 (loi de 1962, art. 3)
  listBy: "2027-03-26", // the list of candidates is published at the latest on the fourth Friday before the first round
};
const WINDOW_2022 = { opened: "2022-01-27", deadline: "2022-03-04T18:00:00+01:00", list: "2022-03-07", firstRound: "2022-04-10" };

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

// ---------------------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------------------
async function get(url, { quiet = false, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { text: Buffer.from(await res.arrayBuffer()).toString("utf8"), type: res.headers.get("content-type") ?? "", lastModified: res.headers.get("last-modified") };
    } catch (e) {
      // DNS failure (the 2027 site does not exist yet) is an expected "not there"
      const code = e?.cause?.code;
      if (code === "ENOTFOUND" || (code === "EAI_AGAIN" && i >= tries)) { if (!quiet) console.log(`  ${url}: host not found`); return null; }
      if (i >= tries) { if (!quiet) console.warn(`  ${url}: ${e.message}`); return null; }
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

async function readSource(src) {
  if (/^https?:/.test(src)) return get(src);
  return { text: await readFile(src, "utf8"), type: src.endsWith(".json") ? "application/json" : "text/csv", lastModified: null };
}

/** The newest CSV/JSON resource of a 2027 "Parrainages" dataset of the Conseil constitutionnel on data.gouv.fr. */
async function findOnDataGouv(year) {
  const r = await get(`https://www.data.gouv.fr/api/1/datasets/?organization=${CC_ORG}&page_size=50&sort=-created`);
  if (!r) return null;
  let j;
  try { j = JSON.parse(r.text); } catch { return null; }
  const ds = (j.data ?? []).find((d) => /parrainage/i.test(d.title) && new RegExp(String(year)).test(d.title));
  if (!ds) return null;
  const res = (ds.resources ?? [])
    .filter((x) => /^(csv|json)$/i.test(x.format ?? "") || /\.(csv|json)(\?|$)/i.test(x.url ?? ""))
    .sort((a, b) => String(b.last_modified ?? b.created_at).localeCompare(String(a.last_modified ?? a.created_at)) || (/csv/i.test(a.format) ? -1 : 1));
  if (!res.length) return null;
  return { url: res[0].url, dataset: ds.page, title: res[0].title, lastModified: res[0].last_modified ?? null };
}

// ---------------------------------------------------------------------------------------------------------
// Parsing: header-driven, so a renamed or reordered column (CSV or JSON) still parses.
// ---------------------------------------------------------------------------------------------------------
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const COLS = {
  candidate: ["candidat", "candidate", "nomcandidat"],
  department: ["departement", "department", "departementcollectivite"],
  mandate: ["mandat", "mandate", "qualite"],
  date: ["datedepublication", "datepublication", "date", "publication"],
  civ: ["civilite"],
};
const pick = (keys, wanted) => keys.find((k) => wanted.includes(norm(k)));

export function parseList(text, type = "") {
  let rows;
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (/json/.test(type) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let j = JSON.parse(trimmed);
    if (!Array.isArray(j)) j = j.data ?? j.parrainages ?? Object.values(j).find(Array.isArray) ?? [];
    rows = j;
  } else {
    const first = trimmed.split(/\r?\n/, 1)[0];
    const sep = (first.match(/;/g) ?? []).length >= (first.match(/,/g) ?? []).length ? ";" : ",";
    const [header, ...body] = parseCsv(trimmed, sep);
    rows = body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }
  if (!rows.length) throw new Error("empty list");
  const keys = Object.keys(rows[0]);
  const k = Object.fromEntries(Object.entries(COLS).map(([name, w]) => [name, pick(keys, w)]));
  for (const need of ["candidate", "department", "mandate"]) if (!k[need]) throw new Error(`no "${need}" column in [${keys.join(", ")}]`);
  return rows.map((r) => ({
    candidate: String(r[k.candidate]).replace(/\s+/g, " ").trim(),
    department: String(r[k.department]).replace(/\s+/g, " ").trim(),
    mandate: String(r[k.mandate]).replace(/\s+/g, " ").trim(),
    date: k.date ? isoDate(r[k.date]) : null,
  })).filter((r) => r.candidate);
}

/** "01/02/2022" | "2022-02-01T00:00:00" → "2022-02-01" */
function isoDate(s) {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Mandates as published, grouped (the feminine and masculine forms of each office are one group).
const MANDATES = [
  ["maire", /^maire$/i],
  ["maire-delegue", /^maire d[ée]l[ée]gu[ée]e?/i],
  ["maire-arrondissement", /^maire d'arrondissement/i],
  ["conseiller-departemental", /^conseill(er|[èe]re) d[ée]partementale?/i],
  ["conseiller-regional", /^conseill(er|[èe]re) r[ée]gionale?/i],
  ["conseiller-paris", /^conseill(er|[èe]re) de paris/i],
  ["conseiller-metropole-lyon", /m[ée]tropolitaine? de lyon/i],
  ["assemblee-corse", /assembl[ée]e de corse/i],
  ["outre-mer", /outre-mer|polyn[ée]sie|nouvelle-cal[ée]donie|martinique|guyane|mayotte|saint-pierre|wallis/i],
  ["depute", /^d[ée]put[ée]e?$/i],
  ["senateur", /^s[ée]nat(eur|rice)$/i],
  ["depute-europeen", /parlement europ[ée]en/i],
  ["president-epci", /epci|m[ée]tropole/i],
  ["afe", /assembl[ée]e des fran[çc]ais de l'[ée]tranger/i],
  ["conseil-consulaire", /conseil consulaire/i],
];
const unmapped = new Map();
function mandateKey(label) {
  for (const [key, re] of MANDATES) if (re.test(label)) return key;
  unmapped.set(label, (unmapped.get(label) ?? 0) + 1);
  return "autre";
}

/** "LE PEN Marine" → "Marine Le Pen"; the surname is the leading run of upper-case words, as the Conseil writes it. */
export function displayName(published) {
  const parts = published.split(" ");
  const isUpper = (w) => w === w.toLocaleUpperCase("fr") && w !== w.toLocaleLowerCase("fr");
  let i = 0;
  while (i < parts.length && isUpper(parts[i])) i++;
  if (i === 0 || i === parts.length) return published;
  const cap = (w, first) => {
    const lw = w.toLocaleLowerCase("fr");
    if (!first && /^(de|du|des|d'|la)$/.test(lw)) return lw;
    return lw.replace(/(^|[-'’])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("fr"));
  };
  const surname = parts.slice(0, i).map((w, k) => cap(w, k === 0)).join(" ");
  return `${parts.slice(i).join(" ")} ${surname}`;
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")));

export function aggregate(rows) {
  const by = new Map();
  for (const r of rows) {
    let c = by.get(r.candidate);
    if (!c) by.set(r.candidate, (c = { rows: [] }));
    c.rows.push(r);
  }
  const publications = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const candidates = [...by].map(([name, { rows: rs }]) => {
    const total = rs.length;
    const byDepartment = {}, byMandate = {}, perDate = {};
    for (const r of rs) {
      byDepartment[r.department] = (byDepartment[r.department] ?? 0) + 1;
      const m = mandateKey(r.mandate);
      byMandate[m] = (byMandate[m] ?? 0) + 1;
      if (r.date) perDate[r.date] = (perDate[r.date] ?? 0) + 1;
    }
    const deps = sortObj(byDepartment);
    const [topName, topCount] = Object.entries(deps)[0];
    // cumulative count after each publication (only the publications that added something)
    let run = 0, reached500On = null;
    const byDate = Object.keys(perDate).sort().map((d) => {
      run += perDate[d];
      if (!reached500On && run >= RULES.threshold) reached500On = d;
      return [d, run];
    });
    const departments = Object.keys(deps).length;
    // The spread rule is checked on what is published: the Conseil checks it on the valid sponsorships it
    // retains (it draws 500 at random only to publish them in the Journal officiel), so this is an indication.
    const share = topCount / total;
    return {
      name,
      displayName: displayName(name),
      total,
      departments,
      topDepartment: { name: topName, count: topCount, share: Math.round(share * 1e4) / 1e4 },
      rule: { reached500: total >= RULES.threshold, departments30: departments >= RULES.minDepartments, share10: share <= RULES.maxShare },
      qualifiedOnPublishedData: total >= RULES.threshold && departments >= RULES.minDepartments && share <= RULES.maxShare,
      reached500On,
      byDate,
      byMandate: sortObj(byMandate),
      byDepartment: deps,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fr"));
  return { publications, candidates };
}

function build(rows, extra) {
  const { publications, candidates } = aggregate(rows);
  return {
    ...extra,
    updatedAt: publications.at(-1) ?? extra.updatedAt ?? null,
    rules: RULES,
    totals: {
      sponsorships: rows.length,
      candidates: candidates.length,
      reached500: candidates.filter((c) => c.rule.reached500).length,
      qualifiedOnPublishedData: candidates.filter((c) => c.qualifiedOnPublishedData).length,
    },
    publications,
    candidates,
  };
}

const writeJson = async (url, data) => {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(url, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${url.pathname.split("/public/")[1] ?? url.pathname} (${data.candidates?.length ?? 0} candidates)`);
};

function logUnmapped() {
  if (unmapped.size) console.warn(`mandates not grouped (counted as "autre"): ${[...unmapped].map(([l, n]) => `${l} ×${n}`).join("; ")}`);
  unmapped.clear();
}

// ---------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------
async function reference2022() {
  console.log("2022 reference");
  let used = SRC_2022.url;
  let r = await get(SRC_2022.url);
  if (!r) { used = SRC_2022.fallback; r = await get(SRC_2022.fallback); }
  if (!r) throw new Error("2022 list unavailable");
  const rows = parseList(r.text, r.type);
  const data = build(rows, {
    year: 2022,
    status: "final",
    fetchedAt: new Date().toISOString(),
    source: { name: "Conseil constitutionnel", url: used, dataset: SRC_2022.dataset, licence: "Other (Public Domain), as listed on data.gouv.fr" },
    window: WINDOW_2022,
  });
  logUnmapped();
  // sanity checks against the known final figures (13,427 sponsorships; 12 candidates on the ballot)
  if (data.totals.sponsorships < 13000 || data.totals.qualifiedOnPublishedData !== 12) console.warn(`unexpected 2022 totals: ${JSON.stringify(data.totals)}`);
  await writeJson(OUT_2022, data);
}

async function current2027() {
  console.log("2027");
  const tried = [];
  let found = null;
  const forced = process.env.PARRAINAGES_URL;
  if (forced) {
    const r = await get(forced);
    tried.push({ url: forced, found: !!r });
    if (r) found = { url: forced, r };
  }
  if (!found) {
    const dg = await findOnDataGouv(2027);
    tried.push({ url: `https://www.data.gouv.fr/api/1/datasets/?organization=${CC_ORG}`, found: !!dg });
    if (dg) {
      const r = await get(dg.url);
      if (r) found = { url: dg.url, dataset: dg.dataset, r: { ...r, lastModified: r.lastModified ?? dg.lastModified } };
    }
  }
  if (!found) {
    const r = await get(GUESS_2027, { quiet: true, tries: 1 });
    tried.push({ url: GUESS_2027, found: !!r });
    // only trust the guess if it really is the list (a parked domain could answer with an HTML page)
    if (r && !/html/i.test(r.type)) found = { url: GUESS_2027, r };
  }

  if (!found) {
    console.log("no 2027 list published yet: status not-open");
    return writeJson(OUT, {
      year: 2027,
      status: "not-open",
      fetchedAt: new Date().toISOString(),
      updatedAt: null,
      source: { name: "Conseil constitutionnel", url: null, checked: tried.map((t) => t.url) },
      window: WINDOW_2027,
      rules: RULES,
      reference: "/data/2027/parrainages-2022.json",
      candidates: [],
    });
  }

  let rows;
  try {
    rows = parseList(found.r.text, found.r.type);
  } catch (e) {
    console.error(`2027 list found at ${found.url} but could not be parsed: ${e.message}. Previous file kept.`);
    process.exit(1);
  }
  const data = build(rows, {
    year: 2027,
    status: "open",
    fetchedAt: new Date().toISOString(),
    source: { name: "Conseil constitutionnel", url: found.url, dataset: found.dataset ?? null, lastModified: found.r.lastModified ?? null },
    window: WINDOW_2027,
  });
  logUnmapped();
  await writeJson(OUT, data);
}

if (opt("--source")) {
  // test mode: parse any file or URL into --out (default: stdout summary only)
  const r = await readSource(opt("--source"));
  if (!r) throw new Error("source not found");
  const rows = parseList(r.text, r.type);
  const data = build(rows, { year: Number(opt("--year") ?? 2027), status: "open", fetchedAt: new Date().toISOString(), source: { name: "Conseil constitutionnel", url: opt("--source") }, window: WINDOW_2027 });
  logUnmapped();
  if (opt("--out")) await writeFile(opt("--out"), JSON.stringify(data, null, 1) + "\n");
  console.log(JSON.stringify(data.totals), data.candidates.slice(0, 12).map((c) => `${c.displayName} ${c.total}`).join(", "));
} else {
  if (flag("--reference") || !existsSync(OUT_2022)) await reference2022();
  await current2027();
}
