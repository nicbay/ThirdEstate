# Data: 2027 candidate files

One hand-curated file per candidate in `public/data/candidates/<slug>.json`, plus
`public/data/candidates/pay-scales.json` (official gross pay scales used by the public-pay estimate).
They feed the candidate page `#/candidat/<slug>` (`src/views/candidate.ts`), which is the hub for
everything the site knows about a candidate, and the "Les candidats" section of `#/2027`.

The candidate set is not fixed in code: the 2027 page shows a card for every name in the polling
average (`average()` in `src/lib/polls.ts`), plus every candidate file missing from that average. A
name with no file gets a card without a link. `index.json`, written by `scripts/check-candidates.mjs`,
maps poll names to slugs and carries the `display` overrides, and `src/lib/candidates.ts` imports it,
so the colour, party code and page link of a candidate follow the file everywhere on the site (2027
page, polls, simulator, forecast).

## What the candidate page shows, and where it comes from

Every block says so in one line when there is nothing to show; none of them needs code per candidate.

| Block | Source | When absent |
|---|---|---|
| Polls, trend, forecast, markets | `public/data/polls/2027.json` by `pollName`; `src/lib/forecast.ts`; `markets.json` | "Not polled yet" / "Not in the recent average" |
| Campaign 2027 | `background`, `supporters`, `campaign` in the file | block hidden |
| Programme | `public/data/programmes/index.json`: `programme` slug, else same slug, else same candidate name | "Not analysed yet" |
| Parliament | MP: `an`, else same name in `public/data/an/deputes.json`; senator: `senat`, else same name in `public/data/senat/senateurs.json` | "Does not sit in the French Parliament" (MEPs: link to the EP page from `links` with `kind: "ep"`) |
| News | `public/data/feed/latest.json` (72 h): titles and summaries matching `newsMatch` (default: full name and surname) | "No recent headline" |
| Quiz | `quiz.groups` (`public/data/an/quiz.json`, built by `scripts/build-quiz.mjs`) | "Not in the quiz yet" + `quiz.note` |
| Assets, courts, elections, public pay, career, links | the file | "None found" / "Not published" / … |

## Adding a candidate

1. Create `public/data/candidates/<slug>.json` (lower-case, hyphens; the slug is the URL `#/candidat/<slug>`)
   following the schema below. Set `pollName` to the name exactly as in `public/data/polls/2027.json`
   (the check warns if it is not there yet; the page still works, with "Not polled yet").
2. Photo: a Wikimedia Commons file, with `file`, `src` (`Special:FilePath/…?width=480`), `page`,
   `author`, `licence`, `licenceUrl`, `year` copied from the file page.
3. Colour: nothing to do if the polls give the candidate a known party code (`parties` in
   `public/data/polls/2027.json`, colours in `PARTY` in `src/lib/candidates.ts`). Otherwise add
   `"display": { "party": "XYZ" }` (an existing code), or `"display": { "color": "#rrggbb", "bloc": 0–4 | null }`.
   Without either, the candidate shows in neutral grey with no political family.
4. If the surname alone is ambiguous in headlines (a common first name, a family name shared with
   another politician), set `newsMatch`, e.g. `["Édouard Philippe"]`.
5. Quiz: leave `"groups": []` (with a `note`) until a parliamentary group represents the candidate.
   Giving groups means `scripts/build-quiz.mjs` also needs the same number of programme measures
   for them as for everyone else (its `MEASURES` list), then `npm run build:quiz`.
6. Programme (optional): `public/data/programmes/<slug>.json` (see `scripts/build-programme.mjs`), then
   `node scripts/build-programmes-index.mjs`. The candidate page finds it by slug or name.
7. Run `npm run check:candidates`: it validates every source and rewrites `index.json`. Fix errors,
   read the warnings. `npm run build` runs it too.

## Rules (legal care: accuracy over completeness)

- **Every fact carries a `sources` array.** `node scripts/check-candidates.mjs` (run by `npm run build`)
  fails if any fact, any list item, any mandate or any pay-scale entry has no source, or a source
  without an `https` URL and a date.
- A source is `{ "title", "publisher", "url", "date" }`; `date` is the publication date (YYYY-MM-DD,
  or YYYY-MM / YYYY when only that is known). Prefer official sources: HATVP, Journal officiel,
  Légifrance, Cour de cassation, Conseil constitutionnel, ministère de l'Intérieur results,
  Assemblée/Sénat/European Parliament sites, Wikidata. Wikipedia is acceptable only for candidacies and
  mandates, never for judicial facts.
