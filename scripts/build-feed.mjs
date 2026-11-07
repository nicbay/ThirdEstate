// Build the public Red/Blue feed from the state files (no network, no AI):
//   public/data/feed/latest.json            stories of the last 72 h with their (rated) MP reactions
//   public/data/feed/archive/YYYY-MM-DD.json the same, per day (days still in the window are rewritten; older days stay frozen)
//   public/data/feed/index.json             list of archive days
//   node scripts/build-feed.mjs
import { readdir } from "node:fs/promises";
import { STATE, PUBLIC_DIR, WINDOW_H, readJson, writeJson, HOUR } from "./lib/feed-common.mjs";
import { loadWindow, MATCH } from "./lib/stories.mjs";

const MAX_STORIES = 80;
const ctx = await loadWindow();
const { now, stories, posts, matches, mps } = ctx;
const store = await readJson(STATE.ratings, { ratings: {} });

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
    match: { how, score: m?.candidates?.[0]?.score ?? null },
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

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
function serialise(s, filter = () => true) {
  const reactions = (reactionsByStory.get(s.id) ?? []).filter((r) => filter(r.time)).sort((a, b) => b.time.localeCompare(a.time));
  const items = s.items.filter((i) => filter(i.time));
  const leans = reactions.map((r) => r.rating?.lean?.score).filter((x) => typeof x === "number");
  return {
    id: s.id,
    title: s.title,
    firstTime: s.firstTime,
    lastTime: s.lastTime,
    outlets: [...new Set(items.map((i) => i.outlet))],
    terms: s.terms,
    items: items.map(({ id, outlet, title, link, time, summary }) => ({ id, outlet, title, link, time, summary })),
    reactions,
    stats: {
      reactions: reactions.length,
      rated: reactions.filter((r) => r.rating).length,
      leanAvg: avg(leans),
      left: leans.filter((x) => x <= -0.2).length,
      right: leans.filter((x) => x >= 0.2).length,
      checks: reactions.filter((r) => r.rating?.check).length,
    },
  };
}
const keepStory = (x) => x.items.length && (x.reactions.length || x.outlets.length >= 2);
const rank = (a, b) => b.outlets.length + 1.5 * b.reactions.length - (a.outlets.length + 1.5 * a.reactions.length) || b.lastTime.localeCompare(a.lastTime);

const meta = {
  windowHours: WINDOW_H,
  outlets: ctx.outlets,
  method: {
    clustering: "TF-IDF cosine, greedy, see docs/data-feed.md",
    matching: { sure: MATCH.sure, maybe: MATCH.maybe, note: "rule match (shared link or term overlap); ambiguous posts are assigned by the AI rating" },
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
  counts: { stories: latestStories.length, reactions: rated + unrated, rated, unrated, postsInWindow: posts.length },
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
  const prevN = prev?.stories?.reduce((n, s) => n + s.reactions.length + s.items.length, 0) ?? 0;
  const curN = ds.reduce((n, s) => n + s.reactions.length + s.items.length, 0);
  if (prev && curN < prevN) continue;
  await writeJson(file, { day, generatedAt: new Date(now).toISOString(), ...meta, stories: ds });
}
const archiveDays = (await readdir(`${PUBLIC_DIR}archive`)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
await writeJson(`${PUBLIC_DIR}index.json`, { generatedAt: new Date(now).toISOString(), latest: "latest.json", days: archiveDays });

console.log(`feed: ${latestStories.length} stories, ${rated + unrated} reactions (${rated} rated, ${unrated} awaiting a rating), archives: ${[...days].join(", ")}`);
