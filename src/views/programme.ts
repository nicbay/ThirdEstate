// Campaign programme over time: every measure of a candidate's programme across its versions
// (e.g. 2022 abridged booklet → 2025 full edition → 2027 online book), what was kept, reworded,
// added or dropped, and how the candidate's Assembly group voted on matching texts since 2024.
// Data: public/data/programmes/<slug>.json, built by scripts/build-programme.mjs. Generic over slug.
// Tone: descriptive only. Status chips use neutral ink/grey styles; colour is kept for vote positions.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, fmtPct } from "../i18n";
import { esc, safeUrl } from "../util";

type VersionId = "a22" | "e25" | "w27" | string;
type Status = "maintained" | "modified" | "new2025" | "new2027" | "dropped";
interface Measure { id: string; t: string; s: number; p?: number; k?: 1; f?: string[] }
interface Change { from: number; to: number; kinds: string[]; before: string[]; after: string[] }
interface Lineage { id: string; theme: string; status: Status; droppedIn?: number; changed?: 1; key?: 1; a?: Measure; e?: Measure; w?: Measure; changes?: Change[] }
interface Version { id: VersionId; year: number; label: { fr: string; en: string }; title: string; date: string; kind: string; url?: string; count: number; key: number; financing?: { page: number; fr: string; en: string } }
interface VoteItem { num: number; date: string; title: string; result: string; total: { P: number; C: number; A: number }; group: { P: number; C: number; A: number }; majority: "P" | "C" | "A" | null; expect: "P" | "C"; agrees: boolean | null }
interface VoteLink { lineage: string; topic: { fr: string; en: string }; note: { fr: string; en: string } | null; scrutins: VoteItem[] }
type Counts = Record<Status, number>;
interface CostLine { by: string; spending: number; revenue: number; net: number; date: string; note: { fr: string; en: string }; url: string }
interface CostRound { id: string; year: number; label: { fr: string; en: string }; horizon: { fr: string; en: string }; announced: CostLine; estimates: CostLine[] }
interface ProgrammeFile {
  slug: string; candidate: string; party: string; programme: string; group: string; generatedAt: string;
  themes: { id: string; fr: string; en: string }[];
  versions: Version[];
  sections: Record<string, [string | null, string, string | null, string | null][]>;
  summary: { overall: Counts & { total: number; changed: number }; byTheme: Record<string, Counts> };
  highlights: { lineage: string; kind: string; fr: string; en: string }[];
  costing?: { rounds: CostRound[]; checked: string };
  votes: VoteLink[];
  themeWeights: { programme: Record<string, Record<string, number>>; speeches: Record<string, number> | null; chamber: Record<string, number> | null; speechesPeriod: { from: string; to: string } | null; speechesCount: number | null };
  lineages: Lineage[];
}

const cache = new Map<string, Promise<ProgrammeFile>>();
const load = (slug: string) => {
  if (!cache.has(slug)) cache.set(slug, fetchJson<ProgrammeFile>(`/data/programmes/${slug}.json`));
  return cache.get(slug)!;
};

const STATUSES: Status[] = ["maintained", "modified", "new2025", "new2027", "dropped"];
const statusLabel = (s: Status, short = false): string =>
  ({
    maintained: L("Maintenue", "Kept"),
    modified: L("Modifiée", "Changed"),
    new2025: short ? L("Apparue en 2025", "Added 2025") : L("Apparue en 2025", "Added in 2025"),
    new2027: short ? L("Nouvelle en 2027", "New 2027") : L("Nouvelle en 2027", "New in 2027"),
    dropped: L("Abandonnée", "Dropped"),
  })[s];
const statusHelp = (s: Status): string =>
  ({
    maintained: L("présente en 2022 et en 2027, même engagement et mêmes chiffres", "in 2022 and 2027, same commitment and figures"),
    modified: L("présente en 2022 et en 2027, chiffre ou formulation modifiés", "in 2022 and 2027, figure or wording changed"),
    new2025: L("absente de l’abrégé 2022, présente dans l’édition 2025 et en 2027", "not in the 2022 booklet, in the 2025 edition and in 2027"),
    new2027: L("présente seulement dans le programme 2027", "only in the 2027 programme"),
    dropped: L("absente du programme 2027", "not in the 2027 programme"),
  })[s];
const POS = { P: () => L("Pour", "For"), C: () => L("Contre", "Against"), A: () => L("Abstention", "Abstain") };

/** Word-level diff (LCS) of two wordings: returns the newer one with insertions marked and the older with deletions. */
function diff(a: string, b: string): [string, string] {
  const A = a.split(/\s+/), B = b.split(/\s+/);
  if (A.length * B.length > 40000) return [esc(a), esc(b)];
  const key = (w: string) => w.toLowerCase().replace(/[.,;:!?()«»"]/g, "");
  const n = A.length, m = B.length;
  const T: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = key(A[i]) === key(B[j]) ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const outA: string[] = [], outB: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(A[i]) === key(B[j])) { outA.push(esc(A[i])); outB.push(esc(B[j])); i++; j++; }
    else if (j < m && (i >= n || T[i][j + 1] >= T[i + 1][j])) { outB.push(`<ins>${esc(B[j])}</ins>`); j++; }
    else { outA.push(`<del>${esc(A[i])}</del>`); i++; }
  }
  const join = (xs: string[], tag: string) => xs.join(" ").replace(new RegExp(`</${tag}> <${tag}>`, "g"), " ");
  return [join(outA, "del"), join(outB, "ins")];
}

// Branches of the flow view: where each commitment went between the versions.
type BranchId = "kept" | "changed" | "drop22" | "add25" | "drop25" | "new27";
const BRANCH: Record<BranchId, (l: Lineage) => boolean> = {
  kept: (l) => l.status === "maintained",
  changed: (l) => l.status === "modified",
  drop22: (l) => l.status === "dropped" && !!l.a,
  add25: (l) => l.status === "new2025",
  drop25: (l) => l.status === "dropped" && !l.a,
  new27: (l) => l.status === "new2027",
};
const branchLabel = (b: BranchId) => ({
  kept: L("Gardées telles quelles", "Kept as is"),
  changed: L("Modifiées", "Changed"),
  drop22: L("Retirées", "Dropped"),
  add25: L("Ajoutées, gardées en 2027", "Added, kept in 2027"),
  drop25: L("Ajoutées, retirées en 2027", "Added, dropped in 2027"),
  new27: L("Nouvelles en 2027", "New in 2027"),
})[b];
const branchHelp = (b: BranchId) => ({
  kept: L("Dans l’abrégé 2022 et en 2027, même engagement, mêmes chiffres.", "In the 2022 booklet and in 2027, same commitment, same figures."),
  changed: L("Dans l’abrégé 2022 et en 2027, mais un chiffre ou la formulation a changé.", "In the 2022 booklet and in 2027, but a figure or the wording changed."),
  drop22: L("Dans l’abrégé 2022, plus dans le programme 2027 (retirées dès 2025 ou en 2027).", "In the 2022 booklet, no longer in the 2027 programme (dropped in 2025 or in 2027)."),
  add25: L("Absentes de l’abrégé 2022, ajoutées dans l’édition 2025, toujours là en 2027.", "Not in the 2022 booklet, added in the 2025 edition, still there in 2027."),
  drop25: L("Ajoutées dans l’édition 2025, plus dans le programme 2027.", "Added in the 2025 edition, no longer in the 2027 programme."),
  new27: L("Sans équivalent dans les versions précédentes : n’apparaissent qu’en 2027.", "No match in earlier versions: only in 2027."),
})[b];
const BRANCH_STATUS: Record<BranchId, Status> = { kept: "maintained", changed: "modified", drop22: "dropped", add25: "new2025", drop25: "dropped", new27: "new2027" };

