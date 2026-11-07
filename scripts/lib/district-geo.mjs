// Geography helpers for the district profiles:
//   - planar point-in-polygon on the district outlines (public/data/geo/circo/<dep>.geojson)
//   - conversion of commune codes from older geographies to the INSEE COG 2026

import { readdir, readFile } from "node:fs/promises";

// ---- point in polygon (lon/lat treated as planar: fine at district scale) ----

const ringContains = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const polygonContains = (poly, x, y) => ringContains(poly[0], x, y) && !poly.slice(1).some((h) => ringContains(h, x, y));

export function geometryContains(geom, lon, lat) {
  if (geom.type === "Polygon") return polygonContains(geom.coordinates, lon, lat);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => polygonContains(p, lon, lat));
  return false;
}

function bbox(geom) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Loads every district outline: Map code → { geom, bbox }
export async function loadDistrictShapes(dir) {
  const shapes = new Map();
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".geojson")) continue;
    const g = JSON.parse(await readFile(new URL(f, dir), "utf8"));
    for (const ft of g.features) shapes.set(ft.properties.code, { geom: ft.geometry, bbox: bbox(ft.geometry) });
  }
  return shapes;
}

// District containing a point, among `candidates` (codes) or all shapes.
export function locate(shapes, lon, lat, candidates = null) {
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  for (const code of candidates ?? shapes.keys()) {
    const s = shapes.get(code);
    if (!s) continue;
    const [x0, y0, x1, y1] = s.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (geometryContains(s.geom, lon, lat)) return code;
  }
  return null;
}

// ---- commune codes → COG 2026 ----
// v_commune_2026.csv lists current communes (COM), municipal arrondissements (ARM) and
// delegated/associated communes (COMD/COMA, with their parent COMPARENT).
// v_mvt_commune_2026.csv lists every change since 1943; we follow merges forward.

export function makeCogResolver(communeRows, mvtRows) {
  const current = new Map(); // code → name, for COM and ARM
  const parent = new Map(); // COMD/COMA code → parent COM
  for (const r of communeRows) {
    if (r.TYPECOM === "COM" || r.TYPECOM === "ARM") current.set(r.COM, r.LIBELLE);
    else if ((r.TYPECOM === "COMD" || r.TYPECOM === "COMA") && r.COMPARENT && !current.has(r.COM)) parent.set(r.COM, r.COMPARENT);
  }
  const forward = new Map(); // old code → [{date, to}]
  for (const r of mvtRows) {
    if (r.COM_AV === r.COM_AP || r.TYPECOM_AP !== "COM") continue;
    if (!forward.has(r.COM_AV)) forward.set(r.COM_AV, []);
    forward.get(r.COM_AV).push({ date: r.DATE_EFF, to: r.COM_AP });
  }
  for (const list of forward.values()) list.sort((a, b) => (a.date < b.date ? 1 : -1)); // latest first

  const resolve = (code, depth = 0) => {
    if (!code) return null;
    if (current.has(code)) return code;
    if (depth > 10) return null;
    if (parent.has(code)) return resolve(parent.get(code), depth + 1);
    const f = forward.get(code);
    if (f) return resolve(f[0].to, depth + 1);
    return null;
  };
  return { resolve, name: (code) => current.get(code) ?? null, isCurrent: (code) => current.has(code) };
}

// Paris / Lyon / Marseille: arrondissement code from a polling-station number (bureau "1203" → 12e)
export const PLM = { "75056": (n) => `751${String(n).padStart(2, "0")}`, "69123": (n) => `6938${n}`, "13055": (n) => `132${String(n).padStart(2, "0")}` };
export const PLM_OF_ARM = (arm) => (arm.startsWith("751") ? "75056" : arm.startsWith("6938") ? "69123" : arm.startsWith("132") ? "13055" : null);
