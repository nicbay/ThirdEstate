// Legislative election history and the district "shift map" (one arrow per district / department).
// Historical data: run once, or again with --refresh to re-download the sources.
//   node scripts/sync-legislative-history.mjs [--refresh]
//
// Sources (all free / open, see docs/data-legislative-history.md):
//   2012–2024  Ministry of the Interior results by district, via data.gouv.fr
//              (tabular API for 2022 and 2024; raw files for 2012 polling stations and 2017 xlsx)
//   1958–2007  Sciences Po CDSP "Élections législatives 1958-2012" (ODbL), by old district,
//              aggregated here to departments
//   1848–1956  Cagé & Piketty (2023), "Une histoire du conflit politique", by commune (already mapped to
//              today's departments by the authors), aggregated here to departments; free use with citation
//
// Output (public/data/history/legislative/):
//   <year>.json   2012–2024: results by district (both rounds) + national
//                 1848–2007: first-round results by department + national
//                 (two elections in 1946: 1946-06.json and 1946-11.json)
//   shifts.json   per consecutive pair: left–right, far-right, centre and turnout shift for
//                 each district (2012→2017, 2017→2022, 2022→2024) and each department (1958→…→2024),
//                 with centroids (lon/lat) for drawing arrows
//
// Raw downloads are cached in .cache/legislative-history/ (git-ignored).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readSheet } from "./lib/xlsx.mjs";
import { BLOCS, BLOC_KEYS, LEFT, RIGHT, NUANCE_BLOC, NUANCE_LABEL, CDSP_BLOC, CDSP_LABEL, CP_BLOC, CP_FAMILY, CP_FAMILY_LABEL, CP_LABEL } from "./lib/legislative-blocs.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/history/legislative/", ROOT);
const CACHE = new URL(".cache/legislative-history/", ROOT);
const GEO = new URL("public/data/geo/", ROOT);
const REFRESH = process.argv.includes("--refresh");

const RES = (id) => `https://www.data.gouv.fr/fr/datasets/r/${id}`; // stable redirect to the file
const TABULAR = (id) => `https://tabular-api.data.gouv.fr/api/resources/${id}/data/`;

