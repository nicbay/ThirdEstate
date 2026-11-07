// Past elections: official results and how far off the final polls were.
import { ELECTIONS, loadLeg24, loadPolls, presidentialResults } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { lineChart } from "../lib/chart";
import { LEG_BLOCS, NUANCE_LABEL, meta, nuanceColor, registerParties } from "../lib/candidates";
import { pollValue, trend, type Poll } from "../lib/polls";
import { esc } from "../util";
import { renderPresidential } from "./presidential";

const TABS = [
  { key: "presidentielle-2022", fr: "Présidentielle 2022", en: "2022 presidential" },
  { key: "legislatives-2024", fr: "Législatives 2024", en: "2024 legislative" },
];

export async function renderResults(app: HTMLElement, tab = "presidentielle-2022") {
  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">${L("Archives", "Archive")}</p><h1>${L("Résultats passés et précision des sondages", "Past results and poll accuracy")}</h1></div>
        <nav class="tabs">${TABS.map((t) => `<a role="tab" href="#/resultats/${t.key}" aria-selected="${t.key === tab}">${L(t.fr, t.en)}</a>`).join("")}</nav>
      </div>
      <div id="pane"></div>
    </section>`;
  const pane = app.querySelector<HTMLElement>("#pane")!;
  if (tab === "legislatives-2024") await legislatives(pane);
  else await presidential2022(pane);
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
const delta = (d: number) => `<span class="${Math.abs(d) < 1 ? "muted" : d > 0 ? "up" : "down"}">${d > 0 ? "+" : ""}${d.toFixed(1)}</span>`;

/** Final polls = each pollster's last poll in the week before election day. */
function finalPolls(polls: Poll[], electionDay: string) {
  const from = new Date(Date.parse(electionDay) - 8 * 86400000).toISOString().slice(0, 10);
  const last = new Map<string, Poll>();
  for (const p of polls) if (p.end < electionDay && p.end >= from && !last.has(p.pollster)) last.set(p.pollster, p); // polls sorted newest first
  return [...last.values()];
}

async function presidential2022(pane: HTMLElement) {
  pane.innerHTML = `<article class="card" id="map-block"></article><div id="acc"></div>`;
  const [polls, rounds] = await Promise.all([loadPolls("2022"), presidentialResults(ELECTIONS[0]), renderPresidential(pane.querySelector("#map-block")!, 2022)]);
  registerParties(polls.parties);
  const day = "2022-04-10";
  const official = new Map(rounds[0].national.candidates.map((c) => [norm(`${c.prenom}${c.nom}`), c.pct]));
  const result = (name: string) => official.get(norm(name));
  const finals = finalPolls(polls.firstRound, day);
  const names = [...new Set(finals.flatMap((p) => p.hyps.flatMap((h) => Object.keys(h))))].filter((n) => result(n) != null);
  const rows = names
    .map((n) => {
      const vals = finals.map((p) => pollValue(p, n)).filter((v): v is number => v != null);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { n, avg, res: result(n)!, d: result(n)! - avg };
    })
    .sort((a, b) => b.res - a.res);
  const pollsters = finals
    .map((p) => {
      const errs = names.map((n) => { const v = pollValue(p, n); return v == null ? null : Math.abs(v - result(n)!); }).filter((x): x is number => x != null);
      return { p, mae: errs.reduce((a, b) => a + b, 0) / errs.length };
    })
    .sort((a, b) => a.mae - b.mae);

  const pts = trend(polls.firstRound, "2022-01-01");
  const series = rows.slice(0, 8).map((r) => ({
    name: r.n,
    label: meta(r.n).surname,
    color: meta(r.n).color,
    line: pts.filter((p) => p.values[r.n] != null).map((p) => ({ date: p.date, value: p.values[r.n] })),
    final: { date: day, value: r.res, title: `${r.n} : ${L("résultat", "result")} ${r.res.toFixed(1)} %` },
  }));

  pane.querySelector("#acc")!.innerHTML = `
    <div class="grid-2">
      <article class="card">
        <header class="card-head"><h2>${L("Derniers sondages contre résultat · 1er tour", "Final polls vs result · first round")}</h2></header>
        <p class="muted small">${finals.length} ${L("instituts, dernier sondage de chacun dans la semaine précédant le 10 avril 2022.", "pollsters, each one’s last poll in the week before 10 April 2022.")}</p>
        <table class="table">
          <thead><tr><th>${L("Candidat", "Candidate")}</th><th class="num">${L("Sondages", "Polls")}</th><th class="num">${L("Résultat", "Result")}</th><th class="num">${L("Écart", "Miss")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><i class="dot" style="background:${meta(r.n).color}"></i>${esc(r.n)}</td><td class="num">${r.avg.toFixed(1)}</td><td class="num"><b>${r.res.toFixed(1)}</b></td><td class="num">${delta(r.d)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">${L("Écart = résultat − moyenne des sondages. Positif : candidat sous-estimé.", "Miss = result − polling average. Positive: candidate was underestimated.")}</p>
      </article>
      <article class="card">
        <header class="card-head"><h2>${L("Précision par institut", "Accuracy by pollster")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Dernier sondage", "Final poll")}</th><th class="num">${L("Erreur moyenne", "Mean error")}</th></tr></thead>
          <tbody>${pollsters.map(({ p, mae }) => `<tr><td>${esc(p.pollster)}</td><td class="muted">${fmtDate(p.end)}</td><td class="num">${mae.toFixed(2)} pt</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">${L("Erreur absolue moyenne sur l’ensemble des candidats.", "Mean absolute error across all candidates.")}</p>
      </article>
    </div>
    <article class="card">
      <header class="card-head"><h2>${L("Les sondages de 2022 jusqu’au vote", "2022 polls up to election day")}</h2></header>
      ${lineChart(series)}
      <p class="muted small">${L("Losanges : résultat officiel du 1er tour.", "Diamonds: official first-round result.")}</p>
    </article>
    <p class="source muted">${L("Sondages : Wikipédia (CC BY-SA)", "Polls: Wikipedia (CC BY-SA)")} · <a href="${polls.source}" target="_blank" rel="noopener">source</a> · ${L("Résultats : ministère de l’Intérieur via data.gouv.fr", "Results: Ministry of the Interior via data.gouv.fr")}</p>`;
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
  const blocRows = LEG_BLOCS.map((b) => {
    const vals = finals.map((p) => p.hyps[0][b.key]).filter((v): v is number => v != null);
    const res = blocPct(b.key)!;
    const avg = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    return { b, res, avg, nPolls: vals.length };
  }).filter((r) => r.res >= 0.1);
  const pollsters = finals
    .map((p) => {
      const errs = Object.entries(p.hyps[0]).map(([k, v]) => { const r = resultFor(k); return r == null ? null : Math.abs(v - r); }).filter((x): x is number => x != null);
      return { p, mae: errs.reduce((a, c) => a + c, 0) / errs.length };
    })
    .sort((a, b) => a.mae - b.mae);

  const main = ["NFP", "ENS", "RN and allies", "LR"];
  const pts = trend(polls.firstRound, "2024-06-01", 7);
  const series = main.map((k) => {
    const b = LEG_BLOCS.find((x) => x.key === k)!;
    return { name: k, label: getLang() === "fr" ? b.fr : b.en, color: b.color, line: pts.filter((p) => p.values[k] != null).map((p) => ({ date: p.date, value: p.values[k] })), final: { date: day, value: blocPct(k)!, title: `${b.fr} : ${blocPct(k)!.toFixed(1)} %` } };
  });
  const nuances = Object.entries(n.nuances).sort((a, b) => b[1] - a[1]);

  pane.innerHTML = `
    <div class="grid-2">
      <article class="card">
        <header class="card-head"><h2>${L("Sondages contre résultat · 1er tour, 30 juin 2024", "Polls vs result · first round, 30 June 2024")}</h2></header>
        <p class="muted small">${finals.length} ${L("instituts, dernier sondage de chacun dans la semaine précédant le vote.", "pollsters, each one’s last poll in the week before the vote.")} ${L("Participation", "Turnout")} ${((100 * n.votants) / n.inscrits).toFixed(1)} %.</p>
        <table class="table">
          <thead><tr><th>${L("Bloc", "Bloc")}</th><th class="num">${L("Sondages", "Polls")}</th><th class="num">${L("Résultat", "Result")}</th><th class="num">${L("Écart", "Miss")}</th></tr></thead>
          <tbody>${blocRows
            .map((r) => `<tr><td><i class="dot" style="background:${r.b.color}"></i>${esc(getLang() === "fr" ? r.b.fr : r.b.en)}</td><td class="num">${r.avg != null ? r.avg.toFixed(1) : "–"}</td><td class="num"><b>${r.res.toFixed(1)}</b></td><td class="num">${r.avg != null ? delta(r.res - r.avg) : "–"}</td></tr>`)
            .join("")}</tbody>
        </table>
        <p class="muted small">${L("Les blocs regroupent les nuances officielles du ministère (ex. « RN et alliés » = RN + UXD). Certains instituts publient des blocs fusionnés ; ils comptent dans la précision par institut mais pas dans cette moyenne.", "Blocs group the Ministry’s official labels (e.g. “RN and allies” = RN + UXD). Some pollsters publish merged blocs; those count toward pollster accuracy but not this average.")}</p>
      </article>
      <article class="card">
        <header class="card-head"><h2>${L("Précision par institut", "Accuracy by pollster")}</h2></header>
        <table class="table">
          <thead><tr><th>${L("Institut", "Pollster")}</th><th>${L("Dernier sondage", "Final poll")}</th><th class="num">${L("Erreur moyenne", "Mean error")}</th></tr></thead>
          <tbody>${pollsters.map(({ p, mae }) => `<tr><td>${esc(p.pollster)}</td><td class="muted">${fmtDate(p.end)}</td><td class="num">${mae.toFixed(2)} pt</td></tr>`).join("")}</tbody>
        </table>
      </article>
    </div>
    <article class="card">
      <header class="card-head"><h2>${L("Les sondages de la campagne éclair", "Polls during the snap campaign")}</h2></header>
      ${lineChart(series, { height: 320 })}
      <p class="muted small">${L("Moyenne mobile sur 7 jours. Losanges : résultat officiel.", "7-day rolling average. Diamonds: official result.")}</p>
    </article>
    <article class="card">
      <header class="card-head"><h2>${L("Résultat national par nuance · 1er tour", "National result by label · first round")}</h2><a href="#/assemblee">${L("Voir par circonscription", "See by district")} →</a></header>
      <ol class="bars compact">${nuances
        .map(([code, v]) => `<li><div class="bar-label"><span><i class="dot" style="background:${nuanceColor(code)}"></i>${esc(NUANCE_LABEL[code] ?? code)} <span class="muted">${code}</span></span><span><b>${((100 * v) / n.exprimes).toFixed(2)} %</b> <span class="muted small">${fmtNum(v)}</span></span></div><div class="bar"><div style="width:${(100 * v) / n.exprimes / 0.35}%;background:${nuanceColor(code)}"></div></div></li>`)
        .join("")}</ol>
    </article>
    <p class="source muted">${L("Résultats : ministère de l’Intérieur via l’API data.gouv.fr", "Results: Ministry of the Interior via the data.gouv.fr API")} · <a href="${leg.source}" target="_blank" rel="noopener">${L("jeu de données", "dataset")}</a> · ${L("Sondages : Wikipédia (CC BY-SA)", "Polls: Wikipedia (CC BY-SA)")} · <a href="${polls.source}" target="_blank" rel="noopener">source</a></p>`;
}
