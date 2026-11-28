// Addresses. The site's pages have real paths (/depute/PA123, /ville/75056) so search engines can index each one.
// Inside the code a page is still named by its route key, "#/depute/PA123": links are written that way and
// rewritten to paths in the page (see prettifyLinks), and `location.hash = "#/x"` still navigates (main.ts turns
// it into /x). Old shared links of the form /#/x land on /x.

/** "#/x/y#a" → "/x/y#a"; anything else is returned as is. */
export function prettyHref(href: string): string {
  if (!href.startsWith("#/")) return href;
  const rest = href.slice(1); // "/x/y#a"
  const i = rest.indexOf("#");
  const path = i < 0 ? rest : rest.slice(0, i);
  const anchor = i < 0 ? "" : rest.slice(i);
  return (path.length > 1 ? path.replace(/\/+$/, "") : "/") + anchor;
}

/** "/x/y" (a same-site path) → "#/x/y", the route key; null for files and other sites. */
export function routeKeyOf(pathname: string): string {
  let p = pathname.replace(/\/index\.html$/, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  try { p = decodeURI(p); } catch { /* keep it raw */ }
  return "#" + (p || "/");
}

/** The current page's route key and in-page anchor, e.g. { path: "#/race", anchor: "methode" }. */
export function currentRoute(): { path: string; anchor: string } {
  const h = location.hash;
  if (h.startsWith("#/")) { // a legacy or freshly assigned hash route, not yet turned into a path
    const i = h.indexOf("#", 1);
    return i < 0 ? { path: h, anchor: "" } : { path: h.slice(0, i), anchor: h.slice(i + 1) };
  }
  return { path: routeKeyOf(location.pathname), anchor: h.slice(1) };
}

/** The current page's route key, e.g. "#/simulateur/abc". */
export const currentPath = () => currentRoute().path;

/** A full shareable address for a route key. */
export const absoluteUrl = (key: string) => location.origin + prettyHref(key);

/** Rewrite every `href="#/…"` under root to its real path, so crawlers and "open in new tab" see real addresses. */
export function prettifyLinks(root: ParentNode) {
  root.querySelectorAll<HTMLAnchorElement | SVGAElement>("a[href^='#/']").forEach((a) => a.setAttribute("href", prettyHref(a.getAttribute("href")!)));
}

/** Normalise an href read from the page back to a route key, whichever form it is in. */
export function hrefKey(href: string | null): string | null {
  if (!href) return href;
  if (href.startsWith("#/")) return href;
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const i = href.indexOf("#");
  return routeKeyOf(i < 0 ? href : href.slice(0, i)) + (i < 0 ? "" : href.slice(i));
}
