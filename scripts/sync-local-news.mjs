// Local news per commune: regional / local press RSS feeds (list in scripts/data/local-news-feeds.json),
// matched to communes by name, restricted to the departments each feed covers. Writes
//   public/data/news/<department>.json = { generatedAt, department, feeds, communes: { <INSEE>: [item…] } }
//   public/data/news/index.json        = per-department counts + feed health
// Items keep only title, link, time, outlet and a short summary (no article bodies). See docs/data-local-news.md.
//
//   node scripts/sync-local-news.mjs              fetch feeds (conditional GET), match, write
//   node scripts/sync-local-news.mjs --offline    no network: re-match what is in .cache/local-news/
//   node scripts/sync-local-news.mjs --explain 84007   also print why each item of that commune matched
//
// Idempotent: feed bodies + validators are cached in .cache/local-news/feeds/, all items of the last 14 days
// in .cache/local-news/items.json (previous outputs are also read back, so a cold cache keeps history).
// A file is rewritten only when its content (other than generatedAt) changes.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cleanText, snippet, pool, deaccent } from "./lib/feed-common.mjs";
import { parseFeed, canonical, guessTime, fetchFeed } from "./lib/rss.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/news/", ROOT);
const CACHE = new URL(".cache/local-news/", ROOT);
const FEEDS_FILE = new URL("scripts/data/local-news-feeds.json", ROOT);
const COMMUNES_FILE = new URL("public/data/communes/index.json", ROOT);

const WINDOW_DAYS = 14;
const PER_COMMUNE = 15;
const SUMMARY_CHARS = 200;
const MAX_MATCHES = 8; // an item naming more communes than this is a listing: keep only the ones named in its title

const argv = process.argv.slice(2);
const OFFLINE = argv.includes("--offline");
const EXPLAIN = argv.includes("--explain") ? new Set(argv[argv.indexOf("--explain") + 1].split(",")) : null;
const now = Date.now();

