// What the fox can stand on, in page coordinates. The fox lives in a layer at the document's origin, so a box's
// top edge read once (getBoundingClientRect + scroll) stays right while the reader scrolls; only layout changes
// (resize, content loading, a page change) move it, and the fox re-reads its own box once a frame.

/** What the fox may land on and walk along: only buttons and boxes with an edge of their own (cards, the note of the
 *  day, the hero's buttons, the bordered boxes, the homepage widgets). Never a bare figure, a map or a legend: there
 *  the fox would look as if it sat on nothing. */
export const SURF_SEL = ".card, .ed, .box, .hday-doors a, .hw, .quiz-line .button";
/** What a lingering pointer can draw the fox's attention to (a chart, a card, a button). */
export const ATTN_SEL = ".card, figure, .hw, .ed, .hday-doors a, .button, .hd-legend, table";
/** Elements that carry words: the fox never sits where its painted pixels would hide them. */
const TEXTY = "p, h1, h2, h3, h4, h5, li, a, button, label, td, th, figcaption, dt, dd, span, b, strong, em, small, input, select, textarea, text";

export type Surface = { el: Element; left: number; right: number; top: number };

const TOP_BAR = 64; // under the sticky masthead nothing can be stood on

const clear = (c: string) => !c || c === "transparent" || /,\s*0\)$/.test(c);
/** True when the element is one of the boxes above AND is drawn as one right now: a visible top line, or a ground
 *  of its own. The class alone is not enough (a card inside a card is flat, and page CSS changes), so this is
 *  read from the computed style each time. */
export function isBox(el: Element): boolean {
  if (!el.matches(SURF_SEL) || el.closest(".fox-layer")) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  const line = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && !clear(cs.borderTopColor);
  return line || !clear(cs.backgroundColor) || cs.backgroundImage !== "none";
}

/** The nearest box around an element (or the element itself), as a surface; null when it sits in no box. */
export function boxOf(el: Element): Surface | null {
  for (let e: Element | null = el; e; e = e.parentElement?.closest(SURF_SEL) ?? null) {
    if (isBox(e)) { const s = measure(e); if (s) return s; }
  }
  return null;
}

/** A box's top edge in page coordinates, or null when it is gone, hidden or too small to stand on. */
export function measure(el: Element): Surface | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 36 || r.height < 8) return null;
  return { el, left: r.left + scrollX, right: r.right + scrollX, top: r.top + scrollY };
}

/** Boxes whose top edge is on screen (give or take `margin` px), in document order. */
export function visibleSurfaces(margin = 0): Surface[] {
  const out: Surface[] = [];
  const vh = innerHeight, vw = innerWidth;
  for (const el of document.querySelectorAll(SURF_SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 36 || r.height < 8 || r.top < TOP_BAR - margin || r.top > vh + margin || r.right < 0 || r.left > vw) continue;
    if (!isBox(el)) continue; // after the cheap test: only what is on screen has its style read
    out.push({ el, left: r.left + scrollX, right: r.right + scrollX, top: r.top + scrollY });
    if (out.length > 60) break; // a long list page: the first sixty on screen are plenty to choose from
  }
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Where on a box the fox's feet can be (its body is about 70px wide, so it keeps off the very ends). */
export const standRange = (s: Surface): [number, number] => {
  const inset = Math.min(22, (s.right - s.left) / 2);
  return [s.left + inset, s.right - inset];
};

/** A jump from box `a` (fox at `x`) to box `b`: where to take off and where to land, or null when out of reach.
 *  Up to 300px up, any reasonable drop, at most 380px across. */
export function jumpSpot(x: number, a: Surface, b: Surface): { takeoff: number; land: number } | null {
  const rise = a.top - b.top;
  if (rise > 300 || rise < -900) return null;
  const [bl, br] = standRange(b), [al, ar] = standRange(a);
  const land = clamp(x, bl, br);
  let takeoff = clamp(land, al, ar);
  // a straight-up hop reads as a glitch: take off at least 60px to one side when the box allows it
  if (Math.abs(land - takeoff) < 60) {
    const back = clamp(land - 70, al, ar), fwd = clamp(land + 70, al, ar);
    takeoff = Math.abs(back - land) >= Math.abs(fwd - land) ? back : fwd;
  }
  if (Math.abs(land - takeoff) > 380) return null;
  return { takeoff, land };
}

/** Hops to get from box `a` to box `b` through boxes on screen (at most three), or null. */
export function plan(x: number, a: Surface, b: Surface, toX: number) {
  type Hop = { s: Surface; takeoff: number; land: number };
  const pool = visibleSurfaces(250).filter((s) => s.el !== a.el && s.el !== b.el);
  const nodes = [b, ...pool];
  const queue: { s: Surface; x: number; path: Hop[] }[] = [{ s: a, x, path: [] }];
  const seen = new Set<Element>([a.el]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.path.length >= 3) continue;
    for (const n of nodes) {
      if (seen.has(n.el)) continue;
      const j = jumpSpot(n === b ? clamp(toX, ...standRange(b)) : cur.x, cur.s, n);
      if (!j) continue;
      const path = [...cur.path, { s: n, ...j }];
      if (n === b) return path;
      seen.add(n.el);
      queue.push({ s: n, x: j.land, path });
    }
  }
  return null;
}

/** True when the fox (about 70×66px) standing at `x` on box `s` would hide no words: samples a few points of its
 *  silhouette and looks at what is under them, ignoring the box itself and the containers around it. */
export function clearAbove(x: number, s: Surface): boolean {
  const vy = s.top - scrollY, vx = x - scrollX;
  if (vy - 60 < TOP_BAR) return false;
  for (const [dx, dy] of [[-28, 8], [0, 22], [24, 40], [-10, 52], [18, 10]]) {
    const px = vx + dx, py = vy - dy;
    if (px < 0 || px > innerWidth) return false;
    const hit = document.elementsFromPoint(px, py).find((e) => !e.closest(".fox-layer"));
    if (!hit || hit === s.el || hit.contains(s.el)) continue;
    const t = hit.closest(TEXTY);
    if (t && !t.contains(s.el)) return false;
  }
  return true;
}
