# Communes ("my neighbourhood") — data

One JSON file per French commune (INSEE COG 2026, 34,875 communes) and per municipal arrondissement of Paris, Lyon and Marseille (45),
plus a search index and a source registry.

```bash
node scripts/sync-communes.mjs                       # full build: every source part, then all files
node scripts/sync-communes.mjs --only=rne,dvf        # rebuild only these parts, reuse the others from .cache/communes/parts/
node scripts/sync-communes.mjs --assemble            # only rewrite the files from the cached parts (seconds)
node scripts/sync-communes.mjs --codes=84007,75104   # write only these commune files (for checks)
node scripts/sync-communes.mjs --refresh             # ignore the download cache
```

Parts: `base`, `districts`, `rne`, `monuments`, `museums`, `libraries`, `sports`, `apl`, `fibre`, `dvf`, `wikidata`, `wikipedia`.
`museums` needs `base`; `wikipedia` needs `wikidata`. Needs Node 24, no API key, no new dependency (fflate is used through `scripts/lib/xlsx.mjs`).
Downloads (~350 MB) are cached in `.cache/communes/` (gitignored) and reused for 7 days (DVF 30 days). Without the Wikimedia
parts a full build takes ~4 minutes (most of it writing 34,920 files).

**Wikimedia is incremental.** Wikimedia rate-limits anonymous API clients per IP (observed on 2026-11-07: about 10 requests a minute
across Commons and Wikipedia, then HTTP 429). The script therefore makes one request every 6.5 s, stores every answer per item in
`.cache/communes/commons-items.json` and `wikipedia-items.json`, handles communes by population (largest first) and stops after
`--wiki-budget=N` requests per part (default 300 ≈ 35 min). Covering everything takes ~540 Commons requests (50 files each) and
~1,750 Wikipedia requests (20 articles each), i.e. several runs:

```bash
node scripts/sync-communes.mjs --only=wikidata,wikipedia --wiki-budget=300   # repeat until sources.json shows pendingFiles/pendingArticles = 0
```

Communes not fetched yet carry `image` / `wikipedia` = `unavailable` with a "not fetched yet" reason.
`public/data/districts/` must be built first (`scripts/sync-district-profiles.mjs`): crime, census, income, local spending,
schools, population and district shares are taken from it, not downloaded again.

Suggested cadence: monthly (RNE is updated a few times a year, ARCEP quarterly, DVF twice a year, the rest yearly).

## Files

| File | Content |
|---|---|
| `public/data/communes/<code>.json` | one file per commune / arrondissement (`"84007"`, `"2A004"`, `"97101"`, `"75104"`) |
| `public/data/communes/index.json` | compact search index (rows of `columns`) |
| `public/data/communes/sources.json` | source registry (`sources[key]`: name, url, file, licence, year/period, method) and indicator `definitions` (crime labels, spending items…), build `coverage` and `failures` |

## Principles

- **Every block names its source** with `source: "<key>"`; the key's entry in `sources.json` gives the dataset page (`url`), the exact file (`file`),
  the licence and the year or period. Blocks also carry their own `year` / `period`. (The registry is separate to keep each commune file small:
  repeating the source texts would add ~3 KB × 35,000 files.)
- **Nothing is invented.** Each block has `status: "ok"` or `status: "unavailable"` + `reason`; schools may be `"empty"`.
  Values published at a coarser level are labelled (`level: "city"`, `department…`).
- Only public-role data on elected officials: name, function, start of mandate/function. Birth date, sex, profession and nationality,
  which the RNE also publishes, are **not** kept.
- Every image comes with its Commons file page, author and licence; every Wikipedia text with its page URL, revision and licence.
- Files are minified; typical size 5–12 KB, largest ~17 KB (Marseille). Lists are truncated with `truncated: <n more>`.

## `index.json`

```jsonc
{ "generated": "2026-11-07", "schemaVersion": 1,
  "columns": ["code", "name", "postcodes", "department", "districts", "population", "lon", "lat", "parent"],
  "rows": [ ["84007", "Avignon", "84000 84140", "84", "8401", 92188, 4.8333, 43.9416, ""],
            ["75104", "Paris 4e Arrondissement", "75004", "75", "7507", 27332, 2.3554, 48.8543, "75056"], … ] }
```

