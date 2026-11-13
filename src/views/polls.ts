// Polls & markets: trend, runoff match-ups, every poll, prediction markets.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { WINDOW, average, duelAverages, latestPollDate, pollsterName } from "../lib/polls";
import { colon, dec, pair100, pct } from "../lib/format";
import { combineOdds, oddsFor, winShare } from "../lib/markets";
import { esc, safeUrl } from "../util";
import { shiftDays } from "./home";
import { liveForecast, mountDaily } from "./daily";
import { mountForecastChart } from "./forecast-chart";

const ui = { range: 180, hidden: new Set<string>(), pollster: "" };

export async function renderPolls(app: HTMLElement) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  registerParties(polls.parties);
  const latest = latestPollDate(polls.firstRound);
  const current = average(polls.firstRound, latest);
  const pollsters = [...new Set(polls.firstRound.map((p) => pollsterName(p.pollster)))].sort();
  const allDuels = duelAverages(polls.secondRound);
  const duels = allDuels.filter((d) => !d.stale);
  const nStale = allDuels.length - duels.length;

  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">${L("Présidentielle 2027", "2027 presidential election")}</p><h1>${current[0] ? (getLang() === "fr" ? `${esc(current[0].name)} à ${pct(current[0].avg)} en moyenne${current[1] ? `, ${esc(meta(current[1].name).surname)} à ${pct(current[1].avg)}` : ""}` : `${esc(current[0].name)} averages ${pct(current[0].avg)}${current[1] ? `, ${esc(meta(current[1].name).surname)} ${pct(current[1].avg)}` : ""}`) : L("Tous les sondages, et ce que parient les marchés", "Every poll, and what the betting markets say")}</h1>
          <p class="dek">${L("L’évolution des intentions de vote depuis 2025, chaque duel de second tour testé, la liste complète des sondages et les cotes de Kalshi et Polymarket.", "Voting intention since 2025, every runoff match-up tested, the full list of polls, and the odds on Kalshi and Polymarket.")}</p></div>
        <nav class="subnav">
          <a href="#/sondages#point">${L("Le point du jour", "Today’s brief")}</a>
          <a href="#/sondages#evolution">${L("Évolution", "Trend")}</a>
          <a href="#/sondages#second-tour">${L("Second tour", "Runoff")}</a>
          <a href="#/sondages#liste">${L("Tous les sondages", "All polls")}</a>
          <a href="#/sondages#marches">${L("Marchés", "Markets")}</a>
          <a href="#/sondages/instituts">${L("Les instituts notés", "Pollsters graded")}</a>
        </nav>
      </div>

      <div id="daily"></div>

      <article class="card" id="evolution">
        <header class="card-head"><h2>${L("Évolution des intentions de vote au 1er tour", "First-round voting intention over time")}</h2>
          <div class="tabs">${[[180, L("6 mois", "6 months")], [365, L("1 an", "1 year")], [3650, L("Tout", "All")]].map(([d, l]) => `<button type="button" data-range="${d}" aria-selected="${ui.range === d}">${l}</button>`).join("")}</div>
        </header>
        <div id="chart"></div>
        <div class="legend" id="legend"></div>
        <p class="muted small">${L(`Lignes pleines : moyenne des sondages sur ${WINDOW} jours glissants, pondérée par la note de chaque institut (un sondage mal noté la fait moins bouger), la même que partout sur le site. Points : sondages individuels (moyenne des hypothèses testées).`, `Solid lines: ${WINDOW}-day rolling polling average, weighted by each institute’s grade (a poorly graded poll moves it less), the same one used across the site. Dots: individual polls (mean across tested line-ups).`)} <a href="#/sondages/instituts">${L("Les instituts notés", "Pollsters graded")}</a> · <a href="#/sources">${L("Méthode", "Method")}</a></p>
      </article>

      <article class="card" id="second-tour">
        <header class="card-head"><h2>${L("Second tour : tous les duels testés", "Runoff: every match-up polled")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Duel", "Match-up")}</th><th class="num">${L("Moyenne", "Average")}</th><th class="num">${L("Sondages", "Polls")}</th><th>${L("Dernier", "Latest")}</th></tr></thead>
          <tbody>${duels
            .map((d) => {
              const w = meta(d.winner), l = meta(d.loser);
              const [rw, rl] = pair100(d.pw, d.pl);
              return `<tr><td><b>${esc(d.winner)}</b> ${L("contre", "vs")} ${esc(d.loser)}</td>
                <td class="num"><div class="duel"><span style="width:${rw}%;background:${w.color}">${rw}</span><span style="width:${rl}%;background:${l.color}">${rl}</span></div></td>
                <td class="num muted">${d.total}</td><td class="muted">${fmtDate(d.last)}</td></tr>`;
            })
            .join("")}</tbody>
        </table>
        <p class="muted small">${L("Moyenne des sondages des 60 jours précédant le dernier sondage du duel, ramenée à 100 entre les deux candidats.", "Average of polls in the 60 days before each match-up’s latest poll, scaled so the two add up to 100.")}${nStale ? ` ${L(`${nStale} ${nStale > 1 ? "duels non sondés" : "duel non sondé"} depuis plus d’un an ${nStale > 1 ? "sont masqués" : "est masqué"}.`, `${nStale} match-up${nStale > 1 ? "s" : ""} not polled for over a year ${nStale > 1 ? "are" : "is"} hidden.`)}` : ""}</p>
      </article>

      <article class="card" id="liste">
        <header class="card-head"><h2>${L("Tous les sondages du 1er tour", "Every first-round poll")}</h2>
          <select id="pollster"><option value="">${L("Tous les instituts", "All pollsters")}</option>${pollsters.map((p) => `<option ${p === ui.pollster ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </header>
        <div id="list"></div>
      </article>

      <article class="card" id="marches">
        <header class="card-head"><h2>${L("Marchés prédictifs, pour comparaison", "Prediction markets, for comparison")}</h2></header>
        ${markets ? marketsHtml(markets, polls) : `<p class="muted">${L("Données indisponibles.", "Data unavailable.")}</p>`}
      </article>

      <p class="source muted">${L("Sondages : Wikipédia (CC BY-SA), mis à jour le", "Polls: Wikipedia (CC BY-SA), updated")} ${fmtDate(polls.fetchedAt)} · <a href="${esc(safeUrl(polls.source))}" target="_blank" rel="noopener">${L("page source", "source page")}</a></p>
    </section>`;

  void mountDaily(app.querySelector<HTMLElement>("#daily")).then(() => { if (/#point$/.test(location.hash)) document.getElementById("point")?.scrollIntoView(); });

  const shown = current.slice(0, 12).map((r) => r.name);
  const redraw = mountForecastChart(app.querySelector<HTMLElement>("#chart")!, {
    polls, markets, from: () => shiftDays(latest, -ui.range), shown: () => shown, hidden: () => ui.hidden,
  });
  const drawChart = () => {
    redraw();
    app.querySelector("#legend")!.innerHTML = shown
      .map((n) => `<button type="button" class="chip-toggle" data-name="${esc(n)}" aria-pressed="${!ui.hidden.has(n)}" style="--c:${meta(n).color}">${esc(meta(n).surname)}</button>`)
      .join("");
    app.querySelectorAll<HTMLButtonElement>(".chip-toggle").forEach((b) =>
      b.addEventListener("click", () => {
        const n = b.dataset.name!;
        ui.hidden.has(n) ? ui.hidden.delete(n) : ui.hidden.add(n);
        drawChart();
      }),
    );
    app.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.range) === ui.range)));
  };

  const drawList = () => {
    const rows = polls.firstRound.filter((p) => !ui.pollster || pollsterName(p.pollster) === ui.pollster).slice(0, 60);
    app.querySelector("#list")!.innerHTML = `<ul class="poll-list">${rows
      .map(
        (p) => `<li>
          <div class="poll-head"><b>${esc(p.pollster)}</b><span class="muted small">${fmtDate(p.start)} – ${fmtDate(p.end)}${p.sample ? ` · n = ${fmtNum(p.sample)}` : ""}${p.hyps.length > 1 ? ` · ${p.hyps.length} ${L("hypothèses", "line-ups")}` : ""}</span></div>
          ${p.hyps
            .map(
              (h) => `<div class="hyp">${Object.entries(h)
                .sort((a, b) => b[1] - a[1])
                .map(([n, v]) => `<span class="pill" style="--c:${meta(n).color}">${esc(meta(n).surname)} <b>${dec(v, Number.isInteger(v) ? 0 : 1)}</b></span>`)
                .join("")}</div>`,
            )
            .join("")}
        </li>`,
      )
      .join("")}</ul>`;
  };

  app.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.range = Number(b.dataset.range);
      drawChart();
    }),
  );
  app.querySelector<HTMLSelectElement>("#pollster")!.addEventListener("change", (e) => {
    ui.pollster = (e.target as HTMLSelectElement).value;
    drawList();
  });
  drawChart();
  drawList();
}

