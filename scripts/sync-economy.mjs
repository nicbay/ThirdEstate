// France's main economic indicators, for the "La France en chiffres" page and its live debt counter.
//   npm run sync:economy
// Sources (all keyless, official):
//   - Eurostat dissemination API (JSON-stat 2.0)
//     https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?<filters>
//     Maastricht debt (quarterly), deficit, spending, interest, tax burden, GDP, growth, trade, population, employment.
//   - INSEE BDM, public SDMX endpoint https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/<idbank>
//     consumer prices (CPI, base 2025), ILO unemployment and employment rates.
//   - INSEE annual Maastricht debt table, 1978 onwards (xlsx), Eurostat gov_10dd_edpt1 and the IMF Global Debt
//     Database (datamapper API) for the long-run France/Germany debt-to-GDP chart (debtHistory, see below).
// A source that fails keeps the value from the previous public/data/economy.json; with no previous file it falls
// back to FALLBACK below (values read from the same APIs on 2026-11-08, so the page never ships empty).
//
// Output: public/data/economy.json
//   { fetchedAt, debt: { eur, pct, ratePerYear, rateFrom, rateTo, asOf, ... }, people: { population, employed },
//     debtHistory: { fr|de: { annual: [[year, pct]], latest: { period, value }, source(s) } },
//     kpis: [{ id, value, unit, period, prev, series: [[period, value]], source: { name, dataset, url }, fallback? }] }

import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../public/data/economy.json", import.meta.url);
const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const INSEE = "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM";
const estatPage = (ds) => `https://ec.europa.eu/eurostat/databrowser/view/${ds}/default/table?lang=fr`;
const inseePage = (id) => `https://www.insee.fr/fr/statistiques/serie/${id}`;

async function get(url, accept) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: accept, "User-Agent": "third-estate (github.com/nicbay/projectview)" }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/** One Eurostat series: every filter pins a dimension to one code, so the cube is one-dimensional in time. */
async function eurostat(dataset, filters, last) {
  const qs = new URLSearchParams({ geo: "FR", ...filters, lastTimePeriod: String(last) });
  const j = JSON.parse(await get(`${EUROSTAT}/${dataset}?${qs}`, "application/json"));
  if (j.error) throw new Error(`${dataset}: ${JSON.stringify(j.error)}`);
  const times = Object.entries(j.dimension.time.category.index).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  // with every other dimension of size 1, the flat index is the time index
  if (j.size.slice(0, -1).some((n) => n !== 1)) throw new Error(`${dataset}: filters do not pin one series (${j.size})`);
  const series = times.flatMap((t, i) => (j.value[i] == null ? [] : [[t, j.value[i]]]));
  if (!series.length) throw new Error(`${dataset}: no data for ${qs}`);
  return { series, updated: j.updated?.slice(0, 10) ?? null, url: estatPage(dataset), dataset };
}

/** One INSEE BDM series by idbank. */
async function insee(idbank, last) {
  const xml = await get(`${INSEE}/${idbank}?lastNObservations=${last}`, "application/xml");
  const title = xml.match(/TITLE_FR="([^"]*)"/)?.[1] ?? idbank;
  const updated = xml.match(/LAST_UPDATE="([^"]*)"/)?.[1] ?? null;
  const series = [...xml.matchAll(/<Obs TIME_PERIOD="([^"]+)" OBS_VALUE="([^"]+)"/g)].map((m) => [m[1], Number(m[2])]).filter((p) => Number.isFinite(p[1])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!series.length) throw new Error(`INSEE ${idbank}: no observations`);
  return { series, updated, url: inseePage(idbank), dataset: `${idbank} (${title})` };
}

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
/** End of a period as an ISO instant, Paris time: 2026-Q2 → 2026-06-30T22:00Z, 2025 → 2025-12-31T23:00Z. */
function periodEnd(p) {
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return new Date(Date.UTC(+q[1], +q[2] * 3, 1) - 2 * 3600e3).toISOString();
  const m = p.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2], 1) - 2 * 3600e3).toISOString();
  return new Date(Date.UTC(+p + 1, 0, 1) - 3600e3).toISOString();
}

