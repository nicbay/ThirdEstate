// Prediction markets, combined per candidate across Kalshi and Polymarket.
//
// Method (shown on the 2027 page):
// - Winner markets are rescaled to sum to 100 % (removing the platforms margin); runoff markets
//   are used as quoted (see add()).
// - Platforms are averaged weighted by each market's traded volume, so a thin market counts little.
// - "If qualified" = P(win) / P(reach runoff): what the markets imply for a candidate who makes it.
import type { Market } from "../data";

export interface Cell { kalshi?: number; polymarket?: number; avg: number }
export interface Odds { name: string; win: Cell | null; runoff: Cell | null; ifQualified: number | null }

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
export const isWinner = (m: Market) => /^KXFRENCHPRES-/.test(m.id) || /^next french presidential election$/i.test(m.question.trim());
export const isRunoff = (m: Market) => /^KXFRPRESADVANCE/.test(m.id) || /advance to the 2nd round|who will advance/i.test(m.question);
const platform = (m: Market) => (m.platform.toLowerCase().startsWith("kalshi") ? "kalshi" : "polymarket") as "kalshi" | "polymarket";
/** Markets below this traded volume are shown but flagged as thin. */
export const THIN_VOLUME = 100000;

export function combineOdds(markets: Market[]): Odds[] {
  const acc = new Map<string, { name: string; win: Map<string, { p: number; w: number }>; runoff: Map<string, { p: number; w: number }> }>();
  const add = (kind: "win" | "runoff", m: Market) => {
    // Winner markets: rescale to 100 % (the excess is the platform's margin, a few points).
    // Runoff markets are many separate yes/no contracts whose long shots each sit at a price floor,
    // so their sum (200–320 %) is mostly tail noise: rescaling would wrongly shrink the favourites.
    const total = m.outcomes.reduce((s, o) => s + o.prob, 0) || 1;
    const scale = kind === "win" && total > 100 ? 100 / total : 1;
    for (const o of m.outcomes) {
      if (/^other|^autre/i.test(o.name)) continue;
      const k = norm(o.name);
      const row = acc.get(k) ?? { name: o.name, win: new Map(), runoff: new Map() };
      row[kind].set(platform(m), { p: Math.min(100, o.prob * scale), w: Math.max(1, m.volume) });
      acc.set(k, row);
    }
  };
  for (const m of markets) {
    if (isWinner(m)) add("win", m);
    else if (isRunoff(m)) add("runoff", m);
  }
  const cell = (mp: Map<string, { p: number; w: number }>): Cell | null => {
    if (!mp.size) return null;
    let sw = 0, sp = 0;
    const c: Cell = { avg: 0 };
    for (const [pl, { p, w }] of mp) { c[pl as "kalshi" | "polymarket"] = p; sw += w; sp += p * w; }
    c.avg = sp / sw;
    return c;
  };
  return [...acc.values()]
    .map((r) => {
      const win = cell(r.win), runoff = cell(r.runoff);
      const ifQualified = win && runoff && runoff.avg >= 2 ? Math.min(100, (100 * win.avg) / runoff.avg) : null;
      return { name: r.name, win, runoff, ifQualified };
    })
    .filter((r) => r.win || r.runoff)
    .sort((a, b) => (b.win?.avg ?? 0) - (a.win?.avg ?? 0));
}
export const oddsFor = (odds: Odds[], name: string) => odds.find((o) => norm(o.name) === norm(name));
/** Volume and freshness per market, for the caption. */
export const marketMeta = (markets: Market[]) => markets.filter((m) => isWinner(m) || isRunoff(m)).map((m) => ({ platform: m.platform, kind: isWinner(m) ? "win" : "runoff", volume: m.volume, thin: m.volume < THIN_VOLUME }));
