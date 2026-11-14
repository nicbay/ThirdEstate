// The Third Estate fox, full body, living on the corner of the note of the day: it sits and wags its tail, now and
// then walks a few steps along the box's top edge and back, and after a while curls up and sleeps (a few "z"
// rise). Click it to wake it up, or to send it to sleep. Pixel art in the mark's palette (src/lib/fox.ts); still
// under reduced motion; paused off screen and in a background tab.

const PAL: Record<string, string> = { K: "#5470ff", L: "#e1000f", M: "#ffffff", E: "#111216", N: "#111216" };

// Facing right. '.' is transparent. Rows top to bottom.
const SIT_A = [
  ".......K.K......",
  "......KLKLK.....",
  "......KLLLLK....",
  "......KLLLELK...",
  ".......KLLMMNK..",
  ".......KLLMMK...",
  "......KLLLMK....",
  ".....KLLLLMK....",
  "....KLLLLLMK....",
  "KK..KLLLLLMK....",
  "KLK.KLLLLLLK....",
  "KLLKKLLLLLLK....",
  ".KMLLLLLLLLK....",
  "..KKKMMKKMMK....",
];
const SIT_B = [
  ...SIT_A.slice(0, 8),
  "KK..KLLLLLMK....",
  "KMK.KLLLLLMK....",
  "KLLKKLLLLLLK....",
  ".KLLLLLLLLLK....",
  "..KKLLLLLLLK....",
  "....KMMKKMMK....",
];
const WALK_TOP = [
  "..........K.K.....",
  ".........KLKLK....",
  "KK.......KLLELK...",
  "KMK......KLLLMMNK.",
  ".KLKKKKKKKLLLMMK..",
  "..KLLLLLLLLLLMK...",
  "..KLLLLLLLLLLLK...",
  "..KLLKKKKKKKLLK...",
];
const WALK_A = [...WALK_TOP, "..KMK.....KMK.....", "..KK......KK......"];
const WALK_B = [...WALK_TOP, "...KMK...KMK......", "...KK.....KK......"];
const SLEEP = [
  "................",
  "................",
  "................",
  "................",
  ".....KKKKKKK....",
  "...KKLLLLLLLKK..",
  "..KLLLLLLLLLLLK.",
  ".KLLKKLLLLLLLLK.",
  ".KLKEKMMMMLLLLK.",
  "KNMMMMMMMMMMLLK.",
  "KMMMMMMMMMMMMK..",
  ".KKKKKKKKKKKK...",
  "................",
  "................",
];

const PX = 3; // CSS px per sprite pixel
const W = 18, H = 14;
function frame(rows: string[]) {
  let out = "";
  const dy = H - rows.length; // all frames stand on the same baseline
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      const ch = row[c];
      let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      if (PAL[ch]) out += `<rect x="${c}" y="${r + dy}" width="${e - c}" height="1" fill="${PAL[ch]}"/>`;
      c = e;
    }
  });
  return out;
}
const FRAMES = { sitA: frame(SIT_A), sitB: frame(SIT_B), walkA: frame(WALK_A), walkB: frame(WALK_B), sleep: frame(SLEEP) };

/** Puts the fox on the top-left corner of `box` (positioned). Returns a cleanup function. */
export function mountFox(box: HTMLElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "fox-pet";
  el.setAttribute("aria-label", "Le renard de Third Estate");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W * PX}" height="${H * PX}" shape-rendering="crispEdges" aria-hidden="true"><g class="fp-body">${FRAMES.sitA}</g></svg><span class="fp-z" aria-hidden="true"></span>`;
  box.append(el);
  const body = el.querySelector<SVGGElement>(".fp-body")!;
  const zs = el.querySelector<HTMLElement>(".fp-z")!;
  if (reduced) return () => el.remove();

  type Mode = "sit" | "walk" | "sleep";
  let mode: Mode = "sit", tick = 0, x = 0, dir = 1, target = 0, until = 0, timer = 0, visible = true, cycles = 0;
  const show = (f: keyof typeof FRAMES) => { body.innerHTML = FRAMES[f]; };
  const set = (m: Mode, ms: number) => {
    mode = m; until = performance.now() + ms; tick = 0;
    el.classList.toggle("is-asleep", m === "sleep");
    zs.textContent = m === "sleep" ? "z z z" : "";
    if (m === "walk") {
      const room = Math.max(40, Math.min(160, box.clientWidth * 0.25));
      target = x === 0 ? room * (0.4 + 0.6 * Math.random()) : 0; // out along the edge, then back to the corner
      dir = target > x ? 1 : -1;
    }
  };
  const step = () => {
    timer = 0;
    if (!visible || document.hidden || !document.body.contains(el)) return;
    const now = performance.now();
    tick++;
    if (mode === "sit") {
      show(tick % 4 < 2 ? "sitA" : "sitB"); // the tail wags
      if (now > until) { cycles++; set(cycles % 4 === 0 ? "sleep" : "walk", cycles % 4 === 0 ? 14000 : 0); }
    } else if (mode === "walk") {
      show(tick % 2 ? "walkA" : "walkB");
      x += dir * 4;
      if ((dir > 0 && x >= target) || (dir < 0 && x <= target)) { x = target; set("sit", 4000 + Math.random() * 5000); }
    } else {
      show("sleep");
      if (now > until) set("sit", 5000);
    }
    el.style.transform = `translateX(${x}px) scaleX(${mode === "walk" ? dir : 1})`;
    timer = window.setTimeout(step, mode === "walk" ? 140 : mode === "sleep" ? 600 : 260);
  };
  const kick = () => { if (!timer) timer = window.setTimeout(step, 50); };
  el.addEventListener("click", () => { set(mode === "sleep" ? "sit" : "sleep", mode === "sleep" ? 6000 : 12000); kick(); });
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
  io.observe(box);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  set("sit", 5000);
  kick();
  return () => { clearTimeout(timer); io.disconnect(); document.removeEventListener("visibilitychange", onVis); el.remove(); };
}
