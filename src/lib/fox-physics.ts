// The fox's two kinds of flight. A jump is authored: a parabola between two chosen points, so it always lands
// where it meant to. A throw is simulated: the drag's velocity, gravity, a little air drag and spin, with the tail
// on a damped spring that trails the motion (the "ragdoll" is faked: one rigid body, a tail that lags, and squash).
// All units are CSS px, seconds and degrees.

export const GRAVITY = 2600;

export type Arc = { x0: number; y0: number; x1: number; y1: number; h: number; T: number; t: number };

/** A jump from (x0,y0) to (x1,y1): higher arcs for longer or upward jumps, 0.38–0.9 s in the air. */
export function makeArc(x0: number, y0: number, x1: number, y1: number): Arc {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const h = 34 + Math.max(0, y0 - y1) * 0.62 + d * 0.08; // y0 > y1 is upward: the arc must clear the target first
  return { x0, y0, x1, y1, h, T: Math.min(0.9, 0.38 + d / 1800), t: 0 };
}

/** Position and heading (deg, 0 = level, nose down positive) at the arc's current time. */
export function arcAt(a: Arc) {
  const u = Math.min(1, a.t / a.T);
  const x = a.x0 + (a.x1 - a.x0) * u;
  const y = a.y0 + (a.y1 - a.y0) * u - 4 * a.h * u * (1 - u);
  const dx = a.x1 - a.x0, dy = a.y1 - a.y0 - 4 * a.h * (1 - 2 * u);
  const tilt = Math.max(-24, Math.min(24, (Math.atan2(dy, Math.abs(dx) + 120) * 180) / Math.PI));
  return { x, y, tilt, u };
}

export type Body = { x: number; y: number; vx: number; vy: number; ang: number; w: number; tail: number; tailV: number };

/** One step of a thrown fox. */
export function stepBody(b: Body, dt: number) {
  b.vy += GRAVITY * dt;
  const drag = Math.exp(-0.35 * dt);
  b.vx *= drag;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.ang += b.w * dt;
  b.w *= Math.exp(-0.6 * dt);
  // the tail trails the spin and is flung up by the fall
  const want = Math.max(-75, Math.min(75, -b.w * 0.06 - b.vy * 0.025));
  b.tailV += (240 * (want - b.tail) - 13 * b.tailV) * dt;
  b.tail += b.tailV * dt;
}

/** Stretch along the motion when fast, as a hand-drawn fall would. */
export const squash = (speed: number) => {
  const s = 1 + Math.min(0.16, speed / 9000);
  return [s, 1 / s] as const;
};
