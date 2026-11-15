// Municipal police headcounts per commune, for the "Safety" section of the town page (and anything that compares towns).
//
// Source: Ministère de l'Intérieur (DLPAJ), "Police municipale : effectifs par commune", data.gouv.fr, Licence Ouverte.
// https://www.data.gouv.fr/datasets/police-municipale-effectifs-par-commune — a yearly survey (state at 31 December)
// of every commune or intercommunal body that has a municipal police service. The latest year's .ods is used.
//
// What the file does NOT tell: national police and gendarmerie staffing per town (not published as open data),
// nor whether a commune missing from the list has no municipal police or simply didn't answer the survey.
// So a commune absent from the file has no entry here (never 0).
//
// The survey lists communes by name and department, not INSEE code: names are matched to the COG through
// public/data/communes/index.json (accent, case, hyphen, "ST"/"STE" and "(LE)" insensitive; ambiguous or
// unmatched names, and intercommunal services, are left out and counted in the log). Rates use the INSEE legal
// population from that same index, the one the town page shows, not the survey's own rounded figure.
//
// Output: public/data/police/<dep>.json
//   { year, source, url, bands: [{ min, max, n, median }], communes: { code: [agents, asvp, gardesChampetres, population] } }
//   bands: the median municipal police officers per 10,000 inhabitants among surveyed communes of that population size
//   (communes with at least one officer), the reference the page compares a town with.
//
// Usage: node scripts/sync-police.mjs [--refresh]
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readOdsSheet } from "./lib/ods.mjs";

const DATASET = "5369986ba3a729239d204f55";
const PAGE = "https://www.data.gouv.fr/datasets/police-municipale-effectifs-par-commune";
const CACHE = new URL("../.cache/police/", import.meta.url);
const OUT = new URL("../public/data/police/", import.meta.url);
const INDEX = new URL("../public/data/communes/index.json", import.meta.url);
const REFRESH = process.argv.includes("--refresh");
const UA = { "User-Agent": "ThirdEstate/0.1 (French civic data; open source)" };
const BANDS = [[0, 2000], [2000, 5000], [5000, 10000], [10000, 20000], [20000, 50000], [50000, 100000], [100000, Infinity]];

async function cached(name, url) {
  await mkdir(CACHE, { recursive: true });
  const file = new URL(name, CACHE);
  if (!REFRESH) {
    try { if (Date.now() - (await stat(file)).mtimeMs < 20 * 3600e3) return file; } catch {}
  }
  console.log(`↓ ${url}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// ---- pick the latest year's spreadsheet
const meta = await (await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATASET}/`, { headers: UA })).json();
const latest = meta.resources
  .map((r) => ({ r, year: Number((r.title.match(/\b(20\d\d)\b/) ?? [])[1]) }))
  .filter(({ r, year }) => year && /ods/i.test(r.format))
  .sort((a, b) => b.year - a.year)[0];
if (!latest) throw new Error("no .ods resource found on the dataset");
const { r: res, year } = latest;
console.log(`municipal police survey ${year}: ${res.title}`);
const rows = readOdsSheet(await readFile(await cached(`pm-${year}.ods`, res.url)));

