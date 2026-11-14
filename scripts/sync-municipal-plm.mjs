// Arrondissement councils of Paris, Lyon and Marseille, 2026 (15 & 22 March 2026).
//
//   node scripts/sync-municipal-plm.mjs            (official files cached in .cache/municipal/raw/, never expire)
//   node scripts/sync-municipal-plm.mjs --refresh
//
// In these three cities every voter casts two ballots since the 2025 reform: one for the city council (Conseil de
// Paris, Lyon, Marseille: in public/data/municipal/<dept>.json under the city's code) and one for their
// arrondissement's council, which elects the arrondissement's own mayor. This file holds the second, so a page about
// the 15th of Paris shows the 15th's result (Philippe Goujon) and not the city's (Emmanuel Grégoire).
//
// Sources (Ministry of the Interior, Licence Ouverte v2.0): the sector results of each round, and the elected
// councillors of round 1 (head-of-list names for sectors decided in round 1: the results file leaves them blank).
// One sector can cover several arrondissements (Paris Centre: 1st–4th; Marseille: two each).
//
// Output: public/data/municipal/arrondissements.json  { generated, sources, note, arrondissements: { <INSEE code>: entry } }
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./lib/csv.mjs";
import { makeCache } from "./lib/http-cache.mjs";
import { familyOf } from "./lib/municipal-nuances.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/municipal/arrondissements.json", ROOT);
const C = makeCache(new URL(".cache/municipal/raw/", ROOT), { refresh: process.argv.includes("--refresh") });
const T1 = "https://static.data.gouv.fr/resources/elections-municipales-2026-resultats-du-premier-tour/";
const T2 = "https://static.data.gouv.fr/resources/elections-municipales-2026-resultats-du-scond-tour/";
const FILES = {
  s1: { file: "plm-2026-secteurs-t1.csv", url: T1 + "20260316-160627/conseils-darrondissement-paris-lyon-marseille-2026-resultats-secteurs-2026-03-16.csv" },
  s2: { file: "plm-2026-secteurs-t2.csv", url: T2 + "20260323-180123/conseils-d-39-arrondissement-paris-lyon-marseille-2026-resultats-secteurs-2026-03-23-16h22.csv" },
  e1: { file: "plm-2026-elus-t1.csv", url: T1 + "20260316-162449/conseils-darrondissement-paris-lyon-marseille-2026-candidats-elus-tour-1-2026-03-16.csv" },
};
const SOURCES = [
  { id: "mi-2026-plm-t1", name: "Elections municipales 2026 - Résultats du premier tour : conseils d'arrondissement Paris Lyon Marseille, secteurs (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69b82a7de5d58cc06ad35ce0", file: FILES.s1.url, date: "2026-03-16" },
  { id: "mi-2026-plm-t2", name: "Elections municipales 2026 - Résultats du second tour : conseils d'arrondissement Paris Lyon Marseille, secteurs (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69c17fed9f18c7781fd11a14", file: FILES.s2.url, date: "2026-03-23" },
  { id: "mi-2026-plm-elus-t1", name: "Elections municipales 2026 - Candidats élus au premier tour : conseils d'arrondissement Paris Lyon Marseille (Ministère de l'Intérieur)", url: "https://www.data.gouv.fr/datasets/69b82a7de5d58cc06ad35ce0", file: FILES.e1.url, date: "2026-03-16", use: "head of list for sectors decided in round 1" },
];
const DATES = ["2026-03-15", "2026-03-22"];

/** INSEE arrondissement codes in each sector. */
function arrondissementsOf(sector) {
  const m = /^(75056|69123|13055)SR(\d+)$/.exec(sector);
  if (!m) return [];
  const n = Number(m[2]);
  if (m[1] === "75056") return n === 1 ? ["75101", "75102", "75103", "75104"] : [`751${String(n).padStart(2, "0")}`];
  if (m[1] === "69123") return [`6938${n}`];
  // Marseille: 1st & 7th, 2nd & 3rd, 4th & 5th, 6th & 8th, 9th & 10th, 11th & 12th, 13th & 14th, 15th & 16th
  const pairs = [[1, 7], [2, 3], [4, 5], [6, 8], [9, 10], [11, 12], [13, 14], [15, 16]][n - 1] ?? [];
  return pairs.map((a) => `132${String(a).padStart(2, "0")}`);
}

