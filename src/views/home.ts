// Front page. The hero and a live ticker, then the story of the moment (the 2027 programmes, with posts),
// the polling trend and the shift arrows, each drawn in as it scrolls into view.
import { geoConicConformal, geoPath } from "d3-geo";
import { fetchJson, loadDepartements, loadDeputes, loadFeed, loadMarkets, loadPolls, loadShifts } from "../data";
import { pixelIcon } from "../lib/pixel-icons";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { lineChart } from "../lib/chart";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { cloudEnabled, getHome, onPresence } from "../lib/cloud";
import { rewind } from "../lib/map";
import { average, pollsInWindow, trend, WINDOW } from "../lib/polls";
import { ELECTION_DAY, forecast } from "../lib/forecast";
import { colon, pct } from "../lib/format";
import { esc, safeColor } from "../util";
import { arrowPaths, legend, unitsPerPx } from "./shifts";
import { bindSearch, searchBox } from "./explore";
import { heroViz } from "./hero";
import { mpChip, townBrief } from "./brief";
import { mountDebtTeaser } from "./economy";
import { mountDaily } from "./daily";
import { mountProgrammesFeature, startTicker, tickerHtml, type TickerItem } from "./home-programmes";

export async function renderHome(app: HTMLElement) {
  const [polls, markets, geo, deputes, shifts, progs] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null), loadDepartements(), loadDeputes(), loadShifts().catch(() => null),
    fetchJson<{ programmes: { total: number; inLatest?: number }[] }>("/data/programmes/index.json").catch(() => null)]);
  const nProgs = progs?.programmes.length ?? 0;
  const nMeasures = progs?.programmes.reduce((n, p) => n + (p.inLatest ?? p.total), 0) ?? 0;
  registerParties(polls.parties);
  const fr = getLang() === "fr";
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  // the strip and the headline use the site-wide polling average (lib/polls average), not one line-up
  const now = average(polls.firstRound, latest);
  const strip = now.filter((r) => r.avg >= 0.5).sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
  const sum = strip.reduce((s, r) => s + r.avg, 0) || 1;
  const [leader, second] = now;
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const today = new Date().toISOString().slice(0, 10);
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(today)) / 86400000));

  const headline = leader && second
    ? fr
      ? `${leader.name} en tête, ${meta(second.name).surname} deuxième, à ${daysToGo} jours du premier tour`
      : `${leader.name} leads, ${meta(second.name).surname} second, ${daysToGo} days before the first round`
    : L("Où en est la course", "Where the race stands");

  const feed = await loadFeed().catch(() => null);
  const stories = (feed?.stories ?? []).filter((s) => (s.reactions ?? []).some((r) => r.rating)).slice(0, 3);
  const fav = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], today).rows[0];
  const home = getHome();
  const viz = heroViz(geo, deputes, shifts?.pairs.filter((p) => p.level === "district").at(-1));

  const ticker: TickerItem[] = [
    ...(leader ? [{ k: L("Sondages", "Polls"), html: esc(fr ? `${leader.name} en tête (${pct(leader.avg)})${second ? `, ${meta(second.name).surname} ${pct(second.avg)}` : ""}` : `${leader.name} leads (${pct(leader.avg)})${second ? `, ${meta(second.name).surname} ${pct(second.avg)}` : ""}`) }] : []),
    { k: L("Programmes", "Programmes"), html: `<a href="#/programmes">${nProgs ? L(`${nProgs} programmes comparés, thème par thème`, `${nProgs} programmes compared, theme by theme`) : L("Les programmes comparés, thème par thème", "The programmes compared, theme by theme")}</a>` },
    ...(fav ? [{ k: L("Prévision", "Forecast"), html: esc(fr ? `${fav.name} : ${pct(fav.win, 0)} de chances` : `${fav.name}: ${pct(fav.win, 0)} chance`) }] : []),
    ...(feed?.stories ?? []).slice(0, 4).map((st) => ({ k: L("Actualité", "News"), html: `<a href="#/fil">${esc(st.items[0].title)}</a>` })),
    { k: L("Quiz", "Quiz"), html: `<a href="#/quiz">${L("Quel député vous ressemble ?", "Which MP is most like you?")}</a>` },
  ];
  app.innerHTML = `
    <section class="page home">
      <section class="hero-x" aria-labelledby="hero-title">
        <div class="hero-x-in">
          <div class="hero-x-copy">
            <p class="hero-kicker">${L("Présidentielle 2027 · Programmes · Parlement · 34 920 communes", "2027 presidential · Programmes · Parliament · 34,920 towns")} <span class="live-badge" id="live-badge" hidden><i></i><span id="live-count"></span></span></p>
            <h1 id="hero-title"><span class="ln"><span>${L("La politique française,", "French politics,")}</span></span><span class="ln"><span><em>${L("en données.", "in data.")}</em></span></span></h1>
            <a class="hero-story" href="#home-programmes" id="hero-story"><i aria-hidden="true"></i><span>${L("Le dossier du moment", "The story right now")}</span>${L("Les programmes 2027 passés au crible : ce qui change, ce que ça coûte", "The 2027 programmes examined: what changes, what it costs")} →</a>
            <p class="hero-dek">${L("Qui va gagner en 2027. Comment votent vos députés et sénateurs. Ce qui se passe dans votre commune. Et toutes les élections depuis 1848, archives à l’appui.", "Who will win in 2027. How your MPs and senators vote. What is happening in your town. And every election since 1848, with the archive footage.")}</p>
            <p class="hero-search-label">${home?.code ? `${L("Votre commune", "Your town")}${colon()}<a href="#/ville/${home.code}">${esc(home.commune ?? home.code)}</a>. ${L("Ou cherchez ailleurs", "Or look somewhere else")}` : L("Commencez par chez vous", "Start with where you live")}</p>
            ${searchBox(L("Votre ville ou votre code postal", "Your town or postcode"))}
          </div>
          <figure class="hero-x-viz">
            ${viz.svg}
            <figcaption>
              <div class="hd-toggle" role="group" aria-label="${L("Vue", "View")}"><button type="button" data-hd="map">${L("577 circonscriptions", "577 districts")}</button><button type="button" data-hd="hemi">${L("577 sièges", "577 seats")}</button></div>
              <p id="hd-caption"></p>
              ${viz.legend}
            </figcaption>
          </figure>
        </div>
        <nav class="hero-x-doors" aria-label="${L("Rubriques", "Sections")}">
          <a href="${home?.code ? `#/ville/${home.code}` : "#/explorer"}"><span class="hx-k">${pixelIcon("home", 12)}${L("Chez vous", "Where you live")}</span><strong data-count="34920">${L("34 920", "34,920")}</strong><span>${home?.code ? esc(L(`communes, dont la vôtre, ${home.commune ?? home.code}`, `towns, yours included, ${home.commune ?? home.code}`)) : L("communes : maire, conseil, écoles, sécurité", "towns: mayor, council, schools, safety")}</span></a>
          <a href="#/assemblee"><span class="hx-k">${pixelIcon("parliament", 12)}${L("Parlement", "Parliament")}</span><strong data-count="${deputes.length || 577}">${deputes.length || 577}</strong><span>${L("députés et 348 sénateurs : chacun de leurs votes", "MPs and 348 senators: every vote they cast")}</span></a>
          <a href="#/2027"><span class="hx-k">${pixelIcon("ballot", 12)}${L("Présidentielle 2027", "2027 presidential")}</span>${fav ? `<strong data-count="${Math.round(fav.win)}" data-suffix="${fr ? " %" : "%"}">${pct(fav.win, 0)}</strong><span>${fr ? `de chances pour ${esc(fav.name)} selon notre prévision` : `chance for ${esc(fav.name)} in our forecast`}</span>` : `<strong>2027</strong><span>${L("la course, les sondages et le simulateur", "the race, the polls and the simulator")}</span>`}</a>
          <a href="#/programmes" class="is-new"><span class="hx-k">${pixelIcon("doc", 12)}${L("Programmes", "Programmes")}<i class="px-tag">${L("Nouveau", "New")}</i></span><strong${nMeasures ? ` data-count="${nMeasures}"` : ""}>${nMeasures ? fmtNum(nMeasures) : "2027"}</strong><span>${L(`mesures de ${nProgs || "tous les"} candidats, comparées et chiffrées`, `measures from ${nProgs || "all the"} candidates, compared and costed`)}</span></a>
          <a href="#/chiffres"><span class="hx-k">${pixelIcon("france", 12)}${L("La France", "France")}</span><strong data-count="101">101</strong><span>${L("départements : dette en direct, emploi, prix, bascules", "departments: live debt, jobs, prices, shifts")}</span></a>
          <a href="#/resultats"><span class="hx-k">${pixelIcon("archive", 12)}${L("Archives", "Archives")}</span><strong>1848</strong><span>${L("chaque présidentielle depuis, avec l’annonce filmée", "every presidential election since, with the footage")}</span></a>
        </nav>
        ${tickerHtml(ticker)}
        <div class="px-edge" aria-hidden="true"></div>
      </section>

      <div id="home-daily"></div>
      <div id="home-programmes" class="home-programmes"></div>
      <div id="mine"></div>
      <a class="quiz-teaser" href="#/quiz"><span class="quiz-teaser-k">${L("Quiz", "Quiz")}</span><strong>${L("Qui vous ressemble ?", "Who’s closest to you?")}</strong><span>${L("Répondez à de vrais votes de l’Assemblée : découvrez le député, le groupe et le candidat 2027 les plus proches de vous.", "Answer real Assembly votes: find the MP, group and 2027 candidate closest to you.")}</span></a>

      <section class="card">
        <header class="card-head"><h2>${esc(headline)}</h2><a href="#/2027">${L("La présidentielle 2027", "The 2027 race")}</a></header>
        <figure class="spectrum reveal-now" style="margin:0">
          <div class="spectrum-bar">${strip.map((r, i) => `<span class="grow" style="flex:${r.avg};background:${meta(r.name).color};--i:${i}" data-tip="${esc(`${r.name}${meta(r.name).party ? ` (${meta(r.name).party})` : ""}\n${pct(r.avg)}`)}"></span>`).join("")}</div>
          <div class="spectrum-labels">${strip.map((r, i) => `<span class="fade" style="flex:${r.avg};--i:${i}">${(100 * r.avg) / sum >= 6 ? `<b>${pct(r.avg)}</b>${esc(meta(r.name).surname)}` : ""}</span>`).join("")}</div>
          <div class="spectrum-axis"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
        </figure>
        <p class="muted small">${L(`Moyenne des ${nPolls} sondages des ${WINDOW} derniers jours, au ${fmtDate(latest)}, de chaque candidat dans les sondages où il figure (le total dépasse donc 100 %).`, `Average of the ${nPolls} polls from the last ${WINDOW} days, as of ${fmtDate(latest)}, for each candidate in the polls that include them (so the total exceeds 100%).`)}</p>
        <div id="trend" class="reveal"></div>
      </section>

      ${
        stories.length
          ? `<section class="card">
              <header class="card-head"><h2>${L("Fil rouge, fil bleu", "Red feed, blue feed")}</h2><a href="#/fil">${L("Tout le fil", "The whole feed")}</a></header>
              <ul class="teaser-stories">${stories
                .map((s) => {
                  const rs = (s.reactions ?? []).filter((r) => r.rating);
                  const l = rs.filter((r) => r.rating!.lean.score < 0).length, r = rs.length - l;
                  return `<li><a href="#/fil"><b>${esc(s.items[0].title)}</b></a><span class="lean-split"><span style="flex:${l || 0.001};background:#d4253a"></span><span style="flex:${r || 0.001};background:#1f5fcf"></span></span><span class="muted small">${l} ${L("réactions à gauche", "left-leaning reactions")}, ${r} ${L("à droite", "right-leaning")}</span></li>`;
                })
                .join("")}</ul>
            </section>`
          : ""
      }

      ${
        shifts
          ? `<section class="card arrows-card">
              <header class="card-head"><h2>${L("De 2022 à 2024, presque toute la France a basculé à droite", "From 2022 to 2024, almost all of France moved right")}</h2><a href="#/resultats/bascules">${L("Toutes les élections depuis 1848", "Every election since 1848")}</a></header>
              <p class="muted small">${L("Une flèche par circonscription, premier tour des législatives. Écart entre la droite (droite et extrême droite) et la gauche (gauche et écologistes).", "One arrow per district, legislative first round. Margin between the right (right and far right) and the left (left and greens).")}</p>
              <div class="shift-legend" id="home-legend"></div>
              <div class="reveal"><svg id="home-arrows" viewBox="0 0 800 780" class="home-arrows" role="img" aria-label="${L("Carte des bascules 2022–2024", "Shift map 2022–2024")}"></svg></div>
            </section>`
          : ""
      }

      <div id="home-debt"></div>

      <section class="charter">
        <blockquote>${L("« La société a le droit de demander compte à tout agent public de son administration. »", "“Society has the right to ask every public official to account for their administration.”")}</blockquote>
        <p>${L("Déclaration des droits de l’homme et du citoyen, article 15, 1789. Third Estate s’efforce de rendre ce droit praticable : des données publiques, une méthode ouverte, pour chacun.", "Declaration of the Rights of Man and of the Citizen, article 15, 1789. Third Estate tries to make that right practical: public data and an open method, for everyone.")}</p>
      </section>
    </section>`;
  bindSearch(app);
  viz.start(app);
  mountDebtTeaser(app.querySelector<HTMLElement>("#home-debt"));
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);

  const features = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
  const fc = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;

  // ---------- live visitors: the badge in the hero ----------
  const badge = app.querySelector<HTMLElement>("#live-badge")!;
  const off = onPresence((_c, total) => {
    if (!document.body.contains(badge)) return off();
    badge.hidden = !cloudEnabled();
    app.querySelector("#live-count")!.textContent = fr ? `${total} ${total > 1 ? "personnes" : "personne"} en ce moment` : `${total} ${total > 1 ? "people" : "person"} here now`;
  });
  startTicker(app, ELECTION_DAY);
  app.querySelector("#hero-story")?.addEventListener("click", (e) => { e.preventDefault(); app.querySelector("#home-programmes")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
  void mountDaily(app.querySelector<HTMLElement>("#home-daily"), true);
  mountProgrammesFeature(app.querySelector<HTMLElement>("#home-programmes"));

  // ---------- trend chart ----------
  const from = shiftDays(latest, -365);
  const pts = trend(polls.firstRound, from);
  const shown = now.slice(0, 7).map((r) => r.name);
  app.querySelector("#trend")!.innerHTML = lineChart(
    shown.map((n) => ({ name: n, label: meta(n).surname, color: meta(n).color, line: pts.filter((p) => p.values[n] != null).map((p) => ({ date: p.date, value: p.values[n] })) })).filter((s) => s.line.length),
    { height: 340 },
  );

  // ---------- arrows ----------
  if (shifts) {
    const pair = shifts.pairs.filter((p) => p.level === "district").at(-1)!;
    const projA = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], fc);
    const outlines = features.map((f) => `<path d="${geoPath(projA)(f)}" class="shift-base"/>`);
    const svgA = app.querySelector<SVGSVGElement>("#home-arrows")!;
    const k = unitsPerPx(svgA, 800);
    svgA.style.setProperty("--sw", `${(1.7 * k).toFixed(2)}px`);
    svgA.innerHTML = outlines.join("") + arrowPaths(pair, "lr", (p) => projA(p) as [number, number] | null, { k });
    app.querySelector("#home-legend")!.innerHTML = legend("lr", 2.2 / k);
    svgA.addEventListener("click", (e) => { const href = (e.target as Element).closest<SVGGElement>(".arrow")?.dataset.href; if (href) location.hash = href; });
  }

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** The reader's own town, first thing under the hero: the four-sentence brief, their MPs, shortcuts into the town page. */
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
