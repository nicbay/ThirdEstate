# MPs' social accounts (`socials.json`)

`scripts/sync-socials.mjs` finds the social accounts of the 574 sitting MPs using free sources only,
and records where each account came from. It does not change `deputes.json`; the UI merges `socials.json`.

```
node scripts/sync-socials.mjs            # full run (about 3 min cold, about 1 min with the cache)
node scripts/sync-socials.mjs --refresh  # ignore cached pages
# also: --no-sites --no-guess --no-groups --no-bluesky --no-ai
```

It does not need `ANTHROPIC_API_KEY`. Without the key, the AI step is skipped and ambiguous cases stay undecided.

## Output

`public/data/an/socials.json` holds one entry per MP id:

```json
"PA841067": {
  "twitter":   { "url": "https://x.com/AllegretPilot", "handle": "@AllegretPilot", "source": "override", "confidence": "high", "confirmedBy": ["wikidata", "site"] },
  "instagram": { "url": "https://www.instagram.com/alexandre.allegret.pilot/", "handle": "@alexandre.allegret.pilot", "source": "override", "confidence": "high", "confirmedBy": ["site"] },
  "tiktok":    { "url": "https://www.tiktok.com/@allegretpilot", "handle": "@allegretpilot", "source": "site", "confidence": "medium", "evidence": { "page": "https://alexandreallegretpilot.fr/contact/" } }
}
```

- Platforms: `twitter` (X), `instagram`, `linkedin`, `facebook`, `bluesky`, `tiktok`, `youtube`, `mastodon`, `website`.
- `url` is canonical (`https://x.com/…`, `https://www.instagram.com/…/`, `https://www.linkedin.com/in/…/`, `https://bsky.app/profile/…`). `handle` is for display.
- `source` is the strongest source that gave the account. `confirmedBy` lists other sources that found the same account.
- `confidence`:
  - `high`: declared by the MP, on Wikidata, or found on a trusted page with a handle that carries the MP's name.
  - `medium`: found with a handle that doesn't carry the name, from a guessed or old website, or from a Bluesky match on name and role only.
  - `low`: one Facebook page from the previous term.
- `evidence` (when present) is the page the link was found on, or why it was accepted.

`public/data/an/socials-meta.json` holds coverage after each step, counts by source and by confidence, conflicts between sources, every rejected candidate with its reason, and the ambiguous cases still undecided.

## Sources, in order

A stronger source wins. Weaker sources that agree go into `confirmedBy`, and weaker sources that disagree go into `conflicts`.

1. **Assemblée**: what the MP declared, already in `deputes.json`. Some declared values can't be used: about 60 Facebook values are just a name ("Pouria Amirshahi"), plus a few broken Instagram and X values. These are rejected, and the reason is recorded.
2. **Wikidata**: one SPARQL POST for every MP, joined on P4123 (the Assemblée id). 543 of the 574 MPs have an item. Properties used: P2002 (X), P2003 (Instagram), P6634 (LinkedIn), P2013 (Facebook), P12361 (Bluesky), P7085 (TikTok), P2397 (YouTube), P4033 (Mastodon), P856 (website).
3. **MPs' own websites**: the declared site, the Wikidata P856 site, the previous-term site, or a guessed domain (see below). The script fetches the homepage and up to two same-site contact or about pages, then extracts the social links.
   - It respects robots.txt, sends `User-Agent: ProjectView-socials/1.0 (+https://github.com/nicbay/projectview)`, waits at least 1.2 s between requests to the same host, and caches pages for 7 days.
   - It ignores share buttons, links to individual posts, and the Assemblée's or a party's own accounts.
   - An account linked from two or more MPs' sites is treated as a party account and dropped.
   - **Guessed domains**: for MPs with no known site, it tries `prenomnom.fr`, `prenom-nom.fr`, `prenomnom.com` and `prenom-nom.com`. A domain is kept only if its homepage contains the MP's full name and "député(e)". This found 36 sites, including `alexandreallegretpilot.fr`.
4. **Group pages**: the sites below were checked on 2026-11-07. An account repeated under several MPs is the group's own and is dropped.

   | Group | Page | Notes |
   |---|---|---|
   | RN | `deputes-rn.fr/deputes?page=1…` | Directory cards carry the links. 113 MPs, 71 new accounts (mostly Instagram and Facebook). |
   | LIOT | `www.groupeliot.fr` | One page; each card links the MP's Assemblée page (PA id), so the join is exact. 19 new accounts. |
   | HOR | `horizonsleparti.fr/nos-parlementaires/` | Mostly X, all already known, so it only adds confirmations. |
   | GDR | `groupe-communiste.assemblee-nationale.fr/auteur/…` | Facebook only. 3 new accounts. |

   These groups have no usable page: EPR, DR and DEM have no group site; the SOC domain is parked; ECOS, LFI and UDR list their MPs without accounts. Party sites only show the party's own accounts.
