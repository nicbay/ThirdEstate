// "My neighbourhood": one public-data file per French commune (and per arrondissement of Paris, Lyon, Marseille).
//
//   node scripts/sync-communes.mjs                         build every source part, then write the files
//   node scripts/sync-communes.mjs --only=rne,dvf          rebuild only these parts (others are read from .cache), then write
//   node scripts/sync-communes.mjs --assemble              only write the files from the cached parts
//   node scripts/sync-communes.mjs --refresh               ignore the download cache (re-download sources)
//   node scripts/sync-communes.mjs --codes=84007,75104     write only these commune files (index/sources are still written)
//
// Parts (sources): base, districts, rne, monuments, museums, libraries, sports, apl, fibre, dvf, wikidata, wikipedia.
// Downloads and intermediate parts are cached in .cache/communes/ (gitignored); Wikimedia answers are memoised there
// per batch, so a rerun does not hit Wikidata/Commons/Wikipedia again.
//
// Output (schema, sources, method and gaps: docs/data-communes.md):
//   public/data/communes/<INSEE code>.json   one file per commune (COG 2026) and per PLM arrondissement
//   public/data/communes/index.json          compact search index
//   public/data/communes/sources.json        source registry (name, url, licence, year…) and indicator definitions
//
// Only free official sources (+ Wikidata / Wikimedia Commons / Wikipedia for the photo and description, with their
// licence and author recorded). Nothing is invented: a missing value is { status: "unavailable", reason }.

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readSheet, sheetNames } from "./lib/xlsx.mjs";
import { parseCsv, csvObjects, num } from "./lib/csv.mjs";
import { makeCogResolver, PLM_OF_ARM } from "./lib/district-geo.mjs";
import { makeCache, fetchRetry, throttle, sleep } from "./lib/http-cache.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/communes/", ROOT);
const DISTRICTS = new URL("public/data/districts/", ROOT);
const CACHE = new URL(".cache/communes/", ROOT);
const PARTS = new URL("parts/", CACHE);
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const REFRESH = flag("refresh");
const ASSEMBLE_ONLY = flag("assemble");
const ONLY = opt("only")?.split(",").filter(Boolean) ?? null;
const CODES = opt("codes")?.split(",").filter(Boolean) ?? null;
const TODAY = new Date().toISOString().slice(0, 10);
const C = makeCache(CACHE, { refresh: REFRESH });
const SCHEMA_VERSION = 1;

const LO = "Licence Ouverte / Open Licence v2.0 (Etalab)";
const LO_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";

// ---------- small helpers ----------
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const r0 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\bSAINTE?\b/g, (m) => (m === "SAINT" ? "ST" : "STE")).replace(/[^A-Z0-9]/g, "");
const NA = (reason) => ({ status: "unavailable", reason });
const median = (arr) => {
  if (!arr.length) return null;
  const a = Float64Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const titleCaseName = (s) => s.toLowerCase().replace(/(^|[\s'’\-])(\p{L})/gu, (m, p, l) => p + l.toUpperCase());
const person = (first, last) => `${first.trim()} ${last.trim()}`.replace(/\s+/g, " ");

async function readPart(name) {
  try {
    return JSON.parse(await readFile(new URL(`${name}.json`, PARTS), "utf8"));
  } catch {
    return null;
  }
}
async function writePart(name, part) {
  await mkdir(PARTS, { recursive: true });
  await writeFile(new URL(`${name}.json`, PARTS), JSON.stringify(part));
}

// data.gouv.fr dataset → latest resource whose title/url matches `re`
async function dgResource(datasetId, re) {
  const j = await C.cachedJson(`dg-${datasetId}.json`, `https://www.data.gouv.fr/api/1/datasets/${datasetId}/`, { maxAgeH: 24 });
  const res = j.resources.filter((r) => re.test(r.title) || re.test(r.url));
  res.sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1));
  if (!res.length) throw new Error(`no resource ${re} in dataset ${datasetId}`);
  return { dataset: j, resource: res[0], page: `https://www.data.gouv.fr/datasets/${j.slug}` };
}

let cogResolver = null;
async function cog() {
  if (cogResolver) return cogResolver;
  const base = "https://www.insee.fr/fr/statistiques/fichier/8740222/";
  cogResolver = makeCogResolver(
    csvObjects(await C.cachedText("v_commune_2026.csv", base + "v_commune_2026.csv")),
    csvObjects(await C.cachedText("v_mvt_commune_2026.csv", base + "v_mvt_commune_2026.csv")),
  );
  return cogResolver;
}

// =====================================================================================
// Part builders. Each returns { sources: { key: {...} }, data: { code: … }, meta?: … }
// =====================================================================================

// ---------- base: COG list, names, postcodes, centroids, population, districts, cantons ----------
async function buildBase() {
  const base = "https://www.insee.fr/fr/statistiques/fichier/8740222/";
  const communes = csvObjects(await C.cachedText("v_commune_2026.csv", base + "v_commune_2026.csv"));
  const cantons = csvObjects(await C.cachedText("v_canton_2026.csv", base + "v_canton_2026.csv"));
  const deps = csvObjects(await C.cachedText("v_departement_2026.csv", base + "v_departement_2026.csv"));
  const regs = csvObjects(await C.cachedText("v_region_2026.csv", base + "v_region_2026.csv"));
  const fields = "code,nom,codesPostaux,centre,population,codeDepartement,codeRegion";
  const geo = await C.cachedJson("geoapi-communes.json", `https://geo.api.gouv.fr/communes?fields=${fields}&format=json`);
  const geoArm = await C.cachedJson("geoapi-arm.json", `https://geo.api.gouv.fr/communes?type=arrondissement-municipal&fields=${fields}&format=json`);
  const geoBy = new Map([...geo, ...geoArm].map((g) => [g.code, g]));

  // district profiles: commune → districts (share), population
  const units = new Map(); // code → { pop, districts: [{code, share}] }
  let popSource = null;
  let popYear = null;
  for (const f of await readdir(DISTRICTS)) {
    if (!/^\w+\.json$/.test(f) || f === "index.json") continue;
    const d = JSON.parse(await readFile(new URL(f, DISTRICTS), "utf8"));
    popSource ??= d.geography?.populationSource;
    popYear ??= d.geography?.populationYear;
    for (const u of d.geography?.units ?? []) {
      if (!units.has(u.code)) units.set(u.code, { pop: u.pop ?? null, districts: [] });
      units.get(u.code).districts.push({ code: d.code, share: u.share });
    }
  }

  const depName = Object.fromEntries(deps.map((r) => [r.DEP, r.LIBELLE]));
  const regName = Object.fromEntries(regs.map((r) => [r.REG, r.LIBELLE]));
  const canton = Object.fromEntries(cantons.map((r) => [r.CAN, { name: r.LIBELLE, type: r.TYPECT, bur: r.BURCENTRAL, dep: r.DEP }]));
  const cantonsByBur = new Map();
  for (const r of cantons) if (r.TYPECT === "C") {
    if (!cantonsByBur.has(r.BURCENTRAL)) cantonsByBur.set(r.BURCENTRAL, []);
    cantonsByBur.get(r.BURCENTRAL).push(r.CAN);
  }

  const data = {};
  const arms = new Map();
  for (const r of communes) if (r.TYPECOM === "ARM") {
    if (!arms.has(r.COMPARENT)) arms.set(r.COMPARENT, []);
    arms.get(r.COMPARENT).push(r.COM);
  }
  for (const r of communes) {
    if (r.TYPECOM !== "COM" && r.TYPECOM !== "ARM") continue;
    const parentRow = r.TYPECOM === "ARM" ? communes.find((x) => x.COM === r.COMPARENT && x.TYPECOM === "COM") : null;
    const g = geoBy.get(r.COM);
    const u = units.get(r.COM);
    const e = {
      name: r.LIBELLE,
      type: r.TYPECOM === "ARM" ? "arrondissement" : "commune",
      dep: r.DEP || parentRow?.DEP,
      reg: r.REG || parentRow?.REG,
      ctcd: r.CTCD || parentRow?.CTCD || null,
      postcodes: g?.codesPostaux ?? [],
      centroid: g?.centre?.coordinates ?? null,
      pop: u?.pop ?? null,
      popFrom: u?.pop != null ? "insee" : null,
      districts: u?.districts ?? [],
    };
    if (e.pop == null && g?.population != null) {
      e.pop = g.population;
      e.popFrom = "geoapi";
    }
    if (r.TYPECOM === "ARM") e.parent = r.COMPARENT;
    if (arms.has(r.COM)) e.arrondissements = arms.get(r.COM);
    // cantons
    const can = r.CAN || parentRow?.CAN;
    if (can && canton[can]?.type === "C") e.cantons = [can];
    else if (can && canton[can]) e.cantons = cantonsByBur.get(r.TYPECOM === "ARM" ? r.COMPARENT : r.COM) ?? [];
    else e.cantons = [];
    e.cantonMulti = !!(can && canton[can] && canton[can].type !== "C");
    data[r.COM] = e;
  }
  // PLM cities: districts and population from their arrondissements
  for (const [city, list] of arms) {
    const c = data[city];
    if (!c) continue;
    const w = new Map();
    let pop = 0;
    for (const a of list) {
      const ad = data[a];
      pop += ad?.pop ?? 0;
      for (const d of ad?.districts ?? []) w.set(d.code, (w.get(d.code) ?? 0) + d.share * (ad.pop ?? 0));
    }
    if (pop) {
      c.pop = c.pop ?? pop;
      c.popFrom = c.popFrom ?? "insee";
      c.districts = [...w].map(([code, v]) => ({ code, share: r3(v / pop) })).sort((a, b) => b.share - a.share);
      c.districtsMethod = "population of each arrondissement × its district share";
    }
  }
  return {
    sources: {
      cog: { name: "INSEE — Code officiel géographique (COG) 2026 : communes, arrondissements municipaux, cantons", url: "https://www.insee.fr/fr/information/8740222", licence: LO, year: 2026 },
      geoapi: { name: "API Découpage administratif (geo.api.gouv.fr) — codes postaux (La Poste) et centre des communes (IGN Admin Express)", url: "https://geo.api.gouv.fr/decoupage-administratif", licence: LO, retrieved: TODAY },
      population: { ...(popSource ?? {}), year: popYear, note: "Population municipale, as used in public/data/districts. Missing communes fall back to geo.api.gouv.fr (latest legal population)." },
      districtsMap: { name: "Commune → legislative district shares, built in public/data/districts from the Ministère de l'Intérieur 2024 polling-station results", url: "https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour", licence: LO, year: 2024, doc: "docs/data-district-profiles.md" },
    },
    data,
    meta: { depName, regName, canton },
  };
}

// ---------- districts: commune values already in public/data/districts/<code>.json ----------
async function buildDistricts() {
  const data = {};
  const depCrime = {};
  const depUnemp = {};
  const src = {};
  let crimeDefs = null;
  let spendingItems = null;
  let years = {};
  const put = (code, k, v) => ((data[code] ??= {})[k] = v);
  for (const f of await readdir(DISTRICTS)) {
    if (!/^\w+\.json$/.test(f) || f === "index.json") continue;
    const d = JSON.parse(await readFile(new URL(f, DISTRICTS), "utf8"));
    const I = d.indicators ?? {};
    if (I.crime?.status === "ok") {
      crimeDefs ??= I.crime.indicators;
      src.crime ??= { ...I.crime.source, year: I.crime.year, method: "Commune values as published by SSMSI (count, rate per 1,000 inhabitants; burglary per 1,000 dwellings). Paris, Lyon and Marseille: whole city." };
      years.crime = I.crime.year;
      for (const [c, v] of Object.entries(I.crime.communes ?? {})) put(c, "crime", v);
      if (I.crime.department) depCrime[I.crime.department.code] = I.crime.department;
    }
    if (I.unemploymentCensus?.status === "ok") {
      src.census ??= { ...I.unemploymentCensus.source, year: I.unemploymentCensus.year, definition: I.unemploymentCensus.definition };
      for (const [c, v] of Object.entries(I.unemploymentCensus.communes ?? {})) put(c, "census", v);
    }
    const q = I.unemploymentQuarterly;
    if (q?.status === "ok" && q.department) {
      src.ilo ??= { ...q.department.source, definition: q.definition };
      depUnemp[q.department.code] = { rate: q.department.rate, period: q.department.period };
    }
    if (I.income?.status === "ok") {
      src.filosofi ??= { ...I.income.source, year: I.income.year, definition: I.income.definition };
      for (const [c, v] of Object.entries(I.income.communes ?? {})) put(c, "income", v);
    }
    const ls = I.localSpending;
    if (ls?.status === "ok" && ls.communes) {
      spendingItems ??= ls.items;
      src.ofgl ??= { ...ls.communes.source, year: ls.communes.year, unit: ls.unit };
      const cols = ls.communes.columns;
      for (const [c, v] of Object.entries(ls.communes.values ?? {})) put(c, "spending", Object.fromEntries(cols.map((k, i) => [k, v[i]])));
    }
    if (I.schools?.status === "ok" || I.schools?.status === "empty") {
      src.schools ??= { name: "Éducation nationale — Annuaire de l'éducation, IPS, IVAC (DNB), IVAL (bac)", url: I.schools.sources?.directory?.url, licence: LO, years: I.schools.years, sources: I.schools.sources, note: I.schools.note };
      for (const s of I.schools.list ?? []) {
        const e = { uai: s.uai, name: s.name, type: s.type, sector: s.sector };
        if (s.priorityEducation) e.priorityEducation = s.priorityEducation;
        if (s.ips?.value != null) e.ips = s.ips.value;
        if (s.dnb?.successRate != null) e.dnbSuccess = s.dnb.successRate;
        if (s.bacGT?.successRate != null) e.bacGTSuccess = s.bacGT.successRate;
        if (s.bacPro?.successRate != null) e.bacProSuccess = s.bacPro.successRate;
        const list = ((data[s.commune] ??= {}).schools ??= []);
        if (!list.some((x) => x.uai === s.uai)) list.push(e);
      }
    }
  }
  return {
    sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { ...v, via: "public/data/districts (scripts/sync-district-profiles.mjs)" }])),
    data,
    meta: { depCrime, depUnemp, crimeDefs, spendingItems },
  };
}

