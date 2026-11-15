// The CAC 40's week: the index and each of its shares, last close against the last close at least seven days
// earlier, and the two shares that moved most. Daily closes come from Yahoo Finance's public chart endpoint (no
// key, not a documented API: Euronext's own site serves its figures encrypted, so they are left alone). Every
// value is checked; a share that fails is skipped, and with no index reading the previous file is kept.
//
//   node scripts/sync-cac.mjs        (npm run sync:daily runs it)
//
// Output: public/data/daily/cac.json
//   { fetchedAt, asOf, from, level, d7, read, movers: [{ name, d7 }, { name, d7 }], source: { name, url } }
// d7 in percent. The list of shares below is the index's composition as last checked by hand: Euronext reviews
// it every quarter, so a share that left the index must be removed here and its replacement added.
import { readFile, writeFile } from "node:fs/promises";
import { path, pool } from "./lib/feed-common.mjs";

const OUT = path("public/data/daily/cac.json");
const CHART = (t) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1mo&interval=1d`;
const SHARES = {
  "AC.PA": "Accor", "AI.PA": "Air Liquide", "AIR.PA": "Airbus", "MT.AS": "ArcelorMittal", "CS.PA": "AXA", "BNP.PA": "BNP Paribas",
  "EN.PA": "Bouygues", "BVI.PA": "Bureau Veritas", "CAP.PA": "Capgemini", "CA.PA": "Carrefour", "ACA.PA": "Crédit Agricole",
  "BN.PA": "Danone", "DSY.PA": "Dassault Systèmes", "EDEN.PA": "Edenred", "ENGI.PA": "Engie", "EL.PA": "EssilorLuxottica",
  "ERF.PA": "Eurofins Scientific", "ENX.PA": "Euronext", "RMS.PA": "Hermès", "KER.PA": "Kering", "OR.PA": "L’Oréal", "LR.PA": "Legrand",
  "MC.PA": "LVMH", "ML.PA": "Michelin", "ORA.PA": "Orange", "RI.PA": "Pernod Ricard", "PUB.PA": "Publicis", "RNO.PA": "Renault",
  "SAF.PA": "Safran", "SGO.PA": "Saint-Gobain", "SAN.PA": "Sanofi", "SU.PA": "Schneider Electric", "GLE.PA": "Société Générale",
  "STLAP.PA": "Stellantis", "STMPA.PA": "STMicroelectronics", "HO.PA": "Thales", "TTE.PA": "TotalEnergies", "URW.PA": "Unibail-Rodamco-Westfield",
  "VIE.PA": "Veolia", "DG.PA": "Vinci",
};

/** Daily closes of one ticker: [[date, close], …], oldest first. */
async function closes(ticker) {
  const res = await fetch(CHART(ticker), { headers: { "User-Agent": "Mozilla/5.0 (compatible; data-sync)" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${ticker}`);
  const r = (await res.json())?.chart?.result?.[0];
  const ts = r?.timestamp ?? [], cl = r?.indicators?.quote?.[0]?.close ?? [];
  const rows = ts.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), cl[i]]).filter((x) => Number.isFinite(x[1]) && x[1] > 0);
  if (rows.length < 6) throw new Error(`${ticker}: too few closes`);
  return rows;
}
/** The last close against the last close at least seven days earlier. */
function week(rows) {
  const last = rows.at(-1), cut = new Date(Date.parse(last[0]) - 7 * 864e5).toISOString().slice(0, 10);
  const back = rows.filter((r) => r[0] <= cut).at(-1);
  if (!back) return null;
  return { asOf: last[0], from: back[0], level: last[1], d7: Math.round((last[1] / back[1] - 1) * 1000) / 10 };
}

let index = null;
try { index = week(await closes("^FCHI")); } catch (e) { console.log(`cac: index FAILED ${e.message}`); }
if (!index || Math.abs(index.d7) > 25 || index.level < 2000 || index.level > 30000 || Date.parse(index.asOf) < Date.now() - 10 * 864e5) {
  console.log("cac: no usable index reading, the previous file is kept"); process.exit(0);
}
const moves = [];
await pool(Object.entries(SHARES), 4, async ([ticker, name]) => {
  try { const w = week(await closes(ticker)); if (w && w.asOf === index.asOf && Math.abs(w.d7) < 60) moves.push({ name, d7: w.d7 }); }
  catch (e) { console.log(`cac: ${name} skipped (${e.message})`); }
});
moves.sort((a, b) => Math.abs(b.d7) - Math.abs(a.d7));
const prev = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
// the movers need most of the index to mean anything; with too few shares read, the last known ones stay (if of the same week)
const movers = moves.length >= 30 ? moves.slice(0, 2) : prev?.asOf === index.asOf ? prev.movers : [];
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), asOf: index.asOf, from: index.from, level: Math.round(index.level * 100) / 100, d7: index.d7, read: moves.length, movers, source: { name: "Yahoo Finance", url: "https://finance.yahoo.com/quote/%5EFCHI/components/" } }));
console.log(`cac ${index.asOf}: ${index.level.toFixed(0)} (${index.d7 > 0 ? "+" : ""}${index.d7} % since ${index.from}) · ${moves.length}/${Object.keys(SHARES).length} shares · movers ${movers.map((m) => `${m.name} ${m.d7 > 0 ? "+" : ""}${m.d7} %`).join(", ") || "none"}`);