interface State { q: string; theme: string; status: Status | ""; branch: BranchId | ""; key: boolean; votes: boolean; shown: number; focus: string | null; flowTheme: string; flowPick: BranchId }
const state: State = { q: "", theme: "", status: "", branch: "", key: false, votes: false, shown: 30, focus: null, flowTheme: "", flowPick: "drop22" };
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// ---------- flow view: a node graph (source versions → switches → branches → 2027 / dropped) ----------
interface FlowNode { id: string; x: number; y: number; w: number; h: number; kind: "source" | "switch" | "branch" | "sink"; icon: string; title: string; sub: string; branch?: BranchId; drop?: boolean }
function flowSvg(f: ProgrammeFile, ls: Lineage[], pick: BranchId | "") {
  const n = Object.fromEntries((Object.keys(BRANCH) as BranchId[]).map((b) => [b, ls.filter(BRANCH[b]).length])) as Record<BranchId, number>;
  const inA = ls.filter((l) => l.a).length, inE = ls.filter((l) => l.e).length, newE = ls.filter((l) => l.e && !l.a).length, inW = ls.filter((l) => l.w).length;
  const [va, ve, vw] = f.versions;
  const items = (k: number) => `${fmtNum(k)} ${k > 1 ? L("mesures", "measures") : L("mesure", "measure")}`;
  const N: FlowNode[] = [
    { id: "s22", x: 10, y: 92, w: 168, h: 64, kind: "source", icon: "22", title: L("Abrégé 2022", "2022 booklet"), sub: items(inA) },
    { id: "s25", x: 10, y: 292, w: 168, h: 64, kind: "source", icon: "25", title: L("Édition 2025", "2025 edition"), sub: items(inE) },
    { id: "s27", x: 10, y: 432, w: 168, h: 64, kind: "source", icon: "27", title: L("Site 2027", "2027 website"), sub: L("textes nouveaux", "new texts") },
    { id: "if22", x: 226, y: 96, w: 150, h: 56, kind: "switch", icon: "?", title: L("Toujours en 2027 ?", "Still in 2027?"), sub: L("aiguillage", "switch") },
    { id: "if25", x: 226, y: 296, w: 150, h: 56, kind: "switch", icon: "?", title: L("Toujours en 2027 ?", "Still in 2027?"), sub: L("aiguillage", "switch") },
    { id: "kept", x: 424, y: 14, w: 214, h: 58, kind: "branch", icon: "=", title: branchLabel("kept"), sub: items(n.kept), branch: "kept" },
    { id: "changed", x: 424, y: 94, w: 214, h: 58, kind: "branch", icon: "≠", title: branchLabel("changed"), sub: items(n.changed), branch: "changed" },
    { id: "drop22", x: 424, y: 174, w: 214, h: 58, kind: "branch", icon: "−", title: branchLabel("drop22"), sub: items(n.drop22), branch: "drop22", drop: true },
    { id: "add25", x: 424, y: 264, w: 214, h: 58, kind: "branch", icon: "+", title: branchLabel("add25"), sub: items(n.add25), branch: "add25" },
    { id: "drop25", x: 424, y: 344, w: 214, h: 58, kind: "branch", icon: "−", title: branchLabel("drop25"), sub: items(n.drop25), branch: "drop25", drop: true },
    { id: "new27", x: 424, y: 434, w: 214, h: 58, kind: "branch", icon: "★", title: branchLabel("new27"), sub: items(n.new27), branch: "new27" },
    { id: "w27", x: 712, y: 150, w: 186, h: 70, kind: "sink", icon: "✓", title: L("Programme 2027", "2027 programme"), sub: items(inW) },
    { id: "gone", x: 712, y: 300, w: 186, h: 70, kind: "sink", icon: "×", title: L("Abandonnées", "Dropped"), sub: items(n.drop22 + n.drop25), drop: true },
  ];
  const byId = Object.fromEntries(N.map((x) => [x.id, x]));
  const E: [string, string, number][] = [
    ["s22", "if22", inA], ["if22", "kept", n.kept], ["if22", "changed", n.changed], ["if22", "drop22", n.drop22],
    ["s25", "if25", newE], ["if25", "add25", n.add25], ["if25", "drop25", n.drop25],
    ["s27", "new27", n.new27],
    ["kept", "w27", n.kept], ["changed", "w27", n.changed], ["add25", "w27", n.add25], ["new27", "w27", n.new27],
    ["drop22", "gone", n.drop22], ["drop25", "gone", n.drop25],
  ];
  const max = Math.max(1, ...E.map((e) => e[2]));
  const edges = E.map(([a, b, k], i) => {
    const A = byId[a], B = byId[b];
    const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, dx = Math.max(30, (x2 - x1) / 2);
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    const w = k ? 1.6 + 9 * Math.sqrt(k / max) : 1;
    const drop = !!(B.drop || A.drop);
    const on = pick && (A.branch === pick || B.branch === pick);
    const dots = k ? Array.from({ length: Math.min(3, 1 + Math.floor(Math.log10(k + 1))) }, (_, j) => `<circle class="flow-dot" r="${Math.min(4, 1.6 + w / 4).toFixed(1)}"><animateMotion dur="${(2.6 + (i % 3) * 0.4).toFixed(1)}s" begin="${(j * 0.9).toFixed(1)}s" repeatCount="indefinite" path="${d}"/></circle>`).join("") : "";
    const t = B.kind === "sink" ? 0.28 : 0.5, u = 1 - t; // labels on edges into a sink sit early, away from where they converge
    const mx = u * u * u * x1 + 3 * u * u * t * (x1 + dx) + 3 * u * t * t * (x2 - dx) + t * t * t * x2;
    const my = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
    return `<g class="flow-edge${drop ? " is-drop" : ""}${on ? " is-on" : ""}${k ? "" : " is-empty"}">
      <path d="${d}" style="stroke-width:${w.toFixed(1)}"/>${dots}
      <g class="flow-elabel" transform="translate(${mx.toFixed(0)},${my.toFixed(0)})"><rect x="-21" y="-9" width="42" height="18" rx="9"/><text y="4">${fmtNum(k)}</text></g></g>`;
  }).join("");
  const nodes = N.map((x) => {
    const btn = x.branch ? ` role="button" tabindex="0" data-branch="${x.branch}" aria-pressed="${pick === x.branch}" aria-label="${esc(`${x.title}, ${x.sub}`)}"` : "";
    const ports = `${x.kind !== "source" ? `<circle class="flow-port" cx="0" cy="${x.h / 2}" r="4.5"/>` : ""}${x.kind !== "sink" ? `<circle class="flow-port" cx="${x.w}" cy="${x.h / 2}" r="4.5"/>` : ""}`;
    const tile = x.kind === "switch" ? 0 : 44;
    return `<g class="flow-node is-${x.kind}${x.drop ? " is-drop" : ""}${pick && x.branch === pick ? " is-on" : ""}" transform="translate(${x.x},${x.y})"${btn}>
      <rect class="flow-box" width="${x.w}" height="${x.h}" rx="${x.kind === "switch" ? 28 : 10}"/>
      ${tile ? `<rect class="flow-tile" x="10" y="${(x.h - 34) / 2}" width="34" height="34" rx="7"/><text class="flow-icon" x="27" y="${x.h / 2 + 6}">${esc(x.icon)}</text>` : `<text class="flow-icon is-q" x="22" y="${x.h / 2 + 6}">?</text>`}
      <text class="flow-title" x="${tile ? 54 : 38}" y="${x.h / 2 - 3}">${esc(x.title)}</text>
      <text class="flow-sub" x="${tile ? 54 : 38}" y="${x.h / 2 + 14}">${esc(x.sub)}</text>
      ${ports}</g>`;
  }).join("");
  const label = L(`Flux des engagements : ${inA} dans l’abrégé 2022 (${va.year}), ${inE} dans l’édition ${ve.year}, ${inW} dans le programme ${vw.year}.`, `Flow of commitments: ${inA} in the 2022 booklet, ${inE} in the ${ve.year} edition, ${inW} in the ${vw.year} programme.`);
  return `<svg class="flow-svg" viewBox="0 0 910 510" role="group" aria-label="${esc(label)}">${edges}${nodes}</svg>`;
}

