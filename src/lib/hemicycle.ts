// Hemicycle seat chart: one dot per MP, groups placed left → right in the order they sit.
import { esc } from "../util";
import { L } from "../i18n";

/** Seating order of the 17th-legislature groups, left to right; unknown groups go before non-attached. */
export const SEATING = ["GDR", "LFI-NFP", "ECOS", "SOC", "LIOT", "DEM", "EPR", "HOR", "DR", "UDR", "RN", "NI"];
export const seatRank = (abrev: string | undefined) => {
  const i = SEATING.indexOf(abrev ?? "");
  return i < 0 ? SEATING.length - 1.5 : i;
};

export interface SeatGroup {
  label: string;
  color: string;
  seats: number;
  href?: string;
}

/** Groups must already be in left → right order. */
export function hemicycle(groups: SeatGroup[], rows = 12) {
  const total = groups.reduce((s, g) => s + g.seats, 0);
  if (!total) return "";
  const W = 640, H = 340, cx = W / 2, cy = H - 12, outer = 300, inner = 110;
  // seats per row proportional to row radius, adjusted to sum to total
  const radii = Array.from({ length: rows }, (_, i) => inner + ((outer - inner) * i) / (rows - 1));
  const sumR = radii.reduce((a, b) => a + b, 0);
  const perRow = radii.map((r) => Math.floor((total * r) / sumR));
  for (let i = rows - 1; perRow.reduce((a, b) => a + b, 0) < total; i = (i - 1 + rows) % rows) perRow[i]++;
  const seats: { x: number; y: number; angle: number }[] = [];
  radii.forEach((r, i) => {
    const n = perRow[i];
    for (let k = 0; k < n; k++) {
      const angle = Math.PI - (Math.PI * (k + 0.5)) / n; // π (left) → 0 (right)
      seats.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle), angle });
    }
  });
  seats.sort((a, b) => b.angle - a.angle); // sweep left → right
  const dot = ((outer - inner) / (rows - 1)) * 0.42;
  let g = 0, used = 0;
  const circles = seats.map((s) => {
    while (g < groups.length - 1 && used >= groups[g].seats) { g++; used = 0; }
    used++;
    const grp = groups[g];
    return `<circle class="seat" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${dot.toFixed(1)}" fill="${grp.color}" data-tip="${esc(`${grp.label}\n${grp.seats} ${L("sièges", "seats")}`)}"/>`;
  });
  return `<svg class="hemicycle" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hémicycle">${circles.join("")}
    <line x1="${cx}" x2="${cx}" y1="${cy - outer - 10}" y2="${cy - inner + 14}" class="hemi-maj"/>
    <text x="${cx}" y="${cy - 34}" text-anchor="middle" class="hemi-total">${total}</text>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="hemi-sub">${L("sièges", "seats")} · ${L("majorité", "majority")} ${Math.floor(total / 2) + 1}</text>
  </svg>`;
}
