// Front page, built as a landing page with one job: send the reader to the 2027 forecast.
// One offer (who can win in 2027, read without the noise of a single poll) → one primary action ("See the 2027
// forecast", top and bottom). Order: hero with the live odds · the reader's town (when known) · problem → solution
// with the polls chart · what else the site answers (bento) · the Article 15 tagline, revealed word by word ·
// how the forecast works in three steps · sources and promises · FAQ · the same call to action.
import "../styles/landing.css";
import { loadDepartements, loadDeputes, loadMarkets, loadPolls, loadShifts } from "../data";
import { pixelIcon, type PixelIcon } from "../lib/pixel-icons";
import { L, fmtDate } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { getHome } from "../lib/cloud";
import { latestPollDate, pollsInWindow, WINDOW } from "../lib/polls";
import { colon, pct } from "../lib/format";
import { esc } from "../util";
import { taglineReveal } from "../lib/tagline";
import { mpChip, townBrief } from "./brief";
import { mountForecastChart, scenarioForecast } from "./forecast-chart";
import { forecastLine } from "./hero-day";
import { heroViz } from "./hero";

const arrow = `<svg class="cta-arrow" viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><rect x="0" y="3" width="5" height="1"/><rect x="3" y="1" width="1" height="1"/><rect x="4" y="2" width="1" height="1"/><rect x="5" y="3" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="3" y="5" width="1" height="1"/></svg>`;
const cta = () => `<span class="cta-wrap"><a class="cta" href="#/2027">${L("Voir la prévision 2027", "See the 2027 forecast")}${arrow}</a></span>`;