`postcodes` and `districts` are space-separated strings (several districts for split communes; district codes match `public/data/districts/<code>.json`).
Centroids are geo.api.gouv.fr's commune centres. Paris/Lyon/Marseille appear as the city **and** each arrondissement.

## Commune file schema (`<code>.json`)

```jsonc
{
  "code": "84007", "name": "Avignon", "type": "commune",            // or "arrondissement"
  "generated": "2026-11-07", "schemaVersion": 1,
  "department": { "code": "84", "name": "Vaucluse" }, "region": { "code": "93", "name": "Provence-Alpes-Côte d'Azur" },
  "postcodes": ["84000", "84140"], "centroid": [4.8333, 43.9416],    // [lon, lat]
  "population": { "value": 92188, "year": 2023, "source": "population" },
  "districts": [ { "code": "8401", "share": 1 } ],                 // share of the commune in each legislative district
  "parent": { "code": "75056", "name": "Paris" },                  // arrondissements only
  "arrondissements": [ { "code": "75101", "name": "…" } ],         // Paris, Lyon, Marseille only
  "cantons": [ { "code": "8402", "name": "Avignon-1" }, … ], "cantonsMethod": "…",
  "elected": { … }, "assets": { … }, "health": { … }, "broadband": { … }, "property": { … }, "local": { … }, "media": { … }
}
```

### `elected` — Répertoire national des élus (`source: "rne"`)

Ministère de l'Intérieur, data.gouv.fr dataset `5c34c4d1634f4173183a64f1` (files: municipal, mayors, arrondissement, departmental,
regional councillors, senators, members of single assemblies). `updated` = file date.

| Key | Content |
|---|---|
| `mayor` | `{ name, since }` (start of the function). Arrondissements: the city's mayor, `level: "city"`. |
| `council` | municipal council `{ count, list: [{ name, role? }] }` — mayor, adjoints by rank, then councillors alphabetically; ≤ 70 listed. Arrondissements: the city council (`level: "city"`). |
| `arrondissementCouncil` | arrondissements only: the sector's council from the RNE arrondissement file (mayor of the arrondissement first). Paris 1er–4e share the "Paris Centre" sector; Marseille sectors group two arrondissements. The RNE file lists only arrondissement councillors who are not also city councillors. |
| `departmental` | `{ cantons: [{ code, name, councillors: [{ name, role? }] }], president }`. Unavailable for Paris, the Métropole de Lyon, Corsica, Martinique, Guyane (no departmental council). |
| `regional` | `{ region, count, president, section: { code, name, count, list } }` — the councillors elected in the department's section of the regional list (≤ 40 listed). Corsica, Martinique, Guyane: `{ assembly, count, president, executivePresident, list }` (members of the single assembly). |
| `metropole` | Métropole de Lyon communes: `{ name, count, president }` (members are elected in metropolitan constituencies; no commune → constituency table is available, so they are not listed per commune). |
| `senators` | senators of the department `{ count, list: [{ name, since }] }`. |
| `partyAffiliation` | always `unavailable`: the RNE publishes no list or political nuance, and none is added. |

Names are written as published (first name + surname in capitals). Communes split between cantons (COG pseudo-canton) get the cantons
whose *bureau centralisateur* is the commune — a canton covering part of the commune but centralised elsewhere is missed (stated in `cantonsMethod`).

### `assets`

