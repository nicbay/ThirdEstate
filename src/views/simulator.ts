// 2027 scenario planner: three linked panels played by hand, all live.
// 1. Premier tour: one 100 % stacked bar in seating order; drag the dividers (pointer, touch or
//    keyboard) to move points between neighbours, or type a score (the difference is spread over the
//    politically closest candidates). Presets are built from the candidates pollsters actually test.
// 2. Reports de voix: each eliminated candidate's voters split three ways (finalist A / no vote /
//    finalist B) on a bar with two handles; defaults from the 2022 transfer survey (lib/transfers.ts).
// 3. Second tour: finalists follow the top two (or are picked by hand), the runoff result, the
//    chance of that result given polling error, the scenario's probability from the 20,000-run
//    simulation (lib/scenario-odds.ts), and what the betting markets say.
// Every scenario lives in the URL (#/simulateur/<code>, same code as before) and can be saved and compared.
import { loadMarkets, loadPolls } from "../data";
import { combineOdds, oddsFor, platformShare, winShare } from "../lib/markets";
import { dec, pair100, pct, pts, signed } from "../lib/format";
import { ROUND1_SD, ROUND2_SD, RUNS, buildModel, normCdf, oddsSentence } from "../lib/scenario-odds";
import { L, colon, fmtDate, getLang } from "../i18n";
import { BLOCS, meta, registerParties, spectrumRank, type Bloc } from "../lib/candidates";
import { average, duelAverages, referenceLineup } from "../lib/polls";
import { defaultTransfer } from "../lib/forecast";
import { SURVEY_SOURCE, TRANSFER_PRESETS, rnSide, transferFor, type Side, type Transfer, type TransferPreset } from "../lib/transfers";
import { cloudEnabled, currentUser, deleteScenario, listScenarios, onAuth, saveScenario, sendLoginLink, signOut, type SavedScenario } from "../lib/cloud";
import { esc, safeColor } from "../util";
import "../styles/simulator.css";

interface Cand { name: string; share: number; bloc: Bloc | null }
interface Scenario {
  cands: Cand[];
  /** [A, B], A the further left: transfers are [% to A, % to B] */
  finalists: [string, string];
  transfers: Record<string, [number, number]>;
  /** candidates whose transfers were set by hand */
  edited: string[];
  /** finalists picked by hand rather than the top two */
  manual?: boolean;
  /** transfer rule for candidates not set by hand */
  tp?: TransferPreset;
  /** first-round preset this field came from, until the first edit */
  p1?: string;
  /** runoff turnout of the eliminated candidates' voters, in % of the transfer rule (50–110; absent = 100) */
  mob?: number;
}

let state: Scenario | null = null;
/** Undo / redo: scenarios as JSON, kept across re-renders of the page. */
let undoStack: string[] = [], redoStack: string[] = [];
/** A scenario pinned for side-by-side comparison (this visit only; saved scenarios live below). */
let pinned: Scenario | null = null;
let lastNudge = 0, lastNudgeKey = "";
let authHooked = false;
/** Saved scenarios ticked for comparison (ids; "now" = the scenario on screen). */
const compare = new Set<string>(["now"]);
let dockObserver: IntersectionObserver | null = null;
/** Always in the default line-up when they are polled. */
const LIKELY = ["David Lisnard"];
const GREY = "#c4c7cc";
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sum = (cs: Cand[]) => cs.reduce((t, c) => t + c.share, 0);
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const byRank = (a: Cand, b: Cand) => spectrumRank(a.name) - spectrumRank(b.name);
const color = (n: string) => safeColor(meta(n).color, "#9aa0aa");

// Default transfer assumption by political distance (lib/forecast.ts), used here for "how close" two candidates are.
const AFFINITY = [0.85, 0.5, 0.4, 0.15, 0.15];
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
    const tw = w.reduce((x, y) => x + y, 0);
    if (!tw) break;
    let used = 0;
    pool.forEach((c, i) => {
      const next = Math.max(0, c.share - (left * w[i]) / tw);
      used += c.share - next;
      c.share = r1(next);
    });
    left -= used;
  }
}
/** Rounding leaves a few tenths over or under 100: give them to (or take them from) the largest candidate. */
function fixDrift(cands: Cand[], keep?: Cand) {
  const diff = r1(100 - sum(cands));
  if (!diff) return;
  const big = cands.filter((c) => c !== keep).sort((a, b) => b.share - a.share)[0];
  if (big) big.share = r1(Math.max(0, big.share + diff));
}
function normalise(cands: Cand[]) {
  const t = sum(cands);
  if (!t) return;
  for (const c of cands) c.share = r1((100 * c.share) / t);
  fixDrift(cands);
}

