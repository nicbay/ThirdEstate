// The polling chart with a look ahead: every poll as a dot, the average as a line, then a dotted projection to
// election day inside a band (the polls model's 80 % range for the first-round score). Scenario buttons re-run
// the forecast with a different starting point and redraw the projection; the caller updates its headline.
// Scenarios combine (a primary plus a black swan, say); a button that clashes with the selection is greyed out.
// The selection is kept in the URL anchor (#/#scenario-<key>+<key>) so a "what if" view can be shared.
import type { Market } from "../data";
import { L, fmtDate } from "../i18n";
import { lineChart, pollDots, type Series } from "../lib/chart";
import { meta } from "../lib/candidates";
import { ELECTION_DAY, INCOMPATIBLE, PRIMARY, RALLY_SHARE, SCENARIOS, TREND_CAP, canonical, compatible, forecast, isScenario, type Forecast, type ScenarioKey } from "../lib/forecast";
import { trend, type PollFile } from "../lib/polls";
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
}

/** Renders scenario buttons + chart + note into `box`; returns a redraw function (for range or legend changes). */
export function mountForecastChart(box: HTMLElement, o: Opts) {
  let sel = scenarioFromUrl();
  box.innerHTML = `<div class="scn" role="group" aria-label="${L("Scénarios, combinables", "Scenarios, can be combined")}">
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

  const draw = () => {
    const fc = scenarioForecast(o.polls, o.markets, sel);
    const from = o.from();
    const pts = trend(o.polls.firstRound, from);
    const hidden = o.hidden?.() ?? new Set<string>();
    const lastDate = pts.at(-1)?.date ?? today();
    const series: Series[] = o.shown()
      .filter((n) => !hidden.has(n))
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
    );
    note.innerHTML = `${base ? "" : `<b>${esc(scenarioLabel(sel))}.</b> `}${L(
      `Pointillés : les sondages tels quels, prolongés d’une tendance lente (un cinquième de celle des quatre derniers mois, ${TREND_CAP} points au plus)${base ? "" : ", plus ce que change le scénario"} ; les scores de tous les candidats (y compris ceux non affichés) font 100 %. Zone colorée : 8 chances sur 10 que le score tombe dedans, selon notre modèle (erreurs de sondage, ralliements tardifs et cygnes noirs tirés au hasard). Personne ne dépasse un plafond tiré du rejet : on ne gagne au plus que la moitié du chemin vers l’électorat qui n’exclut pas de voter pour vous (Mélenchon : ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))} %).`,
      `Dotted line: the polls as they are, carried forward with a slow trend (a fifth of the last four months’ trend, ${TREND_CAP} points at most)${base ? "" : ", plus what the scenarios change"}; all candidates’ scores (including those not shown) add up to 100%. Shaded area: an 8-in-10 chance the score lands inside it, in our model (polling error, random late rallies and black swans). Nobody goes above a ceiling drawn from rejection: at most half the way to the electorate that doesn’t rule out voting for them (Mélenchon: ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))}%).`,
    )}${primLine} <a href="#/2027">${L("La méthode", "The method")}</a>.`;
    o.onChange?.(fc);
  };

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
