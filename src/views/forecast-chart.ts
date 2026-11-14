// The polling chart with a look ahead: every poll as a dot, the average as a line, then a dotted projection to
// election day inside a band (the polls model's 80 % range for the first-round score). Scenario buttons re-run
// the forecast with a different starting point and redraw the projection; the caller updates its headline.
// Scenarios combine (a primary plus a black swan, say); a button that clashes with the selection is greyed out.
// The selection is kept in the URL anchor (#/#scenario-<key>+<key>) so a "what if" view can be shared.
import { fetchJson, type Market } from "../data";
import { L, fmtDate } from "../i18n";
import { lineChart, pollDots, type RugMark, type Series } from "../lib/chart";
import { meta } from "../lib/candidates";
import { ELECTION_DAY, INCOMPATIBLE, PRIMARY, RALLY_SHARE, SCENARIOS, TREND_CAP, canonical, compatible, forecast, isScenario, type Forecast, type ScenarioKey } from "../lib/forecast";
import { gradeColor, pollValue, pollsterAnchor, pollsterName, pollsterRating, trend, type PollFile } from "../lib/polls";
import { dec } from "../lib/format";
import { esc } from "../util";

const today = () => new Date().toISOString().slice(0, 10);
const cache = new Map<string, Forecast>();

/** The forecast under a set of scenarios (empty = today's polls), computed once per data refresh and day. */
export function scenarioForecast(polls: PollFile, markets: { fetchedAt: string; markets: Market[] } | null, sel: readonly ScenarioKey[]): Forecast {
  const keys = canonical(sel);
  const k = `${polls.fetchedAt}|${markets?.fetchedAt ?? ""}|${today()}|${keys.join("+")}`;
  let fc = cache.get(k);
  if (!fc) cache.set(k, (fc = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], today(), keys)));
  return fc;
}

