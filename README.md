# ProjectView

French election and parliament tracker, in French and English.

| Section | What it shows |
|---|---|
| **2027** | Polling average, prediction-market odds, runoff match-ups, latest polls |
| **Polls** | Trend chart, every runoff match-up, every poll, prediction markets |
| **Simulator** | First-round shares → finalists → vote transfers → runoff result |
| **Results** | 2022 presidential and 2024 legislative results, with final-poll accuracy |
| **Parliament** | France → department → district → MP; MP list; composition (background, age, digital presence) |
| **Sources** | Every source, refresh time, and method |

## Run locally

```bash
npm install
npm run dev
```

## Data

| Data | Source | How it's loaded |
|---|---|---|
| Presidential results 2022 | Ministry of the Interior, [data.gouv.fr tabular API](https://tabular-api.data.gouv.fr) | Live, in the browser |
| Legislative results 2024 | Ministry of the Interior, data.gouv.fr tabular API | National totals: `npm run sync:results` (one-off). District detail: live |
| MPs and their votes | [Assemblée nationale open data](https://data.assemblee-nationale.fr) | `npm run sync:an` — daily GitHub Action |
| Polls (2027, 2022, legislative 2024) | Wikipedia poll tables via the MediaWiki API (CC BY-SA) | `npm run sync:polls` — hourly GitHub Action |
| Prediction markets | Kalshi and Polymarket public APIs | `npm run sync:markets` — hourly GitHub Action |
| Department and district outlines | Etalab / data.gouv.fr | `npm run sync:geo` (one-off) |

`npm run sync` runs everything. Polymarket is blocked from French networks, so it only loads when the sync runs elsewhere (e.g. on GitHub).
