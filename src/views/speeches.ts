// What MPs say in the chamber: word clouds and themes, from the verbatim record of public sittings
// (built by scripts/sync-interventions.mjs into public/data/an/interventions/).
// - renderMpSpeech: the section on one MP's page
// - renderThemes:   the "Thèmes" tab of the Assemblée section
import { fetchJson, loadDeputes, type Depute } from "../data";
import { L, colon, fmtDate, fmtNum, fmtPct } from "../i18n";
import { seatRank } from "../lib/hemicycle";
import { fontsReady, wordCloud } from "../lib/wordcloud";
import { esc, safeColor } from "../util";
import { photoUrl } from "./deputes";

/** A quote: sitting date, debate title, record anchor (compte rendu uid#paragraph), extract, the word's span in it, the MP (chamber words) */
interface Src { d: string; t: string; u: string; x: string; h: [number, number] | null; m?: string }
/** [text, weight 0–1, theme id | null, and on an MP's cloud: times they said it, their latest quotes] */
type Term = [string, number, string | null, number?, Src[]?];
/** Chamber and group cloud words: times said, by how many MPs, recent quotes (rankings: ranks/NN.json) */
type Words = Record<string, { n: number; m: number; src: Src[] }>;
type Shares = Record<string, number>;
interface Theme { id: string; fr: string; en: string }
interface Summary {
  source: { url: string };
  period: { from: string; to: string; sittings: number };
  themes: Theme[];
  chamber: { speeches: number; words: number; themes: Shares; terms: Term[] };
  groups: Record<string, { libelle: string; couleur: string; mps: number; speeches: number; words: number; themes: Shares; terms: Term[] }>;
  /** n speeches, i interjections, w words, c classified speeches, t shares in `themes` order */
  mps: Record<string, { n: number; i: number; w: number; c: number; t: number[] }>;
}
interface MpSpeech { id: string; speeches: number; interjections: number; words: number; classified: number; first: string; last: string; terms: Term[]; themes: Shares }

let summaryP: Promise<Summary> | null = null;
const loadSummary = () => (summaryP ??= fetchJson<Summary>("/data/an/interventions/summary.json"));
const loadMp = (id: string) => fetchJson<MpSpeech>(`/data/an/interventions/${id}.json`);
let wordsP: Promise<Words> | null = null;
const loadWords = () => (wordsP ??= fetchJson<Words>("/data/an/interventions/words.json").catch(() => ({}) as Words));

/** One colour per theme, dark enough to read as text on white. */
export const THEME_COLOR: Record<string, string> = {
  securite: "#23408e", immigration: "#7b3fa0", sante: "#c8264b", social: "#d0508f", education: "#a86f00", travail: "#9f3a22",
  economie: "#3a6a8e", budget: "#5a5e9a", ecologie: "#1b8448", agriculture: "#667f12", logement: "#c25a12", international: "#4a4f57",
  justice: "#86286a", europe: "#1f62c9", institutions: "#227780", outremer: "#0c8ea2", culture: "#7a5a2c",
};
const NEUTRAL = "#9a9ea6";
const color = (theme: string | null) => (theme ? THEME_COLOR[theme] ?? NEUTRAL : NEUTRAL);
const themeName = (s: Summary, id: string | null) => {
  const t = id ? s.themes.find((x) => x.id === id) : null;
  return t ? L(t.fr, t.en) : "";
};
const pct = (x: number, d = 0) => fmtPct(100 * x, d);

/** Lays the cloud out at the slot's real width, so type sizes are the same on every screen. */
function fillCloud(slot: HTMLElement | null, s: Summary, terms: Term[], label: string, pick?: { tip: (t: Term) => string; open: (t: Term) => void }) {
  if (!slot) return;
  const width = Math.round(Math.max(300, Math.min(1000, slot.clientWidth || 600)));
  const height = Math.round(width > 700 ? width * 0.5 : width > 480 ? width * 0.74 : width * 1.05);
  slot.innerHTML = wordCloud(
    terms.map((t, i) => ({ text: t[0], weight: t[1], color: color(t[2]), tip: pick ? pick.tip(t) : t[2] ? `${t[0]} · ${themeName(s, t[2])}` : t[0], key: pick ? String(i) : undefined })),
    { width, height, min: width < 420 ? 10 : 11, max: Math.round(Math.min(50, Math.max(26, width / 20))), label },
  );
  if (!pick) return;
  const choose = (el: Element | null) => {
    const k = (el as SVGElement | null)?.dataset?.key;
    if (k != null) pick.open(terms[Number(k)]);
  };
  slot.addEventListener("click", (e) => choose((e.target as Element).closest("[data-key]")));
  slot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose((e.target as Element).closest("[data-key]")); } });
}