/** Scenarios from the URL anchor, e.g. #/#scenario-centre-primary+setback-le-pen. */
export function scenarioFromUrl(): ScenarioKey[] {
  const m = /#scenario-([\w+-]+)$/.exec(location.hash);
  return m ? canonical(m[1].split("+").filter(isScenario)) : [];
}
function setUrl(sel: readonly ScenarioKey[]) {
  const path = location.hash.replace(/#scenario-[\w+-]+$/, "").replace(/^(#\/[^#]*).*$/, "$1") || "#/";
  history.replaceState(history.state, "", sel.length ? `${path}#scenario-${sel.join("+")}` : path);
}

const def = (key: ScenarioKey) => SCENARIOS.find((x) => x.key === key)!;
const label = (key: ScenarioKey) => L(def(key).fr, def(key).en);
const desc = (key: ScenarioKey) => L(def(key).descFr, def(key).descEn);
/** "A + B" for the selection */
export const scenarioLabel = (sel: readonly ScenarioKey[]) => sel.map(label).join(" + ");

/** A candidate's ceiling in the model, or NaN. */
const ceilingOf = (fc: Forecast, name: string) => fc.ceilings[name] ?? NaN;

interface Opts {
  polls: PollFile;
  markets: { fetchedAt: string; markets: Market[] } | null;
  /** first date shown */
  from: () => string;
  /** candidates shown, in order */
  shown: () => string[];
  /** hidden candidates (legend toggles), optional */
  hidden?: () => Set<string>;
  height?: number;
  onChange?: (fc: Forecast) => void;
  /** where the one-line key and the folded method go (default: under the chart); the homepage puts them after its number */
  after?: HTMLElement;
  /** offer the four views (polls, prediction markets, odds of winning, scenarios); default: scenarios only */
  views?: boolean;
  /** candidates below this share (%, on the view's latest figure) are left off the chart */
  minShare?: number;
}

/** The chart's views: today's polls (default), the prediction markets, our odds of winning, and scenario planning. */
type View = "polls" | "markets" | "odds" | "scenarios";
const VIEWS: { key: View; fr: string; en: string }[] = [
  { key: "polls", fr: "Sondages", en: "Polls" },
  { key: "markets", fr: "Marchés de prédiction", en: "Prediction markets" },
  { key: "odds", fr: "Chances de victoire", en: "Odds of winning" },
  { key: "scenarios", fr: "Scénarios", en: "Scenario planning" },
];
/** The daily record of the forecast (scripts/forecast-history.ts): our chance of winning and the markets', per day. */
interface History { days: { date: string; rows: { name: string; win: number; polls: number | null; markets: number | null }[] }[] }
let historyP: Promise<History | null> | null = null;
const loadHistory = () => (historyP ??= fetchJson<History>("/data/forecast/history.json").catch(() => null));

/** Renders scenario buttons + chart + note into `box`; returns a redraw function (for range or legend changes). */
export function mountForecastChart(box: HTMLElement, o: Opts) {
  let sel = scenarioFromUrl();
  let view: View = !o.views || sel.length ? "scenarios" : "polls";
  const min = o.minShare ?? 0;
  box.innerHTML = `${o.views ? `<div class="fc-views" role="group" aria-label="${L("Vue", "View")}">${VIEWS.map((v) => `<button type="button" data-v="${v.key}">${esc(L(v.fr, v.en))}</button>`).join("")}</div>` : ""}<div class="scn" role="group" aria-label="${L("Scénarios, combinables", "Scenarios, can be combined")}">
      <p class="scn-k">${L("Et si… ?", "What if…?")} <span>${L("(plusieurs choix possibles)", "(pick several)")}</span></p>
      <div class="scn-list">${SCENARIOS.map((s) => `<button type="button" class="scn-btn scn-${s.kind}" data-k="${s.key}">${esc(L(s.fr, s.en))}</button>`).join("")}</div>
    </div>
    <div class="fc-chart"></div>`;
  // under the chart (or wherever the caller wants it): one line that says how to read it, the method folded away
  const chartBox = box.querySelector<HTMLElement>(".fc-chart")!;
  const foot = o.after ?? box.appendChild(document.createElement("div"));
  foot.innerHTML = `<p class="scn-key"></p>
    <details class="scn-more"><summary>${L("Méthode", "Method")}</summary><p class="scn-note"></p></details>`;
  const key = foot.querySelector<HTMLElement>(".scn-key")!;
  const note = foot.querySelector<HTMLElement>(".scn-note")!;
  const buttons = [...box.querySelectorAll<HTMLButtonElement>(".scn-btn")];
  const scnBox = box.querySelector<HTMLElement>(".scn")!;
  const viewButtons = [...box.querySelectorAll<HTMLButtonElement>(".fc-views button")];

  /** pressed / greyed-out state of every button */
  const syncButtons = () => {
    for (const b of buttons) {
      const k = b.dataset.k as ScenarioKey;
      const on = k === "base" ? sel.length === 0 : sel.includes(k);
      const blocked = k !== "base" && !on && !compatible(sel, k);
      b.setAttribute("aria-pressed", String(on));
      b.disabled = blocked;
      const clash = blocked ? INCOMPATIBLE.filter(([a, c]) => a === k || c === k).map(([a, c]) => (a === k ? c : a)).filter((x) => sel.includes(x)) : [];
      b.title = blocked
        ? L(`Incompatible avec « ${clash.map(label).join(", ")} »`, `Can’t be combined with “${clash.map(label).join(", ")}”`)
        : desc(k);
    }
  };

  const below = L(`Candidats sous ${min} % non affichés.`, `Candidates under ${min}% not shown.`);

  // ---- today's polls: the average and every poll, the latest one ringed in its institute's grade colour, and
  // each poll's grade along the bottom (click: the institute on the ranking page)
  const drawPolls = () => {
    const from = o.from();
    const pts = trend(o.polls.firstRound, from);
    const hidden = o.hidden?.() ?? new Set<string>();
    const lastDate = pts.at(-1)?.date ?? today();
    const nowV = pts.at(-1)?.values ?? {};
    const inRange = o.polls.firstRound.filter((p) => p.end >= from);
    const lastPoll = [...inRange].sort((a, b) => b.end.localeCompare(a.end))[0];
    const lastGrade = lastPoll ? pollsterRating(lastPoll.pollster)?.grade ?? null : null;
    const series: Series[] = o.shown()
      .filter((n) => !hidden.has(n) && (nowV[n] ?? 0) >= min)
      .map((n) => {
        const m = meta(n);
        const v = lastPoll ? pollValue(lastPoll, n) : null;
        return {
          name: n, label: m.surname, color: m.color,
          line: pts.filter((p) => p.values[n] != null).map((p) => ({ date: p.date, value: p.values[n] })),
          dots: pollDots(o.polls.firstRound, n, from, o.polls.source),
          ring: lastPoll && v != null ? { date: lastPoll.end, value: v, color: gradeColor(lastGrade), title: `${pollsterName(lastPoll.pollster)} (${lastGrade ?? L("non noté", "not graded")}) · ${fmtDate(lastPoll.end)} · ${m.surname} ${dec(v)} %` } : undefined,
        };
      })
      .filter((s) => s.line.length);
    const marks: RugMark[] = inRange.map((p) => {
      const g = pollsterRating(p.pollster)?.grade ?? null;
      return { date: p.end, text: g ? g[0] : "–", color: gradeColor(g), href: `#/sondages/instituts#${pollsterAnchor(p.pollster)}`, title: `${pollsterName(p.pollster)} · ${g ? L(`note ${g}`, `grade ${g}`) : L("pas encore noté", "not yet graded")} · ${fmtDate(p.end)}` };
    });
    chartBox.innerHTML = lineChart(series, { height: o.height, rug: { marks, label: L("Note", "Grade") } });
    const who = lastPoll ? ` (${esc(pollsterName(lastPoll.pollster))})` : "";
    key.innerHTML = L(
      `Ligne : moyenne des sondages jusqu’au ${fmtDate(lastDate)}, pondérée par la note des instituts. Points : chaque sondage ; cerclé, le dernier${who}, dans la couleur de sa note. Lettres en bas : la note de l’institut de chaque sondage, cliquez pour son classement. ${below}`,
      `Line: polling average up to ${fmtDate(lastDate)}, weighted by institute grade. Dots: each poll; ringed, the latest${who}, in its grade’s colour. Letters along the bottom: each poll’s institute grade, click for its ranking. ${below}`,
    );
    note.innerHTML = L(
      `Chaque sondage compte selon la note de son institut (de A+ à F), tirée de l’écart entre ses derniers sondages et les résultats depuis 2002. <a href="#/sondages/instituts">Le classement des instituts</a>.`,
      `Each poll counts by its institute’s grade (A+ to F), from how far its final polls landed from the results since 2002. <a href="#/sondages/instituts">The pollster ranking</a>.`,
    );
    o.onChange?.(scenarioForecast(o.polls, o.markets, []));
  };

  // ---- the prediction markets' chance of winning, or ours, day by day
  let seq = 0;
  const drawHistory = async (field: "markets" | "win") => {
    const my = ++seq;
    chartBox.innerHTML = `<p class="hday-small">${L("Chargement…", "Loading…")}</p>`;
    const h = await loadHistory();
    if (my !== seq) return;
    const days = h?.days ?? [];
    const last = days.at(-1)?.rows ?? [];
    const names = last.filter((r) => (r[field] ?? 0) >= min).sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0)).map((r) => r.name);
    const series: Series[] = names.map((n) => {
      const m = meta(n);
      const line = days.flatMap((d) => { const v = d.rows.find((r) => r.name === n)?.[field]; return v == null ? [] : [{ date: d.date, value: v }]; });
      return { name: n, label: m.surname, color: m.color, line };
    }).filter((s) => s.line.length);
    chartBox.innerHTML = series.length ? lineChart(series, { height: o.height }) : `<p class="hday-small">${L("Pas encore d’historique.", "No history yet.")}</p>`;
    const since = days[0] ? fmtDate(days[0].date) : "";
    key.innerHTML = field === "markets"
      ? L(`Chance de victoire selon les marchés de prédiction (Kalshi et Polymarket, pondérés par les volumes échangés), chaque jour depuis le ${since}. ${below}`, `Chance of winning priced by the prediction markets (Kalshi and Polymarket, weighted by volume traded), every day since ${since}. ${below}`)
      : L(`Notre chance de victoire, chaque jour depuis le ${since} : le modèle des sondages et les marchés, à parts égales. ${below}`, `Our chance of winning, every day since ${since}: the polls model and the markets, half and half. ${below}`);
    note.innerHTML = L(
      `Les marchés de prédiction sont des paris en argent réel sur le résultat ; leurs prix se lisent comme des probabilités. Notre prévision les mêle à parts égales à un modèle tiré des sondages. <a href="#/2027">La méthode</a>.`,
      `Prediction markets are real-money bets on the result; their prices read as probabilities. Our forecast blends them half and half with a model built on the polls. <a href="#/2027">The method</a>.`,
    );
    o.onChange?.(scenarioForecast(o.polls, o.markets, []));
  };

  const drawScenarios = () => {
    const fc = scenarioForecast(o.polls, o.markets, sel);
    const from = o.from();
    const pts = trend(o.polls.firstRound, from);
    const hidden = o.hidden?.() ?? new Set<string>();
    const lastDate = pts.at(-1)?.date ?? today();
    const nowV = pts.at(-1)?.values ?? {};
    // kept when today's share or the projected one reaches the floor (a scenario can lift someone above it)
    const projEnd = (n: string) => fc.projection.find((p) => p.name === (sel.includes("le-pen-out") && n === "Marine Le Pen" ? "Jordan Bardella" : n))?.knots.at(-1)?.mid ?? 0;
    const series: Series[] = o.shown()
      .filter((n) => !hidden.has(n) && ((nowV[n] ?? 0) >= min || projEnd(n) >= min))
      .map((n) => {
        const m = meta(n);
        const line = pts.filter((p) => p.values[n] != null).map((p) => ({ date: p.date, value: p.values[n] }));
        const s: Series = { name: n, label: m.surname, color: m.color, line, dots: pollDots(o.polls.firstRound, n, from, o.polls.source) };
        // the projection leaves from the chart's own last average and heads for the model's levels, which add up to 100
        const replaced = sel.includes("le-pen-out") && n === "Marine Le Pen";
        const pr = fc.projection.find((p) => p.name === (replaced ? "Jordan Bardella" : n));
        const last = line.at(-1);
        if (pr && last && last.date === lastDate) {
          const knots = pr.knots.map((k, i) => (i === 0 ? { date: last.date, mid: last.value, lo: last.value, hi: last.value } : k));
          const end = knots.at(-1)!;
          const who = replaced ? "Bardella" : m.surname;
          s.proj = pr.outAt ? {
            knots, out: true,
            title: L(`${who} se retire à la primaire du ${fmtDate(pr.outAt)}`, `${who} withdraws at the ${fmtDate(pr.outAt)} primary`),
          } : {
            knots,
            label: replaced ? "Bardella" : undefined,
            title: L(`${who} le ${fmtDate(ELECTION_DAY)} : ${dec(end.lo)} à ${dec(end.hi)} % (8 chances sur 10), ${dec(end.mid)} % attendus`, `${who} on ${fmtDate(ELECTION_DAY)}: ${dec(end.lo)} to ${dec(end.hi)}% (8 in 10 chance), ${dec(end.mid)}% expected`),
          };
        }
        return s;
      })
      .filter((s) => s.line.length);
    const markers = [{ date: ELECTION_DAY, label: L("1er tour", "1st round"), title: L(`Premier tour, ${fmtDate(ELECTION_DAY)}`, `First round, ${fmtDate(ELECTION_DAY)}`) }];
    if (fc.primary) markers.push({ date: fc.primary.day, label: L("Primaire", "Primary"), title: L(`Primaire du centre (scénario), ${fmtDate(fc.primary.day)}`, `Centre primary (scenario), ${fmtDate(fc.primary.day)}`) });
    // the figures at the line ends are the projection on election day, not today's average: the chart says so
    chartBox.innerHTML = lineChart(series, { height: o.height, markers, endHead: L("1er tour, projeté", "1st round, projected") });

    const pr = fc.primary;
    const sn = (names: string[], fr: boolean) => { const xs = names.map((n) => esc(meta(n).surname)); return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${fr ? "et" : "and"} ${xs.at(-1)}` : xs.join(""); };
    const win = pr?.winner ? esc(meta(pr.winner).surname) : null;
    const primLine = pr && win
      ? L(` Primaire : le mieux placé dans les sondages de fin décembre l’emporte, ${win} selon la tendance actuelle. ${sn(pr.losers, true)} se retirent (✕) et ${Math.round(100 * RALLY_SHARE)} % de leurs électeurs le rejoignent ; ${sn(PRIMARY.rallyFrom, true)} n’y participe pas : seuls ${Math.round(100 * PRIMARY.rallyFromShare)} % de ses électeurs le rejoignent.`,
          ` Primary: whoever is best placed in the end-of-December polls wins, ${win} on the current trend. ${sn(pr.losers, false)} withdraw (✕) and ${Math.round(100 * RALLY_SHARE)}% of their voters join him; ${sn(PRIMARY.rallyFrom, false)} stays out: only ${Math.round(100 * PRIMARY.rallyFromShare)}% of his voters join him.`)
      : "";
    const base = sel.length === 0;
    // every candidate of the model is on the chart: say the figures add up
    const all = fc.projection.every((p) => series.some((x) => x.name === p.name || (p.name === "Jordan Bardella" && x.name === "Marine Le Pen" && sel.includes("le-pen-out"))));
    key.innerHTML = L(
      `Ligne pleine : moyenne des sondages jusqu’au ${fmtDate(lastDate)}. Pointillés et chiffres en bout de ligne : la projection au premier tour (${fmtDate(ELECTION_DAY)})${all ? ", 100 % à eux tous" : ""} ; zone : 8 chances sur 10.`,
      `Solid line: polling average up to ${fmtDate(lastDate)}. Dotted line and the figures at the line ends: the projection to the first round (${fmtDate(ELECTION_DAY)})${all ? ", 100% between them" : ""}; shaded: an 8-in-10 range.`,
    ) + (min && !all ? ` ${below}` : "");
    note.innerHTML = `${base ? "" : `<b>${esc(scenarioLabel(sel))}.</b> `}${L(
      `Pointillés : les sondages tels quels, prolongés d’une tendance lente (un cinquième de celle des quatre derniers mois, ${TREND_CAP} points au plus)${base ? "" : ", plus ce que change le scénario"} ; les scores de tous les candidats (y compris ceux non affichés) font 100 %. Zone colorée : 8 chances sur 10 que le score tombe dedans, selon notre modèle (erreurs de sondage, ralliements tardifs et cygnes noirs tirés au hasard). Personne ne dépasse un plafond tiré du rejet : on ne gagne au plus que la moitié du chemin vers l’électorat qui n’exclut pas de voter pour vous (Mélenchon : ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))} %).`,
      `Dotted line: the polls as they are, carried forward with a slow trend (a fifth of the last four months’ trend, ${TREND_CAP} points at most)${base ? "" : ", plus what the scenarios change"}; all candidates’ scores (including those not shown) add up to 100%. Shaded area: an 8-in-10 chance the score lands inside it, in our model (polling error, random late rallies and black swans). Nobody goes above a ceiling drawn from rejection: at most half the way to the electorate that doesn’t rule out voting for them (Mélenchon: ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))}%).`,
    )}${primLine} <a href="#/2027">${L("La méthode", "The method")}</a>.`;
    o.onChange?.(fc);
  };

  const draw = () => {
    scnBox.hidden = view !== "scenarios";
    for (const b of viewButtons) b.setAttribute("aria-pressed", String(b.dataset.v === view));
    if (view === "polls") drawPolls();
    else if (view === "markets") void drawHistory("markets");
    else if (view === "odds") void drawHistory("win");
    else drawScenarios();
  };
  for (const b of viewButtons)
    b.addEventListener("click", () => {
      view = b.dataset.v as View;
      if (view !== "scenarios" && sel.length) { sel = []; syncButtons(); setUrl(sel); }
      draw();
    });

  for (const b of buttons)
    b.addEventListener("click", () => {
      const k = b.dataset.k as ScenarioKey;
      sel = k === "base" ? [] : sel.includes(k) ? sel.filter((x) => x !== k) : canonical([...sel, k]);
      syncButtons();
      setUrl(sel);
      draw();
    });
  syncButtons();
  draw();
  return draw;
}
