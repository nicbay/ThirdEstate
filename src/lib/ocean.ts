// The homepage hero's background: an ocean of pixels, one per inhabitant of France. The grid is virtual
// (8,314 × 8,314 ≈ 69.1 million cells) and drawn by a fragment shader, so nothing is stored: every cell's colour comes
// from a hash of its position, and the screen shows a window onto it with the true proportion (about 71 % in colour).
// Registered voters take the flag's three colours; everyone else (minors, foreign residents, adults not on the rolls)
// is grey. Nothing moves across the screen: each pixel flickers softly on its own rhythm, and now and then fades to
// blue and back. A soft halo follows the pointer. One pixel glows gold: the reader. Near it (pointer, focus or tap) it
// blooms into a wide soft halo and says "your vote matters". Still frame under reduced motion (the halos still answer
// the pointer), paused off screen; no WebGL → the plain grid.
import { L } from "../i18n";

/** INSEE, population on 1 January 2026 (public/data/economy.json). */
const POPULATION = 69_112_309;
/** Registered voters, 2024 legislative election, first round (public/data/results/legislatives-2024-t1.json). */
const REGISTERED = 49_332_761;
const SIDE = Math.ceil(Math.sqrt(POPULATION)); // 8,314
const CELL = 4; // CSS px per inhabitant

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uT; uniform float uCell; uniform vec2 uOff; uniform float uShare; uniform float uSide;
uniform vec2 uMe; uniform float uNear; uniform vec2 uPtr; uniform float uPtrOn; uniform float uDpr;
// a cell's identity, hashed in two small parts so precision never smears neighbours together
float h1(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float hash(vec2 c){ vec2 lo = mod(c, 64.0), hi = floor(c / 64.0); return fract(h1(lo + 0.5) + h1(hi * 1.37 + 7.0) * 1.618); }
const vec3 BLUE = vec3(0.36, 0.5, 1.0);
const vec3 GOLD = vec3(1.0, 0.84, 0.36);
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor(frag / uCell);
  vec2 inCell = frag - cell * uCell;
  bool gap = inCell.x >= uCell - uDpr || inCell.y >= uCell - uDpr;
  vec2 uv = frag / uRes;
  vec2 meCell = floor(uMe / uCell);
  vec2 meC = (meCell + 0.5) * uCell;
  float dMe = length(frag - meC) / uDpr;           // CSS px from the reader's pixel
  float dPtr = length(frag - uPtr) / uDpr;         // CSS px from the pointer
  float halo = uPtrOn * exp(-(dPtr * dPtr) / (2.0 * 70.0 * 70.0));
  float bloomR = mix(10.0, 46.0, uNear);
  float bloom = exp(-(dMe * dMe) / (2.0 * bloomR * bloomR)) * mix(0.35, 0.9, uNear);

  vec3 col = vec3(0.0); float a = 0.0;
  if (!gap) {
    if (cell == meCell) {
      col = GOLD; a = 0.85 + 0.15 * sin(uT * 2.2) + 0.15 * uNear;
    } else {
      vec2 c = mod(cell + uOff, uSide);
      float r = hash(c), r2 = hash(c + 17.0), r3 = hash(c + 41.0), r4 = hash(c + 83.0);
      vec3 base = vec3(0.37, 0.38, 0.44); float k = 0.55;
      if (r < uShare) { base = r2 < 0.34 ? BLUE : (r2 < 0.67 ? vec3(0.93, 0.93, 0.97) : vec3(1.0, 0.37, 0.44)); k = 1.0; }
      // a soft flicker, each pixel on its own rhythm
      float f = 0.5 + 0.5 * sin(uT * (0.35 + r3 * 0.9) + r4 * 6.2832);
      // now and then a pixel drifts to blue and back
      float toBlue = smoothstep(0.82, 1.0, sin(uT * (0.08 + r4 * 0.12) + r3 * 6.2832));
      col = mix(base, BLUE, toBlue * 0.85);
      float vis = (0.3 + 0.7 * smoothstep(0.1, 0.75, uv.x)) * (1.0 - 0.72 * smoothstep(0.3, 0.7, uv.y));
      a = (0.05 + 0.24 * (0.35 + 0.65 * f) * (0.6 + 0.4 * r2)) * k * vis;
      // the halos: the pointer's lights its neighbours softly, the reader's warms them
      a += halo * 0.45 * k + bloom * 0.5 * k;
      col = mix(col, GOLD, bloom * 0.55);
    }
  }
  // the bloom also glows between pixels, so the reader's pixel looks lit from within
  float glow = bloom * 0.22;
  vec3 outc = col * min(a, 1.0) + GOLD * glow;
  float outa = min(1.0, min(a, 1.0) + glow);
  gl_FragColor = vec4(outc, outa);
}`;

const fmtM = (n: number) => (n / 1e6).toLocaleString(L("fr-FR", "en-GB"), { maximumFractionDigits: 1 });

/** Paints the ocean behind `host` (a positioned, overflow-hidden band). Returns a cleanup function. */
export function mountOcean(host: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.className = "ocean";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return () => {};
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u("uRes"), t: u("uT"), cell: u("uCell"), off: u("uOff"), share: u("uShare"), side: u("uSide"), me: u("uMe"), near: u("uNear"), ptr: u("uPtr"), ptrOn: u("uPtrOn"), dpr: u("uDpr") };
  gl.uniform1f(U.share, REGISTERED / POPULATION);
  gl.uniform1f(U.side, SIDE);
  // which window onto the 69 million this visit shows
  gl.uniform2f(U.off, Math.floor(Math.random() * SIDE), Math.floor(Math.random() * SIDE));

  // the reader's pixel: a real button (keyboard and touch can reach it), sitting on the glowing cell
  const me = document.createElement("button");
  me.type = "button";
  me.className = "ocean-me";
  me.setAttribute("aria-describedby", "ocean-say");
  me.setAttribute("aria-label", L("Ce pixel, c’est vous", "This pixel is you"));
  const say = document.createElement("p");
  say.className = "ocean-say";
  say.id = "ocean-say";
  say.innerHTML = `<b>${L("Votre voix compte", "Your vote matters")}</b><span>${L(`Un pixel parmi ${fmtM(POPULATION)} millions d’habitants. En couleur, les ${fmtM(REGISTERED)} millions d’inscrits sur les listes.`, `One pixel among ${fmtM(POPULATION)} million people. In colour, the ${fmtM(REGISTERED)} million on the electoral rolls.`)}</span>`;
  host.classList.add("has-ocean");
  host.prepend(canvas);
  host.append(me, say);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dpr = 1, meX = 0, meY = 0, raf = 0, visible = true, pinned = false;
  let near = 0, nearTarget = 0, ptrOn = 0, ptrTarget = 0, px = -9999, py = -9999;
  const t0 = performance.now();

  const frame = (now: number) => {
    near += (nearTarget - near) * 0.08;
    ptrOn += (ptrTarget - ptrOn) * 0.1;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.t, reduced ? 0 : (now - t0) / 1000);
    gl.uniform1f(U.cell, CELL * dpr);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform2f(U.me, meX * dpr, meY * dpr);
    gl.uniform1f(U.near, near);
    gl.uniform2f(U.ptr, px * dpr, py * dpr);
    gl.uniform1f(U.ptrOn, ptrOn);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  // the loop runs while there is something to animate: always (flicker), or under reduced motion only while a halo eases
  const settling = () => Math.abs(nearTarget - near) > 0.01 || Math.abs(ptrTarget - ptrOn) > 0.01;
  const loop = (now: number) => {
    raf = 0;
    if (!visible || document.hidden || !document.body.contains(host)) return;
    frame(now);
    if (!reduced || settling()) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  const place = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // in the open space at the top right on wide screens, by the headline on phones; snapped to the grid
    meX = Math.floor((r.width * (r.width > 760 ? 0.86 : 0.88)) / CELL) * CELL;
    meY = Math.floor(Math.min(r.height * 0.16, r.width > 760 ? 150 : 120) / CELL) * CELL;
    for (const el of [me, say]) { el.style.left = `${meX + CELL / 2}px`; el.style.top = `${meY + CELL / 2}px`; }
    say.classList.toggle("is-left", meX > r.width - 260);
    frame(performance.now());
    kick();
  };

  // near the pixel it blooms and speaks; anywhere over the band the pointer carries its own soft halo
  const show = (on: boolean) => { nearTarget = on ? 1 : 0; say.classList.toggle("is-on", on); kick(); };
  host.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect();
    px = e.clientX - r.left; py = e.clientY - r.top;
    ptrTarget = 1;
    if (e.pointerType !== "touch" && !pinned) show(Math.hypot(px - meX, py - meY) < 90);
    kick();
  });
  host.addEventListener("pointerleave", () => { ptrTarget = 0; if (!pinned) show(false); kick(); });
  me.addEventListener("click", () => { pinned = !pinned; show(pinned); });
  me.addEventListener("focus", () => show(true));
  me.addEventListener("blur", () => { pinned = false; show(false); });
  me.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = false; show(false); } });

  const ro = new ResizeObserver(place);
  ro.observe(host);
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
  io.observe(host);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  place();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
}
