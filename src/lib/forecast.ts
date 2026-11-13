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
import { average, duelAverages, referenceLineup, type Duel, type Poll } from "./polls";

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

export type ScenarioKey = "base" | "right-rallies" | "left-unites" | "le-pen-out" | "setback-le-pen" | "setback-melenchon" | "setback-centre";
export interface ScenarioDef { key: ScenarioKey; fr: string; en: string; descFr: string; descEn: string; kind: "base" | "rally" | "ballot" | "setback" }
const pc = (x: number) => Math.round(x * 100);
export const SCENARIOS: ScenarioDef[] = [
  { key: "base", kind: "base", fr: "Les sondages du jour", en: "Today’s polls", descFr: "Notre prévision telle quelle : le modèle des sondages et les marchés, à parts égales.", descEn: "Our forecast as it stands: the polls model and the markets, half and half." },
  { key: "right-rallies", kind: "rally", fr: "Le centre et la droite se rassemblent", en: "Centre and right rally", descFr: `Les autres candidats du centre et de la droite cèdent ${pc(RALLY_SHARE)} % de leurs voix au mieux placé d’entre eux.`, descEn: `The other centre and right candidates hand ${pc(RALLY_SHARE)}% of their vote to the best placed among them.` },
  { key: "left-unites", kind: "rally", fr: "La gauche s’unit", en: "The left unites", descFr: `Les autres candidats de gauche cèdent ${pc(RALLY_SHARE)} % de leurs voix au mieux placé d’entre eux.`, descEn: `The other left-wing candidates hand ${pc(RALLY_SHARE)}% of their vote to the best placed among them.` },
  { key: "le-pen-out", kind: "ballot", fr: "Le Pen n’est pas candidate", en: "Le Pen doesn’t run", descFr: "Jordan Bardella la remplace, au niveau que lui donnent les sondages qui le testent.", descEn: "Jordan Bardella replaces her, at the level the polls that test him give him." },
  { key: "setback-le-pen", kind: "setback", fr: "Coup dur pour Le Pen", en: "Major setback: Le Pen", descFr: `Elle perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `She loses ${pc(SETBACK_SHARE)}% of her first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
  { key: "setback-melenchon", kind: "setback", fr: "Coup dur pour Mélenchon", en: "Major setback: Mélenchon", descFr: `Il perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `He loses ${pc(SETBACK_SHARE)}% of his first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
  { key: "setback-centre", kind: "setback", fr: "Coup dur pour le centre", en: "Major setback: the centre", descFr: `Le candidat du centre le mieux placé perd ${pc(SETBACK_SHARE)} % de ses voix au premier tour et ${SETBACK_RUNOFF} points dans chaque duel.`, descEn: `The best-placed centrist loses ${pc(SETBACK_SHARE)}% of their first-round vote and ${SETBACK_RUNOFF} points in every runoff.` },
];
export const isScenario = (k: string | null | undefined): k is ScenarioKey => SCENARIOS.some((s) => s.key === k);

export interface ForecastRow {
  name: string;
  /** blended chance of winning, % */
  win: number;
  /** blended chance of reaching the runoff, % (null if neither source has it) */
  qualify: number | null;
  polls: { win: number; qualify: number; share: number } | null;
  markets: { win: number | null; qualify: number | null } | null;
}
/** Where a candidate's first-round score lands on election day in the polls model: the starting share (after the
 *  scenario), its 80 % range, and how far the scenario moved the starting share. */
export interface Projection { name: string; mid: number; lo: number; hi: number; shift: number }
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
  scenario: ScenarioKey;
  /** who the scenario acted on (the rallying leader, the candidate hit, the replacement) */
  scenarioTarget: string | null;
  /** markets weight actually used (0 under a scenario) */
  marketWeight: number;
  projection: Projection[];
  /** transfer rates by political distance, fitted to the runoff polls */
  affinity: number[];
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

/** Uncertainty shrinks as the vote nears: linear in days to go, between eve-of-vote and six-months values. */
export function errors(daysToGo: number) {
  const k = Math.max(0, Math.min(1, daysToGo / 180));
  return { sd1: 2 + 1.5 * k, sd2: 3.5 + 2.5 * k, bloc: 1.5 };
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

export function forecast(firstRound: Poll[], secondRound: Duel[], markets: Market[], asOf: string, scenario: ScenarioKey = "base"): Forecast {
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(asOf)) / 86400000));
  const { sd1, sd2, bloc: sdBloc } = errors(daysToGo);
  const lineup = referenceLineup(firstRound, asOf);
  const base: Cand[] = lineup.rows.map((r) => ({ name: r.name, share: r.share, bloc: meta(r.name).bloc }));
  const duels = duelAverages(secondRound, undefined, asOf).filter((d) => !d.stale);
  const odds = combineOdds(markets);
  const added: string[] = [];
  const polled = average(firstRound, asOf, undefined, 0);
  for (const o of odds) {
    if ((winShare(odds, o) ?? 0) < 3 || base.some((c) => norm(c.name) === norm(o.name))) continue;
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
  const before = new Map(base.map((c) => [c, c.share]));
  const { target, handicap } = applyScenario(scenario, base, firstRound, aff);

  const runoffShare = (a: string, b: string) => {
    const d = duels.find((x) => [x.winner, x.loser].sort().join() === [a, b].sort().join());
    let v: number;
    if (d) v = d.winner === a ? (100 * d.pw) / (d.pw + d.pl) : (100 * d.pl) / (d.pw + d.pl);
    else {
      const A = base.find((c) => c.name === a), B = base.find((c) => c.name === b);
      v = A && B ? transferShare(base, A, B, aff) : 50;
    }
    return v - (handicap.get(a) ?? 0) + (handicap.get(b) ?? 0);
  };

  // ---- polls model
  const rand = mulberry32(2027);
  const wins = new Map<string, number>(), quals = new Map<string, number>();
  const pairs = new Map<string, { n: number; aWins: number }>();
  const runoffCache = new Map<string, number>();
  const sims = base.map(() => new Float32Array(RUNS));
  for (let r = 0; r < RUNS && base.length >= 2; r++) {
    const blocShift = [0, 1, 2, 3, 4].map(() => sdBloc * gauss(rand));
    let i1 = -1, i2 = -1, v1 = -Infinity, v2 = -Infinity;
    for (let i = 0; i < base.length; i++) {
      const c = base[i];
      const v = c.share + (c.bloc != null ? blocShift[c.bloc] : 0) + sd1 * gauss(rand);
      sims[i][r] = v;
      if (v > v1) { i2 = i1; v2 = v1; i1 = i; v1 = v; } else if (v > v2) { i2 = i; v2 = v; }
    }
    const [a, b] = [base[i1].name, base[i2].name].sort();
    const key = `${a}|${b}`;
    let ra = runoffCache.get(key);
    if (ra == null) { ra = runoffShare(a, b); runoffCache.set(key, ra); }
    const aWins = ra + sd2 * gauss(rand) > 50;
    const w = aWins ? a : b;
    wins.set(w, (wins.get(w) ?? 0) + 1);
    quals.set(a, (quals.get(a) ?? 0) + 1);
    quals.set(b, (quals.get(b) ?? 0) + 1);
    const p = pairs.get(key) ?? { n: 0, aWins: 0 };
    p.n++; if (aWins) p.aWins++;
    pairs.set(key, p);
  }
  const quant = (arr: Float32Array, f: number) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  const projection: Projection[] = base.length >= 2 ? base.map((c, i) => ({ name: c.name, mid: c.share, lo: Math.max(0, quant(sims[i], 0.1)), hi: quant(sims[i], 0.9), shift: c.share - (before.get(c) ?? c.share) })) : [];

  // ---- markets (not under a scenario: they can't be re-priced for an imagined world)
  const hasMarkets = scenario === "base" && odds.some((o) => o.win);

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
    scenario,
    scenarioTarget: target,
    marketWeight: wm,
    projection,
    affinity: aff,
  };
}
