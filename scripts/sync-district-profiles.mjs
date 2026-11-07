// "Your district" profiles: local public data aggregated to each of the 577 legislative districts.
//   node scripts/sync-district-profiles.mjs              full build (≈ 300 MB of downloads, cached 20 h in .cache/)
//   node scripts/sync-district-profiles.mjs --events     only refresh the events files (daily job)
//   node scripts/sync-district-profiles.mjs --refresh    ignore the download cache
//
// Output (schema, sources, formulas and gaps: docs/data-district-profiles.md):
//   public/data/districts/<code>.json         one profile per district ("0104", "2A01", "97101", "9901")
//   public/data/districts/index.json          national distribution (median, deciles) of every district indicator
//   public/data/districts/events/<code>.json  upcoming public events (DATAtourisme), refreshed separately
//
// Only free official sources: Ministère de l'Intérieur (elections, SSMSI), INSEE, Éducation nationale, OFGL,
// ADN Tourisme (DATAtourisme). Nothing is estimated unless the field name says so ("…Estimated").

import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { readSheet } from "./lib/xlsx.mjs";
import { parseCsv, csvObjects, num, decodeCp850 } from "./lib/csv.mjs";
import { loadDistrictShapes, locate, makeCogResolver, PLM, PLM_OF_ARM } from "./lib/district-geo.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/districts/", ROOT);
const CACHE = new URL(".cache/district-profiles/", ROOT);
const ARGS = new Set(process.argv.slice(2));
const EVENTS_ONLY = ARGS.has("--events");
const REFRESH = ARGS.has("--refresh");
const TODAY = new Date().toISOString().slice(0, 10);
const UA = { "User-Agent": "ProjectView data sync (github.com/nicbay/projectview)" };

// ---------------------------------------------------------------- sources
const LO = "Licence Ouverte / Open Licence v2.0 (Etalab)";
const SRC = {
  bv: {
    name: "Ministère de l'Intérieur — Élections législatives 2024, résultats définitifs du 1er tour par bureau de vote",
    page: "https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour",
    url: "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171445/resultats-definitifs-par-bureau-de-vote.csv",
    licence: LO,
  },
  cand: {
    name: "Ministère de l'Intérieur — Résultats du 1er tour des législatives 2024 par circonscription (une ligne par candidat)",
    page: "https://www.data.gouv.fr/datasets/resultats-du-1er-tour-des-elections-legislatives-2024-par-circonscription",
    url: "https://static.data.gouv.fr/resources/resultats-du-1er-tour-des-elections-legislatives-2024-par-circonscription/20240701-162320/lg2024-resultats-circonscriptions-une-ligne-par-candidat2.csv",
    licence: "data.gouv.fr (licence not specified on the resource; Ministère de l'Intérieur public data)",
  },
  cog: {
    name: "INSEE — Code officiel géographique au 1er janvier 2026 (communes et mouvements)",
    page: "https://www.insee.fr/fr/information/8740222",
    communes: "https://www.insee.fr/fr/statistiques/fichier/8740222/v_commune_2026.csv",
    mvt: "https://www.insee.fr/fr/statistiques/fichier/8740222/v_mvt_commune_2026.csv",
    licence: LO,
  },
  tag: {
    name: "INSEE — Table d'appartenance géographique des communes au 1er janvier 2026",
    page: "https://www.insee.fr/fr/information/7671844",
    url: "https://www.insee.fr/fr/statistiques/fichier/7671844/table-appartenance-geo-communes-2026.zip",
    licence: LO,
  },
  pop: {
    name: "INSEE — Populations de référence (population municipale), via l'API Melodi",
    page: "https://catalogue-donnees.insee.fr/fr/catalogue/recherche/DS_POPULATIONS_REFERENCE",
    api: "https://api.insee.fr/melodi/data/DS_POPULATIONS_REFERENCE",
    licence: LO,
  },
  crime: {
    name: "SSMSI (Ministère de l'Intérieur) — Base statistique communale de la délinquance enregistrée par la police et la gendarmerie nationales",
    page: "https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales",
    dataset: "621df2954fa5a3b5a023e23c",
    doc: "https://static.data.gouv.fr/resources/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales/20260709-120136/fichier-metadonnees-data-gouv-geographie-delinquance-juillet2026.pdf",
    licence: LO,
  },
  census: {
    name: "INSEE — Recensement de la population, Population active et chômage (DS_RP_EMPLOI_LR_PRINC), via l'API Melodi",
    page: "https://catalogue-donnees.insee.fr/fr/catalogue/recherche/DS_RP_EMPLOI_LR_PRINC",
    api: "https://api.insee.fr/melodi/data/DS_RP_EMPLOI_LR_PRINC",
    licence: LO,
  },
  tclZe: {
    name: "INSEE — Taux de chômage localisés par zone d'emploi (moyennes trimestrielles, CVS)",
    page: "https://www.insee.fr/fr/statistiques/1893230",
    pageFile: "https://www.insee.fr/fr/statistiques/1893230",
    licence: LO,
  },
  tclDep: {
    name: "INSEE — Taux de chômage localisés par département (BDM, série TAUX-CHOMAGE, CVS)",
    page: "https://www.insee.fr/fr/statistiques/series/102760732",
    url: "https://bdm.insee.fr/series/sdmx/data/TAUX-CHOMAGE?lastNObservations=1",
    licence: LO,
  },
  filo: {
    name: "INSEE — Filosofi : niveau de vie médian et taux de pauvreté (DS_FILOSOFI_CC), via l'API Melodi",
    page: "https://catalogue-donnees.insee.fr/fr/catalogue/recherche/DS_FILOSOFI_CC",
    catalog: "https://api.insee.fr/melodi/catalog/DS_FILOSOFI_CC",
    licence: LO,
  },
  ofglCom: {
    name: "OFGL — Comptes consolidés des communes (budget principal + budgets annexes), source DGFiP",
    page: "https://data.ofgl.fr/explore/dataset/ofgl-base-communes-consolidee/",
    api: "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-communes-consolidee/exports/json",
    licence: LO,
  },
  ofglEi: {
    name: "OFGL — Comptes consolidés des ensembles intercommunaux (communes + groupement, flux croisés neutralisés)",
    page: "https://data.ofgl.fr/explore/dataset/ofgl-base-ei/",
    api: "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-ei/exports/json",
    licence: LO,
  },
  ofglDep: {
    name: "OFGL — Comptes consolidés des départements",
    page: "https://data.ofgl.fr/explore/dataset/ofgl-base-departements-consolidee/",
    api: "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-departements-consolidee/exports/json",
    licence: LO,
  },
  ofglReg: {
    name: "OFGL — Comptes consolidés des régions",
    page: "https://data.ofgl.fr/explore/dataset/ofgl-base-regions-consolidee/",
    api: "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-regions-consolidee/exports/json",
    licence: LO,
  },
  annuaire: { name: "Éducation nationale — Annuaire de l'éducation", page: "https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/", ds: "fr-en-annuaire-education", licence: LO },
  ipsCol: { name: "Éducation nationale — Indices de position sociale des collèges (à partir de 2023)", page: "https://data.education.gouv.fr/explore/dataset/fr-en-ips-colleges-ap2023/", ds: "fr-en-ips-colleges-ap2023", licence: LO },
  ipsLyc: { name: "Éducation nationale — Indices de position sociale des lycées (à partir de 2023)", page: "https://data.education.gouv.fr/explore/dataset/fr-en-ips-lycees-ap2023/", ds: "fr-en-ips-lycees-ap2023", licence: LO },
  ivac: { name: "Éducation nationale — Indicateurs de valeur ajoutée des collèges (IVAC, DNB)", page: "https://data.education.gouv.fr/explore/dataset/fr-en-indicateurs-valeur-ajoutee-colleges/", ds: "fr-en-indicateurs-valeur-ajoutee-colleges", licence: LO },
  ivalGt: { name: "Éducation nationale — Indicateurs de valeur ajoutée des lycées d'enseignement général et technologique (IVAL)", page: "https://data.education.gouv.fr/explore/dataset/fr-en-indicateurs-de-resultat-des-lycees-gt_v2/", ds: "fr-en-indicateurs-de-resultat-des-lycees-gt_v2", licence: LO },
  ivalPro: { name: "Éducation nationale — Indicateurs de valeur ajoutée des lycées d'enseignement professionnel (IVAL)", page: "https://data.education.gouv.fr/explore/dataset/fr-en-indicateurs-de-resultat-des-lycees-pro_v2/", ds: "fr-en-indicateurs-de-resultat-des-lycees-pro_v2", licence: LO },
  events: {
    name: "ADN Tourisme — DATAtourisme, fêtes et manifestations (flux quotidien)",
    page: "https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques",
    dataset: "5b598be088ee387c0c353714",
    licence: LO,
  },
};
const cite = (s, extra = {}) => ({ name: s.name, url: s.page, licence: s.licence, ...extra });

