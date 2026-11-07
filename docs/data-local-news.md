# Local news per commune: data pipeline

Recent local press items for every French commune page ("My town"). Items come from the free RSS feeds that regional and local outlets publish. Each item is matched to the communes it names, but only inside the departments the feed covers. We store the title, link, date, outlet and a summary of at most 200 characters. We never store the article itself.

Script: `scripts/sync-local-news.mjs`. Feed list: `scripts/data/local-news-feeds.json`. RSS helpers: `scripts/lib/rss.mjs` (the `sync-news.mjs` parser plus conditional GET). Output: `public/data/news/`. Workflow: `.github/workflows/sync-local-news.yml`, every 3 hours, concurrency group `local-news`.

```bash
node scripts/sync-local-news.mjs                    # fetch, match, write
node scripts/sync-local-news.mjs --offline          # no network: re-match the cached items (to test rule changes)
node scripts/sync-local-news.mjs --explain 84007,75113   # also print each matched item of these communes, with the rule that matched it
```

## Output

`public/data/news/<department>.json`, one file for each of the 101 departments (`01` … `95`, `2A`, `2B`, `971` … `976`):

```jsonc
{
  "generatedAt": "2026-11-07T14:09:31.000Z", // last time this file's content changed
  "department": "84",
  "name": "Vaucluse",
  "windowDays": 14,
  "feeds": [ { "id": "france3-84", "outlet": "France 3 Régions", "url": "https://…/vaucluse/rss", "scope": "department" }, … ],
  "communes": {
    "84007": [ // INSEE code; Paris/Lyon/Marseille arrondissements use their own codes (75113, 69385, 13208…)
      { "title": "…", "link": "https://…", "time": "2026-11-07T13:10:00.000Z", "outlet": "La Provence", "summary": "≤ 200 characters" }
      // newest first, at most 15 items, none older than 14 days
    ]
  }
}
```

Communes with no item are left out of `communes`. `public/data/news/index.json` holds, for each department, the number of feeds, communes, communes with news and distinct items, plus each feed's `ok` flag from the last run and run totals.

`time` comes from the feed's `pubDate`. Le Parisien feeds have no date: there we use the DD-MM-YYYY in the URL, or the time we first saw the item (the same rule as `sync-news.mjs`). If a date is more than 10 minutes in the future (for example an event date), we use the first-seen time instead.

## Pipeline and idempotency

1. **Item store.** `.cache/local-news/items.json` holds every item of the last 14 days, with the feeds it appeared in. The script also reads back the committed `public/data/news/*.json`, so a cold cache (a new CI runner) keeps the matched history. The workflow restores `.cache/local-news` with `actions/cache`.
2. **Fetch.** We make a conditional GET (`If-None-Match` / `If-Modified-Since`) for each feed, with at most 8 requests in flight and at least 400 ms between two requests to the same host. The last body is kept in `.cache/local-news/feeds/<id>.xml`. If a fetch fails, the copy from the last 24 hours is used.
3. **Match** (rules below), keep the 15 newest items per commune, and write.
4. **Write only on change.** A file is rewritten only when something other than `generatedAt` changes. The workflow therefore commits only when the data changed: it runs `git add public/data/news` and commits only if `git diff --cached` is not empty. This is the same idea as `scripts/data-changed.mjs`, which only knows about the `fetchedAt` key. Running the script twice offline writes 0 files.

## Feeds

We tested more than 300 candidate feeds on 2026-11-07, and 261 feeds remain in use. Each one answered HTTP 200 with RSS items at that date, without being redirected to a generic feed. `scripts/data/local-news-feeds.json` records each feed's `url`, `outlet`, `departments` (the departments whose communes its items may match), `scope` and `checked` (the item count and newest item date at verification time).

