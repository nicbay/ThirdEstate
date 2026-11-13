// The THIRD ESTATE wordmark: bitmap capitals on the fox's pixel grid (5×7 glyphs, one-unit gaps).
// THIRD is set in a doubled stroke (every pixel also fills its right neighbour), ESTATE in a single stroke and a
// quieter colour: the old heavy/light Archivo pairing, redrawn in pixels. Render at whole multiples (2, 3, 4…)
// so every pixel stays square. Used by the masthead, the phone menu, the footer and the share card
// (scripts/build-brand.mjs imports this file).

const GLYPHS: Record<string, string[]> = {
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};
const WORD_GAP = 3;

/** One word as <rect>s (horizontal runs merged) from x0; returns the markup and the x where the next word may start. */
function word(text: string, bold: boolean, x0: number, fill: string) {
  let out = "";
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    const w = g[0].length + (bold ? 1 : 0);
    g.forEach((row, y) => {
      // a bold glyph: each "#" also fills the cell to its right
      const cells = new Set<number>();
      [...row].forEach((c, i) => { if (c === "#") { cells.add(i); if (bold) cells.add(i + 1); } });
      for (let i = 0; i < w; ) {
        if (!cells.has(i)) { i++; continue; }
        let e = i + 1;
        while (cells.has(e)) e++;
        out += `<rect x="${x + i}" y="${y}" width="${e - i}" height="1" fill="${fill}"/>`;
        i = e;
      }
    });
    x += w + 1;
  }
  return { out, end: x - 1 };
}

/** Width of the wordmark in grid units (height is always 7). */
const third = word("THIRD", true, 0, "");
const estate = word("ESTATE", false, third.end + WORD_GAP, "");
export const WORDMARK_W = estate.end;
export const WORDMARK_H = 7;

/**
 * Inline SVG of the wordmark, `px` CSS pixels per grid unit. THIRD takes `currentColor`; ESTATE a quieter tone
 * (a mid grey on night, the tertiary ink on paper). Decorative: the link around it carries the name.
 */
export function wordmarkSvg(px: number, onDark = true, cls = "wordmark") {
  const quiet = onDark ? "#9b9b9b" : "#686d77";
  const a = word("THIRD", true, 0, "currentColor");
  const b = word("ESTATE", false, a.end + WORD_GAP, quiet);
  return `<svg class="${cls}" viewBox="0 0 ${WORDMARK_W} ${WORDMARK_H}" width="${WORDMARK_W * px}" height="${WORDMARK_H * px}" shape-rendering="crispEdges" aria-hidden="true">${a.out}${b.out}</svg>`;
}
