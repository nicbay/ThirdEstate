// Daily closing prices of the "who wins the 2027 presidential election" market on Kalshi and Polymarket
// (public APIs, no key), shared by scripts/forecast-history.ts and scripts/daily-brief.ts.
// Polymarket is blocked from France: from there only Kalshi answers; the GitHub runner reaches both.
export const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
export const KALSHI_SERIES = "KXFRENCHPRES";
export const POLY_SLUG = "next-french-presidential-election";
export const DAY = 86400000;
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** GET JSON, pacing requests and backing off on 429 (Kalshi rate-limits shared CI addresses). */
export async function getJson<T = any>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await sleep(attempt ? 2000 * 2 ** attempt : 250);
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ThirdEstate/0.1 (forecast history)" }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && attempt < 5) continue;
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json() as Promise<T>;
  }
}

// ---- market price history → one synthetic "winner" market per platform per day
export type Daily = Map<string, Map<string, number>>; // date → candidate → prob (%)

export async function kalshiDaily(from: number, to: number): Promise<Daily> {
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

export async function polymarketDaily(): Promise<Daily> {
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

