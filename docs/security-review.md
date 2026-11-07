# ProjectView: security review and live functional test

Date: 2026-11-07. Scope: repo `nicbay/projectview` (working tree and full git history), live site
https://projectview-swart.vercel.app (bundle `assets/index-CMYN0sjL.js`), Supabase project
`bxjparhlylqrbipnnyuu`, GitHub Actions. Tests were read-only or fail-safe: the only write tests were RLS
inserts, which were refused as expected. No accounts were created, no emails sent, no bulk updates or deletes.
No code was changed. The fixes below are proposals only.

The live site runs `6c01e61` (origin/main). Local `main` has one commit that is not pushed yet (`4cac2d0`),
so `#/2027` and `#/elus` have no route on the live site yet and fall back to the home page.

## Summary

| # | Severity | Finding |
|---|----------|---------|
| H1 | High | The simulator share link can inject HTML into the page (DOM XSS); reproduced on the live site |
| M1 | Medium | No security headers: no CSP, no frame-ancestors/X-Frame-Options, no Referrer-Policy, no nosniff |
| M2 | Medium | External URLs in `href`/`src` are HTML-escaped but their scheme is never checked |
| M3 | Medium | GitHub Actions: every dependency can reach a write token; actions pinned by tag only; ledger race |
| L1 | Low | Supabase: public scenarios can be listed by anyone; `data` size is unbounded; sign-up has no CAPTCHA |
| L2 | Low | Dev dependencies with known CVEs (vite 6.0.7 / esbuild, fflate 0.8.2) |
| L3 | Low | Anyone can join the Realtime Presence channel, so visitor counts can be faked |
| L4 | Low | Functional issues: 404s, overflow at 375px, large payloads, deploy lag |
| OK | Info | No secrets found anywhere; only the anon/publishable key ships; RLS behaves as intended |

---

## H1 (High): HTML injection through the simulator share link

**Where:** `src/views/simulator.ts`, `decode()` (about line 27) and the `shell()` template (about lines 70-100).

**What happens:** `decode()` turns the token after `#/simulateur/` back into an object and uses it as the
simulator state without checking its shape. `shell()` then writes some of that state into `app.innerHTML`
without `esc()`, because it assumes those fields are numbers. The fields are the transfer percentages
(`s.transfers[name][0|1]`, in an input `value` and in an `<output>`) and `c.share` in an input `value`.
A crafted token can put markup in those fields.

**Evidence:** On the live site, a harmless test token (it only set a `data-` attribute on `<html>`) caused
markup to be injected and run when `#/simulateur/<token>` was opened. Opening the link is enough; no click
is needed. There is no CSP to stop it (see M1). When a visitor is signed in, the Supabase session sits in
`localStorage` on the same origin, so script injected this way could act on that visitor's saved scenarios.

**Fix:** validate the decoded object strictly and coerce every number. Escaping the numeric fields as well
adds a second layer of protection.

```diff
--- a/src/views/simulator.ts
+++ b/src/views/simulator.ts
-const decode = (t: string): Scenario | null => {
-  try {
-    return JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/")))));
-  } catch {
-    return null;
-  }
-};
+const num = (v: unknown, lo: number, hi: number) => {
+  const n = Number(v);
+  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
+};
+const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
+/** Parse a share token and rebuild a clean Scenario: wrong types are dropped, numbers are clamped. */
+const decode = (t: string): Scenario | null => {
+  try {
+    const raw = JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/")))));
+    if (!raw || !Array.isArray(raw.cands) || raw.cands.length > 30) return null;
+    const cands: Cand[] = raw.cands
+      .map((c: any) => ({ name: str(c?.name), share: num(c?.share, 0, 100), bloc: Number.isInteger(c?.bloc) && c.bloc >= 0 && c.bloc < BLOCS.length ? c.bloc : null }))
+      .filter((c: Cand) => c.name);
+    const names = new Set(cands.map((c) => c.name));
+    const finalists = (Array.isArray(raw.finalists) ? raw.finalists.map(str) : []).filter((n: string) => names.has(n));
+    if (finalists.length !== 2) return null;
+    const transfers: Record<string, [number, number]> = {};
+    for (const [k, v] of Object.entries(raw.transfers ?? {}))
+      if (names.has(k) && Array.isArray(v)) transfers[k] = [num(v[0], 0, 100), num(v[1], 0, 100)];
+    const edited = (Array.isArray(raw.edited) ? raw.edited.map(str) : []).filter((n: string) => names.has(n) && transfers[n]);
+    return { cands, finalists: [finalists[0], finalists[1]], transfers, edited };
+  } catch {
+    return null;
+  }
+};
```

