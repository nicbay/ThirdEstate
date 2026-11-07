# Municipal politics data (municipales 2026 & 2020, promises, council votes)

Three independent jobs, all writing under `public/data/municipal/`. The mayor and councillors themselves come from the
Répertoire national des élus and live in `public/data/communes/<code>.json` (`elected`, see `docs/data-communes.md`); these
files do not repeat them.

| Job | Script | Output | Needs |
|---|---|---|---|
| Election results 2026 + 2020 | `scripts/sync-municipal.mjs` | `municipal/<dept>.json`, `municipal/index.json`, `municipal/families.json` | network (≈210 MB of downloads, cached) |
| Campaign promises (AI summaries) | `scripts/sync-municipal-promises.mjs` | `municipal/promises/<code>.json`, `municipal/promises/index.json` | hand-registered PDFs + `ANTHROPIC_API_KEY` (optional) |
| Council votes | `scripts/sync-municipal-councils.mjs` | `municipal/councils/<code>.json`, `municipal/councils/index.json` | network |

Shared code: `scripts/lib/municipal-nuances.mjs` (nuance → family table), `scripts/lib/http-cache.mjs`, `scripts/lib/csv.mjs`,
`scripts/lib/district-geo.mjs` (COG resolver), `scripts/lib/claude.mjs` (budget-capped Claude client). Downloads are cached in
`.cache/municipal/` (gitignored).

## Run commands

```sh
node scripts/sync-municipal.mjs                 # all departments (≈10 s once downloaded)
node scripts/sync-municipal.mjs --dept=31,75    # only these department files (index/families still rewritten)
node scripts/sync-municipal.mjs --refresh       # re-download the source files

node scripts/sync-municipal-promises.mjs --probe          # dry run: targets, registered PDFs, cost estimate, site check
node scripts/sync-municipal-promises.mjs --run            # summarise (skips the AI step cleanly if no ANTHROPIC_API_KEY)
node scripts/sync-municipal-promises.mjs --run --codes=31555 --max-usd=0.5 --force

node scripts/sync-municipal-councils.mjs        # Toulouse, Bordeaux, Nantes (cache 24 h; --refresh to force)
```

---

## 1. Election results — `municipal/<dept>.json`

### Sources