// ---------------------------------------------------------------- sources
const MODERN = {
  2012: {
    dates: { t1: "2012-06-10", t2: "2012-06-17" },
    dataset: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-2012-resultats-par-bureaux-de-vote/",
    both: { id: "32981cf5-2560-48c7-a355-1acdf33bd504", kind: "bvot2012" }, // LG12_Bvot_T1T2.txt, licence Licence Ouverte
  },
  2017: {
    dates: { t1: "2017-06-11", t2: "2017-06-18" },
    dataset: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-11-et-18-juin-2017-resultats-du-1er-tour/",
    dataset2: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-11-et-18-juin-2017-resultats-du-2nd-tour/",
    t1: { id: "3eb503cd-49cf-4e04-9efd-7262580f7fc7", kind: "xlsx", sheet: /^Circo/ },
    t2: { id: "41483dcf-4c61-4e30-b7f8-d10396d28040", kind: "xlsx", sheet: /^Circo/ },
  },
  2022: {
    dates: { t1: "2022-06-12", t2: "2022-06-19" },
    dataset: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-12-et-19-juin-2022-resultats-definitifs-du-premier-tour/",
    dataset2: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-12-et-19-juin-2022-resultats-definitifs-du-second-tour/",
    t1: { id: "a5e0199c-c98b-43b5-8a9f-e8a8b4133b2e", kind: "tabular" },
    t2: { id: "3ce8fa1a-a0d3-4012-b9c0-10c480cefeda", kind: "tabular" },
  },
  2024: {
    dates: { t1: "2024-06-30", t2: "2024-07-07" },
    dataset: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/",
    dataset2: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/",
    t1: { id: "5163f2e3-1362-4c35-89a0-1934bb74f2d9", kind: "tabular" },
    t2: { id: "41ed46cd-77c2-4ecc-b8eb-374aa953ca39", kind: "tabular" },
  },
};
const CDSP_DATASET = "https://www.data.gouv.fr/fr/datasets/elections-legislatives-1958-2012/";
// First round by (old) district; 1986 was a single-round, department-list proportional vote.
const CDSP = {
  1958: { id: "824b7125-3790-43e9-bc3e-775525149ebe", date: "1958-11-23" },
  1962: { id: "6c377063-6a4e-498d-9ef0-bf84124904ef", date: "1962-11-18" },
  1967: { id: "d9b133b7-551b-4a6c-84af-6ea7dfd9669c", date: "1967-03-05" },
  1968: { id: "2a7897ad-1193-4e85-af65-bbcb27c67695", date: "1968-06-23" },
  1973: { id: "a9573a0d-576a-4111-8acf-1a6bac086d8a", date: "1973-03-04" },
  1978: { id: "a4b74978-3999-45e4-b8aa-ce65156849ea", date: "1978-03-12" },
  1981: { id: "fdea2152-bf13-4aad-8764-af8c662d4628", date: "1981-06-14" },
  1986: { id: "67fe1163-5df1-40d2-a76a-28e422da86a8", date: "1986-03-16" },
  1988: { id: "0a62240d-4c26-434d-86fa-dd4c8e2747e5", date: "1988-06-05" },
  1993: { id: "cf526fe2-7889-44cd-9b56-8500983f4fd6", date: "1993-03-21" },
  1997: { id: "61cf9b5e-2dc8-4fe2-a5ee-a8f01d0ed48e", date: "1997-05-25" },
  2002: { id: "332b2dc4-2c62-4eca-89bb-27ec39af6edc", date: "2002-06-09" },
  2007: { id: "5527d841-95fd-41b0-ac8c-a182b0980748", date: "2007-06-10" },
};
// Cagé–Piketty files (https://unehistoireduconflitpolitique.fr/telecharger.html). system: "list" =
// department-list majority vote (scrutin de liste), "pr" = proportional by department, otherwise
// single-member districts in two rounds. July 1871 (complementary by-elections) is left out.
const CP_SITE = "https://unehistoireduconflitpolitique.fr/telecharger.html";
const CP_ZIP = (name) => `https://conflit-politique-data.ams3.cdn.digitaloceanspaces.com/zip/${name}_csv.zip`;
const CP = {
  "1848": { zip: "leg1848", date: "1848-04-23", system: "list" },
  "1849": { zip: "leg1849", date: "1849-05-13", system: "list" },
  "1871": { zip: "leg1871fev", date: "1871-02-08", system: "list" },
  "1876": { zip: "leg1876", date: "1876-02-20" },
  "1881": { zip: "leg1881", date: "1881-08-21" },
  "1885": { zip: "leg1885", date: "1885-10-04", system: "list" },
  "1889": { zip: "leg1889", date: "1889-09-22" },
  "1893": { zip: "leg1893", date: "1893-08-20" },
  "1898": { zip: "leg1898", date: "1898-05-08" },
  "1902": { zip: "leg1902", date: "1902-04-27" },
  "1906": { zip: "leg1906", date: "1906-05-06" },
  "1910": { zip: "leg1910", date: "1910-04-24" },
  "1914": { zip: "leg1914", date: "1914-04-26" },
  "1919": { zip: "leg1919", date: "1919-11-16", system: "list" },
  "1924": { zip: "leg1924", date: "1924-05-11", system: "list" },
  "1928": { zip: "leg1928", date: "1928-04-22" },
  "1932": { zip: "leg1932", date: "1932-05-01" },
  "1936": { zip: "leg1936", date: "1936-04-26" },
  "1945": { zip: "leg1945", date: "1945-10-21", system: "pr" },
  "1946-06": { zip: "leg1946Juin", date: "1946-06-02", system: "pr" },
  "1946-11": { zip: "leg1946Nov", date: "1946-11-10", system: "pr" },
  "1951": { zip: "leg1951", date: "1951-06-17", system: "pr" },
  "1956": { zip: "leg1956", date: "1956-01-02", system: "pr" },
};

// ---------------------------------------------------------------- helpers
const num = (x) => (typeof x === "number" ? x : x == null || x === "" ? 0 : Number(String(x).replace(/[\s%]/g, "").replace(",", ".")) || 0);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const pct = (a, b) => (b ? (100 * a) / b : null);

async function download(id) {
  const file = new URL(id, CACHE);
  if (!REFRESH && existsSync(file)) return readFile(file);
  console.log(`↓ ${RES(id)}`);
  const res = await fetch(RES(id));
  if (!res.ok) throw new Error(`${res.status} ${RES(id)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

async function downloadUrl(url, name) {
  const file = new URL(name, CACHE);
  if (!REFRESH && existsSync(file)) return readFile(file);
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

// Whole resource through the data.gouv tabular API → [header, ...rows] (columns in file order)
async function tabular(id) {
  const file = new URL(`${id}.tabular.json`, CACHE);
  if (!REFRESH && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const size = 200;
  const rows = [];
  for (let page = 1; ; page++) {
    const url = `${TABULAR(id)}?page_size=${size}&page=${page}`;
    if (page === 1) console.log(`↓ ${TABULAR(id)}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const j = await res.json();
    rows.push(...j.data);
    if (rows.length >= j.meta.total || !j.data.length) break;
  }
  const header = Object.keys(rows[0]).filter((k) => k !== "__id");
  const table = [header, ...rows.map((r) => header.map((k) => r[k] ?? ""))];
  await writeFile(file, JSON.stringify(table));
  return table;
}

