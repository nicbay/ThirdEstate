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

/** First round of the 2027 presidential election. The decree isn't out yet: the Constitution puts it
 *  20–35 days before the end of the current term (13 May 2027), so mid-April; we use 11 April. */
export const ELECTION_DAY = "2027-04-11";
export const MARKET_WEIGHT = 0.5;
const RUNS = 20000;

// Default transfer by political distance (0 = same family … 4 = opposite ends), capped at 90 % in total.
const AFFINITY = [0.85, 0.5, 0.4, 0.15, 0.15];
export function defaultTransfer(from: Bloc | null, a: Bloc | null, b: Bloc | null): [number, number] {
  if (from == null || a == null || b == null) return [35, 35];
  let ta = AFFINITY[Math.abs(from - a)], tb = AFFINITY[Math.abs(from - b)];
  const sum = ta + tb;
  if (sum > 0.9) [ta, tb] = [(ta * 0.9) / sum, (tb * 0.9) / sum];
  return [Math.round(ta * 100), Math.round(tb * 100)];
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
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

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

export function forecast(firstRound: Poll[], secondRound: Duel[], markets: Market[], asOf: string): Forecast {
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(asOf)) / 86400000));
  const { sd1, sd2, bloc: sdBloc } = errors(daysToGo);
  const lineup = referenceLineup(firstRound, asOf);
  const base = lineup.rows.map((r) => ({ name: r.name, share: r.share, bloc: meta(r.name).bloc }));
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

  const runoffShare = (a: string, b: string) => {
    const d = duels.find((x) => [x.winner, x.loser].sort().join() === [a, b].sort().join());
    if (d) return d.winner === a ? (100 * d.pw) / (d.pw + d.pl) : (100 * d.pl) / (d.pw + d.pl);
    const A = base.find((c) => c.name === a), B = base.find((c) => c.name === b);
    if (!A || !B) return 50;
    let va = A.share, vb = B.share;
    for (const c of base) if (c !== A && c !== B) { const [ta, tb] = defaultTransfer(c.bloc, A.bloc, B.bloc); va += (c.share * ta) / 100; vb += (c.share * tb) / 100; }
    return (100 * va) / (va + vb);
  };

  // ---- polls model
  const rand = mulberry32(2027);
  const wins = new Map<string, number>(), quals = new Map<string, number>();
  const pairs = new Map<string, { n: number; aWins: number }>();
  const runoffCache = new Map<string, number>();
  for (let r = 0; r < RUNS && base.length >= 2; r++) {
    const blocShift = [0, 1, 2, 3, 4].map(() => sdBloc * gauss(rand));
    let i1 = -1, i2 = -1, v1 = -Infinity, v2 = -Infinity;
    for (let i = 0; i < base.length; i++) {
      const c = base[i];
      const v = c.share + (c.bloc != null ? blocShift[c.bloc] : 0) + sd1 * gauss(rand);
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

  // ---- markets
  const hasMarkets = odds.some((o) => o.win);

  // ---- blend
  const names = new Map<string, string>(); // norm → display name
  for (const c of base) names.set(norm(c.name), c.name);
  for (const o of odds) if (!names.has(norm(o.name)) && (o.win?.avg ?? 0) >= 0.5) names.set(norm(o.name), o.name);
  const wm = hasMarkets && base.length >= 2 ? MARKET_WEIGHT : hasMarkets ? 1 : 0;
  const rows: ForecastRow[] = [...names.entries()].map(([k, name]) => {
    const c = base.find((x) => norm(x.name) === k);
    const o = odds.find((x) => norm(x.name) === k);
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
  };
}
