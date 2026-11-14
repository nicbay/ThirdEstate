// Build the public Red/Blue feed from the state files (no network, no AI):
//   public/data/feed/latest.json            stories of the last 72 h with the X posts their articles quote (press)
//                                           and, secondarily, MP posts tied to them (reactions)
//   public/data/feed/archive/YYYY-MM-DD.json the same, per day (days still in the window are rewritten; older days stay frozen)
//   public/data/feed/index.json             list of archive days
//   node scripts/build-feed.mjs
import { readdir } from "node:fs/promises";
import { STATE, PUBLIC_DIR, WINDOW_H, readJson, writeJson, HOUR, termVector, weigh, cosine, properNouns } from "./lib/feed-common.mjs";
import { loadWindow, postText, MATCH } from "./lib/stories.mjs";
import { pressTweets } from "./lib/press-tweets.mjs";

const MAX_STORIES = 80;
const ctx = await loadWindow();
const { now, stories, posts, matches, mps } = ctx;
const store = await readJson(STATE.ratings, { ratings: {} });
const pressFor = await pressTweets(store.ratings);

// Social posts (mostly Bluesky, where the left is far more present than the right) are only kept when the tie
// to the story is solid: the post links to / is embedded in one of its articles, or it shares at least
// STRONG.shared distinctive terms with the story, one of them a name that is also in the story's headlines
// (a shared "SOS" between "SOS Racisme" and "SOS proviseurs" is not enough). Even then, per story, they can't
// outnumber the posts the press itself quoted (see serialise).
const STRONG = { score: MATCH.sure, shared: 3 };
function termTie(p, s) {
  const text = postText(p);
  const v = weigh(termVector(text), ctx.idf, 0);
  const shared = [...v.keys()].filter((t) => s.centroid.has(t) && (ctx.idf.get(t) ?? 0) > 1.5);
  const names = properNouns(text);
  const heads = properNouns(s.items.map((i) => i.title).join(" \n "));
  const named = shared.filter((t) => names.has(t) && heads.has(t));
  const score = cosine(v, s.centroid);
  return { score: Math.round(score * 1000) / 1000, shared: shared.length, named, strong: score >= STRONG.score && shared.length >= STRONG.shared && named.length > 0 };
}

// story lookup by article id (ratings remember their story by its articles)
const storyOfItem = new Map();
for (const s of stories) for (const it of s.items) storyOfItem.set(it.id, s);

const mpInfo = (id) => {
  const d = mps.get(id);
  return d
    ? { id, name: `${d.prenom} ${d.nom}`, group: d.groupe ? { abrev: d.groupe.abrev, libelle: d.groupe.libelle, couleur: d.groupe.couleur } : null }
    : { id, name: null, group: null };
};

const reactionsByStory = new Map();
let rated = 0;
let unrated = 0;
let weak = 0;
for (const p of posts) {
  const m = matches.get(p.id);
  const r = store.ratings[p.id];
  let story = null;
  let how = m?.how ?? null;
  if (r) {
    story = r.storyItems.map((id) => storyOfItem.get(id)).find(Boolean) ?? null; // the AI's choice wins
    how = how === "link" || how === "embed" ? how : "ai";
    if (!story) continue; // the model said it isn't about any candidate story
  } else if (m?.sure) {
    story = stories.find((s) => s.id === m.sure);
  }
  if (!story) continue;
  const tie = how === "link" || how === "embed" ? null : termTie(p, story);
  if (tie && !tie.strong) {
    weak++;
    continue;
  }
  r ? rated++ : unrated++;
  const reaction = {
    id: p.id,
    mp: mpInfo(p.mpId),
    platform: p.platform,
    source: p.source ?? "platform",
    handle: p.handle,
    url: p.url,
    time: p.time,
    text: p.text,
    link: p.link,
    quoted: p.quoted,
    metrics: p.metrics,
    match: tie ? { how, score: tie.score, shared: tie.shared, names: tie.named } : { how, score: 1 },
    rating: r
      ? {
          political: r.political,
          lean: r.lean,
          populism: r.populism,
          check: r.check,
          model: r.model,
          promptVersion: r.promptVersion,
          ratedAt: r.ratedAt,
        }
      : null,
  };
  if (!reactionsByStory.has(story.id)) reactionsByStory.set(story.id, []);
  reactionsByStory.get(story.id).push(reaction);
}

