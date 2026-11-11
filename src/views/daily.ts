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

/** A change in points as a pill: green up, red down, stronger the bigger the move; grey when flat or unknown. */
const pill = (d: number | null, span: string) => {
  if (d == null) return `<span class="dy-pill is-na" title="${L("Pas de relevé à cette date", "No reading on that date")}">— <small>${span}</small></span>`;
  if (d === 0) return `<span class="dy-pill is-flat">= <small>${span}</small></span>`;
  const a = Math.abs(d);
  return `<span class="dy-pill ${d > 0 ? "is-up" : "is-down"} s${a >= 2 ? 3 : a >= 0.5 ? 2 : 1}" title="${d > 0 ? L("En hausse", "Up") : L("En baisse", "Down")}"><i aria-hidden="true">${d > 0 ? "▲" : "▼"}</i>${dec(a)} <small>${span}</small></span>`;
};
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
  const week = L("7 j", "7 d");
  // bars: polls against the best polling average, both markets against the best market price
  const top = (xs: (Move | null)[]) => Math.max(1, ...xs.map((m) => m?.now ?? 0));
  const maxPolls = top(b.rows.map((r) => r.polls)), maxMkt = top(b.rows.flatMap((r) => [r.kalshi, r.poly]));
  const src = (label: string, m: Move | null, max: number, withDay: boolean) => `<div class="dy-src" data-l="${label}">${m
    ? `<b class="dy-val">${pct(m.now)}</b><span class="dy-bar"><i style="width:${Math.max(2, Math.round((100 * m.now) / max))}%"></i></span><span class="dy-pills">${withDay ? pill(m.d1, "24 h") : ""}${pill(m.d7, week)}</span>`
    : `<span class="dy-none">${L("non mesuré", "not measured")}</span>`}</div>`;
  const table = `<div class="dy-grid">
    <div class="dy-hrow" aria-hidden="true"><span></span><span>${L("Sondages", "Polls")} <small>${L("moyenne au 1er tour", "first-round average")}</small></span><span>Kalshi <small>${L("chances de victoire", "odds of winning")}</small></span><span>Polymarket <small>${L("chances de victoire", "odds of winning")}</small></span></div>
    ${rows.map((r) => `<div class="dy-row" style="--c:${safeColor(meta(r.name).color)}"><div class="dy-who">${name(r.name)}</div>${src(L("Sondages", "Polls"), r.polls, maxPolls, false)}${src("Kalshi", r.kalshi, maxMkt, true)}${src("Polymarket", r.poly, maxMkt, true)}</div>`).join("")}
  </div>`;
  // the biggest moves, as tiles: green up, red down
  const big = b.movers.flatMap((m) => m.moves.map((x) => ({ ...x, name: m.name }))).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, compact ? 3 : 4);
  const tiles = big.length ? `<ul class="dy-tiles">${big.map((x) => `<li class="dy-tile ${x.d > 0 ? "is-up" : "is-down"}">
      <span class="dy-tile-d"><i aria-hidden="true">${x.d > 0 ? "▲" : "▼"}</i>${x.d > 0 ? "+" : "−"}${dec(Math.abs(x.d))}<small>${Math.abs(x.d) >= 2 ? "pts" : "pt"}</small></span>
      <span class="dy-tile-n">${esc(meta(x.name).surname)}</span>
      <span class="dy-tile-s">${SRC[x.src]()} · ${x.days === 1 ? "24 h" : week} · ${L("à", "now")} ${pct(x.now)}</span></li>`).join("")}</ul>` : "";
  const by = b.summary.by === "template"
    ? L("Résumé composé automatiquement à partir des chiffres du tableau.", "Summary assembled automatically from the figures in the table.")
    : L("Résumé rédigé par un modèle d’IA à partir des seuls chiffres et titres de cette page, puis vérifié automatiquement : chaque nombre cité doit figurer dans les données.", "Summary written by an AI model from the figures and headlines on this page only, then checked automatically: every number quoted must be in the data.");
  // the first sentence carries the headline; the rest reads as a paragraph under the day's biggest moves
  const sum = L(b.summary.fr, b.summary.en), cut = sum.indexOf(". ");
  const lead = cut > 0 ? sum.slice(0, cut + 1) : sum, rest = cut > 0 ? sum.slice(cut + 2) : "";
  const head = `<header class="card-head"><h2>${L("Le point du jour", "Today’s brief")}</h2>${compact ? `<a href="#/sondages#point">${L("Le point complet", "The full brief")}</a>` : ""}</header>
    <p class="dy-when"><span class="px-tag dy-live">${L("En direct", "Live")}</span>${esc(longDate(b.date))} · ${L("sondages relevés à", "polls checked at")} ${clock(polls?.fetchedAt ?? b.pollsFetchedAt)} · ${L("marchés à", "markets at")} ${clock(b.marketsFetchedAt)}</p>
    <p class="dy-sum">${esc(lead)}</p>${tiles}${rest ? `<p class="dy-rest">${esc(rest)}</p>` : ""}`;
  if (compact) {
    box.innerHTML = `<section class="card dy dy-compact" id="point">${head}${table}</section>`;
    return;
  }

  // the latest polls, straight from the hourly file; "new" = published since the last brief
  const fresh = new Set(b.newPolls.map((p) => `${p.pollster}|${p.end}`));
  const latest = [...(polls?.firstRound ?? [])].sort((x, y) => y.end.localeCompare(x.end)).slice(0, 6);
  const pollLine = (p: (typeof latest)[number]) => {
    const top = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))].map((n) => ({ n, v: pollValue(p, n)! })).sort((x, y) => y.v - x.v).slice(0, 5);
    return `<li><span class="dy-pwho">${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener"><b>${esc(pollsterName(p.pollster))}</b></a>` : `<b>${esc(pollsterName(p.pollster))}</b>`}${fresh.has(`${pollsterName(p.pollster)}|${p.end}`) ? ` <span class="px-tag">${L("Nouveau", "New")}</span>` : ""}<span class="muted small">${fmtDate(p.start)} – ${fmtDate(p.end)}${p.sample ? ` · ${p.sample.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB")} ${L("pers.", "people")}` : ""}</span></span>
      <span class="dy-ptop">${top.map((t) => `<span style="--c:${safeColor(meta(t.n).color)}"><i></i>${esc(meta(t.n).surname)} <b>${dec(t.v, t.v % 1 ? 1 : 0)}</b></span>`).join("")}</span></li>`;
  };

  box.innerHTML = `<article class="card dy" id="point">${head}
      <p class="muted small">${by}</p>
      ${table}
      <p class="muted small">${L("Sondages : moyenne des intentions de vote au premier tour (en %). Marchés : probabilité de gagner l’élection, d’après les cours de Kalshi et de Polymarket (en %). Variations en points, sur 24 heures et sur sept jours : vert en hausse, rouge en baisse, d’autant plus marqué que le mouvement est fort ; « = » : inchangé, « — » : pas de relevé à cette date.", "Polls: average first-round voting intention (%). Markets: probability of winning the election, from Kalshi and Polymarket prices (%). Changes in points over 24 hours and seven days: green up, red down, stronger for bigger moves; ‘=’: unchanged, ‘—’: no reading on that date.")}</p>

      <h3>${L("Ce qui a pu jouer", "What could have played a part")}</h3>
      ${b.movers.length ? `<ul class="dy-movers">${b.movers.map((m) => `<li>
          <p class="dy-mhead">${name(m.name)}${m.moves.map((x) => `<span class="dy-chip">${SRC[x.src]()} ${pill(x.d, x.days === 1 ? "24 h" : week)}</span>`).join("")}</p>
          ${m.headlines.length ? `<ul>${m.headlines.map((h) => `<li><a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted small">${esc(h.outlet)}, ${fmtDate(h.time)}${h.n > 1 ? ` · ${h.n} ${L("articles sur le sujet", "articles on the story")}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted small">${L("Aucun titre du fil d’actualité ne nomme ce candidat sur la période : pas d’explication évidente.", "No headline in the feed names this candidate over the period: no obvious explanation.")}</p>`}
        </li>`).join("")}</ul>
        <p class="muted small">${L("Les titres viennent du fil d’actualité du site (presse nationale) et nomment le candidat sur la période du mouvement. Ce sont des éléments de contexte, pas des causes établies : un marché prédictif peu liquide peut bouger sur un seul gros ordre, et une moyenne de sondages bouge aussi quand un sondage ancien en sort.", "Headlines come from the site’s news feed (national press) and name the candidate over the period of the move. They are context, not established causes: a thinly traded prediction market can move on a single large order, and a polling average also moves when an old poll drops out.")} <a href="#/fil">${L("Voir le fil", "See the feed")}</a></p>`
        : `<p class="muted">${L("Aucun mouvement notable : moins d’un point en 24 heures et de deux points en sept jours sur les marchés, moins d’un point sur la moyenne des sondages.", "No notable move: under one point in 24 hours and two points in seven days on the markets, under one point in the polling average.")}</p>`}

      <h3>${L("Les derniers sondages", "The latest polls")}</h3>
      <ul class="dy-polls">${latest.map(pollLine).join("")}</ul>
      <p class="muted small">${L("Liste mise à jour toutes les heures depuis le relevé de Wikipédia ; les sondages paraissent quelques jours après la fin du terrain.", "List refreshed every hour from Wikipedia’s record; polls are published a few days after fieldwork ends.")} <a href="#/sondages#liste">${L("Tous les sondages", "Every poll")}</a></p>
    </article>`;
}
