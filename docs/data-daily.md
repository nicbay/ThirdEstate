# Data: the daily brief ("Le point du jour")

`scripts/daily-brief.ts` (`npm run sync:daily`), run once a day by `.github/workflows/sync-daily.yml` (06:05 UTC).
Shown at the top of `#/sondages` (`#/sondages#point`) and, in short form, on the homepage (`src/views/daily.ts`).

## What it says

Three readings of the 2027 race, kept apart because they do not measure the same thing:

| Reading | Figure | Source |
|---------|--------|--------|
| Polls | first-round polling average, in % (`average()` in `src/lib/polls.ts`, the site-wide one) | `public/data/polls/2027.json` |
| Kalshi | probability of winning the election, in % | market `KXFRENCHPRES` |
| Polymarket | probability of winning the election, in % | event `next-french-presidential-election` |

For each candidate (the ten highest on any reading, at least 2): today's value, the change over 24 hours and over
seven days, in points.

## Files

- `public/data/daily/latest.json`: today's brief (`Brief` in the script).
- `public/data/daily/history.json`: one snapshot a day (`polls`, `kalshi`, `poly`, and the polls known that day).
  Changes are measured against these snapshots. A day with no snapshot in the last eight is filled from each
  platform's daily closing prices (`scripts/lib/market-history.ts`); for polls, the average is replayed with the
  polls whose fieldwork had ended, since publication dates are not recorded.

Both are read live from GitHub by the site (`LIVE` in `src/data.ts`) and do not trigger a deployment
(`scripts/vercel-ignore.sh`). Polls and markets themselves are refreshed every hour by `sync-live.yml`; the brief's
poll list is read from that hourly file, so a poll appears on the page within the hour, before the next brief.

## Rules

- **A move is notable** from 1 point in 24 hours or 2 points in seven days on a market, 0.5 and 1 point on the polling
  average. Below that the brief says nothing moved.
- **"What could have played a part"** lists up to three headlines per candidate from the red/blue feed
  (`public/data/feed/latest.json`): one per story, from an article whose title names the candidate, over the period
  of the move (2 days, or 7 for a weekly move), most-covered stories first. They are linked and attributed.
  They are context, never a stated cause: a thinly traded market can move on one large order, and the polling
  average also moves when an old poll leaves the window. The page says so next to the list.
- **The numbers are computed by the script.** The default summary is a template that restates them.
- **Claude (Haiku, shared monthly budget, `scripts/lib/claude.mjs`)** may reword the summary when at least one
  candidate moved. It receives only the figures and headlines of the brief. Its answer is kept only if it is
  valid JSON, of plausible length, and every number in it is one it was given; otherwise the template stays.
  The page states which of the two wrote the summary. `--no-ai` never calls it.
- Same tone as the rest of the site: descriptive, no adjective about a candidate, no prediction.
