// Official 2024 legislative results (1st round, by district), from the Ministry of the Interior
// via the data.gouv.fr tabular API. Historical data: run once.
//   npm run sync:results
//
// Output: public/data/results/legislatives-2024-t1.json
//   { source, national: { inscrits, votants, exprimes, nuances: { CODE: voix } },
//     circos: { "0104": { e: exprimes, c: [[nuance, pct, "E"|"Q"|""], ...] } } }   // top candidates per district
// The district page queries the same API live for full candidate detail.

import { mkdir, writeFile } from "node:fs/promises";

const RESOURCE = "a04f8cae-c94d-4ade-804d-ec024ee554ac"; // "Résultats du 1er tour des élections législatives 2024 par circonscription"
const API = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE}/data/`;
const OUT = new URL("../public/data/results/", import.meta.url);

// Ministry codes for overseas departments / French abroad → our district code prefix
const PREFIX = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZS: "975", ZM: "976", ZX: "977", ZW: "986", ZP: "987", ZN: "988", ZZ: "99" };
const circoCode = (cod) => (PREFIX[cod.slice(0, 2)] ? PREFIX[cod.slice(0, 2)] + cod.slice(-2) : cod.length === 5 ? cod : cod);

async function all() {
  const size = 200;
  const first = await (await fetch(`${API}?page_size=${size}&page=1`)).json();
  const pages = Math.ceil(first.meta.total / size);
  const rows = [...first.data];
  for (let p = 2; p <= pages; p++) {
    const r = await (await fetch(`${API}?page_size=${size}&page=${p}`)).json();
    rows.push(...r.data);
  }
  return rows;
}

console.log(`↓ ${API}`);
const rows = await all();
const national = { inscrits: 0, votants: 0, exprimes: 0, nuances: {} };
const circos = {};
for (const r of rows) {
  const code = circoCode(String(r.CodCirElec));
  let c = circos[code];
  if (!c) {
    c = circos[code] = { e: r.Exprimes, i: r.Inscrits, v: r.Votants, list: [] };
    national.inscrits += r.Inscrits;
    national.votants += r.Votants;
    national.exprimes += r.Exprimes;
  }
  national.nuances[r.CodNuaCand] = (national.nuances[r.CodNuaCand] ?? 0) + r.NbVoix;
  // Elu: "OUI" elected in round 1, "QUALIF T2" qualified, else "NON"
  const status = /oui/i.test(r.Elu) ? "E" : /qualif/i.test(r.Elu) ? "Q" : "";
  c.list.push([r.CodNuaCand, Math.round((1000 * r.NbVoix) / r.Exprimes) / 10, status]);
}
const out = {};
for (const [code, c] of Object.entries(circos)) out[code] = { e: c.e, c: c.list.sort((a, b) => b[1] - a[1]).slice(0, 4) };

await mkdir(OUT, { recursive: true });
await writeFile(new URL("legislatives-2024-t1.json", OUT), JSON.stringify({ source: `https://www.data.gouv.fr/fr/datasets/resultats-du-1er-tour-des-elections-legislatives-2024-par-circonscription/`, resource: RESOURCE, national, circos: out }));
console.log(`✓ ${rows.length} candidates in ${Object.keys(out).length} districts; nuances: ${Object.keys(national.nuances).join(" ")}`);
console.log(`  Elu values: ${[...new Set(rows.map((r) => r.Elu))].join(", ")}`);
