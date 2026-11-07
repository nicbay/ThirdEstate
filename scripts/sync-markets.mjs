// Prediction-market odds on the 2027 French presidential election.
//   npm run sync:markets
// Kalshi: public trade API (no key). Polymarket: public Gamma API (no key).
// Polymarket is blocked by French ISPs, so it usually only succeeds on the GitHub runner;
// a failed source is recorded in `errors` and the other sources are still written.
//
// Output: public/data/markets.json
//   { fetchedAt, markets: [{ platform, id, question, url, volume, outcomes: [{ name, prob }] }], errors: [] }

import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../public/data/", import.meta.url);
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_SERIES = {
  KXFRENCHPRES: "Winner of the 2027 presidential election",
  KXFRPRESADVANCE: "Who will advance to the runoff?",
  KXFRPRES1R1ST: "1st place in the first round",
};

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function kalshi() {
  const out = [];
  for (const [series, question] of Object.entries(KALSHI_SERIES)) {
    const { markets } = await getJson(`${KALSHI}/markets?series_ticker=${series}&status=open&limit=200`);
    if (!markets?.length) continue;
    const byEvent = Map.groupBy(markets, (m) => m.event_ticker);
    for (const [event, ms] of byEvent) {
      const outcomes = ms
        .map((m) => {
          const bid = Number(m.yes_bid_dollars), ask = Number(m.yes_ask_dollars), last = Number(m.last_price_dollars);
          // mid-quote when the spread is tight, else last trade
          const prob = bid > 0 && ask > 0 && ask - bid <= 0.05 ? (bid + ask) / 2 : last;
          return { name: m.yes_sub_title, prob: Math.round(prob * 1000) / 10, volume: Number(m.volume_fp ?? 0) };
        })
        .filter((o) => o.name && o.prob > 0)
        .sort((a, b) => b.prob - a.prob);
      out.push({ platform: "Kalshi", id: event, question, url: `https://kalshi.com/markets/${series.toLowerCase()}`, volume: Math.round(outcomes.reduce((s, o) => s + o.volume, 0)), outcomes: outcomes.map(({ name, prob }) => ({ name, prob })) });
    }
  }
  return out;
}

// Polymarket lists unlaunched placeholder outcomes ("Candidate A", "Person 3") and many tiny side bets.
const PLACEHOLDER = /^(candidate|person|option) [a-z0-9]+$/i;
const MIN_VOLUME = 50000; // USD traded; below this a market says little
const MAX_POLYMARKET = 6;

async function polymarket() {
  const events = await getJson("https://gamma-api.polymarket.com/events?closed=false&limit=200&tag_slug=france");
  return events
    .filter((e) => /french presiden|france presiden/i.test(e.title) && Number(e.volume ?? 0) >= MIN_VOLUME)
    .map((e) => ({
      platform: "Polymarket",
      id: e.slug,
      question: e.title,
      url: `https://polymarket.com/event/${e.slug}`,
      volume: Math.round(Number(e.volume ?? 0)),
      outcomes: (e.markets ?? [])
        .filter((m) => !m.closed && Number(m.volumeNum ?? m.volume ?? 0) > 0) // untraded outcomes sit at a default 50 %
        .map((m) => ({ name: m.groupItemTitle || m.question, prob: Math.round(Number(JSON.parse(m.outcomePrices ?? "[0]")[0]) * 1000) / 10 }))
        .filter((o) => o.prob > 0 && !PLACEHOLDER.test(o.name))
        .sort((a, b) => b.prob - a.prob),
    }))
    .filter((m) => m.outcomes.length)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_POLYMARKET);
}

const markets = [];
const errors = [];
for (const [name, fn] of [["Kalshi", kalshi], ["Polymarket", polymarket]]) {
  try {
    const m = await fn();
    markets.push(...m);
    console.log(`✓ ${name}: ${m.length} markets`);
  } catch (e) {
    errors.push({ platform: name, error: String(e.message ?? e) });
    console.warn(`✗ ${name}: ${e.message ?? e}`);
  }
}
if (!markets.length) throw new Error("No market source succeeded; keeping the previous file.");
await mkdir(OUT, { recursive: true });
await writeFile(new URL("markets.json", OUT), JSON.stringify({ fetchedAt: new Date().toISOString(), markets, errors }));
