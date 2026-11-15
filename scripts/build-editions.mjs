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
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

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
// outlet ids of the press feed, as readers know them
const outletName = new Map(((await read("feed/latest.json").catch(() => null))?.outlets ?? []).map((o) => [o.id, o.name]));
const stories = async (date) => {
  const f = await read(`feed/archive/${date}.json`).catch(() => null);
  return (f?.stories ?? []).map((s) => ({ title: s.title, link: s.items?.[0]?.link ?? null, outlet: outletName.get(s.items?.[0]?.outlet ?? s.outlets?.[0]) ?? s.items?.[0]?.outlet ?? s.outlets?.[0] ?? "", n: s.outlets?.length ?? 1 }));
};

// The city of the day: a town with a local story dated that day (or the eve) in the regional press feeds
// (public/data/news/<dep>.json), whose headline names it, with a coat of arms to show and at least 10,000
// inhabitants. Crime and accident stories are left out, and a town does not come back within 30 days. Once picked
// a city is kept (daily/cities.json): the press files only cover the last two weeks, so past days can't be redone.
// what France pays to borrow (scripts/sync-yields.mjs) and the pace of new debt (scripts/sync-economy.mjs)
const yields = await read("daily/yields.json").catch(() => null);
// the week's other figures: INSEE's surveys and car registrations (scripts/sync-indicators.mjs), growth, prices and
// unemployment (scripts/sync-economy.mjs). "fresh" marks a figure published in the seven days before the edition.
const indicators = await read("daily/indicators.json").catch(() => null);
// the CAC 40's week and its two biggest movers (scripts/sync-cac.mjs)
const cacWeek = await read("daily/cac.json").catch(() => null);
const economyKpis = (await read("economy.json").catch(() => null))?.kpis ?? [];
function weekKpis(D) {
  const fresh = (u) => !!u && u > iso(Date.parse(D) - 7 * DAY) && u <= D;
  const eco = (id) => { const k = economyKpis.find((x) => x.id === id); return k ? { id, period: k.period, value: k.value, prev: k.prev ?? null, yearAgo: null, updated: k.updated ?? null, url: k.source?.url ?? null, fresh: fresh(k.updated) } : null; };
  return { items: [eco("growth_q"), eco("inflation"), eco("unemployment"), ...(indicators?.items ?? []).map((x) => ({ ...x, fresh: fresh(x.updated) }))].filter(Boolean), confidence: indicators?.confidence ?? null };
}
const newDebtPerYear = (await read("economy.json").catch(() => null))?.debt?.ratePerYear ?? null;
// headlines that can move a government bond: the budget, the debt, a rating, a censure vote, the central bank
const BOND_NEWS = /budget|dette publique|la dette|d[ée]ficit|notation|moody|fitch|standard ?& ?poor|agence de notation|censure|49[.,]3|dissolution|bce|banque centrale|emprunt|obligations?|march[ée]s financiers|spread|oat|taux d.int[ée]r[êe]t/i;
/** The borrowing line of an edition: the OAT-Bund gap at the last close on or before D, its move over a session (a week
 *  on a Sunday), the OAT rate and its move when both days were recorded, and what the move is worth in interest on a
 *  year of new debt (the move in points × the debt France adds in a year): a notional figure, an order of magnitude. */
