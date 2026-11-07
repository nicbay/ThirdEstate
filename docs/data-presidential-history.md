# Data: history of French presidential elections (1848–2022)

Data only. The UI will be built later on the new design. It covers all 30 presidential elections (63 ballots): 1848 (direct, men only), the Third Republic votes by the National Assembly / Congress (1873–1939), the Fourth Republic Congress votes (1947, 1953), the 1958 electoral college, and every Fifth Republic direct election (1965–2022), both rounds.

## Run

```bash
node scripts/sync-presidential-history.mjs
```

- `node scripts/sync-presidential-history.mjs 1981 2022`: rebuilds only those elections. The index is rebuilt from every file on disk.
- `--verify-media`: re-checks each media URL live (YouTube oEmbed, ina.fr page title, Gallica OAI record). It writes a dated `check` object onto each media item.
- `PV_CACHE=<dir>`: caches downloads on disk while developing.

The data is historical, so run it once, or again when a source changes. It is not wired into `npm run sync` or CI, and `package.json` is untouched. A full run takes about 3 minutes. It is throttled to about 1 request per 1.2 s on Wikipedia.

There are no new dependencies. It uses `node-html-parser` (already a devDependency, used by `sync-polls.mjs`) and `fflate` (already a dependency) to unzip the Cagé–Piketty archive.

The curated media list is in `scripts/data/presidential-history-media.json`. The script merges it in. Editing that file and re-running is how media gets added or changed.

## Files

```
public/data/history/presidential/
  index.json          ~60 KB   summary of all 30 elections (for the timeline / list view)
  <id>.json           1–76 KB  one per election: all ballots, candidates, totals, departments, media
```

Election ids: `1848`, `1873`, `1879`, `1885`, `1887`, `1894`, `1895`, `1899`, `1906`, `1913`, `1920-01`, `1920-09`, `1924`, `1931`, `1932`, `1939`, `1947`, `1953`, `1958`, `1965`, `1969`, `1974`, `1981`, `1988`, `1995`, `2002`, `2007`, `2012`, `2017`, `2022`.

Round ids are `<election>-t<n>`, for example `1981-t2` or `1953-t13`. For Third and Fourth Republic Congress votes, a "round" is a ballot of the same sitting: 1887, 1895, 1913 and 1931 had 2 ballots, and 1953 had 13.

## Schema

### `index.json`

```jsonc
{
  "generatedAt": "ISO date",
  "doc": "docs/data-presidential-history.md",
  "colours": { "left": "red/pink", "right": "blue", "centre": "neutral", "other": "grey" },
  "elections": [{
    "id": "1981", "year": 1981,
    "title": { "fr": "...", "en": "..." },
    "regime": "IIe" | "IIIe" | "IVe" | "Ve",
    "method": { "fr": "...", "en": "..." },
    "direct": true,                       // popular vote (1848, 1965+)
    "winner": { "id", "name", "party", "family", "side" },
    "file": "1981.json",
    "rounds": [{
      "id": "1981-t1", "round": 1, "date": "1981-04-26", "decisive": false,
      "turnoutPct": 81.09 | null, "exprimes": 29038117,
      "top": [{ "id", "name", "party", "side", "pct", "votes" }],   // top 2 (decisive direct) or 3
      "departments": 96,                  // number of department rows in the election file (0 = none)
      "media": { "type": "tv", "url": "..." } | null
    }]
  }]
}
```

### `<id>.json`

