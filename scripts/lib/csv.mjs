// Small RFC 4180 CSV parser (no dependency): quoted fields, doubled quotes, newlines inside quotes.
// parseCsv(text, sep) → array of rows (arrays of strings). csvObjects() keys rows by the header line.

export function parseCsv(text, sep = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

export function csvObjects(text, sep = ",") {
  const [header, ...rows] = parseCsv(text, sep);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// DOS code page 850 (some Ministry of the Interior CSV files use it, e.g. "1\x8Are" = "1ère")
const CP850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
export const decodeCp850 = (buf) => {
  let s = "";
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
  return s;
};

// French decimal ("1,25") or "NA" → number | null
export const num = (s) => {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const t = String(s).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "NA" || t === "nd" || t === "ns" || t === "s") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
