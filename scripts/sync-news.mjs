// News for the Red/Blue feed: public RSS feeds of French outlets across the spectrum.
// Stores only title, link, outlet, time and a short snippet (no article bodies) in data/feed/news.json.
//   node scripts/sync-news.mjs
import { STATE, KEEP_DAYS, readJson, writeJson, fetchText, cleanText, snippet, hash, pool } from "./lib/feed-common.mjs";

// `lean` is only a rough editorial label for display/balance checks; it is never used in ratings.
// Le Point, Marianne and CNews block automated RSS readers (HTTP 403) and are left out.
const OUTLETS = [
  { id: "humanite", name: "L'Humanité", lean: "gauche", feeds: ["https://www.humanite.fr/sections/politique/feed"] },
  { id: "mediapart", name: "Mediapart", lean: "gauche", feeds: ["https://www.mediapart.fr/articles/feed"] },
  { id: "liberation", name: "Libération", lean: "centre-gauche", feeds: ["https://www.liberation.fr/arc/outboundfeeds/rss/category/politique/?outputType=xml"] },
  { id: "lemonde", name: "Le Monde", lean: "centre-gauche", feeds: ["https://www.lemonde.fr/politique/rss_full.xml", "https://www.lemonde.fr/rss/une.xml"] },
  { id: "franceinfo", name: "franceinfo", lean: "service public", feeds: ["https://www.francetvinfo.fr/politique.rss", "https://www.francetvinfo.fr/titres.rss"] },
  { id: "publicsenat", name: "Public Sénat", lean: "parlementaire", feeds: ["https://www.publicsenat.fr/feed"] },
  { id: "lcp", name: "LCP", lean: "parlementaire", feeds: ["https://lcp.fr/rss.xml"] },
  { id: "20minutes", name: "20 Minutes", lean: "centre", feeds: ["https://www.20minutes.fr/feeds/rss-politique.xml"] },
  { id: "leparisien", name: "Le Parisien", lean: "centre", feeds: ["https://feeds.leparisien.fr/leparisien/rss/politique"] },
  { id: "lesechos", name: "Les Échos", lean: "centre-droit", feeds: ["https://services.lesechos.fr/rss/les-echos-politique.xml"] },
  { id: "lexpress", name: "L'Express", lean: "centre-droit", feeds: ["https://www.lexpress.fr/arc/outboundfeeds/rss/politique.xml"] },
  { id: "lopinion", name: "L'Opinion", lean: "droite libérale", feeds: ["https://www.lopinion.fr/politique.rss"] },
  { id: "lefigaro", name: "Le Figaro", lean: "droite", feeds: ["https://www.lefigaro.fr/rss/figaro_politique.xml", "https://www.lefigaro.fr/rss/figaro_actualites.xml"] },
  { id: "jdd", name: "Le JDD", lean: "droite", feeds: ["https://www.lejdd.fr/rss.xml"] },
  { id: "valeursactuelles", name: "Valeurs actuelles", lean: "droite", feeds: ["https://www.valeursactuelles.com/feed"] },
];

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]+)"`, "i"))?.[1] ?? "";

/** Minimal RSS 2.0 / Atom parser: enough for news feeds. */
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = cleanText(tag(b, "title"));
    let link = cleanText(tag(b, "link")) || attr(b, "link", "href");
    if (!/^https?:/.test(link)) link = cleanText(tag(b, "guid"));
    const date = cleanText(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated"));
    const desc = cleanText(tag(b, "description") || tag(b, "summary") || tag(b, "content"));
    const cats = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => cleanText(m[1])).filter(Boolean);
    if (!title || !/^https?:/.test(link)) continue;
    const t = Date.parse(date);
    items.push({ title, link, time: Number.isFinite(t) ? new Date(t).toISOString() : null, summary: desc, categories: cats });
  }
  return items;
}

const canonical = (u) => {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|xtor|at_|ens_|fbclid)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u;
  }
};

// No date in the feed (Le Parisien): use the DD-MM-YYYY in the URL if it is an earlier day,
// else the first time we saw it (we run every 1-2 h, so that is close).
function guessTime(link, now) {
  const m = link.match(/-(\d{2})-(\d{2})-(20\d{2})-/);
  if (m) {
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    if (day < new Date(now).toISOString().slice(0, 10)) return `${day}T12:00:00.000Z`;
  }
  return new Date(now).toISOString();
}

async function main() {
  const now = Date.now();
  const prev = await readJson(STATE.news, { items: [] });
  const byLink = new Map(prev.items.map((i) => [i.link, i]));
  const report = [];
  const jobs = OUTLETS.flatMap((o) => o.feeds.map((f) => ({ o, f })));
  await pool(jobs, 6, async ({ o, f }) => {
    try {
      const items = parseFeed(await fetchText(f));
      let added = 0;
      for (const it of items) {
        const link = canonical(it.link);
        if (byLink.has(link)) continue;
        const time = it.time && Date.parse(it.time) <= now + 10 * 60e3 ? it.time : guessTime(link, now);
        byLink.set(link, {
          id: hash(link),
          outlet: o.id,
          title: it.title,
          link,
          time,
          summary: snippet(it.summary.replace(it.title, "").trim(), 280),
          categories: it.categories.slice(0, 5),
          seenAt: new Date(now).toISOString(),
        });
        added++;
      }
      report.push(`${o.id}: ${items.length} in feed, ${added} new`);
    } catch (e) {
      report.push(`${o.id}: FAILED ${e.message}`);
    }
  });
  const cutoff = now - KEEP_DAYS * 24 * 3600e3;
  const items = [...byLink.values()].filter((i) => Date.parse(i.time) >= cutoff).sort((a, b) => b.time.localeCompare(a.time));
  await writeJson(STATE.news, { fetchedAt: new Date(now).toISOString(), outlets: OUTLETS.map(({ feeds, ...o }) => o), items });
  console.log(report.sort().join("\n"));
  console.log(`news: ${items.length} items kept (last ${KEEP_DAYS} days)`);
}

await main();
