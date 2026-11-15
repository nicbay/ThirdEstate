# Pollster ratings

`npm run sync:pollster-ratings` (script: `scripts/sync-pollster-ratings.mjs`, table helpers: `scripts/lib/wiki-polls.mjs`).

Outputs:

- `public/data/polls/history/<election-id>.json`: every poll parsed from the election's Wikipedia table, plus the result: `{ id, source, resultSource, result: {name: pct}, polls: [{pollster, start, end, sample, url, values}] }`.
  - Presidential `values` are keyed by candidate name, the same names as in the site's result files.
  - Other elections are keyed by the table's column label. When one cell spans several columns, its key is `"A + B"`.
  - `result` is keyed by comparison unit (see Method), so a merged unit appears as `"A + B"`.
- `public/data/polls/pollsters.json`: grades, per-election history and methodology for every firm. Firms that polled 2027 but were never rated get `grade: null` and an empty history. The front end gives them weight 0.6.

## Sources

| Election | Poll table | Result |
|---|---|---|
| Presidential 2002–2022, rounds 1 and 2 | en.wikipedia "Opinion polling for the <year> French presidential election" | `public/data/history/presidential/<year>.json`, built from fr.wikipedia and the Conseil constitutionnel. It is cross-checked against the result row of the Wikipedia poll table, and differences over 0.05 pt are logged. |
| European 2009, 2014, 2019 | en.wikipedia "Opinion polling for the <year> European Parliament election in France" | The official-result row ("<year> election") at the top of the same poll table |
| European 2024 | Poll table inside en.wikipedia "2024 European Parliament election in France". There is no separate polling article. | The "Results" table of the same article. Ten lists of 2% or more are matched to poll columns by name (RN, Ens., PS–PP, LFI, LR, EELV, REC, PCF, AR, PA). |
| Legislative 2017, 2022, 2024, first round | en.wikipedia "Opinion polling for the <year> French legislative election" | The official-result row of the poll table ("2017 election" / "Ministry of the Interior"). The far-right figure is cross-checked against `public/data/history/legislative/<year>.json`. |

Why legislative results don't come straight from the site's files: those files hold nuance and bloc totals (XG/G/C/D/XD…), which don't line up with the party and alliance columns pollsters publish. The table's own result row uses the same columns as the polls.

The English tables parsed cleanly for every election listed, so they are the only source used. The French "Liste de sondages…" pages were not compared poll by poll. Adding them as a cross-check, or to fill in firms the English tables lack, is possible future work.

Each poll's `url` is the external link Wikipedia cites for that row (the pollster's or the outlet's page), or `null`.

## Method

The same text is in `pollsters.json` → `method` (fr/en).

1. **Final poll.** For each election and firm, take the latest poll whose fieldwork ends in the 14 days before the vote.
   - Polls ending on election day itself (exit polls, 20:00 estimates) are excluded.
   - When one poll tests several line-ups, its first row is used.
   - A final poll is dropped if its figures add up to less than 80 or more than 110. That is a guard against misparsed rows; none were dropped on the last run.
2. **Comparison units.** Presidential units are the candidates. In other elections a firm, or the result row, sometimes reports several lists as one figure (a cell spanning columns: "ENS + DVC", "UMP + NC"). In that case those columns are merged into one unit for every firm in that election, so all firms are scored on the same units.
3. **Error.** The mean absolute error, in points, over units that won at least 2% of the vote.
4. **Relative score.** The firm's error minus the average error of all firms in that election.
5. **Overall score.** A weighted mean of relative scores, multiplied by n/(n+2), where n is the number of elections rated.
   - Weights: presidential first round 1, every other election 0.6.
   - Recency: each election is also weighted 0.85^((2024 − year)/5), so a five-year cycle further back counts 15% less.
   - Negative is better than the field.
6. **Information only, not graded:**
   - `mae`: plain mean of the firm's errors.
   - `elections`: number of elections rated.
   - `polls`: number of polls the firm published in the scored 14-day windows.
   - `biasFarRight`: mean over elections of (poll − result) for RN/FN and Reconquête combined. In 2022 legislative this is the "REC EXD" column. In 2024 legislative the "RN and allies" alliance includes Ciotti's LR-UXD candidates, because most firms reported it as one figure.

### Grade thresholds (score, in points)