```jsonc
{
  "id", "year", "title", "regime": { "id", "fr", "en" }, "method", "direct", "winner",
  "media": { ... } | null,                // pointer to the last round's media
  "sources": { "national": Source },
  "generatedAt": "ISO date",
  "rounds": [{
    "id": "1981-t2", "round": 2,
    "date": "1981-05-10", "dateEnd"?: "1848-12-11",   // 1848 voting lasted two days
    "decisive": true,                     // the ballot that elected the president
    "totals": {
      "inscrits": n | null,               // registered voters (members of Congress for indirect votes; often unknown before 1920)
      "votants": n | null, "abstention": n | null,
      "blancsNuls": n | null, "blancs"?: n, "nuls"?: n,   // blank and spoilt ballots are split from 2017
      "exprimes": n,                      // valid votes
      "majorite"?: n                      // required majority, when the table gives it
    },
    "turnoutPct": 85.85 | null,           // computed as votants / inscrits
    "candidates": [{                      // sorted by votes, descending
      "id": "francois-mitterrand",        // slug of the name, stable across rounds of one election
      "name": "François Mitterrand",
      "party": "PS",                      // label as given by the source table
      "family": Family, "side": "left" | "centre" | "right" | "other",
      "votes": 15708262, "pct": 51.76,    // pct of valid votes, as published
      "elected"?: true, "qualified"?: true,   // qualified = Fifth Republic first-round top two
      "other"?: true                      // aggregated "Autres candidats" row (id "autres")
    }],
    "winner": "francois-mitterrand" | null,
    "checks": ["..."],                    // internal inconsistencies of the source table (see Known gaps)
    "sources": { "national": Source, "departments"?: DeptSource },
    "departments": null | {
      "source": DeptSource,
      "count": 96,
      "sumExprimes": 29774401, "nationalExprimes": 30350568,
      "coveragePct": 98.1,                // share of national valid votes covered by the rows
      "rows": { "<dept code>": { "name", "inscrits", "votants", "exprimes", "votes": { "<candidate id>": n } } }
    },
    "media": Media | null,
    "mediaAlternatives"?: [Media],        // other verified items (up to 2)
    "mediaSearched"?: "what was searched when media is null",
    "mediaLeads"?: [Lead]                 // UNVERIFIED pointers (see Media); never display as the round's media
  }]
}

Source     = { name, page, permalink, revid, licence, cites: [{ url, label }], note }
DeptSource = { name, dataset, resource, title?, licence, unit }
Media      = { type: "tv"|"radio"|"newsreel"|"newspaper", provider, url, embed|null, start?: seconds,
               title, publisher, date|null, evidence, verifiedAt, check?: { ok, title, publisher?, at } }
Lead       = { type, provider, publisher, url, date, status }
Family     = "extreme-gauche"|"gauche"|"centre-gauche"|"ecologiste"|"centre"|"centre-droit"|"droite"|"extreme-droite"|"divers"
```

Department codes are INSEE style: `01`…`95`, `2A`/`2B`, `971`…`988`, and `99` for French citizens abroad. Mayotte's old CDSP code `985` is mapped to `976`, and the 2017 Ministry codes `ZA`… are mapped to INSEE codes. Codes match `public/data/geo/departements.geojson` from 1969 onward. Older files use the boundaries of their time; see Known gaps.

Colour convention: `side` drives the colour. Left (including ecologists) is red/pink, right is blue, centre is neutral, `divers` is grey. `family` and `side` are an editorial classification made for this site, based on each party's position in the chamber or politics of its time (for example "Républicains de gouvernement" in the 1880s are `centre-gauche`). The mapping is the `FAMILY` table in the script, so it is easy to review.

## Sources and licences

