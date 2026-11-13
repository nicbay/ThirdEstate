// Past elections: official results and how far off the final polls were.
import { ELECTIONS, loadLeg24, loadPolls, presidentialResults } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { lineChart } from "../lib/chart";
import { LEG_BLOCS, NUANCE_LABEL, meta, nuanceColor, registerParties } from "../lib/candidates";
import { average, pollValue, pollsInWindow, pollsterName, trend, type Poll } from "../lib/polls";
import { colon, dec, pct, signed } from "../lib/format";
import { esc, safeUrl } from "../util";
import { renderPresidential } from "./presidential";
import { renderHistoryList } from "./history";
import { renderShifts } from "./shifts";

const TABS = [
  { key: "presidentielles", fr: "Présidentielles depuis 1848", en: "Presidential elections since 1848" },
  { key: "bascules", fr: "Bascules gauche-droite", en: "Left–right shifts" },
  { key: "presidentielle-2022", fr: "2022 : sondages et résultat", en: "2022: polls vs result" },
  { key: "legislatives-2024", fr: "Législatives 2024", en: "2024 legislative" },
];

export async function renderResults(app: HTMLElement, tab = "presidentielles") {
  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">${L("Résultats passés", "Past results")}</p><h1>${L("Ce que les électeurs ont voté, et à quel point les sondages s’étaient trompés", "How France voted, and how far off the polls were")}</h1>
          <p class="dek">${L("Résultats officiels du ministère de l’Intérieur, comparés au dernier sondage de chaque institut avant le vote.", "Official Ministry of the Interior results, compared with each pollster’s last poll before the vote.")}</p></div>
        <nav class="tabs">${TABS.map((t) => `<a role="tab" href="#/resultats${t.key === "presidentielles" ? "" : `/${t.key}`}" aria-selected="${t.key === tab}">${L(t.fr, t.en)}</a>`).join("")}</nav>
      </div>
      <div id="pane"></div>
    </section>`;
  const pane = app.querySelector<HTMLElement>("#pane")!;
  if (tab === "legislatives-2024") await legislatives(pane);
  else if (tab === "presidentielle-2022") await presidential2022(pane);
  else if (tab === "bascules") await renderShifts(pane);
  else await renderHistoryList(pane);
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
const delta = (d: number) => `<span class="${Math.abs(d) < 1 ? "muted" : d > 0 ? "up" : "down"}">${signed(d)}</span>`;

/** The final-polls window: the 7 days before election day (fieldwork ending on day −7 … eve), each
 *  firm counted once with its latest poll (partner names merged: "Ipsos-Sopra Steria" = "Ipsos").
 *  The table, the pollster ranking and the chart's last point all use it, so they agree. */
const FINAL = { days: 7, onePerPollster: true } as const;
const eve = (electionDay: string) => new Date(Date.parse(electionDay) - 86400000).toISOString().slice(0, 10);
const shift = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
const finalPolls = (polls: Poll[], electionDay: string) => pollsInWindow(polls, eve(electionDay), FINAL.days, FINAL.onePerPollster);

async function presidential2022(pane: HTMLElement) {
  pane.innerHTML = `<article class="card" id="map-block"></article><div id="acc"></div>`;
  const [polls, rounds] = await Promise.all([loadPolls("2022"), presidentialResults(ELECTIONS[0]), renderPresidential(pane.querySelector("#map-block")!, 2022)]);
  registerParties(polls.parties);
  const day = "2022-04-10";
  const official = new Map(rounds[0].national.candidates.map((c) => [norm(`${c.prenom}${c.nom}`), c.pct]));
  const result = (name: string) => official.get(norm(name));
  const finals = finalPolls(polls.firstRound, day);
  const finalAvg = average(polls.firstRound, eve(day), FINAL.days, 0, FINAL.onePerPollster);
  const names = finalAvg.map((r) => r.name).filter((n) => result(n) != null);
  const rows = finalAvg
    .filter((r) => result(r.name) != null)
    .map((r) => ({ n: r.name, avg: r.avg, res: result(r.name)!, d: result(r.name)! - r.avg }))
    .sort((a, b) => b.res - a.res);
  const pollsters = finals
    .map((p) => {
      const errs = names.map((n) => { const v = pollValue(p, n); return v == null ? null : Math.abs(v - result(n)!); }).filter((x): x is number => x != null);
      return { p, mae: errs.reduce((a, b) => a + b, 0) / errs.length };
    })
    .sort((a, b) => a.mae - b.mae);

  // same window as the table, sampled weekly up to the eve: the line's end label is the table's "Polls" figure
  const pts = trend(polls.firstRound, "2022-01-01", { ...FINAL, minShare: 0, to: eve(day) });
  const series = rows.slice(0, 8).map((r) => ({
    name: r.n,
    label: meta(r.n).surname,
    color: meta(r.n).color,
    line: pts.filter((p) => p.values[r.n] != null).map((p) => ({ date: p.date, value: p.values[r.n] })),
    final: { date: day, value: r.res, title: `${r.n}${colon()}${L("résultat", "result")} ${pct(r.res)}` },
  }));

  pane.querySelector("#acc")!.innerHTML = `
    <div class="grid-2">
      <article class="card">
        <header class="card-head"><h2>${L("Derniers sondages contre résultat · 1er tour", "Final polls vs result · first round")}</h2></header>
        <p class="muted small">${finals.length} ${L(`instituts, dernier sondage de chacun dont le terrain s’achève entre le ${fmtDate(shift(day, -7))} et le ${fmtDate(eve(day))} (premier tour le 10 avril 2022).`, `pollsters, each one’s last poll with fieldwork ending ${fmtDate(shift(day, -7))} to ${fmtDate(eve(day))} (first round on 10 April 2022).`)}</p>
        <table class="table">
          <thead><tr><th>${L("Candidat", "Candidate")}</th><th class="num">${L("Sondages", "Polls")}</th><th class="num">${L("Résultat", "Result")}</th><th class="num">${L("Écart", "Miss")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><i class="dot" style="background:${meta(r.n).color}"></i>${esc(r.n)}</td><td class="num">${dec(r.avg)}</td><td class="num"><b>${dec(r.res)}</b></td><td class="num">${delta(r.d)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">${L("Écart = résultat − moyenne des sondages. Positif : candidat sous-estimé.", "Miss = result − polling average. Positive: candidate was underestimated.")}</p>
      </article>
      <article class="card">
        <header class="card-head"><h2>${L("Précision par institut", "Accuracy by pollster")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Dernier sondage", "Final poll")}</th><th class="num">${L("Erreur moyenne", "Mean error")}</th></tr></thead>
          <tbody>${pollsters.map(({ p, mae }) => `<tr><td>${esc(pollsterName(p.pollster))}${pollsterName(p.pollster) !== p.pollster ? ` <span class="muted small">(${esc(p.pollster)})</span>` : ""}</td><td class="muted">${fmtDate(p.end)}</td><td class="num">${dec(mae, 2)}${L(" pt", " pt")}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">${L("Erreur absolue moyenne sur l’ensemble des candidats.", "Mean absolute error across all candidates.")}</p>
      </article>
    </div>
    <article class="card">
      <header class="card-head"><h2>${L("Les sondages de 2022 jusqu’au vote", "2022 polls up to election day")}</h2></header>
      ${lineChart(series)}
      <p class="muted small">${L("Losanges : résultat officiel du 1er tour.", "Diamonds: official first-round result.")}</p>
    </article>
    <p class="source muted">${L("Sondages : Wikipédia (CC BY-SA)", "Polls: Wikipedia (CC BY-SA)")} · <a href="${esc(safeUrl(polls.source))}" target="_blank" rel="noopener">source</a> · ${L("Résultats : ministère de l’Intérieur via data.gouv.fr", "Results: Ministry of the Interior via data.gouv.fr")}</p>`;
}

async function legislatives(pane: HTMLElement) {
  const [leg, polls] = await Promise.all([loadLeg24(), loadPolls("legislatives-2024")]);
  const n = leg.national;
  const day = "2024-06-30";
  const blocPct = (key: string) => {
    const b = LEG_BLOCS.find((x) => x.key === key);
    return b ? (100 * b.nuances.reduce((s, c) => s + (n.nuances[c] ?? 0), 0)) / n.exprimes : null;
  };
  // a poll key may combine blocs: "ENS + DVC"
  const resultFor = (key: string) => {
    const parts = key.split(" + ").map(blocPct);
    return parts.every((p) => p != null) ? parts.reduce((a, b) => a! + b!, 0)! : null;
  };
  const finals = finalPolls(polls.firstRound, day);
  const finalAvg = new Map(average(polls.firstRound, eve(day), FINAL.days, 0, FINAL.onePerPollster).map((r) => [r.name, r]));
  const blocRows = LEG_BLOCS.map((b) => {
    const res = blocPct(b.key)!;
    const a = finalAvg.get(b.key);
    return { b, res, avg: a?.avg ?? null, nPolls: a?.n ?? 0 };
  }).filter((r) => r.res >= 0.1);
  const pollsters = finals
    .map((p) => {
      const errs = Object.entries(p.hyps[0]).map(([k, v]) => { const r = resultFor(k); return r == null ? null : Math.abs(v - r); }).filter((x): x is number => x != null);
      return { p, mae: errs.reduce((a, c) => a + c, 0) / errs.length };
    })
    .sort((a, b) => a.mae - b.mae);

  const main = ["NFP", "ENS", "RN and allies", "LR"];
  const pts = trend(polls.firstRound, "2024-06-01", { ...FINAL, minShare: 0, to: eve(day) });
  const series = main.map((k) => {
    const b = LEG_BLOCS.find((x) => x.key === k)!;
    const label = getLang() === "fr" ? b.fr : b.en;
    return { name: k, label, color: b.color, line: pts.filter((p) => p.values[k] != null).map((p) => ({ date: p.date, value: p.values[k] })), final: { date: day, value: blocPct(k)!, title: `${label}${colon()}${pct(blocPct(k))}` } };
  });
  const nuances = Object.entries(n.nuances).sort((a, b) => b[1] - a[1]);

  pane.innerHTML = `
    <div class="grid-2">
      <article class="card">
        <header class="card-head"><h2>${L("Sondages contre résultat · 1er tour, 30 juin 2024", "Polls vs result · first round, 30 June 2024")}</h2></header>
        <p class="muted small">${finals.length} ${L(`instituts, dernier sondage de chacun dont le terrain s’achève entre le ${fmtDate(shift(day, -7))} et le ${fmtDate(eve(day))}.`, `pollsters, each one’s last poll with fieldwork ending ${fmtDate(shift(day, -7))} to ${fmtDate(eve(day))}.`)} ${L("Participation", "Turnout")} ${pct((100 * n.votants) / n.inscrits)}.</p>
        <table class="table">
          <thead><tr><th>${L("Bloc", "Bloc")}</th><th class="num">${L("Sondages", "Polls")}</th><th class="num">${L("Résultat", "Result")}</th><th class="num">${L("Écart", "Miss")}</th></tr></thead>
          <tbody>${blocRows
            .map((r) => `<tr><td><i class="dot" style="background:${r.b.color}"></i>${esc(getLang() === "fr" ? r.b.fr : r.b.en)}</td><td class="num">${dec(r.avg)}</td><td class="num"><b>${dec(r.res)}</b></td><td class="num">${r.avg != null ? delta(r.res - r.avg) : "–"}</td></tr>`)
            .join("")}</tbody>
        </table>
        <p class="muted small">${L("Les blocs regroupent les nuances officielles du ministère (ex. « RN et alliés » = RN + UXD). Certains instituts publient des blocs fusionnés ; ils comptent dans la précision par institut mais pas dans cette moyenne.", "Blocs group the Ministry’s official labels (e.g. “RN and allies” = RN + UXD). Some pollsters publish merged blocs; those count toward pollster accuracy but not this average.")}</p>
      </article>
      <article class="card">
        <header class="card-head"><h2>${L("Précision par institut", "Accuracy by pollster")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Dernier sondage", "Final poll")}</th><th class="num">${L("Erreur moyenne", "Mean error")}</th></tr></thead>
          <tbody>${pollsters.map(({ p, mae }) => `<tr><td>${esc(pollsterName(p.pollster))}</td><td class="muted">${fmtDate(p.end)}</td><td class="num">${dec(mae, 2)}${L(" pt", " pt")}</td></tr>`).join("")}</tbody>
        </table>
      </article>
    </div>
    <article class="card">
      <header class="card-head"><h2>${L("Les sondages de la campagne éclair", "Polls during the snap campaign")}</h2></header>
      ${lineChart(series, { height: 320 })}
      <p class="muted small">${L("Moyenne mobile sur 7 jours, chaque institut compté une fois (son dernier sondage). Losanges : résultat officiel.", "7-day rolling average, each pollster counted once (its latest poll). Diamonds: official result.")}</p>
    </article>
    <article class="card">
      <header class="card-head"><h2>${L("Résultat national par nuance · 1er tour", "National result by label · first round")}</h2><a href="#/assemblee">${L("Voir par circonscription", "See by district")}</a></header>
      <ol class="bars compact">${nuances
        .map(([code, v]) => `<li><div class="bar-label"><span><i class="dot" style="background:${nuanceColor(code)}"></i>${esc(NUANCE_LABEL[code] ?? code)} <span class="muted">${code}</span></span><span><b>${pct((100 * v) / n.exprimes, 2)}</b> <span class="muted small">${fmtNum(v)}</span></span></div><div class="bar"><div style="width:${(100 * v) / n.exprimes / 0.35}%;background:${nuanceColor(code)}"></div></div></li>`)
        .join("")}</ol>
    </article>
    <p class="source muted">${L("Résultats : ministère de l’Intérieur via l’API data.gouv.fr", "Results: Ministry of the Interior via the data.gouv.fr API")} · <a href="${esc(safeUrl(leg.source))}" target="_blank" rel="noopener">${L("jeu de données", "dataset")}</a> · ${L("Sondages : Wikipédia (CC BY-SA)", "Polls: Wikipedia (CC BY-SA)")} · <a href="${esc(safeUrl(polls.source))}" target="_blank" rel="noopener">source</a></p>`;
}