| Key | Source | Content |
|---|---|---|
| `monuments` | `merimee` — Ministère de la Culture, Immeubles protégés au titre des Monuments historiques (Mérimée) | `count`, `classe`, `inscrit`, `list` (≤ 10: `{ ref, name, level, partial? }`, notice `https://pop.culture.gouv.fr/notice/merimee/<ref>`), `truncated`. Located by the INSEE code of the notice (converted to COG 2026). "Notable" order = classé before inscrit, whole before partial protection, named before generic titles ("Immeuble", "Maison"), then alphabetical — not a ranking of merit. Cross-reference notices are skipped. Lyon and Marseille: most notices are coded to the city, so arrondissement files show few and give `cityLevel.count`. |
| `museums` | `museofile` — Répertoire des Musées de France (Muséofile) | `count`, `list` (≤ 10: `{ id, name, url? }`). Only the ~1,200 museums with the official *Musée de France* label. The file has no INSEE code: placed by postcode + town name, else by the nearest commune centre among the postcode's communes. |
| `libraries` | `libraries` — Ministère de la Culture (SLL), bibliothèques des collectivités territoriales | `count`, `list` (≤ 8 names). Open public premises only; county lending services excluded. Paris/Lyon/Marseille: city level only (arrondissement files are `unavailable` with the city count). |
| `sports` | `dataes` — Ministère des Sports, Data ES | `count` of sports equipments (not installations) and `families` (count by family, descending); out-of-service installations excluded. |
| `greenSpaces` | — | `unavailable`: no official commune-level indicator exists (only land-cover rasters, Corine Land Cover / OCS GE, which would need our own computation). |

### `health.gpAccess` — APL to general practitioners (`source: "apl"`)

