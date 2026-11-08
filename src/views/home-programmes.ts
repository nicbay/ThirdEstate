// Homepage: "the story of the moment" — the 2027 programmes under the microscope (flow teaser, claimed vs
// estimated cost, every candidate's programme status) with what people are posting about it — and a live ticker.
// Data: /data/programmes/index.json (scripts/build-programmes-index.mjs), /data/programmes/posts.json (curated,
// each post checked against X's public oEmbed), /data/candidates/index.json.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { flowSvg, type FlowSpec } from "../lib/programme-flow";
import { esc, safeUrl } from "../util";

interface IndexEntry {
  slug: string; candidate: string; party: string; programme: string | null; lite: boolean; status: "published" | "partial" | "none";
  statusNote?: { fr: string; en: string }; summary?: { fr: string; en: string };
  versions: { id: string; year: number; label: { fr: string; en: string } }[];
  counts?: { maintained: number; modified: number; new: number; dropped: number }; total: number; inLatest?: number;
  flow?: { kept: number; changed: number; drop22: number; add25: number; drop25: number; new27: number; inA: number; inE: number; inW: number };
  lastEstimate: { year: number; announced: number | null; by: string; net: number } | null;
  latestCost: { year: number; announced: { by: string; net: number } | null; estimates: { by: string; net: number }[] } | null;
}
export interface Post { url: string; author: string; handle?: string; authorUrl?: string; date: string; text: string; topic?: string; side?: string; about?: string | null; kind?: "post" | "quote" }
interface CandidateCard { slug: string; name: string; photo?: string; party: { fr: string; en: string } }

const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; return L(`${sg}${fmtNum(Math.abs(Math.round(v)))} Md€`, `${sg}€${fmtNum(Math.abs(Math.round(v)))}bn`); };

function teaserSpec(e: IndexEntry): FlowSpec | null {
  const n = e.flow;
  if (!n) return null;
  const items = (k: number) => `${fmtNum(k)} ${L("mesures", "measures")}`;
  return {
    sources: [
      { id: "s22", icon: "22", title: L("Abrégé 2022", "2022 booklet"), sub: items(n.inA), out: ["kept", "changed", "drop22"] },
      { id: "s25", icon: "25", title: L("Édition 2025", "2025 edition"), sub: items(n.inE), out: ["add25", "drop25"] },
      { id: "s27", icon: "27", title: L("Site 2027", "2027 website"), sub: L("textes nouveaux", "new texts"), out: ["new27"] },
    ],
    branches: [
      { id: "kept", icon: "=", title: L("Gardées", "Kept"), n: n.kept },
      { id: "changed", icon: "≠", title: L("Modifiées", "Changed"), n: n.changed },
      { id: "drop22", icon: "−", title: L("Retirées", "Dropped"), n: n.drop22, drop: true },
      { id: "add25", icon: "+", title: L("Ajoutées en 2025", "Added in 2025"), n: n.add25 },
      { id: "drop25", icon: "−", title: L("Ajoutées puis retirées", "Added, then dropped"), n: n.drop25, drop: true },
      { id: "new27", icon: "★", title: L("Nouvelles en 2027", "New in 2027"), n: n.new27 },
    ],
    keepTitle: L("Programme 2027", "2027 programme"), keepN: n.inW, goneN: n.drop22 + n.drop25,
    label: L(`Évolution du programme : ${n.inW} mesures en 2027, ${n.new27} nouvelles, ${n.drop22 + n.drop25} abandonnées.`, `How the programme evolved: ${n.inW} measures in 2027, ${n.new27} new, ${n.drop22 + n.drop25} dropped.`),
  };
}

const STATUS_LABEL = { published: () => L("Programme analysé", "Programme analysed"), partial: () => L("Annonces partielles", "Partial announcements"), none: () => L("Pas encore publié", "Not yet published") };

export function postCard(p: Post, i = 0) {
  const initials = p.author.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return `<article class="post${p.kind === "quote" ? " is-quote" : ""}" style="--i:${i}">
    <header><span class="post-av" aria-hidden="true">${esc(initials)}</span><span><b>${esc(p.author)}</b>${p.handle ? ` <span class="muted">${esc(p.handle)}</span>` : ""}<br><span class="muted small">${fmtDate(p.date)}</span></span>
      <span class="post-src" aria-hidden="true">${p.kind === "quote" ? "❝" : "𝕏"}</span></header>
    <p lang="fr">${esc(p.text)}</p>
    <a class="post-link" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${p.kind === "quote" ? L("Lire l’article", "Read the article") : L("Voir le message", "See the post")}</a>
  </article>`;
}