// ---------------------------------------------------------------- utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r0 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");

async function fetchRetry(url, opts = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers ?? {}) } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      return res;
    } catch (e) {
      if (e.fatal || i >= tries) throw e;
      await sleep(3000 * i);
    }
  }
}

// Download once, keep in .cache for 20 h (the full build needs ~300 MB)
async function cached(name, url, { maxAgeH = 20 } = {}) {
  const file = new URL(name, CACHE);
  if (!REFRESH) {
    try {
      const s = await stat(file);
      if (Date.now() - s.mtimeMs < maxAgeH * 3600e3) return file;
    } catch {}
  }
  console.log(`↓ ${url}`);
  const res = await fetchRetry(url);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
const cachedText = async (name, url, enc = "utf8") => {
  const buf = await readFile(await cached(name, url));
  return enc === "cp850" ? decodeCp850(buf) : buf.toString("utf8");
};
const cachedJson = async (name, url) => JSON.parse(await cachedText(name, url));

async function dataGouvResources(datasetId) {
  const res = await fetchRetry(`https://www.data.gouv.fr/api/1/datasets/${datasetId}/`);
  return (await res.json()).resources;
}

// INSEE Melodi data API (free, no key). Pages through results; returns observations.
async function melodi(dataset, params) {
  const obs = [];
  for (let page = 1; ; page++) {
    const url = `https://api.insee.fr/melodi/data/${dataset}?${new URLSearchParams({ ...params, maxResult: 10000, page })}`;
    const name = `melodi-${dataset}-${createHash("md5").update(JSON.stringify(params)).digest("hex").slice(0, 12)}-${page}.json`;
    const j = await cachedJson(name, url);
    obs.push(...j.observations);
    if (j.observations.length < 10000) break;
    await sleep(2500); // Melodi allows ~30 requests/minute without a key
  }
  return obs;
}
const geoCode = (g) => g.split("-").pop();
const obsValue = (o) => o.measures?.OBS_VALUE_NIVEAU?.value ?? null;

// Opendatasoft "exports" (data.education.gouv.fr, data.ofgl.fr): full filtered result in one call
async function ods(base, ds, params, name) {
  const url = `${base}/api/explore/v2.1/catalog/datasets/${ds}/exports/json?${new URLSearchParams(params)}`;
  return cachedJson(name, url);
}
const EDU = "https://data.education.gouv.fr";
const OFGL = "https://data.ofgl.fr";

const quantiles = (values) => {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
  };
  return { n: v.length, min: v[0], max: v[v.length - 1], median: q(0.5), deciles: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => q(d / 10)) };
};

// ---------------------------------------------------------------- 1. districts & commune ↔ district weights
// District codes: department + 2-digit number, as in public/data/geo/circo and the results file.
const PREFIX = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZS: "975", ZM: "976", ZX: "977", ZW: "986", ZP: "987", ZN: "988", ZZ: "99" };
const circoCode = (cod) => (PREFIX[cod.slice(0, 2)] ? PREFIX[cod.slice(0, 2)] + cod.slice(-2) : cod);
const depOf = (code) => code.slice(0, -2);

async function buildGeography(cog) {
  // Candidates → district (a candidate stands in one district only)
  const candText = await cachedText("lg2024-candidats.csv", SRC.cand.url, "cp850");
  const cand = csvObjects(candText, ",");
  const districts = new Map(); // code → { code, label, dep }
  const byName = new Map(); // dep|NOM|PRENOM → code
  for (const c of cand) {
    const code = circoCode(c.CodCirElec);
    if (!districts.has(code)) districts.set(code, { code, label: c.LibCirElec, dep: depOf(code) });
    byName.set(`${depOf(code)}|${norm(c.NomPsn)}|${norm(c.PrenomPsn)}`, code);
  }

  // Polling stations: commune, number, registered voters, and the candidates on the ballot
  const bvText = await cachedText("lg2024-bureaux.csv", SRC.bv.url);
  const rows = parseCsv(bvText, ";");
  const head = rows.shift();
  const iDep = head.indexOf("Code département"), iDepLib = head.indexOf("Libellé département");
  const iCom = head.indexOf("Code commune"), iComLib = head.indexOf("Libellé commune");
  const iBv = head.indexOf("Code BV"), iIns = head.indexOf("Inscrits");
  const iNom1 = head.indexOf("Nom candidat 1");
  const depNames = new Map();
  const com = new Map(); // commune 2026 → Map(district → inscrits)
  const arm = new Map(); // arrondissement → Map(district → inscrits)
  const unresolved = new Set();
  let unmatched = 0;
  const add = (m, k, d, n) => {
    if (!m.has(k)) m.set(k, new Map());
    m.get(k).set(d, (m.get(k).get(d) ?? 0) + n);
  };
  for (const r of rows) {
    let dep = r[iDep];
    dep = PREFIX[dep] ?? (dep.length === 1 ? "0" + dep : dep);
    depNames.set(dep, r[iDepLib]);
    let district = null;
    for (let k = iNom1; k < r.length && !district; k += 9) {
      if (!r[k]) continue;
      district = byName.get(`${dep}|${norm(r[k])}|${norm(r[k + 1])}`) ?? null;
    }
    if (!district) { unmatched++; continue; }
    const inscrits = num(r[iIns]) ?? 0;
    const raw = /^\d{4}$/.test(r[iCom]) ? "0" + r[iCom] : r[iCom]; // departments 01–09 lose their leading zero
    if (dep === "99") continue; // French abroad: consulates, not communes
    const c = cog.resolve(raw) ?? raw;
    if (!cog.isCurrent(c)) unresolved.add(`${raw} ${r[iComLib]}`);
    add(com, c, district, inscrits);
    if (PLM[c]) add(arm, PLM[c](Math.floor(Number(r[iBv]) / 100)), district, inscrits);
  }
  if (unmatched) console.warn(`  ⚠ ${unmatched} polling stations without a matching candidate`);
  if (unresolved.size) console.warn(`  ⚠ ${unresolved.size} commune codes not in COG 2026 (kept as is): ${[...unresolved].slice(0, 8).join(", ")}`);
  for (const d of districts.values()) d.depName = depNames.get(d.dep) ?? null;

  // weights: share of the unit's registered voters that vote in each district
  const toWeights = (m) => {
    const w = new Map();
    for (const [k, byD] of m) {
      const tot = [...byD.values()].reduce((a, b) => a + b, 0);
      w.set(k, new Map([...byD].map(([d, n]) => [d, { share: tot ? n / tot : 1 / byD.size, inscrits: n }])));
    }
    return w;
  };
  return { districts, comW: toWeights(com), armW: toWeights(arm) };
}

