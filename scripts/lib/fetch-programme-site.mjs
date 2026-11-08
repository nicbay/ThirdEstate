// Polite crawler for an online programme "book": fetches the index page, follows every
// sub-page link under the same path, and caches the raw HTML (one file per page).
// Used by scripts/build-programme.mjs --fetch. Skips pages already cached unless force.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; ThirdEstate programme reader; one request every few seconds)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

export const pageFile = (dir, slug) => new URL(`${slug ? slug.replaceAll("/", "__") : "index"}.html`, dir);

/** @returns {Promise<{slug:string,url:string,ok:boolean,status?:number}[]>} */
export async function crawlBook({ base, dir, delayMs = 3000, force = false }) {
  await mkdir(dir, { recursive: true });
  const get = async (url) => {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    return { status: res.status, text: res.ok ? await res.text() : "" };
  };
  const indexPath = pageFile(dir, "");
  let index;
  if (!force && (await exists(indexPath))) index = await readFile(indexPath, "utf8");
  else {
    const r = await get(base);
    if (!r.text) throw new Error(`index ${base}: HTTP ${r.status}`);
    index = r.text;
    await writeFile(indexPath, index);
    await sleep(delayMs);
  }
  const path = new URL(base).pathname.replace(/\/$/, "");
  const re = new RegExp(`href=["'](?:https?://[^/"']+)?${path.replace(/[/.]/g, "\\$&")}/([a-z0-9/-]+?)/?["'#]`, "g");
  const slugs = [...new Set([...index.matchAll(re)].map((m) => m[1]))].sort();
  const log = [];
  for (const slug of slugs) {
    const file = pageFile(dir, slug);
    const url = `${base.replace(/\/$/, "")}/${slug}/`;
    if (!force && (await exists(file))) { log.push({ slug, url, ok: true }); continue; }
    try {
      const r = await get(url);
      if (r.text) await writeFile(file, r.text);
      log.push({ slug, url, ok: !!r.text, status: r.status });
      console.log(`  ${r.status} ${slug}`);
    } catch (e) {
      log.push({ slug, url, ok: false, status: 0 });
      console.log(`  ERR ${slug}: ${e.message}`);
    }
    await sleep(delayMs);
  }
  await writeFile(new URL("crawl-log.json", dir), JSON.stringify({ at: new Date().toISOString(), base, pages: log }, null, 1));
  return log;
}
