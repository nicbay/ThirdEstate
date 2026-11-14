// The 2022 → 2027 scorecard of a programme: grouped by status (changed, kept, dropped, new), each commitment on one
// line, its oldest version on the left and its newest on the right, joined by a short link carrying the status
// icon. (It used to be wired through one hub per status, workflow-editor style: pretty, but you couldn't tell which
// old promise had become which new one.)
// Every node opens its own source: the version's PDF at the right page, the website section, or the article.
// Shared by the full (Mélenchon) and the curated ("lite") programme pages (src/views/programme.ts).
import { L, fmtNum } from "../i18n";
import { esc, safeUrl } from "../util";

export type ScStatus = "changed" | "kept" | "dropped" | "new";
/** One side of a commitment: its wording in a version, and where to read it. */
export interface ScSide { year: number; text: string; href?: string; where?: string; /** link label when not a PDF (e.g. "site 2027") */ tag?: string }
export interface ScItem { id: string; status: ScStatus; key?: boolean; theme?: string; before?: ScSide; after?: ScSide; note?: string }
export interface ScOptions {
  id: string; yearA: number; yearB: number;
  /** shown under the "dropped" ghost node (e.g. "retirée en 2025") */
  droppedNote?: (it: ScItem) => string;
  /** link to the full list of a status, under the graph */
  listHref?: (s: ScStatus) => string;
  /** commitments per hub before "show the others" (default 3) */
  fold?: number;
  /** true counts when `items` is only a selection (e.g. the key measures of a 1,200-commitment programme) */
  totals?: Record<ScStatus, number>;
}

export const SC_ORDER: ScStatus[] = ["changed", "kept", "dropped", "new"];
const icon: Record<ScStatus, string> = { changed: "≠", kept: "=", dropped: "−", new: "+" };
export const scLabel = (s: ScStatus) => ({ changed: L("Modifiées", "Changed"), kept: L("Gardées", "Kept"), dropped: L("Abandonnées", "Dropped"), new: L("Nouvelles", "New") })[s];
const scHelp = (s: ScStatus, a: number, b: number) => ({
  changed: L(`en ${a} et en ${b}, chiffre ou contenu modifié`, `in ${a} and ${b}, figure or content changed`),
  kept: L(`en ${a} et en ${b}, même engagement`, `in ${a} and ${b}, same commitment`),
  dropped: L(`en ${a}, plus en ${b}`, `in ${a}, gone by ${b}`),
  new: L(`absentes en ${a}, présentes en ${b}`, `not in ${a}, in ${b}`),
})[s];

