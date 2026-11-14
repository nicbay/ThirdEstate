import { loadAnMeta, loadDeputes, loadScrutins, loadVotes, type Depute } from "../data";
import { entrySentence, entryTag } from "../lib/mandate";
import { L, fmtDate, fmtNum, fmtPct, t } from "../i18n";
import { PLATFORMS, age, presence } from "./assemblee";
import { esc, safeUrl, safeColor } from "../util";
import { photoUrl } from "./deputes";
import { pcsCategoryLabel, pcsGroup, pcsGroupLabel } from "../lib/pcs";
import { mountMpLoyalty } from "./loyalty";
import { renderMpSpeech } from "./speeches";

const PAGE = 20;
const href = (platform: string, v: string) => (v.startsWith("http") ? v : (SOCIAL_URL[platform] ?? ((h: string) => h))(v));
const PLATFORM_LABEL: Record<string, string> = { twitter: "X", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", bluesky: "Bluesky", tiktok: "TikTok", youtube: "YouTube", mastodon: "Mastodon", website: "Site web" };
const SOURCE_LABEL: Record<string, [string, string]> = {
  assemblee: ["déclaré à l’Assemblée", "declared to the Assemblée"], an: ["déclaré à l’Assemblée", "declared to the Assemblée"],
  wikidata: ["Wikidata", "Wikidata"], site: ["lié depuis son site", "linked from their website"], override: ["vérifié manuellement", "checked by hand"],
  nosdeputes: ["NosDéputés.fr", "NosDéputés.fr"], bluesky: ["recherche Bluesky", "Bluesky search"], group: ["page du groupe ou du parti", "group or party page"], party: ["page du parti", "party page"],
};
const SOCIAL_URL: Record<string, (h: string) => string> = {
  twitter: (h) => `https://x.com/${h.replace(/^@/, "")}`,
  instagram: (h) => `https://www.instagram.com/${h.replace(/^@/, "")}`,
  facebook: (h) => (h.startsWith("http") ? h : `https://www.facebook.com/${h}`),
  linkedin: (h) => (h.startsWith("http") ? h : `https://www.linkedin.com/in/${h}`),
  bluesky: (h) => `https://bsky.app/profile/${h.replace(/^@/, "")}`,
  tiktok: (h) => `https://www.tiktok.com/@${h.replace(/^@/, "")}`,
  youtube: (h) => (h.startsWith("http") ? h : `https://www.youtube.com/${h}`),
  website: (h) => (h.startsWith("http") ? h : `https://${h}`),
};

export async function renderDepute(app: HTMLElement, id: string) {
  const [deputes, scrutins, votes, meta] = await Promise.all([loadDeputes(), loadScrutins(), loadVotes(id), loadAnMeta()]);
  const d = deputes.find((x) => x.id === id);
  if (!d) throw new Error(id);
  const s = t();
  const st = d.stats;
  const cast = st.pour + st.contre + st.abstention;
  const pct = (n: number) => (cast ? (100 * n) / cast : 0);
  const idx = deputes.indexOf(d);
  const prev = deputes[idx - 1];
  const next = deputes[idx + 1];

  // Only votes held while this MP sat.
  const mine = scrutins.filter((x) => x[1] >= d.debutMandat);
  const f = { q: "", pos: "", sort: "", page: 1 };

  app.innerHTML = `
    <section class="page">
      <p class="muted small crumbs"><a href="#/assemblee">${L("Assemblée", "Assembly")}</a> › ${d.numDepartement ? `<a href="#/assemblee/${d.numDepartement}">${esc(d.departement ?? d.numDepartement)}</a> › ` : ""}${d.circo ? `<a href="#/circo/${d.circo}">${L("Circonscription", "District")} ${d.numCirco}</a> › ` : ""}${esc(d.prenom)} ${esc(d.nom)}</p>
      <div class="mp-head card" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">
        <img src="${photoUrl(d.id)}" alt="" data-hide-broken />
        <div class="mp-id">
          <h1>${esc(d.civ)} ${esc(d.prenom)} ${esc(d.nom)}</h1>
          <p><span class="chip">${esc(d.groupe?.abrev ?? "—")}</span> ${esc(d.groupe?.libelle ?? "")}${entryTag(d) ? ` <span class="tag mp-entry-tag">${esc(entryTag(d)!)}</span>` : ""}</p>
          <p class="mp-entry small">${esc(entrySentence(d))}</p>
          <p class="muted">${d.departement && d.numCirco ? `<a href="#/circo/${d.circo}">${esc(s.district(d.departement, d.numCirco))}</a>` : ""}</p>
        </div>
        <nav class="mp-nav small">
          ${prev ? `<a href="#/depute/${prev.id}">← ${esc(prev.prenom)} ${esc(prev.nom)}</a>` : "<span></span>"}
          ${next ? `<a href="#/depute/${next.id}">${esc(next.prenom)} ${esc(next.nom)}</a>` : ""}
        </nav>
      </div>

      <div id="mp-speech"></div>

      <div class="mp-grid-2">
        <div class="card">
          <dl class="facts">
            ${d.naissance ? `<dt>${s.born}</dt><dd>${fmtDate(d.naissance)} (${age(d)} ${L("ans", "years")})</dd>` : ""}
            ${d.profession ? `<dt>${s.profession}</dt><dd>${esc(d.profession)}</dd>` : ""}
            ${d.catSocPro ? `<dt>${s.socioCategory}</dt><dd>${pcsGroup(d.famSocPro) === "none" ? "" : `${esc(pcsGroupLabel(pcsGroup(d.famSocPro)))} — `}${esc(pcsCategoryLabel(d.catSocPro))}</dd>` : ""}
            ${d.hatvp ? `<dt>HATVP</dt><dd><a href="${esc(safeUrl(d.hatvp))}" target="_blank" rel="noopener">${s.hatvp} ↗</a> <span class="muted small">${L("parcours, activités et intérêts déclarés", "declared career, activities and interests")}</span></dd>` : ""}
            <dt>LinkedIn</dt><dd>${
              d.socials.linkedin
                ? `<a href="${esc(safeUrl(href("linkedin", d.socials.linkedin)))}" target="_blank" rel="noopener">${L("Voir le profil", "View profile")}</a>`
                : `<a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${d.prenom} ${d.nom} député`)}" target="_blank" rel="noopener">${L("Rechercher sur LinkedIn", "Search LinkedIn")} ↗</a> <span class="muted small">${L("aucun profil déclaré", "no profile declared")}</span>`
            }</dd>
          </dl>
          <h3>${s.contact} <span class="score" title="${L("Nombre de réseaux déclarés sur 5 (X, Facebook, Instagram, LinkedIn, site web)", "Channels declared out of 5 (X, Facebook, Instagram, LinkedIn, website)")}">${L("Présence numérique", "Digital presence")} ${presence(d)}/${PLATFORMS.length}</span></h3>
          <ul class="socials">
            ${d.email ? `<li><a href="mailto:${esc(d.email)}">✉ ${esc(d.email)}</a></li>` : ""}
            ${Object.entries(d.socials)
              .map(([k, v]) => {
                const src = d.socialSources?.[k]?.source;
                const lbl = src ? SOURCE_LABEL[src] ?? [src, src] : SOURCE_LABEL.assemblee;
                return `<li><a href="${esc(safeUrl(href(k, v)))}" target="_blank" rel="noopener">${esc(PLATFORM_LABEL[k] ?? k)}</a> <span class="muted small">${esc(L(lbl[0], lbl[1]))}</span></li>`;
              })
              .join("")}
          </ul>
        </div>
        <div class="card">
          <div class="kpis kpis-4">
            <div><span class="muted">${s.scrutins}</span><strong>${fmtNum(st.scrutins)}</strong></div>
            <div><span class="muted">${s.for}</span><strong class="pos-P">${fmtNum(st.pour)}</strong></div>
            <div><span class="muted">${s.against}</span><strong class="pos-C">${fmtNum(st.contre)}</strong></div>
            <div><span class="muted">${s.abstention}</span><strong class="pos-A">${fmtNum(st.abstention)}</strong></div>
          </div>
          <div class="stack" aria-hidden="true">
            <div class="bg-P" style="width:${pct(st.pour)}%"></div><div class="bg-A" style="width:${pct(st.abstention)}%"></div><div class="bg-C" style="width:${pct(st.contre)}%"></div>
          </div>
          <p class="small">${s.participation} <b>${fmtPct(100 * st.participation, 0)}</b> · ${s.shareFor} <b>${fmtPct(st.pour + st.contre ? (100 * st.pour) / (st.pour + st.contre) : 0)}</b></p>
        </div>
      </div>

      <details class="card mp-votes">
        <summary><h2>${L(`Tous ses votes, un par un (${fmtNum(st.scrutins)})`, `All their votes, one by one (${fmtNum(st.scrutins)})`)}</h2></summary>
        <div class="filters">
          <input id="vq" type="search" placeholder="${s.searchVotes}" />
          <select id="vpos">
            <option value="">${s.allPositions}</option>
            <option value="P">${s.for}</option><option value="C">${s.against}</option><option value="A">${s.abstention}</option><option value="N">${s.nonVoting}</option><option value="-">${s.absent}</option>
          </select>
          <select id="vsort"><option value="">${s.allOutcomes}</option><option value="adopté">${s.adopted}</option><option value="rejeté">${s.rejected}</option></select>
          <span id="vcount" class="muted"></span>
        </div>
        <ul id="votes" class="votes"></ul>
        <div class="pager"><button id="vprev" type="button">${s.prev}</button><span id="vpage" class="muted"></span><button id="vnext" type="button">${s.next}</button></div>
      </details>
      <p class="source muted">${s.sourceAN(fmtDate(meta.syncedAt))}</p>
    </section>`;

  void mountMpLoyalty(app.querySelector(".mp-grid-2")!, d); // group-loyalty card (src/views/loyalty.ts)
  const label: Record<string, string> = { P: s.for, C: s.against, A: s.abstention, N: s.nonVoting, "-": s.absent };
  const draw = () => {
    const q = f.q.toLowerCase();
    const rows = mine.filter((x) => {
      const p = votes[x[0]] ?? "-";
      return (!f.pos || p === f.pos) && (!f.sort || x[3] === f.sort) && (!q || x[2].toLowerCase().includes(q) || String(x[0]) === q);
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    f.page = Math.min(f.page, pages);
    app.querySelector("#vcount")!.textContent = s.results(rows.length);
    app.querySelector("#vpage")!.textContent = s.page(f.page, pages);
    (app.querySelector("#vprev") as HTMLButtonElement).disabled = f.page <= 1;
    (app.querySelector("#vnext") as HTMLButtonElement).disabled = f.page >= pages;
    app.querySelector("#votes")!.innerHTML = rows
      .slice((f.page - 1) * PAGE, f.page * PAGE)
      .map(([num, date, titre, sort, dem, p, c, a]) => {
        const pos = votes[num] ?? "-";
        return `<li>
          <div class="vote-meta muted small">${fmtDate(date)} · n° ${num} · <span class="sort-${sort === "adopté" ? "ok" : "ko"}">${sort === "adopté" ? s.adopted : s.rejected}</span> (${p}–${c}–${a})</div>
          <div class="vote-title"><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${num}" target="_blank" rel="noopener">${esc(titre)}</a></div>
          ${dem ? `<div class="muted small">${s.requestedBy}${L(" : ", ": ")}${esc(dem)}</div>` : ""}
          <span class="pos pos-${pos} bg-${pos}">${label[pos]}</span>
        </li>`;
      })
      .join("");
  };
  const on = (sel: string, ev: string, fn: (v: string) => void) => app.querySelector(sel)!.addEventListener(ev, (e) => { fn((e.target as HTMLInputElement).value); draw(); });
  on("#vq", "input", (v) => { f.q = v; f.page = 1; });
  on("#vpos", "change", (v) => { f.pos = v; f.page = 1; });
  on("#vsort", "change", (v) => { f.sort = v; f.page = 1; });
  void renderMpSpeech(app.querySelector<HTMLElement>("#mp-speech")!, d).catch(console.error);
  app.querySelector("#vprev")!.addEventListener("click", () => { f.page--; draw(); });
  app.querySelector("#vnext")!.addEventListener("click", () => { f.page++; draw(); });
  draw();
}

export type { Depute };
