// One legislative district: where it is, who represents it, how it voted in 2024.
import { districtResults2024, loadCircoGeo, loadDepartements, loadDeputes } from "../data";
import { L, fmtNum, fmtPct } from "../i18n";
import { NUANCE_LABEL, nuanceColor } from "../lib/candidates";
import { mapPaths, rewind } from "../lib/map";
import { esc, safeColor } from "../util";
import { PLATFORMS, age, presence } from "./assemblee";
import { photoUrl } from "./deputes";
import { renderDistrictProfile } from "./district-profile";

export async function renderCirco(app: HTMLElement, code: string) {
  const dep = code.slice(0, -2);
  const num = Number(code.slice(-2));
  const [deputes, deps] = await Promise.all([loadDeputes(), loadDepartements()]);
  const d = deputes.find((x) => x.circo === code);
  const depName = deps.features.find((f) => f.properties!.code === dep)?.properties!.nom ?? (dep === "99" ? L("Français établis hors de France", "French residents abroad") : dep);
  const ordinal = L(`${num}${num === 1 ? "re" : "e"} circonscription`, `District ${num}`);

  app.innerHTML = `
    <section class="page">
      <p class="muted small crumbs"><a href="#/assemblee">${L("Assemblée", "Assembly")}</a> › <a href="#/assemblee/${dep}">${esc(depName)}</a> › ${ordinal}</p>
      <div class="page-head"><h1>${esc(depName)} · ${ordinal}</h1></div>
      <div class="pres-grid">
        <div class="stack-col">
          ${
            d
              ? `<article class="card mp-head" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">
              <img src="${photoUrl(d.id)}" alt="" data-hide-broken />
              <div class="mp-id">
                <p class="eyebrow">${L("Député·e", "MP")}</p>
                <h2><a href="#/depute/${d.id}">${esc(d.prenom)} ${esc(d.nom)}</a></h2>
                <p><span class="chip">${esc(d.groupe?.abrev ?? "—")}</span> ${esc(d.groupe?.libelle ?? "")}</p>
                <p class="muted small">${age(d) ?? "?"} ${L("ans", "years old")} · ${esc(d.profession ?? L("profession non déclarée", "no occupation stated"))}</p>
              </div>
            </article>
            <article class="card">
              <div class="kpis kpis-4">
                <div><span class="muted">${L("Participation", "Participation")}</span><strong>${fmtPct(100 * d.stats.participation, 0)}</strong></div>
                <div><span class="muted">${L("Pour", "For")}</span><strong class="pos-P">${fmtNum(d.stats.pour)}</strong></div>
                <div><span class="muted">${L("Contre", "Against")}</span><strong class="pos-C">${fmtNum(d.stats.contre)}</strong></div>
                <div><span class="muted">${L("Présence numérique", "Digital presence")}</span><strong>${presence(d)}/${PLATFORMS.length}</strong></div>
              </div>
              <p><a class="button" href="#/depute/${d.id}">${L("Profil complet et tous ses votes", "Full profile and every vote")}</a></p>
            </article>`
              : `<article class="card"><p>${L("Siège actuellement vacant ou non renseigné.", "Seat currently vacant or not listed.")}</p></article>`
          }
          <article class="card">
            <header class="card-head"><h2>${L("Législatives 2024 · 1er tour", "2024 legislative · first round")}</h2></header>
            <div id="res"><p class="muted">${L("Chargement depuis data.gouv.fr…", "Loading from data.gouv.fr…")}</p></div>
          </article>
        </div>
        <article class="card"><svg id="m" viewBox="0 0 400 400"></svg><p class="muted small">${L("En surbrillance : cette circonscription dans son département.", "Highlighted: this district within its department.")}</p></article>
      </div>
      <div id="profile" class="stack-col"></div>
    </section>`;
  renderDistrictProfile(app.querySelector<HTMLElement>("#profile")!, code);

  // district map (missing for French abroad)
  loadCircoGeo(dep)
    .then((g) => {
      app.querySelector("#m")!.innerHTML = mapPaths(g.features.map(rewind), [400, 400], (c) => ({ fill: c === code ? safeColor(d?.groupe?.couleur) ?? "var(--ink)" : "var(--wash)", title: `${L("Circonscription", "District")} ${Number(c.slice(-2))}`, selected: c === code }), dep.length === 3 ? "mercator" : "france");
      app.querySelectorAll<SVGElement>("#m [data-code]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/circo/${el.dataset.code}`)));
    })
    .catch(() => app.querySelector("#m")?.closest(".card")?.remove());

  // live results
  try {
    const { url, rows } = await districtResults2024(code);
    const r0 = rows[0];
    app.querySelector("#res")!.innerHTML = rows.length
      ? `<p class="muted small">${L("Participation", "Turnout")} ${fmtPct((100 * r0.Votants) / r0.Inscrits)} · ${fmtNum(r0.Exprimes)} ${L("suffrages exprimés", "valid votes")}</p>
        <ol class="bars">${rows
          .map((r) => `<li><div class="bar-label"><span><i class="dot" style="background:${nuanceColor(r.CodNuaCand)}"></i>${esc(r.PrenomPsn)} <b>${esc(r.NomPsn)}</b> <span class="muted">${esc(NUANCE_LABEL[r.CodNuaCand] ?? r.CodNuaCand)}</span>${/oui/i.test(r.Elu) ? ` <span class="tag">${L("élu·e au 1er tour", "won outright")}</span>` : /qualif/i.test(r.Elu) ? ` <span class="tag">${L("qualifié·e", "qualified")}</span>` : ""}</span><b>${fmtPct(r.RapportExprimes)}</b></div><div class="bar"><div style="width:${r.RapportExprimes}%;background:${nuanceColor(r.CodNuaCand)}"></div></div></li>`)
          .join("")}</ol>
        <p class="source muted">${L("Requête en direct : ministère de l’Intérieur via l’API data.gouv.fr", "Live query: Ministry of the Interior via the data.gouv.fr API")} · <a href="${esc(url)}" target="_blank" rel="noopener">API</a></p>`
      : `<p class="muted">${L("Aucun résultat trouvé pour cette circonscription.", "No result found for this district.")}</p>`;
  } catch (e) {
    app.querySelector("#res")!.innerHTML = `<p class="error">${L("API data.gouv.fr indisponible", "data.gouv.fr API unavailable")} (${esc((e as Error).message)})</p>`;
  }
}
