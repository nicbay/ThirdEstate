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
  /** figures that are not the town's own: city-wide for an arrondissement, or averaged over arrondissements */
  approx: Set<string>;
  cityWide: Set<string>;
}

const PLM_NAME: Record<string, string> = { "75056": "Paris", "69123": "Lyon", "13055": "Marseille" };

async function loadSide(code: string): Promise<Side | null> {
  const dep = depOf(code);
  const [{ towns }, bundle, info, muni] = await Promise.all([
    loadDepartmentTowns(dep).catch(() => ({ towns: new Map<string, TownData>() })),
    loadTownBundle(dep),
    get(`https://geo.api.gouv.fr/communes/${code}?fields=nom,code,population,departement,surface`),
    get(`/data/municipal/${dep}.json`),
  ]);
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
  const m = muni?.communes?.[code] ?? muni?.communes?.[plmCity(code)];
  if (m && !muni?.communes?.[code]) cityWide.add("vote");
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
    approx,
    cityWide,
  };
}

// ---------- the figures ----------
type Unit = "€" | "%" | "‰" | "pop" | "density" | "€/m²" | "apl" | "per10k";
interface Kpi {
  id: string;
  group: string;
  label: [string, string];
  unit: Unit;
  /** "pts" for rates (difference in points), "rel" for amounts (relative difference) */
  diff: "pts" | "rel";
  /** which way is better, when there is one; drives the green mark only, never the wording */
  better: "high" | "low" | null;
  get: (s: Side) => number | undefined;
  /** tag that marks an approximate or city-wide figure (see Side.approx / Side.cityWide) */
  flag?: string;
  note?: (s: Side) => string | undefined;
}
const GROUPS: [string, string, string][] = [
  ["people", "Habitants", "People"],
  ["money", "Revenus et emploi", "Income and jobs"],
  ["housing", "Logement", "Housing"],
  ["services", "Services", "Services"],
  ["safety", "Sécurité, faits pour 1 000 habitants", "Safety, offences per 1,000 people"],
  ["vote", "Municipales 2026", "2026 municipal elections"],
];
const decisive = (m: Any) => m?.y2026?.rounds?.find((r: Any) => r.round === m.y2026.decidedRound) ?? m?.y2026?.rounds?.at(-1);
const KPIS: Kpi[] = [
  { id: "pop", group: "people", label: ["Population", "Population"], unit: "pop", diff: "rel", better: null, get: (s) => s.pop },
  { id: "density", group: "people", label: ["Densité", "Density"], unit: "density", diff: "rel", better: null, get: (s) => (s.pop && s.area ? s.pop / s.area : undefined) },
  { id: "income", group: "money", label: ["Niveau de vie médian", "Median standard of living"], unit: "€", diff: "rel", better: "high", get: (s) => s.t?.income, flag: "income" },
  { id: "poverty", group: "money", label: ["Taux de pauvreté", "Poverty rate"], unit: "%", diff: "pts", better: "low", get: (s) => s.t?.poverty, flag: "poverty" },
  { id: "unemployment", group: "money", label: ["Chômage (recensement)", "Unemployment (census)"], unit: "%", diff: "pts", better: "low", get: (s) => s.t?.unemployment, flag: "unemployment" },
  { id: "flat", group: "housing", label: ["Prix au m², appartements", "Price per m², flats"], unit: "€/m²", diff: "rel", better: null, get: (s) => s.extra?.prices?.apartment?.median },
  { id: "house", group: "housing", label: ["Prix au m², maisons", "Price per m², houses"], unit: "€/m²", diff: "rel", better: null, get: (s) => s.extra?.prices?.house?.median },
  { id: "apl", group: "services", label: ["Accès aux généralistes", "Access to GPs"], unit: "apl", diff: "rel", better: "high", get: (s) => s.extra?.health?.apl },
  { id: "fibre", group: "services", label: ["Locaux raccordables à la fibre", "Premises with fibre"], unit: "%", diff: "pts", better: "high", get: (s) => s.extra?.broadband?.fibre },
  { id: "spending", group: "services", label: ["Dépense de la commune, par habitant", "Town spending, per inhabitant"], unit: "€", diff: "rel", better: null, get: (s) => s.t?.spending?.[0] },
  { id: "schools", group: "services", label: ["Collèges et lycées, pour 10 000 habitants", "Secondary schools, per 10,000 people"], unit: "per10k", diff: "rel", better: "high", get: (s) => (s.t?.schools.length && s.pop ? (10000 * s.t.schools.length) / s.pop : undefined) },
  ...Object.entries(CRIME_LABELS).map(([k, [fr, en]]): Kpi => ({
    id: `crime-${k}`, group: "safety", label: k === "burglary" ? [`${fr} (pour 1 000 logements)`, `${en} (per 1,000 homes)`] : [fr, en], unit: "‰", diff: "rel", better: "low", get: (s) => s.t?.crime?.[k]?.[1], flag: "crime",
  })),
  { id: "turnout", group: "vote", label: ["Participation", "Turnout"], unit: "%", diff: "pts", better: null, get: (s) => decisive(s.muni)?.turnoutPct, flag: "vote" },
  { id: "winnerShare", group: "vote", label: ["Score de la liste élue", "Winning list’s share"], unit: "%", diff: "pts", better: null, get: (s) => s.muni?.y2026?.winner?.pctExpressed, flag: "vote" },
];

