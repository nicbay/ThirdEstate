// Summary of every candidate's programme file for the homepage and the 2027 page:
// public/data/programmes/<slug>.json (full analysis, or "lite" curated file) → public/data/programmes/index.json.
// Also checks the lite files' shape, so a bad hand edit fails the build rather than the page.
// Run: node scripts/build-programmes-index.mjs (part of `npm run build`).
import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = new URL("../public/data/programmes/", import.meta.url);
const STATUS = new Set(["maintained", "modified", "new", "dropped"]);
const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && !["index.json", "posts.json"].includes(f));
const out = [];
const errors = [];

for (const file of files) {
  const f = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
  const costing = f.costing?.rounds?.length ? f.costing.rounds.at(-1) : null;
  // headline: the latest round the candidate's own party costed and someone independent estimated (not a coalition's)
  const costed = f.costing?.rounds?.filter((r) => r.estimates?.length && !r.coalition).at(-1) ?? f.costing?.rounds?.filter((r) => r.estimates?.length).at(-1) ?? null;
  const base = {
    slug: f.slug, candidate: f.candidate, party: f.party, programme: f.programme ?? null,
    versions: f.versions.map((v) => ({ id: v.id, year: v.year, label: v.label })),
    latestCost: costing ? { year: costing.year, label: costing.label, announced: costing.announced ? { by: costing.announced.by, net: costing.announced.net } : null, estimates: (costing.estimates ?? []).map((e) => ({ by: e.by, net: e.net })) } : null,
    lastEstimate: costed ? { year: costed.year, announced: costed.announced?.net ?? null, by: costed.estimates[0].by, net: costed.estimates[0].net } : null,
  };
  if (f.lite) {
    const ids = new Set(f.versions.map((v) => v.id));
    for (const m of f.measures ?? []) {
      if (!STATUS.has(m.status)) errors.push(`${file} ${m.id}: status ${m.status}`);
      for (const k of Object.keys(m.texts ?? {})) if (!ids.has(k)) errors.push(`${file} ${m.id}: text for unknown version ${k}`);
      if (!m.sources?.length) errors.push(`${file} ${m.id}: no source`);
    }
    const c = { maintained: 0, modified: 0, new: 0, dropped: 0 };
    for (const m of f.measures ?? []) c[m.status]++;
    out.push({ ...base, lite: true, status: f.status, statusNote: f.statusNote, summary: f.summary, counts: c, total: (f.measures ?? []).length });
  } else {
    const n = { kept: 0, changed: 0, drop22: 0, add25: 0, drop25: 0, new27: 0 };
    let inA = 0, inE = 0, inW = 0;
    for (const l of f.lineages) {
      if (l.a) inA++; if (l.e) inE++; if (l.w) inW++;
      if (l.status === "maintained") n.kept++;
      else if (l.status === "modified") n.changed++;
      else if (l.status === "new2025") n.add25++;
      else if (l.status === "new2027") n.new27++;
      else if (l.status === "dropped") l.a ? n.drop22++ : n.drop25++;
    }
    out.push({ ...base, lite: false, status: "published", flow: { ...n, inA, inE, inW }, total: f.lineages.length, inLatest: inW });
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
out.sort((a, b) => (a.status === b.status ? a.candidate.localeCompare(b.candidate, "fr") : ["published", "partial", "none"].indexOf(a.status) - ["published", "partial", "none"].indexOf(b.status)));
await writeFile(new URL("index.json", DIR), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), programmes: out }));
console.log(`programmes index: ${out.length} (${out.map((p) => p.slug).join(", ")})`);
