// The candidate's and their lieutenant's own past votes against what the candidate proposes today.
// Collects every recorded vote of the people listed in scripts/data/programmes/<slug>-record.mjs, in each chamber
// they sat in (Assemblée 15th–17th legislatures, European Parliament from 2019), shortlists the votes touching each
// programme measure by keywords (for the hand review), and writes only the contradictions confirmed by hand.
//
//   node scripts/record/roussel.mjs              writes public/data/programmes/record/roussel.json
//   node scripts/record/roussel.mjs --shortlist  also writes .cache/record/roussel-shortlist.txt for review
//
// Sources (cached under .cache/record/):
//   Assemblée 15th/16th: data.assemblee-nationale.fr Scrutins zips (one JSON per vote, nominative positions)
//   Assemblée 17th: public/data/an/ (scrutins.json + votes/PA*.json, from scripts/sync-assemblee.mjs)
//   European Parliament: HowTheyVote.eu data release (members, votes, member_votes CSVs)
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import readline from "node:readline";
import { unzipSync, strFromU8 } from "fflate";

const SLUG = "roussel";
const cfg = (await import(`../data/programmes/${SLUG}-record.mjs`)).default;
const ROOT = new URL("../../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const HTV = "https://github.com/HowTheyVote/data/releases/download/2026-11-14/";
const AN_ZIP = {
  15: "https://data.assemblee-nationale.fr/static/openData/repository/15/loi/scrutins/Scrutins_XV.json.zip",
  16: "https://data.assemblee-nationale.fr/static/openData/repository/16/loi/scrutins/Scrutins.json.zip",
};
await mkdir(CACHE, { recursive: true });

async function cached(name, url) {
  const f = new URL(name, CACHE);
  try { await stat(f); return f; } catch {}
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await writeFile(f, Buffer.from(await r.arrayBuffer()));
      return f;
    } catch (e) { console.warn(`retry ${name}: ${e.message}`); }
  }
  throw new Error(`could not download ${url}`);
}
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
async function* csv(file) {
  const rl = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    // RFC 4180: quoted fields may hold commas and doubled quotes (titles); no multi-line fields in these exports
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { cells.push(cur); cur = ""; } else cur += c;
    }
    cells.push(cur);
    if (!head) { head = cells; continue; }
    yield Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  }
}

// ---------- collect: records[person][chamber] = [{ leg, num, date, title, pos, url }] ----------
const records = new Map(cfg.people.map((p) => [p.name, { AN: [], PE: [] }]));
const anIds = new Map(cfg.people.filter((p) => p.an).map((p) => [p.an.id, p]));

for (const leg of [15, 16]) {
  if (![...anIds.values()].some((p) => p.an.legs.includes(leg))) continue;
  const files = unzipSync(new Uint8Array(await readFile(await cached(`Scrutins_${leg}.json.zip`, AN_ZIP[leg]))));
  for (const data of Object.values(files)) {
    if (!data.length) continue;
    const s = JSON.parse(strFromU8(data)).scrutin;
    for (const grp of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
      const nom = grp.vote?.decompteNominatif ?? {};
      for (const [key, pos] of Object.entries({ pours: "P", contres: "C", abstentions: "A" })) {
        for (const v of arr(nom[key]?.votant)) {
          const p = anIds.get(v.acteurRef);
          if (!p || !p.an.legs.includes(leg)) continue;
          records.get(p.name).AN.push({ leg, num: Number(s.numero), date: s.dateScrutin, title: s.titre ?? s.objet?.libelle ?? "", result: s.sort?.code ?? "", pos, url: `https://www.assemblee-nationale.fr/dyn/${leg}/scrutins/${s.numero}` });
        }
      }
    }
  }
}
if ([...anIds.values()].some((p) => p.an.legs.includes(17))) {
  const rows = new Map(JSON.parse(await readFile(new URL("public/data/an/scrutins.json", ROOT), "utf8")).map((r) => [r[0], r]));
  for (const [id, p] of anIds) {
    if (!p.an.legs.includes(17)) continue;
    const v = JSON.parse(await readFile(new URL(`public/data/an/votes/${id}.json`, ROOT), "utf8"));
    for (const [num, pos] of Object.entries(v)) {
      const r = rows.get(Number(num));
      if (!r || !["P", "C", "A"].includes(pos)) continue;
      records.get(p.name).AN.push({ leg: 17, num: r[0], date: r[1], title: r[2], result: r[3], pos, url: `https://www.assemblee-nationale.fr/dyn/17/scrutins/${r[0]}` });
    }
  }
}
const epIds = new Map(cfg.people.filter((p) => p.ep).map((p) => [String(p.ep.id), p]));
if (epIds.size) {
  const mine = new Map(); // vote_id -> [[person, pos]]
  for await (const r of csv(await cached("htv-member_votes.csv.gz", HTV + "member_votes.csv.gz"))) {
    const p = epIds.get(r.member_id);
    const pos = { FOR: "P", AGAINST: "C", ABSTENTION: "A" }[r.position];
    if (!p || !pos) continue;
    if (!mine.has(r.vote_id)) mine.set(r.vote_id, []);
    mine.get(r.vote_id).push([p.name, pos]);
  }
  for await (const v of csv(await cached("htv-votes.csv.gz", HTV + "votes.csv.gz"))) {
    for (const [name, pos] of mine.get(v.id) ?? []) {
      const date = v.timestamp.slice(0, 10);
      const title = [v.display_title, v.is_main === "True" ? "" : [v.description, v.amendment_subject].filter(Boolean).join(" – ")].filter(Boolean).join(" : ");
      records.get(name).PE.push({ leg: date < "2024-07-16" ? 9 : 10, num: Number(v.id), date, title, procedure: v.procedure_title, main: v.is_main === "True", result: v.result, pos, url: `https://howtheyvote.eu/votes/${v.id}` });
    }
  }
}