// ---------- RNE: elected officials ----------
async function buildRne() {
  const ds = "5c34c4d1634f4173183a64f1";
  const files = {
    cm: /conseiller-municipal|conseillers-municipaux/,
    mai: /elus-maire|maires-mai/,
    cd: /conseiller-departemental|conseillers-departementaux/,
    cr: /conseiller-regional|conseillers-regionaux/,
    sen: /senateur/,
    ca: /conseiller-darrondissement|conseillers-darrondissements/,
    ma: /membre-dune-assemblee|membres-assemblee/,
  };
  const R = {};
  let page = null;
  for (const [k, re] of Object.entries(files)) {
    const { resource, page: p } = await dgResource(ds, re);
    page = p;
    R[k] = { url: resource.url, updated: resource.last_modified?.slice(0, 10), rows: csvObjects(await C.cachedText(`rne-${k}.csv`, resource.url), ";") };
  }
  const resolve = (await cog()).resolve;
  const F = { dep: "Code du département", com: "Code de la commune", last: "Nom de l'élu", first: "Prénom de l'élu", fn: "Libellé de la fonction", fnStart: "Date de début de la fonction", start: "Date de début du mandat", can: "Code du canton", canName: "Libellé du canton", reg: "Code de la région", regName: "Libellé de la région", sec: "Code de la section départementale", sector: "Libellé du secteur", csp: "Code de la collectivité à statut particulier" };
  // only public-role fields: name, function, mandate/function start. (Birth date, sex, profession, nationality are not kept.)
  const rank = (fn) => {
    if (!fn) return 1000;
    if (/^Maire$/i.test(fn) || /^Président/i.test(fn) || /^Maire d.arrondissement/i.test(fn)) return 0;
    if (/^Maire délégué/i.test(fn)) return 500;
    const m = fn.match(/^(\d+)/);
    return m ? Number(m[1]) : 900;
  };
  const sortElus = (a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, "fr");
  const elu = (r) => {
    const e = { name: person(r[F.first], r[F.last]) };
    if (r[F.fn]) e.role = r[F.fn];
    return e;
  };

  const data = {};
  const get = (c) => (data[c] ??= {});
  // municipal councillors
  for (const r of R.cm.rows) {
    const c = resolve(r[F.com]) ?? r[F.com];
    (get(c).council ??= []).push({ ...elu(r), since: r[F.start] || undefined });
  }
  for (const v of Object.values(data)) v.council?.sort(sortElus);
  // mayors
  for (const r of R.mai.rows) {
    const c = resolve(r[F.com]) ?? r[F.com];
    get(c).mayor = { name: person(r[F.first], r[F.last]), since: r[F.fnStart] || r[F.start] || null };
  }
  // arrondissement councils (PLM sectors)
  const sectors = {};
  for (const r of R.ca.rows) (sectors[r[F.sector]] ??= { city: r[F.com], list: [] }).list.push(elu(r));
  for (const s of Object.values(sectors)) s.list.sort(sortElus);
  // departmental councillors by canton; president by department
  const cantons = {};
  const depPresident = {};
  for (const r of R.cd.rows) {
    (cantons[r[F.can]] ??= { name: r[F.canName], list: [] }).list.push(elu(r));
    if (/^Président du conseil départemental/i.test(r[F.fn])) depPresident[r[F.dep]] = person(r[F.first], r[F.last]);
  }
  for (const s of Object.values(cantons)) s.list.sort(sortElus);
  // regional councillors
  const regions = {};
  for (const r of R.cr.rows) {
    const g = (regions[r[F.reg]] ??= { name: r[F.regName], count: 0, president: null, sections: {} });
    g.count++;
    if (/^Président du conseil régional/i.test(r[F.fn]) || /^Président de l'assemblée/i.test(r[F.fn])) g.president = person(r[F.first], r[F.last]);
    (g.sections[r[F.sec]] ??= { name: r["Libellé de la section départementale"], list: [] }).list.push(elu(r));
  }
  for (const g of Object.values(regions)) for (const s of Object.values(g.sections)) s.list.sort(sortElus);
  // senators by department
  const senators = {};
  for (const r of R.sen.rows) (senators[r[F.dep]] ??= []).push({ name: person(r[F.first], r[F.last]), since: r[F.start] || null });
  for (const s of Object.values(senators)) s.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  // single assemblies (Corse, Martinique, Guyane), Métropole de Lyon council, overseas collectivities
  const assemblies = {};
  for (const r of R.ma.rows) {
    const k = r[F.csp];
    if (!k) continue;
    const g = (assemblies[k] ??= { name: r["Libellé de la collectivité à statut particulier"], count: 0, president: null, executive: null, list: [] });
    g.count++;
    if (/^Président de l'assemblée/i.test(r[F.fn])) g.president = person(r[F.first], r[F.last]);
    if (/^Président de l'organe exécutif/i.test(r[F.fn])) g.executive = person(r[F.first], r[F.last]);
    g.list.push(elu(r));
  }
  for (const g of Object.values(assemblies)) g.list.sort(sortElus);

  const updated = Object.values(R).map((x) => x.updated).sort().pop();
  return {
    sources: {
      rne: {
        name: "Ministère de l'Intérieur — Répertoire national des élus (RNE)", url: page, licence: LO, updated,
        files: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.url])),
        note: "Only public-role fields are kept (name, function, start of mandate/function). The RNE does not publish political lists or nuances.",
      },
    },
    data,
    meta: { sectors, cantons, depPresident, regions, senators, assemblies },
  };
}

