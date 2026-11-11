// Summary of every candidate's programme file for the homepage and the 2027 page:
// public/data/programmes/<slug>.json (full analysis, or "lite" curated file) → public/data/programmes/index.json.
// Also checks the lite files' shape, so a bad hand edit fails the build rather than the page.
// Run: node scripts/build-programmes-index.mjs (part of `npm run build`).
import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = new URL("../public/data/programmes/", import.meta.url);
const STATUS = new Set(["maintained", "modified", "new", "dropped"]);
// <slug>-household.json holds the household simulator's distribution data, not a programme
const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && !["index.json", "posts.json", "compare.json"].includes(f) && !f.endsWith("-household.json"));
const out = [];
const errors = [];
// compare.json: every candidate's current measures in one compact file, for the hub (#/programmes): theme by theme,
// with each measure's status, legal read, feasibility and cost. Full notes and sources stay in the candidate's own file.
const compare = [];
let themes = [];
const firstClause = (t) => t.split(/[.;:(]/)[0].trim().slice(0, 110);

for (const file of files) {
  const f = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
  const costing = f.costing?.rounds?.length ? f.costing.rounds.at(-1) : null;
  // headline: the latest round the candidate's own party costed and someone independent estimated (not a coalition's)
  const costed = f.costing?.rounds?.filter((r) => r.estimates?.length && !r.coalition).at(-1) ?? f.costing?.rounds?.filter((r) => r.estimates?.length).at(-1) ?? null;
  const base = {
    slug: f.slug, candidate: f.candidate, party: f.party, programme: f.programme ?? null,
    versions: f.versions.map((v) => ({ id: v.id, year: v.year, label: v.label })),
    latestCost: costing ? { year: costing.year, label: costing.label, announced: costing.announced ? { by: costing.announced.by, net: costing.announced.net } : null, estimates: (costing.estimates ?? []).map((e) => ({ by: e.by, net: e.net })) } : null,
    lastEstimate: costed ? { year: costed.year, label: costed.label, horizon: costed.horizon, announced: costed.announced?.net ?? null, by: costed.estimates[0].by, net: costed.estimates[0].net } : null,
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
    const last = f.versions.at(-1).id, first = f.versions[0].id;
    compare.push({ slug: f.slug, lite: true, measures: (f.measures ?? []).map((m) => {
      const text = m.texts[last] ?? m.texts[first] ?? Object.values(m.texts)[0] ?? "";
      return { id: m.id, theme: m.theme, status: m.status, label: m.short ?? null, text, legal: m.legal ?? "unknown", feasibility: m.feasibility ?? null, cost: m.cost?.value ?? null, by: m.cost?.by ?? null, broad: !!m.broadBenefit };
    }) });
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
    themes = f.themes ?? themes;
    const byId = new Map(f.lineages.map((l) => [l.id, l]));
    compare.push({ slug: f.slug, lite: false, measures: (f.assessment ?? []).flatMap((a) => {
      const l = byId.get(a.id);
      if (!l?.w) return [];
      return [{ id: a.id, theme: l.theme, status: l.status.startsWith("new") ? "new" : l.status, label: a.short ?? null, text: l.w.t, legal: a.legal ?? "unknown", feasibility: a.feasibility ?? null, cost: a.cost ?? null, by: a.by ?? null, broad: !!a.broadBenefit }];
    }) });
    out.push({ ...base, lite: false, status: "published", flow: { ...n, inA, inE, inW }, total: f.lineages.length, inLatest: inW });
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
out.sort((a, b) => (a.status === b.status ? a.candidate.localeCompare(b.candidate, "fr") : ["published", "partial", "none"].indexOf(a.status) - ["published", "partial", "none"].indexOf(b.status)));
await writeFile(new URL("index.json", DIR), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), programmes: out }));
for (const c of compare) for (const m of c.measures) if (!m.label) m.label = { fr: firstClause(m.text), en: firstClause(m.text) };
await writeFile(new URL("compare.json", DIR), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), themes, candidates: compare }));
console.log(`programmes index: ${out.length} (${out.map((p) => p.slug).join(", ")})`);
