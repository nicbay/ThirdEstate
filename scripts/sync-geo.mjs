// Map outlines from official open data (data.gouv.fr). Borders rarely change: run once.
//   npm run sync:geo
//
// Output:
//   public/data/geo/departements.geojson      Etalab administrative boundaries (2024)
//   public/data/geo/circo/<dep>.geojson       legislative districts, one file per department
//                                             feature property `code` = dep + 2-digit district ("0104", "97101")

import { mkdir, writeFile } from "node:fs/promises";

const DEPARTEMENTS = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2024/geojson/departements-1000m.geojson";
const CIRCOS = "https://static.data.gouv.fr/resources/contours-geographiques-des-circonscriptions-legislatives/20240613-191520/circonscriptions-legislatives-p10.geojson";
const out = new URL("../public/data/geo/", import.meta.url);

// The district file uses ministry codes for overseas departments.
const OVERSEAS = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZS: "975", ZM: "976", ZX: "977", ZW: "986", ZP: "987", ZN: "988" };

const round = (digits) => {
  const k = 10 ** digits;
  const r = (c) => (typeof c[0] === "number" ? c.map((n) => Math.round(n * k) / k) : c.map(r));
  return r;
};
const get = async (url) => {
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

await mkdir(new URL("circo/", out), { recursive: true });

const dep = await get(DEPARTEMENTS);
dep.features = dep.features.map((f) => ({ type: "Feature", properties: { code: f.properties.code, nom: f.properties.nom }, geometry: { type: f.geometry.type, coordinates: round(4)(f.geometry.coordinates) } }));
await writeFile(new URL("departements.geojson", out), JSON.stringify(dep));
console.log(`✓ ${dep.features.length} departments`);

const circ = await get(CIRCOS);
const byDep = new Map();
for (const f of circ.features) {
  const p = f.properties;
  const depCode = OVERSEAS[p.codeDepartement] ?? p.codeDepartement;
  const code = depCode + p.codeCirconscription.slice(-2);
  const list = byDep.get(depCode) ?? [];
  list.push({ type: "Feature", properties: { code, num: Number(p.codeCirconscription.slice(-2)) }, geometry: { type: f.geometry.type, coordinates: round(4)(f.geometry.coordinates) } });
  byDep.set(depCode, list);
}
for (const [code, features] of byDep) await writeFile(new URL(`circo/${code}.geojson`, out), JSON.stringify({ type: "FeatureCollection", features }));
console.log(`✓ ${circ.features.length} districts in ${byDep.size} department files`);
