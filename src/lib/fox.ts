// The Third Estate mark: a 16×16 pixel-art fox head, symmetrical: bleu France outline, rouge Marianne fur, white snout.
// One grid drives every use: the masthead and footer (onDark), the favicon and the share image
// (scripts/build-brand.mjs imports this file), and docs/design.md describes it.
// Rows top to bottom; '.' is transparent.
export const FOX_GRID = [
  "..K..........K..",
  ".KLK........KRK.",
  ".KLLK......KRRK.",
  ".KLILK....KRIRK.",
  "KLLILLKKKKRRIRRK",
  "KLLLLLLMMRRRRRRK",
  "KLLLLLLMMRRRRRRK",
  "KLLEELLMMRREERRK",
  "KLLLLLLMMRRRRRRK",
  ".KMMLLLMMRRRMMK.",
  "..KMMMLMMRMMMK..",
  "...KMMMMMMMMK...",
  "....KMMMMMMK....",
  ".....KMNNMK.....",
  "......KNNK......",
  ".......KK.......",
];

/** K outline (bleu France), L and R fur (rouge Marianne, both sides: the head is symmetrical), I inner ear, M muzzle, E eye, N nose.
 *  L and R stay separate letters so the grid still reads left/right, but they share one colour. */
const LIGHT: Record<string, string> = { K: "#000091", L: "#e1000f", R: "#e1000f", I: "#ffffff", M: "#ffffff", E: "#111216", N: "#111216" };
/** On the black masthead bleu France (#000091) would vanish: the outline takes a lighter blue of the same hue. */
const DARK: Record<string, string> = { ...LIGHT, K: "#5470ff" };

/** The fox as <rect>s (horizontal runs merged), in a 16-unit box, offset by (x, y). */
export function foxRects(onDark = false, x = 0, y = 0) {
  const pal = onDark ? DARK : LIGHT;
  let out = "";
  FOX_GRID.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      const ch = row[c];
      let e = c + 1;
      while (e < row.length && pal[row[e]] === pal[ch]) e++;
      if (pal[ch]) out += `<rect x="${x + c}" y="${y + r}" width="${e - c}" height="1" fill="${pal[ch]}"/>`;
      c = e;
    }
  });
  return out;
}

/** Inline SVG of the fox, `size` CSS pixels square. Decorative by default (the brand link carries the name). */
export function foxSvg(size: number, onDark = false, attrs = 'aria-hidden="true"') {
  return `<svg class="fox" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" ${attrs}>${foxRects(onDark)}</svg>`;
}

/** The favicon: the fox on a rounded ink tile. */
export function foxFavicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" shape-rendering="crispEdges"><rect width="20" height="20" rx="4" fill="#111216" shape-rendering="geometricPrecision"/>${foxRects(true, 2, 2)}</svg>`;
}

/** Every filled cell of the fox, one per pixel (src/lib/motion.ts assembles and blinks the masthead fox from these). */
export function foxCells(onDark = false) {
  const pal = onDark ? DARK : LIGHT;
  const out: { x: number; y: number; ch: string; fill: string }[] = [];
  FOX_GRID.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) out.push({ x, y, ch, fill: pal[ch] }); }));
  return out;
}
/** The fur colour each side of the muzzle: an eye "closes" by taking it. */
export const foxFur = (x: number, onDark = false) => ((onDark ? DARK : LIGHT)[x < 8 ? "L" : "R"]);
