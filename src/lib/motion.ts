// Motion system. Every animation explains a number or a change of place, each page gets one
// orchestrated moment, and all of it is off under prefers-reduced-motion (docs/design.md, rule 5).
//
// Content is always complete at rest: nothing waits at opacity 0 for an observer. Seats start from
// grey seats, counters from 0, lines from their origin, and only once the element is on screen;
// an element that never scrolls into view simply stays as rendered.
//
//  - the masthead fox assembles pixel by pixel on the first visit of a session, blinks now and then,
//    and breathes while a route is loading (initFox, foxBusy);
//  - route changes cross over with the View Transitions API, the dark masthead staying put (pageTransition);
//  - figures count up, hemicycles fill group by group, word clouds fall into place in spiral order,
//    polling lines draw in and bars grow, the first time each enters the viewport (initMotion).
// Styles: the `.mo-` block at the end of style.css.
import { foxCells, foxFur } from "./fox";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const still = () => reducedMotion() || document.hidden;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- the fox ----------
let fox: SVGSVGElement | null = null;
let blinkTimer = 0;

/** Redraw the masthead fox one <rect> per pixel (eyes tagged for blinking) and start it living. */
export function initFox(svg: SVGSVGElement | null) {
  if (!svg) return;
  fox = svg;
  const cells = foxCells(true);
  // outline first (top to bottom, the ears before the chin), then the fur, the muzzle and the eyes
  const outline = cells.filter((c) => c.ch === "K").sort((a, b) => a.y - b.y || a.x - b.x);
  const rest = cells.filter((c) => c.ch !== "K").sort((a, b) => a.y - b.y || Math.abs(a.x - 7.5) - Math.abs(b.x - 7.5));
  let first = false;
  try { first = !sessionStorage.getItem("mo-fox"); sessionStorage.setItem("mo-fox", "1"); } catch { /* storage blocked: no assembly */ }
  const assemble = first && !still();
  const rect = (c: (typeof cells)[number], d: number) =>
    `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="${c.fill}"${c.ch === "E" ? ` class="mo-e" style="--fur:${foxFur(c.x, true)}${assemble ? `;animation-delay:${d}ms` : ""}"` : assemble ? ` style="animation-delay:${d}ms"` : ""}/>`;
  svg.innerHTML =
    outline.map((c, i) => rect(c, Math.round((i / outline.length) * 300))).join("") +
    rest.map((c, i) => rect(c, Math.round(300 + (i / rest.length) * 320))).join("");
  if (assemble) {
    svg.classList.add("mo-asm");
    setTimeout(() => svg.classList.remove("mo-asm"), 800);
  }
  scheduleBlink(assemble ? 1400 : 4000 + Math.random() * 4000);
}

function blink(double = false) {
  if (!fox || still()) return;
  fox.classList.add("mo-blink");
  setTimeout(() => fox?.classList.remove("mo-blink"), 120);
  if (double) setTimeout(() => blink(), 260);
}
function scheduleBlink(ms: number) {
  clearTimeout(blinkTimer);
  blinkTimer = window.setTimeout(() => {
    const busy = fox?.classList.contains("mo-busy");
    blink(!busy && Math.random() < 0.25);
    scheduleBlink(busy ? 1100 : 3500 + Math.random() * 5000);
  }, ms);
}

let busyTimer = 0;
/** The router's loading state: after 150 ms (no flicker on fast routes) the fox breathes and blinks faster. */
export function foxBusy(on: boolean) {
  clearTimeout(busyTimer);
  if (!fox) return;
  if (!on) { fox.classList.remove("mo-busy"); return; }
  busyTimer = window.setTimeout(() => {
    if (!fox || reducedMotion()) return;
    fox.classList.add("mo-busy");
    scheduleBlink(300);
  }, 150);
}

// ---------- page transitions ----------
type VTDocument = Document & { startViewTransition?: (cb: () => Promise<unknown>) => { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void>; skipTransition?: () => void } };

/**
 * Run a route render inside a view transition: the old page slides out, the new one in, the dark
 * masthead stays put (style.css names it). The browser freezes the old frame while the callback runs, so
 * it waits at most `cap` ms for the render: a slower route shows its loading line, and its page then
 * comes in with the ordinary .page entrance instead. No API or reduced motion: just render.
 */
