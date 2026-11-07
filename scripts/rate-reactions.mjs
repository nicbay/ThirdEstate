// Rate MP reactions to news stories with Claude Haiku 5.5 (shared client, $15/month cap across all jobs).
// For each post that the rule matcher tied to a story (surely or as a candidate), one structured rating:
//   - which story it reacts to (among the candidates, or none),
//   - lean: -1 (gauche) … +1 (droite) from the CONTENT of the post, with a one-line rationale,
//   - populism: 0 … 1 with the rhetorical markers found,
//   - "à vérifier": only for a checkable factual claim the model doubts — never "false"/"incorrect".
// Posts already in data/feed/ratings.json are never re-rated. Newest posts go first; the run stops
// cleanly when the budget (monthly cap, feed share, per-run cap) runs out.
//   node scripts/rate-reactions.mjs [--dry-run] [--limit N]
import { ask, remainingBudget, MODEL, BudgetExceededError } from "./lib/claude.mjs";
import { STATE, readJson, writeJson, snippet, path } from "./lib/feed-common.mjs";
import { loadWindow, postText } from "./lib/stories.mjs";
import { readFile } from "node:fs/promises";

export const PROMPT_VERSION = "feed-rating-v1";
const JOB = "feed";
const BATCH = 8; // posts per request
const argLimit = process.argv.indexOf("--limit");
const MAX_PER_RUN = argLimit > 0 ? +process.argv[argLimit + 1] : +(process.env.FEED_MAX_PER_RUN ?? 120);
const FEED_MONTHLY_SHARE = +(process.env.FEED_MONTHLY_USD ?? 6); // this job's share of the $15 cap
const MIN_REMAINING = 0.25; // leave this much of the global cap for other jobs
const DRY = process.argv.includes("--dry-run");

// Domains a "source" link may point to besides the news articles we provide (official / statistical bodies).
const SOURCE_DOMAINS = [
  "insee.fr", "legifrance.gouv.fr", "assemblee-nationale.fr", "senat.fr", "vie-publique.fr", "data.gouv.fr",
  "service-public.fr", "gouvernement.fr", "economie.gouv.fr", "interieur.gouv.fr", "ccomptes.fr", "banque-france.fr",
  "conseil-constitutionnel.fr", "conseil-etat.fr", "drees.solidarites-sante.gouv.fr", "dares.travail-emploi.gouv.fr",
  "education.gouv.fr", "francetravail.fr", "ec.europa.eu", "europa.eu", "europarl.europa.eu", "oecd.org", "imf.org",
  "un.org", "who.int", "ipcc.ch", "cnccfp.fr", "conseil-etat.fr", "hatvp.fr", "ofpra.gouv.fr", "fipeco.fr",
];
const MARKERS = ["anti_elites", "peuple_vs_elites", "peuple_homogene", "souverainete_populaire", "delegitimation", "complot", "simplisme", "nativisme", "appel_emotionnel"];
const BANNED = /\b(faux|fausse|fausses|mensong\w*|ment|mentent|menteu\w*|erron\w*|inexact\w*|false|untrue|lie|lies|lying|incorrect|wrong|fake|désinformation|disinformation|misinformation)\b/i;

export const SYSTEM = `Tu analyses des messages publiés sur les réseaux sociaux par des député·es français·es, en réaction à l'actualité. Pour chaque message, tu rends une notation JSON. Sois sobre, factuel et équilibré : tes sorties sont publiées sur un site d'information non partisan.

1. story — Parmi les sujets d'actualité candidats (A, B, C…) fournis avec le message, lequel le message commente-t-il directement ? Réponds par la lettre, ou "none" si aucun ne correspond vraiment (simple ressemblance de mots, sujet différent, message sans rapport).

2. political — true si le message exprime une position, une critique ou une proposition politique ; false pour un message purement pratique (agenda, « je serai sur RTL », remerciements sans contenu).

3. lean — Orientation gauche/droite du CONTENU du message, sur l'axe politique français, de -1 (gauche radicale) à +1 (droite radicale), 0 = centre ou neutre. Juge les idées exprimées (économie, redistribution, immigration, sécurité, écologie, Europe, institutions), pas l'étiquette supposée de l'auteur·e. Repères : -1 rupture anticapitaliste ; -0.5 social-démocratie / écologie de gauche ; 0 centre, consensus, neutre ; +0.5 droite libérale-conservatrice ; +1 droite nationaliste / identitaire. score = null si political = false ou si le message n'a aucun contenu idéologique. rationale_fr / rationale_en : une phrase courte (≤ 25 mots) qui cite ce qui, dans le message, justifie la note.

4. populism — 0 (aucune rhétorique populiste) à 1 (très forte), quel que soit le bord. markers : uniquement ceux réellement présents parmi
   anti_elites (attaque « les élites », « la caste », « l'oligarchie »), peuple_vs_elites (peuple pur contre élite corrompue), peuple_homogene (« le peuple veut… » comme bloc unique), souverainete_populaire (la volonté du peuple contre les institutions / contre-pouvoirs), delegitimation (adversaires présentés comme illégitimes, ennemis, traîtres), complot (intentions cachées, manipulation organisée), simplisme (solution simple à un problème complexe), nativisme (« nous » contre les étrangers), appel_emotionnel (indignation ou peur mise en avant à la place d'arguments).
   La critique d'une politique ou d'un gouvernement n'est pas du populisme en soi. rationale_fr / rationale_en : une phrase courte.

5. check — « À vérifier ». Seulement si le message avance une affirmation factuelle VÉRIFIABLE (chiffre, statistique, fait daté, citation, résultat de vote) dont tu doutes raisonnablement. Sinon null. Les opinions, promesses, prévisions et slogans ne sont jamais à vérifier.
   Règles strictes : ne dis jamais que le message est faux, mensonger, erroné ou incorrect, et n'emploie pas ces mots ; explique seulement pourquoi l'affirmation mérite d'être vérifiée (ex. « d'autres sources donnent un chiffre différent », « le chiffre semble être celui des organisateurs », « la période de comparaison n'est pas précisée »). claim : l'affirmation, reformulée brièvement. why_fr / why_en : une ou deux phrases. sources : 1 à 3 liens où vérifier — de préférence les articles fournis (copie exactement leur URL), sinon uniquement la page d'accueil ou une rubrique générale d'un organisme officiel (insee.fr, assemblee-nationale.fr, vie-publique.fr, legifrance.gouv.fr, ccomptes.fr…). N'invente jamais d'URL précise.

Réponds uniquement avec l'objet JSON demandé, un élément par message, dans l'ordre, en reprenant l'index i.`;

