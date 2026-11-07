// Scenario planner: first-round shares → choose finalists → vote transfers → runoff result.
import { loadPolls } from "../data";
import { L, getLang } from "../i18n";
import { BLOCS, meta, registerParties, type Bloc } from "../lib/candidates";
import { average, duelAverages, pollsInWindow } from "../lib/polls";
import { esc, groupBy } from "../util";

interface Cand {
  name: string;
  share: number;
  bloc: Bloc | null;
}
interface State {
  cands: Cand[];
  finalists: [string, string];
  transfers: Record<string, [number, number]>; // eliminated → [% to A, % to B]
  edited: Set<string>; // transfers the user typed in (kept when finalists change)
}

// Default transfer assumption by political distance (0 = same family … 4 = opposite ends).
// Editable in the UI; documented on the Sources page.
const AFFINITY = [0.85, 0.5, 0.4, 0.15, 0.15];
function defaultTransfer(from: Bloc | null, a: Bloc | null, b: Bloc | null): [number, number] {
  if (from == null || a == null || b == null) return [35, 35];
  let ta = AFFINITY[Math.abs(from - a)], tb = AFFINITY[Math.abs(from - b)];
  const sum = ta + tb;
  if (sum > 0.9) [ta, tb] = [(ta * 0.9) / sum, (tb * 0.9) / sum];
  return [Math.round(ta * 100), Math.round(tb * 100)];
}

let state: State | null = null;

