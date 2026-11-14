// Senate: hemicycle by group, every senator, and each senator's profile with every public vote.
// Data: scripts/sync-senat.mjs (Sénat open data and senat.fr, Licence Ouverte).
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, fmtPct } from "../i18n";
import { SENATE_SEATS, hemicycle, senateSeatRank } from "../lib/hemicycle";
import { esc, safeColor, safeUrl } from "../util";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Senateur {
  id: string; civ: string; prenom: string; nom: string; alpha: string; naissance?: string; profession?: string; catSocPro?: string;
  email?: string; groupe?: { id: string; abrev: string; libelle: string; couleur: string }; circonscription: string; numDepartement: string;
  commission?: { libelle: string; fonction?: string } | null; debutMandat: string; photo?: string; url?: string; hatvp?: string;
  socials?: Record<string, { url: string; handle?: string; source?: string }>;
  stats?: { pour: number; contre: number; abstention: number; nonVotant: number; scrutins: number; participation: number };
}
let senP: Promise<Senateur[]> | null = null;
export const loadSenateurs = () => (senP ??= fetchJson<Senateur[]>("/data/senat/senateurs.json"));
let scrP: Promise<any[]> | null = null;
const loadScrutins = () => (scrP ??= fetchJson<any[]>("/data/senat/scrutins.json"));

const age = (s: Senateur) => (s.naissance ? Math.floor((Date.now() - Date.parse(s.naissance)) / (365.25 * 86400000)) : null);
export const senPhoto = (s: Senateur) => (s.photo ? esc(safeUrl(s.photo)) : "");
const PARTICIPATION_NOTE = () =>
  L(
    "Au Sénat, le délégué de chaque groupe vote pour tous ses membres lors des scrutins publics ordinaires : la participation y mesure donc la présence d’une position, pas la présence en séance. Le président du Sénat ne vote pas, par usage.",
    "In the Senate, each group’s delegate casts the vote for all its members in ordinary public votes, so participation shows that a position was recorded, not attendance. By custom, the Senate President doesn’t vote.",
  );

