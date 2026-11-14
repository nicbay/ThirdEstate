// Town rankings: the figures every commune is ranked on (data: scripts/build-rankings.mjs → public/data/rankings/).
// A ranking is a data file read in one direction: "contributors" and "beneficiaries" are the same balance, read from
// either end. Ranks are national, among the towns that have the figure; ties share a rank.
import { fetchJson } from "../data";
import { L, fmtNum, getLang } from "../i18n";
import { residentBalance } from "./redistribution";

export type Unit = "score" | "pop" | "€" | "€±" | "%" | "‰" | "apl" | "€/m²";
export interface Ranking {
  /** the URL slug */
  slug: string;
  /** the data file (k-<data>.json) */
  data: string;
  /** "desc": highest first */
  dir: "desc" | "asc";
  group: [string, string];
  /** the select's label */
  label: [string, string];
  /** the page title: "the towns …" */
  title: [string, string];
  unit: Unit;
  /** turns the stored figure into the one shown (the typical resident's balance is read off the income) */
  show?: (v: number) => number;
}

const G = {
  score: ["Qualité de vie", "Quality of life"],
  people: ["Habitants", "People"],
  money: ["Revenus et emploi", "Income and jobs"],
  public: ["Contributeur ou bénéficiaire", "Net contributor or beneficiary"],
  housing: ["Logement", "Housing"],
  services: ["Services", "Services"],
  safety: ["Sécurité (faits pour 1 000 habitants)", "Safety (offences per 1,000 people)"],
} satisfies Record<string, [string, string]>;

const CRIME: [string, string, string][] = [
  ["burglary", "Cambriolages de logement (pour 1 000 logements)", "Home burglaries (per 1,000 homes)"],
  ["theftFromPersons", "Vols sans violence contre des personnes", "Non-violent theft from persons"],
  ["physicalViolenceOther", "Violences physiques hors famille", "Physical violence outside the family"],
  ["physicalViolenceFamily", "Violences intrafamiliales", "Domestic violence"],
  ["vehicleTheft", "Vols de véhicules", "Vehicle theft"],
  ["criminalDamage", "Destructions et dégradations", "Criminal damage"],
  ["drugTrafficking", "Trafic de stupéfiants", "Drug trafficking"],
  ["fraud", "Escroqueries", "Fraud"],
];
const resident = (income: number) => Math.round(residentBalance(income).net / 10) * 10;

export const RANKINGS: Ranking[] = [
  { slug: "qualite-de-vie", data: "quality", dir: "desc", group: G.score, label: ["Score de qualité de vie", "Quality-of-life score"], title: ["Les communes au meilleur score de qualité de vie", "Towns with the best quality-of-life score"], unit: "score" },
  { slug: "population", data: "pop", dir: "desc", group: G.people, label: ["Population", "Population"], title: ["Les communes les plus peuplées", "The most populous towns"], unit: "pop" },
  { slug: "niveau-de-vie", data: "income", dir: "desc", group: G.money, label: ["Niveau de vie médian", "Median standard of living"], title: ["Les communes au niveau de vie le plus élevé", "Towns with the highest standard of living"], unit: "€" },
  { slug: "pauvrete", data: "poverty", dir: "asc", group: G.money, label: ["Taux de pauvreté", "Poverty rate"], title: ["Les communes où la pauvreté est la plus faible", "Towns with the lowest poverty rate"], unit: "%" },
  { slug: "chomage", data: "unemployment", dir: "asc", group: G.money, label: ["Chômage (recensement)", "Unemployment (census)"], title: ["Les communes où le chômage est le plus faible", "Towns with the lowest unemployment"], unit: "%" },
  { slug: "mairies-contributrices", data: "townhall", dir: "asc", group: G.public, label: ["La mairie : contributrices nettes", "The town hall: net contributors"], title: ["Les mairies qui versent le plus à la solidarité entre communes", "Town halls that pay the most into equalisation"], unit: "€±" },
  { slug: "mairies-beneficiaires", data: "townhall", dir: "desc", group: G.public, label: ["La mairie : bénéficiaires nettes", "The town hall: net beneficiaries"], title: ["Les mairies qui reçoivent le plus de l’État", "Town halls that receive the most from the state"], unit: "€±" },
  { slug: "habitants-contributeurs", data: "income", dir: "desc", group: G.public, label: ["Un habitant typique : contributeur net", "A typical resident: net contributor"], title: ["Les communes dont l’habitant typique paie le plus", "Towns whose typical resident pays in the most"], unit: "€±", show: resident },
  { slug: "habitants-beneficiaires", data: "income", dir: "asc", group: G.public, label: ["Un habitant typique : bénéficiaire net", "A typical resident: net beneficiary"], title: ["Les communes dont l’habitant typique reçoit le plus", "Towns whose typical resident gets back the most"], unit: "€±", show: resident },
  { slug: "prix-appartements", data: "flat", dir: "desc", group: G.housing, label: ["Prix au m², appartements", "Price per m², flats"], title: ["Les communes où les appartements sont les plus chers", "Towns with the dearest flats"], unit: "€/m²" },
  { slug: "prix-maisons", data: "house", dir: "desc", group: G.housing, label: ["Prix au m², maisons", "Price per m², houses"], title: ["Les communes où les maisons sont les plus chères", "Towns with the dearest houses"], unit: "€/m²" },
  { slug: "medecins", data: "apl", dir: "desc", group: G.services, label: ["Accès aux généralistes", "Access to GPs"], title: ["Les communes au meilleur accès aux médecins généralistes", "Towns with the best access to GPs"], unit: "apl" },
  { slug: "fibre", data: "fibre", dir: "desc", group: G.services, label: ["Locaux raccordables à la fibre", "Premises with fibre"], title: ["Les communes les mieux fibrées", "Towns with the most fibre"], unit: "%" },
  { slug: "depense", data: "spending", dir: "desc", group: G.services, label: ["Dépense de la commune, par habitant", "Town spending, per inhabitant"], title: ["Les communes qui dépensent le plus par habitant", "Towns that spend the most per inhabitant"], unit: "€" },
  ...CRIME.map(([k, fr, en]): Ranking => ({ slug: `delinquance-${k}`, data: `crime-${k}`, dir: "asc", group: G.safety, label: [fr, en], title: [`Les communes les plus sûres : ${fr.toLowerCase()}`, `The safest towns: ${en.toLowerCase()}`], unit: "‰" })),
];
export const rankingBySlug = (slug?: string) => RANKINGS.find((r) => r.slug === slug);
/** The rankings a town is listed in, one per figure. A balance shows the side the town is actually on: a town hall
 *  or a typical resident that comes out behind is ranked among contributors, one that comes out ahead among
 *  beneficiaries (both rankings order every town; they read the same list from either end). */
