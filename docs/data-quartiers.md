# Quartiers (neighbourhoods) — data

Neighbourhood-level data for every French commune that INSEE splits into **IRIS** ("Îlots regroupés pour
l'information statistique", ≈ 2,000 inhabitants each; communes of 5,000+ inhabitants and most of 10,000+, plus the
arrondissements of Paris, Lyon and Marseille). Each IRIS gets its official contour, 14 official figures with
commune and national comparisons, and — where evidence exists — a Wikipedia quartier link and description,
the geolocated Wikipedia articles inside it, and up to 6 Wikimedia Commons photos taken inside it.

The town level (one photo, Wikipedia description of the commune…) is in `public/data/communes/` and is not repeated here.

```bash
node scripts/sync-quartiers.mjs                       # the 50 largest communes (Paris, Lyon, Marseille: every arrondissement)
node scripts/sync-quartiers.mjs --top=200             # the 200 largest
node scripts/sync-quartiers.mjs --all                 # every commune with IRIS (1,944)
node scripts/sync-quartiers.mjs --codes=84007,75111   # only these communes / arrondissements
node scripts/sync-quartiers.mjs --all --no-photos --no-wiki   # figures + contours only (~40 s once downloads are cached)
node scripts/sync-quartiers.mjs --top=50 --cached-photos   # rebuild from the cache only (no Commons request; uncached IRIS keep their photos)
node scripts/sync-quartiers.mjs --ai                  # also write AI descriptions (needs ANTHROPIC_API_KEY, see below)
node scripts/sync-quartiers.mjs --refresh             # ignore the cache (re-download everything)
node scripts/sync-quartiers.mjs --tolerance=0.0001    # contour simplification tolerance in degrees (default 0.00008 ≈ 6–9 m)
```

Node 24, no new dependency (`fflate` for the INSEE zips). Downloads (~125 MB of INSEE zips) and every API answer are
cached in `.cache/quartiers/` (official files 30 days, Wikimedia/WFS answers 60 days), so a rerun is offline and an
interrupted run resumes where it stopped. `--no-photos` / `--no-wiki` keep the photos / Wikipedia data already present
in the output files. `index.json` lists every commune file present, so partial runs accumulate.
No `package.json` script and no workflow were added.

## Files

| File | Content |
|---|---|
| `public/data/quartiers/index.json` | communes covered (code, name, population, IRIS count, IRIS with photos / description), indicator definitions (FR/EN, unit, source, year), IRIS types, source registry, national figures |
| `public/data/quartiers/<code>.json` | one per commune or PLM arrondissement (INSEE code, e.g. `84007`, `75111`): comparison values + list of IRIS |
| `public/data/quartiers/<code>.geojson` | simplified IRIS contours of that commune, WGS 84, properties `code` (9-digit IRIS code), `name`, `type` |

### `<code>.json`

```jsonc
{
  "code": "75111", "name": "Paris 11e Arrondissement",
  "city": { "code": "75056", "name": "Paris" },          // PLM arrondissements only
  "generated": "2026-11-07", "schemaVersion": 1,
  "population": { "value": 139983, "year": 2022, "source": "population" },
  "irisCount": 63,
  "comparison": {
    "commune":  { "label": "arrondissement", "population": …, "under15": …, … },  // same keys as figures
    "city":     { "label": "Paris", … },                                          // PLM only
    "national": { "label": "France (census: excl. Mayotte; income: metropolitan France)", … }
  },
  "iris": [{
    "code": "751114101",               // INSEE IRIS code (commune code + 4 digits)
    "name": "Folie Méricourt 1",       // INSEE/IGN name (LIB_IRIS), never changed
    "type": "H",                       // H residential, A business, D other (large park, port…) — see index.irisTypes
    "center": [2.38105, 48.86726],     // a point guaranteed inside the IRIS (label/marker), [lon, lat]
    "areaKm2": 0.05,
    "figures": { "population": 2994, "under15": 12, "over65": 19.1, "householdSize": 1.96, "apartments": 97.5,
                 "owners": 40, "renters": 58.2, "socialHousing": 25.3, "vacancy": 12.3, "unemployment": 13.6,
                 "higherEducation": 56.4, "noDiploma": 14.5, "medianIncome": 25760, "povertyRate": 20 },
    "lowPopulation": true,             // only when the 2022 population is below 300: rates are fragile
    "missing": { "income": "…reason…" },  // only when a figure is null
    "quartier": {                      // null unless matched (see "Names")
      "name": "Quartier de la Folie-Méricourt", "wikipedia": "https://fr.wikipedia.org/wiki/…", "match": "…" },
    "places": [{ "title": "Rue Oberkampf", "url": "https://fr.wikipedia.org/wiki/Rue_Oberkampf" }],  // ≤ 8 geolocated articles inside the IRIS, nearest first
    "description": {                   // null, or one of:
      "source": "wikipedia", "lang": "fr", "text": "first one or two sentences", "url": "…", "title": "…",
      "licence": "CC BY-SA 4.0", "licenceUrl": "https://creativecommons.org/licenses/by-sa/4.0/" },
      // or { "source": "ai", "aiGenerated": true, "model": "claude-haiku-5-5", "generated": "…", "text": "FR", "textEn": "EN",
      //      "basis": "figures above and names of geolocated Wikipedia articles only", "inputHash": "…" }
    "photos": [{                       // 0–6
      "title": "Rue Oberkampf - Paris XI (FR75) - 2021-06-25 - 1.jpg",
      "thumb": "https://thumb.wikimedia.org/…/960px-….jpg", "thumbWidth": 960, "thumbHeight": 640,
      "page": "https://commons.wikimedia.org/wiki/File:…",   // link for the attribution
      "author": "Mbzt", "licence": "CC BY 4.0", "licenceUrl": "https://creativecommons.org/licenses/by/4.0",
      "quality": "featured" | "quality" | "valued" | null }]
  }]
}
```

