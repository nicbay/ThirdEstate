// 2027 hub: where the race stands today, with doors to every other section.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { average, duelAverages, pollValue, WINDOW } from "../lib/polls";
import { esc } from "../util";

export async function renderHome(app: HTMLElement) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const now = average(polls.firstRound, latest);
  const before = new Map(average(polls.firstRound, shiftDays(latest, -30), WINDOW, 0).map((r) => [r.name, r.avg]));
  const top = now.slice(0, 10);
  const max = Math.max(...top.map((r) => r.avg), 1);
  const duels = duelAverages(polls.secondRound).slice(0, 5);
  const winner = markets?.markets.find((m) => m.id.startsWith("KXFRENCHPRES") || /winner|win the/i.test(m.question));

  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">${L("Élection présidentielle", "Presidential election")}</p>
          <h1>${L("Où en est la course pour 2027", "Where the 2027 race stands")}</h1>
        </div>
      </div>

      <div class="grid-2">
        <article class="card">
          <header class="card-head"><h2>${L("Moyenne des sondages · 1er tour", "Polling average · first round")}</h2><a href="#/sondages">${L("Évolution et détail", "Trend and details")} →</a></header>
          <p class="muted small">${L(`Sondages des ${WINDOW} derniers jours jusqu’au`, `Polls from the last ${WINDOW} days up to`)} ${fmtDate(latest)}. ${L("Écart sur 30 jours entre parenthèses. Les sondages testent des candidatures alternatives (ex. Philippe ou Attal) : le total dépasse 100 %.", "30-day change in brackets. Polls test alternative candidates (e.g. Philippe or Attal), so the total exceeds 100%.")}</p>
          <ol class="bars">
            ${top
              .map((r) => {
                const m = meta(r.name);
                const prev = before.get(r.name);
                const delta = prev != null ? r.avg - prev : null;
                return `<li>
                  <div class="bar-label"><span><i class="dot" style="background:${m.color}"></i>${esc(r.name)} <span class="muted">${m.party ?? ""}</span></span>
                  <span><b>${r.avg.toFixed(1)}</b> ${delta != null && Math.abs(delta) >= 0.1 ? `<span class="${delta > 0 ? "up" : "down"}">(${delta > 0 ? "+" : ""}${delta.toFixed(1)})</span>` : ""}</span></div>
                  <div class="bar"><div style="width:${(100 * r.avg) / max}%;background:${m.color}"></div></div>
                </li>`;
              })
              .join("")}
          </ol>
        </article>

        <article class="card">
          <header class="card-head"><h2>${L("Marchés prédictifs · vainqueur", "Prediction markets · winner")}</h2><a href="#/sondages#marches">${L("Tous les marchés", "All markets")} →</a></header>
          ${
            winner
              ? `<p class="muted small">${esc(winner.platform)} · ${L("probabilité implicite", "implied probability")} · ${L("mis à jour", "updated")} ${fmtDate(markets!.fetchedAt)}</p>
                 <ol class="bars">${winner.outcomes
                   .slice(0, 8)
                   .map((o) => `<li><div class="bar-label"><span><i class="dot" style="background:${meta(o.name).color}"></i>${esc(o.name)}</span><b>${o.prob.toFixed(0)} %</b></div><div class="bar"><div style="width:${o.prob}%;background:${meta(o.name).color}"></div></div></li>`)
                   .join("")}</ol>`
              : `<p class="muted">${L("Données de marché indisponibles.", "Market data unavailable.")}</p>`
          }
        </article>
      </div>

      <div class="grid-2">
        <article class="card">
          <header class="card-head"><h2>${L("Second tour · duels testés", "Runoff · match-ups polled")}</h2><a href="#/sondages#second-tour">${L("Détail", "Details")} →</a></header>
          <table class="table">
            <thead><tr><th>${L("Duel", "Match-up")}</th><th class="num">${L("Écart", "Margin")}</th><th class="num">${L("Sondages", "Polls")}</th></tr></thead>
            <tbody>${duels
              .map((d) => `<tr><td><i class="dot" style="background:${meta(d.winner).color}"></i><b>${esc(meta(d.winner).surname)} ${d.pw.toFixed(0)}</b> – ${d.pl.toFixed(0)} ${esc(meta(d.loser).surname)}</td><td class="num">+${(d.pw - d.pl).toFixed(0)}</td><td class="num muted">${d.total}</td></tr>`)
              .join("")}</tbody>
          </table>
          <a class="button" href="#/simulateur">${L("Construire votre scénario", "Build your own scenario")} →</a>
        </article>

        <article class="card">
          <header class="card-head"><h2>${L("Derniers sondages", "Latest polls")}</h2><a href="#/sondages#liste">${L("Tous les sondages", "All polls")} →</a></header>
          <table class="table">
            <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Terrain", "Fieldwork")}</th><th>${L("En tête", "Top 3")}</th></tr></thead>
            <tbody>${polls.firstRound
              .slice(0, 6)
              .map((p) => {
                const names = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))];
                const top3 = names.map((n) => [n, pollValue(p, n)!] as const).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return `<tr><td>${esc(p.pollster)}</td><td class="muted">${fmtDate(p.end)}</td><td>${top3.map(([n, v]) => `${esc(meta(n).surname)} ${v.toFixed(0)}`).join(" · ")}</td></tr>`;
              })
              .join("")}</tbody>
          </table>
        </article>
      </div>

      <nav class="doors">
        <a class="card door" href="#/resultats"><b>${L("Résultats passés", "Past results")}</b><span class="muted">${L("Présidentielle 2022, législatives 2024, et l’écart avec les sondages", "2022 presidential, 2024 legislative, and how far off the polls were")}</span></a>
        <a class="card door" href="#/assemblee"><b>${L("Assemblée nationale", "National Assembly")}</b><span class="muted">${L("Carte des 577 circonscriptions, députés, votes, profils", "Map of the 577 districts, MPs, votes, profiles")}</span></a>
        <a class="card door" href="#/sources"><b>${L("Sources et méthode", "Sources & method")}</b><span class="muted">${L("D’où viennent les données et comment elles sont calculées", "Where the data comes from and how it’s computed")}</span></a>
      </nav>
      <p class="source muted">${L("Sondages : Wikipédia (CC BY-SA)", "Polls: Wikipedia (CC BY-SA)")} · <a href="${polls.source}" target="_blank" rel="noopener">${L("source", "source")}</a> · ${getLang() === "fr" ? "mis à jour le" : "updated"} ${fmtDate(polls.fetchedAt)}</p>
    </section>`;
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