DREES, *Accessibilité potentielle localisée (APL) aux médecins généralistes*, latest year in the file (2024).
`value` = consultations/visits accessible per standardised inhabitant per year; `under65` = counting only GPs aged 65 or under;
`national` = mean weighted by standardised population, computed here from the same file (DREES's recommended aggregation).
DREES publishes arrondissements for Paris/Lyon/Marseille (the city files are `unavailable`); no APL for Mayotte.
Communes merged after the file's geography get the standardised-population-weighted mean of their former communes (`method: "merged"`).
For context, DREES studies commonly use APL < 2.5 as a threshold of under-supply; `sources.json → apl.national` gives the population share below it.

### `broadband.ftth` — fibre (`source: "arcep"`)

ARCEP, *Le marché du haut et très haut débit fixe (déploiements)*, observatory xlsx, sheets *Communes* and *Arrondissements*, latest quarter.
`{ period, premises, ftth, share }` — `premises` = ARCEP's best estimate of premises (*locaux*), `ftth` = premises connectable to FttH,
`share = 100 × ftth / premises` (capped at 100).

### `property` — DVF (`source: "dvf"`, reference `officialFivePeriod.source: "dvfStats"`)

- `year` (latest full year of *DVF géolocalisées*, DGFiP via data.gouv.fr): `house` / `apartment` = `{ sales, medianPerM2 }`.
  **Computed here** from the raw file with the rules of Etalab's *Statistiques DVF*: sales, VEFA and auctions of exactly one house or apartment
  (outbuildings ignored); price/m² = sale value / built surface; > 100,000 €/m² dropped; median per commune (arrondissement in PLM; PLM cities pool their arrondissements).
  Reason: the official pre-aggregated *Statistiques DVF* file gives only monthly medians or a median over its whole period (10 semesters); a yearly median can't be derived from monthly medians.
- `officialFivePeriod`: the official whole-period medians and sales counts from *Statistiques DVF* (`stats_whole_period.csv`), as published.
- Medians on few sales are volatile: always show `sales`. Unavailable for Alsace-Moselle (57, 67, 68: Livre foncier) and Mayotte.

### `local` — reused from `public/data/districts` (see docs/data-district-profiles.md)

| Key | Source key | Content |
|---|---|---|
| `crime` | `crime` (SSMSI) | `values[key] = [count, rate per 1,000]` for published indicators (labels in `sources.json → definitions.crime`), `department.rates`. PLM arrondissements: whole-city figures (`level: "city"`). Unavailable when SSMSI does not publish the commune (secret statistique). |
| `unemployment` | `census` (INSEE census 2023) | `rate` (15–64, census definition); `departmentIlo` = ILO rate of the department, latest quarter (`source: "ilo"`). PLM cities: see arrondissements. |
| `income` | `filosofi` | `medianIncome` (€/year per consumption unit), `povertyRate` (%); null when withheld. Not covered: Guadeloupe, Martinique, Guyane, Mayotte. |
| `localSpending` | `ofgl` | commune accounts, € per inhabitant: `total`, `operating`, `investment`, `debt`, `stateTransfers` (definitions in `sources.json`). PLM arrondissements: city accounts. |
| `schools` | `schools` | `colleges`, `lycees`, `list` (≤ 15: `{ uai, name, type, sector, priorityEducation?, ips?, dnbSuccess?, bacGTSuccess?, bacProSuccess? }`). No ranking. |

### `media`

| Key | Content |
|---|---|
| `wikidata` | `{ qid, url }` — the item with this INSEE code (P374), excluding dissolved items (P576), preferring "commune of France"/"municipal arrondissement" items. |
| `image` | `source: "commons"`: `{ file, page, thumb (960 px), width, height, author, licence, licenceUrl }` from the Commons file page (P18 of the item). Only used when Commons returns a licence. Display with "© author, licence" and a link to `page`. |
| `wikipedia` | `source: "wikipedia"`: `{ title, url, revid, extract, licence: "CC BY-SA 4.0" }` — the first sentences (≤ ~600 characters) of the French article's introduction, long parentheticals removed. Attribute "Wikipédia, CC BY-SA 4.0" with a link to `url`. |

## Coverage (build of 2026-11-07, 34,920 files)

Exact counts of the last build are in `sources.json → coverage`. Total ≈ 199 MB of minified JSON (average 5.7 KB, largest 17.9 KB: Marseille); `index.json` 2.4 MB.

| Indicator | Files with a value (of 34,920) | Why the others have none |
|---|---|---|
| Mayor | 34,788 | not (yet) in the RNE: vacancy or unrecorded (e.g. Les Abymes) |
| Municipal council | 34,888 | idem |
| Departmental councillors | 34,371 | Paris, Métropole de Lyon, Corsica, Martinique, Guyane have no departmental council |
| Regional council / single assembly | 34,903 | Mayotte (no regional council) |
| Senators | 34,864 | Martinique and Guyane missing from the RNE senators file |
| Monuments historiques ≥ 1 | 16,219 | the others have none (count 0) |
| Musées de France ≥ 1 | 867 | idem (only labelled museums; 2 of 1,216 could not be placed) |
| Libraries ≥ 1 | 13,983 | idem (PLM arrondissements: city level only) |
| Sports equipment ≥ 1 | 28,401 | idem |
| APL (GPs) | 34,890 | PLM cities (per arrondissement only), Mayotte |
| FttH share | 34,920 | — |
| DVF median, houses / apartments | 30,384 / 7,267 | no qualifying sale in 2025 (or Alsace-Moselle, Mayotte) — `sales: 0` |
| Crime (some indicator published) | 34,903 | not published by SSMSI |
| Census unemployment | 34,889 | PLM cities (per arrondissement) |
| Income (Filosofi) | 34,800 | 4 overseas departments, PLM cities; poverty rate often withheld for small communes |
| Local spending (OFGL) | 34,813 | no accounts in OFGL |
| Collèges/lycées ≥ 1 | 4,243 | the others have none |
| Image (Commons, with licence) | 8,608 | **incremental**: 25,782 files still to fetch (see Wikimedia above) |
| Wikipedia intro | 1,520 | **incremental**: 33,400 articles still to fetch (largest communes done first) |

## Not available, and why

- **Political lists / nuances of local councillors**: not in the RNE (the Ministry publishes them with election results, by list, not per elected official). Not added.
- **Green spaces**: no official commune-level indicator.
- **Libraries per arrondissement** (Paris, Lyon, Marseille): the libraries file locates them at city level.
- **APL for Paris/Lyon/Marseille as a whole** and **census/income for the PLM cities**: published per arrondissement only in the sources used; no city figure is recomputed.
- **Senators of Martinique and Guyane**: absent from the RNE senators file at this date.
- **DVF** for Alsace-Moselle and Mayotte (outside DVF); **Filosofi** for four overseas departments; **APL** for Mayotte.
- **Legislative district** for 10 communes (`districts: []`): the six uninhabited "villages morts pour la France" of the Meuse (no voters)
  and four Cantal communes restored after 2024 (15031, 15035, 15047, 15171), absent from the 2024 polling-station results.
- **Métropole de Lyon councillors per commune**: no commune → metropolitan constituency table.
- Overseas collectivities (Saint-Pierre-et-Miquelon, Saint-Barthélemy, Saint-Martin, Wallis-et-Futuna, Polynésie, Nouvelle-Calédonie) are not communes of the COG list used and have no file.