/** "PDF p. 16", "site", "article": what a node's link opens. */
function docTag(href: string) {
  const pdf = /\.pdf(\?|#|$)/i.test(href);
  const page = /#page=(\d+)/.exec(href)?.[1];
  return pdf ? (page ? L(`PDF p. ${page}`, `PDF p. ${page}`) : "PDF") : /^\/|thirdestate/.test(href) ? L("document", "document") : L("source", "source");
}

function node(side: ScSide | undefined, s: ScStatus, it: ScItem, end: "a" | "b", o: ScOptions) {
  if (!side) {
    const txt = end === "a" ? L(`Absente en ${o.yearA}`, `Not in ${o.yearA}`) : o.droppedNote?.(it) ?? L(`Absente en ${o.yearB}`, `Not in ${o.yearB}`);
    return `<span class="sc-node is-ghost is-${end}" data-end="${end}"><span class="sc-y">${end === "a" ? o.yearA : o.yearB}</span><span class="sc-t">${esc(txt)}</span></span>`;
  }
  const href = side.href ? safeUrl(side.href) : "";
  const inner = `<span class="sc-y">${side.year}${it.key && end === "b" ? ` <i class="sc-key">${L("clé", "key")}</i>` : ""}</span><span class="sc-t" lang="fr">${esc(side.text)}</span>${href ? `<span class="sc-doc">${esc(/\.pdf/i.test(href) || !side.tag ? docTag(href) : side.tag)} ↗</span>` : ""}`;
  const title = `${side.year}${side.where ? ` · ${side.where}` : ""} — ${side.text}`;
  return href
    ? `<a class="sc-node is-${end}" data-end="${end}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(title)}">${inner}</a>`
    : `<span class="sc-node is-${end}" data-end="${end}" title="${esc(title)}">${inner}</span>`;
}

/** Scorecard markup: the four counts, then the node graph. Call mountScorecard after it is in the DOM. */
export function scorecardHtml(items: ScItem[], o: ScOptions) {
  const fold = o.fold ?? 3;
  const by = Object.fromEntries(SC_ORDER.map((s) => [s, items.filter((x) => x.status === s)])) as Record<ScStatus, ScItem[]>;
  const n = (s: ScStatus) => o.totals?.[s] ?? by[s].length;
  const total = SC_ORDER.reduce((a, s) => a + n(s), 0) || 1;
  const counts = `<div class="sc-counts" role="list">${SC_ORDER.map((s) => `<a role="listitem" class="sc-count is-${s}" href="#${o.id}-${s}" data-sc-jump="${s}">
      <span class="sc-tile">${icon[s]}</span><b>${fmtNum(n(s))}</b><span>${esc(scLabel(s))}</span>
      <span class="sc-bar"><i style="width:${((100 * n(s)) / total).toFixed(1)}%"></i></span></a>`).join("")}</div>`;
  const groups = SC_ORDER.filter((s) => by[s].length).map((s) => {
    const rows = by[s];
    const link = (it: ScItem) => `<span class="sc-link${!it.before || !it.after ? " is-ghost" : ""}" aria-hidden="true"><span class="sc-tile">${icon[s]}</span></span>`;
    return `<section class="sc-group is-${s}" id="${o.id}-${s}" data-status="${s}">
      <header class="sc-head"><span class="sc-tile">${icon[s]}</span><b>${esc(scLabel(s))} <span class="sc-head-n">${fmtNum(n(s))}</span></b><span>${esc(scHelp(s, o.yearA, o.yearB))}</span></header>
      ${rows.map((it, i) => `<div class="sc-row${i >= fold ? " is-folded" : ""}" data-id="${esc(it.id)}"${i >= fold ? " hidden" : ""}>${node(it.before, s, it, "a", o)}${link(it)}${node(it.after, s, it, "b", o)}</div>`).join("")}
      ${rows.length > fold || (n(s) > rows.length && o.listHref) ? `<div class="sc-foot">${rows.length > fold ? `<button type="button" class="sc-more" aria-expanded="false" data-n="${rows.length - fold}">${L(`+ ${rows.length - fold} autres`, `+ ${rows.length - fold} more`)}</button>` : ""}${n(s) > rows.length && o.listHref ? `<a class="sc-all" href="${esc(o.listHref(s))}">${L(`Les ${fmtNum(n(s))} dans la liste complète`, `All ${fmtNum(n(s))} in the full list`)} →</a>` : ""}</div>` : ""}
    </section>`;
  }).join("");
  return `<div class="sc" id="${o.id}">
    ${counts}
    <div class="sc-cols" aria-hidden="true"><span>${o.yearA}</span><span></span><span>${o.yearB}</span></div>
    <div class="sc-graph">${groups}</div>
  </div>`;
}

/** Wires up the fold buttons and the count tiles' jumps. */
export function mountScorecard(root: HTMLElement, id: string) {
  const sc = root.querySelector<HTMLElement>(`#${id}`);
  if (!sc) return;
  sc.querySelectorAll<HTMLButtonElement>(".sc-more").forEach((b) => b.addEventListener("click", () => {
    const grp = b.closest<HTMLElement>(".sc-group")!;
    const open = b.getAttribute("aria-expanded") !== "true";
    grp.querySelectorAll<HTMLElement>(".sc-row.is-folded").forEach((x) => (x.hidden = !open));
    b.setAttribute("aria-expanded", String(open));
    b.textContent = open ? L("Replier", "Show fewer") : L(`+ ${b.dataset.n} autres`, `+ ${b.dataset.n} more`);
  }));
  sc.querySelectorAll<HTMLAnchorElement>("[data-sc-jump]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    sc.querySelector(`#${id}-${a.dataset.scJump}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }));
}