// For each district: the list of geographic units it contains.
//   level "commune": communes, Paris/Lyon/Marseille as a whole commune (for sources without arrondissements)
//   level "unit":    communes, with Paris/Lyon/Marseille replaced by their arrondissements
function unitsByDistrict(geo) {
  const commune = new Map(), unit = new Map();
  const push = (m, d, x) => { if (!m.has(d)) m.set(d, []); m.get(d).push(x); };
  for (const [c, byD] of geo.comW) for (const [d, w] of byD) {
    push(commune, d, { code: c, share: w.share, inscrits: w.inscrits });
    if (!PLM[c]) push(unit, d, { code: c, share: w.share, inscrits: w.inscrits });
  }
  for (const [a, byD] of geo.armW) for (const [d, w] of byD) push(unit, d, { code: a, share: w.share, inscrits: w.inscrits });
  return { commune, unit };
}

// Σ share × weight × value / Σ share × weight over units that have a value
function weightedMean(units, value, weight) {
  let num_ = 0, den = 0, denAll = 0;
  for (const u of units) {
    const w = u.share * (weight(u.code) ?? 0);
    denAll += w;
    const v = value(u.code);
    if (v == null) continue;
    num_ += w * v;
    den += w;
  }
  return { value: den ? num_ / den : null, coverage: denAll ? den / denAll : null };
}

// ---------------------------------------------------------------- 2. indicators
const CRIME_KEYS = [
  [/^Violences physiques intrafamiliales/i, "physicalViolenceFamily", "Domestic physical violence"],
  [/^Violences physiques hors cadre familial/i, "physicalViolenceOther", "Physical violence outside the family"],
  [/^Violences sexuelles/i, "sexualViolence", "Sexual violence"],
  [/^Vols avec armes/i, "armedRobbery", "Armed robbery"],
  [/^Vols violents sans arme/i, "violentTheft", "Violent theft without a weapon"],
  [/^Vols sans violence contre des personnes/i, "theftFromPersons", "Theft from persons without violence"],
  [/^Cambriolages de logement/i, "burglary", "Residential burglary"],
  [/^Vols de v[ée]hicule/i, "vehicleTheft", "Vehicle theft"],
  [/^Vols dans les v[ée]hicules/i, "theftFromVehicles", "Theft from vehicles"],
  [/^Vols d'accessoires/i, "vehicleAccessoryTheft", "Theft of vehicle accessories"],
  [/^Destructions et d[ée]gradations/i, "criminalDamage", "Criminal damage"],
  [/^Usage de stup[ée]fiants \(AFD\)/i, "drugUseFixedFine", "Drug use (fixed fines)"],
  [/^Usage de stup[ée]fiants/i, "drugUse", "Drug use"],
  [/^Trafic de stup[ée]fiants/i, "drugTrafficking", "Drug trafficking"],
  [/^Escroqueries/i, "fraud", "Fraud and payment fraud"],
  [/^Homicides/i, "homicide", "Homicide"],
  [/^Tentatives d'homicide/i, "attemptedHomicide", "Attempted homicide"],
];
const crimeKey = (label) => {
  for (const [re, key, en] of CRIME_KEYS) if (re.test(label)) return { key, en };
  return { key: norm(label).toLowerCase().slice(0, 30), en: label };
};

async function loadCrime(cog) {
  const res = await dataGouvResources(SRC.crime.dataset);
  const comRes = res.find((r) => /^COM - /.test(r.title) && /csv/i.test(r.format) && r.url.endsWith(".gz"));
  const depRes = res.find((r) => /^DEP - /.test(r.title) && /csv/i.test(r.format));
  const file = await cached("delinquance-com.csv.gz", comRes.url);
  const rows = []; // keep the latest two years while streaming (≈ 6 M lines in total)
  let header = null;
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = line.split(";").map((x) => x.replace(/^"|"$/g, ""));
    if (!header) { header = f.map((h) => h.replace(/^﻿/, "")); continue; }
    if (Number(f[1]) >= 2024) rows.push(f);
  }
  const H = Object.fromEntries(header.map((h, i) => [h, i]));
  const geoCol = header.find((h) => /^CODGEO/.test(h));
  const year = rows.reduce((m, f) => Math.max(m, Number(f[H.annee])), 0);
  const labels = {};
  const byCommune = new Map(); // 2026 code → { key: {...} }
  for (const f of rows) {
    if (Number(f[H.annee]) !== year) continue;
    const code = f[H[geoCol]];
    if (PLM_OF_ARM(code) && code.length === 5 && !PLM[code]) continue; // arrondissements: drug indicators only → use city rows
    const { key, en } = crimeKey(f[H.indicateur]);
    labels[key] = { fr: f[H.indicateur], en, unit: f[H.unite_de_compte], per: /cambriolage/i.test(f[H.indicateur]) ? "1,000 dwellings" : "1,000 inhabitants" };
    const c = cog.resolve(code) ?? code;
    if (!byCommune.has(c)) byCommune.set(c, {});
    const prev = byCommune.get(c)[key];
    const rec = {
      published: f[H.est_diffuse] === "diff",
      count: num(f[H.nombre]),
      rate: num(f[H.taux_pour_mille]),
      avgCountUnpublished: num(f[H.complement_info_nombre]),
      pop: num(f[H.insee_pop]),
      dwellings: num(f[H.insee_log]),
    };
    if (prev) { // two old communes merged into one 2026 commune (rare): add up, unpublished wins
      rec.published = prev.published && rec.published;
      for (const k of ["count", "avgCountUnpublished", "pop", "dwellings"]) rec[k] = (prev[k] ?? 0) + (rec[k] ?? 0);
      rec.rate = null;
    }
    byCommune.get(c)[key] = rec;
  }
  // Department base (homicides etc. and national totals)
  const depRows = csvObjects((await cachedText("delinquance-dep.csv", depRes.url)).replace(/^﻿/, ""), ";");
  const byDep = new Map();
  const national = {};
  for (const r of depRows) {
    if (Number(r.annee) !== year) continue;
    const { key, en } = crimeKey(r.indicateur);
    labels[key] ??= { fr: r.indicateur, en, unit: r.unite_de_compte, per: /cambriolage/i.test(r.indicateur) ? "1,000 dwellings" : "1,000 inhabitants" };
    if (!byDep.has(r.Code_departement)) byDep.set(r.Code_departement, {});
    byDep.get(r.Code_departement)[key] = { count: num(r.nombre), rate: num(r.taux_pour_mille) };
    const n = (national[key] ??= { count: 0, base: 0 });
    n.count += num(r.nombre) ?? 0;
    n.base += (/cambriolage/i.test(r.indicateur) ? num(r.insee_log) : num(r.insee_pop)) ?? 0;
  }
  for (const n of Object.values(national)) n.rate = n.base ? (1000 * n.count) / n.base : null;
  console.log(`  crime ${year}: ${byCommune.size} communes, ${Object.keys(labels).length} indicators`);
  return { year, labels, byCommune, byDep, national, files: { commune: comRes.url, department: depRes.url } };
}

function crimeForDistrict(crime, units) {
  const district = {}, communes = {};
  for (const key of Object.keys(crime.labels)) {
    let pubCount = 0, pubBase = 0, estCount = 0, totBase = 0, any = false;
    for (const u of units) {
      const rec = crime.byCommune.get(u.code)?.[key];
      if (!rec) continue;
      any = true;
      const base = (crime.labels[key].per.includes("dwellings") ? rec.dwellings : rec.pop) ?? 0;
      totBase += u.share * base;
      if (rec.published && rec.count != null) {
        pubCount += u.share * rec.count;
        pubBase += u.share * base;
        estCount += u.share * rec.count;
      } else if (rec.avgCountUnpublished != null) estCount += u.share * rec.avgCountUnpublished;
    }
    if (!any) continue;
    district[key] = {
      count: r1(pubCount), // published communes only
      rate: pubBase ? r2((1000 * pubCount) / pubBase) : null,
      coverage: totBase ? r4(pubBase / totBase) : null, // share of the district's population (dwellings) behind `rate`
      rateEstimated: totBase ? r2((1000 * estCount) / totBase) : null, // + SSMSI department averages for unpublished communes
    };
  }
  for (const u of units) {
    const recs = crime.byCommune.get(u.code);
    if (!recs) continue;
    // published values only: an absent key means "not published" (secret statistique)
    const pub = Object.entries(recs).filter(([, r]) => r.published).map(([k, r]) => [k, [r.count, r2(r.rate)]]);
    if (pub.length) communes[u.code] = Object.fromEntries(pub);
  }
  return { district, communes };
}

async function loadPopulation(cog) {
  const pop = new Map();
  for (const level of ["COM", "ARM"]) {
    for (const o of await melodi("DS_POPULATIONS_REFERENCE", { GEO: level, POPREF_MEASURE: "PMUN" })) {
      const raw = geoCode(o.dimensions.GEO);
      const c = level === "ARM" ? raw : cog.resolve(raw) ?? raw;
      pop.set(c, (pop.get(c) ?? 0) + (obsValue(o) ?? 0));
    }
  }
  const year = 2023;
  console.log(`  population ${year}: ${pop.size} communes/arrondissements`);
  return { year, pop };
}

async function loadCensusUnemployment(cog) {
  const get = async (level, status) => {
    const m = new Map();
    for (const o of await melodi("DS_RP_EMPLOI_LR_PRINC", { GEO: level, TIME_PERIOD: 2023, AGE: "Y15T64", SEX: "_T", EDUC: "_T", EMPSTA_ENQ: status })) {
      const raw = geoCode(o.dimensions.GEO);
      const c = level === "COM" ? cog.resolve(raw) ?? raw : raw;
      m.set(c, (m.get(c) ?? 0) + (obsValue(o) ?? 0));
    }
    return m;
  };
  const unemployed = new Map([...(await get("COM", "2")), ...(await get("ARM", "2"))]);
  const active = new Map([...(await get("COM", "1T2")), ...(await get("ARM", "1T2"))]);
  const fr = await melodi("DS_RP_EMPLOI_LR_PRINC", { GEO: "FRANCE", TIME_PERIOD: 2023, AGE: "Y15T64", SEX: "_T", EDUC: "_T" });
  const national = {};
  for (const o of fr) {
    const g = geoCode(o.dimensions.GEO);
    (national[g] ??= {})[o.dimensions.EMPSTA_ENQ] = obsValue(o);
  }
  console.log(`  census unemployment 2023: ${unemployed.size} units`);
  return { year: 2023, unemployed, active, national: Object.fromEntries(Object.entries(national).map(([g, v]) => [g, v["1T2"] ? (100 * v["2"]) / v["1T2"] : null])) };
}

async function loadFilosofi(cog) {
  const cat = await cachedJson("melodi-catalog-filosofi.json", SRC.filo.catalog);
  const product = (cat.product ?? []).find((p) => p.format === "CSV" && /_CSV_FR$/.test(p.id));
  const year = Number(cat.temporal?.endPeriod?.slice(0, 4)) || Number(product.id.match(/_(\d{4})_/)?.[1]);
  const zip = unzipSync(new Uint8Array(await readFile(await cached("filosofi.zip", product.accessURL))));
  const name = Object.keys(zip).find((n) => /_data\.csv$/.test(n));
  const rows = parseCsv(strFromU8(zip[name]), ";");
  const H = Object.fromEntries(rows.shift().map((h, i) => [h, i]));
  const median = new Map(), poverty = new Map();
  const national = {};
  let dataYear = year;
  for (const r of rows) {
    const lvl = r[H.GEO_OBJECT], meas = r[H.FILOSOFI_MEASURE];
    if (meas !== "MED_SL" && meas !== "PR_MD60") continue;
    const v = num(r[H.OBS_VALUE]);
    dataYear = Number(r[H.TIME_PERIOD]) || dataYear;
    if (lvl === "FRANCE") { national[meas] = v; continue; }
    if (lvl !== "COM" && lvl !== "ARM") continue;
    const c = lvl === "COM" ? cog.resolve(r[H.GEO]) ?? r[H.GEO] : r[H.GEO];
    (meas === "MED_SL" ? median : poverty).set(c, v);
  }
  console.log(`  filosofi ${dataYear}: ${median.size} median values`);
  return { year: dataYear, median, poverty, national, file: product.accessURL };
}

async function loadZoneUnemployment(tag) {
  const page = await (await fetchRetry(SRC.tclZe.pageFile)).text();
  const href = page.match(/href="(\/fr\/statistiques\/fichier\/1893230\/chomage-zone-t1-[^"]+\.xlsx)"/)?.[1];
  if (!href) throw new Error("employment-zone file link not found on " + SRC.tclZe.pageFile);
  const url = "https://www.insee.fr" + href;
  const rows = readSheet(await readFile(await cached("chomage-zone.xlsx", url)), "txcho_ze");
  const hi = rows.findIndex((r) => r[0] === "ZE2020");
  const head = rows[hi];
  const last = head.length - 1 - [...head].reverse().findIndex((h) => /^\d{4}-T\d$/.test(String(h)));
  const period = head[last];
  const rates = new Map();
  for (const r of rows.slice(hi + 1)) if (r[0]) rates.set(String(r[0]).padStart(4, "0"), { name: r[1], rate: num(r[last]) });

  const xml = await cachedText("tcl-dep.xml", SRC.tclDep.url);
  const dep = new Map();
  let depPeriod = null, france = null;
  for (const m of xml.matchAll(/<Series ([^>]*)>([\s\S]*?)<\/Series>/g)) {
    const area = m[1].match(/REF_AREA="([^"]+)"/)[1];
    const obs = m[2].match(/TIME_PERIOD="([^"]+)" OBS_VALUE="([^"]+)"/);
    if (!obs) continue;
    depPeriod = obs[1];
    if (area.startsWith("D")) dep.set(area.slice(1), num(obs[2]));
    if (area === "FE" || (area === "FM" && france == null)) france = { area, rate: num(obs[2]) };
  }
  console.log(`  localised unemployment ${period}: ${rates.size} zones, ${dep.size} departments (${depPeriod})`);
  return { period, rates, dep, depPeriod, france, url, zoneOf: tag.ze };
}

