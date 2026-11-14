// Coats of arms for every commune and department that has one, from Wikidata (property P94, "coat of arms
// image"), pointing at the file on Wikimedia Commons. The site redraws each one as pixel art in the browser
// (src/lib/arms.ts), so all we keep is the file's path on upload.wikimedia.org.
//
//   npm run sync:arms
//
// Output:
//   public/data/arms/departements.json        { "91": "a/ab/Blason_departement_fr_Essonne.svg", ... }
//   public/data/arms/communes/<dep>.json      { "91228": "c/cd/Blason_ville_fr_Evry.svg", ... }
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../public/data/arms/", import.meta.url);
const UA = "third-estate-sync/1.0 (open data for a public-interest site)";

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
    if (r.ok) return (await r.json()).results.bindings;
    if (attempt >= 3) throw new Error(`Wikidata ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 5000 * attempt));
  }
}

/** "http://commons.wikimedia.org/wiki/Special:FilePath/Blason%20x.svg" → "a/ab/Blason_x.svg" (the upload path) */
function uploadPath(filePathUrl) {
  const name = decodeURIComponent(filePathUrl.split("/Special:FilePath/")[1] ?? "").replace(/ /g, "_");
  if (!name) return null;
  const h = createHash("md5").update(name).digest("hex");
  return `${h[0]}/${h.slice(0, 2)}/${name}`;
}
const depOf = (code) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));

// current items only (a merged or dissolved commune keeps its code on its old item)
const communes = await sparql(`SELECT ?code ?arms WHERE {
  ?i wdt:P374 ?code ; wdt:P94 ?arms .
  FILTER NOT EXISTS { ?i wdt:P576 [] }
}`);
const departements = await sparql(`SELECT ?code ?arms WHERE {
  ?i wdt:P2586 ?code ; wdt:P94 ?arms .
  FILTER NOT EXISTS { ?i wdt:P576 [] }
}`);

const deps = {};
for (const b of departements) {
  const code = b.code.value, p = uploadPath(b.arms.value);
  if (p && /^(\d{2}|2[AB]|97\d)$/.test(code) && !deps[code]) deps[code] = p;
}
const byDep = {};
for (const b of communes) {
  const code = b.code.value, p = uploadPath(b.arms.value);
  if (!p || !/^(\d{5}|2[AB]\d{3})$/.test(code)) continue;
  const d = depOf(code);
  (byDep[d] ??= {})[code] ??= p;
}

await mkdir(new URL("communes/", OUT), { recursive: true });
await writeFile(new URL("departements.json", OUT), JSON.stringify(deps));
for (const [d, m] of Object.entries(byDep)) await writeFile(new URL(`communes/${d}.json`, OUT), JSON.stringify(m));
const n = Object.values(byDep).reduce((s, m) => s + Object.keys(m).length, 0);
console.log(`arms: ${Object.keys(deps).length} departments, ${n} communes in ${Object.keys(byDep).length} department files`);
