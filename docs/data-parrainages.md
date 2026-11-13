# Data: presidential sponsorships (`public/data/2027/parrainages*.json`)

`scripts/sync-parrainages.mjs` tracks who has the 500 sponsorships ("parrainages") from elected officials needed to
stand for president. During the collection window the Conseil constitutionnel publishes the sponsorships it has
validated, several times a week, as open data; the script aggregates that list per candidate and checks the spread
rule. Before the window opens there is no official data: the script writes `status: "not-open"` and exits 0.
Page: `#/2027/parrainages` (`src/views/parrainages.ts`).

```
npm run sync:parrainages                    # 2027 (or "not-open"); builds the 2022 reference if it is missing
node scripts/sync-parrainages.mjs --reference                     # rebuild the 2022 reference
node scripts/sync-parrainages.mjs --source <url|file> --out x.json  # parse any list, e.g. to test a new format
PARRAINAGES_URL=<url> npm run sync:parrainages                    # force the 2027 source once it is announced
```

No API key, no AI step, no new dependency (`scripts/lib/csv.mjs`). About one second.

## The rule

Loi n° 62-1292 du 6 novembre 1962, art. 3: at least 500 sponsors among the eligible elected officials (mayors,
deputy mayors of associated communes, MPs, senators, French MEPs, regional and departmental councillors, councillors
of Paris, Lyon metropolis, Corsica and the overseas assemblies, presidents of intercommunal bodies, elected members of
the Assemblée des Français de l'étranger and presidents of consular councils). They must be elected in at least 30
departments or overseas collectivities, and no more than a tenth of them in the same one. Each official sponsors one
person only, and every sponsorship counts, even for someone who is not running.

## Files

| File | Size (2026-11-13) | What |
|---|---|---|
| `public/data/2027/parrainages.json` | 1 KB (not open) | 2027: `status: "not-open"` until the Conseil publishes, then the aggregated list |
| `public/data/2027/parrainages-2022.json` | 80 KB | 2022 final list (7 March 2022): 13,427 sponsorships, 64 people, 12 candidates |

### Common fields

```json
{
  "year": 2027,
  "status": "open",                   // "not-open" | "open" (2027) ; "final" (2022)
  "fetchedAt": "2027-02-09T21:30:12Z",  // time of the run (ignored by scripts/data-changed.mjs)
  "updatedAt": "2027-02-09",          // latest publication date found in the list; null when not open
  "source": { "name": "Conseil constitutionnel", "url": "…", "dataset": "…", "lastModified": "…" },
  "window": { … },                    // calendar, see below
  "rules": { "threshold": 500, "minDepartments": 30, "maxShare": 0.1 },
  "totals": { "sponsorships": 13427, "candidates": 64, "reached500": 12, "qualifiedOnPublishedData": 12 },
  "publications": ["2022-02-01", "2022-02-03", "…"],   // the Conseil's publication dates, oldest first
  "candidates": [ … ]                 // sorted by total, highest first
}
```

When `status` is `"not-open"` there is no `totals` / `publications`, `candidates` is `[]`, `source.url` is `null`,
`source.checked` lists the URLs tried, and `reference` points to the 2022 file.

### `candidates[]`

```json
{
  "name": "LE PEN Marine",            // as published by the Conseil: SURNAME First name
  "displayName": "Marine Le Pen",     // rebuilt from it (surname = the leading upper-case words)
  "total": 622,
  "departments": 101,                 // distinct "Département" values among the sponsors
  "topDepartment": { "name": "Pas-de-Calais", "count": 28, "share": 0.045 },
  "rule": { "reached500": true, "departments30": true, "share10": true },
  "qualifiedOnPublishedData": true,   // all three
  "reached500On": "2022-03-01",       // publication on which the running total first reached 500 (null if never)
  "byDate": [["2022-02-01", 12], ["2022-02-03", 40], …],   // running total after each publication that added some
  "byMandate": { "maire": 292, "conseiller-regional": 241, … },
  "byDepartment": { "Pas-de-Calais": 28, "Nord": 25, … }
}
```

`byMandate` keys group the published "Mandat" labels (masculine and feminine forms together): `maire`,
`maire-delegue`, `maire-arrondissement`, `conseiller-departemental`, `conseiller-regional`, `conseiller-paris`,
`conseiller-metropole-lyon`, `assemblee-corse`, `outre-mer` (members and presidents of overseas assemblies and
governments), `depute`, `senateur`, `depute-europeen`, `president-epci`, `afe`, `conseil-consulaire`. An unknown
label is counted as `autre` and printed as a warning by the script (none in 2022).

The page maps `displayName` to the site's candidate pages through `public/data/candidates/index.json` (accent- and
case-insensitive match on `name` / `pollName`); people not in the index are shown without a link.

