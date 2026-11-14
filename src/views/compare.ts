// "Your town vs another": two communes side by side, every figure the site holds per commune, the
// difference spelled out as a number (which is higher, by how much), never as a paragraph.
// Route: #/comparer/<codeA>/<codeB> (shareable); #/comparer/<codeA> asks for the second town.
// Data: the same sources as the town page (district profiles, per-town files, municipal results,
// geo.api.gouv.fr). To add a figure, add one entry to KPIS below.
import { fetchJson } from "../data";
import { L, fmtNum, getLang } from "../i18n";
import { getHome } from "../lib/cloud";
import { toast } from "../lib/toast";
import { esc, safeColor } from "../util";
import { CRIME_LABELS, bindSearch, depOf, loadDepartmentTowns, loadTownBundle, plmCity, plmWhole, searchBox, townExtra, type TownData } from "./explore";
import "../styles/compare.css";
import { armsSlot, loadCommuneArms, loadDepartmentArms, paintArms } from "../lib/arms";
import { residentBalance } from "../lib/redistribution";
import { loadMunicipalPolice, type MunicipalPolice } from "./town-police";
import { loadStateBalance, type StateBalance } from "./town-state";
import { loadRankMeta, rankHref, rankIn, rankText, townRankings, townRanks, type Meta } from "../lib/rankings";
import { REDISTRIBUTION_SOURCE } from "../lib/redistribution";
import "../styles/rankings.css";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const once = new Map<string, Promise<Any>>();
const get = (url: string) => {
  // the geo API can be slow: give up after 8 s rather than leave the page loading (figures then show "—")
  if (!once.has(url)) once.set(url, Promise.race([fetchJson<Any>(url), new Promise((r) => setTimeout(() => r(null), 8000))]).catch(() => null));
  return once.get(url)!;
};

/** One town, everything the comparison reads. */
interface Side {
  code: string;
  dep: string;
  name: string;
  depName: string;
  pop?: number;
  /** km² */
  area?: number;
  t?: TownData;
  extra: ReturnType<typeof townExtra>;
  muni?: Any;
  /** INSEE 2022 census, whole town (towns split into IRIS neighbourhoods: about 3,900) */
  census?: Record<string, number>;
  /** our quality-of-life score (scripts/build-quality.mjs): [score 0–100, rank, parts] */
  quality?: [number, number, Record<string, number>];
  police?: MunicipalPolice | null;
  state?: StateBalance | null;
  /** figures that are not the town's own: city-wide for an arrondissement, or averaged over arrondissements */
  approx: Set<string>;
  cityWide: Set<string>;
  /** national ranks: ranking data id → [rank, out of] (src/lib/rankings.ts) */
  ranks: Record<string, [number, number]>;
}

const PLM_NAME: Record<string, string> = { "75056": "Paris", "69123": "Lyon", "13055": "Marseille" };

async function loadSide(code: string): Promise<Side | null> {
  const dep = depOf(code);
  const [{ towns }, bundle, info, muni, quartiers, quality, police, state, arrs] = await Promise.all([
    loadDepartmentTowns(dep).catch(() => ({ towns: new Map<string, TownData>() })),
    loadTownBundle(dep),
    get(`https://geo.api.gouv.fr/communes/${code}?fields=nom,code,population,departement,surface`),
    get(`/data/municipal/${dep}.json`),
    get(`/data/quartiers/${code}.json`),
    get(`/data/quality/${dep}.json`),
    loadMunicipalPolice(plmCity(code)).catch(() => null),
    loadStateBalance(code).catch(() => null),
    // Paris, Lyon, Marseille arrondissements: their own council and mayor (scripts/sync-municipal-plm.mjs)
    plmCity(code) !== code ? get("/data/municipal/arrondissements.json") : null,
  ]);
  const ranks = await townRanks(code).catch(() => ({}));
  const own = towns.get(code);
  const t = own ?? plmWhole(towns, code);
  if (!info && !t) return null;
  const approx = new Set<string>(), cityWide = new Set<string>();
  // Paris, Lyon, Marseille as a whole: income, poverty and unemployment exist per arrondissement only,
  // so average them, weighted by population (an approximation, marked as such)
  if (t && !own) {
    const arrs = [...towns.values()].filter((a) => a.code !== code && plmCity(a.code) === code);
    const total = arrs.reduce((s, a) => s + a.pop, 0);
    for (const k of ["income", "poverty", "unemployment"] as const) {
      const has = arrs.filter((a) => a[k] != null);
      const cov = has.reduce((s, a) => s + a.pop, 0);
      if (total && cov / total >= 0.8) { t[k] = has.reduce((s, a) => s + a[k]! * a.pop, 0) / cov; approx.add(k); }
    }
    t.years ??= arrs.find((a) => a.years)?.years;
  }
  if (plmCity(code) !== code && t?.crime) cityWide.add("crime");
  const m = arrs?.arrondissements?.[code] ?? muni?.communes?.[code] ?? muni?.communes?.[plmCity(code)];
  if (m && !muni?.communes?.[code] && !arrs?.arrondissements?.[code]) cityWide.add("vote");
  return {
    code,
    dep,
    name: info?.nom ?? t?.name ?? PLM_NAME[code] ?? code,
    depName: info?.departement?.nom ?? dep,
    pop: info?.population ?? t?.pop,
    area: info?.surface ? info.surface / 100 : undefined,
    t,
    extra: townExtra(bundle[code]),
    muni: m,
    census: quartiers?.comparison?.commune,
    quality: quality?.[code] ?? quality?.[plmCity(code)],
    police,
    state,
    approx,
    cityWide,
    ranks,
  };
}