const POLITICS_URL = /\/(politique|elections?|presidentielle)\b|lcp\.fr|publicsenat\.fr/i;
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
function serialise(s, filter = () => true) {
  const items = s.items.filter((i) => filter(i.time));
  // X posts embedded in the story's own articles: the article ties them to the story, no matching involved
  const press = pressFor(s, items);
  const inPress = new Set(press.map((p) => p.id));
  // social posts: never the same post twice; term-matched ones capped at the number of press-quoted posts
  let termBudget = press.length;
  const reactions = (reactionsByStory.get(s.id) ?? [])
    .filter((r) => filter(r.time) && !inPress.has(r.id))
    .sort((a, b) => b.time.localeCompare(a.time))
    .filter((r) => r.match.how === "link" || r.match.how === "embed" || termBudget-- > 0);
  const leans = reactions.map((r) => r.rating?.lean?.score).filter((x) => typeof x === "number");
  const pressSide = (x) => press.filter((p) => p.side === x).length;
  // the RSS feeds also bring front-page news (outages, sport): the page shows a story's quoted posts only
  // when the story is political — a politician among the quoted authors, an MP reacting, or a politics section
  const political =
    press.some((p) => p.author.kind !== "account") || reactions.length > 0 || items.some((i) => POLITICS_URL.test(i.link));
  return {
    id: s.id,
    title: s.title,
    firstTime: s.firstTime,
    lastTime: s.lastTime,
    outlets: [...new Set(items.map((i) => i.outlet))],
    terms: s.terms,
    items: items.map(({ id, outlet, title, link, time, summary }) => ({ id, outlet, title, link, time, summary })),
    political,
    press,
    reactions,
    stats: {
      press: press.length,
      pressLeft: pressSide("left"),
      pressCentre: pressSide("centre"),
      pressRight: pressSide("right"),
      pressUnplaced: pressSide(null),
      pressPoliticians: press.filter((p) => p.author.kind !== "account").length,
      reactions: reactions.length,
      rated: reactions.filter((r) => r.rating).length,
      leanAvg: avg(leans),
      left: leans.filter((x) => x <= -0.2).length,
      right: leans.filter((x) => x >= 0.2).length,
      checks: reactions.filter((r) => r.rating?.check).length,
    },
  };
}
const keepStory = (x) => x.items.length && (x.press.length || x.reactions.length || x.outlets.length >= 2);
const weight = (x) => x.outlets.length + 1.5 * (x.press.length + x.reactions.length);
const rank = (a, b) => weight(b) - weight(a) || b.lastTime.localeCompare(a.lastTime);

const meta = {
  windowHours: WINDOW_H,
  outlets: ctx.outlets,
  method: {
    clustering: "TF-IDF cosine, greedy, see docs/data-feed.md",
    press: "X posts embedded in or linked from the story's articles (sync-press-tweets.mjs); side from the post's rating if any, else the author's group or party, else unplaced",
    matching: { sure: MATCH.sure, maybe: MATCH.maybe, strong: STRONG, note: "social posts: kept only if they link to an article of the story, or share >= 3 distinctive terms including a name in its headlines; capped at the number of press-quoted posts" },
    rating: "Claude Haiku 5.5, see docs/data-feed.md",
    leanScale: "-1 = gauche (red) … +1 = droite (blue), from the post's content",
  },
};

const winStart = now - WINDOW_H * HOUR;
const latestStories = stories
  .filter((s) => Date.parse(s.lastTime) >= winStart)
  .map((s) => serialise(s, (t) => Date.parse(t) >= winStart))
  .filter(keepStory)
  .sort(rank)
  .slice(0, MAX_STORIES);
await writeJson(`${PUBLIC_DIR}latest.json`, {
  generatedAt: new Date(now).toISOString(),
  ...meta,
  counts: {
    stories: latestStories.length,
    withPress: latestStories.filter((s) => s.press.length).length,
    press: latestStories.reduce((n, s) => n + s.press.length, 0),
    reactions: latestStories.reduce((n, s) => n + s.reactions.length, 0),
    rated,
    unrated,
    weakMatchesDropped: weak,
    postsInWindow: posts.length,
  },
  stories: latestStories,
});

// per-day archives for the days the window touches (UTC days)
const days = new Set();
for (let t = winStart; t <= now; t += 24 * HOUR) days.add(new Date(t).toISOString().slice(0, 10));
days.add(new Date(now).toISOString().slice(0, 10));
for (const day of days) {
  const onDay = (t) => t.slice(0, 10) === day;
  const ds = stories.map((s) => serialise(s, onDay)).filter(keepStory).sort(rank);
  // the first day of the window is only partly covered by this run's state: don't overwrite a fuller archive
  const file = `${PUBLIC_DIR}archive/${day}.json`;
  const prev = await readJson(file, null);
  const prevN = prev?.stories?.reduce((n, s) => n + (s.press?.length ?? 0) + s.reactions.length + s.items.length, 0) ?? 0;
  const curN = ds.reduce((n, s) => n + s.press.length + s.reactions.length + s.items.length, 0);
  if (prev && curN < prevN) continue;
  await writeJson(file, { day, generatedAt: new Date(now).toISOString(), ...meta, stories: ds });
}
const archiveDays = (await readdir(`${PUBLIC_DIR}archive`)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
await writeJson(`${PUBLIC_DIR}index.json`, { generatedAt: new Date(now).toISOString(), latest: "latest.json", days: archiveDays });

const c = latestStories.reduce((a, s) => ({ l: a.l + s.stats.pressLeft, c: a.c + s.stats.pressCentre, r: a.r + s.stats.pressRight, u: a.u + s.stats.pressUnplaced }), { l: 0, c: 0, r: 0, u: 0 });
console.log(
  `feed: ${latestStories.length} stories, ${latestStories.filter((s) => s.press.length).length} with press-quoted X posts ` +
    `(${c.l} left, ${c.c} centre, ${c.r} right, ${c.u} unplaced); ${latestStories.reduce((n, s) => n + s.reactions.length, 0)} social reactions kept ` +
    `(${weak} weak keyword matches dropped); archives: ${[...days].join(", ")}`,
);
