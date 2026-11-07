// Municipal election results per commune: 2026 (15 & 22 March 2026) and 2020 (15 March & 28 June 2020).
//
//   node scripts/sync-municipal.mjs              download (cached in .cache/municipal/) and write every department file
//   node scripts/sync-municipal.mjs --refresh    ignore the download cache
//   node scripts/sync-municipal.mjs --dept=31,75 write only these department files (index/families are still written)
//
// Output (schema, sources, method and limits: docs/data-municipal.md):
//   public/data/municipal/<department>.json   results per commune (2026 both rounds + 2020 for comparison)
//   public/data/municipal/index.json          one compact row per commune (winner nuance/family 2026 and 2020)
//   public/data/municipal/families.json       nuance → political family table, colours, sources
//
// Sources: Ministry of the Interior result files on data.gouv.fr (Licence Ouverte v2.0 for 2026). Nothing is invented:
// head-of-list names for the 2026 first round come from the official candidatures file, joined on commune + panel number.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseCsv, csvObjects } from "./lib/csv.mjs";
import { makeCache } from "./lib/http-cache.mjs";
import { makeCogResolver } from "./lib/district-geo.mjs";
import { FAMILIES, NUANCES, familyOf } from "./lib/municipal-nuances.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/municipal/", ROOT);
const CACHE = new URL(".cache/municipal/raw/", ROOT);
const argv = process.argv.slice(2);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const C = makeCache(CACHE, { refresh: argv.includes("--refresh") });
const DEPTS = opt("dept")?.split(",").filter(Boolean) ?? null;
const TODAY = new Date().toISOString().slice(0, 10);
const SCHEMA_VERSION = 1;
const NEVER = null; // official result files are final: never expire the cache (use --refresh)

const LO = { name: "Licence Ouverte / Open Licence v2.0 (Etalab)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" };
const S = "https://static.data.gouv.fr/resources/";
const FILES = {
  m26t1: { url: S + "elections-municipales-2026-resultats-du-premier-tour/20260320-164339/municipales-2026-resultats-communes-2026-03-20.csv", file: "m26-t1-communes.csv" },
  m26t2: { url: S + "elections-municipales-2026-resultats-du-scond-tour/20260323-180124/municipales-2026-resultats-communes-2026-03-23-16h14.csv", file: "m26-t2-communes.csv" },
  m26c1: { url: S + "elections-municipales-2026-listes-candidates-au-premier-tour/20260313-152615/municipales-2026-candidatures-france-entiere-tour-1-2026-03-13.csv", file: "m26-t1-candidatures.csv" },
  m20t1: { url: S + "elections-municipales-2020-resultats/20200525-133704/2020-05-18-resultats-communes-de-1000-et-plus.txt", file: "m20-t1-1000p.txt" },
  m20t1s: { url: S + "elections-municipales-2020-resultats/20200525-133805/2020-05-18-resultats-communes-de-moins-de-1000.txt", file: "m20-t1-moins1000.txt" },
  m20t2: { url: S + "municipales-2020-resultats-2nd-tour/20200629-192435/2020-06-29-resultats-t2-communes-de-1000-hab-et-plus.txt", file: "m20-t2-1000p.txt" },
  m20t2s: { url: S + "municipales-2020-resultats-2nd-tour/20200629-192436/2020-06-29-resultats-t2-communes-de-moins-de-1000-hab.txt", file: "m20-t2-moins1000.txt" },
};
const SOURCES = [
  { id: "mi-2026-t1", name: "Elections municipales 2026 - Résultats du premier tour (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69b82a7de5d58cc06ad35ce0", file: FILES.m26t1.url, licence: LO.name, licenceUrl: LO.url, date: "2026-03-20" },
  { id: "mi-2026-t2", name: "Elections municipales 2026 - Résultats du second tour (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69c17fed9f18c7781fd11a14", file: FILES.m26t2.url, licence: LO.name, licenceUrl: LO.url, date: "2026-03-23" },
  { id: "mi-2026-cand-t1", name: "Elections municipales 2026 - Listes candidates au premier tour (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69a24d41280ad1aa5193e487", file: FILES.m26c1.url, licence: LO.name, licenceUrl: LO.url, date: "2026-03-13", use: "head of list and list size for the first round" },
  { id: "mi-2020-t1", name: "Elections municipales 2020 - résultats 1er tour (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/5e7102d5ebe5d838b7581662", file: [FILES.m20t1.url, FILES.m20t1s.url], licence: "Not specified on data.gouv.fr (public-sector information, reusable under the CRPA)", date: "2020-05-18" },
  { id: "mi-2020-t2", name: "Municipales 2020 - Résultats 2nd tour (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/5efa23afd85990251fc9a197", file: [FILES.m20t2.url, FILES.m20t2s.url], licence: "Not specified on data.gouv.fr (public-sector information, reusable under the CRPA)", date: "2020-06-29" },
  { id: "insee-cog-2026", name: "Code officiel géographique 2026 (INSEE)", url: "https://www.insee.fr/fr/information/8740222", licence: LO.name, licenceUrl: LO.url, use: "map 2020 commune codes to 2026 communes (mergers)" },
  { id: "geo-api", name: "API Découpage administratif (geo.api.gouv.fr)", url: "https://geo.api.gouv.fr/decoupage-administratif/communes", licence: LO.name, licenceUrl: LO.url, use: "municipal population (latest legal population)" },
];
const DATES = { 2026: ["2026-03-15", "2026-03-22"], 2020: ["2020-03-15", "2020-06-28"] };

