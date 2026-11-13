// Polling average. Method (also shown on the Sources page):
// 1. A poll often tests several line-ups; a candidate's figure for that poll is the mean
//    across the line-ups that include them.
// 2. The average on a date is the mean of each poll's figure over the WINDOW days that end with the
//    most recent poll published by then (each poll counts once; if fewer than 3 polls fall in the
//    window, the last 3 polls are used). The window is anchored on the latest poll, not on the calendar
//    date asked for: so the average "today" and the average "as of the latest poll" are the same
//    number, whichever date a page passes (some passed today, others the latest poll's date, and the
//    two disagreed whenever an old poll had slid out of a calendar window but not out of the other).
// 3. Candidates tested in fewer than 40% of those polls are left out of the average.
// 4. Polls are weighted by their institute's grade (public/data/polls/pollsters.json, from how close each
//    firm's final polls came to the results of past elections): an A+ poll counts 1, an F poll 0.2, a firm
//    with no track record 0.6. A poorly graded poll moves the average less.
// The same `average` feeds every number and chart line on the site (trend() is it, sampled weekly).

import ratingsData from "../../public/data/polls/pollsters.json";

export interface Poll {
  pollster: string;
  start: string;
  end: string;
  sample: number | null;
  /** the poll's own publication when found (the pollster's release, else the Commission des sondages notice) */
  url?: string;
  /** what `url` points to */
  urlKind?: "pollster" | "commission" | "press";
  hyps: Record<string, number>[];
}
export interface Duel {
  pollster: string;
  start: string;
  end: string;
  sample: number | null;
  a: string;
  b: string;
  pa: number;
  pb: number;
}
export interface PollFile {
  source: string;
  fetchedAt: string;
  firstRound: Poll[];
  secondRound: Duel[];
  parties: Record<string, string>;
}

export const WINDOW = 21;
/** Candidates tested in fewer than this share of the window's polls are left out of the average. */
export const MIN_SHARE = 0.4;
/** Runoff match-ups whose latest poll is older than this (relative to the newest runoff poll) are stale. */
export const DUEL_STALE_DAYS = 365;
const DAY = 86400000;

/** One name per polling firm: "Ipsos-Sopra Steria" → "Ipsos", "OpinionWay-Kéa" → "OpinionWay",
 *  "Ifop-Fiducial" / "Ifop/Hexagone" → "Ifop", "Harris-Interactive" → "Harris Interactive". */
const FIRMS = ["Ipsos", "OpinionWay", "Ifop", "Harris Interactive", "Elabe", "BVA", "Odoxa", "Kantar", "Verian", "YouGov", "Cluster17", "AtlasIntel", "Redfield & Wilton", "Toluna", "Viavoice", "CSA", "Sofres", "TNS"];
const flat = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
export function pollsterName(raw: string) {
  const f = flat(raw);
  return FIRMS.find((n) => f === flat(n) || f.startsWith(`${flat(n)} `)) ?? raw.trim();
}

// ---------- institute grades ----------
export type Grade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F";
export interface PollsterRating {
  name: string;
  aliases?: string[];
  grade: Grade | null;
  weight: number | null;
  score: number | null;
  mae: number | null;
  elections: number;
  polls: number;
  biasFarRight: number | null;
  history: { election: string; mae: number; rel: number; end: string; url: string | null }[];
  methodology: { mode: { fr: string; en: string }; sample: string | null; notes: { fr: string; en: string } | null; url: string | null } | null;
}
export interface Ratings {
  updated: string;
  method: { fr: string; en: string };
  grades: { grade: Grade; min: number | null; max: number | null; weight: number }[];
  elections: { id: string; type: string; round: number; date: string; label: { fr: string; en: string }; source: string; resultSource: string; pollsters: number; avgError: number }[];
  pollsters: PollsterRating[];
}
export const RATINGS = ratingsData as unknown as Ratings;
/** Weight of a poll whose institute has no track record yet. */
export const UNRATED_WEIGHT = 0.6;
const byName = new Map<string, PollsterRating>();
for (const r of RATINGS.pollsters ?? []) for (const n of [r.name, ...(r.aliases ?? [])]) byName.set(flat(n), r);
/** The institute's rating, by any of its names. */
export function pollsterRating(raw: string): PollsterRating | null {
  return byName.get(flat(raw)) ?? byName.get(flat(pollsterName(raw))) ?? null;
}
/** How much a poll counts in the average (its institute's grade weight). */
export const pollWeight = (p: Pick<Poll, "pollster">) => pollsterRating(p.pollster)?.weight ?? UNRATED_WEIGHT;

