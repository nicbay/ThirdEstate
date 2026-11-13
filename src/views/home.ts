// Front page. The hero is "the note of the day" (views/hero-day.ts): what moved in the polls, who entered or
// left the race, the day's stories and posts, beside one map of France (the 577 seats, or how each district
// shifted). Below: the reader's own town (when known), the polls chart with its projection and scenarios, and
// one line each on Parliament and the archives.
import { loadMarkets, loadPolls } from "../data";
import { pixelIcon } from "../lib/pixel-icons";
import { L, fmtDate } from "../i18n";
import { registerParties } from "../lib/candidates";
import { getHome } from "../lib/cloud";
import { average, latestPollDate, pollsInWindow, WINDOW } from "../lib/polls";
import { colon } from "../lib/format";
import { esc } from "../util";
import { mpChip, townBrief } from "./brief";
import { mountForecastChart, scenarioForecast } from "./forecast-chart";
import { forecastLine, heroDay } from "./hero-day";

export async function renderHome(app: HTMLElement) {
  const [polls, markets, hero] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null), heroDay()]);
  registerParties(polls.parties);
  const latest = latestPollDate(polls.firstRound);
  const now = average(polls.firstRound, latest);
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const home = getHome();

  app.innerHTML = `
    <section class="page home">
      ${hero.html}

      <div id="mine"></div>

      <section class="card">
        <header class="card-head"><h2>${L("Les sondages, et jusqu’au premier tour", "The polls, and on to the first round")}</h2><a href="#/sondages">${L("Tous les sondages", "Every poll")}</a></header>
        <div id="trend" class="reveal"></div>
        <p class="muted small">${L(`Ligne pleine : moyenne des sondages du premier tour sur ${WINDOW} jours, pondérée par la note des instituts (<a href="#/sondages/instituts">le classement</a>), jusqu’au dernier sondage (${fmtDate(latest)}, ${nPolls} sondages dans la fenêtre) ; la même moyenne partout sur le site. Points : sondages individuels.`, `Solid line: first-round polling average over ${WINDOW} days, weighted by each institute’s grade (<a href="#/sondages/instituts">the ranking</a>), up to the latest poll (${fmtDate(latest)}, ${nPolls} polls in the window); the same average everywhere on the site. Dots: individual polls.`)}</p>
      </section>

      <ul class="home-more" aria-label="${L("Aussi sur Third Estate", "Also on Third Estate")}">
        <li><a href="#/assemblee">${pixelIcon("parliament", 12)}<b>${L("Parlement", "Parliament")}</b><span>${L("577 députés et 348 sénateurs : chacun de leurs votes.", "577 MPs and 348 senators: every vote they cast.")}</span></a></li>
        <li><a href="#/resultats">${pixelIcon("archive", 12)}<b>${L("Archives", "Archives")}</b><span>${L("Chaque présidentielle depuis 1848, avec l’annonce filmée.", "Every presidential election since 1848, with the footage of the result.")}</span></a></li>
      </ul>
    </section>`;
  hero.start(app.querySelector<HTMLElement>(".hday")!);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);

  // ---------- polls chart with the projection to election day and the scenarios ----------
  // five months back on a wide screen, about three on a phone: the projection to the first round gets as much room
  const from = shiftDays(latest, window.innerWidth < 640 ? -100 : -150);
  const shown = now.slice(0, 7).map((r) => r.name);
  const num = app.querySelector<HTMLElement>("#hq-num");
  mountForecastChart(app.querySelector<HTMLElement>("#trend")!, {
    polls, markets, from: () => from, shown: () => shown, height: 340,
    onChange: (fc) => { if (num) num.innerHTML = forecastLine(fc, fc.scenarios.length ? scenarioForecast(polls, markets, []) : undefined); },
  });

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
