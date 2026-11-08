// 2027 front page: the state of the race in one headline and one strip, then the detail.
import { loadMarkets, loadPolls } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { average, duelAverages, pollValue, pollsInWindow } from "../lib/polls";
import { combineOdds, platformShare, winShare } from "../lib/markets";
import { dec, pair100, pct, signed } from "../lib/format";
import { esc, safeUrl, safeColor } from "../util";
import { shiftDays } from "./home";
import { ELECTION_DAY, MARKET_WEIGHT, forecast, type Forecast } from "../lib/forecast";
import { oddsSentence } from "../lib/scenario-odds";
import { lineChart } from "../lib/chart";
import { fetchJson } from "../data";

export async function renderRace(app: HTMLElement) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const now = average(polls.firstRound, latest);
  // 30 days earlier, same average; minShare 0 so a candidate tested then is never missing a comparison point
  const before = new Map(average(polls.firstRound, shiftDays(latest, -30), undefined, 0).map((r) => [r.name, r.avg]));
  const top = now.slice(0, 10);
  const max = Math.max(...top.map((r) => r.avg), 1);
  const duels = duelAverages(polls.secondRound).filter((d) => !d.stale).slice(0, 5);
  // the market card shows the same blended figure as the forecast: both platforms, volume-weighted, rescaled to 100
  const odds = combineOdds(markets?.markets ?? []).filter((o) => o.win);
  const platforms = [...new Set((markets?.markets ?? []).filter((m) => /^KXFRENCHPRES-/.test(m.id) || /^next french presidential election$/i.test(m.question.trim())).map((m) => m.platform))];
  const strip = now.filter((r) => r.avg >= 0.5).sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
  const sum = strip.reduce((s, r) => s + r.avg, 0) || 1;
  const leader = now[0];
  const nPolls = pollsInWindow(polls.firstRound, latest).length;

  const fr = getLang() === "fr";
  const fc = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], new Date().toISOString().slice(0, 10));
  const fav = fc.rows[0];
  const fem = (n: string) => /^(Marine|Christine|Ségolène|Marion|Nathalie|Valérie|Clémentine|Sandrine|Yaël|Élisabeth|Marie|Anne)\b/.test(n);
  const headline = fav
    ? getLang() === "fr"
      ? `${fav.name} ${fem(fav.name) ? "favorite" : "favori"}, ${pct(fav.win, 0)} de chances d’être ${fem(fav.name) ? "élue" : "élu"}`
      : `${fav.name} is the favourite, with a ${pct(fav.win, 0)} chance of winning`
    : leader
      ? L(`${leader.name} en tête des intentions de vote`, `${leader.name} leads first-round polling`)
      : L("Où en est la course", "Where the race stands");

  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027", "2027 presidential election")}</p>
        <h1>${esc(headline)}</h1>
        <p class="dek">${L(
          `Notre prévision mêle deux lectures indépendantes : ${nPolls} sondages récents, passés dans 20 000 simulations des deux tours, et ce que parient les marchés prédictifs (Kalshi, Polymarket). À ${fc.daysToGo} jours du premier tour.`,
          `Our forecast blends two independent reads: ${nPolls} recent polls, run through 20,000 simulations of both rounds, and what prediction markets are betting (Kalshi, Polymarket). ${fc.daysToGo} days to the first round.`,
        )}</p>
      </header>

      ${forecastCard(fc)}

      <h2 class="sec-k">${L("Les sondages aujourd’hui, de gauche à droite", "The polls today, left to right")}</h2>
      <figure class="spectrum" style="margin:0" aria-label="${L("Intentions de vote, de gauche à droite", "Voting intention, left to right")}">
        <div class="spectrum-bar">${strip.map((r) => `<span style="flex:${r.avg};background:${meta(r.name).color}" data-tip="${esc(`${r.name}${meta(r.name).party ? ` (${meta(r.name).party})` : ""}\n${pct(r.avg)}`)}"></span>`).join("")}</div>
        <div class="spectrum-labels">${strip.map((r) => `<span style="flex:${r.avg}">${(100 * r.avg) / sum >= 6 ? `<b>${pct(r.avg)}</b>${esc(meta(r.name).surname)}` : ""}</span>`).join("")}</div>
        <div class="spectrum-axis"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
      </figure>


      <div class="grid-2">
        <section class="card">
          <header class="card-head"><h2>${L("Tous les candidats testés", "Every candidate polled")}</h2><a href="#/sondages">${L("Évolution", "Trend")}</a></header>
          <p class="muted small">${L("Moyenne de chaque candidat dans les sondages où il figure, et son évolution sur 30 jours. Ils ne sont pas tous testés ensemble, le total dépasse donc 100 %.", "Each candidate’s average in the polls that include them, and the 30-day change. They aren’t all tested together, so the total exceeds 100%.")}</p>
          <ol class="bars">
            ${top
              .map((r) => {
                const m = meta(r.name);
                const prev = before.get(r.name);
                // the change is always shown when there is a figure 30 days back (a stable average reads "0,0")
                const delta = prev != null ? Math.round(10 * r.avg) / 10 - Math.round(10 * prev) / 10 : null;
                return `<li>
                  <div class="bar-label"><span>${esc(r.name)} <span class="muted">${esc(m.party ?? "")}</span></span>
                  <span>${delta != null ? `<span class="${Math.abs(delta) < 0.05 ? "muted" : delta > 0 ? "up" : "down"}" title="${L("sur 30 jours", "over 30 days")}">${signed(delta)}</span> ` : `<span class="muted small">${L("nouveau", "new")}</span> `}<b>${pct(r.avg)}</b></span></div>
                  <div class="bar"><div style="width:${(100 * r.avg) / max}%;background:${m.color}"></div></div>
                </li>`;
              })
              .join("")}
          </ol>
        </section>

        <section class="card">
          <header class="card-head"><h2>${L("Ce que parient les marchés", "What the betting markets say")}</h2><a href="#/sondages#marches">${L("Tous les marchés", "All markets")}</a></header>
          ${
            odds.length
              ? `<p class="muted small">${fr
                  ? `Probabilité de victoire implicite, moyenne ${platforms.length > 1 ? `de ${platforms.map(esc).join(" et ")} pondérée par les montants échangés` : `de ${platforms.map(esc).join("")}`}, ramenée à 100 % (le chiffre « Marchés » de la prévision), ${fmtDate(markets!.fetchedAt)}.`
                  : `Implied chance of winning, ${platforms.length > 1 ? `${platforms.map(esc).join(" and ")} averaged by traded volume` : platforms.map(esc).join("")}, rescaled to 100% (the forecast’s “Markets” figure), ${fmtDate(markets!.fetchedAt)}.`}</p>
                 <ol class="bars">${odds
                   .slice(0, 7)
                   .map((o) => {
                     const v = winShare(odds, o) ?? 0;
                     const detail = (["kalshi", "polymarket"] as const).map((pl) => { const x = platformShare(odds, o, pl); return x == null ? "" : `${pl === "kalshi" ? "Kalshi" : "Polymarket"} ${pct(x, 0)}`; }).filter(Boolean).join(" · ");
                     return `<li><div class="bar-label"><span>${esc(o.name)}${detail ? ` <span class="muted small">${detail}</span>` : ""}</span><b>${pct(v, 0)}</b></div><div class="bar"><div style="width:${v}%;background:${meta(o.name).color}"></div></div></li>`;
                   })
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
              .map((d) => { const [rw, rl] = pair100(d.pw, d.pl); return `<tr><td><i class="dot" style="background:${meta(d.winner).color}"></i><b>${esc(meta(d.winner).surname)} ${rw}</b> – ${rl} ${esc(meta(d.loser).surname)}</td><td class="num">+${rw - rl}</td><td class="num muted">${d.total}</td></tr>`; })
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
                return `<tr><td>${esc(p.pollster)}</td><td class="muted">${fmtDate(p.end)}</td><td>${top3.map(([n, v]) => `${esc(meta(n).surname)} ${dec(v, 0)}`).join(", ")}</td></tr>`;
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
  drawForecastTrend(app);
  // the "Method" link (and #/2027#methode links) open the method box
  const md = app.querySelector<HTMLDetailsElement>("#methode");
  app.querySelectorAll('a[href="#/2027#methode"]').forEach((x) => x.addEventListener("click", () => md && (md.open = true)));
  if (md && location.hash.endsWith("#methode")) md.open = true;
}



/** The forecast: one chance per candidate, with the two sources it blends shown underneath. */
function forecastCard(fc: Forecast) {
  const fr = getLang() === "fr";
  const shown = fc.rows.filter((r) => r.win >= 0.5).slice(0, 9);
  const rest = fc.rows.length - shown.length;
  const max = Math.max(...shown.map((r) => r.win), 1);
  const fmt = (v: number) => (v < 1 ? "<1" : v > 99 ? ">99" : Math.round(v).toString());
  const fmtP = (v: number) => `${fmt(v)}${L(" %", "%")}`;
  const fav = fc.rows[0];
  const pair = fc.pairs[0];
  const sur = (n: string) => meta(n).surname;
  // e.g. "Les 34 % de Bardella : autant de chances que de recevoir au moins un as dans une main de cinq cartes."
  const odd = fav ? esc(oddsSentence(fav.win / 100, fr)).replace(/^./, (c) => c.toLowerCase()) : "";
  const pairWinner = pair ? (pair.aWins >= 50 ? pair.a : pair.b) : "";
  const pairPct = pair ? fmt(Math.max(pair.aWins, 100 - pair.aWins)) : "";
  const added = fc.added.map(esc).join(", ");
  return `<section class="card forecast" id="prevision">
    <header class="card-head"><h2>${L("Qui sera élu en 2027 ?", "Who will win in 2027?")}</h2><a href="#/2027#methode">${L("Méthode", "Method")}</a></header>
    <div class="fc-grid">
      <ol class="fc-rows">${shown
        .map((r) => {
          const c = meta(r.name).color;
          const party = meta(r.name).party;
          return `<li>
            <div class="fc-name"><i class="dot" style="background:${c}"></i><b>${esc(r.name)}</b>${party ? ` <span class="muted small">${esc(party)}</span>` : ""}</div>
            <div class="fc-pct"><strong>${fmt(r.win)}</strong><span>%</span></div>
            <div class="fc-bar"><div style="width:${(100 * r.win) / max}%;background:${c}"></div></div>
            <div class="fc-src small muted">${L("Sondages", "Polls")} <b>${r.polls ? `${fmtP(r.polls.win)}` : L("non testé", "not polled")}</b> · ${L("Marchés", "Markets")} <b>${r.markets?.win != null ? `${fmtP(r.markets.win)}` : "–"}</b>${r.qualify != null ? ` · ${L("au second tour", "reaches runoff")} <b>${fmtP(r.qualify)}</b>` : ""}</div>
          </li>`;
        })
        .join("")}</ol>
      <aside class="fc-side">
        ${fav && odd ? `<p class="fc-odd">${fr ? `Les ${Math.round(fav.win)} % de ${esc(sur(fav.name))} : ${odd}` : `${esc(sur(fav.name))}’s ${Math.round(fav.win)}%: ${odd}`}</p>` : ""}
        ${pair ? `<p class="mine-k">${L("Le second tour le plus probable", "The most likely runoff")}</p><p class="fc-pair"><b>${esc(sur(pair.a))} – ${esc(sur(pair.b))}</b><br><span class="muted small">${fr ? `${Math.round(pair.p)} % des simulations ; ${esc(sur(pairWinner))} l’emporte dans ${pairPct} % d’entre elles.` : `${Math.round(pair.p)}% of simulations; ${esc(sur(pairWinner))} wins ${pairPct}% of them.`}</span></p>` : ""}
        <p class="mine-k">${L("Pourquoi deux sources", "Why two sources")}</p>
        <p class="small">${L("Les sondages disent comment les Français voteraient aujourd’hui si ces candidats se présentaient. Les marchés ajoutent ce que les sondages ne voient pas : qui se présentera vraiment, les procès, les retraits. Quand les deux divergent, c’est une information.", "Polls say how people would vote today if these candidates ran. Markets add what polls can’t see: who will actually stand, trials, withdrawals. When the two disagree, that is information.")}</p>
        <a class="button" href="#/simulateur">${L("Faire votre propre scénario", "Build your own scenario")}</a>
      </aside>
    </div>
    ${rest > 0 ? `<p class="muted tiny">${L(`${rest} autres noms sous 0,5 % de chances.`, `${rest} other names below a 0.5% chance.`)}</p>` : ""}
    <div class="fc-trend" id="fc-trend" hidden>
      <div class="fc-trend-head"><h3>${L("La prévision, jour après jour", "The forecast, day by day")}</h3>
        <div class="small-tabs" role="group" aria-label="${L("Série", "Series")}"><button type="button" data-fcs="win" aria-pressed="true">${L("Prévision", "Forecast")}</button><button type="button" data-fcs="polls" aria-pressed="false">${L("Sondages seuls", "Polls only")}</button><button type="button" data-fcs="markets" aria-pressed="false">${L("Marchés seuls", "Markets only")}</button></div></div>
      <div id="fc-chart"></div>
      <p class="muted tiny" id="fc-trend-note"></p>
    </div>
    <details class="fc-method" id="methode">
      <summary>${L("Comment la prévision est calculée", "How the forecast works")}</summary>
      <ol class="small">
        <li>${fr
          ? `<b>Sondages.</b> Point de départ : la moyenne des sondages pour la liste de candidats la plus testée (${fc.nLineupPolls} sondages ces trois dernières semaines)${added ? `, plus ${added}, que les marchés jugent crédible${fc.added.length > 1 ? "s" : ""}, à sa moyenne dans les sondages où il figure ; ses points sont pris aux candidats les plus proches politiquement` : ""}.`
          : `<b>Polls.</b> Starting point: the polling average for the most-tested line-up (${fc.nLineupPolls} polls over the last three weeks)${added ? `, plus ${added}, whom the markets rate as credible, at their average in the polls that test them, with the points taken from the politically closest candidates` : ""}.`}</li>
        <li>${fr
          ? `<b>20 000 simulations.</b> À chaque tirage, chaque candidat reçoit une erreur de sondage aléatoire : une part commune à sa famille politique (σ = 1,5 point) et une part propre (σ = ${dec(fc.sd1)} points à ${fc.daysToGo} jours ; elle se resserre jusqu’à 2 points la veille). Les deux premiers vont au second tour.`
          : `<b>20,000 simulations.</b> In each draw every candidate gets a random polling error: a part shared with their political family (σ = 1.5 pts) and their own part (σ = ${dec(fc.sd1)} pts at ${fc.daysToGo} days out, narrowing to 2 pts on the eve). The top two go to the runoff.`}</li>
        <li>${fr
          ? `<b>Second tour.</b> Le score attendu vient des sondages de second tour pour ce duel s’ils existent, sinon d’un modèle de reports de voix selon la proximité politique (le même que le simulateur). On y ajoute une erreur (σ = ${dec(fc.sd2)} points aujourd’hui) : les duels sondés avant le premier tour se trompent souvent de beaucoup.`
          : `<b>Runoff.</b> The expected score comes from runoff polls for that pairing when they exist, otherwise from a vote-transfer model based on political proximity (the same as the simulator). An error is added (σ = ${dec(fc.sd2)} pts today): runoff polls taken before the first round often miss by a lot.`}</li>
        <li>${L(
          "<b>Marchés.</b> Les cotes « vainqueur » de Kalshi et Polymarket, ramenées à 100 % pour retirer la marge des plateformes, puis moyennées en pondérant par les montants échangés.",
          "<b>Markets.</b> Kalshi and Polymarket “winner” prices, rescaled to 100% to remove the platforms’ margin, then averaged weighted by traded volume.",
        )}</li>
        <li>${fr
          ? `<b>Mélange.</b> ${Math.round(100 * (1 - MARKET_WEIGHT))} % sondages, ${Math.round(100 * MARKET_WEIGHT)} % marchés. Un nom que seuls les marchés couvrent (non testé par les instituts) ne garde que la moitié « marchés ». Premier tour supposé le ${fmtDate(ELECTION_DAY)} (date à fixer par décret, entre mi et fin avril).`
          : `<b>Blend.</b> ${Math.round(100 * (1 - MARKET_WEIGHT))}% polls, ${Math.round(100 * MARKET_WEIGHT)}% markets. A name only the markets cover (not tested by pollsters) keeps only the markets half. First round assumed on ${fmtDate(ELECTION_DAY)} (the date is set by decree, mid to late April).`}</li>
      </ol>
      <p class="small muted">${L("Les tailles d’erreur sont un jugement, pas une estimation tirée des présidentielles passées (trop peu nombreuses pour être ajustées). Ce n’est pas une prédiction certaine : un candidat à 70 % perd trois fois sur dix. Information, pas incitation à parier.", "Error sizes are a judgement, not estimated from past presidential elections (too few to fit). This isn’t a certainty: a candidate at 70% loses three times in ten. Information, not an invitation to bet.")}</p>
    </details>
  </section>`;
}

interface FcDay { date: string; live: boolean; sources: string[]; rows: { name: string; win: number; polls: number | null; markets: number | null }[] }
/** The forecast over time (public/data/forecast/history.json, written daily by scripts/forecast-history.ts). */
async function drawForecastTrend(app: HTMLElement) {
  const h = await fetchJson<{ days: FcDay[] }>("/data/forecast/history.json").catch(() => null);
  const box = app.querySelector<HTMLElement>("#fc-trend");
  if (!h || !box || h.days.length < 2) return;
  box.hidden = false;
  const last = h.days.at(-1)!;
  const names = last.rows.slice(0, 6).map((r) => r.name);
  const draw = (key: "win" | "polls" | "markets") => {
    app.querySelector("#fc-chart")!.innerHTML = lineChart(
      names.map((n) => ({
        name: n, label: meta(n).surname, color: meta(n).color,
        // missing from a day's top rows = under 0.5 % (0); no poll or market figure = a gap
        line: h.days.flatMap((d) => { const r = d.rows.find((x) => x.name === n); const v = r ? r[key] : key === "win" ? 0 : null; return v == null ? [] : [{ date: d.date, value: v }]; }),
      })),
      { height: 300, yMax: 100 },
    );
    box.querySelectorAll<HTMLButtonElement>("[data-fcs]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fcs === key)));
  };
  box.querySelectorAll<HTMLButtonElement>("[data-fcs]").forEach((b) => b.addEventListener("click", () => draw(b.dataset.fcs as "win" | "polls" | "markets")));
  draw("win");
  const firstLive = h.days.find((d) => d.live)?.date;
  const back = h.days.filter((d) => !d.live);
  const kalshiOnly = back.filter((d) => !d.sources.includes("Polymarket")).length;
  app.querySelector("#fc-trend-note")!.textContent = [
    L(`Chance de victoire, en %, chaque jour depuis le ${fmtDate(h.days[0].date)}.`, `Chance of winning, %, every day since ${fmtDate(h.days[0].date)}.`),
    back.length && firstLive ? L(`Avant le ${fmtDate(firstLive)}, la prévision est reconstituée : le même modèle rejoué jour par jour avec les sondages connus ce jour-là et le cours de clôture des marchés${kalshiOnly ? ` (Kalshi seul ${kalshiOnly > 1 ? `${kalshiOnly} jours` : "un jour"}, faute de cours Polymarket)` : ""}.`, `Before ${fmtDate(firstLive)} the forecast is reconstructed: the same model replayed day by day with the polls known that day and each market's closing price${kalshiOnly ? ` (Kalshi only on ${kalshiOnly > 1 ? `${kalshiOnly} days` : "one day"} with no Polymarket price)` : ""}.`) : "",
    L("Ensuite, enregistrée chaque jour.", "From then on, recorded daily."),
  ].filter(Boolean).join(" ");
}
