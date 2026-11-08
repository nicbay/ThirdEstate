// Campaign programme over time: every measure of a candidate's programme across its versions
// (e.g. 2022 abridged booklet → 2025 full edition → 2027 online book), what was kept, reworded,
// added or dropped, and how the candidate's Assembly group voted on matching texts since 2024.
// Data: public/data/programmes/<slug>.json, built by scripts/build-programme.mjs. Generic over slug.
// Tone: descriptive only. Status chips use neutral ink/grey styles; colour is kept for vote positions.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, fmtPct } from "../i18n";
import { esc, safeUrl } from "../util";
import { flowSvg, type FlowSpec } from "../lib/programme-flow";
import { measureTable, mountMeasureTable, type Assessed, type Feas, type Legal } from "../lib/measure-table";

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
interface AssessEntry {
  id: string; short: { fr: string; en: string } | null; cost: number | null; low: number | null; high: number | null; party: number | null; by: string | null;
  basis: string | null; sources: { title: string; url: string }[]; legal: Legal; legalNote: string | null; feasibility: Feas; feasibilityNote: string | null; broadBenefit: boolean; key: boolean;
}
interface ProgrammeFile {
  slug: string; candidate: string; party: string; programme: string; group: string; generatedAt: string;
  themes: { id: string; fr: string; en: string }[];
  versions: Version[];
  sections: Record<string, [string | null, string, string | null, string | null][]>;
  summary: { overall: Counts & { total: number; changed: number }; byTheme: Record<string, Counts> };
  highlights: { lineage: string; kind: string; fr: string; en: string }[];
  costing?: { rounds: CostRound[]; checked: string };
  assessment?: AssessEntry[];
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

// ---------- flow view (src/lib/programme-flow.ts): 2022 booklet, 2025 edition, 2027 site → branches → 2027 / dropped ----------
export function melenchonFlowSpec(f: ProgrammeFile, ls: Lineage[]): FlowSpec {
  const n = Object.fromEntries((Object.keys(BRANCH) as BranchId[]).map((b) => [b, ls.filter(BRANCH[b]).length])) as Record<BranchId, number>;
  const inA = ls.filter((l) => l.a).length, inE = ls.filter((l) => l.e).length, inW = ls.filter((l) => l.w).length;
  const [, ve, vw] = f.versions;
  const items = (k: number) => `${fmtNum(k)} ${k > 1 ? L("mesures", "measures") : L("mesure", "measure")}`;
  const icon: Record<BranchId, string> = { kept: "=", changed: "≠", drop22: "−", add25: "+", drop25: "−", new27: "★" };
  const order: BranchId[] = ["kept", "changed", "drop22", "add25", "drop25", "new27"];
  return {
    sources: [
      { id: "s22", icon: "22", title: L("Abrégé 2022", "2022 booklet"), sub: items(inA), out: ["kept", "changed", "drop22"] },
      { id: "s25", icon: "25", title: L("Édition 2025", "2025 edition"), sub: items(inE), out: ["add25", "drop25"] },
      { id: "s27", icon: "27", title: L("Site 2027", "2027 website"), sub: L("textes nouveaux", "new texts"), out: ["new27"] },
    ],
    branches: order.map((b) => ({ id: b, icon: icon[b], title: branchLabel(b), n: n[b], drop: b === "drop22" || b === "drop25" })),
    keepTitle: L(`Programme ${vw.year}`, `${vw.year} programme`), keepN: inW, goneN: n.drop22 + n.drop25,
    label: L(`Flux des engagements : ${inA} dans l’abrégé 2022, ${inE} dans l’édition ${ve.year}, ${inW} dans le programme ${vw.year}.`, `Flow of commitments: ${inA} in the 2022 booklet, ${inE} in the ${ve.year} edition, ${inW} in the ${vw.year} programme.`),
  };
}

function costCard(f: { slug: string; costing?: { rounds: CostRound[]; checked: string } | null }) {
  const c = f.costing;
  if (!c?.rounds.length) return "";
  const nets = c.rounds.flatMap((r) => [r.announced?.net, ...r.estimates.map((e) => e.net)]).filter((v): v is number => typeof v === "number");
  const lo = Math.min(-20, ...nets), hi = Math.max(40, ...nets), span = hi - lo;
  const pos = (v: number) => (100 * (v - lo)) / span;
  const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; return L(`${sg}${fmtNum(Math.abs(v))} Md€`, `${sg}€${fmtNum(Math.abs(v))}bn`); };
  const bar = (e: CostLine | null, kind: "ann" | "est") => {
    if (!e) return "";
    if (e.net == null) return `<div class="cost-row is-${kind}"><span class="cost-who">${kind === "ann" ? L("Annoncé", "Announced") : L("Estimé", "Estimated")} · <a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">${esc(e.by)}</a></span><span class="cost-detail muted small">${L("Pas de solde chiffré", "No overall balance given")} — ${esc(L(e.note.fr, e.note.en))}</span></div>`;
    const a = pos(Math.min(0, e.net)), b = pos(Math.max(0, e.net));
    return `<div class="cost-row is-${kind}">
      <span class="cost-who">${kind === "ann" ? L("Annoncé", "Announced") : L("Estimé", "Estimated")} · <a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">${esc(e.by)}</a></span>
      <span class="cost-track"><i class="cost-zero" style="left:${pos(0).toFixed(1)}%"></i><i class="cost-bar${e.net < 0 ? " is-neg" : ""}" style="left:${a.toFixed(1)}%;width:${Math.max(0.6, b - a).toFixed(1)}%"></i></span>
      <b class="cost-net${e.net < 0 ? " is-neg" : ""}">${md(e.net)}</b>
      <span class="cost-detail muted small">${L("dépenses", "spending")} ${e.spending == null ? "—" : md(e.spending).replace("+", "")} · ${L("recettes", "revenue")} ${e.revenue == null ? "—" : md(e.revenue).replace("+", "")} — ${esc(L(e.note.fr, e.note.en))}</span>
    </div>`;
  };
  const [r22, r24, r27] = [c.rounds.find((r) => r.year === 2022), c.rounds.find((r) => r.year === 2024), c.rounds.find((r) => r.year === 2027)];
  const m22 = r22?.estimates[0];
  const gap22 = r22 && m22 ? r22.announced.net - m22.net : null;
  const ests = c.rounds.flatMap((r) => r.estimates.map((e) => e.net));
  const generic = c.rounds.filter((r) => r.announced?.net != null && r.estimates.length).map((r) => L(
    `En ${r.year}, ${r.estimates.map((e) => `${e.by} estime le solde à ${md(e.net)}`).join(", ")}, contre ${md(r.announced.net)} annoncés par ${r.announced.by}.`,
    `In ${r.year}, ${r.estimates.map((e) => `${e.by} put the balance at ${md(e.net)}`).join(", ")}, against ${md(r.announced.net)} claimed by ${r.announced.by}.`));
  const verdict = f.slug !== "melenchon" ? (generic.length ? `<div class="cost-verdict"><p class="eyebrow">${L("En résumé", "In short")}</p>${generic.map((g) => `<p>${esc(g)}</p>`).join("")}</div>` : "") : r22 && m22 && r24 && r27 && gap22 != null ? `
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
      ${r.estimates.map((e) => bar(e, "est")).join("") || `<p class="cost-none muted small">${f.slug === "melenchon" ? L("Pas encore d’estimation indépendante : le chiffrage complet est annoncé pour début 2027.", "No independent estimate yet: the full costing is due in early 2027.") : L("Pas encore d’estimation indépendante.", "No independent estimate yet.")}</p>`}
    </section>`).join("")}
    ${verdict}
    <p class="muted small">${L(`Estimations « statiques » : effets directs des mesures, sans effet sur la croissance. Les auteurs n’utilisent pas la même trajectoire de référence, d’où des écarts entre eux.${f.slug === "melenchon" ? " Le NFP de 2024 était une coalition ; son programme n’est pas celui de LFI seule." : ""} Sources vérifiées le ${fmtDate(c.checked)}.`, `‘Static’ estimates: direct effects of the measures, no growth feedback. The authors use different baselines, hence differences between them.${f.slug === "melenchon" ? " The 2024 NFP was a coalition; its programme is not LFI’s alone." : ""} Sources checked on ${fmtDate(c.checked)}.`)}</p>
  </article>`;
}

export async function renderProgramme(app: HTMLElement, slug: string) {
  const f = await load(slug).catch(() => null);
  if (f && (f as unknown as LiteFile).lite) return renderLite(app, f as unknown as LiteFile);
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
  const assessRows: Assessed[] = (f.assessment ?? []).flatMap((a) => {
    const l = byId.get(a.id);
    if (!l?.w) return [];
    const st = l.status === "new2025" ? "new2025" : l.status;
    return [{
      id: a.id, label: a.short ? L(a.short.fr, a.short.en) : l.w.t.split(/[:;,(]/)[0].slice(0, 90), text: l.w.t, theme: l.theme, status: st, statusLabel: statusLabel(st as Status, true),
      cost: a.cost, low: a.low, high: a.high, party: a.party, by: a.by, basis: a.basis, sources: a.sources,
      legal: a.legal, legalNote: a.legalNote, feasibility: a.feasibility, feasibilityNote: a.feasibilityNote, broadBenefit: a.broadBenefit,
    }];
  });
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
          ${f.assessment?.length ? `<a href="#/programmes/${esc(f.slug)}#evaluation">${L("Coût, faisabilité, droit", "Cost, feasibility, law")}</a>` : ""}
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

      ${assessRows.length ? `<article class="card" id="evaluation">
        <header class="card-head"><h2>${L("Mesure par mesure : coût, faisabilité, Constitution", "Measure by measure: cost, feasibility, constitution")}</h2></header>
        <p class="prog-lede">${L(`Les ${fmtNum(assessRows.length)} mesures du programme 2027 qui sont soit des « mesures clés », soit chiffrées par l’Institut Montaigne en 2022. Le chiffre de Montaigne est conservé quand la mesure n’a pas changé de montant ; sinon, et pour les mesures nouvelles, l’estimation est la nôtre, calcul et sources à l’appui. Cliquez une ligne pour le détail.`, `The ${fmtNum(assessRows.length)} measures of the 2027 programme that are either ‘key measures’ or were costed by Institut Montaigne in 2022. Montaigne’s figure is kept where the measure’s amount hasn’t changed; otherwise, and for new measures, the estimate is ours, with its calculation and sources. Click a row for details.`)}</p>
        ${measureTable(assessRows, { id: "mt-mel", partyName: f.candidate })}
      </article>` : ""}

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
  mountMeasureTable(app, "mt-mel", assessRows);

  // ---------- flow view ----------
  const canvas = app.querySelector<HTMLElement>("#fcanvas")!;
  const detail = app.querySelector<HTMLElement>("#fdetail")!;
  const flowSel = app.querySelector<HTMLSelectElement>("#ft")!;
  const drawFlow = () => {
    const ls = state.flowTheme ? f.lineages.filter((l) => l.theme === state.flowTheme) : f.lineages;
    if (canvas.firstChild) canvas.classList.add("flow-static"); // draw-in plays once, not on every click
    canvas.innerHTML = flowSvg(melenchonFlowSpec(f, ls), state.flowPick);
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

// ---------- "lite" programme files: candidates whose programme is curated by hand (selected measures, sourced) ----------
type LiteStatus = "maintained" | "modified" | "new" | "dropped";
interface LiteMeasure {
  id: string; theme: string; status: LiteStatus; texts: Record<string, string>; change: { fr: string; en: string } | null;
  sources: { title: string; url: string }[];
  cost: { value: number; low?: number | null; high?: number | null; by: string; url?: string; note?: { fr: string; en: string } } | null;
  legal: Legal; legalNote: { fr: string; en: string } | null; feasibility: Feas; feasibilityNote: { fr: string; en: string } | null; broadBenefit: boolean;
  short?: { fr: string; en: string };
}
interface LiteFile {
  slug: string; candidate: string; party: string; lite: true; status: "published" | "partial" | "none";
  statusNote: { fr: string; en: string }; summary: { fr: string; en: string };
  versions: { id: string; year: number; label: { fr: string; en: string }; title: string; date: string; url?: string; kind: string }[];
  measures: LiteMeasure[]; costing: { rounds: CostRound[]; checked: string } | null;
}
const LITE_STATUS: LiteStatus[] = ["maintained", "modified", "new", "dropped"];
const liteLabel = (s: LiteStatus) => ({ maintained: L("Gardées", "Kept"), modified: L("Modifiées", "Changed"), new: L("Nouvelles", "New"), dropped: L("Abandonnées", "Dropped") })[s];
const THEME_NAMES: Record<string, [string, string]> = {
  securite: ["Sécurité", "Security"], immigration: ["Immigration", "Immigration"], sante: ["Santé", "Health"], social: ["Social, famille", "Welfare & family"], education: ["Éducation", "Education"],
  travail: ["Travail, retraites", "Work & pensions"], economie: ["Économie", "Economy"], budget: ["Budget, impôts", "Budget & tax"], ecologie: ["Écologie, énergie", "Ecology & energy"], agriculture: ["Agriculture", "Agriculture"],
  logement: ["Logement", "Housing"], international: ["International, défense", "International & defence"], justice: ["Justice", "Justice"], europe: ["Europe", "Europe"], institutions: ["Institutions", "Institutions"], outremer: ["Outre-mer", "Overseas"], culture: ["Culture", "Culture"],
};
const themeLabel = (t: string) => (THEME_NAMES[t] ? L(THEME_NAMES[t][0], THEME_NAMES[t][1]) : t);

function renderLite(app: HTMLElement, f: LiteFile) {
  const vs = f.versions, first = vs[0], last = vs[vs.length - 1];
  const latestText = (m: LiteMeasure) => m.texts[last.id] ?? m.texts[first.id] ?? Object.values(m.texts)[0] ?? "";
  const c = Object.fromEntries(LITE_STATUS.map((s) => [s, f.measures.filter((m) => m.status === s).length])) as Record<LiteStatus, number>;
  const items = (k: number) => `${fmtNum(k)} ${k > 1 ? L("mesures", "measures") : L("mesure", "measure")}`;
  const spec: FlowSpec | null = vs.length > 1 && f.measures.length ? {
    sources: [
      { id: "old", icon: String(first.year).slice(2), title: L(`Socle ${first.year}`, `${first.year} baseline`), sub: items(c.maintained + c.modified + c.dropped), out: ["maintained", "modified", "dropped"] },
      { id: "nw", icon: String(last.year).slice(2), title: L(`Propositions ${last.year}`, `${last.year} proposals`), sub: L("propositions nouvelles", "new proposals"), out: ["new"] },
    ],
    branches: (["maintained", "modified", "dropped", "new"] as LiteStatus[]).map((s) => ({ id: s, icon: { maintained: "=", modified: "≠", dropped: "−", new: "★" }[s], title: liteLabel(s), n: c[s], drop: s === "dropped" })),
    keepTitle: L(`Programme ${last.year}`, `${last.year} programme`), keepN: c.maintained + c.modified + c.new, goneN: c.dropped,
    label: L(`${f.measures.length} mesures suivies de ${first.year} à ${last.year}`, `${f.measures.length} measures followed from ${first.year} to ${last.year}`),
  } : null;
  const rows: Assessed[] = f.measures.map((m) => ({
    id: m.id, label: m.short ? L(m.short.fr, m.short.en) : latestText(m).split(/[.;:]/)[0].slice(0, 90), text: latestText(m), theme: m.theme,
    cost: m.cost?.value ?? null, low: m.cost?.low ?? null, high: m.cost?.high ?? null, by: m.cost?.by ?? null, url: m.cost?.url ?? null,
    basis: m.cost?.note ? L(m.cost.note.fr, m.cost.note.en) : null,
    legal: m.legal ?? "unknown", legalNote: m.legalNote ? L(m.legalNote.fr, m.legalNote.en) : null,
    feasibility: m.feasibility ?? null, feasibilityNote: m.feasibilityNote ? L(m.feasibilityNote.fr, m.feasibilityNote.en) : null,
    broadBenefit: !!m.broadBenefit, sources: m.sources, status: m.status, statusLabel: liteLabel(m.status),
  }));
  let pick: LiteStatus | "" = "";
  const statusTxt = { published: L("Programme publié", "Programme published"), partial: L("Annonces partielles", "Partial announcements"), none: L("Pas encore de programme", "No programme yet") }[f.status];
  app.innerHTML = `
    <section class="page prog">
      <div class="page-head">
        <p class="eyebrow">${L("Programmes 2027", "2027 programmes")} · ${esc(f.candidate)} · ${esc(f.party)}</p>
        <h1>${L(`Le programme de ${f.candidate}, de ${first.year} à ${last.year}`, `${f.candidate}’s programme, ${first.year} to ${last.year}`)}</h1>
        <p class="dek">${esc(L(f.summary.fr, f.summary.en))}</p>
        <p class="prog-status-note"><span class="prog-chip">${esc(statusTxt)}</span> ${esc(L(f.statusNote.fr, f.statusNote.en))}</p>
        <nav class="prog-jump" aria-label="${L("Sur cette page", "On this page")}">
          ${spec ? `<a href="#/programmes/${esc(f.slug)}#parcours">${L("Le parcours des mesures", "Where measures went")}</a>` : ""}
          <a href="#/programmes/${esc(f.slug)}#evaluation">${L("Coût, faisabilité, droit", "Cost, feasibility, law")}</a>
          ${f.costing?.rounds.length ? `<a href="#/programmes/${esc(f.slug)}#cout">${L("Le coût annoncé et estimé", "Claimed vs estimated cost")}</a>` : ""}
          <a href="#/programmes/${esc(f.slug)}#mesures">${L("Toutes les mesures", "Every measure")}</a>
          <a href="#/candidat/${esc(f.slug)}">${L("La fiche du candidat", "Candidate profile")}</a>
        </nav>
      </div>
      ${spec ? `<article class="card flow-card" id="parcours">
        <header class="card-head"><h2>${L(`Le parcours des mesures, de ${first.year} à ${last.year}`, `Where the measures went, ${first.year} to ${last.year}`)}</h2></header>
        <p class="prog-lede">${L("Une sélection des mesures principales, suivies d’une version à l’autre. Cliquez une branche pour filtrer la liste.", "A selection of the main measures, followed from one version to the next. Click a branch to filter the list.")}</p>
        <div class="flow-canvas" id="fcanvas"></div>
      </article>` : ""}
      <article class="card" id="evaluation">
        <header class="card-head"><h2>${L("Mesure par mesure : coût, faisabilité, Constitution", "Measure by measure: cost, feasibility, constitution")}</h2></header>
        ${measureTable(rows, { id: "mt-lite", partyName: f.candidate })}
      </article>
      ${f.costing?.rounds.length ? costCard({ slug: f.slug, costing: f.costing }) : ""}
      <article class="card" id="mesures">
        <header class="card-head"><h2>${L("Les mesures, version par version", "The measures, version by version")}</h2></header>
        <p id="lcount" class="muted small"></p>
        <ol class="prog-list" id="llist"></ol>
      </article>
      <article class="card prose prog-method">
        <header class="card-head"><h2>${L("Sources", "Sources")}</h2></header>
        <ul>${vs.map((v) => `<li><b>${esc(L(v.label.fr, v.label.en))}</b> — ${esc(v.title)} (${esc(v.date)})${v.url ? ` · <a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">${L("source", "source")}</a>` : ""}</li>`).join("")}</ul>
        <p>${L("Sélection des mesures principales de chaque version, citées depuis les documents du candidat ou les comptes rendus de presse indiqués. Le statut compare la plus ancienne et la plus récente version. Chaque mesure a ses sources.", "A selection of each version’s main measures, quoted from the candidate’s documents or the press reports listed. The status compares the oldest and newest versions. Every measure lists its sources.")}</p>
      </article>
    </section>`;
  mountMeasureTable(app, "mt-lite", rows);
  const list = app.querySelector<HTMLOListElement>("#llist")!;
  const canvas = app.querySelector<HTMLElement>("#fcanvas");
  const draw = () => {
    const ms = f.measures.filter((m) => !pick || m.status === pick);
    app.querySelector("#lcount")!.innerHTML = `${fmtNum(ms.length)} ${L("mesures", "measures")}${pick ? ` · ${esc(liteLabel(pick))} <button type="button" class="linkish" id="lclr">${L("tout afficher", "show all")}</button>` : ""}`;
    app.querySelector("#lclr")?.addEventListener("click", () => { pick = ""; draw(); drawFlow(); });
    list.innerHTML = ms.map((m) => `<li class="prog-item" id="m-${esc(m.id)}">
      <div class="prog-item-head"><span class="prog-chip prog-${m.status === "new" ? "new2027" : m.status}">${esc(liteLabel(m.status))}</span><span class="prog-theme">${esc(themeLabel(m.theme))}</span></div>
      <div class="prog-vers">${vs.map((v) => `<div class="prog-ver${m.texts[v.id] ? "" : " prog-absent"}"><p class="prog-year">${v.year}</p><p class="prog-text${m.texts[v.id] ? "" : " muted"}" lang="fr">${m.texts[v.id] ? esc(m.texts[v.id]) : L("Absente", "Absent")}</p></div>`).join("")}</div>
      ${m.change ? `<p class="prog-change">${esc(L(m.change.fr, m.change.en))}</p>` : ""}
      <p class="prog-an small">${m.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ")}</p>
    </li>`).join("");
  };
  function drawFlow() {
    if (!canvas || !spec) return;
    if (canvas.firstChild) canvas.classList.add("flow-static");
    canvas.innerHTML = flowSvg(spec, pick);
    canvas.querySelectorAll<SVGGElement>("[data-branch]").forEach((g) => {
      const go = () => { pick = pick === g.dataset.branch ? "" : (g.dataset.branch as LiteStatus); drawFlow(); draw(); };
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  drawFlow();
  draw();
}