export async function renderSimulator(app: HTMLElement) {
  const polls = await loadPolls("2027");
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const avg = average(polls.firstRound, latest, undefined, 0);
  const avgOf = (n: string) => avg.find((r) => r.name === n)?.avg ?? 0;
  // Start from the line-up pollsters tested most often recently (candidates in the overall
  // average are alternatives — e.g. Philippe or Attal — so summing them would exceed 100 %).
  const fromPolls = (): Cand[] => {
    const hyps = pollsInWindow(polls.firstRound, latest).flatMap((p) => p.hyps);
    const sets = groupBy(hyps, (h) => Object.keys(h).sort().join("|"));
    const best = [...sets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const names = Object.keys(best[0] ?? {});
    return names
      .map((name) => ({ name, share: Math.round((10 * best.reduce((s, h) => s + h[name], 0)) / best.length) / 10, bloc: meta(name).bloc }))
      .filter((c) => c.share > 0);
  };
  const duels = duelAverages(polls.secondRound);

  const reset = () => {
    const cands = fromPolls();
    const top = [...cands].sort((a, b) => b.share - a.share);
    state = { cands, finalists: [top[0].name, top[1].name], transfers: {}, edited: new Set() };
  };
  if (!state) reset();

  const blocName = (b: Bloc) => (getLang() === "fr" ? BLOCS[b].fr : BLOCS[b].en);

  const draw = () => {
    const s = state!;
    const total = s.cands.reduce((t, c) => t + c.share, 0);
    const [fa, fb] = s.finalists;
    const ca = s.cands.find((c) => c.name === fa)!, cb = s.cands.find((c) => c.name === fb)!;
    // fill default transfers (unless user-edited)
    for (const c of s.cands) if (c.name !== fa && c.name !== fb && !s.edited.has(c.name)) s.transfers[c.name] = defaultTransfer(c.bloc, ca.bloc, cb.bloc);
    let va = ca.share, vb = cb.share, lost = 0;
    for (const c of s.cands) {
      if (c.name === fa || c.name === fb) continue;
      const [ta, tb] = s.transfers[c.name];
      va += (c.share * ta) / 100;
      vb += (c.share * tb) / 100;
      lost += (c.share * (100 - ta - tb)) / 100;
    }
    const pa = (100 * va) / (va + vb), pb = 100 - pa;
    const winner = pa >= pb ? ca : cb;
    const pollDuel = duels.find((d) => [d.winner, d.loser].sort().join() === [fa, fb].sort().join());
    const ma = meta(fa), mb = meta(fb);
    const ordered = [...s.cands].sort((a, b) => b.share - a.share);

    app.innerHTML = `
      <section class="page">
        <div class="page-head">
          <div><p class="eyebrow">${L("Présidentielle 2027", "2027 presidential")}</p><h1>${L("Simulateur de scénarios", "Scenario planner")}</h1></div>
          <button type="button" class="button" id="reset">${L("Repartir des sondages", "Reset to polling average")}</button>
        </div>

        <div class="sim-grid">
          <article class="card">
            <header class="card-head"><h2>1. ${L("Scores du 1er tour", "First-round shares")}</h2><span class="${Math.abs(total - 100) > 0.5 ? "warn" : "muted"} small">${L("Total", "Total")} ${total.toFixed(1)} %</span></header>
            <p class="muted small">${L("Pré-rempli avec l’hypothèse de candidatures la plus testée par les sondages récents (moyenne de ces sondages). Ajoutez, retirez ou modifiez les candidats ; la famille politique sert aux reports par défaut.", "Pre-filled with the candidate line-up recent polls tested most (averaged across those polls). Add, remove or edit candidates; political family drives the default transfers.")}</p>
            <table class="table sim-table">
              <thead><tr><th>${L("Candidat", "Candidate")}</th><th>${L("Famille", "Family")}</th><th class="num">%</th><th></th></tr></thead>
              <tbody>${ordered
                .map(
                  (c) => `<tr>
                    <td><i class="dot" style="background:${meta(c.name).color}"></i>${esc(c.name)}</td>
                    <td><select data-bloc="${esc(c.name)}"><option value="">?</option>${BLOCS.map((_, i) => `<option value="${i}" ${c.bloc === i ? "selected" : ""}>${blocName(i as Bloc)}</option>`).join("")}</select></td>
                    <td class="num"><input type="number" min="0" max="100" step="0.5" value="${c.share}" data-share="${esc(c.name)}" /></td>
                    <td><button type="button" class="icon" data-remove="${esc(c.name)}" title="${L("Retirer", "Remove")}" ${s.finalists.includes(c.name) ? "disabled" : ""}>✕</button></td>
                  </tr>`,
                )
                .join("")}</tbody>
            </table>
            <p><select id="add"><option value="">+ ${L("Ajouter un candidat testé dans les sondages", "Add a candidate tested in polls")}</option>${avg.filter((r) => !s.cands.some((c) => c.name === r.name)).map((r) => `<option value="${esc(r.name)}">${esc(r.name)} (${r.avg.toFixed(1)} %)</option>`).join("")}</select></p>
            ${Math.abs(total - 100) > 0.5 ? `<button type="button" class="button" id="normalize">${L("Ramener le total à 100 %", "Scale total to 100%")}</button>` : ""}
          </article>

          <div class="stack-col">
            <article class="card">
              <header class="card-head"><h2>2. ${L("Qualifiés pour le 2nd tour", "Runoff finalists")}</h2></header>
              <div class="finalists">${[0, 1]
                .map((i) => `<select data-finalist="${i}">${ordered.map((c) => `<option ${s.finalists[i] === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`)
                .join(`<span class="muted">${L("contre", "vs")}</span>`)}</div>
              <p class="muted small">${L("Par défaut, les deux premiers du 1er tour.", "Defaults to the top two in the first round.")}</p>
            </article>

            <article class="card result-card" style="--c:${meta(winner.name).color}">
              <header class="card-head"><h2>${L("Résultat simulé du 2nd tour", "Simulated runoff result")}</h2></header>
              <div class="duel big"><span style="width:${pa}%;background:${ma.color}">${esc(ma.surname)} ${pa.toFixed(1)}</span><span style="width:${pb}%;background:${mb.color}">${pb.toFixed(1)} ${esc(mb.surname)}</span></div>
              <p><b>${esc(winner.name)}</b> ${L("l’emporte avec", "wins by")} ${Math.abs(pa - pb).toFixed(1)} ${L("points", "points")}.
                ${L("Abstention, blancs et nuls supplémentaires :", "Extra abstention, blank and void:")} ${((100 * lost) / total).toFixed(0)} % ${L("des voix du 1er tour", "of first-round votes")}.</p>
              ${pollDuel ? `<p class="muted small">${L("Pour comparaison, les sondages sur ce duel donnent", "For comparison, polls of this match-up give")} ${esc(meta(pollDuel.winner).surname)} ${pollDuel.pw.toFixed(0)} – ${pollDuel.pl.toFixed(0)} ${esc(meta(pollDuel.loser).surname)} (${pollDuel.total} ${L("sondages", "polls")}).</p>` : `<p class="muted small">${L("Aucun sondage n’a testé ce duel.", "No poll has tested this match-up.")}</p>`}
            </article>

            <article class="card">
              <header class="card-head"><h2>3. ${L("Reports de voix", "Vote transfers")}</h2></header>
              <p class="muted small">${L("Part des électeurs de chaque candidat éliminé qui votent pour chaque finaliste ; le reste s’abstient ou vote blanc. Les valeurs par défaut sont des hypothèses fondées sur la proximité politique, pas des données. Modifiez-les librement.", "Share of each eliminated candidate’s voters who back each finalist; the rest abstain or vote blank. Defaults are assumptions based on political proximity, not data. Change them freely.")}</p>
              <table class="table sim-table">
                <thead><tr><th>${L("Électeurs de", "Voters of")}</th><th class="num">→ ${esc(ma.surname)}</th><th class="num">→ ${esc(mb.surname)}</th><th class="num">${L("Abst.", "Abst.")}</th></tr></thead>
                <tbody>${ordered
                  .filter((c) => c.name !== fa && c.name !== fb)
                  .map((c) => {
                    const [ta, tb] = s.transfers[c.name];
                    return `<tr><td>${esc(c.name)} <span class="muted small">${c.share} %</span>${s.edited.has(c.name) ? ` <span class="tag">${L("modifié", "edited")}</span>` : ""}</td>
                      <td class="num"><input type="number" min="0" max="100" step="5" value="${ta}" data-ta="${esc(c.name)}" /></td>
                      <td class="num"><input type="number" min="0" max="100" step="5" value="${tb}" data-tb="${esc(c.name)}" /></td>
                      <td class="num muted">${Math.max(0, 100 - ta - tb)}</td></tr>`;
                  })
                  .join("")}</tbody>
              </table>
            </article>
          </div>
        </div>
      </section>`;

    // events
    const on = (sel: string, fn: (el: HTMLInputElement | HTMLSelectElement) => void) =>
      app.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel).forEach((el) => el.addEventListener("change", () => { fn(el); draw(); }));
    on("[data-share]", (el) => { s.cands.find((c) => c.name === el.dataset.share)!.share = Math.max(0, Number(el.value) || 0); });
    on("[data-bloc]", (el) => { s.cands.find((c) => c.name === el.dataset.bloc)!.bloc = el.value === "" ? null : (Number(el.value) as Bloc); });
    on("[data-finalist]", (el) => {
      const i = Number(el.dataset.finalist);
      if (s.finalists[1 - i] === el.value) s.finalists[1 - i] = s.finalists[i]; // swap instead of duplicating
      s.finalists[i] = el.value;
      s.edited.clear();
    });
    const setT = (name: string, idx: 0 | 1, v: number) => {
      const t = s.transfers[name];
      t[idx] = Math.min(100, Math.max(0, v));
      if (t[0] + t[1] > 100) t[1 - idx] = 100 - t[idx];
      s.edited.add(name);
    };
    on("[data-ta]", (el) => setT(el.dataset.ta!, 0, Number(el.value)));
    on("[data-tb]", (el) => setT(el.dataset.tb!, 1, Number(el.value)));
    app.querySelector("#reset")!.addEventListener("click", () => { reset(); draw(); });
    app.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) => b.addEventListener("click", () => { s.cands = s.cands.filter((c) => c.name !== b.dataset.remove); delete s.transfers[b.dataset.remove!]; draw(); }));
    app.querySelector<HTMLSelectElement>("#add")!.addEventListener("change", (e) => {
      const name = (e.target as HTMLSelectElement).value;
      if (name) s.cands.push({ name, share: Math.round(avgOf(name) * 10) / 10, bloc: meta(name).bloc });
      draw();
    });
    app.querySelector("#normalize")?.addEventListener("click", () => {
      for (const c of s.cands) c.share = Math.round((1000 * c.share) / total) / 10;
      draw();
    });
  };
  draw();
}
