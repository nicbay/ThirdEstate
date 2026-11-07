// Bundle the per-commune files (public/data/communes/<code>.json, ~35,000 files) into one file per
// department (public/data/communes-dep/<dep>.json), so the deployment stays small in file count.
// The per-commune files remain the build input and are git-ignored.
//   node scripts/bundle-communes.mjs
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const SRC = new URL("../public/data/communes/", import.meta.url);
const OUT = new URL("../public/data/communes-dep/", import.meta.url);
const files = (await readdir(SRC)).filter((f) => /^[0-9AB]{5}\.json$/i.test(f));
const byDep = new Map();
for (const f of files) {
  const d = JSON.parse(await readFile(new URL(f, SRC), "utf8"));
  const dep = d.department?.code ?? (f.startsWith("97") ? f.slice(0, 3) : f.slice(0, 2));
  // the full council list is long; keep the first 12 names plus the count
  if (d.elected?.council?.list?.length > 12) d.elected.council.list = d.elected.council.list.slice(0, 12);
  (byDep.get(dep) ?? byDep.set(dep, {}).get(dep))[d.code] = d;
}
await mkdir(OUT, { recursive: true });
let total = 0;
for (const [dep, communes] of byDep) {
  const body = JSON.stringify({ department: dep, generated: new Date().toISOString().slice(0, 10), communes });
  total += body.length;
  await writeFile(new URL(`${dep}.json`, OUT), body);
}
console.log(`✓ ${files.length} communes → ${byDep.size} department bundles, ${(total / 1e6).toFixed(1)} MB`);