export function pollValue(p: Poll, cand: string): number | null {
  const v = p.hyps.map((h) => h[cand]).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** The end date of the most recent poll (or today when there are none): the date pages quote the average "as of". */
export function latestPollDate(polls: Poll[]) {
  return polls.reduce<string | null>((m, p) => (m == null || p.end > m ? p.end : m), null) ?? new Date().toISOString().slice(0, 10);
}

/** Polls ending in the `days` days up to the latest poll at or before `asOf` (each poll once; at least
 *  the last 3 polls). With `onePerPollster`, only each firm's latest poll in the window counts. */
export function pollsInWindow(polls: Poll[], asOf: string, days = WINDOW, onePerPollster = false) {
  const t = Date.parse(asOf);
  const before = polls.filter((p) => Date.parse(p.end) <= t).sort((a, b) => b.end.localeCompare(a.end));
  const anchor = before.length ? Date.parse(before[0].end) : t;
  let inWin = before.filter((p) => Date.parse(p.end) > anchor - days * DAY);
  if (inWin.length < 3) inWin = before.slice(0, 3);
  if (!onePerPollster) return inWin;
  const seen = new Set<string>();
  return inWin.filter((p) => { const k = pollsterName(p.pollster); if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface AvgRow {
  name: string;
  avg: number;
  n: number;
}
/** THE polling average. Every page (headline, bars, strips, chart lines and labels) goes through this,
 *  so a candidate's average is the same number wherever it is shown. */
export function average(polls: Poll[], asOf: string, days = WINDOW, minShare = MIN_SHARE, onePerPollster = false): AvgRow[] {
  const win = pollsInWindow(polls, asOf, days, onePerPollster);
  const names = new Set(win.flatMap((p) => p.hyps.flatMap((h) => Object.keys(h))));
  const rows: AvgRow[] = [];
  for (const name of names) {
    let sw = 0, sv = 0, n = 0;
    for (const p of win) {
      const v = pollValue(p, name);
      if (v == null) continue;
      const w = pollWeight(p);
      sw += w; sv += w * v; n++;
    }
    if (n && n >= minShare * win.length && sw > 0) rows.push({ name, avg: sv / sw, n });
  }
  return rows.sort((a, b) => b.avg - a.avg);
}

export interface TrendOpts { days?: number; minShare?: number; onePerPollster?: boolean; /** last date (default: the latest poll) */ to?: string }
/** The same average through time, one point per week; the last point is exactly `average(…, to)`. */
export function trend(polls: Poll[], from?: string, opts: TrendOpts = {}) {
  if (!polls.length) return [];
  const { days = WINDOW, minShare = MIN_SHARE, onePerPollster = false } = opts;
  const ends = polls.map((p) => Date.parse(p.end));
  const start = Math.max(Math.min(...ends), from ? Date.parse(from) : 0);
  const stop = opts.to ? Date.parse(opts.to) : Math.max(...ends);
  const out: { date: string; values: Record<string, number> }[] = [];
  // weekly points, and always a final point exactly on `stop` (so the end label is today's average)
  for (let t = start; ; t += 7 * DAY) {
    const date = new Date(Math.min(t, stop)).toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    for (const r of average(polls, date, days, minShare, onePerPollster)) values[r.name] = r.avg;
    out.push({ date, values });
    if (t >= stop) break;
  }
  return out;
}

export interface DuelAvg { winner: string; pw: number; loser: string; pl: number; n: number; total: number; last: string; stale: boolean }
/** Runoff match-ups: average of each pairing over the last `days` days it was polled.
 *  A pairing whose latest poll is more than DUEL_STALE_DAYS older than `asOf` (default: the newest
 *  runoff poll) is flagged `stale`; pages and the forecast leave stale pairings out. */
export function duelAverages(duels: Duel[], days = 60, asOf?: string): DuelAvg[] {
  const ref = asOf ? Date.parse(asOf) : Math.max(0, ...duels.map((d) => Date.parse(d.end)));
  const pairs = new Map<string, Duel[]>();
  for (const d of duels) {
    if (asOf && Date.parse(d.end) > ref) continue;
    const [a, b] = [d.a, d.b].sort();
    const k = `${a}|${b}`;
    pairs.set(k, [...(pairs.get(k) ?? []), d]);
  }
  return [...pairs.values()]
    .map((list) => {
      const ds = [...list].sort((x, y) => y.end.localeCompare(x.end));
      const last = Date.parse(ds[0].end);
      const recent = ds.filter((d) => Date.parse(d.end) > last - days * DAY);
      const a = recent[0].a;
      const b = recent[0].b;
      const val = (d: Duel, who: string) => (d.a === who ? d.pa : d.pb);
      const pa = recent.reduce((s, d) => s + val(d, a), 0) / recent.length;
      const pb = recent.reduce((s, d) => s + val(d, b), 0) / recent.length;
      const [w, l] = pa >= pb ? [[a, pa], [b, pb]] : [[b, pb], [a, pa]];
      return { winner: w[0] as string, pw: w[1] as number, loser: l[0] as string, pl: l[1] as number, n: recent.length, total: ds.length, last: ds[0].end, stale: ref - last > DUEL_STALE_DAYS * DAY };
    })
    .sort((x, y) => y.total - x.total);
}

/** The candidate line-up pollsters tested most often in the window, averaged over those polls.
 *  Unlike `average`, its shares add up to ~100 because everyone in it was tested together. */
export function referenceLineup(polls: Poll[], asOf: string) {
  const hyps = pollsInWindow(polls, asOf).flatMap((p) => p.hyps);
  const sets = new Map<string, Record<string, number>[]>();
  for (const h of hyps) {
    const k = Object.keys(h).sort().join("|");
    sets.set(k, [...(sets.get(k) ?? []), h]);
  }
  const best = [...sets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const names = Object.keys(best[0] ?? {});
  return { n: best.length, rows: names.map((name) => ({ name, share: best.reduce((s, h) => s + h[name], 0) / best.length })) };
}