async function loadTag() {
  const zip = unzipSync(new Uint8Array(await readFile(await cached("table-appartenance-2026.zip", SRC.tag.url))));
  const buf = Object.values(zip)[0];
  const ze = new Map(), epci = new Map(), ept = new Map(), reg = new Map(), name = new Map();
  for (const sheet of ["COM", "ARM"]) {
    const rows = readSheet(buf, sheet);
    const hi = rows.findIndex((r) => r[0] === "CODGEO");
    const H = Object.fromEntries(rows[hi].map((h, i) => [h, i]));
    for (const r of rows.slice(hi + 1)) {
      const c = String(r[0]);
      if (!c) continue;
      ze.set(c, String(r[H.ZE2020]));
      epci.set(c, String(r[H.EPCI]));
      if (r[H.EPT] && !/^Z+$/.test(r[H.EPT])) ept.set(c, String(r[H.EPT]));
      reg.set(c, String(r[H.REG]));
      name.set(c, r[H.LIBGEO]);
    }
  }
  return { ze, epci, ept, reg, name };
}

const SPENDING = [
  ["Dépenses totales hors remb", "total", "Total spending (excluding debt repayment)"],
  ["Dépenses de fonctionnement", "operating", "Operating spending"],
  ["Dépenses d'investissement hors remb", "investment", "Investment spending (excluding debt repayment)"],
  ["Encours de dette", "debt", "Outstanding debt"],
  ["Concours de l'Etat", "stateTransfers", "State transfers received (DGF and other State grants) — a receipt, not State spending"],
];