// UTF-8 if valid, else Latin-1 (older Ministry files)
const text = (buf) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
};
function parseCsv(str, sep) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (q) {
      if (ch === '"') {
        if (str[i + 1] === '"') (cur += '"'), i++;
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && str[i + 1] === "\n") i++;
      row.push(cur), rows.push(row), (row = []), (cur = "");
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ""));
}

// Ministry department codes → ours ("1" → "01", "ZA" → "971", "ZZ" → "99")
const OVERSEAS = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZS: "975", ZM: "976", ZX: "977", ZW: "986", ZP: "987", ZN: "988", ZZ: "99" };
const depCode = (raw) => {
  const d = String(raw).trim().toUpperCase();
  if (OVERSEAS[d]) return OVERSEAS[d];
  if (/^\d$/.test(d)) return "0" + d;
  if (d === "985") return "976"; // CDSP: Mayotte's former code
  return d;
};
// District code = department + 2-digit number ("0104", "97101", "9905")
const circoCode = (depRaw, circRaw) => depCode(depRaw) + String(+String(circRaw).replace(/\D/g, "").slice(-2)).padStart(2, "0");

// ---------------------------------------------------------------- modern parsers (district level)
// Wide format: one row per district, then repeated candidate groups (panel no., nuance, name, votes, elected…).
// Works for 2017 xlsx, 2022 and 2024 (tabular API); finds columns by header name.
function parseWide(table) {
  const h0 = table.findIndex((r) => r.some((c) => /panneau/i.test(String(c)))); // skip title rows
  const [header, ...rows] = table.slice(h0);
  const H = header.map((h) => String(h).trim());
  const find = (re) => H.findIndex((h) => re.test(h));
  const col = { dep: find(/^Code (du )?d[ée]partement/i), circ: find(/^Code (de la )?circonscription/i), i: find(/^Inscrits$/i), v: find(/^Votants$/i), e: find(/^Exprim[ée]s$/i), b: find(/^Blancs$/i), n: find(/^Nuls$/i) };
  const starts = H.map((h, i) => (/panneau/i.test(h) ? i : -1)).filter((i) => i >= 0);
  const g0 = starts[0];
  // later groups may have no header of their own (2022: "Unnamed: n"): then a group ends at "Sièges"/"Elu"
  const size = starts.length > 1 ? starts[1] - g0 : H.slice(g0).findIndex((h) => /^(Elu|Si[èe]ges)/i.test(h)) + 1;
  const grp = H.slice(g0, g0 + size);
  const off = (re) => grp.findIndex((h) => re.test(h));
  const o = { nu: off(/^Nuance/i), voix: off(/^Voix/i), nom: off(/^Nom/i), pre: off(/^Pr[ée]nom/i), elu: off(/^(Elu|Si[èe]ges)/i) };
  for (const [k, v] of Object.entries({ ...col, ...o })) if (v < 0 && k !== "b" && k !== "n") throw new Error(`column ${k} not found in ${H.slice(0, 30).join("|")}`);
  const out = {};
  for (const r of rows) {
    if (!r[col.dep] || !num(r[col.i])) continue;
    const c = [];
    for (let k = g0; k + o.voix < r.length; k += size) {
      const nu = String(r[k + o.nu] ?? "").trim();
      if (!nu) continue;
      const name = `${String(r[k + o.pre] ?? "").trim()} ${String(r[k + o.nom] ?? "").trim()}`.trim();
      c.push([nu, num(r[k + o.voix]), name, /^([ée]lu|oui)/i.test(String(r[k + o.elu] ?? "").trim()) ? 1 : 0]);
    }
    const rec = { i: num(r[col.i]), v: num(r[col.v]), e: num(r[col.e]) };
    if (col.b >= 0) rec.b = num(r[col.b]);
    if (col.n >= 0) rec.n = num(r[col.n]);
    rec.c = c.sort((a, b) => b[1] - a[1]);
    out[circoCode(r[col.dep], r[col.circ])] = rec;
  }
  return out;
}

