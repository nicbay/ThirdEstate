// Tweets quoted by the press: for each news article of the feed window, fetch the article page once and
// pull out the X (Twitter) posts it embeds or links to. X can't be read for free, but newsrooms embed the
// politicians' posts they write about, so the article itself tells us which post belongs to which story —
// no keyword matching, and no tilt towards Bluesky (where the right is under-represented).
//
// Output (internal state, committed): data/feed/press-tweets.json
//   { articles: { <articleId>: { at, status, tweets: [{ id, url, handle, name, text, dateText, via }] } },
//     oembed:   { <tweetId>: { at, handle, name, text } | { at, error } } }
// build-feed.mjs attaches these tweets to the story their article belongs to.
//
// Politeness: generic User-Agent, 15 s timeout, 4 pages in flight, each article fetched once (pages are also
// cached under .cache/press-pages/ so local reruns and --reparse never refetch). Permanent failures (4xx)
// are not retried; network errors / 5xx are retried on the next runs, at most MAX_TRIES times.
// Missing tweet text (plain links, iframes) is filled from X's free, key-less oEmbed endpoint, as
// sync-x-sample.mjs already does.
//   node scripts/sync-press-tweets.mjs [--limit N] [--reparse] [--no-oembed]
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { STATE, KEEP_DAYS, HOUR, readJson, writeJson, cleanText, path, pool } from "./lib/feed-common.mjs";

const CACHE = path(".cache/press-pages/");
const UA = "third-estate-feed/1.0";
const MAX_TRIES = 3;
const argLimit = process.argv.indexOf("--limit");
const LIMIT = argLimit > 0 ? +process.argv[argLimit + 1] : +(process.env.PRESS_ARTICLES_PER_RUN ?? 400);
const REPARSE = process.argv.includes("--reparse");
const OEMBED = !process.argv.includes("--no-oembed");
const WINDOW_H = 96; // the feed window (72 h) plus the day build-feed clusters before it

// Path segments that look like a handle in x.com/<handle>/status/<id> but aren't one.
const NOT_HANDLES = new Set(["i", "intent", "share", "home", "search", "hashtag", "web"]);
const STATUS_RE = /(?:https?:)?\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(\w{1,15})\/status(?:es)?\/(\d{8,22})/gi;
const snowflakeTime = (id) => {
  try {
    return new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
  } catch {
    return null;
  }
};
const textOf = (html) => cleanText(html.replace(/<br\s*\/?>/gi, "\n").replace(/<a [^>]*>\s*pic\.(?:twitter|x)\.com\/\w+\s*<\/a>/gi, ""));

/**
 * Tweets in an article page. Three shapes, best first:
 *   1. the standard embed: <blockquote class="twitter-tweet"><p>TEXT</p>&mdash; Name (@handle) <a href=".../status/ID">date</a></blockquote>
 *   2. an embed iframe (platform.twitter.com/embed/Tweet.html?id=ID): id only;
 *   3. any other link to x.com/<handle>/status/<id> (also JSON-escaped ones in the page's data).
 * The outlet's own share buttons (intent/tweet) never match the status pattern.
 */
