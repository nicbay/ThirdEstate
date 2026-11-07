// Daily record of the 2027 forecast (src/lib/forecast.ts), so the 2027 page can show it over time.
//
//   npm run sync:forecast      (bundles this file with esbuild, then runs it)
//
// Each run:
// 1. Snapshot: today's forecast from public/data/polls/2027.json and public/data/markets.json, written as
//    today's entry (UTC date; later runs the same day replace it, so the day keeps its last value).
// 2. Backfill, for days before the first snapshot: the same model replayed day by day with
//    - the polls known on that day (fieldwork ended on or before it), and
//    - each market's closing price that day: Kalshi daily candlesticks and Polymarket price history
//      (public APIs, no key). Polymarket is blocked from France, so a run from there backfills with
//      Kalshi alone and marks those days; the next run that can reach Polymarket redoes them.
//    Volume weights between platforms use today's traded volumes (past volumes aren't published per day).
//
// Output: public/data/forecast/history.json
//   { fetchedAt, days: [{ date, live, sources: ["polls","Kalshi","Polymarket"], rows: [{ name, win, polls, markets }] }] }
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Market } from "../src/data";
import { registerParties } from "../src/lib/candidates";
import { forecast } from "../src/lib/forecast";
import type { PollFile } from "../src/lib/polls";

const OUT = new URL("../public/data/forecast/history.json", import.meta.url);
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_SERIES = "KXFRENCHPRES";
const POLY_SLUG = "next-french-presidential-election";
const DAY = 86400000;

interface Row { name: string; win: number; polls: number | null; markets: number | null }
interface Day { date: string; live: boolean; sources: string[]; rows: Row[] }
interface History { fetchedAt: string; days: Day[] }

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const r1 = (x: number) => Math.round(x * 10) / 10;
async function getJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ThirdEstate/0.1 (forecast history)" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

function entry(date: string, live: boolean, polls: PollFile, markets: Market[], asOf: string): Day {
  const fc = forecast(
    polls.firstRound.filter((p) => p.end <= asOf),
    polls.secondRound.filter((d) => d.end <= asOf),
    markets,
    asOf,
  );
  const sources = ["polls", ...new Set(markets.map((m) => m.platform))];
  return {
    date, live, sources,
    rows: fc.rows.filter((r) => r.win >= 0.5).slice(0, 10).map((r) => ({ name: r.name, win: r1(r.win), polls: r.polls ? r1(r.polls.win) : null, markets: r.markets?.win != null ? r1(r.markets.win) : null })),
  };
}

// ---- market price history → one synthetic "winner" market per platform per day
type Daily = Map<string, Map<string, number>>; // date → candidate → prob (%)

async function kalshiDaily(from: number, to: number): Promise<Daily> {
  const { markets } = await getJson<{ markets: any[] }>(`${KALSHI}/markets?series_ticker=${KALSHI_SERIES}&status=open&limit=200`);
  const out: Daily = new Map();
  for (const m of markets) {
    const name = m.yes_sub_title || m.custom_strike?.Person;
    if (!name) continue;
    const { candlesticks } = await getJson<{ candlesticks: any[] }>(`${KALSHI}/series/${KALSHI_SERIES}/markets/${m.ticker}/candlesticks?start_ts=${Math.floor(from / 1000)}&end_ts=${Math.floor(to / 1000)}&period_interval=1440`);
    let last: number | null = null;
    for (const c of candlesticks ?? []) {
      const close = Number(c.price?.close_dollars ?? c.price?.previous_dollars ?? NaN);
      if (Number.isFinite(close) && close > 0) last = close;
      if (last == null) continue;
      const date = iso(c.end_period_ts * 1000 - 1);
      if (!out.has(date)) out.set(date, new Map());
      out.get(date)!.set(name, Math.round(last * 1000) / 10);
    }
  }
  return out;
}

