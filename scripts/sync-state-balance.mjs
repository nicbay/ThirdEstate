// What each commune receives from the state and from equalisation funds, and what it pays into them,
// per inhabitant, for the town page ("solde avec l'État et la péréquation"). One file per department.
//
// Counted in the balance (all for the same year, default 2025):
//   + DGF (dotation globale de fonctionnement: forfaitaire, DSU, DSR, DNP…), the state's main operating grant.
//   ± FPIC (fonds national de péréquation des ressources intercommunales et communales), net of levy and payout.
//     The DGCL computes it for the intercommunal "ensemble" (EPCI + member communes), not per commune, so the
//     ensemble's net amount is spread over its inhabitants. Paris and the few communes outside any EPCI have
//     their own amount. In the Métropole du Grand Paris the ensembles are the territorial bodies (EPT).
//   ± FSRIF (fonds de solidarité des communes de la région Île-de-France), net, per commune.
// Shown alongside but NOT counted:
//   - DILICO 2025 levy (a reserve: 90 % is paid back to the same communes over 2026-2028);
//   - income tax paid by the commune's tax households (DGFiP IRCOM): it funds the whole state budget, not the
//     communes, so netting it against the DGF would be meaningless.
// Not counted at all: other state grants (compensations of tax exemptions, DCRTP, FCTVA, investment grants),
// the FNGIR, and every other national tax.
//
// Sources (Licence Ouverte):
//   OFGL, "Dotations des communes – montants et critères" (DGCL data): data.ofgl.fr/explore/dataset/dotations-communes
//   OFGL, "FPIC des ensembles intercommunaux" (DGCL data): data.ofgl.fr/explore/dataset/fpic-ensembles-intercommunaux
//   OFGL, "Base communale flux financiers" (commune → EPT membership in the Grand Paris)
//   DGFiP, "L'impôt sur le revenu par collectivité territoriale (IRCOM)", data.gouv.fr
//
// Output: public/data/state-balance/<dep>.json
//   { year, irYear, fields: [...], france: {...}, strata: { "01": {...} }, communes: { code: [pop, dgf, fpic, fsrif, ir, dilico, strate, fpicScope] } }
//   money fields are euros per inhabitant (INSEE population), rounded; ir is null when the DGFiP doesn't publish it.
//
// Usage: node scripts/sync-state-balance.mjs [--year 2025] [--refresh]
import { mkdir, writeFile } from "node:fs/promises";
import { makeCache } from "./lib/http-cache.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { readSheet } from "./lib/xlsx.mjs";
import { unzipSync } from "fflate";

const REFRESH = process.argv.includes("--refresh");
const YEAR = Number(process.argv[process.argv.indexOf("--year") + 1]) || 2025;
const C = makeCache(new URL("../.cache/state-balance/", import.meta.url), { refresh: REFRESH });
const OUT = new URL("../public/data/state-balance/", import.meta.url);
const OFGL = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets";
const IRCOM_DATASET = "536998cba3a729239d20505e";

const depOf = (code) => (/^97/.test(code) ? code.slice(0, 3) : code.slice(0, 2));
const plmCity = (c) => (/^751(0[1-9]|1\d|20)$/.test(c) ? "75056" : /^6938[1-9]$/.test(c) ? "69123" : /^132(0[1-9]|1[0-6])$/.test(c) ? "13055" : c);
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\(EPT\)|\(\d\w\)|[^A-Z]/g, "");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

function ofglCsv(dataset, variables, select) {
  const where = `variable in (${variables.map((v) => `"${v}"`).join(",")})`;
  return `${OFGL}/${dataset}/exports/csv?where=${encodeURIComponent(where)}&refine=exercice:${YEAR}&select=${select}&delimiter=%3B`;
}
const rowsOf = (text) => { const [head, ...rows] = parseCsv(text, ";"); return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))); };

