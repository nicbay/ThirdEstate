// The polling chart with a look ahead: every poll as a dot, the average as a line, then a dotted projection to
// election day inside a band (the polls model's 80 % range for the first-round score). Scenario buttons re-run
// the forecast with a different starting point and redraw the projection; the caller updates its headline.
// The chosen scenario is kept in the URL anchor (#/#scenario-<key>) so a "what if" view can be shared.
import type { Market } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { lineChart, pollDots, type Series } from "../lib/chart";
import { meta } from "../lib/candidates";
import { ELECTION_DAY, PRIMARY, RALLY_SHARE, SCENARIOS, forecast, isScenario, type Forecast, type ScenarioKey } from "../lib/forecast";
import { trend, type PollFile } from "../lib/polls";
import { dec, pct } from "../lib/format";
import { esc } from "../util";

const today = () => new Date().toISOString().slice(0, 10);
const cache = new Map<string, Forecast>();

/** The forecast under a scenario, computed once per data refresh and day. */
export function scenarioForecast(polls: PollFile, markets: { fetchedAt: string; markets: Market[] } | null, key: ScenarioKey): Forecast {
  const k = `${polls.fetchedAt}|${markets?.fetchedAt ?? ""}|${today()}|${key}`;
  let fc = cache.get(k);
  if (!fc) cache.set(k, (fc = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], today(), key)));
  return fc;
}

/** Scenario from the URL anchor, e.g. #/#scenario-left-unites or #/sondages#scenario-le-pen-out. */
export function scenarioFromUrl(): ScenarioKey {
  const m = /#scenario-([\w-]+)$/.exec(location.hash);
  return m && isScenario(m[1]) ? m[1] : "base";
}
function setUrl(key: ScenarioKey) {
  const path = location.hash.replace(/#scenario-[\w-]+$/, "").replace(/^(#\/[^#]*).*$/, "$1") || "#/";
  history.replaceState(history.state, "", key === "base" ? path : `${path}#scenario-${key}`);
}

const label = (key: ScenarioKey) => { const s = SCENARIOS.find((x) => x.key === key)!; return L(s.fr, s.en); };
const desc = (key: ScenarioKey) => { const s = SCENARIOS.find((x) => x.key === key)!; return L(s.descFr, s.descEn); };

/** A candidate's ceiling in the model, or NaN. */
const ceilingOf = (fc: Forecast, name: string) => fc.ceilings[name] ?? NaN;

/** One sentence saying what the headline number means under the current scenario. */
export function scenarioHeadline(fc: Forecast, base?: Forecast): string {
  const fav = fc.rows[0];
  if (!fav || fc.scenario === "base") return "";
  const fr = getLang() === "fr";
  // like for like: the same polls model, today, for the same candidate
  const ref = base?.rows.find((r) => r.name === fav.name)?.polls?.win;
  const cmp = ref == null ? "" : fr
    ? ` Sans ce scénario, le même modèle lui donne ${pct(ref, 0)}.`
    : ` Without this scenario, the same model gives ${esc(fav.name)} ${pct(ref, 0)}.`;
  return fr
    ? `Scénario « ${esc(label(fc.scenario))} » : ${esc(desc(fc.scenario))} Chiffre du seul modèle des sondages : les marchés ne peuvent pas être recalculés pour un monde imaginé.${cmp}`
    : `Scenario “${esc(label(fc.scenario))}”: ${esc(desc(fc.scenario))} Figure from the polls model alone: markets can’t be re-priced for an imagined world.${cmp}`;
}

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
}

