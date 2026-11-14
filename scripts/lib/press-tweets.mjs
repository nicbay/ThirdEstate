// Tweets quoted by the press (data/feed/press-tweets.json, from sync-press-tweets.mjs) -> story "press" entries.
// Used by build-feed.mjs. No network, no AI.
import { STATE, SOCIALS, DEPUTES, path, readJson, tokens } from "./feed-common.mjs";

// Left / centre / right of each parliamentary group, used only when a post has no content rating.
// It is the author's camp, not a reading of the post, and the page says so. NI and groups we can't
// place (UNT) stay unplaced rather than guessed.
const GROUP_SIDE = {
  // Assemblée
  "LFI-NFP": "left", SOC: "left", ECOS: "left", GDR: "left",
  EPR: "centre", DEM: "centre", HOR: "centre", LIOT: "centre",
  DR: "right", UDR: "right", RN: "right",
  // Sénat
  "CRCE-K": "left", SER: "left", GEST: "left",
  RDPI: "centre", UCI: "centre", RDSE: "centre",
  "Les Républicains": "right", "Les Indépendants": "right",
};

// Presidential candidates (public/data/candidates/*) don't list their X accounts, so the main ones are here.
// Keep in sync with candidates/index.json. Bardella is not a candidate but leads the RN and is quoted daily.
const CANDIDATE_X = {
  JLMelenchon: ["melenchon", "Jean-Luc Mélenchon", "La France insoumise", "left"],
  n_arthaud: ["arthaud", "Nathalie Arthaud", "Lutte ouvrière", "left"],
  Fabien_Roussel: ["roussel", "Fabien Roussel", "Parti communiste français", "left"],
  marinetondelier: ["tondelier", "Marine Tondelier", "Les Écologistes", "left"],
  rglucks1: ["glucksmann", "Raphaël Glucksmann", "Place publique", "left"],
  GabrielAttal: ["attal", "Gabriel Attal", "Renaissance", "centre"],
  EPhilippe_LH: ["philippe", "Édouard Philippe", "Horizons", "centre"],
  DeVillepin: ["villepin", "Dominique de Villepin", "La France humaniste", "centre"],
  BrunoRetailleau: ["retailleau", "Bruno Retailleau", "Les Républicains", "right"],
  davidlisnard: ["lisnard", "David Lisnard", "Nouvelle Énergie", "right"],
  dupontaignan: ["dupont-aignan", "Nicolas Dupont-Aignan", "Debout la France", "right"],
  MLP_officiel: ["le-pen", "Marine Le Pen", "Rassemblement national", "right"],
  J_Bardella: [null, "Jordan Bardella", "Rassemblement national", "right"],
  ZemmourEric: ["zemmour", "Éric Zemmour", "Reconquête", "right"],
};
// Executive heads and party accounts, quoted almost daily (ministers change too often to list).
const OTHER_X = {
  EmmanuelMacron: ["Emmanuel Macron", "Président de la République", "centre"],
  SebLecornu: ["Sébastien Lecornu", "Premier ministre", "centre"],
  RNational_off: ["Rassemblement national", "Rassemblement national", "right"],
  lesRepublicains: ["Les Républicains", "Les Républicains", "right"],
  partisocialiste: ["Parti socialiste", "Parti socialiste", "left"],
  FranceInsoumise: ["La France insoumise", "La France insoumise", "left"],
  PCF: ["Parti communiste français", "Parti communiste français", "left"],
};

// The outlets' own accounts and wire/broadcast accounts: an article linking its own live feed isn't a reaction.
const MEDIA = new Set(
  "franceinfo franceinfoplus lemondefr le_figaro lefigaro libe liberation_info humanite_fr mediapart lesechos lexpress lopinion_fr leparisien le_parisien 20minutes publicsenat lcp jdd lejdd valeurs afpfr afp bfmtv cnews tf1info tf1plus franceinter rtlfrance europe1 lci franceculture france24 francetvinfo bfmparis bfmpolitique"
    .split(" "),
);

const handleOf = (x) => {
  const s = typeof x === "string" ? x : x?.handle ?? x?.url;
  const h = s?.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0].toLowerCase();
  return h && /^\w{1,15}$/.test(h) ? h : null;
};