async function polymarketDaily(): Promise<Daily> {
  const [event] = await getJson<any[]>(`https://gamma-api.polymarket.com/events?slug=${POLY_SLUG}`);
  const out: Daily = new Map();
  for (const m of event?.markets ?? []) {
    const name = m.groupItemTitle;
    const token = JSON.parse(m.clobTokenIds ?? "[]")[0];
    if (!name || !token || /^(candidate|person|option) [a-z0-9]+$/i.test(name) || !(Number(m.volumeNum ?? 0) > 0)) continue;
    const { history } = await getJson<{ history: { t: number; p: number }[] }>(`https://clob.polymarket.com/prices-history?market=${token}&interval=max&fidelity=1440`);
    for (const h of history ?? []) {
      const date = iso(h.t * 1000);
      if (!out.has(date)) out.set(date, new Map());
      out.get(date)!.set(name, Math.round(h.p * 1000) / 10);
    }
  }
  return out;
}

const syntheticMarkets = (date: string, k: Daily | null, p: Daily | null, today: Market[]): Market[] => {
  const vol = (re: RegExp) => today.find((m) => re.test(m.id))?.volume ?? 1;
  const out: Market[] = [];
  const kd = k?.get(date), pd = p?.get(date);
  if (kd?.size) out.push({ platform: "Kalshi", id: "KXFRENCHPRES-27", question: "Winner of the 2027 presidential election", url: "", volume: vol(/^KXFRENCHPRES-/), outcomes: [...kd].map(([name, prob]) => ({ name, prob })) } as Market);
  if (pd?.size) out.push({ platform: "Polymarket", id: POLY_SLUG, question: "Next French Presidential Election", url: "", volume: vol(new RegExp(`^${POLY_SLUG}$`)), outcomes: [...pd].map(([name, prob]) => ({ name, prob })) } as Market);
  return out;
};

// ---- run
const polls = JSON.parse(await readFile(new URL("../public/data/polls/2027.json", import.meta.url), "utf8")) as PollFile;
const marketsNow = (JSON.parse(await readFile(new URL("../public/data/markets.json", import.meta.url), "utf8")) as { markets: Market[] }).markets;
registerParties(polls.parties);
let hist: History = { fetchedAt: "", days: [] };
try { hist = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }

const today = iso(Date.now());
const byDate = new Map(hist.days.map((d) => [d.date, d]));
byDate.set(today, entry(today, true, polls, marketsNow, today));

// backfill: every day before the first live snapshot that is missing, or lacks Polymarket
const firstLive = [...byDate.values()].filter((d) => d.live).map((d) => d.date).sort()[0] ?? today;
const start = Date.parse("2026-10-13"); // Kalshi's winner market opened then
const want: string[] = [];
for (let t = start; iso(t) < firstLive; t += DAY) {
  const d = byDate.get(iso(t));
  if (!d || !d.sources.includes("Polymarket")) want.push(iso(t));
}
if (want.length) {
  const from = Date.parse(want[0]) - 2 * DAY, to = Date.parse(want.at(-1)!) + 2 * DAY;
  const k = await kalshiDaily(from, to).catch((e) => (console.warn(`✗ Kalshi history: ${e.message}`), null));
  const p = await polymarketDaily().catch((e) => (console.warn(`✗ Polymarket history: ${e.message}`), null));
  let n = 0;
  for (const date of want) {
    const m = syntheticMarkets(date, k, p, marketsNow);
    if (!m.length) continue;
    const prev = byDate.get(date);
    if (prev && prev.sources.length >= m.length + 1) continue; // nothing new
    byDate.set(date, entry(date, false, polls, m, date));
    n++;
  }
  console.log(`backfill: ${n} of ${want.length} days (Kalshi ${k ? "✓" : "✗"}, Polymarket ${p ? "✓" : "✗"})`);
}

hist = { fetchedAt: new Date().toISOString(), days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
await mkdir(new URL(".", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(hist));
const t = hist.days.at(-1)!;
console.log(`forecast ${t.date}: ${t.rows.slice(0, 3).map((r) => `${r.name} ${r.win}%`).join(", ")} · ${hist.days.length} days on record`);
