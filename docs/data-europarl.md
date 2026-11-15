# European Parliament data (`public/data/pe/`)

`scripts/sync-europarl.mjs` builds the European Parliament counterpart of `public/data/an/`: France's Members of the
European Parliament (eurodéputés) of the 10th term (from 16 July 2024), every plenary roll-call vote with each
MEP's position, and what they say in plenary debates (word clouds and themes). It uses only the official
**European Parliament Open Data Portal, API v2** (`https://data.europarl.europa.eu/api/v2`).

```
npm run sync:pe                              # whole term (first run ~45 min, mostly the API's response time; ~20 s when cached)
npm run sync:pe -- --since 2026-09-01        # a sample: sittings (and speeches) from that date only
npm run sync:pe -- --until 2026-10-31
npm run sync:pe -- --refresh                 # ignore the cache in .cache/europarl/
npm run sync:pe -- --no-speeches | --no-votes
```

No API key, no AI step, no new dependency. Requests go one at a time (350 ms apart, retries with back-off on
429/5xx, `scripts/lib/http-cache.mjs`), and every response is reduced and memoised in `.cache/europarl/`:
people 6 days (French MEPs) / 30 days (others), sittings older than 60 days a year, recent sittings and speeches 20 h.
A re-run with a warm cache takes a few minutes.

Views: `src/views/europe.ts` (`#/europe` list, `#/eurodepute/<id>` one MEP). The speeches card and the chamber
cloud reuse `renderSpeakerSpeech` / `renderChamberCloud` from `src/views/speeches.ts` with a `SpeechChamber`
pointing at `public/data/pe/interventions/` (same file shapes as `an/interventions/`).

## Endpoints

| What | Endpoint |
|---|---|
| Sitting French MEPs | `meps/show-current?country-of-representation=FR` |
| French MEPs over the term (incl. those who left) | `meps?parliamentary-term=10&country-of-representation=FR` |
| Every MEP of the term, all countries (747), for group lines | `meps?parliamentary-term=10` |
| Memberships with dates (EP group, national party, mandate), photo, e-mail, gender, birth date | `meps/{id}` |
| Names of groups and national parties | `corporate-bodies/{org}` |
| Plenary sittings | `meetings?year=YYYY` (kept: `parliamentary_term = org/ep-10`, dates in the window, before today) |
| Decisions of a sitting; roll calls list voters | `meetings/MTG-PL-YYYY-MM-DD/decisions` (`decision_method = VOTE_ELECTRONIC_ROLLCALL`, `had_voter_favor / _against / _abstention`) |
| Vote items (official titles) | `meetings/MTG-PL-YYYY-MM-DD/vote-results` (`activity_label`, `consists_of` → decisions) |
| Speeches with text | `speeches?person-id={id}&parliamentary-term=10&include-output=xml_fragment&language=fr` |

A sitting without any decision (opening Monday, debate-only days) answers **404** on `/decisions`: treated as no vote.

Human-facing links shown on the pages (checked in a browser; `www.europarl.europa.eu` refuses non-browser clients,
so the script never fetches it):

- vote: `https://www.europarl.europa.eu/doceo/document/PV-10-YYYY-MM-DD-RCV_FR.html#<vote item number>` (roll-call
  results of the sitting, anchored at the item) and the PDF `https://data.europarl.europa.eu/distribution/doc/PV-10-YYYY-MM-DD-RCV_fr.pdf`;
