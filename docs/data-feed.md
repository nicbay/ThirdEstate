# Red/Blue feed: data pipeline

A live French news feed. Next to each story are the reactions of députés on social media, each one rated by AI for left/right lean and populist rhetoric. A rating can also flag a factual claim as "à vérifier". This file covers the backend and data only. The front end reads `public/data/feed/*.json`.

French colour convention: **left = red, right = blue**. A negative `lean` score means left and a positive one means right.

## Pipeline

Every 2 hours, `.github/workflows/sync-feed.yml` runs these four steps:

| Step | Script | Network | Writes |
|---|---|---|---|
| 1. News | `scripts/sync-news.mjs` | RSS feeds | `data/feed/news.json` |
| 2. MP posts | `scripts/sync-mp-posts.mjs` | Bluesky, YouTube, Mastodon, Wikidata (daily) | `data/feed/posts.json`, `data/feed/accounts.json` |
| 3. Rating | `scripts/rate-reactions.mjs` | Claude API (Haiku 5.5) | `data/feed/ratings.json`, `data/usage/claude-YYYY-MM.json` |
| 4. Build | `scripts/build-feed.mjs` | none | `public/data/feed/latest.json`, `archive/YYYY-MM-DD.json`, `index.json` |

Clustering and matching live in `scripts/lib/stories.mjs` and are pure functions, so steps 3 and 4 compute the same stories. Shared helpers are in `scripts/lib/feed-common.mjs`. Everything runs without an API key: step 3 then prints `ANTHROPIC_API_KEY is not set: skipping the rating step` and exits 0. Step 4 still publishes the stories, with rule-matched reactions marked `rating: null`.

Local run:

```bash
node scripts/sync-news.mjs && node scripts/sync-mp-posts.mjs && node scripts/rate-reactions.mjs && node scripts/build-feed.mjs
```

`node scripts/rate-reactions.mjs --dry-run` prints the first request without calling the API. `--limit N` caps the number of posts rated in one run.

`data/feed/` holds internal state. The workflow commits it so that ratings are never paid for twice. Raw items and posts are kept for 8 days and ratings for 14 days. Only `public/data/feed/` is served.

## Sources

### News (RSS: title, link, outlet, time and a snippet of at most 280 characters; never the article body)

| Outlet | Feed(s) | Rough editorial position (display only, never used in ratings) |
|---|---|---|
| L'Humanité | politique | gauche |
| Mediapart | articles (public teasers) | gauche |
| Libération | politique | centre-gauche |
| Le Monde | politique + une | centre-gauche |
| franceinfo | politique + titres | service public |
| Public Sénat | all | parlementaire |
| LCP | all | parlementaire |
| 20 Minutes | politique | centre |
| Le Parisien | politique (no dates in the feed: the date is read from the URL) | centre |
| Les Échos | politique (often answers 403 to automated readers; tolerated) | centre-droit |
| L'Express | politique | centre-droit |
| L'Opinion | politique | droite libérale |
| Le Figaro | politique + actualités | droite |
| Le JDD | all | droite |
| Valeurs actuelles | all | droite |

Le Point, Marianne and CNews block RSS readers (HTTP 403) and are left out. To add an outlet, add it to `OUTLETS` in `sync-news.mjs`.

### MP posts

| Platform | How | Accounts |
|---|---|---|
| Bluesky | `app.bsky.feed.getAuthorFeed` on the public AppView (`public.api.bsky.app`), no key, own posts only (no replies, no reposts) | 69 current MPs (Wikidata P12361) |
| YouTube | channel RSS `youtube.com/feeds/videos.xml?channel_id=…` (title + description) | 40 (Wikidata P2397) |
| Mastodon | public API `accounts/lookup` + `statuses` | 7 (Wikidata P4033) |
| X/Twitter | **not used**: it can't be read for free | — |

Accounts are merged in this order of preference:

1. `public/data/an/socials.json` from the mp-socials workstream, shaped `{ [mpId]: { [platform]: { url, handle, ... } } }`. It is picked up as soon as the file exists. Keys read: `bluesky` (`handle` or a `bsky.app/profile/…` URL), `youtube` (`channelId`, a `/channel/UC…` URL, or any channel URL, which is resolved once and cached), `mastodon` (`handle` like `user@host` or a `https://host/@user` URL).
2. `socials` in `public/data/an/deputes.json` (Assemblée open data, currently without Bluesky, YouTube or Mastodon).
3. Wikidata, joined on P4123 (Assemblée id = `PA` + value) and refreshed once a day (`--refresh-accounts` forces a refresh).

The resolved list is in `data/feed/accounts.json` → `merged`. On 2026-11-07, 5 of the 69 Wikidata Bluesky handles no longer resolve (HTTP 400) and 1 Mastodon instance is down. Fixing them in Wikidata or in socials.json is enough.