Values are numbers or `null`; `null` is never replaced by an estimate. Percentages have one decimal, incomes are € per
year. The UI must show the photo author + licence (linked to `page`) and, for Wikipedia text, the article link and
CC BY-SA; AI text must be labelled as AI-generated (`aiGenerated: true`).

## Indicators

| Key | Definition | Source (year) |
|---|---|---|
| `population` | municipal population of the IRIS | census 2022, Population |
| `under15`, `over65` | share of 0–14 / 65+ year-olds | census 2022, Population |
| `householdSize` | people in households ÷ households | census 2022, Logement |
| `apartments` | flats ÷ all dwellings | census 2022, Logement |
| `owners`, `renters`, `socialHousing` | owner-occupiers / renters / HLM tenants ÷ main residences | census 2022, Logement |
| `vacancy` | vacant dwellings ÷ all dwellings | census 2022, Logement |
| `unemployment` | unemployed 15–64 ÷ active 15–64 (census definition: self-declared, higher than the ILO rate) | census 2022, Activité des résidents |
| `higherEducation` | holders of a post-bac diploma (bac+2 and more) ÷ people 15+ out of school | census 2022, Diplômes – Formation |
| `noDiploma` | no diploma or only the *certificat d'études* ÷ people 15+ out of school | census 2022, Diplômes – Formation |
| `medianIncome` | median disposable income per consumption unit ("niveau de vie") | Filosofi 2021, IRIS (DISP_MED21) |
| `povertyRate` | share of people below 60 % of the metropolitan median (rates under 5 % are published as 5 % by INSEE) | Filosofi 2021, IRIS (DISP_TP6021) |

Comparisons: census figures for the commune / city / France are the sums of the same IRIS-file counts (so they are
exactly consistent with the IRIS values; France = France excluding Mayotte). Income comparisons come from INSEE's
Filosofi 2021 commune/arrondissement file and the *France métropolitaine* value (median 23,080 €, poverty 14.9 %) —
the same 2021 vintage as the IRIS values. Commune income figures are those of the 2025 geography.

## Sources and licences

| Data | Source | Licence |
|---|---|---|
| IRIS list and contours | IGN "CONTOURS…IRIS", WFS layer `STATISTICALUNITS.IRIS:contours_iris` on the Géoplateforme (data.geopf.fr) — <https://geoservices.ign.fr/contoursiris> | Licence Ouverte / Etalab 2.0 |
| Census 2022 IRIS bases (Population, Logement, Activité, Diplômes) | INSEE, <https://www.insee.fr/fr/statistiques/8647014>, `/8647012`, `/8647006`, `/8647010` (geography 1 Jan 2024) | Licence Ouverte / Etalab 2.0 |
| Filosofi 2021 IRIS (disposable income) | INSEE, <https://www.insee.fr/fr/statistiques/8229323> (geography 1 Jan 2022) | Licence Ouverte / Etalab 2.0 |
| Filosofi 2021 communes / France métropolitaine | INSEE, <https://www.insee.fr/fr/statistiques/7756729> (geography 2025) | Licence Ouverte / Etalab 2.0 |
| Quartier articles, descriptions, named places | French Wikipedia API (`list=geosearch` with `gsbbox`, `prop=extracts`) | CC BY-SA 4.0 (attribute + link) |
| Photos | Wikimedia Commons API (`generator=geosearch` + `imageinfo/extmetadata`) | per file (`licence`, `author`; mostly CC BY / CC BY-SA, some public domain) |
| AI descriptions (optional) | Claude Haiku 5.5 via `scripts/lib/claude.mjs` | generated text, labelled |