// ---------- reference lists ----------
const DEPTS = Object.fromEntries(
  "01:Ain|02:Aisne|03:Allier|04:Alpes-de-Haute-Provence|05:Hautes-Alpes|06:Alpes-Maritimes|07:Ardèche|08:Ardennes|09:Ariège|10:Aube|11:Aude|12:Aveyron|13:Bouches-du-Rhône|14:Calvados|15:Cantal|16:Charente|17:Charente-Maritime|18:Cher|19:Corrèze|21:Côte-d'Or|22:Côtes-d'Armor|23:Creuse|24:Dordogne|25:Doubs|26:Drôme|27:Eure|28:Eure-et-Loir|29:Finistère|2A:Corse-du-Sud|2B:Haute-Corse|30:Gard|31:Haute-Garonne|32:Gers|33:Gironde|34:Hérault|35:Ille-et-Vilaine|36:Indre|37:Indre-et-Loire|38:Isère|39:Jura|40:Landes|41:Loir-et-Cher|42:Loire|43:Haute-Loire|44:Loire-Atlantique|45:Loiret|46:Lot|47:Lot-et-Garonne|48:Lozère|49:Maine-et-Loire|50:Manche|51:Marne|52:Haute-Marne|53:Mayenne|54:Meurthe-et-Moselle|55:Meuse|56:Morbihan|57:Moselle|58:Nièvre|59:Nord|60:Oise|61:Orne|62:Pas-de-Calais|63:Puy-de-Dôme|64:Pyrénées-Atlantiques|65:Hautes-Pyrénées|66:Pyrénées-Orientales|67:Bas-Rhin|68:Haut-Rhin|69:Rhône|70:Haute-Saône|71:Saône-et-Loire|72:Sarthe|73:Savoie|74:Haute-Savoie|75:Paris|76:Seine-Maritime|77:Seine-et-Marne|78:Yvelines|79:Deux-Sèvres|80:Somme|81:Tarn|82:Tarn-et-Garonne|83:Var|84:Vaucluse|85:Vendée|86:Vienne|87:Haute-Vienne|88:Vosges|89:Yonne|90:Territoire de Belfort|91:Essonne|92:Hauts-de-Seine|93:Seine-Saint-Denis|94:Val-de-Marne|95:Val-d'Oise|971:Guadeloupe|972:Martinique|973:Guyane|974:La Réunion|976:Mayotte"
    .split("|")
    .map((s) => s.split(":")),
);
const REGIONS = "Île-de-France|Centre-Val de Loire|Bourgogne|Franche-Comté|Normandie|Hauts-de-France|Grand Est|Pays de la Loire|Bretagne|Nouvelle-Aquitaine|Occitanie|Auvergne|Rhône-Alpes|Provence|Côte d'Azur|Corse|Alsace|Lorraine|Champagne|Picardie|Aquitaine|Limousin|Poitou|Gascogne|Berry|Savoie|Languedoc|Roussillon|Bourbonnais|Quercy|Périgord|Béarn|Bigorre|Touraine|Anjou|Maine|Vexin|Beauce|Brie|Sologne|Camargue|Cévennes|Morvan|Vercors|Chablais|Bugey|Dombes|Bresse|Médoc|Cotentin|Bocage";
// Never matched by name: a commune called like a department, a region / historic province or "pays" (above),
// a river, a foreign place, a planet, or a seat of government / ministry used as a metonym in national news.
const NEVER = new Set(
  [
    ...Object.values(DEPTS).filter((n) => n !== "Paris"),
    ...REGIONS.split("|"),
    ...["Seine", "Garonne", "Durance", "Adour", "Vilaine", "Sèvre", "Dronne", "Isle", "Ill", "Orb", "Hérault"],
    ...["Vienne", "Venise", "Florence", "Rome", "Sion", "Berlin", "Londres", "Moscou", "Genève", "Bruxelles", "Québec", "Alger", "Tunis", "Dakar", "Washington", "Mexico", "Montréal", "Jérusalem", "Bethléem", "Athènes", "Troie", "Carthage", "Babylone", "Jéricho", "Nazareth", "Gaza", "Kiev", "Lisbonne", "Madrid", "Barcelone", "Milan", "Naples", "Turin", "Gênes", "Monaco"],
    ...["Mars", "Vénus", "Lune", "Soleil", "Jupiter", "Mercure", "Saturne"],
    ...["Matignon", "Beauvau", "Brienne", "Solférino", "Varenne", "Élysée", "Bercy", "Grenelle", "Chirac", "Castex", "Borne", "Faure", "Lagarde", "Bayrou", "Mitterrand"],
    ...["France", "Europe", "Afrique", "Amérique", "Asie", "Océanie", "Antilles", "Outre-mer"],
  ].map((s) => key(s)),
);
// Brand / company homonyms: skip the commune when the item reads like news about the company.
const BRAND_CONTEXT = {
  orange: /\b(op[ée]rateur|t[ée]l[ée]com|fibre|box|forfait|r[ée]seau mobile|sfr|bouygues|free|5g|4g|abonn[ée]s|antenne relais|panne g[ée]n[ée]rale)\b/i,
  vittel: /\b(eau min[ée]rale|nestl[ée]|bouteilles?)\b/i,
  volvic: /\b(eau min[ée]rale|danone|bouteilles?)\b/i,
  cognac: /\b(bouteilles?|spiritueux|hennessy|r[ée]my martin|martell|courvoisier|exportations?|droits de douane)\b/i,
};
const FUNCTION_WORDS = new Set("a au aux de du des d en sur sous dans vers pres pour depuis entre et ou le la les l par avec apres avant contre via jusqu chez a cote".split(" "));
const LOCATIVE = new Set("a au aux en sur depuis jusqu".split(" "));
const LOCATIVE_NOUN = new Set("commune ville village bourg maire mairie habitants habitant canton agglomeration metropole secteur region hauteur chateau".split(" "));
// "près de X", "au sud de X", "en direction de X", "CHU de X", "tribunal de X": the item is about somewhere else
const NOT_IN = new Set("pres proche proximite loin sud nord est ouest portes direction environs chu hopital tribunal cour parquet".split(" "));
const ARTICLES = new Set("le la les l au aux du des".split(" "));
const STREET = new Set("rue avenue av boulevard bd place route chemin quai allee impasse porte cours voie square esplanade faubourg".split(" "));
const INSTITUTION = new Set("eglise chapelle cathedrale basilique abbaye prieure monastere couvent paroisse college lycee ecole universite hopital clinique institut ehpad fete foire residence cite quartier stade gymnase parc jardin halle salle centre espace hotel domaine chateau clos cave pont gare station".split(" "));
const ARTICLE_FORMS = { le: ["le", "au", "du"], les: ["les", "aux", "des"], la: ["la"], l: ["l"] };
const HYPHEN = /^[-‑‐]$/;