/** Feature block for the homepage; fills `box` and starts its live bits. */
export async function mountProgrammesFeature(box: HTMLElement | null) {
  if (!box) return;
  const [idx, posts, cands] = await Promise.all([
    fetchJson<{ programmes: IndexEntry[] }>("/data/programmes/index.json").catch(() => null),
    fetchJson<Post[]>("/data/programmes/posts.json").catch(() => [] as Post[]),
    fetchJson<{ candidates: CandidateCard[] }>("/data/candidates/index.json").catch(() => null),
  ]);
  if (!idx?.programmes.length) { box.remove(); return; }
  const lead = idx.programmes.find((p) => p.flow) ?? idx.programmes[0];
  const spec = teaserSpec(lead);
  const byslug = new Map(idx.programmes.map((p) => [p.slug, p]));
  const cardsList = (cands?.candidates ?? []).map((c) => ({ c, p: byslug.get(c.slug) }));
  cardsList.sort((a, b) => (a.p ? ["published", "partial", "none"].indexOf(a.p.status) : 3) - (b.p ? ["published", "partial", "none"].indexOf(b.p.status) : 3) || a.c.name.localeCompare(b.c.name, "fr"));
  const est = lead.lastEstimate, lc = lead.latestCost;
  const span = est ? Math.max(Math.abs(est.net), Math.abs(est.announced ?? 0), 1) : 1;
  const n = lead.flow;
  const shownPosts = [...posts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  box.innerHTML = `
    <section class="pf" aria-labelledby="pf-title">
      <header class="pf-head">
        <p class="pf-kicker"><i class="pf-pulse" aria-hidden="true"></i>${L("Le dossier du moment", "The story right now")}</p>
        <h2 id="pf-title">${L("Les programmes 2027, passés au crible", "The 2027 programmes, under the microscope")}</h2>
        <p class="pf-dek">${L("Ce que chaque candidat promet, ce qui a changé depuis 2022, ce que ça coûte selon eux et selon les économistes indépendants.", "What each candidate promises, what changed since 2022, and what it costs according to them and to independent economists.")}</p>
      </header>
      <div class="pf-grid">
        <a class="pf-lead" href="#/programmes/${esc(lead.slug)}">
          <p class="pf-k">${esc(lead.candidate)} · ${esc(lead.programme ?? lead.party)}</p>
          ${n ? `<div class="pf-stats">
            <span><strong data-count="${n.inW}">${fmtNum(n.inW)}</strong>${L("mesures en 2027", "measures in 2027")}</span>
            <span><strong data-count="${n.new27}">${fmtNum(n.new27)}</strong>${L("nouvelles", "new")}</span>
            <span><strong data-count="${n.drop22 + n.drop25}">${fmtNum(n.drop22 + n.drop25)}</strong>${L("abandonnées", "dropped")}</span>
          </div>` : ""}
          ${spec ? `<div class="pf-flow">${flowSvg(spec, "", true)}</div>` : ""}
          ${est ? `<div class="pf-cost">
            <p class="pf-k">${L(`Coût du programme ${est.year}, en milliards d’euros par an`, `Cost of the ${est.year} programme, € billions a year`)}</p>
            ${est.announced != null ? `<div class="pf-cbar"><span>${L("Annoncé par le parti", "Claimed by the party")}</span><i style="--w:${((50 * Math.abs(est.announced)) / span).toFixed(1)}%" class="${est.announced < 0 ? "is-neg" : ""}"></i><b class="${est.announced < 0 ? "is-neg" : ""}">${md(est.announced)}</b></div>` : ""}
            <div class="pf-cbar"><span>${L("Estimé par", "Estimated by")} ${esc(est.by)}</span><i style="--w:${((50 * Math.abs(est.net)) / span).toFixed(1)}%" class="${est.net < 0 ? "is-neg" : ""}"></i><b class="${est.net < 0 ? "is-neg" : ""}">${md(est.net)}</b></div>
            ${lc && lc.year > est.year && lc.announced && !lc.estimates.length ? `<p class="pf-note">${L(`${lc.year} : le parti annonce ${md(lc.announced.net)} pour la première année. Pas encore d’estimation indépendante.`, `${lc.year}: the party claims ${md(lc.announced.net)} for the first year. No independent estimate yet.`)}</p>` : ""}
          </div>` : ""}
          <span class="pf-cta">${L("Explorer le programme, mesure par mesure", "Explore the programme, measure by measure")} →</span>
        </a>
        <aside class="pf-posts" aria-label="${L("Ce qu’on en dit", "What people are saying")}">
          <p class="pf-k">${L("Ce qu’on en dit", "What people are saying")}</p>
          ${shownPosts.length ? `<div class="pf-post-stack" id="pf-stack">${shownPosts.map((p, i) => postCard(p, i)).join("")}</div>
            <div class="pf-dots" role="tablist" aria-label="${L("Messages", "Posts")}">${shownPosts.map((_, i) => `<button type="button" role="tab" aria-label="${i + 1}" aria-selected="${i === 0}" data-i="${i}"></button>`).join("")}</div>`
            : `<p class="muted small">${L("Les réactions arrivent.", "Reactions coming in.")}</p>`}
        </aside>
      </div>
      ${lead.slug === "melenchon" ? `<a class="pf-sim" href="#/programmes/melenchon/simulateur">
        <span class="pf-k">${L("Simulateur", "Simulator")}</span>
        <strong>${L("Le programme de Mélenchon vous coûterait-il ou vous rapporterait-il ?", "Would Mélenchon’s programme cost you or pay you?")}</strong>
        <span class="pf-sim-go">${L("Simulez l’effet sur votre foyer", "Simulate the effect on your household")} →</span>
      </a>` : ""}
      <div class="pf-rail" aria-label="${L("Les programmes de tous les candidats", "Every candidate’s programme")}">
        ${cardsList.map(({ c, p }, i) => `<a class="pf-cand${p ? ` is-${p.status}` : " is-none"}" style="--i:${i}" href="${p ? `#/programmes/${esc(c.slug)}` : `#/candidat/${esc(c.slug)}`}">
          ${c.photo ? `<img src="${esc(safeUrl(c.photo))}" alt="" loading="lazy" width="44" height="44">` : `<span class="pf-noimg"></span>`}
          <span><b>${esc(c.name)}</b><span class="pf-st">${p ? esc(STATUS_LABEL[p.status]()) : STATUS_LABEL.none()}${p?.total ? ` · ${fmtNum(p.inLatest ?? p.total)} ${L("mesures", "measures")}` : ""}</span></span></a>`).join("")}
      </div>
    </section>`;

  // posts: one at a time, rotating every 7 s; pauses on hover/focus and when the page is hidden
  const stack = box.querySelector<HTMLElement>("#pf-stack");
  if (stack) {
    const cards = [...stack.children] as HTMLElement[];
    const dots = [...box.querySelectorAll<HTMLButtonElement>(".pf-dots button")];
    let cur = 0, paused = false;
    const show = (i: number) => {
      cur = (i + cards.length) % cards.length;
      cards.forEach((c, j) => c.classList.toggle("is-on", j === cur));
      dots.forEach((d, j) => d.setAttribute("aria-selected", String(j === cur)));
    };
    show(0);
    dots.forEach((d) => d.addEventListener("click", () => show(Number(d.dataset.i))));
    stack.addEventListener("mouseenter", () => (paused = true));
    stack.addEventListener("mouseleave", () => (paused = false));
    stack.addEventListener("focusin", () => (paused = true));
    stack.addEventListener("focusout", () => (paused = false));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && cards.length > 1) {
      const t = setInterval(() => {
        if (!document.body.contains(stack)) return clearInterval(t);
        if (!paused && !document.hidden) show(cur + 1);
      }, 7000);
    }
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.2 });
  box.querySelectorAll(".pf-flow, .pf-cost, .pf-rail").forEach((el) => io.observe(el));
}

