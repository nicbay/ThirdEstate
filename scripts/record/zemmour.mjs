// Recorded votes of Éric Zemmour (no parliamentary mandate) and his lieutenant Sarah Knafo, checked against the Reconquête programme.
// Collects every roll-call position cast by the people listed in scripts/data/programmes/zemmour-record.mjs (here
// only the European Parliament, from 2024, via HowTheyVote.eu), then applies the hand-reviewed contradictions of
// scripts/data/programmes/zemmour-record.mjs. Each curated entry is re-checked against the downloaded data
// (the recorded position must be the one the explanation describes), so a stale or mistyped entry fails loudly.
//
//   node scripts/record/zemmour.mjs
//
// Downloads are cached under .cache/record/ (delete a file to refresh it).
// Output: public/data/programmes/record/zemmour.json
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createGunzip, gunzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "../lib/csv.mjs";
import curated from "../data/programmes/zemmour-record.mjs";

const SLUG = "zemmour";
const ROOT = new URL("../../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const HTV = "https://github.com/HowTheyVote/data/releases/latest/download/";
const AN_ZIP = {
  15: "https://data.assemblee-nationale.fr/static/openData/repository/15/loi/scrutins/Scrutins_XV.json.zip",
  16: "https://data.assemblee-nationale.fr/static/openData/repository/16/loi/scrutins/Scrutins.json.zip",
};
const HTV_POS = { FOR: "P", AGAINST: "C", ABSTENTION: "A" };

await mkdir(CACHE, { recursive: true });

async function cached(name, url) {
  const file = new URL(name, CACHE);
  try { await access(file); } catch {
    console.log(`downloading ${url}`);
    const res = await fetch(url, { headers: { "user-agent": "thirdestate-record/1.0" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

// ---- Assemblée nationale -------------------------------------------------------------------------------
// votes[chamber key] = Map(num → { date, title, pos, result })
async function anVotes(leg, acteur) {
  const out = new Map();
  if (leg === 17) {
    // 17th legislature: the site's own sync (scripts/sync-assemblee.mjs)
    const rows = JSON.parse(await readFile(new URL("public/data/an/scrutins.json", ROOT), "utf8"));
    const mine = JSON.parse(await readFile(new URL(`public/data/an/votes/${acteur}.json`, ROOT), "utf8"));
    for (const [num, date, title, result] of rows) {
      const pos = mine[num];
      if (["P", "C", "A"].includes(pos)) out.set(String(num), { date, title, pos, result });
    }
    return out;
  }
  const zip = unzipSync(new Uint8Array(await readFile(await cached(`an${leg}.zip`, AN_ZIP[leg]))));
  for (const [name, bytes] of Object.entries(zip)) {
    if (!name.endsWith(".json")) continue;
    const s = JSON.parse(strFromU8(bytes)).scrutin;
    let pos = null;
    for (const g of [].concat(s.ventilationVotes?.organe?.groupes?.groupe || [])) {
      const dn = g.vote?.decompteNominatif || {};
      for (const [k, p] of [["pours", "P"], ["contres", "C"], ["abstentions", "A"]])
        if ([].concat(dn[k]?.votant || []).some((v) => v.acteurRef === acteur)) pos = p;
    }
    if (pos) out.set(String(s.numero), { date: s.dateScrutin, title: s.titre.replace(/\s+/g, " ").trim(), pos, result: s.sort?.code || "" });
  }
  return out;
}

// ---- European Parliament (HowTheyVote.eu) --------------------------------------------------------------
async function epVotes(memberIds) {
  const votesCsv = parseCsv(gunzipSync(await readFile(await cached("htv-votes.csv.gz", HTV + "votes.csv.gz"))).toString("utf8"));
  const head = votesCsv.shift();
  const col = Object.fromEntries(head.map((k, i) => [k, i]));
  const meta = new Map(votesCsv.map((r) => [r[col.id], r]));
  const out = new Map(memberIds.map((id) => [String(id), new Map()]));
  const rl = createInterface({ input: createReadStream(await cached("htv-member_votes.csv.gz", HTV + "member_votes.csv.gz")).pipe(createGunzip()) });
  for await (const line of rl) {
    const [voteId, memberId, position] = line.split(",", 3);
    const mine = out.get(memberId);
    if (!mine || !HTV_POS[position]) continue;
    const v = meta.get(voteId);
    if (!v) continue;
    const title = [v[col.display_title], v[col.description]].filter(Boolean).join(" — ");
    mine.set(voteId, { date: v[col.timestamp].slice(0, 10), title, pos: HTV_POS[position], result: (v[col.result] || "").toLowerCase(), term: v[col.timestamp] >= "2024-07-16" ? 10 : 9 });
  }
  return out;
}

// ---- collect -------------------------------------------------------------------------------------------
const record = new Map(); // `${person}|${chamber}|${legislature}` → Map
const coverage = [];
for (const p of curated.people) {
  for (const leg of p.an?.legislatures || []) {
    const m = await anVotes(leg, p.an.acteur);
    record.set(`${p.name}|AN|${leg}`, m);
    const dates = [...m.values()].map((v) => v.date).sort();
    coverage.push({ person: p.name, chamber: "AN", legislature: String(leg), from: dates[0] || null, to: dates.at(-1) || null, votes: m.size });
  }
}
const epPeople = curated.people.filter((p) => p.ep);
if (epPeople.length) {
  const all = await epVotes(epPeople.map((p) => p.ep.htv));
  for (const p of epPeople) {
    const m = all.get(String(p.ep.htv));
    for (const term of [9, 10]) {
      const sub = new Map([...m].filter(([, v]) => v.term === term));
      if (!sub.size) continue;
      record.set(`${p.name}|PE|${term}`, sub);
      const dates = [...sub.values()].map((v) => v.date).sort();
      coverage.push({ person: p.name, chamber: "PE", legislature: String(term), from: dates[0], to: dates.at(-1), votes: sub.size });
    }
  }
}

// ---- apply the curated review --------------------------------------------------------------------------
const prog = JSON.parse(await readFile(new URL(`public/data/programmes/${SLUG}.json`, ROOT), "utf8"));
const measureIds = new Set(prog.measures.map((m) => m.id));
const url = (c) => c.chamber === "AN" ? `https://www.assemblee-nationale.fr/dyn/${c.legislature}/scrutins/${c.num}`
  : c.chamber === "PE" ? `https://howtheyvote.eu/votes/${c.num}`
  : c.url;
const contradictions = curated.contradictions.map((c) => {
  const v = record.get(`${c.person}|${c.chamber}|${c.legislature}`)?.get(String(c.num));
  if (!v) throw new Error(`${c.person} ${c.chamber} ${c.legislature} #${c.num}: no recorded vote`);
  if (v.pos !== c.position) throw new Error(`${c.person} #${c.num}: recorded ${v.pos}, curated ${c.position}`);
  if (!measureIds.has(c.measure.lineage)) throw new Error(`unknown measure ${c.measure.lineage}`);
  return { person: c.person, chamber: c.chamber, legislature: String(c.legislature), date: v.date, num: String(c.num), title: c.title || v.title, url: url(c), position: v.pos, measure: c.measure, explanation: c.explanation, strength: c.strength };
}).sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "clear" ? -1 : 1) || b.date.localeCompare(a.date));

await mkdir(new URL("public/data/programmes/record/", ROOT), { recursive: true });
const out = {
  generated: new Date().toISOString(),
  coverage,
  notCovered: curated.notCovered,
  people: curated.people.map(({ name, role }) => ({ name, role })),
  contradictions,
};
await writeFile(new URL(`public/data/programmes/record/${SLUG}.json`, ROOT), JSON.stringify(out, null, 1));
for (const c of coverage) console.log(`${c.person} ${c.chamber} ${c.legislature}: ${c.votes} votes (${c.from} → ${c.to})`);
console.log(`${SLUG}: ${contradictions.filter((c) => c.strength === "clear").length} clear, ${contradictions.filter((c) => c.strength === "partial").length} partial contradictions`);
