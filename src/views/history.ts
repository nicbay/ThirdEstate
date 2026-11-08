// History of French presidential elections, 1848–2022: a timeline, then one page per election
// with each round's result, the archive announcement (video, radio, newspaper) and, where
// available, results by department.
import { loadDepartements, loadHistElection, loadHistIndex, type HistCandidate, type HistMedia, type HistRound, type Side } from "../data";
import { L, fmtDate, fmtNum, fmtPct, getLang } from "../i18n";
import { pct } from "../lib/format";
import { mapPaths, rewind } from "../lib/map";
import { esc, safeUrl } from "../util";

/** Only these players may be framed (security review M2). */
const EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "player.ina.fr", "www.ina.fr", "archive.org", "commons.wikimedia.org"]);
const embedAllowed = (u: string) => {
  try { const x = new URL(u); return x.protocol === "https:" && EMBED_HOSTS.has(x.hostname); } catch { return false; }
};

// French convention: left red, right blue.
export const SIDE_COLOR: Record<Side, string> = { left: "#d4253a", centre: "#f2a400", right: "#1f5fcf", other: "#9aa0a8" };
const sideColor = (s: Side | undefined) => SIDE_COLOR[s ?? "other"] ?? SIDE_COLOR.other;
const REGIMES: Record<string, [string, string]> = {
  "IIe": ["Deuxième République", "Second Republic"],
  "IIIe": ["Troisième République", "Third Republic"],
  "IVe": ["Quatrième République", "Fourth Republic"],
  "Ve": ["Cinquième République", "Fifth Republic"],
};
const MEDIA_LABEL: Record<string, [string, string]> = {
  tv: ["Annonce télévisée", "TV announcement"],
  radio: ["Archive radio", "Radio archive"],
  newsreel: ["Actualités filmées", "Newsreel"],
  newspaper: ["À la une le lendemain", "Next day’s front page"],
};
/** Lower-case form used inside a sentence ("TV" keeps its capitals). */
const MEDIA_INLINE: Record<string, [string, string]> = {
  tv: ["annonce télévisée", "TV announcement"],
  radio: ["archive radio", "radio archive"],
  newsreel: ["actualités filmées", "newsreel"],
  newspaper: ["une du lendemain", "next day’s front page"],
};
const mediaInline = (t?: string) => (t ? L(...(MEDIA_INLINE[t] ?? [t, t])) : "");
/** Accessible name for an archive item, from its type, the election year and its title. */
function mediaAlt(type: string, year: number | string, winner: string, title?: string) {
  const kind = L(...(MEDIA_LABEL[type] ?? [type, type]));
  const what = L(`élection de ${winner}, ${year}`, `${winner}’s election, ${year}`);
  return `${kind}${L(" : ", ": ")}${what}${title ? L(` (« ${title} »)`, ` (“${title}”)`) : ""}`;
}

/** English names for the historical party labels in the results files (French stays as published).
 *  Acronyms (SFIO, MRP, RPR…) are proper names and stay as they are in both languages. */
const PARTY_EN: Record<string, string> = {
  "Bonapartiste": "Bonapartist",
  "Conservateur": "Conservative",
  "Divers gauche": "Miscellaneous left",
  "Démocrate-socialiste": "Democratic socialist",
  "Extrême gauche": "Far left",
  "Gauche démocratique": "Democratic left",
  "Indépendant": "Independent",
  "Ind": "Independent",
  "IND": "Independent",
  "Légitimiste": "Legitimist",
  "Parti nationaliste": "Nationalist party",
  "Parti nationaliste / Groupe de la Défense nationale": "Nationalist party / National Defence group",
  "Parti orléaniste": "Orléanist party",
  "Républicain modéré": "Moderate republican",
  "Républicains modérés": "Moderate republicans",
  "Républicains de gauche": "Left republicans",
  "Républicains de gouvernement": "Government republicans",
  "Républicains progressistes": "Progressive republicans",
  "Républicains radicaux": "Radical republicans",
  "Républicains ralliés": "Rallied republicans",
  "Sans étiquette": "No party",
  "Socialiste": "Socialist",
  "Union républicaine": "Republican Union",
  "Les Verts (RP&S)": "The Greens (RP&S)",
};
export const partyLabel = (p: string | undefined) => (p ? (getLang() === "en" ? PARTY_EN[p] ?? p : p) : "");