const filter = { q: "", g: "", dep: "" };
/** `dep`: open on one department's senators (#/senat/92, "Mes sénateurs" in the menu); typing in the box lifts it. */
export async function renderSenat(app: HTMLElement, dep?: string) {
  const sens = await loadSenateurs();
  filter.dep = dep && sens.some((s) => s.numDepartement === dep) ? dep : "";
  if (filter.dep) filter.q = sens.find((s) => s.numDepartement === filter.dep)!.circonscription;
  const groups = [...new Map(sens.filter((s) => s.groupe).map((s) => [s.groupe!.id, s.groupe!])).values()].sort((a, b) => senateSeatRank(a) - senateSeatRank(b));
  const count = (id: string) => sens.filter((s) => s.groupe?.id === id).length;
  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Sénat", "Senate")}</p>
        <h1>${(() => { const big = [...groups].sort((a, b) => count(b.id) - count(a.id))[0]; return big ? esc(L(`${big.abrev}, premier groupe du Sénat avec ${count(big.id)} sièges sur ${SENATE_SEATS}`, `${big.abrev} is the Senate’s largest group, with ${count(big.id)} of ${SENATE_SEATS} seats`)) : L(`Les ${SENATE_SEATS} sénateurs, leurs groupes et leurs votes`, `The ${SENATE_SEATS} senators, their groups and their votes`); })()}</h1>
        <p class="dek">${L("Élus au suffrage indirect par les grands électeurs de chaque département. Cherchez votre département pour trouver vos sénateurs.", "Elected indirectly by each department’s electoral college. Search your department to find your senators.")}</p>
      </header>
      <div class="pres-grid">
        <section class="card">${hemicycle(groups.map((g) => ({ label: g.libelle, color: safeColor(g.couleur), seats: count(g.id) })), SENATE_SEATS)}</section>
        <section class="card"><ul class="legend-list">${groups.map((g) => `<li><i class="dot" style="background:${safeColor(g.couleur)}"></i>${esc(g.abrev)} <span class="muted">${esc(g.libelle)}</span><b>${count(g.id)}</b></li>`).join("")}</ul></section>
      </div>
      <section class="card">
        <div class="filters"><input id="q" type="search" placeholder="${L("Nom ou département…", "Name or department…")}" value="${esc(filter.q)}"/><select id="g"><option value="">${L("Tous les groupes", "All groups")}</option>${groups.map((g) => `<option value="${esc(g.id)}" ${g.id === filter.g ? "selected" : ""}>${esc(g.abrev)}</option>`).join("")}</select><span id="count" class="muted small"></span></div>
        <div class="mp-grid" id="list"></div>
      </section>
      <p class="source">${L("Source : Sénat (data.senat.fr, senat.fr), Licence Ouverte.", "Source: French Senate (data.senat.fr, senat.fr), Licence Ouverte.")}</p>
    </section>`;
  const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const draw = () => {
    const q = norm(filter.q);
    const rows = sens.filter((s) => (!filter.g || s.groupe?.id === filter.g) && (filter.dep ? s.numDepartement === filter.dep : !q || norm(`${s.prenom} ${s.nom} ${s.circonscription} ${s.numDepartement}`).includes(q))).sort((a, b) => a.alpha.localeCompare(b.alpha, "fr"));
    app.querySelector("#count")!.textContent = `${rows.length} ${L("sénateurs", "senators")}`;
    app.querySelector("#list")!.innerHTML = rows
      .map((s) => `<a class="mp-card card" href="#/senateur/${esc(s.id)}" style="--c:${safeColor(s.groupe?.couleur)}"><img src="${senPhoto(s)}" alt="" loading="lazy" data-hide-broken/><div><strong>${esc(s.prenom)} ${esc(s.nom)}</strong><span class="chip">${esc(s.groupe?.abrev ?? "")}</span><div class="muted small">${esc(s.circonscription)}</div></div></a>`)
      .join("");
  };
  app.querySelector<HTMLInputElement>("#q")!.addEventListener("input", (e) => { filter.q = (e.target as HTMLInputElement).value; filter.dep = ""; draw(); });
  app.querySelector<HTMLSelectElement>("#g")!.addEventListener("change", (e) => { filter.g = (e.target as HTMLSelectElement).value; draw(); });
  draw();
}

const PAGE = 20;
export async function renderSenateur(app: HTMLElement, id: string) {
  const [sens, scrutins, votes] = await Promise.all([loadSenateurs(), loadScrutins(), fetchJson<Record<string, string>>(`/data/senat/votes/${encodeURIComponent(id)}.json`).catch(() => ({}) as Record<string, string>)]);
  const s = sens.find((x) => x.id === id);
  if (!s) throw new Error(id);
  const st = s.stats;
  const f = { q: "", pos: "", page: 1 };
  const label: Record<string, string> = { P: L("Pour", "For"), C: L("Contre", "Against"), A: L("Abstention", "Abstain"), N: L("Non-votant", "Non-voting"), "-": L("Pas de position", "No position") };
  const mine = scrutins.filter((x) => x[1] >= s.debutMandat);
  app.innerHTML = `
    <section class="page">
      <p class="crumbs"><a href="#/senat">${L("Sénat", "Senate")}</a></p>
      <div class="mp-head card" style="--c:${safeColor(s.groupe?.couleur)}">
        <img src="${senPhoto(s)}" alt="" data-hide-broken/>
        <div class="mp-id"><p class="eyebrow">${L(s.civ === "Mme" ? "Sénatrice" : "Sénateur", "Senator")}, ${esc(s.circonscription)}</p><h1>${esc(s.civ)} ${esc(s.prenom)} ${esc(s.nom)}</h1><p><span class="chip">${esc(s.groupe?.abrev ?? "")}</span> ${esc(s.groupe?.libelle ?? "")}</p>
        <p class="muted small">${age(s) ?? "?"} ${L("ans", "years old")}${s.profession ? `, ${esc(s.profession)}` : ""}${s.commission ? `. ${esc(s.commission.libelle)}${s.commission.fonction ? ` (${esc(s.commission.fonction)})` : ""}` : ""}</p></div>
      </div>
      <div class="mp-grid-2">
        <div class="card">
          <h3>${L("Liens", "Links")}</h3>
          <ul class="socials">${s.url ? `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${L("Fiche officielle", "Official page")}</a></li>` : ""}${s.hatvp ? `<li><a href="${esc(safeUrl(s.hatvp))}" target="_blank" rel="noopener">HATVP</a></li>` : ""}${Object.entries(s.socials ?? {}).map(([k, v]) => `<li><a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">${esc(k)}</a></li>`).join("")}</ul>
        </div>
        <div class="card">
          ${st ? `<div class="kpis kpis-4"><div><span class="muted">${L("Scrutins", "Votes")}</span><strong>${fmtNum(st.scrutins)}</strong></div><div><span class="muted">${label.P}</span><strong class="pos-P">${fmtNum(st.pour)}</strong></div><div><span class="muted">${label.C}</span><strong class="pos-C">${fmtNum(st.contre)}</strong></div><div><span class="muted">${label.A}</span><strong class="pos-A">${fmtNum(st.abstention)}</strong></div></div><p class="small">${L("Position enregistrée : ", "Position recorded: ")}<b>${fmtPct(100 * st.participation, 0)}</b></p>` : ""}
          <p class="muted tiny">${PARTICIPATION_NOTE()}</p>
        </div>
      </div>
      <div class="card">
        <div class="filters"><input id="vq" type="search" placeholder="${L("Rechercher dans les scrutins…", "Search votes…")}"/><select id="vpos"><option value="">${L("Toutes positions", "All positions")}</option>${["P", "C", "A", "N", "-"].map((k) => `<option value="${k}">${label[k]}</option>`).join("")}</select><span id="vcount" class="muted small"></span></div>
        <ul class="votes" id="votes"></ul>
        <div class="pager"><button type="button" id="vprev">${L("Précédent", "Previous")}</button><span id="vpage" class="muted small"></span><button type="button" id="vnext">${L("Suivant", "Next")}</button></div>
      </div>
      <p class="source">${L("Source : Sénat, scrutins publics.", "Source: French Senate, public votes.")}</p>
    </section>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const rows = mine.filter((x) => { const p = votes[x[0]] ?? "-"; return (!f.pos || p === f.pos) && (!q || String(x[2]).toLowerCase().includes(q)); });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    f.page = Math.min(f.page, pages);
    app.querySelector("#vcount")!.textContent = `${rows.length} ${L("scrutins", "votes")}`;
    app.querySelector("#vpage")!.textContent = `${f.page} / ${pages}`;
    (app.querySelector("#vprev") as HTMLButtonElement).disabled = f.page <= 1;
    (app.querySelector("#vnext") as HTMLButtonElement).disabled = f.page >= pages;
    app.querySelector("#votes")!.innerHTML = rows
      .slice((f.page - 1) * PAGE, f.page * PAGE)
      .map(([sid, date, titre, sort, , p, c, a, , dossier]) => { const pos = votes[sid] ?? "-"; return `<li><div class="vote-meta muted small">${fmtDate(date)}, n° ${esc(sid)}, <span class="${/adopt/i.test(sort) ? "sort-ok" : "sort-ko"}">${esc(sort)}</span> (${p}–${c}–${a})</div><div class="vote-title">${dossier ? `<a href="${esc(safeUrl(dossier))}" target="_blank" rel="noopener">${esc(titre)}</a>` : esc(titre)}</div><span class="pos pos-${pos} bg-${pos}">${label[pos]}</span></li>`; })
      .join("");
  };
  app.querySelector<HTMLInputElement>("#vq")!.addEventListener("input", (e) => { f.q = (e.target as HTMLInputElement).value; f.page = 1; draw(); });
  app.querySelector<HTMLSelectElement>("#vpos")!.addEventListener("change", (e) => { f.pos = (e.target as HTMLSelectElement).value; f.page = 1; draw(); });
  app.querySelector("#vprev")!.addEventListener("click", () => { f.page--; draw(); });
  app.querySelector("#vnext")!.addEventListener("click", () => { f.page++; draw(); });
  draw();
}
