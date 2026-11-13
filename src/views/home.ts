// Front page, top to bottom: the polls and on to the first round (on the dark hero, under the day's headline);
// one quiet line for the quiz; the reader's own town (when known); the note of the day (key
// takeaways, polls, what changed, stories, posts); two widgets, the Assembly's 577 seats and the shift map.
// The parts are built in views/hero-day.ts.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate } from "../i18n";
import { registerParties } from "../lib/candidates";
import { getHome } from "../lib/cloud";
import { average, latestPollDate, pollsInWindow, WINDOW } from "../lib/polls";
import { colon } from "../lib/format";
import { esc } from "../util";
import { mpChip, townBrief } from "./brief";
import { mountForecastChart, scenarioForecast, scenarioFromUrl } from "./forecast-chart";
import { forecastLine, heroDay } from "./hero-day";
import { mountOcean } from "../lib/ocean";

export async function renderHome(app: HTMLElement) {
  const [polls, markets, hero] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null), heroDay()]);
  registerParties(polls.parties);
  const latest = latestPollDate(polls.firstRound);
  const now = average(polls.firstRound, latest);
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const home = getHome();

  app.innerHTML = `
    <section class="page home">
      <section class="hero-x hday" aria-labelledby="hday-title">
        ${hero.headHtml}
        <div class="hday-chart">
          <div id="trend" class="reveal"></div>
          <div id="hq-num">${forecastLine(scenarioForecast(polls, markets, scenarioFromUrl()))}</div>
          <div id="hq-foot" class="hday-small"></div>
        </div>
        <div class="px-edge" aria-hidden="true"></div>
      </section>

      <p class="quiz-line"><b>${L("Le quiz : qui vous ressemble ?", "The quiz: who is closest to you?")}</b> <span>${L("Dix votes de l’Assemblée, et le député et le candidat les plus proches de vous.", "Ten Assembly votes, and the MP and the candidate closest to you.")}</span> <a class="button" href="#/quiz">${L("Faire le quiz", "Take the quiz")}</a></p>

      <div id="mine"></div>

      ${hero.noteHtml}

      <div class="hw-row">
        ${hero.parliamentHtml}
        ${hero.shiftsHtml}
      </div>
    </section>`;
  hero.start(app);
  mountOcean(app.querySelector<HTMLElement>(".hday")!);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);

  // ---------- polls chart with the projection to election day and the scenarios ----------
  // five months back on a wide screen, about three on a phone: the projection to the first round gets as much room
  const from = shiftDays(latest, window.innerWidth < 640 ? -100 : -150);
  const shown = now.slice(0, 7).map((r) => r.name);
  const num = app.querySelector<HTMLElement>("#hq-num");
  const foot = app.querySelector<HTMLElement>("#hq-foot")!;
  const trendBox = app.querySelector<HTMLElement>("#trend")!;
  const redraw = mountForecastChart(trendBox, {
    polls, markets, from: () => from, shown: () => shown, height: 340, after: foot,
    onChange: (fc) => { if (num) num.innerHTML = forecastLine(fc, fc.scenarios.length ? scenarioForecast(polls, markets, []) : undefined); },
  });
  // the method behind the average, folded with the rest of the method
  foot.querySelector(".scn-more")?.insertAdjacentHTML("beforeend", `<p>${L(`Moyenne des sondages du premier tour sur ${WINDOW} jours, pondérée par la note des instituts (<a href="#/sondages/instituts">le classement</a>), jusqu’au dernier sondage (${fmtDate(latest)}, ${nPolls} sondages dans la fenêtre). Points : sondages individuels.`, `First-round polling average over ${WINDOW} days, weighted by each institute’s grade (<a href="#/sondages/instituts">the ranking</a>), up to the latest poll (${fmtDate(latest)}, ${nPolls} polls in the window). Dots: individual polls.`)}</p>`);
  // phones get a narrower canvas: redraw when the window crosses the 640px line
  const narrow = matchMedia("(max-width: 639px)");
  const onNarrow = () => { if (!document.body.contains(trendBox)) return narrow.removeEventListener("change", onNarrow); redraw(); };
  narrow.addEventListener("change", onNarrow);

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** The reader's own town, under the hero: the four-sentence brief, their MPs, shortcuts into the town page. */
async function drawMine(box: HTMLElement, code: string, name: string) {
  box.innerHTML = `<section class="card mine"><header class="card-head"><h2>${L("Chez vous", "Where you live")}${colon()}${esc(name)}</h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header><p class="muted small">${L("Chargement…", "Loading…")}</p></section>`;
  try {
    const b = await townBrief(code, name);
    box.innerHTML = `<section class="card mine">
      <header class="card-head"><h2>${L("Chez vous", "Where you live")}${colon()}<a href="#/ville/${code}">${esc(name)}</a></h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header>
      <div class="mine-grid">
        <div class="brief-text">${b.sentences.length ? `<p>${b.sentences.join(" ")}</p>` : `<p class="muted">${L("Pas assez de données publiées pour résumer cette commune.", "Not enough published data to sum up this town.")}</p>`}</div>
        <aside>
          ${b.mps.length ? `<p class="mine-k">${L(b.mps.length > 1 ? "Vos députés" : "Votre député", b.mps.length > 1 ? "Your MPs" : "Your MP")}</p>${b.mps.slice(0, 3).map((x) => mpChip(x.mp)).join("")}` : ""}
          <nav class="jump">${[["securite", "Sécurité", "Safety"], ["chiffres", "Chiffres", "Figures"], ["ecoles", "Écoles", "Schools"], ["town-quartiers", "Quartiers", "Neighbourhoods"]].map(([id, f, e]) => `<a href="#/ville/${code}#${id}">${L(f, e)}</a>`).join("")}${b.vote ? `<a href="#/circo/${b.vote.circo}">${L("Votre circonscription", "Your district")}</a>` : ""}</nav>
        </aside>
      </div>
    </section>`;
  } catch {
    box.innerHTML = "";
  }
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
