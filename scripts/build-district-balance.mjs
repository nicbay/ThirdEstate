// Per legislative district: the median standard of living (for the "typical resident" estimate, worked out in
// the browser by src/lib/redistribution.ts) and the town halls' balance with the state (grants and equalisation,
// € per inhabitant, from public/data/state-balance/<dep>.json, weighted like the district profiles: each commune by
// the share of its voters in the district × its population). Plus one light national map of the 577 districts.
//
//   node scripts/build-district-balance.mjs       (after sync:state-balance and the district profiles)
//
// Output:
//   public/data/state-balance/districts.json   { year, incomeYear, districts: { "9101": [label, medianIncome|null, townBalance|null] } }
//   public/data/geo/circo-france.geojson       every district, simplified to about 600 m
import { readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("../public/data/", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const depOf = (code) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));
const plmCity = (c) => (/^751\d\d$/.test(c) ? "75056" : /^6938\d$/.test(c) ? "69123" : /^132\d\d$/.test(c) ? "13055" : c);

const balanceFiles = new Map();
async function balanceOf(code) {
  const dep = depOf(code);
  if (!balanceFiles.has(dep)) balanceFiles.set(dep, await read(`state-balance/${dep}.json`).catch(() => null));
  const f = balanceFiles.get(dep);
  const r = f?.communes[code] ?? f?.communes[plmCity(code)];
  return r ? { v: r[1] + (r[2] ?? 0) + r[3], year: f.year } : null;
}

const files = (await readdir(new URL("districts/", root))).filter((f) => /^\w{4,5}\.json$/.test(f) && f !== "index.json");
const out = {};
let year = null, incomeYear = null;
for (const f of files) {
  const d = await read(`districts/${f}`);
  const inc = d.indicators?.income;
  incomeYear ??= inc?.year ?? null;
  let num = 0, den = 0;
  for (const u of d.geography?.units ?? []) {
    const b = await balanceOf(u.code);
    if (!b || !u.pop) continue;
    year ??= b.year;
    const w = (u.share ?? 1) * u.pop;
    num += w * b.v; den += w;
  }
  out[d.code] = [d.label ?? d.code, inc?.district?.medianIncomeApprox ?? null, den ? Math.round(num / den) : null];
}
await writeFile(new URL("state-balance/districts.json", root), JSON.stringify({ year, incomeYear, districts: out }));

// the national map: every department's districts, simplified (Douglas–Peucker, about 600 m) and rounded to ~100 m
const TOL = 0.006;
function simplify(pts) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let far = -1, fd = TOL;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// a closed ring starts and ends on the same point: simplify its two halves, split at the point farthest from the start
const simplifyRing = (ring) => {
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  if (far <= 0 || far >= ring.length - 1) return simplify(ring);
  return [...simplify(ring.slice(0, far + 1)).slice(0, -1), ...simplify(ring.slice(far))];
};
const thin = (ring) => {
  const r = simplifyRing(ring).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
  return r.length >= 4 ? r : ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
};
const features = [];
for (const f of (await readdir(new URL("geo/circo/", root))).filter((x) => x.endsWith(".geojson"))) {
  const g = await read(`geo/circo/${f}`);
  for (const ft of g.features) {
    const geom = ft.geometry;
    const coordinates = geom.type === "Polygon" ? geom.coordinates.map(thin) : geom.coordinates.map((poly) => poly.map(thin));
    features.push({ type: "Feature", properties: { code: ft.properties.code }, geometry: { type: geom.type, coordinates } });
  }
}
await writeFile(new URL("geo/circo-france.geojson", root), JSON.stringify({ type: "FeatureCollection", features }));
console.log(`district balance: ${Object.keys(out).length} districts; map: ${features.length} features`);