// ---------- the word popup: every MP who said it, most first ----------
// Rankings live in ranks/NN.json, sharded by an FNV-1a hash of the word (same as the sync script).
const SHARDS = 32;
const shardOf = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h % SHARDS;
};
interface Shard { ids: string[]; w: Record<string, number[]> }
const shardP = new Map<number, Promise<Shard>>();
const loadShard = (i: number) => {
  if (!shardP.has(i)) shardP.set(i, fetchJson<Shard>(`/data/an/interventions/ranks/${String(i).padStart(2, "0")}.json`).catch(() => ({ ids: [], w: {} })));
  return shardP.get(i)!;
};
/** n: times said in the chamber; rows: [MP id, times], most first */
async function wordRanking(text: string) {
  const sh = await loadShard(shardOf(text));
  const v = sh.w[text];
  if (!v) return null;
  const rows: [string, number][] = [];
  for (let i = 1; i < v.length; i += 2) rows.push([sh.ids[v[i]], v[i + 1]]);
  return { n: v[0], rows };
}

interface PopupOpts { s: Summary; term: Term; byId: Map<string, Depute>; current?: Depute; quotes?: Src[]; group?: string }
let dialog: HTMLDialogElement | null = null;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "word-pop";
  document.body.append(dialog);
  // a click on the backdrop (outside the box) closes it; so does following an MP link
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog!.close(); });
  window.addEventListener("hashchange", () => dialog?.open && dialog.close());
  return dialog;
}
async function openWordPopup(o: PopupOpts) {
  const dlg = ensureDialog();
  const [text, , theme] = o.term;
  const head = `<header class="wp-head"><h2><span style="color:${color(theme)}">${esc(text)}</span>${theme ? ` <span class="muted small">${esc(themeName(o.s, theme))}</span>` : ""}</h2>
    <button type="button" class="word-close" aria-label="${L("Fermer", "Close")}">×</button></header>`;
  dlg.innerHTML = `${head}<p class="muted">${L("Chargement…", "Loading…")}</p>`;
  if (!dlg.open) dlg.showModal();
  const close = () => dlg.close();
  dlg.querySelector(".word-close")!.addEventListener("click", close);
  const r = await wordRanking(text);
  if (!dlg.open) return;
  const rows = (r?.rows ?? []).filter(([id]) => o.byId.has(id));
  const max = rows[0]?.[1] || 1;
  const mine = o.current ? rows.findIndex(([id]) => id === o.current!.id) : -1;
  const groups = [...new Set(rows.map(([id]) => o.byId.get(id)!.groupe?.abrev ?? "NI"))].sort((a, b) => seatRank(a) - seatRank(b));
  const intro = r
    ? L(`Prononcé ${times(r.n)} en séance par ${fmtNum(rows.length)} députés.`, `Said ${times(r.n)} in the chamber by ${fmtNum(rows.length)} MPs.`) +
      (o.current && mine >= 0 ? ` ${esc(mpName(o.current))}${L(" : ", ": ")}${times(rows[mine][1])}, ${L(`${mine + 1}${mine === 0 ? "er" : "e"} sur ${fmtNum(rows.length)}`, `ranked ${fmtNum(mine + 1)} of ${fmtNum(rows.length)}`)}.` : "")
    : L("Pas de classement pour ce mot.", "No ranking for this word.");
  // header stays put while the list scrolls: the word, the totals, the group filter
  dlg.innerHTML = `<div class="wp-top">${head}
    <p class="muted small wp-intro">${intro}</p>
    ${groups.length > 1 ? `<div class="wp-groups" role="group" aria-label="${L("Filtrer par groupe", "Filter by group")}"><button type="button" class="wp-chip" data-g="" aria-pressed="${!o.group}">${L("Tous", "All")}</button>${groups.map((g) => `<button type="button" class="wp-chip" data-g="${esc(g)}" style="--c:${safeColor(o.byId.get(rows.find(([id]) => (o.byId.get(id)!.groupe?.abrev ?? "NI") === g)![0])!.groupe?.couleur) ?? NEUTRAL}" aria-pressed="${o.group === g}">${esc(g)}</button>`).join("")}</div>` : ""}</div>
    <ol class="word-rank">${rows
      .map(([id, n], i) => {
        const d = o.byId.get(id)!;
        const g = d.groupe?.abrev ?? "NI";
        return `<li data-g="${esc(g)}"${o.current?.id === id ? ` class="is-current" aria-current="true"` : ""}>
          <span class="wr-rank">${i + 1}</span>
          <img src="${photoUrl(d.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <a href="#/depute/${d.id}" class="wr-name">${esc(d.prenom)} ${esc(d.nom)}</a>
          <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? NEUTRAL}">${esc(g)}</span>
          <span class="wr-bar"><span style="width:${(100 * n) / max}%;background:${color(theme)}"></span></span>
          <b class="wr-n">${fmtNum(n)}</b>
        </li>`;
      })
      .join("")}</ol>
    ${o.quotes?.length ? `<h3 class="wp-sub">${o.current ? L(`Ses dernières interventions qui l’emploient`, "Their latest speeches using it") : L("Derniers extraits", "Latest quotes")}</h3>${quotesHtml(o.quotes, o.byId)}` : ""}`;
  dlg.querySelector(".word-close")!.addEventListener("click", close);
  const filter = (g: string) => {
    dlg.querySelectorAll<HTMLButtonElement>(".wp-groups [data-g]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === g)));
    dlg.querySelectorAll<HTMLLIElement>(".word-rank li").forEach((li) => (li.hidden = !!g && li.dataset.g !== g));
  };
  dlg.querySelectorAll<HTMLButtonElement>(".wp-groups [data-g]").forEach((b) => b.addEventListener("click", () => filter(b.dataset.g!)));
  if (o.group) filter(o.group);
  dlg.querySelector<HTMLElement>(".word-rank .is-current")?.scrollIntoView({ block: "center" });
}

