import { loadAnMeta, loadDeputes, type Depute } from "../data";
import { entryTag } from "../lib/mandate";
import { fmtDate, fmtPct, t } from "../i18n";
import { esc, safeColor } from "../util";

let filter = { q: "", groupe: "" };

export async function renderDeputes(app: HTMLElement) {
  const [deputes, meta] = await Promise.all([loadDeputes(), loadAnMeta()]);
  const s = t();
  const groupes = [...new Map(deputes.filter((d) => d.groupe).map((d) => [d.groupe!.id, d.groupe!])).values()].sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));

  // Embedded in the Assemblée section (tab "Députés").
  app.innerHTML = `
    <div class="card">
      <div class="filters">
        <input id="q" type="search" placeholder="${s.search}" value="${esc(filter.q)}" />
        <select id="g"><option value="">${s.allGroups}</option>${groupes.map((g) => `<option value="${g.id}" ${g.id === filter.groupe ? "selected" : ""}>${esc(g.abrev)} — ${esc(g.libelle)}</option>`).join("")}</select>
        <span id="count" class="muted"></span>
      </div>
      <div id="list" class="mp-grid"></div>
    </div>
    <p class="source muted">${s.sourceAN(fmtDate(meta.syncedAt))}</p>`;

  const list = app.querySelector<HTMLElement>("#list")!;
  const draw = () => {
    const q = norm(filter.q);
    const rows = deputes.filter((d) => (!filter.groupe || d.groupe?.id === filter.groupe) && (!q || norm(`${d.prenom} ${d.nom} ${d.departement} ${d.numDepartement} ${d.groupe?.abrev}`).includes(q)));
    app.querySelector("#count")!.textContent = s.results(rows.length);
    list.innerHTML = rows.map(card).join("");
  };
  app.querySelector<HTMLInputElement>("#q")!.addEventListener("input", (e) => {
    filter.q = (e.target as HTMLInputElement).value;
    draw();
  });
  app.querySelector<HTMLSelectElement>("#g")!.addEventListener("change", (e) => {
    filter.groupe = (e.target as HTMLSelectElement).value;
    draw();
  });
  draw();
}

const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export const photoUrl = (id: string) => `https://www2.assemblee-nationale.fr/static/tribun/17/photos/carre/${String(id).slice(2).replace(/D/g, "")}.jpg`;

function card(d: Depute) {
  const s = t();
  return `
    <a class="mp-card card" href="#/depute/${d.id}" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">
      <img src="${photoUrl(d.id)}" alt="" loading="lazy" data-hide-broken />
      <div>
        <strong>${esc(d.prenom)} ${esc(d.nom)}</strong>
        <span class="chip">${esc(d.groupe?.abrev ?? "—")}</span>${entryTag(d) ? ` <span class="tag mp-entry-tag">${esc(entryTag(d)!)}</span>` : ""}
        <div class="muted small">${d.departement && d.numCirco ? esc(s.district(d.departement, d.numCirco)) : ""}</div>
        <div class="muted small">${s.participation} ${fmtPct(100 * d.stats.participation, 0)}</div>
      </div>
    </a>`;
}
