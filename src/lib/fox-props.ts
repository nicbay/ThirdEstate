// Props: the fox plays with a page element through a visual clone. The original is only hidden
// (visibility, so the layout does not move) while the clone is out, and shown again when the clone is back in its
// exact place; the real node, its data and its links are never touched. A clone is styled by copying the
// computed style of each of its nodes, so it looks the same away from the CSS context it came from.
import { GRAVITY } from "./fox-physics";
import { measure, standRange, type Surface } from "./fox-world";

/** What a trick needs from the fox. Every action resolves false when the fox is interrupted (grabbed, called away). */
export interface FoxApi {
  x(): number;
  y(): number;
  face(): number;
  setFace(f: number): void;
  surf(): Surface | null;
  walkTo(x: number): Promise<boolean>;
  goTo(s: Surface, x: number): Promise<boolean>;
  timed(act: "sit" | "crouch" | "look", ms: number): Promise<boolean>;
  props: Set<Prop>;
  layer: HTMLElement;
}

type Mode = "held" | "nose" | "free" | "tween" | "rest";

export class Prop {
  el: HTMLElement;
  w: number;
  h: number;
  x = 0; y = 0; vx = 0; vy = 0; rot = 0; vr = 0;
  mode: Mode = "rest";
  floor = 0; minX = -1e9; maxX = 1e9;
  private tw: { fx: number; fy: number; fr: number; t: number; T: number; to: () => { x: number; y: number }; then: () => void } | null = null;
  private prevVis: string;
  done = false;

  constructor(public orig: HTMLElement, private api: FoxApi) {
    const r = orig.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.x = r.left + scrollX; this.y = r.top + scrollY;
    const el = orig.cloneNode(true) as HTMLElement;
    copyStyles(orig, el);
    el.removeAttribute("id");
    el.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    el.querySelectorAll("a").forEach((a) => a.removeAttribute("href"));
    el.removeAttribute("href");
    el.setAttribute("aria-hidden", "true");
    el.inert = true;
    el.classList.add("fox-prop");
    Object.assign(el.style, { position: "absolute", left: "0", top: "0", margin: "0", width: `${r.width}px`, height: `${r.height}px`, boxSizing: "border-box", pointerEvents: "none", transition: "none", animation: "none" });
    this.el = el;
    api.layer.append(el);
    this.prevVis = orig.style.visibility;
    orig.style.visibility = "hidden";
    api.props.add(this);
    this.render();
  }

