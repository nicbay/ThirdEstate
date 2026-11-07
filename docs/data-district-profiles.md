# District profiles ("your district") — data

Local public data for each of the **577 legislative districts** (circonscriptions), aggregated from communes
(arrondissements in Paris, Lyon and Marseille) to the district, with the commune values kept for the UI.

```bash
node scripts/sync-district-profiles.mjs             # full build: ~300 MB downloaded, cached 20 h in .cache/district-profiles/
node scripts/sync-district-profiles.mjs --events    # refresh only public/data/districts/events/*.json (daily)
node scripts/sync-district-profiles.mjs --refresh   # ignore the download cache
node scripts/sync-district-profiles.mjs --no-events # skip the events step
```

Needs Node 24 and no API key; only `fflate` (already a dependency). No `package.json` script and no workflow were added.
Suggested cadence: full build monthly (sources change once or twice a year), `--events` daily.

## Build of 2026-11-07 at a glance

| Indicator | Latest data | Geography of the values | Districts with data (of 577) |
|---|---|---|---|
| Crime (15 offence types) | 2025 | commune (PLM: whole city) + department | 558 |
| Census unemployment 15–64 | census 2023 | commune / arrondissement | 556 |
| Localised ILO unemployment | 2026-Q2 | employment zone + department | 556 (554 with a zone-based rate) |
| Median standard of living, poverty rate | 2023 | commune / arrondissement | 546 |
| Local-authority spending per inhabitant | accounts 2025 | commune, intercommunal set, department, region | 558 (553 with an intercommunal figure) |
| State spending per inhabitant | — | not published below national level | 0 |
| Schools (14,807 collèges and lycées) | IPS 2025-26, DNB and bac 2025 | school | 564 (+ 2 with no school listed) |
| Events | next 60 days | point (coordinates) | 414 with at least one event |

Size: profiles 27 MB in total (largest 157 KB, many-commune rural districts), events 6.4 MB.
Check run on this build: for every district in France, the sum of polling-station *inscrits* matches the Ministry's official district total
within 75 voters (the bureau file is the definitive one, the district file the provisional one).

## Files

| File | Content |
|---|---|
| `public/data/districts/<code>.json` | one profile per district. Codes match `#/circo/<code>` and `geo/circo` (`"0104"`, `"2A01"`, `"97101"`, `"9901"`). |
| `public/data/districts/index.json` | district list, national distribution (median, deciles) of every district-level indicator, official national figures |
| `public/data/districts/events/<code>.json` | upcoming public events (next 60 days), refreshed separately so the profiles don't change every day |

## Principles

