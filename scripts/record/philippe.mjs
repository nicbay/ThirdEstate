// Recorded votes of Édouard Philippe checked against his programme
// (public/data/programmes/philippe.json). Self-contained: downloads the official open data, caches it under
// .cache/record/, and applies the hand-curated decisions of scripts/data/programmes/philippe-record.mjs.
//
//   node scripts/record/philippe.mjs              # build public/data/programmes/record/philippe.json
//   node scripts/record/philippe.mjs --shortlist  # also write .cache/record/philippe-shortlist.txt (keyword
//                                                   # matches per measure, to review by hand)
//
// Sources: Assemblée nationale open data (scrutins, 14th–16th legislatures as zips; 17th from public/data/an/),
// Sénat (www.senat.fr/scrutin-public session indexes and per-vote JSON lists, from 2006-2007), both under the
// Licence Ouverte. Positions: P pour, C contre, A abstention (non-voting is ignored).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import cfg from "../data/programmes/philippe-record.mjs";

const SLUG = "philippe";
const ROOT = new URL("../../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const PUB = new URL("public/data/", ROOT);
const SHORTLIST = process.argv.includes("--shortlist");
await mkdir(new URL("senat/", CACHE), { recursive: true });

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "thirdestate-record/1.0" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1000 * i);
    }
  }
}
async function cached(name, url) {
  const f = new URL(name, CACHE);
  try { return await readFile(f); } catch {}
  const b = await get(url);
  if (b) await writeFile(f, b);
  return b;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
// minimal zip reader (central directory + deflate), enough for the Assemblée archives
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = [];
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    files.push({ name, data: () => (method === 0 ? raw : inflateRawSync(raw)) });
  }
  return files;
}
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const ENT = { "&eacute;": "é", "&egrave;": "è", "&ecirc;": "ê", "&agrave;": "à", "&acirc;": "â", "&ccedil;": "ç", "&ocirc;": "ô", "&icirc;": "î", "&ucirc;": "û", "&ugrave;": "ù", "&euml;": "ë", "&iuml;": "ï", "&nbsp;": " ", "&deg;": "°", "&amp;": "&", "&quot;": '"', "&#039;": "'", "&rsquo;": "’", "&laquo;": "«", "&raquo;": "»", "&oelig;": "œ", "&Eacute;": "É" };
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-zA-Z#0-9]+;/g, (m) => ENT[m] ?? m).replace(/\s+/g, " ").trim();
const MONTHS = { janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12 };
const frDate = (s) => {
  const m = s.toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/);
  return m && MONTHS[m[2]] ? `${m[3]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

// ---------- Assemblée nationale ----------
const AN_ZIPS = {
  14: "https://data.assemblee-nationale.fr/static/openData/repository/14/loi/scrutins/Scrutins_XIV.json.zip",
  15: "https://data.assemblee-nationale.fr/static/openData/repository/15/loi/scrutins/Scrutins_XV.json.zip",
  16: "https://data.assemblee-nationale.fr/static/openData/repository/16/loi/scrutins/Scrutins.json.zip",
};
const POS = { pours: "P", pour: "P", contres: "C", contre: "C", abstentions: "A", abstention: "A" }; // 14th: pour/contre, later: pours/contres
async function anVotes(leg, pa) {
  const out = [];
  if (leg === 17) {
    const s = JSON.parse(await readFile(new URL("an/scrutins.json", PUB), "utf8"));
    let v = {};
    try { v = JSON.parse(await readFile(new URL(`an/votes/${pa}.json`, PUB), "utf8")); } catch {}
    for (const r of s) if (["P", "C", "A"].includes(v[r[0]])) out.push({ chamber: "AN", legislature: 17, num: r[0], date: r[1], title: r[2], result: r[3], position: v[r[0]] });
    return out;
  }
  const buf = await cached(`Scrutins_${leg}.json.zip`, AN_ZIPS[leg]);
  for (const f of unzip(buf)) {
    if (!f.name.endsWith(".json")) continue;
    const j = JSON.parse(f.data().toString("utf8"));
    for (const s of j.scrutins ? arr(j.scrutins.scrutin) : arr(j.scrutin)) {
      let pos = null;
      for (const g of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
        const d = g.vote?.decompteNominatif ?? {};
        for (const [k, l] of Object.entries(POS)) if (arr(d[k]?.votant).some((x) => x.acteurRef === pa)) pos = l;
      }
      if (pos) out.push({ chamber: "AN", legislature: leg, num: Number(s.numero), date: s.dateScrutin, title: s.titre ?? s.objet?.libelle, result: s.sort?.code, position: pos });
    }
  }
  return out;
}

// ---------- Sénat ----------
async function senatSession(y) {
  // compact cache: { list: [[n, date, title, result]], pos: { n: { matricule: "p"|"c"|"a"|"n" } } }
  const f = new URL(`senat/${y}.json`, CACHE);
  let c = null;
  try { c = JSON.parse(await readFile(f, "utf8")); } catch {}
  const recent = y >= new Date().getFullYear() - 1; // the current session keeps growing: re-read its index
  if (c && !recent) return c;
  const html = (await get(`https://www.senat.fr/scrutin-public/scr${y}.html`))?.toString("utf8");
  if (!html) return { list: [], pos: {} };
  const list = [];
  let date = null;
  const re = new RegExp(`list-group-subtitle">([^<]+)<|<a href="${y}/scr${y}-(\\d+)\\.html">[\\s\\S]*?</a>([\\s\\S]*?)<span class="badge[^"]*">([^<]*)</span>`, "g");
  for (const m of html.matchAll(re)) {
    if (m[1]) { date = frDate(text(m[1])); continue; }
    const title = text(m[3]).replace(/^:\s*/, "").replace(/^sur\s+/i, "").replace(/\s*-?\s*consulter le dossier législatif\s*\.?\s*$/i, "").trim();
    list.push([Number(m[2]), date, title, text(m[4]).toLowerCase()]);
  }
  c ??= { list: [], pos: {} };
  c.list = list;
  const todo = list.filter(([n]) => !c.pos[n]);
  let done = 0;
  await pool(todo, 4, async ([n]) => {
    const b = await get(`https://www.senat.fr/scrutin-public/${y}/scr${y}-${n}.json`);
    const p = {};
    if (b) for (const v of arr(JSON.parse(b.toString("utf8")).votes)) p[v.matricule] = v.vote;
    c.pos[n] = p;
    if (++done % 100 === 0) console.log(`  sénat ${y}: ${done}/${todo.length}`);
  });
  await writeFile(f, JSON.stringify(c));
  return c;
}
async function senatVotes(matricule, fromYear, toYear) {
  const out = [];
  const L = { p: "P", c: "C", a: "A" };
  for (let y = fromYear; y <= toYear; y++) {
    const c = await senatSession(y);
    for (const [n, date, title, result] of c.list) {
      const v = L[c.pos[n]?.[matricule]];
      if (v) out.push({ chamber: "Sénat", legislature: `${y}-${y + 1}`, session: y, num: n, date, title: title.replace(/\s*-?\s*consulter le dossier législatif\s*\.?\s*$/i, "").trim(), result, position: v });
    }
  }
  return out;
}