  /** The fox's mouth (walking or sitting) or the tip of its nose (balancing), in page coordinates. */
  private anchor(m: "held" | "nose") {
    const f = this.api.face(), x = this.api.x(), y = this.api.y();
    return m === "held" ? { x: x + f * 40 - this.w / 2, y: y - 36 - this.h / 2 } : { x: x + f * 18 - this.w / 2, y: y - 70 - this.h };
  }
  /** Glide to the mouth (or nose), then stay there. */
  hold(m: "held" | "nose" = "held", T = 0.16) { this.tweenTo(() => this.anchor(m), T, () => { this.mode = m; }); }
  /** Thrown: flies until it lands on `floor` (a box's top, page px), bouncing once, kept within [minX, maxX]. */
  toss(vx: number, vy: number, floor: number, minX = -1e9, maxX = 1e9) {
    Object.assign(this, { vx, vy, vr: vx * 0.9, floor, minX, maxX, mode: "free" as Mode });
  }
  /** Back to its exact place (re-measured: the page may have moved), then the original shows again. */
  home(T = 0.28) {
    if (this.done) return;
    this.tweenTo(() => {
      const r = this.orig.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY };
    }, T, () => this.restore());
  }
  /** Instantly: original visible, clone gone (page change, fox removed). */
  restore() {
    if (this.done) return;
    this.done = true;
    this.orig.style.visibility = this.prevVis;
    this.el.remove();
    this.api.props.delete(this);
  }
  get cx() { return this.x + this.w / 2; }

  private tweenTo(to: () => { x: number; y: number }, T: number, then: () => void) {
    this.tw = { fx: this.x, fy: this.y, fr: this.rot, t: 0, T, to, then };
    this.mode = "tween";
  }

  step(dt: number, now: number) {
    switch (this.mode) {
      case "held": case "nose": {
        const a = this.anchor(this.mode);
        this.x = a.x; this.y = a.y;
        this.rot = this.mode === "nose" ? Math.sin(now / 180) * 9 : Math.sin(now / 120) * 4;
        break;
      }
      case "free":
        this.vy += GRAVITY * dt;
        this.x = Math.max(this.minX, Math.min(this.maxX - this.w, this.x + this.vx * dt));
        this.y += this.vy * dt;
        this.rot += this.vr * dt;
        if (this.y + this.h >= this.floor && this.vy > 0) {
          this.y = this.floor - this.h;
          if (this.vy > 500) { this.vy *= -0.32; this.vx *= 0.5; this.vr *= -0.5; }
          else { this.mode = "rest"; this.vx = this.vy = 0; }
        }
        break;
      case "rest":
        this.rot *= Math.exp(-14 * dt);
        break;
      case "tween": {
        const tw = this.tw!;
        tw.t += dt;
        const u = Math.min(1, tw.t / tw.T), e = 1 - (1 - u) ** 3;
        const to = tw.to();
        this.x = tw.fx + (to.x - tw.fx) * e;
        this.y = tw.fy + (to.y - tw.fy) * e - Math.sin(Math.PI * u) * 18;
        this.rot = tw.fr * (1 - e);
        if (u >= 1) { this.tw = null; this.mode = "rest"; tw.then(); }
        break;
      }
    }
  }
  render() {
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0) rotate(${this.rot.toFixed(1)}deg)`;
  }
}

function copyStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const st = (dst as HTMLElement).style;
  for (let i = 0; i < cs.length; i++) st.setProperty(cs[i], cs.getPropertyValue(cs[i]));
  for (let i = 0; i < src.children.length; i++) if (dst.children[i]) copyStyles(src.children[i], dst.children[i]);
}

/** Small things worth playing with, on screen and not already out: the Assembly legend chips (the HOR chip
 *  first, half the time) and the hero's buttons. */
export function propCandidates(): HTMLElement[] {
  const onScreen = (e: HTMLElement) => {
    const r = e.getBoundingClientRect();
    return r.width > 10 && r.width < 220 && r.top > 80 && r.bottom < innerHeight - 10 && e.style.visibility !== "hidden";
  };
  const chips = [...document.querySelectorAll<HTMLElement>(".hd-legend li")].filter(onScreen);
  const hor = chips.find((c) => /^\s*HOR\b/.test(c.textContent ?? ""));
  if (hor && Math.random() < 0.5) return [hor];
  return [...chips, ...[...document.querySelectorAll<HTMLElement>(".hday-doors a")].filter(onScreen)];
}

/** The box to stand on to reach an element: the nearest box under it (its legend row, its card…) or itself. */
function perchFor(el: HTMLElement): Surface | null {
  for (let e: HTMLElement | null = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const s = measure(e);
    if (s && s.right - s.left >= 90 && s.top < el.getBoundingClientRect().top + scrollY + 4) return s;
  }
  return measure(el);
}

const near = (s: Surface, x: number) => Math.max(standRange(s)[0], Math.min(standRange(s)[1], x));

/** Fetch: picks the element up, carries it a few steps, throws it, runs after it and puts it back. */
async function fetchTrick(api: FoxApi, el: HTMLElement) {
  const s = perchFor(el);
  if (!s) return false;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2 + scrollX;
  if (!(await api.goTo(s, near(s, cx - 40)))) return false;
  api.setFace(cx >= api.x() ? 1 : -1);
  if (!(await api.timed("crouch", 260))) return false;
  const p = new Prop(el, api);
  try {
    p.hold();
    if (!(await api.timed("sit", 520))) return false;
    const here = api.surf() ?? s, [lo, hi] = standRange(here);
    const dir = api.x() - lo > hi - api.x() ? -1 : 1; // run toward the longer side of the box
    if (!(await api.walkTo(Math.max(lo, Math.min(hi, api.x() + dir * 70))))) return false;
    api.setFace(dir);
    if (!(await api.timed("crouch", 180))) return false;
    p.toss(dir * 380, -560, here.top, here.left, here.right);
    if (!(await api.timed("look", 900))) return false;
    if (!(await api.walkTo(near(here, p.cx - dir * 30)))) return false;
    if (!(await api.timed("crouch", 200))) return false;
    p.hold();
    if (!(await api.timed("sit", 400))) return false;
    if (!(await api.goTo(s, near(s, cx - 40)))) return false;
    api.setFace(cx >= api.x() ? 1 : -1);
    if (!(await api.timed("crouch", 220))) return false;
    p.home();
    return api.timed("sit", 1600);
  } finally {
    if (!p.done && p.mode !== "tween") p.home();
  }
}

/** Balance: puts the element on its nose, throws it up once, catches it, puts it back. */
async function balanceTrick(api: FoxApi, el: HTMLElement) {
  const s = perchFor(el);
  if (!s) return false;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2 + scrollX;
  if (!(await api.goTo(s, near(s, cx - 40)))) return false;
  api.setFace(cx >= api.x() ? 1 : -1);
  if (!(await api.timed("crouch", 240))) return false;
  const p = new Prop(el, api);
  try {
    p.hold("nose", 0.3);
    if (!(await api.timed("sit", 2200))) return false;
    const noseY = api.y() - 70;
    p.toss(0, -900, noseY);
    p.vr = 540;
    if (!(await api.timed("look", 700))) return false;
    p.hold("nose", 0.08);
    if (!(await api.timed("sit", 1200))) return false;
    p.home(0.34);
    return api.timed("sit", 1500);
  } finally {
    if (!p.done && p.mode !== "tween") p.home();
  }
}

/** One trick at random on something on screen; false when there is nothing to play with. */
export async function playTrick(api: FoxApi) {
  const c = propCandidates();
  if (!c.length) return false;
  const el = c[Math.floor(Math.random() * c.length)];
  // a button is too big to balance: those only get fetched
  return el.matches(".hd-legend li") && Math.random() < 0.45 ? balanceTrick(api, el) : fetchTrick(api, el);
}
