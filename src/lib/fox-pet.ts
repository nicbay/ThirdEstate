// The Third Estate fox, full body, living on the top edge of the note of the day. It sits and wags its tail,
// blinks, walks along the edge (sometimes all the way to the far end, sometimes back to the corner, turning to
// face where it goes), lies down, stretches, sits on the corner with its tail hanging over into the void, and now
// and then curls up asleep in its bowl. Click it to wake it or send it to bed. Pixel art in the mark's palette
// (frames in src/lib/fox-sprites.json); still under reduced motion; paused off screen and in background tabs.
import sprites from "./fox-sprites.json";

type Frame = keyof typeof sprites.frames;
const PAL = sprites.palette as Record<string, string>;
const PX = 3; // CSS px per sprite pixel

/** One frame as an SVG, its pixels standing on the frame's baseline (rows below it hang under the edge). */
function svg(name: Frame) {
  const f = sprites.frames[name] as { rows: string[]; baseline?: number };
  const w = Math.max(...f.rows.map((r) => r.length)), h = f.rows.length, base = f.baseline ?? h;
  let rects = "";
  f.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      const ch = row[c];
      let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      if (PAL[ch]) rects += `<rect x="${c}" y="${r}" width="${e - c}" height="1" fill="${PAL[ch]}"/>`;
      c = e;
    }
  });
  return { html: `<svg viewBox="0 0 ${w} ${h}" width="${w * PX}" height="${h * PX}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`, w: w * PX, below: (h - base) * PX };
}
const FR = Object.fromEntries((Object.keys(sprites.frames) as Frame[]).map((k) => [k, svg(k)])) as Record<Frame, ReturnType<typeof svg>>;

type Mode = "sit" | "walk" | "lie" | "bowl" | "stretch" | "edge";

/** Puts the fox on the top edge of the box `perch` sits on (an absolutely positioned, zero-height strip). */
export function mountFox(perch: HTMLElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "fox-pet";
  el.setAttribute("aria-label", "Le renard de Third Estate");
  el.innerHTML = `<span class="fp-sprite"></span><span class="fp-z" aria-hidden="true"></span>`;
  perch.append(el);
  const sprite = el.querySelector<HTMLElement>(".fp-sprite")!;
  const zs = el.querySelector<HTMLElement>(".fp-z")!;
  let shown: Frame | null = null;
  const show = (f: Frame) => {
    if (f === shown) return;
    shown = f;
    sprite.innerHTML = FR[f].html;
    sprite.style.marginBottom = `${-FR[f].below}px`; // the tail that hangs over the edge goes below the line
  };
  show("sitA");
  if (reduced) return () => el.remove();

  let mode: Mode = "sit", tick = 0, x = 0, face = 1, target = 0, until = 0, timer = 0, visible = true, rounds = 0;
  const room = () => Math.max(60, perch.clientWidth - 110); // up to the far end of the box
  const place = () => { el.style.transform = `translateX(${Math.round(x)}px) scaleX(${face})`; };
  const go = (m: Mode, ms = 0) => {
    mode = m; tick = 0; until = performance.now() + ms;
    el.classList.toggle("is-asleep", m === "bowl");
    zs.textContent = m === "bowl" ? "z z z" : "";
    if (m === "walk") {
      const r = Math.random();
      // all the way to the far edge, somewhere along it, or home to the corner
      target = x > room() * 0.6 ? (r < 0.6 ? 0 : room() * (0.2 + 0.4 * Math.random())) : r < 0.5 ? room() : r < 0.8 ? room() * (0.3 + 0.5 * Math.random()) : 0;
      face = target >= x ? 1 : -1;
    }
    if (m === "edge") { x = -34; face = 1; } // on the corner, the tail hanging outside the box
  };
  const next = () => {
    rounds++;
    const r = Math.random();
    if (x <= 0 && r < 0.35) return go("edge", 7000 + Math.random() * 5000);
    if (rounds % 5 === 0) return go("bowl", 16000);
    if (r < 0.55) return go("walk");
    if (r < 0.8) return go("lie", 6000 + Math.random() * 5000);
    return go("sit", 4000 + Math.random() * 3000);
  };
  const step = () => {
    timer = 0;
    if (!visible || document.hidden || !document.body.contains(el)) return;
    const now = performance.now();
    tick++;
    let delay = 240;
    switch (mode) {
      case "sit":
        // the tail wags; a blink now and then
        show(tick % 13 === 0 ? "blink" : tick % 4 < 2 ? "sitA" : "sitB");
        if (now > until) next();
        break;
      case "walk": {
        show((["walk1", "walk2", "walk3", "walk2"] as Frame[])[tick % 4]);
        x += face * 5;
        delay = 120;
        if ((face > 0 && x >= target) || (face < 0 && x <= target)) { x = target; go("sit", 3000 + Math.random() * 4000); }
        break;
      }
      case "lie":
        show("lie");
        delay = 500;
        if (now > until) go("stretch", 1400);
        break;
      case "stretch":
        show("stretch");
        if (now > until) go("sit", 2500);
        break;
      case "edge":
        show("edge");
        delay = 500;
        if (now > until) { x = 0; go("sit", 2000); }
        break;
      case "bowl":
        show("bowl");
        delay = 700;
        if (now > until) go("stretch", 1600);
        break;
    }
    place();
    timer = window.setTimeout(step, delay);
  };
  const kick = () => { if (!timer) timer = window.setTimeout(step, 60); };
  el.addEventListener("click", () => { mode === "bowl" ? go("stretch", 1400) : go("bowl", 14000); kick(); });
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
  io.observe(perch.parentElement ?? perch);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  go("sit", 5000);
  place();
  kick();
  return () => { clearTimeout(timer); io.disconnect(); document.removeEventListener("visibilitychange", onVis); el.remove(); };
}
