// Exit 0 if any given data file changed vs HEAD other than its "fetchedAt" timestamp, else 1.
//   node scripts/data-changed.mjs public/data/markets.json public/data/polls/2027.json ...
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const strip = (txt) => { const j = JSON.parse(txt); delete j.fetchedAt; return JSON.stringify(j); };
for (const file of process.argv.slice(2)) {
  let before = null;
  try { before = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { /* new file */ }
  if (before == null || strip(before) !== strip(readFileSync(file, "utf8"))) {
    console.log(`changed: ${file}`);
    process.exit(0);
  }
}
console.log("No data change (timestamps only).");
process.exit(1);
