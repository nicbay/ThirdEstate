// "Quartiers": neighbourhood-level data for every commune split into INSEE IRIS (≈ 2,000-inhabitant areas).
//
//   node scripts/sync-quartiers.mjs                     the 50 largest communes (Paris, Lyon, Marseille: every arrondissement)
//   node scripts/sync-quartiers.mjs --top=200           the 200 largest communes
//   node scripts/sync-quartiers.mjs --all               every commune with IRIS (~1,840)
//   node scripts/sync-quartiers.mjs --codes=84007,75111 only these communes / arrondissements
//   node scripts/sync-quartiers.mjs --no-photos         skip Wikimedia Commons     --no-wiki   skip Wikipedia
//   node scripts/sync-quartiers.mjs --ai                write AI descriptions (needs ANTHROPIC_API_KEY; communes ≥ 100,000 only)
//   node scripts/sync-quartiers.mjs --refresh           ignore the download cache (Wikimedia answers included)
//   node scripts/sync-quartiers.mjs --tolerance=0.00008 Douglas–Peucker tolerance for the contours, in degrees
//
// Output (schema, sources, licences, coverage and limits: docs/data-quartiers.md):
//   public/data/quartiers/<code>.json      one file per commune / arrondissement: IRIS list with figures, photos, description
//   public/data/quartiers/<code>.geojson   simplified IRIS contours of that commune (property `code` = IRIS code)
//   public/data/quartiers/index.json       communes covered, indicator definitions, sources, national figures
//
// Every figure is copied from an official INSEE file; nothing is estimated. A missing value is null and the reason is in
// `missing`. IRIS names are INSEE's; a Wikipedia quartier is linked only when its title matches the IRIS name AND the
// article is geolocated inside the commune AND its first sentence says it is a quartier/district. AI text (optional)
// is labelled as such and is given only the figures and the names of geolocated Wikipedia articles.

import { noEmail } from "./lib/no-email.mjs";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { UA, sleep } from "./lib/http-cache.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/quartiers/", ROOT);
const CACHE = new URL(".cache/quartiers/", ROOT);
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const REFRESH = flag("refresh");
const ALL = flag("all");
const TOP = Number(opt("top") ?? 50);
const CODES = opt("codes")?.split(",").filter(Boolean) ?? null;
const PHOTOS = !flag("no-photos");
const WIKI = !flag("no-wiki");
const AI = flag("ai");
const CACHED_PHOTOS = flag("cached-photos"); // photos only from the cache (no Commons request); IRIS not cached keep their previous photos
const TOL = Number(opt("tolerance") ?? 0.00008);
const TODAY = new Date().toISOString().slice(0, 10);
const SCHEMA_VERSION = 1;
const MAX_PHOTOS = 6;
const AI_JOB = "quartiers";
const AI_BUDGET_USD = 3; // this job never spends more than this per calendar month (the shared cap is $15)
const AI_MIN_POP = 100000;

