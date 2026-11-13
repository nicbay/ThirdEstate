// The polling chart with a look ahead: every poll as a dot, the average as a line, then a dotted projection to
// election day inside a band (the polls model's 80 % range for the first-round score). Scenario buttons re-run
// the forecast with a different starting point and redraw the projection; the caller updates its headline.
// The chosen scenario is kept in the URL anchor (#/#scenario-<key>) so a "what if" view can be shared.
import type { Market } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { lineChart, pollDots, type Series } from "../lib/chart";
import { meta } from "../lib/candidates";
import { ELECTION_DAY, PRIMARY, SCENARIOS, forecast, isScenario, type Forecast, type ScenarioKey } from "../lib/forecast";
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
        // the projection starts from the chart's own last average and moves by what the scenario changed
        const replaced = key === "le-pen-out" && n === "Marine Le Pen";
        const pr = fc.projection.find((p) => p.name === (replaced ? "Jordan Bardella" : n));
        const last = line.at(-1);
        if (pr && last && last.date === lastDate) {
          // the model's knots are offsets from today's level: hang them on the chart's own last average
          const knots = pr.knots.map((k, i) => ({ date: i === 0 ? last.date : k.date, mid: Math.max(0, last.value + k.mid), lo: Math.max(0, last.value + k.lo), hi: Math.max(0, last.value + k.hi) }));
          const end = knots.at(-1)!;
          const who = replaced ? "Bardella" : m.surname;
          s.proj = {
            knots,
            label: replaced ? "Bardella" : undefined,
            title: L(`${who} le ${fmtDate(ELECTION_DAY)} : ${dec(end.lo)} à ${dec(end.hi)} % (8 chances sur 10), ${dec(end.mid)} % en moyenne`, `${who} on ${fmtDate(ELECTION_DAY)}: ${dec(end.lo)} to ${dec(end.hi)}% (8 in 10 chance), ${dec(end.mid)}% on average`),
          };
        }
        return s;
      })
      .filter((s) => s.line.length);
    const markers = [{ date: ELECTION_DAY, label: L(`1er tour, ${fmtDate(ELECTION_DAY)}`, `1st round, ${fmtDate(ELECTION_DAY)}`) }];
    if (fc.primary && key !== "no-primary") {
      const sure = key === "primary-held" || PRIMARY.status === "confirmed";
      markers.push({ date: fc.primary.day, label: sure ? L("Primaire", "Primary") : L("Primaire ? (proposée)", "Primary? (proposed)") });
    }
    chartBox.innerHTML = lineChart(series, { height: o.height, markers });
    const pr = fc.primary;
    const primLine = pr && key !== "no-primary"
      ? L(` ${esc(PRIMARY.name.fr)} (${PRIMARY.participants.map((n) => esc(meta(n).surname)).join(", ")} ; sans ${PRIMARY.declined.map((n) => esc(meta(n).surname)).join(" ni ")}) : ${key === "primary-held" ? "elle a lieu dans ce scénario" : `proposée pour le ${fmtDate(pr.day)}, elle se tient dans ${Math.round(pr.held)} % des simulations`}${pr.winners[0] ? ` ; ${esc(meta(pr.winners[0].name).surname)} la remporte ${Math.round(pr.winners[0].p)} fois sur 100` : ""}. Après la primaire, la zone de chaque participant s’ouvre vers le bas : le gagnant récupère l’essentiel des voix des autres, les perdants se retirent (la ligne en pointillés est la moyenne des deux).`,
          ` ${esc(PRIMARY.name.en)} (${PRIMARY.participants.map((n) => esc(meta(n).surname)).join(", ")}; without ${PRIMARY.declined.map((n) => esc(meta(n).surname)).join(" or ")}): ${key === "primary-held" ? "held in this scenario" : `proposed for ${fmtDate(pr.day)}, held in ${Math.round(pr.held)}% of simulations`}${pr.winners[0] ? `; ${esc(meta(pr.winners[0].name).surname)} wins it ${Math.round(pr.winners[0].p)} times in 100` : ""}. After the primary each participant’s band opens downwards: the winner takes most of the others’ votes, the losers withdraw (the dotted line averages the two).`)
      : "";
    note.innerHTML = `${key === "base" ? "" : `<b>${esc(label(key))}.</b> ${esc(desc(key))} `}${L(
      `Pointillés : la moyenne des sondages prolongée jusqu’au premier tour, avec la moitié de sa tendance des quatre derniers mois${key === "base" ? "" : ", dans ce scénario"} ; zone colorée : 8 chances sur 10 que le score tombe dedans, selon notre modèle (erreurs de sondage, ralliements tardifs, coups durs).`,
      `Dotted line: the polling average carried on to the first round, with half its trend of the last four months${key === "base" ? "" : ", in this scenario"}; shaded area: an 8-in-10 chance the score lands inside it, in our model (polling error, late rallies, setbacks).`,
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
