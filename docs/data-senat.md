# Sénat data (`public/data/senat/`)

`scripts/sync-senat.mjs` builds the Senate counterpart of `public/data/an/`: sitting senators, every public vote
(scrutin public) since October 2023 with each senator's position, and the results of the 27 September 2026
senatorial elections. It uses only official open data, plus Wikidata for social accounts.

```
node scripts/sync-senat.mjs              # daily run (about 30 s when the cache is fresh, 3–5 min weekly)
node scripts/sync-senat.mjs --full       # refetch every vote page (about 15 min, ~2,000 requests)
node scripts/sync-senat.mjs --refresh    # refetch senators' pages, their own sites and Wikidata now
# also: --no-sites --no-wikidata --no-elections
```

No API key, no AI step, no new dependency (`node-html-parser`, `scripts/lib/csv.mjs`).

## Files

| File | Size (2026-11-07) | What |
|---|---|---|
| `public/data/senat/senateurs.json` | 553 KB | 348 sitting senators |
| `public/data/senat/scrutins.json` | 347 KB | 978 public votes, newest first |
| `public/data/senat/votes/<matricule>.json` | 348 files, 3.9 MB in all (~11 KB each) | one senator's positions |
| `public/data/senat/elections-2026.json` | 115 KB | 2026 senatorial elections, 64 constituencies, 178 seats |
| `public/data/senat/meta.json` | 43 KB | sync time, sources, checks, socials coverage / conflicts / rejections |
| `data/senat-cache.json` | 198 KB | parsed senator pages, own-site links, Wikidata rows, vote-check state (committed) |

### `senateurs.json`

Array, sorted by surname. Same field names as `an/deputes.json` wherever the meaning is the same.

```json
{
  "id": "19591F",                       // Sénat "matricule" (also the votes/<id>.json file name)
  "civ": "M.", "prenom": "Xavier", "nom": "Iacovelli", "alpha": "Iacovelli", "feminin": false,
  "naissance": "1981-03-31",
  "profession": "Attaché territorial contractuel",            // null for 25 senators (not published)
  "catSocPro": "Professions intermédiaires administratives de la fonction publique", // INSEE PCS, as published
  "categoriePro": "Salariés (Employés)",                      // the Sénat's own grouping
  "email": "x.iacovelli@senat.fr",                            // null when "Non public" (14)
  "groupe": { "id": "LREM", "abrev": "RDPI", "libelle": "Groupe Rassemblement des démocrates, progressistes et indépendants",
              "couleur": "#F1B608", "appartenance": "membre" }, // membre | apparenté | rattaché
  "circonscription": "Hauts-de-Seine", "codeCirconscription": "92",
  "numDepartement": "92",               // "99" for French people abroad (codes 997 / 998), as for MPs
  "serie": 1, "siege": 1,               // renewal series (1 = elected 2023, 2 = elected 2026), seat number
  "commission": { "libelle": "commission des affaires sociales", "fonction": "Membre" },   // standing committee
  "autresCommissions": [ { "libelle": "…", "type": "Commission spéciale", "fonction": "Membre" } ],
  "bureau": null,                       // e.g. "Président du Sénat", "Questeur du Sénat", "Secrétaire du Sénat"
  "debutMandat": "2023-10-02",          // current mandate
  "senateurDepuis": "2017-10-02",       // start of uninterrupted service (consecutive mandates)
  "photo": "https://www.senat.fr/senimg/iacovelli_xavier19591f_carre.jpg",
  "url": "https://www.senat.fr/senateur/iacovelli_xavier19591f.html",
  "hatvp": "https://www.hatvp.fr/pages_nominatives/iacovelli-xavier.html",
  "wikidata": "Q40954423",
  "socials": { "twitter": { "url": "https://x.com/iacovellixavier", "handle": "@iacovellixavier", "source": "senat", "confidence": "high", "confirmedBy": ["wikidata"] }, "…": {} },
  "stats": { "pour": 457, "contre": 392, "abstention": 77, "nonVotant": 47, "scrutins": 973,
             "participation": 0.95, "partPour": 0.49, "partContre": 0.42, "partAbstention": 0.08 }
}
```

