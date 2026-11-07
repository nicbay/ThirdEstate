// EXPERIMENT: a sample of MPs' X (Twitter) posts, using only free X endpoints + the Anthropic budget.
//
// X can't be read for free, but:
//   1. Claude's server-side web search (billed to the Anthropic account: $10 per 1,000 searches + tokens,
//      counted in the shared $15/month ledger) can find x.com post URLs that search engines have indexed;
//   2. X's official, free, key-less oEmbed endpoint (publish.twitter.com/oembed) returns the exact text and
//      author of a post from its URL. The post time is read from the post id (snowflake).
// We keep only posts whose author is a current MP (X handles from deputes.json / socials.json).
// Coverage is partial and late (only what search engines index), so this is a SAMPLE, labelled as such.
//
// Discovery, two ways:
//   a. free: X posts embedded in the news articles of the feed (each article page fetched once);
//   b. paid (Anthropic only): for each of the day's biggest stories (once per story per day, at most X_SEARCHES_PER_DAY searches a day),
// one Haiku request with the web_search tool restricted to x.com. Found posts are added to data/feed/posts.json
// as platform "x" with a hint of the story they were found for; rate-reactions.mjs then confirms the match.
//
//   node scripts/sync-x-sample.mjs              (needs ANTHROPIC_API_KEY; skips cleanly without)
//   node scripts/sync-x-sample.mjs --dry-run    show which stories would be searched
//   node scripts/sync-x-sample.mjs --urls <x.com status URL>...   test the oEmbed half without searching
import { ask, remainingBudget, BudgetExceededError } from "./lib/claude.mjs";
import { STATE, SOCIALS, readJson, writeJson, fetchJson, fetchText, cleanText, path, pool, HOUR } from "./lib/feed-common.mjs";
import { loadWindow } from "./lib/stories.mjs";
import { readFile } from "node:fs/promises";

const JOB = "feed-x";
const SEARCHES_PER_DAY = +(process.env.X_SEARCHES_PER_DAY ?? 10);
const SEARCHES_PER_RUN = +(process.env.X_SEARCHES_PER_RUN ?? 2);
const MONTHLY_SHARE = +(process.env.X_MONTHLY_USD ?? 4); // this experiment's share of the $15 cap
const MIN_REMAINING = 1; // never let the experiment eat the last dollar of the shared cap
const STATE_X = path("data/feed/x-search.json");
const DRY = process.argv.includes("--dry-run");
const urlArgs = process.argv.includes("--urls") ? process.argv.slice(process.argv.indexOf("--urls") + 1) : null;

const ctx = await loadWindow();
const now = ctx.now;

// ---------- MP handles ----------
const handleToMp = new Map();
const addHandle = (h, id) => {
  h = h?.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0].toLowerCase();
  if (h && /^\w{1,15}$/.test(h)) handleToMp.set(h, id);
};
for (const [id, d] of ctx.mps) addHandle(d.socials?.twitter, id);
for (const [id, plats] of Object.entries(await readJson(SOCIALS, {}))) {
  const x = plats?.x ?? plats?.twitter;
  if (x && ctx.mps.has(id)) addHandle(typeof x === "string" ? x : x.handle ?? x.url, id);
}

// ---------- oEmbed ----------
const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/status(?:es)?\/(\d{6,25})/i;
const snowflakeTime = (id) => new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();

async function oembed(url) {
  const m = url.match(STATUS);
  if (!m) return null;
  const [, handle, id] = m;
  const mpId = handleToMp.get(handle.toLowerCase());
  if (!mpId) return null;
  const canon = `https://x.com/${handle}/status/${id}`;
  const j = await fetchJson(`https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(canon)}`);
  // html: <blockquote><p lang="fr">TEXT</p>&mdash; Name (@handle) <a href="…">date</a></blockquote>
  const p = j.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
  const text = cleanText(p.replace(/<br\s*\/?>/gi, "\n").replace(/<a [^>]*>(pic\.twitter\.com\/\w+)<\/a>/g, ""));
  const author = j.author_url?.split("/").pop()?.toLowerCase();
  if (!text || author !== handle.toLowerCase()) return null; // a retweet/quote embed of someone else
  return {
    id: `x:${id}`,
    mpId,
    platform: "x",
    handle: j.author_url.split("/").pop(),
    url: canon,
    time: snowflakeTime(id),
    text,
    link: null,
    quoted: null,
    metrics: {},
    source: "web-search+oembed",
  };
}

