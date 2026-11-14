// Measure-by-measure assessment table, shared by every programme page: estimated cost (with who estimated it),
// feasibility, legal/constitutional risk, and an "economic populism" flag computed from stated criteria.
//
// Populism, in the economic sense of Dornbusch & Edwards (1991, "The Macroeconomics of Populism in Latin America"):
// a promise of a broad, immediate material benefit whose budget constraint is not dealt with. Here a measure is flagged:
//   "yes"    — broad household benefit, costs at least €2bn a year, and either: low feasibility, a serious legal
//              obstacle, or an independent cost at least 1.5× the party's own figure;
//   "partly" — broad household benefit that costs money, without those aggravating signs;
//   "no"     — everything else (taxes, regulation, targeted measures, or benefits that cost nothing).
// It describes the shape of a promise, not the intentions of whoever makes it.
import { L, fmtNum } from "../i18n";
import { esc, safeUrl } from "../util";

export type Legal = "ok" | "risk" | "unconstitutional-precedent" | "eu-law" | "constitutional-revision-needed" | "unknown";
export type Feas = "high" | "medium" | "low" | null;
export interface Assessed {
  id: string; label: string; text?: string; theme?: string; status?: string; statusLabel?: string; href?: string;
  cost: number | null; low?: number | null; high?: number | null; party?: number | null;
  by?: string | null; url?: string | null; basis?: string | null;
  legal: Legal; legalNote?: string | null; feasibility: Feas; feasibilityNote?: string | null; broadBenefit: boolean;
  sources?: { title: string; url: string }[];
}
/** Values from data files used as CSS class suffixes: letters, digits and dashes only. */
const cls = (v: unknown) => String(v ?? "").replace(/[^w-]/g, "");
export type Pop = "yes" | "partly" | "no";

export function populism(m: Assessed): Pop {
  if (!m.broadBenefit || m.cost == null || m.cost >= 0) return "no";
  const serious = m.legal === "unconstitutional-precedent" || m.legal === "eu-law" || m.legal === "constitutional-revision-needed";
  const understated = m.party != null && m.party < 0 && Math.abs(m.cost) >= 1.5 * Math.abs(m.party);
  return m.cost <= -2 && (m.feasibility === "low" || serious || understated) ? "yes" : "partly";
}

const legalLabel = (l: Legal) => ({
  ok: L("Pas d’obstacle identifié", "No obstacle found"),
  risk: L("Risque juridique", "Legal risk"),
  "unconstitutional-precedent": L("Censure probable (précédent)", "Likely struck down (precedent)"),
  "eu-law": L("Contraire au droit de l’UE", "Conflicts with EU law"),
  "constitutional-revision-needed": L("Révision de la Constitution", "Needs a constitutional amendment"),
  unknown: L("Non évalué", "Not assessed"),
})[l];
const feasLabel = (f: Feas) => (f ? { high: L("Réalisable", "Feasible"), medium: L("Difficile", "Difficult"), low: L("Peu réalisable", "Hard to deliver") }[f] : "—");
const popLabel = (p: Pop) => ({ yes: L("Oui", "Yes"), partly: L("En partie", "Partly"), no: L("Non", "No") })[p];
const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; const a = Math.abs(v); const n = fmtNum(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10); return L(`${sg}${n} Md€`, `${sg}€${n}bn`); };