Measured volume (2026-11-07): about 45–70 posts per weekday from 25–30 active MPs, and ~180 posts in a 72 h window.

## Stories (clustering)

Each news item becomes a TF-IDF vector. The title counts double, names and capitalised words ×1.5, and words are lowercased, accent-stripped and lightly stemmed, with a French stopword list. Items are processed oldest first. Each item joins the story whose centroid it is most similar to (cosine ≥ **0.25**), provided that story had an item in the last 36 h; otherwise it starts a new story. The headline is the most central item. The story `id` is a hash of its first article's link, so it stays stable while the story grows. Clustering covers the 72 h window plus one day.

On 2026-11-07, 459 items formed 277 stories, 49 of them covered by at least 2 outlets. The feed keeps stories that have a reaction or ≥ 2 outlets, ranked by `outlets + 1.5 × reactions`, at most 80.

## Matching posts to stories

Rules first, no AI:

1. **Link**: the post links to one of the story's articles, which is a sure match.
2. **Terms**: cosine between the post (text + link card title + quoted post) and the story centroid, using the news IDF. Words the news never uses are ignored. A match also needs at least 2 shared distinctive terms. The post time must fall between 12 h before the first article and 72 h after the last one.
   - score ≥ **0.30** and a clear lead (≥ 0.08) over the next story: sure match;
   - **0.14**–0.30, or a close call: ambiguous. Up to 3 candidate stories go to Haiku together with the rating request, and Haiku picks one or `none`. Matching therefore costs no separate AI call.

On 2026-11-07, of 178 posts in the window, 22–29 matched surely, about 60 were ambiguous and the rest were unrelated (not rated, not shown). Once a post is rated, the AI's story choice wins, and a post the AI judges unrelated is dropped from the feed.

## Rating (Claude Haiku 5.5)

Calls go through the shared client `scripts/lib/claude.mjs`. The model is `claude-haiku-5-5` only, with a hard **$15/month cap across all jobs** and the ledger in `data/usage/`. Requests use `output_config: { effort: "low", format: { type: "json_schema", … } }` (structured output) and carry **8 posts per request**. The prompt and schema are `SYSTEM` and `ratingSchema` in `scripts/rate-reactions.mjs`, prompt version **`feed-rating-v1`**. The system prompt is written in French, which matches the posts.

Per post the model returns:

| Field | Meaning |
|---|---|
| `story` | letter of the candidate story the post comments on, or `none` |
| `political` | false for purely practical posts (schedule, "I'll be on RTL") |
| `lean.score` | −1 (gauche radicale) … 0 (centre/neutre) … +1 (droite radicale), **from the content** (the ideas expressed), not the author's party. The prompt gives the MP's name but not their party. `null` if not political. |
| `lean.rationale_fr/_en` | one short sentence citing what in the post justifies the score |
| `populism.score` | 0 … 1, whichever side |
| `populism.markers` | subset of `anti_elites`, `peuple_vs_elites`, `peuple_homogene`, `souverainete_populaire`, `delegitimation`, `complot`, `simplisme`, `nativisme`, `appel_emotionnel` |
| `check` | "à vérifier", or `null`. Only for a checkable factual claim (number, statistic, dated fact, quote, vote result) that the model reasonably doubts. Opinions, promises and slogans never qualify. Shape: `{ claim, why_fr, why_en, sources: [{title,url}] }`. |

**Accuracy and defamation policy.** The model is told never to call a post false, lying, wrong or incorrect, only to explain why a claim deserves checking. This is also enforced in code:

- A `check` whose explanation contains any of those words (FR or EN) is **dropped** and never published.
- Source links are kept only if they are one of the news articles given to the model or point to an allow-listed official domain (insee.fr, assemblee-nationale.fr, vie-publique.fr, legifrance.gouv.fr, ccomptes.fr, …; see `SOURCE_DOMAINS`). This stops invented deep URLs.

Haiku doesn't browse the web (web search would cost $10 per 1,000 searches), so "à vérifier" reflects its own knowledge and the articles it was given. That is why the flag is only a prompt to verify, never a verdict.

Every rating stores `model`, `promptVersion`, `ratedAt` and the chosen story's article ids. A post already in `ratings.json` is **never re-rated**. Changing the prompt means bumping `PROMPT_VERSION`; old ratings keep their version label.

**Budget guards**, applied in this order before every request:

1. `remainingBudget()` must be ≥ $0.25, which keeps a reserve for other jobs.
2. The feed's own share for the month (`byJob.feed` in the ledger) must be under **$6** (`FEED_MONTHLY_USD`).
3. At most **120 posts per run** (`FEED_MAX_PER_RUN`), newest first.
4. The shared client refuses any call whose worst case (input + full `max_tokens`) would cross the $15 cap.