const nullable = (s) => ({ anyOf: [s, { type: "null" }] });
const ratingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ratings"],
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "story", "political", "lean", "populism", "check"],
        properties: {
          i: { type: "integer" },
          story: { type: "string" },
          political: { type: "boolean" },
          lean: {
            type: "object",
            additionalProperties: false,
            required: ["score", "rationale_fr", "rationale_en"],
            properties: { score: nullable({ type: "number" }), rationale_fr: { type: "string" }, rationale_en: { type: "string" } },
          },
          populism: {
            type: "object",
            additionalProperties: false,
            required: ["score", "markers", "rationale_fr", "rationale_en"],
            properties: {
              score: { type: "number" },
              markers: { type: "array", items: { type: "string", enum: MARKERS } },
              rationale_fr: { type: "string" },
              rationale_en: { type: "string" },
            },
          },
          check: nullable({
            type: "object",
            additionalProperties: false,
            required: ["claim", "why_fr", "why_en", "sources"],
            properties: {
              claim: { type: "string" },
              why_fr: { type: "string" },
              why_en: { type: "string" },
              sources: {
                type: "array",
                items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } },
              },
            },
          }),
        },
      },
    },
  },
};

const clamp = (x, lo, hi) => (typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x)) * 100) / 100 : null);
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

function buildPrompt(batch, ctx) {
  const parts = batch.map(({ post, cands }, i) => {
    const mp = ctx.mps.get(post.mpId);
    const stories = cands
      .map((c, k) => {
        const s = ctx.byStory.get(c.storyId);
        const arts = s.items.slice(0, 2).map((a) => `     - ${a.title}${a.summary ? ` — ${snippet(a.summary, 200)}` : ""} (${a.link})`);
        return `  ${"ABC"[k]}. ${s.title}\n${arts.join("\n")}`;
      })
      .join("\n");
    return `### Message i=${i}
Auteur·e : ${mp ? `${mp.prenom} ${mp.nom}` : post.mpId}, député·e — ${post.platform}, ${post.time.slice(0, 16).replace("T", " ")} UTC
Texte :
"""
${snippet(postText(post), 1200)}
"""
Sujets candidats :
${stories}`;
  });
  return `Date du jour : ${new Date(ctx.now).toISOString().slice(0, 10)}. Note les ${batch.length} messages suivants.\n\n${parts.join("\n\n")}`;
}

