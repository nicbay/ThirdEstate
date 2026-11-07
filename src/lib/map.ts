import { geoConicConformal, geoMercator, geoPath, type GeoProjection } from "d3-geo";
import { esc } from "../util";

/** d3-geo expects clockwise exterior rings; RFC 7946 GeoJSON is counter-clockwise. */
export function rewind<T extends GeoJSON.Feature>(f: T): T {
  const area = (r: number[][]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (q[0] - p[0]) * (q[1] + p[1]); }, 0);
  const fix = (rings: number[][][]) => rings.map((r, i) => ((area(r) > 0) === (i === 0) ? r : [...r].reverse()));
  const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const coordinates = g.type === "Polygon" ? fix(g.coordinates) : g.coordinates.map(fix);
  return { ...f, geometry: { type: g.type, coordinates } as GeoJSON.Geometry };
}

export interface Area {
  fill: string;
  opacity?: number;
  title: string;
  selected?: boolean;
}

/** Render features as clickable paths (data-code) fitted to a width × height box. */
export function mapPaths(features: GeoJSON.Feature[], size: [number, number], area: (code: string) => Area, projection: "france" | "mercator" = "france") {
  const fc = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
  const proj: GeoProjection = (projection === "france" ? geoConicConformal().parallels([44, 49]).rotate([-3, 0]) : geoMercator()).fitExtent([[4, 4], [size[0] - 4, size[1] - 4]], fc);
  const path = geoPath(proj);
  const stroke = size[0] > 300 ? 0.6 : 1;
  return features
    .map((f) => {
      const code = f.properties!.code as string;
      const a = area(code);
      return `<path class="area${a.selected ? " selected" : ""}" data-code="${code}" d="${path(f)}" fill="${a.fill}" fill-opacity="${a.opacity ?? 1}" stroke-width="${stroke}"><title>${esc(a.title)}</title></path>`;
    })
    .join("");
}

export const OVERSEAS_DEPS = ["971", "972", "973", "974", "976"];

/** Caption under an overseas inset. */
export const insetFigure = (svg: string, caption: string) => `<figure class="inset-fig">${svg}<figcaption class="inset-cap">${esc(caption)}</figcaption></figure>`;

/**
 * "French abroad" tile, drawn as a peer of the overseas insets: same 100×100 box and caption,
 * a globe filled with the area's colour, and the same hover/selected states as map areas.
 * The click target is the button (data-code="99"); the globe itself carries no data-code.
 */
export function abroadInset(a: { fill: string; opacity?: number; title: string; label: string; sub?: string; selected?: boolean }) {
  const lines = `<g class="globe-lines" aria-hidden="true"><ellipse cx="50" cy="50" rx="17" ry="38"/><path d="M12 50H88M17 31H83M17 69H83M50 12V88"/></g>`;
  return `<button type="button" class="abroad${a.selected ? " selected" : ""}" data-code="99" aria-pressed="${a.selected ? "true" : "false"}" aria-label="${esc(a.title)}" data-tip="${esc(a.title)}">
    <svg viewBox="0 0 100 100" class="inset" aria-hidden="true"><circle class="globe" cx="50" cy="50" r="38" fill="${a.fill}" fill-opacity="${a.opacity ?? 1}"/>${lines}</svg>
    <span class="inset-cap">${esc(a.label)}${a.sub ? ` <span class="muted">${esc(a.sub)}</span>` : ""}</span>
  </button>`;
}