export function pageTransition(update: () => Promise<unknown>, cap = 320): Promise<unknown> {
  const d = document as VTDocument;
  // hidden tabs get no frames, so a transition would hold the update back until the tab is shown again
  if (!d.startViewTransition || still() || document.visibilityState !== "visible") return update();
  const root = document.documentElement;
  root.classList.add("mo-vt");
  return new Promise((resolve) => {
    let late = 0;
    // The browser runs the update on its next painted frame. Where frames stall (an occluded or
    // throttled window), never let the page wait on them: after 100 ms, skip the transition and render.
    let started = false;
    const fallback = window.setTimeout(() => {
      if (started) return;
      started = true;
      try { vt.skipTransition?.(); } catch { /* already finished */ }
      root.classList.remove("mo-vt");
      update().catch(() => {}).then(() => resolve(undefined));
    }, 100);
    const vt = d.startViewTransition!(() => {
      if (started) return Promise.resolve(); // the fallback already rendered
      started = true;
      clearTimeout(fallback);
      const p = update().catch(() => {});
      late = window.setTimeout(() => root.classList.add("mo-late"), cap);
      p.then(() => {
        clearTimeout(late);
        // let a late page finish its entrance before switching it off
        setTimeout(() => root.classList.remove("mo-late"), 450);
        resolve(undefined);
      });
      return Promise.race([p, wait(cap)]);
    });
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
    vt.updateCallbackDone.catch(() => {});
  });
}

// ---------- in-view moments ----------
type Kind = "count" | "hemi" | "cloud" | "chart" | "bar";
/** What animates, and which ancestor counts as "already shown" so a re-render (a filter, a sort, a new selection) doesn't replay it. */
const KINDS: [Kind, string, (el: Element) => Element | null][] = [
  ["count", "[data-count]", () => null], // explicit opt-in: every new one counts
  ["count", ".kpis strong, .lk strong, .eco-v, .hemicycle .hemi-total", (el) => el.closest("section, article, .card, .kpis") ?? el.parentElement],
  ["hemi", "svg.hemicycle", (el) => el.parentElement],
  ["cloud", "svg.wordcloud", (el) => el.parentElement],
  ["chart", "svg.chart", (el) => el.parentElement],
  ["bar", ".loy-bar, .pcs-bar, .wr-bar, .pw-bar, .t-bar", (el) => el.closest("table, ol, ul, section, .card") ?? el.parentElement],
];
const seen = new WeakSet<Element>();
const shownScopes: Record<Kind, WeakSet<Element>> = { count: new WeakSet(), hemi: new WeakSet(), cloud: new WeakSet(), chart: new WeakSet(), bar: new WeakSet() };
const kindOf = new WeakMap<Element, Kind>();
let io: IntersectionObserver | null = null;

/** Watch `root` for figures, hemicycles, clouds, charts and bars, and play each once when it comes into view. */
export function initMotion(root: HTMLElement) {
  if (!("IntersectionObserver" in window)) return;
  io = new IntersectionObserver((es) => {
    const now = es.filter((e) => e.isIntersecting).map((e) => e.target);
    now.forEach((t) => io!.unobserve(t));
    if (now.length) play(now);
  }, { rootMargin: "0px 0px -8% 0px" });
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(root); });
  }).observe(root, { childList: true, subtree: true });
  scan(root);
  // a counter left mid-flight when the tab is hidden jumps to its value
  document.addEventListener("visibilitychange", () => { if (document.hidden) running.forEach((f) => f()); });
}

function scan(root: HTMLElement) {
  if (reducedMotion()) return;
  const fresh: Element[] = [];
  const scopes: [Kind, Element][] = [];
  for (const [kind, sel, scopeOf] of KINDS) {
    root.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (kind === "chart" && el.closest(".reveal")) return; // those already draw in (home trend, shift map)
      if (kind === "count" && !countable(el)) return;
      const scope = scopeOf(el);
      if (scope && shownScopes[kind].has(scope)) return;
      if (scope) scopes.push([kind, scope]);
      kindOf.set(el, kind);
      fresh.push(el);
    });
  }
  // every element of one render pass is armed before its scope is marked, so siblings all play
  scopes.forEach(([k, s]) => shownScopes[k].add(s));
  if (!fresh.length) return;
  // read all positions first, then write: one layout for the whole batch
  const vh = innerHeight;
  const inView = fresh.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh * 0.92 && (r.width > 0 || r.height > 0);
  });
  fresh.forEach((el) => { if (!inView.includes(el)) io!.observe(el); });
  if (inView.length) play(inView);
}

