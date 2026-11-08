// File names built from remote identifiers (Assemblée uids, MP ids, INSEE codes) must not escape their folder:
// a compromised or malformed source could send "../../.github/workflows/x". Letters, digits, "_" and "-" only.
export function safeName(id) {
  const s = String(id ?? "");
  if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) return s;
  console.warn(`skipped unsafe file name from remote data: ${JSON.stringify(s).slice(0, 80)}`);
  return null;
}
