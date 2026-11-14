// Voting record vs programme: did the candidate (and named lieutenants) ever vote against what
// the 2027 programme now proposes?
//
//   node scripts/build-record.mjs              collect + write public/data/programmes/record/<slug>.json
//   node scripts/build-record.mjs --shortlist  also write .cache/record/<slug>-shortlist.json (keyword hits to review)
//
// Sources (downloads cached under .cache/record/; delete the folder to refresh):
//   Assemblée nationale  open data, per-deputy positions, legislatures 15 and 16 (zips), 17 (public/data/an/)
//   Sénat                scrutin-public JSON (per-senator votes, from session 2006-07) + session index pages (titles, dates)
//   European Parliament  HowTheyVote.eu data release (CSV, 2019 onwards)
//
// The people, the coverage gaps and every contradiction kept are hand-curated in
// scripts/data/programmes/<slug>-record.mjs. The script only checks them against the raw data:
// a curated case whose recorded position doesn't match the source fails the build.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { unzipSync, strFromU8 } from "fflate";

const SLUG = "melenchon";
const ROOT = new URL("../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const cfg = (await import(new URL(`data/programmes/${SLUG}-record.mjs`, new URL("./", import.meta.url)))).default;
const programme = JSON.parse(await readFile(new URL(`public/data/programmes/${SLUG}.json`, ROOT), "utf8"));
const SHORTLIST = process.argv.includes("--shortlist");

await mkdir(CACHE, { recursive: true });
await mkdir(new URL("htv/", CACHE), { recursive: true });
await mkdir(new URL("senat/", CACHE), { recursive: true });

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const exists = (u) => access(u).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(name, url, { optional = false } = {}) {
  const file = new URL(name, CACHE);
  if (await exists(file)) return readFile(file);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": "thirdestate-record-builder" } });
    if (res.status === 404 && optional) return null;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    }
    await sleep(1000 * (attempt + 1));
    if (attempt === 2) throw new Error(`${res.status} for ${url}`);
  }
}

const people = cfg.people;
const records = []; // { person, chamber, legislature, date, num, title, url, position }

// ---------- Assemblée nationale ----------
const AN_ZIPS = {
  15: "https://data.assemblee-nationale.fr/static/openData/repository/15/loi/scrutins/Scrutins_XV.json.zip",
  16: "https://data.assemblee-nationale.fr/static/openData/repository/16/loi/scrutins/Scrutins.json.zip",
};
const POS = { pours: "P", contres: "C", abstentions: "A" };
const anUrl = (leg, num) => `https://www.assemblee-nationale.fr/dyn/${leg}/scrutins/${num}`;
const anPeople = people.filter((p) => p.anId);

for (const [leg, url] of Object.entries(AN_ZIPS)) {
  const files = unzipSync(new Uint8Array(await cached(`an${leg}.zip`, url)));
  for (const data of Object.values(files)) {
    const s = JSON.parse(strFromU8(data)).scrutin;
    const pos = new Map();
    for (const g of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
      const nom = g.vote?.decompteNominatif ?? {};
      for (const [k, letter] of Object.entries(POS)) for (const v of arr(nom[k]?.votant)) pos.set(v.acteurRef, letter);
    }
    // "mise au point": the deputy later stated they meant to vote otherwise (the record itself is unchanged)
    const fix = new Map();
    for (const [k, letter] of Object.entries({ ...POS, nonVotants: "N", nonVotantsVolontaires: "N" }))
      for (const v of arr(s.miseAuPoint?.[k]?.votant)) fix.set(v.acteurRef, letter);
    for (const p of anPeople) {
      const position = pos.get(p.anId);
      if (!position) continue;
      records.push({
        person: p.key, chamber: "AN", legislature: Number(leg), date: s.dateScrutin, num: Number(s.numero),
        title: s.titre ?? s.objet?.libelle ?? "", result: s.sort?.code ?? "", url: anUrl(leg, s.numero), position,
        ...(fix.has(p.anId) ? { miseAuPoint: fix.get(p.anId) } : {}),
      });
    }
  }
}
{
  const AN = new URL("public/data/an/", ROOT);
  const scr = JSON.parse(await readFile(new URL("scrutins.json", AN), "utf8"));
  const byNum = new Map(scr.map((s) => [s[0], s]));
  for (const p of anPeople) {
    let votes = {};
    try { votes = JSON.parse(await readFile(new URL(`votes/${p.anId}.json`, AN), "utf8")); } catch {}
    for (const [num, position] of Object.entries(votes)) {
      if (!"PCA".includes(position)) continue;
      const s = byNum.get(Number(num));
      if (!s) continue;
      records.push({ person: p.key, chamber: "AN", legislature: 17, date: s[1], num: Number(num), title: s[2], result: s[3], url: anUrl(17, num), position });
    }
  }
}