const url = (v) => (v.chamber === "AN" ? `https://www.assemblee-nationale.fr/dyn/${v.legislature}/scrutins/${v.num}` : `https://www.senat.fr/scrutin-public/${v.session}/scr${v.session}-${v.num}.html`);
const key = (v) => `${v.chamber}|${v.legislature}|${v.num}`;

// ---------- collect ----------
const prog = JSON.parse(await readFile(new URL(`programmes/${SLUG}.json`, PUB), "utf8"));
const measures = new Map(prog.measures.map((m) => [m.id, m]));
const coverage = [];
const all = new Map(); // person → Map(key → vote)
for (const p of cfg.people) {
  const mine = new Map();
  for (const src of p.sources) {
    // exclude: date windows when the seat was held but the person was not voting themselves (e.g. a minister's
    // first month in government, when the Senate group still casts the vote of the seat)
    const vs = (src.chamber === "AN" ? await anVotes(src.legislature, src.id) : await senatVotes(src.id, src.fromSession, src.toSession))
      .filter((v) => !(src.exclude ?? []).some(([a, b]) => v.date >= a && v.date <= b));
    const dates = vs.map((v) => v.date).filter(Boolean).sort();
    coverage.push({ person: p.name, chamber: src.chamber, ...(src.chamber === "AN" ? { legislature: src.legislature } : {}), from: dates[0] ?? null, to: dates.at(-1) ?? null, votes: vs.length });
    for (const v of vs) mine.set(key(v), v);
    console.log(`${p.name} ${src.chamber}${src.legislature ?? ` ${src.fromSession}–${src.toSession}`}: ${vs.length} votes`);
  }
  all.set(p.name, mine);
}

// ---------- shortlist for review ----------
if (SHORTLIST) {
  const lines = [];
  for (const [lineage, res] of Object.entries(cfg.keywords)) {
    const m = measures.get(lineage);
    lines.push(`\n##### ${lineage} ${Object.values(m.texts).join(" || ")}`);
    for (const [person, votes] of all) for (const v of votes.values()) {
      if (res.some((r) => r.test(v.title ?? ""))) lines.push(`${person} | ${v.chamber} ${v.legislature} n°${v.num} ${v.date} [${v.position}] ${v.result} | ${v.title}`);
    }
  }
  await writeFile(new URL(`${SLUG}-shortlist.txt`, CACHE), lines.join("\n"));
  console.log(`shortlist: ${lines.length} lines → .cache/record/${SLUG}-shortlist.txt`);
}

// ---------- curated contradictions ----------
const contradictions = [];
for (const d of cfg.contradictions) {
  const v = all.get(d.person)?.get(`${d.chamber}|${d.legislature}|${d.num}`);
  if (!v) throw new Error(`no recorded vote for ${d.person} ${d.chamber} ${d.legislature} ${d.num}`);
  if (v.position !== d.position) throw new Error(`${d.person} ${d.chamber} ${d.num}: recorded ${v.position}, curated ${d.position}`);
  const m = measures.get(d.lineage);
  if (!m) throw new Error(`unknown measure ${d.lineage}`);
  contradictions.push({
    person: d.person, chamber: d.chamber, legislature: d.legislature, date: v.date, num: d.num, title: v.title, url: url(v), position: v.position,
    measure: { lineage: d.lineage, label: d.label }, explanation: d.explanation, strength: d.strength,
  });
}
contradictions.sort((a, b) => (a.strength === b.strength ? b.date.localeCompare(a.date) : a.strength === "clear" ? -1 : 1));

await mkdir(new URL("programmes/record/", PUB), { recursive: true });
const out = { generated: new Date().toISOString(), coverage, notCovered: cfg.notCovered, people: cfg.people.map((p) => ({ name: p.name, role: p.role })), contradictions };
await writeFile(new URL(`programmes/record/${SLUG}.json`, PUB), JSON.stringify(out, null, 1));
console.log(`${SLUG}: ${contradictions.filter((c) => c.strength === "clear").length} clear, ${contradictions.filter((c) => c.strength === "partial").length} partial contradictions`);