function borrowing(D, sunday, headlines) {
  const h = (yields?.history ?? []).filter(([d]) => d <= D);
  const last = h.at(-1);
  if (!last || last[0] < iso(Date.parse(D) - 4 * DAY)) return null;
  const back = sunday ? h.filter(([d]) => d <= iso(Date.parse(last[0]) - 7 * DAY)).at(-1) : h.at(-2);
  if (!back) return null;
  const rate = (d) => (yields.rates ?? []).find((r) => r[0] === d) ?? null;
  const now = rate(last[0]), then = rate(back[0]);
  const dSpread = r1(last[1] - back[1]);
  const dOat = now && then ? Math.round((now[1] - then[1]) * 100) / 100 : null; // percentage points
  const moveBp = dOat != null ? dOat * 100 : dSpread;
  const why = headlines.filter((x) => BOND_NEWS.test(x.title)).sort((a, b) => b.n - a.n)[0] ?? null;
  return {
    span: sunday ? "week" : "day", asOf: last[0], from: back[0], spread: last[1], dSpread,
    oat10: now?.[1] ?? null, bund10: now?.[2] ?? null, dOat, basis: dOat != null ? "oat" : "spread",
    base: newDebtPerYear > 0 ? newDebtPerYear : null, cost: newDebtPerYear > 0 ? Math.round((newDebtPerYear * moveBp) / 10000) : null,
    why: why ? { title: why.title, link: why.link, outlet: why.outlet, n: why.n } : null,
  };
}
const cities = await read("daily/cities.json").catch(() => ({}));
let citiesChanged = false, localNews = null;
const GRIM = /meurtr|\bmorts?\b|\bmorte|tu[ée]e?s?\b|d[ée]c[èe]s|d[ée]c[èe]d|\bviols?\b|agress|accident|poignard|fusillade|incendie|drame|suicide|disparu|bless[ée]|proc[èe]s|condamn|prison|drogue|narco|braquage|cambriol|attentat|homicide|f[ée]minicide|noyade|cadavre|\bcorps\b|garde à vue|mis en examen|interpell|lacrymog|violen|heurts|[ée]meut|menac|enqu[êe]te|plainte/i;
const hashStr = (t) => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
async function cityOf(D) {
  if (cities[D]) return cities[D];
  if (D < iso(Date.now() - 2 * DAY)) return null;
  if (!localNews) {
    localNews = [];
    const files = await readdir(new URL("news/", ROOT)).catch(() => []);
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const j = await read(`news/${f}`).catch(() => null);
      for (const [code, items] of Object.entries(j?.communes ?? {})) for (const item of items) localNews.push({ dep: j.department, depName: j.name, code, item });
    }
  }
  const eve = iso(Date.parse(D) - DAY);
  const recent = new Set(Object.entries(cities).filter(([d]) => d > iso(Date.parse(D) - 30 * DAY)).map(([, c]) => c.code));
  const pool = localNews.filter((x) => x.item.time && [D, eve].includes(x.item.time.slice(0, 10)) && !GRIM.test(x.item.title) && !recent.has(x.code));
  const cands = [];
  for (const dep of [...new Set(pool.map((x) => x.dep))]) {
    const arms = await read(`arms/communes/${dep}.json`).catch(() => ({}));
    const com = (await read(`communes-dep/${dep}.json`).catch(() => null))?.communes ?? {};
    for (const x of pool.filter((p) => p.dep === dep)) {
      const c = com[x.code];
      if (!c || !arms[x.code] || (c.population?.value ?? 0) < 10000 || c.name.length < 4) continue;
      if (!new RegExp("(^|[^a-z])" + norm(c.name).replace(/[^a-z0-9]+/g, "[^a-z0-9]+") + "([^a-z]|$)").test(norm(x.item.title))) continue;
      cands.push({ code: x.code, name: c.name, dep, depName: x.depName, arms: arms[x.code], title: x.item.title, link: x.item.link, outlet: x.item.outlet, time: x.item.time });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (b.time.slice(0, 10) === D) - (a.time.slice(0, 10) === D) || hashStr(D + a.code) - hashStr(D + b.code));
  cities[D] = cands[0]; citiesChanged = true;
  return cands[0];
}

