// "Le point du jour": how the race moved since yesterday and over a week in the polling average, on Kalshi and
// on Polymarket, the headlines that could have played a part, and the latest polls (read live).
// Data: /data/daily/latest.json, written once a day by scripts/daily-brief.ts (see docs/data-daily.md);
// the poll list comes from /data/polls/2027.json, refreshed every hour.
import { fetchJson, loadPolls } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { pollValue, pollsterName } from "../lib/polls";
import { dec, pct } from "../lib/format";
import { esc, safeColor, safeUrl } from "../util";

interface Move { now: number; d1: number | null; d7: number | null }
interface Headline { title: string; link: string; outlet: string; time: string; n: number }
interface Brief {
  date: string; generatedAt: string; pollsFetchedAt: string; marketsFetchedAt: string;
  sources: { kalshi: boolean; poly: boolean };
  rows: { name: string; polls: Move | null; kalshi: Move | null; poly: Move | null }[];
  newPolls: { pollster: string; end: string }[];
  movers: { name: string; moves: { src: "polls" | "kalshi" | "poly"; d: number; days: 1 | 7; now: number }[]; headlines: Headline[] }[];
  summary: { fr: string; en: string; by: string };
}

const delta = (d: number | null) => (d == null ? `<span class="dy-na">—</span>` : d === 0 ? `<span class="dy-flat">=</span>` : `<span class="${d > 0 ? "up" : "down"}">${dec(Math.abs(d))}</span>`);
const cell = (m: Move | null, withDay: boolean) => (m ? `<td class="num"><b>${pct(m.now)}</b></td>${withDay ? `<td class="num dy-d">${delta(m.d1)}</td>` : ""}<td class="num dy-d">${delta(m.d7)}</td>` : `<td class="num dy-na" colspan="${withDay ? 3 : 2}">—</td>`);
const SRC = { polls: () => L("Sondages", "Polls"), kalshi: () => "Kalshi", poly: () => "Polymarket" };
const clock = (iso: string) => new Date(iso).toLocaleTimeString(getLang() === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
const longDate = (iso: string) => new Date(iso).toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Fills `box` with the day's brief. `compact` is the homepage version: the summary, the leaders, a link. */
export async function mountDaily(box: HTMLElement | null, compact = false) {
  if (!box) return;
  const [b, polls] = await Promise.all([fetchJson<Brief>("/data/daily/latest.json").catch(() => null), loadPolls("2027").catch(() => null)]);
  if (!b || !document.body.contains(box)) { box.remove(); return; }
  if (polls) registerParties(polls.parties);
  const name = (n: string) => `<span class="dy-name"><i class="dot" style="background:${safeColor(meta(n).color)}"></i>${esc(compact ? meta(n).surname : n)}</span>`;
  const rows = b.rows.slice(0, compact ? 4 : 10);
  const table = `<table class="table dy-table">
    <thead><tr><th rowspan="2">${L("Candidat", "Candidate")}</th><th class="num" colspan="2">${L("Sondages", "Polls")}</th><th class="num" colspan="3">Kalshi</th><th class="num" colspan="3">Polymarket</th></tr>
      <tr class="dy-sub"><th class="num">${L("moyenne", "average")}</th><th class="num">${L("7 j", "7 d")}</th><th class="num">${L("chances", "odds")}</th><th class="num">24 h</th><th class="num">${L("7 j", "7 d")}</th><th class="num">${L("chances", "odds")}</th><th class="num">24 h</th><th class="num">${L("7 j", "7 d")}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${name(r.name)}</td>${cell(r.polls, false)}${cell(r.kalshi, true)}${cell(r.poly, true)}</tr>`).join("")}</tbody></table>`;
  const by = b.summary.by === "template"
    ? L("Résumé composé automatiquement à partir des chiffres du tableau.", "Summary assembled automatically from the figures in the table.")
    : L("Résumé rédigé par un modèle d’IA à partir des seuls chiffres et titres de cette page, puis vérifié automatiquement : chaque nombre cité doit figurer dans les données.", "Summary written by an AI model from the figures and headlines on this page only, then checked automatically: every number quoted must be in the data.");
  const head = `<header class="card-head"><h2>${L("Le point du jour", "Today’s brief")}</h2>${compact ? `<a href="#/sondages#point">${L("Le point complet", "The full brief")}</a>` : ""}</header>
    <p class="dy-when"><span class="px-tag dy-live">${L("En direct", "Live")}</span>${esc(longDate(b.date))} · ${L("sondages relevés à", "polls checked at")} ${clock(polls?.fetchedAt ?? b.pollsFetchedAt)} · ${L("marchés à", "markets at")} ${clock(b.marketsFetchedAt)}</p>
    <p class="dy-sum">${esc(L(b.summary.fr, b.summary.en))}</p>`;
  if (compact) {
    box.innerHTML = `<section class="card dy dy-compact" id="point">${head}${table}</section>`;
    return;
  }

  // the latest polls, straight from the hourly file; "new" = published since the last brief
  const fresh = new Set(b.newPolls.map((p) => `${p.pollster}|${p.end}`));
  const latest = [...(polls?.firstRound ?? [])].sort((x, y) => y.end.localeCompare(x.end)).slice(0, 6);
  const pollLine = (p: (typeof latest)[number]) => {
    const top = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))].map((n) => ({ n, v: pollValue(p, n)! })).sort((x, y) => y.v - x.v).slice(0, 5);
    return `<li><span class="dy-pwho"><b>${esc(pollsterName(p.pollster))}</b>${fresh.has(`${pollsterName(p.pollster)}|${p.end}`) ? ` <span class="px-tag">${L("Nouveau", "New")}</span>` : ""}<span class="muted small">${fmtDate(p.start)} – ${fmtDate(p.end)}${p.sample ? ` · ${p.sample.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB")} ${L("pers.", "people")}` : ""}</span></span>
      <span class="dy-ptop">${top.map((t) => `<span style="--c:${safeColor(meta(t.n).color)}"><i></i>${esc(meta(t.n).surname)} <b>${dec(t.v, t.v % 1 ? 1 : 0)}</b></span>`).join("")}</span></li>`;
  };

  box.innerHTML = `<article class="card dy" id="point">${head}
      <p class="muted small">${by}</p>
      ${table}
      <p class="muted small">${L("Sondages : moyenne des intentions de vote au premier tour (en %). Marchés : probabilité de gagner l’élection, d’après les cours de Kalshi et de Polymarket (en %). Variations en points, sur 24 heures et sur sept jours ; « = » : inchangé, « — » : pas de relevé à cette date.", "Polls: average first-round voting intention (%). Markets: probability of winning the election, from Kalshi and Polymarket prices (%). Changes in points over 24 hours and seven days; ‘=’: unchanged, ‘—’: no reading on that date.")}</p>

      <h3>${L("Ce qui a pu jouer", "What could have played a part")}</h3>
      ${b.movers.length ? `<ul class="dy-movers">${b.movers.map((m) => `<li>
          <p class="dy-mhead">${name(m.name)}${m.moves.map((x) => `<span class="dy-chip">${SRC[x.src]()} <span class="${x.d > 0 ? "up" : "down"}">${dec(Math.abs(x.d))}</span><span class="muted">${x.days === 1 ? "24 h" : L("7 j", "7 d")}</span></span>`).join("")}</p>
          ${m.headlines.length ? `<ul>${m.headlines.map((h) => `<li><a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted small">${esc(h.outlet)}, ${fmtDate(h.time)}${h.n > 1 ? ` · ${h.n} ${L("articles sur le sujet", "articles on the story")}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted small">${L("Aucun titre du fil d’actualité ne nomme ce candidat sur la période : pas d’explication évidente.", "No headline in the feed names this candidate over the period: no obvious explanation.")}</p>`}
        </li>`).join("")}</ul>
        <p class="muted small">${L("Les titres viennent du fil d’actualité du site (presse nationale) et nomment le candidat sur la période du mouvement. Ce sont des éléments de contexte, pas des causes établies : un marché prédictif peu liquide peut bouger sur un seul gros ordre, et une moyenne de sondages bouge aussi quand un sondage ancien en sort.", "Headlines come from the site’s news feed (national press) and name the candidate over the period of the move. They are context, not established causes: a thinly traded prediction market can move on a single large order, and a polling average also moves when an old poll drops out.")} <a href="#/fil">${L("Voir le fil", "See the feed")}</a></p>`
        : `<p class="muted">${L("Aucun mouvement notable : moins d’un point en 24 heures et de deux points en sept jours sur les marchés, moins d’un point sur la moyenne des sondages.", "No notable move: under one point in 24 hours and two points in seven days on the markets, under one point in the polling average.")}</p>`}

      <h3>${L("Les derniers sondages", "The latest polls")}</h3>
      <ul class="dy-polls">${latest.map(pollLine).join("")}</ul>
      <p class="muted small">${L("Liste mise à jour toutes les heures depuis le relevé de Wikipédia ; les sondages paraissent quelques jours après la fin du terrain.", "List refreshed every hour from Wikipedia’s record; polls are published a few days after fieldwork ends.")} <a href="#/sondages#liste">${L("Tous les sondages", "Every poll")}</a></p>
    </article>`;
}
