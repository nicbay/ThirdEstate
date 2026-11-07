// National Assembly: map (France → department → district), MP list, composition analysis.
import { loadAnMeta, loadCircoGeo, loadDepartements, loadDeputes, loadLeg24, type Depute } from "../data";
import { L, fmtDate, fmtPct } from "../i18n";
import { NUANCE_LABEL, nuanceColor } from "../lib/candidates";
import { OVERSEAS_DEPS, abroadInset, insetFigure, mapPaths, rewind } from "../lib/map";
import { esc, groupBy, safeColor } from "../util";
import { hemicycle, seatRank } from "../lib/hemicycle";
import { renderDeputes } from "./deputes";

export const PLATFORMS = ["twitter", "facebook", "instagram", "linkedin", "website"] as const;
/** Digital presence: how many of the 5 main channels the MP declares to the Assemblée (0–5). */
export const presence = (d: Depute) => PLATFORMS.filter((p) => d.socials[p]).length;
export const age = (d: Depute) => (d.naissance ? Math.floor((Date.now() - Date.parse(d.naissance)) / (365.25 * 86400000)) : null);

let mapMode: "groupe" | "leg24" = "groupe";

export async function renderAssemblee(app: HTMLElement, tab = "carte", dep?: string) {
  const all = await loadDeputes().catch(() => [] as Depute[]);
  const byGroup = new Map<string, number>();
  for (const d of all) if (d.groupe?.abrev) byGroup.set(d.groupe.abrev, (byGroup.get(d.groupe.abrev) ?? 0) + 1);
  const [bigG, bigN] = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const h1 = bigN && bigN < 289
    ? L(`Aucune majorité : le premier groupe, ${bigG}, n’a que ${bigN} sièges sur 577`, `No majority: the largest group, ${bigG}, has only ${bigN} of 577 seats`)
    : L("Qui siège à l’Assemblée, et pour qui ont voté leurs circonscriptions", "Who sits in the Assembly, and how their districts voted");
  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <p class="eyebrow">${L("Assemblée nationale, 17e législature", "National Assembly, 17th legislature")}</p>
        <h1>${esc(h1)}</h1>
        <p class="dek">${L("Choisissez un département sur la carte pour voir ses circonscriptions, leur député et leur vote de 2024.", "Pick a department on the map to see its districts, their MP and how they voted in 2024.")}</p>
        <nav class="tabs">
          <a role="tab" href="#/assemblee" aria-selected="${tab === "carte"}">${L("Carte", "Map")}</a>
          <a role="tab" href="#/assemblee/deputes" aria-selected="${tab === "deputes"}">${L("Députés", "MPs")}</a>
          <a role="tab" href="#/assemblee/composition" aria-selected="${tab === "composition"}">${L("Qui sont les députés ?", "Who are the MPs?")}</a>
        </nav>
      </div>
      <div id="pane"></div>
    </section>`;
  const pane = app.querySelector<HTMLElement>("#pane")!;
  if (tab === "deputes") return renderDeputes(pane);
  if (tab === "composition") return composition(pane);
  return mapView(pane, dep);
}

async function mapView(pane: HTMLElement, dep?: string) {
  const [geo, deputes, leg] = await Promise.all([loadDepartements(), loadDeputes(), loadLeg24()]);
  const byCirco = new Map(deputes.filter((d) => d.circo).map((d) => [d.circo!, d]));
  const byDep = groupBy(deputes, (d) => d.numDepartement ?? "");
  const features = geo.features.map(rewind);
  const depName = (code: string) => features.find((f) => f.properties!.code === code)?.properties!.nom ?? (code === "99" ? L("Français de l’étranger", "French abroad") : code);

  // department colour = group holding most of its seats
  const depColor = (code: string) => {
    const mps = byDep.get(code) ?? [];
    const count = new Map<string, { n: number; c: string }>();
    for (const d of mps) if (d.groupe) count.set(d.groupe.id, { n: (count.get(d.groupe.id)?.n ?? 0) + 1, c: safeColor(d.groupe.couleur) });
    const top = [...count.values()].sort((a, b) => b.n - a.n)[0];
    return { fill: top?.c ?? "var(--wash)", opacity: top ? 0.35 + (0.65 * top.n) / mps.length : 1 };
  };
  const circoFill = (code: string) => {
    if (mapMode === "leg24") {
      const lead = leg.circos[code]?.c[0];
      return lead ? nuanceColor(lead[0]) : "var(--wash)";
    }
    return safeColor(byCirco.get(code)?.groupe?.couleur) ?? "var(--wash)";
  };

  pane.innerHTML = `
    <div class="pres-grid">
      <article class="card">
        <header class="card-head"><h2>${L("Le groupe le plus représenté par département", "Largest group in each department")}</h2></header>
        <svg id="fr" viewBox="0 0 600 600"></svg>
        <div class="overseas-label">${L("Outre-mer et étranger", "Overseas and abroad")}</div>
        <div class="overseas">${OVERSEAS_DEPS.map((c) => insetFigure(`<svg viewBox="0 0 100 100" class="inset" data-inset="${c}"></svg>`, depName(c))).join("")}<div class="inset-fig" id="abroad-slot"></div></div>
        <p class="muted small">${L("Plus la couleur est franche, plus ce groupe domine le département.", "The stronger the colour, the more that group dominates the department.")}</p>
      </article>
      <aside class="card panel" id="dep"></aside>
    </div>`;

  const drawFrance = () => {
    const area = (code: string) => ({ ...depColor(code), title: `${depName(code)} · ${(byDep.get(code) ?? []).length} ${L("députés", "MPs")}`, selected: code === dep });
    pane.querySelector("#fr")!.innerHTML = mapPaths(features.filter((f) => f.properties!.code.length === 2), [600, 600], area);
    for (const c of OVERSEAS_DEPS) {
      const f = features.find((x) => x.properties!.code === c);
      if (f) pane.querySelector(`[data-inset="${c}"]`)!.innerHTML = mapPaths([f], [100, 100], area, "mercator");
    }
    pane.querySelector("#abroad-slot")!.innerHTML = abroadInset({
      ...depColor("99"),
      title: `${L("Français de l’étranger", "French abroad")} · ${(byDep.get("99") ?? []).length} ${L("députés", "MPs")}`,
      label: L("Français de l’étranger", "French abroad"),
      sub: L("11 circ.", "11 districts"),
      selected: dep === "99",
    });
    pane.querySelectorAll<SVGElement | HTMLElement>("#fr [data-code], .inset [data-code], .abroad").forEach((el) =>
      el.addEventListener("click", () => (location.hash = `#/assemblee/${el.dataset.code}`)),
    );
  };

  const drawDep = async () => {
    const box = pane.querySelector<HTMLElement>("#dep")!;
    if (!dep) {
      const groups = [...groupBy(deputes.filter((d) => d.groupe), (d) => d.groupe!.id).values()].sort((a, b) => seatRank(a[0].groupe!.abrev) - seatRank(b[0].groupe!.abrev));
      box.innerHTML = `<h2>${L("Les groupes, de gauche à droite", "The groups, left to right")}</h2>
        ${hemicycle(groups.map((g) => ({ label: g[0].groupe!.libelle, color: safeColor(g[0].groupe!.couleur), seats: g.length })))}
        <p class="muted small">${deputes.length} ${L("députés en exercice", "sitting MPs")}${deputes.length < 577 ? L(` ; ${577 - deputes.length} sièges vacants`, `; ${577 - deputes.length} seats vacant`) : ""}.</p>
        <ul class="legend-list">${groups.map((g) => `<li><i class="dot" style="background:${safeColor(g[0].groupe!.couleur)}"></i>${esc(g[0].groupe!.abrev)} <span class="muted">${esc(g[0].groupe!.libelle)}</span><b>${g.length}</b></li>`).join("")}</ul>`;
      return;
    }
    const mps = (byDep.get(dep) ?? []).sort((a, b) => (a.numCirco ?? 0) - (b.numCirco ?? 0));
    box.innerHTML = `<p class="muted small"><a href="#/assemblee">${L("France", "France")}</a> ›</p>
      <h2>${esc(depName(dep))} <span class="muted">(${dep})</span></h2>
      <div class="tabs small-tabs"><button type="button" data-mode="groupe" aria-selected="${mapMode === "groupe"}">${L("Député actuel", "Current MP")}</button><button type="button" data-mode="leg24" aria-selected="${mapMode === "leg24"}">${L("En tête au 1er tour 2024", "First-round leader 2024")}</button></div>
      <svg id="circos" viewBox="0 0 400 320"></svg>
      <ul class="circo-list">${mps
        .map((d) => {
          const lead = leg.circos[d.circo!]?.c[0];
          return `<li><a href="#/circo/${d.circo}"><span class="num-badge">${d.numCirco}</span><span><b>${esc(d.prenom)} ${esc(d.nom)}</b> <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">${esc(d.groupe?.abrev ?? "—")}</span><br><span class="muted small">${L("1er tour 2024", "2024 1st round")} : ${lead ? `${esc(NUANCE_LABEL[lead[0]] ?? lead[0])} ${lead[1]} %` : "–"}</span></span></a></li>`;
        })
        .join("")}</ul>`;
    box.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => { mapMode = b.dataset.mode as typeof mapMode; drawDep(); }));
    try {
      const g = await loadCircoGeo(dep);
      box.querySelector("#circos")!.innerHTML = mapPaths(g.features.map(rewind), [400, 320], (code) => {
        const d = byCirco.get(code);
        return { fill: circoFill(code), title: `${code.slice(-2)} · ${d ? `${d.prenom} ${d.nom} (${d.groupe?.abrev})` : ""}` };
      }, dep.length === 3 ? "mercator" : "france");
      box.querySelectorAll<SVGElement>("#circos [data-code]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/circo/${el.dataset.code}`)));
    } catch {
      box.querySelector("#circos")!.remove(); // e.g. French abroad: no map
    }
  };
  drawFrance();
  await drawDep();
}