async function addPosts(found) {
  const store = await readJson(STATE.posts, { posts: [] });
  const byId = new Map(store.posts.map((p) => [p.id, p]));
  let added = 0;
  for (const p of found) {
    if (!p) continue;
    const old = byId.get(p.id);
    const hint = [...new Set([...(old?.searchHint ?? []), ...(p.searchHint ?? [])])];
    if (!old) added++;
    byId.set(p.id, { ...old, ...p, searchHint: hint, fetchedAt: old?.fetchedAt ?? new Date(now).toISOString() });
  }
  store.posts = [...byId.values()].sort((a, b) => b.time.localeCompare(a.time));
  await writeJson(STATE.posts, store);
  return added;
}

if (urlArgs) {
  const posts = await pool(urlArgs, 4, (u) => oembed(u).catch((e) => (console.warn(`${u}: ${e.message}`), null)));
  posts.forEach((p, i) => console.log(p ? `${p.handle} (${p.mpId}) ${p.time}: ${p.text.slice(0, 140)}` : `${urlArgs[i]}: not an MP post (or not embeddable)`));
  if (!process.argv.includes("--no-save")) console.log(`added ${await addPosts(posts)} post(s) to posts.json`);
  process.exit(0);
}

// ---------- discovery 1 (free): X posts embedded in the news articles we already list ----------
// Each article page is fetched once (only to look for x.com/<handle>/status/<id> links; nothing else is kept).
const ARTICLES_PER_RUN = +(process.env.X_ARTICLES_PER_RUN ?? 150);
const stateA = await readJson(STATE_X, { searches: [], scanned: {} });
stateA.scanned ??= {};
for (const [id, at] of Object.entries(stateA.scanned)) if (Date.parse(at) < now - 10 * 24 * HOUR) delete stateA.scanned[id];
const toScan = ctx.news.filter((i) => !stateA.scanned[i.id]).sort((a, b) => b.time.localeCompare(a.time)).slice(0, ARTICLES_PER_RUN);
const embedded = new Map(); // url -> article ids
if (!DRY) {
  await pool(toScan, 6, async (it) => {
    try {
      const html = await fetchText(it.link, { timeout: 15000 });
      for (const m of html.matchAll(/(?:x|twitter)\.com\/(\w{1,15})\/status\/(\d{15,22})/g))
        if (handleToMp.has(m[1].toLowerCase())) {
          const u = `https://x.com/${m[1]}/status/${m[2]}`;
          embedded.set(u, [...(embedded.get(u) ?? []), it.id]);
        }
    } catch {}
    stateA.scanned[it.id] = new Date(now).toISOString();
  });
  const fromArticles = (await pool([...embedded], 4, ([u, ids]) => oembed(u).then((p) => p && { ...p, searchHint: ids, source: "article-embed+oembed" }).catch(() => null)))
    .filter((p) => p && Date.parse(p.time) >= now - 72 * HOUR);
  const added = await addPosts(fromArticles);
  await writeJson(STATE_X, stateA, true);
  console.log(`X from articles: ${toScan.length} new article(s) scanned, ${embedded.size} MP post link(s), ${fromArticles.length} recent, ${added} new.`);
}

// ---------- discovery 2 (Anthropic budget): Claude web search on x.com ----------
const state = await readJson(STATE_X, { searches: [], scanned: {} });
const day = new Date(now).toISOString().slice(0, 10);
state.searches = state.searches.filter((s) => Date.parse(s.at) >= now - 30 * 24 * HOUR);
const today = state.searches.filter((s) => s.at.startsWith(day));
const searchedRecently = new Set(state.searches.filter((s) => Date.parse(s.at) >= now - 24 * HOUR).flatMap((s) => s.items));
const candidates = ctx.stories
  .filter((s) => Date.parse(s.lastTime) >= now - 24 * HOUR && s.outlets.length >= 3)
  .filter((s) => !s.items.some((i) => searchedRecently.has(i.id)))
  .sort((a, b) => b.outlets.length - a.outlets.length || b.lastTime.localeCompare(a.lastTime));
