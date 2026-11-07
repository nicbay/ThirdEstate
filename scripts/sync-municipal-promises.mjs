// Campaign promises of the WINNING list (municipales 2026) in communes of 30,000+ inhabitants, summarised by AI
// from the list's official "profession de foi" PDF.
//
//   node scripts/sync-municipal-promises.mjs                 dry run: list targets, sources found, cost estimate (no API call)
//   node scripts/sync-municipal-promises.mjs --probe         also test whether the Ministry's e-propagande site answers
//   node scripts/sync-municipal-promises.mjs --run           summarise (needs ANTHROPIC_API_KEY; skips cleanly without it)
//   node scripts/sync-municipal-promises.mjs --run --codes=31555,33063 --max-usd=1 --force
//
// Where the PDFs come from: the Ministry of the Interior published the professions de foi of lists in communes of
// 2,500+ inhabitants on https://programme-candidats.interieur.gouv.fr/ (from 9 March 2026, voluntary for the lists).
// That site sits behind a Cloudflare bot challenge, so this script does NOT crawl it (and must not try to get around
// the challenge). Instead, each source PDF is registered by hand in scripts/data/municipal-promises-sources.json:
//
//   { "31555": { "pdf": "https://…/profession-de-foi.pdf", "panel": 5, "round": 1, "publisher": "…", "checked": "2026-11-07" } }
//
// The PDF is then downloaded from that URL into .cache/municipal/pdf/<code>.pdf (or you can drop the file there yourself
// when the URL cannot be fetched by a script). The registered URL is always published as the source link.
//
// Output (docs/data-municipal.md):
//   public/data/municipal/promises/<code>.json   5–8 bullet points (FR + EN), labelled AI-generated, with the source PDF
//   public/data/municipal/promises/index.json    every target commune with its status (summarised / no_source / error)
//
// Budget: scripts/lib/claude.mjs enforces the $15/month cap across all jobs; this script adds its own per-run cap
// (--max-usd, default 3) and stops before a call whose worst case would cross it.

import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { makeCache, fetchRetry, UA } from "./lib/http-cache.mjs";

const ROOT = new URL("../", import.meta.url);
const MUNI = new URL("public/data/municipal/", ROOT);
const OUT = new URL("promises/", MUNI);
const PDF_CACHE = new URL(".cache/municipal/pdf/", ROOT);
const REGISTRY = new URL("scripts/data/municipal-promises-sources.json", ROOT);
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const RUN = flag("run");
const FORCE = flag("force");
const CODES = opt("codes")?.split(",").filter(Boolean) ?? null;
const MAX_USD = Number(opt("max-usd") ?? 3);
const MIN_POP = Number(opt("min-pop") ?? 30000);
const TODAY = new Date().toISOString().slice(0, 10);
const SITE = "https://programme-candidats.interieur.gouv.fr/";
const JOB = "municipal-promises";

// Haiku 5.5 list prices ($/M tokens) — same as scripts/lib/claude.mjs — used for the ESTIMATE only.
const PRICE_IN = 0.1, PRICE_OUT = 0.5;
const TOKENS_PER_PAGE = 3000; // PDF pages are read as text + page image: ~1,500–3,000 tokens a page (upper bound)
const PROMPT_TOKENS = 600, MAX_TOKENS = 1500;

