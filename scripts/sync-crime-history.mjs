// Recorded crime over time, per town and for France: every year SSMSI publishes (2016 → latest),
// for the indicators shown on the town page. One file per department so a town page loads only its own.
//
// Source: SSMSI (Ministère de l'Intérieur), "Bases statistiques communale, départementale et régionale de
// la délinquance enregistrée par la police et la gendarmerie nationales", data.gouv.fr, Licence Ouverte 2.0.
// Town rates are published only when the town is not under statistical confidentiality that year
// (est_diffuse = "diff"); other years are null. France = sum of department counts / sum of their bases.
//
// Output: public/data/crime-history/<dep>.json
//   { years: [2016, …], national: { key: [rate|null, …] }, department: { key: [...] }, communes: { code: { key: [...] } } }
//
// Usage: node scripts/sync-crime-history.mjs [--refresh]
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const DATASET = "621df2954fa5a3b5a023e23c";
const CACHE = new URL("../.cache/crime-history/", import.meta.url);
const OUT = new URL("../public/data/crime-history/", import.meta.url);
const REFRESH = process.argv.includes("--refresh");
const UA = { "User-Agent": "ThirdEstate/0.1 (French civic data; open source)" };

const KEYS = [
  [/^Cambriolages de logement/i, "burglary"],
  [/^Vols sans violence contre des personnes/i, "theftFromPersons"],
  [/^Violences physiques hors cadre familial/i, "physicalViolenceOther"],
  [/^Violences physiques intrafamiliales/i, "physicalViolenceFamily"],
  [/^Vols de v[ée]hicule/i, "vehicleTheft"],
  [/^Destructions et d[ée]gradations/i, "criminalDamage"],
  [/^Trafic de stup[ée]fiants/i, "drugTrafficking"],
  [/^Escroqueries/i, "fraud"],
];
const keyOf = (label) => KEYS.find(([re]) => re.test(label))?.[1] ?? null;
const num = (s) => (s == null || s === "NA" || s === "" ? null : Number(String(s).replace(",", ".")));
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const depOf = (code) => (/^97/.test(code) ? code.slice(0, 3) : code.slice(0, 2));
// Paris, Lyon, Marseille arrondissements carry only drug indicators: the city rows are used instead.
const isArrondissement = (c) => /^751(0[1-9]|1\d|20)$/.test(c) || /^6938[1-9]$/.test(c) || /^132(0[1-9]|1[0-6])$/.test(c);

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

const meta = await (await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATASET}/`, { headers: UA })).json();
const comRes = meta.resources.find((r) => /^COM - /.test(r.title) && /csv/i.test(r.format) && r.url.endsWith(".gz"));
const depRes = meta.resources.find((r) => /^DEP - /.test(r.title) && /csv/i.test(r.format));
if (!comRes || !depRes) throw new Error("SSMSI resources not found on data.gouv.fr");

// ---- department file → national and department series
const depText = (await readFile(await cached("delinquance-dep.csv", depRes.url), "utf8")).replace(/^﻿/, "");
const [depHead, ...depLines] = depText.trim().split(/\r?\n/);
const DH = Object.fromEntries(depHead.split(";").map((h, i) => [h.replace(/"/g, ""), i]));
const yearsSet = new Set();
const nat = {}; // key → year → {count, base}
const depRates = {}; // dep → key → year → rate
for (const line of depLines) {
  const f = line.split(";").map((x) => x.replace(/^"|"$/g, ""));
  const key = keyOf(f[DH.indicateur]);
  if (!key) continue;
  const y = Number(f[DH.annee]);
  yearsSet.add(y);
  const base = key === "burglary" ? num(f[DH.insee_log]) : num(f[DH.insee_pop]);
  const n = ((nat[key] ??= {})[y] ??= { count: 0, base: 0 });
  n.count += num(f[DH.nombre]) ?? 0;
  n.base += base ?? 0;
  ((depRates[f[DH.Code_departement]] ??= {})[key] ??= {})[y] = num(f[DH.taux_pour_mille]);
}
const years = [...yearsSet].sort((a, b) => a - b);
const national = Object.fromEntries(Object.entries(nat).map(([k, by]) => [k, years.map((y) => (by[y]?.base ? r2((1000 * by[y].count) / by[y].base) : null))]));

// ---- commune file (≈ 5 M lines) → per-department town series
const byDep = {}; // dep → code → key → year → rate
let header = null, H = null, n = 0;
const rl = createInterface({ input: createReadStream(await cached("delinquance-com.csv.gz", comRes.url)).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  const f = line.split(";").map((x) => x.replace(/^"|"$/g, ""));
  if (!header) { header = f.map((h) => h.replace(/^﻿/, "")); H = Object.fromEntries(header.map((h, i) => [h, i])); continue; }
  const key = keyOf(f[H.indicateur]);
  if (!key || f[H.est_diffuse] !== "diff") continue;
  const code = f[H[header.find((h) => /^CODGEO/.test(h))]];
  if (isArrondissement(code)) continue;
  const rate = num(f[H.taux_pour_mille]);
  if (rate == null) continue;
  (((byDep[depOf(code)] ??= {})[code] ??= {})[key] ??= {})[Number(f[H.annee])] = rate;
  n++;
}

await mkdir(OUT, { recursive: true });
const series = (by) => years.map((y) => r2(by?.[y]));
let files = 0;
for (const [dep, communes] of Object.entries(byDep)) {
  const out = {
    years,
    source: { name: "SSMSI (Ministère de l'Intérieur), délinquance enregistrée, bases communale et départementale", url: `https://www.data.gouv.fr/fr/datasets/${DATASET}/`, licence: "Licence Ouverte 2.0" },
    units: { burglary: "per 1,000 dwellings", other: "per 1,000 inhabitants" },
    national,
    department: Object.fromEntries(Object.entries(depRates[dep] ?? {}).map(([k, by]) => [k, series(by)])),
    communes: Object.fromEntries(Object.entries(communes).map(([c, keys]) => [c, Object.fromEntries(Object.entries(keys).map(([k, by]) => [k, series(by)]))])),
  };
  await writeFile(new URL(`${dep}.json`, OUT), JSON.stringify(out));
  files++;
}
console.log(`crime history ${years[0]}–${years.at(-1)}: ${n} published town-year values, ${files} department files`);