### `window`

2027 (`parrainages.json`), checked on 2026-11-13:

| Field | Value | Basis |
|---|---|---|
| `firstRound`, `secondRound` | 2027-04-18, 2027-05-02 | set by the Conseil des ministres on 1 July 2026 (`roundsDecided`) |
| `opens` | `null` | the day after the decree convening the voters is published; not published yet |
| `opensExpected` | late January – early February 2027 (text) | 2022: decree of 26 January, collection from 27 January |
| `deadline` | 2027-03-12, 18:00 | sixth Friday before the first round (loi de 1962, art. 3) |
| `listBy` | 2027-03-26 | the list of candidates is published at the latest on the fourth Friday before the first round |

Fill in `opens` in `WINDOW_2027` once the decree is out. 2022 (`parrainages-2022.json`): `opened` 2022-01-27,
`deadline` 2022-03-04 18:00, `list` 2022-03-07, `firstRound` 2022-04-10.

## Sources and licence

- **2022**: Conseil constitutionnel,
  `https://presidentielle2022.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv` (final list, identical to
  the 7 March 2022 file of the data.gouv.fr dataset
  [Parrainages des candidats à l'élection présidentielle française de 2022](https://www.data.gouv.fr/datasets/parrainages-des-candidats-a-lelection-presidentielle-francaise-de-2022),
  used as fallback). Licence on data.gouv.fr: "Other (Public Domain)". Format: UTF-8 CSV, `;`-separated, quoted
  fields, one row per sponsorship:
  `Civilité;Nom;Prénom;Mandat;Circonscription;Département;Candidat;"Date de publication"`, dates `DD/MM/YYYY`.
  The same list exists as JSON (`parrainagestotal.json`: `Civilite, Nom, Prenom, Mandat, Circonscription,
  Departement, Candidat, DatePublication` with ISO dates) and XLSX.
- **2027**: no URL announced (2026-11-13; `presidentielle2027.conseil-constitutionnel.fr` does not resolve). The script
  tries, in order: `PARRAINAGES_URL`; a dataset whose title contains "parrainage" and "2027" in the Conseil
  constitutionnel organisation on data.gouv.fr (`540f9a01a3a72928898af4a3`, API `/api/1/datasets/?organization=…`),
  taking its newest CSV or JSON resource; then the 2022 address transposed to 2027 (a guess, used only if it answers
  with something other than HTML).

The parser is driven by the header (CSV with `;` or `,`, or a JSON array), matching columns by name without accents or
case (`Candidat`, `Département`/`Departement`, `Mandat`, `Date de publication`/`DatePublication`), so a reordered or
lightly renamed column still parses. 2027 is the first election where sponsorships can be sent electronically; if
the published format changes beyond that, the script exits 1 and keeps the previous file, so the workflow fails
visibly.

The names of the sponsoring officials are not copied into the site's files: only counts per candidate.

## Limits

- The spread check uses the "Département" column as published. The Conseil already groups some sponsors under one
  heading ("Français de l'étranger", "Parlement européen", overseas collectivities); each published value is treated
  as one unit. The check is on all published sponsorships, so it is indicative: only the Conseil's list of candidates
  is authoritative. In 2022 it matched exactly (12 qualified on the published data, 12 on the ballot).
- Only validated sponsorships are published; the forms received but not yet checked are not.
- `reached500On` is the publication date, not the date the 500th form arrived.

## Automatic refresh

`.github/workflows/sync-parrainages.yml`, daily at 21:30 UTC (the Conseil published in the evening in 2022). Until
the window opens the run is a no-op: only `fetchedAt` changes and `scripts/data-changed.mjs` skips the commit.
While open, each new publication is committed (`data: sync parrainages (date)`). The site reads the files deployed
with it (they are not in the `LIVE` list of `src/data.ts`), so each such commit triggers a Vercel deployment
(`scripts/vercel-ignore.sh`), at most once a day. To show updates without deploying, add `2027/parrainages` to
`LIVE` and `public/data/2027/parrainages.json` to the exclusions of `scripts/vercel-ignore.sh`.