Requests use the User-Agent `ThirdEstate/0.1 (github.com/nicbay/ThirdEstate)`, one queue per host with ≥ 650 ms between
requests (≤ ~90/min; Wikimedia allows 200/min for an identified client), and wait for `Retry-After` on HTTP 429.
The Wikimedia budget is shared with the other Third Estate jobs that run from the same machine, so in practice the
throughput is lower (see "Cost and time").

Note: the 2023 census IRIS bases started to appear on 4 Nov 2026 (only *Logement* and *Couples-Familles-Ménages* so far,
in a new European-harmonised format). The 2022 bases are used for all four themes so the figures share one vintage;
switch the four URLs in `SOURCES` when the 2023 set is complete (column names will need checking).

## Method

- **IRIS list**: all WFS features (49,386, of which 33,000+ are type `Z` = commune not split); a commune "has IRIS"
  when it has features of type H, A or D → **1,944 communes / arrondissements, 16,409 IRIS**.
- **Selection**: communes are ranked by 2022 population, a PLM arrondissement taking its city's rank (so `--top=50`
  means the 50 largest cities, Paris/Lyon/Marseille counting once with all their arrondissements).
- **Contours**: requested 30 communes per WFS call; simplified per ring with Douglas–Peucker (default 0.00008°) and
  rounded to 5 decimals (~1 m). Rings are simplified independently, so neighbouring IRIS can show slivers/overlaps of
  a few metres; fine for a city map, not for point-in-polygon at the parcel scale. Area and `center` are computed on
  the full-resolution contour.
- **Figures**: matched on the 9-digit IRIS code. Census variables are INSEE's weighted counts (decimals), rounded only
  in the final ratio.
- **Names** (`quartier`): IRIS names are kept as published. A Wikipedia quartier is linked only when **all** hold:
  the IRIS name, without a trailing number/roman numeral/letter (and, as a second try, without a trailing
  Nord/Sud/Est/Ouest/Centre), equals the article title without "Quartier (de/du…)" and without a disambiguation in
  parentheses (accepted only if it names the commune or says "quartier"); the article is geolocated inside the
  commune's IRIS; it is not a disambiguation page; its first sentence contains *quartier / faubourg / secteur /
  hameau / village / cité / lieu-dit…*. Example: IRIS "Saint-Ambroise 1…14" → "Quartier Saint-Ambroise".
  Official municipal quartier lists (conseils de quartier) are not used: they are published in heterogeneous
  formats per city and their boundaries do not follow IRIS.
- **Places**: Wikipedia articles whose coordinates fall inside the IRIS polygon (events, cantons and similar
  non-places are dropped by title), nearest to `center` first, at most 8.
- **Photos**: one Commons request per IRIS: the 50 geotagged files nearest to `center` within a radius reaching the
  IRIS bounding-box corners; kept only if their coordinates are inside the polygon, JPEG/PNG/WebP, ≥ 800×450, aspect
  0.5–3, with a licence. Score: featured +6, quality +4, valued +3, street/building/park/church/square… words in title
  or categories +2, commune name +1; files whose title or categories mention people, events, vehicles, maps,
  documents, interiors, animals… are dropped whatever their score, and so are files scoring below 1; at most 2 per author and no near-identical titles; best 6 kept. `thumb` is the URL the API returns for
  a 640 px request, which Wikimedia serves as its nearest standard thumbnail step (960 px).
- **Descriptions**: Wikipedia (first one or two sentences of the matched quartier article, intro only) — or, only for
  IRIS in communes of ≥ 100,000 inhabitants without one, and only with `--ai` and `ANTHROPIC_API_KEY`, two factual
  sentences (FR + EN) from Claude Haiku given only the IRIS figures, the commune figures and the names in `places`,
  with an instruction not to mention anything else. This job stops at **$3 per month** (read from the shared ledger
  `data/usage/claude-<month>.json`, job `quartiers`; the shared $15 cap still applies). A description is regenerated
  only when its inputs change (`inputHash`).