/** Map lowercased X handle -> author { kind, id, name, group, side, party }. MPs first, then senators, then candidates. */
export async function loadAuthors() {
  const out = new Map();
  const put = (h, a) => h && !out.has(h) && out.set(h, a);
  const grp = (g) => (g ? { abrev: g.abrev, libelle: g.libelle, couleur: g.couleur } : null);
  const deputes = await readJson(DEPUTES, []);
  const socials = await readJson(SOCIALS, {});
  for (const d of deputes) {
    const a = { kind: "mp", id: d.id, name: `${d.prenom} ${d.nom}`, group: grp(d.groupe), side: GROUP_SIDE[d.groupe?.abrev] ?? null };
    put(handleOf(socials[d.id]?.x ?? socials[d.id]?.twitter), a);
    put(handleOf(d.socials?.twitter), a);
  }
  const sen = await readJson(path("public/data/senat/senateurs.json"), []);
  for (const s of Array.isArray(sen) ? sen : sen.senateurs ?? [])
    put(handleOf(s.socials?.twitter ?? s.socials?.x), { kind: "senator", id: s.id, name: `${s.prenom} ${s.nom}`, group: grp(s.groupe), side: GROUP_SIDE[s.groupe?.abrev] ?? null });
  for (const [h, [slug, name, party, side]] of Object.entries(CANDIDATE_X)) put(h.toLowerCase(), { kind: slug ? "candidate" : "leader", id: slug, name, party, group: null, side });
  for (const [h, [name, party, side]] of Object.entries(OTHER_X)) put(h.toLowerCase(), { kind: "leader", id: null, name, party, group: null, side });
  return out;
}

// A live blog covers the whole day's news (a campaign live also carries the 13-Novembre tributes), so the
// posts it embeds are only kept for the story when their own text uses one of the story's key terms.
const LIVE = (it) => /en-direct|\/live\/|[/-]direct[-_]/i.test(it.link) || /^(en )?direct\b/i.test(it.title);
function fitsStory(text, story) {
  const terms = new Set(story.terms ?? []);
  return tokens(text ?? "").some((t) => terms.has(t));
}

const sideOfScore = (x) => (x <= -0.2 ? "left" : x >= 0.2 ? "right" : "centre");

/**
 * Tweets embedded in each article, with oEmbed text/author filled in and the author resolved.
 * Returns (items, ratings) -> press entries for a story, deduplicated by tweet, newest first.
 */
export async function pressTweets(ratings) {
  const store = await readJson(STATE.pressTweets, { articles: {}, oembed: {} });
  const authors = await loadAuthors();
  return function forStory(story, items = story.items) {
    const byId = new Map();
    for (const it of items) {
      const live = LIVE(it);
      for (const t0 of store.articles[it.id]?.tweets ?? []) {
        const oe = store.oembed?.[t0.id];
        const handle = (oe && !oe.error && oe.handle) || t0.handle;
        if (!handle || MEDIA.has(handle.toLowerCase())) continue;
        const author = authors.get(handle.toLowerCase()) ?? { kind: "account", id: null, name: (oe && !oe.error && oe.name) || t0.name || null, group: null, side: null };
        if (live && !fitsStory(t0.text || oe?.text, story)) continue;
        let p = byId.get(t0.id);
        if (!p) {
          const r = ratings[`x:${t0.id}`]; // MPs' embedded posts may already be rated by rate-reactions.mjs
          const score = r?.political !== false ? r?.lean?.score : null;
          const side = typeof score === "number" ? sideOfScore(score) : author.side ?? null;
          p = {
            id: `x:${t0.id}`,
            platform: "x",
            url: `https://x.com/${handle}/status/${t0.id}`,
            handle,
            time: t0.time,
            dateText: t0.dateText ?? null,
            text: t0.text || (oe && !oe.error && oe.text) || null,
            author,
            side,
            // why the post sits where it does: its rated content, else its author's group/party, else nowhere
            sideFrom: typeof score === "number" ? "content" : author.side ? (author.kind === "mp" || author.kind === "senator" ? "group" : "party") : null,
            rating: r ? { political: r.political, lean: r.lean, populism: r.populism, check: r.check, model: r.model, ratedAt: r.ratedAt } : null,
            quotedBy: [],
          };
          byId.set(t0.id, p);
        }
        if (!p.quotedBy.some((q) => q.link === it.link)) p.quotedBy.push({ outlet: it.outlet, title: it.title, link: it.link });
      }
    }
    return [...byId.values()].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
  };
}