function norm(s) {
  return deaccent(s.normalize("NFKC").toLowerCase()).replace(/œ/g, "oe").replace(/æ/g, "ae");
}
function key(s) {
  return tokenize(s).map((t) => t.n).join(" ");
}
/** Word tokens with their raw form, normalised form and the separator before them. "St"/"Ste" → saint/sainte. */
function tokenize(text) {
  const out = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m, last = 0;
  while ((m = re.exec(text))) {
    let n = norm(m[0]);
    if (n === "st") n = "saint";
    else if (n === "ste") n = "sainte";
    out.push({ raw: m[0], n, sep: text.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  return out;
}
const isUpper = (raw) => /^\p{Lu}/u.test(raw);

// ---------- communes ----------
async function loadCommunes() {
  try {
    const j = JSON.parse(await readFile(COMMUNES_FILE, "utf8"));
    const c = Object.fromEntries(j.columns.map((k, i) => [k, i]));
    return j.rows.map((r) => ({ code: r[c.code], name: r[c.name], dep: r[c.department], pop: +r[c.population] || 0, postcodes: String(r[c.postcodes] ?? "").split(" ").filter(Boolean), parent: r[c.parent] || "" }));
  } catch {
    console.log("communes: public/data/communes/index.json missing, using geo.api.gouv.fr");
    const file = new URL("communes-geoapi.json", CACHE);
    let rows;
    try {
      rows = JSON.parse(await readFile(file, "utf8"));
    } catch {
      const res = await fetch("https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,population,codesPostaux");
      if (!res.ok) throw new Error(`geo.api.gouv.fr HTTP ${res.status}`);
      rows = await res.json();
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, JSON.stringify(rows));
    }
    return rows.map((r) => ({ code: r.code, name: r.nom, dep: r.codeDepartement, pop: r.population || 0, postcodes: r.codesPostaux ?? [], parent: "" }));
  }
}

// ---------- matcher ----------
const PLM = { "75": { city: "paris", parent: "75056", max: 20, code: (n) => `751${String(n).padStart(2, "0")}` }, "69": { city: "lyon", parent: "69123", max: 9, code: (n) => `6938${n}` }, "13": { city: "marseille", parent: "13055", max: 16, code: (n) => `132${String(n).padStart(2, "0")}` } };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
const ORD = /^(\d{1,2}|[ivx]{1,5})(e|er|re|eme|ieme)$/;

function buildMatcher(communes, corpusLower) {
  const byKey = new Map(); // normalised name -> communes (national, for homonyms)
  const byDep = new Map(); // dep -> Map(first core token -> patterns)
  const byCode = new Map(communes.map((c) => [c.code, c]));
  const excluded = [];
  for (const c of communes) {
    if (c.parent) continue; // arrondissements: matched by the PLM rules
    const toks = tokenize(c.name).map((t) => t.n);
    const k = toks.join(" ");
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
    if (NEVER.has(k)) {
      excluded.push(c.name);
      continue;
    }
    let art = null, core = toks;
    if (ARTICLE_FORMS[toks[0]] && toks.length > 1) [art, core] = [toks[0], toks.slice(1)];
    const single = !art && core.length === 1;
    if (single && core[0].length === 1) {
      excluded.push(c.name);
      continue;
    }
    const p = { c, k, art, core, single };
    if (!byDep.has(c.dep)) byDep.set(c.dep, new Map());
    const m = byDep.get(c.dep);
    if (!m.has(core[0])) m.set(core[0], []);
    m.get(core[0]).push(p);
  }
  // longest compound names starting with a shorter name, per department ("Villeneuve" -> "Villeneuve-sur-Lot")
  const prefixMax = new Map(); // "prefix|dep" -> largest population of a commune whose name extends that prefix
  for (const [k, list] of byKey) {
    const t = k.split(" ");
    for (let n = 1; n < t.length; n++) {
      const pre = t.slice(0, n).join(" ");
      for (const c of list) prefixMax.set(`${pre}|${c.dep}`, Math.max(prefixMax.get(`${pre}|${c.dep}`) ?? 0, c.pop));
    }
  }
  const depNames = Object.fromEntries(Object.entries(DEPTS).map(([d, n]) => [d, key(n)]));

  /** Is `c` explicitly located by the text: its department named, "(84)", or one of its postcodes? */
  function located(c, ntext) {
    const words = ` ${tokenize(ntext).map((t) => t.n).join(" ")} `;
    if (words.includes(` ${depNames[c.dep]} `)) return true;
    if (ntext.includes(`(${c.dep.toLowerCase()})`)) return true;
    return c.postcodes.some((p) => words.includes(` ${p} `));
  }

  /** Is `c` located right after the mention: "Lent (Ain)", "Sarry, dans l'Yonne", "Biron, en Dordogne", "(01)", "01500"? */
  function locatedNear(c, toks, end) {
    const dn = depNames[c.dep].split(" ");
    for (let j = end + 1; j <= end + 5 && j < toks.length; j++) {
      if (/[.!?;«»"“”]/.test(toks[j].sep)) return false;
      if (toks[j].n === c.dep.toLowerCase() && toks[j].sep.trim().endsWith("(")) return true;
      if (c.postcodes.includes(toks[j].n)) return true;
      if (dn.every((w, k) => toks[j + k]?.n === w)) return true;
    }
    return false;
  }

  /** Match one item. `deps` = departments it may be matched to. Returns Map(code -> reason). */
  function match(item, deps, explain = false) {
    const found = new Map();
    const parts = [
      { text: item.title, title: true },
      { text: item.summary || "", title: false },
    ];
    const ntext = norm(`${item.title} ${item.summary || ""}`);
    const indexes = deps.map((d) => byDep.get(d)).filter(Boolean);
    for (const part of parts) {
      const toks = tokenize(part.text);
      const hits = [];
      for (let i = 0; i < toks.length; i++) {
        for (const idx of indexes) {
          for (const p of idx.get(toks[i].n) ?? []) {
            const h = tryPattern(p, toks, i, part.title);
            if (h) hits.push(h);
          }
        }
      }
      // longest first, no overlaps
      hits.sort((a, b) => b.end - b.start - (a.end - a.start) || b.p.c.pop - a.p.c.pop);
      const used = new Set();
      const kept = [];
      for (const h of hits) {
        let free = true;
        for (let j = h.start; j <= h.end; j++) if (used.has(j)) free = false;
        // same span, several communes (homonyms inside the covered departments): resolved below
        const twin = kept.find((x) => x.start === h.start && x.end === h.end);
        if (twin) {
          twin.alts.push(h);
          continue;
        }
        if (!free) continue;
        for (let j = h.start; j <= h.end; j++) used.add(j);
        kept.push({ ...h, alts: [h] });
      }
      for (const h of kept) {
        let pick = h.alts[0];
        if (h.alts.length > 1) {
          const s = [...h.alts].sort((a, b) => b.p.c.pop - a.p.c.pop);
          const loc = s.filter((a) => located(a.p.c, ntext));
          if (loc.length === 1) pick = loc[0];
          else if (s[0].p.c.pop >= 5000 && s[0].p.c.pop >= 10 * s[1].p.c.pop) pick = s[0];
          else continue; // ambiguous inside the feed's own area
        }
        const c = pick.p.c;
        // a much larger homonym outside this item's area: require the text to locate the commune
        const others = byKey.get(pick.p.k).filter((o) => o !== c && !deps.includes(o.dep));
        const big = Math.max(0, ...others.map((o) => o.pop));
        if (big >= 5000 && big >= 3 * c.pop && !located(c, ntext)) continue;
        if (pick.strict && !pick.context && !pick.near) continue;
        // a short form of a larger compound-named commune of the same area ("Villeneuve" for Villeneuve-Tolosane)
        if (deps.some((d) => (prefixMax.get(`${pick.p.k}|${d}`) ?? 0) > c.pop)) continue;
        const brand = BRAND_CONTEXT[pick.p.k];
        if (brand && brand.test(ntext)) continue;
        if (!found.has(c.code)) found.set(c.code, { title: part.title, why: explain ? pick.why : undefined });
      }
      // Paris / Lyon / Marseille arrondissements
      for (const [code, why] of arrondissements(toks, deps)) if (!found.has(code)) found.set(code, { title: part.title, why });
    }
    if (found.size > MAX_MATCHES) for (const [code, v] of found) if (!v.title) found.delete(code);
    if (found.size > MAX_MATCHES) found.clear(); // a list of towns, not news about any of them
    return found;
  }

  function tryPattern(p, toks, i, inTitle) {
    const { core, art } = p;
    for (let k = 1; k < core.length; k++) {
      const t = toks[i + k];
      if (!t || t.n !== core[k] || !/^[\s\-‑‐'’]{1,2}$/.test(t.sep)) return null;
    }
    const end = i + core.length - 1;
    let start = i;
    if (!isUpper(toks[i].raw)) return null; // "orange", "tours", "sens" as ordinary words
    if (art) {
      const a = toks[i - 1];
      if (!a || !ARTICLE_FORMS[art].includes(a.n) || !/^[\s'’]{1,2}$/.test(toks[i].sep)) return null;
      start = i - 1;
    }
    // part of a longer hyphenated name ("Saint-Denis-de-Pile", "Paris-Saclay", "Nice-Matin")
    if (start > 0 && HYPHEN.test(toks[start].sep)) return null;
    if (toks[end + 1] && HYPHEN.test(toks[end + 1].sep)) return null;
    const prev = toks[start - 1], prev2 = toks[start - 2], next = toks[end + 1];
    // "rue de Carpentras", "porte de Clichy", "avenue d'Avignon": a street elsewhere
    if (prev && (STREET.has(prev.n) || (["de", "d", "du", "des"].includes(prev.n) && prev2 && STREET.has(prev2.n)))) return null;
    // "église Saint-Pierre", "lycée Saint-Exupéry", "Institut Sainte-Catherine", "Château Saint-Georges": a building's name
    if (prev && INSTITUTION.has(prev.n) && /^[\s]{1,2}$/.test(toks[start].sep)) return null;
    if (prev && (["pres", "vers"].includes(prev.n) || (["de", "d", "du"].includes(prev.n) && prev2 && NOT_IN.has(prev2.n)))) return null;
    // a station or channel name: "ICI La Rochelle", "France Bleu Isère", "France 3 Paris"
    if (prev && (prev.raw === "ICI" || prev.n === "bleu" || (prev.n === "3" && prev2?.n === "france"))) return null;
    const why = [];
    // "la Fontaine ardente", "le Paris d'Éric Cantona", "des Rives": not the commune (its name has no article)
    if (!art && prev && ARTICLES.has(prev.n) && /^[\s'’]{1,2}$/.test(toks[start].sep)) return null;
    if (p.single) {
      // a nobiliary / place particle: "Richard de Méritens de Villeneuve", "Relais de Sancy", "Pays de Gex"
      if (prev && ["de", "d"].includes(prev.n) && prev2 && isUpper(prev2.raw) && !FUNCTION_WORDS.has(prev2.n) && !LOCATIVE_NOUN.has(prev2.n)) return null;
      // a first name / surname / organisation: "Pierre Laval", "Marie Curie", "OGC Nice", "Toulouse FC"
      if (prev && toks[start].sep === " " && isUpper(prev.raw) && !FUNCTION_WORDS.has(prev.n)) return null;
      if (next && next.sep === " " && isUpper(next.raw) && !FUNCTION_WORDS.has(next.n)) return null;
    }
    const titlePrefix = inTitle && start === 0 && next && /^\s*[.:,]\s|^\s+[-–—]\s/.test(next.sep);
    const context =
      titlePrefix ||
      (prev && LOCATIVE.has(prev.n)) ||
      (prev && ["de", "d"].includes(prev.n) && prev2 && LOCATIVE_NOUN.has(prev2.n));
    // strict = needs a locating context: small places with one-word names, short names, common words
    const c = p.c;
    const w = p.core[0];
    const common = p.single && (corpusLower.get(w) ?? 0) >= 2;
    const short = p.single && w.length <= 3 && c.pop < 10000;
    const strict = (p.single && (c.pop < 2000 || common || short)) || (!p.single && art && p.core.length === 1 && c.pop < 2000 && (corpusLower.get(w) ?? 0) >= 2);
    if (w.length <= 2 && !(context && prev && LOCATIVE.has(prev.n))) return null; // "Eu", "Ay", "By": only "à Eu"
    why.push(p.single ? "single-word" : "multi-word", strict ? (context ? "strict+context" : "strict") : "plain", common ? "common-word" : "");
    return { p, start, end, strict, context: !!context, near: locatedNear(c, toks, end), why: why.filter(Boolean).join(",") };
  }

  function arrondissements(toks, deps) {
    const out = new Map();
    const cities = Object.keys(PLM).filter((d) => deps.includes(d));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let num = null, city = null, why = "";
      const om = t.n.match(ORD) ?? (toks[i + 1] && /^(e|er|re|eme)$/.test(toks[i + 1].n) && /^\d{1,2}$/.test(t.n) && toks[i + 1].sep === "" ? [t.n, t.n] : null);
      if (om) {
        num = ROMAN[om[1]] ?? +om[1];
        const j = om[0] === t.n ? i + 1 : i + 2;
        const nx = toks[j];
        const prev = toks[i - 1];
        if (nx && /^arr(ondissement)?s?$/.test(nx.n)) {
          // "11e arrondissement (de Paris)"
          const after = toks[j + 1]?.n === "de" ? toks[j + 2]?.n : null;
          city = Object.keys(PLM).find((d) => PLM[d].city === after) ?? (cities.length === 1 ? cities[0] : null);
          why = "Ne arrondissement";
        } else if (prev && Object.values(PLM).some((x) => x.city === prev.n) && isUpper(prev.raw) && t.sep === " ") {
          // "Paris 11e", "Lyon 3e", "Marseille 13e"
          city = Object.keys(PLM).find((d) => PLM[d].city === prev.n);
          why = "City Ne";
        } else continue;
      } else if (/^(75\d{3}|6900\d|130\d\d)$/.test(t.n)) {
        // postcodes 75011 / 69003 / 13008
        const d = t.n.startsWith("75") ? "75" : t.n.startsWith("69") ? "69" : "13";
        num = +t.n.slice(-2);
        if (d === "75" && t.n === "75116") num = 16;
        if (d === "75" && !t.n.startsWith("750")) continue;
        city = d;
        why = "postcode";
      } else continue;
      if (!city || !deps.includes(city) || !num || num > PLM[city].max) continue;
      const code = PLM[city].code(num);
      if (byCode.has(code)) out.set(code, why);
      if (byCode.has(PLM[city].parent)) out.set(PLM[city].parent, "arrondissement");
    }
    return out;
  }

  return { match, excluded, byCode };
}

// ---------- items ----------
const deptFromLink = (link, deps) => {
  // Le Parisien files articles under /<department-slug>-<code>/; Sud Ouest / Nice-Matin under /<department-slug>/
  let path;
  try {
    path = new URL(link).pathname.toLowerCase();
  } catch {
    return null;
  }
  const segs = path.split("/").filter(Boolean);
  for (const [code, name] of Object.entries(DEPTS)) {
    const s = deaccent(name.toLowerCase()).replace(/[’' ]/g, "-");
    if (segs.includes(`${s}-${code.toLowerCase()}`)) return code;
    if (segs[0] === s && deps.includes(code)) return code;
  }
  return null;
};

function coverage(item, feedsById) {
  const sets = item.feeds.map((id) => feedsById.get(id)?.departments).filter(Boolean);
  if (item.deps?.length) sets.push(item.deps); // seeded from a previous output
  if (!sets.length) return [];
  const union = [...new Set(sets.flat())];
  let inter = sets.reduce((a, b) => a.filter((x) => b.includes(x)));
  const fromLink = deptFromLink(item.link, union);
  if (fromLink) return [fromLink];
  return inter.length ? inter : union;
}

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeIfChanged(url, data) {
  const prev = await readJson(url, null);
  const strip = (j) => JSON.stringify({ ...j, generatedAt: undefined });
  if (prev && strip(prev) === strip(data)) return false;
  await writeFile(url, JSON.stringify(data) + "\n");
  return true;
}

async function main() {
  const { feeds } = JSON.parse(await readFile(FEEDS_FILE, "utf8"));
  const feedsById = new Map(feeds.map((f) => [f.id, f]));
  const communes = await loadCommunes();
  await mkdir(OUT, { recursive: true });
  await mkdir(CACHE, { recursive: true });

  // 1. item store: cache + previous outputs (so a cold cache in CI keeps the 14-day history)
  const storeFile = new URL("items.json", CACHE);
  const store = new Map(Object.entries(await readJson(storeFile, {})));
  for (const f of await readdir(OUT).catch(() => [])) {
    if (!/^[\dAB]{2,3}\.json$/.test(f)) continue;
    const j = await readJson(new URL(f, OUT), null);
    const dep = f.replace(".json", "");
    for (const items of Object.values(j?.communes ?? {}))
      for (const it of items) {
        const s = store.get(it.link);
        if (s) {
          if (!s.feeds.length && !(s.deps ?? []).includes(dep)) s.deps = [...(s.deps ?? []), dep];
        } else store.set(it.link, { title: it.title, summary: it.summary, time: it.time, outlet: it.outlet, feeds: [], deps: [dep], seenAt: it.time });
      }
  }

  // 2. fetch
  const health = new Map();
  await pool(feeds, 8, async (f) => {
    let res;
    try {
      res = OFFLINE ? { xml: await readFile(new URL(`feeds/${f.id}.xml`, CACHE), "utf8"), status: "offline" } : await fetchFeed(f.id, f.url, new URL("feeds/", CACHE));
    } catch (e) {
      health.set(f.id, { ok: false, error: e.message });
      return;
    }
    const items = parseFeed(res.xml);
    let added = 0, newest = null;
    for (const it of items) {
      const link = canonical(it.link);
      const t = it.time && Date.parse(it.time) <= now + 10 * 60e3 ? it.time : null;
      const s = store.get(link);
      if (s) {
        if (!s.feeds.includes(f.id)) s.feeds.push(f.id);
        continue;
      }
      const time = t ?? guessTime(link, now);
      if (!newest || time > newest) newest = time;
      const summary = snippet(cleanText(it.summary).replace(it.title, "").trim(), SUMMARY_CHARS);
      store.set(link, { title: it.title, summary, time, outlet: f.outlet, feeds: [f.id], seenAt: new Date(now).toISOString() });
      added++;
    }
    health.set(f.id, { ok: items.length > 0, items: items.length, added, status: res.status, error: res.error });
  });

  // 3. keep the window
  const cutoff = now - WINDOW_DAYS * 24 * 3600e3;
  for (const [link, it] of store) if (!(Date.parse(it.time) >= cutoff)) store.delete(link);
  await writeFile(storeFile, JSON.stringify(Object.fromEntries(store)));

  // 4. corpus statistics: how often each word appears in lower case (common-word detection)
  const corpusLower = new Map();
  for (const it of store.values())
    for (const t of tokenize(`${it.title} ${it.summary}`)) if (t.raw === t.raw.toLowerCase() && /\p{L}/u.test(t.raw)) corpusLower.set(t.n, (corpusLower.get(t.n) ?? 0) + 1);

  // 5. match
  const matcher = buildMatcher(communes, corpusLower);
  const perCommune = new Map();
  const explain = [];
  for (const [link, it] of store) {
    const deps = coverage({ ...it, link }, feedsById);
    if (!deps.length) continue;
    const found = matcher.match(it, deps, !!EXPLAIN);
    for (const [code, v] of found) {
      if (!perCommune.has(code)) perCommune.set(code, []);
      perCommune.get(code).push({ title: it.title, link, time: it.time, outlet: it.outlet, summary: it.summary });
      if (EXPLAIN?.has(code)) explain.push(`${code} ${matcher.byCode.get(code)?.name} ${it.time.slice(0, 16)} [${v.why ?? ""}] (${deps.join(",")}) ${it.outlet}: ${it.title}`);
    }
  }

  // 6. write one file per department
  const generatedAt = new Date(now).toISOString();
  const byDep = new Map(Object.keys(DEPTS).map((d) => [d, {}]));
  const ordered = [...perCommune.keys()].map((code) => matcher.byCode.get(code)).filter(Boolean).sort((a, b) => b.pop - a.pop);
  for (const c of ordered) {
    const items = perCommune.get(c.code).sort((a, b) => b.time.localeCompare(a.time) || a.link.localeCompare(b.link)).slice(0, PER_COMMUNE);
    byDep.get(c.dep)[c.code] = items;
  }
  const index = { generatedAt, windowDays: WINDOW_DAYS, perCommune: PER_COMMUNE, departments: {}, feeds: [] };
  let changed = 0, communesWith = 0, matchedLinks = new Set();
  for (const [dep, map] of byDep) {
    const depFeeds = feeds.filter((f) => f.departments.includes(dep)).map(({ id, outlet, url, scope }) => ({ id, outlet, url, scope }));
    const data = { generatedAt, department: dep, name: DEPTS[dep], windowDays: WINDOW_DAYS, feeds: depFeeds, communes: map };
    if (await writeIfChanged(new URL(`${dep}.json`, OUT), data)) changed++;
    const n = Object.keys(map).length;
    const total = communes.filter((c) => c.dep === dep && !c.parent).length;
    communesWith += n;
    for (const items of Object.values(map)) for (const i of items) matchedLinks.add(i.link);
    index.departments[dep] = { name: DEPTS[dep], feeds: depFeeds.length, communes: total, communesWithNews: n, items: new Set(Object.values(map).flat().map((i) => i.link)).size };
  }
  index.feeds = feeds.map(({ id, outlet, url, departments, scope }) => ({ id, outlet, url, departments, scope, ok: health.get(id)?.ok ?? false }));
  index.totals = { feeds: feeds.length, feedsOk: index.feeds.filter((f) => f.ok).length, itemsInWindow: store.size, itemsMatched: matchedLinks.size, communesWithNews: communesWith };
  if (await writeIfChanged(new URL("index.json", OUT), index)) changed++;

  // 7. report
  const failed = [...health].filter(([, h]) => !h.ok).map(([id, h]) => `${id} (${h.error ?? "no items"})`);
  console.log(`feeds: ${index.totals.feedsOk}/${feeds.length} ok${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  console.log(`items in last ${WINDOW_DAYS} days: ${store.size}, matched to ≥1 commune: ${matchedLinks.size}`);
  console.log(`communes with ≥1 item: ${communesWith} (${Object.entries(index.departments).filter(([, d]) => d.communesWithNews).length} departments)`);
  console.log(`excluded names: ${matcher.excluded.length} communes (department/region/river/foreign/metonym names, one-letter names)`);
  console.log(`files written: ${changed}`);
  if (EXPLAIN) console.log(`\n${explain.sort().join("\n")}`);
}

await main();
