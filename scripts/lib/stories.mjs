// Story clustering (news items -> stories) and rule-based matching (MP posts -> stories).
// Pure functions, no network, no AI. Used by rate-reactions.mjs and build-feed.mjs.
import { termVector, idfFrom, weigh, cosine, hash, HOUR } from "./feed-common.mjs";

export const CLUSTER = {
  join: 0.25, // cosine(item, story centroid) needed to join a story
  maxGapH: 36, // an item can't join a story whose latest item is older than this
};
export const MATCH = {
  sure: 0.3, // cosine(post, story centroid) at/above which the rule match is accepted outright
  maybe: 0.14, // between maybe and sure: ambiguous, Haiku picks among the candidates (or none)
  minShared: 2, // ...and at least this many shared distinctive terms
  candidates: 3,
  beforeH: 12, // a post may precede the first article of a story by this much
  afterH: 72,
};

const canon = (u) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
};

function addInto(acc, v) {
  for (const [t, x] of v) acc.set(t, (acc.get(t) ?? 0) + x);
}
function normalized(v) {
  let n = 0;
  for (const x of v.values()) n += x * x;
  n = Math.sqrt(n) || 1;
  return new Map([...v].map(([t, x]) => [t, x / n]));
}

/**
 * Cluster news items into stories. Items: [{ id, outlet, title, link, time, summary }].
 * Returns { stories, idf } where each story has a centroid vector (not serialised).
 */
export function clusterNews(items) {
  const raw = items.map((i) => termVector(i.title, i.summary));
  const idf = idfFrom(raw);
  const vecs = raw.map((v) => weigh(v, idf, 0));
  const order = items.map((_, k) => k).sort((a, b) => items[a].time.localeCompare(items[b].time));
  const stories = [];
  for (const k of order) {
    const it = items[k];
    const t = Date.parse(it.time);
    let best = null;
    let bestSim = CLUSTER.join;
    for (const s of stories) {
      if (t - s.lastMs > CLUSTER.maxGapH * HOUR) continue;
      const sim = cosine(vecs[k], s.centroid);
      if (sim >= bestSim) [best, bestSim] = [s, sim];
    }
    if (!best) {
      best = { members: [], sum: new Map(), firstMs: t, lastMs: t };
      stories.push(best);
    }
    best.members.push(k);
    addInto(best.sum, vecs[k]);
    best.centroid = normalized(best.sum);
    best.lastMs = Math.max(best.lastMs, t);
  }
  return {
    idf,
    stories: stories.map((s) => {
      const its = s.members.map((k) => items[k]);
      const first = its.reduce((a, b) => (a.time <= b.time ? a : b));
      // headline: the most central item, preferring politics-section feeds with a summary
      const central = s.members
        .map((k) => [k, cosine(vecs[k], s.centroid) + (items[k].summary ? 0.02 : 0)])
        .sort((a, b) => b[1] - a[1])[0][0];
      const terms = [...s.centroid].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
      return {
        id: `s-${hash(first.link, 10)}`,
        title: items[central].title,
        firstTime: new Date(s.firstMs).toISOString(),
        lastTime: new Date(s.lastMs).toISOString(),
        outlets: [...new Set(its.map((i) => i.outlet))],
        terms,
        items: its.sort((a, b) => b.time.localeCompare(a.time)),
        centroid: s.centroid,
        links: new Set(its.map((i) => canon(i.link))),
      };
    }),
  };
}

export const postText = (p) => [p.text, p.link?.title, p.quoted].filter(Boolean).join("\n");

/**
 * Rule-based post -> story matching.
 * Returns Map postId -> { sure: storyId|null, candidates: [{ storyId, score }] }.
 */
export function matchPosts(posts, { stories, idf }) {
  const out = new Map();
  for (const p of posts) {
    const t = Date.parse(p.time);
    const live = stories.filter((s) => t >= Date.parse(s.firstTime) - MATCH.beforeH * HOUR && t <= Date.parse(s.lastTime) + MATCH.afterH * HOUR);
    // 1. the post links to an article of the story
    if (p.link?.url) {
      const s = live.find((s) => s.links.has(canon(p.link.url)));
      if (s) {
        out.set(p.id, { sure: s.id, how: "link", candidates: [{ storyId: s.id, score: 1 }] });
        continue;
      }
    }
    // 2. term overlap with the story centroid (unknown-to-news terms are ignored)
    const v = weigh(termVector(postText(p)), idf, 0);
    const scored = [];
    for (const s of live) {
      const score = cosine(v, s.centroid);
      if (score < MATCH.maybe) continue;
      let shared = 0;
      for (const term of v.keys()) if (s.centroid.has(term) && (idf.get(term) ?? 0) > 1.5) shared++;
      if (shared < MATCH.minShared) continue;
      scored.push({ storyId: s.id, score: Math.round(score * 1000) / 1000, size: s.outlets.length });
    }
    // prefer bigger stories on near-ties
    scored.sort((a, b) => b.score + 0.01 * b.size - (a.score + 0.01 * a.size));
    let candidates = scored.slice(0, MATCH.candidates).map(({ storyId, score }) => ({ storyId, score }));
    // 3. X sample: embedded in one of the story's own articles = sure; found by a web search for a story =
    //    that story is always a candidate, the AI confirms
    if (p.searchHint?.length) {
      const hinted = stories.find((s) => s.items.some((i) => p.searchHint.includes(i.id)));
      if (hinted && p.source === "article-embed+oembed") {
        out.set(p.id, { sure: hinted.id, how: "embed", candidates: [{ storyId: hinted.id, score: 1 }] });
        continue;
      }
      if (hinted && !candidates.some((c) => c.storyId === hinted.id)) {
        candidates = [{ storyId: hinted.id, score: Math.round(cosine(v, hinted.centroid) * 1000) / 1000 }, ...candidates].slice(0, MATCH.candidates);
        out.set(p.id, { sure: null, how: null, candidates });
        continue;
      }
    }
    if (!candidates.length) continue;
    const top = candidates[0];
    const clear = top.score >= MATCH.sure && (candidates.length < 2 || top.score - candidates[1].score >= 0.08);
    out.set(p.id, { sure: clear ? top.storyId : null, how: clear ? "terms" : null, candidates });
  }
  return out;
}

/** Load state files, cluster the window's news and match the window's posts. */
export async function loadWindow(now = Date.now()) {
  const { STATE, DEPUTES, WINDOW_H, readJson } = await import("./feed-common.mjs");
  const news = (await readJson(STATE.news, { items: [] })).items;
  const outlets = (await readJson(STATE.news, { outlets: [] })).outlets ?? [];
  const posts = (await readJson(STATE.posts, { posts: [] })).posts;
  const deputes = await readJson(DEPUTES, []);
  // cluster a day more than the window so stories that started just before it stay whole
  const newsW = news.filter((i) => Date.parse(i.time) >= now - (WINDOW_H + 24) * HOUR);
  const postsW = posts.filter((p) => Date.parse(p.time) >= now - WINDOW_H * HOUR);
  const clusters = clusterNews(newsW);
  const matches = matchPosts(postsW, clusters);
  return { now, outlets, news: newsW, posts: postsW, ...clusters, matches, mps: new Map(deputes.map((d) => [d.id, d])) };
}