// ---------- share codes: base64url JSON, the same format as the earlier simulator ----------
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
  const seen = new Set<string>();
  const cands: Cand[] = raw.cands
    .map((c: any) => ({ name: str(c?.name), share: num(c?.share, 0, 100), bloc: Number.isInteger(c?.bloc) && c.bloc >= 0 && c.bloc < BLOCS.length ? (c.bloc as Bloc) : null }))
    .filter((c: Cand) => c.name && !seen.has(c.name) && seen.add(c.name));
  const names = new Set(cands.map((c) => c.name));
  const finalists = (Array.isArray(raw.finalists) ? raw.finalists.map(str) : []).filter((n: string) => names.has(n));
  if (finalists.length !== 2 || finalists[0] === finalists[1]) return null;
  const transfers: Record<string, [number, number]> = {};
  for (const [k, v] of Object.entries(raw.transfers ?? {})) {
    if (!names.has(k) || !Array.isArray(v)) continue;
    const a = num(v[0], 0, 100);
    transfers[k] = [a, Math.min(num(v[1], 0, 100), 100 - a)];
  }
  const edited = (Array.isArray(raw.edited) ? raw.edited.map(str) : []).filter((n: string) => names.has(n) && transfers[n]);
  const tp = TRANSFER_PRESETS.includes(raw.tp) ? (raw.tp as TransferPreset) : undefined;
  // codes from the earlier simulator carry no "manual" flag: finalists other than the top two were picked by hand
  const top = [...cands].sort((a, b) => b.share - a.share).slice(0, 2).map((c) => c.name);
  const manual = typeof raw.manual === "boolean" ? raw.manual : !finalists.every((n: string) => top.includes(n));
  const mob = raw.mob == null ? 100 : Math.round(num(raw.mob, 50, 110));
  return { cands, finalists: [finalists[0], finalists[1]], transfers, edited, manual, tp, p1: str(raw.p1) || undefined, ...(mob !== 100 ? { mob } : {}) };
}
const decode = (t: string): Scenario | null => {
  try {
    return sanitizeScenario(JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/"))))));
  } catch {
    return null;
  }
};
const shareUrl = (s: Scenario) => `${location.origin}${location.pathname}#/simulateur/${encode(s)}`;

/** First-round votes → runoff: each finalist's votes, the lost votes, and every flow. */
function outcome(s: Scenario) {
  const [fa, fb] = s.finalists;
  const total = sum(s.cands) || 1;
  let va = 0, vb = 0, lost = 0;
  const flows: { from: Cand; to: "a" | "b" | "x"; v: number }[] = [];
  for (const c of [...s.cands].sort(byRank)) {
    if (c.name === fa) { va += c.share; flows.push({ from: c, to: "a", v: c.share }); continue; }
    if (c.name === fb) { vb += c.share; flows.push({ from: c, to: "b", v: c.share }); continue; }
    const [ta, tb] = s.transfers[c.name] ?? [35, 35];
    // turnout of these voters in the runoff scales both transfers alike (never past 100 % of the electorate)
    const k = Math.min((s.mob ?? 100) / 100, 100 / (ta + tb || 1));
    const a = (c.share * ta * k) / 100, b = (c.share * tb * k) / 100, x = Math.max(0, c.share - a - b);
    va += a; vb += b; lost += x;
    flows.push({ from: c, to: "a", v: a }, { from: c, to: "x", v: x }, { from: c, to: "b", v: b });
  }
  const pa = (100 * va) / (va + vb || 1);
  // shown to one decimal, the two sides add up to exactly 100
  const ra = Math.round(10 * pa) / 10, rb = (1000 - Math.round(10 * pa)) / 10;
  return { va, vb, lost, total, pa, ra, rb, flows, winner: pa >= 50 ? fa : fb, loser: pa >= 50 ? fb : fa };
}

/** A small SVG patcher: same keys → attributes updated in place (so CSS can animate them), else redrawn. */
interface Item { k: string; tag: "path" | "rect" | "text"; a: Record<string, string | number>; text?: string }
function patch(svg: SVGSVGElement, items: Item[]) {
  const keys = items.map((i) => `${i.tag}:${i.k}`).join("\n");
  if (svg.dataset.keys !== keys) {
    svg.innerHTML = items.map((i) => `<${i.tag} ${Object.entries(i.a).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}>${i.text != null ? esc(i.text) : ""}</${i.tag}>`).join("");
    svg.dataset.keys = keys;
    return;
  }
  items.forEach((it, n) => {
    const el = svg.children[n];
    for (const [k, v] of Object.entries(it.a)) if (el.getAttribute(k) !== String(v)) el.setAttribute(k, String(v));
    if (it.text != null && el.textContent !== it.text) el.textContent = it.text;
  });
}

export async function renderSimulator(app: HTMLElement, shared?: string) {
  const [polls, markets] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null)]);
  const odds = combineOdds(markets?.markets ?? []);
  registerParties(polls.parties);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const avg = average(polls.firstRound, latest, undefined, 0);
  const avgOf = (n: string) => avg.find((r) => r.name === n)?.avg;
  // Substitutes pollsters stopped testing (Bardella for Le Pen): their average over every poll that tested them.
  const allTime = average(polls.firstRound, latest, 100000, 0);
  const swapOf = (n: string) => avgOf(n) ?? allTime.find((r) => r.name === n)?.avg;
  const duels = duelAverages(polls.secondRound).filter((d) => !d.stale);
  const lineup = referenceLineup(polls.firstRound, latest);
  const fr = getLang() === "fr";
  const side = (c: Cand | undefined): Side => ({ bloc: c?.bloc ?? null, party: c ? meta(c.name).party : null });
  const surname = (n: string) => meta(n).surname;

  // ---- probability model, from the polls only (unchanged): most-tested line-up + runoff polls or the transfer model
  const modelBase = () => {
    const cands: Cand[] = lineup.rows.map((r) => ({ name: r.name, share: r1(r.share), bloc: meta(r.name).bloc }));
    // Likely candidates the most-tested line-up leaves out (e.g. David Lisnard, second favourite on
    // the betting markets): add them at their polling average, taking the points from their neighbours.
    for (const name of LIKELY) {
      if (cands.some((c) => c.name === name)) continue;
      const share = r1(avgOf(name) ?? 0);
      if (!share) continue;
      const c = { name, share, bloc: meta(name).bloc };
      cands.push(c);
      rebalance(cands, c, share);
    }
    return cands;
  };
  const baseline = modelBase();
  const baseShare = (n: string) => baseline.find((c) => c.name === n);
  const runoffShare = (a: string, b: string) => {
    const d = duels.find((x) => pairKey(x.winner, x.loser) === pairKey(a, b));
    if (d) return d.winner === a ? (100 * d.pw) / (d.pw + d.pl) : (100 * d.pl) / (d.pw + d.pl);
    const A = baseShare(a), B = baseShare(b);
    if (!A || !B) return 50;
    let va = A.share, vb = B.share;
    for (const c of baseline) if (c !== A && c !== B) { const [ta, tb] = defaultTransfer(c.bloc, A.bloc, B.bloc); va += (c.share * ta) / 100; vb += (c.share * tb) / 100; }
    return (100 * va) / (va + vb);
  };
  const model = buildModel(baseline.map((c) => ({ name: c.name, share: c.share })), runoffShare);
  /** P(this pair, this winner) from the simulation, with the Monte Carlo 95 % range; null if a finalist isn't in the model. */
  const scenarioOdds = (s: Scenario) => {
    const o = outcome(s);
    if (!s.finalists.every((n) => baseShare(n))) return null;
    const p1 = model.pRound1(s.finalists[0], s.finalists[1]), p2 = model.pRound2(o.winner, o.loser);
    const se = 1.96 * Math.sqrt((p1 * (1 - p1)) / RUNS);
    return { p1, p2, p: p1 * p2, lo: Math.max(0, p1 - se) * p2, hi: Math.min(1, p1 + se) * p2 };
  };
  const show = (x: number) => (x > 0.99 ? L("plus de 99 %", "over 99%") : x < 0.0001 ? L("moins de 0,01 %", "under 0.01%") : x < 0.01 ? pct(x * 100, 2) : pct(x * 100, 0));

  // ---- first-round presets, from the candidates pollsters test
  const pollAverage = (): Cand[] => {
    const names = lineup.rows.map((r) => r.name);
    for (const n of LIKELY) if (!names.includes(n) && avgOf(n)) names.push(n);
    const cands = names.map((n) => ({ name: n, share: avgOf(n) ?? lineup.rows.find((r) => r.name === n)?.share ?? 0, bloc: meta(n).bloc }));
    normalise(cands);
    return cands;
  };
  const reference = pollAverage();
  const refShare = (n: string) => reference.find((c) => c.name === n)?.share ?? swapOf(n) ?? 0;
  const merge = (pick: (c: Cand) => boolean) => () => {
    const cands = pollAverage();
    const group = cands.filter(pick);
    if (group.length < 2) return null;
    const lead = group.reduce((a, b) => (b.share > a.share ? b : a));
    lead.share = r1(sum(group));
    return cands.filter((c) => !group.includes(c) || c === lead);
  };
  const swap = (out: string, inn: string) => () => {
    const cands = pollAverage();
    const i = cands.findIndex((c) => c.name === out);
    const target = swapOf(inn);
    if (i < 0 || target == null) return null;
    const c: Cand = { name: inn, share: cands[i].share, bloc: meta(inn).bloc };
    cands[i] = c;
    const delta = target - c.share;
    c.share = r1(target);
    rebalance(cands, c, delta);
    fixDrift(cands, c);
    return cands;
  };
  const leftNames = (cs: Cand[], pick: (c: Cand) => boolean) => cs.filter(pick).sort((a, b) => b.share - a.share).map((c) => surname(c.name));
  const isLeft = (c: Cand) => (c.bloc === 0 || c.bloc === 1) && !["LO", "NPA"].includes(meta(c.name).party ?? "");
  const P1: { key: string; fr: string; en: string; hint: string; build: () => Cand[] | null }[] = [
    { key: "avg", fr: "Moyenne des sondages", en: "Polling average", hint: L("21 jours", "21 days"), build: pollAverage },
    { key: "left", fr: "Union de la gauche", en: "United left", hint: leftNames(reference, isLeft)[0] ?? "", build: merge(isLeft) },
    { key: "right", fr: "Droite unie", en: "United right", hint: leftNames(reference, (c) => c.bloc === 3)[0] ?? "", build: merge((c) => c.bloc === 3) },
    { key: "centre", fr: "Centre uni", en: "United centre", hint: leftNames(reference, (c) => c.bloc === 2)[0] ?? "", build: merge((c) => c.bloc === 2) },
  ];
  // Swaps: a polled alternative from the same family (Bardella for Le Pen, Attal for Philippe…), tested often enough to matter.
  // Swaps: Bardella for Le Pen whenever he has ever been polled, plus the strongest same-family
  // alternative tested in the current window (Attal for Philippe…).
  const swaps: { out: string; inn: string; avg: number }[] = [];
  if (reference.some((c) => c.name === "Marine Le Pen") && swapOf("Jordan Bardella")) swaps.push({ out: "Marine Le Pen", inn: "Jordan Bardella", avg: swapOf("Jordan Bardella")! });
  const alt = reference
    .flatMap((x) => avg.filter((y) => y.avg >= 5 && !reference.some((c) => c.name === y.name) && meta(y.name).bloc != null && meta(y.name).bloc === x.bloc && (x.bloc === 2 || meta(y.name).party === meta(x.name).party)).map((y) => ({ out: x.name, inn: y.name, avg: y.avg })))
    .sort((a, b) => b.avg - a.avg)[0];
  if (alt && !swaps.some((w) => w.inn === alt.inn)) swaps.push(alt);
  for (const w of swaps) {
    const rn = w.out === "Marine Le Pen";
    P1.push({ key: `swap:${w.inn}`, fr: rn ? `Sans Le Pen (${surname(w.inn)})` : `${surname(w.inn)} plutôt que ${surname(w.out)}`, en: rn ? `Without Le Pen (${surname(w.inn)})` : `${surname(w.inn)} instead of ${surname(w.out)}`, hint: `${surname(w.inn)} ${pct(w.avg, 0)}`, build: swap(w.out, w.inn) });
  }
  const presets1 = P1.filter((p) => p.build());

  const TP: Record<TransferPreset, { fr: string; en: string }> = {
    "2022": { fr: "Reports de 2022", en: "2022 transfers" },
    front: { fr: "Front républicain", en: "Republican front" },
    fissure: { fr: "Front républicain fissuré", en: "Cracked republican front" },
    prox: { fr: "Proximité politique", en: "Political proximity" },
  };

  // ---- state
  /** A whole scenario from a first-round field: top two qualify, transfers by the given rule. */
  const make = (cands: Cand[], tp: TransferPreset = "2022", p1?: string, mob?: number): Scenario => {
    const top = [...cands].sort((a, b) => b.share - a.share);
    const sc: Scenario = { cands, finalists: [top[0].name, top[1].name], transfers: {}, edited: [], tp, p1, ...(mob && mob !== 100 ? { mob } : {}) };
    orderFinalists(sc);
    fillFor(sc);
    return sc;
  };
  const fresh = (): Scenario => make(pollAverage(), "2022", "avg");
  /** Transfers of every eliminated candidate not set by hand, from the scenario's rule. */
  function fillFor(sc: Scenario) {
    const of = (n: string) => sc.cands.find((c) => c.name === n);
    const [a, b] = sc.finalists.map((n) => side(of(n)));
    for (const c of sc.cands) if (!sc.finalists.includes(c.name) && (!sc.edited.includes(c.name) || !sc.transfers[c.name])) sc.transfers[c.name] = transferFor(sc.tp ?? "2022", side(c), a, b).t;
    for (const n of Object.keys(sc.transfers)) if (!of(n) || sc.finalists.includes(n)) delete sc.transfers[n];
  }
  /** A = the further left, so the duel bar reads left → right like the first-round bar. Swaps transfers to match. */
  function orderFinalists(s: Scenario) {
    if (spectrumRank(s.finalists[0]) <= spectrumRank(s.finalists[1])) return;
    s.finalists = [s.finalists[1], s.finalists[0]];
    for (const k of Object.keys(s.transfers)) s.transfers[k] = [s.transfers[k][1], s.transfers[k][0]];
  }
  if (shared) state = decode(shared) ?? state;
  state ??= fresh();
  const s = state;
  orderFinalists(s);
  s.tp ??= "2022";
  const cand = (n: string) => s.cands.find((c) => c.name === n);
  const transferInfo = (c: Cand): Transfer & { edited: boolean } => {
    const [a, b] = s.finalists.map((n) => side(cand(n)));
    const t = transferFor(s.tp ?? "2022", side(c), a, b);
    return { ...t, t: s.transfers[c.name] ?? t.t, edited: s.edited.includes(c.name) };
  };
  const fillTransfers = () => fillFor(s);

  // ---- ready-made scenarios: a first-round field, a transfer rule, sometimes a turnout; each one explained in a line
  const baseSc = fresh();
  const hasRn = (sc: Scenario) => rnSide(side(sc.cands.find((c) => c.name === sc.finalists[0])), side(sc.cands.find((c) => c.name === sc.finalists[1]))) != null;
  const WHY: Record<string, [string, string]> = {
    avg: ["Chaque candidat à sa moyenne des sondages des 21 derniers jours.", "Every candidate at their 21-day polling average."],
    left: ["La gauche hors extrême gauche derrière son mieux placé, qui additionne leurs voix : une hypothèse haute.", "The left (far left aside) behind its best-placed candidate, who adds up their votes: an upper bound."],
    right: ["La droite derrière son mieux placé, qui additionne leurs voix : une hypothèse haute.", "The right behind its best-placed candidate, who adds up their votes: an upper bound."],
    centre: ["Le centre derrière son mieux placé, qui additionne leurs voix : une hypothèse haute.", "The centre behind its best-placed candidate, who adds up their votes: an upper bound."],
  };
  interface Ready { key: string; title: string; why: string; sc: Scenario }
  const gallery: Ready[] = [
    ...presets1.flatMap((p): Ready[] => {
      const cands = p.build();
      if (!cands) return [];
      const w = swaps.find((x) => `swap:${x.inn}` === p.key);
      const why = WHY[p.key] ? L(...WHY[p.key]) : w ? L(`${surname(w.inn)} à la place de ${surname(w.out)}, à sa moyenne dans les sondages qui l’ont testé.`, `${surname(w.inn)} in place of ${surname(w.out)}, at their average in the polls that tested them.`) : "";
      return [{ key: p.key, title: fr ? p.fr : p.en, why, sc: make(cands, "2022", p.key) }];
    }),
    ...(hasRn(baseSc) ? [
      { key: "front", title: L("Front républicain", "Republican front"), why: L("Les électeurs des éliminés se reportent massivement contre le finaliste de la droite nationale.", "Eliminated candidates’ voters swing heavily against the nationalist-right finalist."), sc: make(pollAverage(), "front", "avg") },
      { key: "fissure", title: L("Front républicain fissuré", "Cracked republican front"), why: L("Les mêmes reports, mais plus faibles et plus partagés.", "The same transfers, but weaker and more evenly split."), sc: make(pollAverage(), "fissure", "avg") },
    ] : []),
    { key: "abst", title: L("Second tour boudé", "A shunned runoff"), why: L("Trois électeurs des éliminés sur dix qui se seraient reportés restent chez eux.", "Three in ten eliminated-candidate voters who would have transferred stay home."), sc: make(pollAverage(), "2022", "avg", 70) },
  ];
  /** What makes two scenarios "the same" for the gallery's pressed state. */
  const sig = (sc: Scenario) => `${[...sc.cands].sort((a, b) => a.name.localeCompare(b.name)).map((c) => `${c.name}:${c.share}`).join(",")}|${sc.finalists.join("+")}|${sc.tp}|${sc.mob ?? 100}|${sc.edited.length}`;
  const gallerySig = gallery.map((g) => sig(g.sc));
  const setFinalists = (a: string, b: string) => {
    if (pairKey(a, b) === pairKey(...s.finalists)) return false;
    s.finalists = [a, b];
    s.edited = [];
    s.transfers = {};
    orderFinalists(s);
    fillTransfers();
    return true;
  };
  /** Finalists follow the top two unless picked by hand. True when they changed. */
  const autoFinalists = () => {
    if (s.manual) return false;
    const top = [...s.cands].sort((a, b) => b.share - a.share);
    return top.length >= 2 && setFinalists(top[0].name, top[1].name);
  };
  if (!s.finalists.every((n) => cand(n))) { s.manual = false; autoFinalists(); }
  fillTransfers();

  // ---------- page ----------
  dockObserver?.disconnect();
  app.innerHTML = `
    <section class="page sim-page">
      <header class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027, simulateur", "2027 presidential, simulator")}</p>
        <h1>${L("Présidentielle 2027, à vous de jouer", "The 2027 election, your call")}</h1>
        <p class="dek">${L("Et si la gauche s’unissait, si un candidat se retirait, si les reports de voix changeaient ? Partez d’un scénario tout prêt ou déplacez les chiffres : qui se qualifie et qui gagne se recalculent à chaque geste.", "What if the left united, a candidate withdrew, or vote transfers shifted? Start from a ready-made scenario or move the numbers: who qualifies and who wins are recomputed at every touch.")}</p>
      </header>
      <div class="sim-app" id="sim-app">
        <section class="sim-ready" aria-labelledby="sim-t0">
          <h2 class="sim-k" id="sim-t0">${L("Partir d’un scénario", "Start from a scenario")}</h2>
          <div class="sim-gallery" id="sim-gallery" role="group" aria-labelledby="sim-t0">${gallery.map((g, i) => {
            const o = outcome(g.sc);
            return `<button type="button" class="sim-card" data-g="${i}" aria-pressed="false" style="--a:${color(g.sc.finalists[0])};--b:${color(g.sc.finalists[1])}">
              <b>${esc(g.title)}</b><span class="sim-card-why">${esc(g.why)}</span>
              <span class="sim-card-duel" aria-hidden="true"><i style="width:${o.pa}%"></i><i style="width:${100 - o.pa}%"></i></span>
              <span class="sim-card-res"><span>${esc(surname(g.sc.finalists[0]))} – ${esc(surname(g.sc.finalists[1]))}</span><strong>${esc(surname(o.winner))} ${pct(Math.max(o.ra, o.rb))}</strong></span>
            </button>`;
          }).join("")}</div>
        </section>
        <section class="sim-story" id="sim-story" aria-label="${L("Le scénario en trois temps", "The scenario in three steps")}">
          <ol class="sim-steps">
            <li><span class="sim-k">1 · ${L("Premier tour", "First round")}</span><p id="st-1"></p></li>
            <li><span class="sim-k">2 · ${L("Qualifiés", "Through")}</span><p id="st-2"></p></li>
            <li class="is-res"><span class="sim-k">3 · ${L("Second tour", "Runoff")}</span><p id="st-3"></p></li>
          </ol>
          <div class="sim-tools" role="toolbar" aria-label="${L("Outils du scénario", "Scenario tools")}">
            <button type="button" class="sim-tool" data-tool="undo" title="Ctrl+Z">${L("Annuler", "Undo")}</button>
            <button type="button" class="sim-tool" data-tool="redo" title="Ctrl+Y">${L("Rétablir", "Redo")}</button>
            <button type="button" class="sim-tool" data-tool="reset">${L("Sondages du jour", "Today’s polls")}</button>
            <button type="button" class="sim-tool" data-tool="pin" aria-pressed="false">${L("Épingler pour comparer", "Pin to compare")}</button>
            <button type="button" class="sim-tool ink" data-tool="share">${L("Copier le lien", "Copy link")}</button>
          </div>
        </section>
        <section class="sim-panel sim-p1" aria-labelledby="sim-t1">
          <header class="sim-ph"><span class="sim-no" aria-hidden="true">1</span><h2 id="sim-t1">${L("Premier tour", "First round")}</h2><span class="sim-total" id="p1-total"></span></header>
          <div class="sim-bar" id="p1-bar" data-drag="p1"></div>
          <div class="sim-axis" aria-hidden="true"><span>← ${L("Gauche", "Left")}</span><span>${L("Glissez les séparations · touchez un nom pour un chiffre précis", "Drag the dividers · tap a name for an exact figure")}</span><span>${L("Droite", "Right")} →</span></div>
          <ul class="sim-cands" id="p1-cands"></ul>
          <div class="sim-foot"><select id="p1-add" class="sim-select" aria-label="${L("Ajouter un candidat", "Add a candidate")}"></select><button type="button" class="sim-btn" id="p1-reset">${L("Repartir des sondages", "Reset to polls")}</button></div>
        </section>
        <section class="sim-panel sim-p2" aria-labelledby="sim-t2">
          <header class="sim-ph"><span class="sim-no" aria-hidden="true">2</span><h2 id="sim-t2">${L("Reports de voix", "Vote transfers")}</h2></header>
          <p class="sim-lede">${L("Où vont les électeurs des candidats éliminés ? Choisissez une règle, puis ajustez candidat par candidat : chaque ligne dit si le chiffre est mesuré, supposé, ou le vôtre.", "Where do the eliminated candidates’ voters go? Pick a rule, then adjust candidate by candidate: each row says whether the figure is measured, assumed, or yours.")}</p>
          <div class="sim-presets" id="p2-presets" role="group" aria-label="${L("Hypothèses de report", "Transfer assumptions")}"></div>
          <div class="sim-mob">
            <label for="p2-mob"><b>${L("Mobilisation des électeurs des éliminés", "Turnout of eliminated candidates’ voters")}</b><output id="p2-mob-v" for="p2-mob"></output></label>
            <input type="range" id="p2-mob" min="50" max="110" step="5" />
            <p class="sim-note">${L("À 100 %, les reports sont ceux de la règle choisie. À 70 %, trois électeurs sur dix qui se seraient reportés restent chez eux, quel que soit leur candidat.", "At 100%, transfers are those of the rule picked. At 70%, three in ten voters who would have transferred stay home, whoever their candidate was.")}</p>
          </div>
          <p class="sim-legend" id="p2-legend"></p>
          <ol class="sim-trs" id="p2-rows"></ol>
          <figure class="sim-flowfig">
            <svg id="p2-flow" class="sim-flow" viewBox="0 0 960 440" role="img" aria-label="${L("Flux de voix du premier au second tour", "Vote flows from the first round to the runoff")}"></svg>
            <div id="p2-list" class="flow-list"></div>
          </figure>
          <p class="sim-note">${L("Reports de 2022", "2022 transfers")}${colon()}<a href="${SURVEY_SOURCE.url}" target="_blank" rel="noopener">${esc(fr ? SURVEY_SOURCE.fr : SURVEY_SOURCE.en)}</a>. ${L("Appliqués par famille politique, seulement à un duel de même forme qu’en 2022 (droite nationale contre centre ou droite) ; ailleurs, et pour les familles que l’enquête ne couvre pas, l’hypothèse de proximité politique (même famille 85 %, voisine 50 %, deux crans 40 %, au-delà 15 %). « Front républicain » et sa version fissurée sont des hypothèses en chiffres ronds.", "Applied by political family, only to a duel shaped like 2022 (nationalist right against centre or right); elsewhere, and for families the survey doesn’t cover, the political-proximity assumption (same family 85%, next 50%, two steps 40%, further 15%). “Republican front” and its cracked version are round-number assumptions.")}</p>
        </section>
        <section class="sim-panel sim-p3" id="sim-p3" aria-labelledby="sim-t3">
          <header class="sim-ph"><span class="sim-no" aria-hidden="true">3</span><h2 id="sim-t3">${L("Second tour", "Runoff")}</h2></header>
          <div class="sim-pick" id="p3-pick"></div>
          <div class="sim-res">
            <div class="sim-res-nums"><div class="a"><span id="r-na"></span><strong id="r-va"></strong></div><div class="b"><span id="r-nb"></span><strong id="r-vb"></strong></div></div>
            <div class="sim-duel" id="r-duel" aria-hidden="true"><i class="a" id="r-ba"></i><i class="b" id="r-bb"></i><span class="sim-band" id="r-band"></span><span class="sim-mid"></span></div>
            <p class="sim-res-line" id="r-line"></p>
          </div>
          <div class="sim-kpis">
            <div class="sim-kpi"><strong id="k-win"></strong><span id="k-win-l"></span></div>
            <div class="sim-kpi"><strong id="k-scn"></strong><span>${L("Probabilité de ce scénario selon les sondages", "Chance of this scenario, by the polls")}</span><span class="sim-ci" id="k-ci"></span></div>
          </div>
          <p class="sim-odds" id="r-odds"></p>
          <div class="sim-read"><p class="sim-k">${L("Lecture", "Reading")}</p><p id="sim-read"></p></div>
          <div class="sim-against" id="sim-vs"></div>
          <p class="sim-detail" id="r-detail"></p>
          <div class="sim-mk" id="p3-mk"></div>
          <p class="sim-note">${L(`Fourchette : votre score plus ou moins l’erreur typique d’un duel sondé avant le premier tour (σ = ${ROUND2_SD} points ; 80 % des cas). Probabilité du scénario : selon les sondages actuels, pas vos curseurs (20 000 simulations, chaque candidat pouvant s’écarter de sa moyenne d’environ ${String(ROUND1_SD).replace(".", ",")} points au 1er tour). Estimation indicative.`, `Range: your score plus or minus the typical miss of a runoff poll taken before the first round (σ = ${ROUND2_SD} points; 80% of cases). Scenario probability: from current polls, not your controls (20,000 simulations, each candidate able to miss their average by about ${ROUND1_SD} points in round 1). Indicative estimate.`)}</p>
        </section>
      </div>
      <section class="card sim-saves" id="sim-saves"></section>
    </section>
    <div class="sim-dock" id="sim-dock" hidden aria-hidden="true"><div class="sim-duel sm"><i class="a" id="d-ba"></i><i class="b" id="d-bb"></i><span class="sim-mid"></span></div><p id="d-line"></p></div>
    <p class="sim-sr" id="sim-live" aria-live="polite" aria-atomic="true"></p>`;
  const root = app.querySelector<HTMLElement>("#sim-app")!;
  const $ = <T extends Element = HTMLElement>(sel: string) => app.querySelector<T>(sel)!;

  // ---------- panel 1: structure ----------
  const ordered = () => [...s.cands].sort(byRank);
  const renderP1 = () => {
    const o = ordered();
    $("#p1-bar").innerHTML =
      o.map((c) => `<div class="sim-seg" data-seg="${esc(c.name)}" style="--c:${color(c.name)}"><b>${esc(surname(c.name))}</b><span></span></div>`).join("") +
      o.slice(0, -1).map((c, i) => `<span class="sim-hd" role="slider" tabindex="0" data-hk="p1:${i}" aria-label="${esc(L(`Séparation ${surname(c.name)} / ${surname(o[i + 1].name)}`, `Divider ${surname(c.name)} / ${surname(o[i + 1].name)}`))}" aria-valuemin="0"></span>`).join("");
    $("#p1-cands").innerHTML = o
      .map((c) => {
        const m = meta(c.name);
        return `<li class="sim-cand" data-c="${esc(c.name)}" style="--c:${color(c.name)}">
          <span class="sim-cand-n"><b>${esc(m.surname)}</b>${m.party ? ` <small>${esc(m.party)}</small>` : ""}<em class="sim-q">${L("qualifié", "through")}</em></span>
          <span class="sim-stepper"><button type="button" class="sim-step" data-step="${esc(c.name)}" data-d="-0.5" aria-label="${esc(L(`${c.name} : un demi-point de moins`, `${c.name}: half a point less`))}">−</button>
          <label class="sim-cand-v"><span class="sim-sr">${esc(L(`Score de ${c.name} au premier tour, en %`, `${c.name}’s first-round share, %`))}</span><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="5" data-share="${esc(c.name)}"/><i aria-hidden="true">%</i></label>
          <button type="button" class="sim-step" data-step="${esc(c.name)}" data-d="0.5" aria-label="${esc(L(`${c.name} : un demi-point de plus`, `${c.name}: half a point more`))}">+</button></span>
          <span class="sim-delta" data-delta="${esc(c.name)}"></span>
          <button type="button" class="sim-x" data-remove="${esc(c.name)}" title="${esc(L("Se retire : ses voix vont aux candidats les plus proches", "Withdraws: their votes go to the closest candidates"))}" aria-label="${esc(L(`${c.name} se retire`, `${c.name} withdraws`))}" ${s.cands.length <= 2 ? "disabled" : ""}>×</button>
        </li>`;
      })
      .join("");
    const addable = avg.filter((r) => !cand(r.name));
    $("#p1-add").innerHTML = `<option value="">+ ${L("Ajouter un candidat testé", "Add a polled candidate")}</option>${addable.map((r) => `<option value="${esc(r.name)}">${esc(r.name)} (${pct(r.avg)})</option>`).join("")}`;
    ($("#p1-add") as HTMLSelectElement).disabled = !addable.length;
  };

  // ---------- panel 2: structure ----------
  const eliminated = () => s.cands.filter((c) => !s.finalists.includes(c.name)).sort((a, b) => b.share - a.share);
  const srcLabel = (t: Transfer & { edited: boolean }) =>
    t.edited ? L("votre hypothèse", "your assumption") : t.src === "survey" ? `${L("mesuré", "measured")} · Ipsos 2022, ${t.who}` : t.src === "survey-partial" ? `${L("mesuré en partie", "partly measured")} · Ipsos 2022, ${t.who}` : t.src === "prox" ? L("hypothèse · proximité", "assumption · proximity") : L("hypothèse · chiffres ronds", "assumption · round numbers");
  const renderP2 = () => {
    const [fa, fb] = s.finalists;
    const rn = rnSide(side(cand(fa)), side(cand(fb)));
    $("#p2-presets").innerHTML = TRANSFER_PRESETS.map((k) => {
      const off = (k === "front" || k === "fissure") && rn == null;
      return `<button type="button" class="sim-chipbtn" data-tp="${k}" aria-pressed="${s.tp === k && !s.edited.length}" ${off ? `disabled title="${esc(L("Il faut un finaliste de la droite nationale", "Needs a nationalist-right finalist"))}"` : ""}>${esc(fr ? TP[k].fr : TP[k].en)}</button>`;
    }).join("");
    $("#p2-legend").innerHTML = `<span style="--c:${color(fa)}">→ ${esc(surname(fa))}</span><span style="--c:${GREY}">${L("abstention, blanc, nul", "no vote, blank, void")}</span><span style="--c:${color(fb)}">→ ${esc(surname(fb))}</span>`;
    const blocName = (b: number) => (fr ? BLOCS[b].fr : BLOCS[b].en);
    $("#p2-rows").innerHTML = eliminated()
      .map((c) => {
        const n = esc(c.name), sn = esc(surname(c.name));
        return `<li class="sim-tr" data-tr="${n}" style="--c:${color(c.name)}">
          <div class="sim-tr-h"><b>${sn}</b><span class="sim-tr-share" data-trs="${n}"></span><span class="sim-src" data-src="${n}"></span><button type="button" class="sim-undo1" data-unedit="${n}" hidden aria-label="${esc(L(`Revenir à la règle pour ${c.name}`, `Back to the rule for ${c.name}`))}">${L("revenir à la règle", "back to the rule")}</button>
            ${meta(c.name).bloc == null ? `<select class="sim-select sm" data-bloc="${n}" aria-label="${esc(L(`Famille politique de ${c.name}`, `${c.name}’s political family`))}"><option value="">${L("Famille ?", "Family?")}</option>${BLOCS.map((_, i) => `<option value="${i}" ${c.bloc === i ? "selected" : ""}>${blocName(i)}</option>`).join("")}</select>` : ""}</div>
          <div class="sim-split" data-drag="tr:${n}">
            <i class="a" style="background:${color(fa)}"><span></span></i><i class="x"><span></span></i><i class="b" style="background:${color(fb)}"><span></span></i>
            <span class="sim-hd" role="slider" tabindex="0" data-hk="tr:${n}:0" aria-label="${esc(L(`Électeurs de ${surname(c.name)} vers ${surname(fa)}`, `${surname(c.name)} voters to ${surname(fa)}`))}" aria-valuemin="0"></span>
            <span class="sim-hd" role="slider" tabindex="0" data-hk="tr:${n}:1" aria-label="${esc(L(`Électeurs de ${surname(c.name)} vers ${surname(fb)}`, `${surname(c.name)} voters to ${surname(fb)}`))}" aria-valuemin="0"></span>
          </div>
          <div class="sim-tr-v">
            <label style="--c:${color(fa)}"><span>→ ${esc(surname(fa))}</span><input type="number" inputmode="numeric" min="0" max="100" step="1" data-tv="${n}:0"/><i>%</i></label>
            <span class="sim-abst" data-abst="${n}"></span>
            <label style="--c:${color(fb)}"><span>→ ${esc(surname(fb))}</span><input type="number" inputmode="numeric" min="0" max="100" step="1" data-tv="${n}:1"/><i>%</i></label>
          </div>
        </li>`;
      })
      .join("") || `<li class="sim-note">${L("Aucun candidat éliminé : ajoutez des candidats au premier tour.", "No eliminated candidate: add candidates to the first round.")}</li>`;
  };

  // ---------- panel 3: structure ----------
  const renderP3 = () => {
    const [fa, fb] = s.finalists;
    const opts = (sel: string) => ordered().map((c) => `<option value="${esc(c.name)}" ${c.name === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    $("#p3-pick").innerHTML = `
      <label><span class="sim-sr">${L("Finaliste de gauche du duel", "Left-hand finalist")}</span><select class="sim-select" id="f-a">${opts(fa)}</select></label>
      <span class="sim-vs">${L("contre", "vs")}</span>
      <label><span class="sim-sr">${L("Finaliste de droite du duel", "Right-hand finalist")}</span><select class="sim-select" id="f-b">${opts(fb)}</select></label>
      <button type="button" class="sim-chipbtn" id="f-auto" aria-pressed="${!s.manual}">${L("Les deux premiers", "Top two")}</button>`;
    const poll = duels.find((d) => pairKey(d.winner, d.loser) === pairKey(fa, fb));
    const pp = poll ? pair100(poll.pw, poll.pl) : null;
    const pollLine = poll && pp ? `${L("Les sondages sur ce duel donnent", "Polls of this match-up give")} ${esc(surname(poll.winner))} ${pp[0]}–${pp[1]} (${poll.total} ${L("sondages", "polls")}, ${L("dernier le", "latest")} ${fmtDate(poll.last)}).` : L("Aucun sondage récent n’a testé ce duel.", "No recent poll has tested this match-up.");
    $("#p3-pick").dataset.poll = pollLine;
    // markets
    const oa = oddsFor(odds, fa), ob = oddsFor(odds, fb);
    const pc = (v?: number | null) => (v == null ? "–" : pct(v, 0));
    const row = (n: string, o: typeof oa) => `<tr style="--c:${color(n)}"><th scope="row">${esc(surname(n))}</th><td>${pc(winShare(odds, o))}</td><td>${o ? pc(platformShare(odds, o, "kalshi")) : "–"}</td><td>${o ? pc(platformShare(odds, o, "polymarket")) : "–"}</td><td>${pc(o?.runoff?.avg)}</td></tr>`;
    const wa = winShare(odds, oa), wb = winShare(odds, ob);
    const lean = wa != null && wb != null && wa + wb > 0 ? pair100(wa, wb) : null;
    $("#p3-mk").innerHTML = odds.length
      ? `<p class="sim-mk-h"><b>${L("Ce que parient les marchés", "What the betting markets say")}</b> <span>Kalshi, Polymarket${markets?.fetchedAt ? `, ${fmtDate(markets.fetchedAt)}` : ""}</span></p>
         <table class="sim-mk-t"><thead><tr><th></th><th>${L("Victoire", "Win")}</th><th>Kalshi</th><th>Polym.</th><th>${L("2nd tour", "Runoff")}</th></tr></thead><tbody>${row(fa, oa)}${row(fb, ob)}</tbody></table>
         <p class="sim-mk-lean" id="mk-lean" data-lean="${lean ? lean.join(",") : ""}"></p>`
      : "";
  };

  // ---------- live updates (never rebuild inputs, so dragging stays smooth) ----------
  let liveTimer = 0, urlTimer = 0;
  const update = () => {
    const o = ordered();
    const bar = $("#p1-bar");
    const W = bar.clientWidth || 1;
    // panel 1
    let cum = 0;
    o.forEach((c) => {
      const seg = bar.querySelector<HTMLElement>(`[data-seg="${CSS.escape(c.name)}"]`);
      if (!seg) return;
      seg.style.width = `${c.share}%`;
      const px = (W * c.share) / 100;
      seg.classList.toggle("is-narrow", px < 64);
      seg.classList.toggle("is-tiny", px < 30);
      seg.classList.toggle("is-fin", s.finalists.includes(c.name));
      seg.querySelector("span")!.textContent = dec(c.share);
    });
    o.slice(0, -1).forEach((c, i) => {
      cum += c.share;
      const h = bar.querySelector<HTMLElement>(`[data-hk="p1:${i}"]`);
      if (!h) return;
      const nx = o[i + 1];
      h.style.left = `${cum}%`;
      h.setAttribute("aria-valuemax", dec(c.share + nx.share).replace(",", "."));
      h.setAttribute("aria-valuenow", String(c.share));
      h.setAttribute("aria-valuetext", `${surname(c.name)} ${pct(c.share)}, ${surname(nx.name)} ${pct(nx.share)}`);
    });
    for (const c of s.cands) {
      const inp = app.querySelector<HTMLInputElement>(`[data-share="${CSS.escape(c.name)}"]`);
      if (inp && document.activeElement !== inp) inp.value = dec(c.share);
      const d = app.querySelector<HTMLElement>(`[data-delta="${CSS.escape(c.name)}"]`);
      if (d) { const v = r1(c.share - refShare(c.name)); d.textContent = v ? signed(v) : "="; d.title = L("Écart à la moyenne des sondages", "Gap to the polling average"); }
      app.querySelector(`[data-c="${CSS.escape(c.name)}"]`)?.classList.toggle("is-fin", s.finalists.includes(c.name));
    }
    const tot = sum(s.cands);
    $("#p1-total").textContent = `${L("Total", "Total")} ${pct(tot)}`;
    $("#p1-total").classList.toggle("warn", Math.abs(tot - 100) > 0.05);

    // panel 2
    for (const c of eliminated()) {
      const n = CSS.escape(c.name);
      const info = transferInfo(c);
      const [ta, tb] = info.t, tx = Math.max(0, 100 - ta - tb);
      const sp = app.querySelector<HTMLElement>(`[data-drag="tr:${n}"]`);
      if (!sp) continue;
      const [ia, ix, ib] = sp.querySelectorAll<HTMLElement>("i");
      ia.style.width = `${ta}%`; ix.style.width = `${tx}%`; ib.style.width = `${tb}%`;
      ia.firstElementChild!.textContent = ta >= 9 ? String(Math.round(ta)) : "";
      ix.firstElementChild!.textContent = tx >= 9 ? String(Math.round(tx)) : "";
      ib.firstElementChild!.textContent = tb >= 9 ? String(Math.round(tb)) : "";
      const [h0, h1] = sp.querySelectorAll<HTMLElement>(".sim-hd");
      h0.style.left = `${ta}%`; h1.style.left = `${100 - tb}%`;
      h0.setAttribute("aria-valuemax", String(100 - tb)); h0.setAttribute("aria-valuenow", String(ta)); h0.setAttribute("aria-valuetext", `${pct(ta, 0)} → ${surname(s.finalists[0])}`);
      h1.setAttribute("aria-valuemax", String(100 - ta)); h1.setAttribute("aria-valuenow", String(tb)); h1.setAttribute("aria-valuetext", `${pct(tb, 0)} → ${surname(s.finalists[1])}`);
      app.querySelectorAll<HTMLInputElement>(`[data-tv^="${n}:"]`).forEach((inp) => { if (document.activeElement !== inp) inp.value = String(inp.dataset.tv!.endsWith(":0") ? ta : tb); });
      $(`[data-abst="${n}"]`).textContent = `${L("abst.", "no vote")} ${pct(tx, 0)}`;
      $(`[data-trs="${n}"]`).textContent = pct(c.share);
      const src = $(`[data-src="${n}"]`);
      src.textContent = srcLabel(info);
      src.dataset.k = info.edited ? "edited" : info.src;
      const back = app.querySelector<HTMLElement>(`[data-unedit="${n}"]`);
      if (back) back.hidden = !info.edited;
    }
    const mobIn = $<HTMLInputElement>("#p2-mob");
    const mob = s.mob ?? 100;
    if (document.activeElement !== mobIn || Number(mobIn.value) !== mob) mobIn.value = String(mob);
    $("#p2-mob-v").textContent = pct(mob, 0);
    mobIn.setAttribute("aria-valuetext", L(`${mob} % des reports de la règle`, `${mob}% of the rule’s transfers`));
    app.querySelectorAll<HTMLButtonElement>("[data-tp]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tp === s.tp && !s.edited.length)));
    app.querySelectorAll<HTMLButtonElement>("[data-p1]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p1 === s.p1)));
    const out = outcome(s);
    drawFlow(out);

    // panel 3
    const [fa, fb] = s.finalists;
    $("#r-na").textContent = surname(fa);
    $("#r-nb").textContent = surname(fb);
    $("#r-va").textContent = dec(out.ra);
    $("#r-vb").textContent = dec(out.rb);
    $(".sim-res-nums .a").classList.toggle("is-win", out.winner === fa);
    $(".sim-res-nums .b").classList.toggle("is-win", out.winner === fb);
    for (const [a, b] of [["#r-ba", "#r-bb"], ["#d-ba", "#d-bb"]]) {
      const ea = $(a), eb = $(b);
      ea.style.width = `${out.pa}%`; ea.style.background = color(fa);
      eb.style.width = `${100 - out.pa}%`; eb.style.background = color(fb);
    }
    const half = 1.2816 * ROUND2_SD;
    const band = $("#r-band");
    band.style.left = `${clamp(out.pa - half, 0, 100)}%`;
    band.style.width = `${clamp(out.pa + half, 0, 100) - clamp(out.pa - half, 0, 100)}%`;
    const wv = Math.max(out.ra, out.rb);
    $("#r-line").innerHTML = `<b>${esc(L(`${out.winner} l’emporte`, `${out.winner} wins`))}</b> ${L("avec", "with")} ${pct(wv)} · ${L("fourchette", "range")} ${dec(clamp(wv - half, 0, 100))}–${dec(clamp(wv + half, 0, 100))} · ${L("abstention et blancs en plus", "extra no-vote")} ${pts(out.lost)}`;
    $("#d-line").innerHTML = `<b>${esc(surname(out.winner))}</b> ${pct(wv)} <span>${L("contre", "vs")} ${esc(surname(out.loser))}</span>`;
    const pw = normCdf((wv - 50) / ROUND2_SD);
    $("#k-win").textContent = show(pw);
    $("#k-win-l").textContent = L(`Chances de victoire de ${surname(out.winner)} avec vos chiffres, compte tenu de l’erreur des sondages`, `${surname(out.winner)}’s chance of winning on your numbers, given polling error`);
    const so = scenarioOdds(s);
    if (so) {
      $("#k-scn").textContent = show(so.p);
      $("#k-ci").textContent = so.p1 > 0 ? (show(so.lo) === show(so.hi) ? L("erreur de simulation négligeable", "simulation error negligible") : `${L("Monte Carlo 95 %", "Monte Carlo 95%")} ${show(so.lo)} – ${show(so.hi)}`) : L(`aucune des ${RUNS.toLocaleString(fr ? "fr-FR" : "en-GB")} simulations`, `none of ${RUNS.toLocaleString("en-GB")} simulations`);
      // p1 = 0 means no simulated run produced this pair: only an upper bound is known
      // (rule of three: < 3/RUNS at 95 % confidence), so the comparison says "less likely than".
      $("#r-odds").textContent = so.p1 > 0 ? oddsSentence(so.p, fr) : oddsSentence((3 / RUNS) * so.p2, fr, true);
      $("#r-detail").innerHTML = `<span><b>${L("1er tour", "Round 1")}</b> ${esc(surname(fa))} ${L("et", "and")} ${esc(surname(fb))} ${L("qualifiés", "qualify")}${colon()}${show(so.p1)}</span><span><b>${L("2nd tour", "Round 2")}</b> ${esc(surname(out.winner))} ${L("l’emporte", "wins")}${colon()}${show(so.p2)}</span><span>${$("#p3-pick").dataset.poll ?? ""}</span>`;
    } else {
      const missing = s.finalists.filter((n) => !baseShare(n)).map(surname).join(", ");
      $("#k-scn").textContent = "—";
      $("#k-ci").textContent = "";
      $("#r-odds").textContent = "";
      $("#r-detail").innerHTML = `<span>${esc(L(`${missing} ne figure pas dans la liste de candidats la plus testée par les sondeurs : la simulation ne peut pas chiffrer ce scénario.`, `${missing} isn’t in the line-up pollsters test most: the simulation can’t price this scenario.`))}</span><span>${$("#p3-pick").dataset.poll ?? ""}</span>`;
    }
    const lean = app.querySelector<HTMLElement>("#mk-lean");
    if (lean) {
      const v = lean.dataset.lean?.split(",").map(Number);
      lean.innerHTML = v?.length === 2
        ? `${L("Entre ces deux-là, les marchés penchent pour", "Between these two, the markets lean to")} <b>${esc(surname(v[0] >= v[1] ? fa : fb))}</b> (${v[0] >= v[1] ? v[0] : v[1]}–${v[0] >= v[1] ? v[1] : v[0]})${L(" ; ", "; ")}${L("votre scénario", "your scenario")}${colon()}<b>${esc(surname(out.winner))}</b>.`
        : "";
    }
    // ---- the story in three steps, the plain-language reading, the comparison
    const rank = [...s.cands].sort((a, b) => b.share - a.share);
    const shareOf = (n: string) => cand(n)?.share ?? 0;
    $("#st-1").innerHTML = rank.slice(0, 4).map((c) => `<span class="${s.finalists.includes(c.name) ? "is-fin" : ""}" style="--c:${color(c.name)}">${esc(surname(c.name))} <b>${dec(c.share)}</b></span>`).join("");
    $("#st-2").innerHTML = `<b>${esc(surname(fa))}</b> ${L("et", "and")} <b>${esc(surname(fb))}</b><small>${so ? `${L("ce duel a lieu dans", "this pairing happens in")} ${show(so.p1)} ${L("des simulations", "of simulations")}` : L("duel hors simulation", "pairing outside the simulation")}${s.manual ? ` · ${L("choisi à la main", "picked by hand")}` : ""}</small>`;
    $("#st-3").innerHTML = `<b style="--c:${color(out.winner)}">${esc(surname(out.winner))} ${pct(wv)}</b><small>${L("gagne dans", "wins in")} ${show(pw)} ${L("des cas avec ces chiffres", "of cases on these numbers")}</small>`;
    const third = rank.find((c) => !s.finalists.includes(c.name));
    const cut = Math.min(shareOf(fa), shareOf(fb));
    const duelPoll = duels.find((d) => pairKey(d.winner, d.loser) === pairKey(fa, fb));
    const polled = duelPoll ? (100 * (duelPoll.winner === out.winner ? duelPoll.pw : duelPoll.pl)) / (duelPoll.pw + duelPoll.pl) : null;
    const gap = polled == null ? 0 : r1(wv - polled);
    $("#sim-read").textContent = [
      L(`${fa} (${pct(shareOf(fa))}) et ${fb} (${pct(shareOf(fb))}) se qualifient`, `${fa} (${pct(shareOf(fa))}) and ${fb} (${pct(shareOf(fb))}) go through`)
        + (s.manual ? L(" : un duel choisi à la main, pas forcément les deux premiers.", ": a pairing picked by hand, not necessarily the top two.") : third ? L(` ; ${third.name} reste à ${pts(r1(cut - third.share))} du second tour.`, `; ${third.name} falls ${pts(r1(cut - third.share))} short of the runoff.`) : "."),
      L(`Les reports apportent ${pts(r1(out.va - shareOf(fa)))} à ${surname(fa)} et ${pts(r1(out.vb - shareOf(fb)))} à ${surname(fb)} ; ${pts(r1(out.lost))} ne vont à aucun des deux.`, `Transfers bring ${pts(r1(out.va - shareOf(fa)))} to ${surname(fa)} and ${pts(r1(out.vb - shareOf(fb)))} to ${surname(fb)}; ${pts(r1(out.lost))} go to neither.`),
      L(`${out.winner} l’emporterait avec ${pct(wv)} des suffrages exprimés.`, `${out.winner} would win with ${pct(wv)} of valid votes.`),
      wv < 52.5
        ? L(`Avec l’erreur habituelle des sondages à ce stade, ${surname(out.winner)} ne gagne que dans ${show(pw)} des cas : trop serré pour trancher.`, `With the usual polling error at this stage, ${surname(out.winner)} wins in only ${show(pw)} of cases: too close to call.`)
        : L(`Avec l’erreur habituelle des sondages à ce stade, ${surname(out.winner)} gagne dans ${show(pw)} des cas.`, `With the usual polling error at this stage, ${surname(out.winner)} wins in ${show(pw)} of cases.`),
      polled == null ? L("Aucun sondage récent n’a testé ce duel : le résultat repose entièrement sur vos reports.", "No recent poll has tested this pairing: the result rests entirely on your transfers.")
        : Math.abs(gap) < 0.5 ? L(`Les sondages de ce duel donnent ${pct(polled, 0)} à ${surname(out.winner)} : vos chiffres sont au même niveau.`, `Polls of this pairing give ${surname(out.winner)} ${pct(polled, 0)}: your numbers are level with them.`)
        : L(`Les sondages de ce duel donnent ${pct(polled, 0)} à ${surname(out.winner)} : vos chiffres lui sont ${gap > 0 ? "plus" : "moins"} favorables de ${pts(Math.abs(gap))}.`, `Polls of this pairing give ${surname(out.winner)} ${pct(polled, 0)}: your numbers are ${pts(Math.abs(gap))} ${gap > 0 ? "kinder" : "harsher"} to them.`),
    ].join(" ");
    const col = (label: string, sc: Scenario, cls = "") => {
      const o2 = outcome(sc), w2 = Math.max(o2.ra, o2.rb), so2 = scenarioOdds(sc);
      return { label, cls, o: o2, w: w2, duel: `${surname(sc.finalists[0])} – ${surname(sc.finalists[1])}`, res: `${surname(o2.winner)} ${pct(w2)}`, win: show(normCdf((w2 - 50) / ROUND2_SD)), p1: so2 ? show(so2.p1) : "—" };
    };
    const cols = [col(L("Sondages du jour", "Today’s polls"), baseSc), ...(pinned ? [col(L("Épinglé", "Pinned"), pinned)] : []), col(L("Ce scénario", "This scenario"), s, "is-now")];
    const base = cols[0];
    const names = [...new Set([...reference.map((c) => c.name), ...s.cands.map((c) => c.name)])];
    const moved = names.map((n) => ({ n, gone: !cand(n), d: r1(shareOf(n) - (reference.find((c) => c.name === n)?.share ?? 0)) })).filter((x) => x.gone || Math.abs(x.d) >= 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
    const rule = `${fr ? TP[s.tp ?? "2022"].fr : TP[s.tp ?? "2022"].en}${s.edited.length ? ` + ${s.edited.length} ${L(s.edited.length > 1 ? "reports modifiés" : "report modifié", s.edited.length > 1 ? "transfers edited" : "transfer edited")}` : ""}${(s.mob ?? 100) !== 100 ? ` · ${L("mobilisation", "turnout")} ${pct(s.mob!, 0)}` : ""}`;
    $("#sim-vs").innerHTML = `<p class="sim-k">${L("Par rapport aux sondages du jour", "Against today’s polls")}</p>
      <table class="sim-vs-t"><thead><tr><th></th>${cols.map((c) => `<th class="${c.cls}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
        <tr><th scope="row">${L("Duel", "Pairing")}</th>${cols.map((c) => `<td class="${c.cls}">${esc(c.duel)}</td>`).join("")}</tr>
        <tr><th scope="row">${L("Second tour", "Runoff")}</th>${cols.map((c) => `<td class="${c.cls}"><b>${esc(c.res)}</b></td>`).join("")}</tr>
        <tr><th scope="row">${L("Chance de victoire", "Chance of winning")}</th>${cols.map((c) => `<td class="${c.cls}">${c.win}</td>`).join("")}</tr>
        <tr><th scope="row">${L("Chance que ce duel ait lieu", "Chance of this pairing")}</th>${cols.map((c) => `<td class="${c.cls}">${c.p1}</td>`).join("")}</tr>
      </tbody></table>
      <p class="sim-vs-line">${base.o.winner === out.winner && pairKey(...baseSc.finalists) === pairKey(fa, fb)
        ? (Math.abs(r1(wv - base.w)) < 0.05 ? L("Même duel, même résultat que les sondages du jour.", "Same pairing, same result as today’s polls.") : `${esc(surname(out.winner))} <b>${signed(r1(wv - base.w))}</b> ${L("point au second tour par rapport aux sondages du jour.", "points in the runoff against today’s polls.")}`)
        : base.o.winner === out.winner ? L(`Le duel change (${base.duel} dans les sondages du jour), le vainqueur reste ${surname(out.winner)}.`, `The pairing changes (${base.duel} in today’s polls); the winner is still ${surname(out.winner)}.`)
        : L(`Le vainqueur change : ${surname(base.o.winner)} dans les sondages du jour, ${surname(out.winner)} ici.`, `The winner changes: ${surname(base.o.winner)} in today’s polls, ${surname(out.winner)} here.`)}</p>
      <p class="sim-changes">${moved.map((x) => `<span style="--c:${color(x.n)}">${esc(surname(x.n))} ${x.gone ? L("se retire", "withdraws") : signed(x.d)}</span>`).join("") || `<span>${L("Premier tour : la moyenne des sondages", "First round: the polling average")}</span>`}<span class="is-rule">${esc(rule)}</span></p>`;
    const curSig = sig(s);
    app.querySelectorAll<HTMLButtonElement>("[data-g]").forEach((b, i) => b.setAttribute("aria-pressed", String(gallerySig[i] === curSig)));
    const tool = (k: string) => app.querySelector<HTMLButtonElement>(`[data-tool="${k}"]`);
    if (tool("undo")) { tool("undo")!.disabled = !undoStack.length; tool("redo")!.disabled = !redoStack.length; tool("pin")!.setAttribute("aria-pressed", String(!!pinned)); tool("pin")!.textContent = pinned ? L("Désépingler", "Unpin") : L("Épingler pour comparer", "Pin to compare"); }

    // live region (debounced, so a drag doesn't flood screen readers) and URL
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => { const live = app.querySelector("#sim-live"); if (!live) return; live.textContent = `${L("Second tour", "Runoff")}${colon()}${surname(fa)} ${pct(out.ra)}, ${surname(fb)} ${pct(out.rb)}. ${L(`${out.winner} l’emporte.`, `${out.winner} wins.`)}`; }, 700);
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      if (!app.querySelector("#p1-bar")) return; // left the page: do not rewrite another page's address
      if (!location.hash.startsWith("#/simulateur")) return;
      const h = `#/simulateur/${encode(s)}`;
      if (location.hash !== h) history.replaceState(history.state, "", h);
      const link = app.querySelector<HTMLInputElement>("#share-url");
      if (link) link.value = shareUrl(s);
      if (compare.has("now")) redrawCompare();
    }, 250);
  };

  // ---------- the flow diagram (sankey on desktop, a list under 640px) ----------
  const drawFlow = (out: ReturnType<typeof outcome>) => {
    const svg = $<SVGSVGElement>("#p2-flow");
    const [fa, fb] = s.finalists;
    const H = 440, x1 = 190, x2 = 730, nodeW = 14, gap = 5;
    const o = ordered();
    const k = (H - 40 - gap * (o.length - 1)) / (out.total || 1);
    const items: Item[] = [];
    let y = 10;
    const left = new Map<string, { y: number; h: number; cur: number }>();
    for (const c of o) { const h = c.share * k; left.set(c.name, { y, h, cur: y }); y += h + gap; }
    const k2 = (H - 40 - 2 * 30) / (out.va + out.vb + out.lost || 1);
    const right = { a: { y: 10, h: out.va * k2 }, x: { y: 0, h: out.lost * k2 }, b: { y: 0, h: out.vb * k2 } };
    right.x.y = right.a.y + right.a.h + 30;
    right.b.y = right.x.y + right.x.h + 30;
    const cur = { a: right.a.y, x: right.x.y, b: right.b.y };
    const mx = (x1 + nodeW + x2) / 2;
    for (const f of out.flows) {
      const l = left.get(f.from.name)!;
      const h1 = f.v * k, h2 = f.v * k2;
      const ya = l.cur, yb = cur[f.to];
      l.cur += h1; cur[f.to] += h2;
      const d = `M${x1 + nodeW},${ya.toFixed(2)}C${mx},${ya.toFixed(2)} ${mx},${yb.toFixed(2)} ${x2},${yb.toFixed(2)}L${x2},${(yb + h2).toFixed(2)}C${mx},${(yb + h2).toFixed(2)} ${mx},${(ya + h1).toFixed(2)} ${x1 + nodeW},${(ya + h1).toFixed(2)}Z`;
      const dest = f.to === "a" ? fa : f.to === "b" ? fb : L("abstention", "no vote");
      items.push({ k: `f:${f.from.name}:${f.to}`, tag: "path", a: { d, class: "sim-rib", fill: color(f.from.name), "data-tip": `${f.from.name} → ${dest}\n${pts(f.v)}` } });
    }
    // left labels, nudged apart so small candidates stay readable
    const labels = o.map((c) => { const l = left.get(c.name)!; return { c, y: l.y + l.h / 2 + 4 }; });
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
    const over = labels.length ? labels[labels.length - 1].y - (H - 26) : 0;
    if (over > 0) for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, (i === labels.length - 1 ? H - 26 : labels[i + 1].y - 14));
    for (const c of o) {
      const l = left.get(c.name)!;
      items.push({ k: `n:${c.name}`, tag: "rect", a: { x: x1, y: l.y.toFixed(2), width: nodeW, height: Math.max(1, l.h).toFixed(2), fill: color(c.name) } });
    }
    for (const { c, y: ly } of labels) items.push({ k: `l:${c.name}`, tag: "text", a: { transform: `translate(${x1 - 8} ${ly.toFixed(1)})`, "text-anchor": "end", class: s.finalists.includes(c.name) ? "sim-fl is-fin" : "sim-fl" }, text: `${surname(c.name)} ${dec(c.share)}` });
    const rnode = (key: "a" | "b" | "x", label: string, fill: string, v: number) => {
      items.push({ k: `r:${key}`, tag: "rect", a: { x: x2, y: right[key].y.toFixed(2), width: nodeW, height: Math.max(1, right[key].h).toFixed(2), fill } });
      items.push({ k: `rl:${key}`, tag: "text", a: { transform: `translate(${x2 + nodeW + 10} ${(right[key].y + right[key].h / 2).toFixed(1)})`, class: "sim-fr" }, text: label });
      items.push({ k: `rv:${key}`, tag: "text", a: { transform: `translate(${x2 + nodeW + 10} ${(right[key].y + right[key].h / 2 + 18).toFixed(1)})`, class: "sim-fv" }, text: pts(v) });
    };
    rnode("a", surname(fa), color(fa), out.va);
    rnode("x", L("Abstention, blanc", "No vote, blank"), GREY, out.lost);
    rnode("b", surname(fb), color(fb), out.vb);
    items.push({ k: "ax1", tag: "text", a: { transform: `translate(${x1 + nodeW / 2} ${H - 4})`, "text-anchor": "middle", class: "sim-fax" }, text: L("Premier tour", "First round") });
    items.push({ k: "ax2", tag: "text", a: { transform: `translate(${x2 + nodeW / 2} ${H - 4})`, "text-anchor": "middle", class: "sim-fax" }, text: L("Second tour", "Runoff") });
    patch(svg, items);
    // Phones: the same flows written out as a list (one row per candidate: where their votes go).
    const row = (c: Cand) => {
      const own = out.flows.filter((f) => f.from === c);
      const v = (to: "a" | "b" | "x") => own.filter((f) => f.to === to).reduce((t, f) => t + f.v, 0);
      const [a, x, b] = [v("a"), v("x"), v("b")];
      const fin = s.finalists.includes(c.name);
      const share = (q: number) => pct(c.share ? (100 * q) / c.share : 0, 0);
      return `<li style="--c:${color(c.name)}"><div class="fl-head"><b>${esc(surname(c.name))}</b><span>${pct(c.share)}</span></div>
        <div class="fl-bar" aria-hidden="true"><i style="flex:${a};background:${color(fa)}"></i><i style="flex:${x};background:${GREY}"></i><i style="flex:${b};background:${color(fb)}"></i></div>
        <p class="fl-split">${fin ? L("Finaliste : garde ses voix", "Finalist: keeps their votes") : `→ ${esc(surname(fa))} ${share(a)} · ${L("abstention", "no vote")} ${share(x)} · → ${esc(surname(fb))} ${share(b)}`}</p></li>`;
    };
    $("#p2-list").innerHTML = `<p class="fl-k">${L("Premier tour → second tour", "First round → runoff")}</p><ol>${o.map(row).join("")}</ol>
      <p class="fl-total"><span style="--c:${color(fa)}"><b>${esc(surname(fa))}</b> ${pts(out.va)}</span><span style="--c:${GREY}">${L("Abstention, blanc", "No vote, blank")} ${pts(out.lost)}</span><span style="--c:${color(fb)}"><b>${esc(surname(fb))}</b> ${pts(out.vb)}</span></p>`;
  };

  // ---------- changes ----------
  /** After any first-round change: finalists may follow, which rebuilds panels 2 and 3 (never panel 1, so a drag continues). */
  const afterShares = () => {
    s.p1 = undefined;
    if (autoFinalists()) { renderP2(); renderP3(); }
    update();
  };
  const restructure = () => { fillTransfers(); renderP1(); renderP2(); renderP3(); update(); };
  // undo / redo: a snapshot before every change (one per burst of arrow-key or slider nudges)
  const checkpoint = () => {
    const j = JSON.stringify(s);
    if (undoStack[undoStack.length - 1] !== j) { undoStack.push(j); if (undoStack.length > 80) undoStack.shift(); }
    redoStack = [];
  };
  const nudgeCheckpoint = (key: string) => { const t = Date.now(); if (key !== lastNudgeKey || t - lastNudge > 900) checkpoint(); lastNudge = t; lastNudgeKey = key; };
  const load = (sc: Scenario) => {
    for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
    Object.assign(s, structuredClone(sc));
    orderFinalists(s);
    s.tp ??= "2022";
    if (!s.finalists.every((n) => cand(n))) { s.manual = false; autoFinalists(); }
    restructure();
  };
  const undo = () => {
    const cur = JSON.stringify(s);
    let prev = undoStack.pop();
    if (prev === cur) prev = undoStack.pop();
    if (!prev) return update();
    redoStack.push(cur);
    load(JSON.parse(prev) as Scenario);
  };
  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(s));
    load(JSON.parse(next) as Scenario);
  };
  const nudgeShare = (name: string, delta: number) => {
    const c = cand(name);
    if (!c) return;
    const next = r1(clamp(c.share + delta, 0, 100));
    const d = next - c.share;
    c.share = next;
    rebalance(s.cands, c, d);
    fixDrift(s.cands, c);
    afterShares();
  };
  const moveDivider = (i: number, toPct: number) => {
    const o = ordered();
    const a = o[i], b = o[i + 1];
    if (!a || !b) return;
    const lo = o.slice(0, i).reduce((t, c) => t + c.share, 0);
    const pair = r1(a.share + b.share);
    a.share = r1(clamp(toPct - lo, 0, pair));
    b.share = r1(pair - a.share);
    afterShares();
  };
  const setTransfer = (name: string, idx: 0 | 1, v: number) => {
    const t = (s.transfers[name] ??= [35, 35]);
    t[idx] = Math.round(clamp(v, 0, 100 - t[1 - idx]));
    if (!s.edited.includes(name)) s.edited.push(name);
    update();
  };

  // pointer drags on the stacked bars: the nearest divider within reach moves; a tap elsewhere picks a candidate
  root.addEventListener("pointerdown", (e) => {
    const zone = (e.target as Element).closest<HTMLElement>("[data-drag]");
    if (!zone || e.button !== 0) return;
    const kind = zone.dataset.drag!;
    const rect = zone.getBoundingClientRect();
    const at = (x: number) => clamp(((x - rect.left) / rect.width) * 100, 0, 100);
    const bounds = () => {
      if (kind === "p1") { let c = 0; return ordered().slice(0, -1).map((x) => (c += x.share)); }
      const t = s.transfers[kind.slice(3)] ?? [35, 35];
      return [t[0], 100 - t[1]];
    };
    const b = bounds();
    const x0 = at(e.clientX);
    const reach = (22 / rect.width) * 100;
    let best = -1;
    b.forEach((v, i) => { if (Math.abs(v - x0) <= reach && (best < 0 || Math.abs(v - x0) < Math.abs(b[best] - x0))) best = i; });
    const group = best < 0 ? [] : b.map((v, i) => (Math.abs(v - b[best]) < 0.05 ? i : -1)).filter((i) => i >= 0);
    let chosen = group.length === 1 ? group[0] : -1;
    let moved = false;
    try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    if (group.length) { e.preventDefault(); checkpoint(); root.classList.add("is-dragging"); }
    const move = (ev: PointerEvent) => {
      const x = at(ev.clientX);
      if (!moved && Math.abs(ev.clientX - e.clientX) < 3) return;
      moved = true;
      if (!group.length) return;
      if (chosen < 0) chosen = x > x0 ? group[group.length - 1] : group[0];
      if (kind === "p1") moveDivider(chosen, x);
      else {
        const name = kind.slice(3);
        const t = s.transfers[name] ?? [35, 35];
        if (chosen === 0) setTransfer(name, 0, x);
        else setTransfer(name, 1, 100 - Math.max(x, t[0]));
      }
    };
    const up = () => {
      zone.removeEventListener("pointermove", move);
      zone.removeEventListener("pointerup", up);
      zone.removeEventListener("pointercancel", up);
      root.classList.remove("is-dragging");
      if (!moved && kind === "p1") {
        // a tap on a segment: jump to that candidate's number
        const seg = (e.target as Element).closest<HTMLElement>("[data-seg]");
        const inp = seg && app.querySelector<HTMLInputElement>(`[data-share="${CSS.escape(seg.dataset.seg!)}"]`);
        if (inp && !group.length) { inp.focus({ preventScroll: true }); inp.select(); inp.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      }
    };
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
  });

  // keyboard on every handle: arrows ±0.5 pt (shift ±2) in round 1, ±1 (shift ±5) on transfers
  root.addEventListener("keydown", (e) => {
    // Ctrl/⌘ Z undoes, Ctrl/⌘ Y or Shift Z redoes (outside text fields, which keep their own undo)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key) && !(e.target as Element).closest("input[type=text], input[type=number], input[type=email]")) {
      e.preventDefault();
      if (e.key.toLowerCase() === "y" || e.shiftKey) redo(); else undo();
      return;
    }
    const h = (e.target as Element).closest<HTMLElement>("[data-hk]");
    if (!h) return;
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "PageUp" ? 2 : e.key === "PageDown" ? -2 : 0;
    const edge = e.key === "Home" ? -1 : e.key === "End" ? 1 : 0;
    if (!dir && !edge) return;
    e.preventDefault();
    nudgeCheckpoint(h.dataset.hk!);
    const [kind, ...rest] = h.dataset.hk!.split(":");
    if (kind === "p1") {
      const i = Number(rest[0]);
      const o = ordered();
      const step = (e.shiftKey || Math.abs(dir) === 2 ? 2 : 0.5) * Math.sign(dir);
      const lo = o.slice(0, i).reduce((t, c) => t + c.share, 0);
      moveDivider(i, edge ? (edge < 0 ? lo : lo + o[i].share + o[i + 1].share) : lo + o[i].share + step);
    } else {
      const idx = Number(rest[rest.length - 1]) as 0 | 1;
      const name = rest.slice(0, -1).join(":");
      const t = s.transfers[name] ?? [35, 35];
      const step = (e.shiftKey || Math.abs(dir) === 2 ? 5 : 1) * Math.sign(dir);
      // handle 0 moves right as A gains; handle 1 moves right as B loses
      if (idx === 0) setTransfer(name, 0, edge ? (edge < 0 ? 0 : 100) : t[0] + step);
      else setTransfer(name, 1, edge ? (edge < 0 ? 100 : 0) : t[1] - step);
    }
  });

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === "p2-mob") return; // handled live on "input"
    if (el.dataset.share || el.dataset.tv || el.dataset.bloc || (el.id === "p1-add" && el.value) || el.id === "f-a" || el.id === "f-b") checkpoint();
    if (el.dataset.share) {
      const c = cand(el.dataset.share);
      const v = Number(el.value.replace(",", "."));
      if (!c || !Number.isFinite(v)) return update();
      const next = r1(clamp(v, 0, 100));
      const delta = next - c.share;
      c.share = next;
      rebalance(s.cands, c, delta);
      fixDrift(s.cands, c);
      afterShares();
    } else if (el.dataset.tv) {
      const [name, idx] = [el.dataset.tv.slice(0, -2), Number(el.dataset.tv.slice(-1)) as 0 | 1];
      const v = Number(el.value);
      if (Number.isFinite(v)) setTransfer(name, idx, v); else update();
    } else if (el.dataset.bloc) {
      const c = cand(el.dataset.bloc);
      if (c) { c.bloc = el.value === "" ? null : (Number(el.value) as Bloc); s.edited = s.edited.filter((n) => n !== c.name); fillTransfers(); update(); }
    } else if (el.id === "p1-add" && el.value) {
      const c: Cand = { name: el.value, share: r1(avgOf(el.value) ?? 1), bloc: meta(el.value).bloc };
      s.cands.push(c);
      rebalance(s.cands, c, c.share);
      fixDrift(s.cands, c);
      s.p1 = undefined;
      autoFinalists();
      restructure();
    } else if (el.id === "f-a" || el.id === "f-b") {
      let a = ($("#f-a") as HTMLSelectElement).value, b = ($("#f-b") as HTMLSelectElement).value;
      if (a === b) [a, b] = el.id === "f-a" ? [a, s.finalists.find((n) => n !== a)!] : [s.finalists.find((n) => n !== b)!, b];
      s.manual = true;
      setFinalists(a, b);
      renderP2(); renderP3(); update();
    }
  });

  root.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    if (b.dataset.g) {
      const g = gallery[Number(b.dataset.g)];
      if (!g) return;
      checkpoint();
      load(g.sc);
    } else if (b.dataset.step) {
      nudgeCheckpoint(`step:${b.dataset.step}`);
      nudgeShare(b.dataset.step, Number(b.dataset.d) * (e.shiftKey ? 4 : 1));
    } else if (b.dataset.unedit) {
      checkpoint();
      s.edited = s.edited.filter((n) => n !== b.dataset.unedit);
      fillTransfers();
      update();
    } else if (b.dataset.tool) {
      const k = b.dataset.tool;
      if (k === "undo") undo();
      else if (k === "redo") redo();
      else if (k === "reset") { checkpoint(); load(baseSc); }
      else if (k === "pin") { pinned = pinned ? null : structuredClone(s); update(); }
      else if (k === "share") {
        const done = (t: string) => { const old = L("Copier le lien", "Copy link"); b.textContent = t; window.setTimeout(() => { if (b.isConnected) b.textContent = old; }, 1600); };
        navigator.clipboard?.writeText(shareUrl(s)).then(() => done(L("Lien copié", "Link copied")), () => done(L("Copie impossible", "Could not copy"))) ?? done(L("Copie impossible", "Could not copy"));
      }
    } else if (b.dataset.tp) {
      checkpoint();
      s.tp = b.dataset.tp as TransferPreset;
      s.edited = [];
      s.transfers = {};
      fillTransfers();
      update();
    } else if (b.dataset.remove) {
      const c = cand(b.dataset.remove);
      if (!c || s.cands.length <= 2) return;
      checkpoint();
      rebalance(s.cands, c, -c.share);
      s.cands = s.cands.filter((x) => x !== c);
      fixDrift(s.cands);
      delete s.transfers[c.name];
      s.edited = s.edited.filter((n) => n !== c.name);
      s.p1 = undefined;
      if (s.finalists.includes(c.name)) s.manual = false;
      autoFinalists();
      restructure();
    } else if (b.id === "p1-reset") {
      checkpoint();
      load(baseSc);
    } else if (b.id === "f-auto") {
      checkpoint();
      s.manual = false;
      autoFinalists();
      renderP2(); renderP3(); update();
    }
  });

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== "p2-mob") return;
    nudgeCheckpoint("mob");
    const v = Math.round(clamp(Number(el.value), 50, 110));
    if (v === 100) delete s.mob; else s.mob = v;
    update();
  });

  // phones and tablets: a slim result strip follows you while panel 3 is off screen
  const dock = $("#sim-dock");
  const wideScreen = matchMedia("(min-width: 1000px)");
  if ("IntersectionObserver" in window) {
    dockObserver = new IntersectionObserver(([en]) => { dock.hidden = wideScreen.matches || en.isIntersecting; }, { threshold: 0.15 });
    dockObserver.observe($("#sim-p3"));
  }
  let lastW = 0;
  const ro = new ResizeObserver(() => { const bar = app.querySelector("#p1-bar"); if (!bar) return ro.disconnect(); /* the reader left the page */ const w = bar.clientWidth; if (w && w !== lastW) { lastW = w; update(); } });
  ro.observe($("#p1-bar"));

  // ---------- my scenarios: save, compare 2–3, share ----------
  let redrawCompare = () => {};
  let saveMsg = (_t: string) => {};
  const drawSaves = async () => {
    const box = $("#sim-saves");
    const user = await currentUser().catch(() => null);
    const list = await listScenarios<Scenario>().catch(() => [] as SavedScenario<Scenario>[]);
    if (!box.isConnected) return;
    const items = list.map((x) => ({ x, sc: sanitizeScenario(x.data) })).filter((r): r is { x: SavedScenario<Scenario>; sc: Scenario } => !!r.sc);
    for (const id of [...compare]) if (id !== "now" && !items.some((r) => r.x.id === id)) compare.delete(id);
    const mini = (sc: Scenario) => {
      const o = outcome(sc);
      const [fa, fb] = sc.finalists;
      return `<div class="sim-duel sm" aria-hidden="true"><i style="width:${o.pa}%;background:${color(fa)}"></i><i style="width:${100 - o.pa}%;background:${color(fb)}"></i><span class="sim-mid"></span></div>`;
    };
    box.innerHTML = `
      <header class="card-head"><h2>${L("Mes scénarios", "My scenarios")}</h2>
        <span class="small muted">${user ? `${L("Connecté", "Signed in")}${colon()}${esc(user.email ?? "")} <button type="button" class="linkish" id="logout">${L("Se déconnecter", "Sign out")}</button>` : L("Enregistrés dans ce navigateur", "Saved in this browser")}</span></header>
      <div class="sim-saverow">
        <label class="sim-grow"><span class="sim-lab">${L("Nom", "Name")}</span><input id="save-name" class="sim-input" type="text" maxlength="80" value="${esc(`${surname(s.finalists[0])} – ${surname(s.finalists[1])}`)}"/></label>
        <button type="button" class="sim-btn ink" id="save">${L("Enregistrer", "Save")}</button>
      </div>
      <div class="sim-saverow">
        <label class="sim-grow"><span class="sim-lab">${L("Lien de ce scénario", "Link to this scenario")}</span><input id="share-url" class="sim-input mono" type="text" readonly value="${esc(shareUrl(s))}"/></label>
        <button type="button" class="sim-btn" id="share">${L("Copier le lien", "Copy link")}</button>
        <span id="save-msg" class="small muted" role="status"></span>
      </div>
      ${items.length ? `<ul class="sim-saved">${items.map(({ x, sc }, i) => `<li>
          <label class="sim-cmp-check"><input type="checkbox" data-cmp="${esc(x.id)}" ${compare.has(x.id) ? "checked" : ""}/><span class="sim-sr">${L("Comparer", "Compare")}</span></label>
          <div class="sim-saved-n"><b>${esc(x.name)}</b><span>${fmtDate(x.updated_at)}${x.cloud ? `, ${L("compte", "account")}` : ""} · ${esc(surname(outcome(sc).winner))} ${pct(Math.max(outcome(sc).ra, outcome(sc).rb))}</span>${mini(sc)}</div>
          <div class="sim-saved-a"><button type="button" class="sim-btn sm" data-load="${i}">${L("Ouvrir", "Open")}</button><button type="button" class="sim-btn sm" data-link="${i}">${L("Lien", "Link")}</button><button type="button" class="sim-x" data-del="${i}" aria-label="${esc(L(`Supprimer ${x.name}`, `Delete ${x.name}`))}">×</button></div>
        </li>`).join("")}</ul>` : `<p class="muted small">${L("Aucun scénario enregistré pour l’instant. Enregistrez-en deux ou trois pour les comparer.", "No saved scenarios yet. Save two or three to compare them.")}</p>`}
      <div id="sim-compare"></div>
      ${cloudEnabled() && !user ? `<form class="sim-saverow" id="login"><label class="sim-grow"><span class="sim-lab">${L("Créez un compte pour retrouver vos scénarios sur tous vos appareils", "Create an account to get your scenarios on every device")}</span><input id="email" class="sim-input" type="email" required placeholder="vous@exemple.fr" autocomplete="email"/></label><button class="sim-btn" type="submit">${L("Recevoir un lien de connexion", "Email me a sign-in link")}</button></form>` : ""}`;
    const msg = (t: string) => (box.querySelector("#save-msg")!.textContent = t);
    const drawCompare = () => {
      const picked = [
        ...(compare.has("now") ? [{ name: L("Scénario à l’écran", "On screen"), sc: s }] : []),
        ...items.filter((r) => compare.has(r.x.id)).map((r) => ({ name: r.x.name, sc: r.sc })),
      ].slice(0, 3);
      const cmp = box.querySelector<HTMLElement>("#sim-compare")!;
      if (!items.length) { cmp.innerHTML = ""; return; }
      cmp.innerHTML = `<div class="sim-cmp-head"><b>${L("Comparer", "Compare")}</b> <span>${L("cochez 2 ou 3 scénarios", "tick 2 or 3 scenarios")}</span> <label class="check"><input type="checkbox" data-cmp="now" ${compare.has("now") ? "checked" : ""}/> ${L("inclure le scénario à l’écran", "include the one on screen")}</label></div>
        ${picked.length >= 2 ? `<div class="sim-cmp">${picked.map(({ name, sc }) => {
          const o = outcome(sc);
          const so = scenarioOdds(sc);
          const [fa, fb] = sc.finalists;
          const r1bar = [...sc.cands].sort(byRank).map((c) => `<i style="width:${c.share}%;background:${color(c.name)}" title="${esc(`${c.name} ${pct(c.share)}`)}"></i>`).join("");
          const top = [...sc.cands].sort((a, b) => b.share - a.share).slice(0, 4).map((c) => `<li style="--c:${color(c.name)}"><span>${esc(surname(c.name))}</span><b>${dec(c.share)}</b></li>`).join("");
          return `<article class="sim-cmp-card">
            <h3>${esc(name)}</h3>
            <p class="sim-lab">${L("1er tour", "Round 1")}</p><div class="sim-r1mini" aria-hidden="true">${r1bar}</div><ol class="sim-top">${top}</ol>
            <p class="sim-lab">${L("2nd tour", "Runoff")} · ${esc(fr ? TP[sc.tp ?? "2022"].fr : TP[sc.tp ?? "2022"].en)}${sc.edited.length ? ` + ${sc.edited.length} ${L("modif.", "edits")}` : ""}</p>
            <div class="sim-cmp-nums"><span style="--c:${color(fa)}">${esc(surname(fa))} <b>${dec(o.ra)}</b></span><span style="--c:${color(fb)}"><b>${dec(o.rb)}</b> ${esc(surname(fb))}</span></div>
            ${mini(sc)}
            <p class="sim-cmp-p"><b>${so ? show(so.p) : "—"}</b> ${L("probabilité selon les sondages", "chance by the polls")}</p>
          </article>`;
        }).join("")}</div>` : `<p class="muted small">${L("Cochez au moins deux scénarios.", "Tick at least two scenarios.")}</p>`}`;
    };
    drawCompare();
    redrawCompare = drawCompare;
    saveMsg = msg;
    box.querySelector("#save")!.addEventListener("click", async () => {
      const name = (box.querySelector<HTMLInputElement>("#save-name")!.value || "Scénario").trim();
      try {
        const saved = await saveScenario<Scenario>(name, structuredClone(s));
        if (compare.size < 3) compare.add(saved.id);
        await drawSaves();
        msg(L("Enregistré.", "Saved."));
      } catch (err) { msg(String((err as Error).message)); }
    });
    const copy = async (link: string) => {
      try { await navigator.clipboard.writeText(link); msg(L("Lien copié.", "Link copied.")); } catch { const inp = box.querySelector<HTMLInputElement>("#share-url")!; inp.value = link; inp.select(); msg(L("Copiez le lien sélectionné.", "Copy the selected link.")); }
    };
    box.querySelector("#share")!.addEventListener("click", () => copy(shareUrl(s)));
    box.querySelectorAll<HTMLButtonElement>("[data-link]").forEach((b) => b.addEventListener("click", () => copy(shareUrl(items[Number(b.dataset.link)].sc))));
    box.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) => b.addEventListener("click", () => { state = structuredClone(items[Number(b.dataset.load)].sc); renderSimulator(app).then(() => app.querySelector("#sim-app")?.scrollIntoView()); }));
    box.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => b.addEventListener("click", async () => { const it = items[Number(b.dataset.del)]; compare.delete(it.x.id); await deleteScenario(it.x); drawSaves(); }));
    box.querySelector("#logout")?.addEventListener("click", async () => { await signOut(); drawSaves(); });
    box.querySelector<HTMLFormElement>("#login")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await sendLoginLink(box.querySelector<HTMLInputElement>("#email")!.value); msg(L("Lien envoyé, vérifiez votre boîte mail.", "Link sent, check your inbox.")); } catch (err) { msg(String((err as Error).message)); }
    });
  };
  // one listener for the compare ticks (the box is redrawn, the listener stays)
  $("#sim-saves").addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.cmp) return;
    if (el.checked) {
      if (compare.size >= 3) { el.checked = false; saveMsg(L("Trois scénarios au plus.", "Three scenarios at most.")); return; }
      compare.add(el.dataset.cmp);
    } else compare.delete(el.dataset.cmp);
    redrawCompare();
  });
  if (!authHooked) { authHooked = true; onAuth(() => { if (location.hash.startsWith("#/simulateur")) renderSimulator(app); }); }

  renderP1();
  renderP2();
  renderP3();
  update();
  drawSaves();
}