- **Only free official sources** (Ministère de l'Intérieur, SSMSI, INSEE, Éducation nationale, OFGL/DGFiP, ADN Tourisme).
  All are under the Licence Ouverte / Open Licence v2.0 (Etalab) except the 2024 candidates file, published by the
  Ministère de l'Intérieur on data.gouv.fr without an explicit licence (it is only used to tell which district a polling station belongs to).
- **Every indicator block carries** `source` (`name`, `url` of the dataset page, `licence`, and usually `file`, the exact file or API used),
  `year` (or `period`), `geo` (geography level of the underlying values) and `method` (the aggregation formula).
  Values inside a block (district and commune values) inherit these.
- **Nothing is invented.** When a source has no value the field is `null`; when a whole indicator is missing for a district,
  the block is `{ "status": "unavailable", "reason": "…" }`. Values that are an approximation say so in their name
  (`…Approx`, `…Estimated`) and in `method`.
- **No ranking.** Schools are listed with the ministry's own indicators; the ministry publishes no ranking and none is computed.

## Commune ↔ district correspondence

There is no current official commune → district table on data.gouv.fr (the Ministry's table dates from 2012/2017 and predates
hundreds of commune mergers). The script builds it from **official 2024 election results by polling station**
(Ministère de l'Intérieur, 1st round, 30 June 2024):

1. Each polling station row lists its commune, its number, its registered voters (*inscrits*) and its candidates.
   A candidate stands in one district only, so the station's district is found by matching its candidates (department + surname + first name)
   against the candidates-by-district file.
2. Weight of commune *c* in district *d*: `share(c,d) = inscrits of c's stations in d / inscrits of c`. 99 % of communes have share 1.
3. **Communes split between districts** (131 communes, e.g. Toulouse, Nice, Nantes, Montpellier, Rennes, Grenoble, Le Havre…) get one share per district.
   Values published for the whole commune are spread with that share, i.e. **the commune is assumed homogeneous** — stated in each `method`.
4. **Paris, Lyon, Marseille**: station numbers encode the arrondissement (`1203` → 12e; checked against INSEE's 2023 REU polling-station table),
   so the weights are computed per **arrondissement** (`75101`…`75120`, `69381`…`69389`, `13201`…`13216`). Arrondissements
   themselves can be split (e.g. Paris 15e, Marseille 13e) and get shares too.
   Sources that publish arrondissements (census, Filosofi, population) use them; sources that don't (crime, OFGL accounts) use the city as a whole.
5. All commune codes are converted to the **INSEE COG 2026** (merged communes follow `v_mvt_commune_2026`, delegated communes their parent),
   so every source lines up regardless of its geography vintage.
6. The district's population is `Σ share × population municipale` (INSEE populations de référence, 2023).

`geography.units[]` lists every commune/arrondissement with `share`, `pop`, `inscrits`, `parent` (city of an arrondissement) and
`splitWith` (other districts sharing it).

Limitations: shares use registered voters, not residents (good proxy for population shares; foreigners and minors are not registered).
District boundaries are the 2010 ones used since 2012 (unchanged for 2024).

## Profile schema (`<code>.json`)

```jsonc
{
  "code": "3102", "label": "2ème circonscription", "department": { "code": "31", "name": "Haute-Garonne" },
  "generated": "2026-11-07", "schemaVersion": 1,
  "geography": { "method": "…", "source": {…}, "population": 123456, "populationYear": 2023, "populationSource": {…},
                 "inscrits2024": 98765,
                 "units": [ { "code": "31555", "name": "Toulouse", "share": 0.21, "pop": 511684, "inscrits": 70000, "splitWith": ["3101", …] }, … ] },
  "indicators": {
    "crime":                 { … },
    "unemploymentCensus":    { … },
    "unemploymentQuarterly": { … },
    "income":                { … },
    "localSpending":         { … },
    "stateSpending":         { "status": "unavailable", "reason": "…" },
    "schools":               { … }
  },
  "events": { "file": "events/3102.json" }
}
```

Every block has `status`: `"ok"`, `"empty"` (schools only: the source has no school there) or `"unavailable"` (+ `reason`).

### 1. `crime` — SSMSI recorded crime

Source: SSMSI, *Base statistique communale de la délinquance enregistrée par la police et la gendarmerie nationales*
(data.gouv.fr dataset `621df2954fa5a3b5a023e23c`, latest year, COG 2026), plus the department base.

- `indicators`: `{ key: { fr, en, unit, per } }` — 15 commune-level offence types: `physicalViolenceFamily`, `physicalViolenceOther`,
  `sexualViolence`, `armedRobbery`, `violentTheft`, `theftFromPersons`, `burglary` (per 1,000 **dwellings**), `vehicleTheft`,
  `theftFromVehicles`, `vehicleAccessoryTheft`, `criminalDamage`, `drugUse`, `drugUseFixedFine`, `drugTrafficking`, `fraud`.
  Homicides are only published by department (see `department`).
- `district[key]`: `{ count, rate, coverage, rateEstimated }`
  - `count = Σ share × count` over communes whose figures are **published**;
  - `rate = 1000 × count / Σ share × population` (dwellings for burglary) of those communes;
  - `coverage` = share of the district's population (dwellings) behind `rate` (1 = every commune published);
  - `rateEstimated` = same over the whole district, counting for each unpublished commune the SSMSI's own published
    *average number of offences of unpublished communes in the department* (`complement_info_nombre`). It is an estimate built only from SSMSI figures.
- `communes[code][key]`: `[count, rate]` for published values only — a missing key (or missing commune) means "not published".
- `department`: the department base values `{ key: { count, rate } }` (includes `homicide`, `attemptedHomicide`).
- **Publication threshold (secret statistique)**: SSMSI publishes a commune's figure only if more than 5 offences were recorded in each of
  the last 3 years (and also publishes zeros that persist 3 years). Small communes are therefore mostly unpublished: rural districts have low `coverage`.
- Counts are by **place of the offence**, except `fraud`, counted at the **victim's residence**. Drug indicators count people charged (*mis en cause*).
- Paris, Lyon, Marseille: the commune base gives arrondissements only for drug indicators, so the **whole-city** figures are used for all indicators
  (every Paris district shows Paris's rate). Stated in `method`.

### 2. `unemploymentCensus` — census unemployment, commune level

Source: INSEE census 2023 (annual surveys 2021–2025), *Population active et chômage* `DS_RP_EMPLOI_LR_PRINC` via the free Melodi API.

- `district`: `{ rate, unemployed, labourForce }`, `rate = 100 × Σ share × unemployed(15–64) / Σ share × labour force(15–64)`.
- `communes[code]`: rate (%), arrondissements for PLM.
- Census unemployment is self-declared and is higher than the ILO rate; do not compare it with the quarterly rate.

### 3. `unemploymentQuarterly` — localised ILO rate (latest quarter)

Sources: INSEE *Taux de chômage localisés* — employment zones (xlsx on insee.fr/fr/statistiques/1893230, the latest file is found on the page) and
departments (BDM SDMX series `TAUX-CHOMAGE`). Quarterly average, seasonally adjusted.

- `zones.list[]`: employment zones (ZE2020) covering the district, `{ code, name, popShare, rate }`.
- `district.rate = Σ popShare × zone rate` — **a weighted mean of zone rates, computed here**; INSEE publishes no district rate.
- `department`: `{ code, rate, period }`.
- Not published for Mayotte (and French Guiana in the zone file); overseas collectivities (975, 977, 986–988) are outside INSEE's scope.

### 4. `income` — Filosofi

Source: INSEE Filosofi `DS_FILOSOFI_CC` (latest year, COG 2026), bulk CSV from the Melodi API.

- `district`: `{ medianIncomeApprox, povertyRateApprox, coverage, povertyCoverage }`.
  `= Σ share × population × commune value / Σ share × population` over communes with a value.
  **A population-weighted mean of commune medians is not the true district median** (INSEE does not publish one); the poverty rate
  computed this way is close to exact (rates are over people in fiscal households, close to population).
- `communes[code]`: `[medianIncome (€/year per consumption unit), povertyRate (%)]` — order given in `columns`.
- Coverage: metropolitan France and La Réunion only (no Filosofi for Guadeloupe, Martinique, French Guiana, Mayotte).

### 5. `localSpending` — local-authority spending per inhabitant (OFGL / DGFiP)

Sources: OFGL (data.ofgl.fr, from DGFiP accounts), latest exercise with accounts for ≥ 95 % of communes. All amounts in € per inhabitant
(OFGL "population totale").

- `items`: `total` (*dépenses totales hors remboursements de dette*), `operating` (*fonctionnement*), `investment` (*investissement hors remboursements*),
  `debt` (*encours de dette*, a stock), `stateTransfers` (*concours de l'État*: DGF and other State grants — **a receipt of the authority, not State spending**).
- `communes`: commune accounts (main + annex budgets, consolidated).
  `district[k] = Σ share × amount / Σ share × population`; `values[code]` = per-inhabitant values in `columns` order; `coverage`.
  Paris's accounts include its département functions (single authority since 2019), hence much higher figures.
- `intercommunal`: *ensembles intercommunaux* = communes + their EPCI (or EPT in Greater Paris), cross flows removed —
  the most complete measure of "bloc communal" spending. `list[]` = sets covering the district with `popShare` and `perCapita`;
  `district = Σ popShare × perCapita`.
- `department`, `region`: consolidated accounts of the district's département and region (`null` where the authority does not exist
  as such, e.g. Paris, Corsica, Martinique, French Guiana, Mayotte — or where OFGL has no row).
- Do not add the levels together without care: transfers between levels are not removed across levels.

### 6. `stateSpending` — not available

Researched: the State publishes budget execution by *mission / programme* at national level (budget.gouv.fr, data.economie.gouv.fr);
no open dataset breaks State spending down by commune, district, department or region (searches on data.gouv.fr for territorialised
State spending, Chorus by region/department returned nothing). The closest public figure is what the State **transfers** to local
authorities (DGF etc.), included as `localSpending.*.stateTransfers`, clearly labelled. No approximation is made.

### 7. `schools` — collèges and lycées

Sources (data.education.gouv.fr, latest year of each): *Annuaire de l'éducation* (open collèges and lycées, location), IPS collèges and lycées
(from 2023), IVAC (collèges, DNB), IVAL (general/technological and vocational lycées).

- A school is placed in the district of its commune; in split communes, in the district whose outline contains its coordinates
  (fallback: the district with the largest share of the commune).
- `list[]`: `{ uai, name, type: "college"|"lycee", sector: "public"|"private", commune, communeName, lat, lon, priorityEducation, tracks?,
  ips?: { value, sd, gt?, pro?, lyceeType? }, dnb?: { candidates, successRate, successVA, writtenScore, writtenVA, access6to3 },
  bacGT?: { candidates, successRate, successVA, accessRate, accessVA, honoursRate, honoursVA }, bacPro?: { same } }`.
  `…VA` = value added (observed − expected given the pupils' profile), as published.
- `summary`: counts, mean/min/max collège IPS, mean DNB success rate (unweighted means of schools).
- National IPS references are in `index.json → national.schools`.
- Primary schools (IPS écoles, ~33,000) are not included to keep the files small.

### 8. Events (`events/<code>.json`)

Source: **DATAtourisme** (ADN Tourisme, national tourism open-data platform, Licence Ouverte), daily file of *fêtes et manifestations*.

```jsonc
{ "code": "0104", "generated": "2026-11-07", "window": ["2026-11-07", "2027-01-06"], "source": {…}, "total": 83,
  "events": [ { "name", "start", "end", "commune", "postcode", "types": [], "url", "datatourisme", "publisher", "lat", "lon" } ] }  // ≤ 50, by start date
```

- Events whose next period overlaps the next 60 days, located in a district by their coordinates; offers lasting more than 62 days
  (permanent visits, courses) are skipped.
- Coverage depends on what local tourist offices publish: strong in tourist areas, thin in some cities; mostly cultural/leisure events, not civic meetings.
- **OpenAgenda** was considered: its API requires a registered key and each agenda has its own terms/licence chosen by its owner, so there is no single
  free open national dump to redistribute; it was not used. DATAtourisme is official, national, keyless and under the Licence Ouverte.

## `index.json`

```jsonc
{ "generated", "schemaVersion": 1, "districts": ["0101", …],
  "indicators": { "income.median": { "en", "fr", "unit", "year", "n", "min", "median", "deciles": [d1…d9], "max" }, … },
  "national": { "crime": { "rates": {…} }, "unemploymentCensus": {…}, "unemploymentQuarterly": {…}, "income": {…}, "schools": {…} },
  "missing": { } }   // sources that failed during the build (empty when all loaded)
```

Indicator keys: `crime.<offence>` (rate), `unemploymentCensus.rate`, `unemploymentQuarterly.rate`, `income.median`, `income.poverty`,
`localSpending.commune.total`, `localSpending.intercommunal.total`, `schools.ipsCollegeMean`, `population`.
The distribution is across districts (each counts once). To say "above/below the national median" use `indicators[k].median`;
to compare with the official national figure use `national`.

## Coverage and known gaps (exact list)

**French abroad — 9901 to 9911 (11 districts)**: no indicator. All sources describe French communes; the abroad districts are made of consulates.
Only `label`, `department` and an empty `events` file are provided.

**Overseas collectivities outside INSEE/SSMSI/OFGL scope — 97501 Saint-Pierre-et-Miquelon, 97701 Saint-Barthélemy/Saint-Martin, 98601 Wallis-et-Futuna,
98701–98703 French Polynesia, 98801–98802 New Caledonia (8 districts)**: crime, census, quarterly unemployment, income and local spending unavailable.
Schools are listed for 97501, 987xx and 988xx (the ministry's directory covers them, without DNB/IVAL results for New Caledonia);
97701 and 98601 have `schools.status = "empty"`. These districts have no outline in `geo/circo`, so no events either.

**Mayotte — 97601, 97602**: no census figures and no population (INSEE's annual census does not cover Mayotte yet — `geography.population` is `null`),
no localised unemployment, no Filosofi. Crime, local spending (without per-inhabitant coverage) and schools are available.

**Guadeloupe, Martinique, French Guiana — 97101–97104, 97201–97204, 97301–97302**: no Filosofi (INSEE publishes it for metropolitan France and La Réunion only).
French Guiana (97301, 97302) has the department's quarterly rate but no employment-zone rate.

**Saint-Étienne area — 4201, 4202, 4203**: OFGL publishes no 2025 consolidated intercommunal set for Saint-Étienne Métropole, so `localSpending.intercommunal` is `null`
(commune, department and region figures are present). Also null for Mayotte.

**Partial coverage inside a district** (reported in the `coverage` fields, not hidden):
- Crime: SSMSI does not publish small communes (≤ 5 offences in one of the last 3 years). Median coverage of the burglary rate is 77 % of a district's
  dwellings, 10 % of districts are below 37 %. For sexual violence and armed robbery coverage is much lower. Use `rateEstimated` with that caveat, or show `coverage`.
- Poverty rate: INSEE does not publish it for small communes (secret statistique); median coverage 80 % of the population, 10 % of districts below 39 %.
  Median income is published almost everywhere (median coverage 100 %).
- Paris, Lyon, Marseille: crime and local spending are whole-city values (sources have no arrondissement figures); census unemployment, income, population
  and schools are by arrondissement / location.
- Communes split between districts (131, in 258 districts): commune-level values are spread by voter share, assuming the commune is homogeneous.

**Events**: DATAtourisme coverage depends on regional tourism bodies. 163 districts have no event in the next 60 days, mostly in Île-de-France
(16 of 18 Paris districts, most of Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne): the whole of Paris has only 23 upcoming events in the national file,
against 1,675 in Bouches-du-Rhône. No other free official national events source was found (OpenAgenda: see section 8).

**Not included, by choice**: primary schools (IPS écoles), homicides at commune level (not published), census figures older than the latest wave,
time series (only the latest year of each source is kept; earlier years are in the same sources if the UI needs trends later).

**Commune codes not in the COG 2026** (87, kept as is): the overseas collectivities' communes (975xx, 977xx, 986xx, 987xx, 988xx, outside the COG commune list)
and the Ministry's special code 02899 (part of Cormicy voting in Aisne). They carry no indicator.

## Refresh notes

- The URLs of yearly files are discovered at run time where possible (data.gouv.fr API for SSMSI and DATAtourisme, the insee.fr page for the employment-zone file,
  Melodi catalogue for Filosofi, "latest year" queries for the Éducation nationale datasets, latest OFGL exercise with ≥ 33,000 communes).
  Census (2023) and population (2023) years are fixed in the script and must be bumped when INSEE publishes the next wave.
- The 2024 polling-station files fix the district geography; they only need replacing after a redistricting or the next legislative election.
- If a source fails, the build still writes every profile; the affected block becomes `unavailable` with the error as `reason`, and `index.json → missing` lists it.