// ---------- helpers ----------
const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace("%", "").replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const int = (s) => {
  const n = num(s);
  return n == null ? null : Math.round(n);
};
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const pct = (a, b) => (a == null || !b ? null : r2((100 * a) / b));
const person = (first, last) => [first, last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || null;
const decode1252 = (buf) => new TextDecoder("windows-1252").decode(buf);
const fileOf = async (k) => C.cached(FILES[k].file, FILES[k].url, { maxAgeH: NEVER });

// 2020 department codes → INSEE: overseas used letter codes ("ZA" = Guadeloupe…) and 3-digit commune numbers
const OVERSEAS_2020 = { ZA: "97", ZB: "97", ZC: "97", ZD: "97", ZM: "97", ZS: "97", ZN: "98", ZP: "98", ZW: "98", ZX: "97" };
const code2020 = (dep, com) => {
  if (OVERSEAS_2020[dep]) return OVERSEAS_2020[dep] + com.padStart(3, "0");
  return dep.padStart(2, "0") + com.padStart(3, "0");
};

// ---------- reference data ----------
async function reference() {
  const base = "https://www.insee.fr/fr/statistiques/fichier/8740222/";
  const cog = makeCogResolver(
    csvObjects(await C.cachedText("v_commune_2026.csv", base + "v_commune_2026.csv", { maxAgeH: NEVER })),
    csvObjects(await C.cachedText("v_mvt_commune_2026.csv", base + "v_mvt_commune_2026.csv", { maxAgeH: NEVER })),
  );
  const geo = await C.cachedJson("geoapi-communes.json", "https://geo.api.gouv.fr/communes?fields=code,nom,population,codeDepartement&format=json", { maxAgeH: 24 * 30 });
  const pop = new Map(geo.map((g) => [g.code, g.population ?? null]));
  return { cog, pop };
}

// ---------- 2026 ----------
// Results files: 18 commune columns, then blocks of 13 columns per list (panel, last name, first name, sex, nuance,
// short label, label, votes, % registered, % expressed, elected, seats CM, seats CC).
function turnout(x) {
  const registered = int(x[4]), voters = int(x[5]), expressed = int(x[9]);
  return {
    registered,
    voters,
    turnoutPct: num(x[6]) ?? pct(voters, registered),
    abstentions: int(x[7]),
    expressed,
    blank: int(x[12]),
    null: int(x[15]),
  };
}

async function heads2026() {
  // commune|panel → { name, sex, candidates }
  const heads = new Map();
  const rl = createInterface({ input: createReadStream(await fileOf("m26c1")), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    const c = parseCsv(line, ";")[0];
    if (!c) continue;
    if (!header) { header = c; continue; }
    const key = `${c[2]}|${c[4]}`;
    let h = heads.get(key);
    if (!h) heads.set(key, (h = { name: null, sex: null, candidates: 0 }));
    h.candidates++;
    if (c[9] === "OUI") Object.assign(h, { name: person(c[13], c[12]), sex: c[11] || null });
  }
  return heads;
}

async function read2026(heads) {
  const communes = new Map(); // code → { dept, deptName, name, rounds: [] }
  for (const [round, key] of [[1, "m26t1"], [2, "m26t2"]]) {
    const rows = parseCsv(await readFile(await fileOf(key), "utf8"), ";");
    for (const x of rows.slice(1)) {
      const code = x[2];
      if (!code) continue;
      let c = communes.get(code);
      if (!c) communes.set(code, (c = { dept: x[0], deptName: x[1], name: x[3], rounds: [] }));
      const lists = [];
      for (let b = 18; b + 12 < x.length; b += 13) {
        if (!x[b] && !x[b + 6]) continue;
        const h = round === 1 ? heads.get(`${code}|${x[b]}`) : null;
        const nuance = x[b + 4] || null;
        lists.push({
          panel: int(x[b]),
          label: x[b + 6] || x[b + 5] || null,
          ...(x[b + 5] && x[b + 5] !== x[b + 6] ? { shortLabel: x[b + 5] } : {}),
          head: round === 1 ? (h?.name ? { name: h.name, sex: h.sex } : null) : person(x[b + 2], x[b + 1]) ? { name: person(x[b + 2], x[b + 1]), sex: x[b + 3] || null } : null,
          ...(h ? { candidates: h.candidates } : {}),
          nuance,
          family: familyOf(nuance),
          votes: int(x[b + 7]),
          pctExpressed: num(x[b + 9]),
          pctRegistered: num(x[b + 8]),
          seats: int(x[b + 11]) ?? 0,
          seatsCommunity: int(x[b + 12]),
        });
      }
      lists.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
      c.rounds.push({ round, date: DATES[2026][round - 1], ...turnout(x), lists });
    }
  }
  return communes;
}

// ---------- 2020 ----------
// Files: 18 commune columns, then blocks of 12 per list/candidate (panel, nuance, sex, last name, first name, list
// label, seats/"Oui" elected, sector seats, community seats, votes, % registered, % expressed).
async function read2020(cog, codes2026) {
  const out = new Map(); // code2020 → { code, name, sectors?: Map, rounds|... }
  const parseFile = async (key, round, small) => {
    const text = decode1252(await readFile(await fileOf(key)));
    const sep = text.slice(0, 200).includes("\t") ? "\t" : ";";
    const rows = parseCsv(text, sep);
    for (const x of rows.slice(1)) {
      if (!x[2]) continue;
      const m = /^(\d+)(SR\d+)?$/.exec(x[2].trim());
      if (!m) continue;
      const code = code2020(x[0].trim(), m[1]);
      const sector = m[2] ?? null;
      let c = out.get(code);
      if (!c) out.set(code, (c = { code, name: sector ? null : x[3], system: small ? "individual" : "list", rounds: [], sectors: null }));
      const registered = int(x[4]), voters = int(x[7]);
      const r = {
        round,
        date: DATES[2020][round - 1],
        registered,
        voters,
        turnoutPct: num(x[8]) ?? pct(voters, registered),
        abstentions: int(x[5]),
        expressed: int(x[15]),
        blank: int(x[9]),
        null: int(x[12]),
      };
      const items = [];
      for (let b = 18; b + 11 < x.length + 1; b += 12) {
        if (!x[b] && !x[b + 3]) continue;
        const nuance = (x[b + 1] || "").trim() || null;
        if (small) {
          // individual candidates: [name, sex, nuance, votes, % expressed, elected 0/1]
          items.push([person(x[b + 4], x[b + 3]), x[b + 2] || null, nuance, int(x[b + 9]), num(x[b + 11]), /^oui$/i.test(x[b + 6]) ? 1 : 0]);
        } else {
          items.push({
            panel: int(x[b]),
            label: x[b + 5] || null,
            head: person(x[b + 4], x[b + 3]) ? { name: person(x[b + 4], x[b + 3]), sex: x[b + 2] || null } : null,
            nuance: NUANCES[nuance] ? nuance : nuance, // kept verbatim
            family: familyOf(nuance),
            votes: int(x[b + 9]),
            pctExpressed: num(x[b + 11]),
            pctRegistered: num(x[b + 10]),
            seats: int(x[b + 6]) ?? 0,
            ...(sector ? { seatsSector: int(x[b + 7]) } : {}),
            seatsCommunity: int(x[b + 8]),
          });
        }
      }
      if (small) {
        items.sort((a, b) => (b[3] ?? 0) - (a[3] ?? 0));
        r.candidates = items;
      } else {
        items.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
        r.lists = items;
      }
      if (sector) {
        c.system = "list-sectors";
        c.sectors ??= new Map();
        if (!c.sectors.has(sector)) c.sectors.set(sector, { sector, name: x[3], rounds: [] });
        c.sectors.get(sector).rounds.push(r);
      } else c.rounds.push(r);
    }
  };
  await parseFile("m20t1", 1, false);
  await parseFile("m20t1s", 1, true);
  await parseFile("m20t2", 2, false);
  await parseFile("m20t2s", 2, true);

  // group by 2026 commune
  const by2026 = new Map();
  let unmatched = [];
  for (const c of out.values()) {
    const to = cog.resolve(c.code) ?? (codes2026.has(c.code) ? c.code : null); // COG has no New Caledonia communes
    if (!to) { unmatched.push(c.code); continue; }
    const v = { code: c.code, name: c.name ?? cog.name(c.code), system: c.system };
    if (c.sectors) {
      v.note = "Paris, Lyon and Marseille voted by sector in 2020; there is no city-wide list result.";
      v.sectors = [...c.sectors.values()].sort((a, b) => a.sector.localeCompare(b.sector, "en", { numeric: true })).map(finish2020);
    } else Object.assign(v, finish2020(c));
    if (!by2026.has(to)) by2026.set(to, []);
    by2026.get(to).push(v);
  }
  return { by2026, unmatched };
}

function finish2020(c) {
  const rounds = c.rounds.sort((a, b) => a.round - b.round);
  const res = { ...(c.sector ? { sector: c.sector, name: c.name } : {}), rounds };
  const last = rounds.at(-1);
  if (last?.lists?.length) {
    const w = winnerOf(last.lists);
    if (w) res.winner = { round: last.round, ...w };
  } else if (rounds.some((r) => r.candidates)) {
    res.elected = rounds.reduce((n, r) => n + (r.candidates ?? []).filter((k) => k[5]).length, 0);
  }
  return res;
}

function winnerOf(lists) {
  const best = lists.reduce((a, b) => ((b.seats ?? 0) > (a?.seats ?? 0) ? b : a), null);
  if (!best || !best.seats) return null;
  return { panel: best.panel, label: best.label, head: best.head, nuance: best.nuance, family: best.family, seats: best.seats, pctExpressed: best.pctExpressed };
}

// ---------- assemble ----------
async function main() {
  console.log("Reference data…");
  const { cog, pop } = await reference();
  console.log("2026 heads of list (candidatures file, ~145 MB)…");
  const heads = await heads2026();
  console.log("2026 results…");
  const r26 = await read2026(heads);
  console.log("2020 results…");
  const { by2026: r20, unmatched } = await read2020(cog, new Set(r26.keys()));

  const depts = new Map();
  const index = [];
  const stats = { communes2026: 0, decidedRound1: 0, decidedRound2: 0, noWinner: 0, lists2026: 0, listsWithHead: 0, nuanced: 0, with2020: 0, unmatched2020: unmatched.length };
  const nuanceByPop = { lt1000: [0, 0], "1000-3499": [0, 0], "3500+": [0, 0] };
  for (const [code0, c] of r26) {
    const code = cog.resolve(code0) ?? code0;
    const rounds = c.rounds.sort((a, b) => a.round - b.round);
    const decided = rounds.find((r) => r.lists.some((l) => l.seats > 0));
    const winner = decided ? winnerOf(decided.lists) : null;
    const population = pop.get(code) ?? null;
    stats.communes2026++;
    if (decided?.round === 1) stats.decidedRound1++;
    else if (decided?.round === 2) stats.decidedRound2++;
    else stats.noWinner++;
    for (const r of rounds) for (const l of r.lists) {
      stats.lists2026++;
      if (l.head) stats.listsWithHead++;
      if (l.nuance) stats.nuanced++;
      if (r.round === 1 && population != null) {
        const b = population < 1000 ? "lt1000" : population < 3500 ? "1000-3499" : "3500+";
        nuanceByPop[b][0]++;
        if (l.nuance) nuanceByPop[b][1]++;
      }
    }
    const seats = decided ? decided.lists.reduce((n, l) => n + (l.seats ?? 0), 0) : null;
    const y2020 = r20.get(code) ?? null;
    if (y2020) stats.with2020++;
    const entry = {
      name: c.name,
      population,
      seats,
      y2026: {
        system: "list",
        decidedRound: decided?.round ?? null,
        winner: winner ? { round: decided.round, ...winner } : null,
        rounds,
      },
      y2020: y2020 ?? null,
    };
    if (!depts.has(c.dept)) depts.set(c.dept, { name: c.deptName, communes: {} });
    depts.get(c.dept).communes[code] = entry;
    const w20 = y2020?.length === 1 ? y2020[0].winner : null;
    index.push([code, c.name, c.dept, population, seats, winner?.nuance ?? null, winner ? winner.family : null, winner?.head?.name ?? null, decided?.round ?? null, w20 ? w20.family : null, w20?.nuance ?? null]);
  }

  await mkdir(OUT, { recursive: true });
  let written = 0;
  for (const [dept, d] of [...depts].sort()) {
    if (DEPTS && !DEPTS.includes(dept)) continue;
    const communes = Object.fromEntries(Object.entries(d.communes).sort(([a], [b]) => a.localeCompare(b)));
    const file = {
      generated: TODAY,
      schemaVersion: SCHEMA_VERSION,
      department: { code: dept, name: d.name },
      elections: {
        2026: { rounds: DATES[2026], system: "Proportional list vote with a majority bonus in every commune (law n° 2025-444 of 21 May 2025 extended list voting to communes under 1,000 inhabitants)." },
        2020: { rounds: DATES[2020], system: "List vote in communes of 1,000+ inhabitants; individual candidates (plurinominal majority vote with panachage) under 1,000." },
      },
      families: "families.json",
      sources: SOURCES.map((s) => s.id),
      notes: [
        "Seats = seats on the municipal council (conseil municipal); seatsCommunity = seats on the intercommunal council.",
        "winner = list with the most council seats in the deciding round. Its head of list is usually, but not necessarily, the mayor (the council elects the mayor): see the commune file for the mayor (RNE).",
        "nuance = political label assigned by the Ministry (prefectures), not chosen by the list. The Ministry did not assign nuances to most lists in small communes (null → family 'unclassified').",
        "2020 individual-candidate rows (communes under 1,000) are arrays: [name, sex, nuance, votes, % expressed, elected (1/0)].",
      ],
      communes,
    };
    await writeFile(new URL(`${dept}.json`, OUT), JSON.stringify(file));
    written++;
  }

  index.sort((a, b) => a[0].localeCompare(b[0]));
  await writeFile(
    new URL("index.json", OUT),
    JSON.stringify({
      generated: TODAY,
      schemaVersion: SCHEMA_VERSION,
      columns: ["code", "name", "department", "population", "seats", "winner2026Nuance", "winner2026Family", "winner2026Head", "decidedRound2026", "winner2020Family", "winner2020Nuance"],
      note: "One row per commune with 2026 results. winner2020* is null for communes under 1,000 in 2020 (individual vote), for Paris/Lyon/Marseille (sector vote) and for communes merged since 2020 (several predecessor results). Open <department>.json for details.",
      rows: index,
    }),
  );
  const nuanceCoverage = Object.fromEntries(Object.entries(nuanceByPop).map(([k, [n, w]]) => [k, { lists: n, withNuance: w, pct: pct(w, n) }]));
  await writeFile(
    new URL("families.json", OUT),
    JSON.stringify(
      {
        generated: TODAY,
        schemaVersion: SCHEMA_VERSION,
        note: "Political families are ProjectView's grouping of the Ministry of the Interior nuance codes (see docs/data-municipal.md). Colours follow the French convention: left red/pink, ecologists green, centre orange, right blue, far right navy.",
        families: FAMILIES,
        nuances: NUANCES,
        sources: SOURCES,
        coverage: { ...stats, nuanceCoverage2026Round1ByPopulation: nuanceCoverage },
      },
      null,
      1,
    ),
  );
  console.log(`Wrote ${written} department files to ${fileURLToPath(OUT)}`);
  console.log(JSON.stringify({ ...stats, nuanceCoverage }, null, 1));
  if (unmatched.length) console.log("2020 codes not found in COG 2026:", unmatched.slice(0, 20).join(" "), unmatched.length > 20 ? "…" : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