// ---- DGCL commune dotations
const V = { dgf: "Montant Dotation DGF", pop: "Population INSEE", fpic: "FPIC - Solde", fsrif: "FSRIF - Solde", dilico: "Montant du prélèvement DILICO" };
const dot = rowsOf(await C.cachedText(`dotations-${YEAR}.csv`, ofglCsv("dotations-communes", Object.values(V), "code_insee,commune,siren_epci,strate_demographique,variable,valeur")));
if (!dot.length) throw new Error(`no DGCL dotations for ${YEAR}`);
const com = new Map();
const keyOf = Object.fromEntries(Object.entries(V).map(([k, v]) => [v, k]));
for (const r of dot) {
  const c = com.get(r.code_insee) ?? { epci: r.siren_epci, strate: r.strate_demographique, name: r.commune };
  c[keyOf[r.variable]] = Number(r.valeur);
  com.set(r.code_insee, c);
}

// ---- FPIC per intercommunal ensemble
const fp = rowsOf(await C.cachedText(`fpic-${YEAR}.csv`, ofglCsv("fpic-ensembles-intercommunaux", ["Montant FPIC - Solde", "Population Insee"], "siren,nom_epci,variable,valeur")));
const ens = new Map();
for (const r of fp) {
  const e = ens.get(r.siren) ?? { name: r.nom_epci };
  e[r.variable === "Population Insee" ? "pop" : "fpic"] = Number(r.valeur);
  ens.set(r.siren, e);
}
// Grand Paris: the DGCL lists communes under the Métropole, the FPIC under the EPT. OFGL's flux base gives membership.
const eptRows = rowsOf(await C.cachedText("ept.csv", `${OFGL}/base-communale-flux-financiers/exports/csv?where=${encodeURIComponent("ept_name is not null")}&select=com_code,ept_name&delimiter=%3B`));
const EPT_ALIAS = { GRANDPARISSUDESTAVENIR: "PLAINECENTRALEHAUTVALMARNEPLATEAUBRIARD", GRANDORLYSEINEBIEVRE: "VALDEBIEVRESEINEAMONTGRANDORLYPORTESDELESSONNE", PARISESTMARNEETBOIS: "ESTPARISIEN" };
const eptSiren = new Map([...ens].filter(([, e]) => /\(EPT\)/.test(e.name)).map(([s, e]) => [norm(e.name), s]));
const eptOf = new Map();
for (const r of eptRows) {
  const n = norm(r.ept_name);
  const s = eptSiren.get(EPT_ALIAS[n] ?? n);
  if (!s) throw new Error(`EPT not matched to an FPIC ensemble: ${r.ept_name}`);
  eptOf.set(r.com_code, s);
}

// ---- income tax by commune (DGFiP IRCOM, latest file)
const meta = await C.cachedJson("ircom-meta.json", `https://www.data.gouv.fr/api/1/datasets/${IRCOM_DATASET}/`, { maxAgeH: 24 });
const ircomRes = meta.resources.filter((r) => /IRCOM \d{4}/.test(r.title) && /\.zip$/.test(r.url)).sort((a, b) => b.title.match(/IRCOM (\d{4})/)[1] - a.title.match(/IRCOM (\d{4})/)[1])[0];
const irYear = Number(ircomRes.title.match(/revenus de (\d{4})/i)?.[1] ?? ircomRes.title.match(/IRCOM (\d{4})/)[1] - 1); // income year; the tax is paid the following year
const zip = unzipSync(new Uint8Array(await C.cachedBuf(`ircom-${irYear}.zip`, ircomRes.url, { maxAgeH: 24 * 90 })), { filter: (f) => /communes.*\.xlsx$/i.test(f.name) });
const xlsx = Object.values(zip)[0];
if (!xlsx) throw new Error("IRCOM commune workbook not found in the zip");
const irTax = new Map(); // INSEE code (PLM summed) → impôt net total, euros
for (const r of readSheet(xlsx, /./)) {
  if (r[4] !== "Total" || !/^\w{3}$/.test(String(r[1])) || !/^\d{3}$/.test(String(r[2]))) continue;
  const d = String(r[1]);
  const code = /^97/.test(d) ? d + String(r[2]).slice(1) : d.replace(/^B/, "").slice(0, 2).padStart(2, "0") + r[2];
  const tax = typeof r[7] === "number" ? r[7] * 1000 : null; // thousands of euros; "n.c." under statistical secrecy
  const city = plmCity(code);
  if (city !== code) { if (tax != null) irTax.set(city, (irTax.get(city) ?? 0) + tax); }
  else irTax.set(code, tax);
}

