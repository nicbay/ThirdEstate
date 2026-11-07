// RSS / Atom helpers shared by the local-news pipeline (scripts/sync-local-news.mjs).
// parseFeed / canonical / guessTime follow the ones in scripts/sync-news.mjs (same behaviour), plus:
//   - fetchFeed(): conditional GET (ETag / Last-Modified) with an on-disk copy, charset-aware decoding
//   - a per-host throttle so ~200 feeds on a few hosts are fetched politely
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { UA, cleanText } from "./feed-common.mjs";

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]+)"`, "i"))?.[1] ?? "";

/** Minimal RSS 2.0 / Atom parser: title, link, time (ISO or null), summary (plain text), categories. */
export function parseFeed(xml) {
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

/** Drop tracking parameters and fragments so the same article seen in two feeds dedupes. */
export const canonical = (u) => {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|xtor|at_|ens_|fbclid)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u;
  }
};

/** No usable date in the feed (Le Parisien): DD-MM-YYYY in the URL if an earlier day, else `now`. */
export function guessTime(link, now) {
  const m = link.match(/-(\d{2})-(\d{2})-(20\d{2})-/);
  if (m) {
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    if (day < new Date(now).toISOString().slice(0, 10)) return `${day}T12:00:00.000Z`;
  }
  return new Date(now).toISOString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextSlot = new Map(); // host -> earliest time of the next request
async function hostThrottle(url, gapMs) {
  const host = new URL(url).host;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gapMs);
  if (at > now) await sleep(at - now);
}

function decode(buf, contentType) {
  const head = buf.subarray(0, 200).toString("latin1");
  const cs = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/encoding=["']([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/**
 * Fetch a feed with a conditional GET. The last body and its validators live in `cacheDir/<id>.{xml,json}`.
 * Returns { xml, status: "fetched" | "not-modified" | "cached-after-error", error? }. Throws if nothing usable.
 */
export async function fetchFeed(id, url, cacheDir, { timeout = 20000, gapMs = 400 } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const bodyFile = new URL(`${id}.xml`, cacheDir);
  const metaFile = new URL(`${id}.json`, cacheDir);
  const meta = await readFile(metaFile, "utf8").then(JSON.parse, () => ({}));
  const cachedBody = () => readFile(bodyFile, "utf8").catch(() => null);
  const headers = { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5" };
  if (meta.url === url && meta.etag) headers["if-none-match"] = meta.etag;
  if (meta.url === url && meta.lastModified) headers["if-modified-since"] = meta.lastModified;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await hostThrottle(url, gapMs);
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (res.status === 304) {
        const xml = await cachedBody();
        if (xml != null) return { xml, status: "not-modified" };
        delete headers["if-none-match"];
        delete headers["if-modified-since"];
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: res.status === 429 || res.status >= 500 });
      const xml = decode(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") ?? "");
      if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) throw new Error("not an RSS/Atom document");
      await writeFile(bodyFile, xml);
      await writeFile(metaFile, JSON.stringify({ url, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), fetchedAt: new Date().toISOString() }));
      return { xml, status: "fetched" };
    } catch (e) {
      lastErr = e;
      if (!(e.retry || e.name === "TimeoutError" || e.name === "TypeError") || attempt === 2) break;
      await sleep(3000);
    }
  }
  const xml = meta.url === url ? await cachedBody() : null;
  if (xml != null && meta.fetchedAt && Date.now() - Date.parse(meta.fetchedAt) < 24 * 3600e3) return { xml, status: "cached-after-error", error: lastErr.message };
  throw lastErr;
}