// The X post of the day (of the week on a Sunday): among the posts the press embedded in its articles
// (feed/archive/<date>.json, stories[].press), the one the most outlets quoted. With fewer than two outlets, none.
const archive = async (date) => (await read(`feed/archive/${date}.json`).catch(() => null))?.stories ?? [];
async function postOf(D, sunday) {
  const span = sunday ? 6 : 1, from = iso(Date.parse(D) - span * DAY), seen = new Map();
  for (let k = 0; k <= span; k++) for (const st of await archive(iso(Date.parse(D) - k * DAY))) for (const p of st.press ?? []) {
    if (p.platform !== "x" || !p.text || !p.url || !p.handle || !p.time || p.time.slice(0, 10) < from || p.time.slice(0, 10) > D) continue;
    const cur = seen.get(p.id) ?? { p, outs: new Set() };
    for (const q of p.quotedBy ?? []) if (q.outlet) cur.outs.add(q.outlet);
    seen.set(p.id, cur);
  }
  const best = [...seen.values()].sort((a, b) => b.outs.size - a.outs.size || b.p.time.localeCompare(a.p.time))[0];
  if (!best || best.outs.size < 2) return null;
  return { handle: best.p.handle, name: best.p.author?.name ?? null, text: best.p.text.replace(/\s*https:\/\/t\.co\/\S+/g, "").trim().slice(0, 420), url: best.p.url, time: best.p.time, outlets: [...best.outs].map((o) => outletName.get(o) ?? o) };
}

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
    polls: day.polls?.[name] ?? null, polls1: diff(day.polls?.[name], y1?.polls?.[name]), polls7: diff(day.polls?.[name], y7?.polls?.[name]),
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
  const pts = (v) => `${Math.abs(v).toString().replace(".", ",")} %pt`; // percentage points, written "%pt" everywhere in the note
  const ptsEn = (v) => `${Math.abs(v)}%pt`;
  const dy = rows.filter((r) => r.d1 != null).sort((a, b) => b.d1 - a.d1);
  const upD = dy[0]?.d1 >= 1 ? dy[0] : null, downD = dy.at(-1)?.d1 <= -1 ? dy.at(-1) : null;
  const sunday = new Date(D + "T12:00:00Z").getUTCDay() === 0;
  // the day's moves when there are any; the week's on a Sunday, or on a day when nothing moved a point
  const head = !sunday && (upD || downD) ? {
    fr: upD && downD ? surname(upD.name) + " gagne " + pts(upD.d1) + " sur les marchés en un jour, " + surname(downD.name) + " en perd " + pts(downD.d1) : upD ? surname(upD.name) + " gagne " + pts(upD.d1) + " sur les marchés en un jour" : surname(downD.name) + " perd " + pts(downD.d1) + " sur les marchés en un jour",
    en: upD && downD ? surname(upD.name) + " up " + ptsEn(upD.d1) + " on the markets today, " + surname(downD.name) + " down " + ptsEn(downD.d1) : upD ? surname(upD.name) + " up " + ptsEn(upD.d1) + " on the markets today" : surname(downD.name) + " down " + ptsEn(downD.d1) + " on the markets today",
  } : {
    fr: up && down ? `${surname(up.name)} gagne ${pts(up.d7)} sur les marchés en une semaine, ${surname(down.name)} en perd ${pts(down.d7)}` : up ? `${surname(up.name)} gagne ${pts(up.d7)} sur les marchés en une semaine` : down ? `${surname(down.name)} perd ${pts(down.d7)} sur les marchés en une semaine` : "Une semaine calme sur les marchés",
    en: up && down ? `${surname(up.name)} up ${ptsEn(up.d7)} on the markets this week, ${surname(down.name)} down ${ptsEn(down.d7)}` : up ? `${surname(up.name)} up ${ptsEn(up.d7)} on the markets this week` : down ? `${surname(down.name)} down ${ptsEn(down.d7)} on the markets this week` : "A quiet week on the markets",
  };
  // the week in review: the markets' figure for the leading candidates, each day of the last seven
  const week = days.filter((d) => d.date > iso(Date.parse(D) - 7 * DAY) && d.date <= D).map((d) => ({ date: d.date, v: Object.fromEntries(rows.slice(0, 5).map((r) => [r.name, market(d, r.name) == null ? null : r1(market(d, r.name))])) }));

  // the note of the day: Claude's four lines when the daily brief wrote them (daily/notes/<date>.json), else a
  // plain one from the figures: the biggest moves, whether polls agree, and the most-covered story
  const ai = await read(`daily/notes/${D}.json`).catch(() => null);
  const fmt = (v, fr) => `${v > 0 ? "+" : "−"}${fr ? String(Math.abs(v)).replace(".", ",") : Math.abs(v)}`;
  // a headline, short: without the "Présidentielle 2027 :" prefix, cut at a word near 80 characters
  const short = (t) => { const x = t.replace(/^(EN DIRECT\s*[-–]\s*)?(Présidentielle|Élection présidentielle)\s*2027\s*:\s*/i, ""); return x.length <= 80 ? x : `${x.slice(0, 80).replace(/\s+\S*$/, "")}…`; };
  const plain = (fr) => {
    const lines = analysis.slice(0, 2).map((a) => {
      const pol = a.factors.find((f) => f.kind === "polls"), news = a.factors.find((f) => f.kind === "news");
      const mv = a.d1 != null && Math.abs(a.d1) >= 1 ? (fr ? `${fmt(a.d1, true)} point en 24 h` : `${fmt(a.d1, false)} pt in 24h`) : (fr ? `${fmt(a.d7, true)} points en 7 jours` : `${fmt(a.d7, false)} pts in 7 days`);
      const why = pol?.same ? (fr ? "comme dans les sondages" : "in line with the polls") : news ? (fr ? `l’actualité a pu jouer (« ${short(news.headlines[0].title)} »)` : `the news may have played a part ("${short(news.headlines[0].title)}")`) : (fr ? "sans explication claire" : "with no clear explanation");
      return `${surname(a.name)}${fr ? " : " : ": "}${mv} ${fr ? "sur les marchés" : "on the markets"}, ${why}.`;
    });
    if (!lines.length) lines.push(fr ? "Pas de mouvement notable sur les marchés ni dans les sondages." : "No notable move on the markets or in the polls.");
    if (headlines[0]) lines.push(fr ? `L’info la plus reprise : « ${short(headlines[0].title)} » (${headlines[0].n} médias).` : `Most-covered story: "${short(headlines[0].title)}" (${headlines[0].n} outlets).`);
    return lines.slice(0, 3).join(" ");
  };
  const note = ai?.fr ? { fr: ai.fr, en: ai.en, by: ai.by } : { fr: plain(true), en: plain(false), by: "template" };

  // the day's verdict: whose day it was, and the surprise. Claude's when the daily brief wrote one (checked there),
  // else a plain one from the figures: a candidate's market move over the week plus their poll move, the largest
  // rises and falls, each with a headline naming them when there is one.
  const num = (v, fr) => (fr ? String(Math.abs(v)).replace(".", ",") : String(Math.abs(v)));
  // a headline naming the candidate, each headline used once (the first candidate it names keeps it)
  const usedStories = new Set();
  const storyFor = (name) => { const key = surnameKey(name); const h = key && headlines.find((x) => !usedStories.has(x.title) && norm(x.title).includes(key)); if (!h) return null; usedStories.add(h.title); return { title: h.title, link: h.link, outlet: h.outlet, n: h.n }; };
  const why = (r, fr) => [
    r.d7 != null && Math.abs(r.d7) >= 1 ? (fr ? `${r.d7 > 0 ? "+" : "−"}${num(r.d7, true)} pt${Math.abs(r.d7) >= 2 ? "s" : ""} sur les marchés en 7 jours` : `${r.d7 > 0 ? "+" : "−"}${num(r.d7)} pt${Math.abs(r.d7) === 1 ? "" : "s"} on the markets in 7 days`) : null,
    r.polls7 != null && Math.abs(r.polls7) >= 0.5 ? (fr ? `${r.polls7 > 0 ? "+" : "−"}${num(r.polls7, true)} pt${Math.abs(r.polls7) >= 2 ? "s" : ""} dans les sondages${r.d7 != null && Math.abs(r.d7) >= 1 ? "" : " en 7 jours"}` : `${r.polls7 > 0 ? "+" : "−"}${num(r.polls7)} pt${Math.abs(r.polls7) === 1 ? "" : "s"} in the polls${r.d7 != null && Math.abs(r.d7) >= 1 ? "" : " in 7 days"}`) : null,
  ].filter(Boolean).join(fr ? ", " : ", ");
  const score = (r) => (r.d7 ?? 0) + 1.5 * (r.polls7 ?? 0);
  const ranked = rows.filter((r) => why(r, false)).sort((a, b) => score(b) - score(a));
  const line = (r, fr) => { const w = why(r, fr); return `${w.charAt(0).toUpperCase()}${w.slice(1)}.`; };
  // the surprise: a newcomer's first poll, else polls and markets pulling apart, else a move on one market only
  const firstPoll = polls.filter((p) => p.end > iso(Date.parse(D) - 7 * DAY) && p.end <= D).flatMap((p) => [...new Set(p.hyps.flatMap((h) => Object.keys(h)))]
    .filter((n) => !polls.some((q) => q.end <= iso(Date.parse(D) - 7 * DAY) && q.hyps.some((h) => n in h))).map((n) => ({ n, p, v: r1(pollMean(p, n)) })))[0];
  const apart = rows.find((r) => r.d7 != null && r.polls7 != null && Math.abs(r.d7) >= 1.5 && Math.abs(r.polls7) >= 1 && Math.sign(r.d7) !== Math.sign(r.polls7));
  const alone = analysis.find((a) => a.factors.some((f) => f.kind === "split"));
  const surprise = firstPoll
    ? { name: firstPoll.n, fr: `${surname(firstPoll.n)} testé pour la première fois : ${num(firstPoll.v, true)} % (${firstPoll.p.pollster}).`, en: `${surname(firstPoll.n)} polled for the first time: ${num(firstPoll.v)}% (${firstPoll.p.pollster}).`, story: storyFor(firstPoll.n) }
    : apart ? { name: apart.name, fr: `${surname(apart.name)} : les marchés et les sondages divergent (${apart.d7 > 0 ? "+" : "−"}${num(apart.d7, true)} contre ${apart.polls7 > 0 ? "+" : "−"}${num(apart.polls7, true)} en 7 jours).`, en: `${surname(apart.name)}: markets and polls pull apart (${apart.d7 > 0 ? "+" : "−"}${num(apart.d7)} against ${apart.polls7 > 0 ? "+" : "−"}${num(apart.polls7)} over 7 days).`, story: null }
    : alone ? (() => { const f = alone.factors.find((x) => x.kind === "split"); return { name: alone.name, fr: `${surname(alone.name)} : un seul marché a bougé (Kalshi ${f.kalshi > 0 ? "+" : "−"}${num(f.kalshi, true)}, Polymarket ${f.poly > 0 ? "+" : "−"}${num(f.poly, true)}), peut-être un seul gros pari.`, en: `${surname(alone.name)}: only one market moved (Kalshi ${f.kalshi > 0 ? "+" : "−"}${num(f.kalshi)}, Polymarket ${f.poly > 0 ? "+" : "−"}${num(f.poly)}), possibly a single large bet.`, story: null }; })()
    : null;
  // after the surprise, so it keeps first claim on a headline naming its candidate
  const good = ranked.filter((r) => score(r) >= 1).slice(0, 3).map((r) => ({ name: r.name, fr: line(r, true), en: line(r, false), story: storyFor(r.name) }));
  const bad = ranked.filter((r) => score(r) <= -1).reverse().slice(0, 3).map((r) => ({ name: r.name, fr: line(r, true), en: line(r, false), story: storyFor(r.name) }));
  const insight = ai?.insight ?? { head, surprise, good, bad, by: "template" };

  // the ledger (the note's lines on the homepage): the world's and France's main story, the candidates in the
  // news, who had the momentum, the table of polls and odds, the city of the day. Day by day; on a Sunday the
  // week, with a longer recap. Figures only: the page writes the sentences.
  const hl = await read("daily/headlines/" + D + ".json").catch(() => null);
  const whoIn = (h) => rows.find((r) => { const k = surnameKey(r.name); return k && norm(h.title).includes(k); });
  const candNews = [];
  for (const h of headlines) { const r = whoIn(h); if (!r || h.title === insight.surprise?.story?.title || candNews.some((c) => c.name === r.name)) continue; candNews.push({ ...h, name: r.name }); if (candNews.length === 2) break; }
  const momentum = (span) => {
    const m = (r) => (span === "day" ? r.d1 : r.d7), p = (r) => (span === "day" ? r.polls1 : r.polls7);
    const sc = (r) => (m(r) ?? 0) + 1.5 * (p(r) ?? 0);
    const one = (r) => ({ name: r.name, market: m(r), polls: p(r) });
    const xs = rows.filter((r) => Math.abs(sc(r)) >= (span === "day" ? 0.5 : 1)).sort((a, b) => sc(b) - sc(a));
    return { span, up: xs.filter((r) => sc(r) > 0).slice(0, 2).map(one), down: xs.filter((r) => sc(r) < 0).reverse().slice(0, 2).map(one) };
  };
  let lead = momentum(sunday ? "week" : "day");
  if (!sunday && !lead.up.length && !lead.down.length) lead = momentum("week"); // a still day: the week instead
  let recap = null;
  if (sunday) {
    const ext = (key, now) => { const xs = rows.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]); const o = (r) => ({ name: r.name, now: r[now], d: r[key] }); return { up: xs[0]?.[key] > 0 ? o(xs[0]) : null, down: xs.at(-1)?.[key] < 0 ? o(xs.at(-1)) : null }; };
    const wkNews = [];
    for (let k = 0; k < 7; k++) wkNews.push(...await stories(iso(Date.parse(D) - k * DAY)));
    const wkSeen = new Set();
    recap = {
      polls: ext("polls7", "polls"), markets: ext("d7", "market"),
      newPolls: polls.filter((p) => p.end > iso(Date.parse(D) - 7 * DAY) && p.end <= D).map((p) => ({ pollster: p.pollster, end: p.end, url: p.url ?? null })),
      stories: wkNews.filter((x) => (wkSeen.has(x.title) ? false : (wkSeen.add(x.title), true))).sort((x, y) => y.n - x.n).slice(0, 3),
    };
  }
  const tableRows = [...rows].sort((x, y) => (y.polls ?? -1) - (x.polls ?? -1) || (y.market ?? 0) - (x.market ?? 0)).slice(0, 7).map(({ name, polls, polls1, polls7, market, d1, d7 }) => ({ name, polls, polls1, polls7, market, d1, d7 }));
  // statements of the day when Claude wrote none: the most-covered headlines that quote someone and name a candidate
  const quoted = [];
  for (const h of headlines) { const r = /[«“"]/.test(h.title) ? whoIn(h) : null; if (!r || quoted.some((q) => q.name === r.name)) continue; quoted.push({ name: r.name, fr: "", en: "", story: { title: h.title, link: h.link, outlet: h.outlet, n: h.n } }); if (quoted.length === 3) break; }
  // Sunday's hand-written file, when there is one: the brief's three lines, and comments that take precedence over Claude's
  const briefFile = sunday ? await read("daily/briefs/" + D + ".json").catch(() => null) : null;
  const ledger = {
    span: sunday ? "week" : "day",
    world: hl?.world?.[0] ?? null,
    france: hl?.france?.find((h) => !whoIn(h)) ?? hl?.france?.[0] ?? headlines.find((h) => !whoIn(h)) ?? null,
    candidates: candNews, lead, recap,
    borrow: sunday ? borrowing(D, sunday, headlines) : null, // the borrowing line belongs to the week's note only
    // Sunday's figures: today's for the current week; an older Sunday keeps the ones it was built with
    kpis: !sunday ? null : D >= iso(Date.now() - 6 * DAY) ? weekKpis(D) : (await read("daily/editions/" + D + ".json").catch(() => null))?.ledger?.kpis ?? null,
    // Sunday's brief: three lines that take a stand, written by hand (daily/briefs/<date>.json), each with its lead and its story
    brief: briefFile?.lines ?? null,
    // comments: two on why the polls moved, one on the week's figures, one on the CAC 40 (the last two on Sundays)
    notes: { polls: briefFile?.polls ?? insight.pollNotes ?? [], kpis: briefFile?.kpis ?? insight.kpiNote ?? null, cac: briefFile?.cac ?? insight.cacNote ?? null },
    cac: !sunday ? null : D >= iso(Date.now() - 6 * DAY) ? cacWeek : (await read("daily/editions/" + D + ".json").catch(() => null))?.ledger?.cac ?? null,
    table: tableRows,
    // the day's facts: our take (Claude's, none without it), the surprises, the statements, the post the press quoted most
    take: insight.take ?? null,
    surprises: insight.surprises ?? (insight.surprise ? [insight.surprise] : []),
    declarations: insight.declarations?.length ? insight.declarations : quoted,
    post: await postOf(D, sunday),
    // Sunday: the polling averages of the leading candidates, day by day (up to 30 days), for the small trend chart
    trend: sunday ? days.filter((d) => d.date <= D && d.polls).slice(-30).map((d) => ({ date: d.date, v: Object.fromEntries(tableRows.filter((r) => r.polls != null).slice(0, 5).map((r) => [r.name, d.polls[r.name] ?? null])) })) : null,
    city: await cityOf(D),
  };

  const edition = { date: D, ledger, provisional: !!day.provisional, note, insight, prev: y1?.date ?? null, head: insight.head ?? head, rows: rows.slice(0, 8), polls: fresh, headlines: headlines.slice(0, 5), analysis, week };
  await writeFile(new URL(`daily/editions/${D}.json`, ROOT), JSON.stringify(edition));
  index.push({ date: D, head: edition.head });
}
await writeFile(new URL("daily/editions/index.json", ROOT), JSON.stringify(index));
if (citiesChanged) await writeFile(new URL("daily/cities.json", ROOT), JSON.stringify(cities));
console.log(`editions: ${index.length} (${index[0]?.date} → ${index.at(-1)?.date})`);