async function loadOfgl(cog) {
  const aggs = SPENDING.map(([a]) => `"${a}"`).join(",");
  const where = (y) => `exer>=date'${y}-01-01' and exer<date'${y + 1}-01-01' and agregat in (${aggs})`;
  // latest exercise with accounts for at least 95 % of communes
  let year = new Date().getFullYear();
  let rows = [];
  for (; year > 2018; year--) {
    rows = await ods(OFGL, "ofgl-base-communes-consolidee", { where: where(year), select: "insee,siren,com_name,agregat,montant,ptot" }, `ofgl-com-${year}.json`);
    if (new Set(rows.map((r) => r.insee)).size > 33000) break;
  }
  const byCommune = new Map(), sirenOf = new Map();
  for (const r of rows) {
    const c = cog.resolve(r.insee) ?? r.insee;
    sirenOf.set(c, r.siren);
    const key = SPENDING.find(([a]) => a === r.agregat)[1];
    const e = byCommune.get(c) ?? { ptot: 0 };
    e[key] = (e[key] ?? 0) + (r.montant ?? 0);
    if (key === "total") e.ptot += r.ptot ?? 0;
    byCommune.set(c, e);
  }
  const ei = new Map();
  for (const r of await ods(OFGL, "ofgl-base-ei", { where: where(year), select: "siren,epci_code,epci_name,type_ei,agregat,montant,ptot" }, `ofgl-ei-${year}.json`)) {
    const key = SPENDING.find(([a]) => a === r.agregat)[1];
    const e = ei.get(r.siren) ?? { name: r.epci_name, type: r.type_ei, ptot: r.ptot };
    e[key] = r.montant;
    ei.set(r.siren, e);
  }
  const level = async (ds, codeField, nameField) => {
    const m = new Map();
    for (const r of await ods(OFGL, ds, { where: where(year), select: `${codeField},${nameField},agregat,montant,ptot` }, `${ds}-${year}.json`)) {
      const key = SPENDING.find(([a]) => a === r.agregat)[1];
      const e = m.get(r[codeField]) ?? { name: r[nameField], ptot: r.ptot };
      e[key] = r.montant;
      m.set(r[codeField], e);
    }
    return m;
  };
  const dep = await level("ofgl-base-departements-consolidee", "dep_code", "dep_name");
  const reg = await level("ofgl-base-regions-consolidee", "reg_code", "reg_name");
  console.log(`  OFGL ${year}: ${byCommune.size} communes, ${ei.size} intercommunal sets, ${dep.size} departments, ${reg.size} regions`);
  return { year, byCommune, sirenOf, ei, dep, reg };
}
const perCapita = (e) => (e && e.ptot ? Object.fromEntries(SPENDING.map(([, k]) => [k, r0(e[k] != null ? e[k] / e.ptot : null)])) : null);

async function loadSchools(cog) {
  const latest = async (ds, field) => {
    const url = `${EDU}/api/explore/v2.1/catalog/datasets/${ds}/records?${new URLSearchParams({ group_by: field, limit: 100 })}`;
    const groups = (await cachedJson(`edu-${ds}-years.json`, url)).results;
    return groups.map((g) => String(g[field])).sort().pop();
  };
  const annuaire = await ods(EDU, SRC.annuaire.ds, {
    where: "(type_etablissement='Collège' or type_etablissement='Lycée') and etat='OUVERT'",
    select: "identifiant_de_l_etablissement,nom_etablissement,type_etablissement,statut_public_prive,code_commune,nom_commune,latitude,longitude,voie_generale,voie_technologique,voie_professionnelle,appartenance_education_prioritaire",
  }, "edu-annuaire.json");

  const ipsColYear = await latest(SRC.ipsCol.ds, "rentree_scolaire");
  const ipsCol = await ods(EDU, SRC.ipsCol.ds, { where: `rentree_scolaire='${ipsColYear}'` }, `edu-ips-col-${ipsColYear}.json`);
  const ipsLycYear = await latest(SRC.ipsLyc.ds, "rentree_scolaire");
  const ipsLyc = await ods(EDU, SRC.ipsLyc.ds, { where: `rentree_scolaire='${ipsLycYear}'` }, `edu-ips-lyc-${ipsLycYear}.json`);
  const ivacYear = (await latest(SRC.ivac.ds, "session")).slice(0, 4);
  const ivac = await ods(EDU, SRC.ivac.ds, { where: `session>=date'${ivacYear}-01-01'` }, `edu-ivac-${ivacYear}.json`);
  const gtYear = (await latest(SRC.ivalGt.ds, "annee")).slice(0, 4);
  const ivalGt = await ods(EDU, SRC.ivalGt.ds, { where: `annee>=date'${gtYear}-01-01'` }, `edu-ival-gt-${gtYear}.json`);
  const proYear = (await latest(SRC.ivalPro.ds, "annee")).slice(0, 4);
  const ivalPro = await ods(EDU, SRC.ivalPro.ds, { where: `annee>=date'${proYear}-01-01'` }, `edu-ival-pro-${proYear}.json`);

  const by = (rows) => new Map(rows.map((r) => [r.uai, r]));
  const IC = by(ipsCol), IL = by(ipsLyc), VC = by(ivac), VG = by(ivalGt), VP = by(ivalPro);
  const schools = [];
  for (const a of annuaire) {
    const uai = a.identifiant_de_l_etablissement;
    const isCol = a.type_etablissement === "Collège";
    const s = {
      uai,
      name: a.nom_etablissement,
      type: isCol ? "college" : "lycee",
      sector: /priv/i.test(a.statut_public_prive) ? "private" : "public",
      commune: cog.resolve(a.code_commune) ?? a.code_commune,
      communeName: a.nom_commune,
      lat: r4(a.latitude), lon: r4(a.longitude),
      priorityEducation: a.appartenance_education_prioritaire || null,
    };
    if (!isCol) s.tracks = [a.voie_generale === "1" && "general", a.voie_technologique === "1" && "technological", a.voie_professionnelle === "1" && "vocational"].filter(Boolean);
    const ic = IC.get(uai), il = IL.get(uai);
    if (ic) s.ips = { value: num(ic.ips), sd: num(ic.ecart_type_de_l_ips) };
    if (il) s.ips = { value: num(il.ips_etab), sd: num(il.ecart_type_etablissement), gt: num(il.ips_voie_gt), pro: num(il.ips_voie_pro), lyceeType: il.type_de_lycee };
    const vc = VC.get(uai);
    if (vc) s.dnb = {
      candidates: num(vc.nb_candidats_g), successRate: num(vc.taux_de_reussite_g), successVA: num(vc.va_du_taux_de_reussite_g),
      writtenScore: num(vc.note_a_l_ecrit_g), writtenVA: num(vc.va_de_la_note_g), access6to3: num(vc.taux_d_acces_6eme_3eme),
    };
    const lycee = (v) => v && {
      candidates: num(v.presents_total), successRate: num(v.taux_reu_total), successVA: num(v.va_reu_total),
      accessRate: num(v.taux_acces_2nde), accessVA: num(v.va_acces_2nde), honoursRate: num(v.taux_men_total), honoursVA: num(v.va_men_total),
    };
    if (VG.get(uai)) s.bacGT = lycee(VG.get(uai));
    if (VP.get(uai)) s.bacPro = lycee(VP.get(uai));
    schools.push(s);
  }
  const ref = ipsCol[0] ?? {};
  const national = { ipsCollege: num(ref.ips_national), ipsCollegePublic: num(ref.ips_national_public), ipsCollegePrivate: num(ref.ips_national_prive) };
  const refL = ipsLyc[0] ?? {};
  Object.assign(national, { ipsLyceeLEGT: num(refL.ips_national_legt), ipsLyceeLPO: num(refL.ips_national_lpo), ipsLyceeLP: num(refL.ips_national_lp) });
  console.log(`  schools: ${schools.length} collèges/lycées (IPS ${ipsColYear}/${ipsLycYear}, DNB ${ivacYear}, bac ${gtYear}/${proYear})`);
  return { schools, years: { ipsCollege: ipsColYear, ipsLycee: ipsLycYear, dnb: ivacYear, bacGT: gtYear, bacPro: proYear }, national };
}

