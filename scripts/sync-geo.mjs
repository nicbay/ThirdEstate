// Department outlines from Etalab's official administrative boundaries (data.gouv.fr).
//   npm run sync:geo
import { mkdir, writeFile } from "node:fs/promises";

const URL_ = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2024/geojson/departements-1000m.geojson";
const out = new URL("../public/data/geo/", import.meta.url);
console.log(`↓ ${URL_}`);
const res = await fetch(URL_);
if (!res.ok) throw new Error(`${res.status} for ${URL_}`);
const gj = await res.json();
// keep only what the map needs; round coordinates to ~10 m
const round = (c) => (typeof c[0] === "number" ? c.map((n) => Math.round(n * 1e4) / 1e4) : c.map(round));
gj.features = gj.features.map((f) => ({ type: "Feature", properties: { code: f.properties.code, nom: f.properties.nom }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } }));
await mkdir(out, { recursive: true });
await writeFile(new URL("departements.geojson", out), JSON.stringify(gj));
console.log(`✓ ${gj.features.length} departments → public/data/geo/departements.geojson`);