const LO = { name: "Licence Ouverte / Open Licence v2.0 (Etalab)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" };
const SOURCES = {
  contours: {
    name: "IGN — CONTOURS…IRIS (couche STATISTICALUNITS.IRIS:contours_iris du service WFS de la Géoplateforme)",
    page: "https://geoservices.ign.fr/contoursiris",
    url: "https://data.geopf.fr/wfs/ows",
    licence: LO,
  },
  population: { name: "INSEE — Recensement 2022, base infracommunale Population (Iris)", page: "https://www.insee.fr/fr/statistiques/8647014", url: "https://www.insee.fr/fr/statistiques/fichier/8647014/base-ic-evol-struct-pop-2022_csv.zip", year: 2022, licence: LO },
  logement: { name: "INSEE — Recensement 2022, base infracommunale Logement (Iris)", page: "https://www.insee.fr/fr/statistiques/8647012", url: "https://www.insee.fr/fr/statistiques/fichier/8647012/base-ic-logement-2022_csv.zip", year: 2022, licence: LO },
  activite: { name: "INSEE — Recensement 2022, base infracommunale Activité des résidents (Iris)", page: "https://www.insee.fr/fr/statistiques/8647006", url: "https://www.insee.fr/fr/statistiques/fichier/8647006/base-ic-activite-residents-2022_csv.zip", year: 2022, licence: LO },
  diplomes: { name: "INSEE — Recensement 2022, base infracommunale Diplômes – Formation (Iris)", page: "https://www.insee.fr/fr/statistiques/8647010", url: "https://www.insee.fr/fr/statistiques/fichier/8647010/base-ic-diplomes-formation-2022_csv.zip", year: 2022, licence: LO },
  filosofiIris: { name: "INSEE — Filosofi 2021, revenus disponibles (Iris)", page: "https://www.insee.fr/fr/statistiques/8229323", url: "https://www.insee.fr/fr/statistiques/fichier/8229323/BASE_TD_FILO_IRIS_2021_DISP_CSV.zip", year: 2021, licence: LO },
  filosofiCom: { name: "INSEE — Filosofi 2021, principaux indicateurs (communes, arrondissements, France métropolitaine), géographie 2025", page: "https://www.insee.fr/fr/statistiques/7756729", url: "https://www.insee.fr/fr/statistiques/fichier/7756729/base-cc-filosofi-2021-geo2025_csv.zip", year: 2021, licence: LO },
  commons: { name: "Wikimedia Commons — photos géolocalisées (API list=geosearch)", page: "https://commons.wikimedia.org/", licence: { name: "licence propre à chaque fichier (voir photos[].licence)" } },
  wikipedia: { name: "Wikipédia en français — articles géolocalisés (API list=geosearch, extraits TextExtracts)", page: "https://fr.wikipedia.org/", licence: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
  ai: { name: "Texte généré par Claude Haiku (Anthropic) à partir des seuls chiffres ci-dessus et des noms d'articles Wikipédia géolocalisés dans l'IRIS", page: "https://www.anthropic.com/" },
};

// Indicators: key → definition. `num`/`den` are census variables (counts, summed for commune/national values).
const INDICATORS = {
  population: { fr: "Population", en: "Population", unit: "inhabitants", source: "population", vars: ["P22_POP"] },
  under15: { fr: "Moins de 15 ans", en: "Under 15", unit: "%", source: "population", num: ["P22_POP0014"], den: ["P22_POP"] },
  over65: { fr: "65 ans ou plus", en: "65 or older", unit: "%", source: "population", num: ["P22_POP65P"], den: ["P22_POP"] },
  householdSize: { fr: "Personnes par ménage", en: "People per household", unit: "people", source: "logement", num: ["P22_PMEN"], den: ["P22_MEN"], ratio: true },
  apartments: { fr: "Appartements (part des logements)", en: "Flats (share of dwellings)", unit: "%", source: "logement", num: ["P22_APPART"], den: ["P22_LOG"] },
  owners: { fr: "Ménages propriétaires", en: "Owner-occupiers", unit: "%", source: "logement", num: ["P22_RP_PROP"], den: ["P22_RP"] },
  renters: { fr: "Ménages locataires", en: "Renters", unit: "%", source: "logement", num: ["P22_RP_LOC"], den: ["P22_RP"] },
  socialHousing: { fr: "Locataires HLM", en: "Social-housing tenants", unit: "%", source: "logement", num: ["P22_RP_LOCHLMV"], den: ["P22_RP"] },
  vacancy: { fr: "Logements vacants", en: "Vacant dwellings", unit: "%", source: "logement", num: ["P22_LOGVAC"], den: ["P22_LOG"] },
  unemployment: { fr: "Chômage des 15-64 ans (recensement)", en: "Unemployment, 15–64 (census)", unit: "%", source: "activite", num: ["P22_CHOM1564"], den: ["P22_ACT1564"] },
  higherEducation: { fr: "Diplômés du supérieur (15 ans ou plus non scolarisés)", en: "Higher-education graduates (15+, out of school)", unit: "%", source: "diplomes", num: ["P22_NSCOL15P_SUP2", "P22_NSCOL15P_SUP34", "P22_NSCOL15P_SUP5"], den: ["P22_NSCOL15P"] },
  noDiploma: { fr: "Sans diplôme ou certificat d'études (15 ans ou plus non scolarisés)", en: "No qualification (15+, out of school)", unit: "%", source: "diplomes", num: ["P22_NSCOL15P_DIPLMIN"], den: ["P22_NSCOL15P"] },
  medianIncome: { fr: "Niveau de vie médian (revenu disponible par UC)", en: "Median standard of living (disposable income per consumption unit)", unit: "€/year", source: "filosofiIris" },
  povertyRate: { fr: "Taux de pauvreté (seuil 60 %)", en: "Poverty rate (60% threshold)", unit: "%", source: "filosofiIris" },
};
const CENSUS_FILES = {
  population: "base-ic-evol-struct-pop-2022",
  logement: "base-ic-logement-2022",
  activite: "base-ic-activite-residents-2022",
  diplomes: "base-ic-diplomes-formation-2022",
};
const IRIS_TYPES = { H: { fr: "habitat", en: "residential" }, A: { fr: "activité", en: "business" }, D: { fr: "divers (grand espace, parc, zone portuaire…)", en: "other (large park, port area…)" } };
const PLM_CITY = (c) => (c.startsWith("751") ? "75056" : c.startsWith("6938") ? "69123" : c.startsWith("132") ? "13055" : null);
const PLM_NAMES = { "75056": "Paris", "69123": "Lyon", "13055": "Marseille" };

// ---------------------------------------------------------------- helpers
const r0 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const numFr = (s) => {
  if (s == null) return null;
  const t = String(s).trim().replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[’']/g, " ")
    .replace(/\bSAINTE\b/g, "STE")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
const hash = (s) => createHash("md5").update(s).digest("hex");
const exists = async (u) => stat(u).then(() => true, () => false);
async function readJson(u, fallback = null) {
  try {
    return JSON.parse(await readFile(u, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(u, v) {
  await writeFile(u, JSON.stringify(v));
}

// ---------------------------------------------------------------- polite HTTP (one queue per host)
const lastAt = new Map();
const GAP = { "commons.wikimedia.org": 650, "fr.wikipedia.org": 650 }; // ≤ ~90 req/min per host (Wikimedia allows 200/min)
const stats = { requests: 0, retries: 0 };
async function get(url, { json = true, tries = 10, form = null } = {}) {
  const host = new URL(url).host;
  for (let i = 1; ; i++) {
    const gap = GAP[host] ?? 200;
    const wait = (lastAt.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt.set(host, Date.now());
    stats.requests++;
    let res;
    try {
      res = await fetch(url, form ? { method: "POST", body: new URLSearchParams(form), headers: { "User-Agent": UA, "Api-User-Agent": UA } } : { headers: { "User-Agent": UA, "Api-User-Agent": UA, "Accept-Encoding": "gzip" } });
    } catch (e) {
      if (i >= tries) throw e;
      stats.retries++;
      await sleep(3000 * i);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (i >= tries) throw new Error(`HTTP ${res.status} ${url}`);
      stats.retries++;
      const ra = Number(res.headers.get("retry-after")) || 5 * i;
      await res.arrayBuffer().catch(() => {});
      lastAt.set(host, Date.now() + Math.min(ra, 300) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    if (!json) return Buffer.from(await res.arrayBuffer());
    const j = await res.json();
    if (j?.error && /busy|try again|maxlag|ratelimit|timeout/i.test(`${j.error.code} ${j.error.info}`) && i < tries) {
      stats.retries++;
      lastAt.set(host, Date.now() + 10000 * i);
      continue;
    }
    return j;
  }
}
// Download once into the cache (official files: kept 30 days unless --refresh)
async function cachedFile(name, url, maxAgeDays = 30) {
  await mkdir(CACHE, { recursive: true });
  const f = new URL(name, CACHE);
  if (!REFRESH) {
    try {
      const s = await stat(f);
      if (Date.now() - s.mtimeMs < maxAgeDays * 864e5) return readFile(f);
    } catch {}
  }
  console.log(`  ↓ ${url}`);
  const buf = await get(url, { json: false });
  await writeFile(f, buf);
  return buf;
}
// JSON answer memoised in the cache (Wikimedia API, WFS), keyed by name
async function memo(dir, name, fn, maxAgeDays = 60) {
  const d = new URL(`${dir}/`, CACHE);
  await mkdir(d, { recursive: true });
  const f = new URL(`${name}.json`, d);
  if (!REFRESH) {
    try {
      const s = await stat(f);
      if (Date.now() - s.mtimeMs < maxAgeDays * 864e5) return JSON.parse(await readFile(f, "utf8"));
    } catch {}
  }
  const v = await fn();
  await writeFile(f, JSON.stringify(v));
  return v;
}

// ---------------------------------------------------------------- geometry
const polysOf = (g) => (!g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(lon, lat, g) {
  for (const p of polysOf(g)) {
    if (!inRing(lon, lat, p[0])) continue;
    if (p.slice(1).some((h) => inRing(lon, lat, h))) continue;
    return true;
  }
  return false;
}
function bboxOf(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polysOf(g)) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
// planar area (km²) on a local equirectangular projection
function areaKm2(g) {
  const [, y0, , y1] = bboxOf(g);
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const ringA = (r) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * k + r[i][0] * k) * (r[j][1] - r[i][1]);
    return Math.abs(a / 2);
  };
  let a = 0;
  for (const p of polysOf(g)) a += ringA(p[0]) - p.slice(1).reduce((s, h) => s + ringA(h), 0);
  return a * 111.32 * 111.32;
}
// a point guaranteed inside the polygon (widest horizontal segment through the largest part, at several latitudes)
function interiorPoint(g) {
  let best = null;
  const parts = polysOf(g);
  for (const p of parts) {
    const [, y0, , y1] = bboxOf({ type: "Polygon", coordinates: p });
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const y = y0 + (y1 - y0) * f;
      const xs = [];
      for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const w = xs[i + 1] - xs[i];
        if (!best || w > best.w) best = { w, x: (xs[i] + xs[i + 1]) / 2, y };
      }
    }
  }
  return best ? [best.x, best.y] : null;
}
const distM = ([x1, y1], [x2, y2]) => {
  const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
  return Math.hypot((x2 - x1) * k, y2 - y1) * 111320;
};
// Douglas–Peucker on one ring, then rounding to 5 decimals (≈ 1 m)
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let d;
      if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > md) { md = d; mi = i; }
    }
    if (md > t2) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) {
    const p = [Math.round(ring[i][0] * 1e5) / 1e5, Math.round(ring[i][1] * 1e5) / 1e5];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}
function simplifyGeom(g, tol) {
  const polys = [];
  for (const p of polysOf(g)) {
    const outer = simplifyRing(p[0], tol);
    if (!outer) continue;
    polys.push([outer, ...p.slice(1).map((h) => simplifyRing(h, tol)).filter(Boolean)]);
  }
  if (!polys.length) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

// ---------------------------------------------------------------- 1. IRIS list and contours (IGN WFS)
const WFS = "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=STATISTICALUNITS.IRIS:contours_iris&OUTPUTFORMAT=application/json";
async function loadIrisList() {
  return memo("wfs", "iris-attributes", async () => {
    const all = [];
    for (let start = 0; ; start += 5000) {
      const j = await get(`${WFS}&PROPERTYNAME=code_insee,nom_commune,code_iris,nom_iris,type_iris&COUNT=5000&STARTINDEX=${start}&SORTBY=code_iris`);
      all.push(...j.features.map((f) => f.properties));
      if (j.features.length < 5000) break;
    }
    return all;
  }, 30);
}
async function loadContours(codes) {
  // batches of 30 communes per WFS request, memoised per batch
  const out = new Map();
  for (let i = 0; i < codes.length; i += 30) {
    const batch = codes.slice(i, i + 30);
    const cql = `code_insee IN (${batch.map((c) => `'${c}'`).join(",")}) AND type_iris<>'Z'`;
    const j = await memo("wfs", `contours-${hash(cql)}`, async () => {
      const feats = [];
      for (let start = 0; ; start += 5000) {
        const r = await get(`${WFS}&COUNT=5000&STARTINDEX=${start}&SORTBY=code_iris&CQL_FILTER=${encodeURIComponent(cql)}`);
        feats.push(...r.features);
        if (r.features.length < 5000) break;
      }
      return feats;
    }, 30);
    for (const f of j) out.set(f.properties.code_iris, f.geometry);
  }
  return out;
}

// ---------------------------------------------------------------- 2. census and Filosofi (INSEE)
function readZipCsv(buf, re) {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => re.test(f.name) });
  const name = Object.keys(files)[0];
  if (!name) throw new Error(`no ${re} in archive`);
  return strFromU8(files[name]);
}
// Census: keep the variables used by INDICATORS for every IRIS; sum them per commune (COM) and nationally.
async function loadCensus() {
  const iris = new Map(), com = new Map(), nat = {};
  const meta = new Map(); // IRIS → { com, type }
  for (const [src, base] of Object.entries(CENSUS_FILES)) {
    const vars = [...new Set(Object.values(INDICATORS).filter((d) => d.source === src).flatMap((d) => [...(d.vars ?? []), ...(d.num ?? []), ...(d.den ?? [])]))];
    const text = readZipCsv(await cachedFile(`${base}_csv.zip`, SOURCES[src].url), new RegExp(`^${base}\\.csv$`, "i"));
    const lines = text.split(/\r?\n/);
    const H = lines[0].replace(/^﻿/, "").split(";");
    const ix = Object.fromEntries(H.map((h, i) => [h, i]));
    for (const v of vars) if (ix[v] == null) throw new Error(`${base}: missing column ${v}`);
    for (let l = 1; l < lines.length; l++) {
      if (!lines[l]) continue;
      const r = lines[l].split(";");
      const code = r[ix.IRIS], c = r[ix.COM];
      if (!meta.has(code)) meta.set(code, { com: c, type: r[ix.TYP_IRIS] });
      const o = iris.get(code) ?? {};
      const oc = com.get(c) ?? {};
      for (const v of vars) {
        const x = numFr(r[ix[v]]);
        o[v] = x;
        if (x != null) { oc[v] = (oc[v] ?? 0) + x; nat[v] = (nat[v] ?? 0) + x; }
      }
      iris.set(code, o);
      com.set(c, oc);
    }
    console.log(`  census ${src}: ${lines.length - 2} rows`);
  }
  // PLM cities = sum of their arrondissements
  for (const [c, o] of [...com]) {
    const city = PLM_CITY(c);
    if (!city) continue;
    const t = com.get(city) ?? {};
    for (const [k, v] of Object.entries(o)) t[k] = (t[k] ?? 0) + v;
    com.set(city, t);
  }
  return { iris, com, nat, meta };
}
async function loadFilosofi() {
  const text = readZipCsv(await cachedFile("BASE_TD_FILO_IRIS_2021_DISP_CSV.zip", SOURCES.filosofiIris.url), /^BASE_TD_FILO_IRIS_2021_DISP\.csv$/i);
  const lines = text.split(/\r?\n/);
  const H = lines[0].replace(/^﻿/, "").split(";");
  const ix = Object.fromEntries(H.map((h, i) => [h, i]));
  const iris = new Map();
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const r = l.split(";");
    iris.set(r[ix.IRIS], { medianIncome: numFr(r[ix.DISP_MED21]), povertyRate: numFr(r[ix.DISP_TP6021]), note: r[ix.DISP_NOTE21] });
  }
  // communes / arrondissements / France métropolitaine (same 2021 vintage)
  const t2 = readZipCsv(await cachedFile("base-cc-filosofi-2021-geo2025_csv.zip", SOURCES.filosofiCom.url), /DS_FILOSOFI_CC_data\.csv$/i);
  const com = new Map();
  let national = {};
  for (const l of t2.split(/\r?\n/)) {
    if (!l.includes("MED_SL") && !l.includes("PR_MD60")) continue;
    const [geo, obj, meas, , , , , , val] = l.split(";").map((s) => s.replace(/^"|"$/g, ""));
    if (meas !== "MED_SL" && meas !== "PR_MD60") continue;
    const key = meas === "MED_SL" ? "medianIncome" : "povertyRate";
    if (obj === "FRANCE" && geo === "FM") national[key] = numFr(val);
    else if (obj === "COM" || obj === "ARM") (com.get(geo) ?? com.set(geo, {}).get(geo))[key] = numFr(val);
  }
  console.log(`  filosofi: ${iris.size} IRIS, ${com.size} communes`);
  return { iris, com, national };
}
function indicatorValues(vals, filo) {
  const out = {};
  for (const [k, d] of Object.entries(INDICATORS)) {
    if (d.source === "filosofiIris") { out[k] = filo?.[k] ?? null; continue; }
    if (!vals) { out[k] = null; continue; }
    if (d.vars) { out[k] = r0(vals[d.vars[0]]); continue; }
    const nums = d.num.map((v) => vals[v]), dens = d.den.map((v) => vals[v]);
    if (nums.some((x) => x == null) || dens.some((x) => x == null)) { out[k] = null; continue; }
    const n = nums.reduce((a, b) => a + b, 0), den = dens.reduce((a, b) => a + b, 0);
    out[k] = den > 0 ? (d.ratio ? r2(n / den) : r1((100 * n) / den)) : null;
  }
  return out;
}

// ---------------------------------------------------------------- 3. Wikipedia (fr): geolocated articles of a commune
const WP = "https://fr.wikipedia.org/w/api.php?format=json&formatversion=2&action=query";
async function wikiArticlesInBbox(code, bb) {
  // quadtree over the commune bbox: list=geosearch returns at most 500 hits per box
  return memo("wiki", `geo-${code}`, async () => {
    const found = new Map();
    const boxes = [bb];
    let n = 0;
    while (boxes.length && n < 200) {
      const [x0, y0, x1, y1] = boxes.pop();
      n++;
      const j = await get(`${WP}&list=geosearch&gsbbox=${y1}|${x0}|${y0}|${x1}&gslimit=500&gsnamespace=0`);
      const big = j.error?.code === "toobig" || (j.query?.geosearch?.length ?? 0) >= 500;
      if (j.error && j.error.code !== "toobig") throw new Error(`wiki geosearch: ${j.error.info}`);
      if (big && x1 - x0 > 0.002) {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        boxes.push([x0, y0, mx, my], [mx, y0, x1, my], [x0, my, mx, y1], [mx, my, x1, y1]);
        if (j.error) continue;
      }
      for (const a of j.query?.geosearch ?? []) found.set(a.pageid, { id: a.pageid, title: a.title, lat: a.lat, lon: a.lon });
    }
    return [...found.values()];
  });
}
async function wikiIntros(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const j = await memo("wiki", `intro-${hash(batch.join("|"))}`, () =>
      get(`${WP}&prop=extracts|info|pageprops&exintro=1&explaintext=1&exsentences=3&exlimit=20&inprop=url&ppprop=disambiguation&redirects=1`, { form: { titles: batch.join("|") } }),
    );
    for (const p of j.query?.pages ?? []) if (!p.missing) out.set(p.title, { title: p.title, url: p.fullurl ?? `https://fr.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, extract: p.extract ?? "", disambiguation: p.pageprops && "disambiguation" in p.pageprops });
  }
  return out;
}
// IRIS name → candidate quartier name (drop trailing numbers / roman numerals, "Quartier", "IRIS")
function coreName(s) {
  return norm(s)
    .replace(/^(QUARTIER|QUARTIERS|IRIS|SECTEUR|CITE)\s+(DU |DE LA |DE L |DES |DE |D )?/, "")
    .replace(/\s+([0-9]+|[IVX]+|[A-Z])$/, "")
    .replace(/\s+([0-9]+|[IVX]+)$/, "")
    .trim();
}
function titleCore(title, communeName) {
  const m = title.match(/^(.*?)\s*\(([^)]*)\)$/);
  let base = m ? m[1] : title, dis = m ? m[2] : null;
  // a disambiguation is accepted only if it is the commune itself or says "quartier" (rejects "(métro de Rennes)"…)
  if (dis && !/quartier|faubourg/i.test(dis) && norm(dis) !== norm(communeName)) return null;
  return norm(base).replace(/^(QUARTIER|QUARTIERS)\s+(DU |DE LA |DE L |DES |DE |D )?/, "").trim();
}
// geolocated articles that are not places (events, electoral units…)
const NOT_PLACE = /^(Canton|Bataille|Siège|Circonscription|Élections?|Traité|Incendie|Attentat|Affaire|Massacre|Accident|Émeute|Grève|Festival|Liste|Arrondissement|Prise|Combat|Explosion|Catastrophe|Inondations?|Tuerie|Meurtre|Assassinat|Fusillade|Manifestations?|Concile|Conclave)\b/;
// evidence that the article is about a quartier: its title says so, or its first sentence says "X est (l'un des / un…) quartier…"
// within the first words after the verb (so "un centre commercial situé dans le quartier…" does not count)
function isQuartierArticle(intro) {
  if (/^Quartiers?\b/i.test(intro.title) || /\(quartier/i.test(intro.title)) return true;
  const first = intro.extract.split(/(?<=[.!?])\s/)[0] ?? "";
  const m = first.match(/\s(est|sont|était|forme|constitue)\s+(.*)$/i);
  if (!m) return false;
  const head = m[2].split(/\s+/).slice(0, 6).join(" ");
  return QUARTIER_RE.test(head);
}
const QUARTIER_RE = /\b(quartiers?|faubourgs?|secteur|lieu-dit|hameau|grand ensemble|cité|ancienne commune|ancien village|village|district|zone d'aménagement)\b/i;

// ---------------------------------------------------------------- 4. Wikimedia Commons photos inside an IRIS
const CM = "https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&action=query";
const GOOD = /\b(streets?|rues?|avenues?|boulevards?|squares?|places?|parks?|parcs?|jardins?|gardens?|buildings?|b[aâ]timents?|immeubles?|houses?|maisons?|h[oô]tels? particuliers?|churches|[ée]glises?|chapels?|chapelles?|architecture|views?|vues?|bridges?|ponts?|fountains?|fontaines?|markets?|march[ée]s?|halles?|quais?|canals?|canal|fa[cç]ades?|skyline|cityscapes?|monuments?|castles?|ch[aâ]teaux?|towers?|tours?|stations?|gares?|schools?|[ée]coles?|neighbourhoods?|quartiers?|aerial|panoramas?|riverbanks?|berges?|cours|all[ée]es?|passages?|impasses?)\b/i;
const BAD = /\b(portraits?|people|personnes?|logos?|maps?|cartes?|plans? of|interiors?|int[ée]rieurs?|details?|d[ée]tails?|inscriptions?|plaques?|signs?|panneaux?|vehicles?|buses|bus|automobiles?|cars|trains?|locomotives?|aircraft|food|cuisine|animals?|insects?|birds?|oiseaux|flowers?|fleurs?|plants?|concerts?|protests?|manifestations?|demonstrations?|sports?|matchs?|football|rugby|paintings?|peintures?|stained glass|vitraux|vitrail|organs?|orgues?|tombs?|tombes?|graves?|gravestones?|s[ée]pultures?|fun[ée]raires?|funerary|epitaphs?|[ée]pitaphes?|sculptures? details?|museum objects?|collections? of|selfies?|cats?|dogs?|chats?|chiens?|documents?|scans?|screenshots?|letterheads?|en-t[êe]te|car|motorcycles?|Honda|Peugeot|Toyota|Volkswagen|BMW|Mercedes-Benz|ISS\d+|View of Earth|astronauts?|satellites?|species|insecta|coleoptera|lepidoptera|diptera|hymenoptera|arachnida|fungi|mushrooms?|rall(y|ies)|campaign\w*|wikimania|wikip[ée]dia|wikimedia|meetups?|conferences?|anniversaires?|carnavals?|parades?|d[ée]fil[ée]s?|women|woman|men|man|girls?|boys?|nudes?|nudity|naked|breasts?|bod(y|ies)|sex\w*|erotic\w*|lingerie|underwear|femmes?|hommes?|enfants?|children|crowds?|foules?|politicians?|elections?|[ée]lections?|ceremon(y|ies)|c[ée]r[ée]monies?|weddings?|mariages?|festivals?|exhibitions?|expositions?|performers?|musicians?|dancers?|actors?|actresses?|couloirs?|corridors?|prononçant|discours|speech(es)?|paintings? by|engravings?|gravures?|drawings?|dessins?|postcards?|cartes? postales?|selfies?)\b/i;
const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
// One request per IRIS: the 50 files nearest to an interior point of the IRIS (generator=geosearch), with their
// coordinates and metadata; only files whose coordinates fall inside the IRIS polygon are kept.
async function commonsPhotos(irisCode, geom, placeNames, center) {
  const [x0, y0, x1, y1] = bboxOf(geom);
  const c = center ?? [(x0 + x1) / 2, (y0 + y1) / 2];
  const far = Math.max(...[[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map((q) => distM(c, q)));
  const radius = Math.max(100, Math.min(10000, Math.ceil(far)));
  if (CACHED_PHOTOS && !(await exists(new URL(`commons/gen-${irisCode}.json`, CACHE)))) return null;
  const pages = await memo("commons", `gen-${irisCode}`, async () => {
    const j = await get(
      `${CM}&generator=geosearch&ggscoord=${c[1].toFixed(6)}|${c[0].toFixed(6)}&ggsradius=${radius}&ggslimit=50&ggsnamespace=6` +
        `&prop=coordinates|imageinfo&colimit=max&iiprop=url|size|mime|extmetadata&iiurlwidth=640&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|Categories|Assessments`,
    );
    if (j.error) throw new Error(`commons geosearch: ${j.error.info}`);
    return (j.query?.pages ?? []).map((p) => {
      const ii = p.imageinfo?.[0];
      const co = p.coordinates?.[0];
      if (!ii || !co) return null;
      const m = ii.extmetadata ?? {};
      return {
        title: p.title, lat: co.lat, lon: co.lon, mime: ii.mime, width: ii.width, height: ii.height, thumb: ii.thumburl, thumbWidth: ii.thumbwidth,
        page: ii.descriptionurl, author: noEmail(stripHtml(m.Artist?.value)).slice(0, 160) || null, licence: m.LicenseShortName?.value ?? null,
        licenceUrl: m.LicenseUrl?.value ?? null, categories: m.Categories?.value ?? "", assessments: m.Assessments?.value ?? "",
      };
    }).filter(Boolean);
  });
  const info = pages.filter((f) => inGeom(f.lon, f.lat, geom));
  const scored = [];
  for (const f of info) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.mime) || !f.thumb || !f.licence) continue;
    if (f.width < 800 || f.height < 450) continue;
    const ar = f.width / f.height;
    if (ar > 3 || ar < 0.5) continue;
    const text = `${f.title} ${f.categories.replace(/\|/g, " ")}`;
    const normText = ` ${norm(text)} `;
    let s = 0;
    const quality = /featured/.test(f.assessments) ? "featured" : /quality/.test(f.assessments) ? "quality" : /valued/.test(f.assessments) ? "valued" : null;
    s += quality === "featured" ? 6 : quality === "quality" ? 4 : quality === "valued" ? 3 : 0;
    if (GOOD.test(text)) s += 2;
    if (placeNames.some((n) => n.length > 3 && normText.includes(n))) s += 1;
    if (BAD.test(text)) continue; // people, events, objects, documents… are never kept, even when assessed
    // keep only files with a positive signal: an assessment, a street/building/park word, or the commune's name
    if (s < 1) continue;
    scored.push({ ...f, quality, score: s });
  }
  scored.sort((a, b) => b.score - a.score || b.width - a.width);
  const photos = [], perAuthor = new Map(), stems = new Set();
  for (const f of scored) {
    if (photos.length >= MAX_PHOTOS) break;
    const stem = norm(f.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "")).replace(/[0-9 ]+/g, "").slice(0, 22);
    const a = f.author ?? "?";
    if ((perAuthor.get(a) ?? 0) >= 2 || (stem.length > 6 && stems.has(stem))) continue;
    perAuthor.set(a, (perAuthor.get(a) ?? 0) + 1);
    stems.add(stem);
    // the API answers iiurlwidth=640 with the nearest standard Wikimedia thumbnail step (960 px); drop its tracking query
    const thumb = f.thumb.replace(/\?.*$/, "");
    const tw = Number(thumb.match(/\/(\d+)px-[^/]+$/)?.[1]) || f.thumbWidth;
    photos.push({
      title: f.title.replace(/^File:/, ""), thumb, thumbWidth: tw, thumbHeight: Math.round((tw * f.height) / f.width), page: f.page,
      author: f.author, licence: f.licence, licenceUrl: f.licenceUrl, quality: f.quality,
    });
  }
  return { candidates: pages.length, inside: info.length, photos };
}

// ---------------------------------------------------------------- 5. optional AI description (Claude Haiku)
let aiSpent = null, aiCalls = 0, aiCost = 0;
async function aiDescription(ctx) {
  const { ask } = await import("./lib/claude.mjs");
  if (aiSpent == null) {
    const l = await readJson(new URL(`data/usage/claude-${TODAY.slice(0, 7)}.json`, ROOT), {});
    aiSpent = l.byJob?.[AI_JOB] ?? 0;
  }
  if (aiSpent >= AI_BUDGET_USD - 0.01) return null;
  const system =
    "You write short, strictly factual neighbourhood descriptions for a French civic website. Use ONLY the facts given. " +
    "Never mention a place, street, landmark, history or feature that is not in the list of named places. Do not judge or rank (no 'good', 'safe', 'popular', 'vibrant'). " +
    "Compare with the commune only using the numbers given. Answer with JSON only: {\"fr\": \"two sentences in French\", \"en\": \"the same two sentences in English\"}.";
  const user = JSON.stringify(ctx);
  const res = await ask({ system, messages: [{ role: "user", content: user }], max_tokens: 300 }, AI_JOB);
  const u = res.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * 0.1 + (u.output_tokens ?? 0) * 0.5) / 1e6;
  aiSpent += cost; aiCost += cost; aiCalls++;
  const text = res.content?.find((b) => b.type === "text")?.text ?? "";
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof j.fr === "string" && typeof j.en === "string") return { fr: j.fr.trim(), en: j.en.trim() };
  } catch {}
  return null;
}

// ---------------------------------------------------------------- main
await mkdir(OUT, { recursive: true });
console.log("IRIS list (IGN WFS)…");
const irisList = await loadIrisList();
const byCommune = new Map();
for (const p of irisList) {
  if (p.type_iris === "Z") continue;
  (byCommune.get(p.code_insee) ?? byCommune.set(p.code_insee, { code: p.code_insee, name: p.nom_commune, iris: [] }).get(p.code_insee)).iris.push(p);
}
console.log(`  ${irisList.length} features, ${byCommune.size} communes with IRIS`);

console.log("INSEE census 2022 and Filosofi 2021…");
const census = await loadCensus();
const filo = await loadFilosofi();

// commune population (census 2022): PLM arrondissements ranked with their whole city
const popOf = (c) => census.com.get(c)?.P22_POP ?? 0;
const rankKey = (c) => PLM_CITY(c) ?? c;
let selected;
if (CODES) selected = CODES.filter((c) => byCommune.has(c));
else if (ALL) selected = [...byCommune.keys()];
else {
  const cities = [...new Set([...byCommune.keys()].map(rankKey))].sort((a, b) => popOf(b) - popOf(a)).slice(0, TOP);
  const keep = new Set(cities);
  selected = [...byCommune.keys()].filter((c) => keep.has(rankKey(c)));
}
selected.sort((a, b) => popOf(rankKey(b)) - popOf(rankKey(a)) || a.localeCompare(b));
console.log(`Selected ${selected.length} communes / arrondissements`);

console.log("Contours (IGN WFS)…");
const contours = await loadContours(selected);

const NAT = indicatorValues(census.nat, filo.national);
const cov = { communes: 0, iris: 0, withPhotos: 0, photos: 0, withWiki: 0, withAi: 0, withPlaces: 0, missingCensus: 0, missingIncome: 0, missingGeom: 0, quality: 0 };
const indexEntries = [];
let totalJson = 0, totalGeo = 0, maxJson = 0, maxGeo = 0;
let ci = 0;
for (const code of selected) {
  ci++;
  const c = byCommune.get(code);
  const cityCode = PLM_CITY(code);
  const comPop = popOf(rankKey(code));
  const prev = await readJson(new URL(`${code}.json`, OUT));
  const prevById = new Map((prev?.iris ?? []).map((i) => [i.code, i]));
  // comparison values
  const comVals = indicatorValues(census.com.get(code), filo.com.get(code));
  const cityVals = cityCode ? indicatorValues(census.com.get(cityCode), filo.com.get(cityCode)) : null;

  // Wikipedia: geolocated articles of the commune
  const geoms = c.iris.map((p) => contours.get(p.code_iris)).filter(Boolean);
  let articles = [];
  if (WIKI && geoms.length) {
    const bbs = geoms.map(bboxOf);
    const bb = [Math.min(...bbs.map((b) => b[0])), Math.min(...bbs.map((b) => b[1])), Math.max(...bbs.map((b) => b[2])), Math.max(...bbs.map((b) => b[3]))];
    try {
      articles = await wikiArticlesInBbox(code, bb);
    } catch (e) {
      console.warn(`  ! wikipedia ${code}: ${e.message}`);
    }
  }
  // place each article in its IRIS
  const artByIris = new Map();
  for (const a of articles) {
    const p = c.iris.find((p) => contours.get(p.code_iris) && inGeom(a.lon, a.lat, contours.get(p.code_iris)));
    if (p) (artByIris.get(p.code_iris) ?? artByIris.set(p.code_iris, []).get(p.code_iris)).push(a);
  }
  const inCommune = [...artByIris.values()].flat();
  const communeNorm = norm(cityCode ? PLM_NAMES[cityCode] : c.name.replace(/\s+\d+e(r)?\s+Arrondissement$/i, ""));
  // name matches: IRIS core name == article title core, article inside the commune
  const matchCand = new Map(); // IRIS → article title
  for (const p of c.iris) {
    const core = coreName(p.nom_iris);
    const core2 = core.replace(/\s+(NORD|SUD|EST|OUEST|CENTRE|NORD EST|NORD OUEST|SUD EST|SUD OUEST|HAUT|BAS|NORD OUEST)$/, "").trim();
    if (core.length < 3 || core === communeNorm) continue;
    const tc = (a) => titleCore(a.title, cityCode ? PLM_NAMES[cityCode] : c.name);
    const m = inCommune.find((a) => tc(a) === core) ?? (core2.length >= 3 && core2 !== communeNorm ? inCommune.find((a) => tc(a) === core2) : null);
    if (m) matchCand.set(p.code_iris, m.title);
  }
  const intros = matchCand.size ? await wikiIntros([...new Set(matchCand.values())]) : new Map();

  const placeNames = [...new Set([norm(c.name.replace(/\s+\d+e(r)?\s+Arrondissement$/i, "")), cityCode ? norm(PLM_NAMES[cityCode]) : null].filter(Boolean))];
  const irisOut = [];
  const features = [];
  for (const p of c.iris.sort((a, b) => a.code_iris.localeCompare(b.code_iris))) {
    const geom = contours.get(p.code_iris);
    const cv = census.iris.get(p.code_iris);
    const fv = filo.iris.get(p.code_iris);
    const figures = indicatorValues(cv, fv);
    const missing = {};
    if (!cv) { missing.census = /^97[5-8]/.test(code) || code.startsWith("976") ? "not covered by the 2022 census IRIS files (Mayotte and overseas collectivities are outside their scope)" : "IRIS absent from the 2022 census files (geography of 1 Jan 2024): created or recoded since"; cov.missingCensus++; }
    if (!fv) missing.income = /^97[1-8]/.test(code) && !/^97[24]/.test(code) ? "Filosofi 2021 IRIS covers only metropolitan France, Martinique and La Réunion" : "IRIS not published in Filosofi 2021 (too few tax households, statistical secrecy, or IRIS created/recoded since 2022)";
    else if (figures.medianIncome == null) missing.income = "value under statistical secrecy in Filosofi 2021";
    if (figures.medianIncome == null) cov.missingIncome++;
    const center = geom ? interiorPoint(geom) : null;
    const entry = {
      code: p.code_iris,
      name: p.nom_iris,
      type: p.type_iris,
      center: center ? [r5(center[0]), r5(center[1])] : null,
      areaKm2: geom ? r2(areaKm2(geom)) : null,
      figures,
      ...(cv && cv.P22_POP != null && cv.P22_POP < 300 ? { lowPopulation: true } : {}),
      ...(Object.keys(missing).length ? { missing } : {}),
      quartier: null,
      places: [],
      description: null,
      photos: [],
    };
    if (!geom) cov.missingGeom++;
    // Wikipedia quartier
    const t = matchCand.get(p.code_iris);
    const intro = t ? intros.get(t) : null;
    if (intro && !intro.disambiguation && isQuartierArticle(intro)) {
      entry.quartier = { name: intro.title.replace(/\s*\([^)]*\)$/, ""), wikipedia: intro.url, match: "IRIS name = article title; article geolocated in the commune; first sentence describes a quartier" };
      const para = intro.extract.split(/\n/)[0].replace(/\s+/g, " ").trim();
      const ss = para.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý«])/).slice(0, 2);
      while (ss.length && /:\s*$/.test(ss[ss.length - 1])) ss.pop();
      const sentences = ss.join(" ").trim();
      if (sentences) {
        entry.description = { source: "wikipedia", lang: "fr", text: sentences, url: intro.url, title: intro.title, licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };
        cov.withWiki++;
      }
    }
    // named places (geolocated Wikipedia articles inside the IRIS)
    const arts = (artByIris.get(p.code_iris) ?? []).filter((a) => norm(a.title) !== communeNorm && a.title !== t && !NOT_PLACE.test(a.title));
    if (center) arts.sort((a, b) => distM(center, [a.lon, a.lat]) - distM(center, [b.lon, b.lat]));
    entry.places = arts.slice(0, 8).map((a) => ({ title: a.title, url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(a.title.replace(/ /g, "_"))}` }));
    if (!WIKI && prevById.has(p.code_iris)) {
      // --no-wiki: keep what an earlier run found
      const o = prevById.get(p.code_iris);
      entry.quartier = o.quartier ?? null;
      entry.places = o.places ?? [];
      if (o.description?.source === "wikipedia") { entry.description = o.description; cov.withWiki++; }
    }
    if (entry.places.length) cov.withPlaces++;
    // photos
    if (PHOTOS && geom) {
      try {
        const r = await commonsPhotos(p.code_iris, geom, placeNames, center);
        entry.photos = r ? r.photos : prevById.get(p.code_iris)?.photos ?? [];
      } catch (e) {
        console.warn(`  ! commons ${p.code_iris}: ${e.message}`);
        entry.photos = prevById.get(p.code_iris)?.photos ?? [];
      }
    } else if (!PHOTOS) entry.photos = prevById.get(p.code_iris)?.photos ?? [];
    if (entry.photos.length) cov.withPhotos++;
    cov.photos += entry.photos.length;
    cov.quality += entry.photos.filter((x) => x.quality).length;
    // AI description (optional, communes ≥ 100,000 only, no Wikipedia text)
    if (!entry.description && comPop >= AI_MIN_POP) {
      const ctx = {
        iris: p.nom_iris, irisType: IRIS_TYPES[p.type_iris]?.en, commune: cityCode ? `${c.name} (${PLM_NAMES[cityCode]})` : c.name,
        figures: Object.fromEntries(Object.entries(figures).filter(([, v]) => v != null).map(([k, v]) => [`${k} (${INDICATORS[k].unit})`, v])),
        communeFigures: Object.fromEntries(Object.entries(comVals).filter(([, v]) => v != null).map(([k, v]) => [`${k} (${INDICATORS[k].unit})`, v])),
        namedPlaces: entry.places.map((x) => x.title),
      };
      const key = hash(JSON.stringify(ctx));
      const old = prevById.get(p.code_iris)?.description;
      if (old?.source === "ai" && old.inputHash === key) entry.description = old;
      else if (AI && process.env.ANTHROPIC_API_KEY) {
        try {
          const d = await aiDescription(ctx);
          if (d) entry.description = { source: "ai", aiGenerated: true, model: "claude-haiku-5-5", generated: TODAY, text: d.fr, textEn: d.en, inputHash: key, basis: "figures above and names of geolocated Wikipedia articles only" };
        } catch (e) {
          console.warn(`  ! ai ${p.code_iris}: ${e.message}`);
        }
      }
      if (entry.description?.source === "ai") cov.withAi++;
    }
    irisOut.push(entry);
    if (geom) {
      const g = simplifyGeom(geom, TOL);
      if (g) features.push({ type: "Feature", properties: { code: p.code_iris, name: p.nom_iris, type: p.type_iris }, geometry: g });
    }
  }
  const doc = {
    code,
    name: c.name,
    ...(cityCode ? { city: { code: cityCode, name: PLM_NAMES[cityCode] } } : {}),
    generated: TODAY,
    schemaVersion: SCHEMA_VERSION,
    population: { value: r0(popOf(code)), year: 2022, source: "population" },
    irisCount: irisOut.length,
    comparison: {
      commune: { label: cityCode ? "arrondissement" : "commune", ...comVals },
      ...(cityVals ? { city: { label: PLM_NAMES[cityCode], ...cityVals } } : {}),
      national: { label: "France (census: excl. Mayotte; income: metropolitan France)", ...NAT },
    },
    iris: irisOut,
  };
  const js = JSON.stringify(doc);
  const gj = JSON.stringify({ type: "FeatureCollection", features });
  await writeFile(new URL(`${code}.json`, OUT), js);
  await writeFile(new URL(`${code}.geojson`, OUT), gj);
  totalJson += js.length; totalGeo += gj.length; maxJson = Math.max(maxJson, js.length); maxGeo = Math.max(maxGeo, gj.length);
  cov.communes++;
  cov.iris += irisOut.length;
  console.log(`[${ci}/${selected.length}] ${code} ${c.name}: ${irisOut.length} IRIS, photos ${irisOut.filter((i) => i.photos.length).length}, wiki ${irisOut.filter((i) => i.description?.source === "wikipedia").length}, ${(js.length / 1024).toFixed(0)} + ${(gj.length / 1024).toFixed(0)} KB (requests ${stats.requests}, retries ${stats.retries})`);
}
function r5(x) {
  return Math.round(x * 1e5) / 1e5;
}