// ---------- formatting ----------
const fr = () => getLang() === "fr";
const dec = (v: number, d = 1) => v.toLocaleString(fr() ? "fr-FR" : "en-GB", { maximumFractionDigits: d });
function fmtVal(v: number | undefined, unit: Unit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "€": return `${fmtNum(Math.round(v))} €`;
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
  const max = has ? Math.max(Math.abs(va!), Math.abs(vb!)) : Math.abs(va ?? vb ?? 0);
  const w = (v?: number) => (v != null && max ? Math.max(2, (100 * Math.abs(v)) / max) : 0);
  const hiSide = has && va !== vb ? (va! > vb! ? "a" : "b") : null;
  const g = has ? gap(va!, vb!, k) : "";
  const winner = hiSide && g !== "≈" && k.better ? (k.better === "high" ? hiSide : hiSide === "a" ? "b" : "a") : null;
  const mark = (s: Side) => (k.flag && s.approx.has(k.flag) ? "≈ " : "");
  const star = (s: Side) => (k.flag && s.cityWide.has(k.flag) ? `<sup title="${esc(L(`Chiffre de ${PLM_NAME[plmCity(s.code)] ?? ""} entier`, `Figure for the whole of ${PLM_NAME[plmCity(s.code)] ?? ""}`))}">*</sup>` : "");
  const hiName = hiSide === "a" ? a.name : b.name;
  return `<li class="cmp-row${winner ? ` win-${winner}` : ""}" data-kpi="${k.id}">
    <div class="cmp-row-head"><span class="cmp-label">${esc(fr() ? k.label[0] : k.label[1])}</span>${
      g && g !== "≈" ? `<span class="cmp-gap gap-${hiSide}" title="${esc(L(`Plus élevé à ${hiName}`, `Higher in ${hiName}`))}"><b>${esc(hiName)}</b> ${g}</span>` : g === "≈" ? `<span class="cmp-gap">${L("à peu près égal", "about the same")}</span>` : ""
    }</div>
    <div class="cmp-row-vals">
      <span class="cmp-v a${hiSide === "a" ? " hi" : ""}">${va == null ? "—" : mark(a) + fmtVal(va, k.unit)}${star(a)}</span>
      <span class="cmp-bars" aria-hidden="true"><i class="a" style="width:${w(va).toFixed(1)}%"></i><i class="b" style="width:${w(vb).toFixed(1)}%"></i></span>
      <span class="cmp-v b${hiSide === "b" ? " hi" : ""}">${vb == null ? "—" : mark(b) + fmtVal(vb, k.unit)}${star(b)}</span>
    </div>
  </li>`;
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
  const [a, b, fams] = await Promise.all([codeA ? loadSide(codeA) : null, codeB ? loadSide(codeB) : null, get("/data/municipal/families.json")]);
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

  const groups = GROUPS.map(([g, f, e]) => {
    const ks = KPIS.filter((k) => k.group === g && (k.get(a) != null || k.get(b) != null));
    const winners = g === "vote" && (a.muni?.y2026?.winner || b.muni?.y2026?.winner)
      ? `<li class="cmp-row cmp-row-text"><div class="cmp-row-head"><span class="cmp-label">${L("Liste élue", "Winning list")}</span></div><div class="cmp-row-vals"><span class="cmp-v a">${winnerCell(a, F)}</span><span></span><span class="cmp-v b">${winnerCell(b, F)}</span></div></li>`
      : "";
    if (!ks.length && !winners) return "";
    return `<section class="cmp-group"><h3>${L(f, e)}</h3><ol class="cmp-rows">${winners}${ks.map((k) => rowHtml(k, a, b)).join("")}</ol></section>`;
  }).join("");

  const notes: string[] = [];
  if (a.approx.size || b.approx.size) notes.push(L("≈ : moyenne des arrondissements pondérée par la population (l’Insee publie ces chiffres par arrondissement).", "≈: average of the arrondissements weighted by population (INSEE publishes these figures by arrondissement)."));
  if (a.cityWide.size || b.cityWide.size) notes.push(L("* : chiffre de la ville entière (non publié par arrondissement).", "*: figure for the whole city (not published by arrondissement)."));

  app.innerHTML = `<section class="page compare">${top}${heads}
    <div class="cmp-tools">
      ${scored.length ? `<p class="cmp-score" title="${esc(L("Indicateurs où plus haut (revenu, accès aux soins…) ou plus bas (pauvreté, délinquance…) est clairement préférable", "Figures where higher (income, access to care…) or lower (poverty, crime…) is clearly better"))}"><span class="a"><b>${nA}</b> ${esc(a.name)}</span><span class="muted small">${L(`plus favorable, sur ${scored.length} indicateurs`, `ahead, out of ${scored.length} figures`)}</span><span class="b"><b>${nB}</b> ${esc(b.name)}</span></p>` : ""}
      <button type="button" class="home-btn cmp-share">${L("Copier le lien", "Copy link")}</button>
    </div>
    <div class="cmp-legend small"><span class="a">${esc(a.name)}</span><span class="b">${esc(b.name)}</span><span class="muted">${L("En vert : la valeur la plus favorable, quand il y en a une.", "In green: the more favourable value, where there is one.")}</span></div>
    <div class="cmp-body">${groups}</div>
    <p class="muted tiny">${[...notes, L("« — » : chiffre non publié pour cette commune. Sources : Insee (revenus, chômage), SSMSI (délinquance), DVF (prix), DREES (accès aux soins), Arcep (fibre), OFGL (dépense), ministère de l’Intérieur (municipales).", "“—”: figure not published for this town. Sources: INSEE (income, jobs), SSMSI (crime), DVF (prices), DREES (access to care), Arcep (fibre), OFGL (spending), Ministry of the Interior (municipal elections).")].join(" ")} <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>
    <nav class="doors"><a class="door" href="#/ville/${esc(a.code)}"><b>${esc(a.name)}</b><span class="muted small">${L("La page complète de la commune", "The full town page")}</span></a><a class="door" href="#/ville/${esc(b.code)}"><b>${esc(b.name)}</b><span class="muted small">${L("La page complète de la commune", "The full town page")}</span></a></nav>
  </section>`;

  // each "change town" box replaces its own side
  const [boxA, boxB] = [app.querySelector<HTMLElement>(".cmp-a"), app.querySelector<HTMLElement>(".cmp-b")];
  void fillFlags(app);
  if (boxA) bindSearch(boxA, (c) => (location.hash = `#/comparer/${c}/${b.code}`));
  if (boxB) bindSearch(boxB, (c) => (location.hash = `#/comparer/${a.code}/${c}`));
  app.querySelectorAll<HTMLDetailsElement>(".cmp-change").forEach((d) => d.addEventListener("toggle", () => { if (d.open) d.querySelector("input")?.focus(); }));
  app.querySelector(".cmp-share")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast(L("Lien copié", "Link copied"), { uniqueID: "cmp-share" }); }
    catch { toast(location.href, { uniqueID: "cmp-share" }); }
  });
}
