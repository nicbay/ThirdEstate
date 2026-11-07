// Polling average. Method (also shown on the Sources page):
// 1. A poll often tests several line-ups; a candidate's figure for that poll is the mean
//    across the line-ups that include them.
// 2. The average on a date is the mean of each poll's figure over the previous WINDOW days
//    (each poll counts once; if fewer than 3 polls fall in the window, the last 3 polls are used).
// 3. Candidates tested in fewer than 40% of those polls are left out of the headline average.

export interface Poll {
  pollster: string;
  start: string;
  end: string;
  sample: number | null;
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
const DAY = 86400000;

export function pollValue(p: Poll, cand: string): number | null {
  const v = p.hyps.map((h) => h[cand]).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function pollsInWindow(polls: Poll[], asOf: string, days = WINDOW) {
  const t = Date.parse(asOf);
  const inWin = polls.filter((p) => Date.parse(p.end) <= t && Date.parse(p.end) > t - days * DAY);
  if (inWin.length >= 3) return inWin;
  return polls.filter((p) => Date.parse(p.end) <= t).sort((a, b) => b.end.localeCompare(a.end)).slice(0, 3);
}

export interface AvgRow {
  name: string;
  avg: number;
  n: number;
}
export function average(polls: Poll[], asOf: string, days = WINDOW, minShare = 0.4): AvgRow[] {
  const win = pollsInWindow(polls, asOf, days);
  const names = new Set(win.flatMap((p) => p.hyps.flatMap((h) => Object.keys(h))));
  const rows: AvgRow[] = [];
  for (const name of names) {
    const vals = win.map((p) => pollValue(p, name)).filter((x): x is number => x != null);
    if (vals.length && vals.length >= minShare * win.length) rows.push({ name, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length });
  }
  return rows.sort((a, b) => b.avg - a.avg);
}

/** Average through time, one point per week. */
export function trend(polls: Poll[], from?: string, days = 30) {
  if (!polls.length) return [];
  const ends = polls.map((p) => Date.parse(p.end));
  const start = Math.max(Math.min(...ends), from ? Date.parse(from) : 0);
  const stop = Math.max(...ends);
  const out: { date: string; values: Record<string, number> }[] = [];
  for (let t = start; t <= stop + DAY; t += 7 * DAY) {
    const date = new Date(Math.min(t, stop)).toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    for (const r of average(polls, date, days, 0.3)) values[r.name] = r.avg;
    out.push({ date, values });
    if (t >= stop) break;
  }
  return out;
}

/** Runoff match-ups: average of each pairing over the last `days` days it was polled. */
export function duelAverages(duels: Duel[], days = 60) {
  const pairs = new Map<string, Duel[]>();
  for (const d of duels) {
    const [a, b] = [d.a, d.b].sort();
    const k = `${a}|${b}`;
    pairs.set(k, [...(pairs.get(k) ?? []), d]);
  }
  return [...pairs.values()]
    .map((ds) => {
      const last = Date.parse(ds[0].end);
      const recent = ds.filter((d) => Date.parse(d.end) > last - days * DAY);
      const a = recent[0].a;
      const b = recent[0].b;
      const val = (d: Duel, who: string) => (d.a === who ? d.pa : d.pb);
      const pa = recent.reduce((s, d) => s + val(d, a), 0) / recent.length;
      const pb = recent.reduce((s, d) => s + val(d, b), 0) / recent.length;
      const [w, l] = pa >= pb ? [[a, pa], [b, pb]] : [[b, pb], [a, pa]];
      return { winner: w[0] as string, pw: w[1] as number, loser: l[0] as string, pl: l[1] as number, n: recent.length, total: ds.length, last: ds[0].end };
    })
    .sort((x, y) => y.total - x.total);
}