function marketsHtml(data: NonNullable<Awaited<ReturnType<typeof loadMarkets>>>, polls: Awaited<ReturnType<typeof loadPolls>>) {
  const top = liveForecast(polls, data).rows[0];
  const odds = combineOdds(data.markets);
  const mk = top ? winShare(odds, oddsFor(odds, top.name)) : null;
  const fr = getLang() === "fr";
  return `
    ${top ? `<p class="mk-vs">${fr
      ? `Notre prévision donne ${pct(top.win, 0)} de chances à ${esc(top.name)}${mk != null ? ` ; les marchés réunis, ${pct(mk, 0)}` : ""}. Le chiffre de référence du site est la prévision ; les marchés sont un second avis, qui intègre aussi la question de savoir qui sera candidat.`
      : `Our forecast gives ${esc(top.name)} a ${pct(top.win, 0)} chance${mk != null ? `; the markets combined, ${pct(mk, 0)}` : ""}. The site’s reference figure is the forecast; the markets are a second opinion, one that also prices who will actually stand.`} <a href="#/sondages#point">${L("Pourquoi les deux diffèrent", "Why the two differ")}</a></p>` : ""}
    <p class="muted small">${L(
      "Prix des contrats « oui », lus comme une probabilité implicite. Ce ne sont pas des sondages : ils reflètent les paris d’une poignée de parieurs, souvent hors de France. Polymarket est bloqué en France ; il est interrogé depuis un serveur hors de France.",
      "Price of “yes” contracts, read as an implied probability. These aren’t polls: they reflect bets by a small number of traders, mostly outside France. Polymarket is blocked in France and is queried from a server outside the country.",
    )} ${L("Mis à jour le", "Updated")} ${fmtDate(data.fetchedAt)}.</p>
    <div class="grid-3">${data.markets
      .map(
        (m) => `<div class="market">
          <h3><span class="tag">${esc(m.platform)}</span> ${esc(m.question)}</h3>
          <ol class="bars compact">${m.outcomes
            .slice(0, 8)
            .map((o) => `<li><div class="bar-label"><span>${esc(o.name)}</span><b>${pct(o.prob, 0)}</b></div><div class="bar"><div style="width:${o.prob}%;background:${meta(o.name).color}"></div></div></li>`)
            .join("")}</ol>
          <p class="muted small">${L("Volume", "Volume")} ${fmtNum(m.volume)} · <a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.platform)} ↗</a></p>
        </div>`,
      )
      .join("")}</div>
    ${data.errors.length ? `<p class="muted small">${L("Non joignable lors de la dernière mise à jour", "Unreachable at last update")}${colon()}${data.errors.map((e) => esc(e.platform)).join(", ")}</p>` : ""}`;
}