const num = (s) => { const t = String(s ?? "").replace("%", "").replace(/\s/g, "").replace(",", "."); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const int = (s) => { const n = num(s); return n == null ? null : Math.round(n); };
const person = (first, last) => [first, last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || null;

async function rows(k) {
  return parseCsv(await readFile(await C.cached(FILES[k].file, FILES[k].url, { maxAgeH: null }), "utf8"), ";").slice(1).filter((x) => x[2]);
}

async function main() {
  // round-1 winners' heads: the first elected councillor of the list (the elected file lists heads first)
  const heads = new Map();
  for (const x of await rows("e1")) {
    const sector = x[8], nuance = x[9];
    const k = `${sector}|${nuance}`;
    if (!heads.has(k)) heads.set(k, { name: person(x[1], x[0]), sex: x[3] || null });
  }
  const sectors = new Map();
  for (const [round, key] of [[1, "s1"], [2, "s2"]]) {
    for (const x of await rows(key)) {
      // 18 sector columns, then blocks of 12 per list: panel, last name, first name, sex, nuance, short label,
      // label, votes, % registered, % expressed, elected, seats
      const lists = [];
      for (let b = 18; b + 11 < x.length; b += 12) {
        if (!x[b] && !x[b + 6]) continue;
        const nuance = x[b + 4] || null;
        const name = person(x[b + 2], x[b + 1]);
        lists.push({
          panel: int(x[b]),
          label: x[b + 6] || x[b + 5] || null,
          ...(x[b + 5] && x[b + 5] !== x[b + 6] ? { shortLabel: x[b + 5] } : {}),
          head: name ? { name, sex: x[b + 3] || null } : null,
          nuance,
          family: familyOf(nuance),
          votes: int(x[b + 7]),
          pctExpressed: num(x[b + 9]),
          pctRegistered: num(x[b + 8]),
          seats: int(x[b + 11]) ?? 0,
        });
      }
      lists.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
      let s = sectors.get(x[2]);
      if (!s) sectors.set(x[2], (s = { sector: x[2], sectorName: x[3], rounds: [] }));
      s.rounds.push({
        round, date: DATES[round - 1],
        registered: int(x[4]), voters: int(x[5]), turnoutPct: num(x[6]), abstentions: int(x[7]), expressed: int(x[9]), blank: int(x[12]), null: int(x[15]),
        lists,
      });
    }
  }
  const out = {};
  for (const s of [...sectors.values()].sort((a, b) => a.sector.localeCompare(b.sector))) {
    const rounds = s.rounds.sort((a, b) => a.round - b.round);
    const decided = rounds.find((r) => r.lists.some((l) => l.seats > 0));
    const best = decided?.lists.reduce((a, b) => ((b.seats ?? 0) > (a?.seats ?? 0) ? b : a), null);
    if (best && !best.head) best.head = heads.get(`${s.sector}|${best.nuance}`) ?? null;
    const winner = best?.seats ? { round: decided.round, panel: best.panel, label: best.label, head: best.head, nuance: best.nuance, family: best.family, seats: best.seats, pctExpressed: best.pctExpressed } : null;
    const arr = arrondissementsOf(s.sector);
    if (!arr.length) { console.warn("unknown sector", s.sector); continue; }
    for (const code of arr) out[code] = {
      sector: s.sector, sectorName: s.sectorName, arrondissements: arr,
      seats: decided ? decided.lists.reduce((n, l) => n + (l.seats ?? 0), 0) : null,
      y2026: { system: "list", council: "arrondissement", decidedRound: decided?.round ?? null, winner, rounds },
    };
  }
  await mkdir(new URL("public/data/municipal/", ROOT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    sources: SOURCES,
    note: "Arrondissement council elections in Paris, Lyon and Marseille, by arrondissement (INSEE code). A sector covering several arrondissements is repeated under each. winner = list with the most seats in the deciding round; its head usually becomes the arrondissement's mayor (elected by the council).",
    arrondissements: out,
  }));
  const missing = Object.entries(out).filter(([, v]) => !v.y2026.winner?.head).map(([k]) => k);
  console.log(`Wrote ${Object.keys(out).length} arrondissements (${sectors.size} sectors).${missing.length ? ` No winner head: ${missing.join(" ")}` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
