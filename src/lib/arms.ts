// Coats of arms as pixel art. Each commune's and department's official arms (Wikidata P94, files on Wikimedia
// Commons, listed by scripts/sync-arms.mjs) are fetched as a small thumbnail, shrunk to a grid about 22 pixels wide,
// every pixel snapped to the heraldic tinctures (azure, gules, or, argent, sable, vert, purpure), and outlined in
// ink like the fox logo. The drawing is done once per file and kept for the visit.
import "../styles/arms.css";
import { fetchJson } from "../data";
import { esc } from "../util";

/** The heraldic tinctures, in pixel-art shades that hold up on paper and on the night band. */
const TINCTURES: [number, number, number][] = [
  [31, 63, 191],   // azure
  [216, 32, 42],   // gules
  [242, 194, 0],   // or
  [244, 244, 240], // argent
  [26, 26, 30],    // sable
  [31, 138, 60],   // vert
  [125, 47, 122],  // purpure
  [168, 104, 52],  // brown (trees, towers, animals in their own colour)
];
const INK: [number, number, number] = [17, 18, 22];
const GRID = 22;

/** Thumbnail of a Commons file, by its upload path ("a/ab/Name.svg"). */
export function commonsThumb(path: string, width: number) {
  const i = path.lastIndexOf("/");
  const dir = path.slice(0, i), name = path.slice(i + 1);
  const enc = encodeURIComponent(name);
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${dir}/${enc}/${width}px-${enc}${/\.svg$/i.test(name) ? ".png" : ""}`;
}

let depArms: Promise<Record<string, string>> | null = null;
/** Department code → arms file. */
export const loadDepartmentArms = () => (depArms ??= fetchJson<Record<string, string>>("/data/arms/departements.json").catch((): Record<string, string> => ({})));
const communeArms = new Map<string, Promise<Record<string, string>>>();
/** Commune code → arms file, for one department. */
export function loadCommuneArms(dep: string) {
  if (!communeArms.has(dep)) communeArms.set(dep, fetchJson<Record<string, string>>(`/data/arms/communes/${dep}.json`).catch((): Record<string, string> => ({})));
  return communeArms.get(dep)!;
}

/** A slot for a coat of arms; `paintArms` fills it. With `href` it's a link (e.g. the department's page). */
export function armsSlot(path: string | null | undefined, label: string, size: "s" | "m" | "l" = "m", href?: string) {
  if (!path) return "";
  const inner = `<canvas aria-hidden="true"></canvas>`;
  const attrs = `class="arms arms-${size}" data-arms="${esc(path)}" title="${esc(label)}"`;
  return href ? `<a ${attrs} href="${esc(href)}" aria-label="${esc(label)}">${inner}</a>` : `<span ${attrs} role="img" aria-label="${esc(label)}">${inner}</span>`;
}

const cache = new Map<string, Promise<ImageData | null>>();
function pixelate(path: string): Promise<ImageData | null> {
  if (cache.has(path)) return cache.get(path)!;
  const p = new Promise<ImageData | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const w = GRID, h = Math.max(8, Math.min(40, Math.round((GRID * img.naturalHeight) / Math.max(1, img.naturalWidth))));
        const src = document.createElement("canvas");
        src.width = w; src.height = h;
        const sx = src.getContext("2d", { willReadFrequently: true })!;
        sx.imageSmoothingQuality = "high";
        sx.drawImage(img, 0, 0, w, h);
        const d = sx.getImageData(0, 0, w, h).data;
        // snap every pixel to the nearest tincture; mostly transparent ones are left out
        const cells: ([number, number, number] | null)[] = [];
        for (let i = 0; i < w * h; i++) {
          const a = d[i * 4 + 3];
          if (a < 110) { cells.push(null); continue; }
          const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
          let best = TINCTURES[0], bd = Infinity;
          for (const t of TINCTURES) {
            // weighted distance: the eye is more sensitive to green
            const dd = 2 * (r - t[0]) ** 2 + 4 * (g - t[1]) ** 2 + 3 * (b - t[2]) ** 2;
            if (dd < bd) { bd = dd; best = t; }
          }
          cells.push(best);
        }
        // one pixel of ink around the shape, like the fox
        const W = w + 2, H = h + 2;
        const out = new ImageData(W, H);
        const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? cells[y * w + x] : null);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let c = at(x - 1, y - 1);
          if (!c && (at(x - 2, y - 1) || at(x, y - 1) || at(x - 1, y - 2) || at(x - 1, y))) c = INK;
          if (!c) continue;
          const o = (y * W + x) * 4;
          out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255;
        }
        resolve(out);
      } catch { resolve(null); } // a file served without CORS: nothing drawn rather than a broken image
    };
    img.src = commonsThumb(path, 120);
  });
  cache.set(path, p);
  return p;
}

/** Draw every unpainted arms slot under `root`; slots whose file can't be drawn are removed. */
export function paintArms(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-arms]:not([data-painted])").forEach(async (el) => {
    el.dataset.painted = "1";
    const data = await pixelate(el.dataset.arms!);
    const cv = el.querySelector("canvas");
    if (!data || !cv) { el.remove(); return; }
    cv.width = data.width; cv.height = data.height;
    cv.getContext("2d")!.putImageData(data, 0, 0);
    el.classList.add("is-in");
  });
}
