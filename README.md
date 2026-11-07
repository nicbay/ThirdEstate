# ProjectView

French election and parliament tracker, in French and English.

## Run locally

```bash
npm install
npm run dev
```

## Data sources

| Data | Source | How it's loaded |
|---|---|---|
| Presidential results | Ministry of the Interior, via the [data.gouv.fr tabular API](https://tabular-api.data.gouv.fr) | Queried live by the browser |
| MPs and their votes | [Assemblée nationale open data](https://data.assemblee-nationale.fr) | `npm run sync:an` → `public/data/an/` (runs daily via GitHub Actions) |
| Department outlines | [Etalab administrative boundaries](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/) | `npm run sync:geo` → `public/data/geo/` (one-off) |

`npm run sync` runs both sync scripts.
