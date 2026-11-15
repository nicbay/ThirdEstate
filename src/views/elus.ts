// "Élus" hub (#/elus): the section's front door. Three chambers, each with its head count and where to go:
// the 577 MPs (Assemblée nationale), the 348 senators, France's members of the European Parliament.
// Counts come from the synced files; a chamber whose file is missing simply shows no number.
import { fetchJson, loadDeputes } from "../data";
import { L, fmtNum } from "../i18n";
import { getHome } from "../lib/cloud";
import { esc } from "../util";
import { loadSenateurs } from "./senat";

export async function renderElus(app: HTMLElement) {
  const [deputes, sens, meps] = await Promise.all([
    loadDeputes().catch(() => null),
    loadSenateurs().catch(() => null),
    fetchJson<unknown>("/data/pe/meps.json").catch(() => null),
  ]);
  const nMeps = Array.isArray(meps) ? meps.length : Array.isArray((meps as { meps?: unknown[] } | null)?.meps) ? (meps as { meps: unknown[] }).meps.length : null;
  const home = getHome();
  const n = (v: number | null | undefined) => (v ? `<strong class="elus-n">${fmtNum(v)}</strong>` : "");
  const door = (href: string, title: string, note: string) => `<a class="door" href="${href}"><b>${esc(title)}</b><span class="muted small">${esc(note)}</span></a>`;
  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Élus", "Elected officials")}</p>
        <h1>${L("Ceux qui votent les lois, et ce qu’ils en disent", "Those who vote on the laws, and what they say about them")}</h1>
        <p class="dek">${L("Les députés, les sénateurs et les eurodéputés français : chacun de leurs votes publics et leurs mots en séance, d’après les données officielles de chaque assemblée.", "France’s MPs, senators and members of the European Parliament: every recorded vote and what they say in the chamber, from each assembly’s official data.")}</p>
      </header>
      <div class="elus-grid">
        <section class="card elus-ch">
          <header class="card-head"><h2>${L("Assemblée nationale", "National Assembly")}</h2></header>
          ${n(deputes?.length)}<p class="muted small">${L("députés, élus au suffrage direct dans 577 circonscriptions", "MPs, elected directly in 577 districts")}</p>
          <nav class="doors">${door("#/assemblee", L("Les députés", "The MPs"), L("La carte, qui ils sont, comment ils votent, ce qu’ils disent", "The map, who they are, how they vote, what they say"))}${door("#/assemblee/deputes", L("Trouver un député", "Find an MP"), L("Par nom, par groupe ou par commune", "By name, group or town"))}</nav>
        </section>
        <section class="card elus-ch">
          <header class="card-head"><h2>${L("Sénat", "Senate")}</h2></header>
          ${n(sens?.length)}<p class="muted small">${L("sénateurs, élus par les grands électeurs de chaque département", "senators, elected by each department’s electoral college")}</p>
          <nav class="doors">${door("#/senat", L("Les sénateurs", "Senators"), L("Leurs groupes, leurs votes, ce qu’ils disent", "Their groups, their votes, what they say"))}${home?.dep ? door(`#/senat/${home.dep}`, L("Mes sénateurs", "My senators"), home.depName ?? home.dep) : ""}</nav>
        </section>
        <section class="card elus-ch">
          <header class="card-head"><h2>${L("Parlement européen", "European Parliament")}</h2></header>
          ${n(nMeps)}<p class="muted small">${L("eurodéputés élus en France en juin 2024, pour cinq ans", "MEPs elected in France in June 2024, for five years")}</p>
          <nav class="doors">${door("#/europe", L("Les eurodéputés", "MEPs"), L("Leurs votes en plénière et leurs discours", "Their plenary votes and speeches"))}</nav>
        </section>
      </div>
      <p class="source">${L("Sources : Assemblée nationale, Sénat, Parlement européen (données ouvertes officielles).", "Sources: National Assembly, Senate, European Parliament (official open data).")} <a href="#/sources">${L("Sources et méthode", "Sources & method")}</a></p>
    </section>`;
}