// 2012: polling-station file with both rounds; aggregate to districts.
// Fields: tour;dep;commune;nom commune;circo;canton;bureau;inscrits;votants;exprimés;n° dépôt;nom;prénom;nuance;voix
function parse2012(buf) {
  const rounds = { 1: {}, 2: {} };
  const seen = new Set();
  const cands = { 1: {}, 2: {} };
  for (const line of new TextDecoder("latin1").decode(buf).split(/\r?\n/)) {
    if (!/^[12];/.test(line)) continue;
    const f = line.split(";");
    const t = f[0];
    const code = circoCode(f[1], f[4]);
    const rec = (rounds[t][code] ??= { i: 0, v: 0, e: 0 });
    const bkey = `${t}|${f[1]}|${f[2]}|${f[6]}`;
    if (!seen.has(bkey)) {
      seen.add(bkey);
      rec.i += +f[7];
      rec.v += +f[8];
      rec.e += +f[9];
    }
    const cs = (cands[t][code] ??= {});
    const cand = (cs[f[10]] ??= [f[13].trim(), 0, `${f[12].trim()} ${f[11].trim()}`, 0]);
    cand[1] += +f[14];
  }
  for (const t of [1, 2])
    for (const [code, rec] of Object.entries(rounds[t])) {
      rec.c = Object.values(cands[t][code]).sort((a, b) => b[1] - a[1]);
      // the file has no "elected" column: majority of valid votes and ≥ 25 % of registered in round 1,
      // most votes in round 2
      if (t === 1) {
        const top = rec.c[0];
        if (top[1] > rec.e / 2 && top[1] >= rec.i / 4) top[3] = 1;
      } else rec.c[0][3] = 1;
    }
  return { t1: rounds[1], t2: rounds[2] };
}

async function loadModern(year) {
  const s = MODERN[year];
  if (s.both) return parse2012(await download(s.both.id));
  const load = async (src) => (src.kind === "tabular" ? parseWide(await tabular(src.id)) : parseWide(readSheet(await download(src.id), src.sheet)));
  return { t1: await load(s.t1), t2: await load(s.t2) };
}

// ---------------------------------------------------------------- CDSP parser (department level)
const warnings = [];
function parseCdsp(year, buf) {
  const rows = parseCsv(text(buf), ",");
  const H = rows[0].map((h) => h.trim());
  const map = CDSP_BLOC[year];
  const find = (re) => H.findIndex((h) => re.test(h));
  const col = { dep: 0, i: find(/^inscrits$/i), v: find(/^votants$/i), e: find(/^exprim[ée]s$/i) };
  const isCand = H.some((h) => /\bnuance$/i.test(h));
  let start = 1;
  let pairs; // [nuanceCol, voixCol] or tendency columns [[col, code]]
  if (isCand) {
    pairs = H.map((h, j) => [h, j]).filter(([h]) => /^\d+ nuance$/i.test(h)).map(([h, j]) => [j, H.indexOf(h.replace(/nuance$/i, "voix"))]);
  } else {
    let codes = H;
    if (rows[1][0] === "") (codes = rows[1].map((c) => c.trim())), (start = 2);
    const last = Math.max(col.i, col.v, col.e, find(/blancs/i), find(/taux/i));
    pairs = codes.map((c, j) => [j, c]).filter(([j, c]) => j > last && c);
  }
  const deps = {};
  const unknown = new Set();
  let sumVotes = 0, sumExpr = 0;
  for (const r of rows.slice(start)) {
    if (!r[col.dep]?.trim() || !num(r[col.i])) continue;
    const dep = depCode(r[col.dep].trim().padStart(2, "0"));
    const d = (deps[dep] ??= { i: 0, v: 0, e: 0, nu: {} });
    d.i += num(r[col.i]);
    d.v += num(r[col.v]);
    d.e += num(r[col.e]);
    sumExpr += num(r[col.e]);
    const add = (code, votes) => {
      if (!code || !votes) return;
      if (!map[code]) unknown.add(code);
      d.nu[code] = (d.nu[code] ?? 0) + votes;
      sumVotes += votes;
    };
    if (isCand) for (const [jn, jv] of pairs) add(r[jn]?.trim(), num(r[jv]));
    else for (const [j, code] of pairs) add(code, num(r[j]));
  }
  if (unknown.size) warnings.push(`${year}: unmapped codes → DIV: ${[...unknown].join(" ")}`);
  const gap = (100 * (sumVotes - sumExpr)) / sumExpr;
  if (Math.abs(gap) > 0.5) warnings.push(`${year}: sum of votes differs from valid votes by ${gap.toFixed(2)} %`);
  return { deps, gap };
}

