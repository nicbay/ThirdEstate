// Zoom and pan for an SVG map, by animating its viewBox (so strokes and arrows can be redrawn at a
// constant on-screen size by the caller, see onChange).
// - drag to pan; double-click / double-tap to zoom in; Ctrl/⌘ + wheel to zoom (a plain wheel keeps
//   scrolling the page, with a hint); two-finger pinch on touch screens
// - zoomBy / reset / zoomToBox for buttons and "click a department to zoom"
// - `wasDrag()` lets click handlers ignore the click that ends a drag
export interface Zoomable {
  zoomBy: (factor: number, cx?: number, cy?: number) => void;
  reset: () => void;
  zoomToBox: (x0: number, y0: number, x1: number, y1: number) => void;
  /** current zoom: 1 = whole map, 2 = twice as close */
  level: () => number;
  wasDrag: () => boolean;
}

export function zoomable(svg: SVGSVGElement, opts: { maxZoom?: number; onChange?: (zoom: number, settled: boolean) => void; onHint?: () => void } = {}): Zoomable {
  const [bx, by, bw, bh] = (svg.getAttribute("viewBox") ?? "0 0 800 600").split(/\s+/).map(Number);
  const maxZoom = opts.maxZoom ?? 10;
  let vb = { x: bx, y: by, w: bw, h: bh };
  let anim = 0, settleT = 0, dragged = false;

  const clamp = (v: typeof vb) => {
    const w = Math.min(bw, Math.max(bw / maxZoom, v.w));
    const h = (w * bh) / bw;
    // keep at least a third of the view over the map
    const x = Math.min(bx + bw - w / 3, Math.max(bx - (2 * w) / 3, v.x));
    const y = Math.min(by + bh - h / 3, Math.max(by - (2 * h) / 3, v.y));
    return w >= bw ? { x: bx, y: by, w: bw, h: bh } : { x, y, w, h };
  };
  const apply = (settled: boolean) => {
    svg.setAttribute("viewBox", `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`);
    const z = bw / vb.w;
    svg.classList.toggle("is-zoomed", z > 1.001);
    svg.style.touchAction = z > 1.001 ? "none" : "pan-y"; // at full view, a one-finger swipe still scrolls the page
    opts.onChange?.(z, settled);
    clearTimeout(settleT);
    if (!settled) settleT = window.setTimeout(() => opts.onChange?.(bw / vb.w, true), 140);
  };
  const set = (v: typeof vb, settled = false) => { vb = clamp(v); apply(settled); };
  const tween = (to: typeof vb) => {
    cancelAnimationFrame(anim);
    const from = { ...vb }, target = clamp(to), t0 = performance.now();
    const dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      apply(k >= 1);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  /** screen point → viewBox point */
  const toVB = (clientX: number, clientY: number) => {
    const r = svg.getBoundingClientRect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  };
  const zoomAround = (factor: number, px: number, py: number, animate: boolean) => {
    const w = vb.w / factor, h = vb.h / factor;
    const next = { x: px - ((px - vb.x) / vb.w) * w, y: py - ((py - vb.y) / vb.h) * h, w, h };
    animate ? tween(next) : set(next);
  };

  // ---- wheel (Ctrl/⌘ only)
  svg.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) { opts.onHint?.(); return; }
    e.preventDefault();
    const p = toVB(e.clientX, e.clientY);
    zoomAround(Math.exp(-e.deltaY * 0.0022), p.x, p.y, false);
  }, { passive: false });

  // ---- drag and pinch
  const pts = new Map<number, { x: number; y: number }>();
  let start: { vb: typeof vb; cx: number; cy: number; dist: number } | null = null;
  const snapshot = () => {
    const ps = [...pts.values()];
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    start = { vb: { ...vb }, cx, cy, dist };
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) dragged = false;
    snapshot();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pts.values()];
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const r = svg.getBoundingClientRect();
    if (!dragged && Math.hypot(cx - start.cx, cy - start.cy) < 5 && pts.size < 2) return;
    if (pts.size === 1 && bw / vb.w <= 1.001) return; // nothing to pan at full view
    if (!dragged) { dragged = true; svg.setPointerCapture(e.pointerId); }
    cancelAnimationFrame(anim);
    let w = start.vb.w, h = start.vb.h;
    if (pts.size > 1 && start.dist) {
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      w = start.vb.w * (start.dist / dist); h = (w * bh) / bw;
    }
    // keep the point under the fingers' centre fixed
    const ax = start.vb.x + ((start.cx - r.left) / r.width) * start.vb.w;
    const ay = start.vb.y + ((start.cy - r.top) / r.height) * start.vb.h;
    set({ x: ax - ((cx - r.left) / r.width) * w, y: ay - ((cy - r.top) / r.height) * h, w, h });
  });
  const end = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size) snapshot(); else start = null;
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const p = toVB(e.clientX, e.clientY);
    zoomAround(e.shiftKey ? 0.5 : 2, p.x, p.y, true);
  });

  return {
    zoomBy: (factor, cx, cy) => zoomAround(factor, cx ?? vb.x + vb.w / 2, cy ?? vb.y + vb.h / 2, true),
    reset: () => tween({ x: bx, y: by, w: bw, h: bh }),
    zoomToBox: (x0, y0, x1, y1) => {
      const pad = 0.15;
      let w = (x1 - x0) * (1 + 2 * pad), h = (y1 - y0) * (1 + 2 * pad);
      if (w / h > bw / bh) h = (w * bh) / bw; else w = (h * bw) / bh;
      tween({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
    },
    level: () => bw / vb.w,
    wasDrag: () => dragged,
  };
}