// ---- assemble
const per = (x, pop) => (x == null || !pop ? null : Math.round(x / pop));
const out = {}; // dep → communes
const byStrate = {};
let tot = { pop: 0, dgf: 0, fpic: 0, fsrif: 0, ir: 0, irPop: 0 };
let missingFpic = 0;
for (const [code, c] of com) {
  if (!c.pop) continue;
  let fpic = null, scope = "e";
  if (c.fpic != null) { fpic = c.fpic / c.pop; scope = "c"; }
  else {
    const e = ens.get(eptOf.get(code) ?? c.epci);
    if (e?.pop && e.fpic != null) fpic = e.fpic / e.pop;
    else missingFpic++;
  }
  const dgf = (c.dgf ?? 0) / c.pop, fsrif = (c.fsrif ?? 0) / c.pop;
  const ir = irTax.get(code);
  const strate = c.strate.slice(0, 2);
  const row = [c.pop, Math.round(dgf), fpic == null ? null : Math.round(fpic), Math.round(fsrif), per(ir, c.pop), per(c.dilico ?? 0, c.pop), strate, scope];
  (out[depOf(code)] ??= {})[code] = row;
  const s = (byStrate[strate] ??= { label: c.strate.slice(5), bal: [], ir: [] });
  const bal = dgf + (fpic ?? 0) + fsrif;
  s.bal.push(bal);
  if (ir != null) s.ir.push(ir / c.pop);
  tot.pop += c.pop; tot.dgf += c.dgf ?? 0; tot.fsrif += c.fsrif ?? 0; tot.fpic += (fpic ?? 0) * c.pop;
  if (ir != null) { tot.ir += ir; tot.irPop += c.pop; }
}
const strata = Object.fromEntries(Object.entries(byStrate).sort().map(([k, s]) => [k, {
  label: s.label,
  n: s.bal.length,
  balance: Math.round(median(s.bal)),
  contributors: Math.round((1000 * s.bal.filter((b) => b < 0).length) / s.bal.length) / 10, // % of communes in the stratum
  ir: s.ir.length ? Math.round(median(s.ir)) : null,
}]));
const france = { pop: tot.pop, dgf: Math.round(tot.dgf / tot.pop), fpic: Math.round(tot.fpic / tot.pop), fsrif: Math.round(tot.fsrif / tot.pop), ir: Math.round(tot.ir / tot.irPop) };
const head = {
  year: YEAR,
  irYear,
  fields: ["pop", "dgf", "fpic", "fsrif", "ir", "dilico", "strate", "fpicScope"],
  sources: {
    dotations: "https://data.ofgl.fr/explore/dataset/dotations-communes/",
    fpic: "https://data.ofgl.fr/explore/dataset/fpic-ensembles-intercommunaux/",
    ircom: `https://www.data.gouv.fr/datasets/${IRCOM_DATASET}/`,
  },
  france,
  strata,
};
await mkdir(OUT, { recursive: true });
for (const [dep, communes] of Object.entries(out)) await writeFile(new URL(`${dep}.json`, OUT), JSON.stringify({ ...head, communes }));
const n = Object.values(out).reduce((s, x) => s + Object.keys(x).length, 0);
const contributors = Object.values(out).flatMap((x) => Object.values(x)).filter((r) => r[1] + (r[2] ?? 0) + r[3] < 0).length;
console.log(`✓ ${n} communes in ${Object.keys(out).length} departments (${YEAR}); ${contributors} net contributors; FPIC missing for ${missingFpic}; IR published for ${[...irTax.values()].filter((x) => x != null).length}`);
console.log("  France per inhabitant:", france);
for (const c of ["75056", "92051", "93048", "23001", "48080", "69123"]) console.log(" ", c, com.get(c)?.name, out[depOf(c)]?.[c]);
