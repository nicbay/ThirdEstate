// MP posts for the Red/Blue feed: Bluesky (public AppView, no key), YouTube channel RSS, Mastodon (public API).
// X/Twitter is not used: it cannot be read for free.
//
// Accounts, merged in this order of preference:
//   1. public/data/an/socials.json  (mp-socials workstream: { [mpId]: { [platform]: { url, handle, ... } } }), if present
//   2. public/data/an/deputes.json  `socials` (Assemblée open data), for bluesky / youtube / mastodon if present
//   3. Wikidata: P12361 (Bluesky handle), P2397 (YouTube channel ID), P4033 (Mastodon address), joined on P4123 (AN id)
// Resolved accounts are cached in data/feed/accounts.json (Wikidata refreshed once a day).
//   node scripts/sync-mp-posts.mjs [--refresh-accounts]
import { STATE, DEPUTES, SOCIALS, KEEP_DAYS, readJson, writeJson, fetchJson, fetchText, cleanText, snippet, pool, HOUR } from "./lib/feed-common.mjs";

const now = Date.now();
const deputes = await readJson(DEPUTES, []);
const mpIds = new Set(deputes.map((d) => d.id));

// ---------- accounts ----------
async function wikidataAccounts() {
  const q = `SELECT ?an ?bsky ?yt ?masto WHERE { ?item wdt:P4123 ?an .
    OPTIONAL { ?item wdt:P12361 ?bsky } OPTIONAL { ?item wdt:P2397 ?yt } OPTIONAL { ?item wdt:P4033 ?masto }
    FILTER(BOUND(?bsky) || BOUND(?yt) || BOUND(?masto)) }`;
  const j = await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { timeout: 60000 });
  const out = {};
  for (const b of j.results.bindings) {
    const id = `PA${b.an.value}`;
    if (!mpIds.has(id)) continue;
    const a = (out[id] ??= {});
    if (b.bsky) a.bluesky ??= { handle: b.bsky.value, source: "wikidata" };
    if (b.yt) a.youtube ??= { channelId: b.yt.value, source: "wikidata" };
    if (b.masto) a.mastodon ??= { acct: b.masto.value.replace(/^@/, ""), source: "wikidata" };
  }
  return out;
}

