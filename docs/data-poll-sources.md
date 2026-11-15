# Data: where a poll dot links to

`scripts/sync-polls.mjs` (`npm run sync:polls`, hourly via `.github/workflows/sync-live.yml`) gives each first-round
poll in `public/data/polls/{2027,2022,legislatives-2024}.json` one `url`. That is the poll's own publication, and
`urlKind` says what kind of page it is:

| `urlKind` | What it is |
|-----------|------------|
| `pollster` | the polling firm's own release or PDF, on its own domain |
| `commission` | the notice the firm filed with the Commission des sondages (`commission-des-sondages.fr`) |
| `press` | anything else (a press article, a social post): nothing better was found |

Polls with no citation at all have neither field. Runoff duels (`secondRound`) have no link.

## 1. Every citation in the row, best one kept

The script collects every external link in the row's cells and every footnote's external links, and ranks them:
pollster domain, then Commission notice, then the rest. Within a rank it prefers direct links over
`web.archive.org` copies, then https, then the firm and date cells' citations. Wikipedia links are ignored.

Pollster domains (`FIRMS` in the script; a pollster name can match several firms, e.g. "Ifop/Hexagone"):

| Firm (as Wikipedia names it) | Domains |
|------------------------------|---------|
| Ifop, Ifop-Fiducial | ifop.com, ifop.fr, Ifop's rolling files on `client-data-serenytics-com.s3…amazonaws.com/IFOP/` |
| Elabe | elabe.fr |
| Harris Interactive, Toluna | harris-interactive.fr, harris-interactive.com, tolunacorporate.com, toluna-group.com |
| OpinionWay, OpinionWay-Kéa | opinion-way.com, opinionway.com, factoviz.com (OpinionWay's results platform, `dviz.factoviz.com`) |
| Ipsos, Ipsos-Sopra Steria, Ipsos BVA | ipsos.com, ipsos.fr, bva-group.com, bva.fr |
| BVA | bva-group.com, bva.fr, ipsos.com |
| Odoxa | odoxa.fr |
| Cluster17 | cluster17.com |
| YouGov | any `yougov.*` host (yougov.com, yougov.fr, cdn.yougov.com, yougov.net) |
| Verian, Kantar | veriangroup.com, kantar.com, kantarpublic.com |
| CSA | csa.eu |
| Viavoice | institut-viavoice.com, viavoice.fr |
| AtlasIntel | atlasintel.org |
| Redfield & Wilton | redfieldandwiltonstrategies.com |

## 2. Looking up the Commission notice

Every poll published in France files a notice with the Commission des sondages before it is published (loi du
19 juillet 1977, art. 3). The notices site has no usable per-year listing (`/notices/medias/dossiers/view/<year>`
returns HTTP 500), and its theme pages are incomplete. Its title search does work:

- `POST https://www.commission-des-sondages.fr/notices/medias/fichiers/search` with `searchterm=<firm>` lists every
  notice whose title has that word, each as `<n°> <scrutin> <sujet> <INSTITUT> <média> <date de publication>` followed
  by `- <Mois> <Année>` (the month it was filed), linking to `/notices/medias/fichiers/add/<id>`.
- `/notices/medias/fichiers/add/<id>` redirects to the PDF, `/notices/files/notices/<année>/<mois>/<n°>-<slug>.pdf`.
  That file URL is what gets stored, over https.

For a poll still left with a press link (or none), the script:

1. searches the firm's name or names (one request per word per run, only when a lookup is due);
2. keeps notices for the right election: the title's scrutin is not `Mun`, `Dep`, `Reg`, `Ref`, `Euro`, `Prim` or
   `TBD`, `Pres` only for presidential files and `Leg` only for the legislative one; the notice was filed from the day
   before fieldwork ended to about seven weeks after, and the title's publication date (if any) is no earlier;
3. reads up to 12 of them, voting-intention titles (`IV`, `intentions`, `1er tour`, `Presitrack`…) first, then the
   closest publication date. The PDF is read without a dependency: Flate streams, object streams and each font's
   ToUnicode map, enough for the Office exports the firms file.
4. accepts a notice only if all of these hold:
   - its fieldwork (the first date range in the text: "Terrain du 12 au 15 octobre 2026", "du 26 au 27 février 2026")
     ends within one day of the poll's;
   - the title or the text is about voting intentions, and the text mentions the presidential or legislative election;
   - the PDF itself downloaded;
   - the notice is not already another poll's link;
   - the sample size the notice states ("1 393 personnes") equals Wikipedia's (within 1% when the end date is the
     same). The only exception is a notice titled as voting intentions whose fieldwork ends the same day.

## Cache

`public/data/polls/notices-cache.json`, committed with the poll files:

- `notices`: one entry per notice read (`url`, `fieldwork`, `samples`, topic flags). Notices don't change, so each PDF
  is downloaded once.
- `lookups`: per poll (`<scope>|<firm>|<start>|<end>`), the notice found (final), or `null` with the day it was
  checked. A miss is retried daily while the poll is under 60 days old, weekly after that.

At most `POLLS_MAX_PDFS` (default 40) PDFs are downloaded per run. Network errors and the budget leave a lookup
for the next run, and a lookup failure never fails the sync. The file is safe to delete; the next runs rebuild it.