// ---------- the figures ----------
type Unit = "€" | "€±" | "%" | "‰" | "pop" | "density" | "€/m²" | "apl" | "per10k" | "score";
interface Kpi {
  id: string;
  group: string;
  label: [string, string];
  unit: Unit;
  /** "pts" for rates (difference in points), "rel" for amounts (relative difference) */
  diff: "pts" | "rel" | "abs";
  /** which way is better, when there is one; drives the green mark only, never the wording */
  better: "high" | "low" | null;
  get: (s: Side) => number | undefined;
  /** tag that marks an approximate or city-wide figure (see Side.approx / Side.cityWide) */
  flag?: string;
  note?: (s: Side) => string | undefined;
}
const GROUPS: [string, string, string][] = [
  ["score", "Qualité de vie", "Quality of life"],
  ["people", "Habitants", "People"],
  ["money", "Revenus et emploi", "Income and jobs"],
  ["housing", "Logement", "Housing"],
  ["services", "Services", "Services"],
  ["safety", "Sécurité, faits pour 1 000 habitants", "Safety, offences per 1,000 people"],
  ["public", "Contributeur ou bénéficiaire", "Net contributor or beneficiary"],
  ["vote", "Municipales 2026", "2026 municipal elections"],
];
/** SRU law: towns of 3,500+ people (1,500+ in Île-de-France) in larger urban areas must reach 25 % social housing
 *  (20 % in some areas). Census share of households renting social housing, a close proxy for the SRU count. */