/** Opens the word popup from anywhere (the site-wide search): every MP who said `text`, with the chamber's latest quotes. */
export async function openWordByText(text: string) {
  const [s, deputes, words] = await Promise.all([loadSummary(), loadDeputes(), loadWords()]);
  const known = [s.chamber.terms, ...Object.values(s.groups).map((g) => g.terms)].flat().find((t) => t[0] === text);
  const byId = new Map(deputes.map((d) => [d.id, d]));
  await openWordPopup({ s, term: [text, 1, known?.[2] ?? null], byId, quotes: words[text]?.src });
}

// ---------- quotes and counts behind each word ----------
const AN_CR = "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/";
const times = (n: number) => (n === 1 ? L("1 fois", "once") : L(`${fmtNum(n)} fois`, `${fmtNum(n)} times`));
const mpName = (d?: Depute) => (d ? `${d.prenom} ${d.nom}` : "");
/** The extract with the word marked. */
function quoteHtml(q: Src) {
  const x = q.h ? `${esc(q.x.slice(0, q.h[0]))}<mark>${esc(q.x.slice(q.h[0], q.h[1]))}</mark>${esc(q.x.slice(q.h[1]))}` : esc(q.x);
  return `« ${x} »`;
}
function quotesHtml(list: Src[], byId?: Map<string, Depute>) {
  if (!list.length) return "";
  return `<ul class="word-quotes">${list
    .map((q) => {
      const d = q.m ? byId?.get(q.m) : undefined;
      return `<li><blockquote>${quoteHtml(q)}</blockquote>
        <div class="muted small">${d ? `<a href="#/depute/${d.id}"><b>${esc(mpName(d))}</b></a> <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? NEUTRAL}">${esc(d.groupe?.abrev ?? "—")}</span> · ` : ""}${fmtDate(q.d)}${q.t ? ` · ${esc(q.t)}` : ""} · <a href="${AN_CR}${esc(q.u)}" target="_blank" rel="noopener">${L("compte rendu", "official record")} ↗</a></div></li>`;
    })
    .join("")}</ul>`;
}
/** Hover text: the word, its theme, how often, and the latest quote. */
function tipText(s: Summary, t: Term, line: string, q?: Src, who?: string) {
  const head = t[2] ? `${t[0]} · ${themeName(s, t[2])}` : t[0];
  const quote = q ? `\n\n« ${q.x} »\n— ${who ? `${who}, ` : ""}${fmtDate(q.d)}${q.t ? `, ${q.t}` : ""}` : "";
  return `${head}\n${line}${quote}\n\n${L("Cliquez pour le détail", "Click for details")}`;
}
/** Chamber and group clouds: hover = count and a quote; click = the popup ranking every MP who said it. */
function chamberPick(s: Summary, words: Words, byId: Map<string, Depute>, group?: string) {
  return {
    tip: (t: Term) => {
      const w = words[t[0]];
      if (!w) return t[2] ? `${t[0]} · ${themeName(s, t[2])}` : t[0];
      return tipText(s, t, L(`Prononcé ${times(w.n)} par ${fmtNum(w.m)} députés`, `Said ${times(w.n)} by ${fmtNum(w.m)} MPs`), w.src[0], mpName(byId.get(w.src[0]?.m ?? "")));
    },
    open: (t: Term) => void openWordPopup({ s, term: t, byId, quotes: words[t[0]]?.src, group }),
  };
}
/** An MP's cloud: hover = how often they said it and their latest quote; click = the popup, with this MP highlighted. */
function mpPick(s: Summary, d: Depute, byId: Map<string, Depute>) {
  const said = (t: Term) => L(`${d.civ === "Mme" ? "Elle l’a dit" : "Il l’a dit"} ${times(t[3] ?? 0)} en séance`, `Said ${times(t[3] ?? 0)} in the chamber`);
  return {
    tip: (t: Term) => (t[3] == null ? (t[2] ? `${t[0]} · ${themeName(s, t[2])}` : t[0]) : tipText(s, t, said(t), t[4]?.[0])),
    open: (t: Term) => void openWordPopup({ s, term: t, byId, current: d, quotes: t[4] }),
  };
}
function legend(s: Summary, terms: Term[]) {
  const used = new Set(terms.map((t) => t[2]).filter(Boolean));
  return `<ul class="legend-list inline cloud-legend">${s.themes.filter((t) => used.has(t.id)).map((t) => `<li><i class="dot" style="background:${color(t.id)}"></i>${esc(L(t.fr, t.en))}</li>`).join("")}<li><i class="dot" style="background:${NEUTRAL}"></i>${L("Sans thème", "No theme")}</li></ul>`;
}
/** Horizontal bars, one per theme, with a tick for the chamber average. */
function themeBars(s: Summary, shares: Shares, opts: { top?: number; compare?: boolean } = {}) {
  const rows = s.themes.map((t) => ({ t, v: shares[t.id] ?? 0, ref: s.chamber.themes[t.id] ?? 0 })).sort((a, b) => b.v - a.v).slice(0, opts.top ?? s.themes.length);
  const max = Math.max(...rows.map((r) => Math.max(r.v, opts.compare ? r.ref : 0)), 0.01);
  return `<ul class="bars compact theme-bars">${rows
    .map(({ t, v, ref }) => `<li data-tip="${esc(`${L(t.fr, t.en)}${colon()}${pct(v, 1)}${opts.compare ? ` (${L("Assemblée", "whole house")} ${pct(ref, 1)})` : ""}`)}">
      <div class="bar-label"><span>${esc(L(t.fr, t.en))}</span><b>${pct(v)}</b></div>
      <div class="bar"><div style="width:${(100 * v) / max}%;background:${color(t.id)}"></div>${opts.compare ? `<i class="ref" style="left:${(100 * ref) / max}%"></i>` : ""}</div>
    </li>`)
    .join("")}</ul>`;
}
const methodNote = () =>
  L(
    "Chaque intervention en séance publique est rattachée à un ou plusieurs thèmes d’après un lexique de mots-clés (et le titre du débat en cours). Les mots du nuage sont ceux que ce député emploie nettement plus que les autres (TF-IDF), mots de procédure exclus. Méthode automatique, indicative.",
    "Each speech in public sitting is assigned to one or more themes from a keyword lexicon (plus the title of the debate under way). Cloud words are those this MP uses far more than the others (TF-IDF), procedural words excluded. Automatic and indicative.",
  );