type Filter = "" | "cost" | "legal" | "low" | "pop";
const SERIOUS_LEGAL = ["unconstitutional-precedent", "eu-law", "constitutional-revision-needed"];
/** Filters a link can open (#eval-<key>, from the programmes page's law and feasibility bars), with their label. */
const LINKED: Record<string, [() => string, (m: Assessed) => boolean]> = {
  "l-ok": [() => L("Pas d’obstacle identifié", "No obstacle found"), (m) => m.legal === "ok"],
  "l-risk": [() => L("Risque juridique", "Legal risk"), (m) => m.legal === "risk"],
  "l-serious": [() => L("Obstacle juridique sérieux", "Serious legal obstacle"), (m) => SERIOUS_LEGAL.includes(m.legal)],
  "l-na": [() => L("Non évalué", "Not assessed"), (m) => m.legal === "unknown" || !m.feasibility],
  "f-high": [() => L("Réalisable", "Feasible"), (m) => m.feasibility === "high"],
  "f-medium": [() => L("Difficile", "Difficult"), (m) => m.feasibility === "medium"],
  "f-low": [() => L("Peu réalisable", "Hard to deliver"), (m) => m.feasibility === "low"],
};
const FILTERS: [Filter, () => string, (m: Assessed) => boolean][] = [
  ["", () => L("Toutes", "All"), () => true],
  ["cost", () => L("Plus de 5 Md€", "Over €5bn"), (m) => m.cost != null && Math.abs(m.cost) >= 5],
  ["legal", () => L("Obstacle juridique", "Legal obstacle"), (m) => m.legal !== "ok" && m.legal !== "unknown"],
  ["low", () => L("Peu réalisables", "Hard to deliver"), (m) => m.feasibility === "low"],
  ["pop", () => L("Populisme économique", "Economic populism"), (m) => populism(m) === "yes"],
];

