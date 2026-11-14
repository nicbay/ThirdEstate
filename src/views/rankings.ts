// Town rankings: every commune on one figure, in France or in a department, by size, from either end.
// Route: #/classements[/<ranking>[/<town code>]]; a town code highlights that town and scrolls to it.
// Ranks shown here are within the current selection (department, size); the town pages show national ranks.
import { L, fmtNum, getLang } from "../i18n";
import { loadDepartements } from "../data";
import { getHome } from "../lib/cloud";
import { esc } from "../util";
import { RANKINGS, fmtRankValue, loadQualityRanks, loadTownIndex, loadValues, rankHref, rankingBySlug, type Ranking } from "../lib/rankings";
import "../styles/rankings.css";

const SIZES: [number, string, string][] = [
  [0, "Toutes les communes", "Every town"],
  [2000, "2 000 habitants et plus", "2,000 people and more"],
  [10000, "10 000 habitants et plus", "10,000 people and more"],
  [50000, "50 000 habitants et plus", "50,000 people and more"],
];
const PAGE = 100;
// remembered for the visit: the reader's last choice of scope and size
const state = { dep: "", min: 0, flip: false };

export async function renderRankings(app: HTMLElement, slug?: string, focus?: string) {
  const rk0 = rankingBySlug(slug) ?? RANKINGS[0];
  app.innerHTML = `<section class="page rankings"><header class="sec-hero"><p class="eyebrow">${L("Classements des communes", "Town rankings")}</p><h1>${esc(L(...rk0.title))}</h1></header><p class="muted small">${L("Chargement…", "Loading…")}</p></section>`;
  const [idx, deps, qRanks] = await Promise.all([loadTownIndex(), loadDepartements().catch(() => null), loadQualityRanks()]);
  const depNames = new Map<string, string>((deps?.features ?? []).map((f) => [String(f.properties!.code), String(f.properties!.nom)]));
  const home = getHome();
  let shown = PAGE;
  if (focus) { state.dep = ""; state.min = 0; state.flip = false; } // a link from a town page: its national rank

  const groups = [...new Set(RANKINGS.map((r) => r.group[0]))];
  const select = `<select class="rk-kpi" aria-label="${esc(L("Classement", "Ranking"))}">${groups.map((g) => {
    const rs = RANKINGS.filter((r) => r.group[0] === g);
    return `<optgroup label="${esc(getLang() === "fr" ? g : rs[0].group[1])}">${rs.map((r) => `<option value="${r.slug}"${r === rk0 ? " selected" : ""}>${esc(L(...r.label))}</option>`).join("")}</optgroup>`;
  }).join("")}</select>`;
  const depOpts = [...new Set(idx.deps)].sort().map((d) => `<option value="${d}"${state.dep === d ? " selected" : ""}>${esc(d)} · ${esc(depNames.get(d) ?? d)}</option>`).join("");

  app.innerHTML = `<section class="page rankings">
    <header class="sec-hero"><p class="eyebrow">${L("Classements des communes", "Town rankings")}</p><h1 class="rk-title"></h1>
      <p class="dek">${L("Les 34 920 communes de France classées sur chaque chiffre publié : en France ou dans un département, par taille, d’un bout à l’autre.", "France’s 34,920 towns ranked on every published figure: nationally or within a department, by size, from either end.")}</p></header>
    <div class="rk-tools card">
      <label>${L("Classement", "Ranking")}${select}</label>
      <label>${L("Où", "Where")}<select class="rk-dep"><option value="">${L("Toute la France", "All of France")}</option>${home?.dep ? `<option value="${esc(home.dep)}">${esc(L(`Votre département : ${home.depName ?? home.dep}`, `Your department: ${home.depName ?? home.dep}`))}</option>` : ""}<optgroup label="${esc(L("Départements", "Departments"))}">${depOpts}</optgroup></select></label>
      <label>${L("Taille", "Size")}<select class="rk-min">${SIZES.map(([v, f, e]) => `<option value="${v}"${state.min === v ? " selected" : ""}>${esc(L(f, e))}</option>`).join("")}</select></label>
      <label>${L("Trouver une commune", "Find a town")}<input type="search" class="rk-q" placeholder="${esc(L("Nom de la commune", "Town name"))}" autocomplete="off"/></label>
      <button type="button" class="button rk-flip"></button>
    </div>
    <p class="rk-mine small"></p>
    <div class="table-scroll"><table class="table rk-table"><thead><tr><th class="num">${L("Rang", "Rank")}</th><th>${L("Commune", "Town")}</th><th>${L("Département", "Department")}</th><th class="num rk-vh"></th><th class="num">${L("Habitants", "People")}</th></tr></thead><tbody></tbody></table></div>
    <p class="rk-more-wrap"><button type="button" class="button rk-more">${L(`Afficher ${PAGE} de plus`, `Show ${PAGE} more`)}</button></p>
    <p class="muted tiny">${L("Rang 1 : le premier dans l’ordre choisi ; les ex æquo partagent un rang. Une commune manque quand le chiffre n’est pas publié pour elle (la délinquance, par exemple, n’est publiée que pour les communes où les faits sont assez nombreux). Dans une petite commune, quelques faits ou quelques ventes suffisent à faire bondir un chiffre : le filtre de taille aide à comparer des communes comparables. Contributeur ou bénéficiaire : pour la mairie, dotations et péréquation reçues moins versées par habitant (DGCL) ; pour un habitant typique, impôts et cotisations payés moins prestations et services reçus au niveau de vie médian de la commune (Insee). Sources : celles de chaque commune, voir ", "Rank 1: first in the chosen order; ties share a rank. A town is missing when the figure isn’t published for it (crime, for one, is only published where offences are numerous enough). In a small town a handful of offences or sales is enough to make a figure jump: the size filter helps compare like with like. Contributor or beneficiary: for the town hall, grants and equalisation received minus paid in, per inhabitant (DGCL); for a typical resident, taxes and contributions paid minus benefits and services received, at the town’s median standard of living (INSEE). Sources: each town’s, see ")}<a href="#/sources">${L("les sources", "the sources")}</a>.</p>
  </section>`;

  const $ = <T extends Element>(s: string) => app.querySelector<T>(s)!;
  const tbody = $<HTMLElement>("tbody");
  let rk: Ranking = rk0, values: (number | null)[] = [];
  let rows: { i: number; v: number; rank: number }[] = [];

  async function load() {
    values = await loadValues(rk.data);
    order();
  }
  function order() {
    const dir = state.flip ? (rk.dir === "desc" ? "asc" : "desc") : rk.dir;
    const pick: { i: number; v: number; q: number }[] = [];
    for (let i = 0; i < idx.codes.length; i++) {
      const v = values[i];
      if (v == null) continue;
      if (state.dep && idx.deps[i] !== state.dep) continue;
      if (state.min && (idx.pops[i] ?? 0) < state.min) continue;
      pick.push({ i, v, q: rk.data === "quality" ? qRanks?.[i] ?? 1e9 : 0 });
    }
    // the quality score is rounded: its exact national rank orders the ties
    pick.sort((a, b) => (dir === "desc" ? b.v - a.v : a.v - b.v) || (dir === rk.dir ? a.q - b.q : b.q - a.q));
    let prev: number | null = null, r = 0;
    rows = pick.map((p, n) => { if (p.v !== prev || p.q) { r = n + 1; prev = p.v; } return { i: p.i, v: p.v, rank: r }; });
    shown = PAGE;
    draw();
  }
  function rowHtml(x: { i: number; v: number; rank: number }) {
    const code = idx.codes[x.i];
    const cls = [code === focus ? "is-focus" : "", code === home?.code ? "is-home" : ""].filter(Boolean).join(" ");
    return `<tr${cls ? ` class="${cls}"` : ""} data-code="${code}"><td class="num">${fmtNum(x.rank)}</td><td><a href="#/ville/${code}">${esc(idx.names[x.i])}</a></td><td class="muted small">${esc(depNames.get(idx.deps[x.i]) ?? idx.deps[x.i])}</td><td class="num"><b>${fmtRankValue(x.v, rk)}</b></td><td class="num muted">${fmtNum(idx.pops[x.i])}</td></tr>`;
  }
  function draw() {
    const flipped = state.flip;
    const title = flipped ? L(`${L(...rk.label)} : l’autre bout du classement`, `${L(...rk.label)}: the other end of the ranking`) : L(...rk.title);
    $<HTMLElement>(".rk-title").textContent = title;
    document.title = `${title} — Third Estate`;
    $<HTMLElement>(".rk-vh").textContent = L(...rk.label);
    $<HTMLElement>(".rk-flip").textContent = flipped ? L("Revenir au début du classement", "Back to the top of the ranking") : L("Voir l’autre bout", "See the other end");
    const q = $<HTMLInputElement>(".rk-q").value.trim().toLocaleLowerCase("fr");
    const norm = (s: string) => s.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");
    const list = q ? rows.filter((x) => norm(idx.names[x.i]).includes(norm(q))) : rows;
    // the focused town (from a town page) is always shown, even past the first page
    const fi = focus ? list.findIndex((x) => idx.codes[x.i] === focus) : -1;
    if (fi >= shown) shown = Math.ceil((fi + 1) / PAGE) * PAGE;
    tbody.innerHTML = list.length ? list.slice(0, shown).map(rowHtml).join("") : `<tr><td colspan="5" class="muted">${L("Aucune commune dans cette sélection.", "No town in this selection.")}</td></tr>`;
    $<HTMLElement>(".rk-more-wrap").hidden = list.length <= shown;
    // where the reader's town (or the focused one) stands in this selection
    const me = focus ?? home?.code;
    const mine = me ? rows.find((x) => idx.codes[x.i] === me) : undefined;
    $<HTMLElement>(".rk-mine").innerHTML = mine
      ? `${esc(idx.names[mine.i])}${L(" : ", ": ")}<b>${L(`${fmtNum(mine.rank)}${mine.rank === 1 ? "ʳᵉ" : "ᵉ"} sur ${fmtNum(rows.length)}`, `#${fmtNum(mine.rank)} of ${fmtNum(rows.length)}`)}</b> ${L("dans cette sélection", "in this selection")} (${fmtRankValue(mine.v, rk)}). <a href="#" class="rk-goto">${L("Voir dans la liste", "See it in the list")}</a>`
      : me ? `<span class="muted">${L("Votre commune n’a pas ce chiffre ou n’est pas dans cette sélection.", "Your town doesn’t have this figure or isn’t in this selection.")}</span>` : "";
    app.querySelector(".rk-goto")?.addEventListener("click", (e) => {
      e.preventDefault();
      const i = rows.findIndex((x) => idx.codes[x.i] === me);
      if (i >= shown) { shown = Math.ceil((i + 1) / PAGE) * PAGE; draw(); }
      tbody.querySelector(`tr[data-code="${me}"]`)?.scrollIntoView({ block: "center" });
    });
  }

  $<HTMLSelectElement>(".rk-kpi").addEventListener("change", (e) => {
    rk = rankingBySlug((e.target as HTMLSelectElement).value) ?? RANKINGS[0];
    state.flip = false;
    history.replaceState(null, "", rankHref(rk, focus));
    void load();
  });
  $<HTMLSelectElement>(".rk-dep").value = state.dep;
  $<HTMLSelectElement>(".rk-dep").addEventListener("change", (e) => { state.dep = (e.target as HTMLSelectElement).value; order(); });
  $<HTMLSelectElement>(".rk-min").addEventListener("change", (e) => { state.min = Number((e.target as HTMLSelectElement).value); order(); });
  $<HTMLButtonElement>(".rk-flip").addEventListener("click", () => { state.flip = !state.flip; order(); });
  $<HTMLInputElement>(".rk-q").addEventListener("input", () => draw());
  $<HTMLButtonElement>(".rk-more").addEventListener("click", () => { shown += PAGE; draw(); });

  await load();
  if (focus) tbody.querySelector(`tr[data-code="${focus}"]`)?.scrollIntoView({ block: "center" });
}