// ---------------------------------------------------------------- 3. events (DATAtourisme)
async function buildEvents(shapes, districtCodes) {
  const res = await dataGouvResources(SRC.events.dataset);
  const fma = res.find((r) => /datatourisme-fma\.csv$/.test(r.url));
  const rows = csvObjects(await cachedText("datatourisme-fma.csv", fma.url), ",");
  const horizon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const byDistrict = new Map(districtCodes.map((c) => [c, []]));
  let kept = 0, unlocated = 0, long = 0;
  for (const r of rows) {
    // next period overlapping [today, today + 60 days]; periods "YYYY-MM-DD<->YYYY-MM-DD" separated by "|"
    const periods = String(r.Periodes_regroupees || "").split("|").map((p) => p.split("<->")).filter((p) => p[0] && p[1] && p[1] >= TODAY && p[0] <= horizon).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!periods.length) continue;
    const [start, end] = periods[0];
    if ((Date.parse(end) - Date.parse(start)) / 864e5 > 62) { long++; continue; } // permanent offers (visits, courses), not events
    const d = locate(shapes, num(r.Longitude), num(r.Latitude));
    if (!d) { unlocated++; continue; }
    const [postcode, commune] = String(r.Code_postal_et_commune).split("#");
    const website = String(r.Contacts_du_POI || "").split("|").map((c) => c.split("#")[1]).find((u) => /^https?:\/\//.test(u ?? "")) ?? null;
    const types = String(r.Categories_de_POI).split("|").map((t) => t.split("#")[1]).filter((t) => t && !/^(PointOfInterest|EntertainmentAndEvent|Event|PlaceOfInterest|Product)$/.test(t));
    byDistrict.get(d)?.push({
      name: r.Nom_du_POI, start, end, commune: commune ?? null, postcode: postcode ?? null,
      types: [...new Set(types)].slice(0, 4), url: website, datatourisme: r.URI_ID_du_POI, publisher: r.Createur_de_la_donnee || null,
      lat: r4(num(r.Latitude)), lon: r4(num(r.Longitude)),
    });
    kept++;
  }
  await mkdir(new URL("events/", OUT), { recursive: true });
  const source = cite(SRC.events, { file: fma.url, retrieved: TODAY });
  for (const [code, list] of byDistrict) {
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1));
    await writeFile(new URL(`events/${code}.json`, OUT), JSON.stringify({ code, generated: TODAY, window: [TODAY, horizon], source, total: list.length, events: list.slice(0, 50) }));
  }
  console.log(`  events: ${kept} upcoming events located in a district (${unlocated} outside every outline, ${long} long-running offers skipped)`);
  return { kept, file: fma.url };
}

// ---------------------------------------------------------------- 4. main
await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });
const shapes = await loadDistrictShapes(new URL("public/data/geo/circo/", ROOT));

if (EVENTS_ONLY) {
  const index = JSON.parse(await readFile(new URL("index.json", OUT), "utf8"));
  await buildEvents(shapes, index.districts);
  process.exit(0);
}

console.log("• geography");
const cog = makeCogResolver(csvObjects(await cachedText("v_commune_2026.csv", SRC.cog.communes)), csvObjects(await cachedText("v_mvt_commune_2026.csv", SRC.cog.mvt)));
const geo = await buildGeography(cog);
const units = unitsByDistrict(geo);
const tag = await loadTag();
console.log(`  ${geo.districts.size} districts, ${geo.comW.size} communes, ${[...geo.comW.values()].filter((m) => m.size > 1).length} split communes`);

const missing = {}; // indicator → reason, when a whole source failed
const tryLoad = async (key, fn) => {
  console.log(`• ${key}`);
  try { return await fn(); } catch (e) { console.error(`  ✗ ${key}: ${e.message}`); missing[key] = e.message; return null; }
};
const population = await tryLoad("population", () => loadPopulation(cog));
const crime = await tryLoad("crime", () => loadCrime(cog));
const census = await tryLoad("unemploymentCensus", () => loadCensusUnemployment(cog));
const zones = await tryLoad("unemploymentQuarterly", () => loadZoneUnemployment(tag));
const filo = await tryLoad("income", () => loadFilosofi(cog));
const ofgl = await tryLoad("localSpending", () => loadOfgl(cog));
const schools = await tryLoad("schools", () => loadSchools(cog));
const popOf = (c) => population?.pop.get(c) ?? null;
const nameOf = (c) => cog.name(c) ?? tag.name.get(c) ?? null;

// schools → district: commune if it lies in one district, else the outline containing the school
const schoolsByDistrict = new Map();
if (schools) {
  let byPoint = 0, byShare = 0;
  for (const s of schools.schools) {
    const cand = geo.comW.get(s.commune) ?? geo.armW.get(s.commune);
    let d = null;
    if (cand?.size === 1) d = [...cand.keys()][0];
    else {
      d = locate(shapes, s.lon, s.lat, cand ? [...cand.keys()] : null);
      if (d) byPoint++;
      else if (cand) { d = [...cand].sort((a, b) => b[1].share - a[1].share)[0][0]; byShare++; }
    }
    if (!d) continue;
    if (!schoolsByDistrict.has(d)) schoolsByDistrict.set(d, []);
    schoolsByDistrict.get(d).push(s);
  }
  console.log(`  schools in split communes: ${byPoint} placed by outline, ${byShare} by largest share`);
}

const NA = (reason) => ({ status: "unavailable", reason });
const ABROAD = "French abroad district: the sources used here cover French communes only.";
const TERR = { "975": "Saint-Pierre-et-Miquelon", "977": "Saint-Barthélemy / Saint-Martin", "986": "Wallis-et-Futuna", "987": "Polynésie française", "988": "Nouvelle-Calédonie" };
const scalars = []; // per district, for index.json

