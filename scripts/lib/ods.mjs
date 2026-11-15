// Minimal .ods (OpenDocument spreadsheet) reader, no new dependency: uses fflate, already in package.json.
// Returns the rows of one sheet as arrays of cell values (numbers for float cells, else strings).
// Expands repeated cells and rows (table:number-columns-repeated / -rows-repeated), but caps the long empty
// runs LibreOffice writes to pad a sheet out to its last column or row.

import { unzipSync, strFromU8 } from "fflate";

const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) =>
    d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[n]);

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

export function readOdsSheet(buf, match) {
  const xml = strFromU8(unzipSync(new Uint8Array(buf), { filter: (f) => f.name === "content.xml" })["content.xml"]);
  const tables = [...xml.matchAll(/<table:table [^>]*table:name="([^"]+)"[^>]*>([\s\S]*?)<\/table:table>/g)];
  const t = match == null ? tables[0] : tables.find((m) => (match instanceof RegExp ? match.test(decode(m[1])) : decode(m[1]) === match));
  if (!t) throw new Error(`sheet ${match} not found in ${tables.map((m) => m[1]).join(", ")}`);
  const rows = [];
  for (const r of t[2].matchAll(/<table:table-row([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const cells = [];
    for (const c of (r[2] ?? "").matchAll(/<table:(?:covered-)?table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const rep = Math.min(Number(attr(c[1], "table:number-columns-repeated") ?? 1), 50);
      const type = attr(c[1], "office:value-type");
      const v = type === "float" || type === "percentage" || type === "currency"
        ? Number(attr(c[1], "office:value"))
        : decode((c[2] ?? "").replace(/<text:s[^>]*\/>/g, " ").replace(/<\/text:p>\s*<text:p[^>]*>/g, "\n").replace(/<[^>]+>/g, "")).trim();
      for (let i = 0; i < rep; i++) cells.push(v);
    }
    while (cells.length && (cells[cells.length - 1] === "" || cells[cells.length - 1] == null)) cells.pop();
    const rep = Math.min(Number(attr(r[1], "table:number-rows-repeated") ?? 1), cells.length ? 1000 : 1);
    for (let i = 0; i < rep; i++) rows.push(cells);
  }
  return rows;
}