export async function renderHome(app: HTMLElement) {
  const [polls, markets, geo, deputes, shifts] = await Promise.all([
    loadPolls("2027"), loadMarkets().catch(() => null), loadDepartements(), loadDeputes(), loadShifts().catch(() => null),
  ]);
  registerParties(polls.parties);
  document.title = L("Third Estate · Qui peut gagner en 2027", "Third Estate · Who can win in 2027");
  const latest = latestPollDate(polls.firstRound);
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const fc = scenarioForecast(polls, markets, []);
  const home = getHome();

  // ---- the live odds, drawn in pixels: 25 blocks a row, one block = 4 % chance of being elected
  const top = fc.rows.slice(0, 5);
  const oddsRows = top.map((r) => {
    const m = meta(r.name);
    const on = Math.max(r.win >= 1 ? 1 : 0, Math.round(r.win / 4));
    return `<li><span class="lp-o-name"><i style="background:${m.color}"></i>${esc(m.surname)}</span><span class="lp-o-cells" aria-hidden="true">${Array.from({ length: 25 }, (_, i) => `<b${i < on ? ` style="background:${m.color}"` : ""}></b>`).join("")}</span><span class="lp-o-v">${r.win < 1 ? L("<1 %", "<1%") : pct(r.win, 0)}</span></li>`;
  }).join("");
  const pair = fc.pairs[0];
  const sur = (n: string) => meta(n).surname;
  const pairLine = pair ? `<p class="lp-o-pair">${L("Second tour le plus probable", "Most likely runoff")}${colon()}<b>${esc(sur(pair.a))} – ${esc(sur(pair.b))}</b>, ${L(`${Math.round(pair.p)} % des simulations`, `${Math.round(pair.p)}% of simulations`)}</p>` : "";

  // ---- the Parliament tile reuses the 577 dots (districts, then seats)
  const shiftPair = shifts?.pairs.filter((p) => p.level === "district").at(-1);
  const viz = heroViz(geo, deputes, shiftPair);

  const benefits: { icon: PixelIcon; href: string; fr: [string, string]; en: [string, string]; fig?: [string, string] }[] = [
    { icon: "chart", href: "#/sondages", fr: ["Lire les sondages sans vous faire balader", "La moyenne pondérée, ce que parient les marchés, et chaque institut noté de A+ à F."], en: ["Read the polls without being led around", "The weighted average, what the markets are betting, and every institute graded A+ to F."] },
    { icon: "doc", href: "#/programmes", fr: ["Comparer les programmes sur les mêmes critères", "Thème par thème : ce que ça coûte, ce que dit le droit, ce qui est faisable."], en: ["Compare the programmes on the same criteria", "Theme by theme: what it costs, what the law says, what is feasible."] },
    { icon: "home", href: "#/explorer", fr: ["Connaître votre commune", "Maire, conseil, écoles, sécurité, quartiers."], en: ["Know your town", "Mayor, council, schools, safety, neighbourhoods."], fig: ["34 920 communes", "34,920 towns"] },
    { icon: "archive", href: "#/resultats", fr: ["Remonter jusqu’à 1848", "Chaque élection, ses cartes, et où la France a glissé."], en: ["Go back to 1848", "Every election, its maps, and where France shifted."] },
  ];

  const steps: [string, string, string, string][] = [
    ["Nous rassemblons chaque sondage", "Chaque institut est noté de A+ à F selon l’écart entre ses derniers sondages et les résultats, depuis 2002. Sa note fixe son poids dans la moyenne.",
      "We gather every poll", "Each institute is graded A+ to F on how far its final polls landed from the results since 2002. Its grade sets its weight in the average."],
    ["Nous rejouons l’élection 20 000 fois", "À chaque tirage, chaque candidat reçoit une erreur de sondage aléatoire ; les deux premiers vont au second tour. Le résultat est croisé avec les cotes de Kalshi et Polymarket.",
      "We replay the election 20,000 times", "In each draw every candidate gets a random polling error; the top two go to the runoff. The result is blended with Kalshi and Polymarket odds."],
    ["Vous lisez les chances, et testez vos scénarios", "Un retrait, un ralliement, une primaire : le simulateur recalcule tout, et dit d’où vient chaque chiffre.",
      "You read the odds, and test your own scenarios", "A withdrawal, a rally, a primary: the simulator recomputes everything, and says where each figure comes from."],
  ];

  const faq: [string, string, string, string][] = [
    ["D’où viennent les chances affichées ?", "De deux lectures indépendantes : les sondages récents rejoués dans 20 000 élections simulées, et les cotes « vainqueur » de Kalshi et Polymarket, ramenées à 100 % pour retirer la marge des plateformes puis pondérées par les montants échangés.",
      "Where do the odds come from?", "From two independent reads: recent polls replayed in 20,000 simulated elections, and the “winner” odds on Kalshi and Polymarket, scaled to 100% to remove the platforms’ margin and weighted by the amounts traded."],
    ["Third Estate fait-il ses propres sondages ?", "Non. La prévision utilise les sondages publiés par les instituts, chacun lié à sa source.",
      "Does Third Estate run its own polls?", "No. The forecast uses the polls the institutes publish, each linked to its source."],
    ["Pourquoi noter les instituts ?", "Parce qu’ils ne se valent pas. Chaque institut reçoit une note de A+ à F, gagnée par l’écart entre ses derniers sondages et les résultats depuis 2002, et cette note fixe son poids dans la moyenne.",
      "Why grade the institutes?", "Because they are not equal. Each institute gets a grade from A+ to F, earned from how far its final polls landed from the results since 2002, and that grade sets its weight in the average."],
    ["Quand la prévision change-t-elle ?", "À chaque nouveau sondage publié et à chaque mise à jour des cotes des marchés. La date du dernier sondage est affichée sous les chances.",
      "When does the forecast change?", "With every newly published poll and every update of the market odds. The date of the latest poll is shown under the odds."],
    ["Le site soutient-il un candidat ?", "Non. Chaque candidat est décrit avec les mêmes critères, dans le même ordre, à partir des mêmes sources.",
      "Does the site back a candidate?", "No. Every candidate is described on the same criteria, in the same order, from the same sources."],
    ["Le quiz me dit-il pour qui voter ?", "Non. Il mesure votre proximité avec les votes des députés et les mesures des candidats. Ce n’est jamais une consigne de vote.",
      "Does the quiz tell me who to vote for?", "No. It measures how close you are to MPs’ votes and candidates’ measures. It is never voting advice."],
    ["Mes visites sont-elles suivies ?", "Non : aucun cookie, aucune publicité, aucun suivi. C’est pour cela qu’il n’y a pas de bandeau.",
      "Are my visits tracked?", "No: no cookies, no ads, no tracking. That is why there is no banner."],
    ["Où vérifier la méthode et les sources ?", "La page Sources et méthode liste chaque jeu de données, sa source, sa fréquence de mise à jour et sa licence. Le code du site est ouvert.",
      "Where can I check the method and sources?", "The Sources and method page lists every dataset, its source, how often it is refreshed and its licence. The site’s code is open."],
  ];

  const sources: [string, string][] = [
    ["Assemblée nationale (open data)", "Assemblée nationale (open data)"],
    ["Sénat (data.senat.fr)", "Senate (data.senat.fr)"],
    ["Ministère de l’Intérieur (data.gouv.fr)", "Ministry of the Interior (data.gouv.fr)"],
    ["INSEE", "INSEE"],
    ["Instituts de sondage", "Polling institutes"],
    ["Kalshi, Polymarket", "Kalshi, Polymarket"],
  ];

  app.innerHTML = `
    <section class="page home lp">
      <section class="hero-x lp-hero" aria-labelledby="lp-title">
        <div class="lp-hero-grid">
          <div class="lp-hero-copy">
            <p class="hero-kicker">${L("Présidentielle 2027", "2027 presidential election")} · ${L(`premier tour dans ${fc.daysToGo} jours`, `first round in ${fc.daysToGo} days`)}</p>
            <h1 id="lp-title"><span class="ln"><span>${L("Qui peut gagner en 2027", "Who can win in 2027")}</span></span><span class="ln"><span>${L("sans le bruit d’un seul sondage", "without the noise of one poll")}</span></span></h1>
            <p class="lp-sub">${L("Tous les sondages, pondérés par la fiabilité de leur institut, rejoués dans 20 000 simulations des deux tours puis croisés avec les marchés prédictifs. Recalculé à chaque nouveau sondage, méthode ouverte.", "Every poll, weighted by its institute’s track record, replayed in 20,000 simulations of both rounds and checked against prediction markets. Recomputed with every new poll, open method.")}</p>
            <div class="lp-actions">${cta()}</div>
            <ul class="lp-proof" aria-label="${L("En chiffres", "In numbers")}">
              <li><b>${nPolls}</b> ${L(`sondages sur ${WINDOW} jours`, `polls over ${WINDOW} days`)}</li>
              <li><b>${L("20 000", "20,000")}</b> simulations</li>
              <li>${L("dernier sondage le", "latest poll")} <b>${fmtDate(latest)}</b></li>
            </ul>
          </div>
          <figure class="lp-odds">
            <figcaption>${L("Chances d’être élu", "Chance of being elected")}</figcaption>
            <ol>${oddsRows}</ol>
            ${pairLine}
            <p class="lp-o-key"><b aria-hidden="true"></b>${L("un bloc = 4 % de chances", "one block = 4% chance")}</p>
          </figure>
        </div>
        <div class="px-edge" aria-hidden="true"></div>
      </section>

      <div id="mine"></div>

      <section class="card lp-why" id="pourquoi">
        <div class="lp-why-text">
          <p class="lp-k">${L("Le problème", "The problem")}</p>
          <h2>${L("Un sondage seul est une photo floue", "One poll on its own is a blurry photo")}</h2>
          <p>${L("Chaque semaine, un sondage fait la une, puis le suivant le contredit. L’écart tient souvent à la marge d’erreur, pas à un vrai mouvement de l’opinion.", "Every week one poll makes the headlines, then the next one contradicts it. The gap is often the margin of error, not a real shift in opinion.")}</p>
          <p class="lp-k">${L("Ce que nous faisons", "What we do")}</p>
          <p>${L("Nous faisons la moyenne de tous les sondages récents, chacun pesé selon la note de son institut. La ligne pleine ci-contre est cette moyenne ; les points, chaque sondage.", "We average every recent poll, each weighed by its institute’s grade. The solid line is that average; the dots are the single polls.")}</p>
          <a class="lp-more" href="#/sondages">${L("Tous les sondages et les marchés", "Every poll and market")} →</a>
        </div>
        <div class="lp-why-chart">
          <div id="trend" class="reveal"></div>
          <div id="hq-num">${forecastLine(fc)}</div>
        </div>
      </section>

      <section class="card lp-benefits" aria-labelledby="lp-b-title">
        <header class="card-head"><h2 id="lp-b-title">${L("Ce que vous trouverez aussi ici", "What else you will find here")}</h2></header>
        <div class="lp-bento">
          <div class="lp-tile lp-tile-big">
            <a class="lp-tile-link" href="#/assemblee">
              <span class="lp-tile-k">${pixelIcon("parliament", 12)}${L("Parlement", "Parliament")}</span>
              <b>${L("Savoir ce que vote votre député", "Know how your MP votes")}</b>
              <span>${L("577 députés et 348 sénateurs : chacun de leurs votes, leur loyauté envers le groupe, ce qu’ils disent en séance.", "577 MPs and 348 senators: every vote they cast, their loyalty to their group, what they say in the chamber.")}</span>
            </a>
            <div class="lp-viz">${viz.svg}${viz.legend}<p class="sr-only" id="hd-caption"></p></div>
          </div>
          ${benefits.map((b) => `<a class="lp-tile" href="${b.href}"><span class="lp-tile-k">${pixelIcon(b.icon, 12)}${b.fig ? esc(L(...b.fig)) : ""}</span><b>${esc(L(b.fr[0], b.en[0]))}</b><span>${esc(L(b.fr[1], b.en[1]))}</span><span class="lp-tile-go" aria-hidden="true">→</span></a>`).join("")}
        </div>
      </section>

      <section class="lp-tagline" aria-label="${L("Article 15 de la Déclaration de 1789", "Article 15 of the 1789 Declaration")}">
        <p class="lp-tag-text" data-reveal>${L("La société a le droit de demander compte à tout agent public de son administration", "Society has the right to ask every public agent to account for their administration")}</p>
        <p class="lp-tag-src">${L("Article 15, Déclaration des droits de l’homme et du citoyen, 1789", "Article 15, Declaration of the Rights of Man and of the Citizen, 1789")}</p>
      </section>

      <section class="card lp-how" aria-labelledby="lp-h-title">
        <header class="card-head"><h2 id="lp-h-title">${L("Comment marche la prévision", "How the forecast works")}</h2><a href="#/2027#methode">${L("La méthode complète", "The full method")}</a></header>
        <ol class="lp-steps">${steps.map(([tf, df, te, de], i) => `<li><span class="lp-step-n" aria-hidden="true">0${i + 1}</span><b>${L(tf, te)}</b><p>${L(df, de)}</p></li>`).join("")}</ol>
      </section>

      <section class="card lp-trust" aria-labelledby="lp-t-title">
        <div>
          <p class="lp-k">${L("Sources publiques", "Public sources")}</p>
          <h2 id="lp-t-title">${L("Chaque chiffre renvoie à sa source", "Every figure points to its source")}</h2>
          <ul class="lp-sources">${sources.map(([f, e]) => `<li>${esc(L(f, e))}</li>`).join("")}</ul>
          <a class="lp-more" href="#/sources">${L("Sources et méthode", "Sources and method")} →</a>
        </div>
        <ul class="lp-promises">
          <li>${pixelIcon("shield", 24)}<b>${L("Gratuit, sans compte", "Free, no account")}</b><span>${L("Tout le site se lit sans inscription.", "The whole site reads without signing up.")}</span></li>
          <li>${pixelIcon("scales", 24)}<b>${L("Mêmes critères pour tous", "Same criteria for everyone")}</b><span>${L("Aucun candidat, aucun parti n’est mis en avant.", "No candidate, no party is pushed forward.")}</span></li>
          <li>${pixelIcon("cross", 24)}<b>${L("Aucun cookie, aucun suivi", "No cookies, no tracking")}</b><span>${L("Ni publicité, ni mesure d’audience nominative.", "No ads, no personal audience tracking.")}</span></li>
        </ul>
      </section>

      <section class="card lp-faq" aria-labelledby="lp-f-title">
        <header class="card-head"><h2 id="lp-f-title">${L("Questions fréquentes", "Frequently asked questions")}</h2></header>
        <div class="lp-faq-list">${faq.map(([qf, af, qe, ae]) => `<details><summary>${L(qf, qe)}<span class="lp-faq-x" aria-hidden="true"></span></summary><p>${L(af, ae)}</p></details>`).join("")}</div>
      </section>

      <section class="lp-final" aria-labelledby="lp-final-title">
        <div class="px-edge px-edge-up" aria-hidden="true"></div>
        <div class="lp-final-in">
          <h2 id="lp-final-title">${L("Voyez où en est la course", "See where the race stands")}</h2>
          <p>${L(`${fc.daysToGo} jours avant le premier tour. Les chances de chaque candidat, et pourquoi.`, `${fc.daysToGo} days to the first round. Every candidate’s chances, and why.`)}</p>
          ${cta()}
        </div>
      </section>
    </section>`;

  viz.start(app.querySelector<HTMLElement>(".lp-tile-big")!);
  taglineReveal(app.querySelector<HTMLElement>("[data-reveal]")!);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);

  // ---- polls chart with the projection to election day and the scenarios
  const from = shiftDays(latest, window.innerWidth < 640 ? -100 : -150);
  const shown = fc.rows.slice(0, 7).map((r) => r.name);
  const num = app.querySelector<HTMLElement>("#hq-num");
  mountForecastChart(app.querySelector<HTMLElement>("#trend")!, {
    polls, markets, from: () => from, shown: () => shown, height: 340,
    onChange: (f) => { if (num) num.innerHTML = forecastLine(f, f.scenarios.length ? scenarioForecast(polls, markets, []) : undefined); },
  });
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