console.log("• writing profiles");
const existing = new Set((await readdir(OUT)).filter((f) => /^\w+\.json$/.test(f) && f !== "index.json"));
for (const d of [...geo.districts.values()].sort((a, b) => (a.code < b.code ? -1 : 1))) {
  const cu = units.commune.get(d.code) ?? [];
  const uu = units.unit.get(d.code) ?? [];
  const abroad = d.dep === "99";
  const terrNote = TERR[d.dep] ? `${TERR[d.dep]} is an overseas collectivity outside the scope of most national statistics.` : null;
  const unitPop = (list) => list.reduce((a, u) => a + u.share * (popOf(u.code) ?? 0), 0);
  const profile = {
    code: d.code,
    label: d.label,
    department: { code: d.dep, name: d.depName },
    generated: TODAY,
    schemaVersion: 1,
    geography: {
      method: "Each commune (Paris, Lyon, Marseille: each arrondissement) is weighted by the share of its registered voters (inscrits) who voted in this district in the 1st round of the 2024 legislative election. Communes are converted to the INSEE COG 2026.",
      source: cite(SRC.bv),
      population: population && unitPop(uu) > 0 ? r0(unitPop(uu)) : null, // null: no INSEE population (abroad, Mayotte, COM)
      populationYear: population?.year ?? null,
      populationSource: cite(SRC.pop),
      inscrits2024: uu.reduce((a, u) => a + u.inscrits, 0),
      units: uu.sort((a, b) => b.share * (popOf(b.code) ?? 0) - a.share * (popOf(a.code) ?? 0)).map((u) => ({
        code: u.code, name: nameOf(u.code), share: r4(u.share), pop: r0(popOf(u.code)), inscrits: u.inscrits,
        ...(PLM_OF_ARM(u.code) && u.code !== PLM_OF_ARM(u.code) ? { parent: PLM_OF_ARM(u.code) } : {}),
        ...(u.share < 0.9999 ? { splitWith: [...(geo.comW.get(u.code) ?? geo.armW.get(u.code) ?? new Map()).keys()].filter((x) => x !== d.code) } : {}),
      })),
    },
    indicators: {},
    events: { file: `events/${d.code}.json` },
  };
  if (abroad) profile.geography.note = ABROAD;
  const I = profile.indicators;
  const S = { code: d.code };

  // crime
  if (abroad) I.crime = NA(ABROAD);
  else if (!crime) I.crime = NA(missing.crime);
  else {
    const { district, communes } = crimeForDistrict(crime, cu);
    const depRates = crime.byDep.get(d.dep) ?? null;
    I.crime = Object.keys(district).length ? {
      status: "ok", source: cite(SRC.crime, { file: crime.files.commune, documentation: SRC.crime.doc }), year: crime.year, geo: "commune",
      method: "count = Σ share × count over communes whose figures are published; rate = 1000 × count / Σ share × population (dwellings for burglary) of those communes; coverage = population behind that rate / district population; rateEstimated adds, for unpublished communes, the SSMSI average count of unpublished communes in the department. Paris, Lyon and Marseille are counted as whole cities (no arrondissement figures for these indicators).",
      indicators: crime.labels, district, communes,
      department: depRates ? { code: d.dep, year: crime.year, geo: "department", source: cite(SRC.crime, { file: crime.files.department }), values: depRates } : null,
    } : NA(terrNote ?? "No commune of this district appears in the SSMSI commune base.");
    for (const [k, v] of Object.entries(district)) S[`crime.${k}`] = v.rate;
  }

  // unemployment (census)
  if (abroad) I.unemploymentCensus = NA(ABROAD);
  else if (!census) I.unemploymentCensus = NA(missing.unemploymentCensus);
  else {
    let un = 0, ac = 0, covered = 0, total = 0;
    const communes = {};
    for (const u of uu) {
      const a = census.active.get(u.code), n = census.unemployed.get(u.code);
      total += u.share;
      if (a == null || n == null) continue;
      un += u.share * n; ac += u.share * a; covered += u.share;
      communes[u.code] = a ? r1((100 * n) / a) : null;
    }
    I.unemploymentCensus = ac ? {
      status: "ok", source: cite(SRC.census), year: census.year, geo: "commune (Paris, Lyon, Marseille: arrondissement)",
      definition: "Census unemployment rate of people aged 15–64 (self-declared, census definition — differs from the ILO rate). Census 2023 = annual surveys 2021–2025.",
      method: "rate = 100 × Σ share × unemployed / Σ share × labour force (15–64)",
      district: { rate: r1((100 * un) / ac), unemployed: r0(un), labourForce: r0(ac) },
      communes,
    } : NA(terrNote ?? "No census figures for this district's communes.");
    S["unemploymentCensus.rate"] = I.unemploymentCensus.district?.rate ?? null;
  }

  // unemployment (quarterly, employment zone + department)
  if (abroad) I.unemploymentQuarterly = NA(ABROAD);
  else if (!zones) I.unemploymentQuarterly = NA(missing.unemploymentQuarterly);
  else {
    const zp = new Map();
    for (const u of uu) {
      const z = tag.ze.get(u.code);
      if (!z) continue;
      zp.set(z, (zp.get(z) ?? 0) + u.share * (popOf(u.code) ?? 0));
    }
    const tot = [...zp.values()].reduce((a, b) => a + b, 0);
    const list = [...zp].map(([z, p]) => ({ code: z, name: zones.rates.get(z)?.name ?? null, popShare: tot ? r4(p / tot) : null, rate: zones.rates.get(z)?.rate ?? null })).sort((a, b) => b.popShare - a.popShare);
    const withRate = list.filter((z) => z.rate != null);
    const wsum = withRate.reduce((a, z) => a + z.popShare, 0);
    const depRate = zones.dep.get(d.dep) ?? null;
    I.unemploymentQuarterly = withRate.length || depRate != null ? {
      status: "ok", period: zones.period, definition: "INSEE localised unemployment rate (ILO definition, quarterly average, seasonally adjusted).",
      zones: { source: cite(SRC.tclZe, { file: zones.url }), period: zones.period, geo: "employment zone 2020", list },
      district: wsum ? { rate: r1(withRate.reduce((a, z) => a + z.popShare * z.rate, 0) / wsum), method: "Σ (population share of the district in each employment zone × zone rate). INSEE does not publish this rate for districts.", period: zones.period } : null,
      department: depRate != null ? { code: d.dep, rate: depRate, period: zones.depPeriod, geo: "department", source: cite(SRC.tclDep) } : null,
    } : NA(terrNote ?? "INSEE publishes no localised rate for this territory (Mayotte and French Guiana are excluded from the employment-zone file).");
    S["unemploymentQuarterly.rate"] = I.unemploymentQuarterly.district?.rate ?? null;
  }

  // income (Filosofi)
  if (abroad) I.income = NA(ABROAD);
  else if (!filo) I.income = NA(missing.income);
  else {
    const med = weightedMean(uu, (c) => filo.median.get(c) ?? null, popOf);
    const pov = weightedMean(uu, (c) => filo.poverty.get(c) ?? null, popOf);
    const communes = {};
    for (const u of uu) if (filo.median.has(u.code) || filo.poverty.has(u.code)) communes[u.code] = [filo.median.get(u.code) ?? null, filo.poverty.get(u.code) ?? null];
    I.income = med.value != null ? {
      status: "ok", source: cite(SRC.filo, { file: filo.file }), year: filo.year, geo: "commune (Paris, Lyon, Marseille: arrondissement)",
      definition: "Median standard of living (disposable income per consumption unit, € per year) and poverty rate (% of people below 60 % of the metropolitan median).",
      method: "Population-weighted mean of commune values: Σ share × population × value / Σ share × population over communes with a value. A mean of medians is an approximation, not the district's true median (INSEE does not publish district figures).",
      columns: ["medianIncome", "povertyRate"],
      district: { medianIncomeApprox: r0(med.value), povertyRateApprox: r1(pov.value), coverage: r4(med.coverage), povertyCoverage: r4(pov.coverage) },
      communes,
    } : NA(terrNote ?? "Filosofi covers metropolitan France and La Réunion only.");
    S["income.median"] = I.income.district?.medianIncomeApprox ?? null;
    S["income.poverty"] = I.income.district?.povertyRateApprox ?? null;
  }

  // local public spending (OFGL)
  if (abroad) I.localSpending = NA(ABROAD);
  else if (!ofgl) I.localSpending = NA(missing.localSpending);
  else {
    const agg = { ptot: 0 };
    const communes = {};
    let covered = 0, total = 0;
    for (const u of cu) {
      const e = ofgl.byCommune.get(u.code);
      total += u.share * (popOf(u.code) ?? 0);
      if (!e || !e.ptot) continue;
      covered += u.share * (popOf(u.code) ?? 0);
      agg.ptot += u.share * e.ptot;
      for (const [, k] of SPENDING) agg[k] = (agg[k] ?? 0) + u.share * (e[k] ?? 0);
      communes[u.code] = SPENDING.map(([, k]) => r0(e[k] != null ? e[k] / e.ptot : null));
    }
    // intercommunal set ("ensemble intercommunal" = communes + their EPCI/EPT, cross flows neutralised)
    const eiShares = new Map();
    for (const u of cu) {
      // EPT (Greater Paris) → the commune itself when it is a set of its own (Paris, islands) → its EPCI; never the
      // Métropole du Grand Paris set (131 communes), which would hide the EPT level
      const sir = [tag.ept.get(u.code), ofgl.sirenOf.get(u.code), tag.epci.get(u.code)].find((k) => k && ofgl.ei.has(k) && ofgl.ei.get(k).type !== "MGP") ?? null;
      if (!sir) continue;
      eiShares.set(sir, (eiShares.get(sir) ?? 0) + u.share * (popOf(u.code) ?? 0));
    }
    const eiTot = [...eiShares.values()].reduce((a, b) => a + b, 0);
    const eiList = [...eiShares].map(([sir, p]) => ({ siren: sir, name: ofgl.ei.get(sir).name, type: ofgl.ei.get(sir).type, popShare: r4(p / eiTot), perCapita: perCapita(ofgl.ei.get(sir)) })).sort((a, b) => b.popShare - a.popShare);
    const eiDistrict = eiTot ? Object.fromEntries(SPENDING.map(([, k]) => [k, r0(eiList.reduce((a, e) => a + e.popShare * (e.perCapita?.[k] ?? 0), 0))])) : null;
    const regCode = tag.reg.get(cu[0]?.code);
    const depE = ofgl.dep.get(d.dep);
    const regE = ofgl.reg.get(regCode);
    I.localSpending = agg.ptot ? {
      status: "ok", year: ofgl.year, unit: "€ per inhabitant (OFGL/DGF total population)",
      items: Object.fromEntries(SPENDING.map(([fr, k, en]) => [k, { fr, en }])),
      communes: {
        source: cite(SRC.ofglCom), year: ofgl.year, geo: "commune",
        method: "per inhabitant = Σ share × amount / Σ share × population over communes with published accounts (principal + annex budgets, consolidated). Paris's accounts include its département functions.",
        district: Object.fromEntries(SPENDING.map(([, k]) => [k, r0(agg[k] / agg.ptot)])),
        coverage: total ? r4(covered / total) : null,
        columns: SPENDING.map(([, k]) => k),
        values: communes,
      },
      intercommunal: eiDistrict ? {
        source: cite(SRC.ofglEi), year: ofgl.year, geo: "intercommunal set (EPCI or EPT territory)",
        method: "Population-weighted mean of the per-inhabitant figures of the intercommunal sets the district's communes belong to. Each set = its communes + the groupement, flows between them removed (the best measure of the 'bloc communal').",
        district: eiDistrict, list: eiList,
      } : null,
      department: depE ? { source: cite(SRC.ofglDep), year: ofgl.year, geo: "department", code: d.dep, name: depE.name, perCapita: perCapita(depE) } : null,
      region: regE ? { source: cite(SRC.ofglReg), year: ofgl.year, geo: "region", code: regCode, name: regE.name, perCapita: perCapita(regE) } : null,
    } : NA(terrNote ?? "No OFGL accounts for this district's communes.");
    S["localSpending.commune.total"] = I.localSpending.communes?.district.total ?? null;
    S["localSpending.intercommunal.total"] = I.localSpending.intercommunal?.district.total ?? null;
  }

  I.stateSpending = NA("The State does not publish its spending broken down by commune, district or department (budget execution is published by mission and programme at national level). The only sub-national State money in open data is what it transfers to local authorities — see localSpending.*.stateTransfers (DGF and other grants, OFGL) — which is a local receipt, not State spending in the territory. No approximation is made.");

  // schools
  if (abroad) I.schools = NA(ABROAD);
  else if (!schools) I.schools = NA(missing.schools);
  else {
    const list = (schoolsByDistrict.get(d.code) ?? []).sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : 1));
    const col = list.filter((s) => s.type === "college");
    const lyc = list.filter((s) => s.type === "lycee");
    const mean = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const ipsC = col.map((s) => s.ips?.value).filter((x) => x != null);
    I.schools = {
      status: list.length ? "ok" : "empty", geo: "school (located by commune, or by its coordinates in communes split between districts)",
      years: schools.years,
      sources: { directory: cite(SRC.annuaire), ipsCollege: cite(SRC.ipsCol), ipsLycee: cite(SRC.ipsLyc), dnb: cite(SRC.ivac), bacGT: cite(SRC.ivalGt), bacPro: cite(SRC.ivalPro) },
      note: "Indicators as published by the ministry (IPS = social position index of pupils' families; VA = value added: observed minus expected result given the pupils' profile). The ministry publishes no ranking and none is computed here.",
      summary: {
        colleges: col.length, collegesPublic: col.filter((s) => s.sector === "public").length, lycees: lyc.length, lyceesPublic: lyc.filter((s) => s.sector === "public").length,
        ipsCollegeMean: mean(ipsC), ipsCollegeMin: ipsC.length ? Math.min(...ipsC) : null, ipsCollegeMax: ipsC.length ? Math.max(...ipsC) : null,
        dnbSuccessMean: mean(col.map((s) => s.dnb?.successRate).filter((x) => x != null)),
      },
      list,
    };
    S["schools.ipsCollegeMean"] = I.schools.summary.ipsCollegeMean;
  }

  S.population = profile.geography.population;
  scalars.push(S);
  await writeFile(new URL(`${d.code}.json`, OUT), JSON.stringify(profile));
  existing.delete(`${d.code}.json`);
}
for (const f of existing) await unlink(new URL(f, OUT)); // districts that no longer exist