/** Totals and table; `mount` wires the filters and the row toggles. */
export function measureTable(rows: Assessed[], opts: { id: string; partyName: string }) {
  const costed = rows.filter((m) => m.cost != null);
  const spend = costed.filter((m) => m.cost! < 0).reduce((s, m) => s + m.cost!, 0);
  const rev = costed.filter((m) => m.cost! > 0).reduce((s, m) => s + m.cost!, 0);
  const pops = rows.map(populism);
  const nLegal = rows.filter((m) => m.legal !== "ok" && m.legal !== "unknown").length;
  const html = `
    <div class="mt-kpis">
      <div><strong>${costed.length}</strong><span>${L(`mesures chiffrées sur ${rows.length}`, `of ${rows.length} measures costed`)}</span></div>
      <div><strong class="mt-neg">${md(spend)}</strong><span>${L("de dépenses par an", "of spending a year")}</span></div>
      <div><strong class="mt-pos">${md(rev)}</strong><span>${L("de recettes par an", "of revenue a year")}</span></div>
      <div><strong>${nLegal}</strong><span>${L("avec un obstacle juridique", "with a legal obstacle")}</span></div>
      <div><strong>${pops.filter((p) => p === "yes").length}</strong><span>${L("signes de populisme économique", "show economic populism")}</span></div>
    </div>
    <div class="mt-filters" role="group" aria-label="${L("Filtrer", "Filter")}">${FILTERS.map(([k, lab, fn]) => `<button type="button" data-f="${k}" aria-pressed="${k === ""}">${esc(lab())} <span>${rows.filter(fn).length}</span></button>`).join("")}</div>
    <div class="mt-wrap"><table class="table mt" id="${esc(opts.id)}">
      <thead><tr><th>${L("Mesure", "Measure")}</th><th class="num">${L("Coût / an", "Cost / year")}</th><th>${L("Faisabilité", "Feasibility")}</th><th>${L("Constitution, droit", "Constitution, law")}</th><th><abbr title="${esc(L("Avantage large et immédiat dont le financement n’est pas assuré (Dornbusch et Edwards, 1991). Critères en bas du tableau.", "A broad, immediate benefit whose funding isn’t secured (Dornbusch & Edwards, 1991). Criteria below the table."))}">${L("Populisme éco.", "Econ. populism")}</abbr></th></tr></thead>
      <tbody>${[...rows].sort((a, b) => Math.abs(b.cost ?? 0) - Math.abs(a.cost ?? 0)).map((m) => {
        const p = populism(m);
        return `<tr class="mt-row" data-id="${esc(m.id)}" tabindex="0" aria-expanded="false">
          <td><b>${esc(m.label)}</b>${m.statusLabel ? ` <span class="prog-chip prog-${cls(m.status === "new" ? "new2027" : m.status)}">${esc(m.statusLabel)}</span>` : ""}</td>
          <td class="num">${m.cost == null ? `<span class="muted">—</span>` : `<b class="${m.cost < 0 ? "mt-neg" : "mt-pos"}">${md(m.cost)}</b>${m.low != null && m.high != null ? `<br><span class="muted small">${md(m.low)} / ${md(m.high)}</span>` : ""}${m.by ? `<br><span class="muted small">${esc(m.by)}</span>` : ""}`}</td>
          <td><span class="mt-f f-${cls(m.feasibility ?? "na")}">${esc(feasLabel(m.feasibility))}</span></td>
          <td><span class="mt-l l-${cls(m.legal)}">${esc(legalLabel(m.legal))}</span></td>
          <td><span class="mt-p p-${cls(p)}">${esc(popLabel(p))}</span></td>
        </tr>
        <tr class="mt-detail" hidden><td colspan="5">
          ${m.text ? `<p class="prog-quote" lang="fr">« ${esc(m.text)} »</p>` : ""}
          ${m.basis ? `<p><b>${L("Coût", "Cost")}${L(" : ", ": ")}</b>${esc(m.basis)}${m.party != null ? ` ${L(`Chiffre du parti : ${md(m.party)}.`, `Party’s figure: ${md(m.party)}.`)}` : ""}</p>` : ""}
          ${m.feasibilityNote ? `<p><b>${L("Faisabilité", "Feasibility")}${L(" : ", ": ")}</b>${esc(m.feasibilityNote)}</p>` : ""}
          ${m.legalNote ? `<p><b>${L("Droit", "Law")}${L(" : ", ": ")}</b>${esc(m.legalNote)}</p>` : ""}
          <p class="muted small">${L("Populisme économique", "Economic populism")}${L(" : ", ": ")}${esc(popWhy(m, p))}</p>
          ${m.sources?.length ? `<p class="small">${L("Sources", "Sources")}${L(" : ", ": ")}${m.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ")}</p>` : ""}
          ${m.href ? `<p class="small"><a href="${esc(m.href)}">${L("Voir la mesure dans le programme", "See the measure in the programme")}</a></p>` : ""}
        </td></tr>`;
      }).join("")}</tbody></table></div>
    <p class="muted small">${L(
      `Coûts en milliards d’euros par an, en régime de croisière ; négatif = dépense ou perte de recettes, positif = recette. Quand l’Institut Montaigne a chiffré la mesure en 2022, son chiffre est repris ; sinon, l’estimation de la rédaction est indiquée avec son calcul et ses sources. Les totaux additionnent des chiffrages d’origines différentes : un ordre de grandeur, pas un budget. « Populisme économique » : avantage large et immédiat pour les ménages, coûtant au moins 2 Md€ par an, et soit jugé peu réalisable, soit face à un obstacle juridique sérieux, soit chiffré par un tiers à au moins 1,5 fois le chiffre du parti (« en partie » : avantage large et coûteux, sans ces signes). Ce critère décrit la forme d’une promesse, pas les intentions de ${opts.partyName}.`,
      `Costs in € billions a year at full speed; negative = spending or lost revenue, positive = revenue. Where Institut Montaigne costed the measure in 2022 its figure is used; otherwise our estimate is shown with its calculation and sources. Totals add up costings from different sources: an order of magnitude, not a budget. ‘Economic populism’: a broad, immediate benefit for households, costing at least €2bn a year, and either judged hard to deliver, facing a serious legal obstacle, or costed by a third party at 1.5× the party’s figure or more (‘partly’: a broad, costly benefit without those signs). The test describes the shape of a promise, not the intentions of ${opts.partyName}.`)}</p>`;
  return html;
}

