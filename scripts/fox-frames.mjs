// Builds the fox's walk cycle and wagging-tail frames in src/lib/fox-sprites.json from hand-drawn parts:
// a body without legs or tail, legs placed by a gait (four legs, the far pair darker and behind the body),
// and a bushy tail drawn along a curve with a white tip. The parts are pixel art like every other frame; the
// script only poses them, so the gait and the wag stay consistent from frame to frame.
//   node scripts/fox-frames.mjs        (FOX_SRC=<path> reads another copy of the sprites file)
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../src/lib/fox-sprites.json", import.meta.url);
const SRC = process.env.FOX_SRC ? new URL(`file:///${process.env.FOX_SRC}`) : FILE;
const sprites = JSON.parse(await readFile(SRC, "utf8"));
sprites.palette = { ...sprites.palette, S: "#6e1220", R: "#4a0d1a" };

const W = 34, H = 22;
const blank = (w = W, h = H) => Array.from({ length: h }, () => Array(w).fill("."));
const put = (g, rows, ox = 0, oy = 0) => rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== "." && g[y + oy]?.[x + ox] !== undefined) g[y + oy][x + ox] = c; }));
const outline = (g, part) => {
  // K around a part's fill, only where the picture is still empty
  for (let y = 0; y < part.length; y++) for (let x = 0; x < part[0].length; x++) {
    if (part[y][x] !== ".") continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = part[y + dy]?.[x + dx]; return c && c !== "." && c !== "K"; });
    if (n && g[y][x] === ".") g[y][x] = "K";
  }
};
const layer = (g, part, edge = true) => { if (edge) outline(g, part); for (let y = 0; y < part.length; y++) for (let x = 0; x < part[0].length; x++) if (part[y][x] !== ".") g[y][x] = part[y][x]; };
const rows = (g) => g.map((r) => r.join(""));

/** A bushy tail from its root (rx, ry) going left `n` px: thick in the middle, a white tip; `bend` lowers the
 *  middle, `lift` raises (negative) or drops the tip. Returns a fill-only layer. */
function tail(rx, ry, n, bend, lift, floor = H - 2) {
  const p = blank();
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const cy = Math.round(ry + bend * Math.sin(Math.PI * s * 0.8) + lift * s * s);
    const th = i === n ? 2 : i < 2 ? 3 : s > 0.8 ? 3 : 4 + (s > 0.3 && s < 0.65 ? 1 : 0);
    const top = Math.min(cy - Math.floor(th / 2), floor - th + 1);
    for (let k = 0; k < th; k++) {
      const y = top + k, x = rx - i;
      if (x < 0 || y < 0 || y > floor) continue;
      const tip = s > 0.72;
      p[y][x] = tip ? (k === th - 1 && th > 2 ? "G" : "M") : k === th - 1 ? "D" : k === 0 && i > 1 ? "L" : "L";
    }
  }
  return p;
}

