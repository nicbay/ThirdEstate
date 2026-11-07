// Shared helpers for the Red/Blue feed pipeline (sync-news, sync-mp-posts, rate-reactions, build-feed).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = new URL("../../", import.meta.url);
export const path = (rel) => fileURLToPath(new URL(rel, ROOT));

// Internal state (committed, not served): data/feed/*. Public output: public/data/feed/*.
export const STATE = {
  news: path("data/feed/news.json"),
  posts: path("data/feed/posts.json"),
  accounts: path("data/feed/accounts.json"),
  ratings: path("data/feed/ratings.json"),
};
export const PUBLIC_DIR = path("public/data/feed/");
export const DEPUTES = path("public/data/an/deputes.json");
export const SOCIALS = path("public/data/an/socials.json"); // produced by the mp-socials workstream (optional)

export const UA = "Mozilla/5.0 (compatible; ThirdEstate/0.1; +https://github.com/nicbay/projectview)";
export const HOUR = 3600e3;
export const WINDOW_H = 72; // stories and reactions shown in latest.json
export const KEEP_DAYS = 8; // how long raw news items / posts stay in the state files

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
export async function writeJson(file, data, pretty = false) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, (pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + "\n");
}

export const hash = (s, n = 12) => createHash("sha1").update(s).digest("hex").slice(0, n);

export async function fetchText(url, { timeout = 20000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: "application/json", ...(opts?.headers ?? {}) } }));
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// ---------- text ----------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "—", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", icirc: "î", ucirc: "û", euro: "€" };
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}
export function cleanText(s) {
  if (!s) return "";
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s); // entity-encoded HTML inside descriptions
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}
export const snippet = (s, n = 280) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

// French stopwords + news boilerplate. Tokens are lowercased and accent-stripped before lookup.
const STOP = new Set(
  `a ai aie aient aies ait alors as au aucun aucune aupres auquel aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront aussi autre autres aux auxquelles auxquels avaient avais avait avant avec avez aviez avions avoir avons ayant ayez ayons bon c ca car ce ceci cela celle celles celui cependant certains ces cet cette ceux chacun chaque chez ci comme comment contre d dans de des deja depuis dès deux devant devrait doit donc dont du duquel durant e elle elles en encore entre es est et etaient etais etait etant ete etre eu eue eues eurent eus eut eux faire fait faut fois font hors ici il ils j je jusqu jusque l la laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me meme memes mes moi moins mon n ne ni non nos notre nous on ont ou par parce pas pendant peu peut peuvent plus plusieurs pour pourquoi pourra pourrait puis qu quand que quel quelle quelles quels qui quoi s sa sans se selon ses si sien soi soit sommes son sont sous suis sur t ta tandis te tes toi ton tous tout toute toutes tres tu un une unes uns v va vers voici voila vont vos votre vous y ans an annee annees apres hier aujourd aujourdhui demain jour jours semaine mois heure heures ainsi alors bien fin sera serait etait faire fait dit dire selon veut veulent doit devrait cest quil quils quelle nest sest dun dune lors entre face contre fois tout tres trop plus moins sans also the of and to in on for with is are this that rt via direct video photos photo info infos exclusif exclusive actu actualite article lire aussi abonnes abonne newsletter live suivez interview entretien tribune analyse decryptage edito chronique podcast replay revoir lemonde figaro liberation libe humanite echos franceinfo lcp parisien mediapart jdd`.split(/\s+/),
);
export const deaccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Lowercased, accent-stripped content tokens with light stemming (plural s/x). */
export function tokens(text) {
  const out = [];
  for (let w of deaccent(text.toLowerCase()).replace(/[’']/g, " ").split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) && w.length !== 4) continue; // keep years like 2027
    if (w.length > 4 && /[sx]$/.test(w)) w = w.slice(0, -1);
    if (STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}
/** Capitalised words / acronyms in the original text (names, parties, places): weighted higher. */
export function properNouns(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:^|[^\p{L}])(\p{Lu}[\p{L}\-]{2,})/gu)) {
    const t = tokens(m[1]);
    for (const x of t) out.add(x);
  }
  return out;
}

/** Sparse TF vector (Map token -> weight) for an item, title counted double, proper nouns boosted. */
export function termVector(title, body = "") {
  const v = new Map();
  const add = (t, w) => v.set(t, (v.get(t) ?? 0) + w);
  for (const t of tokens(title)) add(t, 2);
  for (const t of tokens(body)) add(t, 1);
  const pn = properNouns(`${title} ${body}`);
  for (const t of pn) if (v.has(t)) v.set(t, v.get(t) * 1.5);
  return v;
}
export function idfFrom(vectors) {
  const df = new Map();
  for (const v of vectors) for (const t of v.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = vectors.length;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 0.5)));
  return idf;
}
export function weigh(v, idf, unknownIdf) {
  const out = new Map();
  let norm = 0;
  for (const [t, w] of v) {
    const i = idf.get(t) ?? unknownIdf;
    if (!i) continue;
    const x = w * i;
    out.set(t, x);
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, x] of out) out.set(t, x / norm);
  return out;
}
export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [t, x] of a) {
    const y = b.get(t);
    if (y) s += x * y;
  }
  return s;
}
