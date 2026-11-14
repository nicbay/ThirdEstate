// Recompute every day of public/data/forecast/history.json with the current model (after a method change, so
// the line doesn't jump on the day the method changed), keeping each day's recorded market prices: the stored
// markets figure is fed back in as that day's winner market. No network needed.
//
//   npx esbuild scripts/recompute-history.ts --bundle --platform=node --format=esm --outfile=.cache/recompute-history.mjs && node .cache/recompute-history.mjs
import { readFile, writeFile } from "node:fs/promises";
import type { Market } from "../src/data";
import { registerParties } from "../src/lib/candidates";
import { forecast } from "../src/lib/forecast";
import type { PollFile } from "../src/lib/polls";

interface Row { name: string; win: number; polls: number | null; markets: number | null }
interface Day { date: string; live: boolean; sources: string[]; rows: Row[] }
const OUT = new URL("../public/data/forecast/history.json", import.meta.url);
const r1 = (x: number) => Math.round(x * 10) / 10;

const polls = JSON.parse(await readFile(new URL("../public/data/polls/2027.json", import.meta.url), "utf8")) as PollFile;
registerParties(polls.parties);
const hist = JSON.parse(await readFile(OUT, "utf8")) as { fetchedAt: string; days: Day[] };

for (const d of hist.days) {
  const recorded = d.rows.filter((r) => r.markets != null);
  const markets: Market[] = recorded.length
    ? [{ platform: "Kalshi", id: "KXFRENCHPRES-27", question: "Winner of the 2027 presidential election", url: "", volume: 1, outcomes: recorded.map((r) => ({ name: r.name, prob: r.markets! })) } as unknown as Market]
    : [];
  const fc = forecast(polls.firstRound.filter((p) => p.end <= d.date), polls.secondRound.filter((x) => x.end <= d.date), markets, d.date);
  const before = d.rows[0];
  d.rows = fc.rows.filter((r) => r.win >= 0.5).slice(0, 10).map((r) => ({ name: r.name, win: r1(r.win), polls: r.polls ? r1(r.polls.win) : null, markets: r.markets?.win != null ? r1(r.markets.win) : null }));
  console.log(d.date, before?.name.split(" ").pop(), before?.win, "→", d.rows[0]?.win, "polls", before?.polls, "→", d.rows[0]?.polls);
}
await writeFile(OUT, JSON.stringify(hist));
