// Polite HTTP helpers with an on-disk cache (used by sync-communes.mjs).
//   - one User-Agent for every request
//   - retries on 429 / 5xx with back-off (honours Retry-After)
//   - cached(name, url) downloads once into the cache directory and reuses the file for `maxAgeH` hours
//   - throttle(ms) returns a function that spaces successive calls by at least `ms`

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

export const UA = "ProjectView/0.1 (github.com/nicbay/projectview)";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRetry(url, opts = {}, tries = 8) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers ?? {}) } });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) || (res.status === 429 ? 30 * i : 0);
        if (wait) await sleep(Math.min(wait, 180) * 1000);
        throw new Error(`HTTP ${res.status} ${url}`);
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      return res;
    } catch (e) {
      if (e.fatal || i >= tries) throw e;
      await sleep(4000 * i);
    }
  }
}

export function makeCache(dirUrl, { refresh = false } = {}) {
  let made = false;
  const ensure = async () => {
    if (!made) await mkdir(dirUrl, { recursive: true });
    made = true;
  };
  const file = (name) => new URL(name, dirUrl);
  async function fresh(name, maxAgeH) {
    if (refresh) return false;
    try {
      const s = await stat(file(name));
      return maxAgeH == null || Date.now() - s.mtimeMs < maxAgeH * 3600e3;
    } catch {
      return false;
    }
  }
  // Download `url` to the cache (unless a fresh copy exists) and return its file URL.
  async function cached(name, url, { maxAgeH = 24 * 7, opts } = {}) {
    await ensure();
    if (await fresh(name, maxAgeH)) return file(name);
    console.log(`  ↓ ${url}`);
    const res = await fetchRetry(url, opts);
    await writeFile(file(name), Buffer.from(await res.arrayBuffer()));
    return file(name);
  }
  const cachedBuf = async (name, url, o) => readFile(await cached(name, url, o));
  const cachedText = async (name, url, o) => (await cachedBuf(name, url, o)).toString("utf8");
  const cachedJson = async (name, url, o) => JSON.parse(await cachedText(name, url, o));
  // JSON value memoised in the cache (for API calls made in many small requests)
  async function memo(name, fn, { maxAgeH = 24 * 30 } = {}) {
    await ensure();
    if (await fresh(name, maxAgeH)) return JSON.parse(await readFile(file(name), "utf8"));
    const v = await fn();
    await writeFile(file(name), JSON.stringify(v));
    return v;
  }
  return { cached, cachedBuf, cachedText, cachedJson, memo, file, fresh };
}

export function throttle(ms) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + ms;
    if (wait) await sleep(wait);
  };
}