| Outlet | Feeds | Scope | Departments | Example URL |
|---|---|---|---|---|
| France 3 Régions | 105 | department, region | 96 departments | `https://france3-regions.franceinfo.fr/auvergne-rhone-alpes/ain/rss` |
| ici | 45 | multi, department | 89 departments | `https://www.ici.fr/rss/107-1/a-la-une.xml` |
| Le Dauphiné libéré | 9 | department | 01 05 07 26 30 38 73 74 84 | `https://www.ledauphine.com/isere/rss` |
| Le Progrès | 5 | department | 01 39 42 43 69 | `https://www.leprogres.fr/rhone/rss` |
| L'Est Républicain | 5 | department | 25 54 55 70 90 | `https://www.estrepublicain.fr/meurthe-et-moselle/rss` |
| Vosges Matin | 1 | department | 88 | `https://www.vosgesmatin.fr/vosges/rss` |
| L'Alsace | 1 | department | 68 | `https://www.lalsace.fr/haut-rhin/rss` |
| Le Bien Public | 1 | department | 21 | `https://www.bienpublic.com/cote-d-or/rss` |
| Le Journal de Saône-et-Loire | 1 | department | 71 | `https://www.lejsl.com/saone-et-loire/rss` |
| Le Républicain lorrain | 1 | multi | 54 57 | `https://www.republicain-lorrain.fr/rss` |
| Dernières Nouvelles d'Alsace | 1 | department | 67 | `https://www.dna.fr/rss` |
| Midi Libre | 8 | department | 11 12 13 30 34 48 66 84 | `https://www.midilibre.fr/herault/rss.xml` |
| L'Indépendant | 2 | department | 11 66 | `https://www.lindependant.fr/aude/rss.xml` |
| Sud Ouest | 12 | department | 16 17 19 24 32 33 40 47 64 65 79 87 | `https://www.sudouest.fr/gironde/rss.xml` |
| Le Parisien | 14 | department | 02 10 27 28 45 60 75 77 78 91 92 93 94 95 | `https://feeds.leparisien.fr/leparisien/rss/paris-75` |
| La Dépêche du Midi | 27 | multi, city | 09 11 12 31 32 46 47 65 81 82 | `https://www.ladepeche.fr/rss.xml` |
| Nice-Matin | 2 | city | 06 | `https://www.nicematin.com/alpes-maritimes/nice/rss` |
| Monaco-Matin | 1 | multi | 06 | `https://www.nicematin.com/monaco/rss` |
| Var-Matin | 1 | department | 83 | `https://www.nicematin.com/var/rss` |
| La Provence | 1 | multi | 04 05 13 84 | `https://www.laprovence.com/rss/region.xml` |
| La Nouvelle République | 5 | department | 36 37 41 79 86 | `https://www.lanouvellerepublique.fr/api/v1/rss/5e20725dcc4d8d75408b458d` |
| Charente libre | 1 | department | 16 | `https://www.charentelibre.fr/rss.xml` |
| La République des Pyrénées | 1 | department | 64 | `https://www.larepubliquedespyrenees.fr/rss.xml` |
| Centre Presse Aveyron | 1 | department | 12 | `https://www.centrepresseaveyron.fr/rss.xml` |
| Corse Net Infos | 1 | multi | 2A 2B | `https://www.corsenetinfos.corsica/xml/syndication.rss` |
| Zinfos 974 | 1 | department | 974 | `https://www.zinfos974.com/general-rss` |
| Imaz Press Réunion | 1 | department | 974 | `https://imazpress.com/feed` |
| Le Journal de Mayotte | 1 | department | 976 | `https://lejournaldemayotte.yt/feed/` |
| Mayotte Hebdo | 1 | department | 976 | `https://www.mayottehebdo.com/feed/` |
| L'Info Kwézi | 1 | department | 976 | `https://www.linfokwezi.fr/feed/` |
| Guyaweb | 1 | department | 973 | `https://www.guyaweb.com/feed/` |
| Karib'Info | 1 | multi | 971 972 973 | `https://www.karibinfo.com/feed/` |
| Antilla | 1 | department | 972 | `https://antilla-martinique.com/feed/` |
| Outremers360 | 1 | multi | 971 972 973 974 976 | `https://api.outremers360.com/rss/fil-info.xml` |