function costCard(f: ProgrammeFile) {
  const c = f.costing;
  if (!c?.rounds.length) return "";
  const nets = c.rounds.flatMap((r) => [r.announced.net, ...r.estimates.map((e) => e.net)]);
  const lo = Math.min(-20, ...nets), hi = Math.max(40, ...nets), span = hi - lo;
  const pos = (v: number) => (100 * (v - lo)) / span;
  const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; return L(`${sg}${fmtNum(Math.abs(v))} Md€`, `${sg}€${fmtNum(Math.abs(v))}bn`); };
  const bar = (e: CostLine, kind: "ann" | "est") => {
    const a = pos(Math.min(0, e.net)), b = pos(Math.max(0, e.net));
    return `<div class="cost-row is-${kind}">
      <span class="cost-who">${kind === "ann" ? L("Annoncé", "Announced") : L("Estimé", "Estimated")} · <a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">${esc(e.by)}</a></span>
      <span class="cost-track"><i class="cost-zero" style="left:${pos(0).toFixed(1)}%"></i><i class="cost-bar${e.net < 0 ? " is-neg" : ""}" style="left:${a.toFixed(1)}%;width:${Math.max(0.6, b - a).toFixed(1)}%"></i></span>
      <b class="cost-net${e.net < 0 ? " is-neg" : ""}">${md(e.net)}</b>
      <span class="cost-detail muted small">${L("dépenses", "spending")} ${md(e.spending).replace("+", "")} · ${L("recettes", "revenue")} ${md(e.revenue).replace("+", "")} — ${esc(L(e.note.fr, e.note.en))}</span>
    </div>`;
  };
  const [r22, r24, r27] = [c.rounds.find((r) => r.year === 2022), c.rounds.find((r) => r.year === 2024), c.rounds.find((r) => r.year === 2027)];
  const m22 = r22?.estimates[0];
  const gap22 = r22 && m22 ? r22.announced.net - m22.net : null;
  const ests = c.rounds.flatMap((r) => r.estimates.map((e) => e.net));
  const verdict = r22 && m22 && r24 && r27 && gap22 != null ? `
    <div class="cost-verdict">
      <p class="eyebrow">${L("Conclusion", "Conclusion")}</p>
      <p><b>${L(
        `Chaque fois qu’un chiffrage indépendant existe, il trouve un trou que le parti n’annonce pas : ${fmtNum(-Math.max(...ests))} à ${fmtNum(-Math.min(...ests))} Md€ de déficit en plus par an, soit 5,5 à 7 points de PIB, là où LFI et le NFP annonçaient l’équilibre ou un excédent.`,
        `Every time an independent costing exists, it finds a gap the party does not announce: €${fmtNum(-Math.max(...ests))}bn to €${fmtNum(-Math.min(...ests))}bn a year of extra deficit, 5.5 to 7 points of GDP, where LFI and the NFP announced balance or a surplus.`)}</b></p>
      <p>${L(
        `L’écart vient surtout des recettes. En 2022, l’Institut Montaigne retient ${fmtNum(m22.revenue)} Md€ de recettes sur les ${fmtNum(r22.announced.revenue)} annoncés : il ne compte ni la lutte contre la fraude ni le surplus de croissance attendu par LFI. Il chiffre aussi les dépenses plus haut (${fmtNum(m22.spending)} Md€ contre ${fmtNum(r22.announced.spending)}). Montaigne précise que l’effet de relance pourrait réduire la hausse du déficit de 30 à 50 % : même dans ce cas, il resterait 110 à 150 Md€ par an non financés.`,
        `The gap is mostly about revenue. In 2022 Institut Montaigne counted €${fmtNum(m22.revenue)}bn of revenue out of the €${fmtNum(r22.announced.revenue)}bn announced: it counts neither the anti-fraud receipts nor the extra growth LFI expects. It also prices spending higher (€${fmtNum(m22.spending)}bn against ${fmtNum(r22.announced.spending)}). Montaigne notes the stimulus effect could cut the deficit increase by 30 to 50%: even then, €110–150bn a year would remain unfunded.`)}</p>
      <p>${L(
        `Le premier budget annoncé pour 2027 (${fmtNum(r27.announced.spending)} Md€ de dépenses nouvelles, ${fmtNum(r27.announced.revenue)} Md€ de recettes) est trois fois plus petit que le chiffrage de 2022, mais il ne couvre que la première année et une partie des mesures : le retour à 62 ans y coûte 9 Md€, alors que le programme 2027 vise toujours la retraite à 60 ans, que l’iFRAP chiffrait à 50 Md€ par an en 2024. Le chiffrage complet est annoncé pour début 2027 ; aucune évaluation indépendante n’existe encore. Rien ne permet donc de dire, à ce stade, que l’écart des deux campagnes précédentes s’est refermé.`,
        `The first budget announced for 2027 (€${fmtNum(r27.announced.spending)}bn of new spending, €${fmtNum(r27.announced.revenue)}bn of revenue) is a third the size of the 2022 costing, but covers only the first year and part of the measures: going back to 62 costs €9bn in it, while the 2027 programme still aims for retirement at 60, which iFRAP put at €50bn a year in 2024. The full costing is due in early 2027; no independent assessment exists yet. Nothing so far shows that the gap of the last two campaigns has closed.`)}</p>
    </div>` : "";
  return `<article class="card" id="cout">
    <header class="card-head"><h2>${L("Ce que coûte le programme : l’annonce et les estimations", "What the programme costs: the claim and the estimates")}</h2></header>
    <p class="prog-lede">${L("Solde des mesures pour les finances publiques, en milliards d’euros par an : à droite du zéro, les recettes nouvelles dépassent les dépenses nouvelles ; à gauche, le programme creuse le déficit.", "Balance of the measures for public finances, in billions of euros a year: right of zero, new revenue exceeds new spending; left of zero, the programme widens the deficit.")}</p>
    ${c.rounds.map((r) => `<section class="cost-round">
      <h3>${esc(L(r.label.fr, r.label.en))} <span class="muted small">· ${esc(L(r.horizon.fr, r.horizon.en))}</span></h3>
      ${bar(r.announced, "ann")}
      ${r.estimates.map((e) => bar(e, "est")).join("") || `<p class="cost-none muted small">${L("Pas encore d’estimation indépendante : le chiffrage complet est annoncé pour début 2027.", "No independent estimate yet: the full costing is due in early 2027.")}</p>`}
    </section>`).join("")}
    ${verdict}
    <p class="muted small">${L(`Estimations « statiques » : effets directs des mesures, sans effet sur la croissance. Les auteurs n’utilisent pas la même trajectoire de référence, d’où des écarts entre eux. Le NFP de 2024 était une coalition ; son programme n’est pas celui de LFI seule. Sources vérifiées le ${fmtDate(c.checked)}.`, `‘Static’ estimates: direct effects of the measures, no growth feedback. The authors use different baselines, hence differences between them. The 2024 NFP was a coalition; its programme is not LFI’s alone. Sources checked on ${fmtDate(c.checked)}.`)}</p>
  </article>`;
}