- speech: `https://www.europarl.europa.eu/doceo/document/CRE-10-YYYY-MM-DD-ITM-NNN_FR.html` (verbatim report of the
  debate, from the speech's `is_part_of`);
- MEP: `https://www.europarl.europa.eu/meps/fr/<id>`; photo `https://www.europarl.europa.eu/mepphoto/<id>.jpg` (the API's `img`, linked, not copied).

## Files

| File | What |
|---|---|
| `meps.json` | French MEPs of the term, sitting ones first (81 + those who left) |
| `votes.json` | roll-call votes in the window, newest first, with every group's and French delegation's line |
| `votes/<id>.json` | one MEP's positions on the votes held while they sat |
| `interventions/summary.json` | themes, all French MEPs' cloud and theme shares, per EP group, per MEP |
| `interventions/<id>.json` | one MEP: speech counts, top ~60 distinctive terms with their latest quotes, theme shares |
| `interventions/words.json`, `interventions/ranks/NN.json` | chamber/group cloud words with quotes; who said each word (32 FNV-1a shards, as for MPs) |
| `meta.json` | sync time, window, coverage (sittings, roll calls, speeches kept / dropped), `missing` |

### `meps.json`

```json
{
  "id": "197494", "civ": "Mme", "prenom": "Nathalie", "nom": "Loiseau", "sort": "LOISEAUN", "feminin": true,
  "naissance": "1964-06-01", "photo": "https://www.europarl.europa.eu/mepphoto/197494.jpg",
  "email": "nathalie.loiseau@europarl.europa.eu", "url": "https://www.europarl.europa.eu/meps/fr/197494",
  "current": true, "mandats": [["2024-07-16", null]],
  "groupe": { "abrev": "Renew", "libelle": "Renew Europe", "libelleEn": "Renew Europe", "couleur": "#e0b100" },
  "parti": { "id": "6919", "abrev": "Hor", "libelle": "Horizons", "libelleEn": "Horizons" },
  "stats": {
    "eligible": 6506, "cast": 5294, "pour": 2255, "contre": 2973, "abstention": 66, "participation": 0.814,
    "group":  { "n": 5291, "ok": 5064, "opp": 173, "ni": 0, "rate": 0.957 },
    "france": { "n": 5152, "ok": 3692, "opp": 1274, "rate": 0.717 },
    "parties": { "RN": [5294, 1624], "…": [] },
    "breaks": [["198209", "C", "P", 1, 68]]
  },
  "speeches": { "total": 77, "french": 74, "notFrench": 3, "langs": { "ENG": 3 }, "chair": 0 }
}
```

- `groupe` / `parti`: the membership valid today (for MEPs who left: the last one of the term). Group colours are
  ours (close to the Parliament's charts); group labels from the API, French and English.
- `stats.eligible`: roll calls held while the MEP sat (mandate periods from `org/ep-10` membership).
  `participation = cast / eligible`; an abstention counts as taking part.
- `stats.group`: same method as `scripts/lib/loyalty.mjs` for MPs. The group line is the plurality (for / against /
  abstention) of the **other** members of the MEP's EP group (all countries, group at the date of the vote) who
  voted, counted only with at least 3 of them and no tie. Votes cast as non-attached (NI) are not counted (`ni`).
  `opp` = opposite position (for vs against).
- `stats.france`: the same with the other French MEPs (at least 3, no tie).
- `stats.parties`: for each French national delegation, `[votes compared, same position]` against the plurality of
  its members who voted (the MEP excluded for their own party; at least 1 other voter, no tie). "Sans parti" and "Indépendant" are not
  delegations.
- `stats.breaks`: up to 12 most notable votes against the group line `[votingId, own, line, share of colleagues on
  the line, colleagues voting]`, scored as in `loyalty.mjs`.

### `votes.json`

```
{ groups: { "PPE": { fr, en, couleur, rank }, … }, parties: { "RN": { fr, en }, … },
  items: { "MTG-PL-2026-11-12-VOT-ITM-993391": { fr, en, rec: "PV-10-2026-11-12-VOT-ITM-014", date } },
  votes: [[votingId, date, item, label fr, label en, outcome, for, against, abstention, French line, {group: line}]] }
["200503", "2026-11-12", "MTG-PL-2026-11-12-VOT-ITM-993391", "RC-B10-0497/2026 - Proposition de résolution (ensemble du texte)",
 "RC-B10-0497/2026 – Motion for a resolution (as a whole)", "ADOPTED", 536, 8, 37, "P", { "PPE": "P", … }]
```

- `votingId` = the API's `notation_votingId`. `outcome` is `ADOPTED`, `REJECTED` or `LAPSED`. Totals are the
  published ones (`number_of_votes_*`). `item` titles come from `vote-results`; the label is the decision's own
  (amendment, paragraph, "as a whole").
- Lines in `votes.json` are pluralities of **all** members who voted (the MEP not excluded), for display.

### `votes/<id>.json`

`{ "200503": "P", "200502": "-", … }`: `P` for, `C` against, `A` abstention, `-` did not vote. Only votes held
while the MEP sat. Vote corrections (`had_voter_intended_*`) are not applied: the official result stands.

### `interventions/`

Same shapes as `an/interventions/` (see `scripts/sync-interventions.mjs`), so `src/views/speeches.ts` reads them
unchanged. Differences:

- Documents for TF-IDF are the French MEPs; the "chamber" is all French MEPs; groups are EP groups (current).
- Only speeches whose **original language is French** are tokenised (`originalLanguage` = FRA and the French
  fragment is not a machine translation, `xml:lang` without `-t-…-mtec`). Others are counted per MEP (`notFrench`,
  `langs`), and the `interjections` slot of `<id>.json` and `mps[id].i` holds that count (shown as "Not in French").
  Speeches made while chairing (`participation_role` other than `SPEAKER`) are left out (`chair`).
- Quotes' `u` is appended to `https://www.europarl.europa.eu/doceo/document/` (verbatim report of the debate).
- Tokeniser, stopwords, folding, themes copied from `sync-interventions.mjs` (keep in step by hand), plus EP
  procedural words (commissaire, parlement, européen, union, rapport, résolution, débat, carton bleu…) and French
  MEPs' first names and surnames. Phrase thresholds scaled down (8 uses, 3 MEPs).

## Coverage and what is missing

Full-term run of 15 November 2026: 81 sitting French MEPs + 4 who left (85); 126 plenary sittings from 16 July
2024, 116 with roll calls, **6,506 roll-call votes** (17 Jul 2024 → 12 Nov 2026) on 800 vote items; **3,060
speeches** by 81 French MEPs (17 Jul 2024 → 11 Nov 2026), 2,988 in French analysed. `public/data/pe/` weighs ~15 MB
(`votes/` 6.7 MB, `interventions/` 4.4 MB, `votes.json` 2.1 MB).

`meta.json` records the window, number of sittings, roll calls, vote items, speeches kept and dropped, and a
`missing` list (sittings whose decisions could not be fetched). The pages print this coverage line.

- **Votes by show of hands and simple electronic votes** have no nominative list: only roll calls are analysed.
- **Group at the date of the vote** comes from each MEP's dated memberships (checked on the full-term run: every one
  of the 4.07 million individual votes matched a group membership valid that day).
- **Speeches not in French** (full term: 47 in English, 3 in Italian) are not in the clouds; machine translations are
  never used. 22 speeches made while chairing are left out.
- Only what the speeches endpoint returns as plenary speeches is used (all `PLENARY_DEBATE_SPEECH` in the
  samples checked); written explanations of vote were not looked for.
- **Photos do not display** on other sites: `www.europarl.europa.eu/mepphoto/<id>.jpg` opens in a browser tab but
  refuses cross-site image requests, and the server answers 403 to scripts, so they cannot be fetched and re-hosted
  by the sync either. The pages keep the official URL and hide the broken image (`data-hide-broken`).
- The party lines per vote are used for the stats but not written to `votes.json` (keeps it at ~2 MB).
- The verbatim record of the latest sittings can be provisional; the cache refreshes recent data every 20 h.

## Licence

© European Union, 2024–2026 – Source: European Parliament. Reuse is authorised provided the source is acknowledged
(EP legal notice). Photos are linked from europarl.europa.eu, not copied.
