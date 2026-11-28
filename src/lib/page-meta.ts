// Each page's <title>, description, canonical address and share-card text, set after it renders: the browser
// tab, a link shared from the page and search engines that run the page's scripts all see the page itself.
// The prerendered copies of the pages (scripts/prerender.mjs) carry the same tags before any script runs.
import { currentPath, prettyHref, routeKeyOf } from "./url";

// The page this tab opened on was served prerendered: its tags were written for search results and share cards,
// so they stay as they are for that page; pages reached by following links get tags from what they show.
const served = document.querySelector<HTMLElement>("#app > .prerendered")?.dataset.path;
const PRERENDERED_PATH = served && routeKeyOf(served) === currentPath() ? currentPath() : null;
const metaOf = (sel: string) => document.head.querySelector<HTMLMetaElement>(sel)?.content ?? "";
const LANDING = { title: document.title, desc: metaOf('meta[name="description"]'), ogTitle: metaOf('meta[property="og:title"]'), ogDesc: metaOf('meta[property="og:description"]') };

const SITE = "Third Estate";
const HOME_TITLE = "Third Estate — Élections et vie publique en France";

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.append(el); }
  el.content = value;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

export function applyPageMeta(app: HTMLElement, path: string) {
  if (path === PRERENDERED_PATH) {
    document.title = LANDING.title;
    setMeta("name", "description", LANDING.desc);
    setMeta("property", "og:title", LANDING.ogTitle);
    setMeta("property", "og:description", LANDING.ogDesc);
    setCanonical(location.origin + prettyHref(path));
    return;
  }
  const page = app.querySelector<HTMLElement>(":scope > .page") ?? app;
  const h1 = clean(page.querySelector("h1")?.textContent);
  const title = path === "#/" || !h1 ? HOME_TITLE : `${clip(h1, 70)} — ${SITE}`;
  // the page's own summary: the paragraph under its headline, else its first substantial paragraph
  const lead = [...page.querySelectorAll<HTMLElement>(".page-head p, .sec-hero p, .dek, .lede, p")]
    .map((p) => clean(p.textContent))
    .find((t) => t.length >= 60);
  const desc = lead ? clip(lead, 160) : "";
  // a simulator or quiz address carries the reader's own answers: the page itself is the plain tool
  const url = location.origin + prettyHref(path.replace(/^#\/(simulateur|quiz)\/(?!citations$).+$/, "#/$1"));

  document.title = title;
  if (desc) { setMeta("name", "description", desc); setMeta("property", "og:description", desc); }
  setMeta("property", "og:title", title);
  setMeta("property", "og:url", url);
  setCanonical(url);
}
function setCanonical(url: string) {
  setMeta("property", "og:url", url);
  let canon = document.head.querySelector<HTMLLinkElement>("link[rel=canonical]");
  if (!canon) { canon = document.createElement("link"); canon.rel = "canonical"; document.head.append(canon); }
  canon.href = url;
}