const bskyHandle = (s) => s?.match(/bsky\.app\/profile\/([^/?#]+)/)?.[1] ?? s?.replace(/^@/, "");
const mastoAcct = (s) => {
  if (!s) return null;
  const m = s.match(/^https?:\/\/([^/]+)\/@([^/?#]+)/);
  if (m) return m[2].includes("@") ? m[2] : `${m[2]}@${m[1]}`;
  return /^@?[^@\s]+@[^@\s]+$/.test(s) ? s.replace(/^@/, "") : null;
};

/** platform entries from socials.json or deputes.json socials (value may be a URL string or { url, handle }). */
function fromSocials(socials, source) {
  const out = {};
  for (const [id, plats] of Object.entries(socials ?? {})) {
    if (!mpIds.has(id) || !plats) continue;
    const a = {};
    const get = (p) => (typeof plats[p] === "string" ? { url: plats[p] } : plats[p]);
    const b = get("bluesky");
    if (b && (b.handle || b.url)) a.bluesky = { handle: bskyHandle(b.handle ?? b.url), source };
    const y = get("youtube");
    if (y) {
      const cid = y.channelId ?? y.url?.match(/\/channel\/(UC[\w-]{22})/)?.[1];
      a.youtube = cid ? { channelId: cid, source } : y.url ? { url: y.url, source } : undefined;
      if (!a.youtube) delete a.youtube;
    }
    const m = get("mastodon");
    const acct = m && mastoAcct(m.handle ?? m.url);
    if (acct) a.mastodon = { acct, source };
    if (Object.keys(a).length) out[id] = a;
  }
  return out;
}

async function resolveYoutube(url) {
  // channel URL like youtube.com/@name: the page carries the UC… channel id
  const html = await fetchText(url, { timeout: 15000 });
  return html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ?? html.match(/channel\/(UC[\w-]{22})/)?.[1] ?? null;
}

async function loadAccounts() {
  const cache = await readJson(STATE.accounts, { wikidata: {}, wikidataAt: null, youtubeIds: {} });
  if (process.argv.includes("--refresh-accounts") || !cache.wikidataAt || now - Date.parse(cache.wikidataAt) > 24 * HOUR) {
    try {
      cache.wikidata = await wikidataAccounts();
      cache.wikidataAt = new Date(now).toISOString();
    } catch (e) {
      console.warn(`Wikidata failed, keeping cached accounts: ${e.message}`);
    }
  }
  const layers = [
    fromSocials(await readJson(SOCIALS, {}), "socials.json"),
    fromSocials(Object.fromEntries(deputes.map((d) => [d.id, d.socials])), "assemblee"),
    cache.wikidata,
  ];
  const merged = {};
  for (const layer of layers)
    for (const [id, plats] of Object.entries(layer)) for (const [p, v] of Object.entries(plats)) (merged[id] ??= {})[p] ??= v;
  // YouTube URLs without a channel id: resolve once, cache
  for (const [id, a] of Object.entries(merged)) {
    if (a.youtube && !a.youtube.channelId) {
      const u = a.youtube.url;
      if (!(u in cache.youtubeIds)) cache.youtubeIds[u] = await resolveYoutube(u).catch(() => null);
      if (cache.youtubeIds[u]) a.youtube.channelId = cache.youtubeIds[u];
      else delete a.youtube;
    }
  }
  cache.merged = merged;
  await writeJson(STATE.accounts, cache, true);
  return merged;
}

// ---------- fetchers ----------
const BSKY = "https://public.api.bsky.app/xrpc";
async function bluesky(mpId, { handle }) {
  const j = await fetchJson(`${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=40&filter=posts_no_replies`);
  const out = [];
  for (const it of j.feed ?? []) {
    if (it.reason) continue; // reposts of someone else
    const p = it.post;
    const r = p.record ?? {};
    const rkey = p.uri.split("/").pop();
    const ext = p.embed?.external ?? p.embed?.media?.external;
    const quoted = p.embed?.record?.value?.text ?? p.embed?.record?.record?.value?.text;
    out.push({
      id: `bsky:${p.uri}`,
      mpId,
      platform: "bluesky",
      handle: p.author.handle,
      url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
      time: new Date(r.createdAt ?? p.indexedAt).toISOString(),
      text: r.text ?? "",
      link: ext ? { url: ext.uri, title: cleanText(ext.title ?? "") } : null,
      quoted: quoted ? snippet(quoted, 300) : null,
      metrics: { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0 },
    });
  }
  return out;
}

async function youtube(mpId, { channelId }) {
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []).map((e) => {
    const vid = e.match(/<yt:videoId>([^<]+)/)?.[1];
    const title = cleanText(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const desc = cleanText(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? "");
    return {
      id: `yt:${vid}`,
      mpId,
      platform: "youtube",
      handle: channelId,
      url: `https://www.youtube.com/watch?v=${vid}`,
      time: new Date(e.match(/<published>([^<]+)/)?.[1]).toISOString(),
      text: snippet(desc ? `${title}\n${desc}` : title, 600),
      link: null,
      quoted: null,
      metrics: { views: +(e.match(/views="(\d+)"/)?.[1] ?? 0) },
    };
  });
}

async function mastodon(mpId, { acct }) {
  const [user, host] = acct.split("@");
  const acc = await fetchJson(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  const st = await fetchJson(`https://${host}/api/v1/accounts/${acc.id}/statuses?limit=40&exclude_replies=true&exclude_reblogs=true`);
  return st.map((s) => ({
    id: `masto:${s.uri}`,
    mpId,
    platform: "mastodon",
    handle: acct,
    url: s.url ?? s.uri,
    time: new Date(s.created_at).toISOString(),
    text: cleanText(s.content),
    link: s.card ? { url: s.card.url, title: cleanText(s.card.title ?? "") } : null,
    quoted: null,
    metrics: { likes: s.favourites_count ?? 0, reposts: s.reblogs_count ?? 0, replies: s.replies_count ?? 0 },
  }));
}

const FETCH = { bluesky, youtube, mastodon };

// ---------- main ----------
const accounts = await loadAccounts();
const jobs = Object.entries(accounts).flatMap(([mpId, a]) => Object.entries(a).filter(([p]) => FETCH[p]).map(([p, acc]) => ({ mpId, p, acc })));
const prev = await readJson(STATE.posts, { posts: [] });
const byId = new Map(prev.posts.map((p) => [p.id, p]));
const stats = {};
const failures = [];
await pool(jobs, 6, async ({ mpId, p, acc }) => {
  const s = (stats[p] ??= { accounts: 0, ok: 0, posts: 0, new: 0 });
  s.accounts++;
  try {
    const posts = await FETCH[p](mpId, acc);
    s.ok++;
    for (const post of posts) {
      if (!post.text?.trim() && !post.link) continue;
      s.posts++;
      const old = byId.get(post.id);
      if (!old) s.new++;
      byId.set(post.id, { ...post, fetchedAt: old?.fetchedAt ?? new Date(now).toISOString() }); // refresh metrics
    }
  } catch (e) {
    failures.push(`${p} ${mpId} ${acc.handle ?? acc.channelId ?? acc.acct}: ${e.message}`);
  }
});
const cutoff = now - KEEP_DAYS * 24 * HOUR;
const posts = [...byId.values()].filter((p) => Date.parse(p.time) >= cutoff).sort((a, b) => b.time.localeCompare(a.time));
await writeJson(STATE.posts, { fetchedAt: new Date(now).toISOString(), posts });
console.log(Object.entries(stats).map(([p, s]) => `${p}: ${s.ok}/${s.accounts} accounts read, ${s.posts} posts seen, ${s.new} new`).join("\n"));
if (failures.length) console.log(`${failures.length} account(s) failed:\n  ${failures.slice(0, 15).join("\n  ")}`);
console.log(`posts: ${posts.length} kept (last ${KEEP_DAYS} days)`);