// index.json: national distribution of each district-level indicator
const KEYS = Object.keys(Object.assign({}, ...scalars)).filter((k) => k !== "code");
const labelOf = (k) => {
  if (k.startsWith("crime.")) { const l = crime?.labels[k.slice(6)]; return { fr: l?.fr, en: l?.en, unit: `per ${l?.per}`, year: crime?.year }; }
  return {
    "unemploymentCensus.rate": { en: "Unemployment rate, census (15–64)", fr: "Taux de chômage au recensement (15-64 ans)", unit: "%", year: census?.year },
    "unemploymentQuarterly.rate": { en: "Localised unemployment rate (employment zones)", fr: "Taux de chômage localisé (zones d'emploi)", unit: "%", year: zones?.period },
    "income.median": { en: "Median standard of living (approx.)", fr: "Niveau de vie médian (approché)", unit: "€/year", year: filo?.year },
    "income.poverty": { en: "Poverty rate (approx.)", fr: "Taux de pauvreté (approché)", unit: "%", year: filo?.year },
    "localSpending.commune.total": { en: "Commune spending per inhabitant", fr: "Dépenses des communes par habitant", unit: "€", year: ofgl?.year },
    "localSpending.intercommunal.total": { en: "Bloc communal spending per inhabitant", fr: "Dépenses du bloc communal par habitant", unit: "€", year: ofgl?.year },
    "schools.ipsCollegeMean": { en: "Mean IPS of collèges", fr: "IPS moyen des collèges", unit: "index", year: schools?.years.ipsCollege },
    population: { en: "Population", fr: "Population", unit: "inhabitants", year: population?.year },
  }[k] ?? { en: k };
};
const index = {
  generated: TODAY,
  schemaVersion: 1,
  districts: [...geo.districts.keys()].sort(),
  note: "Distribution across districts (unweighted: each district counts once). `national` is the official national figure when one is published.",
  indicators: Object.fromEntries(KEYS.map((k) => {
    const q = quantiles(scalars.map((s) => s[k]));
    return [k, { ...labelOf(k), ...(q && { n: q.n, min: r2(q.min), median: r2(q.median), deciles: q.deciles.map(r2), max: r2(q.max) }) }];
  })),
  national: {
    crime: crime ? { year: crime.year, geo: "France (sum of departments)", source: cite(SRC.crime, { file: crime.files.department }), rates: Object.fromEntries(Object.entries(crime.national).map(([k, v]) => [k, r2(v.rate)])) } : null,
    unemploymentCensus: census ? { year: census.year, ages: "15-64", france: r1(census.national.F), metropolitan: r1(census.national.FM), source: cite(SRC.census) } : null,
    unemploymentQuarterly: zones?.france ? { period: zones.depPeriod, area: zones.france.area === "FE" ? "France excluding Mayotte" : "Metropolitan France", rate: zones.france.rate, source: cite(SRC.tclDep) } : null,
    income: filo ? { year: filo.year, geo: "Metropolitan France", median: filo.national.MED_SL ?? null, povertyRate: filo.national.PR_MD60 ?? null, source: cite(SRC.filo) } : null,
    schools: schools ? { years: schools.years, ...schools.national, source: cite(SRC.ipsCol) } : null,
  },
  missing,
};
await writeFile(new URL("index.json", OUT), JSON.stringify(index, null, 1));
console.log(`✓ ${geo.districts.size} district profiles → public/data/districts/`);

if (!ARGS.has("--no-events")) {
  console.log("• events");
  try { await buildEvents(shapes, index.districts); } catch (e) { console.error(`  ✗ events: ${e.message}`); }
}