const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const sruNote = (s: Side) => {
  const v = s.census?.socialHousing;
  if (v == null || !s.pop || s.pop < (IDF.has(s.dep) ? 1500 : 3500)) return undefined;
  return v < 20 ? L("sous le plancher de 20 % de la loi SRU", "below the SRU law's 20% floor") : v < 25 ? L("sous l’objectif de 25 % de la loi SRU", "below the SRU law's 25% target") : undefined;
};
const decisive = (m: Any) => m?.y2026?.rounds?.find((r: Any) => r.round === m.y2026.decidedRound) ?? m?.y2026?.rounds?.at(-1);
const KPIS: Kpi[] = [
  { id: "quality", group: "score", label: ["Score de qualité de vie (sur 100)", "Quality-of-life score (out of 100)"], unit: "score", diff: "pts", better: "high", get: (s) => s.quality?.[0],
    note: (s) => (s.quality ? L(`${fmtNum(s.quality[1])}ᵉ commune de France`, `#${fmtNum(s.quality[1])} in France`) : undefined) },
  { id: "pop", group: "people", label: ["Population", "Population"], unit: "pop", diff: "rel", better: null, get: (s) => s.pop },
  { id: "density", group: "people", label: ["Densité", "Density"], unit: "density", diff: "rel", better: null, get: (s) => (s.pop && s.area ? s.pop / s.area : undefined) },
  { id: "under15", group: "people", label: ["Moins de 15 ans", "Under 15"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.under15 },
  { id: "over65", group: "people", label: ["65 ans et plus", "65 and over"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.over65 },
  { id: "higherEd", group: "people", label: ["Diplômés du supérieur", "Degree holders"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.higherEducation },
  { id: "noDiploma", group: "people", label: ["Sans diplôme", "No qualifications"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.noDiploma },
  { id: "income", group: "money", label: ["Niveau de vie médian", "Median standard of living"], unit: "€", diff: "rel", better: "high", get: (s) => s.t?.income, flag: "income" },
  { id: "poverty", group: "money", label: ["Taux de pauvreté", "Poverty rate"], unit: "%", diff: "pts", better: "low", get: (s) => s.t?.poverty, flag: "poverty" },
  { id: "unemployment", group: "money", label: ["Chômage (recensement)", "Unemployment (census)"], unit: "%", diff: "pts", better: "low", get: (s) => s.t?.unemployment, flag: "unemployment" },
  { id: "owners", group: "housing", label: ["Propriétaires", "Homeowners"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.owners },
  { id: "social", group: "housing", label: ["Logement social (HLM)", "Social housing"], unit: "%", diff: "pts", better: null, get: (s) => s.census?.socialHousing, note: sruNote },
  { id: "vacancy", group: "housing", label: ["Logements vacants", "Empty homes"], unit: "%", diff: "pts", better: "low", get: (s) => s.census?.vacancy },
  { id: "flat", group: "housing", label: ["Prix au m², appartements", "Price per m², flats"], unit: "€/m²", diff: "rel", better: null, get: (s) => s.extra?.prices?.apartment?.median },
  { id: "house", group: "housing", label: ["Prix au m², maisons", "Price per m², houses"], unit: "€/m²", diff: "rel", better: null, get: (s) => s.extra?.prices?.house?.median },
  { id: "apl", group: "services", label: ["Accès aux généralistes", "Access to GPs"], unit: "apl", diff: "rel", better: "high", get: (s) => s.extra?.health?.apl },
  { id: "fibre", group: "services", label: ["Locaux raccordables à la fibre", "Premises with fibre"], unit: "%", diff: "pts", better: "high", get: (s) => s.extra?.broadband?.fibre },
  { id: "spending", group: "services", label: ["Dépense de la commune, par habitant", "Town spending, per inhabitant"], unit: "€", diff: "rel", better: null, get: (s) => s.t?.spending?.[0] },
  { id: "schools", group: "services", label: ["Collèges et lycées, pour 10 000 habitants", "Secondary schools, per 10,000 people"], unit: "per10k", diff: "rel", better: "high", get: (s) => (s.t?.schools.length && s.pop ? (10000 * s.t.schools.length) / s.pop : undefined) },
  ...Object.entries(CRIME_LABELS).map(([k, [fr, en]]): Kpi => ({
    id: `crime-${k}`, group: "safety", label: k === "burglary" ? [`${fr} (pour 1 000 logements)`, `${en} (per 1,000 homes)`] : [fr, en], unit: "‰", diff: "rel", better: "low", get: (s) => s.t?.crime?.[k]?.[1], flag: "crime",
  })),
  { id: "police", group: "safety", label: ["Policiers municipaux, pour 10 000 habitants", "Municipal police, per 10,000 people"], unit: "per10k", diff: "rel", better: null, get: (s) => s.police?.per10k },
  { id: "resident", group: "public", label: ["Un habitant typique : reçu − payé, par an", "A typical resident: received − paid, a year"], unit: "€±", diff: "abs", better: null, get: (s) => (s.t?.income ? Math.round(residentBalance(s.t.income).net / 10) * 10 : undefined),
    note: (s) => (s.t?.income ? (residentBalance(s.t.income).net < 0 ? L("contributeur net", "net contributor") : L("bénéficiaire net", "net beneficiary")) : undefined) },
  { id: "townhall", group: "public", label: ["La mairie : dotations et péréquation, par habitant", "The town hall: grants and equalisation, per inhabitant"], unit: "€±", diff: "abs", better: null, get: (s) => s.state?.balance,
    note: (s) => (s.state ? (s.state.balance < 0 ? L("contributrice nette", "net contributor") : L("bénéficiaire nette", "net beneficiary")) : undefined) },
  { id: "turnout", group: "vote", label: ["Participation", "Turnout"], unit: "%", diff: "pts", better: null, get: (s) => decisive(s.muni)?.turnoutPct, flag: "vote" },
  { id: "winnerShare", group: "vote", label: ["Score de la liste élue", "Winning list’s share"], unit: "%", diff: "pts", better: null, get: (s) => s.muni?.y2026?.winner?.pctExpressed, flag: "vote" },
];

// ---------- formatting ----------
/** A name short enough for the narrow middle column: "Paris 15e Arrondissement" → "Paris 15e", then cut. */
function shortName(name: string, max = 14) {
  const n = name.replace(/\s+Arrondissement$/i, "").replace(/^Saint-/, "St-").replace(/^Sainte-/, "Ste-");
  return n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n;
}
const fr = () => getLang() === "fr";
const dec = (v: number, d = 1) => v.toLocaleString(fr() ? "fr-FR" : "en-GB", { maximumFractionDigits: d });
function fmtVal(v: number | undefined, unit: Unit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "€": return `${fmtNum(Math.round(v))} €`;
    case "€±": return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(Math.round(v)))} €`;
    case "score": return `${Math.round(v)}<small>/100</small>`;
    case "€/m²": return `${fmtNum(Math.round(v))} €`;
    case "%": return `${dec(v)}${L(" %", "%")}`;
    case "‰": return dec(v, v < 10 ? 2 : 1);
    case "pop": return fmtNum(Math.round(v));
    case "density": return `${fmtNum(Math.round(v))}<small> ${L("hab./km²", "/km²")}</small>`;
    case "apl": return dec(v);
    case "per10k": return dec(v);
  }
}
/** "+3,2 pts", "+24 %", "×2,4" or "≈": always the gap from the lower to the higher. */
function gap(a: number, b: number, k: Kpi): string {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (k.diff === "abs") { const d = Math.abs(a - b); return d < 1 ? "≈" : `${fmtNum(Math.round(d))} €`; }
  if (k.diff === "pts") {
    const d = hi - lo;
    return d < 0.05 ? "≈" : `+${dec(d)} ${L(d >= 2 ? "pts" : "pt", d >= 2 ? "pts" : "pt")}`;
  }
  if (lo <= 0) return hi > 0 ? "" : "≈";
  const r = hi / lo;
  if (r < 1.02) return "≈";
  return r >= 2 ? `×${r >= 10 ? fmtNum(Math.round(r)) : dec(r)}` : `+${Math.round((r - 1) * 100)}${L(" %", "%")}`;
}

/** Each town's coat of arms in pixel art, with its department's (a link to the department and its MPs). */
async function fillFlags(root: HTMLElement) {
  const da = await loadDepartmentArms();
  for (const el of root.querySelectorAll<HTMLElement>(".town-flag[data-commune]")) {
    const code = el.dataset.commune!, dep = el.dataset.dep!, name = el.dataset.name ?? code;
    const ca = await loadCommuneArms(dep);
    el.innerHTML = armsSlot(ca[code] ?? ca[plmCity(code)], L(`Armoiries : ${name}`, `Coat of arms: ${name}`), "m")
      + armsSlot(da[dep], L("Le département, ses communes et ses députés", "The department, its towns and MPs"), "s", `#/explorer/${dep}`);
    el.removeAttribute("aria-hidden");
  }
  paintArms(root);
}

function flagSlot(s: Side) {
  // filled by fillFlags: the town's arms and its department's
  return `<span class="town-flag" data-commune="${esc(s.code)}" data-dep="${esc(s.dep)}" data-name="${esc(s.name)}" aria-hidden="true"></span>`;
}

function sideCard(s: Side, which: "a" | "b") {
  return `<div class="cmp-town cmp-${which}">
    ${flagSlot(s)}
    <p class="eyebrow">${esc(s.depName)} (${esc(s.dep)})</p>
    <h2><a href="#/ville/${esc(s.code)}">${esc(s.name)}</a></h2>
    <p class="small muted">${s.pop ? `${fmtNum(s.pop)} ${L("habitants", "inhabitants")}` : "—"}</p>
    <details class="cmp-change"><summary>${L("Changer de commune", "Change town")}</summary>${searchBox(L("Une ville, un code postal", "A town, a postcode"))}</details>
  </div>`;
}

function quickPicks(a: Side) {
  const h = getHome();
  const picks: [string, string][] = [];
  if (h?.code && h.code !== a.code) picks.push([h.code, h.commune ?? h.code]);
  for (const [c, n] of [["75056", "Paris"], ["13055", "Marseille"], ["69123", "Lyon"], ["31555", "Toulouse"], ["06088", "Nice"], ["44109", "Nantes"]] as const)
    if (c !== a.code && c !== plmCity(a.code) && !picks.some((p) => p[0] === c)) picks.push([c, n]);
  return `<p class="cmp-picks">${picks.slice(0, 6).map(([c, n]) => `<a class="chip" href="#/comparer/${esc(a.code)}/${esc(c)}">${esc(n)}</a>`).join("")}</p>`;
}

function rowHtml(k: Kpi, a: Side, b: Side) {
  const va = k.get(a), vb = k.get(b);
  const has = va != null && vb != null && Number.isFinite(va) && Number.isFinite(vb);
  const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0));
  const w = (v?: number) => (v != null && max ? Math.max(2, (100 * Math.abs(v)) / max) : 0);
  const hiSide = has && va !== vb ? (va! > vb! ? "a" : "b") : null;
  const g = has ? gap(va!, vb!, k) : "";
  const winner = hiSide && g !== "≈" && k.better ? (k.better === "high" ? hiSide : hiSide === "a" ? "b" : "a") : null;
  const loser = winner ? (winner === "a" ? "b" : "a") : null;
  const tone = (side: "a" | "b") => (winner === side ? " good" : loser === side ? " bad" : "");
  const mark = (s: Side) => (k.flag && s.approx.has(k.flag) ? "≈ " : "");
  const star = (s: Side) => (k.flag && s.cityWide.has(k.flag) ? `<sup title="${esc(L(`Chiffre de ${PLM_NAME[plmCity(s.code)] ?? ""} entier`, `Figure for the whole of ${PLM_NAME[plmCity(s.code)] ?? ""}`))}">*</sup>` : "");
  const note = (s: Side) => { const n = k.note?.(s); return n ? `<small class="cmp-note${k.id === "social" ? " bad" : ""}">${esc(n)}</small>` : ""; };
  const rank = (s: Side) => {
    const data = RANK_DATA[k.id];
    if (!data) return "";
    // a balance is ranked on the side the town is on (contributor or beneficiary)
    const best = townRankings({ townhall: s.state?.balance }).filter((r) => r.data === data && !r.show).map((r) => ({ r, x: rankIn(r, s.ranks, rankMeta) })).find((o) => o.x);
    return best ? `<a class="rank-of" href="${rankHref(best.r, s.code)}" title="${esc(L(...best.r.label))}">${rankText(best.x!)}</a>` : "";
  };
  const hiName = hiSide === "a" ? a.name : b.name;
  // the gap, said once in the middle: red when the higher figure is the worse one, green when it's the better one
  const gapTone = hiSide && winner ? (hiSide === winner ? "good" : "bad") : "";
  const gapHtml = g && g !== "≈" ? `<span class="cmp-gap ${gapTone}" title="${esc(`${g} ${L("à", "at")} ${hiName}`)}">${esc(g)} ${L("à", "at")} ${esc(shortName(hiName))}</span>` : g === "≈" ? `<span class="cmp-gap">${L("à égalité", "level")}</span>` : "";
  return `<li class="cmp-row${winner ? ` win-${winner}` : ""}" data-kpi="${k.id}">
    <span class="cmp-v a${tone("a")}">${va == null ? "—" : mark(a) + fmtVal(va, k.unit)}${star(a)}${note(a)}${rank(a)}</span>
    <span class="cmp-bar a" aria-hidden="true"><i style="width:${w(va).toFixed(1)}%"></i></span>
    <span class="cmp-mid-label">${k.group === "public" ? `<button type="button" class="cmp-label cmp-calc-btn" aria-controls="cmp-calc">${esc(fr() ? k.label[0] : k.label[1])} <span aria-hidden="true">ⓘ</span></button>` : `<span class="cmp-label">${esc(fr() ? k.label[0] : k.label[1])}</span>`}${gapHtml}</span>
    <span class="cmp-bar b" aria-hidden="true"><i style="width:${w(vb).toFixed(1)}%"></i></span>
    <span class="cmp-v b${tone("b")}">${vb == null ? "—" : mark(b) + fmtVal(vb, k.unit)}${star(b)}${note(b)}${rank(b)}</span>
  </li>`;
}
/** Comparison figure → the ranking data it is ranked on (src/lib/rankings.ts). */
const RANK_DATA: Record<string, string> = {
  quality: "quality", pop: "pop", income: "income", poverty: "poverty", unemployment: "unemployment", flat: "flat", house: "house",
  apl: "apl", fibre: "fibre", spending: "spending", townhall: "townhall",
  ...Object.fromEntries(Object.keys(CRIME_LABELS).map((k) => [`crime-${k}`, `crime-${k}`])),
};
let rankMeta: Meta | null = null;