Notes:
- **France 3 Régions**: one feed per metropolitan department, at `/<region>/<department>/rss`, plus the 13 regional feeds. Indre-et-Loire, Loir-et-Cher, Nord and Pas-de-Calais have no department feed (the URL redirects to the national `/actu/rss`), so those four departments rely on the regional feed and other outlets. The Haute-Loire feed was stale at verification time (newest item 13 October).
- **ici** (formerly France Bleu): 45 local stations, at `/rss/<station>/a-la-une.xml`. The first item of every station feed is a national headline, which the department restriction neutralises. Station coverage follows each station's broadcast area (for example `ici Provence` covers 13, 83 and 04, and `ici 107.1` covers Île-de-France).
- **La Dépêche du Midi**: the national feed covers its 10 departments, and there are per-commune feeds (`/communes/<slug>,<INSEE>/rss.xml`) for 26 towns: towns of 15,000+ inhabitants plus the prefectures. The towns are Foix, Pamiers, Carcassonne, Narbonne, Millau, Rodez, Balma, Blagnac, Castanet-Tolosan, Colomiers, Cugnaux, Muret, Plaisance-du-Touch, Ramonville-Saint-Agne, Toulouse, Tournefeuille, Auch, Cahors, Agen, Marmande, Villeneuve-sur-Lot, Tarbes, Albi, Castres, Gaillac and Montauban. These feeds also contain area news, so they go through the same name matching. Narbonne and Millau were stale at verification time.
- **Le Parisien** department feeds (`/rss/<slug>-<code>`) mix in other departments' stories and have no description. An item filed under `/val-de-marne-94/`-style URL paths is restricted to that department. This rule also applies to ici, whose URLs contain `/vaucluse-84/`.
- **Feeds not used**: these outlets answer HTTP 403 to automated readers or offer no per-area feed, so they are left out, as `sync-news.mjs` does: Ouest-France (only `/rss/une` works, a national front page), Le Télégramme, La Voix du Nord, Courrier picard, L'Union, L'Est-Éclair, L'Ardennais, Nord Littoral, Paris-Normandie, actu.fr, Clicanoo, Linfo.re, La Gazette des communes. The following outlets publish no RSS that we could find: La Montagne, Le Populaire, Le Berry républicain, L'Yonne républicaine, La République du Centre, Le JDC, Corse-Matin, France-Antilles, La 1ère (all `…/rss` URLs answer with HTML), and franceinfo's DOM tag feeds (empty). We also dropped these: La Provence `rss/actualites.xml` (its items date from 2023), Nice-Matin feeds other than Nice, Cannes, Var and Monaco (HTTP 406), and Blada (Guyane, feed frozen).

## Matching rules

A wrong match is worse than a missing one, so every rule below errs on the side of no match.

1. **Area.** An item can match only the communes of the departments its feed covers. If an item appears in several feeds, the area is the intersection of their departments, or their union if the intersection is empty. A `/<department>-<code>/` URL segment narrows the area to that department.
2. **Name.** We compare whole words on an accent-free, lower-case form, with hyphens equal to spaces and `St`/`Ste` read as `Saint`/`Sainte`. The name must start with a capital letter in the text, so `orange`, `tours` or `sens` written as ordinary words never match. When names overlap, the longest wins, so `Saint-Rémy-de-Provence` beats `Saint-Rémy`. Names that start with an article accept its contracted forms: `Le Mans` matches "au Mans" and "du Mans", and `Les Sables-d'Olonne` matches "aux Sables". A name that is part of a longer hyphenated word is rejected ("Nice-Matin", "Paris-Saclay", "Toulouse-Lautrec", "Avignon-Carpentras").
3. **Not the commune.** A mention is rejected when the word before it shows it is something else:
   - a street: "rue de Carpentras", "porte de Clichy", "avenue d'Avignon";
   - a building: "église Saint-Pierre", "lycée Saint-Exupéry", "Institut Sainte-Catherine", "Château Saint-Georges";
   - another place: "près de", "au sud de", "en direction de", "CHU de", "tribunal de";
   - a station name: "ICI La Rochelle", "France Bleu Isère";
   - an article in front of a name that has none: "la Fontaine ardente", "le Paris de …".

   One-word names are also rejected when they sit next to another capitalised word, as in a person or a club ("Pierre Laval", "OGC Nice", "Toulouse FC"), or after a particle of a name ("Richard de Méritens de Villeneuve", "Pays de Gex").
