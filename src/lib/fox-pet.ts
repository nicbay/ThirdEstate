// The Third Estate fox, a small physical character that lives on the page's boxes. Pixel art in the mark's
// palette (frames in src/lib/fox-sprites.json, 3 CSS px per sprite pixel).
//
// How it works
// - Where: one absolutely positioned layer at the document's origin (`.fox-layer`), so the fox is placed in page
//   coordinates and scrolls with the boxes it stands on without any work; it never takes part in layout. Only the
//   fox's painted pixels take the pointer, everything else under it stays clickable.
// - Body: one state (`act`) drives both the frame and the motion: sit, walk, lie, stretch, bowl (asleep), edge
//   (tail over a corner), look, crouch → air → land (a jump, an authored parabola, fox-physics.ts), hang (held
//   by the scruff), fly (thrown: simulated, with a spring tail), dizzy, flip (its trick), gone (off screen).
// - Mind: `life()` is an async loop that picks what to do next (wander, hop to another box, sleep, play with a
//   prop, go and read along with what the reader lingers on, find the middle of the screen when the reader is
//   idle). Each step is an awaited action that resolves false the moment the fox is interrupted (grabbed, thrown,
//   called away), so a plan simply stops; the physics then hands control back by starting a fresh `life()`.
// - Frame budget: one requestAnimationFrame loop, running only while the fox is on screen or moving; every frame
//   reads first (its box's rect, scroll), then writes transforms. Background tabs pause it (rAF stops).
// - Under reduced motion the fox only sits on the note of the day and blinks.
import sprites from "./fox-sprites.json";
import "../styles/fox.css";
import { L } from "../i18n";
import { arcAt, makeArc, squash, stepBody, type Arc, type Body } from "./fox-physics";
import { ATTN_SEL, clearAbove, jumpSpot, measure, plan, standRange, visibleSurfaces, SURF_SEL, type Surface } from "./fox-world";
import { playTrick, type FoxApi, type Prop } from "./fox-props";

type Frame = keyof typeof sprites.frames;
const PAL = sprites.palette as Record<string, string>;
const PX = 3;
const BOX = 102; // the sprite box is 34 sprite px wide; the fox's x is its centre, its y the line its feet are on

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
  return { html: `<svg viewBox="0 0 ${w} ${h}" width="${w * PX}" height="${h * PX}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`, h: h * PX, below: (h - base) * PX };
}
const FR = Object.fromEntries((Object.keys(sprites.frames) as Frame[]).map((k) => [k, svg(k)])) as Record<Frame, ReturnType<typeof svg>>;

type Act = "sit" | "walk" | "lie" | "stretch" | "bowl" | "edge" | "look" | "crouch" | "air" | "land" | "hang" | "fly" | "dizzy" | "flip" | "sulk" | "gone";
const RESTING = new Set<Act>(["sit", "lie", "bowl", "edge", "look", "sulk", "dizzy"]);

// what the visit remembers: how often the fox was thrown, and when last
const MEM = "te-fox";
const readMem = (): { n: number; at: number } => { try { return JSON.parse(sessionStorage.getItem(MEM) ?? "") ?? { n: 0, at: 0 }; } catch { return { n: 0, at: 0 }; } };
const writeMem = (m: { n: number; at: number }) => { try { sessionStorage.setItem(MEM, JSON.stringify(m)); } catch { /* private mode */ } };

let layer: HTMLElement | null = null;
let current: { destroy: () => void } | null = null;
const getLayer = () => {
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div");
    layer.className = "fox-layer";
    document.body.append(layer);
  }
  return layer;
};
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Opts = { home?: Element; visitor?: boolean };

