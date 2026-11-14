// The homepage hero's background: an ocean of pixels, one per inhabitant of France. The grid is virtual
// (8,314 × 8,314 ≈ 69.1 million cells) and drawn by a fragment shader, so nothing is stored: every cell's colour comes
// from a hash of its position, and the screen shows a window onto it with the true proportion (about 71 % in colour).
// Registered voters take the flag's three colours; everyone else (minors, foreign residents, adults not on the rolls)
// is grey. Nothing moves across the screen: each pixel flickers softly on its own rhythm, and now and then fades to
// blue and back. The ocean fades out toward the bottom of the band and around the chart (no pixels behind it).
// One pixel glows gold: the reader. Over it (pointer, focus or tap) the pixels around it part and leave an empty
// circle with a short message. Still frame under reduced motion (the circle opens without the slide), paused off
// screen; no WebGL → the plain grid.
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
uniform vec2 uMe; uniform float uOpen; uniform float uR; uniform float uDpr; uniform vec4 uMask;
// a cell's identity, hashed in two small parts so precision never smears neighbours together
float h1(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float hash(vec2 c){ vec2 lo = mod(c, 64.0), hi = floor(c / 64.0); return fract(h1(lo + 0.5) + h1(hi * 1.37 + 7.0) * 1.618); }
const vec3 BLUE = vec3(0.36, 0.5, 1.0);
const vec3 GOLD = vec3(1.0, 0.84, 0.36);
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 meCell = floor(uMe / uCell);
  vec2 meC = (meCell + 0.5) * uCell;
  // the parting: the pixels within reach slide outward, packed into a ring, and leave an empty circle of radius
  // uR * uOpen; each fragment looks up where its pixel came from
  vec2 d = frag - meC;
  float r = length(d);
  float hole = uR * uOpen;
  float reach = uR * 2.2;
  // the reader's own pixel never moves
  vec2 fc = floor(frag / uCell); vec2 fin = frag - fc * uCell;
  if (fc == meCell && fin.x < uCell - uDpr && fin.y < uCell - uDpr) { gl_FragColor = vec4(GOLD, 1.0); return; }
  if (uOpen > 0.001 && r < hole) { gl_FragColor = vec4(0.0); return; }
  vec2 src = frag;
  if (uOpen > 0.001 && r < reach) src = meC + d / max(r, 0.001) * (reach * (r - hole) / (reach - hole));
  vec2 cell = floor(src / uCell);
  vec2 inCell = src - cell * uCell;
  bool gap = inCell.x >= uCell - uDpr || inCell.y >= uCell - uDpr;
  vec2 uv = frag / uRes;
  float dMe = length(frag - meC) / uDpr;           // CSS px from the reader's pixel
  // no pixels behind the chart: they fade out over a soft edge around its box (CSS px)
  vec2 q = max(uMask.xy - frag, frag - uMask.zw) / uDpr;
  float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float clear = smoothstep(0.0, 56.0, outside);
  // and they thin out toward the bottom of the band instead of stopping at its edge
  float bottom = 1.0 - smoothstep(0.55, 0.97, uv.y);

  vec3 col = vec3(0.0); float a = 0.0;
  if (!gap) {
    if (cell == meCell) {
      a = 0.0; // pushed out of its place by the parting: the real one is drawn above
    } else {
      vec2 c = mod(cell + uOff, uSide);
      float r1 = hash(c), r2 = hash(c + 17.0), r3 = hash(c + 41.0), r4 = hash(c + 83.0);
      vec3 base = vec3(0.37, 0.38, 0.44); float k = 0.55;
      if (r1 < uShare) { base = r2 < 0.34 ? BLUE : (r2 < 0.67 ? vec3(0.93, 0.93, 0.97) : vec3(1.0, 0.37, 0.44)); k = 1.0; }
      // a soft flicker, each pixel on its own rhythm
      float f = 0.5 + 0.5 * sin(uT * (0.35 + r3 * 0.9) + r4 * 6.2832);
      // now and then a pixel drifts to blue and back
      float toBlue = smoothstep(0.82, 1.0, sin(uT * (0.08 + r4 * 0.12) + r3 * 6.2832));
      col = mix(base, BLUE, toBlue * 0.85);
      float vis = (0.3 + 0.7 * smoothstep(0.1, 0.75, uv.x)) * clear * bottom;
      a = (0.05 + 0.24 * (0.35 + 0.65 * f) * (0.6 + 0.4 * r2)) * k * vis;
    }
  }
  // the reader's pixel glows a little, between the pixels too (only while the circle is closed)
  float glow = exp(-(dMe * dMe) / (2.0 * 7.0 * 7.0)) * (0.32 + 0.08 * sin(uT * 2.2)) * (1.0 - uOpen);
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
  const U = { res: u("uRes"), t: u("uT"), cell: u("uCell"), off: u("uOff"), share: u("uShare"), side: u("uSide"), me: u("uMe"), open: u("uOpen"), r: u("uR"), dpr: u("uDpr"), mask: u("uMask") };
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
  // the empty circle the pixels leave, in the band's own colour, with the message
  const say = document.createElement("div");
  say.className = "ocean-say";
  say.id = "ocean-say";
  say.innerHTML = `<i aria-hidden="true"></i>${L(
    `<p><b>Votre voix compte</b></p><p class="by">Un pixel parmi ${fmtM(POPULATION)} millions</p>`,
    `<p><b>“Someone struggled for your right to vote. Use it.”</b></p><p class="by">Susan B. Anthony</p>`,
  )}`;
  host.classList.add("has-ocean");
  host.prepend(canvas);
  host.append(me, say);
  const chart = host.querySelector<HTMLElement>(".hday-chart");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dpr = 1, meX = 0, meY = 0, R = 120, raf = 0, visible = true, pinned = false, hover = false;
  let open = 0, openTarget = 0;
  let mask = [0, 0, 0, 0];
  const t0 = performance.now();

  let last = performance.now();
  const frame = (now: number) => {
    // the circle opens in about half a second and closes a little faster, whatever the frame rate
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    open = reduced ? openTarget : openTarget > open ? Math.min(openTarget, open + dt / 0.55) : Math.max(openTarget, open - dt / 0.4);
    // ease in and out: the pixels start gently, slide, and settle
    const e = open < 0.5 ? 4 * open ** 3 : 1 - (-2 * open + 2) ** 3 / 2;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.t, reduced ? 0 : (now - t0) / 1000);
    gl.uniform1f(U.cell, CELL * dpr);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform2f(U.me, meX * dpr, meY * dpr);
    gl.uniform1f(U.open, e);
    gl.uniform1f(U.r, R * dpr);
    gl.uniform4f(U.mask, mask[0] * dpr, mask[1] * dpr, mask[2] * dpr, mask[3] * dpr);
    say.style.clipPath = `circle(${(R * e).toFixed(1)}px)`;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  // the loop runs while there is something to animate: always (flicker), or under reduced motion only while the circle eases
  const settling = () => open !== openTarget;
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
    const wide = r.width > 760;
    // the circle fits the open space above the chart, at the right of the headline; snapped to the grid
    const room = chart ? chart.getBoundingClientRect().top - r.top : 200;
    R = Math.max(84, Math.min(wide ? 112 : 96, (room - 6) / 2));
    meX = Math.floor(Math.min(r.width * (wide ? 0.8 : 0.84), r.width - R - 6) / CELL) * CELL;
    meY = Math.floor((R + 3) / CELL) * CELL;
    for (const el of [me, say]) { el.style.left = `${meX + CELL / 2}px`; el.style.top = `${meY + CELL / 2}px`; }
    say.style.setProperty("--r", `${R}px`);
    if (chart) {
      const c = chart.getBoundingClientRect();
      mask = [c.left - r.left, c.top - r.top, c.right - r.left, c.bottom - r.top];
    }
    frame(performance.now());
    kick();
  };

  // over the pixel the ocean parts; it closes again once the pointer leaves the circle
  const show = (on: boolean) => { openTarget = on ? 1 : 0; say.classList.toggle("is-on", on); kick(); };
  host.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || pinned) return;
    const r = host.getBoundingClientRect();
    const d = Math.hypot(e.clientX - r.left - meX, e.clientY - r.top - meY);
    const on = hover ? d < R + 8 : d < 14;
    if (on !== hover) { hover = on; show(on); }
  });
  host.addEventListener("pointerleave", () => { if (!pinned && hover) { hover = false; show(false); } });
  me.addEventListener("click", () => { pinned = !pinned; hover = false; show(pinned); });
  me.addEventListener("focus", () => show(true));
  me.addEventListener("blur", () => { pinned = false; show(false); });
  me.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = false; show(false); } });

  const ro = new ResizeObserver(place);
  ro.observe(host);
  if (chart) ro.observe(chart);
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
  io.observe(host);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  place();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
}