export async function renderHistoryList(pane: HTMLElement) {
  const idx = await loadHistIndex();
  const byRegime = new Map<string, typeof idx.elections>();
  for (const e of idx.elections) byRegime.set(e.regime, [...(byRegime.get(e.regime) ?? []), e]);
  pane.innerHTML = [...byRegime.entries()]
    .reverse()
    .map(
      ([regime, els]) => `
      <section class="card">
        <header class="card-head"><h2>${esc(L(...(REGIMES[regime] ?? [regime, regime])))}</h2><span class="muted small">${esc(L(els[0].method.fr, els[0].method.en))}</span></header>
        <ol class="timeline">${[...els]
          .reverse()
          .map((e) => {
            const dec = e.rounds.find((r) => r.decisive) ?? e.rounds.at(-1)!;
            const [a, b] = dec.top;
            const m = dec.media;
            const yt = m?.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1];
            // the thumbnail is decorative (alt=""): the button's accessible name describes the item
            const alt = m ? mediaAlt(m.type, e.year, e.winner.name, (m as { title?: string }).title) : "";
            const vid = m
              ? `<button type="button" class="t-vid${m.type === "radio" ? " is-audio" : ""}" data-el="${esc(e.id)}" aria-label="${esc(`${L("Lire", "Play")}${L(" : ", ": ")}${alt}`)}" title="${esc(alt)}">${yt ? `<img src="https://i.ytimg.com/vi/${yt}/mqdefault.jpg" alt="" loading="lazy"/>` : ""}<span class="t-play" aria-hidden="true"></span><span class="t-vid-cap" aria-hidden="true">${esc(L(...(MEDIA_LABEL[m.type] ?? [m.type, m.type])))}</span></button>`
              : "";
            const shown = m?.type ?? e.rounds.map((r) => r.media?.type).find(Boolean);
            return `<li class="t-row">${vid}<a href="#/histoire/${e.id}">
              <span class="t-year">${e.id.replace("-01", L(" (janv.)", " (Jan.)")).replace("-09", L(" (sept.)", " (Sept.)"))}</span>
              <span class="t-body"><b>${esc(e.winner.name)}</b> <span class="muted">${esc(partyLabel(e.winner.party))}</span>
                <span class="t-bar">${a ? `<span style="width:${a.pct}%;background:${sideColor(a.side)}"></span>` : ""}${b ? `<span style="width:${b.pct}%;background:${sideColor(b.side)};opacity:.45"></span>` : ""}</span>
                <span class="muted small">${a ? `${esc(a.name)} ${pct(a.pct)}` : ""}${b ? `, ${esc(b.name)} ${pct(b.pct)}` : ""}${e.rounds.length > 1 ? `, ${e.rounds.length} ${e.direct ? L("tours", "rounds") : L("scrutins", "ballots")}` : ""}${shown ? `, ${L("en archive", "on file")}${L(" : ", ": ")}${esc(mediaInline(shown))}` : ""}</span>
              </span></a></li>`;
          })
          .join("")}</ol>
      </section>`,
    )
    .join("") + LIST_SOURCE();
  // each row's small player: the decisive round's announcement, loaded only when clicked
  pane.querySelectorAll<HTMLButtonElement>(".t-vid").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const el = await loadHistElection(btn.dataset.el!).catch(() => null);
      const r = el?.rounds.find((x) => x.decisive) ?? el?.rounds.at(-1);
      const src = r?.media ? embedUrl(r.media) : null;
      if (!r?.media) return;
      if (!src) { window.open(safeUrl(r.media.url), "_blank", "noopener"); return; }
      const auto = /youtube-nocookie/.test(src) ? `${src}${src.includes("?") ? "&" : "?"}autoplay=1` : src;
      const box = document.createElement("div");
      box.className = `t-vid is-playing${btn.classList.contains("is-audio") ? " is-audio" : ""}`;
      box.innerHTML = `<iframe src="${esc(safeUrl(auto))}" title="${esc(r.media.title ?? btn.title ?? btn.dataset.el!)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      btn.replaceWith(box);
    }),
  );
}

const LIST_SOURCE = () => `<p class="source">${L("Résultats nationaux : tableaux de Wikipédia, chacun relié à sa source officielle (Conseil constitutionnel, Journal officiel). Départements : CDSP Sciences Po et ministère de l’Intérieur (data.gouv.fr), Cagé–Piketty pour 1848. Archives : INA, TF1 INFO, Gallica.", "National results: Wikipedia tables, each tied to its official source (Constitutional Council, Journal officiel). Departments: Sciences Po CDSP and the Ministry of the Interior (data.gouv.fr), Cagé–Piketty for 1848. Archives: INA, TF1 INFO, Gallica.")}</p>`;


export async function renderElection(app: HTMLElement, id: string) {
  const [e, geo, idx] = await Promise.all([loadHistElection(id), loadDepartements(), loadHistIndex()]);
  const regime = typeof e.regime === "string" ? e.regime : e.regime.id;
  const pos = idx.elections.findIndex((x) => x.id === id);
  const prev = idx.elections[pos - 1], next = idx.elections[pos + 1];
  const fr = getLang() === "fr";

  app.innerHTML = `
    <section class="page">
      <p class="crumbs"><a href="#/resultats/presidentielles">${L("Présidentielles depuis 1848", "Presidential elections since 1848")}</a></p>
      <header class="page-head">
        <p class="eyebrow">${esc(L(...(REGIMES[regime] ?? [regime, regime])))}, ${esc(fr ? e.method.fr : e.method.en)}</p>
        <h1>${esc(fr ? `${e.winner.name} élu président en ${e.year}` : `${e.winner.name} elected president in ${e.year}`)}</h1>
        <p class="dek">${esc(partyLabel(e.winner.party))}${e.rounds.length > 1 ? `, ${fr ? `après ${e.rounds.length} ${e.direct ? "tours" : "scrutins"}` : `after ${e.rounds.length} ${e.direct ? "rounds" : "ballots"}`}` : ""}.</p>
      </header>
      ${[...e.rounds].reverse().map((r) => roundBlock(r, e.direct)).join("")}
      <nav class="mp-nav">${prev ? `<a href="#/histoire/${prev.id}">${prev.id}</a>` : "<span></span>"}${next ? `<a href="#/histoire/${next.id}">${next.id}</a>` : ""}</nav>
    </section>`;

  // department maps (current départements only; the 1965 files use pre-1968 codes)
  const features = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
  for (const r of e.rounds) {
    const box = app.querySelector<HTMLElement>(`[data-map="${r.id}"]`);
    if (!box || !r.departments) continue;
    const rows = Object.fromEntries(Object.entries(r.departments.rows).map(([k, v]) => [k.length === 1 ? `0${k}` : k, v]));
    const matched = features.filter((f) => rows[f.properties!.code]).length;
    if (matched < 60) {
      box.innerHTML = `<p class="muted small">${L("Résultats par département disponibles, mais dans l’ancien découpage d’avant 1968 : pas de carte.", "Department results exist, but for the pre-1968 departments, so no map.")}</p>`;
      continue;
    }
    const byId = new Map(r.candidates.map((c) => [c.id, c]));
    box.innerHTML = `<svg viewBox="0 0 500 500" class="hist-map">${mapPaths(features, [500, 500], (code) => {
      const row = rows[code];
      if (!row) return { fill: "var(--wash)", title: code };
      const [lead, second] = Object.entries(row.votes).sort((a, b) => b[1] - a[1]);
      const c = byId.get(lead[0]);
      const pct = (100 * lead[1]) / row.exprimes;
      const margin = second ? pct - (100 * second[1]) / row.exprimes : pct;
      return { fill: sideColor(c?.side), opacity: Math.min(1, 0.3 + margin / 40), title: `${row.name}\n${c?.name ?? lead[0]} ${fmtPct(pct)}` };
    })}</svg><p class="muted small">${L("Candidat en tête par département ; couleur plus franche = écart plus large.", "Leading candidate in each department; stronger colour = wider lead.")} ${r.departments.coveragePct ? `${L("Couverture", "Coverage")} ${fmtPct(r.departments.coveragePct, 0)}.` : ""}</p>`;
  }
}

function roundBlock(r: HistRound, direct: boolean) {
  const fr = getLang() === "fr";
  const label = direct ? (r.round === 1 && !r.decisive ? L("Premier tour", "First round") : r.round === 2 ? L("Second tour", "Runoff") : L("Tour unique", "Single round")) : `${L("Scrutin", "Ballot")} ${r.round}`;
  const max = Math.max(...r.candidates.map((c) => c.pct), 1);
  return `
    <section class="card">
      <header class="card-head"><h2>${label}, ${fmtDate(r.date)}</h2>${r.turnoutPct ? `<span class="muted small">${L("Participation", "Turnout")} ${fmtPct(r.turnoutPct)}, ${fmtNum(r.totals.exprimes)} ${L("suffrages exprimés", "valid votes")}</span>` : `<span class="muted small">${fmtNum(r.totals.exprimes)} ${L("voix exprimées", "votes cast")}</span>`}</header>
      <div class="pres-grid">
        <div>
          <ol class="bars">${r.candidates.map((c) => candidateBar(c, max)).join("")}</ol>
          ${r.checks?.length ? `<p class="muted small">${L("La source publiée ne s’additionne pas exactement ; chiffres laissés tels quels.", "The published source doesn’t add up exactly; figures left as published.")}</p>` : ""}
          ${r.departments ? `<div data-map="${r.id}"></div>` : ""}
        </div>
        <div>${mediaBlock(r.media, r.mediaAlternatives)}${!r.media && r.mediaSearched ? `<p class="muted small">${L("Aucune archive vérifiée pour ce tour.", "No verified archive for this round.")}</p>` : ""}</div>
      </div>
      <p class="source">${esc(r.sources.national.name)}${r.sources.national.permalink ? `, <a href="${esc(safeUrl(r.sources.national.permalink))}" target="_blank" rel="noopener">${fr ? "version consultée" : "revision used"}</a>` : ""}${r.sources.national.licence ? ` (${esc(r.sources.national.licence)})` : ""}</p>
    </section>`;
}

function candidateBar(c: HistCandidate, max: number) {
  return `<li><div class="bar-label"><span>${c.elected ? "<b>" : ""}${esc(c.name)}${c.elected ? "</b>" : ""} <span class="muted">${esc(c.other ? "" : partyLabel(c.party))}</span>${c.elected ? ` <span class="tag">${L("élu", "elected")}</span>` : c.qualified ? ` <span class="tag">${L("qualifié", "qualified")}</span>` : ""}</span><b>${fmtPct(c.pct, 2)}</b></div><div class="bar"><div style="width:${(100 * c.pct) / max}%;background:${sideColor(c.side)}"></div></div></li>`;
}

/** The playable URL for a media item: its embed, or a YouTube watch/short link turned into a nocookie embed. */
function embedUrl(m: HistMedia): string | null {
  let e = m.embed ?? null;
  if (!e) {
    const id = m.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1];
    if (id) e = `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (!e || !embedAllowed(e)) return null;
  return m.start && !/[?&]start=/.test(e) ? `${e}${e.includes("?") ? "&" : "?"}start=${m.start}` : e;
}
function player(m: HistMedia, main: boolean) {
  const kind = L(...(MEDIA_LABEL[m.type] ?? [m.type, m.type]));
  const e = embedUrl(m);
  const audio = m.type === "radio";
  return `<figure class="media${main ? "" : " media-alt"}">
      <figcaption><b>${kind}</b>${m.publisher ? `, ${esc(m.publisher)}` : ""}${m.date ? `, ${fmtDate(m.date)}` : ""}</figcaption>
      ${e ? `<div class="${audio ? "audio" : "video"}"><iframe src="${esc(safeUrl(e))}" title="${esc(m.title ?? kind)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}
      <p class="small"><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.title ?? m.url)}</a>${e ? "" : ` <span class="muted">(${L("à voir sur le site de la source", "watch on the source’s site")})</span>`}</p>
    </figure>`;
}
function mediaBlock(m: HistMedia | null, alts?: HistMedia[]) {
  if (!m) return "";
  return `<div class="media-stack">${player(m, true)}${(alts ?? []).map((a) => player(a, false)).join("")}</div>`;
}