// ---------- coverage ----------
const coverage = [];
for (const [person, ch] of records) for (const [chamber, list] of Object.entries(ch)) {
  if (!list.length) continue;
  const dates = list.map((x) => x.date).sort();
  coverage.push({ person, chamber, from: dates[0], to: dates.at(-1), votes: list.length });
}

// ---------- shortlist for the hand review ----------
if (process.argv.includes("--shortlist")) {
  const out = [];
  for (const [mid, re] of Object.entries(cfg.keywords)) {
    out.push(`\n######## ${mid} ${re}`);
    for (const [person, ch] of records) for (const [chamber, list] of Object.entries(ch)) for (const x of list) {
      const text = `${x.title} ${x.procedure ?? ""}`;
      if (!re.test(text) || (chamber === "PE" && cfg.epMainOnly && !x.main) || (chamber === "AN" && cfg.anSkipAmendments && /amendement/i.test(x.title))) continue;
      out.push(`${person} | ${chamber}${x.leg} #${x.num} ${x.date} ${x.pos} ${x.result} | ${text.slice(0, 260)}`);
    }
  }
  await writeFile(new URL(`${SLUG}-shortlist.txt`, CACHE), out.join("\n"));
  console.log(`shortlist: .cache/record/${SLUG}-shortlist.txt (${out.length} lines)`);
}

// ---------- the confirmed contradictions ----------
const contradictions = cfg.contradictions.map((c) => {
  const x = records.get(c.person)?.[c.chamber === "PE" ? "PE" : "AN"]?.find((v) => v.num === c.num && v.leg === c.legislature);
  if (!x) throw new Error(`${c.person}: no recorded vote ${c.chamber} ${c.legislature} #${c.num}`);
  if (c.position && c.position !== x.pos) throw new Error(`${c.person} #${c.num}: recorded ${x.pos}, curated ${c.position}`);
  const label = cfg.measures[c.measure];
  if (!label) throw new Error(`unknown measure ${c.measure}`);
  return { person: c.person, chamber: c.chamber, legislature: c.legislature, date: x.date, num: c.num, title: c.title ?? x.title, url: x.url, position: x.pos, measure: { lineage: c.measure, label }, explanation: c.explanation, strength: c.strength };
}).sort((a, b) => b.date.localeCompare(a.date));

const out = { generated: new Date().toISOString().slice(0, 10), coverage, notCovered: cfg.notCovered, people: cfg.people.map(({ name, role }) => ({ name, role })), contradictions };
await mkdir(new URL("public/data/programmes/record/", ROOT), { recursive: true });
await writeFile(new URL(`public/data/programmes/record/${SLUG}.json`, ROOT), JSON.stringify(out, null, 1));
console.log(`${SLUG}: ${coverage.map((c) => `${c.person} ${c.chamber} ${c.votes}`).join(", ")}; ${contradictions.length} contradictions (${contradictions.filter((c) => c.strength === "clear").length} clear)`);
