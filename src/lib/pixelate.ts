// Town pictures in the site's own hand. Two treatments, both drawn over the photograph, which stays one click away:
// 1. a landmark in the mark's pixel style, for the towns that have one (src/lib/landmarks.ts);
// 2. otherwise a poster of the photograph in the three colours of the mark: shadows in bleu France, midtones in
//    rouge Marianne, lights in white, on a coarse pixel grid with an ordered dither between the three.
// Markup: <img data-px="hero|card" crossorigin="anonymous"> (the canvas must be allowed to read the pixels; Wikimedia
// Commons serves its files with CORS). If the pixels cannot be read, the photograph is simply shown as it is.
import { L } from "../i18n";
import { landmarkFor } from "./landmarks";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4×4 ordered dither
const INK: [number, number, number][] = [[0, 0, 145], [225, 0, 15], [255, 255, 255]]; // bleu, rouge, blanc

/** Paint `src` as a three-colour poster at `cells` columns, cropped like object-fit: cover. False if unreadable. */
function poster(cv: HTMLCanvasElement, src: HTMLImageElement, cells: number, ratio: number) {
  const w = Math.max(8, Math.round(cells)), h = Math.max(6, Math.round(cells / ratio));
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx || !src.naturalWidth) return false;
  const sr = src.naturalWidth / src.naturalHeight;
  const sw = sr > ratio ? src.naturalHeight * ratio : src.naturalWidth, sh = sr > ratio ? src.naturalHeight : src.naturalWidth / ratio;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (src.naturalWidth - sw) / 2, (src.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  try {
    const im = ctx.getImageData(0, 0, w, h), d = im.data;
    // stretch the photo's own range of light first, so a grey sky and a dark street both use all three colours
    const lum = new Float32Array(w * h);
    let lo = 255, hi = 0;
    for (let i = 0; i < lum.length; i++) { const v = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; lum[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    // a third of the picture per ink: the cut points are the photo's own terciles of light, so a grey sky or a
    // dark street still gives three clear masses; the dither only softens the borders between them
    const sorted = Float32Array.from(lum).sort();
    const q1 = sorted[Math.floor(sorted.length / 3)], q2 = sorted[Math.floor((2 * sorted.length) / 3)];
    const ramp = (v: number) => (v < q1 ? (0.5 * (v - lo)) / Math.max(1, q1 - lo) : v < q2 ? 0.5 + (v - q1) / Math.max(1, q2 - q1) : 1.5 + (0.5 * (v - q2)) / Math.max(1, hi - q2));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = ramp(lum[i]) + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.28; // 0 … 2 across the three inks
      const c = INK[t < 0.5 ? 0 : t < 1.5 ? 1 : 2];
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return true;
  } catch { return false; /* served without CORS: leave the photograph */ }
}

function mount(img: HTMLImageElement) {
  const hero = img.dataset.px === "hero", box = img.parentElement;
  if (!box) return;
  const start = () => {
    const r = img.getBoundingClientRect();
    const ratio = r.width && r.height ? r.width / r.height : 4 / 3;
    const mark = hero ? landmarkFor(box.dataset.code) : null;
    if (mark) {
      img.insertAdjacentHTML("afterend", mark.svg);
      box.classList.add("pxl", "has-landmark");
    } else {
      const cv = document.createElement("canvas");
      cv.className = "pxl-cv";
      cv.setAttribute("aria-hidden", "true");
      if (!poster(cv, img, hero ? 84 : 36, ratio)) return;
      img.after(cv);
      box.classList.add("pxl");
    }
    if (!hero) return;
    // the photograph itself, for anyone who wants it: a real button (touch, keyboard)
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pxl-toggle";
    btn.setAttribute("aria-pressed", "false");
    const label = () => { btn.textContent = btn.getAttribute("aria-pressed") === "true" ? (mark ? L(mark.name[0], mark.name[1]) : L("Revoir l’affiche", "Back to the poster")) : L("Voir la photo", "See the photo"); };
    btn.addEventListener("click", () => { const on = btn.getAttribute("aria-pressed") !== "true"; btn.setAttribute("aria-pressed", String(on)); box.classList.toggle("is-real", on); label(); });
    label();
    box.append(btn);
  };
  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start, { once: true });
}

/** Treat every not-yet-handled <img data-px> under `root`. Safe to call after each render. */
export function pixelateAll(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("img[data-px]:not([data-px-on])").forEach((img) => { img.setAttribute("data-px-on", ""); mount(img); });
}