| Grade | Score | Weight |
|---|---|---|
| A+ | < −0.30 | 1.0 |
| A | −0.30 to −0.20 | 0.95 |
| A- | −0.20 to −0.12 | 0.9 |
| B+ | −0.12 to −0.05 | 0.85 |
| B | −0.05 to 0.05 | 0.8 |
| B- | 0.05 to 0.12 | 0.75 |
| C+ | 0.12 to 0.20 | 0.65 |
| C | 0.20 to 0.30 | 0.6 |
| C- | 0.30 to 0.45 | 0.55 |
| D | 0.45 to 0.65 | 0.4 |
| F | ≥ 0.65 | 0.2 |

Intervals include their lower bound. Three overrides apply:

- **A+** needs at least 4 elections, at least 75% of them better than the field. Otherwise the firm is capped at A.
- **F** needs at least 3 elections, at least 75% of them worse than the field. Otherwise the firm is capped at D.
- **One election** keeps a firm between B+ and C-.

## Pollster name merges

Names go through the same rule as `pollsterName()` in `src/lib/polls.ts`: a name that equals a known firm, or starts with it followed by a space or punctuation, maps to that firm. That covers "Ipsos-Sopra Steria" → Ipsos, "Ifop-Fiducial" / "Ifop/Hexagone" / "Ifop for DLF" → Ifop, "OpinionWay-Kéa" → OpinionWay, "Harris-Interactive" → Harris Interactive and "Elabe BFMTV" → Elabe.

The lineages below are merged on top of that rule (`LINEAGE` in `wiki-polls.mjs`):

- **Sofres, TNS Sofres, Kantar Sofres, Kantar Public, Kantar → Verian.** Sofres (1963) became TNS Sofres, then Kantar TNS / Kantar Public, and was renamed Verian in November 2023. Sources: https://fr.wikipedia.org/wiki/Kantar_TNS and https://www.veriangroup.com/press-release/kantar-public-rebrands-globally-to-become-verian. Verian is the name in the 2027 poll file.
- **Toluna Harris Interactive → Harris Interactive.** Harris Interactive France has been part of Toluna's group since 2014 and now files notices as "Toluna Harris Interactive". Source: https://fr.wikipedia.org/wiki/Harris_Interactive
- **Louis Harris → LH2.** Louis Harris France was renamed LH2 in 2005. It is *not* merged with Harris Interactive: there is no corporate link, only the trademark. Source: https://fr.wikipedia.org/wiki/Louis_Harris_2

Firms kept separate:

- **BVA.** Its own record runs through 2024. Ipsos bought BVA in 2025 and Ipsos France now trades as "Ipsos bva" (https://www.ipsos.com/fr-fr/node/1050436), but BVA's historical polls were BVA's own method, so they are not credited to Ipsos.
- **CSA**, **Odoxa**, **Cluster17**, **YouGov**, **AtlasIntel** and **Le Terrain**.

## Methodology per firm

These facts come from the technical notices each firm files with the Commission des sondages (https://www.commission-des-sondages.fr/notices/), mostly from autumn 2026. The `url` field links the notice that was read.

- Every rated firm still active files notices; French law requires one for each published election poll.
- Odoxa's notice doesn't state the survey mode. "By internet" comes from Public Sénat's write-up.
- CSA's sample size is taken from a political poll, not a voting-intention poll.
- `methodology` is `null` for BVA (absorbed into Ipsos), LH2 (defunct), AtlasIntel and Le Terrain, because nothing was sourced for them.

## Known gaps

- **Not covered:** presidential elections before 2002, the 2004 European election, legislative elections before 2017, and legislative second rounds, which are mostly seat projections.
- **2002 run-off:** only 3 firms polled Chirac–Le Pen in the last fortnight.
- **Legislative first rounds:** units follow each table's party/alliance columns, which change from one election to the next.
- **2024 European:** results are matched to poll columns by a hand-written name map, checked at run time. A missing match is logged.
- **Recent firms:** Cluster17 has 5 elections, YouGov 5 and AtlasIntel 2, so their scores are shrunk toward 0 accordingly.
- **Final-poll rule:** a firm's final poll is its latest in the window, not its best one. A firm that stopped polling more than 14 days before the vote isn't rated for that election.
- **Dependence on Wikipedia:** every figure comes from Wikipedia's tables (CC BY-SA 4.0). A transcription error there carries through.
