// Locale-aware display formatting for the election pages. Never use .toFixed() for text a reader sees:
// French writes "59,6 %" (decimal comma, narrow no-break space before %), English "59.6%".
// Every helper tolerates a missing value and shows "—" instead of throwing.
import { L, fmtPct, getLang } from "../i18n";

const loc = () => (getLang() === "fr" ? "fr-FR" : "en-GB");
const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
export const DASH = "—";

/** A decimal number in the reader's locale: 34,9 / 34.9. */
export const dec = (n: number | null | undefined, digits = 1) =>
  ok(n) ? n.toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }) : DASH;

/** A percentage: "59,6 %" (FR, narrow no-break space) / "59.6%" (EN). */
export const pct = (n: number | null | undefined, digits = 1) => fmtPct(n, digits);

/** A signed change: "+0,7" / "−0,7" (true minus sign); zero after rounding shows without a sign. */
export function signed(n: number | null | undefined, digits = 1) {
  if (!ok(n)) return DASH;
  const r = Number(n.toFixed(digits));
  if (r === 0) return dec(0, digits);
  return `${r > 0 ? "+" : "−"}${dec(Math.abs(r), digits)}`;
}

/** Points: "52,0 pts" (FR, no-break space) / "52.0 pts". */
export const pts = (n: number | null | undefined, digits = 1) => (ok(n) ? `${dec(n, digits)}${L(" ", " ")}${L("pts", "pts")}` : DASH);

/** Label–value separator: French puts a no-break space before the colon, English does not. */
export const colon = () => L(" : ", ": ");

/** Round a pair of shares so the two displayed integers add up to exactly 100. */
export function pair100(a: number, b: number): [number, number] {
  const s = a + b || 1;
  const ra = Math.round((100 * a) / s);
  return [ra, 100 - ra];
}
