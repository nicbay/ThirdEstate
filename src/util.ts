export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Map.groupBy, without needing an ES2024 runtime. */
export function groupBy<T, K>(items: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of items) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Only http(s) URLs from external data may reach href/src (security review M2). */
export const safeUrl = (u: unknown): string => {
  if (typeof u !== "string") return "#";
  try {
    const p = new URL(u, location.href);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "#";
  } catch {
    return "#";
  }
};

/** Colours from external data (group colours, candidate colours) may only be hex or hsl(); anything else falls back. */
const COLOR_RE = /^(#[0-9a-f]{3,8}|hsl\(\s*[\d.]+(deg)?[\s,]+[\d.]+%[\s,]+[\d.]+%\s*\))$/i;
export function safeColor(c: string, fallback?: string): string;
export function safeColor(c: string | null | undefined, fallback?: string): string | undefined;
export function safeColor(c: string | null | undefined, fallback = "#9aa0aa") {
  if (c == null) return undefined;
  return COLOR_RE.test(c.trim()) ? c.trim() : fallback;
}