// ---- COG names → codes, per department
const norm = (s) => {
  let x = String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[’']/g, " ").replace(/Œ/g, "OE");
  const art = x.match(/^(.*?)\s*\((LE|LA|LES|L)\)\s*$/); // "MUREAUX (LES)" → "LES MUREAUX"
  if (art) x = `${art[2]} ${art[1]}`;
  x = x.replace(/\(.*$/, "").replace(/[^A-Z0-9]+/g, " ").trim();
  x = x.replace(/\bSTE\b/g, "SAINTE").replace(/\bST\b/g, "SAINT").replace(/\bS\/\b/g, "SUR");
  return x.replace(/ /g, "");
};
const index = JSON.parse(await readFile(INDEX, "utf8"));
const C = Object.fromEntries(index.columns.map((c, i) => [c, i]));
const byDep = new Map(); // dep → normalized name → code | null (ambiguous)
const pop = new Map();
const popByDep = new Map();
for (const row of index.rows) {
  if (row[C.parent]) continue; // arrondissements of Paris, Lyon, Marseille: the survey lists the city
  const dep = row[C.department];
  const m = byDep.get(dep) ?? new Map();
  byDep.set(dep, m);
  const k = norm(row[C.name]);
  m.set(k, m.has(k) ? null : row[C.code]);
  pop.set(row[C.code], row[C.population]);
}

// ---- survey rows → communes
const depCode = (v) => {
  const s = String(v).trim();
  return /^\d$/.test(s) ? `0${s}` : s;
};
const intOf = (v) => (typeof v === "number" ? Math.round(v) : Number(String(v).replace(/\s/g, "")) || 0);
const header = rows.findIndex((r) => /agents de police municipale/i.test(r.join(" ")));
const H = rows[header];
const col = (re) => H.findIndex((h) => re.test(String(h)));
const NAME = col(/^Nom des communes/i), AGENTS = col(/^Nombre d.agents de police municipale/i), ASVP = col(/^Nombre d.ASVP/i), GARDES = col(/^Nombre de gardes champ/i);
if ([NAME, AGENTS, ASVP, GARDES].includes(-1)) throw new Error(`unexpected header: ${JSON.stringify(H)}`);

const out = new Map(); // dep → { code: [agents, asvp, gardes, pop] }
let epci = 0, unmatched = [], seen = 0;
for (const r of rows.slice(header + 1)) {
  if (!/^(\d{1,3}|2[AB])$/.test(String(r[0]).trim()) || !r[NAME]) continue;
  seen++;
  const dep = depCode(r[0]);
  const name = String(r[NAME]);
  if (/\bEPCI\b|communaut[eé]|agglo|m[ée]tropole|\bSIVU\b|\bSIVOM\b|pluricommunale|syndicat/i.test(name.replace(/\(Fait partie[^)]*\)/i, ""))) { epci++; continue; }
  const code = byDep.get(dep)?.get(norm(name));
  if (!code) { unmatched.push(`${dep} ${name}`); continue; }
  const p = pop.get(code);
  if (!p) continue;
  const o = out.get(dep) ?? {};
  out.set(dep, o);
  const prev = o[code];
  const v = [intOf(r[AGENTS]), intOf(r[ASVP]), intOf(r[GARDES])];
  o[code] = prev ? [prev[0] + v[0], prev[1] + v[1], prev[2] + v[2], p] : [...v, p]; // a commune listed twice: add up
}

// ---- same-size medians (officers per 10,000 inhabitants, among surveyed communes with ≥ 1 officer)
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const all = [...out.values()].flatMap((o) => Object.values(o)).filter(([a]) => a > 0);
const bands = BANDS.map(([min, max]) => {
  const rates = all.filter(([, , , p]) => p >= min && p < max).map(([a, , , p]) => (1e4 * a) / p);
  return { min, max: Number.isFinite(max) ? max : null, n: rates.length, median: rates.length ? Math.round(median(rates) * 10) / 10 : null };
});

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const [dep, communes] of out) {
  await writeFile(new URL(`${dep}.json`, OUT), JSON.stringify({ year, source: "Ministère de l'Intérieur, enquête polices municipales", url: PAGE, file: res.url, bands, communes }));
}
const matched = [...out.values()].reduce((n, o) => n + Object.keys(o).length, 0);
console.log(`${seen} survey rows: ${matched} communes matched in ${out.size} departments, ${epci} intercommunal services skipped, ${unmatched.length} unmatched`);
if (unmatched.length) console.log(`unmatched (sample): ${unmatched.slice(0, 40).join(" · ")}`);
console.log("bands:", bands.map((b) => `${b.min}–${b.max ?? "∞"}: ${b.median} (n=${b.n})`).join(", "));