// ---------------------------------------------------------------- Cagé–Piketty parser (department level)
// One row per commune: dep, …, inscrits, votants, exprimes, voix<PARTY>… In list-vote years the files also
// have voixtot<PARTY> (raw totals, several names per ballot); voix<PARTY> is the per-voter equivalent,
// which adds up to valid votes, and is what we use.
function parseCp(id, zipBuf) {
  const files = unzipSync(new Uint8Array(zipBuf), { filter: (f) => !f.name.includes("MACOSX") && /comm\.csv$/.test(f.name) });
  const [csv] = Object.values(files);
  const rows = parseCsv(text(csv), ",");
  const H = rows[0].map((h) => h.trim());
  const col = { dep: H.indexOf("dep"), i: H.indexOf("inscrits"), v: H.indexOf("votants"), e: H.indexOf("exprimes") };
  const parties = H.map((h, j) => [h, j]).filter(([h]) => /^voix(?!tot)/.test(h)).map(([h, j]) => [h.slice(4), j]);
  const map = CP_BLOC[id];
  const unknown = parties.filter(([c]) => !map[c]).map(([c]) => c);
  if (unknown.length) warnings.push(`${id}: unmapped codes → DIV: ${unknown.join(" ")}`);
  const deps = {};
  let sumVotes = 0, sumExpr = 0;
  for (const r of rows.slice(1)) {
    const dep = r[col.dep] ? depCode(r[col.dep]) : "";
    if (!dep) continue;
    const d = (deps[dep] ??= { i: 0, v: 0, e: 0, nu: {} });
    d.i += num(r[col.i]);
    d.v += num(r[col.v]);
    d.e += num(r[col.e]);
    sumExpr += num(r[col.e]);
    for (const [c, j] of parties) {
      const x = num(r[j]);
      if (!x) continue;
      d.nu[c] = (d.nu[c] ?? 0) + x;
      sumVotes += x;
    }
  }
  // list-vote years have fractional per-voter votes: round the department sums
  for (const d of Object.values(deps)) {
    for (const k of ["i", "v", "e"]) d[k] = Math.round(d[k]);
    for (const k of Object.keys(d.nu)) d.nu[k] = Math.round(d.nu[k]);
  }
  const gap = (100 * (sumVotes - sumExpr)) / sumExpr;
  if (Math.abs(gap) > 0.5) warnings.push(`${id}: sum of votes differs from valid votes by ${gap.toFixed(2)} %`);
  return { deps, gap };
}

// ---------------------------------------------------------------- geometry
// Area-weighted planar centroid in lon/lat (districts are small enough for this to be accurate).
// Each polygon is oriented by its own exterior ring, so files with mixed winding orders still work.
function centroid(features) {
  let A = 0, X = 0, Y = 0;
  const ring = (pts) => {
    let a = 0, x = 0, y = 0;
    for (let k = 0, n = pts.length; k < n - 1; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const cr = x0 * y1 - x1 * y0;
      a += cr;
      x += (x0 + x1) * cr;
      y += (y0 + y1) * cr;
    }
    return [a / 2, x / 6, y / 6];
  };
  for (const f of features) {
    const g = f.geometry;
    for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) {
      const sign = Math.sign(ring(poly[0])[0]) || 1;
      for (const r of poly) {
        const [a, x, y] = ring(r);
        A += sign * a;
        X += sign * x;
        Y += sign * y;
      }
    }
  }
  return [r4(X / A), r4(Y / A)];
}
const circoGeo = {};
for (const f of readdirSync(new URL("circo/", GEO))) for (const ft of JSON.parse(readFileSync(new URL(`circo/${f}`, GEO), "utf8")).features) circoGeo[ft.properties.code] = ft;
const depGeo = {};
for (const ft of JSON.parse(readFileSync(new URL("departements.geojson", GEO), "utf8")).features) depGeo[ft.properties.code] = ft;
const depNames = Object.fromEntries(Object.entries(depGeo).map(([k, f]) => [k, f.properties.nom]));
depNames["99"] = "Français établis hors de France";

// ---------------------------------------------------------------- aggregation & metrics
const blocOf = (map, code) => map[code] ?? "DIV";
const blocVotes = (nu, map) => {
  const b = Object.fromEntries(BLOC_KEYS.map((k) => [k, 0]));
  for (const [code, v] of Object.entries(nu)) b[blocOf(map, code)] += v;
  return b;
};
const nuOfCands = (c) => {
  const nu = {};
  for (const [code, v] of c) nu[code] = (nu[code] ?? 0) + v;
  return nu;
};
function addUnit(acc, u) {
  acc.i += u.i;
  acc.v += u.v;
  acc.e += u.e;
  for (const [k, v] of Object.entries(u.nu)) acc.nu[k] = (acc.nu[k] ?? 0) + v;
  return acc;
}
const empty = () => ({ i: 0, v: 0, e: 0, nu: {} });