- `stats.scrutins` = votes in the window where the senator appears on the nominative list (the Sénat lists every
  sitting senator on every vote, so this is exactly "votes held while sitting"). `participation` = (pour + contre +
  abstention) / scrutins. `partPour` / `partContre` / `partAbstention` are shares of the votes actually cast.
- `socials` uses the same object shape as `an/socials.json` (`url`, `handle`, `source`, `confidence`,
  `confirmedBy`, `evidence`). Sources: `override` > `senat` > `wikidata` > `site`.

### `scrutins.json`

Array of arrays, newest first. Positions 0–7 match `an/scrutins.json`:

```
[id, date, titre, sort, demandeur, pour, contre, abstention, nonVotants, dossier]
["2026-56", "2026-11-05", "l'amendement n° 19 rectifié bis, déposé par M. Cédric Chevalier …", "rejeté", null, 157, 186, 0, 5,
 "https://www.senat.fr/dossier-legislatif/ppl24-515.html"]
```

- `id` = `<session start year>-<number>` (the Sénat numbers votes per session, 1 October – 30 September).
  Page: `https://www.senat.fr/scrutin-public/<year>/scr<year>-<n>.html`.
- `sort` is `adopté` or `rejeté` (516 rejected, 462 adopted). `demandeur` is always `null`: the Sénat does not
  publish who requested the vote in a structured way.
- Totals are the **published** ones (the "Résultat du scrutin" box of the vote page), not recounted.
- `dossier` is the legislative file linked from the vote page (or `null`).

### `votes/<matricule>.json`

`{ "2023-1": "C", "2023-2": "P", …, "2026-56": "P" }` — `P` pour, `C` contre, `A` abstention, `N` n'a pas pris part
au vote. Only votes held while the senator was sitting. One file per sitting senator; files of senators who left
are removed.

### `elections-2026.json`

```json
{ "fetchedAt": "…", "election": "Élections sénatoriales du 27 septembre 2026 (série 2)", "date": "2026-09-27", "serie": 2,
  "source": { "producer": "Ministère de l'Intérieur", "dataset": "https://www.data.gouv.fr/datasets/elections-senatoriales-2026-resultats", "licence": "lov2", "files": [ … ] },
  "sieges": 178,
  "departements": [ {
    "code": "01", "nom": "Ain", "mode": "proportionnel", "sieges": 3,
    "tours": [ { "tour": 1, "inscrits": 1956, "votants": 1931, "abstentions": 25, "exprimes": 1917, "blancs": 8, "nuls": 6,
                 "resultats": [ { "nuance": "LLR", "liste": "L'Ain au coeur", "listeAbrege": "…", "voix": 738, "pctExprimes": 38.5, "sieges": 1 } ] } ],
    "elus": [ { "nom": "BAUDE", "prenom": "Véronique", "sexe": "F", "naissance": "1968-11-10", "nuance": "LR",
                "tour": 1, "sortant": false, "personnalite": null, "senateur": "21674D" } ] } ] }
```

- `mode`: `proportionnel` (list vote, 30 constituencies; results are lists with seats) or `majoritaire`
  (34 constituencies; results are candidates with `elu`, a second round for 14 of them).
