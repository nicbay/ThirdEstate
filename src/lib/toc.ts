// Long reads (how the election works, how to vote, sources and method, legal notice): an "On this page" contents
// list built from the page's section headings. From 1100px it is a sticky rail beside a narrower reading column,
// with the section in view marked (aria-current); below that it folds into a collapsed list under the header.
// Pages that already carry their own jump links (programmes, candidates, towns) are left alone.
import { L } from "../i18n";
import { esc } from "../util";

const LONG = /^#\/(2027\/(comment-ca-marche|voter)|sources|mentions-legales)$/;
const slug = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
let spy: IntersectionObserver | null = null;

export function longRead(page: HTMLElement, path: string) {
  if (!LONG.test(path) || page.querySelector(".prog-jump, .cand-toc, .cv-toc, .jump")) { page.querySelector(".px-toc")?.remove(); page.classList.remove("has-toc"); return; }
  // a page that already links to its own sections (jump buttons in its header) needs no second list
  const own = [...page.querySelectorAll<HTMLAnchorElement>("a[href*='#']")].filter((a) => !a.closest(".px-toc") && a.getAttribute("href")!.startsWith(path + "#"));
  if (own.length >= 3) { page.querySelector(".px-toc")?.remove(); page.classList.remove("has-toc"); return; }
  const heads = [...page.querySelectorAll<HTMLElement>("h2")].filter((h) => !h.closest(".sec-hero, .next-steps, .px-toc") && h.textContent?.trim());
  if (heads.length < 4) return;
  const had = page.querySelector<HTMLElement>(".px-toc");
  if (had && Number(had.dataset.n) >= heads.length) return; // built, and no heading arrived since
  had?.remove();
  const used = new Set<string>();
  const items = heads.map((h) => {
    const box = h.closest<HTMLElement>("[id]:not(.page)");
    let target = box && page.contains(box) && !box.closest(".sec-hero") ? box : h;
    if (!target.id || used.has(target.id)) { target = h; if (!h.id) h.id = slug(h.textContent ?? "") || `s-${used.size}`; }
    used.add(target.id);
    return { id: target.id, text: h.textContent!.trim(), el: target };
  });
  const nav = document.createElement("nav");
  nav.className = "px-toc";
  nav.dataset.n = String(heads.length);
  nav.setAttribute("aria-label", L("Sur cette page", "On this page"));
  nav.innerHTML = `<details open><summary>${L("Sur cette page", "On this page")} <span>${items.length}</span></summary><ol>${items.map((x) => `<li><a href="#${esc(path.slice(1))}#${esc(x.id)}" data-id="${esc(x.id)}">${esc(x.text)}</a></li>`).join("")}</ol></details>`;
  // the band (if any) stays first and full width; the rail spans every reading row after it
  const hero = page.querySelector(":scope > .sec-hero");
  (hero ?? page.firstElementChild)?.after(nav);
  const rows = [...page.children].filter((c) => c !== nav && c !== hero && !c.matches(".next-steps")).length;
  nav.style.setProperty("--toc-rows", String(Math.max(1, rows)));
  page.classList.add("has-toc");
  if (!matchMedia("(min-width: 1100px)").matches) nav.querySelector("details")!.open = false;

  spy?.disconnect();
  const links = new Map(items.map((x) => [x.el, nav.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(x.id)}"]`)!]));
  spy = new IntersectionObserver((es) => {
    const on = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!on) return;
    links.forEach((a) => a.removeAttribute("aria-current"));
    links.get(on.target as HTMLElement)?.setAttribute("aria-current", "location");
  }, { rootMargin: "-25% 0px -65% 0px" });
  items.forEach((x) => spy!.observe(x.el));
}
