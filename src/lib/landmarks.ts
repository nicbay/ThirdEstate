// Landmarks drawn in the mark's style: small pixel grids in the fox's three colours, one per town that has an
// emblem everyone recognises. Shown on the town page in place of the photograph (which stays one click away).
// Letters: K outline (bleu France; a lighter blue on dark), R rouge Marianne, W white, B light blue, N ink.
// Rows may be ragged: they are padded to the widest. Add a town by adding a grid and its INSEE code(s) below.
const GRIDS: Record<string, string[]> = {
  eiffel: [
    ".........KK",
    ".........KK",
    ".........KK",
    "........KRRK",
    "........KRRK",
    "........KRRK",
    ".......KKRRKK",
    "........KRRK",
    "........KRRK",
    ".......KRRRRK",
    ".......KRRRRK",
    ".......KRWWRK",
    "......KRRWWRRK",
    ".....KKKKKKKKKK",
    "......KRRWWRRK",
    "......KRW..WRK",
    ".....KRRW..WRRK",
    ".....KRW....WRK",
    "....KKKKKKKKKKKK",
    "....KRRW....WRRK",
    "...KRRW......WRRK",
    "...KRW........WRK",
    "..KRRW..KKKK..WRRK",
    "..KRW..K....K..WRK",
    ".KRRW.K......K.WRRK",
    ".KRW..K......K..WRK",
    "KRRW.K........K.WRRK",
    "KKKK.K........K.KKKK",
  ],
  cathedral: [
    "......K",
    "......K",
    ".....KRK",
    ".....KRK",
    ".....KRK",
    "....KRRRK",
    "....KRWRK",
    "....KRRRK",
    "...KRRRRRK",
    "...KRWRWRK",
    "...KRRRRRK",
    "...KRWRWRK",
    "..KKKKKKKKKKKKKKKKKK",
    "..KRRRRRRRRRRRRRRRRK",
    "..KRWRRWRRKKKKRRWRRK",
    "..KRWRRWRKWWWWKRWRRK",
    "..KRRRRRRKWRRWKRRRRK",
    "..KRWRRWRKWWWWKRWRRK",
    "..KRWRRWRRKKKKRRWRRK",
    "..KRRRRRRRRRRRRRRRRK",
    "..KRRKKRRRKKKKRRKKRK",
    "..KRKNNKRKNNNNKRKNNK",
    "..KRKNNKRKNNNNKRKNNK",
    "..KKKKKKKKKKKKKKKKKK",
  ],
  mont: [
    "............K",
    "............K",
    "...........KWK",
    "...........KRK",
    "..........KRRRK",
    "..........KRWRK",
    ".........KKRRRKK",
    "........KRRRRRRRK",
    "........KRWRWRWRK",
    ".......KRRRRRRRRRK",
    "......KKKKKKKKKKKKK",
    ".....KRRWRRWRRWRRWRK",
    "....KRRRRRRRRRRRRRRRK",
    "...KRWRRWRRWRRWRRWRRWK",
    "..KKKKKKKKKKKKKKKKKKKKK",
    ".KWWWWWWWWWWWWWWWWWWWWWK",
    "KKKKKKKKKKKKKKKKKKKKKKKKK",
    "..BBBB....BBBBBB....BBBB",
    "BBBB..BBBB......BBBB..BBBB",
  ],
  basilica: [
    "...............W",
    "..............WWW",
    "...............W",
    "..............KKK",
    "..............KRK",
    "..............KRK",
    ".............KKKKK",
    ".............KRWRK",
    ".............KRWRK",
    ".............KRRRK",
    ".............KRWRK",
    "......KKKK...KRWRK",
    ".....KRRRRK..KRRRK",
    "....KRRRRRRKKKRWRK",
    "....KRWRRWRRRKRWRK",
    "....KRWRRWRRRKRRRK",
    "....KRRRRRRRRKRNRK",
    "...KKKKKKKKKKKKKKKK",
    "..KWWWWWWWWWWWWWWWWK",
    ".KWWWWWWWWWWWWWWWWWWKK",
    "KKKKKKKKKKKKKKKKKKKKKKKK",
  ],
};
const NAMES: Record<string, [string, string]> = {
  eiffel: ["La tour Eiffel", "The Eiffel Tower"],
  cathedral: ["La cathédrale de Strasbourg", "Strasbourg cathedral"],
  mont: ["Le Mont-Saint-Michel", "Mont-Saint-Michel"],
  basilica: ["Notre-Dame de la Garde", "Notre-Dame de la Garde"],
};
/** INSEE code (or its first three digits, for Paris and Marseille arrondissements) → landmark. */
const TOWNS: [RegExp, string][] = [
  [/^75(056|1\d\d)$/, "eiffel"],
  [/^13(055|2\d\d)$/, "basilica"],
  [/^67482$/, "cathedral"],
  [/^50353$/, "mont"],
];
const COLOURS: Record<string, string> = { K: "#5470ff", R: "#e1000f", W: "#ffffff", B: "#5470ff", N: "#0b0d18" };

export function landmarkFor(code: string | undefined): { svg: string; name: [string, string] } | null {
  const key = code ? TOWNS.find(([re]) => re.test(code))?.[1] : undefined;
  if (!key) return null;
  const rows = GRIDS[key], w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  let rects = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let e = x + 1;
      while (e < row.length && row[e] === ch) e++;
      if (COLOURS[ch]) rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${COLOURS[ch]}"/>`;
      x = e;
    }
  });
  // centred in a 4:3 stage with two cells of margin
  const side = Math.max(w + 4, ((h + 4) * 4) / 3), vh = (side * 3) / 4;
  return { name: NAMES[key], svg: `<svg class="pxl-cv pxl-landmark" viewBox="${-(side - w) / 2} ${-(vh - h) / 2} ${side} ${vh}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}</svg>` };
}