When any guard trips, the run stops cleanly. Unrated posts wait for the next run and the feed is still built. A failed batch is retried once and then skipped. The ratings file is saved after every batch.

## Budget math

Measured on the 2026-11-07 dry run: a batch of 8 posts is about 18,000 characters of user prompt plus a 3,400-character system prompt, so roughly **6,000 input tokens** at ~3.5 characters per French token. The output is about 8 × 220 tokens of JSON plus a little low-effort thinking, roughly **2,500 output tokens**.

At Haiku 5.5 prices ($0.10 / M input, $0.50 / M output):

- per batch: 6,000 × $0.10/M + 2,500 × $0.50/M ≈ **$0.0019**
- per post: ≈ **$0.00024**

| Scenario | Rated posts/day | $/day | $/month |
|---|---|---|---|
| Measured now (~55 posts/day, ~50 % matched) | ~28 | ~$0.007 | **~$0.20** |
| socials.json triples the accounts and the campaign doubles activity | ~170 | ~$0.04 | ~$1.25 |
| Hard ceiling from the per-run cap (120 × 12 runs) | 1,440 | $0.35 | stopped at the $6 feed share |

These are estimates: no API key was available when this was written, so no live call has been measured. Real spend is in `data/usage/claude-YYYY-MM.json` → `byJob.feed`, and once the first runs land it is worth checking against the table.

## Output schema

`public/data/feed/latest.json`:

```jsonc
{
  "generatedAt": "2026-11-07T12:43:00.000Z",
  "windowHours": 72,
  "outlets": [{ "id": "lemonde", "name": "Le Monde", "lean": "centre-gauche" }, …],
  "method": { … },
  "counts": { "stories": 46, "reactions": 28, "rated": 0, "unrated": 28, "postsInWindow": 178 },
  "stories": [{
    "id": "s-1a2b3c4d5e",
    "title": "Présidentielle 2027 : ce qui change dans le nouveau programme de Jean-Luc Mélenchon",
    "firstTime": "…", "lastTime": "…",
    "outlets": ["lefigaro", "liberation", …],
    "terms": ["melenchon", "programme", …],          // stemmed keywords, for search/debug
    "items": [{ "id", "outlet", "title", "link", "time", "summary" }],
    "reactions": [{
      "id": "bsky:at://…",
      "mp": { "id": "PA794786", "name": "…", "group": { "abrev": "LFI-NFP", "libelle": "…", "couleur": "#C00D0D" } },
      "platform": "bluesky" | "youtube" | "mastodon",
      "handle": "…", "url": "…", "time": "…",
      "text": "…", "link": { "url", "title" } | null, "quoted": "…" | null,
      "metrics": { "likes", "reposts", "replies" } | { "views" },
      "match": { "how": "link" | "terms" | "ai", "score": 0.42 },
      "rating": null | {
        "political": true,
        "lean": { "score": -0.7, "rationale_fr": "…", "rationale_en": "…" },
        "populism": { "score": 0.4, "markers": ["anti_elites"], "rationale_fr": "…", "rationale_en": "…" },
        "check": null | { "claim": "…", "why_fr": "…", "why_en": "…", "sources": [{ "title", "url" }] },
        "model": "claude-haiku-5-5", "promptVersion": "feed-rating-v1", "ratedAt": "…"
      }
    }],
    "stats": { "reactions", "rated", "leanAvg", "left", "right", "checks" }
  }]
}
```

`archive/YYYY-MM-DD.json` has the same shape as `latest.json` minus `counts`, plus `day`. It holds the stories with an article or a reaction on that UTC day, limited to that day's articles and reactions. Days still inside the window are rewritten on each run, and a rewrite never replaces a fuller archive. Older days stay frozen. `index.json` lists the archive days.

## Limitations

- **No X/Twitter.** Most MPs post mainly on X, so the feed under-represents them, especially on the right, where Bluesky use is low. The reaction mix is therefore **not** a representative sample of the Assemblée. The front end should say so.
- Coverage is bounded by known accounts (69 Bluesky, 40 YouTube, 7 Mastodon in Wikidata), and socials.json will extend it.
- YouTube posts are video titles and descriptions, not what is said in the video.
- Clustering is lexical. It sometimes splits one story in two (two angles on the same event) or misses a post that uses different words. Thresholds are at the top of `scripts/lib/stories.mjs`.
- The lean and populism scores are a model's reading of short texts. They are indicative, can be wrong, and should be shown with their rationale and the model and prompt version.
- "À vérifier" relies on the model's knowledge (no live fact-checking). It can miss doubtful claims or flag correct ones, and the wording policy keeps it from asserting falsity.
- Les Échos often refuses automated readers. Le Point, Marianne and CNews are not available by RSS.
- Bluesky post text is stored as written, so links shortened by the app appear as `example.fr/…`.
