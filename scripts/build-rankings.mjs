// Town rankings: every French commune ranked on each figure the town pages show, nationally.
// Reads the files the town pages already use (district profiles, per-department town bundles, the quality score,
// the state balance) and writes small files the rankings page and the town pages read:
//
//   public/data/rankings/towns.json        { codes, names, deps, pops }  one entry per commune, same order everywhere
//   public/data/rankings/k-<id>.json       [value | null, …]             aligned with towns.json
//   public/data/rankings/ranks/<dep>.json  { "<code>": { "<id>": rank } } the town's national rank (1 = first in the
//                                                                         figure's order, see ORDER)
//   public/data/rankings/r-quality.json    [rank | null, …]              the quality score's exact rank (its value is rounded)
//   public/data/rankings/meta.json         { generated, n: { "<id>": towns with the figure } }
//
//   node scripts/build-rankings.mjs   (after the district profiles, sync:communes, build-quality, sync-state-balance)
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const ROOT = new URL("../public/data/", import.meta.url);
const OUT = new URL("rankings/", ROOT);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const depOf = (code) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));
const CRIME = ["burglary", "theftFromPersons", "physicalViolenceOther", "physicalViolenceFamily", "vehicleTheft", "criminalDamage", "drugTrafficking", "fraud"];

/** Which end is first: "desc" = highest value ranks 1, "asc" = lowest ranks 1. Mirrors src/lib/rankings.ts. */
export const ORDER = {
  quality: "desc", pop: "desc", income: "desc", poverty: "asc", unemployment: "asc",
  apl: "desc", fibre: "desc", flat: "desc", house: "desc", spending: "desc",
  townhall: "asc", // most negative first: the biggest net contributors
  ...Object.fromEntries(CRIME.map((k) => [`crime-${k}`, "asc"])),
};

const towns = new Map(); // code → { name, pop, v: {id: value} }
// the quality score is published rounded to a whole number, which ties thousands of towns: its own file keeps the
// exact rank (scripts/build-quality.mjs), used instead
const qualityRank = new Map();
const at = (code, name, pop) => {
  if (!towns.has(code)) towns.set(code, { name, pop, v: {} });
  const t = towns.get(code);
  if (name && !t.name) t.name = name;
  if (pop && !t.pop) t.pop = pop;
  return t.v;
};
const set = (v, k, x) => { if (x != null && Number.isFinite(x) && v[k] == null) v[k] = x; };

for (const f of (await readdir(new URL("districts/", ROOT))).filter((x) => /^\w{4,5}\.json$/.test(x) && x !== "index.json")) {
  const p = await read(`districts/${f}`);
  const I = p.indicators ?? {};
  for (const u of p.geography?.units ?? []) at(u.code, u.name, u.pop);
  for (const [code, x] of Object.entries(I.income?.communes ?? {})) { const v = at(code); set(v, "income", x[0]); set(v, "poverty", x[1]); }
  for (const [code, x] of Object.entries(I.unemploymentCensus?.communes ?? {})) set(at(code), "unemployment", x);
  for (const [code, c] of Object.entries(I.crime?.communes ?? {})) { const v = at(code); for (const k of CRIME) set(v, `crime-${k}`, c?.[k]?.[1]); }
  for (const [code, x] of Object.entries(I.localSpending?.communes?.values ?? {})) set(at(code), "spending", x?.[0]);
}
for (const f of (await readdir(new URL("communes-dep/", ROOT))).filter((x) => x.endsWith(".json"))) {
  for (const [code, c] of Object.entries((await read(`communes-dep/${f}`)).communes ?? {})) {
    const v = at(code, c.name, c.population?.value ?? c.population);
    if (c.health?.gpAccess?.status === "ok") set(v, "apl", c.health.gpAccess.value);
    if (c.broadband?.ftth?.status === "ok") set(v, "fibre", c.broadband.ftth.share);
    if (c.property?.status === "ok") { set(v, "flat", c.property.apartment?.medianPerM2); set(v, "house", c.property.house?.medianPerM2); }
  }
}
for (const f of (await readdir(new URL("quality/", ROOT))).filter((x) => /^\w+\.json$/.test(x) && x !== "meta.json")) {
  for (const [code, q] of Object.entries(await read(`quality/${f}`))) { set(at(code), "quality", q?.[0]); if (q?.[1]) qualityRank.set(code, q[1]); }
}
for (const f of (await readdir(new URL("state-balance/", ROOT))).filter((x) => x.endsWith(".json"))) {
  for (const [code, r] of Object.entries((await read(`state-balance/${f}`)).communes ?? {})) {
    const [pop, dgf, fpic, fsrif] = r;
    set(at(code, undefined, pop), "townhall", dgf + (fpic ?? 0) + fsrif);
  }
}
for (const t of towns.values()) if (t.pop) t.v.pop = t.pop;

// only real communes with a name (drops codes that appear in one source only, without a name)
const codes = [...towns.keys()].filter((c) => towns.get(c).name).sort();
const ids = Object.keys(ORDER);
await mkdir(new URL("ranks/", OUT), { recursive: true });

const round = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100);
const ranks = new Map(); // code → {id: rank}
const n = {};
for (const id of ids) {
  const vals = codes.map((c) => towns.get(c).v[id] ?? null);
  await writeFile(new URL(`k-${id}.json`, OUT), JSON.stringify(vals.map((x) => (x == null ? null : round(x)))));
  const order = codes.map((c, i) => [c, vals[i]]).filter(([, x]) => x != null).sort((a, b) => (ORDER[id] === "desc" ? b[1] - a[1] : a[1] - b[1]));
  n[id] = order.length;
  // ties share a rank (standard competition ranking: 1, 2, 2, 4)
  let prev = null, r = 0;
  order.forEach(([c, x], i) => {
    if (x !== prev) { r = i + 1; prev = x; }
    if (!ranks.has(c)) ranks.set(c, {});
    ranks.get(c)[id] = id === "quality" ? qualityRank.get(c) ?? r : r;
  });
}
// the exact quality rank of every town, aligned with towns.json, so the page can order the rounded scores' ties
await writeFile(new URL("r-quality.json", OUT), JSON.stringify(codes.map((c) => qualityRank.get(c) ?? null)));
await writeFile(new URL("towns.json", OUT), JSON.stringify({ codes, names: codes.map((c) => towns.get(c).name), deps: codes.map(depOf), pops: codes.map((c) => towns.get(c).pop ?? null) }));
const byDep = new Map();
for (const [c, r] of ranks) { const d = depOf(c); if (!byDep.has(d)) byDep.set(d, {}); byDep.get(d)[c] = r; }
for (const [d, obj] of byDep) await writeFile(new URL(`ranks/${d}.json`, OUT), JSON.stringify(obj));
await writeFile(new URL("meta.json", OUT), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), order: ORDER, n }));
console.log(`✓ rankings: ${codes.length} towns, ${ids.length} figures (${ids.map((i) => `${i} ${n[i]}`).join(", ")})`);