5. **NosDéputés.fr**: the archive of the previous term (2022–2024), joined on `id_an`, covering 383 returning MPs. Its sites are crawled; its accounts are added last, at medium or low confidence, because they may have been abandoned since. The site is slow, so the needed rows are cached in `data/socials-cache.json` and used as a fallback.
6. **Bluesky**: `app.bsky.actor.searchActors` (public, no key) is queried with "prénom nom". A result is accepted only if:
   - the display name or handle matches the full name, **and**
   - the bio states a French MP role ("député(e)", "Assemblée nationale", "circonscription", or a group or party name), **and**
   - the bio has no foreign or other office ("Québec", "Canada", "Belgique", "sénateur", "député européen", "MEP"…) unless it also names the MP's department, **and**
   - it is not a fan or parody account.

   Confidence is `high` when the bio also names the department, or when the handle is on the MP's own domain; otherwise `medium`. Bios of known accounts are also read for links (`getProfiles`).
7. **Link-in-bio pages** (Linktree and similar), found on MPs' sites and in Bluesky bios. **linktr.ee disallows all unnamed crawlers in robots.txt (`User-agent: *` / `Disallow: /`), so none were read.** The step stays in place for hosts that allow crawling.
8. **AI (optional)**: Claude Haiku 5.5 through `scripts/lib/claude.mjs` (shared $15/month cap).
   - It runs only for the cases the rules couldn't settle, such as several name-matching profiles, or a site link without the MP's name.
   - Its prompt holds the MP's identity and the evidence already collected. It must return a candidate index or `null` ("never guess"), as structured JSON at low effort.
   - It runs only when `ANTHROPIC_API_KEY` is set, spends at most $0.50 per run, and stops when less than $2 of the monthly cap is left.
   - Verdicts are cached in `data/socials-cache.json`, so a case is never paid for twice, and cached verdicts apply even without a key.
   - It does **not** use web search. According to the Claude API reference, the dynamic web search tool (`web_search_20260209`) is only for Opus/Sonnet models. Whether Haiku 5.5 accepts the basic `web_search_20250305` couldn't be tested without a key, and searches cost $10 per 1,000 on top of tokens. So the AI only judges candidates the free sources have already fetched.
   - Undecided right now: 69 cases (`undecided` in the meta file).
9. **Overrides**: `data/socials-overrides.csv` always wins (see below).

LinkedIn, Instagram, X and Facebook pages are never fetched: the pipeline only reads pages that link to them (terms of service).

## Coverage (run of 2026-11-07, 574 MPs)

Number of MPs with an account after each step:

| after | X | Instagram | LinkedIn | Facebook | Bluesky | TikTok | YouTube | website |
|---|---|---|---|---|---|---|---|---|
| Assemblée (usable values) | 356 | 235 | 120 | 262 | 0 | 0 | 0 | 211 |
| + Wikidata | 536 | 261 | 188 | 323 | 69 | 21 | 40 | 278 |
| + own websites (incl. 36 guessed) | 536 | 305 | 215 | 363 | 75 | 43 | 97 | 345 |
| + group pages | 536 | 353 | 217 | 404 | 75 | 45 | 97 | 345 |
| + NosDéputés (2022) | 536 | 353 | 217 | 411 | 75 | 45 | 97 | 345 |
| + Bluesky search | 536 | 353 | 217 | 411 | 151 | 45 | 97 | 345 |
| + overrides | **536** | **353** | **217** | **411** | **151** | **45** | **97** | **345** |

Change from Assemblée-only data:
- Instagram: 241 declared values, 235 usable, 353 now (+50 %)
- LinkedIn: 120 → 217 (+81 %)
- Facebook: 318 declared values, 262 usable, 411 now
- Bluesky: 0 → 151
- X: 357 declared values, 536 now (93 % of MPs)

550 of 574 MPs have at least one account.

These 24 MPs have none of X, Instagram, LinkedIn, Facebook or Bluesky:

> Shéhérazade Bentorki, Marie-Sophie Bernadeau, Benoît Blanchard, Jean-Yves Bonnefoy, Hubert Brigand, Cendrine Chazé, Michel Criaud, Lionel Duparay, Muriel Fiol, Laurence Gardet, Éric Gérard, Sabine Gervais, Benoit Gilhet, Melouka Hadj-Mimoune, Eric Liégeon, Pierre Marle, Patrice Martin, Christelle Minard, Didier Padey, Dominique Paillat, Emeline Rey-Rinchet, Emmanuel Riotte, Sébastien Saint-Pasteur, Emmanuel Tjibaou