// ---------- one MP ----------
export async function renderMpSpeech(el: HTMLElement, d: Depute) {
  const she = d.civ === "Mme";
  const title = L(she ? "Ce qu’elle dit dans l’hémicycle" : "Ce qu’il dit dans l’hémicycle", "What they say in the chamber");
  let s: Summary, m: MpSpeech, deputes: Depute[];
  try {
    [s, m, deputes] = await Promise.all([loadSummary(), loadMp(d.id), loadDeputes()]);
  } catch {
    el.innerHTML = `<article class="card mp-speech"><header class="card-head"><h2>${title}</h2><a href="#/assemblee/themes">${L("Thèmes de l’Assemblée", "Assembly themes")}</a></header><p class="muted">${L("Aucune intervention en séance publique relevée pour l’instant.", "No speech in public sitting recorded yet.")}</p></article>`;
    return;
  }
  await fontsReady();
  const top = Object.entries(m.themes).sort((a, b) => b[1] - a[1])[0];
  el.innerHTML = `
    <article class="card mp-speech">
      <header class="card-head"><h2>${title}</h2><a href="#/assemblee/themes">${L("Thèmes de l’Assemblée", "Assembly themes")}</a></header>
      <div class="kpis kpis-4">
        <div><span class="muted">${L("Interventions", "Speeches")}</span><strong>${fmtNum(m.speeches)}</strong></div>
        <div><span class="muted">${L("Interpellations", "Interjections")}</span><strong>${fmtNum(m.interjections)}</strong></div>
        <div><span class="muted">${L("Mots", "Words")}</span><strong>${fmtNum(m.words)}</strong></div>
        <div><span class="muted">${L("Premier thème", "Top theme")}</span><strong class="theme-kpi" style="color:${color(top && top[1] ? top[0] : null)}">${top && top[1] ? esc(themeName(s, top[0])) : "—"}</strong></div>
      </div>
      ${m.terms.length ? `<div class="speech-grid">
        <div><div class="cloud-slot" id="mp-cloud"></div>${legend(s, m.terms)}</div>
        <div><h3>${L("Thèmes abordés", "Themes raised")}</h3>${m.classified ? themeBars(s, m.themes, { top: 8, compare: true }) : `<p class="muted small">${L("Trop peu d’interventions classées.", "Too few classified speeches.")}</p>`}
          <p class="muted small">${L("Barre : part de ses interventions ; trait : moyenne de l’Assemblée.", "Bar: share of their speeches; tick: whole-house average.")}</p></div>
      </div>` : `<p class="muted">${L("Trop peu de mots prononcés pour un nuage.", "Too few words spoken for a cloud.")}</p>`}
      <p class="muted small">${methodNote()} ${L("Interventions du", "Speeches from")} ${fmtDate(m.first)} ${L("au", "to")} ${fmtDate(m.last)}.</p>
    </article>`;
  fillCloud(el.querySelector("#mp-cloud"), s, m.terms, L(`Mots les plus caractéristiques de ${d.prenom} ${d.nom}`, `Most distinctive words of ${d.prenom} ${d.nom}`), mpPick(s, d, new Map(deputes.map((x) => [x.id, x]))));
}

