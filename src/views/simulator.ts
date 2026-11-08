// Scenario planner as a funnel: first-round votes (left) flow into the two finalists or into
// abstention (right). Sliders update the funnel live; scenarios can be saved (browser, or account
// when signed in) and shared by link.
import { loadMarkets, loadPolls } from "../data";
import { combineOdds, oddsFor } from "../lib/markets";
import { ROUND1_SD, ROUND2_SD, RUNS, buildModel, oddsSentence } from "../lib/scenario-odds";
import { L, fmtDate, getLang } from "../i18n";
import { BLOCS, meta, registerParties, spectrumRank, type Bloc } from "../lib/candidates";
import { average, duelAverages, referenceLineup } from "../lib/polls";
import { cloudEnabled, currentUser, deleteScenario, listScenarios, onAuth, saveScenario, sendLoginLink, signOut, type SavedScenario } from "../lib/cloud";
import { esc, safeColor } from "../util";

interface Cand { name: string; share: number; bloc: Bloc | null }
interface Scenario { cands: Cand[]; finalists: [string, string]; transfers: Record<string, [number, number]>; edited: string[] }

// Default transfer assumption by political distance (0 = same family … 4 = opposite ends), capped at 90 % in total.
const AFFINITY = [0.85, 0.5, 0.4, 0.15, 0.15];
function defaultTransfer(from: Bloc | null, a: Bloc | null, b: Bloc | null): [number, number] {
  if (from == null || a == null || b == null) return [35, 35];
  let ta = AFFINITY[Math.abs(from - a)], tb = AFFINITY[Math.abs(from - b)];
  const sum = ta + tb;
  if (sum > 0.9) [ta, tb] = [(ta * 0.9) / sum, (tb * 0.9) / sum];
  return [Math.round(ta * 100), Math.round(tb * 100)];
}

let state: Scenario | null = null;
let autoBalance = true;
/** Finalists follow the top two until the user picks one by hand. */
let manualFinalists = false;
/** Always in the default line-up when they are polled. */
const LIKELY = ["David Lisnard"];

/** How much of a candidate's moving vote goes to another, by political distance (unknown family = middling). */
const proximity = (a: Bloc | null, b: Bloc | null) => (a == null || b == null ? 0.3 : AFFINITY[Math.abs(a - b)]);
/**
 * Spread `delta` points (positive = to take from others, negative = to give to others) over every
 * candidate except `who`, weighted by political proximity × current share, never below 0.
 */