const eur = (n: number, sign = false) => `${sign && n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(Math.round(n)))} €`;
/** The two balances worked out for one town: what goes in, what comes out, the result. */
function calcSide(s: Side) {
  const out: string[] = [];
  if (s.t?.income) {
    const r = residentBalance(s.t.income);
    out.push(`<h4>${L("Un habitant typique", "A typical resident")}</h4>
      <p class="small">${L(`Niveau de vie médian ${eur(r.income)} par an, soit le ${Math.round(r.percentile)}ᵉ centile en France. À ce niveau de vie, en moyenne par an et par unité de consommation (Insee, 2019) :`, `Median standard of living ${eur(r.income)} a year, the ${Math.round(r.percentile)}th percentile in France. At that standard of living, on average a year and per consumption unit (INSEE, 2019):`)}</p>
      <table class="table cmp-calc-t"><tbody>
        <tr><td>${L("Impôts, cotisations et TVA payés", "Taxes, contributions and VAT paid")}</td><td class="num">${eur(-r.paid, true)}</td></tr>
        <tr><td>${L("Prestations en espèces reçues (retraites comprises)", "Cash benefits received (pensions included)")}</td><td class="num">${eur(r.cash, true)}</td></tr>
        <tr><td>${L("Services publics utilisés (santé, éducation…)", "Public services used (health, education…)")}</td><td class="num">${eur(r.inKind, true)}</td></tr>
        <tr><td>${L("Part de la dépense collective (défense, justice…)", "Share of collective spending (defence, justice…)")}</td><td class="num">${eur(r.collective, true)}</td></tr>
        <tr class="cmp-calc-sum"><td>${L("Solde publié par l’Insee à ce niveau de vie", "Balance INSEE publishes at this standard of living")}</td><td class="num"><b>${eur(r.net, true)}</b></td></tr>
      </tbody></table>
      <p class="tiny muted">${L("Le solde publié diffère un peu de la somme des lignes : l’Insee arrondit chaque poste et en répartit certains autrement. Une estimation pour un habitant typique, pas une mesure de la commune.", "The published balance differs slightly from the sum of the lines: INSEE rounds each item and allocates some differently. An estimate for a typical resident, not a measure of the town.")} <a href="${REDISTRIBUTION_SOURCE.page}" target="_blank" rel="noopener">Insee Analyses n° 88</a></p>`);
  }
  if (s.state) {
    const st = s.state;
    out.push(`<h4>${L("La mairie", "The town hall")} (${st.year})</h4>
      <table class="table cmp-calc-t"><tbody>
        <tr><td>${L("Dotation globale de fonctionnement reçue (DGF)", "General operating grant received (DGF)")}</td><td class="num">${eur(st.dgf, true)}</td></tr>
        ${st.fpic != null ? `<tr><td>${st.fpicScope === "e" ? L("Péréquation intercommunale (FPIC), solde de l’intercommunalité par habitant", "Intercommunal equalisation (FPIC), the intercommunality's balance per inhabitant") : L("Péréquation intercommunale (FPIC), solde de la commune", "Intercommunal equalisation (FPIC), the town's balance")}</td><td class="num">${eur(st.fpic, true)}</td></tr>` : ""}
        ${st.fsrif ? `<tr><td>${L("Solidarité des communes d’Île-de-France (FSRIF), solde", "Île-de-France solidarity fund (FSRIF), balance")}</td><td class="num">${eur(st.fsrif, true)}</td></tr>` : ""}
        <tr class="cmp-calc-sum"><td>${L("Reçu moins versé, par habitant", "Received minus paid in, per inhabitant")}</td><td class="num"><b>${eur(st.balance, true)}</b></td></tr>
      </tbody></table>
      <p class="tiny muted">${L(`Par habitant au sens de la DGF (${fmtNum(st.pop)} habitants). Positif : la commune reçoit plus qu’elle ne verse ; négatif : contributrice nette. Ni l’impôt sur le revenu de ses habitants ni le prélèvement DILICO ne sont dans ce solde.`, `Per DGF inhabitant (${fmtNum(st.pop)} people). Positive: the town receives more than it pays in; negative: a net contributor. Neither its residents' income tax nor the DILICO levy is in this balance.`)} <a href="#/ville/${esc(s.code)}">${L("Le détail sur la page de la commune", "The detail on the town page")}</a></p>`);
  }
  return out.join("") || `<p class="muted small">—</p>`;
}

function winnerCell(s: Side, F: Any) {
  const w = s.muni?.y2026?.winner;
  if (!w) return `<span class="muted">—</span>`;
  const fam = F[w.family ?? ""];
  const famName = fam && w.family !== "unclassified" ? (fr() ? fam.fr : fam.en) : L("sans étiquette", "no label");
  const head = w.head?.name ? String(w.head.name).replace(/\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'-]+)\b/g, (x: string) => (x.length > 1 && x === x.toUpperCase() ? x.charAt(0) + x.slice(1).toLowerCase() : x)) : "";
  return `<span class="cmp-winner" style="--c:${safeColor(fam?.color, "#a3a7ae")}"><b>${esc(famName)}</b>${head ? `<span class="small">${esc(head)}</span>` : ""}${w.seats != null && s.muni?.seats ? `<span class="tiny muted">${w.seats}/${s.muni.seats} ${L("sièges", "seats")}</span>` : ""}</span>`;
}

// ---------- page ----------
export async function renderCompare(app: HTMLElement, codeA?: string, codeB?: string) {
  if (codeA && codeA === codeB) codeB = undefined;
  const [a, b, fams, meta] = await Promise.all([codeA ? loadSide(codeA) : null, codeB ? loadSide(codeB) : null, get("/data/municipal/families.json"), loadRankMeta().catch(() => null)]);
  rankMeta = meta;
  const F = fams?.families ?? {};

  const top = `<header class="sec-hero cmp-hero">
      <p class="eyebrow">${L("Comparer deux communes", "Compare two towns")}</p>
      <h1>${a && b ? `${esc(a.name)} <span class="cmp-vs">${L("contre", "vs")}</span> ${esc(b.name)}` : L("Votre commune face à une autre", "Your town against another")}</h1>
    </header>`;

  if (!a) {
    app.innerHTML = `<section class="page compare">${top}
      <div class="cmp-pick card"><p>${L("Choisissez une première commune.", "Pick a first town.")}</p>${searchBox(L("Une ville, un code postal", "A town, a postcode"))}</div></section>`;
    bindSearch(app, (c) => (location.hash = `#/comparer/${c}`));
    void fillFlags(app);
    return;
  }

  const heads = `<div class="cmp-heads">
      ${sideCard(a, "a")}
      <div class="cmp-mid">${b ? `<a class="cmp-swap" href="#/comparer/${esc(b.code)}/${esc(a.code)}" title="${esc(L("Inverser", "Swap"))}" aria-label="${esc(L("Inverser les deux communes", "Swap the two towns"))}">⇄</a>` : `<span class="cmp-vs">${L("contre", "vs")}</span>`}</div>
      ${b ? sideCard(b, "b") : `<div class="cmp-town cmp-b cmp-empty"><span class="town-flag" aria-hidden="true"></span><p class="eyebrow">${L("Deuxième commune", "Second town")}</p>${searchBox(L("Une ville, un code postal", "A town, a postcode"))}${quickPicks(a)}</div>`}
    </div>`;

  if (!b) {
    app.innerHTML = `<section class="page compare">${top}${heads}</section>`;
    bindSearch(app, (c) => (location.hash = `#/comparer/${a.code}/${c}`));
    void fillFlags(app);
    return;
  }

  // tally: where "better" has a direction and both towns have the figure
  const scored = KPIS.filter((k) => k.better).map((k) => {
    const va = k.get(a), vb = k.get(b);
    if (va == null || vb == null || gap(va, vb, k) === "≈") return null;
    return (va > vb) === (k.better === "high") ? "a" : "b";
  }).filter(Boolean);
  const nA = scored.filter((x) => x === "a").length, nB = scored.filter((x) => x === "b").length;
  /** a group is a round: the town ahead on more of its figures takes it */
  function roundWinner(g: string): "a" | "b" | null {
    let x = 0, y = 0;
    for (const k of KPIS.filter((k) => k.group === g && k.better)) {
      const va = k.get(a!), vb = k.get(b!);
      if (va == null || vb == null || gap(va, vb, k) === "≈") continue;
      if ((va > vb) === (k.better === "high")) x++; else y++;
    }
    return x > y ? "a" : y > x ? "b" : null;
  }

  const groups = GROUPS.map(([g, f, e]) => {
    const ks = KPIS.filter((k) => k.group === g && (k.get(a) != null || k.get(b) != null));
    const winners = g === "vote" && (a.muni?.y2026?.winner || b.muni?.y2026?.winner)
      ? `<li class="cmp-row cmp-row-text"><span class="cmp-v a">${winnerCell(a, F)}</span><span></span><span class="cmp-mid-label"><span class="cmp-label">${L("Liste élue", "Winning list")}</span></span><span></span><span class="cmp-v b">${winnerCell(b, F)}</span></li>`
      : "";
    if (!ks.length && !winners) return "";
    const calc = g === "public" && ks.length ? `<li class="cmp-calc"><details id="cmp-calc"><summary>${L("Voir le calcul, pour chaque commune", "See the calculation, for each town")}</summary><div class="cmp-calc-cols"><div><p class="eyebrow">${esc(a.name)}</p>${calcSide(a)}</div><div><p class="eyebrow">${esc(b.name)}</p>${calcSide(b)}</div></div></details></li>` : "";
    return `<section class="cmp-group"><h3>${L(f, e)}${roundWinner(g) ? ` <span class="cmp-round r-${roundWinner(g)}">${L("manche pour", "round to")} ${esc(roundWinner(g) === "a" ? a.name : b.name)}</span>` : ""}</h3><ol class="cmp-rows">${winners}${ks.map((k) => rowHtml(k, a, b)).join("")}${calc}</ol></section>`;
  }).join("");

  const notes: string[] = [];
  if (a.approx.size || b.approx.size) notes.push(L("≈ : moyenne des arrondissements pondérée par la population (l’Insee publie ces chiffres par arrondissement).", "≈: average of the arrondissements weighted by population (INSEE publishes these figures by arrondissement)."));
  if (a.cityWide.size || b.cityWide.size) notes.push(L("* : chiffre de la ville entière (non publié par arrondissement).", "*: figure for the whole city (not published by arrondissement)."));

  app.innerHTML = `<section class="page compare">${top}${heads}
    <div class="cmp-tools">
      ${scored.length ? `<div class="cmp-score" title="${esc(L("Indicateurs où plus haut (revenu, accès aux soins…) ou plus bas (pauvreté, délinquance…) est clairement préférable", "Figures where higher (income, access to care…) or lower (poverty, crime…) is clearly better"))}">
        <span class="a${nA > nB ? " lead" : ""}" title="${esc(a.name)}"><b>${nA}</b>${esc(shortName(a.name, 22))}</span>
        <span class="cmp-score-mid">${L("indicateurs gagnés", "figures won")}<small>${L(`sur ${scored.length}`, `of ${scored.length}`)}</small></span>
        <span class="b${nB > nA ? " lead" : ""}" title="${esc(b.name)}"><b>${nB}</b>${esc(shortName(b.name, 22))}</span></div>` : ""}
      <button type="button" class="home-btn cmp-share">${L("Copier le lien", "Copy link")}</button>
    </div>
    <div class="cmp-legend small"><span class="a">${esc(a.name)}</span><span class="b">${esc(b.name)}</span><span class="muted">${L("En vert la valeur la plus favorable, en rouge la moins favorable, quand l’une l’est clairement ; sans couleur, ni l’une ni l’autre.", "Green: the more favourable value; red: the less favourable one, where one clearly is; no colour, neither.")}</span></div>
    <div class="cmp-body">${groups}</div>
    <p class="muted tiny">${[...notes, L("« — » : chiffre non publié pour cette commune. Sources : Insee (revenus, chômage, recensement 2022), SSMSI (délinquance), ministère de l’Intérieur (police municipale), DGCL et Insee (contributeur ou bénéficiaire, voir la page de la commune), score de qualité de vie : notre moyenne des rangs de la commune en France sur le revenu, la pauvreté, le chômage, la délinquance, l’accès aux généralistes et la fibre, DVF (prix), DREES (accès aux soins), Arcep (fibre), OFGL (dépense), ministère de l’Intérieur (municipales).", "“—”: figure not published for this town. Sources: INSEE (income, jobs, 2022 census), SSMSI (crime), Ministry of the Interior (municipal police), DGCL and INSEE (contributor or beneficiary, see the town page), quality-of-life score: our average of the town's national ranks on income, poverty, unemployment, crime, access to GPs and fibre, DVF (prices), DREES (access to care), Arcep (fibre), OFGL (spending), Ministry of the Interior (municipal elections).")].join(" ")} <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>
    <nav class="doors"><a class="door" href="#/ville/${esc(a.code)}"><b>${esc(a.name)}</b><span class="muted small">${L("La page complète de la commune", "The full town page")}</span></a><a class="door" href="#/ville/${esc(b.code)}"><b>${esc(b.name)}</b><span class="muted small">${L("La page complète de la commune", "The full town page")}</span></a></nav>
  </section>`;

  // each "change town" box replaces its own side
  const [boxA, boxB] = [app.querySelector<HTMLElement>(".cmp-a"), app.querySelector<HTMLElement>(".cmp-b")];
  void fillFlags(app);
  if (boxA) bindSearch(boxA, (c) => (location.hash = `#/comparer/${c}/${b.code}`));
  if (boxB) bindSearch(boxB, (c) => (location.hash = `#/comparer/${a.code}/${c}`));
  // the two balances' labels open the worked calculation
  app.querySelectorAll<HTMLButtonElement>(".cmp-calc-btn").forEach((btn) => btn.addEventListener("click", () => {
    const d = app.querySelector<HTMLDetailsElement>("#cmp-calc");
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  app.querySelectorAll<HTMLDetailsElement>(".cmp-change").forEach((d) => d.addEventListener("toggle", () => { if (d.open) d.querySelector("input")?.focus(); }));
  app.querySelector(".cmp-share")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast(L("Lien copié", "Link copied"), { uniqueID: "cmp-share" }); }
    catch { toast(location.href, { uniqueID: "cmp-share" }); }
  });
}