// ---- walk: the body (head and trunk, no legs, no tail), then legs from a gait
// the head is the sitting fox's own (big enough to read at 3px a pixel), on a long trunk
const BODY = [
  "......................K......K....",
  ".....................KLK....KLK...",
  ".....................KLMK..KMLK...",
  ".....................KLMLKKLMLK...",
  "....................KLLLLLLLLLLK..",
  "....................KLLLLLLLLLLK..",
  "....................KDLLLLLLELLK..",
  "...................KDLLLLLLLLMMMK.",
  "...................KDLLLLLMMMMMNK.",
  "...........KKKKKKKKKKDLLMMMMMMKK..",
  "..........KDLLLLLLLLLLDMMMMMGK....",
  "..........KDLLLLLLLLLLLLMMMMGK....",
  "..........KDLLLLLLLLLLLLLMMMGK....",
  "..........KDDLLLLLLLLLLLLLMMGK....",
  "..........KDDLLLKKKKKKKKDDLMGK....",
];
const HIP = 14, GROUND = 21, STRIDE = 4;
// [hip x, gait phase, near?]: a trot, each near leg paired with the far leg at the other end
const LEGS = [
  [15, 0.0, false], // far hind
  [24, 0.5, false], // far front
  [12, 0.5, true],  // near hind
  [26, 0.0, true],  // near front
];
function leg(hx, p, near) {
  const g = blank();
  const swing = p >= 0.5, s = swing ? (p - 0.5) / 0.5 : p / 0.5;
  const dx = Math.round(swing ? -STRIDE + s * 2 * STRIDE : STRIDE - s * 2 * STRIDE);
  const lift = swing ? Math.round(2 * Math.sin(Math.PI * s)) : 0;
  const paw = GROUND - 1 - lift;
  for (let y = HIP; y <= paw; y++) {
    const u = (y - HIP) / Math.max(1, paw - HIP);
    // a lifted leg bends: the lower half tucks back under the body
    const bendBack = swing ? Math.round(Math.sin(Math.PI * u) * 1.5 * Math.sin(Math.PI * s)) : 0;
    const x = hx + Math.round(dx * u) - bendBack;
    // dark stockings like a red fox's, in a deep maroon ("S") rather than black so they still read on the night
    // band; the far legs a shade darker ("R") all the way down, so they sit behind
    const c = near ? (u < 0.45 ? "D" : "S") : u < 0.45 ? "S" : "R";
    g[y][x] = c; g[y][x + 1] = c;
    if (y === paw) g[y][x + 2] = c; // the paw points the way the fox walks
  }
  // a near leg's thigh runs up into the trunk, over the belly's outline, so the leg grows out of the body
  if (near) { g[HIP - 1][hx] = "D"; g[HIP - 1][hx + 1] = "D"; }
  return g;
}
const walk = [];
for (let f = 0; f < 8; f++) {
  const g = blank();
  // the tail swings a little with the gait, held out behind, its tip a touch low
  const tl = tail(12, 10, 10, 1, [1, 0, -1, -2, -2, -1, 0, 1][f]);
  for (const [hx, ph, near] of LEGS.filter((l) => !l[2])) layer(g, leg(hx, (f / 8 + ph) % 1, near));
  layer(g, tl);
  put(g, BODY);
  for (const [hx, ph, near] of LEGS.filter((l) => l[2])) layer(g, leg(hx, (f / 8 + ph) % 1, near));
  walk.push(rows(g));
}

// ---- sitting: the old sitting fox without its tail, and a tail on the ground that sweeps up and down
const SIT = sprites.frames.sitA.rows.map((r) => r.padEnd(28, "."));
const BLINK = sprites.frames.blink.rows.map((r) => r.padEnd(28, "."));
const untail = (src) => {
  const g = src.map((r) => [...r]);
  for (let y = 14; y < g.length; y++) for (let x = 0; x < 10; x++) g[y][x] = ".";
  // the haunch's own edge where the tail used to join
  g[19][10] = "K"; g[20][10] = "K"; g[20][11] = g[20][11] === "L" ? "D" : g[20][11];
  for (let x = 10; x < 15; x++) g[21][x] = "K";
  return g.map((r) => r.join(""));
};
// kept beside the frames (under "parts", which the page never draws) so the script can be run again
const parts = sprites.parts ?? { sitBody: untail(SIT), blinkBody: untail(BLINK) };
const { sitBody, blinkBody } = parts;
// six poses of one sweep: lying flat, then the tip curling up, then the whole tail lifting
const SWEEP = [[0, 0], [0, -2], [-1, -4], [-1, -6], [-2, -7], [-2, -8]];
const sitWith = (body, k) => {
  const g = blank(28, 22);
  const [bend, lift] = SWEEP[k];
  const tl = tail(10, 19, 9, bend, lift, 20).map((r) => r.slice(0, 28));
  layer(g, tl);
  put(g, body);
  return rows(g);
};

const frames = { ...sprites.frames };
for (const k of Object.keys(frames)) if (/^(walk\d|wag\d|sitB)$/.test(k)) delete frames[k];
walk.forEach((r, i) => { frames[`walk${i}`] = { rows: r }; });
frames.sitA = { rows: sitWith(sitBody, 0) };
frames.blink = { rows: sitWith(blinkBody, 0) };
for (let k = 1; k < SWEEP.length; k++) frames[`wag${k}`] = { rows: sitWith(sitBody, k) };
await writeFile(FILE, JSON.stringify({ ...sprites, frames, parts }, null, 2) + "\n");
console.log("✓ fox frames:", Object.keys(frames).join(" "));
