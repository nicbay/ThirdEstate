// Prediction markets, combined per candidate across Kalshi and Polymarket.
import type { Market } from "../data";

export interface Odds { name: string; win: { kalshi?: number; polymarket?: number; avg: number } | null; runoff: { kalshi?: number; polymarket?: number; avg: number } | null }

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const isWinner = (m: Market) => /^KXFRENCHPRES-/.test(m.id) || /^next french presidential election$/i.test(m.question.trim());
const isRunoff = (m: Market) => /^KXFRPRESADVANCE/.test(m.id) || /advance to the 2nd round|who will advance/i.test(m.question);
const platform = (m: Market) => (m.platform.toLowerCase().startsWith("kalshi") ? "kalshi" : "polymarket") as "kalshi" | "polymarket";

/** Win and runoff-qualification probabilities (%) per candidate, averaged over the platforms that list them. */
export function combineOdds(markets: Market[]): Odds[] {
  const by = new Map<string, Odds>();
  const add = (kind: "win" | "runoff", m: Market) => {
    for (const o of m.outcomes) {
      if (/^other|^autre/i.test(o.name)) continue;
      const k = norm(o.name);
      const row = by.get(k) ?? { name: o.name, win: null, runoff: null };
      const cell = row[kind] ?? { avg: 0 };
      cell[platform(m)] = o.prob;
      const vals = [cell.kalshi, cell.polymarket].filter((v): v is number => v != null);
      cell.avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      row[kind] = cell;
      by.set(k, row);
    }
  };
  for (const m of markets) {
    if (isWinner(m)) add("win", m);
    else if (isRunoff(m)) add("runoff", m);
  }
  return [...by.values()].filter((r) => r.win || r.runoff).sort((a, b) => (b.win?.avg ?? 0) - (a.win?.avg ?? 0));
}
export const oddsFor = (odds: Odds[], name: string) => odds.find((o) => norm(o.name) === norm(name));