export function townRankings(balance: { townhall?: number | null; resident?: number | null }): Ranking[] {
  const side = (v: number | null | undefined, contrib: string, benef: string) => (v == null ? null : v < 0 ? contrib : benef);
  const th = side(balance.townhall, "mairies-contributrices", "mairies-beneficiaires");
  const re = side(balance.resident, "habitants-contributeurs", "habitants-beneficiaires");
  return RANKINGS.filter((r) => (r.data === "townhall" ? r.slug === th : r.show ? r.slug === re : true));
}
/** The default ranking for a figure (the comparison and the town page link to it). */
export const rankingForData = (data: string) => RANKINGS.find((r) => r.data === data && r.show == null);

export interface TownIndex { codes: string[]; names: string[]; deps: string[]; pops: (number | null)[] }
export interface Meta { generated: string; order: Record<string, "asc" | "desc">; n: Record<string, number> }
let idx: Promise<TownIndex> | null = null, meta: Promise<Meta> | null = null;
const files = new Map<string, Promise<(number | null)[]>>();
const ranksByDep = new Map<string, Promise<Record<string, Record<string, number>>>>();
export const loadTownIndex = () => (idx ??= fetchJson<TownIndex>("/data/rankings/towns.json"));
export const loadRankMeta = () => (meta ??= fetchJson<Meta>("/data/rankings/meta.json"));
export function loadValues(data: string) {
  if (!files.has(data)) files.set(data, fetchJson<(number | null)[]>(`/data/rankings/k-${data}.json`));
  return files.get(data)!;
}
let qRanks: Promise<(number | null)[] | null> | null = null;
/** The quality score's exact ranks (its published value is rounded), to order its ties. */
export const loadQualityRanks = () => (qRanks ??= fetchJson<(number | null)[]>("/data/rankings/r-quality.json").catch(() => null));
const depOf = (code: string) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));

/** A town's national ranks: data id → [rank, out of]. Reading "desc" data "asc" (and the reverse) flips the rank. */
export async function townRanks(code: string): Promise<Record<string, [number, number]>> {
  const dep = depOf(code);
  if (!ranksByDep.has(dep)) ranksByDep.set(dep, fetchJson<Record<string, Record<string, number>>>(`/data/rankings/ranks/${dep}.json`).catch(() => ({})));
  const [r, m] = await Promise.all([ranksByDep.get(dep)!, loadRankMeta().catch(() => null)]);
  const own = r[code];
  if (!own || !m) return {};
  return Object.fromEntries(Object.entries(own).map(([k, v]) => [k, [v, m.n[k]] as [number, number]]));
}
/** The rank in one ranking's own direction. */
export function rankIn(rk: Ranking, ranks: Record<string, [number, number]>, meta: Meta | null): [number, number] | null {
  const r = ranks[rk.data];
  if (!r || !meta) return null;
  return meta.order[rk.data] === rk.dir ? r : [r[1] + 1 - r[0], r[1]];
}

/** "285ᵉ sur 30 836" / "#285 of 30,836" */
export const rankText = ([r, n]: [number, number]) => L(`${fmtNum(r)}${r === 1 ? "ʳᵉ" : "ᵉ"} sur ${fmtNum(n)}`, `#${fmtNum(r)} of ${fmtNum(n)}`);
export const rankHref = (rk: Ranking, code?: string) => `#/classements/${rk.slug}${code ? `/${code}` : ""}`;

const dec = (v: number, d = 1) => v.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: d });
export function fmtRankValue(v: number | null | undefined, rk: Ranking): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = rk.show ? rk.show(v) : v;
  switch (rk.unit) {
    case "score": return `${Math.round(x)}/100`;
    case "pop": return fmtNum(Math.round(x));
    case "€": case "€/m²": return `${fmtNum(Math.round(x))} €`;
    case "€±": return `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmtNum(Math.abs(Math.round(x)))} €`;
    case "%": return `${dec(x)}${L(" %", "%")}`;
    case "‰": return dec(x, x < 10 ? 2 : 1);
    case "apl": return dec(x);
  }
}
