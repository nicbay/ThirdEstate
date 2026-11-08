// Sync official Assemblée nationale open data (17th legislature) into small JSON files
// the website reads. Source: https://data.assemblee-nationale.fr (refreshed daily).
//
//   npm run sync:an
//
// Output (public/data/an/):
//   meta.json        sync time + source timestamps
//   deputes.json     one entry per sitting MP (identity, group, district, socials, vote stats)
//   scrutins.json    every public vote: [numero, date, titre, sort, demandeur, pour, contre, abst]
//   votes/<PA>.json  that MP's position on each vote: { numero: "P" | "C" | "A" | "N" }
//   loyalty.json     how often each MP votes with their group (method in scripts/lib/loyalty.mjs)

import { mkdir, writeFile, rm } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { loyaltyTracker } from "./lib/loyalty.mjs";

const LEG = 17;
const SOURCES = {
  deputes: `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip`,
  scrutins: `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}/loi/scrutins/Scrutins.json.zip`,
};
const OUT = new URL("../public/data/an/", import.meta.url);

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

async function fetchZip(url) {
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return { files, lastModified: res.headers.get("last-modified") };
}

const json = (u8) => JSON.parse(strFromU8(u8));

// ---------- deputies + organs ----------
const amo = await fetchZip(SOURCES.deputes);
const organes = new Map();
const acteurs = [];
for (const [path, data] of Object.entries(amo.files)) {
  if (path.startsWith("json/organe/")) {
    const o = json(data).organe;
    organes.set(o.uid, o);
  } else if (path.startsWith("json/acteur/")) {
    acteurs.push(json(data).acteur);
  }
}

const SOCIAL = { Twitter: "twitter", Instagram: "instagram", Facebook: "facebook", LinkedIn: "linkedin", Linkedin: "linkedin", Bluesky: "bluesky", TikTok: "tiktok", Youtube: "youtube", YouTube: "youtube", "Site internet": "website" };

const deputes = [];
for (const a of acteurs) {
  const mandats = arr(a.mandats?.mandat);
  const an = mandats.find((m) => m.typeOrgane === "ASSEMBLEE" && !m.dateFin && m.legislature === String(LEG));
  if (!an) continue;
  const gp = mandats.find((m) => m.typeOrgane === "GP" && !m.dateFin);
  const g = gp ? organes.get(gp.organes.organeRef) : null;
  const lieu = an.election?.lieu ?? {};
  const socials = {};
  let email = null;
  for (const ad of arr(a.adresses?.adresse)) {
    if (ad.type === "15" && ad.valElec) email = ad.valElec; // type 15 = e-mail
    const key = SOCIAL[ad.typeLibelle];
    if (key && ad.valElec) socials[key] = ad.valElec;
  }
  const ec = a.etatCivil;
  // Some records have an empty XML node (parsed as an object) instead of a string.
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  // the source spells this family two ways; use INSEE's label
  const fam = str(a.profession?.socProcINSEE?.famSocPro)?.replace(/^Artisans.*$/, "Artisans, commerçants et chefs d'entreprise") ?? null;
  const depNum = lieu.numDepartement === "099" ? "99" : lieu.numDepartement ?? null;
  deputes.push({
    id: a.uid["#text"],
    civ: ec.ident.civ,
    prenom: ec.ident.prenom,
    nom: ec.ident.nom,
    alpha: ec.ident.alpha,
    naissance: ec.infoNaissance?.dateNais ?? null,
    profession: str(a.profession?.libelleCourant)?.replace(/^\(\d+\)\s*-\s*/, "") ?? null,
    catSocPro: str(a.profession?.socProcINSEE?.catSocPro),
    famSocPro: fam,
    hatvp: a.uri_hatvp ?? null,
    email,
    socials,
    groupe: g ? { id: g.uid, abrev: g.libelleAbrev, libelle: g.libelle, couleur: g.couleurAssociee } : null,
    region: lieu.region ?? null,
    departement: lieu.departement ?? null,
    numDepartement: depNum,
    numCirco: lieu.numCirco ? Number(lieu.numCirco) : null,
    // district code shared with the map and results: department + 2-digit district ("0104", "97101", "9901")
    circo: depNum && lieu.numCirco ? depNum + String(lieu.numCirco).padStart(2, "0") : null,
    debutMandat: an.dateDebut,
  });
}
const sitting = new Set(deputes.map((d) => d.id));
console.log(`✓ ${deputes.length} sitting MPs`);

// ---------- votes ----------
const scr = await fetchZip(SOURCES.scrutins);
const scrutins = [];
const votes = new Map(deputes.map((d) => [d.id, {}]));
const POS = { pours: "P", contres: "C", abstentions: "A", nonVotants: "N" };
const loyalty = loyaltyTracker({ sitting, organes, deputes });

for (const data of Object.values(scr.files)) {
  const s = json(data).scrutin;
  const num = Number(s.numero);
  const d = s.syntheseVote?.decompte ?? {};
  loyalty.add(s);
  scrutins.push([num, s.dateScrutin, s.titre ?? s.objet?.libelle ?? "", s.sort?.code ?? "", s.demandeur?.texte ?? "", Number(d.pour ?? 0), Number(d.contre ?? 0), Number(d.abstentions ?? 0)]);
  for (const grp of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
    const nominatif = grp.vote?.decompteNominatif ?? {};
    for (const [key, letter] of Object.entries(POS)) {
      for (const v of arr(nominatif[key]?.votant)) {
        if (sitting.has(v.acteurRef)) votes.get(v.acteurRef)[num] = letter;
      }
    }
  }
}
scrutins.sort((a, b) => b[0] - a[0]);
console.log(`✓ ${scrutins.length} votes (scrutins)`);

// Stats: participation = votes cast / scrutins held since the MP took their seat.
for (const dep of deputes) {
  const v = votes.get(dep.id);
  const c = { P: 0, C: 0, A: 0, N: 0 };
  for (const x of Object.values(v)) c[x]++;
  const held = scrutins.filter((s) => s[1] >= dep.debutMandat).length;
  dep.stats = { pour: c.P, contre: c.C, abstention: c.A, nonVotant: c.N, scrutins: held, participation: held ? (c.P + c.C + c.A) / held : 0 };
}
deputes.sort((a, b) => a.alpha.localeCompare(b.alpha, "fr"));

// ---------- write ----------
await rm(new URL("votes/", OUT), { recursive: true, force: true });
await mkdir(new URL("votes/", OUT), { recursive: true });
await writeFile(new URL("deputes.json", OUT), JSON.stringify(deputes));
await writeFile(new URL("scrutins.json", OUT), JSON.stringify(scrutins));
const loyal = loyalty.result();
await writeFile(new URL("loyalty.json", OUT), JSON.stringify(loyal));
console.log(`✓ loyalty: ${loyal.ranked} MPs ranked`);
for (const [id, v] of votes) await writeFile(new URL(`votes/${id}.json`, OUT), JSON.stringify(v));
await writeFile(
  new URL("meta.json", OUT),
  JSON.stringify({ syncedAt: new Date().toISOString(), legislature: LEG, sources: { deputes: { url: SOURCES.deputes, lastModified: amo.lastModified }, scrutins: { url: SOURCES.scrutins, lastModified: scr.lastModified } } }, null, 2),
);
console.log("✓ wrote public/data/an/");
