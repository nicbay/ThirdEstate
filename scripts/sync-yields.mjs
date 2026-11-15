// What France pays to borrow: the 10-year OAT yield, the 10-year Bund yield and the spread between them, with the
// spread's daily closes. Read from the public spread pages of Borsa Italiana, whose figures come from Teleborsa
// (15 minutes delayed) and sit in the page itself: the overview lists both yields and the spread, the OAT-Bund page
// carries the spread's daily history. There is no documented API, so everything read is checked (ranges, and the
// spread must equal the gap between the two yields); when a check fails the previous file is kept.
//
//   node scripts/sync-yields.mjs        (npm run sync:daily runs it)
//
// Output: public/data/daily/yields.json
//   { fetchedAt, asOf, oat10, bund10, spread, history: [[date, close], … last 30 sessions],
//     rates: [[date, oat10, bund10], … one line per session read, last 30], source: { name, url } }
// The page only gives today's two rates, so their history is the one this script builds up, run after run.
// oat10 and bund10 in percent, spread and history in basis points (100 = one percentage point).
import { readFile, writeFile } from "node:fs/promises";
import { fetchText, path } from "./lib/feed-common.mjs";

const PAGE = "https://www.borsaitaliana.it/obbligazioni/spread/francia/oat-bund.en.htm";
const OVERVIEW = "https://borsaitaliana.teleborsa.it/pages/spread/2021/overview.aspx?lang=en";
const ITEM = "https://borsaitaliana.teleborsa.it/Pages/Spread/2021/Item.aspx?code=YIELD10_OAT&lang=en";
const OUT = path("public/data/daily/yields.json");

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const n = (s) => Number(String(s).replace(",", "."));
const fail = (why) => { console.log(`yields: ${why}; the previous file is kept`); process.exit(0); };

let overview, item;
try { [overview, item] = await Promise.all([fetchText(OVERVIEW), fetchText(ITEM)]); } catch (e) { fail(`fetch failed (${e.message})`); }

// "Spread OAT vs BUND Current 154 Points Change +3,63% Yield OAT 10 Years +4.92% Yield BUND 10 Years +3.38% Update 11/13/2026 6:01 PM"
const m = text(overview).match(/Spread OAT vs BUND Current ([\d.,]+) Points.{0,40}?Yield OAT 10 Years \+?(-?[\d.,]+)% Yield BUND 10 Years \+?(-?[\d.,]+)% Update (\d{1,2})\/(\d{1,2})\/(\d{4})/);
if (!m) fail("the overview no longer reads as expected");
const spread = n(m[1]), oat10 = n(m[2]), bund10 = n(m[3]);
const asOf = `${m[6]}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`;

// the chart's daily series: [[timestamp, close, open, high, low, …], …]
let rows;
try {
  const j = item.indexOf("historical:[[");
  rows = JSON.parse(item.slice(j + "historical:".length, item.indexOf("]]", j) + 2));
} catch { fail("the spread's daily history could not be read"); }
const history = rows.filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]))
  .map((r) => [new Date(r[0]).toISOString().slice(0, 10), Math.round(r[1] * 10) / 10]).slice(-30);

const sane = [oat10, bund10].every((v) => Number.isFinite(v) && v > -2 && v < 20) && Number.isFinite(spread) && spread > -200 && spread < 1500
  && Math.abs((oat10 - bund10) * 100 - spread) <= 8 // the page rounds the yields to two decimals
  && history.length >= 8 && history.every(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && v > -200 && v < 1500)
  && Date.parse(asOf) > Date.now() - 10 * 86400e3 && Date.parse(asOf) < Date.now() + 86400e3;
if (!sane) fail(`figures out of range or inconsistent (OAT ${oat10}, Bund ${bund10}, spread ${spread}, ${history.length} days, as of ${asOf})`);

const prev = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
const rates = [...(prev?.rates ?? []).filter((r) => Array.isArray(r) && r[0] !== asOf), [asOf, oat10, bund10]].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), asOf, oat10, bund10, spread, history, rates, source: { name: "Teleborsa, via Borsa Italiana", url: PAGE } }));
console.log(`yields ${asOf}: OAT ${oat10} %, Bund ${bund10} %, spread ${spread} pts, ${history.length} sessions (${history[0][0]} → ${history.at(-1)[0]})`);