## Coverage and sizes (build of 2026-11-07)

| | 50 largest cities (92 files incl. 45 PLM arrondissements) | All communes with IRIS |
|---|---|---|
| Communes / arrondissements | 92 | 1,944 |
| IRIS | 4,488 | 16,409 |
| Contours + 12 census figures | 100 % (16 IRIS recoded since 2024 without figures) | 100 % contours; 98.8 % census figures (197 without: Mayotte, SPM, St-Barthélemy, recoded IRIS) |
| Median income / poverty | 89.3 % | 88.1 % |
| Wikipedia quartier linked + description | 1,220 (27.2 %) | same 1,220 (Wikipedia step run on the top 50 only) |
| Named places (geolocated articles) | 3,298 (73.5 %) | same (top 50 only) |
| Photos | **393 IRIS (8.8 %), 1,852 photos, 75 assessed (quality/featured/valued)** — done: Paris 1er–11e (every IRIS but one), Paris 12e partly (45/63 IRIS fetched so far) and Avignon (19/36: the other IRIS have no suitable geotagged file) | same |
| AI descriptions | 0 (no `ANTHROPIC_API_KEY` in this environment; $0 spent) | — |
| JSON size | 4.8 MB (largest 211 KB: Paris 11e) | 11.1 MB |
| GeoJSON size | 2.6 MB | 20.0 MB (largest 124 KB; 968k points kept of 1.49M) |
| `index.json` | | 199 KB |

The photo step is the bottleneck: one Commons request per IRIS, and the Wikimedia budget (200 requests/min per
client) was shared with other Third Estate jobs, giving ~8–10 IRIS/min. Remaining for the top 50: ~4,100 IRIS
(≈ 7 h at that rate, ≈ 1 h when the budget is free). Resume with `node scripts/sync-quartiers.mjs --top=50`
(cached answers are reused); then `--top=200` / `--all` the same way (all communes ≈ 16,000 requests for photos plus
≈ 2,500 for Wikipedia). Expected size with photos everywhere: roughly +2–3 KB per IRIS with photos (≈ +30–40 MB for
all communes), so consider loading photos lazily per commune.

Samples: **Avignon (84007)** — 36 IRIS, income from 12,460 € (Monclar Sud) to 25,830 € (La Balance-Raspail),
commune 17,690 €; 6 IRIS linked to a Wikipedia quartier (Montfavet, Saint-Chamand, Croix des Oiseaux,
Pont-des-Deux-Eaux, Monclar), 19 with photos, 23 with named places; 50 KB + 28 KB.
**Paris 11e (75111)** — 63 IRIS all linked to their administrative quartier (Folie-Méricourt, Saint-Ambroise,
Roquette, Sainte-Marguerite — so 4 distinct descriptions), 62 with photos, income 15,140 € (Folie Méricourt 12) to
38,400 € (Saint-Ambroise 8), arrondissement 30,210 €; 211 KB + 17 KB.

## Limits

- Census IRIS figures are estimates from the rolling census (sample surveys in communes of 10,000+); INSEE advises
  caution for IRIS of small population — `lowPopulation` flags those under 300 inhabitants (669 IRIS, mostly
  business/other IRIS).
- Filosofi 2021 covers metropolitan France, Martinique and La Réunion only, and is not published for IRIS with too
  few tax households or under statistical secrecy (≈ 12 % of IRIS have no income figure).
- Vintages differ: contours = current IGN edition, census = geography 2024, Filosofi IRIS = geography 2022. IRIS
  created or recoded since (e.g. Saint-Denis 93066 after its 2025 merger, a few in Montpellier, Blain, Cesson…) have
  `null` figures with a reason. Mayotte, Saint-Pierre-et-Miquelon and Saint-Barthélemy have contours but no
  census/income figures in these files.
- Wikipedia matching is conservative: many real quartiers whose IRIS names differ from the article title (compound
  names like "Saint-Ruf-Trillade Nord") are not linked. No renaming is done.
- Photos are chosen automatically from geotags; a geotag is the camera position (a photo taken from a bridge may show
  the other bank). Heuristics remove most portraits/events/objects, not all — the UI should allow hiding a photo
  (a manual exclusion list can be added in the script if needed).
- Descriptions are French (Wikipedia FR); AI descriptions, when generated, have FR and EN.