function sanitize(r, { post, cands }, ctx) {
  const k = "ABC".indexOf(r.story?.trim()?.[0]?.toUpperCase());
  const story = r.story !== "none" && k >= 0 && k < cands.length ? ctx.byStory.get(cands[k].storyId) : null;
  let check = r.check;
  if (check) {
    const allowed = new Set(cands.flatMap((c) => ctx.byStory.get(c.storyId).items.map((a) => a.link)));
    check = {
      claim: check.claim.trim(),
      why_fr: check.why_fr.trim(),
      why_en: check.why_en.trim(),
      sources: check.sources
        .filter((s) => allowed.has(s.url) || SOURCE_DOMAINS.some((d) => host(s.url) === d || host(s.url)?.endsWith(`.${d}`)))
        .slice(0, 3),
    };
    // policy: never call an MP's claim false. If the model slipped, drop the flag rather than publish it.
    if (BANNED.test(`${check.why_fr} ${check.why_en}`) || !check.claim) {
      console.warn(`  dropped an "à vérifier" note that broke the wording policy (${post.id})`);
      check = null;
    }
  }
  return {
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    ratedAt: new Date().toISOString(),
    // the chosen story, remembered by its articles (story ids can change as clusters grow)
    storyItems: story ? story.items.slice(0, 6).map((a) => a.id) : [],
    storyTitle: story?.title ?? null,
    political: !!r.political,
    lean: { score: r.political ? clamp(r.lean.score, -1, 1) : null, rationale_fr: r.lean.rationale_fr, rationale_en: r.lean.rationale_en },
    populism: {
      score: clamp(r.populism.score, 0, 1) ?? 0,
      markers: [...new Set(r.populism.markers.filter((m) => MARKERS.includes(m)))],
      rationale_fr: r.populism.rationale_fr,
      rationale_en: r.populism.rationale_en,
    },
    check,
  };
}

async function feedSpentThisMonth() {
  const f = path(`data/usage/claude-${new Date().toISOString().slice(0, 7)}.json`);
  try {
    return JSON.parse(await readFile(f, "utf8")).byJob?.[JOB] ?? 0;
  } catch {
    return 0;
  }
}

// ---------- main ----------
const ctx = await loadWindow();
ctx.byStory = new Map(ctx.stories.map((s) => [s.id, s]));
const store = await readJson(STATE.ratings, { ratings: {}, failures: {} });
store.failures ??= {};
const todo = ctx.posts
  .filter((p) => ctx.matches.has(p.id) && !store.ratings[p.id] && (store.failures[p.id] ?? 0) < 2)
  .sort((a, b) => b.time.localeCompare(a.time)) // newest first
  .map((post) => ({ post, cands: ctx.matches.get(post.id).candidates }));
console.log(`${todo.length} matched post(s) waiting for a rating (${Object.keys(store.ratings).length} already rated).`);

if (!todo.length) process.exit(0);
if (DRY) {
  console.log(`--dry-run: first request would be:\n\n${buildPrompt(todo.slice(0, BATCH), ctx)}`);
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is not set: skipping the rating step (the feed is still built, with unrated reactions).");
  process.exit(0);
}

let spent = 0;
let rated = 0;
let calls = 0;
const queue = todo.slice(0, MAX_PER_RUN);
for (let i = 0; i < queue.length; i += BATCH) {
  const left = await remainingBudget();
  const share = FEED_MONTHLY_SHARE - (await feedSpentThisMonth());
  if (left < MIN_REMAINING || share <= 0) {
    console.log(`Budget stop: $${left.toFixed(2)} left on the monthly cap, $${share.toFixed(2)} left of the feed's $${FEED_MONTHLY_SHARE} share. ${queue.length - i} post(s) left for later.`);
    break;
  }
  const batch = queue.slice(i, i + BATCH);
  const before = await remainingBudget();
  let res;
  try {
    res = await ask(
      {
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(batch, ctx) }],
        max_tokens: 1500 + batch.length * 450,
        output_config: { effort: "low", format: { type: "json_schema", schema: ratingSchema } },
      },
      JOB,
    );
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`Budget stop: ${e.message}`);
      break;
    }
    console.warn(`Request failed (${e.status ?? ""} ${e.message}); these ${batch.length} posts will be retried next run.`);
    for (const b of batch) store.failures[b.post.id] = (store.failures[b.post.id] ?? 0) + 1;
    continue;
  }
  calls++;
  spent += before - (await remainingBudget());
  const text = res.content.find((c) => c.type === "text")?.text;
  let parsed = null;
  try {
    parsed = res.stop_reason === "end_turn" && text ? JSON.parse(text) : null;
  } catch {}
  if (!parsed) {
    console.warn(`Unusable response (stop_reason=${res.stop_reason}); ${batch.length} posts will be retried once.`);
    for (const b of batch) store.failures[b.post.id] = (store.failures[b.post.id] ?? 0) + 1;
  } else {
    for (const r of parsed.ratings) {
      const b = batch[r.i];
      if (!b || store.ratings[b.post.id]) continue;
      store.ratings[b.post.id] = { ...sanitize(r, b, ctx), postTime: b.post.time };
      delete store.failures[b.post.id];
      rated++;
    }
  }
  await writeJson(STATE.ratings, store, true); // save after every batch: a crash never loses paid work
}

// forget ratings of posts that left the state files long ago (archives keep the published copy)
const keep = Date.now() - 14 * 24 * 3600e3;
for (const [id, r] of Object.entries(store.ratings)) if (Date.parse(r.postTime) < keep) delete store.ratings[id];
await writeJson(STATE.ratings, store, true);
console.log(`Rated ${rated} post(s) in ${calls} request(s), cost $${spent.toFixed(4)}. Monthly cap left: $${(await remainingBudget()).toFixed(2)}.`);
