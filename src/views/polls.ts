// Polls & markets: trend, runoff match-ups, every poll, prediction markets.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate, fmtNum } from "../i18n";
import { lineChart } from "../lib/chart";
import { meta, registerParties } from "../lib/candidates";
import { average, duelAverages, pollValue, trend } from "../lib/polls";
import { esc } from "../util";
import { shiftDays } from "./home";

const ui = { range: 365, hidden: new Set<string>(), pollster: "" };

export async function renderPolls(app: HTMLElement) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const current = average(polls.firstRound, latest);
  const pollsters = [...new Set(polls.firstRound.map((p) => p.pollster))].sort();

  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">${L("Présidentielle 2027", "2027 presidential")}</p><h1>${L("Sondages et marchés", "Polls & markets")}</h1></div>
        <nav class="subnav">
          <a href="#/sondages#evolution">${L("Évolution", "Trend")}</a>
          <a href="#/sondages#second-tour">${L("Second tour", "Runoff")}</a>
          <a href="#/sondages#liste">${L("Tous les sondages", "All polls")}</a>
          <a href="#/sondages#marches">${L("Marchés", "Markets")}</a>
        </nav>
      </div>

      <article class="card" id="evolution">
        <header class="card-head"><h2>${L("Évolution des intentions de vote au 1er tour", "First-round voting intention over time")}</h2>
          <div class="tabs">${[[180, L("6 mois", "6 months")], [365, L("1 an", "1 year")], [3650, L("Tout", "All")]].map(([d, l]) => `<button type="button" data-range="${d}" aria-selected="${ui.range === d}">${l}</button>`).join("")}</div>
        </header>
        <div id="chart"></div>
        <div class="legend" id="legend"></div>
        <p class="muted small">${L("Lignes : moyenne mobile sur 30 jours. Points : sondages individuels (moyenne des hypothèses testées).", "Lines: 30-day rolling average. Dots: individual polls (mean across tested line-ups).")} <a href="#/sources">${L("Méthode", "Method")}</a></p>
      </article>

      <article class="card" id="second-tour">
        <header class="card-head"><h2>${L("Second tour : tous les duels testés", "Runoff: every match-up polled")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Duel", "Match-up")}</th><th class="num">${L("Moyenne", "Average")}</th><th class="num">${L("Sondages", "Polls")}</th><th>${L("Dernier", "Latest")}</th></tr></thead>
          <tbody>${duelAverages(polls.secondRound)
            .map((d) => {
              const w = meta(d.winner), l = meta(d.loser);
              return `<tr><td><b>${esc(d.winner)}</b> ${L("contre", "vs")} ${esc(d.loser)}</td>
                <td class="num"><div class="duel"><span style="width:${d.pw}%;background:${w.color}">${d.pw.toFixed(0)}</span><span style="width:${d.pl}%;background:${l.color}">${d.pl.toFixed(0)}</span></div></td>
                <td class="num muted">${d.total}</td><td class="muted">${fmtDate(d.last)}</td></tr>`;
            })
            .join("")}</tbody>
        </table>
        <p class="muted small">${L("Moyenne des sondages des 60 jours précédant le dernier sondage du duel.", "Average of polls in the 60 days before each match-up’s latest poll.")}</p>
      </article>

      <article class="card" id="liste">
        <header class="card-head"><h2>${L("Tous les sondages du 1er tour", "Every first-round poll")}</h2>
          <select id="pollster"><option value="">${L("Tous les instituts", "All pollsters")}</option>${pollsters.map((p) => `<option ${p === ui.pollster ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </header>
        <div id="list"></div>
      </article>

      <article class="card" id="marches">
        <header class="card-head"><h2>${L("Marchés prédictifs", "Prediction markets")}</h2></header>
        ${markets ? marketsHtml(markets) : `<p class="muted">${L("Données indisponibles.", "Data unavailable.")}</p>`}
      </article>

      <p class="source muted">${L("Sondages : Wikipédia (CC BY-SA), mis à jour le", "Polls: Wikipedia (CC BY-SA), updated")} ${fmtDate(polls.fetchedAt)} · <a href="${polls.source}" target="_blank" rel="noopener">${L("page source", "source page")}</a></p>
    </section>`;

  const drawChart = () => {
    const from = shiftDays(latest, -ui.range);
    const pts = trend(polls.firstRound, from);
    const shown = current.slice(0, 12).map((r) => r.name);
    const series = shown
      .filter((n) => !ui.hidden.has(n))
      .map((n) => {
        const m = meta(n);
        return {
          name: n,
          label: m.surname,
          color: m.color,
          line: pts.filter((p) => p.values[n] != null).map((p) => ({ date: p.date, value: p.values[n] })),
          dots: polls.firstRound.filter((p) => p.end >= from).flatMap((p) => {
            const v = pollValue(p, n);
            return v == null ? [] : [{ date: p.end, value: v, title: `${p.pollster} · ${fmtDate(p.end)} · ${n} ${v.toFixed(1)} %` }];
          }),
        };
      })
      .filter((s) => s.line.length);
    app.querySelector("#chart")!.innerHTML = lineChart(series);
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
    const rows = polls.firstRound.filter((p) => !ui.pollster || p.pollster === ui.pollster).slice(0, 60);
    app.querySelector("#list")!.innerHTML = `<ul class="poll-list">${rows
      .map(
        (p) => `<li>
          <div class="poll-head"><b>${esc(p.pollster)}</b><span class="muted small">${fmtDate(p.start)} – ${fmtDate(p.end)}${p.sample ? ` · n = ${fmtNum(p.sample)}` : ""}${p.hyps.length > 1 ? ` · ${p.hyps.length} ${L("hypothèses", "line-ups")}` : ""}</span></div>
          ${p.hyps
            .map(
              (h) => `<div class="hyp">${Object.entries(h)
                .sort((a, b) => b[1] - a[1])
                .map(([n, v]) => `<span class="pill" style="--c:${meta(n).color}">${esc(meta(n).surname)} <b>${v}</b></span>`)
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

function marketsHtml(data: NonNullable<Awaited<ReturnType<typeof loadMarkets>>>) {
  return `
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
            .map((o) => `<li><div class="bar-label"><span>${esc(o.name)}</span><b>${o.prob.toFixed(0)} %</b></div><div class="bar"><div style="width:${o.prob}%;background:${meta(o.name).color}"></div></div></li>`)
            .join("")}</ol>
          <p class="muted small">${L("Volume", "Volume")} ${fmtNum(m.volume)} · <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.platform)} ↗</a></p>
        </div>`,
      )
      .join("")}</div>
    ${data.errors.length ? `<p class="muted small">${L("Non joignable lors de la dernière mise à jour", "Unreachable at last update")} : ${data.errors.map((e) => esc(e.platform)).join(", ")}</p>` : ""}`;
}
