// 2027 front page: the state of the race in one headline and one strip, then the detail.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { average, duelAverages, pollValue, referenceLineup, WINDOW } from "../lib/polls";
import { combineOdds, marketMeta } from "../lib/markets";
import { esc, safeUrl, safeColor } from "../util";
import { shiftDays } from "./home";

export async function renderRace(app: HTMLElement) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const now = average(polls.firstRound, latest);
  const before = new Map(average(polls.firstRound, shiftDays(latest, -30), WINDOW, 0).map((r) => [r.name, r.avg]));
  const top = now.slice(0, 10);
  const max = Math.max(...top.map((r) => r.avg), 1);
  const duels = duelAverages(polls.secondRound).slice(0, 5);
  const winner = markets?.markets.find((m) => m.id.startsWith("KXFRENCHPRES")) ?? markets?.markets.find((m) => /winner|next french presidential election$/i.test(m.question));
  const lineup = referenceLineup(polls.firstRound, latest);
  const strip = [...lineup.rows].sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
  const sum = strip.reduce((s, r) => s + r.share, 0) || 1;
  const ranked = [...lineup.rows].sort((a, b) => b.share - a.share);
  const [leader, second] = ranked;
  const nPolls = polls.firstRound.filter((p) => p.end > shiftDays(latest, -WINDOW)).length;

  const headline = leader
    ? getLang() === "fr"
      ? `${leader.name} en tête des intentions de vote${second ? `, ${meta(second.name).surname} deuxième` : ""}`
      : `${leader.name} leads first-round polling${second ? `, with ${meta(second.name).surname} second` : ""}`
    : L("Où en est la course", "Where the race stands");

  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027", "2027 presidential election")}</p>
        <h1>${esc(headline)}</h1>
        <p class="dek">${L(
          `Moyenne des ${nPolls} sondages publiés ces ${WINDOW} derniers jours, au ${fmtDate(latest)}, pour l’hypothèse de candidatures la plus testée. Les candidats sont rangés de gauche à droite.`,
          `Average of the ${nPolls} polls published in the last ${WINDOW} days, as of ${fmtDate(latest)}, for the most-tested candidate line-up. Candidates run left to right.`,
        )}</p>
      </header>

      <figure class="spectrum" style="margin:0" aria-label="${L("Intentions de vote, de gauche à droite", "Voting intention, left to right")}">
        <div class="spectrum-bar">${strip.map((r) => `<span style="flex:${r.share};background:${meta(r.name).color}" data-tip="${esc(`${r.name}${meta(r.name).party ? ` (${meta(r.name).party})` : ""}\n${r.share.toFixed(1)} %`)}"></span>`).join("")}</div>
        <div class="spectrum-labels">${strip.map((r) => `<span style="flex:${r.share}">${(100 * r.share) / sum >= 7 ? `<b>${r.share.toFixed(0)} %</b>${esc(meta(r.name).surname)}` : ""}</span>`).join("")}</div>
        <div class="spectrum-axis"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
      </figure>

      <section class="card polls-vs-markets">
        <header class="card-head"><h2>${L("Sondages ou paris : qui va gagner ?", "Polls or bets: who will win?")}</h2><a href="#/sondages#marches">${L("Détail des marchés", "Market details")}</a></header>
        <p class="muted small">${L("Les sondages mesurent les intentions de vote au premier tour ; les marchés prédictifs donnent la probabilité, selon les parieurs, que chacun soit élu ou qualifié au second tour.", "Polls measure first-round voting intention; prediction markets give the probability, according to traders, that each candidate wins or reaches the runoff.")}</p>
        <table class="table"><thead><tr><th>${L("Candidat", "Candidate")}</th><th class="num">${L("Sondages, 1er tour", "Polls, 1st round")}</th><th class="num">${L("Chance d’être qualifié", "Chance of reaching runoff")}</th><th class="num">${L("Chance de gagner", "Chance of winning")}</th><th class="num">${L("S’il est qualifié", "If qualified")}</th><th class="num">Kalshi</th><th class="num">Polymarket</th></tr></thead>
        <tbody>${(() => {
          const odds = combineOdds(markets?.markets ?? []);
          const pollOf = (n: string) => average(polls.firstRound, latest).find((r) => r.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() === n.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase())?.avg;
          return odds
            .filter((o) => (o.win?.avg ?? 0) >= 1 || (o.runoff?.avg ?? 0) >= 5)
            .slice(0, 10)
            .map((o) => { const pv = pollOf(o.name); const w = o.win?.avg ?? 0; return `<tr><td><i class="dot" style="background:${meta(o.name).color}"></i><b>${esc(o.name)}</b></td><td class="num">${pv != null ? `${pv.toFixed(1)} %` : "–"}</td><td class="num">${o.runoff ? `${Math.round(o.runoff.avg)} %` : "–"}</td><td class="num"><span class="odds-bar"><i style="width:${w}%;background:${meta(o.name).color}"></i></span><b>${Math.round(w)} %</b></td><td class="num">${o.ifQualified != null ? `${Math.round(o.ifQualified)} %` : "–"}</td><td class="num muted">${o.win?.kalshi != null ? `${Math.round(o.win.kalshi)} %` : "–"}</td><td class="num muted">${o.win?.polymarket != null ? `${Math.round(o.win.polymarket)} %` : "–"}</td></tr>`; })
            .join("");
        })()}</tbody></table>
        <p class="small"><b>${L("Comment lire :", "How to read it:")}</b> ${L("un candidat peut avoir de bonnes chances d’être qualifié mais peu de chances de gagner (s’il perdrait le second tour), ou l’inverse. La colonne « s’il est qualifié » donne ses chances de l’emporter une fois au second tour.", "a candidate can be likely to reach the runoff yet unlikely to win (if they would lose it), or the reverse. The “if qualified” column gives their chance of winning once in the runoff.")}</p>
        <p class="muted tiny">${L("Cotes « vainqueur » ramenées à 100 % pour retirer la marge des plateformes, cotes « qualifiés » telles quelles ; puis moyenne des deux plateformes pondérée par les montants échangés.", "Winner prices rescaled to 100% to remove the platforms’ margin, runoff prices as quoted; then averaged across platforms weighted by traded volume.")} ${marketMeta(markets?.markets ?? []).map((x) => `${esc(x.platform)} ${x.kind === "win" ? L("vainqueur", "winner") : L("qualifiés", "runoff")} : ${Math.round(x.volume / 1000).toLocaleString()} k$${x.thin ? ` (${L("marché peu liquide", "thin market")})` : ""}`).join(", ")}.</p>
        <p class="muted tiny">${L("Kalshi et Polymarket, prix des contrats « oui ». Polymarket est bloqué en France ; il est interrogé depuis un serveur à l’étranger. Information, pas incitation à parier.", "Kalshi and Polymarket, price of “yes” contracts. Polymarket is blocked in France and is queried from a server abroad. Information only, not an invitation to bet.")}${markets?.fetchedAt ? ` <b>${L("Cotes du", "Prices as of")} ${fmtDate(markets.fetchedAt)} ${new Date(markets.fetchedAt).toLocaleTimeString(getLang() === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" })}.</b>` : ""}</p>
      </section>

      <div class="grid-2">
        <section class="card">
          <header class="card-head"><h2>${L("Tous les candidats testés", "Every candidate polled")}</h2><a href="#/sondages">${L("Évolution", "Trend")}</a></header>
          <p class="muted small">${L("Moyenne de chaque candidat dans les sondages où il figure, et son évolution sur 30 jours. Ils ne sont pas tous testés ensemble, le total dépasse donc 100 %.", "Each candidate’s average in the polls that include them, and the 30-day change. They aren’t all tested together, so the total exceeds 100%.")}</p>
          <ol class="bars">
            ${top
              .map((r) => {
                const m = meta(r.name);
                const prev = before.get(r.name);
                const delta = prev != null ? r.avg - prev : null;
                return `<li>
                  <div class="bar-label"><span>${esc(r.name)} <span class="muted">${esc(m.party ?? "")}</span></span>
                  <span>${delta != null && Math.abs(delta) >= 0.1 ? `<span class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta.toFixed(1)}</span> ` : ""}<b>${r.avg.toFixed(1)} %</b></span></div>
                  <div class="bar"><div style="width:${(100 * r.avg) / max}%;background:${m.color}"></div></div>
                </li>`;
              })
              .join("")}
          </ol>
        </section>

        <section class="card">
          <header class="card-head"><h2>${L("Ce que parient les marchés", "What the betting markets say")}</h2><a href="#/sondages#marches">${L("Tous les marchés", "All markets")}</a></header>
          ${
            winner
              ? `<p class="muted small">${L("Probabilité de victoire implicite", "Implied chance of winning")}, ${esc(winner.platform)}, ${fmtDate(markets!.fetchedAt)}.</p>
                 <ol class="bars">${winner.outcomes
                   .slice(0, 7)
                   .map((o) => `<li><div class="bar-label"><span>${esc(o.name)}</span><b>${o.prob.toFixed(0)} %</b></div><div class="bar"><div style="width:${o.prob}%;background:${meta(o.name).color}"></div></div></li>`)
                   .join("")}</ol>`
              : `<p class="muted">${L("Données de marché indisponibles.", "Market data unavailable.")}</p>`
          }
        </section>
      </div>

      <div class="grid-2">
        <section class="card">
          <header class="card-head"><h2>${L("Les duels du second tour", "Runoff match-ups")}</h2><a href="#/sondages#second-tour">${L("Tous les duels", "All match-ups")}</a></header>
          <table class="table">
            <thead><tr><th>${L("Duel testé", "Match-up")}</th><th class="num">${L("Écart", "Margin")}</th><th class="num">${L("Sondages", "Polls")}</th></tr></thead>
            <tbody>${duels
              .map((d) => `<tr><td><i class="dot" style="background:${meta(d.winner).color}"></i><b>${esc(meta(d.winner).surname)} ${d.pw.toFixed(0)}</b> – ${d.pl.toFixed(0)} ${esc(meta(d.loser).surname)}</td><td class="num">+${(d.pw - d.pl).toFixed(0)}</td><td class="num muted">${d.total}</td></tr>`)
              .join("")}</tbody>
          </table>
          <a class="button" href="#/simulateur">${L("Simuler un second tour", "Simulate a runoff")}</a>
        </section>

        <section class="card">
          <header class="card-head"><h2>${L("Derniers sondages", "Latest polls")}</h2><a href="#/sondages#liste">${L("Tous les sondages", "All polls")}</a></header>
          <table class="table">
            <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Terrain", "Fieldwork")}</th><th>${L("Les trois premiers", "Top three")}</th></tr></thead>
            <tbody>${polls.firstRound
              .slice(0, 6)
              .map((p) => {
                const names = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))];
                const top3 = names.map((n) => [n, pollValue(p, n)!] as const).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return `<tr><td>${esc(p.pollster)}</td><td class="muted">${fmtDate(p.end)}</td><td>${top3.map(([n, v]) => `${esc(meta(n).surname)} ${v.toFixed(0)}`).join(", ")}</td></tr>`;
              })
              .join("")}</tbody>
          </table>
        </section>
      </div>

      <nav class="doors" aria-label="${L("Rubriques", "Sections")}">
        <a class="door" href="#/resultats"><b>${L("Résultats passés", "Past results")}</b><span class="muted small">${L("Présidentielle 2022, législatives 2024 et l’écart avec les derniers sondages.", "The 2022 presidential and 2024 legislative elections, and how far off the final polls were.")}</span></a>
        <a class="door" href="#/assemblee"><b>${L("L’Assemblée nationale", "The National Assembly")}</b><span class="muted small">${L("Les 577 circonscriptions, leurs députés, leurs votes et leur profil.", "All 577 districts, their MPs, how they vote and who they are.")}</span></a>
        <a class="door" href="#/sources"><b>${L("Sources et méthode", "Sources and method")}</b><span class="muted small">${L("D’où viennent les chiffres et comment ils sont calculés.", "Where the numbers come from and how they’re calculated.")}</span></a>
      </nav>
      <p class="source">${L("Sondages compilés par Wikipédia (CC BY-SA)", "Polls compiled by Wikipedia (CC BY-SA)")}, <a href="${esc(safeUrl(polls.source))}" target="_blank" rel="noopener">${L("page source", "source page")}</a>, ${L("mis à jour le", "updated")} ${fmtDate(polls.fetchedAt)}.</p>
    </section>`;
}