Do the same for scenarios loaded from `localStorage` or Supabase (`[data-load]` handler): run
`list[i].data` through the same validator, not just `structuredClone`. Also escape `m.party`
(`${esc(m.party ?? "")}`) and treat `m.color` as data: accept only `/^#[0-9a-f]{3,8}$/i`, otherwise use a default.

---

## M1 (Medium): missing security headers

**Evidence:** `curl -I https://projectview-swart.vercel.app/` returns only `Strict-Transport-Security:
max-age=63072000; includeSubDomains; preload`, which Vercel adds by default. There is no CSP, no
`frame-ancestors`/`X-Frame-Options`, no `Referrer-Policy`, no `X-Content-Type-Options` and no
`Permissions-Policy`. The repo has no `vercel.json`.

**Fix:** add `vercel.json`. The policy below allows every host the site uses today: Google Fonts, Supabase
REST and Realtime, data.geopf.fr, geo.api.gouv.fr, tabular-api.data.gouv.fr, youtube-nocookie and INA
embeds, Wikimedia images, and Assemblée photos. Inline `style=""` attributes are used everywhere, so
`style-src` needs `'unsafe-inline'`. The four `onerror="this.style.visibility='hidden'"` handlers
(circo.ts, depute.ts, deputes.ts, explore.ts) are allowed through `'unsafe-hashes'` and their hash.
A cleaner option is to replace them with one delegated `error` listener and drop `'unsafe-hashes'`.
Deploy it first as `Content-Security-Policy-Report-Only`, browse every route, then switch to enforcing.

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-2v15HA+jcUVSuZj1qG3oTd5Ic+VBbl+6+8wh+TEIxBI='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www2.assemblee-nationale.fr https://www.assemblee-nationale.fr https://upload.wikimedia.org https://commons.wikimedia.org; connect-src 'self' https://bxjparhlylqrbipnnyuu.supabase.co wss://bxjparhlylqrbipnnyuu.supabase.co https://data.geopf.fr https://geo.api.gouv.fr https://tabular-api.data.gouv.fr; frame-src https://www.youtube-nocookie.com https://player.ina.fr https://www.ina.fr; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

If the site later loads anything from `static.data.gouv.fr`, `www.data.gouv.fr` or another host in the
browser, add that host to `connect-src` or `img-src`. Today those hosts appear only as links.
Fixing H1 still matters with a CSP in place; the CSP is defense in depth.

---

## M2 (Medium): URLs from external data are not scheme-checked

`esc()` (src/util.ts) escapes HTML characters, but a `javascript:` URL passes through it unchanged. These
values come from third parties or from Claude output and go into `href`/`src` with `esc()` only:

- `feed.ts:60` `lead.link` and `feed.ts:83` `r.url`. `scripts/sync-news.mjs` already requires
  `^https?:` for RSS links, which is good. Post URLs from the other sources and the `rt.check.sources[].url`
  values have no such check (feed.ts:87). Those last ones come from Claude web search, which reads
  untrusted pages, so prompt injection could steer them.
- `depute.ts:8` `href()`: platforms without a builder fall back to `(h) => h`, so a stored value is used as-is.
  `mastodon` is one such platform. `d.hatvp` is also used as-is.