| Data | Source | Licence | Notes |
|---|---|---|---|
| National results, all ballots | fr.wikipedia results table of each election page, fetched through the MediaWiki API and pinned to a revision (`permalink`/`revid`) | CC BY-SA 4.0 (attribution and share-alike apply to data derived from it) | Each table's own references are kept in `sources.national.cites`. They are the Conseil constitutionnel proclamation decisions (1965+), the Journal officiel on Gallica, and the MJP database (Université de Perpignan) for older votes. That gives a primary-source URL for every figure. |
| Departments 1848 | Julia Cagé & Thomas Piketty, *Une histoire du conflit politique* (Seuil, 2023), file `pres1848_csv.zip`, commune-level data summed by department | No formal licence. The site says the data can be downloaded freely and asks that the source be cited | Reconstructed from the archived minutes of the vote. It covers 94.5% of national valid votes; some communes are missing. |
| Departments 1965–2012 | Sciences Po CDSP, dataset "Elections présidentielles 1965-2012" on data.gouv.fr ([54aeb906…](https://www.data.gouv.fr/datasets/54aeb906c751df6643de6534/)), constituency files summed by department | ODbL | Data comes from the BDSP/CDSP up to 2002 and from the Ministry from 2007. |
| Departments 2017 | Ministère de l'Intérieur, "Résultats définitifs" for round 1 and round 2 (xls by canton, read through the data.gouv tabular API), summed by department | Licence Ouverte / Etalab | |
| Departments 2022 | Ministère de l'Intérieur, "Résultats définitifs" for round 1 and round 2, department files (`resultats-par-niveau-dpt-…txt`) | The licence field is not set on data.gouv.fr. This is Ministry open data, published under Licence Ouverte like 2017 | |
| Media | INA (YouTube channels INA Politique, INA Histoire, etc., and ina.fr), TF1 INFO (2022), British Pathé / British Movietone (YouTube), Gallica (BnF) | Rights stay with the holders. We only link or embed (YouTube `youtube-nocookie.com` embeds, ina.fr pages, Gallica pages); nothing is re-hosted | |

Cagé–Piketty also publish commune-level files for every Fifth Republic election (`pres1965_csv.zip` … `pres2022_csv.zip`). They are not used here, because the CDSP and Ministry files are official and carry clear open licences.

## Coverage

| Election | Regime | Ballots | Winner | Department results (rows, % of national valid votes) | Media |
|---|---|---|---|---|---|
| 1848 | IIe | 1 | Louis-Napoléon Bonaparte | 92 (94.5%), Cagé–Piketty | none |
| 1873 | IIIe | 1 | Patrice de Mac Mahon | n/a (indirect) | none (leads) |
| 1879 | IIIe | 1 | Jules Grévy | n/a | none (leads) |
| 1885 | IIIe | 1 | Jules Grévy | n/a | none (leads) |
| 1887 | IIIe | 2 | Sadi Carnot | n/a | none (leads) |
| 1894 | IIIe | 1 | Jean Casimir-Perier | n/a | none (leads) |
| 1895 | IIIe | 2 | Félix Faure | n/a | none (leads) |
| 1899 | IIIe | 1 | Émile Loubet | n/a | none (leads) |
| 1906 | IIIe | 1 | Armand Fallières | n/a | none (leads) |
| 1913 | IIIe | 2 | Raymond Poincaré | n/a | none (leads) |
| 1920-01 | IIIe | 1 | Paul Deschanel | n/a | none (leads) |
| 1920-09 | IIIe | 1 | Alexandre Millerand | n/a | none (leads) |
| 1924 | IIIe | 1 | Gaston Doumergue | n/a | none (leads) |
| 1931 | IIIe | 2 | Paul Doumer | n/a | t2: newspaper (Le Temps, 15 May 1931, p. 1) + newsreel alternative |
| 1932 | IIIe | 1 | Albert Lebrun | n/a | newsreel (British Pathé) + Le Temps 12 May 1932 + Pathé-Journal |
| 1939 | IIIe | 1 | Albert Lebrun | n/a | newsreel (British Pathé) + Le Temps 7 Apr 1939 + Movietone |
| 1947 | IVe | 1 | Vincent Auriol | n/a | **radio** (ina.fr, Pierre Crenesse from Versailles, 16 Jan 1947) + Actualités Françaises + L'Humanité 17 Jan 1947 |
| 1953 | IVe | 13 | René Coty | n/a | t13: newsreel (ina.fr, Actualités Françaises 24 Dec 1953) + Le Figaro 24 Dec 1953 + British Pathé |
| 1958 | Ve | 1 | Charles de Gaulle | n/a (electoral college) | newsreel (ina.fr, Actualités Françaises 24 Dec 1958) |
| 1965 | Ve | 2 | Charles de Gaulle | 90 / 90 (98.0 / 97.9%) | t1 tv, t2 tv (compilation, start 0 s) |
| 1969 | Ve | 2 | Georges Pompidou | 95 / 95 (98.2 / 97.6%) | t1 tv (compilation 75 s), t2 tv (compilation 106 s) |
| 1974 | Ve | 2 | Valéry Giscard d'Estaing | 95 / 95 (98.1 / 97.9%) | t1 tv (compilation 148 s), t2 tv |
| 1981 | Ve | 2 | François Mitterrand | 96 / 96 (98.2 / 98.1%) | t1 tv (JA2 20H), t2 tv (full election night) |
| 1988 | Ve | 2 | François Mitterrand | 96 / 97 (97.9 / 97.7%) | t1 tv, t2 tv (JA2 20H) |
| 1995 | Ve | 2 | Jacques Chirac | 96 / 96 (97.8 / 97.6%) | t1 tv, t2 tv |
| 2002 | Ve | 2 | Jacques Chirac | 105 / 105 (99.5%) | t1 tv, t2 tv (ina.fr) |
| 2007 | Ve | 2 | Nicolas Sarkozy | 106 / 106 (100%) | t1 tv (compilation 538 s), t2 tv (ina.fr) |
| 2012 | Ve | 2 | François Hollande | 107 / 107 (100%) | t1 tv (compilation 636 s), t2 tv (compilation 714 s) |
| 2017 | Ve | 2 | Emmanuel Macron | 107 / 103 (100 / 98.2%) | t1 tv (compilation 681 s), t2 tv (compilation 759 s) |
| 2022 | Ve | 2 | Emmanuel Macron | 107 / 107 (100%) | t1 tv, t2 tv (TF1 INFO) |

Totals:
- **National results:** 63 of 63 ballots, each with a pinned source and its citations.
- **Department results:** 1848 and all 22 direct Fifth Republic rounds. They are not applicable for indirect elections (1873–1958).
- **Verified media:** 28 rounds (22 TV, 1 radio, 4 newsreel, 1 newspaper), plus 37 verified alternatives.
- **No media:** 13 elections, 1848–1924 (see below). The non-decisive ballots of multi-ballot Congress votes deliberately have no media; their media sits on the decisive ballot.

"Compilation" means one of INA Politique's two official compilations of 8 pm announcements from 1965 to 2017: [first rounds](https://www.youtube.com/watch?v=rvApHXLuxmA) and [second rounds](https://www.youtube.com/watch?v=YfzncBfAj4M). The `start` offset (seconds) comes from the chapter list in INA's own video description and is also applied to `embed` (`?start=`). They are used where INA has no standalone clip of that night. The full-night videos and standalone clips listed in `mediaAlternatives` are better whenever a UI can afford a long player.

### How media was verified (2026-11-07)

- **YouTube:** oEmbed returned 200, and `title` and `author_name` were recorded verbatim. The watch-page description was read to confirm the date or round. `playableInEmbed` was checked for the 1958–1988 items. Every YouTube and ina.fr URL was then re-checked by `--verify-media`: all passed, none failed.
- **ina.fr:** each page was fetched, and its title, broadcast date, duration and producer were checked.
- **Gallica:** Gallica answers scripts with a Cloudflare 403. The issue dates (from the issue record and page title) and the result text (from Gallica's in-issue full-text search, with the snippet recorded in `evidence`) were checked by hand in a browser. `--verify-media` reports these as `ok: null` ("not checkable automatically") rather than as failures.

## Known gaps

1. **No verified media for 1848 or for 1873–1924 (13 elections).**
   - Gallica blocks automated clients: Cloudflare 403, then a rate limit (error 1015), then an ALTCHA "je ne suis pas un robot" challenge. The challenge was not bypassed.
   - For 1873–1924, the issues of *Le Temps* (an evening paper, so the result is in the issue dated the day after the vote) were identified from Gallica's Issues service. They are stored as `mediaLeads`: date verified, content **not** verified.
   - 1848 was not searched: *Le Temps* did not exist yet, so a paper such as the Journal des débats, Le Constitutionnel or Le Siècle is needed.
   - To finish: in a normal browser session, open each lead (or use Gallica's in-issue search for the winner's surname), confirm the page that reports the result, and move it from `leads` to `media` in `scripts/data/presidential-history-media.json` with the `evidence` filled in.
   - The 1887 Wikipedia citation also points to the Journal officiel of 4 Dec 1887 on Gallica ([bpt6k63491873](https://gallica.bnf.fr/ark:/12148/bpt6k63491873)). That is the official record, not a press front page.
2. **Radio exists for only one radio-era vote (1947).** ina.fr, Gallica sound recordings and YouTube (including radio-archive channels) were searched for 1931, 1932, 1939 and 1953. INA has nothing online for those results, so the newsreel or newspaper fallback is used, as labelled by `type`. A second 1947 radio item exists on ina.fr: phd85002898, Auriol thanking Parliament (6 min).
3. **Media quality caveats:**
   - The 1931 newsreel shows the president-elect posing, not the announcement, so the *Le Temps* front page is the primary item for 1931.
   - The 1932 and 1939 primaries are British Pathé newsreels in English. The French Pathé-Journal copy for 1932 comes from a re-upload channel ("ArchivesRadio") and is listed only as an alternative.
   - 1958 has no TV item; the newsreel aired three days after the vote.
   - 2022 has no INA copy online, so TF1 INFO's own channel is used. Its 2022-t1 title gives the 8 pm *estimates* (28.6 / 23.9%), not the final figures.
   - 1981-t2 is the full 4 h 26 election night with no 8 pm offset recorded.
   - Three British Pathé items have `date: null` because their descriptions give no release date.
4. **Department boundaries in 1848 and 1965.**
   - 1965 rows use pre-1968 departments: `75` is the whole Seine and `78` is Seine-et-Oise; `91`–`95` do not exist yet. Corsica is `20` until 1974.
   - 1848: Cagé–Piketty assign each 1848 commune to its **present-day** department, so codes match `departements.geojson`. Savoie, Haute-Savoie and most of Alpes-Maritimes (`73`, `74`, `06`, not French in 1848) are absent, as is Algeria. The result is 92 rows.
   - So the 1965 rows do not map one-to-one onto `departements.geojson`: `75` and `78` there mean the old departments, not today's. Join by `code` for 1848 and from 1969 onward only.
5. **Department coverage below 100%:**
   - 1965–1995 files are metropolitan France only (about 98% of national valid votes; no overseas departments or voters abroad).
   - 2002 covers 99.5%.
   - The 2017 round-2 Ministry canton file has no rows for `99` (abroad), `975`, `977` or `986`, which leaves 98.2%.
   - `coveragePct` in each round states this exactly.
6. **National figures come through Wikipedia.** They are not parsed directly from the Conseil constitutionnel or Journal officiel. Every table cites them in `cites`, and the revision is pinned. Sums of department results differ slightly from the national figures, because the proclaimed results include corrections and votes from abroad and overseas.
7. **Source-table inconsistencies,** kept as published and listed in `checks`:
   - 1913 t1/t2: 2 and 15 valid votes not attributed to any candidate row.
   - 1920-01: inscrits 928 ≠ votants + abstention 948.
   - 1953 t5: the table's participation 87.89% is a typo for 97.89% (the computed value is used).
   - 1953 t7: 10 valid votes not attributed to any candidate row.
   - Registered members (`inscrits`) of Congress are unknown on the source pages for 1885–1913, 1931 and 1932, so `turnoutPct` is null for those votes.
8. **Not included:**
   - Thiers (1871, "chef du pouvoir exécutif", made president by the loi Rivet, with no election).
   - The Republican caucus "scrutins préparatoires" before Congress votes. They appear on the source pages but were not official and are skipped on purpose.
   - Interim presidents.
