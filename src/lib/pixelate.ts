// Town photos in the mark's grammar: each photo is first shown as pixel art (a small canvas drawn over the
// image, scaled up with hard edges), and resolves into the real photograph when the reader points at it,
// taps it or focuses it. Costs one canvas per photo and no network request, except the hero (`data-px="hero"`)
// which re-reads the same file with CORS so its colours can be reduced and dithered like a 16-bit screen.
// Markup: <img data-px="hero|card"> inside any element; pixelateAll() wraps nothing, it adds a sibling canvas
// and the class `pxl` on the image's parent (styles in src/redesign.css).
import { L } from "../i18n";
import { reducedMotion } from "./motion";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4×4 ordered dither
const LEVELS = 6; // colour steps per channel after reduction

/** Draw `src` into `cv` at `cells` columns, cropped like object-fit: cover for the box the image is shown in. */
function draw(cv: HTMLCanvasElement, src: HTMLImageElement, cells: number, ratio: number, dither: boolean) {
  const w = Math.max(4, Math.round(cells)), h = Math.max(3, Math.round(cells / ratio));
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: dither });
  if (!ctx || !src.naturalWidth) return;
  const sr = src.naturalWidth / src.naturalHeight;
  const sw = sr > ratio ? src.naturalHeight * ratio : src.naturalWidth, sh = sr > ratio ? src.naturalHeight : src.naturalWidth / ratio;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (src.naturalWidth - sw) / 2, (src.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  if (!dither) return;
  try {
    const im = ctx.getImageData(0, 0, w, h), d = im.data, step = 255 / (LEVELS - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * step * 0.7;
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] + t) / step) * step));
    }
    ctx.putImageData(im, 0, 0);
  } catch { /* a canvas tainted by a photo served without CORS: keep the plain mosaic */ }
}

function mount(img: HTMLImageElement) {
  const hero = img.dataset.px === "hero", box = img.parentElement;
  if (!box) return;
  const start = () => {
    const r = img.getBoundingClientRect();
    const ratio = r.width && r.height ? r.width / r.height : 4 / 3;
    const base = hero ? 88 : 30;
    const cv = document.createElement("canvas");
    cv.className = "pxl-cv";
    cv.setAttribute("aria-hidden", "true");
    box.classList.add("pxl");
    img.after(cv);
    let src = img, dither = false;
    const paint = (cells = base) => draw(cv, src, cells, ratio, dither);
    paint();
    if (hero) {
      // same file again, this time readable: reduce and dither its colours (the browser serves it from cache when it can)
      const again = new Image();
      again.crossOrigin = "anonymous";
      again.onload = () => { src = again; dither = true; if (!box.classList.contains("is-real")) paint(); };
      again.src = img.currentSrc || img.src;
    }
    // resolve into the photograph, block by block; pixelate again on leaving
    let timer = 0;
    const run = (to: boolean) => {
      clearTimeout(timer);
      if (reducedMotion() || !hero) { box.classList.toggle("is-real", to); if (!to) paint(); return; }
      const steps = to ? [base * 1.6, base * 2.6, base * 4.2] : [base * 2.6, base * 1.6, base];
      if (!to) box.classList.remove("is-real");
      let n = 0;
      const tick = () => {
        if (n < steps.length) { paint(steps[n++]); timer = window.setTimeout(tick, 70); }
        else if (to) box.classList.add("is-real");
      };
      tick();
    };
    const target = (box.closest("a") as HTMLElement | null) ?? box;
    target.addEventListener("pointerenter", () => run(true));
    target.addEventListener("pointerleave", () => run(false));
    target.addEventListener("focusin", () => run(true));
    target.addEventListener("focusout", () => run(false));
    if (hero) {
      // touch and keyboard: a real button, so the photograph is reachable without a pointer
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pxl-toggle";
      const label = () => { const real = btn.getAttribute("aria-pressed") === "true"; btn.textContent = real ? L("Revoir en pixels", "Back to pixels") : L("Voir la photo", "See the photo"); };
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => { const on = btn.getAttribute("aria-pressed") !== "true"; btn.setAttribute("aria-pressed", String(on)); run(on); label(); });
      label();
      cv.after(btn);
    }
  };
  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start, { once: true });
}

/** Pixelate every not-yet-handled <img data-px> under `root`. Safe to call after each render. */
export function pixelateAll(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("img[data-px]:not([data-px-on])").forEach((img) => { img.setAttribute("data-px-on", ""); mount(img); });
}