- `history.ts:113,127-129` `permalink`, iframe `embed`, `m.url`, `a.url`; `explore.ts:243,248,287`
  `photo.url`, Wikipedia URL, event links; `district-profile.ts:38` `s.url`; `polls.ts:153` `m.url`.

The current data contains no `javascript:` URLs (checked across `public/data`), so this is hardening
against a compromised upstream or prompt injection.

**Fix:** add one helper and use it at every external `href`/`src`, and for iframes check the host as well:

```diff
--- a/src/util.ts
+++ b/src/util.ts
 export const esc = (s: unknown) => ...
+/** An http(s) URL, escaped for an attribute; anything else becomes "#". */
+export const safeUrl = (u: unknown) => {
+  try { const x = new URL(String(u ?? ""), location.href); return /^https?:$/.test(x.protocol) ? esc(x.href) : "#"; } catch { return "#"; }
+};
+const EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "player.ina.fr", "www.ina.fr"]);
+export const safeEmbed = (u: unknown) => {
+  try { const x = new URL(String(u)); return x.protocol === "https:" && EMBED_HOSTS.has(x.hostname) ? esc(x.href) : null; } catch { return null; }
+};
```

Then replace `href="${esc(x)}"` with `href="${safeUrl(x)}"` in the places listed. The same check could
also run in the sync scripts (`build-feed.mjs`, `rate-reactions.mjs`, `sync-socials.mjs`) so bad URLs
never get committed.

Everything else checked in the views was escaped correctly: titles, names, poll and market labels,
Wikipedia text, tooltips (`textContent`) and map `<title>`s. Values from Assemblée open data used in
`style`/`fill` attributes (`d.groupe.couleur`) are unescaped; they are low risk but should get the same
color check as in H1.

---

## M3 (Medium): GitHub Actions hardening

Checked `sync-assemblee.yml`, `sync-feed.yml`, `sync-live.yml`, `sync-socials.yml`.

Good:
- Triggers are `schedule` and `workflow_dispatch` only (no `pull_request_target`).
- No `${{ github.event.* }}` or other untrusted input inside `run:` steps, so no script injection.
- `ANTHROPIC_API_KEY` is set only in the `env:` of the steps that call Claude, not during `npm ci`.
- The key is never logged. `scripts/lib/claude.mjs` writes only spend and call counts to
  `data/usage/claude-YYYY-MM.json`. The committed ledger was checked and holds no secret.
- The 401 message in `rate-reactions.mjs` prints guidance only, not the key.

To fix:
1. **Write token reachable by every dependency.** `actions/checkout` keeps `GITHUB_TOKEN`
   (`contents: write`) in `.git/config`. Every later step, including npm install scripts during `npm ci`,
   can read it and push to `main`, which deploys to Vercel. Dependencies use caret ranges
   (`@anthropic-ai/sdk ^1.6.0`, `@supabase/supabase-js ^2.118.0`), but `npm ci` honors the lockfile, which
   limits drift. Proposed:
   - `npm ci --ignore-scripts`. Nothing in the dependency tree needs install scripts at sync time; esbuild's
     postinstall is only needed for `vite build`, which these jobs never run.
   - `actions/checkout` with `persist-credentials: false`, and push with an explicit token only in the
     commit step: `git push https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git HEAD:main`,
     with `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on that step alone.
   - Move `permissions:` to the job level. That is already minimal (`contents: write`), so this is optional.
2. **Actions pinned by tag only** (`actions/checkout@v5`, `actions/setup-node@v5`). Both are first-party,
   so the risk is low. Pinning to a full commit SHA with a `# v5` comment, plus Dependabot for
   `github-actions`, removes the risk of a tag being moved.
3. **Budget ledger race.** `sync-socials.yml` writes `data/usage` but uses concurrency group
   `sync-socials`, not `claude-budget` as the comment in `sync-feed.yml` requires. A Monday 08:45 socials run
   can overlap a feed run, and one of the two ledger updates would be lost, which weakens the $15 cap.
   Set `concurrency: { group: claude-budget, cancel-in-progress: false }` in `sync-socials.yml`.
   Also set the hard monthly limit in the Anthropic Console, as the code already recommends.
