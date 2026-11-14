// The homepage hero's background: an ocean of pixels, one per inhabitant of France. The grid is virtual
// (8,314 × 8,314 ≈ 69.1 million cells) and drawn by a fragment shader, so nothing is stored: every cell's colour comes
// from a hash of its position, and the screen shows a window onto it with the true proportion (about 71 % in colour).
// Registered voters take the flag's three colours; everyone else (minors, foreign residents, adults not on the rolls)
// is grey. Nothing moves across the screen: each pixel flickers softly on its own rhythm, and now and then fades to
// blue and back. The ocean fades out toward the bottom of the band and around the chart (no pixels behind it).
// One pixel glows bright white: the reader. Over it (pointer, focus or tap) the pixels around it are pushed aside to make room,
// crowd an uneven edge and keep pressing back, and "your vote matters" appears in the space. Touch screens
// only get the glow. Still frame under reduced motion (the circle opens without the slide), paused off
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
uniform vec2 uMe; uniform float uOpen; uniform float uR; uniform float uDpr; uniform vec4 uMask; uniform vec4 uMask2;
// a cell's identity, hashed in two small parts so precision never smears neighbours together
float h1(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float hash(vec2 c){ vec2 lo = mod(c, 64.0), hi = floor(c / 64.0); return fract(h1(lo + 0.5) + h1(hi * 1.37 + 7.0) * 1.618); }
const vec3 BLUE = vec3(0.36, 0.5, 1.0);
const vec3 GOLD = vec3(1.0, 1.0, 1.0); // the reader's pixel: plain bright white
vec2 meC; float L;
// the room the pixels leave around the reader's: an uneven edge that slowly breathes, never a perfect circle
float holeAt(float th){ return uR * uOpen * (1.0 + 0.07 * sin(3.0 * th + uT * 0.45) + 0.045 * sin(5.0 * th - uT * 0.7 + 1.3) + 0.03 * sin(8.0 * th + uT * 1.1)); }
// where a pixel sits once pushed: each one moves whole (no stretching); the nearest ones go furthest and crowd the
// edge, where they keep pressing back toward the reader, get pushed out again, and slide slowly along it
vec2 pushed(vec2 c, float h){
  vec2 d = c - meC; float s = length(d);
  if (uOpen < 0.001 || s >= L) return c;
  float th = atan(d.y, d.x);
  float u = 1.0 - s / L, edge = u * u;
  float r = s + holeAt(th) * edge;
  float press = pow(max(0.0, sin(uT * (0.55 + h * 0.6) + h * 6.2832)), 4.0);
  r -= edge * edge * uOpen * uCell * 1.4 * press;
  th += uOpen * edge * 0.06 * sin(uT * 0.22 + h * 1.7);
  return meC + r * vec2(cos(th), sin(th));
}
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 meCell = floor(uMe / uCell);
  meC = (meCell + 0.5) * uCell;
  L = uR * 2.8;
  // the reader's own pixel never moves
  vec2 fc = floor(frag / uCell); vec2 fin = frag - fc * uCell;
  if (fc == meCell && fin.x < uCell - uDpr && fin.y < uCell - uDpr) { gl_FragColor = vec4(GOLD, 1.0); return; }
  vec2 d = frag - meC;
  float r = length(d);
  vec2 cell = fc; bool hit = fin.x < uCell - uDpr && fin.y < uCell - uDpr;
  if (uOpen > 0.001 && r < L + 3.0 * uCell) {
    // which pixel landed here: start from a guess (the push undone along this direction), then look around it
    float H = holeAt(atan(d.y, d.x));
    float s = r;
    if (H > 0.0 && r < L) { float u = (L - sqrt(max(0.0, L * L - 4.0 * H * (L - r)))) / (2.0 * H); s = max(0.0, L * (1.0 - u)); }
    vec2 g = floor((meC + d / max(r, 0.001) * s) / uCell);
    hit = false; float best = 1e9;
    for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
      vec2 cc = g + vec2(float(i), float(j));
      if (cc == meCell) continue;
      vec2 p = pushed((cc + 0.5) * uCell, hash(mod(cc + uOff, uSide) + 5.0));
      vec2 lp = frag - (p - 0.5 * uCell);
      if (lp.x >= 0.0 && lp.y >= 0.0 && lp.x < uCell - uDpr && lp.y < uCell - uDpr) {
        float dd = dot(frag - p, frag - p);
        if (dd < best) { best = dd; cell = cc; hit = true; }
      }
    }
  }
  vec2 uv = frag / uRes;
  float dMe = r / uDpr;                             // CSS px from the reader's pixel
  // no pixels behind the chart or the seats animation: they fade out over a soft edge around each box (CSS px)
  vec2 q = max(uMask.xy - frag, frag - uMask.zw) / uDpr;
  vec2 q2 = max(uMask2.xy - frag, frag - uMask2.zw) / uDpr;
  float outside = min(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0), length(max(q2, 0.0)) + min(max(q2.x, q2.y), 0.0));
  float clear = smoothstep(0.0, 56.0, outside);
  // and they thin out toward the bottom of the band instead of stopping at its edge
  float bottom = 1.0 - smoothstep(0.55, 0.97, uv.y);

  vec3 col = vec3(0.0); float a = 0.0;
  if (hit && cell != meCell) {
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
  // the reader's pixel glows a little, between the pixels too (only while the room is closed)
  float glow = exp(-(dMe * dMe) / (2.0 * 7.0 * 7.0)) * (0.32 + 0.08 * sin(uT * 2.2)) * (1.0 - uOpen);
  vec3 outc = col * min(a, 1.0) + GOLD * glow;
  float outa = min(1.0, min(a, 1.0) + glow);
  gl_FragColor = vec4(outc, outa);
}`;

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
  const U = { res: u("uRes"), t: u("uT"), cell: u("uCell"), off: u("uOff"), share: u("uShare"), side: u("uSide"), me: u("uMe"), open: u("uOpen"), r: u("uR"), dpr: u("uDpr"), mask: u("uMask"), mask2: u("uMask2") };
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
  say.innerHTML = `<i aria-hidden="true"></i><p><b>${L("Votre voix compte", "Your vote matters")}</b></p>`;
  host.classList.add("has-ocean");
  host.prepend(canvas);
  // the room and the message are for a mouse (and the keyboard); on touch screens the pixel only glows
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (canHover) host.append(me, say);
  const chart = host.querySelector<HTMLElement>(".hday-chart");
  const art = host.querySelector<HTMLElement>(".hday-art"), intro = host.querySelector<HTMLElement>(".hday-intro");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dpr = 1, meX = 0, meY = 0, R = 120, raf = 0, visible = true, pinned = false, hover = false;
  let open = 0, openTarget = 0;
  let mask = [0, 0, 0, 0], mask2 = [-9, -9, -9, -9];
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
    gl.uniform4f(U.mask2, mask2[0] * dpr, mask2[1] * dpr, mask2[2] * dpr, mask2[3] * dpr);
    say.style.opacity = e.toFixed(3);
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
    // pixels pushed past the top of the band or behind the chart simply aren't drawn, so the room can be wider than
    // the space; the message's own solid centre (four fifths of it) stays above the chart and below the masthead
    R = Math.max(90, Math.min(wide ? 120 : 104, (room - 6) / 1.6));
    meX = Math.floor(Math.min(r.width * (wide ? 0.8 : 0.84), r.width - R * 0.8 - 6) / CELL) * CELL;
    meY = Math.floor((R * 0.8 + 3) / CELL) * CELL;
    // an easter egg: the reader's pixel hides to the right of the map of France, in the margin when there is one
    if (art && wide) {
      const ab = art.getBoundingClientRect();
      R = 84;
      const right = ab.right - r.left, margin = r.width - right;
      meX = Math.floor((margin > 2 * R * 0.8 ? right + margin / 2 : r.width - R * 0.8 - 6) / CELL) * CELL;
      meY = Math.floor((ab.top - r.top + ab.height * 0.42) / CELL) * CELL;
    }
    void intro;
    for (const el of [me, say]) { el.style.left = `${meX + CELL / 2}px`; el.style.top = `${meY + CELL / 2}px`; }
    say.style.setProperty("--r", `${R}px`);
    if (chart) {
      const c = chart.getBoundingClientRect();
      mask = [c.left - r.left, c.top - r.top, c.right - r.left, c.bottom - r.top];
    }
    mask2 = [-9, -9, -9, -9]; // the animation sits on the pixels; only the chart keeps them out
    frame(performance.now());
    kick();
  };

  // over the pixel the ocean parts; it closes again once the pointer leaves the circle
  const show = (on: boolean) => { openTarget = on ? 1 : 0; say.classList.toggle("is-on", on); kick(); };
  host.addEventListener("pointermove", (e) => {
    if (!canHover || e.pointerType === "touch" || pinned) return;
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
  if (art) ro.observe(art);
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
  io.observe(host);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  place();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
}
