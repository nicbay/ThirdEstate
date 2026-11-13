// The homepage hero's background: an ocean of pixels, one per inhabitant of France. The grid is virtual
// (8,314 × 8,314 ≈ 69.1 million cells) and drawn by a fragment shader, so nothing is stored: every cell's colour comes
// from a hash of its position. Registered voters take the flag's three colours; everyone else (minors, foreign
// residents, adults not on the rolls) is grey. The ocean swells in four brightness steps and drifts one cell at a
// time. One cell stays put and glows: the reader. Bring the pointer near it (or focus it, or tap it) and it says
// "your vote matters". Off under reduced motion (one still frame), paused off screen; no WebGL → the plain grid.
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
uniform vec2 uRes; uniform float uT; uniform float uCell; uniform vec2 uOff; uniform float uShare; uniform vec2 uMe; uniform float uNear; uniform float uSide;
// a cell's identity, hashed in two small parts so precision never smears neighbours together
float h1(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float hash(vec2 c){ vec2 lo = mod(c, 64.0), hi = floor(c / 64.0); return fract(h1(lo + 0.5) + h1(hi * 1.37 + 7.0) * 1.618); }
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor(frag / uCell);
  vec2 inCell = frag - cell * uCell;
  if (inCell.x >= uCell - 1.0 || inCell.y >= uCell - 1.0) { gl_FragColor = vec4(0.0); return; }
  vec2 me = floor(uMe / uCell);
  if (cell == me) {
    float a = 0.8 + 0.2 * sin(uT * 3.0) + 0.2 * uNear;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.32) * min(a, 1.0), min(a, 1.0));
    return;
  }
  vec2 c = mod(cell + uOff, uSide);
  float r = hash(c), r2 = hash(c + 17.0);
  float w = sin(c.x * 0.045 + uT * 0.6) + sin(c.y * 0.06 - uT * 0.45) + sin((c.x + c.y) * 0.02 + uT * 0.3);
  float lvl = floor(clamp(0.5 + w * 0.17 + (r2 - 0.5) * 0.45, 0.0, 0.999) * 4.0) / 3.0;
  vec3 col = vec3(0.36, 0.37, 0.43);
  float k = 0.55;
  if (r < uShare) { col = r2 < 0.34 ? vec3(0.36, 0.48, 1.0) : (r2 < 0.67 ? vec3(0.93, 0.93, 0.97) : vec3(1.0, 0.36, 0.43)); k = 1.0; }
  vec2 uv = frag / uRes;
  float vis = (0.3 + 0.7 * smoothstep(0.1, 0.75, uv.x)) * (1.0 - 0.72 * smoothstep(0.3, 0.7, uv.y));
  float d = length(cell - me);
  float halo = uNear * 0.35 * (1.0 - smoothstep(0.0, 9.0, d));
  float a = (mix(0.04, 0.3, lvl) * k * vis) + halo * k;
  gl_FragColor = vec4(col * a, a);
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
  const U = { res: u("uRes"), t: u("uT"), cell: u("uCell"), off: u("uOff"), share: u("uShare"), me: u("uMe"), near: u("uNear"), side: u("uSide") };
  gl.uniform1f(U.share, REGISTERED / POPULATION);
  gl.uniform1f(U.side, SIDE);

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
  let dpr = 1, w = 0, h = 0, meX = 0, meY = 0, near = 0, nearTarget = 0, raf = 0, visible = true, pinned = false;
  const off = [Math.floor(Math.random() * SIDE), Math.floor(Math.random() * SIDE)];
  const t0 = performance.now();
  let lastStep = t0;

  const place = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // in the open space at the top right on wide screens, by the headline on phones; snapped to the grid
    meX = Math.floor((w * (w > 760 ? 0.86 : 0.88)) / CELL) * CELL;
    meY = Math.floor(Math.min(h * 0.16, w > 760 ? 150 : 120) / CELL) * CELL;
    me.style.left = `${meX + CELL / 2}px`; me.style.top = `${meY + CELL / 2}px`;
    say.style.left = `${meX + CELL / 2}px`; say.style.top = `${meY + CELL / 2}px`;
    say.classList.toggle("is-left", meX > w - 260);
    if (reduced || !raf) frame(performance.now());
  };
  const frame = (now: number) => {
    // the ocean drifts one cell at a time (pixel motion), its swell moves continuously in four steps
    if (!reduced && now - lastStep > 520) { off[0] += 1; if (Math.random() < 0.35) off[1] += 1; lastStep = now; }
    near += (nearTarget - near) * 0.15;
    const t = reduced ? 0 : (now - t0) / 1000;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.t, t);
    gl.uniform1f(U.cell, CELL * dpr);
    gl.uniform2f(U.off, off[0] % SIDE, off[1] % SIDE);
    gl.uniform2f(U.me, meX * dpr, meY * dpr);
    gl.uniform1f(U.near, near);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const loop = (now: number) => {
    raf = 0;
    if (!visible || document.hidden || !document.body.contains(host)) return;
    frame(now);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!reduced && !raf) raf = requestAnimationFrame(loop); };

  // close to the pixel: it brightens, the ocean around it lights up, the message appears
  const show = (on: boolean) => {
    nearTarget = on ? 1 : 0;
    say.classList.toggle("is-on", on);
    if (reduced) { near = nearTarget; frame(performance.now()); }
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" || pinned) return;
    const r = host.getBoundingClientRect();
    const d = Math.hypot(e.clientX - r.left - meX, e.clientY - r.top - meY);
    show(d < 90);
  };
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", () => { if (!pinned) show(false); });
  me.addEventListener("click", () => { pinned = !pinned; show(pinned); });
  me.addEventListener("focus", () => show(true));
  me.addEventListener("blur", () => { pinned = false; show(false); });
  me.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = false; show(false); } });

  const ro = new ResizeObserver(place);
  ro.observe(host);
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); });
  io.observe(host);
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener("visibilitychange", onVis);
  place();
  start();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
}