// Each KPI: how to fetch it, and a dated fallback (same APIs, read on 2026-11-08) used only if there is no previous file.
const KPIS = [
  { id: "debt_eur", unit: "eur", source: "Eurostat", get: () => eurostat("gov_10q_ggdebt", { unit: "MIO_EUR", sector: "S13", na_item: "GD" }, 20), scale: 1e6,
    fallback: { period: "2026-Q2", value: 3595524.9e6, prev: 3535928.6e6, updated: "2026-10-21" } },
  { id: "debt_pct", unit: "pct_gdp", source: "Eurostat", get: () => eurostat("gov_10q_ggdebt", { unit: "PC_GDP", sector: "S13", na_item: "GD" }, 20),
    fallback: { period: "2026-Q2", value: 119.1, prev: 117.7, updated: "2026-10-21" } },
  { id: "deficit", unit: "pct_gdp", source: "Eurostat", get: () => eurostat("gov_10a_main", { unit: "PC_GDP", sector: "S13", na_item: "B9" }, 12),
    fallback: { period: "2025", value: -5.1, prev: -5.8, updated: "2026-10-21" } },
  { id: "gdp", unit: "eur", source: "Eurostat", get: () => eurostat("nama_10_gdp", { unit: "CP_MEUR", na_item: "B1GQ" }, 12), scale: 1e6,
    fallback: { period: "2025", value: 2991055.9e6, prev: 2935236.2e6, updated: "2026-11-05" } },
  { id: "growth_q", unit: "pct", source: "Eurostat", get: () => eurostat("namq_10_gdp", { unit: "CLV_PCH_PRE", s_adj: "SCA", na_item: "B1GQ" }, 16),
    fallback: { period: "2026-Q3", value: -0.1, prev: 0, updated: "2026-11-05" } },
  { id: "growth_y", unit: "pct", source: "Eurostat", get: () => eurostat("nama_10_gdp", { unit: "CLV_PCH_PRE", na_item: "B1GQ" }, 12),
    fallback: { period: "2025", value: 0.8, prev: 1.5, updated: "2026-11-05" } },
  { id: "inflation", unit: "pct", source: "INSEE", get: () => insee("011814632", 24),
    fallback: { period: "2026-10", value: 3.4, prev: null, updated: null } },
  { id: "unemployment", unit: "pct", source: "INSEE", get: () => insee("011818543", 16),
    fallback: { period: "2026-Q2", value: 8.3, prev: null, updated: null } },
  { id: "employment", unit: "pct", source: "INSEE", get: () => insee("011818676", 16),
    fallback: { period: "2026-Q2", value: 69.0, prev: null, updated: null } },
  { id: "spending", unit: "pct_gdp", source: "Eurostat", get: () => eurostat("gov_10a_main", { unit: "PC_GDP", sector: "S13", na_item: "TE" }, 12),
    fallback: { period: "2025", value: 57.3, prev: 57.0, updated: "2026-10-21" } },
  { id: "tax", unit: "pct_gdp", source: "Eurostat", get: () => eurostat("gov_10a_taxag", { unit: "PC_GDP", sector: "S13_S212", na_item: "D2_D5_D91_D61_M_D995" }, 12),
    fallback: { period: "2025", value: 46.0, prev: 45.1, updated: "2026-11-05" } },
  // exports minus imports of goods and services, quarterly, seasonally adjusted (B11 is not published quarterly)
  { id: "trade", unit: "eur", source: "Eurostat", get: async () => {
      const [x, m] = await Promise.all([eurostat("namq_10_gdp", { unit: "CP_MEUR", s_adj: "SCA", na_item: "P6" }, 16), eurostat("namq_10_gdp", { unit: "CP_MEUR", s_adj: "SCA", na_item: "P7" }, 16)]);
      const im = new Map(m.series);
      return { ...x, series: x.series.filter(([t]) => im.has(t)).map(([t, v]) => [t, round(v - im.get(t), 1)]) };
    }, scale: 1e6,
    fallback: { period: "2026-Q3", value: -4317.0e6, prev: -2784.8e6, updated: "2026-11-05" } },
  { id: "interest", unit: "eur", source: "Eurostat", get: () => eurostat("gov_10a_main", { unit: "MIO_EUR", sector: "S13", na_item: "D41PAY" }, 12), scale: 1e6,
    fallback: { period: "2025", value: 65720.9e6, prev: 60130.9e6, updated: "2026-10-21" } },
  { id: "interest_pct", unit: "pct_gdp", source: "Eurostat", get: () => eurostat("gov_10a_main", { unit: "PC_GDP", sector: "S13", na_item: "D41PAY" }, 12),
    fallback: { period: "2025", value: 2.2, prev: 2.0, updated: "2026-10-21" } },
  { id: "population", unit: "people", source: "Eurostat", get: () => eurostat("demo_gind", { indic_de: "JAN" }, 12),
    fallback: { period: "2026", value: 69112309, prev: 68882600, updated: "2026-10-27" } },
  // persons in employment, national accounts (domestic concept), thousands
  { id: "employed", unit: "people", source: "Eurostat", get: () => eurostat("nama_10_pe", { unit: "THS_PER", na_item: "EMP_DC" }, 12), scale: 1e3,
    fallback: { period: "2025", value: 30638e3, prev: 30592e3, updated: "2026-10-21" } },
];