async function composition(pane: HTMLElement) {
  const [deputes, meta] = await Promise.all([loadDeputes(), loadAnMeta()]);
  const groups = [...groupBy(deputes.filter((d) => d.groupe), (d) => d.groupe!.id).values()].sort((a, b) => seatRank(a[0].groupe!.abrev) - seatRank(b[0].groupe!.abrev));
  const fams = [...new Set(deputes.map((d) => d.famSocPro ?? L("Non renseigné", "Not stated")))].sort((a, b) => deputes.filter((d) => (d.famSocPro ?? "") === b).length - deputes.filter((d) => (d.famSocPro ?? "") === a).length);
  const famColor = (i: number) => ["#1d4ed8", "#0ea5e9", "#14b8a6", "#f59e0b", "#a855f7", "#ef4444", "#64748b", "#94a3b8", "#cbd5e1"][i % 9];
  const famOf = (d: Depute) => d.famSocPro ?? L("Non renseigné", "Not stated");
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const pct = (n: number, d: number) => fmtPct((100 * n) / d, 0);

  const stack = (mps: Depute[]) => `<div class="stackbar">${fams.map((f, i) => { const n = mps.filter((d) => famOf(d) === f).length; return n ? `<span style="flex:${n};background:${famColor(i)}" title="${esc(f)} : ${n}"></span>` : ""; }).join("")}</div>`;

  pane.innerHTML = `
    <article class="card">
      <header class="card-head"><h2>${L("Origine socio-professionnelle", "Socio-professional background")}</h2></header>
      <p class="muted small">${L("Catégorie INSEE de la profession déclarée par chaque député à l’Assemblée.", "INSEE category of the occupation each MP declared to the Assemblée.")}</p>
      <ul class="legend-list inline">${fams.map((f, i) => `<li><i class="dot" style="background:${famColor(i)}"></i>${esc(f)} <b>${pct(deputes.filter((d) => famOf(d) === f).length, deputes.length)}</b></li>`).join("")}</ul>
      <table class="table">
        <thead><tr><th>${L("Groupe", "Group")}</th><th>${L("Répartition", "Breakdown")}</th><th class="num">${L("Cadres", "Managers & prof.")}</th></tr></thead>
        <tbody>
          <tr><td><b>${L("Assemblée", "Whole house")}</b></td><td>${stack(deputes)}</td><td class="num">${pct(deputes.filter((d) => d.famSocPro?.startsWith("Cadres")).length, deputes.length)}</td></tr>
          ${groups.map((g) => `<tr><td><span class="chip" style="--c:${safeColor(g[0].groupe!.couleur)}">${esc(g[0].groupe!.abrev)}</span></td><td>${stack(g)}</td><td class="num">${pct(g.filter((d) => d.famSocPro?.startsWith("Cadres")).length, g.length)}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="muted small">${L("Comparaison avec la population française : à ajouter depuis les données INSEE (voir Sources).", "Comparison with the French population: to be added from INSEE data (see Sources).")}</p>
    </article>

    <div class="grid-2">
      <article class="card">
        <header class="card-head"><h2>${L("Âge", "Age")}</h2></header>
        <table class="table"><thead><tr><th>${L("Groupe", "Group")}</th><th class="num">${L("Âge médian", "Median age")}</th><th class="num">${L("Femmes", "Women")}</th></tr></thead>
          <tbody>
            <tr><td><b>${L("Assemblée", "Whole house")}</b></td><td class="num">${median(deputes.map(age).filter((a): a is number => a != null))}</td><td class="num">${pct(deputes.filter((d) => d.civ === "Mme").length, deputes.length)}</td></tr>
            ${groups.map((g) => `<tr><td><span class="chip" style="--c:${safeColor(g[0].groupe!.couleur)}">${esc(g[0].groupe!.abrev)}</span></td><td class="num">${median(g.map(age).filter((a): a is number => a != null))}</td><td class="num">${pct(g.filter((d) => d.civ === "Mme").length, g.length)}</td></tr>`).join("")}
          </tbody></table>
      </article>
      <article class="card">
        <header class="card-head"><h2>${L("Présence numérique", "Digital presence")}</h2></header>
        <p class="muted small">${L("Part des députés déclarant chaque réseau à l’Assemblée, et score moyen (nombre de réseaux sur 5).", "Share of MPs declaring each channel to the Assemblée, and mean score (channels out of 5).")}</p>
        <table class="table"><thead><tr><th>${L("Groupe", "Group")}</th>${PLATFORMS.map((p) => `<th class="num">${p === "website" ? "Web" : p === "twitter" ? "X" : p[0].toUpperCase() + p.slice(1, 5)}</th>`).join("")}<th class="num">Score</th></tr></thead>
          <tbody>
            ${[[L("Assemblée", "Whole house"), deputes, null] as const, ...groups.map((g) => [g[0].groupe!.abrev, g, safeColor(g[0].groupe!.couleur)] as const)]
              .map(([label, mps, color]) => `<tr><td>${color ? `<span class="chip" style="--c:${color}">${esc(label)}</span>` : `<b>${esc(label)}</b>`}</td>${PLATFORMS.map((p) => `<td class="num">${pct(mps.filter((d) => d.socials[p]).length, mps.length)}</td>`).join("")}<td class="num"><b>${(mps.reduce((s, d) => s + presence(d), 0) / mps.length).toFixed(1)}</b></td></tr>`)
              .join("")}
          </tbody></table>
      </article>
    </div>
    <p class="source muted">${L("Source : open data de l’Assemblée nationale, synchronisé le", "Source: Assemblée nationale open data, synced")} ${fmtDate(meta.syncedAt)}</p>`;
}
