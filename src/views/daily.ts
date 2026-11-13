// "Le point du jour": where the race stands today and how it moved — the polling average, our forecast,
// and (secondary) the prediction markets — with the headlines that could have played a part and the
// latest polls.
//
// One set of numbers: the polling average and its 24-hour / 7-day changes are computed here, live, from
// the hourly poll file with the site's one `average` (lib/polls), so they match every other block on the
// site. The once-a-day file (/data/daily/latest.json, scripts/daily-brief.ts, see docs/data-daily.md) is
// only used for what can't be recomputed in the browser: market moves, the matching headlines, and which
// polls are new since the previous brief. Its frozen polling figures (taken from the poll file as it was
// at the time of the run) are deliberately not shown.
import { fetchJson, loadMarkets, loadPolls, type Market } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { forecast, type Forecast } from "../lib/forecast";
import { combineOdds, oddsFor, winShare } from "../lib/markets";
import { average, pollValue, pollsterName, type Poll, type PollFile } from "../lib/polls";
import { dec, pct } from "../lib/format";
import { esc, safeColor, safeUrl } from "../util";

interface Headline { title: string; link: string; outlet: string; time: string; n: number }
interface Brief {
  date: string; generatedAt: string;
  newPolls: { pollster: string; end: string }[];
  movers: { name: string; moves: { src: "polls" | "kalshi" | "poly"; d: number; days: 1 | 7; now: number }[]; headlines: Headline[] }[];
}
export interface Move { now: number; d1: number | null; d7: number | null }

const DAY = 86400000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const today = () => isoDay(Date.now());
const r1 = (x: number) => Math.round(x * 10) / 10;
/** A polling move worth a line (same thresholds as scripts/daily-brief.ts): ½ point in a day, 1 point in a week. */
const NOTABLE_POLLS = { d1: 0.5, d7: 1 };

/** The polling average today, yesterday and a week ago, each through the site's one `average`. */
export function pollMoves(firstRound: Poll[], asOf = today()): Map<string, Move> {
  const at = (d: string) => new Map(average(firstRound, d).map((r) => [r.name, r.avg]));
  const t = Date.parse(asOf);
  const now = at(asOf), y1 = at(isoDay(t - DAY)), y7 = at(isoDay(t - 7 * DAY));
  const out = new Map<string, Move>();
  for (const [name, v] of now) {
    const d = (m: Map<string, number>) => (m.has(name) ? r1(v - m.get(name)!) : null);
    out.set(name, { now: v, d1: d(y1), d7: d(y7) });
  }
  return out;
}

let fcCache: { key: string; fc: Forecast } | null = null;
/** Our forecast as of today, computed once per data refresh (the homepage, this brief and the polls page share it). */
export function liveForecast(polls: PollFile, markets: { fetchedAt: string; markets: Market[] } | null): Forecast {
  const key = `${polls.fetchedAt}|${markets?.fetchedAt ?? ""}|${today()}`;
  if (fcCache?.key !== key) fcCache = { key, fc: forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], today()) };
  return fcCache.fc;
}

export const loadBrief = () => fetchJson<Brief>("/data/daily/latest.json").catch(() => null);