function popWhy(m: Assessed, p: Pop) {
  if (p === "no") return !m.broadBenefit ? L("pas un avantage matériel direct et large pour les ménages.", "not a direct, broad material benefit for households.") : L("ne coûte rien aux finances publiques selon l’estimation retenue.", "costs public finances nothing on the estimate used.");
  const why: string[] = [];
  if (m.feasibility === "low") why.push(L("jugée peu réalisable", "judged hard to deliver"));
  if (["unconstitutional-precedent", "eu-law", "constitutional-revision-needed"].includes(m.legal)) why.push(L("obstacle juridique sérieux", "serious legal obstacle"));
  if (m.party != null && m.party < 0 && m.cost != null && Math.abs(m.cost) >= 1.5 * Math.abs(m.party)) why.push(L("coût estimé au moins 1,5 fois celui du parti", "estimated at 1.5× the party’s cost or more"));
  return p === "yes"
    ? L(`avantage large, ${md(m.cost!)} par an, ${why.join(", ")}.`, `broad benefit, ${md(m.cost!)} a year, ${why.join(", ")}.`)
    : L(`avantage large et coûteux (${md(m.cost!)} par an), sans signe aggravant retenu.`, `broad, costly benefit (${md(m.cost!)} a year), with no aggravating sign.`);
}

export function mountMeasureTable(root: HTMLElement, id: string, rows: Assessed[]) {
  const table = root.querySelector<HTMLTableElement>(`#${CSS.escape(id)}`);
  if (!table) return;
  const byId = new Map(rows.map((m) => [m.id, m]));
  const wrap = table.closest(".mt-wrap")!.parentElement!;
  wrap.querySelectorAll<HTMLButtonElement>(".mt-filters button").forEach((b) => b.addEventListener("click", () => {
    wrap.querySelectorAll(".mt-filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const fn = FILTERS.find((f) => f[0] === b.dataset.f)![2];
    table.querySelectorAll<HTMLTableRowElement>(".mt-row").forEach((tr) => {
      const show = fn(byId.get(tr.dataset.id!)!);
      tr.hidden = !show;
      const det = tr.nextElementSibling as HTMLTableRowElement;
      if (!show) det.hidden = true;
      else det.hidden = tr.getAttribute("aria-expanded") !== "true";
    });
  }));
  // arriving from a bar on the programmes page: only those measures, each opened on its reason and sources
  const linked = /#eval-([\w-]+)$/.exec(location.hash)?.[1];
  const lf = linked ? LINKED[linked] : undefined;
  if (lf) {
    const [label, fn] = lf;
    let n = 0;
    table.querySelectorAll<HTMLTableRowElement>(".mt-row").forEach((tr) => {
      const show = fn(byId.get(tr.dataset.id!)!);
      tr.hidden = !show;
      tr.setAttribute("aria-expanded", String(show));
      (tr.nextElementSibling as HTMLElement).hidden = !show;
      if (show) n++;
    });
    wrap.querySelectorAll(".mt-filters button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    const note = document.createElement("p");
    note.className = "mt-linked";
    note.innerHTML = `${esc(label())}${L(" : ", ": ")}<b>${n}</b> ${L("mesures, avec la raison et les sources", "measures, with the reason and the sources")} · <button type="button" class="linkish">${L("tout afficher", "show all")}</button>`;
    note.querySelector("button")!.addEventListener("click", () => { note.remove(); (wrap.querySelector<HTMLButtonElement>('.mt-filters button[data-f=""]'))?.click(); });
    table.closest(".mt-wrap")!.before(note);
    requestAnimationFrame(() => note.scrollIntoView({ block: "start" }));
  }
  table.querySelectorAll<HTMLTableRowElement>(".mt-row").forEach((tr) => {
    const toggle = () => { const open = tr.getAttribute("aria-expanded") !== "true"; tr.setAttribute("aria-expanded", String(open)); (tr.nextElementSibling as HTMLElement).hidden = !open; };
    tr.addEventListener("click", (e) => { if (!(e.target as Element).closest("a")) toggle(); });
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}