function createFox(opts: Opts) {
  const reduced = reducedMotion();
  const lay = getLayer();
  const el = document.createElement("button");
  el.type = "button";
  el.className = "fox-pet";
  el.setAttribute("aria-label", L("Le renard de Third Estate : appuyez pour un tour", "The Third Estate fox: press for a trick"));
  el.innerHTML = `<span class="fp-body"><span class="fp-sprite"></span><span class="fp-tail">${FR.tail.html}</span></span><span class="fp-z" aria-hidden="true"></span>`;
  el.style.visibility = "hidden"; // until it has somewhere to be
  lay.append(el);
  const body = el.querySelector<HTMLElement>(".fp-body")!;
  const sprite = el.querySelector<HTMLElement>(".fp-sprite")!;
  const tailEl = el.querySelector<HTMLElement>(".fp-tail")!;
  const bubble = el.querySelector<HTMLElement>(".fp-z")!;

  // ---- state
  let x = 0, y = 0, face = 1, act: Act = "gone", t0 = performance.now(), surf: Surface | null = null;
  let arc: Arc | null = null, fly: Body | null = null, bounces = 0, landRot = 0, impact = 0;
  let hang = { px: 0, py: 0, swing: 0, swingV: 0 }, samples: { x: number; y: number; t: number }[] = [];
  let pend: { done: (now: number) => boolean; resolve: (ok: boolean) => void } | null = null;
  let gen = 0, dead = false, raf = 0, last = 0, onScreen = true, rounds = 0, lastTrick = performance.now();
  let attention: { el: Element; px: number } | null = null, lastAttended: Element | null = null;
  let lastActivity = performance.now(), idleHandled = false, hoverEl: Element | null = null, hoverSince = 0, hoverX = 0;
  let goneTimer = 0, leaveAt = opts.visitor ? performance.now() + rand(40000, 80000) : Infinity;
  const props = new Set<Prop>();
  let shownFrame: Frame | null = null;

  const show = (f: Frame) => {
    if (f === shownFrame) return;
    shownFrame = f;
    sprite.innerHTML = FR[f].html;
    sprite.style.marginBottom = `${-FR[f].below}px`;
  };
  const say = (t: string) => { if (bubble.textContent !== t) bubble.textContent = t; };
  const setAct = (a: Act) => {
    act = a; t0 = performance.now();
    el.classList.toggle("is-asleep", a === "bowl");
    el.classList.toggle("is-flying", a === "fly");
    el.classList.toggle("is-held", a === "hang");
    el.style.visibility = a === "gone" ? "hidden" : "";
    if (a === "gone" && document.activeElement === el) el.blur(); // decorative: never keep focus on an absent fox
    say(a === "bowl" ? "z z z" : a === "sulk" ? "…" : "");
    wake();
  };

  // ---- actions: each resolves true when done, false when interrupted
  const perform = (a: Act, done: (now: number) => boolean) => new Promise<boolean>((resolve) => {
    if (pend) pend.resolve(false);
    setAct(a);
    pend = { done, resolve };
  });
  const timed = (a: Act, ms: number) => perform(a, (now) => now - t0 >= ms);
  let walkTarget = 0;
  const walkTo = (tx: number) => {
    if (surf) { const [lo, hi] = standRange(surf); if (act !== "gone") tx = Math.max(lo, Math.min(hi, tx)); }
    if (Math.abs(tx - x) < 2) return Promise.resolve(true);
    walkTarget = tx; face = tx > x ? 1 : -1;
    return perform("walk", () => x === walkTarget);
  };
  const interrupt = () => { gen++; if (pend) { const p = pend; pend = null; p.resolve(false); } };

  async function jumpTo(s: Surface, takeoff: number, land: number) {
    if (!(await walkTo(takeoff))) return false;
    if (Math.abs(land - x) > 4) face = land > x ? 1 : -1;
    if (!(await timed("crouch", 170))) return false;
    arc = makeArc(x, y, land, s.top);
    surf = null;
    const target = s.el;
    if (!(await perform("air", () => !!arc && arc.t >= arc.T))) return false;
    surf = measure(target) ?? s;
    y = surf.top; landRot = 0; impact = 0;
    return timed("land", 150);
  }
  async function goTo(s: Surface, tx: number): Promise<boolean> {
    if (!surf) return false;
    if (surf.el === s.el) return walkTo(tx);
    const hops = plan(x, surf, s, tx);
    if (!hops) return relocate(s, tx);
    for (const h of hops) if (!(await jumpTo(h.s, h.takeoff, h.land))) return false;
    return walkTo(tx);
  }
  /** Out by the nearest screen edge (walking if the box reaches it, else leaping off), then gone. */
  async function exitScreen() {
    const left = x - scrollX < innerWidth / 2, edge = left ? scrollX - 80 : scrollX + innerWidth + 80;
    if (surf && (left ? surf.left <= scrollX + 30 : surf.right >= scrollX + innerWidth - 30)) {
      walkTarget = edge; face = left ? -1 : 1;
      if (!(await perform("walk", () => x === walkTarget))) return false;
    } else {
      if (surf && !(await walkTo(left ? surf.left : surf.right))) return false;
      face = left ? -1 : 1;
      if (!(await timed("crouch", 160))) return false;
      arc = makeArc(x, y, edge + (left ? -60 : 60), y + 220);
      surf = null;
      if (!(await perform("air", () => !!arc && arc.t >= arc.T))) return false;
    }
    setAct("gone");
    return true;
  }
  /** In from the screen edge nearest `tx`: walking along the box if it reaches the edge, leaping in otherwise. */
  async function enter(s: Surface, tx: number, side?: number) {
    side ??= tx - scrollX < innerWidth / 2 ? -1 : 1;
    const edge = side < 0 ? scrollX - 60 : scrollX + innerWidth + 60;
    face = -side;
    if (side < 0 ? s.left <= scrollX + 30 : s.right >= scrollX + innerWidth - 30) {
      x = edge; y = s.top; surf = s;
      walkTarget = tx;
      return perform("walk", () => x === walkTarget);
    }
    x = edge; y = s.top - 160; surf = null;
    arc = makeArc(x, y, tx, s.top);
    arc.h = 40;
    if (!(await perform("air", () => !!arc && arc.t >= arc.T))) return false;
    surf = measure(s.el) ?? s; y = surf.top;
    return timed("land", 150);
  }
  async function relocate(s: Surface, tx: number) {
    if (!(await exitScreen())) return false;
    if (!(await timed("gone", 900))) return false;
    const m = measure(s.el);
    return m ? enter(m, tx) : false;
  }

  // ---- the mind
  const api: FoxApi = {
    x: () => x, y: () => y, face: () => face, setFace: (f) => { face = f; }, surf: () => surf,
    walkTo, goTo, timed: (a, ms) => timed(a, ms), props, layer: lay,
  };
  const homeSurface = () => (opts.home ? measure(opts.home) : null);

  async function attend(a: { el: Element; px: number }) {
    lastAttended = a.el;
    const target = a.el instanceof SVGElement ? a.el.closest("figure") ?? a.el : a.el;
    const r = target.getBoundingClientRect(), cx = r.left + r.width / 2 + scrollX;
    face = cx >= x ? 1 : -1;
    say("!");
    if (!(await timed("look", 700))) return false;
    say("");
    const s = measure(target);
    if (!s || s.top - scrollY < 70 || s.top - scrollY > innerHeight - 20) return timed("look", 2500);
    // beside it, on its top corner away from the pointer (so the fox never sits where the reader points)
    const [lo, hi] = standRange(s);
    const corners = a.px + scrollX < cx ? [hi - 14, lo + 14] : [lo + 14, hi - 14];
    const spot = corners.find((c) => clearAbove(c, s));
    if (spot === undefined) return timed("look", 2500);
    if (!(await goTo(s, spot))) return false;
    face = cx >= x ? 1 : -1;
    return timed("sit", rand(6000, 9000));
  }

  async function hopSomewhere() {
    if (!surf) return false;
    const home = homeSurface();
    let pool = visibleSurfaces().filter((s) => s.el !== surf!.el);
    if (home && surf.el !== home.el && Math.random() < 0.5) pool = [home];
    const options = pool.map((s) => ({ s, j: jumpSpot(x, surf!, s) })).filter((o) => o.j && clearAbove(o.j.land, o.s));
    if (!options.length) return timed("sit", 2000);
    const o = options[Math.floor(Math.random() * options.length)];
    return jumpTo(o.s, o.j!.takeoff, o.j!.land);
  }

  async function think(): Promise<boolean> {
    if (!surf) return timed("sit", 500);
    if (attention) { const a = attention; attention = null; return attend(a); }
    if (opts.visitor && performance.now() > leaveAt) { await exitScreen(); destroy(); return false; }
    rounds++;
    const now = performance.now(), r = Math.random(), [lo, hi] = standRange(surf);
    // a trick now and then, rare enough to surprise: at most every 70 s, one chance in eight
    if (now - lastTrick > 70000 && Math.random() < 0.125) { lastTrick = now; if (await playTrick(api)) return true; }
    if (rounds % 8 === 0) return (await timed("bowl", 16000)) && timed("stretch", 1500);
    if (r < 0.2) return hopSomewhere();
    if (r < 0.5) {
      const tx = x - lo > (hi - lo) * 0.6 ? (Math.random() < 0.6 ? lo : rand(lo, hi)) : Math.random() < 0.5 ? hi : rand(lo, hi);
      return walkTo(tx);
    }
    if (r < 0.62) {
      // on the corner, the tail hanging over the void
      const left = x - lo < hi - x;
      if (!(await walkTo(left ? surf.left + 33 : surf.right - 33))) return false;
      face = left ? 1 : -1;
      return timed("edge", rand(7000, 12000));
    }
    if (r < 0.78) return (await timed("lie", rand(6000, 11000))) && timed("stretch", 1400);
    return timed("sit", rand(3500, 7000));
  }

  async function life() {
    const g = ++gen;
    while (g === gen && !dead) {
      const ok = await think();
      if (!ok && g !== gen) return;
    }
  }

  // ---- the body, one frame
  const falls = () => {
    fly = { x, y, vx: 0, vy: 0, ang: 0, w: 0, tail: 0, tailV: 0 };
    surf = null; bounces = 0;
    interrupt();
    setAct("fly");
  };
  let flySurfs: Surface[] = [], flySurfsAt = 0;

  function update(dt: number, now: number) {
    if (!["air", "fly", "hang", "gone"].includes(act)) {
      // standing: follow its box; no box under it (gone from the page, or a jump cut short): it falls
      const m = surf && measure(surf.el);
      if (!m) falls();
      else { surf = m; y = m.top; }
    }
    switch (act) {
      case "walk": {
        x = face > 0 ? Math.min(walkTarget, x + 64 * dt) : Math.max(walkTarget, x - 64 * dt);
        break;
      }
      case "air": {
        if (!arc) break;
        arc.t += dt;
        const p = arcAt(arc);
        x = p.x; y = p.y;
        break;
      }
      case "hang": {
        x += (hang.px - x) * Math.min(1, dt * 28);
        const ty = hang.py + 63;
        y += (ty - y) * Math.min(1, dt * 28);
        // a pendulum pushed by the hand's horizontal motion
        const s = samples.length > 1 ? samples[samples.length - 1].x - samples[samples.length - 2].x : 0;
        hang.swingV += (-90 * hang.swing - 7 * hang.swingV) * dt - s * 1.6;
        hang.swing = Math.max(-60, Math.min(60, hang.swing + hang.swingV * dt));
        break;
      }
      case "fly": {
        const b = fly!;
        const prevY = b.y;
        stepBody(b, dt);
        x = b.x; y = b.y;
        if (now - flySurfsAt > 250) { flySurfs = visibleSurfaces(200); flySurfsAt = now; }
        if (b.vy > 0) {
          for (const s of flySurfs) {
            if (prevY <= s.top && b.y >= s.top && b.x >= s.left + 6 && b.x <= s.right - 6) {
              const m = measure(s.el);
              if (!m) continue;
              if (b.vy > 1300 && bounces < 2) {
                b.y = m.top; b.vy *= -0.32; b.vx *= 0.6; b.w = -b.w * 0.5 + rand(-200, 200); bounces++;
              } else {
                impact = b.vy; landRot = b.ang % 360; if (landRot > 180) landRot -= 360; if (landRot < -180) landRot += 360;
                surf = m; y = m.top; x = Math.max(standRange(m)[0], Math.min(standRange(m)[1], b.x));
                fly = null;
                void afterLanding();
              }
              break;
            }
          }
        }
        if (fly && (b.x < scrollX - 160 || b.x > scrollX + innerWidth + 160 || b.y > scrollY + innerHeight + 200)) thrownAway(b.x < scrollX ? -1 : b.x > scrollX + innerWidth ? 1 : 0);
        break;
      }
    }
    if (pend && pend.done(now)) { const p = pend; pend = null; p.resolve(true); }
    for (const p of props) p.step(dt, now);
  }

  async function afterLanding() {
    const g = ++gen;
    setAct("land");
    await new Promise((r) => setTimeout(r, 170));
    if (g !== gen || dead) return;
    // a hard landing shakes it for a while; a gentle toss only for a moment
    const dizzy = impact > 900 ? rand(2200, 3200) : 900;
    setAct("dizzy");
    await new Promise((r) => setTimeout(r, dizzy));
    if (g !== gen || dead) return;
    void life();
  }

  function thrownAway(side: number) {
    fly = null;
    interrupt();
    setAct("gone");
    const mem = readMem();
    mem.n++; mem.at = Date.now();
    writeMem(mem);
    for (const p of props) p.home();
    if (opts.visitor) { setTimeout(destroy, 400); return; } // a visiting fox thrown out does not come back to this page
    // home: it comes back, later the more often it was thrown, a bit dizzy, and sulks if this keeps happening
    goneTimer = window.setTimeout(async () => {
      if (dead) return;
      const s = homeSurface() && isOnScreen(homeSurface()!) ? homeSurface()! : visibleSurfaces()[0] ?? homeSurface();
      if (!s) { goneTimer = window.setTimeout(() => thrownAway(side), 3000); return; }
      const [lo, hi] = standRange(s);
      const tx = side < 0 ? lo + 30 : side > 0 ? hi - 30 : (lo + hi) / 2;
      const g = ++gen;
      if (!(await enter(s, Math.max(lo, Math.min(hi, tx)), side || undefined)) || g !== gen) return;
      if (!(await timed("dizzy", 2600)) || g !== gen) return;
      if (mem.n >= 2) {
        face = -face; // its back to the reader
        if (!(await timed("sulk", 3000 + 1500 * Math.min(4, mem.n))) || g !== gen) return;
      }
      void life();
    }, 2600 + 1600 * Math.min(4, mem.n));
  }
  const isOnScreen = (s: Surface) => s.top - scrollY > 70 && s.top - scrollY < innerHeight - 20;

  function frameOf(now: number): Frame {
    const k = Math.floor((now - t0) / 240);
    switch (act) {
      case "sit": case "look": return reduced ? (Math.floor(now / 250) % 18 === 0 ? "blink" : "sitA") : k % 13 === 12 ? "blink" : act === "look" ? "sitA" : k % 4 < 2 ? "sitA" : "sitB";
      case "walk": return (["walk1", "walk2", "walk3", "walk2"] as Frame[])[Math.floor(now / 120) % 4];
      case "lie": case "sulk": return "lie";
      case "stretch": return "stretch";
      case "bowl": return "bowl";
      case "edge": return "edge";
      case "crouch": case "land": case "flip": return "crouch";
      case "air": return "leap";
      case "hang": return "hang";
      case "fly": return "fly";
      case "dizzy": return Math.floor(now / 300) % 2 ? "dizzyB" : "dizzyA";
      default: return "sitA";
    }
  }

  function render(now: number) {
    const f = frameOf(now);
    show(f);
    const e = now - t0;
    let rot = 0, sx = 1, sy = 1, py = 0, lift = 0;
    switch (act) {
      case "crouch": sx = 1.06; sy = 0.86; break;
      case "land": {
        const u = Math.min(1, e / 150);
        sx = 1.16 - 0.16 * u; sy = 0.8 + 0.2 * u; py = 20; rot = landRot * (1 - u);
        break;
      }
      case "air": {
        const p = arc ? arcAt(arc) : { tilt: 0, u: 0 };
        rot = p.tilt; py = 22;
        if (p.u < 0.15) { sx = 0.9; sy = 1.12; } // take-off stretch
        break;
      }
      case "hang": rot = hang.swing; py = FR.hang.h; break;
      case "fly": {
        const b = fly!;
        rot = b.ang; py = 22;
        [sx, sy] = squash(Math.hypot(b.vx, b.vy));
        tailEl.style.transform = `rotate(${b.tail.toFixed(1)}deg)`;
        break;
      }
      case "dizzy": rot = Math.sin(now / 130) * 5; break;
      case "flip": {
        const u = Math.min(1, e / 620), ease = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        lift = Math.sin(Math.PI * u) * 46; rot = -360 * ease; py = 22;
        break;
      }
    }
    el.style.transform = `translate3d(${(x - BOX / 2).toFixed(1)}px, ${(y - lift).toFixed(1)}px, 0)`;
    body.style.transform = `scaleX(${face}) translateY(${-py}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) translateY(${py}px)`;
    bubble.style.left = face > 0 ? "58px" : "14px";
    for (const p of props) p.render();
  }

  // ---- the loop: runs while the fox is on screen or anything moves
  function loop(now: number) {
    raf = 0;
    if (dead) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    update(dt, now);
    if (dead) return;
    attentionCheck(now);
    render(now);
    onScreen = y > scrollY - 80 && y - 80 < scrollY + innerHeight;
    const moving = !RESTING.has(act) || props.size > 0;
    if ((onScreen || moving) && act !== "gone" && !document.hidden) raf = requestAnimationFrame(loop);
    else last = 0;
  }
  function wake() { if (!raf && !dead && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); } }

  // ---- attention: the reader idle, or lingering on something
  function attentionCheck(now: number) {
    if (reduced || !surf || attention || props.size || act === "bowl" || act === "sulk" || act === "dizzy") return;
    const calm = act === "sit" || act === "lie" || act === "walk" || act === "edge";
    if (!calm) return;
    let found: { el: Element; px: number } | null = null;
    if (hoverEl && now - hoverSince > 2000 && hoverEl !== lastAttended && hoverEl.isConnected) found = { el: hoverEl, px: hoverX };
    else if (!idleHandled && now - lastActivity > 8000) {
      idleHandled = true;
      const mid = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).find((e) => !e.closest(".fox-layer"));
      const t = mid?.closest(SURF_SEL) ?? mid?.closest(ATTN_SEL);
      if (t && t !== lastAttended) found = { el: t, px: innerWidth / 2 };
    }
    if (found) { attention = found; void life(); }
  }
  const onActivity = () => { lastActivity = performance.now(); idleHandled = false; };
  const onMove = (e: PointerEvent) => {
    onActivity();
    if (e.pointerType !== "mouse") return;
    const t = (e.target as Element | null)?.closest?.(ATTN_SEL) ?? null;
    if (t && t.closest(".fox-layer")) return;
    if (t !== hoverEl) { hoverEl = t; hoverSince = performance.now(); }
    hoverX = e.clientX;
    if (t) wake();
  };

  // ---- grab and throw (mouse right away; touch after a 200 ms press, so a swipe still scrolls)
  let press: { id: number; x: number; y: number; timer: number; touch: boolean } | null = null, grabbed = false, suppressClick = false;
  const docPoint = (e: PointerEvent) => ({ x: e.clientX + scrollX, y: e.clientY + scrollY });
  const startGrab = (e: { clientX: number; clientY: number }) => {
    grabbed = true; suppressClick = true;
    interrupt();
    for (const p of props) p.home();
    surf = null; fly = null; arc = null;
    hang = { px: e.clientX + scrollX, py: e.clientY + scrollY, swing: 0, swingV: 0 };
    samples = [{ x: hang.px, y: hang.py, t: performance.now() }];
    setAct("hang");
  };
  el.addEventListener("pointerdown", (e) => {
    if (reduced || e.button > 0 || act === "gone") return;
    const touch = e.pointerType !== "mouse";
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: touch ? window.setTimeout(() => { if (press) { startGrab({ clientX: press.x, clientY: press.y }); navigator.vibrate?.(8); } }, 200) : 0 };
    if (!touch) el.setPointerCapture(e.pointerId);
  });
  // a held finger must not scroll the page; before the grab starts it scrolls as usual
  el.addEventListener("touchmove", (e) => { if (grabbed) e.preventDefault(); }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  const onPointerMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    if (!grabbed) {
      const d = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (press.touch) { if (d > 10) { clearTimeout(press.timer); press = null; } return; }
      if (d < 5) return;
      startGrab(e);
    }
    const p = docPoint(e);
    hang.px = p.x; hang.py = p.y;
    samples.push({ ...p, t: performance.now() });
    if (samples.length > 8) samples.shift();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    clearTimeout(press.timer);
    press = null;
    if (!grabbed) return;
    grabbed = false;
    // the release velocity: over the last ~80 ms of the drag
    const now = performance.now(), recent = samples.filter((s) => now - s.t < 90);
    const a = recent[0] ?? samples[0], b = samples[samples.length - 1];
    const span = Math.max(16, (b?.t ?? now) - (a?.t ?? now)) / 1000;
    const cap = (v: number) => Math.max(-4200, Math.min(4200, v));
    const vx = a && b && recent.length > 1 ? cap((b.x - a.x) / span) : 0, vy = a && b && recent.length > 1 ? cap((b.y - a.y) / span) : 0;
    face = vx > 40 ? 1 : vx < -40 ? -1 : face;
    fly = { x, y: y - 63 + 45, vx, vy, ang: hang.swing, w: vx * 0.3 * face + rand(-120, 120), tail: 0, tailV: 0 };
    bounces = 0; flySurfsAt = 0;
    setAct("fly");
  };
  addEventListener("pointermove", onPointerMove, { passive: true });
  addEventListener("pointerup", onPointerUp);
  addEventListener("pointercancel", (e) => { if (press && e.pointerId === press.id) { clearTimeout(press.timer); press = null; if (grabbed) onPointerUp(e); } });

  // a click (or Enter, Space): wakes it, or it does a little back-flip
  el.addEventListener("click", () => {
    if (suppressClick) { suppressClick = false; return; }
    if (reduced || !surf) return;
    if (act === "bowl") { const g = ++gen; void timed("stretch", 1200).then((ok) => { if (ok && g === gen) void life(); }); return; }
    if (!RESTING.has(act) && act !== "walk") return;
    const g = ++gen;
    void timed("flip", 620).then(async (ok) => { if (ok && g === gen && (await timed("sit", 1200)) && g === gen) void life(); });
  });

  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerdown", onActivity, { passive: true });
  addEventListener("keydown", onActivity, { passive: true });
  addEventListener("scroll", onActivity, { passive: true });
  addEventListener("scroll", wake, { passive: true });
  addEventListener("resize", wake, { passive: true });
  const onVis = () => { if (!document.hidden) wake(); };
  document.addEventListener("visibilitychange", onVis);

  function destroy() {
    if (dead) return;
    dead = true;
    interrupt();
    cancelAnimationFrame(raf);
    clearTimeout(goneTimer);
    for (const p of [...props]) p.restore();
    removeEventListener("pointermove", onPointerMove);
    removeEventListener("pointerup", onPointerUp);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onActivity);
    removeEventListener("keydown", onActivity);
    removeEventListener("scroll", onActivity);
    removeEventListener("scroll", wake);
    removeEventListener("resize", wake);
    document.removeEventListener("visibilitychange", onVis);
    el.remove();
    if (current?.destroy === destroy) current = null;
  }

  // ---- start
  async function start() {
    // the note of the day fills in after the page renders: wait for its box to have a size
    let home = homeSurface();
    for (let i = 0; opts.home && !home && i < 40 && !dead; i++) { await new Promise((r) => setTimeout(r, 150)); home = homeSurface(); }
    if (dead) return;
    if (opts.home && !home) return destroy();
    if (home) {
      surf = home; y = home.top; x = home.left + 67; face = 1;
      setAct("sit");
      if (reduced) return; // sits and blinks
      const mem = readMem();
      if (Date.now() - mem.at < 120000 && mem.n >= 2) { face = -1; await timed("sulk", 6000); } // still cross about the last throw
      void life();
      return;
    }
    // a visit: in from a screen edge onto a box on screen, a while after the page settles
    setAct("gone");
    await new Promise((r) => setTimeout(r, rand(1500, 4000)));
    if (dead) return;
    const pool = visibleSurfaces().filter((s) => s.top - scrollY < innerHeight * 0.8);
    const s = pool[Math.floor(Math.random() * pool.length)];
    if (!s) return destroy();
    const [lo, hi] = standRange(s);
    const side = Math.random() < 0.5 ? -1 : 1;
    const g = ++gen;
    if ((await enter(s, side < 0 ? lo + rand(20, 120) : hi - rand(20, 120), side)) && g === gen) void life();
  }
  void start();
  // a debugging hook in development: __fox.trick(), __fox.hop()
  if (import.meta.env.DEV) (window as unknown as { __fox: unknown }).__fox = { trick: async () => { const g = ++gen; if ((await playTrick(api)) && g === gen) void life(); }, hop: () => { const g = ++gen; void hopSomewhere().then(() => { if (g === gen) void life(); }); }, state: () => ({ act, x, y, surf: surf?.el, fly, hang, samples: samples.length }) };
  return { destroy };
}

/** The homepage fox: lives on the note of the day (the box under `perch`). */
export function mountFox(perch: HTMLElement) {
  current?.destroy();
  const home = perch.parentElement?.querySelector(".ed") ?? perch.parentElement ?? perch;
  const fox = createFox({ home });
  current = fox;
  return fox.destroy;
}

/** Called on every page change: the fox of the previous page goes. */
export function foxLeave() { current?.destroy(); }

/** After another page has rendered: one page view in four, the fox drops by, unless it was thrown out lately. */
export function foxVisit() {
  if (current || reducedMotion()) return;
  const mem = readMem();
  if (Date.now() - mem.at < 45000 * Math.min(4, mem.n)) return; // still sulking
  if (Math.random() >= 0.25) return;
  current = createFox({ visitor: true });
}