// ---------- the whole chamber ----------
const view = { group: "", theme: "" };

export async function renderThemes(pane: HTMLElement) {
  const [s, deputes, words] = await Promise.all([loadSummary(), loadDeputes(), loadWords()]);
  await fontsReady();
  const byId = new Map(deputes.map((d) => [d.id, d]));
  const groups = Object.entries(s.groups).sort((a, b) => seatRank(a[0]) - seatRank(b[0]));
  const ranked = [...s.themes].sort((a, b) => (s.chamber.themes[b.id] ?? 0) - (s.chamber.themes[a.id] ?? 0));
  if (!view.theme) view.theme = ranked[0].id;

  pane.innerHTML = `
    <article class="card">
      <header class="card-head"><h2>${L("Ce dont parle l’Assemblée", "What the Assembly talks about")}</h2></header>
      <p class="muted small">${L(
        `${fmtNum(s.chamber.speeches)} interventions de députés en séance publique, ${fmtNum(s.period.sittings)} séances du ${fmtDate(s.period.from)} au ${fmtDate(s.period.to)}. Les mots les plus présents, pondérés par leur concentration sur certains débats. Survolez un mot pour un extrait, cliquez pour voir qui le prononce.`,
        `${fmtNum(s.chamber.speeches)} speeches by MPs in public sitting, ${fmtNum(s.period.sittings)} sittings from ${fmtDate(s.period.from)} to ${fmtDate(s.period.to)}. The most used words, weighted by how concentrated they are in particular debates. Hover a word for a quote, click it to see who says it.`,
      )}</p>
      <div class="cloud-slot" id="th-cloud"></div>
      ${legend(s, s.chamber.terms)}
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Les thèmes, groupe par groupe", "Themes, group by group")}</h2>
        <select id="th-group" aria-label="${L("Groupe", "Group")}"><option value="">${L("Toute l’Assemblée", "Whole house")}</option>${groups.map(([g, v]) => `<option value="${esc(g)}" ${g === view.group ? "selected" : ""}>${esc(g)} — ${esc(v.libelle)}</option>`).join("")}</select>
      </header>
      <div class="speech-grid" id="th-pane"></div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Les mots de chaque groupe", "Each group’s words")}</h2></header>
      <p class="muted small">${L(
        "Les dix mots que chaque groupe emploie le plus par rapport au reste de l’Assemblée, avec le nombre de fois où ses députés les ont prononcés. Cliquez sur un mot pour voir tous les députés qui l’emploient.",
        "The ten words each group uses most compared with the rest of the house, with how many times its MPs said them. Click a word to see every MP who uses it.",
      )}</p>
      <div class="party-words">${groups
        .filter(([, v]) => v.terms.length)
        .map(([g, v]) => {
          const top = v.terms.slice(0, 10);
          const max = Math.max(...top.map((t) => t[3] ?? 0), 1);
          return `<section class="pw-group" style="--c:${safeColor(v.couleur) ?? NEUTRAL}">
            <h3><span class="chip" style="--c:${safeColor(v.couleur) ?? NEUTRAL}">${esc(g)}</span> <span class="muted small">${esc(v.libelle)}</span></h3>
            <ol>${top
              .map((t, i) => `<li><button type="button" class="pw-word" data-g="${esc(g)}" data-i="${i}" style="color:${color(t[2])}">${esc(t[0])}</button>
                <span class="pw-bar"><span style="width:${(100 * (t[3] ?? 0)) / max}%"></span></span><b class="pw-n">${fmtNum(t[3] ?? 0)}</b></li>`)
              .join("")}</ol>
          </section>`;
        })
        .join("")}</div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Qui parle de quoi", "Who talks about what")}</h2></header>
      <p class="muted small">${L("Part des interventions de chaque groupe consacrée à chaque thème. Plus la case est foncée, plus le groupe en parle par rapport aux autres.", "Share of each group’s speeches devoted to each theme. The darker the cell, the more the group talks about it compared with the others.")}</p>
      <table class="table theme-matrix">
        <thead><tr><th>${L("Groupe", "Group")}</th>${ranked.map((t) => `<th class="num" title="${esc(L(t.fr, t.en))}"><span>${esc(L(t.fr, t.en))}</span></th>`).join("")}</tr></thead>
        <tbody>
          <tr><td><b>${L("Assemblée", "Whole house")}</b></td>${ranked.map((t) => `<td class="num">${pct(s.chamber.themes[t.id] ?? 0)}</td>`).join("")}</tr>
          ${groups.map(([g, v]) => `<tr><td><span class="chip" style="--c:${safeColor(v.couleur) ?? NEUTRAL}">${esc(g)}</span></td>${ranked.map((t) => {
            const x = v.themes[t.id] ?? 0;
            const maxT = Math.max(...groups.map(([, w]) => w.themes[t.id] ?? 0), 0.001);
            const a = x / maxT;
            return `<td class="num" style="background:${color(t.id)}${Math.round(a * 200).toString(16).padStart(2, "0")};color:${a > 0.55 ? "#fff" : "inherit"}" data-tip="${esc(`${g} · ${L(t.fr, t.en)}${colon()}${pct(x, 1)}`)}">${pct(x)}</td>`;
          }).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Les députés qui en parlent le plus", "The MPs who talk about it most")}</h2></header>
      <div class="legend" id="th-themes">${ranked.map((t) => `<button type="button" class="chip-toggle" style="--c:${color(t.id)}" data-theme="${t.id}" aria-pressed="${t.id === view.theme}">${esc(L(t.fr, t.en))}</button>`).join("")}</div>
      <div id="th-mps"></div>
      <p class="muted small">${L("Classement par part de leurs interventions consacrée au thème, parmi les députés ayant au moins 30 interventions classées.", "Ranked by the share of their speeches devoted to the theme, among MPs with at least 30 classified speeches.")}</p>
    </article>
    <p class="muted small">${methodNote()}</p>
    <p class="source muted">${L("Source : comptes rendus des débats de l’Assemblée nationale (open data, XML Syceron), jusqu’à la séance du", "Source: Assemblée nationale verbatim records (open data, Syceron XML), up to the sitting of")} ${fmtDate(s.period.to)} ·<a href="${esc(s.source.url)}" target="_blank" rel="noopener">${L("fichier source", "source file")} ↗</a></p>`;

  const drawGroup = () => {
    const g = view.group ? s.groups[view.group] : null;
    const terms = g ? g.terms : s.chamber.terms;
    pane.querySelector("#th-pane")!.innerHTML = `
      <div><h3>${g ? `${esc(view.group)}${colon()}${L("part des interventions par thème", "share of speeches by theme")}` : L("Part des interventions par thème", "Share of speeches by theme")}</h3>
        ${themeBars(s, g ? g.themes : s.chamber.themes, { compare: !!g })}
        ${g ? `<p class="muted small">${L("Trait : moyenne de l’Assemblée.", "Tick: whole-house average.")} ${fmtNum(g.speeches)} ${L("interventions", "speeches")}, ${g.mps} ${L("députés", "MPs")}.</p>` : ""}</div>
      <div><h3>${g ? L(`Les mots propres au groupe ${view.group}`, `Words typical of ${view.group}`) : L("Choisissez un groupe pour voir ses mots", "Pick a group to see its words")}</h3>
        ${g ? `<div class="cloud-slot" id="th-gcloud"></div>${legend(s, terms)}` : `<p class="muted small">${L("Les mots qu’un groupe emploie nettement plus que l’ensemble de l’Assemblée.", "The words a group uses far more than the house as a whole.")}</p>`}</div>`;
    if (g) fillCloud(pane.querySelector("#th-gcloud"), s, terms, L(`Mots du groupe ${view.group}`, `Words of ${view.group}`), chamberPick(s, words, byId, view.group));
  };
  const drawMps = () => {
    const ti = s.themes.findIndex((t) => t.id === view.theme);
    const rows = Object.entries(s.mps)
      .filter(([id, x]) => x.c >= 30 && byId.has(id))
      .map(([id, x]) => ({ d: byId.get(id)!, share: x.t[ti], n: Math.round(x.t[ti] * x.c) }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 12);
    const max = rows[0]?.share || 1;
    pane.querySelector("#th-mps")!.innerHTML = `<ol class="theme-mps">${rows
      .map(({ d, share, n }) => `<li>
        <img src="${photoUrl(d.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div><a href="#/depute/${d.id}"><b>${esc(d.prenom)} ${esc(d.nom)}</b></a> <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? NEUTRAL}">${esc(d.groupe?.abrev ?? "—")}</span>
          <div class="bar"><div style="width:${(100 * share) / max}%;background:${color(view.theme)}"></div></div></div>
        <span class="num"><b>${pct(share)}</b><span class="muted small"> · ${L(`≈ ${fmtNum(n)} interv.`, `≈ ${fmtNum(n)} speeches`)}</span></span>
      </li>`)
      .join("")}</ol>`;
  };
  pane.querySelector<HTMLSelectElement>("#th-group")!.addEventListener("change", (e) => { view.group = (e.target as HTMLSelectElement).value; drawGroup(); });
  pane.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      view.theme = b.dataset.theme!;
      pane.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawMps();
    }),
  );
  pane.querySelectorAll<HTMLButtonElement>(".pw-word").forEach((b) =>
    b.addEventListener("click", () => void openWordPopup({ s, term: s.groups[b.dataset.g!].terms[Number(b.dataset.i)], byId, quotes: words[b.textContent ?? ""]?.src, group: b.dataset.g })),
  );
  fillCloud(pane.querySelector("#th-cloud"), s, s.chamber.terms, L("Nuage de mots de l’Assemblée", "Assembly word cloud"), chamberPick(s, words, byId));
  drawGroup();
  drawMps();
}