/** The day in one sentence, from the live average: the leader, the biggest weekly mover, the latest poll. */
export function todaySentence(firstRound: Poll[], moves = pollMoves(firstRound)): string {
  const fr = getLang() === "fr";
  const rows = [...moves].map(([name, m]) => ({ name, ...m })).sort((a, b) => b.now - a.now);
  const lead = rows[0];
  if (!lead) return "";
  const ptsTxt = (d: number) => `${d > 0 ? "+" : "−"}${dec(Math.abs(d))} ${Math.abs(d) >= 2 ? "pts" : "pt"}`;
  const leadMove = lead.d7 == null || Math.abs(lead.d7) < 0.5 ? L("stable sur 7 jours", "steady over 7 days") : `${ptsTxt(lead.d7)} ${L("en 7 jours", "in 7 days")}`;
  let s = fr
    ? `${meta(lead.name).surname} en tête de la moyenne des sondages, à ${pct(lead.now)} (${leadMove})`
    : `${meta(lead.name).surname} leads the polling average at ${pct(lead.now)} (${leadMove})`;
  const mover = rows.slice(1, 8).filter((r) => r.d7 != null && Math.abs(r.d7) >= NOTABLE_POLLS.d7).sort((a, b) => Math.abs(b.d7!) - Math.abs(a.d7!))[0];
  if (mover) s += fr ? ` ; ${meta(mover.name).surname} ${ptsTxt(mover.d7!)}, à ${pct(mover.now)}` : `; ${meta(mover.name).surname} ${ptsTxt(mover.d7!)} to ${pct(mover.now)}`;
  const last = [...firstRound].sort((a, b) => b.end.localeCompare(a.end))[0];
  if (last) s += fr ? ` ; dernier sondage : ${pollsterName(last.pollster)}, terrain achevé le ${fmtDate(last.end)}` : `; latest poll: ${pollsterName(last.pollster)}, fieldwork ended ${fmtDate(last.end)}`;
  return `${s}.`;
}