let previous = null;
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }

const kpis = [];
const errors = [];
for (const k of KPIS) {
  try {
    const r = await k.get();
    const s = r.series.map(([t, v]) => [t, round(v * (k.scale ?? 1), k.scale ? 0 : 2)]);
    const [period, value] = s.at(-1);
    kpis.push({ id: k.id, unit: k.unit, period, value, prev: s.at(-2)?.[1] ?? null, series: s, updated: r.updated, source: { name: k.source, dataset: r.dataset, url: r.url } });
  } catch (e) {
    errors.push({ id: k.id, error: String(e.message ?? e) });
    const old = previous?.kpis?.find((x) => x.id === k.id);
    if (old) kpis.push({ ...old, stale: true });
    else kpis.push({ id: k.id, unit: k.unit, ...k.fallback, series: [], source: { name: k.source, dataset: "fallback", url: null }, fallback: "2026-11-08" });
    console.warn(`! ${k.id}: ${e.message ?? e}`);
  }
}
const by = Object.fromEntries(kpis.map((k) => [k.id, k]));

// Live counter: latest quarterly Maastricht debt, extrapolated at its pace over the last four quarters.
const d = by.debt_eur;
const ds = d.series.length >= 5 ? d.series : null;
const yearAgo = ds ? ds.at(-5) : null;
const ratePerYear = yearAgo ? d.value - yearAgo[1] : by.deficit && by.gdp ? (-by.deficit.value / 100) * by.gdp.value : 0;
const debt = {
  eur: d.value,
  pct: by.debt_pct?.value ?? null,
  period: d.period,
  asOf: periodEnd(d.period),
  ratePerYear: Math.round(ratePerYear),
  rateFrom: yearAgo?.[0] ?? null,
  rateTo: d.period,
  rateBasis: yearAgo ? "4q" : "deficit",
};

// ---------- long-run debt-to-GDP, France and Germany (the "president by president" chart) ----------
// France: INSEE, comptes nationaux annuels base 2020, Maastricht debt of general government in % of GDP at
//   31 December, 1978 onwards (table "Dette des administrations publiques au sens de Maastricht par sous-secteur",
//   sheet "Figure 2", row "Ensemble"). Nothing official on the same definition exists before 1978.
// Germany: Eurostat gov_10dd_edpt1 (PC_GDP, S13, GD) from 1995; before that the IMF Global Debt Database
//   (GG_DEBT_GDP, general government, West Germany until 1990), linked to the Eurostat level at 1995 by a ratio
//   so the splice does not create a step.
// Latest point for each: the latest quarter of Eurostat gov_10q_ggdebt (end of quarter, % of GDP over four quarters).
// A part that fails keeps the previous file's series.
const INSEE_DEBT_PAGE = "https://www.insee.fr/fr/statistiques/2830192";
const INSEE_DEBT_XLSX = "https://www.insee.fr/fr/statistiques/fichier/2830192/econ-fin-pub-dette-adm-pub.xlsx";
const IMF_GDD = "https://www.imf.org/external/datamapper/api/v1/GG_DEBT_GDP/DEU";

