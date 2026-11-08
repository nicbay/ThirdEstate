// Small SVG word cloud: words placed largest first along an Archimedean spiral from the centre,
// each one in the first spot where its box doesn't overlap a word already placed.
// Widths are measured with a canvas in the page's own font, so call it after fonts have loaded
// (see `fontsReady`). Words that can't be placed are left out.
import { esc } from "../util";

export interface CloudWord {
  text: string;
  /** 0–1, drives the font size */
  weight: number;
  color: string;
  /** tooltip text */
  tip?: string;
  href?: string;
}

let ctx: CanvasRenderingContext2D | null = null;
const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';
function measure(text: string, size: number, weight: number) {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.56;
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(text).width;
}

/** Resolves once web fonts are in (or after 1.5 s), so measured widths match what is drawn. */
export const fontsReady = () => Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

export function wordCloud(words: CloudWord[], opts: { width?: number; height?: number; min?: number; max?: number; label?: string } = {}) {
  const W = opts.width ?? 720, H = opts.height ?? 380;
  const min = opts.min ?? 12, max = opts.max ?? 46;
  const sorted = [...words].sort((a, b) => b.weight - a.weight);
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const out: string[] = [];
  const pad = 3;
  const aspect = W / H;
  for (const wd of sorted) {
    // square root so mid-weight words stay readable
    let size = Math.round(min + (max - min) * Math.sqrt(Math.max(0, Math.min(1, wd.weight))));
    const fw = size >= 26 ? 800 : size >= 17 ? 700 : 600;
    let w = measure(wd.text, size, fw) + pad * 2;
    // a long phrase wider than the canvas: shrink it to fit
    if (w > W - 8) { size = Math.max(min, Math.floor((size * (W - 8)) / w)); w = measure(wd.text, size, fw) + pad * 2; }
    const h = size * 1.08 + pad;
    let placed: { x: number; y: number } | null = null;
    for (let t = 0; t < 900; t += 0.11) {
      const r = 2.2 * t;
      const x = W / 2 + r * Math.cos(t) * aspect * 0.75 - w / 2;
      const y = H / 2 + r * Math.sin(t) - h / 2;
      if (x < 2 || y < 2 || x + w > W - 2 || y + h > H - 2) {
        if (r > Math.max(W, H)) break;
        continue;
      }
      if (boxes.every((b) => x + w <= b.x || b.x + b.w <= x || y + h <= b.y || b.y + b.h <= y)) { placed = { x, y }; break; }
    }
    if (!placed) continue;
    boxes.push({ ...placed, w, h });
    const text = `<text x="${(placed.x + w / 2).toFixed(1)}" y="${(placed.y + h / 2 + size * 0.34).toFixed(1)}" font-size="${size}" font-weight="${fw}" fill="${wd.color}"${wd.tip ? ` data-tip="${esc(wd.tip)}"` : ""}>${esc(wd.text)}</text>`;
    out.push(wd.href ? `<a href="${esc(wd.href)}">${text}</a>` : text);
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="wordcloud" role="img" aria-label="${esc(opts.label ?? sorted.slice(0, 20).map((w) => w.text).join(", "))}">${out.join("")}</svg>`;
}
