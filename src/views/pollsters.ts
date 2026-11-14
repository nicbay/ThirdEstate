// Polling institutes, graded A+ to F on how close their final polls came to the result, election after election.
// Data: public/data/polls/pollsters.json (scripts/sync-pollster-ratings.mjs, see docs/data-pollsters.md). The same
// grades weight the polling average everywhere on the site (lib/polls.ts).
import "../styles/pollsters.css";
import { loadPolls } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { HOUSE_DAYS, RATINGS, UNRATED_WEIGHT, houseEffects, latestPollDate, pollValue, pollWeight, pollsterAnchor, pollsterName, pollsterRating, type Grade, type Poll, type PollsterRating } from "../lib/polls";
import { meta, registerParties } from "../lib/candidates";
import { dec, signed } from "../lib/format";
import { esc, safeUrl } from "../util";

const gradeClass = (g: Grade | null) => (g == null ? "g-none" : `g-${g[0].toLowerCase()}`);
const badge = (g: Grade | null) => `<span class="pg-badge ${gradeClass(g)}">${g ?? "—"}</span>`;

export async function renderPollsters(app: HTMLElement) {
  const polls = await loadPolls("2027").catch(() => null);
  const fr = getLang() === "fr";
  const R = RATINGS;
  const elections = new Map(R.elections.map((e) => [e.id, e]));
  // how many 2027 polls each institute has published, and their weight in today's average
  const n2027 = new Map<string, number>();
  for (const p of polls?.firstRound ?? []) { const k = pollsterRating(p.pollster)?.name ?? pollsterName(p.pollster); n2027.set(k, (n2027.get(k) ?? 0) + 1); }
  // each institute's 2027 polls, latest first
  const byFirm = new Map<string, Poll[]>();
  for (const p of polls?.firstRound ?? []) { const k = pollsterRating(p.pollster)?.name ?? pollsterName(p.pollster); byFirm.set(k, [...(byFirm.get(k) ?? []), p]); }
  for (const xs of byFirm.values()) xs.sort((a, b) => b.end.localeCompare(a.end));
  /** "Le Pen 33 · Mélenchon 18 · Philippe 12" for one poll */
  const top = (p: Poll, n = 3) => {
    const names = [...new Set(p.hyps.flatMap((h) => Object.keys(h)))];
    return names.map((nm) => ({ nm, v: pollValue(p, nm) ?? 0 })).sort((a, b) => b.v - a.v).slice(0, n)
      .map((x) => `${esc(meta(x.nm).surname)} ${Math.round(x.v)}`).join(" · ");
  };
  const pollLink = (p: Poll, body: string) => (p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${body}</a>` : body);
  const maxMae = Math.max(1, ...R.pollsters.map((p) => p.mae ?? 0));
  // each institute's lean in 2027 (taken off its polls in our average): the two largest, 0.5 point or more
  const house = polls ? houseEffects(polls.firstRound, latestPollDate(polls.firstRound)) : new Map();
  const lean = (name: string) => {
    const xs = [...(house.get(name) ?? new Map()).entries()].filter(([, h]) => h.n >= 2 && Math.abs(h.effect) >= 0.5).sort((a, b) => Math.abs(b[1].effect) - Math.abs(a[1].effect)).slice(0, 2);
    return xs.length ? xs.map(([nm, h]) => `<span class="${h.effect > 0 ? "pg-hi" : "pg-lo"}">${esc(meta(nm).surname)} ${signed(h.effect, 1)}</span>`).join("<br>") : `<span class="muted">${house.has(name) ? L("aucun", "none") : "—"}</span>`;
  };
  const rated = R.pollsters.filter((p) => p.grade);
  const unrated = R.pollsters.filter((p) => !p.grade);
  const presCount = R.elections.filter((e) => e.type === "presidential").length;
  if (polls) registerParties(polls.parties);
  const lastElection = (p: PollsterRating) => { const e = elections.get(p.history[0].election); return e ? L(e.label.fr, e.label.en) : p.history[0].election; };

  const row = (p: PollsterRating) => `<tr id="${pollsterAnchor(p.name)}">
      <th scope="row"><button type="button" class="pg-open" aria-expanded="false" data-name="${esc(p.name)}">${esc(p.name)}</button></th>
      <td>${badge(p.grade)}</td>
      <td class="num">${p.score == null ? "—" : `${signed(p.score, 2)}`}</td>
      <td class="pg-miss">${p.mae == null ? "—" : `<span class="pg-bar ${gradeClass(p.grade)}" style="width:${((100 * p.mae) / maxMae).toFixed(0)}%"></span><b>${dec(p.mae, 1)}</b> ${L("pt", "pt")}${p.history[0] ? `<span class="muted tiny">${L("dernière fois", "last time")} ${dec(p.history[0].mae, 1)} (${esc(lastElection(p))})</span>` : ""}`}</td>
      <td class="num">${p.elections || "—"}</td>
      <td class="num">${p.biasFarRight == null ? "—" : signed(p.biasFarRight, 1)}</td>
      <td class="pg-lean">${lean(p.name)}</td>
      <td class="num">${dec(p.weight ?? UNRATED_WEIGHT, 2)}</td>
      <td class="num">${n2027.get(p.name) ?? 0}</td>
      <td class="pg-last">${(() => { const x = byFirm.get(p.name)?.[0]; return x ? `${pollLink(x, fmtDate(x.end))}<span class="muted tiny">${top(x)}</span>` : `<span class="muted">—</span>`; })()}</td>
    </tr>
    <tr class="pg-detail" hidden data-for="${esc(p.name)}"><td colspan="10">${detail(p)}</td></tr>`;

  const detail = (p: PollsterRating) => {
    const m = p.methodology;
    const meth = m ? `<p><b>${L("Méthode", "Method")}.</b> ${esc(L(m.mode.fr, m.mode.en))}${m.sample ? ` · ${L("échantillon type", "typical sample")} ${esc(m.sample)}` : ""}${m.notes ? `. ${esc(L(m.notes.fr, m.notes.en))}` : ""}${m.url ? ` · <a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${L("Page méthodologie", "Methodology page")}</a>` : ""}</p>` : `<p class="muted">${L("Méthode non documentée ici.", "Method not documented here.")}</p>`;
    const aliases = p.aliases?.length ? `<p class="muted small">${L("Aussi publié sous", "Also published as")} ${p.aliases.map(esc).join(", ")}</p>` : "";
    const hist = p.history.length
      ? `<table class="table pg-hist"><thead><tr><th>${L("Élection", "Election")}</th><th>${L("Dernier sondage", "Final poll")}</th><th class="num">${L("Écart moyen", "Mean error")}</th><th class="num">${L("Écart à la moyenne des instituts", "Vs the field")}</th></tr></thead><tbody>${p.history
          .map((h) => {
            const e = elections.get(h.election);
            const lab = e ? L(e.label.fr, e.label.en) : h.election;
            return `<tr><td>${esc(lab)}</td><td>${h.url ? `<a href="${esc(safeUrl(h.url))}" target="_blank" rel="noopener">${fmtDate(h.end)}</a>` : fmtDate(h.end)}</td><td class="num">${dec(h.mae, 1)}</td><td class="num ${h.rel < 0 ? "better" : h.rel > 0 ? "worse" : ""}">${signed(h.rel, 1)}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<p class="muted">${L("Pas encore de sondage final comparable à un résultat : pas de note, poids par défaut dans la moyenne.", "No final poll yet to compare with a result: no grade, default weight in the average.")}</p>`;
    const recent = (byFirm.get(p.name) ?? []).slice(0, 5);
    const recentHtml = recent.length ? `<h3 class="pg-h">${L("Ses derniers sondages 2027", "Its latest 2027 polls")}</h3><ul class="pg-recent">${recent.map((x) => `<li>${pollLink(x, fmtDate(x.end))}<span>${top(x, 4)}</span></li>`).join("")}</ul>` : "";
    return `<div class="pg-detail-in">${meth}${aliases}${recentHtml}<h3 class="pg-h">${L("Ses erreurs passées", "How far off it was")}</h3>${hist}</div>`;
  };

  app.innerHTML = `
    <section class="page pg">
      <div class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027 · sondages", "2027 presidential · polls")}</p>
        <h1>${L("Les instituts de sondage, notés de A+ à F", "Polling institutes, graded A+ to F")}</h1>
        <p class="dek">${L(
          `Pour chaque élection passée, le dernier sondage de chaque institut comparé au résultat : ${R.elections.length} scrutins, dont ${presCount} présidentielles. La note compte dans notre moyenne : un sondage mal noté la fait moins bouger.`,
          `For each past election, every institute’s final poll set against the result: ${R.elections.length} elections, ${presCount} of them presidential. The grade counts in our average: a poorly graded poll moves it less.`,
        )}</p>
        <nav class="subnav"><a href="#/sondages">${L("Tous les sondages", "Every poll")}</a><a href="#/sondages/instituts#methode">${L("La méthode", "The method")}</a><a href="#/sondages/instituts#elections">${L("Les élections", "The elections")}</a></nav>
      </div>

      <article class="card">
        <header class="card-head"><h2>${L("Le classement", "The ranking")}</h2></header>
        ${R.pollsters.length ? `<div class="table-wrap"><table class="table pg-table">
          <thead><tr>
            <th>${L("Institut", "Institute")}</th><th>${L("Note", "Grade")}</th>
            <th class="num" title="${esc(L("Écart moyen à la moyenne des instituts, en points (négatif = meilleur que les autres)", "Average gap to the field, in points (negative = better than the others)"))}">${L("Score", "Score")}</th>
            <th title="${esc(L("Écart moyen entre son dernier sondage et le résultat, en points, sur toutes les élections notées", "Average gap between its final poll and the result, in points, across every graded election"))}">${L("Erreur moyenne", "Off by, on average")}</th><th class="num">${L("Élections", "Elections")}</th>
            <th class="num" title="${esc(L("Sondage moins résultat pour l’extrême droite (RN/FN et Reconquête), en moyenne : positif = surestimée", "Poll minus result for the far right (RN/FN and Reconquête), on average: positive = overestimated"))}">${L("Biais ext. droite", "Far-right bias")}</th>
            <th title="${esc(L(`Penchant de l’institut en 2027 : de combien ses sondages placent un candidat au-dessus (+) ou au-dessous (−) des autres instituts, sur ${HOUSE_DAYS} jours, en points. Nous le retirons de ses sondages dans la moyenne.`, `The institute's 2027 lean: how far its polls put a candidate above (+) or below (−) the other institutes, over ${HOUSE_DAYS} days, in points. We take it off its polls in the average.`))}">${L("Penchant 2027", "2027 lean")}</th>
            <th class="num">${L("Poids", "Weight")}</th><th class="num">${L("Sondages 2027", "2027 polls")}</th><th>${L("Dernier sondage", "Latest poll")}</th>
          </tr></thead>
          <tbody>${rated.map(row).join("")}${unrated.map(row).join("")}</tbody>
        </table></div>
        <p class="muted small">${L(`Cliquer sur un institut : sa méthode, ses derniers sondages et son erreur à chaque élection. Écarts en points de pourcentage. Penchant 2027 : de combien l’institut place un candidat au-dessus ou au-dessous des autres sur les ${HOUSE_DAYS} derniers jours, ramené vers zéro quand il a peu de sondages ; notre moyenne le retire de ses sondages.`, `Click an institute: its method, its latest polls and how far off it was at each election. Gaps in percentage points. 2027 lean: how far the institute puts a candidate above or below the others over the last ${HOUSE_DAYS} days, pulled toward zero when it has few polls; our average takes it off its polls.`)}</p>`
        : `<p class="muted">${L("Notes en cours de calcul.", "Grades being computed.")}</p>`}
      </article>

      <article class="card" id="methode">
        <header class="card-head"><h2>${L("Comment la note est calculée", "How the grade is worked out")}</h2></header>
        <p>${esc(L(R.method.fr, R.method.en))}</p>
        ${R.grades.length ? `<table class="table pg-grades"><thead><tr><th>${L("Note", "Grade")}</th><th>${L("Score", "Score")}</th><th class="num">${L("Poids dans la moyenne", "Weight in the average")}</th></tr></thead><tbody>${R.grades
          .map((g) => `<tr><td>${badge(g.grade)}</td><td>${g.min == null ? "" : `≥ ${signed(g.min, 2)}`}${g.min != null && g.max != null ? " · " : ""}${g.max == null ? "" : `< ${signed(g.max, 2)}`}</td><td class="num">${dec(g.weight, 2)}</td></tr>`)
          .join("")}<tr><td>${badge(null)}</td><td>${L("pas encore noté", "not yet graded")}</td><td class="num">${dec(UNRATED_WEIGHT, 2)}</td></tr></tbody></table>` : ""}
        <p class="muted small">${L(
          "Une note mesure le passé : un institut peut changer de méthode. Toutes les enquêtes électorales publiées en France sont déposées auprès de la Commission des sondages, qui en publie les notices.",
          "A grade measures the past: an institute can change its method. Every electoral poll published in France is filed with the Commission des sondages, which publishes the notices.",
        )} <a href="https://www.commission-des-sondages.fr/" target="_blank" rel="noopener">${L("Commission des sondages", "Commission des sondages")}</a></p>
      </article>

      <article class="card" id="elections">
        <header class="card-head"><h2>${L("Les élections comparées", "The elections compared")}</h2></header>
        ${R.elections.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>${L("Élection", "Election")}</th><th class="num">${L("Instituts", "Institutes")}</th><th class="num">${L("Écart moyen des instituts", "Average institute error")}</th><th>${L("Sources", "Sources")}</th></tr></thead><tbody>${[...R.elections]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => `<tr><td>${esc(L(e.label.fr, e.label.en))} <span class="muted small">${fmtDate(e.date)}</span></td><td class="num">${e.pollsters}</td><td class="num">${dec(e.avgError, 1)} pt</td><td class="small"><a href="${esc(safeUrl(e.source))}" target="_blank" rel="noopener">${L("sondages", "polls")}</a> · <a href="${esc(safeUrl(e.resultSource))}" target="_blank" rel="noopener">${L("résultat", "result")}</a></td></tr>`)
          .join("")}</tbody></table></div>` : `<p class="muted">—</p>`}
        <p class="muted small">${L(`Mis à jour le ${fmtDate(R.updated)}.`, `Updated ${fmtDate(R.updated)}.`)} ${fr ? "Tableaux de sondages : Wikipédia (CC BY-SA)." : "Poll tables: Wikipedia (CC BY-SA)."}</p>
      </article>
    </section>`;

  app.querySelectorAll<HTMLButtonElement>(".pg-open").forEach((b) =>
    b.addEventListener("click", () => {
      const tr = app.querySelector<HTMLElement>(`.pg-detail[data-for="${CSS.escape(b.dataset.name!)}"]`);
      if (!tr) return;
      const open = tr.hidden;
      tr.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    }),
  );
  // arriving from a grade letter on the homepage chart (#/sondages/instituts#pg-ifop): open that institute
  const m = /#(pg-[\w-]+)$/.exec(location.hash);
  const tr = m ? document.getElementById(m[1]) : null;
  if (tr) { tr.querySelector<HTMLButtonElement>(".pg-open")?.click(); tr.scrollIntoView({ block: "center" }); }
  void pollWeight;
}

