// Hemicycle seat chart: one dot per seat, groups placed left → right in the order they sit.
import { esc } from "../util";
import { L, fmtNum } from "../i18n";

/** Statutory seats, set by organic law (Code électoral, art. LO 119 and LO 274). */
export const AN_SEATS = 577;
export const SENATE_SEATS = 348;

/**
 * Seats filled, seats vacant and the absolute majority. A vote that needs an absolute majority of the
 * "members composing the Assembly" (a censure motion, art. 49 of the Constitution) counts only the seats
 * actually filled: 289 of 577 when every seat is filled, 288 with 574 sitting MPs. Ordinary votes only
 * need a majority of the votes cast.
 */
export function seatSummary(statutory: number, sitting: number) {
  const filled = Math.min(sitting, statutory);
  return { statutory, sitting: filled, vacant: statutory - filled, majority: Math.floor(filled / 2) + 1, fullMajority: Math.floor(statutory / 2) + 1 };
}

/** Seating order of the 17th-legislature groups, left to right; unknown groups go before non-attached. */
export const SEATING = ["GDR", "LFI-NFP", "ECOS", "SOC", "LIOT", "DEM", "EPR", "HOR", "DR", "UDR", "RN", "NI"];
export const seatRank = (abrev: string | undefined) => {
  const i = SEATING.indexOf(abrev ?? "");
  return i < 0 ? SEATING.length - 1.5 : i;
};

/**
 * Senate seating, left to right. Matched on the group's abbreviation first, then on a keyword of its full
 * name (case- and accent-insensitive), so renamed groups still sort sensibly. Non-attached always last.
 */
const SENATE_SEATING: [abrevs: string[], keyword: string][] = [
  [["CRCE-K", "CRCE"], "communiste"],
  [["GEST"], "ecologiste - solidarite"],
  [["SER"], "socialiste"],
  [["RDPI"], "rassemblement des democrates"],
  [["RDSE"], "rassemblement democratique et social"],
  [["UC", "UCI"], "union centriste"],
  [["LIRT", "Les Indépendants"], "les independants"],
  [["LR", "Les Républicains"], "republicains"],
  [["UNT"], "union nationale pour les territoires"],
  [["NI"], "ne figurant sur la liste d'aucun groupe"],
];
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/’/g, "'").toLowerCase();
export const senateSeatRank = (g?: { abrev: string; libelle: string }) => {
  if (!g) return SENATE_SEATING.length;
  let i = SENATE_SEATING.findIndex(([ab]) => ab.includes(g.abrev));
  if (i < 0) {
    const s = fold(g.libelle);
    i = SENATE_SEATING.findIndex(([, k]) => s.includes(k));
  }
  return i < 0 ? SENATE_SEATING.length - 1.5 : i; // unknown group: just before non-attached
};

export interface SeatGroup {
  label: string;
  color: string;
  seats: number;
  href?: string;
}

/**
 * Groups must already be in left → right order. `statutory` is the chamber's legal size: seats beyond
 * the groups' total are drawn as empty (vacant) seats at the right-hand end.
 */
export function hemicycle(groups: SeatGroup[], statutory?: number, rows = 12) {
  const sitting = groups.reduce((s, g) => s + g.seats, 0);
  if (!sitting) return "";
  const sum = seatSummary(Math.max(statutory ?? sitting, sitting), sitting);
  const all: SeatGroup[] = sum.vacant ? [...groups, { label: L("Siège vacant", "Vacant seat"), color: "", seats: sum.vacant }] : groups;
  const total = sum.statutory;
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
    while (g < all.length - 1 && used >= all[g].seats) { g++; used = 0; }
    used++;
    const grp = all[g];
    const tip = grp.color
      ? `${grp.label}\n${grp.seats} ${L("sièges", "seats")}`
      : `${grp.seats} ${grp.seats > 1 ? L("sièges vacants", "vacant seats") : L("siège vacant", "vacant seat")}`;
    return `<circle class="seat${grp.color ? "" : " seat-vacant"}" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${dot.toFixed(1)}"${grp.color ? ` fill="${grp.color}"` : ""} data-tip="${esc(tip)}"/>`;
  });
  const sub = sum.vacant
    ? `${fmtNum(sum.sitting)} ${L("pourvus", "filled")} · ${L("majorité", "majority")} ${sum.majority}`
    : `${L("sièges", "seats")} · ${L("majorité", "majority")} ${sum.majority}`;
  const aria = L(`Hémicycle : ${total} sièges, ${sum.sitting} pourvus, majorité absolue ${sum.majority}`, `Hemicycle: ${total} seats, ${sum.sitting} filled, absolute majority ${sum.majority}`);
  return `<svg class="hemicycle" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${circles.join("")}
    <line x1="${cx}" x2="${cx}" y1="${cy - outer - 10}" y2="${cy - inner + 14}" class="hemi-maj"/>
    <text x="${cx}" y="${cy - 34}" text-anchor="middle" class="hemi-total">${total}</text>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="hemi-sub">${sub}</text>
  </svg>`;
}

/** Sentence under the Assembly hemicycle: seats, vacancies, and which majority the line marks. */
export function assemblyMajorityNote(sitting: number) {
  const s = seatSummary(AN_SEATS, sitting);
  const vac = s.vacant
    ? L(` ${s.vacant} ${s.vacant > 1 ? "sièges sont vacants" : "siège est vacant"}, en attente d’une élection partielle.`, ` ${s.vacant} ${s.vacant > 1 ? "seats are" : "seat is"} vacant, pending a by-election.`)
    : "";
  return L(
    `${s.statutory} sièges, ${fmtNum(s.sitting)} députés en exercice.${vac} Majorité absolue des membres en exercice, seuil d’une motion de censure : ${s.majority}${s.vacant ? ` (${s.fullMajority} quand les ${s.statutory} sièges sont pourvus)` : ""}. Les votes ordinaires se décident à la majorité des suffrages exprimés.`,
    `${s.statutory} seats, ${fmtNum(s.sitting)} sitting MPs.${vac} Absolute majority of sitting members, the threshold for a censure motion: ${s.majority}${s.vacant ? ` (${s.fullMajority} when all ${s.statutory} seats are filled)` : ""}. Ordinary votes are decided by a majority of votes cast.`,
  );
}
