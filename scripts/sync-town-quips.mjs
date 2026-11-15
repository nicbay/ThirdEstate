// One light-hearted, AI-written line per town, shown under the Wikipedia extract on the town page and labelled
// as AI-generated (public/data/town-quips.json). The first lines were written by hand-prompting; this script adds
// the towns that have none yet, largest first.
//
//   node scripts/sync-town-quips.mjs                    dry run: how many towns are missing a line (no API call)
//   node scripts/sync-town-quips.mjs --run              write lines (needs ANTHROPIC_API_KEY; skips cleanly without it)
//   node scripts/sync-town-quips.mjs --run --min-pop=20000 --max=200 --codes=77284,06029
//
// Rules given to the model: one sentence, affectionate, built on something the town is genuinely known for (taken
// from the Wikipedia extract passed in), nothing about politics, crime, poverty, religion or its inhabitants'
// character, no invented fact or figure. Existing lines are never overwritten.
import { readFile, readdir, writeFile } from "node:fs/promises";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const RUN = process.argv.includes("--run");
const MIN_POP = Number(arg("min-pop", 20000)), MAX = Number(arg("max", 300));
const ONLY = arg("codes", "").split(",").filter(Boolean);
const MODEL = "claude-haiku-5-5";

const OUT = new URL("../public/data/town-quips.json", import.meta.url);
const DEP = new URL("../public/data/communes-dep/", import.meta.url);
const file = JSON.parse(await readFile(OUT, "utf8"));

const towns = [];
for (const f of (await readdir(DEP)).filter((x) => x.endsWith(".json"))) {
  const { communes = {} } = JSON.parse(await readFile(new URL(f, DEP), "utf8"));
  for (const c of Object.values(communes)) {
    const pop = c.population?.value ?? 0, wiki = c.media?.wikipedia;
    if (file.quips[c.code] || wiki?.status !== "ok" || !wiki.extract) continue;
    if (ONLY.length ? !ONLY.includes(c.code) : pop < MIN_POP) continue;
    towns.push({ code: c.code, name: c.name, dep: c.department?.name, pop, extract: String(wiki.extract).slice(0, 1200) });
  }
}
towns.sort((a, b) => b.pop - a.pop);
const todo = towns.slice(0, MAX);
console.log(`${Object.keys(file.quips).length} towns have a line; ${towns.length} more qualify (population ≥ ${MIN_POP}); this run would write ${todo.length}.`);
if (!RUN) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) { console.log("ANTHROPIC_API_KEY is not set: nothing written."); process.exit(0); }

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic();
const SYSTEM = `You write one light-hearted sentence about a French town for a civic data site. It appears under the town's Wikipedia extract, labelled "written by an AI, for fun".
Rules: exactly one sentence, at most 25 words, affectionate and dry, built on something the town is genuinely known for and that appears in the extract you are given. No politics, crime, poverty, religion, or remarks on the inhabitants' character or intelligence. Never invent a fact, a date or a number. If the extract gives you nothing to work with, answer {"fr":"","en":""}.
Answer with JSON only: {"fr": "<the sentence in French, with French typography>", "en": "<the same sentence in English>"}`;

let written = 0;
for (const t of todo) {
  try {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 300, system: SYSTEM,
      messages: [{ role: "user", content: `Town: ${t.name} (${t.dep}), ${t.pop} inhabitants.\nWikipedia extract:\n${t.extract}` }],
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    const q = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof q.fr === "string" && typeof q.en === "string" && q.fr.trim() && q.en.trim()) { file.quips[t.code] = { fr: q.fr.trim(), en: q.en.trim() }; written++; }
  } catch (e) {
    console.warn(`${t.code} ${t.name}: ${e.message}`);
  }
}
file.generated = new Date().toISOString().slice(0, 10);
await writeFile(OUT, `${JSON.stringify(file, null, 2)}\n`);
console.log(`✓ ${written} lines written; ${Object.keys(file.quips).length} towns in all.`);
