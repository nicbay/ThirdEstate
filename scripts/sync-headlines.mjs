// The day's main world story and main French story, for the note of the day (the "World" and "France" lines).
// Reads the front-page RSS feeds of a few general outlets and keeps, in each list, the stories the most outlets
// carry at once: a story counts for an outlet when one of its recent titles shares at least two significant
// words with it. Only the title, link, outlet and time are stored (no article text).
//
//   node scripts/sync-headlines.mjs        (npm run sync:daily runs it before build-editions)
//
// Output: public/data/daily/headlines/<date>.json { date, fetchedAt, world: Story[], france: Story[] }
// with Story = { title, link, outlet, time, n } and n = how many outlets carry it. A feed that fails is skipped;
// with no feed at all nothing is written and the edition falls back to the political press feed.
import { mkdir, writeFile } from "node:fs/promises";
import { fetchText, cleanText, deaccent, pool, path } from "./lib/feed-common.mjs";

const WORLD = [
  { outlet: "Le Monde", url: "https://www.lemonde.fr/international/rss_full.xml" },
  { outlet: "franceinfo", url: "https://www.francetvinfo.fr/monde.rss" },
  { outlet: "France 24", url: "https://www.france24.com/fr/rss" },
  { outlet: "Le Figaro", url: "https://www.lefigaro.fr/rss/figaro_international.xml" },
  { outlet: "RFI", url: "https://www.rfi.fr/fr/rss" },
];
const FRANCE = [
  { outlet: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml" },
  { outlet: "franceinfo", url: "https://www.francetvinfo.fr/titres.rss" },
  { outlet: "Le Figaro", url: "https://www.lefigaro.fr/rss/figaro_actualites.xml" },
  { outlet: "20 Minutes", url: "https://www.20minutes.fr/feeds/rss-une.xml" },
  { outlet: "Libération", url: "https://www.liberation.fr/arc/outboundfeeds/rss-all/?outputType=xml" },
];

const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const title = cleanText(tag(b, "title"));
    let link = cleanText(tag(b, "link")) || (b.match(/<link\s[^>]*href="([^"]+)"/i)?.[1] ?? "");
    if (!/^https?:/.test(link)) link = cleanText(tag(b, "guid"));
    const t = Date.parse(cleanText(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated")));
    return { title, link, time: Number.isFinite(t) ? new Date(t).toISOString() : null };
  }).filter((i) => i.title && /^https?:/.test(i.link));
}

// words that say nothing about which story it is
const STOP = new Set("apres avant selon contre entre depuis pendant direct video videos france francais francaise francaises paris leurs notre votre cette comme encore aussi alors toujours jamais pourquoi comment quand faire avoir etre annonce annoncent president presidente ministre gouvernement guerre monde nouveau nouvelle nouvelles premier premiere personnes moins plusieurs millions milliards".split(" "));
const words = (title) => new Set(deaccent(title.toLowerCase()).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)));
const shared = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

async function ranked(feeds, now) {
  const lists = [];
  await pool(feeds, 5, async (f) => {
    try {
      const items = parseFeed(await fetchText(f.url)).filter((i) => !i.time || now - Date.parse(i.time) < 26 * 3600e3).slice(0, 20)
        .map((i, rank) => ({ ...i, outlet: f.outlet, rank, w: words(i.title) }));
      if (items.length) lists.push(items);
    } catch (e) { console.log(`headlines: ${f.outlet} FAILED ${e.message}`); }
  });
  const all = lists.flat().filter((i) => !/^(en direct|direct|vid[ée]o|podcast|infographie)\b/i.test(i.title));
  for (const it of all) it.n = 1 + lists.filter((l) => l[0].outlet !== it.outlet && l.some((o) => shared(it.w, o.w) >= 2)).length;
  all.sort((a, b) => b.n - a.n || a.rank - b.rank);
  // one line per story: drop an item that tells a story already kept
  const kept = [];
  for (const it of all) if (!kept.some((k) => shared(k.w, it.w) >= 2)) kept.push(it);
  return { feeds: lists.length, items: kept };
}

const now = Date.now();
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
const [w, f] = await Promise.all([ranked(WORLD, now), ranked(FRANCE, now)]);
if (!w.feeds && !f.feeds) { console.log("headlines: no feed answered, nothing written"); process.exit(0); }
const out = ({ title, link, outlet, time, n }) => ({ title, link, outlet, time, n });
// the French list leaves out what the world list already tells
const france = f.items.filter((i) => !w.items.slice(0, 3).some((k) => shared(k.w, i.w) >= 2));
await mkdir(path("public/data/daily/headlines/"), { recursive: true });
await writeFile(path(`public/data/daily/headlines/${date}.json`), JSON.stringify({ date, fetchedAt: new Date(now).toISOString(), world: w.items.slice(0, 5).map(out), france: france.slice(0, 5).map(out) }));
console.log(`headlines ${date}: world "${w.items[0]?.title ?? "-"}" (${w.items[0]?.n ?? 0}/${w.feeds}) · france "${france[0]?.title ?? "-"}" (${france[0]?.n ?? 0}/${f.feeds})`);