// ---------- Sénat ----------
// Session index pages (scr<YYYY>.html) list every scrutin of session YYYY-(YYYY+1) with its date and object.
// They mix UTF-8 and Latin-1 lines, so decode line by line.
function decodeMixed(buf) {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const latin = new TextDecoder("latin1");
  const out = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 10) {
      const line = buf.subarray(start, i);
      try { out.push(utf8.decode(line)); } catch { out.push(latin.decode(line)); }
      start = i + 1;
    }
  }
  return out.join("\n");
}
const unhtml = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&deg;/g, "°").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è")
  .replace(/&agrave;/g, "à").replace(/&amp;/g, "&").replace(/&#039;|&rsquo;/g, "’").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
const MONTHS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };
function frDate(s) {
  const m = s.trim().match(/^(\d{1,2})(?:er)?\s+(\S+)\s+(\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const senPeople = people.filter((p) => p.senatId);
for (const p of senPeople) {
  for (let year = p.senatSessions[0]; year <= p.senatSessions[1]; year++) {
    const html = decodeMixed(await cached(`senat/scr${year}.html`, `https://www.senat.fr/scrutin-public/scr${year}.html`));
    const items = [];
    let date = null;
    const re = /list-group-subtitle">([^<]+)<|<a href="(\d{4})\/scr\d{4}-(\d+)\.html">Scrutin N&deg;\s*\d+<\/a>([\s\S]*?)<\/p>/g;
    for (const m of html.matchAll(re)) {
      if (m[1]) { date = frDate(unhtml(m[1])); continue; }
      const text = unhtml(m[4].replace(/<a href="\/dossier[\s\S]*?<\/a>/g, "").replace(/<span[\s\S]*?<\/span>/g, ""))
        .replace(/^:\s*/, "").replace(/\s*-\s*\.?$/, "").trim();
      const badge = m[4].match(/badge[^>]*>([^<]+)</)?.[1] ?? "";
      items.push({ num: Number(m[3]), date, title: text, result: badge.trim() });
    }
    // fetch per-senator votes, a few at a time
    for (let i = 0; i < items.length; i += 6) {
      await Promise.all(items.slice(i, i + 6).map(async (it) => {
        const buf = await cached(`senat/scr${year}-${it.num}.json`, `https://www.senat.fr/scrutin-public/${year}/scr${year}-${it.num}.json`, { optional: true });
        if (!buf) return;
        const v = JSON.parse(buf.toString("utf8")).votes?.find((x) => x.matricule === p.senatId)?.vote;
        const position = { p: "P", c: "C", a: "A" }[v];
        if (!position) return;
        records.push({ person: p.key, chamber: "Sénat", legislature: `${year}-${year + 1}`, date: it.date, num: it.num, title: it.title, result: it.result,
          url: `https://www.senat.fr/scrutin-public/${year}/scr${year}-${it.num}.html`, position });
      }));
    }
  }
}

// ---------- European Parliament (HowTheyVote.eu) ----------
const HTV = `https://github.com/HowTheyVote/data/releases/download/${cfg.howTheyVoteRelease}/`;
const epPeople = people.filter((p) => p.htvId);
if (epPeople.length) {
  for (const f of ["votes.csv.gz", "member_votes.csv.gz"]) await cached(`htv/${f}`, HTV + f);
  const parseCsv = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === "\"" && line[i + 1] === "\"") { cur += "\""; i++; } else if (c === "\"") q = false; else cur += c; }
      else if (c === "\"") q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur); return out;
  };
  const lines = (name) => createInterface({ input: createReadStream(new URL(`htv/${name}`, CACHE)).pipe(createGunzip()), crlfDelay: Infinity });
  const ids = new Map(epPeople.map((p) => [String(p.htvId), p]));
  const mine = [];
  let header = null;
  for await (const line of lines("member_votes.csv.gz")) {
    if (!header) { header = line.split(","); continue; }
    const comma1 = line.indexOf(","), comma2 = line.indexOf(",", comma1 + 1);
    const member = line.slice(comma1 + 1, comma2);
    if (!ids.has(member)) continue;
    const [voteId, , position] = parseCsv(line);
    const letter = { FOR: "P", AGAINST: "C", ABSTENTION: "A" }[position];
    if (letter) mine.push({ voteId, member, letter });
  }
  const wanted = new Set(mine.map((m) => m.voteId));
  const votes = new Map();
  let vh = null;
  // votes.csv has quoted multi-line fields only rarely; join lines until quotes balance
  let buf = "";
  for await (const line of lines("votes.csv.gz")) {
    buf = buf ? buf + "\n" + line : line;
    if ((buf.match(/"/g)?.length ?? 0) % 2) continue;
    const row = parseCsv(buf); buf = "";
    if (!vh) { vh = row; continue; }
    const o = Object.fromEntries(vh.map((k, i) => [k, row[i]]));
    if (wanted.has(o.id)) votes.set(o.id, o);
  }
  for (const m of mine) {
    const v = votes.get(m.voteId);
    if (!v) continue;
    const p = ids.get(m.member);
    const title = [v.display_title, v.description, v.amendment_subject].filter(Boolean).join(" — ");
    records.push({ person: p.key, chamber: "PE", legislature: Number(v.timestamp.slice(0, 4)) >= 2024 ? 10 : 9, date: v.timestamp.slice(0, 10), num: Number(v.id),
      title, reference: v.reference || null, isMain: v.is_main === "True", result: v.result, url: `https://howtheyvote.eu/votes/${v.id}`, position: m.letter });
  }
}

// ---------- coverage ----------
const coverage = [];
for (const p of people) {
  for (const chamber of ["AN", "Sénat", "PE"]) {
    const rs = records.filter((r) => r.person === p.key && r.chamber === chamber);
    if (!rs.length) continue;
    const dates = rs.map((r) => r.date).filter(Boolean).sort();
    const note = cfg.coverageNotes?.[`${p.key}:${chamber}`];
    coverage.push({ person: p.name, chamber, from: dates[0], to: dates.at(-1), votes: rs.length,
      byLegislature: Object.fromEntries([...new Set(rs.map((r) => String(r.legislature)))].sort().map((l) => [l, rs.filter((r) => String(r.legislature) === l).length])),
      ...(note ? { note } : {}) });
  }
}
console.log("collected:");
for (const c of coverage) console.log(`  ${c.person.padEnd(18)} ${c.chamber.padEnd(6)} ${c.from} → ${c.to}  ${c.votes} votes  ${JSON.stringify(c.byLegislature)}`);

// ---------- shortlist (keyword search, for manual review) ----------
const lineages = new Map(programme.lineages.map((l) => [l.id, l]));
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
if (SHORTLIST) {
  const out = [];
  for (const topic of cfg.topics) {
    const res = topic.keywords.map((k) => new RegExp(k, "i"));
    const not = (topic.exclude ?? []).map((k) => new RegExp(k, "i"));
    const hits = records.filter((r) => res.some((re) => re.test(norm(r.title))) && !not.some((re) => re.test(norm(r.title))));
    out.push({ topic: topic.id, lineages: topic.lineages.map((id) => [id, lineages.get(id)?.w?.t]), count: hits.length,
      hits: hits.sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => `${r.person}|${r.chamber}|${r.legislature}|${r.num}|${r.date}|${r.position}${r.miseAuPoint ? `(MAP:${r.miseAuPoint})` : ""}|${r.title}`) });
  }
  await writeFile(new URL(`${SLUG}-shortlist.json`, CACHE), JSON.stringify(out, null, 1));
  await writeFile(new URL(`${SLUG}-all.json`, CACHE), JSON.stringify(records));
  console.log(`shortlist: ${out.reduce((s, t) => s + t.count, 0)} hits → .cache/record/${SLUG}-shortlist.json`);
}

// ---------- curated contradictions, checked against the data ----------
const personByKey = new Map(people.map((p) => [p.key, p]));
const contradictions = [];
const errors = [];
for (const c of cfg.contradictions) {
  const r = records.find((x) => x.person === c.person && x.chamber === c.chamber && String(x.legislature) === String(c.legislature) && x.num === c.num);
  const L = lineages.get(c.lineage);
  if (!L) { errors.push(`unknown lineage ${c.lineage}`); continue; }
  if (!L.w) { errors.push(`lineage ${c.lineage} is not in the 2027 programme`); continue; }
  if (!r) { errors.push(`no record for ${c.person} ${c.chamber} ${c.legislature} #${c.num}`); continue; }
  if (r.position !== c.position) { errors.push(`${c.person} ${c.chamber} ${c.legislature} #${c.num}: source says ${r.position}, curated ${c.position}`); continue; }
  if (r.miseAuPoint) { errors.push(`${c.person} ${c.chamber} ${c.legislature} #${c.num}: has a mise au point (${r.miseAuPoint}); review`); continue; }
  contradictions.push({
    person: personByKey.get(c.person).name, chamber: c.chamber, legislature: c.legislature, date: r.date, num: c.num,
    title: r.title, url: r.url, position: r.position,
    measure: { lineage: c.lineage, label: c.label, text: L.w.t },
    explanation: c.explanation, strength: c.strength,
  });
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
contradictions.sort((a, b) => (a.strength === b.strength ? (a.date < b.date ? -1 : 1) : a.strength === "clear" ? -1 : 1));

const out = {
  generated: new Date().toISOString(),
  method: cfg.method,
  coverage,
  notCovered: cfg.notCovered,
  people: people.map((p) => ({ name: p.name, role: p.role, ...(p.anId ? { anId: p.anId } : {}), ...(p.senatId ? { senatId: p.senatId } : {}), ...(p.htvId ? { epId: p.htvId } : {}) })),
  reviewed: cfg.reviewed,
  contradictions,
};
await mkdir(new URL("public/data/programmes/record/", ROOT), { recursive: true });
await writeFile(new URL(`public/data/programmes/record/${SLUG}.json`, ROOT), JSON.stringify(out, null, 1) + "\n");
console.log(`✓ ${contradictions.filter((c) => c.strength === "clear").length} clear, ${contradictions.filter((c) => c.strength === "partial").length} partial → public/data/programmes/record/${SLUG}.json`);