- `resultats` are sorted by votes. `pctExprimes` is a number (the CSV's "38,50 %").
- `nuance` is the Ministry's code (`LR`, `SOC`, `DVD`… for candidates and winners; `LLR`, `LDVG`… for lists).
  Labels are **not** included: the dataset does not ship the nuance grid.
- `elus[].senateur` links a winner to `senateurs.json` (same name and birth date). 177 of 178 link; the exception
  is Françoise Gatel (Ille-et-Vilaine), who is not a sitting senator today.
- `personnalite` is the Ministry's code for the winner's other office (`SEN` outgoing senator, `DEP`, `MIN`, …).

## Sources and licence

| Data | Source | Format | Licence |
|---|---|---|---|
| Sitting senators: group code and label, constituency, series, seat, photo, page, declared X / Facebook | `https://www.senat.fr/api-senat/senateurs.json` (linked from data.senat.fr "Les sénateurs") | JSON | Licence Ouverte (Sénat) |
| Birth date, profession, PCS, e-mail, Bureau office | `data.senat.fr/data/senateurs/ODSEN_GENERAL.json` | JSON (also CSV/XLS) | Licence Ouverte (Sénat) |
| Mandates (current mandate, continuous service) | `ODSEN_ELUSEN.json` | JSON | idem |
| Current committees | `ODSEN_CUR_COMS.json` | JSON | idem |
| Group colours | `hemicycle-groups` widget on `https://www.senat.fr/` (official colours used by the Sénat) | HTML attribute (JSON) | idem |
| HATVP link, LinkedIn / Instagram / website… | Contact block of each senator's page on senat.fr | HTML | idem |
| Votes list per session | `https://www.senat.fr/scrutin-public/scr<year>.html` | HTML | idem |
| Vote title, date, outcome, totals, dossier | `…/scrutin-public/<year>/scr<year>-<n>.html` | HTML | idem |
| Each senator's position | `…/scrutin-public/<year>/scr<year>-<n>.json` (feeds the hemicycle on the vote page) | JSON | idem |
| 2026 elections | data.gouv.fr dataset "Elections sénatoriales 2026 - Résultats" (Ministère de l'Intérieur): elected, round 1 (majoritarian and list), round 2 | CSV `;` | Licence Ouverte 2.0 |
| Social accounts (complement) | Wikidata, joined on P1808 (Sénat id `senateur/<slug>`) | SPARQL | CC0 |

The Sénat's licence (`https://data.senat.fr/licence/`) is the Licence Ouverte: reuse is free, including
commercial, provided the source ("Sénat") and the date of last update are credited. `meta.json` keeps every source
URL. data.senat.fr has no scrutin dataset; the vote JSON files on www.senat.fr are the only machine-readable
nominative source. The senatoriales2026.senat.fr site also publishes results CSVs; the Ministry's data.gouv files
are used because they are the official source and carry the list of winners with birth dates.

**Photos** are linked (official URL on senat.fr), not copied. They belong to the Sénat; check its terms before
re-hosting them.

## Social accounts

Same approach as the MPs (`docs/data-socials.md`), with fewer steps:

1. **senat**: what the senator declared: X and Facebook in the senators API, and every link in the "Contact" block
   of their senat.fr page (LinkedIn, Instagram, Bluesky, YouTube, personal site…). `high`.
2. **wikidata**: P2002, P2003, P6634, P2013, P12361, P7085, P2397, P4033, P856, joined on P1808.
   346 of 348 senators have an item. `high`.
3. **site**: the senator's own site (declared on senat.fr, else Wikidata P856): homepage plus one contact / about
   page, respecting robots.txt, 1.2 s between requests to a host. A handle carrying the senator's name is `high`,
   otherwise `medium`; LinkedIn links without the name, accounts linked from two or more senators' sites (party
   accounts), share buttons and posts are dropped. 39 of 108 sites could not be read (down, 403, robots.txt).
4. **override**: optional `data/senat-socials-overrides.csv` (not created yet), same columns as the MPs' file
   with `senator_id` in place of `mp_id`; an empty `url` removes the platform.

Institutional accounts (`@senat`, `publicsenat`, parties) are rejected. A stronger source wins; agreeing sources
go to `confirmedBy`, disagreeing ones to `meta.socials.conflicts` (92, mostly an old and a new account).
Not done for senators (unlike MPs): Bluesky search, group pages, link-in-bio pages, AI arbitration.

Coverage (2026-11-07, 348 senators): after senat → + Wikidata → + own sites

| | X | Instagram | LinkedIn | Facebook | Bluesky | TikTok | YouTube | Mastodon | website |
|---|---|---|---|---|---|---|---|---|---|
| senat | 208 | 34 | 113 | 242 | 1 | 1 | 3 | 0 | 48 |
| + Wikidata | 247 | 47 | 127 | 256 | 12 | 3 | 7 | 2 | 108 |
| + own sites | **247** | **63** | **132** | **260** | **15** | **6** | **24** | **3** | **108** |

291 of 348 senators have at least one social account.

## Coverage and checks (run of 2026-11-07)

- **Senators: 348**, the Sénat's full membership. The senators API and ODSEN_GENERAL (state `ACTIF`) agree
  (348 / 348, same matricules). Series 1: 170, series 2: 178. By group, the counts equal the seats in the
  Sénat's hemicycle widget: LR 124, UC 63, SER 62, CRCE-K 18, RDSE 18, RDPI 16, GEST 15, UNT 15, Les Indépendants 14,
  NI 3. Every group has its official colour.
- **Votes: 978** = every vote listed by the Sénat for sessions 2023-2024 (215), 2024-2025 (367), 2025-2026 (340)
  and 2026-2027 so far (56, last on 2026-11-05). All 978 have a date, title, outcome and published totals.
- **Positions**: 973 votes have each senator's position. Gaps, listed in `meta.checks.votes.noNominativeList`
  and retried on every run:
  - 2023-87 and 2023-101 have no JSON file (404); their names appear only in the page text.
  - 2023-98, 2023-99 and 2023-100: the JSON file holds a neighbouring vote's list (its counts equal the published
    totals of the next vote), so these positions are dropped rather than misattributed.