// metrics of one unit: shares of valid votes (%) and turnout (% of registered)
function metrics(u, map) {
  const b = blocVotes(u.nu, map);
  const s = (keys) => pct(keys.reduce((a, k) => a + b[k], 0), u.e);
  const left = s(LEFT), right = s(RIGHT);
  return { left, right, centre: s(["C"]), farRight: s(["XD"]), lr: right - left, turnout: pct(u.v, u.i), shares: Object.fromEntries(BLOC_KEYS.map((k) => [k, r2(pct(b[k], u.e))])) };
}
const triple = (a, b) => [r2(a), r2(b), r2(b - a)];
// absent: a bloc that stood nationally that year but got no vote in this unit (no candidate)
function shift(u0, u1, m0, m1, y0, y1, n0, n1) {
  const a = metrics(u0, m0), b = metrics(u1, m1);
  const absent = [];
  for (const k of ["left", "right", "centre", "farRight"]) {
    if (!a[k] && (!n0 || n0[k])) absent.push(`${k}@${y0}`);
    if (!b[k] && (!n1 || n1[k])) absent.push(`${k}@${y1}`);
  }
  const out = { lr: triple(a.lr, b.lr), farRight: triple(a.farRight, b.farRight), centre: triple(a.centre, b.centre), turnout: triple(a.turnout, b.turnout), left: triple(a.left, b.left), right: triple(a.right, b.right) };
  if (absent.length) out.absent = absent;
  return out;
}

// ---------------------------------------------------------------- build
await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

const nuanceTable = (labels, map) => Object.fromEntries(Object.keys({ ...labels, ...map }).map((k) => [k, { label: labels[k] ?? k, bloc: blocOf(map, k) }]));
const blocsOut = Object.fromEntries(BLOC_KEYS.map((k) => [k, BLOCS[k]]));

// units[year] = { dist: {code: unit}|null, dep: {code: unit}, map, national }
const units = {};

for (const year of [2012, 2017, 2022, 2024]) {
  const map = NUANCE_BLOC[year];
  const { t1, t2 } = await loadModern(year);
  const unknown = new Set();
  const districts = {};
  const seats = { nuances: {}, blocs: Object.fromEntries(BLOC_KEYS.map((k) => [k, 0])) };
  const nat = { t1: empty(), t2: empty() };
  const dist = {}, dep = {};
  for (const code of Object.keys(t1).sort()) {
    const a = t1[code], b = t2[code] ?? null;
    for (const r of [a, b]) for (const c of r?.c ?? []) if (!map[c[0]]) unknown.add(c[0]);
    const win = a.c.find((c) => c[3]) ? { c: a.c.find((c) => c[3]), round: 1 } : b ? { c: b.c.find((c) => c[3]) ?? b.c[0], round: 2 } : null;
    const winner = win && { nuance: win.c[0], bloc: blocOf(map, win.c[0]), name: win.c[2], round: win.round };
    if (winner) {
      seats.nuances[winner.nuance] = (seats.nuances[winner.nuance] ?? 0) + 1;
      seats.blocs[winner.bloc]++;
    }
    districts[code] = { dep: code.length === 5 ? code.slice(0, 3) : code.slice(0, 2), t1: a, t2: b, winner };
    const u = { i: a.i, v: a.v, e: a.e, nu: nuOfCands(a.c) };
    dist[code] = u;
    addUnit((dep[districts[code].dep] ??= empty()), u);
    addUnit(nat.t1, u);
    if (b) addUnit(nat.t2, { i: b.i, v: b.v, e: b.e, nu: nuOfCands(b.c) });
  }
  if (unknown.size) warnings.push(`${year}: unmapped nuances → DIV: ${[...unknown].join(" ")}`);
  const natOut = (u) => ({ inscrits: u.i, votants: u.v, exprimes: u.e, turnout: r2(pct(u.v, u.i)), nuances: u.nu, blocs: blocVotes(u.nu, map), shares: metrics(u, map).shares });
  const national = { t1: natOut(nat.t1), t2: natOut(nat.t2), seats };
  units[String(year)] = { year, date: MODERN[year].dates.t1, dist, dep, map, national: nat.t1 };
  const s = MODERN[year];
  await writeFile(
    new URL(`${year}.json`, OUT),
    JSON.stringify({
      year,
      level: "district",
      boundaries: "2010 redistricting, used for every election since 2012",
      dates: s.dates,
      sources: [s.dataset, s.dataset2].filter(Boolean),
      licence: "Licence Ouverte / Etalab",
      blocs: blocsOut,
      nuances: nuanceTable(NUANCE_LABEL[year], map),
      national,
      districts,
    })
  );
  console.log(`✓ ${year}: ${Object.keys(districts).length} districts, ${Object.keys(t2).length} second rounds; T1 turnout ${national.t1.turnout} %, seats ${JSON.stringify(seats.blocs)}`);
}