4. **Stricter names** need a locating context. These are one-word names of communes under 2,000 inhabitants; names of 3 letters or fewer for towns under 10,000; and names that the last 14 days of feeds also use as ordinary lower-case words (counted automatically, for example `rives`, `paris` for bets, `créances`). The context can be "à / au / en / sur X", "commune / village / maire / secteur / château de X", the title prefix used by local papers ("Mazan. …", "Pons : …"), or the department right after the name ("Lent (Ain)", "Sarry, dans l'Yonne", "(01)", a postcode). Two-letter names (Eu, Ay, By) need "à/en/sur" before them. One-letter names (Y) are never matched.
5. **Homonyms.**
   - Within the item's area: if several communes share the name, the one the text locates (department named, "(dd)" or postcode) wins. Otherwise the largest wins, but only if it has at least 5,000 inhabitants and 10 times the population of the next one. Otherwise the mention is skipped.
   - Outside the area: if a commune with the same name elsewhere has at least 5,000 inhabitants and 3 times the population, the text must locate our commune. This stops "Valence" in a Charente feed from going to Valence (16).
   - Short forms: a commune is skipped when a larger commune of the same area has a longer name that starts with it ("Villeneuve" → Villeneuve-Tolosane, "Saint-Denis" → Saint-Denis-de-Pile).
6. **Never matched by name.** These are communes whose name is also:
   - a department or region name: Vienne (38), Allier (65), Indre (44), Doubs (25), Bretagne, Champagne, La Réunion (47)…;
   - a historic province or "pays";
   - a river: Seine, Garonne, Durance…;
   - a foreign city: Venise (25), Sion, Rome…;
   - a planet: Mars;
   - a seat of government or a politician used as a metonym: Matignon, Beauvau, Brienne, Solférino, Chirac, Castex, Borne, Lagarde…

   This covers 51 communes. `Orange`, `Vittel`, `Volvic` and `Cognac` are skipped when the item reads like news about the company or the product (telecom words, mineral water, spirits).
7. **Paris, Lyon, Marseille arrondissements** match "11e arrondissement (de Paris)", "XIe arrondissement", "Paris 11e", "Lyon 3e", "Marseille 13e" and the postcodes 75011 / 69003 / 13008. A mention without the city name counts only when the item's area contains just one of the three cities. An arrondissement match also adds the item to the city.
8. **Listings.** An item that names more than 8 communes keeps only the ones in its title. If its title alone names more than 8, it matches none.

The text matched is the title plus the stored summary, so a re-match (`--offline`, or after a rule change) uses exactly the published data.

## Coverage

These are the numbers for the first run (2026-11-07). The store held 5,656 items from the last 14 days, but most feeds only list their latest 10 to 100 items, so the first run only reaches a few days back. Coverage grows as the store fills up over 14 days of 3-hourly runs. In this run, 2,503 items matched at least one commune, and 1,115 communes and arrondissements (of 34,875 communes and 45 arrondissements) had at least one item, in all 101 departments.

| Commune size | Communes | With ≥1 item |
|---|---|---|
| 20,000+ inhabitants | 484 | 276 |
| 5,000 – 19,999 | 1,767 | 327 |
| under 5,000 | 32,624 | 506 |
| Paris / Lyon / Marseille arrondissements | 45 | 6 |

Every department has at least 2 feeds. The thinnest are Nord and Pas-de-Calais (2 feeds: no France 3 department feed, and La Voix du Nord blocks readers), Guadeloupe (2) and the other DOM (3–4).

Per department (communes with news include Paris/Lyon/Marseille arrondissements; `communes` counts communes only):

