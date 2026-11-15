// The Third Estate 2027 forecast: one chance-of-winning number per candidate, from two independent reads.
//
// 1. Polls model (Monte Carlo, 20 000 runs)
//    - First round: each candidate's share = the polling average for the most-tested line-up + a random
//      error. The error has a shared part (a whole political family over- or under-performs together,
//      σ = 1.5 pts per family) and a candidate part (σ grows with time to the vote: about 3.5 pts six
//      months out, 2 pts on the eve). The top two go through.
//    - Runoff: the winner's share = the runoff polls for that pair when they exist, otherwise the
//      vote-transfer model (votes of eliminated candidates split by political distance), + a random
//      error (σ = 6 pts six months out, 3.5 on the eve: runoff polls taken before the first round miss widely).
//    Candidates that line-up leaves out but the markets give at least 3 % (and pollsters do test) are
//    added at their polling average, the points taken from the candidates closest to them politically.
//    The polls model still assumes that field runs: it can't price whether someone will stand.
// 2. Prediction markets: Kalshi and Polymarket winner markets, rescaled to 100 % and averaged weighted by
//    traded volume (lib/markets.ts). They price everything, including who will actually run.
// 3. Blend: 50 % polls model, 50 % markets. A candidate only one source covers keeps that source's half,
//    so a long shot the markets price but pollsters don't test still shows up, at half weight.
//
// Errors on the polls side are a judgement, not an estimate from past French elections (too few of them
// to fit). The method is shown in full on the 2027 page.
import type { Market } from "../data";
import { meta, type Bloc } from "./candidates";
import { combineOdds, winShare } from "./markets";
import { average, duelAverages, houseEffects, pollWeight, pollsInWindow, pollsterName, pollsterRating, referenceLineup, trend, type Duel, type Poll } from "./polls";
import primaryData from "../../public/data/2027/primary.json";
import rejectionData from "../../public/data/2027/rejection.json";
import candidateIndex from "../../public/data/candidates/index.json";


/** First round of the 2027 presidential election: Sunday 18 April 2027 (run-off 2 May), as chosen at the Council
 *  of Ministers of 1 July 2026. The convening decree, due at least 10 weeks before, makes it official. */
export const ELECTION_DAY = "2027-04-18";
export const MARKET_WEIGHT = 0.5;
const RUNS = 20000;

// Default transfer by political distance (0 = same family … 4 = opposite ends), capped at 90 % in total.
const AFFINITY = [0.85, 0.5, 0.4, 0.15, 0.15];
export function defaultTransfer(from: Bloc | null, a: Bloc | null, b: Bloc | null, aff: readonly number[] = AFFINITY): [number, number] {
  if (from == null || a == null || b == null) return [35, 35];
  let ta = aff[Math.abs(from - a)], tb = aff[Math.abs(from - b)];
  const sum = ta + tb;
  if (sum > 0.9) [ta, tb] = [(ta * 0.9) / sum, (tb * 0.9) / sum];
  return [Math.round(ta * 100), Math.round(tb * 100)];
}

// ---------- scenarios ----------
// A scenario changes the starting point of the polls model (first-round shares, sometimes a runoff handicap)
// and nothing else. Under a scenario the number is the polls model alone: markets can't be re-priced for an
// imagined world. Setbacks are the same size for every camp.

/** Share of their first-round vote a candidate loses in a major setback: Fillon fell from about 26 % in
 *  December 2016 to 20 % (−25 % of his vote), Pécresse from about 17 % to 4.8 % in 2022 (−70 %), Balladur from
 *  about 30 % to 18.6 % in 1995 (−38 %). We use about a third. */
export const SETBACK_SHARE = 0.35;
/** Runoff points a candidate hit by a setback loses in every match-up. */
export const SETBACK_RUNOFF = 5;
/** Share of their vote the smaller candidates of a camp hand to its leader when the camp rallies. */
export const RALLY_SHARE = 0.7;