function rebalance(cands: Cand[], who: Cand, delta: number) {
  let left = delta;
  for (let pass = 0; pass < 4 && Math.abs(left) > 0.01; pass++) {
    const pool = cands.filter((c) => c !== who && (left < 0 || c.share > 0));
    // closeness matters most (squared); size only a little (square root), so a big but distant candidate gets few points
    const w = pool.map((c) => proximity(who.bloc, c.bloc) ** 2 * Math.sqrt(Math.max(c.share, 0.5)));
    const sum = w.reduce((x, y) => x + y, 0);
    if (!sum) break;
    let used = 0;
    pool.forEach((c, i) => {
      const want = (left * w[i]) / sum;
      const next = Math.max(0, c.share - want);
      used += c.share - next;
      c.share = Math.round(next * 10) / 10;
    });
    left -= used;
  }
}
let authHooked = false;
const encode = (s: Scenario) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Share links and saved scenarios are untrusted input: rebuild a clean Scenario from them,
// dropping wrong types and clamping numbers, before anything reaches the page (security review H1).
const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
/* eslint-disable @typescript-eslint/no-explicit-any */
export function sanitizeScenario(raw: any): Scenario | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cands) || raw.cands.length > 30) return null;
  const cands: Cand[] = raw.cands
    .map((c: any) => ({ name: str(c?.name), share: num(c?.share, 0, 100), bloc: Number.isInteger(c?.bloc) && c.bloc >= 0 && c.bloc < BLOCS.length ? (c.bloc as Bloc) : null }))
    .filter((c: Cand) => c.name);
  const names = new Set(cands.map((c) => c.name));
  const finalists = (Array.isArray(raw.finalists) ? raw.finalists.map(str) : []).filter((n: string) => names.has(n));
  if (finalists.length !== 2 || finalists[0] === finalists[1]) return null;
  const transfers: Record<string, [number, number]> = {};
  for (const [k, v] of Object.entries(raw.transfers ?? {})) if (names.has(k) && Array.isArray(v)) transfers[k] = [num(v[0], 0, 100), num(v[1], 0, 100)];
  const edited = (Array.isArray(raw.edited) ? raw.edited.map(str) : []).filter((n: string) => names.has(n) && transfers[n]);
  return { cands, finalists: [finalists[0], finalists[1]], transfers, edited };
}
const decode = (t: string): Scenario | null => {
  try {
    return sanitizeScenario(JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/"))))));
  } catch {
    return null;
  }
};

export async function renderSimulator(app: HTMLElement, shared?: string) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  const odds = combineOdds(markets?.markets ?? []);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const avg = average(polls.firstRound, latest, undefined, 0);
  const duels = duelAverages(polls.secondRound);

  const fromPolls = (): Scenario => {
    const cands = referenceLineup(polls.firstRound, latest).rows.map((r) => ({ name: r.name, share: Math.round(r.share * 10) / 10, bloc: meta(r.name).bloc }));
    // Likely candidates the most-tested line-up leaves out (e.g. David Lisnard, second favourite on
    // the betting markets): add them at their polling average, taking the points from their neighbours.
    for (const name of LIKELY) {
      if (cands.some((c) => c.name === name)) continue;
      const share = Math.round((avg.find((r) => r.name === name)?.avg ?? 0) * 10) / 10;
      if (!share) continue;
      const c = { name, share, bloc: meta(name).bloc };
      cands.push(c);
      rebalance(cands, c, share);
    }
    const top = [...cands].sort((a, b) => b.share - a.share);
    return { cands, finalists: [top[0].name, top[1].name], transfers: {}, edited: [] };
  };
  // Probability model, from the polls: baseline shares + runoff polls (or the transfer model).
  const baseline = fromPolls().cands;
  const baseShare = (n: string) => baseline.find((c) => c.name === n);
  const runoffShare = (a: string, b: string) => {
    const d = duels.find((x) => [x.winner, x.loser].sort().join() === [a, b].sort().join());
    if (d) return d.winner === a ? (100 * d.pw) / (d.pw + d.pl) : (100 * d.pl) / (d.pw + d.pl);
    const A = baseShare(a), B = baseShare(b);
    if (!A || !B) return 50;
    let va = A.share, vb = B.share;
    for (const c of baseline) if (c !== A && c !== B) { const [ta, tb] = defaultTransfer(c.bloc, A.bloc, B.bloc); va += (c.share * ta) / 100; vb += (c.share * tb) / 100; }
    return (100 * va) / (va + vb);
  };
  const model = buildModel(baseline.map((c) => ({ name: c.name, share: c.share })), runoffShare);
  let needRebuild = false;
  if (shared) state = decode(shared) ?? state;
  state ??= fromPolls();
  const s = state;
  const blocName = (b: Bloc) => (getLang() === "fr" ? BLOCS[b].fr : BLOCS[b].en);
  const fillDefaults = () => {
    const [a, b] = s.finalists.map((n) => s.cands.find((c) => c.name === n)!);
    for (const c of s.cands) if (!s.finalists.includes(c.name) && !s.edited.includes(c.name)) s.transfers[c.name] = defaultTransfer(c.bloc, a.bloc, b.bloc);
  };

  const shell = () => {
    fillDefaults();
    const ordered = [...s.cands].sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
    const [fa, fb] = s.finalists;
    app.innerHTML = `
      <section class="page">
        <header class="page-head">
          <p class="eyebrow">${L("Présidentielle 2027, simulateur", "2027 presidential, simulator")}</p>
          <h1 id="sim-h1"></h1>
          <p class="dek">${L("Faites glisser les curseurs : à gauche, le score de chaque candidat au premier tour ; au milieu, où vont ses électeurs s’il est éliminé. Le résultat se met à jour en direct.", "Drag the sliders: on the left, each candidate’s first-round share; in the middle, where their voters go if they’re eliminated. The result updates live.")}</p>
        </header>

        <div class="sim-odds" id="sim-odds"></div>
        <div class="sim-result" id="sim-result"></div>
        <div class="sim-markets" id="sim-markets"></div>
        <figure class="funnel-fig"><svg id="funnel" viewBox="0 0 960 520" role="img" aria-label="${L("Reports de voix", "Vote transfers")}"></svg></figure>

        <section class="card">
          <header class="card-head"><h2>${L("Candidats et reports", "Candidates and transfers")}</h2>
            <span class="small sim-tools"><label class="check"><input type="checkbox" id="auto" ${autoBalance ? "checked" : ""}/> ${L("Reporter automatiquement les points vers les candidats proches", "Move points to and from nearby candidates automatically")}</label> <button type="button" class="linkish" id="reset">${L("Repartir des sondages", "Reset to polls")}</button></span></header>
          <p class="muted small">${L("Cliquez sur « Qualifier » pour choisir les deux finalistes. Les reports par défaut sont des hypothèses fondées sur la proximité politique, pas des données.", "Click “Qualify” to pick the two finalists. Default transfers are assumptions based on political proximity, not data.")}</p>
          <div class="sim-rows">${ordered
            .map((c) => {
              const fin = s.finalists.includes(c.name);
              const m = meta(c.name);
              return `<div class="sim-row ${fin ? "is-finalist" : ""}" data-row="${esc(c.name)}" style="--c:${m.color}">
                <div class="sim-name"><b>${esc(c.name)}</b> <span class="muted small">${esc(m.party ?? "")}</span>
                  <select data-bloc="${esc(c.name)}" aria-label="${L("Famille politique", "Political family")}"><option value="">?</option>${BLOCS.map((_, i) => `<option value="${i}" ${c.bloc === i ? "selected" : ""}>${blocName(i as Bloc)}</option>`).join("")}</select></div>
                <label class="sim-share"><span class="muted small">${L("1er tour", "1st round")}</span><input type="range" min="0" max="45" step="0.1" value="${c.share}" data-share="${esc(c.name)}"/><output data-share-out="${esc(c.name)}">${c.share.toFixed(1)} %</output></label>
                ${
                  fin
                    ? `<div class="sim-transfer muted small">${L("Finaliste : garde ses voix", "Finalist: keeps their votes")}</div>`
                    : `<div class="sim-transfer">
                        <label><span class="small">→ ${esc(meta(fa).surname)}</span><input type="range" min="0" max="100" step="5" value="${s.transfers[c.name][0]}" data-ta="${esc(c.name)}"/><output data-ta-out="${esc(c.name)}">${s.transfers[c.name][0]} %</output></label>
                        <label><span class="small">→ ${esc(meta(fb).surname)}</span><input type="range" min="0" max="100" step="5" value="${s.transfers[c.name][1]}" data-tb="${esc(c.name)}"/><output data-tb-out="${esc(c.name)}">${s.transfers[c.name][1]} %</output></label>
                      </div>`
                }
                <div class="sim-actions">${fin ? `<span class="tag">${L("finaliste", "finalist")}</span>` : `<button type="button" class="linkish" data-qualify="${esc(c.name)}">${L("Qualifier", "Qualify")}</button><button type="button" class="icon" data-remove="${esc(c.name)}" title="${L("Retirer", "Remove")}">✕</button>`}</div>
              </div>`;
            })
            .join("")}</div>
          <p><select id="add"><option value="">+ ${L("Ajouter un candidat testé dans les sondages", "Add a candidate tested in polls")}</option>${avg.filter((r) => !s.cands.some((c) => c.name === r.name)).map((r) => `<option value="${esc(r.name)}">${esc(r.name)} (${r.avg.toFixed(1)} %)</option>`).join("")}</select></p>
        </section>

        <section class="card" id="saves"></section>
      </section>`;
    bind();
    update();
    drawSaves();
  };

  // Live part: result, funnel, outputs. Never rebuilds the inputs, so dragging stays smooth.
  const update = () => {
    const [fa, fb] = s.finalists;
    const total = s.cands.reduce((t, c) => t + c.share, 0) || 1;
    let va = 0, vb = 0, lost = 0;
    const flows: { from: Cand; to: "a" | "b" | "x"; v: number }[] = [];
    for (const c of [...s.cands].sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name))) {
      if (c.name === fa) { va += c.share; flows.push({ from: c, to: "a", v: c.share }); continue; }
      if (c.name === fb) { vb += c.share; flows.push({ from: c, to: "b", v: c.share }); continue; }
      const [ta, tb] = s.transfers[c.name];
      const a = (c.share * ta) / 100, b = (c.share * tb) / 100, x = c.share - a - b;
      va += a; vb += b; lost += x;
      flows.push({ from: c, to: "a", v: a }, { from: c, to: "x", v: x }, { from: c, to: "b", v: b });
    }
    const pa = (100 * va) / (va + vb || 1), pb = 100 - pa;
    const ma = meta(fa), mb = meta(fb);
    const winner = pa >= pb ? fa : fb;
    const fr = getLang() === "fr";
    app.querySelector("#sim-h1")!.textContent = fr ? `${winner} l’emporte avec ${Math.max(pa, pb).toFixed(1)} %` : `${winner} wins with ${Math.max(pa, pb).toFixed(1)}%`;
    const poll = duels.find((d) => [d.winner, d.loser].sort().join() === [fa, fb].sort().join());
    app.querySelector("#sim-result")!.innerHTML = `
      <div class="duel big"><span style="width:${pa}%;background:${ma.color}">${esc(ma.surname)} ${pa.toFixed(1)}</span><span style="width:${pb}%;background:${mb.color}">${pb.toFixed(1)} ${esc(mb.surname)}</span></div>
      <p class="muted small">${L("Abstention, blancs et nuls supplémentaires", "Extra abstention, blank and void")} : ${((100 * lost) / total).toFixed(0)} % ${L("des voix du premier tour", "of first-round votes")}. ${poll ? `${L("Les sondages sur ce duel donnent", "Polls of this match-up give")} ${esc(meta(poll.winner).surname)} ${poll.pw.toFixed(0)}–${poll.pl.toFixed(0)} (${poll.total} ${L("sondages", "polls")}, ${L("dernier le", "latest")} ${fmtDate(poll.last)}).` : L("Aucun sondage n’a testé ce duel.", "No poll has tested this match-up.")} ${Math.abs(total - 100) > 0.5 ? `<span class="warn">${L("Total du premier tour", "First-round total")} : ${total.toFixed(1)} %.</span>` : ""}</p>`;
    const oa = oddsFor(odds, fa), ob = oddsFor(odds, fb);
    const pct = (v?: number) => (v == null ? "–" : `${Math.round(v)} %`);
    app.querySelector("#sim-markets")!.innerHTML = odds.length
      ? `<div class="mk-head"><b>${L("Ce que parient les marchés", "What the betting markets say")}</b> <span class="muted small">Kalshi, Polymarket${markets?.fetchedAt ? `, ${fmtDate(markets.fetchedAt)}` : ""}</span></div>
         <div class="mk-grid">${[fa, fb].map((n, k) => { const o = k ? ob : oa; const m = meta(n); return `<div class="mk-card" style="--c:${m.color}"><span class="muted small">${esc(m.surname)}</span><strong>${pct(o?.win?.avg)}</strong><span class="small">${L("de chances de gagner", "chance of winning")}</span><span class="muted tiny">${L("qualifié au 2nd tour", "reaches the runoff")} : ${pct(o?.runoff?.avg)}</span></div>`; }).join("")}
         <div class="mk-card mk-wide"><span class="muted small">${L("Favoris des marchés", "Market favourites")}</span><ol class="bars compact">${odds.slice(0, 5).map((o) => `<li><div class="bar-label"><span>${esc(meta(o.name).surname)}</span><b>${pct(o.win?.avg)}</b></div><div class="bar"><div style="width:${o.win?.avg ?? 0}%;background:${meta(o.name).color}"></div></div></li>`).join("")}</ol></div></div>
         <p class="muted tiny">${L("Probabilités implicites des contrats, moyenne des deux plateformes quand les deux cotent le candidat. Ce ne sont pas des sondages.", "Implied probabilities from contract prices, averaged across both platforms when both list the candidate. These aren’t polls.")}</p>`
      : "";
    {
      const loser = winner === fa ? fb : fa;
      const p1 = model.pRound1(fa, fb), p2 = model.pRound2(winner, loser), p = p1 * p2;
      const show = (x: number) => (x > 0.99 ? L("plus de 99 %", "over 99%") : x < 0.0001 ? L("moins de 0,01 %", "under 0.01%") : x < 0.01 ? `${(x * 100).toFixed(2).replace(".", fr ? "," : ".")} %` : `${Math.round(x * 100)} %`);
      // p1 = 0 means no simulated run produced this pair: only an upper bound is known
      // (rule of three: < 3/RUNS at 95 % confidence), so the comparison says "less likely than".
      const oddsLine = p1 > 0 ? oddsSentence(p, fr) : oddsSentence((3 / RUNS) * p2, fr, true);
      app.querySelector("#sim-odds")!.innerHTML = `
        <div class="odds-headline">
          <div class="odds-num"><span class="muted small">${L("Probabilité de votre scénario", "Probability of your scenario")}</span><strong>${show(p)}</strong></div>
          <div class="odds-split small">
            <span><b>${L("1er tour", "Round 1")}</b> ${esc(meta(fa).surname)} ${L("et", "and")} ${esc(meta(fb).surname)} ${L("qualifiés", "qualify")} : <b>${show(p1)}</b></span>
            <span><b>${L("2nd tour", "Round 2")}</b> ${esc(meta(winner).surname)} ${L("l’emporte", "wins")} : <b>${show(p2)}</b></span>
          </div>
          <p class="odds-fun">${esc(oddsLine)}</p>
          <p class="muted tiny">${L(`Selon les sondages actuels, pas selon vos curseurs : chaque candidat peut s’écarter de sa moyenne d’environ ${String(ROUND1_SD).replace(".", ",")} points au 1er tour et le duel de ${ROUND2_SD} points au 2nd tour (20 000 simulations). Estimation indicative.`, `Based on current polls, not your sliders: each candidate can miss their average by about ${ROUND1_SD} points in round 1 and the runoff by ${ROUND2_SD} points (20,000 simulations). Indicative estimate.`)}</p>
        </div>`;
    }
    drawFunnel(flows, total, fa, fb, va, vb, lost);
    for (const c of s.cands) {
      const o = app.querySelector(`[data-share-out="${CSS.escape(c.name)}"]`);
      if (o) o.textContent = `${c.share.toFixed(1)} %`;
      const t = s.transfers[c.name];
      const oa = app.querySelector(`[data-ta-out="${CSS.escape(c.name)}"]`), ob = app.querySelector(`[data-tb-out="${CSS.escape(c.name)}"]`);
      if (t && oa && ob) { oa.textContent = `${t[0]} %`; ob.textContent = `${t[1]} %`; }
    }
  };

  const drawFunnel = (flows: { from: Cand; to: "a" | "b" | "x"; v: number }[], total: number, fa: string, fb: string, va: number, vb: number, lost: number) => {
    const W = 960, H = 520, x1 = 200, x2 = 720, nodeW = 14, gap = 6;
    const ordered = [...s.cands].sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
    const usable = H - gap * (ordered.length - 1) - 20;
    const k = usable / total;
    // left nodes
    let y = 10;
    const left = new Map<string, { y: number; h: number; cursor: number }>();
    for (const c of ordered) { const h = c.share * k; left.set(c.name, { y, h, cursor: y }); y += h + gap; }
    // right nodes: finalist A on top, abstention middle, finalist B bottom
    const sum = va + vb + lost;
    const k2 = (H - 2 * 28 - 20) / (sum || 1);
    const right = { a: { y: 10, h: va * k2 }, x: { y: 0, h: lost * k2 }, b: { y: 0, h: vb * k2 } };
    right.x.y = right.a.y + right.a.h + 28;
    right.b.y = right.x.y + right.x.h + 28;
    const cursor = { a: right.a.y, x: right.x.y, b: right.b.y };
    const ribbons = flows
      .filter((f) => f.v > 0.01)
      .map((f) => {
        const l = left.get(f.from.name)!;
        const h1 = f.v * k, h2 = f.v * k2;
        const ya = l.cursor; l.cursor += h1;
        const yb = cursor[f.to]; cursor[f.to] += h2;
        const mx = (x1 + nodeW + x2) / 2;
        const d = `M${x1 + nodeW},${ya}C${mx},${ya} ${mx},${yb} ${x2},${yb}L${x2},${yb + h2}C${mx},${yb + h2} ${mx},${ya + h1} ${x1 + nodeW},${ya + h1}Z`;
        const dest = f.to === "a" ? fa : f.to === "b" ? fb : L("abstention", "abstention");
        return `<path d="${d}" class="ribbon" fill="${meta(f.from.name).color}" data-tip="${esc(`${f.from.name} → ${dest}\n${f.v.toFixed(1)} ${L("points", "points")}`)}"/>`;
      })
      .join("");
    const leftNodes = ordered
      .map((c) => { const l = left.get(c.name)!; return `<rect x="${x1}" y="${l.y}" width="${nodeW}" height="${Math.max(1, l.h)}" fill="${meta(c.name).color}"/><text x="${x1 - 8}" y="${l.y + l.h / 2 + 4}" text-anchor="end" class="f-label">${esc(meta(c.name).surname)} <tspan class="f-num">${c.share.toFixed(1)}</tspan></text>`; })
      .join("");
    const rnode = (key: "a" | "b" | "x", label: string, color: string, v: number) =>
      `<rect x="${x2}" y="${right[key].y}" width="${nodeW}" height="${Math.max(1, right[key].h)}" fill="${color}"/><text x="${x2 + nodeW + 10}" y="${right[key].y + right[key].h / 2}" class="f-label f-right">${esc(label)}</text><text x="${x2 + nodeW + 10}" y="${right[key].y + right[key].h / 2 + 18}" class="f-num">${v.toFixed(1)} ${L("pts", "pts")}</text>`;
    app.querySelector("#funnel")!.innerHTML = `
      <text x="${x1 + nodeW / 2}" y="${H - 2}" text-anchor="middle" class="f-axis">${L("Premier tour", "First round")}</text>
      <text x="${x2 + nodeW / 2}" y="${H - 2}" text-anchor="middle" class="f-axis">${L("Second tour", "Runoff")}</text>
      ${ribbons}${leftNodes}${rnode("a", fa, meta(fa).color, va)}${rnode("x", L("Abstention, blanc", "Abstain, blank"), "#c4c7cc", lost)}${rnode("b", fb, meta(fb).color, vb)}`;
    void W;
  };

  const bind = () => {
    const on = (sel: string, ev: string, fn: (el: HTMLInputElement) => void) => app.querySelectorAll<HTMLInputElement>(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
    on("[data-share]", "input", (el) => {
      const c = s.cands.find((x) => x.name === el.dataset.share)!;
      const next = Number(el.value);
      const delta = next - c.share;
      c.share = next;
      if (autoBalance && delta) {
        rebalance(s.cands, c, delta);
        for (const o of s.cands) { const inp = app.querySelector<HTMLInputElement>(`[data-share="${CSS.escape(o.name)}"]`); if (inp && o !== c) inp.value = String(o.share); }
      }
      if (!manualFinalists) {
        const top = [...s.cands].sort((a, b) => b.share - a.share).slice(0, 2).map((x) => x.name);
        if (top.slice().sort().join() !== s.finalists.slice().sort().join()) {
          s.finalists = [top[0], top[1]];
          s.edited = s.edited.filter((n) => !s.finalists.includes(n));
          fillDefaults();
          needRebuild = true;
        }
      }
      update();
    });
    on("[data-share]", "change", () => { if (needRebuild) { needRebuild = false; shell(); } });
    app.querySelector<HTMLInputElement>("#auto")?.addEventListener("change", (e) => { autoBalance = (e.target as HTMLInputElement).checked; });
    on("[data-ta]", "input", (el) => setT(el.dataset.ta!, 0, Number(el.value)));
    on("[data-tb]", "input", (el) => setT(el.dataset.tb!, 1, Number(el.value)));
    on("[data-bloc]", "change", (el) => { s.cands.find((c) => c.name === el.dataset.bloc)!.bloc = el.value === "" ? null : (Number(el.value) as Bloc); fillDefaults(); shell(); });
    app.querySelectorAll<HTMLButtonElement>("[data-qualify]").forEach((b) => b.addEventListener("click", () => {
      manualFinalists = true;
      // replace the weaker current finalist
      const [x, y] = s.finalists.map((n) => s.cands.find((c) => c.name === n)!);
      s.finalists = x.share >= y.share ? [x.name, b.dataset.qualify!] : [b.dataset.qualify!, y.name];
      s.edited = []; shell();
    }));
    app.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) => b.addEventListener("click", () => { s.cands = s.cands.filter((c) => c.name !== b.dataset.remove); delete s.transfers[b.dataset.remove!]; shell(); }));
    app.querySelector<HTMLSelectElement>("#add")!.addEventListener("change", (e) => {
      const name = (e.target as HTMLSelectElement).value;
      if (name) s.cands.push({ name, share: Math.round((avg.find((r) => r.name === name)?.avg ?? 1) * 10) / 10, bloc: meta(name).bloc });
      shell();
    });
    app.querySelector("#reset")!.addEventListener("click", () => { state = fromPolls(); manualFinalists = false; renderSimulator(app); });
  };
  const setT = (name: string, idx: 0 | 1, v: number) => {
    const t = s.transfers[name];
    t[idx] = v;
    if (t[0] + t[1] > 100) {
      t[1 - idx] = 100 - v;
      const other = app.querySelector<HTMLInputElement>(`[data-${idx ? "ta" : "tb"}="${CSS.escape(name)}"]`);
      if (other) other.value = String(t[1 - idx]);
    }
    if (!s.edited.includes(name)) s.edited.push(name);
    update();
  };

  const drawSaves = async () => {
    const box = app.querySelector<HTMLElement>("#saves")!;
    const user = await currentUser().catch(() => null);
    const list = await listScenarios<Scenario>().catch(() => [] as SavedScenario<Scenario>[]);
    box.innerHTML = `
      <header class="card-head"><h2>${L("Vos scénarios", "Your scenarios")}</h2>
        <span class="small muted">${user ? `${L("Connecté", "Signed in")} : ${esc(user.email ?? "")} <button type="button" class="linkish" id="logout">${L("Se déconnecter", "Sign out")}</button>` : cloudEnabled() ? L("Enregistrés dans ce navigateur", "Saved in this browser") : L("Enregistrés dans ce navigateur", "Saved in this browser")}</span></header>
      <div class="save-row">
        <input id="save-name" type="text" maxlength="80" placeholder="${L("Nom du scénario", "Scenario name")}" value="${esc(`${meta(s.finalists[0]).surname} – ${meta(s.finalists[1]).surname}`)}"/>
        <button type="button" class="button" id="save">${L("Enregistrer", "Save")}</button>
        <button type="button" class="linkish" id="share">${L("Copier le lien de partage", "Copy share link")}</button>
        <span id="save-msg" class="small muted" role="status"></span>
      </div>
      ${list.length ? `<ul class="saved">${list.map((x, i) => `<li><button type="button" class="linkish" data-load="${i}">${esc(x.name)}</button> <span class="muted small">${fmtDate(x.updated_at)}${x.cloud ? `, ${L("compte", "account")}` : ""}</span> <button type="button" class="icon" data-del="${i}" title="${L("Supprimer", "Delete")}">✕</button></li>`).join("")}</ul>` : `<p class="muted small">${L("Aucun scénario enregistré pour l’instant.", "No saved scenarios yet.")}</p>`}
      ${
        cloudEnabled() && !user
          ? `<form class="save-row" id="login"><label class="small" for="email">${L("Créez un compte pour retrouver vos scénarios sur tous vos appareils :", "Create an account to get your scenarios on every device:")}</label><input id="email" type="email" required placeholder="vous@exemple.fr" autocomplete="email"/><button class="button" type="submit">${L("Recevoir un lien de connexion", "Email me a sign-in link")}</button></form>`
          : ""
      }`;
    const msg = (t: string) => (box.querySelector("#save-msg")!.textContent = t);
    box.querySelector("#save")!.addEventListener("click", async () => {
      const name = (box.querySelector<HTMLInputElement>("#save-name")!.value || "Scénario").trim();
      try { await saveScenario<Scenario>(name, structuredClone(s)); drawSaves(); } catch (e) { msg(String((e as Error).message)); }
    });
    box.querySelector("#share")!.addEventListener("click", async () => {
      const link = `${location.origin}${location.pathname}#/simulateur/${encode(s)}`;
      try { await navigator.clipboard.writeText(link); msg(L("Lien copié.", "Link copied.")); } catch { msg(link); }
    });
    box.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) => b.addEventListener("click", () => { const clean = sanitizeScenario(list[Number(b.dataset.load)].data); if (clean) { state = clean; renderSimulator(app); } }));
    box.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => b.addEventListener("click", async () => { await deleteScenario(list[Number(b.dataset.del)]); drawSaves(); }));
    box.querySelector("#logout")?.addEventListener("click", async () => { await signOut(); drawSaves(); });
    box.querySelector<HTMLFormElement>("#login")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await sendLoginLink(box.querySelector<HTMLInputElement>("#email")!.value); msg(L("Lien envoyé, vérifiez votre boîte mail.", "Link sent, check your inbox.")); } catch (err) { msg(String((err as Error).message)); }
    });
  };
  if (!authHooked) { authHooked = true; onAuth(() => { if (location.hash.startsWith("#/simulateur")) renderSimulator(app); }); }
  shell();
}
