# Legislative election history and the shift map

Data for a New York Times–style "shift map": one arrow per legislative district (circonscription) or
department, whose direction and length show how it moved between two elections. Colour convention is
French: **left = red, right = blue**, so an arrow pointing right (positive left–right shift) is blue.

Everything is produced by one script from free, official or academic open data. It is historical data,
so it is not part of the scheduled GitHub Actions; run it once (and again only if a source is corrected):

```bash
node scripts/sync-legislative-history.mjs
```

```bash
node scripts/sync-legislative-history.mjs --refresh
```

`--refresh` re-downloads every source. Raw downloads are cached in `.cache/legislative-history/`
(git-ignored, ≈ 65 MB, mostly the 2012 polling-station file). No new npm dependency: `.xlsx` files are
read with `fflate` (already a dependency) through `scripts/lib/xlsx.mjs`.

| File | What it does |
|---|---|
| `scripts/sync-legislative-history.mjs` | downloads, parses, normalises, aggregates, computes shifts, writes the JSON |
| `scripts/lib/legislative-blocs.mjs` | the bloc definitions and the nuance → bloc table for every election (single source of truth for the tables below) |
| `scripts/lib/xlsx.mjs` | minimal `.xlsx` sheet reader |

## Output

All files are in `public/data/history/legislative/`.