export async function renderProgramme(app: HTMLElement, slug: string) {
  const f = await load(slug).catch(() => null);
  if (!f) {
    app.innerHTML = `<section class="page"><div class="page-head"><h1>${L("Programme introuvable", "Programme not found")}</h1><p class="dek">${L("Aucune analyse de programme n’est disponible pour ce candidat pour l’instant.", "No programme analysis is available for this candidate yet.")}</p></div></section>`;
    return;
  }
  const V = Object.fromEntries(f.versions.map((v) => [v.id, v])) as Record<string, Version>;
  const [va, ve, vw] = [f.versions[0], f.versions[1], f.versions[2]];
  const themeName = (id: string) => { const t = f.themes.find((x) => x.id === id); return t ? L(t.fr, t.en) : id; };
  const byId = new Map(f.lineages.map((l) => [l.id, l]));
  const votesBy = new Map(f.votes.map((v) => [v.lineage, v]));
  const o = f.summary.overall;
  const latest = (l: Lineage) => (l.w ?? l.e ?? l.a)!;
  const loc = (vid: string, m: Measure) => {
    const sec = f.sections[vid]?.[m.s];
    const where = [sec?.[0], sec?.[1], sec?.[2]].filter(Boolean).map((x) => esc(x)).join(" › ");
    const ref = sec?.[3]
      ? `<a href="${esc(safeUrl(sec[3]))}" target="_blank" rel="noopener">${L("lire en ligne", "read online")}</a>`
      : m.p ? `p. ${m.p}` : "";
    return `<span class="prog-loc">${where}${ref ? ` · ${ref}` : ""}</span>`;
  };

  const tag = (s: Status) => `<span class="prog-chip prog-${s}">${esc(statusLabel(s, true))}</span>`;
  const swatch = (s: Status) => `<i class="prog-sw prog-${s}" aria-hidden="true"></i>`;

  // ---------- stacked bars by theme ----------
  const themeRows = f.themes
    .map((t) => ({ t, c: f.summary.byTheme[t.id], n: STATUSES.reduce((s, k) => s + (f.summary.byTheme[t.id]?.[k] ?? 0), 0) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxN = Math.max(...themeRows.map((r) => r.n));
  const stack = (c: Counts, n: number, scale: number) =>
    `<div class="prog-stack" style="width:${((100 * n) / scale).toFixed(2)}%">${STATUSES.filter((s) => c[s]).map((s) => `<span class="prog-${s}" style="flex:${c[s]}" title="${esc(statusLabel(s))} : ${c[s]}"></span>`).join("")}</div>`;
  const legend = `<ul class="prog-legend">${STATUSES.map((s) => `<li>${swatch(s)}<b>${esc(statusLabel(s))}</b> <span class="muted">${fmtNum(o[s])}</span><br><span class="muted small">${esc(statusHelp(s))}</span></li>`).join("")}</ul>`;

  // ---------- programme weight vs speeches ----------
  const tw = f.themeWeights;
  const progShare = tw.programme[vw.id] ?? {};
  const weightRows = f.themes
    .map((t) => ({ t, p: progShare[t.id] ?? 0, s: tw.speeches?.[t.id] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const wMax = Math.max(...weightRows.flatMap((r) => [r.p, r.s]), 0.01);

  const voteRows = (v: VoteLink) => v.scrutins.map((s) => {
    const g = s.group, cast = g.P + g.C + g.A;
    const verdict = s.majority == null
      ? `<span class="prog-verdict prog-none">${L("Aucun vote du groupe enregistré", "No group vote recorded")}</span>`
      : s.agrees
      ? `<span class="prog-verdict prog-yes">${L("Dans le sens de la promesse", "In line with the promise")}</span>`
      : `<span class="prog-verdict prog-no">${L("Pas dans le sens de la promesse", "Not in line with the promise")}</span>`;
    return `<tr>
      <td class="nowrap">${fmtDate(s.date)}</td>
      <td><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${s.num}" target="_blank" rel="noopener">n° ${s.num}</a> · ${esc(s.title.replace(/^./, (c) => c.toUpperCase()))} <span class="muted small">(${esc(s.result)}, ${s.total.P}–${s.total.C}–${s.total.A})</span></td>
      <td class="nowrap">${cast ? `<span class="pos-P">${g.P}</span> / <span class="pos-C">${g.C}</span> / <span class="pos-A">${g.A}</span>` : "—"}${s.majority ? `<br><b class="pos-${s.majority}">${POS[s.majority]()}</b>` : ""}</td>
      <td class="nowrap">${POS[s.expect]()}</td>
      <td>${verdict}</td></tr>`;
  }).join("");
  const nVoteScrutins = f.votes.reduce((s, v) => s + v.scrutins.length, 0);
  const nAgree = f.votes.reduce((s, v) => s + v.scrutins.filter((x) => x.agrees === true).length, 0);
  const nDisagree = f.votes.reduce((s, v) => s + v.scrutins.filter((x) => x.agrees === false).length, 0);
  const nInW = f.lineages.filter((l) => l.w).length;

  app.innerHTML = `
    <section class="page prog">
      <div class="page-head">
        <p class="eyebrow">${L("Programmes 2027", "2027 programmes")} · ${esc(f.candidate)} · ${esc(f.party)}</p>
        <h1>${L(`${f.programme}, de 2022 à 2027 : ce qui reste, ce qui change`, `${f.programme} from 2022 to 2027: what stays, what changes`)}</h1>
        <p class="dek">${L(
          `${fmtNum(f.lineages.length)} engagements suivis à travers trois versions du programme : l’abrégé de 2022 (${va.count} mesures), l’édition complète de 2025 (${ve.count}) et le programme 2027 en ligne (${vw.count}). ${fmtNum(o.maintained + o.modified)} figuraient déjà dans l’abrégé de 2022, ${fmtNum(o.new2027)} n’apparaissent qu’en 2027, ${fmtNum(o.dropped)} ne figurent plus dans la version 2027.`,
          `${fmtNum(f.lineages.length)} commitments tracked across three versions of the programme: the 2022 abridged booklet (${va.count} measures), the full 2025 edition (${ve.count}) and the online 2027 programme (${vw.count}). ${fmtNum(o.maintained + o.modified)} were already in the 2022 booklet, ${fmtNum(o.new2027)} appear only in 2027, ${fmtNum(o.dropped)} are no longer in the 2027 version.`)}</p>
        <nav class="prog-jump" aria-label="${L("Sur cette page", "On this page")}">
          <a href="#/programmes/${esc(f.slug)}#parcours">${L("Le parcours des mesures", "Where measures went")}</a>
          ${f.costing ? `<a href="#/programmes/${esc(f.slug)}#cout">${L("Le coût annoncé et estimé", "Claimed vs estimated cost")}</a>` : ""}
          <a href="#/programmes/${esc(f.slug)}#mesures">${L("Toutes les mesures", "Every measure")}</a>
          <a href="#/programmes/${esc(f.slug)}#assemblee">${L("Les votes à l’Assemblée", "Assembly votes")}</a>
        </nav>
      </div>

      <article class="card flow-card" id="parcours">
        <header class="card-head"><h2>${L("Le parcours des mesures, de 2022 à 2027", "Where the measures went, 2022 to 2027")}</h2></header>
        <p class="prog-lede">${L("Chaque version du programme entre à gauche ; chaque mesure suit une branche : gardée, modifiée, ajoutée ou abandonnée. L’épaisseur d’un lien est proportionnelle au nombre de mesures. Cliquez une branche pour voir ses mesures.", "Each version of the programme enters on the left; each measure follows a branch: kept, changed, added or dropped. A link’s thickness is proportional to the number of measures. Click a branch to see its measures.")}</p>
        <div class="flow-tools">
          <label>${L("Thème", "Theme")} <select id="ft"><option value="">${L("Tous les thèmes", "All themes")}</option>${themeRows.map((r) => `<option value="${esc(r.t.id)}" ${state.flowTheme === r.t.id ? "selected" : ""}>${esc(L(r.t.fr, r.t.en))}</option>`).join("")}</select></label>
          <span class="muted small flow-hint">${L("Faites glisser pour voir tout le schéma", "Swipe to see the whole diagram")}</span>
        </div>
        <div class="flow-canvas" id="fcanvas"></div>
        <div class="flow-detail" id="fdetail" aria-live="polite"></div>
      </article>

      <article class="card">
        <header class="card-head"><h2>${L("Le programme, thème par thème", "The programme, theme by theme")}</h2></header>
        <div class="kpis kpis-4 prog-kpis">
          <div><strong>${fmtNum(o.maintained)}</strong>${esc(statusLabel("maintained"))}</div>
          <div><strong>${fmtNum(o.modified)}</strong>${esc(statusLabel("modified"))}</div>
          <div><strong>${fmtNum(o.new2025 + o.new2027)}</strong>${L("Ajoutées (2025 + 2027)", "Added (2025 + 2027)")}</div>
          <div><strong>${fmtNum(o.dropped)}</strong>${esc(statusLabel("dropped"))}</div>
        </div>
        ${legend}
        <div class="prog-bars" role="img" aria-label="${L("Nombre d’engagements par thème et par statut", "Commitments by theme and status")}">
          ${themeRows.map((r) => `<button type="button" class="prog-row" data-theme="${esc(r.t.id)}" title="${L("Filtrer la liste sur ce thème", "Filter the list to this theme")}">
            <span class="prog-row-label">${esc(L(r.t.fr, r.t.en))} <b>${r.n}</b></span>${stack(r.c, r.n, maxN)}</button>`).join("")}
        </div>
        <p class="muted small">${L(`Un engagement = une mesure suivie d’une version à l’autre (les mesures rapprochées par similarité de texte, puis relues). Thème : celui de la dernière version. « Apparue en 2025 » signifie absente de l’abrégé de 2022, qui ne reprend qu’une partie du programme complet de 2022.`, `One commitment = one measure followed from version to version (matched by text similarity, then reviewed). Theme: that of the latest version. ‘Added in 2025’ means absent from the 2022 booklet, which only covers part of the full 2022 programme.`)}</p>
      </article>

      <article class="card">
        <header class="card-head"><h2>${L("Les changements les plus nets", "The biggest changes")}</h2></header>
        <ol class="prog-highlights">${f.highlights.map((h) => `<li><span class="tag">${esc(({ figure: L("chiffre", "figure"), new: L("nouveau", "new"), dropped: L("retiré", "dropped"), wording: L("formulation", "wording") } as Record<string, string>)[h.kind] ?? h.kind)}</span> ${esc(L(h.fr, h.en))} <button type="button" class="linkish prog-goto" data-id="${esc(h.lineage)}">${L("voir les textes", "see the texts")}</button></li>`).join("")}</ol>
        ${va.financing && !f.costing ? `<p class="muted small">${L(`Chiffrage d’ensemble de 2022 (abrégé, p. ${va.financing.page}) : ${esc(va.financing.fr)}. Les éditions 2025 et 2027 étudiées ici ne donnent pas de chiffrage global équivalent.`, `Overall 2022 costing (booklet, p. ${va.financing.page}): ${esc(va.financing.en)}. The 2025 and 2027 editions studied here give no equivalent overall costing.`)}</p>` : ""}
      </article>

      ${costCard(f)}

      <article class="card" id="mesures">
        <header class="card-head"><h2>${L("Toutes les mesures, version par version", "Every measure, version by version")}</h2></header>
        <div class="filters prog-filters">
          <input id="pq" type="search" placeholder="${L("Rechercher un mot : SMIC, retraite, nucléaire…", "Search a word: SMIC, retraite, nucléaire…")}" value="${esc(state.q)}" aria-label="${L("Rechercher dans les mesures", "Search the measures")}" />
          <select id="pt" aria-label="${L("Thème", "Theme")}"><option value="">${L("Tous les thèmes", "All themes")}</option>${themeRows.map((r) => `<option value="${esc(r.t.id)}" ${state.theme === r.t.id ? "selected" : ""}>${esc(L(r.t.fr, r.t.en))} (${r.n})</option>`).join("")}</select>
          <label class="check"><input id="pk" type="checkbox" ${state.key ? "checked" : ""}/> ${L("Mesures clés", "Key measures")}</label>
          <label class="check"><input id="pv" type="checkbox" ${state.votes ? "checked" : ""}/> ${L("Avec un vote à l’Assemblée", "With an Assembly vote")}</label>
        </div>
        <div class="prog-status" role="group" aria-label="${L("Statut", "Status")}">
          <button type="button" data-s="" aria-pressed="${state.status === ""}">${L("Tous", "All")} <span>${fmtNum(f.lineages.length)}</span></button>
          ${STATUSES.map((s) => `<button type="button" data-s="${s}" aria-pressed="${state.status === s}">${swatch(s)}${esc(statusLabel(s, true))} <span>${fmtNum(o[s])}</span></button>`).join("")}
        </div>
        <p id="pcount" class="muted small" aria-live="polite"></p>
        <ol id="plist" class="prog-list"></ol>
        <button type="button" id="pmore" class="button prog-more" hidden>${L("Afficher plus", "Show more")}</button>
      </article>

      <article class="card" id="assemblee">
        <header class="card-head"><h2>${L(`À l’Assemblée depuis 2024 : comment a voté le groupe ${esc(f.group)}`, `In the Assembly since 2024: how the ${esc(f.group)} group voted`)}</h2></header>
        <p class="prog-lede">${L(
          `${f.votes.length} engagements du programme correspondent clairement à un texte voté depuis juillet 2024 (${nVoteScrutins} scrutins publics). La position du groupe est celle de la majorité de ses députés actuels ayant voté. Elle va dans le sens de la promesse dans ${nAgree} scrutins, pas dans ${nDisagree}. Pour les ${fmtNum(nInW - f.votes.length)} autres engagements de 2027 : pas de vote correspondant identifié.`,
          `${f.votes.length} programme commitments clearly match a text voted on since July 2024 (${nVoteScrutins} public votes). The group position is that of the majority of its current MPs who voted. It is in line with the promise in ${nAgree} votes, not in ${nDisagree}. For the other ${fmtNum(nInW - f.votes.length)} 2027 commitments: no matching vote identified.`)}</p>
        <div class="prog-votes">${f.votes.map((v) => {
          const l = byId.get(v.lineage);
          const m = l ? latest(l) : null;
          return `<section class="prog-vote">
            <h3>${esc(L(v.topic.fr, v.topic.en))}</h3>
            ${m ? `<p class="prog-quote" lang="fr">« ${esc(m.t)} » <button type="button" class="linkish prog-goto" data-id="${esc(v.lineage)}">${L("voir la mesure", "see the measure")}</button></p>` : ""}
            ${v.note ? `<p class="muted small">${esc(L(v.note.fr, v.note.en))}</p>` : ""}
            <table class="table prog-vtable"><thead><tr><th>${L("Date", "Date")}</th><th>${L("Scrutin", "Vote")}</th><th title="${L("pour / contre / abstention", "for / against / abstain")}">${esc(f.group)} ${L("P/C/A", "F/A/Ab")}</th><th>${L("Sens de la promesse", "Promise implies")}</th><th></th></tr></thead><tbody>${voteRows(v)}</tbody></table>
          </section>`;
        }).join("")}</div>
      </article>

      <article class="card">
        <header class="card-head"><h2>${L("Poids dans le programme et temps de parole", "Weight in the programme vs speaking time")}</h2></header>
        <p class="prog-lede">${L(
          `Part de chaque thème parmi les ${vw.count} mesures du programme 2027, et part du même thème dans les interventions en séance des députés ${esc(f.group)}${tw.speechesPeriod ? ` (${fmtDate(tw.speechesPeriod.from)} – ${fmtDate(tw.speechesPeriod.to)}${tw.speechesCount ? `, ${fmtNum(tw.speechesCount)} interventions` : ""})` : ""}. Les deux mesures ne se comparent qu’en ordre de grandeur : une mesure n’est pas une minute de débat, et l’ordre du jour de l’Assemblée est largement fixé par le gouvernement.`,
          `Share of each theme among the ${vw.count} measures of the 2027 programme, and share of the same theme in ${esc(f.group)} MPs’ speeches in the chamber${tw.speechesPeriod ? ` (${fmtDate(tw.speechesPeriod.from)} – ${fmtDate(tw.speechesPeriod.to)}${tw.speechesCount ? `, ${fmtNum(tw.speechesCount)} speeches` : ""})` : ""}. Only orders of magnitude compare: a measure is not a minute of debate, and the Assembly’s agenda is largely set by the government.`)}</p>
        <div class="prog-weights">
          <div class="prog-wkey"><span><i class="prog-sw prog-wp"></i>${L("Programme 2027", "2027 programme")}</span><span><i class="prog-sw prog-ws"></i>${L(`Interventions ${f.group}`, `${f.group} speeches`)}</span></div>
          ${weightRows.map((r) => `<div class="prog-wrow"><span class="prog-wlabel">${esc(L(r.t.fr, r.t.en))}</span>
            <span class="prog-wbars"><span class="prog-wbar prog-wp" style="width:${((100 * r.p) / wMax).toFixed(1)}%"></span><b>${fmtPct(100 * r.p, 0)}</b>
            <span class="prog-wbar prog-ws" style="width:${((100 * r.s) / wMax).toFixed(1)}%"></span><b>${fmtPct(100 * r.s, 0)}</b></span></div>`).join("")}
        </div>
        <p class="muted small">${L("Thèmes : le même lexique de mots-clés que la page « De quoi parlent-ils ? » (17 thèmes). Une mesure reçoit le thème de sa section, sauf si son texte relève clairement d’un autre.", "Themes: the same keyword lexicon as the ‘What do they talk about?’ page (17 themes). A measure takes its section’s theme unless its text clearly belongs to another.")} <a href="#/assemblee/themes">${L("Voir les thèmes à l’Assemblée", "See themes in the Assembly")}</a></p>
      </article>

      <article class="card prose prog-method">
        <header class="card-head"><h2>${L("Sources et méthode", "Sources and method")}</h2></header>
        <ul>
          ${f.versions.map((v) => `<li><b>${esc(L(v.label.fr, v.label.en))}</b> — ${esc(v.title)} (${v.count} ${L("mesures", "measures")}, ${v.key} ${L("mesures clés", "key measures")}). ${v.url ? `<a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">${v.kind === "site" ? L("Site", "Website") : L("Adresse d’origine du PDF", "Original PDF address")}</a>${v.kind !== "site" ? L(" (redirige désormais vers le site 2027 ; copie du PDF conservée par la rédaction)", " (now redirects to the 2027 site; a copy of the PDF is kept on file)") : ""}` : ""}</li>`).join("")}
        </ul>
        <p>${L(
          "Extraction : le texte des deux PDF est découpé en puces (« • ») sous leurs chapitres et sections ; les encadrés « mesure clé » sont repérés et fusionnés avec la puce qu’ils reprennent ; les encadrés de sondages (« À savoir ») sont écartés. Le site 2027 est lu page par page (chaque chapitre de chaque partie) ; chaque mesure garde le lien de sa section. Les textes sont cités tels quels, en français.",
          "Extraction: the text of both PDFs is split into bullet points under their chapters and sections; ‘key measure’ boxes are detected and merged with the bullet they restate; poll boxes (‘À savoir’) are left out. The 2027 site is read page by page (every chapter of every part); each measure keeps the link to its section. Measures are quoted verbatim, in French.")}</p>
        <p>${L(
          "Rapprochement : chaque mesure de 2025 est associée à la mesure de 2027 la plus proche (recouvrement des mots, pondéré par leur rareté), puis chaque mesure de l’abrégé 2022 à la plus proche des deux. Les paires douteuses ont été relues une à une et confirmées ou rejetées à la main. « Modifiée » : un chiffre diffère, ou, entre 2025 et 2027, la formulation change d’au moins trois mots porteurs de sens. L’abrégé de 2022 résumant par nature, sa seule différence de formulation n’est pas comptée comme une modification.",
          "Matching: each 2025 measure is paired with the closest 2027 measure (word overlap weighted by rarity), then each 2022 booklet measure with the closest of the two. Doubtful pairs were read one by one and confirmed or rejected by hand. ‘Changed’: a figure differs or, between 2025 and 2027, the wording changes by at least three meaningful words. As the 2022 booklet summarises by design, a difference of wording alone from it does not count as a change.")}</p>
        <p>${L(
          `Votes : seuls les scrutins dont l’objet est la mesure elle-même (ou son contraire direct) sont reliés ; les amendements, dont l’intitulé ne dit pas le contenu, ne le sont pas. Position du groupe : majorité des voix exprimées par ses ${esc(f.group === "LFI-NFP" ? "députés" : "membres")} actuels (open data de l’Assemblée). Ce relevé ne juge pas les mesures.`,
          `Votes: only votes whose object is the measure itself (or its direct opposite) are linked; amendments, whose titles do not state their content, are not. Group position: majority of the votes cast by its current members (Assembly open data). This record does not judge the measures.`)}</p>
        <p class="source">${L("Analyse générée le", "Analysis generated on")} ${fmtDate(f.generatedAt)} · ${L("script", "script")} <a href="https://github.com/nicbay/projectview/blob/main/scripts/build-programme.mjs" target="_blank" rel="noopener">scripts/build-programme.mjs</a> · <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>
      </article>
    </section>`;

  // ---------- measure list ----------
  const list = app.querySelector<HTMLOListElement>("#plist")!;
  const more = app.querySelector<HTMLButtonElement>("#pmore")!;
  const countEl = app.querySelector<HTMLElement>("#pcount")!;
  const hay = new Map(f.lineages.map((l) => [l.id, fold([l.a?.t, l.e?.t, l.w?.t].filter(Boolean).join(" "))]));
  const order: Record<Status, number> = { modified: 0, new2027: 1, dropped: 2, new2025: 3, maintained: 4 };

  const col = (vid: string, year: number, m: Measure | undefined, html?: string) => `
    <div class="prog-ver${m ? "" : " prog-absent"}">
      <p class="prog-year">${year}${m?.k ? ` <span class="tag">${L("mesure clé", "key measure")}</span>` : ""}</p>
      ${m ? `<p class="prog-text" lang="fr">${html ?? esc(m.t)}</p>${loc(vid, m)}` : `<p class="prog-text muted">${L("Absente", "Absent")}</p>`}
    </div>`;
  const changeNote = (l: Lineage) => (l.changes ?? []).map((c) => {
    const bits: string[] = [];
    if (c.kinds.includes("figure")) bits.push(L(`chiffres ${c.before.join(", ")} → ${c.after.join(", ")}`, `figures ${c.before.join(", ")} → ${c.after.join(", ")}`));
    if (c.kinds.includes("figure-removed")) bits.push(L(`chiffre retiré (${c.before.join(", ")})`, `figure removed (${c.before.join(", ")})`));
    if (c.kinds.includes("figure-added")) bits.push(L(`chiffre ajouté (${c.after.join(", ")})`, `figure added (${c.after.join(", ")})`));
    if (c.kinds.includes("wording")) bits.push(L("formulation modifiée", "wording changed"));
    return `${c.from} → ${c.to}${L(" : ", ": ")}${bits.join(L(" ; ", "; "))}`;
  }).join(" · ");
  const item = (l: Lineage) => {
    // highlight differences between consecutive full versions (2025 → 2027)
    let eh: string | undefined, wh: string | undefined;
    if (l.e && l.w && l.changed) [eh, wh] = diff(l.e.t, l.w.t);
    const v = votesBy.get(l.id);
    return `<li class="prog-item" id="m-${esc(l.id)}">
      <div class="prog-item-head">${tag(l.status)}${l.status === "new2025" && l.changed ? `<span class="prog-chip prog-modified">${L("modifiée en 2027", "changed in 2027")}</span>` : ""}${l.status === "dropped" ? `<span class="muted small">${L(`absente depuis ${l.droppedIn}`, `absent since ${l.droppedIn}`)}</span>` : ""}<span class="prog-theme">${esc(themeName(l.theme))}</span></div>
      <div class="prog-vers">
        ${col(va.id, va.year, l.a)}
        ${col(ve.id, ve.year, l.e, eh)}
        ${col(vw.id, vw.year, l.w, wh)}
      </div>
      ${l.changes?.length ? `<p class="prog-change">${esc(changeNote(l))}</p>` : ""}
      <p class="prog-an">${v
        ? `${L("Assemblée", "Assembly")} : ${v.scrutins.map((s) => `<a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${s.num}" target="_blank" rel="noopener">n° ${s.num}</a> (${esc(f.group)} ${s.majority ? POS[s.majority]().toLowerCase() : "—"})`).join(", ")} · <a href="#/programmes/${esc(f.slug)}#assemblee">${L("détail", "details")}</a>`
        : `${L("Assemblée : pas de vote correspondant", "Assembly: no matching vote")}`}</p>
    </li>`;
  };
  const filtered = () => {
    if (state.focus) { const l = byId.get(state.focus); return l ? [l] : []; }
    const q = fold(state.q.trim());
    return f.lineages
      .filter((l) => (!state.theme || l.theme === state.theme) && (!state.status || l.status === state.status) && (!state.branch || BRANCH[state.branch](l)) && (!state.key || l.key) && (!state.votes || votesBy.has(l.id)) && (!q || hay.get(l.id)!.includes(q)))
      .sort((a, b) => (b.key ?? 0) - (a.key ?? 0) || order[a.status] - order[b.status]);
  };
  const draw = () => {
    const rows = filtered();
    list.innerHTML = rows.slice(0, state.shown).map(item).join("") || `<li class="muted">${L("Aucune mesure ne correspond.", "No measure matches.")}</li>`;
    countEl.innerHTML = state.focus
      ? `${L("Une mesure affichée.", "One measure shown.")} <button type="button" class="linkish" id="pall">${L("Revenir à toute la liste", "Back to the full list")}</button>`
      : `${fmtNum(rows.length)} ${rows.length > 1 ? L("engagements", "commitments") : L("engagement", "commitment")}${rows.length > state.shown ? L(`, ${state.shown} premiers affichés`, `, first ${state.shown} shown`) : ""}${state.branch ? ` · ${L("branche", "branch")} « ${esc(branchLabel(state.branch))} » <button type="button" class="linkish" id="pbr">${L("retirer", "clear")}</button>` : ""}`;
    app.querySelector("#pall")?.addEventListener("click", () => { state.focus = null; draw(); });
    app.querySelector("#pbr")?.addEventListener("click", () => { state.branch = ""; draw(); });
    more.hidden = state.focus != null || rows.length <= state.shown;
  };
  const reset = () => { state.shown = 30; state.focus = null; draw(); };
  app.querySelector<HTMLInputElement>("#pq")!.addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; reset(); });
  const themeSel = app.querySelector<HTMLSelectElement>("#pt")!;
  themeSel.addEventListener("change", () => { state.theme = themeSel.value; reset(); });
  app.querySelector<HTMLInputElement>("#pk")!.addEventListener("change", (e) => { state.key = (e.target as HTMLInputElement).checked; reset(); });
  app.querySelector<HTMLInputElement>("#pv")!.addEventListener("change", (e) => { state.votes = (e.target as HTMLInputElement).checked; reset(); });
  const statusBtns = [...app.querySelectorAll<HTMLButtonElement>(".prog-status button")];
  const setStatus = (s: Status | "") => { state.status = s; state.branch = ""; statusBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === s))); reset(); };
  statusBtns.forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.s as Status | "")));
  more.addEventListener("click", () => { state.shown += 30; draw(); });
  const toList = () => app.querySelector("#mesures")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  app.querySelectorAll<HTMLButtonElement>(".prog-row").forEach((b) => b.addEventListener("click", () => { state.theme = b.dataset.theme!; themeSel.value = state.theme; reset(); toList(); }));
  app.querySelectorAll<HTMLButtonElement>(".prog-goto").forEach((b) => b.addEventListener("click", () => { state.focus = b.dataset.id!; draw(); toList(); }));
  draw();

  // ---------- flow view ----------
  const canvas = app.querySelector<HTMLElement>("#fcanvas")!;
  const detail = app.querySelector<HTMLElement>("#fdetail")!;
  const flowSel = app.querySelector<HTMLSelectElement>("#ft")!;
  const drawFlow = () => {
    const ls = state.flowTheme ? f.lineages.filter((l) => l.theme === state.flowTheme) : f.lineages;
    canvas.innerHTML = flowSvg(f, ls, state.flowPick);
    const b = state.flowPick;
    const rows = ls.filter(BRANCH[b]).sort((x, y) => (y.key ?? 0) - (x.key ?? 0));
    const ver = (l: Lineage) => (b === "drop22" ? l.a : b === "drop25" ? l.e : l.w)!;
    const themes = new Map<string, number>();
    for (const l of rows) themes.set(l.theme, (themes.get(l.theme) ?? 0) + 1);
    const top = [...themes].sort((x, y) => y[1] - x[1]).slice(0, 4);
    detail.innerHTML = `
      <div class="flow-detail-head">${tag(BRANCH_STATUS[b])}<h3>${esc(branchLabel(b))} · ${fmtNum(rows.length)}</h3></div>
      <p class="muted small">${esc(branchHelp(b))}${top.length && !state.flowTheme ? ` ${L("Surtout :", "Mostly:")} ${top.map(([t, k]) => `${esc(themeName(t))} (${k})`).join(", ")}.` : ""}</p>
      <ul class="flow-examples">${rows.slice(0, 5).map((l) => `<li lang="fr">${l.key ? `<span class="tag">${L("clé", "key")}</span> ` : ""}${esc(ver(l).t)} <button type="button" class="linkish prog-goto" data-id="${esc(l.id)}">${L("voir", "see")}</button></li>`).join("") || `<li class="muted">${L("Aucune mesure dans cette branche pour ce thème.", "No measure in this branch for this theme.")}</li>`}</ul>
      ${rows.length > 5 ? `<button type="button" class="button" id="fall">${L(`Voir les ${fmtNum(rows.length)} mesures de cette branche`, `See all ${fmtNum(rows.length)} measures in this branch`)}</button>` : ""}`;
    detail.querySelectorAll<HTMLButtonElement>(".prog-goto").forEach((x) => x.addEventListener("click", () => { state.focus = x.dataset.id!; draw(); toList(); }));
    detail.querySelector("#fall")?.addEventListener("click", () => {
      state.branch = b; state.status = ""; state.theme = state.flowTheme; themeSel.value = state.theme;
      statusBtns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.s === "")));
      reset(); toList();
    });
    canvas.querySelectorAll<SVGGElement>("[data-branch]").forEach((g) => {
      const go = () => { state.flowPick = g.dataset.branch as BranchId; drawFlow(); canvas.querySelector<SVGGElement>(`[data-branch="${state.flowPick}"]`)?.focus(); };
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  };
  flowSel.addEventListener("change", () => { state.flowTheme = flowSel.value; drawFlow(); });
  drawFlow();
}
