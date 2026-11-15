// The indicators the note of the week follows beside the polls: household confidence (with ten years of history and
// the balances of opinion it is made of), the business and employment climates, and new car registrations. All
// from INSEE's macroeconomic database (BDM, SDMX, no key), by series id. The debt, growth, prices and unemployment
// come from scripts/sync-economy.mjs, the OAT and the gap with the Bund from scripts/sync-yields.mjs.
//
//   node scripts/sync-indicators.mjs        (npm run sync:daily runs it)
//
// Output: public/data/daily/indicators.json
//   { fetchedAt, items: [{ id, period, value, prev, yearAgo, updated, url }],
//     confidence: { series: [[period, value], … 10 years], parts: [{ id, period, value, prev, yearAgo }] } }
// A series that fails keeps its previous entry; with nothing read at all the file is left as it is.
import { readFile, writeFile } from "node:fs/promises";
import { path } from "./lib/feed-common.mjs";

const INSEE = "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM";
const page = (id) => `https://www.insee.fr/fr/statistiques/serie/${id}`;
const OUT = path("public/data/daily/indicators.json");

const ITEMS = [
  { id: "confidence", idbank: "001587668", last: 121 }, // synthetic household confidence indicator (long-run average 100)
  { id: "climate", idbank: "001565530", last: 14 },     // business climate, all sectors (long-run average 100)
  { id: "jobsClimate", idbank: "001796629", last: 14 }, // employment climate, all sectors
  { id: "cars", idbank: "010756764", last: 14 },        // new passenger car registrations, seasonally and working-day adjusted
];
// the balances of opinion behind household confidence (answers "better" minus "worse", seasonally adjusted)
const PARTS = [
  { id: "ownPast", idbank: "000857196" }, { id: "ownFuture", idbank: "000857197" },
  { id: "livingPast", idbank: "000857188" }, { id: "livingFuture", idbank: "000857189" },
  { id: "unemployment", idbank: "000857190" }, { id: "purchases", idbank: "000857193" },
  { id: "savingNow", idbank: "000857195" }, { id: "savingFuture", idbank: "000857198" },
  { id: "pricesFuture", idbank: "000857192" },
];

async function insee(idbank, last) {
  const res = await fetch(`${INSEE}/${idbank}?lastNObservations=${last}`, { headers: { Accept: "application/xml", "User-Agent": "data-sync" }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`${res.status} INSEE ${idbank}`);
  const xml = await res.text();
  const series = [...xml.matchAll(/<Obs TIME_PERIOD="([^"]+)" OBS_VALUE="([^"]+)"/g)].map((m) => [m[1], Number(m[2])]).filter((p) => /^\d{4}-\d{2}$/.test(p[0]) && Number.isFinite(p[1])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (series.length < 2) throw new Error(`INSEE ${idbank}: no observations`);
  return { series, updated: xml.match(/LAST_UPDATE="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null };
}
const entry = (id, idbank, r) => ({ id, period: r.series.at(-1)[0], value: r.series.at(-1)[1], prev: r.series.at(-2)[1], yearAgo: r.series.at(-13)?.[1] ?? null, updated: r.updated, url: page(idbank) });

const prev = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
const keep = (list, id) => (list ?? []).find((x) => x.id === id) ?? null;
let read = 0, history = prev?.confidence?.series ?? [];
const items = [];
for (const it of ITEMS) {
  try {
    const r = await insee(it.idbank, it.last);
    items.push(entry(it.id, it.idbank, r)); read++;
    if (it.id === "confidence") history = r.series.slice(-121);
  } catch (e) { console.log(`indicators: ${it.id} FAILED ${e.message}`); const old = keep(prev?.items, it.id); if (old) items.push(old); }
}
const parts = [];
for (const p of PARTS) {
  try { parts.push(entry(p.id, p.idbank, await insee(p.idbank, 14))); read++; }
  catch (e) { console.log(`indicators: ${p.id} FAILED ${e.message}`); const old = keep(prev?.confidence?.parts, p.id); if (old) parts.push(old); }
}
if (!read) { console.log("indicators: nothing read, the previous file is kept"); process.exit(0); }
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), items, confidence: { series: history, parts } }));
console.log(`indicators: ${items.map((i) => `${i.id} ${i.value} (${i.period})`).join(", ")} · ${parts.length} confidence parts · ${history.length} months of history`);