// ---------- monuments historiques (Mérimée) ----------
async function buildMonuments() {
  const { resource, page } = await dgResource("5af120e5b595087cfabcde81", /\.csv$/);
  const rows = parseCsv(await C.cachedText("merimee.csv", resource.url), "|");
  const h = rows[0];
  const ix = (n) => h.indexOf(n);
  const I = { ref: ix("Reference"), cog: ix("COG_Insee_lors_de_la_protection"), tit: ix("Titre_editorial_de_la_notice"), den: ix("Denomination_de_l_edifice"), prot: ix("Typologie_de_la_protection"), typ: ix("Typologie_du_dossier") };
  const resolve = (await cog()).resolve;
  const data = {};
  let skipped = 0;
  for (const r of rows.slice(1)) {
    if (/renvoi/i.test(r[I.typ] ?? "")) continue; // cross-reference notices, not monuments
    const codes = [...new Set(String(r[I.cog] ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((c) => resolve(c) ?? null).filter(Boolean))];
    if (!codes.length) { skipped++; continue; }
    const prot = String(r[I.prot] ?? "");
    const level = /class/i.test(prot) ? "classé" : /inscrit/i.test(prot) ? "inscrit" : null;
    const m = { ref: r[I.ref], name: (r[I.tit] || r[I.den] || "").trim(), level };
    if (/partiel/i.test(prot) && !/protection totale/i.test(prot) && !/^(classé|inscrit) MH$/.test(prot.split(";")[0])) m.partial = true;
    for (const c of codes) (data[c] ??= []).push(m);
  }
  return {
    sources: { merimee: { name: "Ministère de la Culture — Immeubles protégés au titre des Monuments historiques (base Mérimée)", url: page, file: resource.url, licence: LO, updated: resource.last_modified?.slice(0, 10), noticeUrl: "https://pop.culture.gouv.fr/notice/merimee/{ref}" } },
    data,
    meta: { skipped },
  };
}

// ---------- museums (Muséofile: Musées de France) ----------
async function buildMuseums(base) {
  const { resource, page } = await dgResource("5d12ee8206e3e762c0c89a4c", /museofile|\.csv$/);
  const rows = csvObjects(await C.cachedText("museofile.csv", resource.url), "|");
  // Muséofile has no INSEE code: locate by postcode + town name, else nearest centroid among the postcode's communes
  const byPostcode = new Map();
  for (const [code, e] of Object.entries(base.data)) {
    if (e.arrondissements) continue; // PLM: use arrondissements
    for (const p of e.postcodes) {
      if (!byPostcode.has(p)) byPostcode.set(p, []);
      byPostcode.get(p).push(code);
    }
  }
  const nameKey = (s) => norm(s).replace(/(\d+)(ER|E|EME)?ARRONDISSEMENT$/, "");
  const data = {};
  let unmatched = 0;
  const how = { name: 0, single: 0, nearest: 0 };
  for (const r of rows) {
    const cands = byPostcode.get(r.Code_postal) ?? [];
    let code = null;
    const town = nameKey(r.Ville);
    const named = cands.filter((c) => nameKey(base.data[c].name) === town || nameKey(base.data[c].parent ? base.data[base.data[c].parent].name : "") === town);
    if (named.length === 1) { code = named[0]; how.name++; }
    else if (cands.length === 1) { code = cands[0]; how.single++; }
    else {
      const [lat, lon] = String(r.Coordonnees).split(",").map(Number);
      const pool = (named.length ? named : cands).filter((c) => base.data[c].centroid);
      if (Number.isFinite(lat) && pool.length) {
        pool.sort((a, b) => dist(base.data[a].centroid, lon, lat) - dist(base.data[b].centroid, lon, lat));
        code = pool[0];
        how.nearest++;
      }
    }
    if (!code) {
      // postcode unknown (CEDEX, typo): same town name in the department, else nearest commune centre in the department
      const dep = /^97/.test(r.Code_postal) ? r.Code_postal.slice(0, 3) : r.Code_postal.startsWith("20") ? null : r.Code_postal.slice(0, 2);
      const pool = Object.entries(base.data).filter(([, e]) => !e.arrondissements && (dep ? e.dep === dep : /^2[AB]$/.test(e.dep)));
      const byName = pool.filter(([, e]) => nameKey(e.name) === town);
      const [lat, lon] = String(r.Coordonnees).split(",").map(Number);
      if (byName.length === 1) { code = byName[0][0]; how.name++; }
      else if (Number.isFinite(lat) && pool.length) {
        const cand = (byName.length ? byName : pool).filter(([, e]) => e.centroid).sort((a, b) => dist(a[1].centroid, lon, lat) - dist(b[1].centroid, lon, lat))[0];
        if (cand && dist(cand[1].centroid, lon, lat) < 0.01) { code = cand[0]; how.nearest++; } // within ~10 km
      }
    }
    if (!code) { unmatched++; continue; }
    const m = { id: r.Identifiant, name: r.Nom_officiel.trim() };
    if (r.URL) m.url = /^https?:/.test(r.URL) ? r.URL : `https://${r.URL.replace(/^\/+/, "")}`;
    (data[code] ??= []).push(m);
  }
  return {
    sources: { museofile: { name: "Ministère de la Culture — Répertoire des Musées de France (base Muséofile)", url: page, file: resource.url, licence: LO, updated: resource.last_modified?.slice(0, 10), noticeUrl: "https://pop.culture.gouv.fr/notice/museo/{id}", method: "The file has no INSEE code: each museum is placed by its postcode and town name; when a postcode covers several communes, or is unknown, by the commune whose centre is nearest to the museum coordinates (within the department, ~10 km)." } },
    data,
    meta: { unmatched, how },
  };
}
const dist = ([x, y], lon, lat) => (x - lon) ** 2 + ((y - lat) * 1.4) ** 2;

// ---------- public libraries (Ministère de la Culture, SLL) ----------
async function buildLibraries() {
  const { resource, page, dataset } = await dgResource("5c3538da9ce2e7459c6d765a", /adresses-des-bibliotheques-publiques\.csv|\.csv$/);
  const rows = csvObjects(await C.cachedText("bibliotheques.csv", resource.url), ";");
  const resolve = (await cog()).resolve;
  const data = {};
  let kept = 0;
  for (const r of rows) {
    if (r.type_adresse !== "Bâtiment ouvert") continue; // open premises only (not administrative sites, reserves, bookmobiles)
    if (/^(Département|Bibliothèque départementale)/i.test(r.Statut)) continue; // county lending services serve libraries, not the public
    const c = resolve(r.code_insee_commune);
    if (!c) continue;
    kept++;
    (data[c] ??= []).push(r.nom_de_l_etablissement.trim());
  }
  return {
    sources: { libraries: { name: "Ministère de la Culture (Service du livre et de la lecture) — Les bibliothèques des collectivités territoriales : adresses et données d'activité", url: page, file: resource.url, licence: dataset.license === "lov2" ? LO : dataset.license, updated: resource.last_modified?.slice(0, 10), method: "Libraries whose address type is 'Bâtiment ouvert' (open to the public); county lending services (bibliothèques départementales) excluded." } },
    data,
    meta: { kept },
  };
}

// ---------- sports facilities (Data ES) ----------
async function buildSports() {
  const ods = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/data-es-recensement-des-equipements-sportifs-et-lieux-de-pratique-complet";
  const q = new URLSearchParams({ select: "count(*) as n", group_by: "new_code,equip_type_famille", where: 'not inst_hs_bool = "Oui"' });
  const rows = await C.cachedJson("dataes-groups.json", `${ods}/exports/json?${q}`);
  const meta = await C.cachedJson("dataes-meta.json", ods, { maxAgeH: 24 });
  const resolve = (await cog()).resolve;
  const data = {};
  for (const r of rows) {
    const c = resolve(r.new_code);
    if (!c) continue;
    const e = (data[c] ??= { total: 0, families: {} });
    e.total += r.n;
    const fam = r.equip_type_famille ?? "Autre";
    e.families[fam] = (e.families[fam] ?? 0) + r.n;
  }
  return {
    sources: { dataes: { name: "Ministère chargé des Sports — Data ES, recensement des équipements sportifs et lieux de pratique", url: "https://www.data.gouv.fr/datasets/data-es-recensement-des-equipements-sportifs-et-lieux-de-pratique-complet-1", file: `${ods}/exports/json`, licence: LO, updated: meta.metas?.default?.modified?.slice(0, 10), method: "Count of sports equipments (a facility, e.g. a sports complex, can hold several) by family, excluding installations marked out of service." } },
    data,
  };
}

// ---------- APL to general practitioners (DREES) ----------
async function buildApl() {
  const { resource, page } = await dgResource("62263314072c63d4d53e0c50", /m[ée]decins[ _-]g[ée]n[ée]ralistes/i);
  const buf = await C.cachedBuf("apl-mg.xlsx", resource.url);
  const sheets = sheetNames(buf).filter((s) => /APL \d{4}/.test(s)).sort();
  const sheet = sheets.pop();
  const year = Number(sheet.match(/\d{4}/)[0]);
  const rows = readSheet(buf, sheet);
  const hi = rows.findIndex((r) => /Code commune/i.test(String(r[0])));
  const head = rows[hi].map(String);
  const iApl = 2;
  const i65 = head.findIndex((h) => /65 ans/.test(h));
  const iStd = head.findIndex((h) => /Population standardisée/i.test(h));
  const iPop = head.findIndex((h) => /Population totale/i.test(h));
  const raw = new Map();
  for (const r of rows.slice(hi + 1)) {
    const code = String(r[0] ?? "").trim();
    if (!/^\d[\dAB]\d{3}$/.test(code)) continue;
    raw.set(code, { apl: num(r[iApl]), apl65: num(r[i65]), std: num(r[iStd]), pop: num(r[iPop]) });
  }
  // national reference: mean weighted by standardised population (DREES's recommended aggregation), and the population share below 2.5
  let sw = 0, sv = 0, below = 0, popAll = 0;
  for (const v of raw.values()) if (v.apl != null && v.std) {
    sw += v.std; sv += v.std * v.apl;
    if (v.pop) { popAll += v.pop; if (v.apl < 2.5) below += v.pop; }
  }
  const { resolve, isCurrent } = await cog();
  const data = {};
  const merged = new Map();
  for (const [code, v] of raw) {
    if (isCurrent(code)) { data[code] = { value: r2(v.apl), under65: r2(v.apl65) }; continue; }
    const c = resolve(code);
    if (c) (merged.get(c) ?? merged.set(c, []).get(c)).push(v);
  }
  for (const [c, list] of merged) {
    if (data[c]) continue; // a current commune keeps its own value
    const w = list.reduce((s, v) => s + (v.std ?? 0), 0);
    if (!w || list.some((v) => v.apl == null)) continue;
    data[c] = { value: r2(list.reduce((s, v) => s + v.apl * v.std, 0) / w), under65: null, method: "merged" };
  }
  const methodology = "https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/information/";
  return {
    sources: {
      apl: {
        name: "DREES — Indicateur d'accessibilité potentielle localisée (APL) aux médecins généralistes", url: page, file: resource.url, methodology, licence: LO, year, updated: resource.last_modified?.slice(0, 10),
        unit: "consultations/visits accessible per standardised inhabitant per year",
        method: "Commune value as published. For communes merged after the source's geography, the mean of the former communes weighted by standardised population (DREES's recommended aggregation) — flagged method: 'merged'.",
        national: { meanWeighted: r2(sv / sw), shareOfPopulationBelow2_5: r1((100 * below) / popAll), note: "Computed here from the same file: mean weighted by standardised population; share of the population living in communes with APL < 2.5." },
      },
    },
    data,
  };
}

// ---------- FttH coverage (ARCEP) ----------
async function buildFibre() {
  const { resource, page } = await dgResource("547d8d7ac751df405d090fcb", /obs-hd-thd-deploiement/);
  const buf = await C.cachedBuf("arcep-obs.xlsx", resource.url);
  const data = {};
  let period = null;
  const read = (sheet, codeCol) => {
    const rows = readSheet(buf, sheet);
    const hi = rows.findIndex((r) => String(r[0]).startsWith("Code "));
    const head = rows[hi].map((h) => String(h).trim());
    const iLoc = head.findIndex((h) => /^Meilleure estimation des locaux/i.test(h));
    const last = head.length - 1; // latest quarter column ("T2 2026")
    period = head[last].replace(/^T(\d) (\d{4})$/, "$2-T$1");
    for (const r of rows.slice(hi + 1)) {
      const code = String(r[codeCol] ?? "").trim();
      if (!code) continue;
      const premises = num(r[iLoc]);
      const ftth = num(r[last]);
      if (premises == null || ftth == null) continue;
      data[code] = { premises: r0(premises), ftth: r0(ftth), share: premises > 0 ? r1(Math.min(100, (100 * ftth) / premises)) : null };
    }
  };
  read("Communes", 0);
  read("Arrondissements", 0);
  return {
    sources: { arcep: { name: "ARCEP — Le marché du haut et très haut débit fixe (déploiements) : observatoire, onglets Communes et Arrondissements", url: page, file: resource.url, licence: "Licence Ouverte (fr-lo)", period, updated: resource.last_modified?.slice(0, 10), method: "share = 100 × premises connectable to FttH (locaux raccordables, latest quarter) / ARCEP's best estimate of the number of premises (capped at 100)." } },
    data,
  };
}

// ---------- property prices (DVF, DGFiP via data.gouv.fr) ----------
async function buildDvf() {
  // latest full year of geo-DVF
  const idx = await C.cachedText("geo-dvf-index.html", "https://files.data.gouv.fr/geo-dvf/latest/csv/", { maxAgeH: 24 });
  const years = [...idx.matchAll(/csv\/(\d{4})\//g)].map((m) => Number(m[1])).sort();
  const nowYear = Number(TODAY.slice(0, 4));
  const year = years.filter((y) => y < nowYear).pop();
  const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/full.csv.gz`;
  const file = await C.cached(`dvf-${year}-full.csv.gz`, url, { maxAgeH: 24 * 30 });
  const resolve = (await cog()).resolve;
  // Etalab "Statistiques DVF" method: sales (Vente, VEFA, Adjudication) of a single property (excluding outbuildings);
  // price per m² = valeur foncière / surface réelle bâtie, excluding > 100,000 €/m².
  const KEEP = new Set(["Vente", "Vente en l'état futur d'achèvement", "Adjudication"]);
  const prices = new Map(); // code → { m: [], a: [] }
  let cur = null;
  let minDate = "9999", maxDate = "0000";
  const flush = () => {
    if (!cur || !KEEP.has(cur.nature) || cur.biens.length !== 1) return;
    const b = cur.biens[0];
    if (b.type !== "1" && b.type !== "2") return;
    if (!(b.surface > 0) || !(cur.valeur > 0)) return;
    const p = cur.valeur / b.surface;
    if (p > 100000) return;
    const c = resolve(b.commune) ?? b.commune;
    const e = prices.get(c) ?? prices.set(c, { m: [], a: [] }).get(c);
    (b.type === "1" ? e.m : e.a).push(p);
  };
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let H = null;
  for await (const line of rl) {
    const f = line.includes('"') ? parseCsv(line)[0] : line.split(",");
    if (!H) { H = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    const id = f[H.id_mutation];
    if (!cur || cur.id !== id) {
      flush();
      const d = f[H.date_mutation];
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
      cur = { id, nature: f[H.nature_mutation], valeur: Number(f[H.valeur_fonciere]), biens: [], keys: new Set() };
    }
    const t = f[H.code_type_local];
    if (t === "1" || t === "2" || t === "4") {
      // the same property can appear on several lines (several parcels): de-duplicate
      const key = [t, f[H.surface_reelle_bati], f[H.lot1_numero]].join("|");
      if (!cur.keys.has(key)) {
        cur.keys.add(key);
        cur.biens.push({ type: t, surface: Number(f[H.surface_reelle_bati]), commune: f[H.code_commune] });
      }
    }
  }
  flush();
  const stat = (arr) => (arr.length ? { sales: arr.length, medianPerM2: r0(median(arr)) } : { sales: 0, medianPerM2: null });
  const data = {};
  const plm = new Map();
  for (const [c, e] of prices) {
    data[c] = { house: stat(e.m), apartment: stat(e.a) };
    const city = PLM_OF_ARM(c);
    if (city) {
      const p = plm.get(city) ?? plm.set(city, { m: [], a: [] }).get(city);
      p.m.push(...e.m); p.a.push(...e.a);
    }
  }
  for (const [city, e] of plm) data[city] = { house: stat(e.m), apartment: stat(e.a) };

  // official whole-period aggregates (Etalab, 10 semesters) for reference
  const { resource: wr, page } = await dgResource("64998de5926530ebcecc7b15", /whole_period/);
  const whole = csvObjects(await C.cachedText("dvf-stats-whole-period.csv", wr.url));
  const official = {};
  for (const r of whole) {
    if (r.echelle_geo !== "commune") continue;
    official[r.code_geo] = {
      house: { sales: num(r.nb_ventes_whole_maison) ?? 0, medianPerM2: num(r.med_prix_m2_whole_maison) },
      apartment: { sales: num(r.nb_ventes_whole_appartement) ?? 0, medianPerM2: num(r.med_prix_m2_whole_appartement) },
    };
  }
  for (const [c, v] of Object.entries(official)) (data[c] ??= {}).official = v;
  return {
    sources: {
      dvf: {
        name: `DGFiP — Demandes de valeurs foncières géolocalisées (DVF), ${year}`, url: "https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees", file: url, licence: LO, year, period: [minDate, maxDate],
        method: "Computed here with the Etalab 'Statistiques DVF' rules: sales, off-plan sales (VEFA) and auctions of a single house or apartment (outbuildings ignored); price per m² = sale value / built surface (surface réelle bâtie); prices above 100,000 €/m² dropped; median per commune (arrondissement in Paris, Lyon, Marseille). Medians on few sales are volatile: check `sales`.",
        coverage: "DVF does not cover Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle: Livre foncier) or Mayotte.",
      },
      dvfStats: { name: "data.gouv.fr (Etalab) — Statistiques DVF, statistiques totales (10 derniers semestres)", url: page, file: wr.url, licence: LO, updated: wr.last_modified?.slice(0, 10), note: "Official pre-aggregated medians over the whole available period (5 years); there is no official per-year median file (only monthly medians)." },
    },
    data,
  };
}

// ---------- Wikidata (P374 INSEE code → item, P18 image, frwiki article) + Commons licence/author ----------
async function selectWikidata() {
  const q = `SELECT ?insee ?item ?image ?article ?dissolved (GROUP_CONCAT(DISTINCT STRAFTER(STR(?t),"entity/");separator=",") AS ?types) WHERE {
  ?item wdt:P374 ?insee .
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P576 ?dissolved }
  OPTIONAL { ?item wdt:P31 ?t }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> }
} GROUP BY ?insee ?item ?image ?article ?dissolved`;
  const csv = await C.memo("wikidata-p374.json", async () => {
    console.log("  ↓ Wikidata SPARQL (P374)");
    const res = await fetchRetry("https://query.wikidata.org/sparql", { method: "POST", headers: { Accept: "text/csv", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ query: q }) });
    return await res.text();
  }, { maxAgeH: 24 * 30 });
  const rows = csvObjects(csv);
  const { isCurrent } = await cog();
  const byCode = new Map();
  for (const r of rows) {
    if (!isCurrent(r.insee)) continue;
    if (!byCode.has(r.insee)) byCode.set(r.insee, new Map());
    const items = byCode.get(r.insee);
    const qid = r.item.split("/").pop();
    const it = items.get(qid) ?? items.set(qid, { qid, images: new Set(), article: null, dissolved: false, types: new Set() }).get(qid);
    if (r.image) it.images.add(decodeURIComponent(r.image.split("/Special:FilePath/")[1]));
    if (r.article) it.article = r.article;
    if (r.dissolved) it.dissolved = true;
    for (const t of r.types.split(",")) if (t) it.types.add(t);
  }
  const PREF = ["Q484170", "Q702842", "Q22923920", "Q2989454"]; // commune of France, municipal arrondissement, commune nouvelle…
  const data = {};
  for (const [code, items] of byCode) {
    const list = [...items.values()].filter((i) => !i.dissolved);
    if (!list.length) continue;
    list.sort((a, b) => (PREF.some((p) => b.types.has(p)) - PREF.some((p) => a.types.has(p))) || (!!b.article - !!a.article) || (Number(a.qid.slice(1)) - Number(b.qid.slice(1))));
    const it = list[0];
    data[code] = { qid: it.qid, image: [...it.images].sort()[0] ?? null, article: it.article };
  }
  return data;
}

// Wikimedia rate-limits anonymous API clients per IP (observed: ~10 requests/min across Commons and Wikipedia, then HTTP 429).
// So: one shared throttle, answers stored per item in .cache/communes/*-items.json (merged with older per-batch caches),
// communes processed by population (largest first), and at most --wiki-budget=N requests per part and run (default 300 ≈ 35 min).
// Rerunning the part continues where the previous run stopped.
const wikiWait = throttle(6500);
const WIKI_BUDGET = Number(opt("wiki-budget") ?? 300);
let wikiSpent = 0;
async function wikiGet(url) {
  if (wikiSpent >= WIKI_BUDGET) return null;
  wikiSpent++;
  await wikiWait();
  const j = await (await fetchRetry(url)).json();
  if (j.error) throw new Error(`Wikimedia API error ${j.error.code}: ${j.error.info}`);
  return j;
}
async function loadItems(name) {
  try { return JSON.parse(await readFile(new URL(name, CACHE), "utf8")); } catch { return {}; }
}
const saveItems = (name, obj) => writeFile(new URL(name, CACHE), JSON.stringify(obj));
async function oldBatches(dir) {
  try { return await Promise.all((await readdir(new URL(dir, CACHE))).map(async (f) => JSON.parse(await readFile(new URL(`${dir}${f}`, CACHE), "utf8")))); } catch { return []; }
}
const byPopulation = async () => {
  const base = await readPart("base");
  return (code) => -(base?.data?.[code]?.pop ?? 0);
};
const stripHtml = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

function ingestCommons(j, info) {
  const back = new Map((j.query?.normalized ?? []).map((n) => [n.to, n.from]));
  for (const pg of j.query?.pages ?? []) {
    const from = (back.get(pg.title) ?? pg.title).replace(/^File:/, "");
    const ii = pg.imageinfo?.[0];
    if (!ii) { if (pg.missing || pg.invalid) info[from] = { missing: true }; continue; }
    const md = ii.extmetadata ?? {};
    info[from] = {
      page: ii.descriptionurl, url: ii.url, thumb: ii.thumburl ?? null, width: ii.thumbwidth ?? null, height: ii.thumbheight ?? null,
      author: stripHtml(md.Artist?.value).slice(0, 200) || null, credit: stripHtml(md.Credit?.value).slice(0, 200) || null,
      licence: stripHtml(md.LicenseShortName?.value) || null, licenceUrl: md.LicenseUrl?.value ?? null,
    };
  }
}

async function buildWikidata() {
  wikiSpent = 0;
  const data = await selectWikidata();
  const info = await loadItems("commons-items.json");
  for (const j of await oldBatches("commons/")) ingestCommons(j, info);
  const key = (f) => f.replace(/_/g, " ");
  const rank = await byPopulation();
  const codes = Object.keys(data).filter((c) => data[c].image).sort((a, b) => rank(a) - rank(b));
  const todo = [...new Set(codes.map((c) => data[c].image).filter((f) => !info[key(f)] && !info[f]))];
  console.log(`  commons: ${todo.length} files to fetch (budget ${WIKI_BUDGET - wikiSpent} requests)`);
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "960", iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit", titles: batch.map((f) => `File:${f}`).join("|"), maxlag: "5" });
    const j = await wikiGet(`https://commons.wikimedia.org/w/api.php?${p}`);
    if (!j) break;
    ingestCommons(j, info);
    await saveItems("commons-items.json", info);
    if ((i / 50) % 20 === 0) console.log(`  commons ${i}/${todo.length}`);
  }
  let pending = 0;
  for (const d of Object.values(data)) if (d.image) {
    d.imageInfo = info[key(d.image)] ?? info[d.image] ?? null;
    if (!d.imageInfo) pending++;
  }
  return {
    sources: {
      wikidata: { name: "Wikidata — items with an INSEE municipality code (P374): image (P18) and French Wikipedia sitelink", url: "https://www.wikidata.org/wiki/Property:P374", licence: "CC0 1.0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/", retrieved: TODAY },
      commons: { name: "Wikimedia Commons — file pages (author, licence) via the MediaWiki API", url: "https://commons.wikimedia.org/", licence: "per file (see image.licence)", retrieved: TODAY, pendingFiles: pending },
    },
    data,
  };
}

