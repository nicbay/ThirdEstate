// Nicolas Dupont-Aignan's voting record (Assemblée nationale, 14th–16th legislatures, 2012–2024)
// checked against his 2027 programme (public/data/programmes/dupont-aignan.json).
//
//   node scripts/record/dupont-aignan.mjs            → builds public/data/programmes/record/dupont-aignan.json
//   node scripts/record/dupont-aignan.mjs --shortlist → also prints keyword candidates per measure for review
//
// Downloads are cached under .cache/record/. Every contradiction kept is a hand-reviewed decision in
// scripts/data/programmes/dupont-aignan-record.mjs; this script never publishes a keyword match on its own.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { contradictions } from "../data/programmes/dupont-aignan-record.mjs";

const ROOT = new URL("../../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const OUT = new URL("public/data/programmes/record/dupont-aignan.json", ROOT);
const ACTEUR = "PA1206"; // Nicolas Dupont-Aignan in the Assembly's open data

const BASE = "https://data.assemblee-nationale.fr/static/openData/repository";
const LEGS = [
  { leg: 14, url: `${BASE}/14/loi/scrutins/Scrutins_XIV.json.zip`, from: "2012-06-20", to: "2017-06-20", truncated: true },
  { leg: 15, url: `${BASE}/15/loi/scrutins/Scrutins_XV.json.zip`, from: "2017-06-21", to: "2022-06-21" },
  { leg: 16, url: `${BASE}/16/loi/scrutins/Scrutins.json.zip`, from: "2022-06-22", to: "2024-06-09" },
];
// the 14th-legislature file uses singular keys (pour, contre), later ones plural (pours, contres)
const POS = { pours: "P", pour: "P", contres: "C", contre: "C", abstentions: "A", nonVotants: "N" };
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

async function cached(url, name) {
  const file = new URL(name, CACHE);
  try { await access(file); } catch {
    await mkdir(CACHE, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  }
  return readFile(file);
}

function* scrutinsOf(zip) {
  for (const data of Object.values(unzipSync(new Uint8Array(zip)))) {
    const j = JSON.parse(strFromU8(data));
    if (j.scrutins) yield* arr(j.scrutins.scrutin);
    else if (j.scrutin) yield j.scrutin;
  }
}

const votes = [];
const coverage = [];
const gaps = [];
for (const { leg, url, from, to, truncated } of LEGS) {
  const zip = await cached(url, `${leg}_${url.split("/").pop()}`);
  let n = 0, last = from;
  for (const s of scrutinsOf(zip)) {
    if (s.dateScrutin > last) last = s.dateScrutin;
    let pos = null;
    for (const grp of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
      const nom = grp.vote?.decompteNominatif ?? {};
      for (const [k, letter] of Object.entries(POS)) for (const v of arr(nom[k]?.votant)) if (v.acteurRef === ACTEUR) pos = letter;
    }
    if (!pos || pos === "N") continue;
    n++;
    votes.push({ leg, num: Number(s.numero), date: s.dateScrutin, title: s.titre ?? s.objet?.libelle ?? "", sort: s.sort?.code ?? "", pos });
  }
  // the published 14th-legislature file stops in November 2016: report the span the data really covers
  coverage.push({ person: "Nicolas Dupont-Aignan", chamber: "AN", from, to: truncated ? last : to, votes: n });
  if (truncated) gaps.push({ person: "Nicolas Dupont-Aignan", chamber: "AN", from: last, to, why: { fr: `Le fichier ouvert des scrutins de la ${leg}e législature s'arrête le ${last} : les votes suivants ne sont pas couverts.`, en: `The open roll-call file for the ${leg}th legislature stops on ${last}: later votes are not covered.` } });
}
await writeFile(new URL("dupont-aignan-votes.json", CACHE), JSON.stringify(votes));
console.log(coverage.map((c) => `${c.from}…${c.to}: ${c.votes} votes`).join("\n"));

if (process.argv.includes("--shortlist")) {
  const programme = JSON.parse(await readFile(new URL("public/data/programmes/dupont-aignan.json", ROOT), "utf8"));
  const KW = {
    d01: /union européenne|traité.*(européen|lisbonne)|référendum.*europ|ratification.*traité/i,
    d02: /schengen|contrôle.*frontières|frontières/i,
    d03: /ressources propres|prélèvement.*union|budget.*européen/i,
    d04: /ukrain/i,
    d05: /retraite/i,
    d06: /retraite|pension|revalorisation|indexation/i,
    d07: /demi-part|réversion|veuv/i,
    d09: /allocations familiales|prestations.*étrangers|résidence/i,
    d10: /aide médicale|AME/,
    d11: /droit du sol|regroupement familial|nationalité|accord franco-algérien|algérie/i,
    d12: /électricité|EDF|ARENH|tarif.*réglementé|marché.*énergie/i,
    d13: /carburant|ZFE|faibles émissions|taxe.*intérieure|TICPE|essence|gazole/i,
    d14: /heures supplémentaires/i,
    d15: /succession|transmission/i,
    d16: /TVA|frais bancaires/i,
    d17: /commande publique|marchés publics|préférence/i,
    d19: /référendum d'initiative|RIC|référendum/i,
    d20: /chômeurs de longue durée|exonération.*cotisations/i,
    d21: /hôpita|tarification à l'activité|médicament/i,
    d22: /dépendance|autonomie|cinquième branche|congé parental/i,
    d23: /banque de france|banque centrale/i,
    d25: /peines planchers|peine minimale|double peine|expulsion/i,
    d26: /SMIC|salaire minimum/i,
  };
  for (const m of programme.measures) {
    const re = KW[m.id];
    if (!re) continue;
    const hits = votes.filter((v) => re.test(v.title) && /^(l'ensemble|la motion|l'article|la proposition|le projet|la déclaration|l'amendement)/i.test(v.title));
    console.log(`\n=== ${m.id} ${Object.values(m.texts)[0].slice(0, 120)}`);
    for (const v of hits) console.log(`  ${v.leg}/${v.num} ${v.date} ${v.pos} [${v.sort}] ${v.title.slice(0, 260)}`);
  }
}

await mkdir(new URL("./", OUT), { recursive: true });
const byKey = new Map(votes.map((v) => [`${v.leg}/${v.num}`, v]));
const out = {
  generated: new Date().toISOString(),
  coverage,
  notCovered: [
    { person: "Nicolas Dupont-Aignan", chamber: "AN", from: "1997-06-12", to: "2012-06-19", why: { fr: "Votes antérieurs à 2012 (11e à 13e législatures) : pas de données de vote nominatif ouvertes au même format.", en: "Votes before 2012 (11th–13th legislatures): no open roll-call data in the same format." } },
    ...gaps,
    { person: "Nicolas Dupont-Aignan", chamber: "AN", from: "2024-07-18", to: null, why: { fr: "Battu aux élections législatives de 2024 : il ne siège plus à l'Assemblée.", en: "Lost his seat at the 2024 general election: no longer in the Assembly." } },
    { person: "Debout la France", chamber: "AN", from: "2024-07-18", to: null, why: { fr: "Aucun député de Debout la France dans l'Assemblée élue en 2024.", en: "Debout la France has no MP in the Assembly elected in 2024." } },
    { person: "Nicolas Dupont-Aignan", chamber: "Sénat", from: null, to: null, why: { fr: "Jamais sénateur.", en: "Never a senator." } },
    { person: "Nicolas Dupont-Aignan", chamber: "PE", from: null, to: null, why: { fr: "Jamais député européen (sa liste n'a pas eu d'élu en 2019 ni en 2024).", en: "Never an MEP (his list won no seat in 2019 or 2024)." } },
  ],
  people: [{ name: "Nicolas Dupont-Aignan", role: { fr: "Député de l'Essonne (1997-2024), président de Debout la France", en: "MP for Essonne (1997–2024), leader of Debout la France" } }],
  contradictions: contradictions.map((c) => {
    const v = byKey.get(`${c.leg}/${c.num}`);
    if (!v) throw new Error(`no recorded vote for ${c.leg}/${c.num}`);
    if (v.pos !== c.expect) throw new Error(`${c.leg}/${c.num}: recorded ${v.pos}, decision file expects ${c.expect}`);
    return {
      person: "Nicolas Dupont-Aignan",
      chamber: "AN",
      legislature: c.leg,
      date: v.date,
      num: c.num,
      title: v.title,
      url: `https://www.assemblee-nationale.fr/dyn/${c.leg}/scrutins/${c.num}`,
      position: v.pos,
      measure: { lineage: c.measure, label: c.label },
      explanation: c.explanation,
      strength: c.strength,
    };
  }),
};
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ ${out.contradictions.length} contradictions → ${OUT.pathname}`);
