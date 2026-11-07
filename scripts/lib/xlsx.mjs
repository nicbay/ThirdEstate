// Minimal .xlsx reader (no new dependency: uses fflate, already in package.json).
// Returns the rows of one named sheet as arrays of cell values (strings or numbers).
// Handles shared strings, inline strings and sparse cells; ignores styles and formulas.

import { unzipSync, strFromU8 } from "fflate";

const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) =>
    d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[n]);

// Column letters → 0-based index ("A" → 0, "AB" → 27)
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

export function sheetNames(buf) {
  const z = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === "xl/workbook.xml" });
  return [...strFromU8(z["xl/workbook.xml"]).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));
}

export function readSheet(buf, match) {
  const z = unzipSync(new Uint8Array(buf));
  const wb = strFromU8(z["xl/workbook.xml"]);
  const rels = strFromU8(z["xl/_rels/workbook.xml.rels"]);
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: decode(m[1]), rid: m[2] }));
  const sheet = sheets.find((s) => (match instanceof RegExp ? match.test(s.name) : s.name === match));
  if (!sheet) throw new Error(`sheet ${match} not found in ${sheets.map((s) => s.name).join(", ")}`);
  const target = rels.match(new RegExp(`<Relationship [^>]*Id="${sheet.rid}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels.match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${sheet.rid}"`))[1];
  const path = "xl/" + target.replace(/^\/?xl\//, "");

  const shared = [];
  if (z["xl/sharedStrings.xml"]) {
    for (const si of strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(decode([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  }

  const rows = [];
  for (const rm of strFromU8(z[path]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const body = cm[2] ?? "";
      let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (type === "s") v = shared[+v];
      else if (type === "inlineStr") v = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (type === "str" || type === "e") v = v == null ? "" : decode(v);
      else if (v != null) v = Number(v);
      row[ref ? colIndex(ref) : row.length] = v ?? "";
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}