// ---------- French Wikipedia intro extracts ----------
async function buildWikipedia() {
  wikiSpent = 0;
  const wd = await selectWikidata(); // same SPARQL answer (memoised) as the wikidata part
  const titles = new Map(); // title → [codes]
  for (const [code, d] of Object.entries(wd)) {
    if (!d.article) continue;
    const t = decodeURIComponent(d.article.split("/wiki/")[1]).replace(/_/g, " ");
    (titles.get(t) ?? titles.set(t, []).get(t)).push(code);
  }
  const out = await loadItems("wikipedia-items.json");
  const ingest = (chunk) => {
    const back = new Map();
    for (const n of chunk.normalized ?? []) back.set(n.to, n.from);
    for (const r of chunk.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const pg of chunk.pages ?? []) {
      const orig = back.get(pg.title) ?? pg.title;
      if (pg.missing) { out[orig] = { missing: true }; continue; }
      if (pg.extract == null) continue; // not returned in this chunk (continuation)
      out[orig] = { title: pg.title, url: pg.fullurl, revid: pg.lastrevid, extract: pg.extract };
    }
  };
  for (const b of await oldBatches("wikipedia/")) for (const chunk of b) ingest(chunk);
  const rank = await byPopulation();
  const todo = [...titles.keys()].filter((t) => !out[t]).sort((a, b) => Math.min(...titles.get(a).map(rank)) - Math.min(...titles.get(b).map(rank)));
  console.log(`  wikipedia: ${todo.length} articles to fetch (budget ${WIKI_BUDGET - wikiSpent} requests)`);
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "extracts|info", exintro: "1", explaintext: "1", exlimit: "20", inprop: "url", redirects: "1", titles: batch.join("|"), maxlag: "5" });
    const j = await wikiGet(`https://fr.wikipedia.org/w/api.php?${p}`);
    if (!j) break;
    ingest({ pages: j.query?.pages, redirects: j.query?.redirects, normalized: j.query?.normalized });
    await saveItems("wikipedia-items.json", out);
    if ((i / 20) % 20 === 0) console.log(`  wikipedia ${i}/${todo.length}`);
  }
  const data = {};
  let pending = 0;
  const pendingCodes = [];
  for (const [t, codes] of titles) {
    const p = out[t];
    if (!p) { pending += codes.length; pendingCodes.push(...codes); continue; }
    const text = p.extract ? shorten(p.extract) : null;
    if (!text) continue;
    for (const c of codes) data[c] = { title: p.title, url: p.url, revid: p.revid, extract: text };
  }
  return {
    sources: { wikipedia: { name: "Wikipédia en français — introduction of the commune's article (first sentences), via the MediaWiki API", url: "https://fr.wikipedia.org/", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.fr", attribution: "Text from the French Wikipedia article (see url), by its contributors (history: url + '?action=history'), licensed CC BY-SA 4.0; shortened.", retrieved: TODAY, pendingArticles: pending } },
    data,
    meta: { pending: pendingCodes },
  };
}
function shorten(s) {
  const t = String(s ?? "").replace(/\s*\([^()]*\)/g, (m) => (m.length > 60 ? "" : m)).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const sentences = t.match(/[^.!?]+(?:[.!?]+(?=\s+[A-ZÀ-ÝÉÈ«"(]|$)|$)/g) ?? [t];
  let out = "";
  for (const se of sentences) {
    if (out && (out + " " + se.trim()).length > 600) break;
    out = out ? `${out} ${se.trim()}` : se.trim();
    if (out.length > 280) break;
  }
  return out.length > 700 ? out.slice(0, 697).replace(/\s+\S*$/, "") + "…" : out;
}

// =====================================================================================
// Assembly
// =====================================================================================
const NOTABLE = { monuments: 10, museums: 10, libraries: 8, schools: 15, council: 70, regional: 40 };

function assembleCommune(code, P) {
  const b = P.base.data[code];
  const m = P.base.meta;
  const parent = b.parent ?? null;
  const city = parent ? P.base.data[parent] : null;
  const isPlmCity = !!b.arrondissements;
  const childCodes = b.arrondissements ?? [];
  const f = {
    code, name: b.name, type: b.type, generated: TODAY, schemaVersion: SCHEMA_VERSION,
    department: { code: b.dep, name: m.depName[b.dep] ?? null },
    region: { code: b.reg, name: m.regName[b.reg] ?? null },
    postcodes: b.postcodes,
    centroid: b.centroid,
    population: b.pop != null ? { value: b.pop, year: b.popFrom === "insee" ? P.base.sources.population.year : null, source: b.popFrom === "insee" ? "population" : "geoapi" } : NA("No population in the sources used."),
    districts: b.districts,
  };
  if (parent) f.parent = { code: parent, name: city?.name };
  if (isPlmCity) f.arrondissements = childCodes.map((c) => ({ code: c, name: P.base.data[c]?.name }));
  f.cantons = (b.cantons ?? []).map((c) => ({ code: c, name: m.canton[c]?.name ?? null }));
  if (b.cantonMulti) f.cantonsMethod = (parent ? "Cantons of the whole city (the COG does not map arrondissements to cantons). " : "") + "Commune split between several cantons: cantons whose bureau centralisateur is this commune (INSEE COG). A canton covering part of this commune but centralised elsewhere is not listed.";

  // ---- elected officials ----
  f.elected = assembleElected(code, b, P);

  // ---- local assets ----
  // PLM cities: own entries + those of their arrondissements
  const sum = (part) => {
    const own = part?.data?.[code] ?? [];
    if (!isPlmCity) return own;
    return [...own, ...childCodes.flatMap((c) => part?.data?.[c] ?? [])];
  };
  const assets = {};
  if (P.monuments) {
    const list = sum(P.monuments) ?? [];
    const uniq = [...new Map(list.map((x) => [x.ref, x])).values()];
    const classe = uniq.filter((x) => x.level === "classé");
    // "notable" = a simple, documented ordering: classé before inscrit, whole building before partial protection,
    // named buildings before generic titles ("Immeuble", "Maison"…), then alphabetical. Not a ranking of merit.
    const generic = (n) => /^(immeubles?|maisons?|hôtel|ancien hôtel|ferme|demeure|bâtiment|façades?)(\s|$|,)/i.test(n) && n.split(/\s+/).length <= 3;
    const score = (x) => (x.level === "classé" ? 4 : x.level === "inscrit" ? 2 : 0) + (x.partial ? 0 : 1) - (generic(x.name) ? 3 : 0);
    const top = [...uniq].sort((a, b2) => score(b2) - score(a) || a.name.localeCompare(b2.name, "fr")).slice(0, NOTABLE.monuments);
    assets.monuments = { status: "ok", source: "merimee", count: uniq.length, classe: classe.length, inscrit: uniq.filter((x) => x.level === "inscrit").length, list: top, ...(uniq.length > top.length ? { truncated: uniq.length - top.length } : {}) };
    const cityOnly = parent ? (P.monuments.data[parent] ?? []).length : 0;
    if (cityOnly) assets.monuments.cityLevel = { code: parent, count: cityOnly, note: "Mérimée codes these monuments of the city to the whole commune, not to an arrondissement: they are counted in the city file only." };
  } else assets.monuments = NA("Source not built.");
  if (P.museums) {
    const list = sum(P.museums) ?? [];
    assets.museums = { status: "ok", source: "museofile", count: list.length, list: list.slice(0, NOTABLE.museums), ...(list.length > NOTABLE.museums ? { truncated: list.length - NOTABLE.museums } : {}) };
  } else assets.museums = NA("Source not built.");
  if (P.libraries) {
    const list = P.libraries.data[code] ?? (parent ? null : sum(P.libraries)) ?? [];
    if (parent) assets.libraries = { ...NA("The libraries file locates Paris, Lyon and Marseille libraries at city level only."), city: { code: parent, count: (P.libraries.data[parent] ?? []).length } };
    else assets.libraries = { status: "ok", source: "libraries", count: list.length, list: list.slice(0, NOTABLE.libraries), ...(list.length > NOTABLE.libraries ? { truncated: list.length - NOTABLE.libraries } : {}) };
  } else assets.libraries = NA("Source not built.");
  if (P.sports) {
    let s = P.sports.data[code];
    if (isPlmCity) {
      const kids = [s, ...childCodes.map((c) => P.sports.data[c])].filter(Boolean);
      if (kids.length) s = kids.reduce((a, k) => { a.total += k.total; for (const [f2, n] of Object.entries(k.families)) a.families[f2] = (a.families[f2] ?? 0) + n; return a; }, { total: 0, families: {} });
    }
    s ??= { total: 0, families: {} };
    const families = Object.fromEntries(Object.entries(s.families).sort((a, b) => b[1] - a[1]));
    assets.sports = { status: "ok", source: "dataes", count: s.total, families };
  } else assets.sports = NA("Source not built.");
  assets.greenSpaces = NA("No official commune-level indicator of green space was found in open data (INSEE, Ministère de la Transition écologique, data.gouv.fr): only land-cover rasters (Corine Land Cover, OCS GE) that would need a computation of our own. Not computed.");
  f.assets = assets;

  // ---- health ----
  if (P.apl) {
    const v = P.apl.data[code];
    f.health = { gpAccess: v ? { status: "ok", source: "apl", year: P.apl.sources.apl.year, value: v.value, under65: v.under65, ...(v.method ? { method: v.method } : {}), national: P.apl.sources.apl.national.meanWeighted } : NA(isPlmCity ? "DREES publishes APL for each arrondissement of Paris, Lyon and Marseille, not for the whole city: see the arrondissement files." : b.dep === "976" ? "DREES does not compute APL for Mayotte." : "No value in the DREES file for this commune.") };
  } else f.health = { gpAccess: NA("Source not built.") };

  // ---- broadband ----
  if (P.fibre) {
    const v = P.fibre.data[code];
    f.broadband = { ftth: v ? { status: "ok", source: "arcep", period: P.fibre.sources.arcep.period, ...v } : NA("No row for this commune in ARCEP's deployment observatory.") };
  } else f.broadband = { ftth: NA("Source not built.") };

  // ---- property ----
  if (P.dvf) {
    const v = P.dvf.data[code];
    const S = P.dvf.sources.dvf;
    if (["57", "67", "68", "976"].includes(b.dep)) f.property = NA("DVF does not cover Alsace-Moselle (Livre foncier) or Mayotte.");
    else if (!v) f.property = { status: "ok", source: "dvf", year: S.year, house: { sales: 0, medianPerM2: null }, apartment: { sales: 0, medianPerM2: null }, note: "No qualifying sale recorded this year." };
    else {
      f.property = { status: "ok", source: "dvf", year: S.year, house: v.house ?? { sales: 0, medianPerM2: null }, apartment: v.apartment ?? { sales: 0, medianPerM2: null } };
      if (v.official) f.property.officialFivePeriod = { source: "dvfStats", ...v.official };
    }
  } else f.property = NA("Source not built.");

  // ---- local figures reused from the district profiles ----
  f.local = assembleLocal(code, b, P, parent, isPlmCity, childCodes);

  // ---- photo and description ----
  f.media = assembleMedia(code, P);
  return f;
}

function assembleElected(code, b, P) {
  if (!P.rne) return NA("Source not built.");
  const R = P.rne;
  const own = R.data[parentOr(code, b)] ?? {};
  const e = { source: "rne", updated: R.sources.rne.updated };
  const cityCode = parentOr(code, b);
  // mayor + municipal council (city level for arrondissements)
  if (own.mayor) e.mayor = { status: "ok", ...(b.parent ? { level: "city", city: cityCode } : {}), ...own.mayor };
  else e.mayor = NA("No mayor listed in the RNE for this commune (vacancy or not yet recorded).");
  if (own.council?.length) {
    const list = own.council;
    e.council = { status: "ok", ...(b.parent ? { level: "city", city: cityCode } : {}), count: list.length, list: list.slice(0, NOTABLE.council).map(({ since, ...x }) => x), ...(list.length > NOTABLE.council ? { truncated: list.length - NOTABLE.council } : {}) };
  } else e.council = NA("No municipal councillor listed in the RNE for this commune.");
  // arrondissement council (PLM)
  if (b.type === "arrondissement") {
    const sector = sectorOf(code, P.base.data[code].name, R.meta.sectors);
    if (sector) e.arrondissementCouncil = { status: "ok", sector: sector.name, count: sector.list.length, list: sector.list.slice(0, NOTABLE.council), note: "RNE file of arrondissement councillors: members of the sector council who do not sit on the city council (the sector's city councillors also sit on it)." };
    else e.arrondissementCouncil = NA("No sector found in the RNE arrondissement-councillor file.");
  }
  // departmental councillors
  const cantons = b.cantons ?? [];
  const cds = cantons.map((c) => R.meta.cantons[c] ? { code: c, name: R.meta.cantons[c].name, councillors: R.meta.cantons[c].list } : null).filter(Boolean);
  const NO_DEP = { "75C": "Paris (Ville de Paris exercises the department's powers; no departmental council).", "69M": "Métropole de Lyon (it exercises the department's powers on its territory; no departmental councillors).", "20R": "Collectivité de Corse (single authority; no departmental councillors).", "972R": "Collectivité territoriale de Martinique (single authority; no departmental councillors).", "973R": "Collectivité territoriale de Guyane (single authority; no departmental councillors)." };
  if (cds.length) e.departmental = { status: "ok", cantons: cds, president: R.meta.depPresident[b.dep] ?? null, ...(b.cantonMulti ? { method: "Commune split between cantons: cantons whose bureau centralisateur is this commune." } : {}) };
  else e.departmental = NA(NO_DEP[b.ctcd] ?? (cantons.length ? "Canton not found in the RNE departmental-councillor file." : "No canton found for this commune in the COG."));
  // regional council
  const reg = R.meta.regions[b.reg];
  if (reg) {
    const secKey = Object.keys(reg.sections).find((s) => s === b.dep || s === b.dep.replace(/^0/, "")) ?? null;
    const sec = secKey ? reg.sections[secKey] : null;
    e.regional = { status: "ok", region: P.base.meta.regName[b.reg] ?? reg.name, count: reg.count, president: reg.president, ...(sec ? { section: { code: secKey, name: sec.name, count: sec.list.length, list: sec.list.slice(0, NOTABLE.regional), ...(sec.list.length > NOTABLE.regional ? { truncated: sec.list.length - NOTABLE.regional } : {}) } } : {}), note: "Regional councillors are elected on regional lists with departmental sections; 'section' lists those elected in this department's section. The RNE does not publish their list or party." };
  } else {
    const key = b.reg === "94" ? "94" : ["972", "973"].includes(b.dep) ? b.dep : null;
    const a = key && R.meta.assemblies[key];
    if (a) e.regional = { status: "ok", assembly: a.name, count: a.count, president: a.president, executivePresident: a.executive, list: a.list.slice(0, NOTABLE.regional), ...(a.list.length > NOTABLE.regional ? { truncated: a.list.length - NOTABLE.regional } : {}), note: "Single territorial authority (no separate regional and departmental councils): members of its assembly (RNE 'membres d'une assemblée')." };
    else e.regional = NA(b.dep === "976" ? "Mayotte: the departmental council also exercises regional powers (see departmental); there is no regional council." : "No regional councillors listed for this region in the RNE.");
  }
  // Métropole de Lyon (its council replaces the departmental council on its territory)
  if (b.ctcd === "69M" && R.meta.assemblies["69M"]) {
    const a = R.meta.assemblies["69M"];
    e.metropole = { status: "ok", name: a.name, count: a.count, president: a.president ?? a.executive, note: "Metropolitan councillors are elected in 14 metropolitan constituencies; the RNE file names the constituency but no commune → constituency table is used here, so they are not listed per commune." };
  }
  // senators
  const sen = R.meta.senators[b.dep];
  e.senators = sen?.length ? { status: "ok", count: sen.length, list: sen } : NA("No senator listed for this department in the RNE.");
  e.partyAffiliation = NA("The RNE does not publish candidate lists or political nuances; they are not added from other sources.");
  return e;
}
const parentOr = (code, b) => b.parent ?? code;
function sectorOf(code, name, sectors) {
  const n = Number(code.slice(-2));
  const city = code.startsWith("751") ? "Paris" : code.startsWith("6938") ? "Lyon" : "Marseille";
  const entries = Object.entries(sectors);
  if (city === "Paris") {
    const k = n <= 4 ? "Paris 1Er Secteur" : `Paris ${n}Eme Secteur`;
    const s = entries.find(([key]) => key.toLowerCase() === k.toLowerCase());
    return s ? { name: n <= 4 ? "Paris Centre (1er–4e)" : s[0], list: s[1].list } : null;
  }
  if (city === "Lyon") {
    const s = entries.find(([key]) => key.toLowerCase() === (n === 1 ? "lyon 1er secteur" : `lyon ${n}eme secteur`));
    return s ? { name: s[0], list: s[1].list } : null;
  }
  // Marseille: 8 sectors of two arrondissements (1: 1er+7e, 2: 2e+3e, 3: 4e+5e, 4: 6e+8e, 5: 9e+10e, 6: 11e+12e, 7: 13e+14e, 8: 15e+16e)
  const MS = { 1: 1, 7: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 4, 8: 4, 9: 5, 10: 5, 11: 6, 12: 6, 13: 7, 14: 7, 15: 8, 16: 8 };
  const s = entries.find(([key]) => key.toLowerCase() === `marseille secteur ${MS[n]}`);
  return s ? { name: s[0], list: s[1].list } : null;
}

function assembleLocal(code, b, P, parent, isPlmCity, childCodes) {
  const D = P.districts;
  if (!D) return NA("Source not built.");
  const own = D.data[code] ?? {};
  const cityVals = parent ? D.data[parent] ?? {} : {};
  const out = {};
  // crime: SSMSI publishes PLM as whole cities
  const crime = own.crime ?? cityVals.crime;
  const crimeNote = parent ? { level: "city", city: parent } : {};
  out.crime = crime ? { status: "ok", source: "crime", year: D.sources.crime.year, ...crimeNote, values: crime, department: depCrime(D, b.dep) } : { ...NA("Not published by SSMSI for this commune: a commune's figures are published only when more than 5 offences were recorded in each of the last 3 years (statistical confidentiality). See the department rates."), department: depCrime(D, b.dep) };
  // census unemployment
  const ilo = D.meta.depUnemp[b.dep];
  if (own.census != null) out.unemployment = { status: "ok", source: "census", year: D.sources.census.year, rate: own.census, ...(ilo ? { departmentIlo: { source: "ilo", ...ilo } } : {}) };
  else out.unemployment = { ...NA(isPlmCity ? "Published per arrondissement in the reused data: see the arrondissement files." : "No census value for this commune in the reused data."), ...(ilo ? { departmentIlo: { source: "ilo", ...ilo } } : {}) };
  // income / poverty
  if (own.income) out.income = { status: "ok", source: "filosofi", year: D.sources.filosofi.year, medianIncome: own.income[0], povertyRate: own.income[1] };
  else out.income = NA(isPlmCity ? "Published per arrondissement in the reused data: see the arrondissement files." : ["971", "972", "973", "976"].includes(b.dep) ? "Filosofi does not cover this overseas department." : "Not published by INSEE for this commune (Filosofi withholds communes with fewer than 50 households or 1,000 inhabitants for the poverty rate; secret statistique).");
  if (out.income.status === "ok" && out.income.povertyRate == null) out.income.povertyRateNote = "Poverty rate not published for this commune (secret statistique).";
  // local spending (city accounts for arrondissements)
  const sp = own.spending ?? cityVals.spending;
  out.localSpending = sp ? { status: "ok", source: "ofgl", year: D.sources.ofgl.year, unit: "€ per inhabitant", ...(parent ? { level: "city", city: parent } : {}), ...sp } : NA("No OFGL accounts for this commune in the reused data.");
  // schools
  let schools = own.schools ?? [];
  if (isPlmCity) schools = [...schools, ...childCodes.flatMap((c) => D.data[c]?.schools ?? [])];
  const colleges = schools.filter((s) => s.type === "college");
  const lycees = schools.filter((s) => s.type === "lycee");
  const list = [...schools].sort((a, b2) => (a.type === b2.type ? a.name.localeCompare(b2.name, "fr") : a.type === "college" ? -1 : 1));
  out.schools = { status: schools.length ? "ok" : "empty", source: "schools", colleges: colleges.length, lycees: lycees.length, list: list.slice(0, NOTABLE.schools), ...(list.length > NOTABLE.schools ? { truncated: list.length - NOTABLE.schools } : {}), note: "Collèges and lycées only; indicators as published (no ranking)." };
  return out;
}
const depCrime = (D, dep) => {
  const d = D.meta.depCrime[dep];
  if (!d) return null;
  return { code: dep, year: d.year, rates: Object.fromEntries(Object.entries(d.values ?? {}).map(([k, x]) => [k, r2(x.rate)])) };
};

function assembleMedia(code, P) {
  const out = {};
  const w = P.wikidata?.data[code];
  if (!P.wikidata) return { image: NA("Source not built."), wikipedia: NA("Source not built.") };
  if (w) out.wikidata = { qid: w.qid, url: `https://www.wikidata.org/wiki/${w.qid}` };
  const ii = w?.imageInfo;
  if (ii && ii.licence && ii.thumb) out.image = { status: "ok", source: "commons", file: w.image, page: ii.page, thumb: ii.thumb.split("?utm_")[0], width: ii.width, height: ii.height, author: ii.author ?? ii.credit ?? null, licence: ii.licence, licenceUrl: ii.licenceUrl };
  else out.image = NA(!w ? "No Wikidata item with this INSEE code." : !w.image ? "No image (P18) on the Wikidata item." : !ii ? "Not fetched from Commons yet (Wikimedia rate limit: filled in by later runs of the wikidata part)." : "No licence returned by Commons for this file (or the file is missing); not used.");
  if (out.image.status === "ok" && !out.image.author) out.image.authorNote = "No author field on the Commons file page; credit the file page.";
  const wp = P.wikipedia?.data[code];
  out.wikipedia = wp ? { status: "ok", source: "wikipedia", title: wp.title, url: wp.url, revid: wp.revid, extract: wp.extract, licence: "CC BY-SA 4.0" } : NA(!P.wikipedia ? "Source not built." : !w?.article ? "No French Wikipedia article linked from Wikidata." : (P.wikipedia._pending ??= new Set(P.wikipedia.meta?.pending ?? [])).has(code) ? "Not fetched from Wikipedia yet (rate limit: filled in by later runs of the wikipedia part)." : "No introduction text returned by Wikipedia.");
  return out;
}

// =====================================================================================
// Main
// =====================================================================================
const ORDER = ["base", "districts", "rne", "monuments", "museums", "libraries", "sports", "apl", "fibre", "dvf", "wikidata", "wikipedia"];
const BUILD = { base: buildBase, districts: buildDistricts, rne: buildRne, monuments: buildMonuments, museums: buildMuseums, libraries: buildLibraries, sports: buildSports, apl: buildApl, fibre: buildFibre, dvf: buildDvf, wikidata: buildWikidata, wikipedia: buildWikipedia };
const P = {};
const failures = {};
for (const name of ORDER) {
  const want = !ASSEMBLE_ONLY && (!ONLY || ONLY.includes(name));
  let part = want ? null : await readPart(name);
  if (want || (!part && !ASSEMBLE_ONLY && !ONLY)) {
    console.log(`▶ ${name}`);
    const t0 = Date.now();
    try {
      const arg = name === "museums" ? P.base : undefined;
      if (name === "museums" && !P.base) throw new Error("needs part base");
      part = await BUILD[name](arg);
      await writePart(name, part);
      console.log(`  ✓ ${name}: ${Object.keys(part.data).length} entries (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      failures[name] = e.message;
      part = await readPart(name); // keep the previous build if any
    }
  }
  if (part) P[name] = part;
}
if (!P.base) throw new Error("base part missing: run without --assemble first");

await mkdir(OUT, { recursive: true });
const codes = Object.keys(P.base.data).sort();
const targets = CODES ?? codes;
let bytes = 0;
let maxSize = [0, null];
const coverage = {};
const count = (k, ok) => { coverage[k] ??= 0; if (ok) coverage[k]++; };
for (const code of targets) {
  if (!P.base.data[code]) { console.warn(`unknown code ${code}`); continue; }
  const f = assembleCommune(code, P);
  const s = JSON.stringify(f);
  bytes += s.length;
  if (s.length > maxSize[0]) maxSize = [s.length, code];
  await writeFile(new URL(`${code}.json`, OUT), s);
  count("mayor", f.elected.mayor?.status === "ok");
  count("council", f.elected.council?.status === "ok");
  count("departmental", f.elected.departmental?.status === "ok");
  count("regional", f.elected.regional?.status === "ok");
  count("senators", f.elected.senators?.status === "ok");
  count("monuments>0", f.assets.monuments.count > 0);
  count("museums>0", f.assets.museums.count > 0);
  count("libraries>0", f.assets.libraries.count > 0);
  count("sports>0", f.assets.sports.count > 0);
  count("gpAccess", f.health.gpAccess.status === "ok");
  count("ftth", f.broadband.ftth.status === "ok");
  count("property.apartment", f.property.apartment?.medianPerM2 != null);
  count("property.house", f.property.house?.medianPerM2 != null);
  count("crime", f.local.crime?.status === "ok");
  count("unemployment", f.local.unemployment?.status === "ok");
  count("income", f.local.income?.status === "ok");
  count("localSpending", f.local.localSpending?.status === "ok");
  count("schools>0", f.local.schools?.status === "ok");
  count("image", f.media.image?.status === "ok");
  count("wikipedia", f.media.wikipedia?.status === "ok");
}
// remove stale files (full builds only)
if (!CODES) {
  const keep = new Set(codes.map((c) => `${c}.json`));
  for (const f of await readdir(OUT)) if (/^\w+\.json$/.test(f) && !["index.json", "sources.json"].includes(f) && !keep.has(f)) await unlink(new URL(f, OUT));
}

// index
const index = {
  generated: TODAY, schemaVersion: SCHEMA_VERSION,
  columns: ["code", "name", "postcodes", "department", "districts", "population", "lon", "lat", "parent"],
  note: "One row per commune (COG 2026) and per arrondissement of Paris, Lyon and Marseille. postcodes and districts are space-separated; parent is the city of an arrondissement (else empty). Search on name and postcodes; open <code>.json.",
  rows: codes.map((c) => {
    const b = P.base.data[c];
    return [c, b.name, b.postcodes.join(" "), b.dep, b.districts.map((d) => d.code).join(" "), b.pop, b.centroid?.[0] ?? null, b.centroid?.[1] ?? null, b.parent ?? ""];
  }),
};
await writeFile(new URL("index.json", OUT), JSON.stringify(index));

// sources registry
const sources = {};
for (const name of ORDER) Object.assign(sources, P[name]?.sources ?? {});
const registry = {
  generated: TODAY, schemaVersion: SCHEMA_VERSION,
  note: "Every block in a commune file names its source with `source: <key>`; the key's entry here gives the dataset name, url, licence and year/period. See docs/data-communes.md.",
  sources,
  definitions: {
    crime: P.districts?.meta.crimeDefs ?? null,
    localSpending: P.districts?.meta.spendingItems ?? null,
    gpAccess: { fr: "Accessibilité potentielle localisée (APL) aux médecins généralistes", en: "Local potential accessibility to general practitioners", unit: "consultations/visits per standardised inhabitant per year", under65: "Same, counting only GPs aged 65 or under" },
    ftth: { fr: "Locaux raccordables à la fibre (FttH)", en: "Premises where fibre to the home can be connected", share: "% of premises" },
    property: { medianPerM2: "Median price per m² (€), single-property sales", sales: "Number of qualifying sales" },
  },
  failures,
  coverage: CODES ? null : { files: targets.length, ...coverage },
};
await writeFile(new URL("sources.json", OUT), JSON.stringify(registry, null, 1));

console.log(`\nWrote ${targets.length} commune files (${(bytes / 1e6).toFixed(1)} MB, largest ${maxSize[1]} ${(maxSize[0] / 1024).toFixed(1)} KB) + index.json + sources.json`);
console.log("Coverage:", coverage);
if (Object.keys(failures).length) console.log("Failures:", failures);