function extractTweets(html) {
  const out = new Map();
  const add = (t) => {
    const old = out.get(t.id);
    if (!old) out.set(t.id, t);
    else for (const k of ["handle", "name", "text", "dateText"]) old[k] ??= t[k];
  };
  html = html.replace(/\\\//g, "/"); // JSON-escaped URLs inside script data
  for (const m of html.matchAll(/<blockquote[^>]*class=["'][^"']*twitter-tweet[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/gi)) {
    const body = m[1];
    const links = [...body.matchAll(new RegExp(STATUS_RE.source, "gi"))];
    const st = links.at(-1); // the date link is last; earlier ones can be quoted posts
    if (!st || NOT_HANDLES.has(st[1].toLowerCase())) continue;
    // a post can span several <p>; the "— Name (@handle) date" signature follows the last one
    const ps = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => textOf(x[1])).filter(Boolean);
    const sig = cleanText(body.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, " "));
    const by = [...sig.matchAll(/(?:^|[—–])\s*([^—–()]*?)\s*\(@(\w{1,15})\)/g)].at(-1);
    const dateText = cleanText(body.match(/<a [^>]*\/status(?:es)?\/\d+[^>]*>([^<]*)<\/a>\s*$/i)?.[1] ?? "") || null;
    add({ id: st[2], handle: by?.[2] ?? st[1], name: by?.[1] || null, text: ps.join("\n") || null, dateText, via: "blockquote" });
  }
  for (const m of html.matchAll(/platform\.twitter\.com\/embed\/Tweet\.html\?[^"'\s>]*\bid=(\d{8,22})/gi)) add({ id: m[1], handle: null, name: null, text: null, dateText: null, via: "iframe" });
  for (const m of html.matchAll(STATUS_RE)) {
    if (NOT_HANDLES.has(m[1].toLowerCase())) continue;
    add({ id: m[2], handle: m[1], name: null, text: null, dateText: null, via: "link" });
  }
  return [...out.values()].map((t) => ({ ...t, url: `https://x.com/${t.handle ?? "i"}/status/${t.id}`, time: snowflakeTime(t.id) }));
}

async function page(it) {
  const file = `${CACHE}${it.id}.html`;
  try {
    return { html: await readFile(file, "utf8"), cached: true };
  } catch {}
  const res = await fetch(it.link, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw e;
  }
  const html = await res.text();
  // Some outlets (Le Monde) answer 200 with an anti-bot challenge page: that is a refusal, and we take it as
  // one (no retry, nothing cached) rather than trying to get past it.
  if (html.length < 20000 && /<title>[^<]*(challenge|captcha|just a moment|access denied|attention required)/i.test(html)) {
    const e = new Error("blocked (bot challenge)");
    e.permanent = true;
    throw e;
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, html);
  return { html, cached: false };
}

async function oembed(t) {
  const url = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(`https://twitter.com/${t.handle ?? "i"}/status/${t.id}`)}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // 404 = deleted or protected post
  const j = await res.json();
  const p = j.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
  return { handle: j.author_url?.split("/").pop() ?? null, name: j.author_name ?? null, text: p ? textOf(p) || null : null };
}

async function main() {
  const now = Date.now();
  const news = (await readJson(STATE.news, { items: [] })).items.filter((i) => Date.parse(i.time) >= now - WINDOW_H * HOUR);
  const store = await readJson(STATE.pressTweets, { articles: {}, oembed: {} });
  store.oembed ??= {};
  const keepFrom = now - KEEP_DAYS * 24 * HOUR;
  for (const [id, a] of Object.entries(store.articles)) if (Date.parse(a.at) < keepFrom) delete store.articles[id];
  for (const [id, o] of Object.entries(store.oembed)) if (Date.parse(o.at) < keepFrom) delete store.oembed[id];

  const due = (it) => {
    const a = store.articles[it.id];
    if (REPARSE) return a?.status === "ok"; // re-extract from the cached pages only, never refetch
    return !a || (a.status !== "ok" && !a.permanent && (a.tries ?? 1) < MAX_TRIES);
  };
  const todo = news.filter(due).sort((a, b) => b.time.localeCompare(a.time)).slice(0, LIMIT);
  let fetched = 0, fromCache = 0, failed = 0;
  await pool(todo, 4, async (it) => {
    const prev = store.articles[it.id];
    try {
      const { html, cached } = await page(it);
      cached ? fromCache++ : fetched++;
      store.articles[it.id] = { at: prev?.at ?? new Date(now).toISOString(), status: "ok", tweets: extractTweets(html) };
    } catch (e) {
      if (REPARSE && prev?.status === "ok") return; // no cached page to reparse: keep what we had
      failed++;
      store.articles[it.id] = { at: prev?.at ?? new Date(now).toISOString(), status: e.message || "error", permanent: !!e.permanent, tries: (prev?.tries ?? 0) + 1, tweets: [] };
    }
  });

  // fill missing texts / handles from oEmbed (once per tweet, recent ones only)
  let oe = 0;
  if (OEMBED) {
    const need = new Map();
    for (const a of Object.values(store.articles))
      for (const t of a.tweets) if ((!t.text || !t.handle) && !store.oembed[t.id] && Date.parse(t.time) >= now - 30 * 24 * HOUR) need.set(t.id, t);
    await pool([...need.values()], 3, async (t) => {
      try {
        store.oembed[t.id] = { at: new Date(now).toISOString(), ...(await oembed(t)) };
        oe++;
      } catch (e) {
        store.oembed[t.id] = { at: new Date(now).toISOString(), error: e.message };
      }
    });
  }
  await writeJson(STATE.pressTweets, store, true);

  const inWindow = news.map((i) => store.articles[i.id]).filter(Boolean);
  const withTweets = inWindow.filter((a) => a.tweets.length).length;
  const byOutlet = {};
  for (const i of news) {
    const a = store.articles[i.id];
    const o = (byOutlet[i.outlet] ??= { articles: 0, ok: 0, withTweets: 0 });
    o.articles++;
    if (a?.status === "ok") o.ok++;
    if (a?.tweets.length) o.withTweets++;
  }
  console.log(Object.entries(byOutlet).map(([k, v]) => `${k}: ${v.ok}/${v.articles} read, ${v.withTweets} with tweets`).sort().join("\n"));
  console.log(`press tweets: ${todo.length} article(s) processed (${fetched} fetched, ${fromCache} from cache, ${failed} failed); ${withTweets}/${inWindow.length} articles in the window quote a tweet; ${oe} oEmbed lookups.`);
}

await main();