/** Why our forecast and the markets disagree, in plain words; states today's gap when it is large. */
export function whyDiffer(fc: Forecast): string {
  const fr = getLang() === "fr";
  const top = fc.rows[0];
  const pw = top?.polls?.win, mw = top?.markets?.win;
  const months = Math.max(1, Math.round(fc.daysToGo / 30));
  let gap = "";
  if (top && pw != null && mw != null && Math.abs(pw - mw) >= 15) {
    const n = esc(meta(top.name).surname);
    const pq = top.polls!.qualify, wr = pq ? (100 * pw) / pq : 0; // how often the polls model has them win the runoffs they reach
    const wins = wr >= 90 ? L("le gagne presque toujours", "nearly always wins it") : L(`le gagne dans ${pct(wr, 0)} des cas`, `wins it ${pct(wr, 0)} of the time`);
    gap = pw > mw
      ? fr
        ? `<p>Aujourd’hui, l’écart est grand pour ${n} : notre modèle de sondages lui donne ${pct(pw, 0)}, les marchés ${pct(mw, 0)}, d’où ${pct(top.win, 0)} dans notre prévision. Dans le modèle, ${n} se qualifie pour le second tour dans ${pct(pq, 0)} des simulations et ${wins}. Mais il prend les candidats testés par les instituts comme acquis : il ne sait pas dire si un candidat sera bien sur le bulletin, ni si ses adversaires se rangeront derrière l’un d’eux. Les marchés, eux, le prennent en compte, et c’est la principale raison de l’écart. À ${months} mois du vote, les sondages se sont souvent trompés de plus que ça${fc.nLineupPolls < 4 ? `, et la configuration de référence ne repose que sur ${fc.nLineupPolls} sondage${fc.nLineupPolls > 1 ? "s" : ""}` : ""} : lisez ce chiffre comme « en tête », pas comme « élection jouée ».</p>`
        : `<p>Today the gap is wide for ${n}: our polls model gives ${pct(pw, 0)}, the markets ${pct(mw, 0)}, hence ${pct(top.win, 0)} in our forecast. In the model, ${n} reaches the runoff in ${pct(pq, 0)} of simulations and ${wins}. But it takes the candidates pollsters test as given: it can’t tell whether a candidate will actually be on the ballot, or whether rivals will rally behind one of them. The markets do price that, and it is the main reason for the gap. ${months} months out, polls have often missed by more than this${fc.nLineupPolls < 4 ? `, and the reference line-up rests on just ${fc.nLineupPolls} poll${fc.nLineupPolls > 1 ? "s" : ""}` : ""}: read the number as “ahead”, not “done deal”.</p>`
      : fr
        ? `<p>Aujourd’hui, les marchés donnent à ${n} plus que les sondages (${pct(mw, 0)} contre ${pct(pw, 0)}) : les parieurs anticipent peut-être une remontée ou un retrait d’un rival, ce que le modèle de sondages, qui ne voit que les chiffres du jour, ne fait pas.</p>`
        : `<p>Today the markets rate ${n} above the polls (${pct(mw, 0)} against ${pct(pw, 0)}): traders may expect a rise or a rival dropping out, which the polls model, seeing only today’s numbers, does not.</p>`;
  }
  return `<div class="dy-why">
    <h3>${L("Pourquoi notre prévision et les marchés diffèrent", "Why our forecast and the markets differ")}</h3>
    <p>${L(
      "Notre prévision mesure ce que disent les sondages : elle rejoue l’élection 20 000 fois à partir de la moyenne des sondages, avec une marge d’erreur qui se resserre à l’approche du vote, puis compte ce résultat pour moitié et les marchés pour l’autre moitié.",
      "Our forecast measures what the polls say: it replays the election 20,000 times from the polling average, with a margin of error that narrows as the vote nears, then counts that result for half and the markets for the other half.",
    )}</p>
    <p>${L(
      "Le prix d’un marché, c’est ce que des parieurs de Kalshi et Polymarket paient pour un contrat qui rapporte si un candidat gagne : un pari, pas un sondage, fait par un petit nombre de personnes, surtout hors de France. Il réagit à l’actualité avant les sondages et intègre des choses qu’un sondage ne mesure pas, comme la probabilité qu’un candidat se présente vraiment.",
      "A market price is what traders on Kalshi and Polymarket pay for a contract that pays out if a candidate wins: a bet, not a survey, by a small number of people, mostly outside France. It reacts to news before the polls do and takes in things a poll doesn’t measure, such as the odds that a candidate actually stands.",
    )}</p>
    ${gap}
    <p class="muted small"><a href="#/2027">${L("La méthode complète de la prévision", "The forecast’s full method")}</a> · <a href="#/sondages#marches">${L("Les marchés en détail", "The markets in detail")}</a></p>
  </div>`;
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

/** A live polling move as the brief's mover format, when it is notable. */
const pollsMove = (m: Move | undefined) =>
  m?.d1 != null && Math.abs(m.d1) >= NOTABLE_POLLS.d1 ? { src: "polls" as const, d: m.d1, days: 1 as const, now: m.now }
  : m?.d7 != null && Math.abs(m.d7) >= NOTABLE_POLLS.d7 ? { src: "polls" as const, d: m.d7, days: 7 as const, now: m.now }
  : null;

/** Fills `box` with the day's brief (the polls page, #/sondages#point). */
export async function mountDaily(box: HTMLElement | null) {
  if (!box) return;
  const [b, polls, markets] = await Promise.all([loadBrief(), loadPolls("2027").catch(() => null), loadMarkets().catch(() => null)]);
  if (!polls || !document.body.contains(box)) { box.remove(); return; }
  registerParties(polls.parties);
  const moves = pollMoves(polls.firstRound);
  const fc = liveForecast(polls, markets);
  const odds = combineOdds(markets?.markets ?? []);
  const week = L("7 j", "7 d");
  const name = (n: string) => `<span class="dy-name"><i class="dot" style="background:${safeColor(meta(n).color)}"></i>${esc(n)}</span>`;

  // rows: everyone at 2 % or more in the polling average or in our forecast
  const fcBy = new Map(fc.rows.map((r) => [r.name, r]));
  const names = [...new Set([...[...moves].filter(([, m]) => m.now >= 2).map(([n]) => n), ...fc.rows.filter((r) => r.win >= 2).map((r) => r.name)])];
  names.sort((a, c) => (moves.get(c)?.now ?? 0) - (moves.get(a)?.now ?? 0) || (fcBy.get(c)?.win ?? 0) - (fcBy.get(a)?.win ?? 0));
  const rows = names.slice(0, 10);
  const maxPolls = Math.max(1, ...rows.map((n) => moves.get(n)?.now ?? 0));
  const table = `<div class="dy-grid">
    <div class="dy-hrow" aria-hidden="true"><span></span><span>${L("Sondages", "Polls")} <small>${L("moyenne au 1er tour", "first-round average")}</small></span><span>${L("Notre prévision", "Our forecast")} <small>${L("chances de victoire", "chance of winning")}</small></span><span class="dy-mk">${L("Marchés", "Markets")} <small>${L("pour comparaison", "for comparison")}</small></span></div>
    ${rows.map((n) => {
      const m = moves.get(n), f = fcBy.get(n), mk = winShare(odds, oddsFor(odds, n));
      return `<div class="dy-row" style="--c:${safeColor(meta(n).color)}"><div class="dy-who">${name(n)}</div>
        <div class="dy-src" data-l="${L("Sondages", "Polls")}">${m ? `<b class="dy-val">${pct(m.now)}</b><span class="dy-bar"><i style="width:${Math.max(2, Math.round((100 * m.now) / maxPolls))}%"></i></span><span class="dy-pills">${pill(m.d1, "24 h")}${pill(m.d7, week)}</span>` : `<span class="dy-none">${L("pas dans la moyenne", "not in the average")}</span>`}</div>
        <div class="dy-src" data-l="${L("Prévision", "Forecast")}">${f ? `<b class="dy-val">${pct(f.win, 0)}</b>` : `<span class="dy-none">—</span>`}</div>
        <div class="dy-src dy-mk" data-l="${L("Marchés", "Markets")}">${mk != null ? `<span class="dy-mval">${pct(mk, 0)}</span>` : `<span class="dy-none">—</span>`}</div></div>`;
    }).join("")}
  </div>`;

  // the moves: polls live, markets from the daily file (in their own price points, so no level is quoted)
  const movers = (b?.movers ?? [])
    .map((m) => ({ ...m, moves: [...m.moves.filter((x) => x.src !== "polls"), ...[pollsMove(moves.get(m.name))].filter((x) => x != null)] }))
    .filter((m) => m.moves.length);
  const big = [
    ...[...moves].flatMap(([n, m]) => { const x = pollsMove(m); return x ? [{ ...x, name: n }] : []; }),
    ...movers.flatMap((m) => m.moves.filter((x) => x.src !== "polls").map((x) => ({ ...x, name: m.name }))),
  ].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 4);
  const tiles = big.length ? `<ul class="dy-tiles">${big.map((x) => `<li class="dy-tile ${x.d > 0 ? "is-up" : "is-down"}">
      <span class="dy-tile-d"><i aria-hidden="true">${x.d > 0 ? "▲" : "▼"}</i>${x.d > 0 ? "+" : "−"}${dec(Math.abs(x.d))}<small>${Math.abs(x.d) >= 2 ? "pts" : "pt"}</small></span>
      <span class="dy-tile-n">${esc(meta(x.name).surname)}</span>
      <span class="dy-tile-s">${SRC[x.src]()} · ${x.days === 1 ? "24 h" : week}${x.src === "polls" ? ` · ${L("à", "now")} ${pct(x.now)}` : ""}</span></li>`).join("")}</ul>` : "";

  // the latest polls, straight from the hourly file; "new" = published since the last brief
  const fresh = new Set((b?.newPolls ?? []).map((p) => `${p.pollster}|${p.end}`));
  const latest = [...polls.firstRound].sort((x, y) => y.end.localeCompare(x.end)).slice(0, 6);
  const pollLine = (p: Poll) => {
    const top = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))].map((n) => ({ n, v: pollValue(p, n)! })).sort((x, y) => y.v - x.v).slice(0, 5);
    return `<li><span class="dy-pwho">${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener"><b>${esc(pollsterName(p.pollster))}</b></a>` : `<b>${esc(pollsterName(p.pollster))}</b>`}${fresh.has(`${pollsterName(p.pollster)}|${p.end}`) ? ` <span class="px-tag">${L("Nouveau", "New")}</span>` : ""}<span class="muted small">${fmtDate(p.start)} – ${fmtDate(p.end)}${p.sample ? ` · ${p.sample.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB")} ${L("pers.", "people")}` : ""}</span></span>
      <span class="dy-ptop">${top.map((t) => `<span style="--c:${safeColor(meta(t.n).color)}"><i></i>${esc(meta(t.n).surname)} <b>${dec(t.v, t.v % 1 ? 1 : 0)}</b></span>`).join("")}</span></li>`;
  };

  box.innerHTML = `<article class="card dy" id="point">
      <header class="card-head"><h2>${L("Le point du jour", "Today’s brief")}</h2></header>
      <p class="dy-when">${esc(longDate(today()))} · ${L("sondages relevés à", "polls checked at")} ${clock(polls.fetchedAt)}${markets ? ` · ${L("marchés à", "markets at")} ${clock(markets.fetchedAt)}` : ""}</p>
      <p class="dy-sum">${esc(todaySentence(polls.firstRound, moves))}</p>
      ${tiles}
      ${table}
      <p class="muted small">${L("Sondages : moyenne des intentions de vote au premier tour (en %), la même que partout sur le site, et sa variation en points sur 24 heures et sur sept jours. Notre prévision : chances de gagner l’élection. Marchés : la même probabilité d’après les cours de Kalshi et Polymarket, moyennés selon les volumes échangés ; donnés pour comparaison, ce ne sont pas des sondages.", "Polls: average first-round voting intention (%), the same one used across the site, and its change in points over 24 hours and seven days. Our forecast: chance of winning the election. Markets: the same probability from Kalshi and Polymarket prices, averaged by traded volume; shown for comparison, they aren’t polls.")}</p>
      ${whyDiffer(fc)}

      <h3>${L("Ce qui a pu jouer", "What could have played a part")}</h3>
      ${movers.length ? `<ul class="dy-movers">${movers.map((m) => `<li>
          <p class="dy-mhead">${name(m.name)}${m.moves.map((x) => `<span class="dy-chip">${SRC[x.src]()} ${pill(x.d, x.days === 1 ? "24 h" : week)}</span>`).join("")}</p>
          ${m.headlines.length ? `<ul>${m.headlines.map((h) => `<li><a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted small">${esc(h.outlet)}, ${fmtDate(h.time)}${h.n > 1 ? ` · ${h.n} ${L("articles sur le sujet", "articles on the story")}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted small">${L("Aucun titre du fil d’actualité ne nomme ce candidat sur la période : pas d’explication évidente.", "No headline in the feed names this candidate over the period: no obvious explanation.")}</p>`}
        </li>`).join("")}</ul>
        <p class="muted small">${L("Les mouvements des marchés et les titres viennent du point quotidien", "Market moves and headlines come from the daily brief of")} ${b ? fmtDate(b.date) : ""}. ${L("Les titres viennent du fil d’actualité du site (presse nationale) et nomment le candidat sur la période du mouvement. Ce sont des éléments de contexte, pas des causes établies : un marché prédictif peu liquide peut bouger sur un seul gros ordre, et une moyenne de sondages bouge aussi quand un sondage ancien en sort.", "Headlines come from the site’s news feed (national press) and name the candidate over the period of the move. They are context, not established causes: a thinly traded prediction market can move on a single large order, and a polling average also moves when an old poll drops out.")} <a href="#/fil">${L("Voir le fil", "See the feed")}</a></p>`
        : `<p class="muted">${L("Aucun mouvement notable : moins d’un demi-point en 24 heures et d’un point en sept jours dans la moyenne des sondages, moins d’un point en 24 heures et de deux points en sept jours sur les marchés.", "No notable move: under half a point in 24 hours and one point in seven days in the polling average, under one point in 24 hours and two points in seven days on the markets.")}</p>`}

      <h3>${L("Les derniers sondages", "The latest polls")}</h3>
      <ul class="dy-polls">${latest.map(pollLine).join("")}</ul>
      <p class="muted small">${L("Liste mise à jour toutes les heures depuis le relevé de Wikipédia ; les sondages paraissent quelques jours après la fin du terrain.", "List refreshed every hour from Wikipedia’s record; polls are published a few days after fieldwork ends.")} <a href="#/sondages#liste">${L("Tous les sondages", "Every poll")}</a></p>
    </article>`;
}