/** Renders scenario buttons + chart + note into `box`; returns a redraw function (for range or legend changes). */
export function mountForecastChart(box: HTMLElement, o: Opts) {
  let key = scenarioFromUrl();
  box.innerHTML = `<div class="scn" role="group" aria-label="${L("Scénarios", "Scenarios")}">
      <p class="scn-k">${L("Et si… ?", "What if…?")}</p>
      <div class="scn-list">${SCENARIOS.map((s) => `<button type="button" class="scn-btn scn-${s.kind}" data-k="${s.key}" aria-pressed="${s.key === key}" title="${esc(L(s.descFr, s.descEn))}">${esc(L(s.fr, s.en))}</button>`).join("")}</div>
    </div>
    <div class="fc-chart"></div>
    <p class="muted small scn-note"></p>`;
  const chartBox = box.querySelector<HTMLElement>(".fc-chart")!;
  const note = box.querySelector<HTMLElement>(".scn-note")!;

  const draw = () => {
    const fc = scenarioForecast(o.polls, o.markets, key);
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
        const replaced = key === "le-pen-out" && n === "Marine Le Pen";
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
            title: L(`${who} le ${fmtDate(ELECTION_DAY)} : ${dec(end.lo)} à ${dec(end.hi)} % (8 chances sur 10), ${dec(end.mid)} % en moyenne`, `${who} on ${fmtDate(ELECTION_DAY)}: ${dec(end.lo)} to ${dec(end.hi)}% (8 in 10 chance), ${dec(end.mid)}% on average`),
          };
        }
        return s;
      })
      .filter((s) => s.line.length);
    const markers = [{ date: ELECTION_DAY, label: L("1er tour", "1st round"), title: L(`Premier tour, ${fmtDate(ELECTION_DAY)}`, `First round, ${fmtDate(ELECTION_DAY)}`) }];
    if (fc.primary && key !== "no-primary") {
      markers.push({ date: fc.primary.day, label: L("Primaire", "Primary"), title: L(`Primaire du centre ${PRIMARY.status === "confirmed" ? "" : "(anticipée) "}— ${fmtDate(fc.primary.day)}`, `Centre primary ${PRIMARY.status === "confirmed" ? "" : "(anticipated) "}— ${fmtDate(fc.primary.day)}`) });
    }
    chartBox.innerHTML = lineChart(series, { height: o.height, markers });
    const pr = fc.primary;
    const sn = (names: string[], fr: boolean) => { const xs = names.map((n) => esc(meta(n).surname)); return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${fr ? "et" : "and"} ${xs.at(-1)}` : xs.join(""); };
    const win = pr?.winner ? esc(meta(pr.winner).surname) : null;
    const primLine = pr && key !== "no-primary" && win
      ? L(` Primaire du centre anticipée fin janvier : le mieux placé dans les sondages de fin décembre l’emporte, ${win} selon la tendance actuelle. ${sn(pr.losers, true)} se retirent (✕) et ${Math.round(100 * RALLY_SHARE)} % de leurs électeurs le rejoignent ; ${sn(PRIMARY.rallyFrom, true)} n’y participe pas mais ${Math.round(100 * PRIMARY.rallyFromShare)} % de ses électeurs le rejoignent aussi.`,
          ` Centre primary anticipated at the end of January: whoever is best placed in the end-of-December polls wins, ${win} on the current trend. ${sn(pr.losers, false)} withdraw (✕) and ${Math.round(100 * RALLY_SHARE)}% of their voters join him; ${sn(PRIMARY.rallyFrom, false)} doesn’t take part, but ${Math.round(100 * PRIMARY.rallyFromShare)}% of his voters join him too.`)
      : "";
    note.innerHTML = `${key === "base" ? "" : `<b>${esc(label(key))}.</b> ${esc(desc(key))} `}${L(
      `Pointillés : le score attendu au premier tour, avec la moitié de la tendance des quatre derniers mois${key === "base" ? "" : ", dans ce scénario"} ; les scores de tous les candidats (y compris ceux non affichés) font 100 %. Zone colorée : 8 chances sur 10 que le score tombe dedans, selon notre modèle (erreurs de sondage, ralliements tardifs, cygnes noirs). Personne ne dépasse un plafond tiré du rejet : on ne gagne au plus que la moitié du chemin vers l’électorat qui n’exclut pas de voter pour vous (Mélenchon : ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))} %).`,
      `Dotted line: the expected first-round score, with half the trend of the last four months${key === "base" ? "" : ", in this scenario"}; all candidates’ scores (including those not shown) add up to 100%. Shaded area: an 8-in-10 chance the score lands inside it, in our model (polling error, late rallies, black swans). Nobody goes above a ceiling drawn from rejection: at most half the way to the electorate that doesn’t rule out voting for them (Mélenchon: ${dec(ceilingOf(fc, "Jean-Luc Mélenchon"))}%).`,
    )}${primLine} <a href="#/2027">${L("La méthode", "The method")}</a>.`;
    o.onChange?.(fc);
  };

  box.querySelectorAll<HTMLButtonElement>(".scn-btn").forEach((b) =>
    b.addEventListener("click", () => {
      key = b.dataset.k as ScenarioKey;
      box.querySelectorAll<HTMLButtonElement>(".scn-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      setUrl(key);
      draw();
    }),
  );
  draw();
  return draw;
}