const quota = Math.max(0, Math.min(SEARCHES_PER_RUN, SEARCHES_PER_DAY - today.length));
const picked = candidates.slice(0, quota);
console.log(`X sample: ${handleToMp.size} MP handles; ${today.length}/${SEARCHES_PER_DAY} searches used today; ${candidates.length} story(ies) eligible, ${picked.length} picked.`);
const queryFor = (s) => `${s.title.replace(/^(Présidentielle( 2027)?|EN DIRECT|VIDÉO|INFO \w+)\s*[-:–]\s*/i, "").slice(0, 110)} député`;
if (DRY) {
  for (const s of picked) console.log(`  would search x.com for: ${queryFor(s)}`);
  process.exit(0);
}
if (!picked.length) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is not set: skipping the X sample.");
  process.exit(0);
}

async function experimentSpent() {
  try {
    return JSON.parse(await readFile(path(`data/usage/claude-${day.slice(0, 7)}.json`), "utf8")).byJob?.[JOB] ?? 0;
  } catch {
    return 0;
  }
}

let foundTotal = 0;
for (const s of picked) {
  const left = await remainingBudget();
  const share = MONTHLY_SHARE - (await experimentSpent());
  if (left < MIN_REMAINING || share <= 0.02) {
    console.log(`Budget stop: $${left.toFixed(2)} left on the cap, $${share.toFixed(2)} left of the X experiment's $${MONTHLY_SHARE}.`);
    break;
  }
  const before = left;
  let res;
  try {
    res = await ask(
      {
        max_tokens: 400,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1, allowed_domains: ["x.com", "twitter.com"] }],
        messages: [
          {
            role: "user",
            content: `Use web_search once, with this exact query: ${queryFor(s)}\nThen reply with only the x.com post URLs you found, one per line (no commentary).`,
          },
        ],
      },
      JOB,
    );
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`Budget stop: ${e.message}`);
      break;
    }
    console.warn(`Search request failed (${e.status ?? ""} ${e.message}). If this says the tool is not supported for this model, the experiment can't run on Haiku 5.5.`);
    break;
  }
  const cost = before - (await remainingBudget());
  // URLs straight from the search results (not from the model's prose), plus any it listed
  const urls = new Set();
  for (const b of res.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) urls.add(r.url);
    if (b.type === "text") for (const u of b.text.match(/https?:\/\/\S+/g) ?? []) urls.add(u.replace(/[).,]+$/, ""));
  }
  const statusUrls = [...urls].filter((u) => STATUS.test(u));
  const posts = (await pool(statusUrls, 4, (u) => oembed(u).catch(() => null)))
    .filter((p) => p && Date.parse(p.time) >= now - 72 * HOUR)
    .map((p) => ({ ...p, searchHint: s.items.slice(0, 6).map((i) => i.id) }));
  const added = await addPosts(posts);
  foundTotal += added;
  state.searches.push({
    at: new Date().toISOString(),
    story: s.title,
    items: s.items.map((i) => i.id),
    query: queryFor(s),
    results: urls.size,
    statusUrls: statusUrls.length,
    mpPosts: posts.length,
    added,
    costUsd: Math.round(cost * 1e5) / 1e5,
  });
  console.log(`  "${s.title.slice(0, 70)}": ${urls.size} results, ${statusUrls.length} post URLs, ${posts.length} recent MP posts (${added} new), $${cost.toFixed(4)}`);
  await writeJson(STATE_X, state, true);
}
await writeJson(STATE_X, state, true);
const tot = state.searches.reduce((a, x) => ({ n: a.n + 1, posts: a.posts + x.mpPosts, cost: a.cost + (x.costUsd ?? 0) }), { n: 0, posts: 0, cost: 0 });
console.log(`X sample: ${foundTotal} new post(s) this run. Last 30 days: ${tot.n} searches, ${tot.posts} MP posts found, $${tot.cost.toFixed(3)}.`);