export type ScenarioKey = "base" | "centre-primary" | "right-rallies" | "left-unites" | "le-pen-out" | "setback-le-pen" | "setback-melenchon" | "setback-centre";
export interface ScenarioDef { key: ScenarioKey; fr: string; en: string; descFr: string; descEn: string; kind: "base" | "primary" | "rally" | "ballot" | "setback" }
const pc = (x: number) => Math.round(x * 100);
const BS_FR = "Impact calqué sur les cygnes noirs de la vie politique française (Balladur 1995, Fillon 2017, Pécresse 2022 : entre un quart et deux tiers de leurs voix perdues)";
const BS_EN = "Impact based on past black swans in French political life (Balladur 1995, Fillon 2017, Pécresse 2022: between a quarter and two thirds of their vote lost)";
export const SCENARIOS: ScenarioDef[] = [
  { key: "base", kind: "base", fr: "Les sondages du jour", en: "Today’s polls", descFr: "Notre prévision telle quelle : le modèle des sondages et les marchés, à parts égales.", descEn: "Our forecast as it stands: the polls model and the markets, half and half." },
  { key: "centre-primary", kind: "primary", fr: "Primaire du centre", en: "Centre primary", descFr: "Fin janvier, Attal, Retailleau et Lisnard se rangent derrière le mieux placé dans les sondages de fin décembre ; les deux autres se retirent et la plupart de leurs électeurs le suivent. Philippe n’y participe pas : seul un quart de ses électeurs rejoignent le candidat désigné.", descEn: "At the end of January Attal, Retailleau and Lisnard line up behind whoever is best placed in the end-of-December polls; the other two withdraw and most of their voters follow. Philippe stays out: only a quarter of his voters join the chosen candidate." }, // keep in step with rallyFromShare in primary.json
  { key: "right-rallies", kind: "rally", fr: "Le centre et la droite se rassemblent", en: "Centre and right rally", descFr: `Les autres candidats du centre et de la droite cèdent ${pc(RALLY_SHARE)} % de leurs voix au mieux placé d’entre eux.`, descEn: `The other centre and right candidates hand ${pc(RALLY_SHARE)}% of their vote to the best placed among them.` },
  { key: "left-unites", kind: "rally", fr: "La gauche s’unit", en: "The left unites", descFr: `Les autres candidats de gauche cèdent ${pc(RALLY_SHARE)} % de leurs voix au mieux placé d’entre eux.`, descEn: `The other left-wing candidates hand ${pc(RALLY_SHARE)}% of their vote to the best placed among them.` },
  { key: "le-pen-out", kind: "ballot", fr: "Le Pen n’est pas candidate", en: "Le Pen doesn’t run", descFr: "Jordan Bardella la remplace, au niveau que lui donnent les sondages qui le testent.", descEn: "Jordan Bardella replaces her, at the level the polls that test him give him." },
  { key: "setback-le-pen", kind: "setback", fr: "Cygne noir : Le Pen", en: "Le Pen black swan", descFr: `${BS_FR} : elle perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `${BS_EN}: she loses ${pc(SETBACK_SHARE)}% of her first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
  { key: "setback-melenchon", kind: "setback", fr: "Cygne noir : Mélenchon", en: "Mélenchon black swan", descFr: `${BS_FR} : il perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `${BS_EN}: he loses ${pc(SETBACK_SHARE)}% of his first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
  { key: "setback-centre", kind: "setback", fr: "Cygne noir : le centre", en: "Centre black swan", descFr: `${BS_FR} : le candidat du centre le mieux placé perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `${BS_EN}: the best-placed centrist loses ${pc(SETBACK_SHARE)}% of their first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
];
export const isScenario = (k: string | null | undefined): k is ScenarioKey => SCENARIOS.some((s) => s.key === k);
/** Scenarios that can't be combined: both rally the same camp, or one removes the candidate the other hits. */
export const INCOMPATIBLE: [ScenarioKey, ScenarioKey][] = [
  ["centre-primary", "right-rallies"],
  ["le-pen-out", "setback-le-pen"],
];
/** Can `k` be added to the selection `sel`? */
export const compatible = (sel: readonly ScenarioKey[], k: ScenarioKey) => !INCOMPATIBLE.some(([a, b]) => (a === k && sel.includes(b)) || (b === k && sel.includes(a)));
/** A selection in the canonical order (the order of SCENARIOS), without "base", duplicates or clashes. */
export function canonical(sel: ScenarioKey | readonly ScenarioKey[] | undefined): ScenarioKey[] {
  const raw = (Array.isArray(sel) ? sel : sel ? [sel] : []) as ScenarioKey[];
  const out: ScenarioKey[] = [];
  for (const s of SCENARIOS) if (s.key !== "base" && raw.includes(s.key) && compatible(out, s.key)) out.push(s.key);
  return out;
}

export interface ForecastRow {
  name: string;
  /** blended chance of winning, % */
  win: number;
  /** blended chance of reaching the runoff, % (null if neither source has it) */
  qualify: number | null;
  polls: { win: number; qualify: number; share: number } | null;
  markets: { win: number | null; qualify: number | null } | null;
}
/** A candidate's first-round score along the way, in the polls model: at each knot (today, the primary, election
 *  day) the average and the 80 % range, in % of votes cast; at every knot the field adds up to 100. */
export interface Projection { name: string; knots: { date: string; mid: number; lo: number; hi: number }[]; /** withdraws on this date */ outAt?: string }
export interface Forecast {
  rows: ForecastRow[];
  /** most likely runoff pairings in the polls model */
  pairs: { a: string; b: string; p: number; aWins: number }[];
  daysToGo: number;
  sd1: number;
  sd2: number;
  nLineupPolls: number;
  /** candidates added to the poll line-up because the markets rate them */
  added: string[];
  /** the scenarios applied, in canonical order (empty = today's polls) */
  scenarios: ScenarioKey[];
  /** who the scenarios acted on (the rallying leader, the candidate hit, the replacement) */
  scenarioTargets: string[];
  /** markets weight actually used (0 under a scenario) */
  marketWeight: number;
  projection: Projection[];
  /** transfer rates by political distance, fitted to the runoff polls */
  affinity: number[];
  /** the centre and right primary, when it falls before the vote: how often it's held, who wins it */
  primary: { day: string; pHeld: number; held: number; winner: string | null; losers: string[] } | null;
  /** first-round ceilings from rejection polls, by candidate (only those the poll covers) */
  ceilings: Record<string, number>;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const isLePen = (n: string) => norm(n) === "marine le pen";
const isMelenchon = (n: string) => norm(n).endsWith("melenchon");

function gauss(rand: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uncertainty shrinks as the vote nears: linear in days to go, between eve-of-vote and six-months values.
 *  Six months out: 4.5 pts per candidate in the first round, 7.5 pts in the runoff (runoff polls taken in
 *  November 2011 missed Hollande–Sarkozy by about 8 points). */
export function errors(daysToGo: number) {
  const k = Math.max(0, Math.min(1, daysToGo / 180));
  return { sd1: 2 + 2.5 * k, sd2: 3.5 + 4 * k, bloc: 1.5 };
}

type Cand = { name: string; share: number; bloc: Bloc | null };

/** Runoff share for A from the first-round field and transfer rates by distance. */
function transferShare(base: Cand[], A: Cand, B: Cand, aff: readonly number[]) {
  let va = A.share, vb = B.share;
  for (const c of base) if (c !== A && c !== B) { const [ta, tb] = defaultTransfer(c.bloc, A.bloc, B.bloc, aff); va += (c.share * ta) / 100; vb += (c.share * tb) / 100; }
  return (100 * va) / (va + vb);
}

/** Transfer rates by political distance that best reproduce the runoffs pollsters did test (least squares,
 *  weighted by number of polls), so match-ups nobody polls come out neither harsher nor softer than those they do. */
function fitAffinity(base: Cand[], duels: { winner: string; pw: number; loser: string; pl: number; n: number }[]): number[] {
  const obs = duels.flatMap((d) => {
    const A = base.find((c) => c.name === d.winner), B = base.find((c) => c.name === d.loser);
    return A && B && A.bloc != null && B.bloc != null ? [{ A, B, v: (100 * d.pw) / (d.pw + d.pl), n: d.n }] : [];
  });
  if (obs.length < 2) return [...AFFINITY];
  const range = (a: number, b: number, st: number) => Array.from({ length: Math.round((b - a) / st) + 1 }, (_, i) => +(a + i * st).toFixed(2));
  let best = [...AFFINITY], bestErr = Infinity;
  for (const a1 of range(0.3, 0.8, 0.1)) for (const a2 of range(0.1, 0.7, 0.05)) if (a2 <= a1) for (const a3 of range(0.05, 0.6, 0.05)) if (a3 <= a2) for (const a4 of range(0.02, 0.38, 0.04)) if (a4 <= a3) {
    const aff = [AFFINITY[0], a1, a2, a3, a4];
    let err = 0;
    for (const o of obs) { const e = transferShare(base, o.A, o.B, aff) - o.v; err += o.n * e * e; }
    if (err < bestErr - 1e-9) { bestErr = err; best = aff; }
  }
  return best;
}

/** Moves `pts` of `from`'s vote to the others, in proportion to share × political closeness. */
function redistribute(base: Cand[], from: Cand, pts: number, aff: readonly number[]) {
  const others = base.filter((c) => c !== from);
  const w = (c: Cand) => (from.bloc == null || c.bloc == null ? 0.3 : aff[Math.abs(from.bloc - c.bloc)]) * c.share;
  const tot = others.reduce((s, c) => s + w(c), 0) || 1;
  for (const c of others) c.share += (pts * w(c)) / tot;
  from.share -= pts;
}

/** Bardella's level relative to Le Pen's, from polls that tested both line-ups (same poll, two hypotheses). */
function bardellaRatio(firstRound: Poll[]) {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rs: number[] = [];
  for (const p of firstRound) {
    const lp = p.hyps.flatMap((h) => Object.entries(h).filter(([k]) => isLePen(k)).map(([, v]) => v));
    const jb = p.hyps.flatMap((h) => Object.entries(h).filter(([k]) => norm(k) === "jordan bardella").map(([, v]) => v));
    if (lp.length && jb.length) rs.push(mean(jb) / mean(lp));
  }
  return rs.length ? mean(rs) : 1;
}

function applyScenario(key: ScenarioKey, base: Cand[], firstRound: Poll[], aff: readonly number[]): { target: string | null; handicap: Map<string, number> } {
  const handicap = new Map<string, number>();
  const leaderOf = (blocs: number[]) => base.filter((c) => c.bloc != null && blocs.includes(c.bloc)).sort((a, b) => b.share - a.share)[0];
  if (key === "right-rallies" || key === "left-unites") {
    const blocs = key === "right-rallies" ? [2, 3] : [0, 1];
    const lead = leaderOf(blocs);
    if (!lead) return { target: null, handicap };
    for (const c of base) if (c !== lead && c.bloc != null && blocs.includes(c.bloc)) { const g = c.share * RALLY_SHARE; c.share -= g; lead.share += g; }
    return { target: lead.name, handicap };
  }
  if (key === "le-pen-out") {
    const lp = base.find((c) => isLePen(c.name));
    if (!lp) return { target: null, handicap };
    const jb = Math.min(lp.share, lp.share * bardellaRatio(firstRound));
    const gap = lp.share - jb;
    lp.name = "Jordan Bardella";
    if (gap > 0) redistribute(base, lp, gap, aff);
    return { target: lp.name, handicap };
  }
  if (key.startsWith("setback-")) {
    const hit = key === "setback-le-pen" ? base.find((c) => isLePen(c.name)) : key === "setback-melenchon" ? base.find((c) => isMelenchon(c.name)) : leaderOf([2]);
    if (!hit) return { target: null, handicap };
    redistribute(base, hit, hit.share * SETBACK_SHARE, aff);
    handicap.set(hit.name, SETBACK_RUNOFF);
    return { target: hit.name, handicap };
  }
  return { target: null, handicap };
}

// ---------- built-in uncertainty (applies to every view, scenarios included) ----------
// Polls five months out miss more, and more unevenly, than a bell curve allows: in 1995, 2017 and 2022 a leading
// candidate collapsed (Balladur, Fillon, Pécresse: three of the last five elections), in 2017 and 2022 a camp rallied late behind one name
// (Macron, Mélenchon). Each simulated campaign can therefore include, at random:
/** Chance that one major candidate (picked at random, every camp alike) suffers a black swan of the size above. */
export const P_SHOCK = 0.5;
/** Chance, per camp (left; centre and right), that its voters rally late behind its best-placed candidate. */
export const P_RALLY = 0.25;
/** Momentum, discounted: the slope of the polling average over the last MOMENTUM_DAYS carries on, but fades
 *  (an exponential decay with a MOMENTUM_TAU-day time constant), so a candidate climbing or sliding today moves
 *  about MOMENTUM_TAU days' worth of that slope by election day, and most of it in the first weeks. Capped at
 *  MOMENTUM_CAP points. Momentum in polls is real but short-lived (FiveThirtyEight's primary models weight the
 *  recent trend, Silver calls lasting momentum "mostly a mirage"): the decay is that discount. */
export const MOMENTUM_DAYS = 42, MOMENTUM_TAU = 21, MOMENTUM_CAP = 4;
/** Points carried by day `t` (from today) for a slope `s` (points per day). */
export const momentumAt = (s: number, t: number) => Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, s * MOMENTUM_TAU * (1 - Math.exp(-Math.max(0, t) / MOMENTUM_TAU))));
// Errors have fat tails (one draw in ten is about twice as wide), so big misses aren't vanishingly rare.
/** Ceiling: a candidate can climb at most this fraction of the way from today's share to their maximum
 *  electorate (everyone who doesn't completely rule out voting for them, Cluster17 for Politico). */
export const CEILING_FRACTION = 0.5;
export const REJECTION = rejectionData as { excluded: Record<string, number>; source: { url: string; title: string; publisher: string; date: string }; poll: { pollster: string; sponsor: string; fieldwork: string[]; sample: number } };

export interface Primary {
  name: { fr: string; en: string };
  /** "expected" = our assumption that it happens (still only proposed by the candidates) */
  status: "proposed" | "expected" | "confirmed" | "cancelled";
  rounds: string[];
  /** the polls that decide who is best placed */
  decidedBy: string;
  participants: string[];
  declined: string[];
  pHeld: number;
  /** candidates outside the primary whose voters partly rally to its winner, and how much */
  rallyFrom: string[];
  rallyFromShare: number;
  note: { fr: string; en: string };
  sources: { url: string; title: string; publisher: string; date: string }[];
}
export const PRIMARY: Primary = { rallyFrom: [], rallyFromShare: 0, declined: [], decidedBy: "", ...(primaryData as Partial<Primary>) } as Primary;
/** The primary's deciding day (its last round). */
export const PRIMARY_DAY = PRIMARY.rounds.at(-1)!;

/** Slope of each candidate's polling average over the last `days` (recent days weigh more), in points per day. A candidate needs
 *  half that span of history (a newcomer like Lisnard counts once polled for three weeks). */
export function trendSlopes(firstRound: Poll[], asOf: string, days = MOMENTUM_DAYS): Map<string, number> {
  const from = new Date(Date.parse(asOf) - days * 86400000).toISOString().slice(0, 10);
  const pts = trend(firstRound, from, { to: asOf });
  const out = new Map<string, number>();
  const names = new Set(pts.flatMap((p) => Object.keys(p.values)));
  for (const n of names) {
    const xs: number[] = [], ys: number[] = [];
    for (const p of pts) if (p.values[n] != null) { xs.push(Date.parse(p.date) / 86400000); ys.push(p.values[n]); }
    if (xs.length < 6 || xs.at(-1)! - xs[0] < days / 2) continue;
    // recent days count more (weight halves every two weeks back): a rise then a fall reads as falling
    const now = Date.parse(asOf) / 86400000;
    const ws = xs.map((xx) => Math.pow(0.5, (now - xx) / 14));
    const sw = ws.reduce((a, b) => a + b, 0);
    const mx = xs.reduce((a, xx, i) => a + ws[i] * xx, 0) / sw, my = ys.reduce((a, yy, i) => a + ws[i] * yy, 0) / sw;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < xs.length; i++) { sxy += ws[i] * (xs[i] - mx) * (ys[i] - my); sxx += ws[i] * (xs[i] - mx) ** 2; }
    if (sxx > 0) out.set(n, sxy / sxx);
  }
  return out;
}

/** A name joins the model once pollsters have tested it this often in the last FIELD_DAYS, candidate file or not
 *  (Riner, Lagarde: not yet), unless it's tested instead of a declared candidate rather than alongside them
 *  (Hollande is tested in place of Glucksmann, Bardella in place of Le Pen). */
export const FIELD_MIN_POLLS = 5, FIELD_DAYS = 60;
/** Declared candidates (one file each in public/data/candidates), by poll name. */
const DECLARED = new Set(((candidateIndex as { candidates?: { pollName: string }[] }).candidates ?? []).map((c) => c.pollName.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()));

/** The starting point: from every poll of the last three weeks, the line-up closest to the declared field (most
 *  declared candidates, fewest hypothetical ones), each candidate averaged over the polls that test them, then
 *  scaled to 100. Close to the polling average on the chart, but one coherent field. Falls back to the most-tested
 *  line-up when too few polls match (old dates). */
/** The field: anyone tested in at least FIELD_MIN_POLLS polls of the last FIELD_DAYS days, mostly alongside the
 *  declared candidates who poll 8 % or more (not in place of one of them). Declared or not. */
export function fieldNames(polls: Poll[], asOf: string): Set<string> {
  const from = new Date(Date.parse(asOf) - FIELD_DAYS * 86400000).toISOString().slice(0, 10);
  const recent = polls.filter((p) => p.end >= from && p.end <= asOf);
  const majors = average(polls, asOf).filter((r) => r.avg >= 8 && DECLARED.has(norm(r.name))).map((r) => r.name);
  // everyone, declared or not, needs FIELD_MIN_POLLS polls: a new candidate (Riner) joins once tested enough
  const field = new Set<string>();
  const counts = new Map<string, number>();
  for (const p of recent) for (const n of new Set(p.hyps.flatMap((h) => Object.keys(h)))) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [n, c] of counts) {
    if (c < FIELD_MIN_POLLS) continue;
    // an alternative to a major candidate is almost never tested together with them (Hollande and Glucksmann
    // share 1 line-up in 10): at most a fifth of the smaller of the two's line-ups
    const hyps = recent.flatMap((p) => p.hyps);
    const hs = hyps.filter((h) => n in h);
    const alternative = majors.some((m) => {
      if (m === n) return false;
      const hm = hyps.filter((h) => m in h).length;
      return hs.filter((h) => m in h).length <= 0.2 * Math.min(hs.length, hm);
    });
    if (!alternative) field.add(norm(n));
  }
  return field;
}

export function fieldLineup(polls: Poll[], asOf: string): { n: number; rows: { name: string; share: number }[] } {
  const ps = pollsInWindow(polls, asOf);
  const FIELD = fieldNames(polls, asOf);
  const score = (h: Record<string, number>) => Object.keys(h).reduce((s, k) => s + (FIELD.has(norm(k)) ? 1 : -1), 0);
  const acc = new Map<string, [number, number][]>(); // [value, the poll's grade weight]
  // each institute's lean taken off, as in the polling average
  const house = houseEffects(polls, ps.reduce((m, p) => (p.end > m ? p.end : m), ps[0]?.end ?? asOf));
  for (const p of ps) {
    const w = pollWeight(p);
    const lean = house.get(pollsterRating(p.pollster)?.name ?? pollsterName(p.pollster));
    if (!p.hyps.length) continue;
    const best = Math.max(...p.hyps.map(score));
    const hs = p.hyps.filter((h) => score(h) === best);
    for (const n of new Set(hs.flatMap((h) => Object.keys(h)))) {
      if (!FIELD.has(norm(n))) continue; // tested too rarely so far: left out, the others scaled up to 100
      const v = hs.map((h) => h[n]).filter((x): x is number => x != null);
      if (v.length) acc.set(n, [...(acc.get(n) ?? []), [v.reduce((a, b) => a + b, 0) / v.length - (lean?.get(n)?.effect ?? 0), w]]);
    }
  }
  const rows = [...acc].map(([name, v]) => ({ name, share: v.reduce((a, [x, w]) => a + x * w, 0) / v.reduce((a, [, w]) => a + w, 0) }));
  const sum = rows.reduce((s, r) => s + r.share, 0);
  if (ps.length < 3 || rows.length < 4 || sum <= 0) return referenceLineup(polls, asOf);
  return { n: ps.length, rows: rows.map((r) => ({ name: r.name, share: (100 * r.share) / sum })) };
}

export function forecast(firstRound: Poll[], secondRound: Duel[], markets: Market[], asOf: string, scenario: ScenarioKey | readonly ScenarioKey[] = []): Forecast {
  const keys = canonical(scenario);
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(asOf)) / 86400000));
  const { sd1, sd2, bloc: sdBloc } = errors(daysToGo);
  const lineup = fieldLineup(firstRound, asOf);
  const field = fieldNames(firstRound, asOf);
  const base: Cand[] = lineup.rows.map((r) => ({ name: r.name, share: r.share, bloc: meta(r.name).bloc }));
  const duels = duelAverages(secondRound, undefined, asOf).filter((d) => !d.stale);
  const odds = combineOdds(markets);
  const added: string[] = [];
  const polled = average(firstRound, asOf, undefined, 0);
  for (const o of odds) {
    // only the field (declared, or polled often enough): a name the markets like but pollsters barely test stays in
    // the markets half
    if ((winShare(odds, o) ?? 0) < 3 || !field.has(norm(o.name)) || base.some((c) => norm(c.name) === norm(o.name))) continue;
    const pv = polled.find((r) => norm(r.name) === norm(o.name));
    if (!pv || pv.avg < 1) continue;
    const nb = meta(pv.name).bloc;
    const weight = (c: { bloc: Bloc | null; share: number }) => (nb == null || c.bloc == null ? 0.3 : AFFINITY[Math.abs(nb - c.bloc)]) * c.share;
    const tot = base.reduce((s, c) => s + weight(c), 0) || 1;
    for (const c of base) c.share = Math.max(0, c.share - (pv.avg * weight(c)) / tot);
    base.push({ name: pv.name, share: pv.avg, bloc: nb });
    added.push(pv.name);
  }
  const aff = fitAffinity(base, duels);
  const before = base.map((c) => c.share);
  const handicap = new Map<string, number>();
  const targets: string[] = [];
  for (const k of keys) {
    if (k === "centre-primary") continue; // played inside the simulation, at its date
    const r = applyScenario(k, base, firstRound, aff);
    if (r.target) targets.push(r.target);
    for (const [nm, v] of r.handicap) handicap.set(nm, (handicap.get(nm) ?? 0) + v);
  }
  const n = base.length;

  // momentum carried forward, fading: points gained or lost by day t
  const slopes = trendSlopes(firstRound, asOf);
  const slope = base.map((c) => slopes.get(c.name) ?? 0);
  const driftAt = (i: number, t: number) => momentumAt(slope[i], t);

  // the primary: when it would be decided, and who takes part (only those in the field)
  const tPrim = Math.round((Date.parse(PRIMARY_DAY) - Date.parse(asOf)) / 86400000);
  const primIdx = base.map((c, i) => (PRIMARY.participants.some((p) => norm(p) === norm(c.name)) ? i : -1)).filter((i) => i >= 0);
  const pHeldRaw = keys.includes("centre-primary") || PRIMARY.status === "confirmed" ? 1 : PRIMARY.status === "cancelled" ? 0 : PRIMARY.pHeld;
  const primaryOn = pHeldRaw > 0 && tPrim > 0 && tPrim < daysToGo && primIdx.length >= 2;
  const pHeld = pHeldRaw;
  const rallyIdx = base.map((c, i) => (PRIMARY.rallyFrom.some((p) => norm(p) === norm(c.name)) ? i : -1)).filter((i) => i >= 0);
  // ceilings from rejection (today's share, before any scenario, plus half the room to the maximum electorate)
  const ceiling = base.map((c, i) => {
    const ex = Object.entries(REJECTION.excluded).find(([k]) => norm(k) === norm(c.name))?.[1];
    return ex == null ? Infinity : before[i] + CEILING_FRACTION * Math.max(0, 100 - ex - before[i]);
  });
  const f1 = primaryOn ? tPrim / Math.max(1, daysToGo) : 1;
  // who the primary picks: the participant best placed in the polls at the end of December, as projected today
  // (today's share plus the trend carried to that date); once December's polls are in, that is simply who leads
  const fDec = Math.max(0, Math.min(1, (Date.parse(PRIMARY.decidedBy || PRIMARY_DAY) - Date.parse(asOf)) / 86400000 / Math.max(1, daysToGo)));
  const tDec = fDec * daysToGo;
  const primWinner = primIdx.length ? primIdx.reduce((a, b) => (base[b].share + driftAt(b, tDec) > base[a].share + driftAt(a, tDec) ? b : a)) : -1;
  // momentum split between the two stages (today → primary, primary → election day)
  const t1 = f1 * daysToGo;
  const d1 = base.map((_, i) => driftAt(i, t1)), d2 = base.map((_, i) => driftAt(i, daysToGo) - d1[i]);

  const polledShare = (a: string, b: string) => {
    const d = duels.find((x) => [x.winner, x.loser].sort().join() === [a, b].sort().join());
    return d ? (d.winner === a ? (100 * d.pw) / (d.pw + d.pl) : (100 * d.pl) / (d.pw + d.pl)) : null;
  };
  // A match-up nobody polls borrows from the closest one that is polled: same opponent, someone of the same
  // political family, shifted by the difference the transfer model sees between the two.
  const runoffBase = (a: string, b: string) => {
    const direct = polledShare(a, b);
    if (direct != null) return direct;
    const A = base.find((c) => c.name === a), B = base.find((c) => c.name === b);
    if (!A || !B) return 50;
    const model = transferShare(base, A, B, aff);
    const proxies: number[] = [];
    for (const [keep, swap, flip] of [[A, B, false], [B, A, true]] as const) {
      for (const Y of base) {
        if (Y === swap || Y === keep || Y.bloc == null || Y.bloc !== swap.bloc) continue;
        const v = polledShare(keep.name, Y.name);
        if (v == null) continue;
        const shift = transferShare(base, keep, swap, aff) - transferShare(base, keep, Y, aff);
        const forKeep = v + shift;
        proxies.push(flip ? 100 - forKeep : forKeep);
      }
    }
    return proxies.length ? proxies.reduce((s, v) => s + v, 0) / proxies.length : model;
  };

  // ---- polls model
  const rand = mulberry32(2027);
  // fat tails as a scale mixture: one draw in ten is about twice as wide (unit variance overall, like a Student t)
  const tdist = () => gauss(rand) * (rand() < 0.1 ? 1.9 : 0.85);
  const affW = (from: Bloc | null, to: Bloc | null) => (from == null || to == null ? 0.3 : aff[Math.abs(from - to)]);
  /** hand `pts` of candidate i's vote to the others, by political closeness × size */
  const spread = (x: Float64Array, i: number, pts: number, out: Set<number>) => {
    let tot = 0;
    for (let j = 0; j < n; j++) if (j !== i && !out.has(j)) tot += affW(base[i].bloc, base[j].bloc) * x[j];
    if (tot <= 0) return;
    for (let j = 0; j < n; j++) if (j !== i && !out.has(j)) x[j] += (pts * affW(base[i].bloc, base[j].bloc) * x[j]) / tot;
    x[i] -= pts;
  };
  const majors = base.map((c, i) => (c.share >= 8 ? i : -1)).filter((i) => i >= 0);
  const wins = new Map<string, number>(), quals = new Map<string, number>();
  const pairs = new Map<string, { n: number; aWins: number }>();
  const runoffCache = new Map<string, number>();
  const atPrimary = base.map(() => new Float32Array(RUNS)), afterPrimary = base.map(() => new Float32Array(RUNS)), final = base.map(() => new Float32Array(RUNS));
  let nHeld = 0;
  const x = new Float64Array(n);
  /** shares add up to 100 among those still running; nobody goes above their ceiling (the excess goes to the others) */
  const settle = (out: Set<number>) => {
    for (let pass = 0; pass < 2; pass++) {
      let sum = 0;
      for (let i = 0; i < n; i++) { if (out.has(i) || x[i] < 0) x[i] = out.has(i) ? 0 : Math.max(0, x[i]); sum += x[i]; }
      if (sum > 0) for (let i = 0; i < n; i++) x[i] = (100 * x[i]) / sum;
      let excess = 0, free = 0;
      for (let i = 0; i < n; i++) { if (x[i] > ceiling[i]) { excess += x[i] - ceiling[i]; x[i] = ceiling[i]; } else if (!out.has(i)) free += x[i]; }
      if (excess <= 0 || free <= 0) return;
      for (let i = 0; i < n; i++) if (!out.has(i) && x[i] < ceiling[i]) x[i] += (excess * x[i]) / free;
    }
  };
  for (let r = 0; r < RUNS && n >= 2; r++) {
    const out = new Set<number>();
    const hcap = new Map(handicap);
    // stage 1: today → primary
    const b1 = [0, 1, 2, 3, 4].map(() => sdBloc * Math.sqrt(f1) * gauss(rand));
    for (let i = 0; i < n; i++) x[i] = base[i].share + d1[i] + (base[i].bloc != null ? b1[base[i].bloc!] : 0) + sd1 * Math.sqrt(f1) * tdist();
    settle(out);
    for (let i = 0; i < n; i++) atPrimary[i][r] = x[i];
    // the primary: whoever is best placed at the end of December wins it; the others withdraw and most of their
    // voters follow; part of the centre outside the primary (Philippe's voters) rallies too
    if (primaryOn && rand() < pHeld) {
      nHeld++;
      const w = primWinner;
      for (const i of primIdx) if (i !== w) { const g = Math.max(0, x[i]); x[w] += g * RALLY_SHARE; x[i] -= g * RALLY_SHARE; spread(x, i, Math.max(0, x[i]), out); x[i] = 0; out.add(i); }
      for (const j of rallyIdx) if (!out.has(j) && x[j] > 0) { const g = x[j] * PRIMARY.rallyFromShare; x[j] -= g; x[w] += g; }
      settle(out);
    }
    for (let i = 0; i < n; i++) afterPrimary[i][r] = x[i];
    // stage 2: primary → election day
    if (f1 < 1) {
      const b2 = [0, 1, 2, 3, 4].map(() => sdBloc * Math.sqrt(1 - f1) * gauss(rand));
      for (let i = 0; i < n; i++) if (!out.has(i)) x[i] += d2[i] + (base[i].bloc != null ? b2[base[i].bloc!] : 0) + sd1 * Math.sqrt(1 - f1) * tdist();
    }
    // a late rally in a camp
    for (const camp of [[0, 1], [2, 3]]) {
      if (rand() >= P_RALLY) continue;
      const idx = base.map((c, i) => (c.bloc != null && camp.includes(c.bloc) && !out.has(i) ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 2) continue;
      const lead = idx.reduce((a, b) => (x[b] > x[a] ? b : a));
      const k = RALLY_SHARE * (0.4 + 0.6 * rand());
      for (const i of idx) if (i !== lead && x[i] > 0) { const g = x[i] * k; x[i] -= g; x[lead] += g; }
    }
    // a black swan: one major candidate, any camp, loses a third of their vote and ground in every runoff
    if (rand() < P_SHOCK) {
      const live = majors.filter((i) => !out.has(i));
      if (live.length) {
        const h = live[Math.floor(rand() * live.length)];
        if (x[h] > 0) spread(x, h, x[h] * SETBACK_SHARE, out);
        hcap.set(base[h].name, (hcap.get(base[h].name) ?? 0) + SETBACK_RUNOFF);
      }
    }
    settle(out);
    let i1 = -1, i2 = -1, v1 = -Infinity, v2 = -Infinity;
    for (let i = 0; i < n; i++) {
      final[i][r] = x[i];
      if (out.has(i)) continue;
      if (x[i] > v1) { i2 = i1; v2 = v1; i1 = i; v1 = x[i]; } else if (x[i] > v2) { i2 = i; v2 = x[i]; }
    }
    const [a, b] = [base[i1].name, base[i2].name].sort();
    const key = `${a}|${b}`;
    let ra = runoffCache.get(key);
    if (ra == null) { ra = runoffBase(a, b); runoffCache.set(key, ra); }
    const aWins = ra - (hcap.get(a) ?? 0) + (hcap.get(b) ?? 0) + sd2 * tdist() > 50;
    const w = aWins ? a : b;
    wins.set(w, (wins.get(w) ?? 0) + 1);
    quals.set(a, (quals.get(a) ?? 0) + 1);
    quals.set(b, (quals.get(b) ?? 0) + 1);
    const p = pairs.get(key) ?? { n: 0, aWins: 0 };
    p.n++; if (aWins) p.aWins++;
    pairs.set(key, p);
  }
  // when the primary surely happens, its losers' lines stop there (they withdraw)
  const sure = primaryOn && pHeld >= 1;
  // The dotted line: the polls as they are, plus the slow trend and whatever the scenario itself changes, with
  // none of the random black swans and late rallies (those only widen the band). Adds up to 100 at every step.
  const path = (() => {
    const out = new Set<number>();
    for (let i = 0; i < n; i++) x[i] = base[i].share + d1[i];
    settle(out);
    const p1 = Array.from(x);
    if (sure && primWinner >= 0) {
      const w = primWinner;
      for (const i of primIdx) if (i !== w) { const g = Math.max(0, x[i]); x[w] += g * RALLY_SHARE; x[i] -= g * RALLY_SHARE; spread(x, i, Math.max(0, x[i]), out); x[i] = 0; out.add(i); }
      for (const j of rallyIdx) if (!out.has(j) && x[j] > 0) { const g = x[j] * PRIMARY.rallyFromShare; x[j] -= g; x[w] += g; }
      settle(out);
    }
    const p2 = Array.from(x);
    for (let i = 0; i < n; i++) if (!out.has(i)) x[i] += d2[i];
    settle(out);
    return { p1, p2, p3: Array.from(x) };
  })();
  // the dotted line between today and the first knot, every few weeks, so the fading momentum shows as a curve
  // (the band there is the next knot's, narrowed with the square root of time)
  const stepDays = [10, 21, 35, 56, 84, 120].filter((d) => d < t1 - 5);
  const early = stepDays.map((t) => {
    for (let i = 0; i < n; i++) x[i] = base[i].share + driftAt(i, t);
    settle(new Set());
    return { t, date: new Date(Date.parse(asOf) + t * 86400000).toISOString().slice(0, 10), mid: Array.from(x) };
  });
  const knot = (date: string, arr: Float32Array, mid: number) => {
    const sorted = arr.sort(); // in place: the arrays aren't used again
    const at = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    return { date, mid, lo: Math.min(mid, at(0.1)), hi: Math.max(mid, at(0.9)) };
  };
  const projection: Projection[] = n >= 2 ? base.map((c, i) => {
    const out = sure && primIdx.includes(i) && i !== primWinner;
    return {
      name: c.name,
      ...(out ? { outAt: PRIMARY_DAY } : {}),
      knots: [
        { date: asOf, mid: c.share, lo: c.share, hi: c.share },
        ...early.map((e) => ({ date: e.date, mid: e.mid[i], lo: NaN, hi: NaN, t: e.t })),
        ...(primaryOn ? [knot(PRIMARY_DAY, atPrimary[i], path.p1[i])] : []),
        ...(primaryOn && !out ? [knot(new Date(Date.parse(PRIMARY_DAY) + 86400000).toISOString().slice(0, 10), afterPrimary[i], path.p2[i])] : []),
        ...(out ? [] : [knot(ELECTION_DAY, final[i], path.p3[i])]),
      ],
    };
  }).map((p) => {
    // fill the early knots' band from the first simulated knot after them
    const k1 = p.knots.find((k, j) => j > 0 && !Number.isNaN(k.lo));
    if (k1) for (const k of p.knots as ({ date: string; mid: number; lo: number; hi: number; t?: number })[]) if (Number.isNaN(k.lo)) {
      const g = Math.sqrt((k.t ?? 0) / Math.max(1, t1));
      k.lo = Math.min(k.mid, k.mid - (k1.mid - k1.lo) * g);
      k.hi = Math.max(k.mid, k.mid + (k1.hi - k1.mid) * g);
      delete k.t;
    }
    return p;
  }) : [];
  const primary = primaryOn ? {
    day: PRIMARY_DAY, pHeld, held: (100 * nHeld) / RUNS,
    winner: primWinner >= 0 ? base[primWinner].name : null,
    losers: primIdx.filter((i) => i !== primWinner).map((i) => base[i].name),
  } : null;

  // ---- markets (not under a scenario: they can't be re-priced for an imagined world)
  const hasMarkets = keys.length === 0 && odds.some((o) => o.win);

  // ---- blend
  const names = new Map<string, string>(); // norm → display name
  for (const c of base) names.set(norm(c.name), c.name);
  if (hasMarkets) for (const o of odds) if (!names.has(norm(o.name)) && (o.win?.avg ?? 0) >= 0.5) names.set(norm(o.name), o.name);
  const wm = hasMarkets && base.length >= 2 ? MARKET_WEIGHT : hasMarkets ? 1 : 0;
  const rows: ForecastRow[] = [...names.entries()].map(([k, name]) => {
    const c = base.find((x) => norm(x.name) === k);
    const o = wm > 0 ? odds.find((x) => norm(x.name) === k) : undefined;
    const pw = c ? (100 * (wins.get(c.name) ?? 0)) / RUNS : 0;
    const pq = c ? (100 * (quals.get(c.name) ?? 0)) / RUNS : 0;
    const mw = winShare(odds, o) ?? 0;
    const mq = o?.runoff?.avg ?? null;
    const qualify = c && mq != null ? (1 - wm) * pq + wm * mq : c ? pq : mq;
    return {
      name,
      win: (1 - wm) * pw + wm * mw,
      qualify,
      polls: c ? { win: pw, qualify: pq, share: c.share } : null,
      markets: o ? { win: o.win ? mw : null, qualify: mq } : null,
    };
  });
  const sumWin = rows.reduce((s, r) => s + r.win, 0) || 1;
  for (const r of rows) r.win = (100 * r.win) / sumWin; // long shots below 0.5 % on the markets are dropped: put their share back
  rows.sort((a, b) => b.win - a.win);
  return {
    rows,
    pairs: [...pairs.entries()].map(([k, v]) => { const [a, b] = k.split("|"); return { a, b, p: (100 * v.n) / RUNS, aWins: (100 * v.aWins) / v.n }; }).sort((x, y) => y.p - x.p).slice(0, 5),
    daysToGo, sd1, sd2,
    nLineupPolls: lineup.n,
    added,
    scenarios: keys,
    scenarioTargets: targets,
    marketWeight: wm,
    projection,
    affinity: aff,
    primary,
    ceilings: Object.fromEntries(base.map((c, i) => [c.name, ceiling[i]]).filter(([, v]) => Number.isFinite(v as number))),
  };
}