4. `sync-feed.yml` runs `git pull --rebase --autostash` after committing. It is fine, but if a rebase
   conflict happens on `data/usage`, the push fails without notice and that spend is lost from the ledger.
   Fix 3 makes this unlikely.

---

## L1 (Low): Supabase findings

Tested with the anon key read from the deployed bundle:

| Test | Result |
|------|--------|
| Key role | JWT payload `{"ref":"bxjparhlylqrbipnnyuu","role":"anon"}` (starts `eyJhbG`); publishable key starts `sb_pub`. No `service_role` or `sb_secret_` key anywhere. The `sb_secret_` string in the bundle is supabase-js code that checks key prefixes. |
| `GET /rest/v1/` (OpenAPI listing) | 401 "Only the service_role API key can be used". The schema is not listed. |
| `GET /rest/v1/scenarios` | 200 `[]`, `Content-Range: */0`. No private rows visible (and no public rows exist yet). |
| Insert with someone else's `user_id`, or with none (anon JWT and publishable key) | 401 `42501 new row violates row-level security policy` |
| PATCH a single ID | 200 `[]`; no rows can be seen, so none were changed |
| Other table names (profiles, users, visitors, presence, comments, votes, settings…) | 404 PGRST205: not exposed |
| `/graphql/v1` | pg_graphql is not enabled |
| `GET /storage/v1/bucket` | `[]`: no buckets visible to anon |
| `/auth/v1/settings` | email only, `disable_signup:false`, `mailer_autoconfirm:false`, anonymous users off |

The policies in `supabase/schema.sql` are correct. The UPDATE policy has no `WITH CHECK`, and Postgres
then reuses `USING`, so a user cannot change `user_id` to someone else. Remaining low-risk points:

- `public = true` rows can be read and listed by anyone, together with `user_id` and `data`. The app shares
  by link and never reads public rows, so you could drop `or public` or expose public rows through a view
  without `user_id`.
- `data jsonb` has no size limit, so a signed-in user can store large rows. Add
  `check (pg_column_size(data) < 32768)`.
- Sign-up is open and magic links go to any address, so the endpoint can be used to send emails. Turn on
  CAPTCHA (Turnstile or hCaptcha) in Auth settings and keep the default email rate limits.
- Check the Auth "Redirect URLs" allow-list: `emailRedirectTo` is built from `location` and should be
  limited to the production domain and localhost.
- If the Vercel Supabase integration was installed, it also creates server-side variables such as
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` and `POSTGRES_PASSWORD`. They are not in the bundle,
  because `envPrefix` limits the bundle to `VITE_`/`NEXT_PUBLIC_`. A static site does not need them, so
  removing them from the Vercel project is safer. Not verified: I did not read Vercel environment values.

Defensive SQL (proposal):

```sql
alter table public.scenarios add constraint scenarios_data_size check (pg_column_size(data) < 32768);
drop policy if exists "own scenarios: update" on public.scenarios;
create policy "own scenarios: update" on public.scenarios for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## L2 (Low): dependencies

`npm audit`: 3 vulnerabilities, all in tools that never ship to visitors.
- `vite 6.0.7`, rated high by audit: dev-server only. Includes file read via the dev-server WebSocket
  (GHSA-p9ff-h696-f583), several `server.fs.deny` bypasses, and launch-editor issues on Windows.
  It matters while `npm run dev` is running on this Windows machine. Fix: `vite@^6.4.5`
  (`npm audit fix --force` would install 6.4.5, which is still a 6.x minor update).
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99): dev server, fixed by the vite update.
- `fflate 0.8.2` (GHSA-px8p-9vwx-vf98): `unzipSync` can loop forever on a malformed ZIP64 file. It is
  used by the sync scripts on downloaded ZIP/XLSX files, so the worst case is a CI job hanging until its
  timeout. Fix: `fflate@^0.8.3` (`npm audit fix`).