| Dept | Name | Feeds | Communes with ≥1 item / communes | Distinct items |
|---|---|---|---|---|
| 01 | Ain | 4 | 16 / 391 | 28 |
| 02 | Aisne | 4 | 4 / 797 | 5 |
| 03 | Allier | 3 | 5 / 317 | 5 |
| 04 | Alpes-de-Haute-Provence | 4 | 1 / 198 | 1 |
| 05 | Hautes-Alpes | 4 | 4 / 162 | 12 |
| 06 | Alpes-Maritimes | 6 | 19 / 163 | 71 |
| 07 | Ardèche | 4 | 13 / 335 | 18 |
| 08 | Ardennes | 3 | 6 / 447 | 14 |
| 09 | Ariège | 6 | 11 / 325 | 38 |
| 10 | Aube | 4 | 5 / 431 | 13 |
| 11 | Aude | 8 | 16 / 433 | 30 |
| 12 | Aveyron | 7 | 17 / 285 | 44 |
| 13 | Bouches-du-Rhône | 5 | 15 / 119 | 36 |
| 14 | Calvados | 3 | 7 / 526 | 23 |
| 15 | Cantal | 3 | 2 / 250 | 2 |
| 16 | Charente | 4 | 12 / 359 | 26 |
| 17 | Charente-Maritime | 4 | 16 / 462 | 35 |
| 18 | Cher | 3 | 4 / 286 | 13 |
| 19 | Corrèze | 4 | 8 / 277 | 10 |
| 21 | Côte-d'Or | 4 | 7 / 698 | 25 |
| 22 | Côtes-d'Armor | 4 | 7 / 344 | 12 |
| 23 | Creuse | 3 | 12 / 255 | 27 |
| 24 | Dordogne | 4 | 21 / 503 | 38 |
| 25 | Doubs | 5 | 16 / 563 | 40 |
| 26 | Drôme | 4 | 14 / 362 | 34 |
| 27 | Eure | 4 | 8 / 585 | 18 |
| 28 | Eure-et-Loir | 4 | 5 / 363 | 7 |
| 29 | Finistère | 3 | 11 / 277 | 28 |
| 2A | Corse-du-Sud | 4 | 8 / 124 | 36 |
| 2B | Haute-Corse | 4 | 16 / 236 | 42 |
| 30 | Gard | 5 | 23 / 350 | 45 |
| 31 | Haute-Garonne | 14 | 38 / 586 | 153 |
| 32 | Gers | 6 | 7 / 458 | 19 |
| 33 | Gironde | 4 | 25 / 534 | 36 |
| 34 | Hérault | 4 | 16 / 341 | 45 |
| 35 | Ille-et-Vilaine | 3 | 9 / 332 | 27 |
| 36 | Indre | 4 | 13 / 241 | 29 |
| 37 | Indre-et-Loire | 3 | 13 / 272 | 29 |
| 38 | Isère | 4 | 19 / 512 | 33 |
| 39 | Jura | 4 | 8 / 492 | 16 |
| 40 | Landes | 5 | 16 / 327 | 29 |
| 41 | Loir-et-Cher | 4 | 7 / 267 | 24 |
| 42 | Loire | 4 | 15 / 320 | 33 |
| 43 | Haute-Loire | 5 | 9 / 257 | 16 |
| 44 | Loire-Atlantique | 3 | 12 / 207 | 31 |
| 45 | Loiret | 4 | 15 / 325 | 37 |
| 46 | Lot | 4 | 6 / 312 | 17 |
| 47 | Lot-et-Garonne | 7 | 14 / 319 | 42 |
| 48 | Lozère | 4 | 7 / 152 | 7 |
| 49 | Maine-et-Loire | 3 | 3 / 176 | 6 |
| 50 | Manche | 4 | 13 / 445 | 16 |
| 51 | Marne | 3 | 7 / 610 | 23 |
| 52 | Haute-Marne | 3 | 5 / 426 | 4 |
| 53 | Mayenne | 3 | 5 / 240 | 17 |
| 54 | Meurthe-et-Moselle | 5 | 9 / 591 | 24 |
| 55 | Meuse | 4 | 9 / 499 | 17 |
| 56 | Morbihan | 3 | 7 / 249 | 12 |
| 57 | Moselle | 4 | 15 / 725 | 28 |
| 58 | Nièvre | 3 | 4 / 309 | 4 |
| 59 | Nord | 2 | 10 / 647 | 18 |
| 60 | Oise | 4 | 12 / 680 | 26 |
| 61 | Orne | 3 | 4 / 381 | 4 |
| 62 | Pas-de-Calais | 2 | 4 / 887 | 5 |
| 63 | Puy-de-Dôme | 3 | 7 / 463 | 22 |
| 64 | Pyrénées-Atlantiques | 6 | 17 / 545 | 53 |
| 65 | Hautes-Pyrénées | 6 | 5 / 469 | 18 |
| 66 | Pyrénées-Orientales | 5 | 25 / 226 | 46 |
| 67 | Bas-Rhin | 5 | 12 / 514 | 28 |
| 68 | Haut-Rhin | 5 | 17 / 366 | 39 |
| 69 | Rhône | 3 | 5 / 266 | 22 |
| 70 | Haute-Saône | 4 | 11 / 536 | 19 |
| 71 | Saône-et-Loire | 4 | 13 / 563 | 28 |
| 72 | Sarthe | 3 | 6 / 352 | 17 |
| 73 | Savoie | 4 | 13 / 273 | 25 |
| 74 | Haute-Savoie | 4 | 14 / 279 | 20 |
| 75 | Paris | 4 | 5 / 1 | 18 |
| 76 | Seine-Maritime | 3 | 10 / 707 | 23 |
| 77 | Seine-et-Marne | 4 | 18 / 507 | 22 |
| 78 | Yvelines | 4 | 13 / 259 | 32 |
| 79 | Deux-Sèvres | 5 | 13 / 252 | 33 |
| 80 | Somme | 3 | 6 / 771 | 20 |
| 81 | Tarn | 7 | 12 / 314 | 52 |
| 82 | Tarn-et-Garonne | 5 | 7 / 195 | 19 |
| 83 | Var | 4 | 23 / 153 | 47 |
| 84 | Vaucluse | 6 | 16 / 151 | 37 |
| 85 | Vendée | 3 | 4 / 253 | 10 |
| 86 | Vienne | 4 | 15 / 265 | 31 |
| 87 | Haute-Vienne | 4 | 5 / 195 | 19 |
| 88 | Vosges | 4 | 14 / 506 | 22 |
| 89 | Yonne | 3 | 17 / 423 | 29 |
| 90 | Territoire de Belfort | 4 | 7 / 101 | 22 |
| 91 | Essonne | 4 | 9 / 194 | 19 |
| 92 | Hauts-de-Seine | 4 | 18 / 36 | 31 |
| 93 | Seine-Saint-Denis | 4 | 14 / 39 | 33 |
| 94 | Val-de-Marne | 4 | 19 / 47 | 30 |
| 95 | Val-d'Oise | 4 | 10 / 183 | 13 |
| 971 | Guadeloupe | 2 | 8 / 32 | 9 |
| 972 | Martinique | 3 | 4 / 34 | 5 |
| 973 | Guyane | 3 | 2 / 22 | 6 |
| 974 | La Réunion | 3 | 9 / 24 | 11 |
| 976 | Mayotte | 4 | 7 / 17 | 9 |

## Limits

- A commune gets news only when an outlet writes about it by name in a title or summary within 14 days. Most of the 35,000 communes will often have nothing, and that is expected.
- Matching works on names, not meaning. An item that mentions a town in passing ("originaire de Clamecy", "transporté à Clermont-Ferrand") still counts for that town. The rules remove the common false friends, but they can still miss, for example a surname that is also the name of a mid-sized town and is preceded by "à".
- The rules accept missing items to avoid wrong ones. They miss nicknames ("Sainté", "Clermont" for Clermont-Ferrand, "Aix"), names in the article body only, and Le Parisien items (no summary).
- North, Brittany (Ouest-France and Le Télégramme block readers), Normandy, Champagne and Picardy rely on France 3 and ici only. In the DOM, Guadeloupe and Martinique rely on Outremers360, Karib'Info and Antilla. Mayotte, Réunion and Guyane have dedicated local sites.
- Feeds change without notice. `index.json` → `feeds[].ok` shows the last run's status, and the run log lists failures. Re-run the discovery checks before adding feeds, and never add a feed that was not fetched and seen to contain items.
- Terms: we use only the publishers' public RSS. We store no article text beyond the RSS summary, cut to 200 characters. Each item links to the publisher.