export interface TickerItem { k: string; html: string }
/** A scrolling "live" strip: countdown to the first round (ticking every second) and the latest items. */
export function tickerHtml(items: TickerItem[]) {
  const row = items.map((t) => `<span class="tk-item"><b>${esc(t.k)}</b> ${t.html}</span>`).join(`<span class="tk-sep" aria-hidden="true">●</span>`);
  return `<div class="ticker" role="region" aria-label="${L("En direct", "Live")}">
    <span class="tk-live"><i></i>${L("En direct", "Live")}</span>
    <span class="tk-count" id="tk-count" aria-live="off"></span>
    <div class="tk-track"><div class="tk-move">${row}<span class="tk-sep" aria-hidden="true">●</span><span aria-hidden="true" class="tk-dup">${row}</span></div></div>
  </div>`;
}
export function startTicker(root: HTMLElement, electionDay: string) {
  const el = root.querySelector<HTMLElement>("#tk-count");
  if (!el) return;
  const target = Date.parse(`${electionDay}T08:00:00+02:00`); // polls open at 8:00, Paris time
  const fr = getLang() === "fr";
  const pad = (n: number) => String(n).padStart(2, "0");
  const tick = () => {
    if (!document.body.contains(el)) return clearInterval(t);
    const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    el.innerHTML = `${fr ? "1er tour dans" : "First round in"} <b>${d}</b>${fr ? " j" : "d"} <b>${pad(h)}</b>:<b>${pad(m)}</b>:<b>${pad(sec)}</b>`;
  };
  const t = setInterval(tick, 1000);
  tick();
}
