// Front page: one question and three doors. "Who will win 2027?" answered with one number (our forecast)
// and the day in one sentence; then three ways in: your town, the candidates side by side, the quiz.
// Below, a few calm blocks: the reader's own town (when known), the polling average over a year, and
// one line each on Parliament and the archives.
import { fetchJson, loadMarkets, loadPolls } from "../data";
import { pixelIcon } from "../lib/pixel-icons";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { getHome } from "../lib/cloud";
import { average, latestPollDate, pollsInWindow, WINDOW } from "../lib/polls";
import { ELECTION_DAY, type Forecast } from "../lib/forecast";
import { colon, pct } from "../lib/format";
import { esc } from "../util";
import { bindSearch, searchBox } from "./explore";
import { mpChip, townBrief } from "./brief";
import { todaySentence } from "./daily";
import { mountForecastChart, scenarioForecast, scenarioFromUrl, scenarioHeadline } from "./forecast-chart";

export async function renderHome(app: HTMLElement) {
  const [polls, markets, cands] = await Promise.all([
    loadPolls("2027"),
    loadMarkets().catch(() => null),
    fetchJson<{ candidates: unknown[] }>("/data/candidates/index.json").catch(() => null),
  ]);
  registerParties(polls.parties);
  const fr = getLang() === "fr";
  const latest = latestPollDate(polls.firstRound);
  const now = average(polls.firstRound, latest);
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const today = new Date().toISOString().slice(0, 10);
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(today)) / 86400000));
  const fc0 = scenarioForecast(polls, markets, scenarioFromUrl());
  const fcBase = () => scenarioForecast(polls, markets, "base");
  const sentence = todaySentence(polls.firstRound);
  const nCands = cands?.candidates.length ?? 0;
  const home = getHome();

  app.innerHTML = `
    <section class="page home">
      <section class="hero-x home-q" aria-labelledby="hero-title">
        <p class="hero-kicker">${L(`Présidentielle 2027 · premier tour dans ${daysToGo} jours`, `2027 presidential election · first round in ${daysToGo} days`)}</p>
        <h1 id="hero-title"><span class="ln"><span>${L("Qui va gagner", "Who will win")}</span></span><span class="ln"><span><em>${L("en 2027 ?", "in 2027?")}</em></span></span></h1>
        <div class="hq-answer">
          <div id="hq-num">${headline(fc0, fr, fcBase())}</div>
          ${sentence ? `<p class="hq-brief"><span class="hq-k">${L("Le point du jour", "Today’s brief")}</span> ${esc(sentence)} <a href="#/sondages#point">${L("Le point complet", "The full brief")} →</a></p>` : ""}
        </div>
        <div class="hero-x-doors hq-doors">
          <div class="hq-door hq-town">
            <h2 class="hx-k">${pixelIcon("home", 12)}${L("Votre commune", "Your town")}</h2>
            <p>${home?.code ? `${L("Chez vous", "Where you live")}${colon()}<a href="#/ville/${home.code}">${esc(home.commune ?? home.code)}</a>. ${L("Ou cherchez ailleurs :", "Or look somewhere else:")}` : L("Maire, conseil, écoles, sécurité, vos députés : tapez votre ville ou votre code postal.", "Mayor, council, schools, safety, your MPs: type your town or postcode.")}</p>
            ${searchBox(L("Votre ville ou votre code postal", "Your town or postcode"))}
          </div>
          <a class="hq-door" href="#/programmes">
            <h2 class="hx-k">${pixelIcon("doc", 12)}${L("Comparer les candidats", "Compare the candidates")}</h2>
            <p>${nCands ? L(`Les ${nCands} candidats déclarés, leurs programmes côte à côte, thème par thème.`, `All ${nCands} declared candidates, their programmes side by side, theme by theme.`) : L("Tous les candidats, leurs programmes côte à côte, thème par thème.", "Every candidate, their programmes side by side, theme by theme.")}</p>
          </a>
          <a class="hq-door" href="#/quiz">
            <h2 class="hx-k">${pixelIcon("ballot", 12)}${L("Faire le quiz", "Take the quiz")}</h2>
            <p>${L("Répondez à de vrais votes de l’Assemblée : découvrez le député, le groupe et le candidat 2027 les plus proches de vous.", "Answer real Assembly votes: find the MP, group and 2027 candidate closest to you.")}</p>
          </a>
        </div>
        <div class="px-edge" aria-hidden="true"></div>
      </section>

      <div id="mine"></div>

      <section class="card">
        <header class="card-head"><h2>${L("Les sondages, et jusqu’au premier tour", "The polls, and on to the first round")}</h2><a href="#/sondages">${L("Tous les sondages", "Every poll")}</a></header>
        <div id="trend" class="reveal"></div>
        <p class="muted small">${L(`Ligne pleine : moyenne des sondages du premier tour sur ${WINDOW} jours, jusqu’au dernier sondage (${fmtDate(latest)}, ${nPolls} sondages dans la fenêtre) ; la même moyenne partout sur le site. Points : sondages individuels.`, `Solid line: first-round polling average over ${WINDOW} days, up to the latest poll (${fmtDate(latest)}, ${nPolls} polls in the window); the same average everywhere on the site. Dots: individual polls.`)}</p>
      </section>

      <ul class="home-more" aria-label="${L("Aussi sur Third Estate", "Also on Third Estate")}">
        <li><a href="#/assemblee">${pixelIcon("parliament", 12)}<b>${L("Parlement", "Parliament")}</b><span>${L("577 députés et 348 sénateurs : chacun de leurs votes.", "577 MPs and 348 senators: every vote they cast.")}</span></a></li>
        <li><a href="#/resultats">${pixelIcon("archive", 12)}<b>${L("Archives", "Archives")}</b><span>${L("Chaque présidentielle depuis 1848, avec l’annonce filmée.", "Every presidential election since 1848, with the footage of the result.")}</span></a></li>
      </ul>
    </section>`;
  bindSearch(app);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);

  // ---------- polls chart with the projection to election day and the scenarios ----------
  const from = shiftDays(latest, -365);
  const shown = now.slice(0, 7).map((r) => r.name);
  const num = app.querySelector<HTMLElement>("#hq-num")!;
  mountForecastChart(app.querySelector<HTMLElement>("#trend")!, {
    polls, markets, from: () => from, shown: () => shown, height: 340,
    onChange: (fc) => { num.innerHTML = headline(fc, fr, fcBase()); },
  });

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** The reader's own town, under the doors: the four-sentence brief, their MPs, shortcuts into the town page. */
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

/** The one number: the favourite's chance, today or under the chosen scenario. */
function headline(fc: Forecast, fr: boolean, ref?: Forecast) {
  const fav = fc.rows[0];
  if (!fav) return `<p class="hq-num"><span><a href="#/2027">${L("La course, les sondages et le simulateur", "The race, the polls and the simulator")}</a></span></p>`;
  const base = fc.scenario === "base";
  return `<p class="hq-num${base ? "" : " is-scenario"}"><strong>${pct(fav.win, 0)}</strong><span>${fr
    ? `de chances pour <b>${esc(fav.name)}</b>, ${base ? "selon notre prévision" : "dans ce scénario"}`
    : `chance for <b>${esc(fav.name)}</b>, ${base ? "in our forecast" : "in this scenario"}`} · <a href="${base ? "#/2027" : "#/"}"${base ? "" : ' data-scn-reset="1"'}>${base ? L("Comment on calcule", "How it’s worked out") : L("Revenir aux sondages du jour", "Back to today’s polls")}</a></span></p>${base ? "" : `<p class="hq-scn">${scenarioHeadline(fc, ref)}</p>`}`;
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