function play(els: Element[]) {
  if (still()) return;
  const counts: Element[] = [];
  for (const el of els) {
    const kind = kindOf.get(el);
    if (kind === "count") counts.push(el);
    else el.classList.add("mo-play");
  }
  if (counts.length) countUp(counts);
}

// ---------- counting up ----------
interface Num { pre: string; post: string; value: number; dec: number; group: string; decChar: string }
const NUM = /\d+(?:[   .,]\d+)*/;

/** Split "1 234,5 €" into prefix, number and suffix, keeping the separators it was written with. */
function parseNum(text: string): Num | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const tok = m[0];
  const seps = tok.match(/[^\d]/g) ?? [];
  const fr = document.documentElement.lang !== "en";
  const decChars = fr ? [",", "."] : ["."];
  let intPart = tok, frac = "", decChar = fr ? "," : ".";
  const last = seps.at(-1);
  if (last && decChars.includes(last) && !(seps.length > 1 && seps.every((s) => s === last))) {
    const i = tok.lastIndexOf(last);
    intPart = tok.slice(0, i);
    frac = tok.slice(i + 1);
    decChar = last;
  }
  const groups = intPart.match(/[^\d]/g) ?? [];
  if (groups.some((g) => decChars.includes(g) && fr)) return null; // "1.234.567" in French: not ours to guess
  const parts = intPart.split(/[^\d]/);
  if (parts.slice(1).some((p) => p.length !== 3)) return null;
  const value = Number(parts.join("") + (frac ? `.${frac}` : ""));
  if (!Number.isFinite(value)) return null;
  return { pre: text.slice(0, m.index), post: text.slice(m.index + tok.length), value, dec: frac.length, group: groups[0] ?? "", decChar };
}
function fmtNum(n: Num, v: number) {
  const [i, f] = v.toFixed(n.dec).split(".");
  const int = n.group ? i.replace(/\B(?=(\d{3})+(?!\d))/g, n.group) : i;
  return `${n.pre}${int}${f ? n.decChar + f : ""}${n.post}`;
}

/** Text-only, a real number, and (unless opted in) not a year and not a sentence. */
function countable(el: Element) {
  if (el.childNodes.length !== 1 || el.firstChild!.nodeType !== Node.TEXT_NODE) return false;
  const text = el.textContent ?? "";
  const n = parseNum(text);
  if (!n || n.value === 0) return false;
  if (el.hasAttribute("data-count")) return true;
  if (!n.group && !n.dec && n.value >= 1800 && n.value <= 2100) return false;
  return (n.pre + n.post).trim().length <= 6;
}

const running = new Set<() => void>();
const DUR = 420;

function countUp(els: Element[]) {
  // read: final text, parsed number and the width it will need
  const jobs = els.map((el) => {
    const text = el.textContent ?? "";
    let w = 0;
    if (el instanceof HTMLElement) {
      const r = document.createRange();
      r.selectNodeContents(el);
      w = r.getBoundingClientRect().width;
    }
    return { el, text, n: parseNum(text)!, w };
  }).filter((j) => j.n);
  // write
  jobs.forEach(({ el, text, n, w }, i) => {
    let show: Element | Text;
    if (el instanceof HTMLElement) {
      // the final figure stays in the DOM for screen readers; the moving one is hidden from them
      const vis = document.createElement("span");
      vis.className = "mo-num";
      vis.setAttribute("aria-hidden", "true");
      vis.style.minWidth = `${Math.ceil(w)}px`;
      const sr = document.createElement("span");
      sr.className = "mo-sr";
      sr.textContent = text;
      el.replaceChildren(vis, sr);
      show = vis;
    } else show = el.firstChild as Text; // SVG <text>: its <svg role="img"> carries the label
    const t0 = performance.now() + Math.min(i, 6) * 50;
    const finish = () => { running.delete(finish); if (show.parentNode === el) el.textContent = text; };
    running.add(finish);
    show.textContent = fmtNum(n, 0);
    const step = (t: number) => {
      if (!running.has(finish)) return;
      if (show.parentNode !== el) { running.delete(finish); return; } // the view re-rendered it: leave theirs
      const k = Math.max(0, Math.min(1, (t - t0) / DUR));
      if (k >= 1) return finish();
      show.textContent = fmtNum(n, n.value * (1 - (1 - k) ** 3));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
