// National Assembly: one page, one tab bar (map, who they are, toeing the line, what they say, find an MP).
import { loadAnMeta, loadCircoGeo, loadDepartements, loadDeputes, loadLeg24, type Depute } from "../data";
import { L, fmtDate, fmtNum, fmtPct } from "../i18n";
import { NUANCE_LABEL, nuanceColor } from "../lib/candidates";
import { OVERSEAS_DEPS, abroadInset, insetFigure, mapPaths, rewind } from "../lib/map";
import { esc, groupBy, safeColor } from "../util";
import { AN_SEATS, assemblyMajorityNote, hemicycle, seatRank, seatSummary } from "../lib/hemicycle";
import { INSEE_EMPLOYED_2024, INSEE_SOURCE, PCS_ORDER, pcsGroup, pcsGroupLabel, type PcsGroup } from "../lib/pcs";
import { renderDeputes } from "./deputes";
import { renderLoyalty } from "./loyalty";
import { renderThemes } from "./speeches";

export const PLATFORMS = ["twitter", "facebook", "instagram", "linkedin", "website"] as const;
const PLATFORM_SHORT: Record<(typeof PLATFORMS)[number], string> = { twitter: "X", facebook: "FB", instagram: "IG", linkedin: "LI", website: "Web" };
const PLATFORM_NAME: Record<(typeof PLATFORMS)[number], () => string> = {
  twitter: () => "X (Twitter)", facebook: () => "Facebook", instagram: () => "Instagram", linkedin: () => "LinkedIn", website: () => L("Site web", "Website"),
};
/** Digital presence: how many of the 5 main channels the MP declares to the Assemblée (0–5). */
export const presence = (d: Depute) => PLATFORMS.filter((p) => d.socials[p]).length;
export const age = (d: Depute) => (d.naissance ? Math.floor((Date.now() - Date.parse(d.naissance)) / (365.25 * 86400000)) : null);

let mapMode: "groupe" | "leg24" = "groupe";