const SYSTEM = `You summarise French municipal election manifestos ("professions de foi") for a neutral civic-information website.
Rules:
- Use ONLY what the document says. Never add facts, figures, names or context that are not in the document.
- Extract the list's main concrete commitments (what they promise to do), not slogans or attacks on opponents.
- 5 to 8 bullets, each one short (max ~20 words), neutral wording, no adjectives of praise, no emoji.
- Keep the document's own figures (amounts, numbers, dates) when given; do not compute new ones.
- Write each bullet in French (as close to the document as possible) and translate it into English.
- If the document contains fewer than 5 identifiable commitments, return only those it contains (minimum 1); if none, return an empty list.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bullets", "theme_count_note"],
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fr", "en", "theme"],
        properties: {
          fr: { type: "string" },
          en: { type: "string" },
          theme: { type: "string", enum: ["security", "transport", "housing", "environment", "economy", "taxes_budget", "education_youth", "social_health", "culture_sport", "democracy", "urban_planning", "other"] },
        },
      },
    },
    theme_count_note: { type: "string", description: "One short sentence (English) on anything that limited the summary, e.g. 'document is mostly images', or empty string." },
  },
};

async function loadTargets() {
  const files = (await readdir(MUNI)).filter((f) => /^[0-9AB]{2,3}\.json$/.test(f));
  const targets = [];
  for (const f of files) {
    const d = JSON.parse(await readFile(new URL(f, MUNI), "utf8"));
    for (const [code, c] of Object.entries(d.communes)) {
      if ((c.population ?? 0) < MIN_POP) continue;
      if (CODES && !CODES.includes(code)) continue;
      targets.push({ code, name: c.name, department: d.department.code, population: c.population, winner: c.y2026?.winner ?? null });
    }
  }
  return targets.sort((a, b) => b.population - a.population);
}

async function loadRegistry() {
  try {
    const j = JSON.parse(await readFile(REGISTRY, "utf8"));
    return j.sources ?? {};
  } catch {
    return {};
  }
}

const pageCount = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length || null;

async function probe() {
  try {
    const res = await fetch(SITE, { headers: { "User-Agent": UA } });
    const body = await res.text();
    const challenge = res.status === 403 && /challenge|Just a moment/i.test(body);
    return { url: SITE, status: res.status, challenge, checked: new Date().toISOString() };
  } catch (e) {
    return { url: SITE, error: String(e.message ?? e), checked: new Date().toISOString() };
  }
}

async function getPdf(code, src) {
  await mkdir(PDF_CACHE, { recursive: true });
  const file = new URL(`${code}.pdf`, PDF_CACHE);
  try {
    await stat(file);
  } catch {
    const C = makeCache(PDF_CACHE);
    await C.cached(`${code}.pdf`, src.pdf, { maxAgeH: null });
  }
  const buf = await readFile(file);
  if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("downloaded file is not a PDF (blocked or moved?)");
  return buf;
}

async function main() {
  const targets = await loadTargets();
  if (!targets.length) {
    console.log("No target communes: run scripts/sync-municipal.mjs first.");
    return;
  }
  const registry = await loadRegistry();
  const probeResult = flag("probe") ? await probe() : null;
  if (probeResult) console.log("e-propagande site:", JSON.stringify(probeResult));

  const withSource = targets.filter((t) => registry[t.code]?.pdf);
  console.log(`${targets.length} communes ≥ ${MIN_POP.toLocaleString("en")} inhabitants; ${withSource.length} with a registered source PDF.`);

  // ---- estimate (always) ----
  let pages = 0, known = 0;
  for (const t of withSource) {
    try {
      const buf = await readFile(new URL(`${t.code}.pdf`, PDF_CACHE));
      const n = pageCount(buf);
      if (n) { pages += n; known++; }
    } catch {}
  }
  const assumedPages = pages + (withSource.length - known) * 4; // professions de foi are usually 2–4 pages
  const estIn = assumedPages * TOKENS_PER_PAGE + withSource.length * PROMPT_TOKENS;
  const estOut = withSource.length * 700;
  const est = (estIn * PRICE_IN + estOut * PRICE_OUT) / 1e6;
  const worst = (estIn * PRICE_IN + withSource.length * MAX_TOKENS * PRICE_OUT) / 1e6;
  console.log(`Estimate: ~${assumedPages} pages, ~${estIn.toLocaleString("en")} input tokens → ~$${est.toFixed(3)} (worst case $${worst.toFixed(3)}); per-run cap $${MAX_USD}.`);
  if (targets.length > withSource.length && !withSource.length)
    console.log(`(Full coverage would be ~${targets.length} PDFs → ~$${((targets.length * (4 * TOKENS_PER_PAGE + PROMPT_TOKENS) * PRICE_IN + targets.length * 700 * PRICE_OUT) / 1e6).toFixed(2)}.)`);

  let summarise = RUN;
  if (RUN && !process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY is not set: skipping the AI step (index is still written).");
    summarise = false;
  }
  if (!RUN) console.log("Dry run (pass --run to summarise).");

  const { ask, MODEL } = summarise ? await import("./lib/claude.mjs") : { ask: null, MODEL: "claude-haiku-5-5" };
  await mkdir(OUT, { recursive: true });
  let spent = 0;
  const rows = [];
  for (const t of targets) {
    const src = registry[t.code];
    const row = { code: t.code, name: t.name, department: t.department, population: t.population, winner: t.winner ? { label: t.winner.label, head: t.winner.head?.name ?? null, nuance: t.winner.nuance } : null };
    const outFile = new URL(`${t.code}.json`, OUT);
    let existing = null;
    try { existing = JSON.parse(await readFile(outFile, "utf8")); } catch {}
    if (!src?.pdf) {
      rows.push({ ...row, status: existing ? "summarised" : "no_source" });
      continue;
    }
    if (src.panel != null && t.winner && src.panel !== t.winner.panel) {
      rows.push({ ...row, status: "error", error: `registered PDF is for panel ${src.panel}, winning list is panel ${t.winner.panel}` });
      continue;
    }
    if (!summarise) {
      rows.push({ ...row, status: existing ? "summarised" : "pending", source: src.pdf });
      continue;
    }
    try {
      const buf = await getPdf(t.code, src);
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (existing && existing.source?.sha256 === sha256 && !FORCE) {
        rows.push({ ...row, status: "summarised", source: src.pdf });
        continue;
      }
      const n = pageCount(buf) ?? 4;
      const worstCall = ((n * TOKENS_PER_PAGE + PROMPT_TOKENS) * PRICE_IN + MAX_TOKENS * PRICE_OUT) / 1e6;
      if (spent + worstCall > MAX_USD) {
        console.log(`Per-run cap $${MAX_USD} reached; stopping.`);
        rows.push({ ...row, status: "pending", source: src.pdf });
        continue;
      }
      const res = await ask(
        {
          system: SYSTEM,
          max_tokens: MAX_TOKENS,
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
                { type: "text", text: `Profession de foi of the list "${t.winner?.label ?? "?"}" (head of list: ${t.winner?.head?.name ?? "?"}) for the 2026 municipal election in ${t.name}. Summarise its main promises.` },
              ],
            },
          ],
        },
        JOB,
      );
      const u = res.usage;
      spent += ((u.input_tokens ?? 0) * PRICE_IN + (u.output_tokens ?? 0) * PRICE_OUT) / 1e6;
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`model stopped: ${res.stop_reason}`);
      const text = res.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(text);
      const bullets = (parsed.bullets ?? []).slice(0, 8);
      const file = {
        code: t.code,
        name: t.name,
        generated: TODAY,
        schemaVersion: 1,
        election: { name: "Municipales 2026", round: src.round ?? null },
        list: t.winner ? { panel: t.winner.panel, label: t.winner.label, head: t.winner.head, nuance: t.winner.nuance, family: t.winner.family } : null,
        source: { pdf: src.pdf, title: src.title ?? "Profession de foi", publisher: src.publisher ?? "Ministère de l'Intérieur (programme-candidats.interieur.gouv.fr)", checked: src.checked ?? null, pages: pageCount(buf), sha256 },
        summary: {
          aiGenerated: true,
          model: MODEL,
          generatedAt: new Date().toISOString(),
          label: { fr: "Résumé généré par IA à partir de la profession de foi officielle — peut contenir des erreurs ; consultez le document source.", en: "AI-generated summary of the official election leaflet — may contain errors; check the source document." },
          bullets,
          limitations: parsed.theme_count_note || null,
        },
        usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens },
      };
      await writeFile(outFile, JSON.stringify(file, null, 1));
      rows.push({ ...row, status: "summarised", source: src.pdf });
      console.log(`  ✓ ${t.code} ${t.name}: ${bullets.length} bullets`);
    } catch (e) {
      rows.push({ ...row, status: "error", error: String(e.message ?? e), source: src.pdf });
      console.log(`  ✗ ${t.code} ${t.name}: ${e.message ?? e}`);
    }
  }

  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  await writeFile(
    new URL("index.json", OUT),
    JSON.stringify(
      {
        generated: TODAY,
        schemaVersion: 1,
        scope: `Winning list of the 2026 municipal election in communes of ${MIN_POP.toLocaleString("en")}+ inhabitants`,
        sourceSite: { url: SITE, note: "Official e-propagande site (communes of 2,500+ inhabitants, publication voluntary for lists, online from 9 March 2026). It is behind a bot challenge, so PDFs are registered by hand in scripts/data/municipal-promises-sources.json.", ...(probeResult ? { probe: probeResult } : {}) },
        aiLabel: { fr: "Résumés générés par IA (Claude Haiku) — toujours vérifier le document source.", en: "AI-generated summaries (Claude Haiku) — always check the source document." },
        counts,
        rows,
      },
      null,
      1,
    ),
  );
  console.log("Status:", JSON.stringify(counts), RUN ? `spent this run ≈ $${spent.toFixed(4)}` : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
