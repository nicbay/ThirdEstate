// Build-time check of the hand-curated candidate files (public/data/candidates/*.json), see docs/data-candidates.md.
// 1. Every fact, list item, mandate and pay-scale section has at least one source with an https URL and a date.
// 2. Required fields and enums are present; wording fields are bilingual.
// 3. Presidential and 2012–2024 legislative results are cross-checked against our own history files (warnings).
// 4. Writes public/data/candidates/index.json (poll name → slug, card fields) for the 2027 page.
// Exits 1 on any error, so `npm run build` fails.
import fs from "node:fs";
import path from "node:path";

const DIR = "public/data/candidates";
const errors = [];
const warnings = [];
const err = (f, where, msg) => errors.push(`${f}: ${where}: ${msg}`);
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function checkSources(f, where, sources, { required = true } = {}) {
  if (!Array.isArray(sources) || (required && sources.length === 0)) return err(f, where, "no sources");
  sources.forEach((s, i) => {
    if (!s || typeof s !== "object") return err(f, `${where}.sources[${i}]`, "not an object");
    if (typeof s.url !== "string" || !/^https:\/\//.test(s.url)) err(f, `${where}.sources[${i}]`, `url must be https (${s.url})`);
    if (typeof s.date !== "string" || !DATE.test(s.date)) err(f, `${where}.sources[${i}]`, `bad date (${s.date})`);
    if (!s.title || !s.publisher) err(f, `${where}.sources[${i}]`, "title and publisher required");
  });
}
const bi = (f, where, o, nullable = false) => {
  if (o == null && nullable) return;
  if (!o || typeof o.fr !== "string" || typeof o.en !== "string" || !o.fr || !o.en) err(f, where, "needs {fr, en}");
};
const TYPES = ["presidential", "legislative", "european", "regional", "departmental", "cantonal", "municipal", "senatorial"];
const OFFICES = ["depute", "senateur", "mep", "premier-ministre", "ministre", "ministre-delegue", "secretaire-etat", "maire", "adjoint", "conseiller-municipal", "conseiller-regional", "vice-president-region", "president-region", "conseiller-departemental", "vice-president-departement", "president-departement", "conseiller-communautaire", "president-epci", "fonctionnaire", "other"];

const polls = JSON.parse(fs.readFileSync("public/data/polls/2027.json", "utf8"));
const pollNames = new Set(polls.firstRound.flatMap((p) => p.hyps.flatMap((h) => Object.keys(h))));
const presIndex = JSON.parse(fs.readFileSync("public/data/history/presidential/index.json", "utf8"));
const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();
const legCache = {};
const leg = (y) => (legCache[y] ??= fs.existsSync(`public/data/history/legislative/${y}.json`) ? JSON.parse(fs.readFileSync(`public/data/history/legislative/${y}.json`, "utf8")) : null);

const index = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "pay-scales.json" && f !== "index.json").sort();
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (d.slug !== f.replace(/\.json$/, "")) err(f, "slug", "must match file name");
  for (const k of ["name", "pollName", "verified"]) if (!d[k]) err(f, k, "required");
  if (!DATE.test(d.verified ?? "")) err(f, "verified", "bad date");
  if (!pollNames.has(d.pollName)) warnings.push(`${f}: pollName "${d.pollName}" not found in the 2027 polls`);
  const ph = d.photo;
  if (!ph || !/^https:\/\/commons\.wikimedia\.org\//.test(ph.src ?? "") || !ph.author || !ph.licence || !/^https:/.test(ph.page ?? "")) err(f, "photo", "Commons src, page, author and licence required");
  bi(f, "party", d.party); checkSources(f, "party", d.party?.sources);
  bi(f, "role", d.role); checkSources(f, "role", d.role?.sources);
  if (d.born) checkSources(f, "born", d.born.sources);
  (d.links ?? []).forEach((l, i) => { bi(f, `links[${i}]`, l); if (!/^https:\/\//.test(l.url ?? "")) err(f, `links[${i}]`, "https url required"); });
  if (d.an != null && !/^PA\d+$/.test(d.an)) err(f, "an", "must be PA… or null");

  const w = d.wealth;
  if (!w || !["published", "none"].includes(w.status)) err(f, "wealth.status", "published | none");
  else {
    bi(f, "wealth.explanation", w.explanation); checkSources(f, "wealth", w.sources);
    if (w.status === "published" && !w.declarations?.length) err(f, "wealth", "published without declarations");
    (w.declarations ?? []).forEach((x, i) => { bi(f, `wealth.declarations[${i}].context`, x.context); bi(f, `wealth.declarations[${i}].note`, x.note, true); checkSources(f, `wealth.declarations[${i}]`, x.sources); if (x.net != null && typeof x.net !== "number") err(f, `wealth.declarations[${i}].net`, "number or null"); });
  }

  const c = d.convictions;
  if (!c) err(f, "convictions", "required");
  else {
    checkSources(f, "convictions", c.sources);
    (c.definitive ?? []).forEach((x, i) => {
      const w = `convictions.definitive[${i}]`;
      for (const k of ["court", "offence", "sentence", "final"]) bi(f, `${w}.${k}`, x[k]);
      if (!["penal", "press", "civil"].includes(x.kind)) err(f, w, "kind penal | press | civil");
      if (!DATE.test(x.date ?? "")) err(f, w, "date");
      checkSources(f, w, x.sources);
      // primary source, or at least two outlets
      if ((x.sources?.length ?? 0) < 2 && !/legifrance|courdecassation|conseil-etat|conseil-constitutionnel/.test(x.sources?.[0]?.url ?? "")) err(f, w, "needs a primary source or two outlets");
    });
    (c.pending ?? []).forEach((x, i) => {
      const w = `convictions.pending[${i}]`;
      for (const k of ["court", "subject", "status"]) bi(f, `${w}.${k}`, x[k]);
      checkSources(f, w, x.sources);
      if ((x.sources?.length ?? 0) < 2 && !/legifrance|courdecassation|conseil-etat/.test(x.sources?.[0]?.url ?? "")) err(f, w, "needs a primary source or two outlets");
    });
  }

  (d.candidacies ?? []).forEach((x, i) => {
    const w = `candidacies[${i}]`;
    if (!TYPES.includes(x.type)) err(f, w, `type ${x.type}`);
    if (!DATE.test(x.date ?? "")) err(f, w, "date");
    bi(f, `${w}.office`, x.office); bi(f, `${w}.result`, x.result); bi(f, `${w}.list`, x.list, true);
    if (typeof x.elected !== "boolean") err(f, w, "elected boolean");
    checkSources(f, w, x.sources);
    const year = +x.date.slice(0, 4);
    // cross-check with our own data
    if (x.type === "presidential") {
      const e = presIndex.elections.find((e) => e.year === year && e.direct);
      if (e) {
        const file = JSON.parse(fs.readFileSync(`public/data/history/presidential/${e.file}`, "utf8"));
        const r1 = file.rounds.find((r) => r.round === 1)?.candidates.find((k) => norm(k.name) === norm(d.name));
        if (!r1) warnings.push(`${f}: ${w} presidential ${year}: not in our history file`);
        else if (x.round === 1 && x.pct != null && Math.abs(r1.pct - x.pct) > 0.06) warnings.push(`${f}: ${w} presidential ${year}: ${x.pct} vs our ${r1.pct}`);
      }
    }
    if (x.type === "legislative" && year >= 2012 && leg(year)) {
      const L = leg(year);
      const hits = Object.entries(L.districts).flatMap(([code, dd]) => [["t1", dd.t1], ["t2", dd.t2]].flatMap(([t, r]) => (r?.c ?? []).filter((k) => norm(k[2]) === norm(d.name)).map((k) => ({ code, t, pct: (100 * k[1]) / r.e, el: k[3] }))));
      if (!hits.length) warnings.push(`${f}: ${w} legislative ${year}: not found in our ${year} file`);
      else if (x.pct != null) {
        const best = hits.find((h) => h.t === (x.round === 2 ? "t2" : "t1")) ?? hits[0];
        if (Math.abs(best.pct - x.pct) > 0.15) warnings.push(`${f}: ${w} legislative ${year}: ${x.pct} vs our ${best.pct.toFixed(2)} (${best.code} ${best.t})`);
      }
    }
  });

  (d.mandates ?? []).forEach((x, i) => {
    const w = `mandates[${i}]`;
    if (!OFFICES.includes(x.office)) err(f, w, `office ${x.office}`);
    bi(f, `${w}.label`, x.label);
    if (x.from != null && !DATE.test(x.from)) err(f, w, "from");
    if (x.to != null && !DATE.test(x.to)) err(f, w, "to");
    checkSources(f, w, x.sources);
  });
  (d.partyFunding ?? []).forEach((x, i) => { bi(f, `partyFunding[${i}].label`, x.label); if (!["campaign", "party"].includes(x.kind)) err(f, `partyFunding[${i}]`, "kind"); checkSources(f, `partyFunding[${i}]`, x.sources); });
  if (!d.quiz || !Array.isArray(d.quiz.groups)) err(f, "quiz", "groups required");
  bi(f, "quiz.note", d.quiz?.note, true);

  index.push({ slug: d.slug, name: d.name, pollName: d.pollName, photo: ph?.src, party: { fr: d.party?.fr, en: d.party?.en }, role: { fr: d.role?.fr, en: d.role?.en }, verified: d.verified });
}

// pay scales: every section sourced
const pay = JSON.parse(fs.readFileSync(path.join(DIR, "pay-scales.json"), "utf8"));
for (const k of ["pointIndice", "parliament", "mep", "government", "local", "ecretement"]) checkSources("pay-scales.json", k, pay[k]?.sources);
for (const k of ["changes"]) if (!pay.pointIndice?.[k]?.length) err("pay-scales.json", "pointIndice", "changes required");

for (const w of warnings) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  console.error(`check-candidates: ${errors.length} error(s)`);
  process.exit(1);
}
const out = JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), candidates: index }, null, 1) + "\n";
const idxPath = path.join(DIR, "index.json");
// only rewrite when the content (not the date) changed, so builds don't dirty the tree
const prev = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, "utf8") : "";
if (prev.replace(/"generatedAt": "[^"]*"/, "") !== out.replace(/"generatedAt": "[^"]*"/, "")) fs.writeFileSync(idxPath, out);
console.log(`check-candidates: ${files.length} candidates OK, every fact sourced (${warnings.length} warning(s))`);