| id | Dataset (Ministère de l'Intérieur, data.gouv.fr) | Licence |
|---|---|---|
| mi-2026-t1 | [Elections municipales 2026 - Résultats du premier tour](https://www.data.gouv.fr/datasets/69b82a7de5d58cc06ad35ce0) — `municipales-2026-resultats-communes-2026-03-20.csv` | Licence Ouverte 2.0 |
| mi-2026-t2 | [Elections municipales 2026 - Résultats du second tour](https://www.data.gouv.fr/datasets/69c17fed9f18c7781fd11a14) — `municipales-2026-resultats-communes-2026-03-23-16h14.csv` | Licence Ouverte 2.0 |
| mi-2026-cand-t1 | [Elections municipales 2026 - Listes candidates au premier tour](https://www.data.gouv.fr/datasets/69a24d41280ad1aa5193e487) (145 MB) — head of list + list size for round 1 | Licence Ouverte 2.0 |
| mi-2020-t1 | [Elections municipales 2020 - résultats 1er tour](https://www.data.gouv.fr/datasets/5e7102d5ebe5d838b7581662) — files "communes de 1000 et plus" and "moins de 1000" | not specified on data.gouv.fr |
| mi-2020-t2 | [Municipales 2020 - Résultats 2nd tour](https://www.data.gouv.fr/datasets/5efa23afd85990251fc9a197) — same two files | not specified on data.gouv.fr |
| insee-cog-2026 | INSEE COG 2026 (`v_commune_2026.csv`, `v_mvt_commune_2026.csv`) — map 2020 codes to 2026 communes | Licence Ouverte 2.0 |
| geo-api | geo.api.gouv.fr `/communes` — municipal population | Licence Ouverte 2.0 |

The 2026 first-round **results** file leaves the head-of-list name empty; it is joined from the candidatures file
(`Code circonscription` = commune code, `Numéro de panneau`, `Tête de liste = OUI`). Every 2026 list (54,119 list-rounds) got
its head this way. The second-round results file carries the names itself.

### Voting systems (important for the UI)

- **2026**: law n° 2025-444 of 21 May 2025 extended the **list vote** (proportional with a majority bonus, parity lists) to
  every commune, including those under 1,000 inhabitants. So all 34,836 communes have list results in 2026. A list that wins
  an absolute majority in round 1 takes the seats at once (33,310 communes); otherwise there is a round 2 (1,526 communes).
  Paris, Lyon and Marseille: since the 2025 PLM reform the city council is elected city-wide (one result for 75056 / 69123 /
  13055); the separate arrondissement/sector council results are **not** included (files exist in the same datasets).
- **2020**: list vote only in communes of 1,000+; under 1,000, **individual candidates** (plurinominal majority vote with
  panachage) — stored as `system: "individual"` with one row per candidate (see schema). Paris/Lyon/Marseille voted **by
  sector** in 2020 (`system: "list-sectors"`, one result per sector, no city-wide figure).

### Schema

```jsonc
{
  "generated": "2026-11-07", "schemaVersion": 1,
  "department": { "code": "31", "name": "Haute-Garonne" },
  "elections": { "2026": { "rounds": ["2026-03-15","2026-03-22"], "system": "…" }, "2020": { … } },
  "families": "families.json", "sources": ["mi-2026-t1", …], "notes": ["…"],
  "communes": {
    "31555": {
      "name": "Toulouse", "population": 514819,
      "seats": 69,                                 // council seats filled in the deciding round
      "y2026": {
        "system": "list", "decidedRound": 2,
        "winner": { "round": 2, "panel": 5, "label": "…", "head": { "name": "Jean-Luc MOUDENC", "sex": "M" },
                    "nuance": "LDVD", "family": "right", "seats": 53, "pctExpressed": 53.87 },
        "rounds": [ {
          "round": 1, "date": "2026-03-15", "registered": 281775, "voters": 158977, "turnoutPct": 56.42,
          "abstentions": 122798, "expressed": 157021, "blank": 1221, "null": 735,
          "lists": [ { "panel": 5, "label": "…", "shortLabel": "…" /* only if different */, "head": {…},
                       "candidates": 71 /* round 1 only */, "nuance": "LDVD", "family": "right",
                       "votes": 58462, "pctExpressed": 37.23, "pctRegistered": 20.75,
                       "seats": 0, "seatsCommunity": 0 } ]           // sorted by votes, descending
        }, { "round": 2, … } ]
      },
      "y2020": [                                   // array: several entries when communes merged since 2020
        { "code": "31555", "name": "Toulouse", "system": "list",
          "winner": { "round": 2, … }, "rounds": [ … same list shape … ] },
        // under 1,000 inhabitants in 2020:
        { "code": "01001", "system": "individual", "elected": 15,
          "rounds": [ { …turnout…, "candidates": [ ["Delphine BOUILLOUX","F","NC",267,97.45,1], … ] } ] },
        // Paris / Lyon / Marseille:
        { "code": "75056", "system": "list-sectors", "note": "…", "sectors": [ { "sector": "SR01", "name": "Paris 1er secteur", "rounds": […], "winner": {…} } ] }
      ]
    }
  }
}
```

- `winner` = list with the most council seats in the deciding round. Its head is usually, **not necessarily**, the mayor: the
  council elects the mayor afterwards — use `communes/<code>.json → elected.mayor` (RNE) for the mayor.
- `seats` = seats on the conseil municipal; `seatsCommunity` = seats on the intercommunal (EPCI) council (null in small communes).
- Individual-candidate rows (2020, under 1,000) are arrays `[name, sex, nuance, votes, % expressed, elected 1/0]` to keep files small.
- `y2020` is `null` when no 2020 result maps to the commune (French Polynesia, see limits).
- Percentages are the Ministry's own values (French decimals converted); nothing is recomputed except `turnoutPct` when absent.

### `index.json` and `families.json`

`index.json`: `{ columns, rows }` with one row per commune: `code, name, department, population, seats, winner2026Nuance,
winner2026Family, winner2026Head, decidedRound2026, winner2020Family, winner2020Nuance` — enough to colour a map. The 2020
winner is null for communes under 1,000 in 2020, for PLM, and for merged communes.

`families.json`: the family table (`families`), the nuance table (`nuances`, official FR label + EN), the sources, and
`coverage` counters.

### Nuances → political families (colour convention)

Nuances are **assigned by the prefectures** (circular on the attribution of nuances), not chosen by the lists. Official labels
are taken from the 2026 candidatures file; 2020-only codes from the 2020 grid. The family grouping is ProjectView's editorial
choice:

| Family | Colour | Nuance codes |
|---|---|---|
| far_left — Extrême gauche | `#8B0000` dark red | LEXG |
| radical_left — Gauche radicale | `#C8102E` red | LFI, LCOM |
| left — Gauche | `#E8556D` pink-red | LSOC, LUG, LDVG, LRDG (2020) |
| ecologist — Écologistes | `#2E8B3E` green | LVEC, LECO |
| centre — Centre | `#F2A500` orange | LREN, LREM (2020), LMDM, LHOR, LUDI, LUC, LDVC |
| right — Droite | `#1F5AA6` blue | LLR, LUD, LDVD, LDLF (2020), LDSV |
| far_right — Extrême droite | `#13213F` navy | LRN, LREC, LUXD, LEXD, LUDR |
| regionalist — Régionalistes | `#2A9D8F` teal | LREG |
| miscellaneous — Divers | `#8C8C8C` grey | LDIV, LGJ (2020) |
| unclassified — Sans nuance | `#C9C9C9` light grey | no nuance (2026), LNC / NC (2020) |

Debatable choices, stated openly: **LUDR** (Union des droites pour la République, Éric Ciotti's party allied with the RN) is put
with the far right; **LDSV** (droite souverainiste) and **LDLF** with the right; LCOM with LFI as "radical left". Each family also
has a coarse `bloc` (left / centre / right / far_right / other / none).

**Nuance coverage (2026, round 1):** 100 % of lists in communes of 3,500+ inhabitants, 0.3 % in 1,000–3,499, 0 % under 1,000 —
the Ministry only labels lists in communes of 3,500+. Hence 31,554 of 34,836 winners are `unclassified`; never colour these as
a political family. Among the 291 communes of 30,000+: winners 2026 — right 124, left 98, centre 42, far right 12, radical left
6, miscellaneous 7, ecologist 1, regionalist 1.

### Coverage

- 2026: 34,836 communes (metropolitan France, the five DROM, Saint-Pierre-et-Miquelon, New Caledonia), 103 department files.
- 2020 matched to 34,780 of them (merged communes carry several 2020 entries). 18 unmatched 2020 codes are all French Polynesia.

### Limits

- French Polynesia (987) is not included: its 2026 results are in separate files with a different structure.
- Arrondissement / sector councils of Paris, Lyon, Marseille in 2026 are not included.
- Results are the files published on 20 March (round 1) and 23 March 2026 (round 2); later court annulments or partial
  elections are not reflected.
- 2020 files carry no licence on data.gouv.fr (public-sector information under the CRPA; the Ministry's newer files are LO 2.0).

---

## 2. Campaign promises — `municipal/promises/`

### What exists (checked 2026-11-07)

- The Ministry of the Interior runs **"e-propagande"** at <https://programme-candidats.interieur.gouv.fr/>: the candidates'
  *professions de foi* (PDF leaflets validated by the propaganda commission) for the 2026 municipales, **communes of 2,500
  inhabitants and more only**, online from **9 March 2026**, for both rounds. Publication is **voluntary** for each list, so
  some lists are missing. (Prefecture notices, e.g. Haute-Corse and Var, describe it.)
- Below 2,500 inhabitants there is no official online publication (lists distribute their leaflets themselves).
- No dataset of these PDFs or of their URLs exists on data.gouv.fr. No licence is stated for the documents; they are
  candidates' electoral material, so we only **link** to them and publish short AI summaries, never the documents.
- The site is behind a **Cloudflare bot challenge** (HTTP 403 "Just a moment…" for scripts, re-checked by `--probe`). The script
  does not crawl it and must not try to get around the challenge.

### How the script works

1. Targets: communes with population ≥ 30,000 (291) and their **winning 2026 list** (from `municipal/<dept>.json`).
2. Sources: `scripts/data/municipal-promises-sources.json` — a hand-curated register `{ "<code>": { "pdf", "panel", "round",
   "checked" } }`. A person opens the official site in a normal browser, copies the link of the winning list's leaflet, and adds
   it. The PDF is downloaded into `.cache/municipal/pdf/<code>.pdf` (or saved there by hand). The panel number is checked
   against the winning list.
3. Dry run by default: prints the cost estimate. `--run` sends each PDF (base64 `document` block) to **Claude Haiku 5.5** through
   `scripts/lib/claude.mjs` (monthly $15 cap across jobs) with structured JSON output: 5–8 bullets, FR + EN, theme tag.
   Without `ANTHROPIC_API_KEY` the AI step is skipped and only the index is written. A per-run cap (`--max-usd`, default 3)
   stops before a call whose worst case would exceed it. Unchanged PDFs (same SHA-256) are not re-summarised.

**Cost estimate:** a leaflet is usually 2–4 pages ≈ 3,000 tokens/page upper bound → ≈ 12,600 input + ≈ 700 output tokens per
commune ≈ $0.0016. All 291 communes ≈ **$0.47** (worst case < $0.6), well under the $3 limit.

### Schema — `promises/<code>.json`

```jsonc
{ "code": "31555", "name": "Toulouse", "generated": "…", "schemaVersion": 1,
  "election": { "name": "Municipales 2026", "round": 1 },
  "list": { "panel": 5, "label": "…", "head": {…}, "nuance": "LDVD", "family": "right" },
  "source": { "pdf": "https://…", "title": "Profession de foi", "publisher": "…", "checked": "…", "pages": 4, "sha256": "…" },
  "summary": { "aiGenerated": true, "model": "claude-haiku-5-5", "generatedAt": "…",
               "label": { "fr": "Résumé généré par IA …", "en": "AI-generated summary …" },
               "bullets": [ { "fr": "…", "en": "…", "theme": "transport" } ], "limitations": null },
  "usage": { "inputTokens": 0, "outputTokens": 0 } }
```

`promises/index.json`: every target commune with `status` = `summarised` | `pending` | `no_source` | `error`, the winning list,
the e-propagande probe result and the AI label. The UI must always show the AI label and the source PDF link.

### Current state

**0 summaries, $0 spent.** No PDF could be retrieved automatically (bot challenge), and the register is empty; all 291 targets are
`no_source`. Filling the register by hand (≈ 291 links) and running `--run` is the way forward.

---

## 3. Council votes — `municipal/councils/`

### Survey (2026-11-07)

There is no national API for municipal deliberations. The SCDL "délibérations" schema (schema.data.gouv.fr
`scdl/deliberations`) only has **totals** (`VOTE_EFFECTIF, VOTE_REEL, VOTE_POUR, VOTE_CONTRE, VOTE_ABSTENTION`), never groups.
Large cities checked:

| City | Status | Why |
|---|---|---|
| **Toulouse** 31555 | ✅ covered — **votes by group** | data.toulouse-metropole.fr `deliberations-a-partir-de-mars-2026-mairie-de-toulouse`: outcome + groups/councillors voting against, abstaining or not taking part |
| **Bordeaux** 33063 | ✅ covered — outcome only | `bor_deliberations` (LO 2.0): adopted unanimously / by majority, current to 2026-11-02, no counts |
| **Nantes** 44109 | ✅ covered — totals only | SCDL dataset (LO 2.0) with for/against/abstention; nothing after 2026-02-19 yet (previous mandate) |
| Paris | ✗ | no deliberation/vote dataset (Conseil de Paris agendas only, last updated 2018); votes only in BMO/minutes |
| Lyon, Nice, Montpellier, Grenoble | ✗ | no deliberation dataset found |
| Marseille | ✗ | deliberation lists without votes, last edition 2024 |
| Strasbourg | ✗ | legal postings (PDF + OCR text), no structured votes |
| Lille | ✗ | one-off 2022 dataset; MEL deliberations have no votes |
| Rennes | ✗ | vote totals stopped in 2021 |
| Angers, Besançon, Tours, Brest | ✗ | deliberations without (usable) vote fields |
| Clermont-Ferrand, Saint-Étienne | ✗ | vote totals but stale (2024 / previous mandate) or undated |

Toulouse Métropole (the intercommunal council) publishes counts plus the surnames of councillors voting against/abstaining,
but it is not a commune, so it is not included; it could be added later with a group roster.

### Schema — `councils/<code>.json`

```jsonc
{ "generated": "…", "schemaVersion": 1, "code": "31555", "name": "Toulouse",
  "granularity": "group",            // "group" | "totals" | "outcome"
  "council": "Conseil municipal de Toulouse", "mandate": "2026–2032",
  "groups": [ { "name": "Demain Toulouse", "family": "radical_left", "basis": "…" } ],   // Toulouse only
  "method": "…", "source": { "name", "publisher", "url", "api", "licence", "modified" },
  "deliberations": [ {
    "id": "26-0217", "date": "2026-06-19", "order": 3.1, "title": "…", "theme": "…", "rapporteur": "…",
    "outcome": "adopted",            // adopted | rejected | withdrawn | noted | other | unknown
    "unanimous": false, "outcomeLabel": "Adopté",
    "byGroup": { "Demain Toulouse": { "position": "notVoting", "implied": false },
                 "Aimer Toulouse": { "position": "for", "implied": true } },   // Toulouse; null when no vote
    "individuals": [ { "name": "Fella ALLAL", "position": "notVoting" } ],    // named outside a group
    "voteText": "Ne participe pas au vote\n\n\tDemain Toulouse\n\tFella ALLAL",  // verbatim source
    "totals": { "for": 53, "against": 4, "abstain": 6, "members": 63, "voting": 63 },  // Nantes
    "url": "…"                                                                  // Bordeaux / Nantes
  } ] }
```

**Toulouse method:** the source lists only *Contre*, *Abstention* and *Ne participe pas au vote*; "Pour" is never written. So a
group not listed on a deliberation that was put to the vote is marked `for` with **`implied: true`**. `except` lists members
named as not following their group ("Aimer Toulouse sauf Fella ALLAL"). Group families come from the 2026 lists the groups
emerged from (group names match official list names; documented in `groups[].basis`). The verbatim `voteText` is kept for audit.

Toulouse 2026 mandate so far (223 deliberations, 27 Mar → 19 Jun 2026): 151 unanimous; "Demain Toulouse" voted against 14,
abstained 14, did not take part 24; "Vivre mieux…" against 7, abstained 11; "Aimer Toulouse" (majority) against 3 (rejected
items).

`councils/index.json`: `covered` (code, granularity, counts, date range, source, licence) and `notCovered` (code, reason).

### Limits

- Toulouse's 2026 dataset lags (last council published: 19 June 2026); its metadata has no licence (the 2020–2026 edition of the
  same dataset is Licence Ouverte 2.0).
- `implied` positions assume the official format is complete (as the source states, only non-"pour" votes are listed).
- Group membership of individual councillors is not published in current form (the `liste-elus-toulouse` roster still shows
  2020 groups), so individuals are listed by name only.
- Nantes and Bordeaux cannot show group positions; the UI should show only totals / outcome there.