- 30 more votes (2024-93, 2024-150…171, 2024-196, 2025-25…28, 2025-56, 2025-293) have published totals that differ
  from the nominative list by 1 or 2 (usually one senator counted "n'a pas pris part" in the total but listed as
  voting). Positions are kept; the published totals are kept in `scrutins.json`. Details in `meta.checks.totalsMismatches`.
- **Field gaps**: HATVP link missing for 47 senators, all elected in September 2026 (declarations not yet
  published); profession missing for 25; e-mail not public for 14; Wikidata item missing for 2.
- **Elections**: 64 constituencies (series 2), 178 winners = 178 seats; 159 elected in round 1, 19 in round 2.

## Limits

- **Participation is not attendance.** In the Sénat, a group's delegate casts the votes of the whole group in a
  public vote, so most senators "vote" in ~99 % of votes (mean 0.967). Low figures mean the senator is outside
  that system for all or part of the window: the President of the Sénat (Gérard Larcher) by custom does not vote
  (0.1 %); the lowest others are Durox, Hochart and Szczurek (UNT, ~33 % over 973 votes) and the two NI senators
  elected in 2026, Amard (52 %) and Mougenot (2 %) over 56 votes. Present this carefully in the UI.
- The window starts with session 2023-2024 (the Sénat has no legislature; `FIRST_SESSION` in the script). Senators
  elected in 2026 only have votes from October 2026 (56 so far). Former senators' positions are not kept.
- Votes already stored are not refetched, except the last 14 days and the gaps above. If the Sénat corrects an
  older vote, run with `--full`.
- Vote pages are HTML: if senat.fr changes its markup, the script warns (`could not read date / outcome / totals`).
- Election results are provisional as published by the Ministry (subject to appeals before the Conseil
  constitutionnel). Nuance labels are not included.
- Senator pages, own sites and Wikidata are refreshed weekly, so a new account can take up to 7 days to appear.

## Automatic refresh

`.github/workflows/sync-senat.yml` runs every day at 06:15 UTC and on demand ("Sync Sénat data").
- It reuses the committed votes, so a normal run makes ~70 requests to senat.fr; the weekly page refresh adds
  ~350 senat.fr pages, ~110 senators' sites and one Wikidata query.
- It commits `public/data/senat/` and `data/senat-cache.json` only when real data changed: `scripts/data-changed.mjs`
  for `senateurs.json`, `scrutins.json`, `elections-2026.json` (its `fetchedAt` is ignored) and the cache, plus
  `git status` on `votes/`. `meta.json` alone (timestamp) never triggers a commit.
- It runs `git pull --rebase` before pushing, because other jobs push to the same branch.

There is no `package.json` script for this (out of scope); the workflow calls the script directly.
