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
import { esc, safeUrl } from "../util";
import { mpChip, townBrief } from "./brief";
import { bindSearch, byTownHall, depOf, eventItem, loadDepartmentTowns, loadTownBundle, searchBox, townExtra, upcoming } from "./explore";
import { fetchJson } from "../data";
import { armsSlot, loadCommuneArms, loadDepartmentArms, paintArms } from "../lib/arms";
import { mountForecastChart, scenarioForecast, scenarioFromUrl } from "./forecast-chart";
import { forecastLine, heroDay } from "./hero-day";
import { mountOcean } from "../lib/ocean";
import { mountEdition } from "./edition";
import { mountFox } from "../lib/fox-pet";

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
        <div class="hday-top">${hero.headHtml}${hero.artHtml}</div>
        <div class="hday-chart">
          <div class="ed-wrap"><div class="ed-perch"></div>
          <section id="edition" class="ed" aria-label="${L("L’édition du jour", "The day’s edition")}"></section></div>
          <div id="trend" class="reveal"></div>
          <div id="hq-num">${forecastLine(scenarioForecast(polls, markets, scenarioFromUrl()))}</div>
          <div id="hq-foot" class="hday-small"></div>
        </div>
        <div class="px-edge" aria-hidden="true"></div>
      </section>

      <p class="box quiz-line"><b>${L("Le quiz : qui vous ressemble ?", "The quiz: who is closest to you?")}</b> <span>${L("Dix votes de l’Assemblée, et le député et le candidat les plus proches de vous.", "Ten Assembly votes, and the MP and the candidate closest to you.")}</span> <a class="button" href="#/quiz">${L("Faire le quiz", "Take the quiz")}</a></p>

      <div id="mine"></div>

      <div class="hw-row">
        ${hero.parliamentHtml}
        ${hero.shiftsHtml}
      </div>
    </section>`;
  hero.start(app);
  mountOcean(app.querySelector<HTMLElement>(".hday")!);
  void mountEdition(app.querySelector<HTMLElement>("#edition")!, hero.pollsHtml);
  // the fox lives on the note of the day's top edge (its own perch, so changing day doesn't redraw it)
  const perch = app.querySelector<HTMLElement>(".ed-perch");
  if (perch) mountFox(perch);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);
  else drawFindTown(app.querySelector<HTMLElement>("#mine")!);

  // ---------- polls chart with the projection to election day and the scenarios ----------
  // five months back on a wide screen, about three on a phone: the projection to the first round gets as much room
  const from = shiftDays(latest, window.innerWidth < 640 ? -100 : -150);
  // every candidate in the model (polled at least FIELD_MIN_POLLS times lately), largest first; the chart leaves out
  // those under 4 %
  const field = scenarioForecast(polls, markets, []).projection.map((p) => p.name);
  const rank = (n: string) => now.find((r) => r.name === n)?.avg ?? 0;
  const shown = [...field].sort((a, b) => rank(b) - rank(a));
  const num = app.querySelector<HTMLElement>("#hq-num");
  const foot = app.querySelector<HTMLElement>("#hq-foot")!;
  const trendBox = app.querySelector<HTMLElement>("#trend")!;
  const redraw = mountForecastChart(trendBox, {
    polls, markets, from: () => from, shown: () => shown, height: 340, after: foot, views: true, minShare: 4,
    onChange: (fc) => { if (num) num.innerHTML = forecastLine(fc, fc.scenarios.length ? scenarioForecast(polls, markets, []) : undefined); },
  });
  // the method behind the average, folded with the rest of the method
  foot.querySelector(".scn-more")?.insertAdjacentHTML("beforeend", `<p>${L(`Moyenne des sondages du premier tour sur ${WINDOW} jours, pondérée par la note des instituts et corrigée de leurs penchants (<a href="#/sondages/instituts">le classement</a>), jusqu’au dernier sondage (${fmtDate(latest)}, ${nPolls} sondages dans la fenêtre). Points : sondages individuels.`, `First-round polling average over ${WINDOW} days, weighted by each institute’s grade and corrected for their leans (<a href="#/sondages/instituts">the ranking</a>), up to the latest poll (${fmtDate(latest)}, ${nPolls} polls in the window). Dots: individual polls.`)}</p>`);
  // phones get a narrower canvas: redraw when the window crosses the 640px line
  const narrow = matchMedia("(max-width: 639px)");
  const onNarrow = () => { if (!document.body.contains(trendBox)) return narrow.removeEventListener("change", onNarrow); redraw(); };
  narrow.addEventListener("change", onNarrow);

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** No town set yet: a search box for it, and the comparison of two towns. */
function drawFindTown(box: HTMLElement) {
  box.innerHTML = `<section class="card mine mine-find">
    <header class="card-head"><h2>${L("Et chez vous ?", "And where you live?")}</h2><a href="#/comparer">${L("Comparer deux communes", "Compare two towns")} →</a></header>
    <p class="muted small">${L("Vos élus, la sécurité, les écoles, ce que la commune reçoit de l’État, et comment elle se compare aux autres.", "Your officials, safety, schools, what the town gets from the state, and how it compares with others.")}</p>
    ${searchBox(L("Votre commune ou votre code postal", "Your town or postcode"))}
  </section>`;
  bindSearch(box);
}

/** The reader's own town, under the hero: the four-sentence brief, their MPs, shortcuts into the town page. */
async function drawMine(box: HTMLElement, code: string, name: string) {
  box.innerHTML = `<section class="card mine"><header class="card-head"><h2>${L("Chez vous", "Where you live")}${colon()}${esc(name)}</h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header><p class="muted small">${L("Chargement…", "Loading…")}</p></section>`;
  try {
    const dep = depOf(code);
    const [b, bundle, ca, da] = await Promise.all([townBrief(code, name), loadTownBundle(dep), loadCommuneArms(dep), loadDepartmentArms()]);
    const photo = townExtra(bundle[code])?.photo;
    // coming up: the town's own events (town hall first), else the district's nearest ones
    const { towns } = await loadDepartmentTowns(dep).catch(() => ({ towns: new Map() }));
    const t = towns.get(code);
    let evs: { start: string; end?: string; commune?: string; publisher?: string }[] = upcoming(t?.events ?? []);
    let nearby = false;
    if (!evs.length && t?.districts?.[0]) {
      const ev = await fetchJson<{ events: { start: string; end?: string; commune?: string; publisher?: string }[] }>(`/data/districts/events/${t.districts[0].code}.json`).catch(() => null);
      evs = upcoming(ev?.events ?? []);
      nearby = true;
    }
    evs = [...evs].sort((a, b) => Number(byTownHall(b)) - Number(byTownHall(a)) || a.start.localeCompare(b.start)).slice(0, 5);
    const eventsHtml = evs.length ? `<section class="mine-events"><h3>${nearby ? L("À venir près de chez vous", "Coming up nearby") : L(`À venir à ${esc(name)}`, `Coming up in ${esc(name)}`)}</h3><ul class="events">${evs.map((e) => eventItem(e, nearby)).join("")}</ul></section>` : "";
    // the town's own picture and coat of arms; the department's arms lead to the department, its towns and MPs
    const compare = `<a class="button cmp-cta" href="#/comparer/${code}">${L(`Comparer ${esc(name)} avec une autre commune`, `Compare ${esc(name)} with another town`)} →</a>`;
    const ident = `<div class="mine-id">${photo ? `<a class="mine-photo" href="#/ville/${code}"><img src="${esc(safeUrl(photo.url))}" alt="${esc(name)}" loading="lazy"/></a>` : ""}<div class="mine-arms">${armsSlot(ca[code], L(`Armoiries : ${name}`, `Coat of arms: ${name}`), "xl")}${armsSlot(da[dep], L("Le département, ses communes et ses députés", "The department, its towns and MPs"), "xl", `#/explorer/${dep}`)}</div></div>`;
    box.innerHTML = `<section class="card mine">
      <header class="card-head"><h2>${L("Chez vous", "Where you live")}${colon()}<a href="#/ville/${code}">${esc(name)}</a></h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header>
      ${ident}${compare}${eventsHtml}
      <div class="mine-grid">
        <div class="brief-text">${b.sentences.length ? `<p>${b.sentences.join(" ")}</p>` : `<p class="muted">${L("Pas assez de données publiées pour résumer cette commune.", "Not enough published data to sum up this town.")}</p>`}</div>
        <aside>
          ${b.mps.length ? `<p class="mine-k">${L(b.mps.length > 1 ? "Vos députés" : "Votre député", b.mps.length > 1 ? "Your MPs" : "Your MP")}</p>${b.mps.slice(0, 3).map((x) => mpChip(x.mp)).join("")}` : ""}
          <nav class="jump">${[["securite", "Sécurité", "Safety"], ["chiffres", "Chiffres", "Figures"], ["ecoles", "Écoles", "Schools"], ["town-quartiers", "Quartiers", "Neighbourhoods"]].map(([id, f, e]) => `<a href="#/ville/${code}#${id}">${L(f, e)}</a>`).join("")}${b.vote ? `<a href="#/circo/${b.vote.circo}">${L("Votre circonscription", "Your district")}</a>` : ""}</nav>
        </aside>
      </div>
    </section>`;
    paintArms(box);
  } catch {
    box.innerHTML = "";
  }
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