for (const [y, s] of Object.entries(CDSP)) {
  const year = +y;
  const map = CDSP_BLOC[year];
  const { deps, gap } = parseCdsp(year, await download(s.id));
  const nat = Object.values(deps).reduce(addUnit, empty());
  units[y] = { year, date: s.date, dist: null, dep: deps, map, national: nat };
  const used = new Set(Object.values(deps).flatMap((d) => Object.keys(d.nu)));
  await writeFile(
    new URL(`${year}.json`, OUT),
    JSON.stringify({
      year,
      level: "department",
      boundaries: "pre-2012 districts, aggregated to departments",
      dates: { t1: s.date },
      round: year === 1986 ? "single round (department-list proportional representation)" : "first round",
      sources: [CDSP_DATASET, RES(s.id)],
      licence: "ODbL (CDSP Sciences Po / BDSP Grenoble / Ministère de l'Intérieur)",
      coverage: year < 1988 ? "metropolitan France only" : "metropolitan France and overseas (no French abroad before 2012)",
      votesVsValid: r2(gap),
      blocs: blocsOut,
      nuances: Object.fromEntries([...used].sort().map((k) => [k, { label: CDSP_LABEL[k] ?? k, bloc: blocOf(map, k) }])),
      national: { t1: { inscrits: nat.i, votants: nat.v, exprimes: nat.e, turnout: r2(pct(nat.v, nat.i)), nuances: nat.nu, blocs: blocVotes(nat.nu, map), shares: metrics(nat, map).shares } },
      departments: Object.fromEntries(Object.entries(deps).sort().map(([k, d]) => [k, { name: depNames[k] ?? null, t1: d }])),
    })
  );
  console.log(`✓ ${year}: ${Object.keys(deps).length} departments, turnout ${r2(pct(nat.v, nat.i))} %, votes vs valid ${gap.toFixed(2)} %`);
}

for (const [id, s] of Object.entries(CP)) {
  const year = +id.slice(0, 4);
  const map = CP_BLOC[id];
  const { deps, gap } = parseCp(id, await downloadUrl(CP_ZIP(s.zip), `cp-${s.zip}_csv.zip`));
  const nat = Object.values(deps).reduce(addUnit, empty());
  units[id] = { year, date: s.date, dist: null, dep: deps, map, national: nat };
  const used = new Set(Object.values(deps).flatMap((d) => Object.keys(d.nu)));
  const round =
    s.system === "pr" ? "single round (proportional representation by department)"
    : s.system === "list" ? "first round, department-list vote (each voter chose several names; votes are per-voter equivalents)"
    : "first round";
  await writeFile(
    new URL(`${id}.json`, OUT),
    JSON.stringify({
      year,
      ...(id !== String(year) ? { id } : {}),
      level: "department",
      boundaries: "communes mapped by the source to today's departments, aggregated to departments",
      dates: { t1: s.date },
      round,
      sources: [CP_SITE, CP_ZIP(s.zip)],
      licence: "Free use with citation: J. Cagé and T. Piketty (2023), Une histoire du conflit politique. Élections et inégalités sociales en France, 1789-2022, Le Seuil",
      coverage: "metropolitan France within the borders of the time; men only before 1945",
      votesVsValid: r2(gap),
      blocs: blocsOut,
      nuances: Object.fromEntries([...used].sort().map((k) => [k, { label: CP_LABEL[k] ?? k, bloc: blocOf(map, k), family: CP_FAMILY_LABEL[CP_FAMILY[id][k]] ?? "divers" }])),
      national: { t1: { inscrits: nat.i, votants: nat.v, exprimes: nat.e, turnout: r2(pct(nat.v, nat.i)), nuances: nat.nu, blocs: blocVotes(nat.nu, map), shares: metrics(nat, map).shares } },
      departments: Object.fromEntries(Object.entries(deps).sort().map(([k, d]) => [k, { name: depNames[k] ?? null, t1: d }])),
    })
  );
  console.log(`✓ ${id}: ${Object.keys(deps).length} departments, turnout ${r2(pct(nat.v, nat.i))} %, votes vs valid ${gap.toFixed(2)} %`);
}