async function getBuf(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (third-estate; github.com/nicbay/projectview)" }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

async function franceAnnual() {
  const { readSheet } = await import("./lib/xlsx.mjs");
  const rows = readSheet(await getBuf(INSEE_DEBT_XLSX), /Figure 2/);
  const head = rows.find((r) => r.filter((v) => typeof v === "number" && v >= 1950 && v <= 2100).length > 10);
  const tot = rows.find((r) => String(r[0]).trim() === "Ensemble");
  if (!head || !tot) throw new Error("INSEE debt table: header or 'Ensemble' row not found");
  const series = head.flatMap((y, i) => (typeof y === "number" && y >= 1950 && typeof tot[i] === "number" ? [[String(y), round(tot[i], 1)]] : []));
  if (series.length < 40 || series[0][0] > "1980") throw new Error(`INSEE debt table: unexpected shape (${series.length} years from ${series[0]?.[0]})`);
  return { series, source: { name: "INSEE", dataset: "Comptes nationaux annuels base 2020, dette des APU au sens de Maastricht (% du PIB)", url: INSEE_DEBT_PAGE } };
}

async function germanyAnnual() {
  const es = await eurostat("gov_10dd_edpt1", { geo: "DE", unit: "PC_GDP", sector: "S13", na_item: "GD" }, 60);
  const imf = JSON.parse(await get(IMF_GDD, "application/json"));
  const raw = imf?.values?.GG_DEBT_GDP?.DEU;
  if (!raw) throw new Error("IMF GDD: no DEU series");
  const first = es.series[0];
  const link = raw[first[0]] ? first[1] / raw[first[0]] : 1;
  const early = Object.entries(raw).filter(([y]) => y < first[0] && y >= "1960").sort().map(([y, v]) => [y, round(v * link, 1)]);
  return {
    series: [...early, ...es.series.map(([y, v]) => [y, round(v, 1)])],
    link: { year: first[0], factor: Math.round(link * 10000) / 10000 },
    sources: [
      { name: "Eurostat", dataset: "gov_10dd_edpt1", from: first[0], url: es.url },
      { name: "FMI / IMF", dataset: "Global Debt Database, GG_DEBT_GDP", from: early[0]?.[0] ?? null, url: "https://www.imf.org/external/datamapper/GG_DEBT_GDP@GDD/DEU" },
    ],
  };
}

const debtHistory = { ...(previous?.debtHistory ?? {}) };
for (const [key, fn] of [["fr", franceAnnual], ["de", germanyAnnual]]) {
  try {
    const r = await fn();
    debtHistory[key] = { ...(debtHistory[key] ?? {}), annual: r.series, ...(r.source ? { source: r.source } : {}), ...(r.sources ? { sources: r.sources, link: r.link } : {}), stale: undefined };
  } catch (e) {
    errors.push({ id: `debt_history_${key}`, error: String(e.message ?? e) });
    if (debtHistory[key]) debtHistory[key].stale = true;
    console.warn(`! debt history ${key}: ${e.message ?? e}`);
  }
}
// latest quarter: France from the KPI already fetched, Germany from the same dataset
if (debtHistory.fr && by.debt_pct?.period && !by.debt_pct.fallback)
  debtHistory.fr.latest = { period: by.debt_pct.period, value: by.debt_pct.value, source: { name: "Eurostat", dataset: "gov_10q_ggdebt", url: estatPage("gov_10q_ggdebt") } };
try {
  const q = await eurostat("gov_10q_ggdebt", { geo: "DE", unit: "PC_GDP", sector: "S13", na_item: "GD" }, 4);
  const [period, value] = q.series.at(-1);
  if (debtHistory.de) debtHistory.de.latest = { period, value: round(value, 1), source: { name: "Eurostat", dataset: "gov_10q_ggdebt", url: q.url } };
} catch (e) {
  errors.push({ id: "debt_history_de_q", error: String(e.message ?? e) });
  console.warn(`! debt history de (quarterly): ${e.message ?? e}`);
}

const data = {
  fetchedAt: new Date().toISOString(),
  debt,
  people: { population: by.population.value, populationPeriod: by.population.period, employed: by.employed.value, employedPeriod: by.employed.period },
  kpis,
  ...(debtHistory.fr || debtHistory.de ? { debtHistory } : {}),
  errors,
};
await mkdir(new URL(".", OUT), { recursive: true });
// one [period, value] pair per line keeps the file short and the diffs readable
await writeFile(OUT, JSON.stringify(data, null, 1).replace(/\[\s+("[^"]+"),\s+(-?[\d.e+]+)\s+\]/g, "[$1, $2]") + "\n");
console.log(`economy.json: ${kpis.length} indicators (${errors.length} failed); debt ${(d.value / 1e9).toFixed(1)} bn € at ${d.period}, +${(ratePerYear / 1e9).toFixed(1)} bn €/yr`);