They are good candidates for manual overrides.

Confidence of the final accounts:
- X: 536 high
- Instagram: 343 high, 10 medium
- LinkedIn: 213 high, 4 medium
- Facebook: 371 high, 39 medium, 1 low
- Bluesky: 143 high, 8 medium

LinkedIn is the hardest platform: no free source lists it beyond what MPs declare and what their sites link. About 360 MPs still have no LinkedIn account here.

## Example: Alexandre Allegret-Pilot (PA841067)

He declared nothing to the Assemblée.
- Wikidata has his X account.
- The guessed domain `alexandreallegretpilot.fr` passed the name and "député" check, and its contact page links X, Instagram, LinkedIn, TikTok and YouTube.

So the three overrides the owner seeded are each **independently confirmed** (`confirmedBy: ["site"]`), and TikTok and YouTube come for free. His site also links a numeric Facebook profile (`profile.php?id=…`). It is left undecided because the site was guessed and the id carries no name; add an override if it is his.

## False positives that were rejected (examples)

- **Gabriel Attal on Bluesky**: `gattalactu.bsky.social` ("Compte Fan | Toute l'actualité de Gabriel Attal") and a parody account were rejected as fan or parody accounts.
- **Namesakes on Bluesky**: 77 accounts had the right name but no MP role in their bio and were rejected. Canadian, Belgian and European-Parliament "député(e)" accounts are rejected by the foreign-office rule.
- **A web designer's LinkedIn**: Éric Pauget's site links `linkedin.com/in/clément-fauriel-…`, which is the agency credit, not the MP. LinkedIn links without the MP's name are never auto-accepted; this one is left undecided for the AI step or an override.
- **A colleague's page on the RN directory**: Thierry Tesson's card links `facebook.com/MatthieuMarchioRN`. Any handle that carries another sitting MP's full name is rejected.
- **The Assemblée's own channel**: Sandrine Josso's "website" is her Assemblée page, which links `youtube.com/@Assemblee-nationale`. Assemblée-hosted pages aren't crawled as MPs' sites, and institutional accounts are on a deny list.
- **Shared "websites"**: `rassemblementnational.fr` (4 MPs), `mlafrance.fr` (3), `avenirfrancais.fr` (2) and `gouvernement.fr` (2) are not MPs' own sites. They are dropped and not crawled; institution and party hosts are also on a deny list.
- **Party accounts on MPs' sites**: any account linked from two or more MPs' sites is dropped.
- **Unusable declared values**: Facebook values that are only a name ("Pouria Amirshahi", "Facebook - Florence Goulet"), e-mail addresses typed into Instagram, and `facebook.com/share/…` short links.

Conflicts (two sources give different accounts, 267) are kept in the meta file. Usually both are the MP's, an old and a new account, for example Louis Boyard's `@LouisBoyard` (Assemblée) and `@l_boyard` (Wikidata). The Assemblée value wins.

## Adding or correcting an account (overrides)

Edit `data/socials-overrides.csv`:

```csv
mp_id,platform,url,note
PA841067,linkedin,https://www.linkedin.com/in/alexandreallegret/,checked by owner 2026-11-07
PA718784,linkedin,,web designer's profile, not the MP
```

- `mp_id` is the Assemblée id (`PA…`, as in `deputes.json`).
- `platform` is one of `twitter instagram linkedin facebook bluesky tiktok youtube mastodon website`.
- `url` can be a full URL or a handle. An **empty `url` removes** that platform for that MP (use it for a false positive).
- `note` is free text (who checked, and when). It is copied into the output.
- Overrides always win and get `confidence: "high"`. If another source found the same account, it shows in `confirmedBy`.

Then run `node scripts/sync-socials.mjs`.

## Files

| File | Committed | What |
|---|---|---|
| `scripts/sync-socials.mjs` | yes | the pipeline |
| `public/data/an/socials.json` | yes | accounts per MP (for the UI) |
| `public/data/an/socials-meta.json` | yes | coverage, conflicts, rejections, undecided cases |
| `data/socials-overrides.csv` | yes | manual overrides |
| `data/socials-cache.json` | yes | AI verdicts, domain-guess results, NosDéputés fallback (~200 KB) |
| `.cache/socials-fetch.json` | no (git-ignored) | links of fetched pages, 7-day cache |

Not done here: no `package.json` script (out of scope for this change) and no GitHub Actions step yet. A weekly job running the script and committing `public/data/an/socials*.json`, `data/socials-cache.json` and `data/usage/` would keep it fresh.