- **Patrimoine:** only official published declarations (HATVP publication for members of government;
  the presidential candidates' declarations published by the Conseil constitutionnel / Journal officiel).
  No estimate from press rankings. If nothing is published, `status: "none"` and an explanation
  (parliamentarians' and MEPs' declarations are only consultable in préfecture and may not be
  disclosed; mayors' and local executives' declarations are not published).
- **Condamnations définitives:** final criminal convictions only (no appeal or pourvoi pending).
  Press-law offences (diffamation, provocation à la haine…) are criminal offences in French law and are
  labelled `"kind": "press"`. Civil judgments only if final and for defamation/press law
  (`"kind": "civil"`). Each needs a primary source (court decision, official communiqué) or two
  reputable outlets. Amnestied or expunged convictions are never listed.
- **Procédures en cours:** cases under appeal, pourvoi or investigation where the candidate is personally
  a party (prévenu, mis en examen, appellant). Neutral wording; the page always states the presumption of
  innocence. Nothing else: no accusations, no complaints, no party-only cases.
- **If unsure, leave it out**, and list it in `omitted` (internal, not shown) with the reason.
- Strictly neutral wording, no adjectives. Same structure for every candidate.

## Candidate file schema

```jsonc
{
  "slug": "melenchon",
  "name": "Jean-Luc Mélenchon",
  "pollName": "Jean-Luc Mélenchon",         // exactly as in public/data/polls/2027.json
  "display": { "party": "NE", "color": "#3f72c4", "bloc": 3 },  // optional, each key optional: party code,
                                             // colour and political family (0 radical left … 4 nationalist right,
                                             // null = none) when the polls don't give them or give a wrong one
  "verified": "2026-11-08",                  // date of last verification ("dernière vérification")
  "wikidata": "Q...",
  "born": { "date": "1951-08-19", "place": "Tanger (Maroc)", "sources": [] },
  "photo": {                                 // Wikimedia Commons, freely licensed
    "file": "File:Example.jpg",
    "src": "https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg?width=480",
    "page": "https://commons.wikimedia.org/wiki/File:Example.jpg",
    "author": "…", "licence": "CC BY-SA 4.0", "licenceUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "year": 2022
  },
  "party": { "fr": "La France insoumise", "en": "La France insoumise", "sources": [] },
  "role":  { "fr": "…", "en": "…", "sources": [] },        // current role on the verification date
  "links": [ { "fr": "Fiche HATVP", "en": "HATVP page", "url": "https://www.hatvp.fr/…", "kind": "hatvp" } ],
                                              // kind: an | senat | ep | hatvp | gouv | wikidata | other
  "an": "PA2150" ,                            // current MP id on our site (#/depute/PA…), else null
  "senat": "04033B" | null,                   // optional: senator id (#/senateur/…); both are also found by name
  "background": { "fr": "…", "en": "…", "sources": [] } | null,   // optional short sourced background
  "supporters": [ { "name": "…", "role": { "fr": "…", "en": "…" }, "sources": [] } ],  // optional, named in the press
  "campaign": [ { "date": "2026-11-09", "fr": "…", "en": "…", "sources": [] } ],       // optional dated campaign steps
  "newsMatch": ["Édouard Philippe"] | null,   // optional: headline terms (default: full name and surname)
  "wealth": {
    "status": "published" | "none",
    "declarations": [{
      "date": "2022-03-11",                   // date of the declaration (or of its publication)
      "context": { "fr": "Candidature à l'élection présidentielle de 2022", "en": "…" },
      "net": 1234567 | null,                  // declared net assets in euros, as published
      "gross": 1234567 | null,                // optional
      "note": { "fr": "…", "en": "…" } | null,
      "sources": []
    }],
    "explanation": { "fr": "…", "en": "…" },  // why nothing is published, or what the figures are
    "sources": []
  },
  "convictions": {
    "definitive": [{
      "date": "2019-12-09",
      "court": { "fr": "Tribunal correctionnel de Bobigny", "en": "Bobigny criminal court" },
      "offence": { "fr": "…", "en": "…" },
      "sentence": { "fr": "…", "en": "…" },
      "kind": "penal" | "press" | "civil",
      "final": { "fr": "Définitive faute d'appel", "en": "Final, no appeal" },
      "sources": []
    }],
    "pending": [{
      "since": "2016-06",
      "court": { "fr": "…", "en": "…" },
      "subject": { "fr": "…", "en": "…" },
      "status": { "fr": "…", "en": "…" },     // where the case stands on the verification date
      "sources": []
    }],
    "sources": []                              // what was searched (e.g. Légifrance / Cour de cassation)
  },
  "candidacies": [{
    "date": "2022-04-10",
    "type": "presidential" | "legislative" | "european" | "regional" | "departmental" | "cantonal" | "municipal" | "senatorial",
    "office": { "fr": "Présidence de la République", "en": "President of the Republic" },
    "place": "Bouches-du-Rhône, 4e circonscription" | null,
    "list": { "fr": "Tête de liste « … »", "en": "…" } | null,
    "pct": 21.95 | null,                       // candidate's (or list's) share of valid votes, best round
    "round": 1 | 2 | null,                     // last round reached
    "elected": true | false,
    "result": { "fr": "Éliminé au 1er tour, 3e (21,95 %)", "en": "…" },
    "sources": []
  }],
  "mandates": [{                               // offices, mandates, government posts, documented public jobs
    "office": "depute" | "senateur" | "mep" | "premier-ministre" | "ministre" | "ministre-delegue" | "secretaire-etat"
            | "maire" | "adjoint" | "conseiller-municipal" | "conseiller-regional" | "vice-president-region"
            | "president-region" | "conseiller-departemental" | "vice-president-departement"
            | "president-departement" | "conseiller-communautaire" | "president-epci" | "fonctionnaire" | "other",
    "label": { "fr": "Député de la Somme (2e circ.)", "en": "…" },
    "place": "Le Havre" | null,
    "population": 170147 | null,               // commune, département or région population (for the pay tier)
    "from": "2012-06-17", "to": "2017-06-20" | null,
    "sources": []
  }],
  "partyFunding": [{                           // money paid to the party or campaign, NOT personal income
    "year": 2022,
    "kind": "campaign" | "party",
    "label": { "fr": "Remboursement forfaitaire des dépenses de campagne présidentielle 2022", "en": "…" },
    "amount": 6000000,
    "sources": []
  }],
  "programme": "melenchon" | null,             // #/programmes/<slug>; null = look it up by slug, then by name
  "quiz": { "groups": ["LFI-NFP"], "note": { "fr": "…", "en": "…" } | null },
  "omitted": [ { "what": "…", "why": "…" } ]  // facts considered and left out (not displayed)
}
```

## Still hard-coded elsewhere (outside the candidate files)

- `src/views/simulator.ts`: the Le Pen → Bardella swap scenario names both people.
- `scripts/build-quiz.mjs`: `MEASURES`, the programme questions per candidate slug (every candidate in
  the quiz must have the same number).
- The household budget simulator exists for Mélenchon only (`src/views/household.ts`, its route in
  `src/main.ts`, links in `src/views/programme.ts`, `programmes-hub.ts`, `home-programmes.ts`).
- `PARTY` in `src/lib/candidates.ts` maps party codes (not candidates) to colours and blocs; a new party
  either gets a line there or its candidates set `display.color` / `display.bloc`.

## Public-pay estimate

`src/lib/public-pay.ts` turns `mandates` into a yearly gross estimate with `pay-scales.json`:

- Each mandate contributes, for each month it was held, the official gross monthly amount of that year
  for its office (and, for local executives, the population tier).
- Parliamentary indemnity (deputies and senators, and French MEPs before July 2009): base + residence +
  function allowances. MEPs from 14 July 2009: the single EU salary.
- Ministers / Prime Minister: the government pay set in 2012 (−30 %), indexed like the civil-service
  point; earlier years use the pre-2012 level.
- Local indemnities: maximum legal rate (CGCT) × gross monthly pay of the terminal civil-service index,
  by population tier. Councils may vote less: this is an upper estimate.
- Écrêtement: local indemnities on top of a parliamentary indemnity or of other local mandates are
  capped so the total does not exceed 1.5 × the base parliamentary indemnity.
- Not estimated: civil-service salaries (grade and step not public), years before the 1992 law on
  local elected officials for local mandates, expense allowances (AFM/AMEP, frais de mandat), staff
  budgets, pensions.
- Party and campaign money is shown separately and never added to the personal total.