- Outdated without known CVEs: supabase-js 2.118.0 → 2.119.0, d3-geo 3.1.1 → 3.1.2, plus major versions
  of typescript, vite and node-html-parser.

## L3 (Low): Realtime Presence

Any client with the public key can join the `visitors` channel and send any presence payload, so the
"people here now" count and per-department counts can be inflated. The rendering is safe: counts go
through `textContent` and department codes are only used as map keys. Optional fix: enable Realtime
Authorization (private channels) or treat the count as approximate.

## L4 (Low): functional test of the live site

All 18 routes were loaded in Chromium (Playwright) at 1280px and 375px, without signing in.

| Route | Result |
|-------|--------|
| `#/` | renders; `/favicon.ico` 404 on every first load (add a favicon) |
| `#/explorer`, `#/explorer/84` | render; `#/explorer/84` pulls 1.16 MB of GeoJSON from geo.api.gouv.fr (contours for the whole department). Consider simplified geometry or a precomputed simplified file. |
| `#/ville/84007` | renders the header, but `/data/communes/84007.json` returns 404: `public/data/communes/` is untracked and not deployed yet |
| `#/elus`, `#/2027` | no route live: show the home page (fixed by the unpushed `4cac2d0`) |
| `#/assemblee` | OK |
| `#/assemblee/deputes` | at 375px the page is 446px wide: the tab links and `.page-head`/`h1` overflow |
| `#/assemblee/composition` | at 375px the page is 387px wide: same tab row |
| `#/circo/8401`, `#/depute/PA841067`, `#/fil`, `#/resultats`, `#/resultats/bascules`, `#/histoire/1981`, `#/simulateur` | OK, no console errors, no broken images |
| `#/sondages` | at 375px the page is 371px wide: the polls `table.table` overflows (wrap it in `overflow-x:auto`); the anchor tab row also overflows |
| `#/sources` | renders. `networkidle` timed out once at 45s; a second run had no pending requests, so this is probably the open Realtime WebSocket |

Other notes:
- Mobile overflow is mainly the horizontal tab rows (`nav.tabs` / anchor links). Fix:
  `.tabs { overflow-x: auto; flex-wrap: nowrap; }`, or allow them to wrap.
- Large static files: `data/an/scrutins.json` is 2.55 MB raw but 212 KB over the wire (brotli), and
  `data/history/legislative/shifts.json` is 1.14 MB raw, 312 KB over the wire. Both are acceptable;
  `/assets/*` could get `immutable` caching (included in the `vercel.json` above).
- Malformed simulator state renders `NaN` in SVG attributes (console errors) instead of being rejected;
  fixed by H1.
- No `javascript:` links were found in the rendered DOM on any route.
- Unrelated to security: `.playwright-mcp/` (browser test output) sits in the repo root and is not in
  `.gitignore`. Add it.

## OK: secrets

- Working tree (outside `node_modules`), including `.claude/worktrees/*`, `data/`, `public/data/`, `dist/`:
  `ANTHROPIC_API_KEY` appears only as a variable name. There are no `sk-ant-`, `sb_secret_`, `ghp_`/`github_pat_`,
  AWS or Vercel tokens, private keys, or service-role keys.
- Full history (`git log -p --all`, 40 commits): no matches for those patterns. No `.env` file has ever
  been committed (only `.env.example`, which is empty).
- `.gitignore` covers `.env`, `.env.local`, `node_modules`, `dist` and `.cache`. Suggest adding `.env.*` with
  `!.env.example`, plus `.playwright-mcp/`.
- Live site: `/.env`, `/.env.local`, `/.git/config`, `/package.json`, `/src/main.ts`, `/data/usage/...`,
  `/supabase/schema.sql` and `*.js.map` all return 404. The bundle holds only the three `NEXT_PUBLIC_SUPABASE_*`
  values (URL, anon JWT, publishable key), which are public by design. Sample `/data/*.json` files contain
  no secrets.
