// A quality-of-life score per commune, ours and transparent: for each of six published figures, the town's
// percentile among all French towns that have it (turned so that higher is always better), then the average.
// Figures: median standard of living, poverty rate, unemployment (INSEE), offences against people and property
// per 1,000 people (SSMSI: violence outside the family, burglary, theft from persons, criminal damage, averaged as
// percentiles), access to GPs (DREES APL) and fibre coverage (Arcep). A town needs at least four of the six.
// It is a summary of these figures, not a measure of happiness: nothing on climate, transport, culture or nature.
//
//   node scripts/build-quality.mjs      (after the district profiles and sync:communes)
//
// Output: public/data/quality/<dep>.json  { "<code>": [score 0–100, rank, parts: {income, poverty, …} ] } and
//         public/data/quality/meta.json   { n, year, parts }
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const ROOT = new URL("../public/data/", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const depOf = (code) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));
const CRIME = ["physicalViolenceOther", "burglary", "theftFromPersons", "criminalDamage"];

// raw figures per commune
const raw = new Map(); // code → { income, poverty, unemployment, crime, gp, fibre }
const at = (code) => { if (!raw.has(code)) raw.set(code, {}); return raw.get(code); };
for (const f of (await readdir(new URL("districts/", ROOT))).filter((x) => /^\w{4,5}\.json$/.test(x) && x !== "index.json")) {
  const I = (await read(`districts/${f}`)).indicators ?? {};
  for (const [code, v] of Object.entries(I.income?.communes ?? {})) { const r = at(code); r.income ??= v[0]; r.poverty ??= v[1]; }
  for (const [code, v] of Object.entries(I.unemploymentCensus?.communes ?? {})) at(code).unemployment ??= v;
  for (const [code, c] of Object.entries(I.crime?.communes ?? {})) {
    const r = at(code);
    r.crimeRates ??= Object.fromEntries(CRIME.map((k) => [k, c?.[k]?.[1]]).filter(([, x]) => x != null));
  }
}
for (const f of (await readdir(new URL("communes-dep/", ROOT))).filter((x) => x.endsWith(".json"))) {
  const b = await read(`communes-dep/${f}`);
  for (const [code, c] of Object.entries(b.communes ?? {})) {
    const gp = c.health?.gpAccess, ft = c.broadband?.ftth;
    if (gp?.status === "ok" && gp.value != null) at(code).gp = gp.value;
    if (ft?.status === "ok" && ft.share != null) at(code).fibre = ft.share;
  }
}

// percentiles (0 = worst, 100 = best) per figure
const pct = (key, better, get = (r) => r[key]) => {
  const xs = [...raw].map(([c, r]) => [c, get(r)]).filter(([, v]) => v != null && Number.isFinite(v)).sort((a, b) => a[1] - b[1]);
  // ties share their average rank (thousands of villages sit at exactly 100 % fibre)
  const out = new Map();
  for (let i = 0; i < xs.length; ) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1][1] === xs[i][1]) j++;
    const p = (100 * ((i + j) / 2)) / Math.max(1, xs.length - 1);
    for (let k = i; k <= j; k++) out.set(xs[k][0], better === "high" ? p : 100 - p);
    i = j + 1;
  }
  return out;
};
const parts = {
  income: pct("income", "high"),
  poverty: pct("poverty", "low"),
  unemployment: pct("unemployment", "low"),
  safety: (() => { // the four offence rates, each as a percentile, averaged
    const per = CRIME.map((k) => pct(k, "low", (r) => r.crimeRates?.[k]));
    const out = new Map();
    for (const c of raw.keys()) { const v = per.map((m) => m.get(c)).filter((x) => x != null); if (v.length >= 2) out.set(c, v.reduce((a, b) => a + b, 0) / v.length); }
    return out;
  })(),
  doctors: pct("gp", "high"),
  fibre: pct("fibre", "high"),
};
const scores = [];
for (const c of raw.keys()) {
  const p = Object.fromEntries(Object.entries(parts).map(([k, m]) => [k, m.get(c)]).filter(([, v]) => v != null).map(([k, v]) => [k, Math.round(v)]));
  if (Object.keys(p).length < 4) continue;
  const vals = Object.values(p);
  scores.push([c, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), p]);
}
scores.sort((a, b) => b[1] - a[1]);
const byDep = {};
scores.forEach(([c, s, p], i) => { (byDep[depOf(c)] ??= {})[c] = [s, i + 1, p]; });
await mkdir(new URL("quality/", ROOT), { recursive: true });
for (const [d, m] of Object.entries(byDep)) await writeFile(new URL(`quality/${d}.json`, ROOT), JSON.stringify(m));
await writeFile(new URL("quality/meta.json", ROOT), JSON.stringify({ n: scores.length, parts: Object.keys(parts) }));
console.log(`quality: ${scores.length} towns scored; top: ${scores.slice(0, 3).map((x) => x[0]).join(", ")}`);