// ---- shifts
// Department units are harmonised per pair. The CDSP reports 1958–1962 by the departments of the time
// (Paris/Seine = 75, Seine-et-Oise = 78; 91–95 date from 1968) and Corsica as 20 until 1976. When the two
// elections of a pair report one of these groups differently, the group is merged in both years.
// Cagé–Piketty map every commune to today's departments, so pairs between their elections are not merged.
const MERGE = [
  { key: "75", members: ["75", "92", "93", "94"], name: "Seine (75 + 92 + 93 + 94)" },
  { key: "78", members: ["78", "91", "95"], name: "Seine-et-Oise (78 + 91 + 95)" },
  { key: "20", members: ["2A", "2B", "20"], name: "Corse (2A + 2B)" },
];
const mergesFor = (d0, d1) => {
  const sig = (d, m) => m.members.filter((k) => d[k]).join();
  return MERGE.filter((m) => sig(d0, m) !== sig(d1, m));
};
function harmonise(depUnits, merges) {
  const out = {};
  for (const [code, u] of Object.entries(depUnits)) {
    const m = merges.find((m) => m.members.includes(code));
    addUnit((out[m ? m.key : code] ??= empty()), u);
  }
  return out;
}
const unitCentroid = (key, merged, isDistrict) => {
  if (isDistrict) return circoGeo[key] ? centroid([circoGeo[key]]) : null;
  const members = merged ? merged.members : [key];
  const fs = members.map((k) => depGeo[k]).filter(Boolean);
  return fs.length ? centroid(fs) : null;
};

// elections in date order; ids are the year ("1958"), or "1946-06" / "1946-11"
const ELECTIONS = Object.keys(units).sort((a, b) => units[a].date.localeCompare(units[b].date));
const pairs = [];
const pairOf = (y0, y1, level) => {
  const U0 = units[y0], U1 = units[y1];
  const isD = level === "district";
  const merges = isD ? [] : mergesFor(U0.dep, U1.dep);
  const a = isD ? U0.dist : harmonise(U0.dep, merges);
  const b = isD ? U1.dist : harmonise(U1.dep, merges);
  const out = {};
  const missing = [];
  for (const key of Object.keys({ ...a, ...b }).sort()) {
    if (!a[key] || !b[key]) {
      missing.push(key);
      continue;
    }
    const merged = merges.find((m) => m.key === key);
    const [lon, lat] = unitCentroid(key, merged, isD) ?? [null, null];
    const rec = { lon, lat, ...shift(a[key], b[key], U0.map, U1.map, y0, y1, metrics(U0.national, U0.map), metrics(U1.national, U1.map)) };
    if (!isD) rec.name = merged ? merged.name : depNames[key] ?? null;
    if (merged) rec.merged = merged.members.filter((k) => k !== "20");
    out[key] = rec;
  }
  return {
    from: U0.year,
    to: U1.year,
    fromId: y0, // = year file name; differs from the year only for "1946-06" / "1946-11"
    toId: y1,
    fromDate: U0.date,
    toDate: U1.date,
    level,
    national: shift(U0.national, U1.national, U0.map, U1.map, y0, y1),
    ...(missing.length ? { skipped: missing } : {}),
    units: out,
  };
};
for (let k = 1; k < ELECTIONS.length; k++) pairs.push(pairOf(ELECTIONS[k - 1], ELECTIONS[k], "department"));
for (const [y0, y1] of [["2012", "2017"], ["2017", "2022"], ["2022", "2024"]]) pairs.push(pairOf(y0, y1, "district"));

await writeFile(
  new URL("shifts.json", OUT),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    doc: "docs/data-legislative-history.md",
    round: "first round (single round for the proportional elections of 1945–1956 and 1986)",
    elections: ELECTIONS.map((id) => ({ id, year: units[id].year, date: units[id].date })),
    units: "percentage points of valid votes (turnout: points of registered voters)",
    metrics: {
      lr: "(D + XD) − (XG + G + ECO) share of valid votes; positive = right of left. Centre (C) and DIV count in the denominator only.",
      farRight: "XD share of valid votes",
      centre: "C share of valid votes",
      left: "XG + G + ECO share",
      right: "D + XD share",
      turnout: "votants / inscrits",
      format: "[from, to, to − from]",
    },
    blocs: blocsOut,
    pairs,
  })
);
const nUnits = pairs.map((p) => `${p.fromId}→${p.toId} ${p.level[0]}:${Object.keys(p.units).length}`).join(", ");
console.log(`✓ shifts.json: ${nUnits}`);
for (const w of warnings) console.warn(`⚠ ${w}`);
