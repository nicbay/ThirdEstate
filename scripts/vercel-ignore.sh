#!/bin/sh
# Vercel "Ignored Build Step" (vercel.json → ignoreCommand). Exit 0 = skip this deployment, 1 = build.
#
# The sync bots commit polls, markets, the forecast, the red/blue feed and local news many times a day.
# The site reads those files live from GitHub (src/data.ts → fetchJson), so a commit that touches only
# them doesn't need a new ~360 MB deployment. Anything else (code, other data) builds as usual.
# If the previous deployed commit isn't in Vercel's shallow clone, git diff fails and we build (safe).

prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -z "$prev" ] && exit 1

if git diff --quiet "$prev" HEAD -- . \
  ':(exclude)public/data/markets.json' \
  ':(exclude)public/data/polls' \
  ':(exclude)public/data/forecast' \
  ':(exclude)public/data/feed' \
  ':(exclude)public/data/news' \
  ':(exclude)public/data/daily' \
  ':(exclude)data/feed' \
  ':(exclude)data/usage' 2>/dev/null; then
  echo "Only live data changed since $prev: skipping the deployment (the site reads it from GitHub)."
  exit 0
fi
echo "Code or bundled data changed since $prev: building."
exit 1
