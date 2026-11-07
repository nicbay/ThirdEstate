// Party colours and political families. Party codes come from Wikipedia's poll tables
// (see scripts/sync-polls.mjs); candidates without one are "unknown" until the user sets it.

export type Bloc = 0 | 1 | 2 | 3 | 4; // radical left → far right
export const BLOCS: { fr: string; en: string; color: string }[] = [
  { fr: "Gauche radicale", en: "Radical left", color: "#c41f33" },
  { fr: "Gauche", en: "Left", color: "#e8559a" },
  { fr: "Centre", en: "Centre", color: "#f2a400" },
  { fr: "Droite", en: "Right", color: "#1f5fcf" },
  { fr: "Droite nationale", en: "Nationalist right", color: "#1c2c6c" },
];

const PARTY: Record<string, { color: string; bloc: Bloc | null }> = {
  LO: { color: "#7f0000", bloc: 0 },
  NPA: { color: "#a31515", bloc: 0 },
  PCF: { color: "#d0021b", bloc: 0 },
  LFI: { color: "#cf2a36", bloc: 0 },
  "D!": { color: "#e2683c", bloc: 0 },
  PS: { color: "#e8559a", bloc: 1 },
  PP: { color: "#f48fb1", bloc: 1 },
  LC: { color: "#d97aa6", bloc: 1 },
  LE: { color: "#1e9e57", bloc: 1 },
  EELV: { color: "#1e9e57", bloc: 1 },
  RE: { color: "#f2a400", bloc: 2 },
  LREM: { color: "#f2a400", bloc: 2 },
  HOR: { color: "#36a3d9", bloc: 2 },
  MD: { color: "#f77f00", bloc: 2 },
  LFH: { color: "#9b7fd1", bloc: 2 },
  IND: { color: "#9aa3b2", bloc: 2 },
  LR: { color: "#1f5fcf", bloc: 3 },
  NF: { color: "#5a8be0", bloc: 3 },
  RES: { color: "#8e7cc3", bloc: null },
  DLF: { color: "#4c6a92", bloc: 4 },
  RN: { color: "#1c2c6c", bloc: 4 },
  "R!": { color: "#4a2c1d", bloc: 4 },
  REC: { color: "#4a2c1d", bloc: 4 },
  NE: { color: "#3f72c4", bloc: 3 }, // Nouvelle Énergie (David Lisnard)
  DIV: { color: "#9aa3b2", bloc: null },
};

export interface CandidateMeta {
  name: string;
  surname: string;
  party: string | null;
  color: string;
  bloc: Bloc | null;
}

/** "Jean-Luc Mélenchon" → "Mélenchon", "Marine Le Pen" → "Le Pen", "Dominique de Villepin" → "de Villepin" */
export function surname(full: string) {
  const parts = full.split(" ");
  const i = parts.findIndex((p, k) => k > 0 && (/^(de|du|des|Le|La)$/.test(p) || k === parts.length - 1));
  return parts.slice(i).join(" ");
}

let extraParties: Record<string, string> = {};
// Candidates the poll tables list without a party label.
const KNOWN_PARTIES: Record<string, string> = { "David Lisnard": "NE" };
export const registerParties = (p: Record<string, string>) => (extraParties = { ...extraParties, ...p });

export function meta(name: string): CandidateMeta {
  const party = extraParties[name] ?? KNOWN_PARTIES[name] ?? null;
  const p = party ? PARTY[party] : undefined;
  return { name, surname: surname(name), party, color: p?.color ?? hashColor(name), bloc: p?.bloc ?? null };
}

// Stable fallback colour for candidates with no known party.
function hashColor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 35% 55%)`;
}

// ---------- 2024 legislative nuances (Ministry of the Interior codes) → poll blocs ----------
export const LEG_BLOCS: { key: string; nuances: string[]; color: string; fr: string; en: string }[] = [
  { key: "EXG", nuances: ["EXG"], color: "#7f0000", fr: "Extrême gauche", en: "Far left" },
  { key: "NFP", nuances: ["UG", "FI", "SOC", "COM", "VEC"], color: "#cf2a36", fr: "Nouveau Front populaire", en: "New Popular Front" },
  { key: "DVG", nuances: ["DVG", "RDG"], color: "#e8559a", fr: "Divers gauche", en: "Misc. left" },
  { key: "ECO", nuances: ["ECO"], color: "#1e9e57", fr: "Écologistes", en: "Ecologists" },
  { key: "ENS", nuances: ["ENS", "HOR", "UDI"], color: "#f2a400", fr: "Ensemble", en: "Ensemble" },
  { key: "DVC", nuances: ["DVC"], color: "#f6c75a", fr: "Divers centre", en: "Misc. centre" },
  { key: "LR", nuances: ["LR"], color: "#1f5fcf", fr: "Les Républicains", en: "The Republicans" },
  { key: "DVD", nuances: ["DVD"], color: "#6f95e0", fr: "Divers droite", en: "Misc. right" },
  { key: "DSV", nuances: ["DSV"], color: "#4c6a92", fr: "Droite souverainiste", en: "Sovereigntist right" },
  { key: "RN and allies", nuances: ["RN", "UXD"], color: "#1c2c6c", fr: "RN et alliés", en: "RN and allies" },
  { key: "REC", nuances: ["REC"], color: "#4a2c1d", fr: "Reconquête", en: "Reconquête" },
  { key: "REG", nuances: ["REG"], color: "#8a6d3b", fr: "Régionalistes", en: "Regionalists" },
  { key: "Others", nuances: ["DIV", "EXD"], color: "#9aa3b2", fr: "Divers", en: "Others" },
];
export const NUANCE_LABEL: Record<string, string> = {
  EXG: "Extrême gauche", UG: "Union de la gauche (NFP)", FI: "La France insoumise", SOC: "Parti socialiste", COM: "Parti communiste", VEC: "Les Écologistes",
  DVG: "Divers gauche", RDG: "Parti radical de gauche", ECO: "Écologistes", ENS: "Ensemble", HOR: "Horizons", UDI: "UDI", DVC: "Divers centre",
  LR: "Les Républicains", DVD: "Divers droite", DSV: "Droite souverainiste", RN: "Rassemblement national", UXD: "Union de l'extrême droite (Ciotti)",
  REC: "Reconquête", EXD: "Extrême droite", REG: "Régionaliste", DIV: "Divers",
};
export const nuanceColor = (code: string) => LEG_BLOCS.find((b) => b.nuances.includes(code))?.color ?? "#9aa3b2";

const PARTY_ORDER = Object.keys(PARTY);
/** Position on the left → right axis, for ordering strips and lists by seating rather than size. */
export function spectrumRank(name: string) {
  const m = meta(name);
  const p = m.party ? PARTY_ORDER.indexOf(m.party) : -1;
  return (m.bloc ?? 2.5) * 100 + (p < 0 ? 50 : p);
}
