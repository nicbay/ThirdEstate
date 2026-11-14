// The day's edition: one file per day for the homepage, so readers can step back through past days. Each edition
// holds the moves of the day and of the week on the prediction markets (Kalshi and Polymarket averaged) and in the
// polling average, the polls published that day, the most-covered headlines, and an analysis of what could have
// moved each candidate who moved: the polls (same way or not), the day's new polls, the headlines naming them, a
// gap between the two markets. Every figure is computed here from the records; the analysis only lines them up,
// and says plainly when nothing in the record explains a move (a thin market can move on one large order).
//
//   node scripts/build-editions.mjs        (after sync:daily; npm run sync:daily runs it)
//
// Inputs: public/data/daily/history.json (one snapshot a day), public/data/feed/archive/<date>.json (the day's
// stories), public/data/polls/2027.json.
// Output: public/data/daily/editions/<date>.json and editions/index.json [{ date, head }]
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../public/data/", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const r1 = (x) => Math.round(x * 10) / 10;
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
/** "Marine Le Pen" → "le pen", "Dominique de Villepin" → "villepin": what a headline would say */
const surnameKey = (name) => norm(name.split(" ").slice(1).join(" ").replace(/^(de |d’|d')/i, ""));
const surname = (name) => name.split(" ").slice(1).join(" ").replace(/^de /, "");

const hist = await read("daily/history.json");
const polls = (await read("polls/2027.json")).firstRound;
const days = [...hist.days].sort((a, b) => a.date.localeCompare(b.date));
// The daily brief runs once a day, sometimes hours late: when today has no snapshot yet, today's edition is built
// from the hourly market prices (public/data/markets.json), with the polling figures of the last snapshot, so the
// homepage always shows today. The real snapshot replaces it at the next daily run.
const todayIso = iso(Date.now());
if (days.length && days.at(-1).date < todayIso) {
  const m = await read("markets.json").catch(() => null);
  const probs = (mk) => {
    if (!mk) return null;
    const total = mk.outcomes.reduce((t, o) => t + o.prob, 0) || 1;
    const k = total > 100 ? 100 / total : 1; // winner markets sum a little over 100: the platform's margin
    return Object.fromEntries(mk.outcomes.filter((o) => !/^other|^autre/i.test(o.name)).map((o) => [o.name, Math.round(o.prob * k * 10) / 10]));
  };
  const kalshi = probs(m?.markets?.find((x) => x.id === "KXFRENCHPRES-27"));
  const poly = probs(m?.markets?.find((x) => x.id === "next-french-presidential-election"));
  if (kalshi || poly) days.push({ date: todayIso, polls: days.at(-1).polls, kalshi, poly, seen: [], provisional: true });
}
const byDate = new Map(days.map((d) => [d.date, d]));
const before = (date, n) => { // the snapshot n days earlier, or the nearest earlier one
  for (let k = n; k <= n + 3; k++) { const d = byDate.get(iso(Date.parse(date) - k * DAY)); if (d) return d; }
  return null;
};
const market = (s, name) => {
  const xs = [s?.kalshi?.[name], s?.poly?.[name]].filter((v) => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const diff = (a, b) => (a == null || b == null ? null : r1(a - b));
const pollMean = (p, name) => { const v = p.hyps.map((h) => h[name]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const stories = async (date) => {
  const f = await read(`feed/archive/${date}.json`).catch(() => null);
  return (f?.stories ?? []).map((s) => ({ title: s.title, link: s.items?.[0]?.link ?? null, outlet: s.items?.[0]?.outlet ?? s.outlets?.[0] ?? "", n: s.outlets?.length ?? 1 }));
};

await mkdir(new URL("daily/editions/", ROOT), { recursive: true });
const index = [];
for (const day of days) {
  const D = day.date, y1 = before(D, 1), y7 = before(D, 7);
  const names = [...new Set([...Object.keys(day.kalshi ?? {}), ...Object.keys(day.poly ?? {}), ...Object.keys(day.polls ?? {})])];
  const rows = names.map((name) => ({
    name,
    market: market(day, name) == null ? null : r1(market(day, name)),
    d1: diff(market(day, name), market(y1, name)), d7: diff(market(day, name), market(y7, name)),
    kalshi1: diff(day.kalshi?.[name], y1?.kalshi?.[name]), poly1: diff(day.poly?.[name], y1?.poly?.[name]),
    polls: day.polls?.[name] ?? null, polls7: diff(day.polls?.[name], y7?.polls?.[name]),
  })).filter((r) => (r.market ?? 0) >= 1 || (r.polls ?? 0) >= 3).sort((a, b) => (b.market ?? 0) - (a.market ?? 0));

  // polls published since the previous edition (by fieldwork end), and the day's and the eve's stories
  const from = y1?.date ?? iso(Date.parse(D) - DAY);
  const fresh = polls.filter((p) => p.end > from && p.end <= D).map((p) => ({
    pollster: p.pollster, end: p.end, url: p.url ?? null,
    top: [...new Set(p.hyps.flatMap((h) => Object.keys(h)))].map((n) => ({ name: n, v: r1(pollMean(p, n)) })).sort((a, b) => b.v - a.v).slice(0, 5),
  }));
  const news = [...await stories(D), ...await stories(iso(Date.parse(D) - DAY))];
  const seen = new Set();
  const headlines = news.filter((s) => (seen.has(s.title) ? false : (seen.add(s.title), true))).sort((a, b) => b.n - a.n);

  // who moved: a point in a day or 2.5 in a week on the markets, the four largest
  const movers = rows.filter((r) => (r.d1 != null && Math.abs(r.d1) >= 1) || (r.d7 != null && Math.abs(r.d7) >= 2.5))
    .sort((a, b) => Math.abs(b.d1 ?? 0) + Math.abs(b.d7 ?? 0) / 3 - (Math.abs(a.d1 ?? 0) + Math.abs(a.d7 ?? 0) / 3)).slice(0, 4);
  const analysis = movers.map((r) => {
    const dir = Math.sign((r.d1 != null && Math.abs(r.d1) >= 1 ? r.d1 : r.d7) ?? 0);
    const factors = [];
    if (r.polls7 != null && Math.abs(r.polls7) >= 0.5) factors.push({ kind: "polls", same: Math.sign(r.polls7) === dir, d: r.polls7 });
    for (const p of fresh) {
      const v = p.top.find((t) => t.name === r.name)?.v;
      if (v != null && r.polls != null && Math.abs(v - r.polls) >= 1.5) factors.push({ kind: "poll", pollster: p.pollster, url: p.url, v, avg: r.polls, same: Math.sign(v - r.polls) === dir });
    }
    const key = surnameKey(r.name);
    const hs = headlines.filter((h) => key && norm(h.title).includes(key)).slice(0, 3);
    if (hs.length) factors.push({ kind: "news", headlines: hs });
    if (r.kalshi1 != null && r.poly1 != null && Math.abs(r.kalshi1 - r.poly1) >= 2) factors.push({ kind: "split", kalshi: r.kalshi1, poly: r.poly1 });
    if (!factors.length) factors.push({ kind: "none" });
    return { name: r.name, market: r.market, d1: r.d1, d7: r.d7, factors };
  });

  // the edition's headline: the week's largest rise and fall on the markets
  const wk = rows.filter((r) => r.d7 != null).sort((a, b) => b.d7 - a.d7);
  const up = wk[0]?.d7 >= 1 ? wk[0] : null, down = wk.at(-1)?.d7 <= -1 ? wk.at(-1) : null;
  const pts = (v) => `${Math.abs(v).toString().replace(".", ",")} point${Math.abs(v) >= 2 ? "s" : ""}`;
  const ptsEn = (v) => `${Math.abs(v)} point${Math.abs(v) >= 2 ? "s" : ""}`;
  const head = {
    fr: up && down ? `${surname(up.name)} gagne ${pts(up.d7)} sur les marchés en une semaine, ${surname(down.name)} en perd ${pts(down.d7)}` : up ? `${surname(up.name)} gagne ${pts(up.d7)} sur les marchés en une semaine` : down ? `${surname(down.name)} perd ${pts(down.d7)} sur les marchés en une semaine` : "Une semaine calme sur les marchés",
    en: up && down ? `${surname(up.name)} up ${ptsEn(up.d7)} on the markets this week, ${surname(down.name)} down ${ptsEn(down.d7)}` : up ? `${surname(up.name)} up ${ptsEn(up.d7)} on the markets this week` : down ? `${surname(down.name)} down ${ptsEn(down.d7)} on the markets this week` : "A quiet week on the markets",
  };
  // the week in review: the markets' figure for the leading candidates, each day of the last seven
  const week = days.filter((d) => d.date > iso(Date.parse(D) - 7 * DAY) && d.date <= D).map((d) => ({ date: d.date, v: Object.fromEntries(rows.slice(0, 5).map((r) => [r.name, market(d, r.name) == null ? null : r1(market(d, r.name))])) }));

  const edition = { date: D, provisional: !!day.provisional, prev: y1?.date ?? null, head, rows: rows.slice(0, 8), polls: fresh, headlines: headlines.slice(0, 5), analysis, week };
  await writeFile(new URL(`daily/editions/${D}.json`, ROOT), JSON.stringify(edition));
  index.push({ date: D, head });
}
await writeFile(new URL("daily/editions/index.json", ROOT), JSON.stringify(index));
console.log(`editions: ${index.length} (${index[0]?.date} → ${index.at(-1)?.date})`);