| File | Level | Content | Size |
|---|---|---|---|
| `2012.json`, `2017.json`, `2022.json`, `2024.json` | district (today's boundaries) | both rounds, every candidate, winner, national totals and seats | 290–425 KB |
| `1958.json` … `2007.json` (13 files) | department | first round (1986: single round), votes by party code, national totals | ≈ 20 KB each |
| `shifts.json` | district and department | shift metrics for every consecutive pair, with centroids | ≈ 750 KB (≈ 150 KB gzipped) |

### `<year>.json`, 2012–2024 (district level)

```jsonc
{
  "year": 2024,
  "level": "district",
  "boundaries": "2010 redistricting, used for every election since 2012",
  "dates": { "t1": "2024-06-30", "t2": "2024-07-07" },
  "sources": ["https://www.data.gouv.fr/fr/datasets/…"],
  "licence": "Licence Ouverte / Etalab",
  "blocs": { "XG": { "fr": "Extrême gauche", "en": "Far left", "side": "left" }, … },
  "nuances": { "UG": { "label": "Union de la gauche (NFP)", "bloc": "G" }, … },   // this year's mapping
  "national": {
    "t1": { "inscrits": 49332709, "votants": 32908657, "exprimes": 32057946, "turnout": 66.71,
            "nuances": { "RN": 9379092, … },        // votes by Ministry nuance
            "blocs":   { "XD": 10928830, … },       // votes by bloc
            "shares":  { "XD": 34.09, … } },        // % of valid votes
    "t2": { …same shape, only districts that had a second round… },
    "seats": { "nuances": { "RN": 125, … }, "blocs": { "XD": 143, … } }
  },
  "districts": {
    "0101": {
      "dep": "01",
      "t1": { "i": 86843, "v": 61830, "e": 60495, "b": 929, "n": 406,
              "c": [["RN", 23819, "Christophe MAÎTRE", 0], ["LR", 14495, "Xavier BRETON", 0], …] },
      "t2": { "i": …, "v": …, "e": …, "b": …, "n": …, "c": [["LR", 33889, "Xavier BRETON", 1], …] },   // null if decided in round 1
      "winner": { "nuance": "LR", "bloc": "D", "name": "Xavier BRETON", "round": 2 }
    }
  }
}
```

- `i` registered (inscrits), `v` voters (votants), `e` valid votes (exprimés), `b` blank, `n` spoilt.
  **2012 has no `b`/`n`**: the 2012 polling-station file only gives voters and valid votes (blank + spoilt = `v − e`).
- `c`: candidates sorted by votes: `[nuance, votes, "First LAST", elected (1/0)]`.
- District codes are ours (same as `public/data/geo/circo/*.geojson` feature `code`): department + 2-digit
  number. Ministry codes are converted: `ZA…ZD` → `971…974`, `ZS` → `975`, `ZM` → `976`,
  `ZX` → `977` (Saint-Barthélemy & Saint-Martin), `ZW` → `986`, `ZP` → `987`, `ZN` → `988`,
  `ZZ` → `99` (French abroad, `9901`…`9911`); `"1"`/`"101"` → `"0101"`.
- 2012 "elected": the source has no elected column, so it is derived (round 1: > 50 % of valid votes and
  ≥ 25 % of registered; round 2: most votes). This reproduces the official 36 round-1 winners and the
  official seat count per nuance.

### `<year>.json`, 1958–2007 (department level)

Same top-level fields, plus `round`, `coverage`, `votesVsValid` (sum of party votes vs valid votes, %, a
data-quality check: |gap| ≤ 0.04 % in every file), and:

```jsonc
"departments": { "01": { "name": "Ain", "t1": { "i": …, "v": …, "e": …, "nu": { "COM": 4708, "UNR": 5053, … } } } }
```

`nu` keys are the CDSP codes listed in `nuances` (1958–1986: party *tendencies*, already aggregated by the
source; 1988–2007: candidate nuances summed per department). Department codes as of the election
(1958–1962: no 91–95, Paris/Seine is `75`, Seine-et-Oise `78`; until 1973 Corsica is `20`; Mayotte's old
`985` is converted to `976`).

### `shifts.json`

```jsonc
{
  "generated": "2026-11-07",
  "round": "first round (1986: single round)",
  "units": "percentage points of valid votes (turnout: points of registered voters)",
  "metrics": { …one-line definitions… },
  "blocs": { … },
  "pairs": [
    {
      "from": 2022, "to": 2024, "level": "district",            // or "department"
      "national": { "lr": [4.47, 13.18, 8.71], … },
      "skipped": ["…"],                                          // units present in only one of the two years
      "units": {
        "0101": {
          "lon": 5.2124, "lat": 46.2978,                         // centroid, null where we have no outline
          "lr":       [25.52, 40.03, 14.51],                     // [from, to, to − from]
          "farRight": [26.23, 39.37, 13.15],
          "centre":   [19.30, 11.68, -7.63],
          "turnout":  [49.35, 71.20, 21.85],
          "left":     [27.59, 24.15, -3.44],
          "right":    [53.11, 64.18, 11.07],
          "absent":   ["centre@2024"]                            // optional, see caveats
        }
      }
    }
  ]
}
```

Department units also have `name`, and merged units (see below) have `merged: ["75", "92", "93", "94"]`.

Pairs (19 in total):

| Level | Pairs | Units per pair |
|---|---|---|
| district | 2012→2017, 2017→2022, 2022→2024 | 577 (all) |
| department | 1958→1962, 1962→1967, 1967→1968, 1968→1973, 1973→1978, 1978→1981, 1981→1986, 1986→1988, 1988→1993, 1993→1997, 1997→2002, 2002→2007, 2007→2012, 2012→2017, 2017→2022, 2022→2024 | 90–107 |

Department pairs for 2012–2024 are aggregated from the districts (districts never cross department lines),
so the UI can show one consistent department-level series from 1958 to 2024.

**Drawing an arrow (suggestion):** start at `(lon, lat)`; horizontal component ∝ `lr[2]` (positive → right
→ blue, negative → left → red); for the far-right map use `farRight[2]` the same way. A useful
calibration: national `lr[2]` is +8.71 for 2022→2024.

**Centroids** are area-weighted planar centroids of the outlines in `public/data/geo/` (districts from
`circo/<dep>.geojson`, departments from `departements.geojson`; merged units use the union of their
members). For districts made of several islands the centroid can fall at sea. There is no outline, so
`lon`/`lat` are `null`, for the 11 French-abroad districts (`99xx`) and the 7 districts of Saint-Barthélemy &
Saint-Martin, Wallis-et-Futuna, French Polynesia and New Caledonia (`977`, `986`, `987`, `988`); at
department level only `99` lacks one. The UI can place these in an inset.

## Shift formulas

All on **first-round** results (the second round is a run-off with 1–3 candidates per district and says more
about alliances than about voters' first choice). 1986 was a single-round proportional vote.

- share(bloc) = 100 × votes(bloc) / valid votes (exprimés)
- **left** = XG + G + ECO; **right** = D + XD
- **Left–right position `lr`** = right − left. Positive = more right than left.
- **Left–right shift** = `lr(to) − lr(from)`
- **Far-right shift** = `XD(to) − XD(from)`
- **Centre shift** = `C(to) − C(from)`
- **Turnout** = 100 × votants / inscrits; turnout change = difference in points.

Values are rounded to 0.01 point.

### Where does the centre go?

**The centre is its own axis, not part of either side.** Its votes count in the denominator of every share,
but on neither side of `lr`; its own change is the separate `centre` metric. Reasons:

1. The centre's composition and alliances changed abruptly: in 2017 Macron's movement absorbed a large part
   of the PS and LR electorates (centre 2.4 % → 32.3 %). Putting the centre on the right would show a huge
   artificial rightward lurch in 2012→2017; putting it on the left would show the opposite. As a neutral
   third force, a PS → Ensemble voter moves the district right by reducing the left, and an LR → Ensemble
   voter moves it left by reducing the right, which is what happened.
2. It keeps the arrow meaning stable over 66 years, when the centre was alternately independent (MRP,
   Centre démocrate, Réformateurs; MoDem from 2007), allied with the right (UDF 1978–2002), or the governing
   bloc (2017–2024).
3. The UI can still show the centre: as a third arrow component (for example vertical = `centre[2]`), or by
   computing its own alternative from `left`, `right` and `centre`, which are all provided.

Ecologists outside a left alliance (`ECO`) are counted on the left side: in every election since 1978 most of
their votes went to the left in the run-off, and in 2017 the ECO nuance contained most EELV candidates.
Regionalists and miscellaneous (`DIV`) are on neither side.

## Blocs

| Bloc | Meaning | Side |
|---|---|---|
| XG | Far left (LO, LCR/NPA, POI…) | left |
| G | Left: PCF, LFI, PS, radicals of the left, Greens in a left alliance, misc. left (and SFIO, FGDS, PSU…) | left |
| ECO | Ecologists outside a left alliance | left |
| C | Centre | neutral |
| D | Right: Gaullists, UDF/UMP/LR, misc. right, allied centrists, sovereigntists (DLF/DSV) | right |
| XD | Far right: FN/RN, Ciotti's UXD, Reconquête, MNR, Poujadists, misc. far right | right |
| DIV | Regionalists, miscellaneous | none |

Sovereigntists (Debout la France, `DLF`/`DSV`) are in D, following the Ministry's own grouping; they never
reached 1.2 % nationally, so this barely moves the far-right metric.

### Mapping per election

One table per election because codes change every time (the Ministry's nuance grid is reset by circular before
each election; the CDSP codes are its own). 2012–2024 are Ministry nuances; 1958–2007 are CDSP codes.

| Year | XG | G | ECO | C | D | XD | DIV |
|---|---|---|---|---|---|---|---|
| 2024 | EXG | UG, COM, FI, SOC, RDG, VEC, DVG | ECO | ENS, HOR, UDI, DVC | LR, DVD, DSV | RN, UXD, REC, EXD | REG, DIV |
| 2022 | DXG | NUP, RDG, DVG | ECO | ENS, DVC | UDI, LR, DVD, DSV | RN, REC, DXD | REG, DIV |
| 2017 | EXG | COM, FI, SOC, RDG, DVG | ECO | REM, MDM | UDI, LR, DVD, DLF | FN, EXD | REG, DIV |
| 2012 | EXG | FG, SOC, RDG, DVG, VEC | ECO | CEN, ALLI | NCE, PRV, UMP, DVD | FN, EXD | AUT, REG |
| 2007 | EXG | COM, SOC, PRG, DVG | ECO | MODEM | PSLE, UMP, DVD | FRN, EXD | DIV |
| 2002 | EXG | COM, SOC, PRG, DVG | ECO | — | UDF, UMP, DVD | FRN, EXD | DIV |
| 1997 | EXG | COM, SOC, PRG, DVG | ECO | — | UDF, RPR, DVD | FRN, EXD | DIV |
| 1993 | EXG | COM, SOC, RDG, MAJ | VEC, GEC | — | UDF, RPR, DVD | FRN, EXD | REG, DIV |
| 1988 | EXG, EXE | COM, SOC, RDG, DVG, MAJ, SDC, SCO, RDC | ECO, ECI | — | RPR, UDF, DVD, UOF, UDP, UDR, PRP | FRN, EXD, RFN, RRN | REG, EXO, ROG |
| 1986 | EXG | COM, SOC, DVG, RADICAUX GAUCHE | ECO | — | UDF, RPR, DVD, UDF-RPR | FRN, EXD | REG |
| 1981 | EXG | COM, SOC, DVG, RADICAUX GAUCHE | ECO | — | UDF, RPR, DVD, UDF-RPR | FRN, EXD | REG |
| 1978 | EXG | COM, PSMRG, DVG | ECO | — | GAULOPP, UDF, RPR, DVD | EXD | — |
| 1973 | LO, LCR, OCI | COM, PSU, SOC, MRG, DVG | — | REFRAD, DIVREF | DVD, UDRURP, RIURP, CDPURP, DIVURP, UDR, RI, CDP, DIVGAULL | EXD | — |
| 1968 | EXG | COM, PSU, FGDS, RADSOC | — | CPDM | RADDROIT, UDR, DIVGAULL, RI, RIUDR, MOD | EXD | DIV |
| 1967 | EXG | COM, PSU, FGDS | — | CENTDEM | RADDROIT, UD5, DIVGAULL, RI, RALLIE, MOD | EXD, ALLREP | DIV |
| 1962 | EXG | COM, PSU, SFIO, RADSOC | — | RADCENT, MRP | UNR-UDT, DIVGAULL, INDVREP, MRPVREP, CNI, MOD | EXD, POUJ | DIV |
| 1958 | — | COM, UFD, SFIO, RADSOC, RADUFD, UDSRMIN | — | RADCENT, MRP | UNR, CRR, DIVGAUL, CNI, MOD | EXD, POUJ | DIV |

Labels for every code are in each year file's `nuances`. Choices worth knowing:

- **UDI**: right (D) in 2017 and 2022, when it was allied with LR; centre (C) in 2024, when it ran inside the
  Ensemble coalition. This matches the existing `LEG_BLOCS` in `src/lib/candidates.ts`.
- **Nouveau Centre / Parti radical** (`NCE`, `PRV` in 2012, `PSLE` in 2007): right, allied with the UMP.
  **MoDem** (`CEN` 2012, `MODEM` 2007, `MDM` 2017) and **Alliance centriste** (`ALLI`): centre.
- **UDF**: right from 1978 to 2002 (the non-Gaullist half of the right-wing coalition; it stayed in the
  majority in 2002). So **the centre bloc is empty from 1978 to 2002** and reappears with the MoDem in 2007.
  The 2002→2007 department shift therefore shows a right-side drop equal to the MoDem's 7.6 %.
- **1958–1973**: classified by alignment with the Gaullist majority. Majority parties and allies (UNR/UDR,
  Républicains indépendants, CNI and *modérés*, centrists who joined the majority: `RALLIE`, `CDP`, URP
  candidates) are D; opposition centrists (MRP, Centre démocrate, PDM, Réformateurs, centrist radicals) are C;
  SFIO/FGDS, PCF, PSU, radical-socialists are G. In 1958 the SFIO supported de Gaulle's investiture, so the
  1958 left–right reading is the weakest of the series.
- **1988 and 1993 MAJ** (*majorité présidentielle*): Mitterrand's presidential majority → left.
- **1988 uncleaned codes**: the CDSP says its 1988 and 1993 files were not fully cleaned. A handful of 1988 codes
  are obvious typos, mapped by the party labels next to them: `SCO`, `SDC` (PS / *majorité présidentielle*),
  `RDC` (MRG) → G; `UOF`, `UDP`, `UDR`, `PRP` (URC = UDF-RPR union, RPR) → D; `RFN`, `RRN` (FN lists) → XD;
  `ECI` → ECO; `EXE` → XG; `EXO` (a mix of small lists) and `ROG` → DIV. Together < 1 % of the 1988 vote.

## Sources and licences

| Years | Source | Level used | Access | Licence |
|---|---|---|---|---|
| 2024 | Ministry of the Interior, [round 1](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/) (`5163f2e3…`), [round 2](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/) (`41ed46cd…`), final results by district | district | data.gouv **tabular API** | Licence Ouverte 2.0 |
| 2022 | Ministry, [round 1](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-12-et-19-juin-2022-resultats-definitifs-du-premier-tour/) (`a5e0199c…`), [round 2](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-12-et-19-juin-2022-resultats-definitifs-du-second-tour/) (`3ce8fa1a…`), final results, `cirlg` level | district | data.gouv **tabular API** | Licence Ouverte |
| 2017 | Ministry, [round 1](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-11-et-18-juin-2017-resultats-du-1er-tour/) (`3eb503cd…`), [round 2](https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-11-et-18-juin-2017-resultats-du-2nd-tour/) (`41483dcf…`), sheet "Circo. leg." | district | raw `.xlsx` (the tabular API only reads the first sheet) | Licence Ouverte |
| 2012 | Ministry, [results by polling station, both rounds](https://www.data.gouv.fr/fr/datasets/elections-legislatives-2012-resultats-par-bureaux-de-vote/) (`32981cf5…`, 62 MB), aggregated to districts | district | raw `.txt` (no tabular API) | Licence Ouverte |
| 1958–2007 | CDSP Sciences Po / BDSP Grenoble / Ministry, [Élections législatives 1958-2012](https://www.data.gouv.fr/fr/datasets/elections-legislatives-1958-2012/), first round by (old) district, aggregated to departments | department | raw `.csv` | ODbL |
| — | District and department outlines already in `public/data/geo/` (see `scripts/sync-geo.mjs`) | centroids | local | Licence Ouverte |

Downloads use data.gouv's stable resource links `https://www.data.gouv.fr/fr/datasets/r/<resource id>`.

**Attribution required by the ODbL for 1958–2007** (show it wherever those years appear): *Résultats des
élections législatives 1958-2012 par circonscription, Banque de Données Socio-Politiques (Grenoble),
Ministère de l'Intérieur, diffusé par le Centre de Données Socio-Politiques (Sciences Po).* The derived
JSON files are a "derivative database" under the ODbL: they must stay under the ODbL (they are public in
this repository, which satisfies the share-alike condition).

**Cagé–Piketty, *Une histoire du conflit politique* (unehistoireduconflitpolitique.fr)** — checked, not used
yet. The site says the data can be downloaded freely and are "entirely at your disposal" provided the source is
cited (Julia Cagé and Thomas Piketty, 2023); there is no formal open licence (no Licence Ouverte / CC / ODbL
statement). The legislative files are at commune level back to 1848 and would extend department-level shifts
to the Third and Fourth Republics. Not integrated here because (1) the terms are attribution-only without a
named licence, which the owner should accept explicitly, and (2) it needs a separate commune → department
harmonisation and a bloc mapping per Third/Fourth-Republic election. See *Follow-ups*.

## Coverage

| Years | Units | Notes |
|---|---|---|
| 2012–2024 | 577 districts, both rounds | metropolitan France, overseas departments and collectivities, French abroad |
| 1988–2007 | 104–105 departments | metropolitan + overseas; no French abroad (they had no deputies before 2012); Mayotte missing in 1988 |
| 1958–1986 | 90–96 departments | metropolitan France only (the CDSP has no overseas results before 1988) |

Second rounds before 2012 are not included (they are in the CDSP files if needed; the shift map uses first
rounds only).

**Merged department units.** Departments were reorganised twice; for any pair that crosses a change, the
newer departments are merged back into the old unit in *both* years so arrows compare like with like:

- Pairs starting in 1958 or 1962: `75` = Seine (75 + 92 + 93 + 94), `78` = Seine-et-Oise (78 + 91 + 95). The
  1964 law took effect in 1968, but the CDSP already reports the March 1967 election by new department.
  Approximation: a few communes moved between the old Seine and Seine-et-Oise in the reform.
- Pairs starting before 1978: `20` = Corsica (2A + 2B, split in 1976).
- Guadeloupe (`971`) lost Saint-Barthélemy and Saint-Martin (now `977`) in 2007; the 2007→2012 pair compares
  971 with that small boundary change, and skips 977 and 99 (they did not exist in 2007).

## Sanity checks against official figures

Run on 2026-11-07 against the Ministry's own France-entière files.

| Election | Check | Result |
|---|---|---|
| 2024 T1 | registered, voters, valid votes, votes for each of the 22 nuances vs `resultats-definitifs-france-entiere.xlsx` | **identical** (49,332,709 / 32,908,657 / 32,057,946; turnout 66.71 %; RN 29.26 %, UG 27.99 %, ENS 20.04 %) |
| 2024 T2 | same, vs `resultats-definitifs-france-entiere.csv` | **identical** (501 run-offs) |
| 2022 T1, T2 | same, vs `resultats-par-niveau-fe-t1/t2-france-entiere.txt` | **identical** (T1: 48,953,748 / 23,256,207 / 22,744,708; ENS 25.75 %, NUP 25.66 %, RN 18.68 %) |
| 2017 T1, T2 | same, vs the "FE - Metro - OM" sheet of the same workbooks | **identical** (T1: 47,570,988 / 23,167,508 / 22,654,164; turnout 48.70 %) |
| 2012 T1 | vs the CDSP's Ministry-sourced district file | registered +299, voters +68, valid votes −25 out of ≈ 46 M (< 0.001 %): the polling-station file predates a few final corrections; turnout 57.22 % as published |
| Seats | winners per nuance vs official composition | 2012: SOC 280, UMP 194, DVG 22, VEC 17, NCE 12, RDG 12, DVD 15, FG 10, PRV 6, … (577); 2017: REM 308, LR 112, MDM 42, SOC 30, UDI 18, FI 17, … ; 2022: ENS 245, NUP 131, RN 89, LR 61, DVG 22, … ; 2024: UG 178, ENS 150, RN 125, LR 39, DVD 27, UXD 17, … — all match |
| 1958–2007 | sum of party votes vs valid votes in each CDSP file | within 0.04 % every year; turnout 77.2 % (1958), 81.1 % (1967), 70.9 % (1981), 78.5 % (1986), 65.7 % (1988), 68.0 % (1997), 60.4 % (2007), in line with published metropolitan figures |

National first-round shares by bloc (% of valid votes; 1958–1986 metropolitan France only):

| Year | Turnout | XG | G | ECO | C | D | XD | DIV |
|---|---|---|---|---|---|---|---|---|
| 1958 | 77.18 | 0 | 41.75 | 0 | 14.57 | 40.60 | 2.57 | 0.51 |
| 1962 | 68.69 | 0.04 | 41.24 | 0 | 10.35 | 47.55 | 0.76 | 0.07 |
| 1967 | 81.12 | 0.09 | 43.52 | 0 | 14.09 | 41.71 | 0.56 | 0.02 |
| 1968 | 79.96 | 0.07 | 40.82 | 0 | 10.47 | 48.02 | 0.09 | 0.54 |
| 1973 | 81.31 | 1.24 | 44.60 | 0 | 13.26 | 40.28 | 0.62 | 0 |
| 1978 | 82.92 | 3.20 | 46.12 | 2.13 | 0 | 47.78 | 0.76 | 0 |
| 1981 | 70.86 | 1.26 | 54.30 | 1.07 | 0 | 42.96 | 0.31 | 0.10 |
| 1986 | 78.49 | 1.53 | 42.51 | 1.24 | 0 | 44.73 | 9.90 | 0.08 |
| 1988 | 65.72 | 0.36 | 48.96 | 0.35 | 0 | 40.43 | 9.74 | 0.14 |
| 1993 | 68.91 | 1.72 | 29.49 | 7.66 | 0 | 44.09 | 12.71 | 4.30 |
| 1997 | 68.00 | 2.58 | 38.09 | 6.85 | 0 | 36.29 | 15.06 | 1.13 |
| 2002 | 64.41 | 2.78 | 32.61 | 5.82 | 0 | 43.56 | 12.43 | 2.81 |
| 2007 | 60.43 | 3.41 | 32.31 | 4.05 | 7.64 | 45.55 | 4.68 | 2.35 |
| 2012 | 57.22 | 0.98 | 46.78 | 0.96 | 2.37 | 34.06 | 13.79 | 1.08 |
| 2017 | 48.70 | 0.77 | 23.25 | 4.30 | 32.33 | 22.74 | 13.50 | 3.11 |
| 2022 | 47.51 | 1.17 | 29.35 | 2.67 | 27.00 | 14.72 | 22.95 | 2.13 |
| 2024 | 66.71 | 1.14 | 29.70 | 0.57 | 22.50 | 10.51 | 34.09 | 1.49 |

## Caveats

- **A bloc with no candidate.** If a bloc that stood nationally got no vote in a unit, the unit's
  `absent` lists it as `"<metric>@<year>"` (`left`, `right`, `centre`, `farRight`). Its arrow then mixes
  voter movement with candidate supply: e.g. in 2012 the centre (MoDem, Alliance centriste) had no
  first-round candidate in 211 districts (`centre@2012`); in 2024 the centre had none in 79 (`centre@2024`),
  mostly where Ensemble backed an allied or LR candidate. The far right was absent in 5–10 districts per
  election, mostly overseas, plus a few deals (e.g. no RN against Nicolas Dupont-Aignan in Essonne 8th,
  `9108`, in 2022 and 2024).
  Pre-1978 departments are flagged the same way (e.g. no far-right candidate in Corsica in 1962).
- **Alliances are not parties.** NUPES (2022, nuance `NUP`) and the NFP (2024, `UG`) were joint candidacies:
  a district's left share compares a single left candidate with the sum of several in 2017. Both are in G, so
  the left–right metric is unaffected; only party-level comparisons are. Likewise Ciotti's LR dissidents ran
  as `UXD` (far right) in 2024 while their former party was `LR` (right) in 2022: a district whose LR deputy
  followed Ciotti moves sharply right on `lr` and up on `farRight`.
- **Individual incumbents' nuances.** The Ministry assigns a nuance per candidate; a deputy can change bloc
  between elections without voters moving (e.g. UDI deputies counted D in 2022 and C in 2024: Seine-Saint-Denis
  5th, `9305`, shows −42 points on `lr` in 2022→2024 largely for that reason). Arrows in districts with a strong
  personal vote should be read with that in mind; the year files keep candidate names to check.
- **By-elections are not included.** Only general elections. Several districts had by-elections
  (*législatives partielles*) between general elections; the winner listed for an election may not have been the
  deputy at the end of the term. The Ministry publishes by-elections as separate datasets (e.g. 2016, 2023).
- **Valid votes, not registered voters.** Shares are of *exprimés*, so a district can move on `lr` while turnout
  changes a lot (2022→2024: +19 points nationally); read `turnout` alongside.
- **1986** was a proportional vote by department lists in a single round, and is followed by the 1988
  return to districts: the 1981→1986 and 1986→1988 arrows partly reflect the change of system.
- **Old districts** (1958–2007) used other boundaries (1958, 1986 redistricting), so they are compared at
  department level only. The year files keep CDSP codes, not today's district codes.
- **2012 blank and spoilt votes** are not separable in the source (see above).
- **Rounding**: all metrics to 0.01 point; national shares in the year files are recomputed from the votes.

## Follow-ups

- Third and Fourth Republic department shifts (1848–1956) from the Cagé–Piketty data, if the owner accepts
  their attribution-only terms: commune → department aggregation and a bloc mapping per election.
- Optional: second-round seat changes per department before 2012 (in the CDSP files).