// index: every commune file present (so partial runs accumulate)
const files = (await readdir(OUT)).filter((f) => /^[0-9AB]{5}\.json$/.test(f));
for (const f of files) {
  const d = await readJson(new URL(f, OUT));
  if (!d) continue;
  indexEntries.push({
    code: d.code, name: d.name, ...(d.city ? { city: d.city.code } : {}), population: d.population?.value ?? null, iris: d.irisCount,
    withPhotos: d.iris.filter((i) => i.photos.length).length, withDescription: d.iris.filter((i) => i.description).length,
  });
}
indexEntries.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
await writeFile(
  new URL("index.json", OUT),
  JSON.stringify({
    generated: TODAY,
    schemaVersion: SCHEMA_VERSION,
    doc: "docs/data-quartiers.md",
    irisTypes: IRIS_TYPES,
    indicators: Object.fromEntries(Object.entries(INDICATORS).map(([k, d]) => [k, { fr: d.fr, en: d.en, unit: d.unit, source: d.source, year: SOURCES[d.source].year }])),
    sources: SOURCES,
    national: NAT,
    communes: indexEntries,
  }),
);
console.log("\nCoverage of this run:", JSON.stringify(cov));
console.log(`Sizes this run: JSON ${(totalJson / 1048576).toFixed(1)} MB (max ${(maxJson / 1024).toFixed(0)} KB), GeoJSON ${(totalGeo / 1048576).toFixed(1)} MB (max ${(maxGeo / 1024).toFixed(0)} KB)`);
console.log(`Requests ${stats.requests} (retries ${stats.retries}); AI calls ${aiCalls}, $${aiCost.toFixed(4)}`);