export async function renderAssemblee(app: HTMLElement, tab = "carte", dep?: string) {
  const all = await loadDeputes().catch(() => [] as Depute[]);
  const byGroup = new Map<string, number>();
  for (const d of all) if (d.groupe?.abrev) byGroup.set(d.groupe.abrev, (byGroup.get(d.groupe.abrev) ?? 0) + 1);
  const [bigG, bigN] = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const seats = seatSummary(AN_SEATS, all.length);
  // One Assembly page: five views behind one tab bar. Each view keeps its own URL (#/assemblee/<tab>), so old links still land.
  const TABS: { key: string; href: string; fr: string; en: string }[] = [
    { key: "carte", href: "#/assemblee", fr: "La carte", en: "The map" },
    { key: "composition", href: "#/assemblee/composition", fr: "Qui ils sont", en: "Who they are" },
    { key: "loyaute", href: "#/assemblee/loyaute", fr: "Doigt sur la couture", en: "Toeing the line" },
    { key: "themes", href: "#/assemblee/themes", fr: "Ce qu’ils disent", en: "What they say" },
    { key: "deputes", href: "#/assemblee/deputes", fr: "Trouver un député", en: "Find an MP" },
  ];
  const head: Record<string, [string, string]> = {
    loyaute: [L("Du doigt sur la couture à la fronde, qui vote toujours comme son groupe", "From toeing the line to open rebellion, who always votes with their group"),
      L("Sur chaque scrutin public, chaque député comparé à la ligne de son groupe : du vote aveugle à la fronde.", "On every public vote, each MP compared with their group’s line: from blind obedience to open rebellion.")],
    composition: [L("Qui siège à l’Assemblée, par âge, métier et parité", "Who sits in the Assembly, by age, occupation and gender"),
      L("La sociologie des députés, groupe par groupe, comparée à celle des Français qui travaillent.", "The MPs’ backgrounds, group by group, compared with France’s workforce.")],
    themes: [L("Ce qu’ils disent, les mots et les thèmes de l’hémicycle", "What they say, the words and themes of the chamber"),
      L("Chaque intervention en séance publique, ramenée à ses mots les plus caractéristiques.", "Every speech in public sitting, boiled down to its most distinctive words.")],
    deputes: [L("Trouver un député, par nom, département ou groupe", "Find an MP, by name, department or group"),
      L("Les députés en exercice : ouvrez une fiche pour ses votes, ses interventions et sa circonscription.", "The sitting MPs: open a profile for their votes, speeches and district.")],
  };
  const [h1, dek] = head[tab] ?? [
    bigN && bigN < seats.majority
      ? L(`Aucune majorité : le premier groupe, ${bigG}, n’a que ${bigN} sièges sur ${seats.statutory}`, `No majority: the largest group, ${bigG}, has only ${bigN} of ${seats.statutory} seats`)
      : L("Qui siège à l’Assemblée, et pour qui ont voté leurs circonscriptions", "Who sits in the Assembly, and how their districts voted"),
    L("Choisissez un département sur la carte pour voir ses circonscriptions, leur député et leur vote de 2024.", "Pick a department on the map to see its districts, their MP and how they voted in 2024."),
  ];
  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <p class="eyebrow">${L("Assemblée nationale, 17e législature", "National Assembly, 17th legislature")}</p>
        <h1>${esc(h1)}</h1>
        <p class="dek">${dek}</p>
        <nav class="tabs page-tabs" aria-label="${esc(L("Les vues de l’Assemblée", "Assembly views"))}">
          ${TABS.map((x) => `<a href="${x.href}"${x.key === tab ? ` aria-current="page"` : ""}>${L(x.fr, x.en)}</a>`).join("")}
        </nav>
      </div>
      <div id="pane"></div>
    </section>`;
  const pane = app.querySelector<HTMLElement>("#pane")!;
  if (tab === "deputes") return renderDeputes(pane);
  if (tab === "composition") return composition(pane);
  if (tab === "loyaute") return renderLoyalty(pane);
  if (tab === "themes") return renderThemes(pane);
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
        ${hemicycle(groups.map((g) => ({ label: g[0].groupe!.libelle, color: safeColor(g[0].groupe!.couleur), seats: g.length })), AN_SEATS)}
        <p class="muted small">${assemblyMajorityNote(deputes.length)}</p>
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
          return `<li><a href="#/circo/${d.circo}"><span class="num-badge">${d.numCirco}</span><span><b>${esc(d.prenom)} ${esc(d.nom)}</b> <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">${esc(d.groupe?.abrev ?? "—")}</span><br><span class="muted small">${L("1er tour 2024", "2024 1st round")}${L(" : ", ": ")}${lead ? `${esc(NUANCE_LABEL[lead[0]] ?? lead[0])} ${fmtPct(lead[1])}` : "–"}</span></span></a></li>`;
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
  const famOf = (d: Depute) => pcsGroup(d.famSocPro);
  const famCount = (mps: Depute[], f: PcsGroup) => mps.filter((d) => famOf(d) === f).length;
  // largest first, "not stated" always last; colours stay tied to the category, not its rank
  const fams = PCS_ORDER.filter((f) => famCount(deputes, f)).sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : famCount(deputes, b) - famCount(deputes, a)));
  const FAM_COLOR: Record<PcsGroup, string> = { cadres: "#1d4ed8", intermediaires: "#0ea5e9", artisans: "#14b8a6", employes: "#f59e0b", agri: "#a855f7", ouvriers: "#ef4444", none: "#94a3b8" };
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const pct = (n: number, d: number) => fmtPct((100 * n) / d, 0);
  const colon = L(" : ", ": ");

  const stack = (mps: Depute[]) => `<div class="stackbar">${fams.map((f) => { const n = famCount(mps, f); return n ? `<span style="flex:${n};background:${FAM_COLOR[f]}" title="${esc(`${pcsGroupLabel(f)}${colon}${n}`)}"></span>` : ""; }).join("")}</div>`;

  // Assembly vs people in employment (INSEE): same six PCS groups
  const share = (f: PcsGroup) => (100 * famCount(deputes, f)) / deputes.length;
  const maxShare = Math.max(...PCS_ORDER.map((f) => Math.max(share(f), INSEE_EMPLOYED_2024[f])));
  const bar = (v: number, cls: string) => `<span class="pcs-track"><span class="pcs-bar ${cls}" style="width:${((100 * v) / maxShare).toFixed(1)}%"></span></span>`;
  const ratio = (f: PcsGroup) => {
    const a = share(f), p = INSEE_EMPLOYED_2024[f];
    if (f === "none" || !p) return "–";
    const r = a / p, x = r >= 1 ? r : 1 / r;
    if (!a) return L("aucun", "none");
    return `${r >= 1 ? "×" : "÷"}${x.toLocaleString(L("fr-FR", "en-GB"), { maximumFractionDigits: x >= 10 ? 0 : 1 })}`;
  };
  const pcsRows = PCS_ORDER.filter((f) => f !== "none").map((f) => `<tr>
      <th scope="row">${esc(pcsGroupLabel(f))}</th>
      <td class="pcs-cell"><div>${bar(share(f), "is-an")}<span class="num">${fmtPct(share(f), 1)}</span></div></td>
      <td class="pcs-cell"><div>${bar(INSEE_EMPLOYED_2024[f], "is-pop")}<span class="num">${fmtPct(INSEE_EMPLOYED_2024[f], 1)}</span></div></td>
      <td class="num">${ratio(f)}</td></tr>`).join("");
  const noneN = famCount(deputes, "none");

  pane.innerHTML = `
    <article class="card">
      <header class="card-head"><h2>${L("Origine socio-professionnelle", "Socio-professional background")}</h2></header>
      <p class="muted small">${L("Catégorie INSEE de la profession déclarée par chaque député à l’Assemblée.", "INSEE category of the occupation each MP declared to the Assemblée.")}</p>
      <ul class="legend-list inline">${fams.map((f) => `<li><i class="dot" style="background:${FAM_COLOR[f]}"></i>${esc(pcsGroupLabel(f))} <b>${pct(famCount(deputes, f), deputes.length)}</b></li>`).join("")}</ul>
      <div class="table-scroll"><table class="table">
        <thead><tr><th>${L("Groupe", "Group")}</th><th>${L("Répartition", "Breakdown")}</th><th class="num">${L("Cadres", "Managers & prof.")}</th></tr></thead>
        <tbody>
          <tr><td><b>${L("Assemblée", "Whole house")}</b></td><td>${stack(deputes)}</td><td class="num">${pct(famCount(deputes, "cadres"), deputes.length)}</td></tr>
          ${groups.map((g) => `<tr><td><span class="chip" style="--c:${safeColor(g[0].groupe!.couleur)}">${esc(g[0].groupe!.abrev)}</span></td><td>${stack(g)}</td><td class="num">${pct(famCount(g, "cadres"), g.length)}</td></tr>`).join("")}
        </tbody>
      </table></div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("L’Assemblée ressemble-t-elle aux Français qui travaillent ?", "Does the Assembly look like France’s workforce?")}</h2></header>
      <p class="muted small">${L(
        `Part de chaque catégorie parmi les ${fmtNum(deputes.length)} députés, comparée à sa part parmi les personnes en emploi en France.`,
        `Share of each category among the ${fmtNum(deputes.length)} MPs, compared with its share of people in employment in France.`,
      )}</p>
      <div class="table-scroll"><table class="table pcs-table">
        <thead><tr><th>${L("Catégorie", "Category")}</th><th><i class="dot pcs-an"></i>${L("Députés", "MPs")}</th><th><i class="dot pcs-pop"></i>${L("En emploi", "In work")}</th><th class="num" title="${esc(L("Part chez les députés rapportée à la part dans la population en emploi", "Share among MPs relative to the share among people in work"))}">${L("Écart", "Ratio")}</th></tr></thead>
        <tbody>${pcsRows}</tbody>
      </table></div>
      <p class="muted small">${L(
        `Les ${noneN} députés sans profession déclarée (${fmtPct((100 * noneN) / deputes.length, 1)}) ne sont rangés dans aucune catégorie. Pour les députés, c’est la profession déclarée, souvent celle exercée avant l’élection ; pour la population, l’emploi occupé en 2024. Les retraités et les personnes sans emploi ne figurent pas dans la référence.`,
        `The ${noneN} MPs with no occupation stated (${fmtPct((100 * noneN) / deputes.length, 1)}) are in no category. For MPs this is the occupation they declared, often the one held before election; for the population, the job held in 2024. Retirees and people out of work are not in the reference.`,
      )} ${L("Source", "Source")}${colon}<a href="${INSEE_SOURCE.url}" target="_blank" rel="noopener">${esc(INSEE_SOURCE.name())}</a>${L(" (France, logements ordinaires).", " (France, ordinary housing).")}</p>
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
        <div class="table-scroll"><table class="table presence-table"><thead><tr><th>${L("Groupe", "Group")}</th>${PLATFORMS.map((p) => `<th class="num"><abbr title="${esc(PLATFORM_NAME[p]())}">${PLATFORM_SHORT[p]}</abbr></th>`).join("")}<th class="num"><abbr title="${esc(L("Nombre moyen de réseaux déclarés, sur 5", "Mean number of channels declared, out of 5"))}">${L("Score", "Score")}</abbr></th></tr></thead>
          <tbody>
            ${[[L("Assemblée", "Whole house"), deputes, null] as const, ...groups.map((g) => [g[0].groupe!.abrev, g, safeColor(g[0].groupe!.couleur)] as const)]
              .map(([label, mps, color]) => `<tr><td>${color ? `<span class="chip" style="--c:${color}">${esc(label)}</span>` : `<b>${esc(label)}</b>`}</td>${PLATFORMS.map((p) => `<td class="num">${pct(mps.filter((d) => d.socials[p]).length, mps.length)}</td>`).join("")}<td class="num"><b>${(mps.reduce((s, d) => s + presence(d), 0) / mps.length).toFixed(1)}</b></td></tr>`)
              .join("")}
          </tbody></table></div>
      </article>
    </div>
    <p class="source muted">${L("Source : open data de l’Assemblée nationale, synchronisé le", "Source: Assemblée nationale open data, synced")} ${fmtDate(meta.syncedAt)}</p>`;
}
