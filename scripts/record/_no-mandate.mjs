// Shared by the record scripts of candidates who never sat in Parliament (lisnard, villepin, arthaud).
// Checks the open rosters for the name, then writes a record file that says plainly nothing could be compared.
//   - Assemblée nationale: every actor with a mandate in the AMO30 historical archive (legislatures 12–16)
//     plus the sitting MPs (public/data/an/deputes.json, 17th legislature)
//   - Sénat: ODSEN_GENERAL.csv (all senators since 1959)
//   - European Parliament: MEP directories of the 9th (2019) and 10th (2024) terms
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

const ROOT = new URL("../../", import.meta.url);
const CACHE = new URL(".cache/record/", ROOT);
const SOURCES = {
  amo: ["16_AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip", "https://data.assemblee-nationale.fr/static/openData/repository/16/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip"],
  senat: ["senateurs.csv", "https://data.senat.fr/data/senateurs/ODSEN_GENERAL.csv"],
  pe9: ["meps9.xml", "https://www.europarl.europa.eu/meps/en/directory/xml/?leg=9"],
  pe10: ["meps10.xml", "https://www.europarl.europa.eu/meps/en/directory/xml/?leg=10"],
};

async function cached([name, url]) {
  const file = new URL(name, CACHE);
  try { await access(file); } catch {
    await mkdir(CACHE, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  }
  return readFile(file);
}

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Returns the chambers in which someone with this first name + surname appears. */
export async function findMandates(first, last) {
  const f = norm(first), l = norm(last);
  const found = [];
  const amo = unzipSync(new Uint8Array(await cached(SOURCES.amo)), { filter: (x) => x.name.includes("/acteur/") });
  for (const data of Object.values(amo)) {
    const id = JSON.parse(strFromU8(data)).acteur.etatCivil.ident;
    if (norm(id.nom) === l && norm(id.prenom) === f) found.push("AN (2002-2024)");
  }
  const deputes = JSON.parse(await readFile(new URL("public/data/an/deputes.json", ROOT), "utf8"));
  if (deputes.some((d) => norm(d.nom) === l && norm(d.prenom) === f)) found.push("AN (2024-)");
  // the Senate CSV is Latin-1: compare on the surname column and the first-name column
  for (const line of new TextDecoder("latin1").decode(await cached(SOURCES.senat)).split("\n")) {
    const c = line.split(",");
    if (c[2] && norm(c[2]).endsWith(l) && norm(c[3] ?? "") === f) found.push("Sénat");
  }
  for (const k of ["pe9", "pe10"]) {
    const xml = (await cached(SOURCES[k])).toString("utf8");
    for (const m of xml.matchAll(/<fullName>([^<]*)<\/fullName>/g)) if (norm(m[1]).includes(l) && norm(m[1]).includes(f)) found.push(`PE (${k})`);
  }
  return found;
}

export async function writeNoMandateRecord({ slug, first, last, people, notCovered }) {
  const found = await findMandates(first, last);
  if (found.length) throw new Error(`${first} ${last} appears in: ${found.join(", ")} — this candidate needs a real record script`);
  const out = { generated: new Date().toISOString(), coverage: [], notCovered, people, contradictions: [] };
  const file = new URL(`public/data/programmes/record/${slug}.json`, ROOT);
  await mkdir(new URL("./", file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ ${first} ${last}: no mandate found in AN, Sénat or PE rosters → ${slug}.json`);
}
