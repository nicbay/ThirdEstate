// After `vite build`: one HTML file per page, so search engines and link previews (LinkedIn, X, WhatsApp…) see
// each page's own title, description and a readable summary before any script runs. The app then takes over and
// draws the full page in place of the summary.
//
// Writes, into dist/:
//   <path>.html         for every section, MP, district, senator, MEP, candidate, programme, election, town…
//   app.html            the bare app, served (vercel.json) for any other address (a simulator link, a comparison)
//   sitemap.xml + sitemap-*.xml, robots.txt
//
// Everything comes from the data already in public/data. Pages are in French, the site's default language.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ORIGIN = "https://www.thirdestate.fr";
const DIST = "dist";
const DATA = "public/data";
const TODAY = new Date().toISOString().slice(0, 10);
const json = (p) => JSON.parse(readFileSync(join(DATA, p), "utf8"));
const tryJson = (p) => { try { return json(p); } catch { return null; } };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");
const nf = (n) => Math.round(n).toLocaleString("fr-FR").replace(/\u202f/g, " ");
const ord = (n) => (n === 1 ? "1re" : `${n}e`);
/** "Emmanuel GRÉGOIRE" → "Emmanuel Grégoire" (the registers write surnames in capitals) */
const titleCase = (s) => String(s ?? "").replace(/(^|[\s\-’'])([A-ZÀ-Ý])([A-ZÀ-Ý]+)/gu, (_, p, a, b) => p + a + b.toLowerCase()).trim();
/** "de" with French elision: "d’Emmanuel", "de Marine" */
const de = (w) => (/^[aeiouyhàâéèêîôûAEIOUYHÀÂÉÈÊÎÔÛ]/.test(w) ? `d’${w}` : `de ${w}`);
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const frDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return y && m && d ? `${d === 1 ? "1er" : d} ${MONTHS[m - 1]} ${y}` : String(iso); };

// the built shell, kept aside so the script can run again on the same dist/ (index.html becomes the homepage)
const SHELL = ".cache/shell.html";
let template = readFileSync(join(DIST, "index.html"), "utf8");
if (template.includes('<main id="app" tabindex="-1"></main>')) { mkdirSync(".cache", { recursive: true }); writeFileSync(SHELL, template); }
else if (existsSync(SHELL)) template = readFileSync(SHELL, "utf8");
if (!template.includes('<main id="app" tabindex="-1"></main>')) throw new Error("prerender: dist/index.html has no empty <main id=\"app\">");

/** @type {{ loc: string, group: string, priority: number }[]} */
const urls = [];

function htmlFor({ path, title, desc, body, ld, image }) {
  const url = ORIGIN + (path === "/" ? "/" : path);
  const fullTitle = path === "/" ? title : `${title} — Third Estate`;
  const d = clip(desc, 200);
  let h = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(d)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(fullTitle)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(d)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${esc(url)}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${esc(url)}"`);
  if (image) h = h.replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(image)}"`).replace(/\s*<meta property="og:image:(width|height)"[^>]*>/g, "");
  const lds = (ld ?? []).map((o) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o }).replace(/</g, "\\u003c")}</script>`).join("");
  h = h.replace("</head>", `    ${lds}\n  </head>`);
  return h.replace('<main id="app" tabindex="-1"></main>', `<main id="app" tabindex="-1"><div class="page pad prerendered" data-path="${esc(path)}">${body}</div></main>`);
}

function crumbsHtml(trail) {
  return `<p class="crumbs">${trail.map(([name, href]) => `<a href="${esc(href)}">${esc(name)}</a>`).join(" › ")}</p>`;
}
function crumbsLd(trail, last) {
  const items = [...trail, last].map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, item: ORIGIN + href }));
  return { "@type": "BreadcrumbList", itemListElement: items };
}
const linkList = (items) => `<ul>${items.map(([name, href, note]) => `<li><a href="${esc(href)}">${esc(name)}</a>${note ? ` — ${esc(note)}` : ""}</li>`).join("")}</ul>`;

/**
 * One page. `trail` is the breadcrumb above it ([name, href] pairs, home first); `sections` are [heading, html]
 * blocks under the summary.
 */
function page({ path, title, h1, desc, trail = [["Accueil", "/"]], sections = [], ld = [], image, group = "pages", priority = 0.5 }) {
  const body = `${crumbsHtml(trail)}<header class="page-head"><h1>${esc(h1 ?? title)}</h1><p>${esc(desc)}</p></header>`
    + sections.map(([head, html]) => `<section><h2>${esc(head)}</h2>${html}</section>`).join("");
  const ldAll = path === "/" ? ld : [...ld, crumbsLd(trail, [h1 ?? title, path])];
  // /depute/PA123 → dist/depute/PA123.html, served at /depute/PA123 (vercel.json: cleanUrls)
  const out = path === "/" ? join(DIST, "index.html") : join(DIST, `${path.slice(1)}.html`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, htmlFor({ path, title, desc, body, ld: ldAll, image }));
  urls.push({ loc: ORIGIN + path, group, priority });
}

// ---------------------------------------------------------------- data
const deputes = json("an/deputes.json");
const senateurs = json("senat/senateurs.json");
const meps = json("pe/meps.json").filter((m) => m.current !== false);
const candidates = json("candidates/index.json").candidates;
const programmes = json("programmes/index.json").programmes;
const elections = json("history/presidential/index.json").elections;
const depFiles = readdirSync(join(DATA, "communes-dep")).filter((f) => /^\w{2,3}\.json$/.test(f)).sort();
const departments = depFiles.map((f) => json(`communes-dep/${f}`));
const districtCodes = readdirSync(join(DATA, "districts")).filter((f) => /^\w{4,5}\.json$/.test(f)).map((f) => f.replace(".json", "")).sort();
const mpByCirco = new Map(deputes.map((d) => [d.circo, d]));
const RANK_N = tryJson("rankings/meta.json")?.n ?? {};
const townsOfDistrict = new Map();
for (const f of readdirSync(join(DATA, "communes-dep")).filter((x) => /^\w{2,3}\.json$/.test(x))) {
  for (const c of Object.values(json(`communes-dep/${f}`).communes ?? {})) {
    if (c.type !== "commune") continue;
    for (const d of c.districts ?? []) townsOfDistrict.set(d.code, [...(townsOfDistrict.get(d.code) ?? []), [c, (c.population?.value ?? 0) * d.share]]);
  }
}
const leg24 = tryJson("results/legislatives-2024-t1.json")?.circos ?? {};
const NUANCE = { RN: "Rassemblement national", UG: "Union de la gauche (NFP)", ENS: "Ensemble", LR: "Les Républicains", UXD: "Union de l’extrême droite (LR-RN)", DVG: "Divers gauche", DVD: "Divers droite", DVC: "Divers centre", DIV: "Divers", DSV: "Droite souverainiste", ECO: "Écologistes", REC: "Reconquête", HOR: "Horizons", UDI: "UDI", EXG: "Extrême gauche", REG: "Régionalistes", EXD: "Extrême droite", RDG: "Radicaux de gauche", FI: "La France insoumise", SOC: "Parti socialiste", COM: "Parti communiste", VEC: "Les Écologistes" };
const fem = (p) => p.civ === "Mme" || p.feminin === true;
const factList = (rows) => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
const ageOf = (iso) => { const b = new Date(iso); if (isNaN(+b)) return null; const n = new Date(); return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0); };
const pct = (x) => `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;
const leg24Html = (code) => {
  const r = leg24[code];
  if (!r?.c?.length) return null;
  return `<p>Premier tour, 30 juin 2024 (${nf(r.e)} suffrages exprimés) :</p><ul>${r.c.slice(0, 6).map(([n, p, e]) => `<li>${esc(NUANCE[n] ?? n)} : ${String(p).replace(".", ",")} %${e === "E" ? " (élu·e dès le premier tour)" : ""}</li>`).join("")}</ul>`;
};
const AN_PHOTO = (id) => `https://www2.assemblee-nationale.fr/static/tribun/17/photos/carre/${String(id).slice(2).replace(/D/g, "")}.jpg`;

// ---------------------------------------------------------------- sections
const SECTIONS = [
  ["/2027", "Présidentielle 2027 : la course", "Où en est la présidentielle 2027 : la prévision, les sondages, les marchés prédictifs, les candidats et leurs fiches.", 0.9],
  ["/sondages", "Sondages présidentielle 2027 et marchés prédictifs", "Chaque sondage de la présidentielle 2027, la moyenne, et ce que parient les marchés prédictifs (Polymarket, Kalshi).", 0.9],
  ["/sondages/instituts", "Les instituts de sondage notés", "Les instituts de sondage français notés de A+ à F, sur leurs sondages passés face aux résultats.", 0.6],
  ["/simulateur", "Simulateur de second tour 2027", "Composez votre second tour de la présidentielle 2027, report de voix par report de voix.", 0.8],
  ["/programmes", "Les programmes des candidats à la présidentielle 2027", "Les programmes de tous les candidats à la présidentielle 2027, de la gauche à la droite : mesures, coûts chiffrés, faisabilité juridique.", 0.9],
  ["/programmes/melenchon/simulateur", "Votre budget selon un programme", "L’effet d’un programme présidentiel sur le budget de votre foyer : impôts, prestations, salaires.", 0.6],
  ["/quiz", "Le quiz : quel candidat vous ressemble ?", "Répondez à quelques questions : le député et le candidat à la présidentielle 2027 les plus proches de vos positions.", 0.9],
  ["/quiz/citations", "Le quiz des citations", "Qui a dit quoi ? Des citations de responsables politiques français, à attribuer.", 0.5],
  ["/2027/voter", "Comment voter en 2027", "S’inscrire sur les listes électorales, voter par procuration, trouver son bureau de vote pour la présidentielle 2027.", 0.7],
  ["/2027/comment-ca-marche", "Comment marche l’élection présidentielle", "L’élection présidentielle française expliquée, étape par étape : parrainages, campagne, premier et second tours.", 0.6],
  ["/2027/calendrier", "Calendrier de la présidentielle 2027", "Les dates clés de la campagne présidentielle 2027, jusqu’au second tour.", 0.7],
  ["/2027/parrainages", "Les parrainages de la présidentielle", "Les 500 signatures d’élus nécessaires pour être candidat à la présidentielle : qui a parrainé qui.", 0.6],
  ["/elus", "Vos élus", "Députés, sénateurs, eurodéputés : qui ils sont, comment ils votent, ce qu’ils disent.", 0.7],
  ["/assemblee", "Les députés de l’Assemblée nationale", "Les 577 députés : la carte des circonscriptions, qui ils sont, comment ils votent, ce qu’ils disent en séance.", 0.8],
  ["/assemblee/deputes", "Trouver un député", "Tous les députés de l’Assemblée nationale, par nom, groupe ou département.", 0.8],
  ["/assemblee/composition", "Composition de l’Assemblée nationale", "Les groupes politiques de l’Assemblée nationale, leur poids, l’âge, le sexe et la profession des députés.", 0.6],
  ["/assemblee/loyaute", "Discipline de vote des députés", "Quels députés votent avec leur groupe, lesquels s’en écartent.", 0.6],
  ["/assemblee/themes", "Ce que disent les députés en séance", "Les mots et les thèmes des interventions des députés dans l’hémicycle.", 0.5],
  ["/senat", "Les sénateurs", "Les 348 sénateurs : leurs groupes, leurs votes, ce qu’ils disent.", 0.7],
  ["/europe", "Les eurodéputés français", "Les élus français au Parlement européen : leurs votes et leurs discours.", 0.6],
  ["/explorer", "Toutes les communes de France", "Maire, conseil municipal, député, écoles, sécurité, finances : chacune des 34 920 communes de France.", 0.8],
  ["/comparer", "Comparer deux communes", "Votre commune face à une autre : revenus, sécurité, impôts, finances, services.", 0.6],
  ["/classements", "Classements des communes", "Qualité de vie, revenus, sécurité, prix de l’immobilier, finances : chaque commune de France classée.", 0.7],
  ["/resultats", "Toutes les élections présidentielles depuis 1848", "Les résultats de chaque élection présidentielle française depuis 1848 : cartes, chiffres, annonces filmées.", 0.7],
  ["/resultats/presidentielle-2022", "Présidentielle 2022 : sondages et résultat", "La présidentielle 2022 : les sondages face au résultat, candidat par candidat.", 0.6],
  ["/resultats/legislatives-2024", "Législatives 2024 : les résultats", "Les résultats des élections législatives 2024, circonscription par circonscription.", 0.7],
  ["/resultats/bascules", "Cartes des bascules gauche-droite", "Où la France a glissé à gauche, où elle a glissé à droite, élection après élection.", 0.6],
  ["/chiffres", "La France en chiffres", "La dette publique en direct, l’emploi, les prix, le déficit : la France en chiffres, président par président.", 0.7],
  ["/sources", "Sources et méthode", "D’où viennent les données de Third Estate, et comment elles sont traitées.", 0.3],
  ["/mentions-legales", "Mentions légales et contact", "Mentions légales, données personnelles, et comment écrire à Third Estate (contact@thirdestate.fr) : signaler une erreur, demander une rectification, presse et recherche.", 0.3],
  ["/contributeurs", "Les contributeurs", "Les personnes qui ont contribué à Third Estate.", 0.2],
];
const sectionLinks = linkList(SECTIONS.slice(0, 28).map(([p, t]) => [t, p]));

// ---------------------------------------------------------------- home
page({
  path: "/",
  title: "Third Estate — Élections et vie publique en France",
  h1: "Third Estate : les élections et la vie publique en France",
  desc: "Sondages et prévision de la présidentielle 2027, programmes des candidats, résultats de chaque élection depuis 1848, vos députés et sénateurs et leurs votes, la vie de votre commune. Sources publiques, méthode ouverte.",
  sections: [
    ["Rubriques", sectionLinks],
    ["Candidats à la présidentielle 2027", linkList(candidates.map((c) => [c.name, `/candidat/${c.slug}`, c.party?.fr]))],
    ["Les plus grandes villes", linkList(departments.flatMap((d) => Object.values(d.communes ?? {})).filter((c) => c.type === "commune" && c.population?.value).sort((a, b) => b.population.value - a.population.value).slice(0, 40).map((c) => [c.name, `/ville/${c.code}`, c.department?.name]))],
  ],
  ld: [
    { "@type": "WebSite", name: "Third Estate", url: ORIGIN + "/", inLanguage: ["fr", "en"], description: "Élections et vie publique en France : sondages, prévisions, résultats, élus, communes." },
    { "@type": "Organization", name: "Third Estate", url: ORIGIN + "/", logo: ORIGIN + "/favicon.svg", email: "contact@thirdestate.fr", contactPoint: { "@type": "ContactPoint", email: "contact@thirdestate.fr", contactType: "customer support", availableLanguage: ["fr", "en"] } },
  ],
  priority: 1,
});

for (const [p, t, d, pr] of SECTIONS) {
  let sections = [["Ailleurs sur Third Estate", sectionLinks]];
  if (p === "/assemblee" || p === "/assemblee/deputes") sections = [["Les députés", linkList([...deputes].sort((a, b) => a.alpha.localeCompare(b.alpha, "fr")).map((m) => [`${m.prenom} ${m.nom}`, `/depute/${m.id}`, `${m.groupe?.abrev ?? ""}, ${m.departement ?? ""}`]))], ...sections];
  if (p === "/senat") sections = [["Les sénateurs", linkList([...senateurs].sort((a, b) => a.alpha.localeCompare(b.alpha, "fr")).map((s) => [`${s.prenom} ${s.nom}`, `/senateur/${s.id}`, `${s.groupe?.abrev ?? ""}, ${s.circonscription ?? ""}`]))], ...sections];
  if (p === "/europe") sections = [["Les eurodéputés", linkList(meps.map((m) => [`${m.prenom} ${m.nom}`, `/eurodepute/${m.id}`, m.groupe?.libelle]))], ...sections];
  if (p === "/explorer") sections = [["Les départements", linkList(departments.map((d) => [`${d.communes[Object.keys(d.communes)[0]]?.department?.name ?? d.department} (${d.department})`, `/explorer/${d.department}`]))], ...sections];
  if (p === "/programmes") sections = [["Programme par candidat", linkList(programmes.map((x) => [`${x.candidate} — ${x.programme ?? "programme"}`, `/programmes/${x.slug}`, x.party]))], ...sections];
  if (p === "/2027") sections = [["Les candidats", linkList(candidates.map((c) => [c.name, `/candidat/${c.slug}`, c.party?.fr]))], ...sections];
  if (p === "/resultats") sections = [["Chaque élection présidentielle", linkList(elections.map((e) => [e.title.fr, `/histoire/${e.id}`, e.winner?.name ? `élu : ${e.winner.name}` : ""]))], ...sections];
  if (p === "/classements") sections = [["Les classements", linkList(RANKINGS().map(([slug, t]) => [t, `/classements/${slug}`]))], ...sections];
  page({ path: p, title: t, desc: d, sections, priority: pr });
}

// ---------------------------------------------------------------- rankings (slugs and titles from src/lib/rankings.ts)
function RANKINGS() {
  const src = readFileSync("src/lib/rankings.ts", "utf8");
  const out = [...src.matchAll(/slug: "([\w-]+)"[^\n]*?title: \["([^"]+)"/g)].map((m) => [m[1], m[2]]);
  const crime = src.match(/const CRIME[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (crime) for (const m of crime[1].matchAll(/\["(\w+)", "([^"]+)"/g)) out.push([`delinquance-${m[1]}`, `Les communes les plus sûres : ${m[2].toLowerCase()}`]);
  return out;
}
for (const [slug, t] of RANKINGS()) {
  page({ path: `/classements/${slug}`, title: t, desc: `${t}. Le classement de toutes les communes de France, avec la position de la vôtre. Données publiques (INSEE, ministère de l’Intérieur, DGFiP).`, trail: [["Accueil", "/"], ["Classements des communes", "/classements"]], priority: 0.5 });
}

// ---------------------------------------------------------------- MPs and districts
for (const m of deputes) {
  const name = `${m.prenom} ${m.nom}`;
  const role = fem(m) ? "Députée" : "Député";
  const where = m.numCirco ? `de la ${ord(m.numCirco)} circonscription ${m.departement ? `(${m.departement})` : ""}`.trim() : "";
  const part = m.stats?.participation != null ? ` Participation aux votes : ${Math.round(100 * m.stats.participation)} %.` : "";
  const desc = `${name}, ${role.toLowerCase()} ${m.groupe?.abrev ?? ""} ${where}. Ses votes à l’Assemblée nationale, sa présence, ses interventions en séance, sa fidélité à son groupe.${part}`.replace(/\s+/g, " ");
  page({
    path: `/depute/${m.id}`, title: `${name}, ${role.toLowerCase()}${m.departement ? ` (${m.departement}${m.numCirco ? `, ${ord(m.numCirco)} circonscription` : ""})` : ""}`, h1: name, desc,
    trail: [["Accueil", "/"], ["Les députés", "/assemblee"]],
    sections: [
      ["En bref", factList([
        ["Groupe", m.groupe?.libelle ?? "—"],
        m.circo && ["Circonscription", `${m.departement ?? ""}, ${ord(m.numCirco)} circonscription`],
        m.profession && ["Profession", m.profession],
        m.naissance && ageOf(m.naissance) && ["Âge", `${ageOf(m.naissance)} ans`],
        m.debutMandat && [`${role} depuis le`, frDate(m.debutMandat)],
        m.stats?.scrutins && ["Votes", `${nf(m.stats.pour ?? 0)} pour, ${nf(m.stats.contre ?? 0)} contre, ${nf(m.stats.abstention ?? 0)} abstentions, sur ${nf(m.stats.scrutins)} scrutins publics`],
        m.stats?.participation != null && ["Participation aux scrutins", pct(m.stats.participation)],
      ])],
      ...(m.circo && leg24Html(m.circo) ? [["Législatives 2024 dans sa circonscription", leg24Html(m.circo)]] : []),
      ["Ailleurs", linkList([
        ...(m.circo ? [[`La ${ord(m.numCirco)} circonscription ${m.departement ? `(${m.departement})` : ""} : communes et résultats`, `/circo/${m.circo}`]] : []),
        ...(m.numDepartement && m.numDepartement !== "99" ? [[`Les communes du département`, `/explorer/${m.numDepartement}`], [`Les sénateurs du département`, `/senat/${m.numDepartement}`]] : []),
        ...deputes.filter((o) => o.numDepartement === m.numDepartement && o.id !== m.id).slice(0, 8).map((o) => [`${o.prenom} ${o.nom}, ${fem(o) ? "députée" : "député"} ${o.groupe?.abrev ?? ""}`, `/depute/${o.id}`]),
        ...(m.hatvp ? [["Sa déclaration d’intérêts (HATVP)", m.hatvp]] : []),
      ])],
    ],
    image: AN_PHOTO(m.id),
    ld: [{ "@type": "Person", name, givenName: m.prenom, familyName: m.nom, jobTitle: role, ...(m.profession ? { hasOccupation: { "@type": "Occupation", name: m.profession } } : {}), ...(m.groupe?.libelle ? { memberOf: { "@type": "Organization", name: m.groupe.libelle } } : {}), url: ORIGIN + `/depute/${m.id}`, image: AN_PHOTO(m.id), ...(m.naissance ? { birthDate: m.naissance } : {}) }],
    group: "elus", priority: 0.7,
  });
}
for (const code of districtCodes) {
  const dj = tryJson(`districts/${code}.json`);
  if (!dj) continue;
  const mp = mpByCirco.get(code);
  const label = `${dj.department?.name ?? ""} : ${dj.label ?? code}`;
  page({
    path: `/circo/${code}`, title: `${dj.department?.name ? `${dj.department.name} : ` : ""}${dj.label ?? "circonscription"}, résultats et député`, h1: label,
    desc: `La ${dj.label ?? "circonscription"} ${dj.department?.name ? `(${dj.department.name})` : ""} : ${mp ? `son ${fem(mp) ? "députée" : "député"}, ${mp.prenom} ${mp.nom} (${mp.groupe?.abrev ?? ""}), ` : ""}les résultats des législatives 2024, ses communes, son profil.`.replace(/\s+/g, " "),
    trail: [["Accueil", "/"], ["Les députés", "/assemblee"]],
    sections: [
      ...(mp ? [[fem(mp) ? "La députée" : "Le député", linkList([[`${mp.prenom} ${mp.nom}`, `/depute/${mp.id}`, mp.groupe?.libelle]])]] : []),
      ...(leg24Html(code) ? [["Législatives 2024", leg24Html(code)]] : []),
      ...(townsOfDistrict.get(code)?.length ? [["Ses communes", linkList(townsOfDistrict.get(code).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => [c.name, `/ville/${c.code}`]))]] : []),
    ],
    ...(mp ? { image: AN_PHOTO(mp.id) } : {}),
    group: "elus", priority: 0.5,
  });
}

// ---------------------------------------------------------------- senators, MEPs
for (const s of senateurs) {
  const name = `${s.prenom} ${s.nom}`;
  const role = fem(s) ? "Sénatrice" : "Sénateur";
  page({
    path: `/senateur/${s.id}`, title: `${name}, ${role.toLowerCase()} ${s.circonscription ? `(${s.circonscription})` : ""}`.trim(), h1: name,
    desc: `${name}, ${role.toLowerCase()} ${s.groupe?.abrev ?? ""} ${s.circonscription ? `(${s.circonscription})` : ""}. Ses votes au Sénat, ses interventions, sa commission.`.replace(/\s+/g, " "),
    trail: [["Accueil", "/"], ["Les sénateurs", "/senat"]],
    sections: [
      ["En bref", factList([
        s.groupe?.libelle && ["Groupe", s.groupe.libelle],
        s.circonscription && ["Département", s.circonscription],
        s.commission?.libelle && ["Commission", `${s.commission.libelle}${s.commission.fonction && s.commission.fonction !== "Membre" ? ` (${s.commission.fonction.toLowerCase()})` : ""}`],
        s.profession && ["Profession", s.profession],
        s.naissance && ageOf(s.naissance) && ["Âge", `${ageOf(s.naissance)} ans`],
        s.serie && ["Série", `${s.serie} (renouvellement par moitié tous les trois ans)`],
        s.stats?.scrutins && ["Votes", `${nf(s.stats.pour ?? 0)} pour, ${nf(s.stats.contre ?? 0)} contre, ${nf(s.stats.abstention ?? 0)} abstentions, sur ${nf(s.stats.scrutins)} scrutins publics`],
        s.stats?.participation != null && ["Participation aux scrutins", pct(s.stats.participation)],
      ])],
      ...(s.numDepartement ? [["Ailleurs", linkList([
        [`Les sénateurs du département (${s.circonscription ?? ""})`, `/senat/${s.numDepartement}`],
        [`Les communes du département`, `/explorer/${s.numDepartement}`],
        ...deputes.filter((o) => o.numDepartement === s.numDepartement).slice(0, 8).map((o) => [`${o.prenom} ${o.nom}, ${fem(o) ? "députée" : "député"} ${o.groupe?.abrev ?? ""}`, `/depute/${o.id}`]),
      ])]] : []),
    ],
    ld: [{ "@type": "Person", name, givenName: s.prenom, familyName: s.nom, jobTitle: role, ...(s.groupe?.libelle ? { memberOf: { "@type": "Organization", name: s.groupe.libelle } } : {}), url: ORIGIN + `/senateur/${s.id}` }],
    group: "elus", priority: 0.6,
  });
}
const senDeps = new Map();
for (const s of senateurs) if (s.numDepartement) senDeps.set(s.numDepartement, [...(senDeps.get(s.numDepartement) ?? []), s]);
for (const [dep, list] of senDeps) {
  const name = list[0].circonscription ?? dep;
  page({
    path: `/senat/${dep}`, title: `Sénateurs : ${name} (${dep})`, desc: `${name} (${dep}), ${list.length} sénateur${list.length > 1 ? "s" : ""} : ${list.map((s) => `${s.prenom} ${s.nom}`).join(", ")}. Leurs votes et leurs interventions au Sénat.`,
    trail: [["Accueil", "/"], ["Les sénateurs", "/senat"]],
    sections: [["Les sénateurs", linkList(list.map((s) => [`${s.prenom} ${s.nom}`, `/senateur/${s.id}`, s.groupe?.abrev]))]],
    group: "elus", priority: 0.4,
  });
}
for (const m of meps) {
  const name = `${m.prenom} ${m.nom}`;
  page({
    path: `/eurodepute/${m.id}`, title: `${name}, ${fem(m) ? "eurodéputée" : "eurodéputé"}`, h1: name,
    desc: `${name}, ${fem(m) ? "eurodéputée" : "eurodéputé"} ${m.parti?.libelle ? `(${m.parti.libelle})` : ""}, groupe ${m.groupe?.libelle ?? ""} au Parlement européen : ses votes et ses discours.`.replace(/\s+/g, " "),
    trail: [["Accueil", "/"], ["Les eurodéputés", "/europe"]],
    sections: [
      ["En bref", factList([
        m.groupe?.libelle && ["Groupe au Parlement européen", m.groupe.libelle],
        m.parti?.libelle && ["Parti", m.parti.libelle],
        m.naissance && ageOf(m.naissance) && ["Âge", `${ageOf(m.naissance)} ans`],
        m.mandats?.[0]?.[0] && ["Eurodéputé·e depuis le", frDate(m.mandats[0][0])],
        m.stats?.cast && ["Votes", `${nf(m.stats.pour ?? 0)} pour, ${nf(m.stats.contre ?? 0)} contre, ${nf(m.stats.abstention ?? 0)} abstentions, sur ${nf(m.stats.eligible ?? m.stats.cast)} votes`],
        m.stats?.participation != null && ["Participation", pct(m.stats.participation)],
        m.stats?.group?.rate != null && ["Vote avec son groupe", pct(m.stats.group.rate)],
        m.stats?.france?.rate != null && ["Vote avec la majorité des élus français", pct(m.stats.france.rate)],
      ])],
      ["Les autres eurodéputés de son groupe", linkList(meps.filter((o) => o.groupe?.abrev === m.groupe?.abrev && o.id !== m.id).map((o) => [`${o.prenom} ${o.nom}`, `/eurodepute/${o.id}`, o.parti?.libelle]))],
    ],
    ...(/^https:\/\/www\.europarl\.europa\.eu\//.test(m.photo ?? "") ? { image: m.photo } : {}),
    ld: [{ "@type": "Person", name, jobTitle: "Membre du Parlement européen", ...(m.groupe?.libelle ? { memberOf: { "@type": "Organization", name: m.groupe.libelle } } : {}), url: ORIGIN + `/eurodepute/${m.id}` }],
    group: "elus", priority: 0.5,
  });
}

// ---------------------------------------------------------------- candidates, programmes
for (const c of candidates) {
  const full = tryJson(`candidates/${c.slug}.json`);
  const prog = programmes.find((p) => p.slug === c.slug);
  page({
    path: `/candidat/${c.slug}`, title: `${c.name}, ${/\bcandidate\b/.test(c.role?.fr ?? "") ? "candidate" : "candidat"} à la présidentielle 2027`, h1: c.name,
    desc: `${c.name} (${c.party?.fr ?? ""}) : ${c.role?.fr ?? "candidat à la présidentielle 2027"}. Sondages, programme, parcours, patrimoine déclaré, mandats.`,
    trail: [["Accueil", "/"], ["Présidentielle 2027", "/2027"]],
    sections: [
      ["En bref", factList([
        c.party?.fr && ["Parti", c.party.fr],
        c.role?.fr && ["Fonction", c.role.fr],
        full?.born?.date && ["Naissance", `${frDate(full.born.date)}${full.born.place ? `, ${full.born.place}` : ""}${ageOf(full.born.date) ? ` (${ageOf(full.born.date)} ans)` : ""}`],
      ])],
      ...(full?.mandates?.length ? [["Mandats", `<ul>${full.mandates.slice(0, 12).map((x) => `<li>${esc(x.label?.fr ?? x.office ?? "")}${x.from ? ` (${x.from.slice(0, 4)}–${x.to ? x.to.slice(0, 4) : "en cours"})` : ""}</li>`).join("")}</ul>`]] : []),
      ...(full?.candidacies?.length ? [["Candidatures passées", `<ul>${full.candidacies.slice(0, 12).map((x) => `<li>${esc(`${x.date?.slice(0, 4) ?? ""} · ${x.office?.fr ?? x.type ?? ""}${x.place ? `, ${x.place}` : ""}${x.pct != null ? ` : ${String(x.pct).replace(".", ",")} %` : ""}${x.elected ? " (élu·e)" : ""}`)}</li>`).join("")}</ul>`]] : []),
      ["À lire", linkList([...(prog ? [[`Le programme ${de(c.name)}`, `/programmes/${c.slug}`]] : []), ["Les sondages de la présidentielle", "/sondages"], ["Le quiz : quel candidat vous ressemble ?", "/quiz"], ...candidates.filter((o) => o.slug !== c.slug).map((o) => [o.name, `/candidat/${o.slug}`, o.party?.fr])])],
    ],
    ...(/^https:\/\/(commons|upload)\.wikimedia\.org\//.test(c.photo ?? "") ? { image: c.photo } : {}),
    ld: [{ "@type": "Person", name: c.name, ...(c.photo ? { image: c.photo } : {}), ...(c.party?.fr ? { affiliation: { "@type": "Organization", name: c.party.fr } } : {}), ...(full?.born?.date ? { birthDate: full.born.date } : {}), ...(full?.wikidata ? { sameAs: [`https://www.wikidata.org/wiki/${full.wikidata}`] } : {}), url: ORIGIN + `/candidat/${c.slug}` }],
    group: "pages", priority: 0.8,
  });
}
for (const p of programmes) {
  page({
    path: `/programmes/${p.slug}`, title: `Le programme ${de(p.candidate)} pour 2027${p.programme ? ` : ${p.programme}` : ""}`, h1: `${p.candidate} : ${p.programme ?? "le programme"}`,
    desc: `Le programme ${de(p.candidate)} (${p.party ?? ""}) mesure par mesure : ce qu’il propose, ce que ça coûte selon le parti et selon les instituts, ce que dit le droit, et comment ses élus votent.`,
    trail: [["Accueil", "/"], ["Les programmes", "/programmes"]],
    sections: [["À lire", linkList([[`${p.candidate}, la fiche`, `/candidat/${p.slug}`], ["Comparer les programmes par thème", "/programmes"]])]],
    group: "pages", priority: 0.8,
  });
}

// ---------------------------------------------------------------- past elections
for (const e of elections) {
  page({
    path: `/histoire/${e.id}`, title: e.title.fr, h1: e.title.fr,
    desc: `${e.title.fr}${e.winner?.name ? ` : élection ${de(e.winner.name)}` : ""}. Les résultats${e.direct ? " tour par tour, la carte, la participation" : ""}, le contexte. ${e.method?.fr ?? ""}.`.replace(/\s+/g, " "),
    trail: [["Accueil", "/"], ["Toutes les élections depuis 1848", "/resultats"]],
    group: "pages", priority: 0.5,
  });
}

// ---------------------------------------------------------------- departments and towns
let towns = 0;
for (const d of departments) {
  const list = Object.values(d.communes ?? {});
  const depName = list[0]?.department?.name ?? d.department;
  const depCode = d.department;
  page({
    path: `/explorer/${depCode}`, title: `${depName} (${depCode}) : toutes les communes`,
    desc: `${depName} (${depCode}), ${nf(list.filter((c) => c.type === "commune").length)} communes : maire, député, résultats électoraux, sécurité, écoles, finances, prix de l’immobilier.`,
    trail: [["Accueil", "/"], ["Toutes les communes", "/explorer"]],
    sections: [
      ["Les plus grandes communes", linkList([...list].filter((c) => c.type === "commune" && c.population?.value).sort((a, b) => b.population.value - a.population.value).slice(0, 15).map((c) => [c.name, `/ville/${c.code}`, `${nf(c.population.value)} habitants`]))],
      ["Les élus du département", linkList([
        ...deputes.filter((m) => m.numDepartement === depCode).map((m) => [`${m.prenom} ${m.nom}, ${fem(m) ? "députée" : "député"} de la ${ord(m.numCirco)} circonscription`, `/depute/${m.id}`, m.groupe?.abrev]),
        ...(senDeps.has(depCode) ? [[`Les sénateurs du département (${depName})`, `/senat/${depCode}`]] : []),
      ])],
      ["Toutes les communes", linkList([...list].sort((a, b) => a.name.localeCompare(b.name, "fr")).map((c) => [c.name, `/ville/${c.code}`, c.postcodes?.[0]]))],
    ],
    group: "communes", priority: 0.5,
  });
  const muni = tryJson(`municipal/${depCode}.json`)?.communes ?? {};
  const ranks = tryJson(`rankings/ranks/${depCode}.json`) ?? {};
  const located = list.filter((c) => c.centroid && c.type === "commune");
  for (const c of list) {
    const pop = c.population?.value;
    const mayor = c.elected?.mayor?.status === "ok" ? titleCase(c.elected.mayor.name) : null;
    const mps = (c.districts ?? []).map((x) => mpByCirco.get(x.code)).filter(Boolean);
    const m26 = muni[c.code]?.y2026;
    const win = m26?.winner;
    const flat = c.property?.status === "ok" ? c.property.apartment?.medianPerM2 : null;
    const house = c.property?.status === "ok" ? c.property.house?.medianPerM2 : null;
    const bits = [mayor ? `maire : ${mayor}` : "", pop ? `${nf(pop)} habitants` : ""].filter(Boolean).join(", ");

    // the town in figures: only what the data holds for this town, so every page says something of its own
    const facts = [
      ["Département", `${depName} (${depCode})`],
      c.region?.name && ["Région", c.region.name],
      pop && ["Population", `${nf(pop)} habitants${c.population.year ? ` (${c.population.year})` : ""}`],
      c.postcodes?.length && ["Code postal", c.postcodes.slice(0, 6).join(", ") + (c.postcodes.length > 6 ? "…" : "")],
      mayor && ["Maire", `${mayor}${c.elected.mayor.since ? `, depuis le ${frDate(c.elected.mayor.since)}` : ""}`],
      c.elected?.council?.count && ["Conseil municipal", `${c.elected.council.count} élus`],
      c.cantons?.length && ["Canton", c.cantons.map((x) => x.name).join(", ")],
      flat && ["Prix des appartements", `${nf(flat)} €/m² (médiane ${c.property.year})`],
      house && ["Prix des maisons", `${nf(house)} €/m² (médiane ${c.property.year})`],
      c.broadband?.ftth?.status === "ok" && ["Fibre", `${String(c.broadband.ftth.share).replace(".", ",")} % des locaux raccordables`],
      c.health?.gpAccess?.status === "ok" && ["Accès aux généralistes", `${String(c.health.gpAccess.value).replace(".", ",")} consultations par an et par habitant (France : ${String(c.health.gpAccess.national).replace(".", ",")})`],
      c.assets?.monuments?.count && ["Monuments historiques", `${nf(c.assets.monuments.count)}`],
    ].filter(Boolean);
    const sections = [["La commune en bref", `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`]];

    if (win) {
      const r = m26.rounds?.[(m26.decidedRound ?? 1) - 1];
      sections.push(["Municipales 2026", `<p>${esc(`Liste élue${m26.decidedRound === 2 ? " au second tour" : m26.decidedRound === 1 ? " dès le premier tour" : ""} : « ${win.label} », menée par ${titleCase(win.head?.name ?? "")}${win.pctExpressed != null ? `, ${String(win.pctExpressed).replace(".", ",")} % des suffrages exprimés` : ""}${win.seats ? `, ${win.seats} sièges sur ${muni[c.code].seats}` : ""}.${r?.turnoutPct != null ? ` Participation : ${String(r.turnoutPct).replace(".", ",")} %.` : ""}`)}</p>`]);
    }
    const crime = c.local?.crime?.status === "ok" ? c.local.crime.values : null;
    if (crime) {
      const row = (k, label, unit) => crime[k] ? `<li>${esc(label)} : ${esc(String(crime[k][1]).replace(".", ","))} ${unit}</li>` : "";
      const items = row("burglary", "Cambriolages de logement", "pour 1 000 logements") + row("theftFromPersons", "Vols sans violence contre des personnes", "pour 1 000 habitants") + row("physicalViolenceOther", "Violences physiques hors famille", "pour 1 000 habitants") + row("criminalDamage", "Destructions et dégradations", "pour 1 000 habitants");
      if (items) sections.push([`Sécurité (${c.local.crime.year})`, `<ul>${items}</ul><p>Faits enregistrés par la police et la gendarmerie (SSMSI, ministère de l’Intérieur).</p>`]);
    }
    const rk = ranks[c.code] ?? {};
    const rankLine = (k, label, slug) => rk[k] && RANK_N[k] ? [`${label} : ${nf(rk[k])}e sur ${nf(RANK_N[k])} communes`, `/classements/${slug}/${c.code}`] : null;
    const rankLinks = [rankLine("quality", "Qualité de vie", "qualite-de-vie"), rankLine("income", "Niveau de vie", "niveau-de-vie"), rankLine("pop", "Population", "population"), rankLine("flat", "Prix des appartements", "prix-appartements")].filter(Boolean);
    if (rankLinks.length) sections.push(["Classements", linkList(rankLinks)]);

    // the six nearest towns of the department: readers compare with neighbours, crawlers follow the links
    const near = c.centroid ? located.filter((o) => o.code !== c.code).map((o) => [o, (o.centroid[0] - c.centroid[0]) ** 2 * 0.53 + (o.centroid[1] - c.centroid[1]) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 6).map(([o]) => o) : [];
    sections.push(["Élus et comparaisons", linkList([
      ...mps.slice(0, 4).map((m) => [`${m.prenom} ${m.nom}, ${fem(m) ? "députée" : "député"} ${m.groupe?.abrev ?? ""}`, `/depute/${m.id}`]),
      ...(c.districts ?? []).slice(0, 4).map((d) => [`Circonscription ${d.code.slice(-2)} : résultats des législatives`, `/circo/${d.code}`]),
      [`Les sénateurs du département (${depName})`, `/senat/${depCode}`],
      [`Comparer ${c.name} à une autre commune`, `/comparer/${c.code}`],
    ])]);
    if (near.length) sections.push(["Communes voisines", linkList(near.map((o) => [o.name, `/ville/${o.code}`]))]);

    const img = c.media?.image?.status === "ok" && /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(c.media.image.thumb ?? "") ? c.media.image.thumb : null;
    page({
      path: `/ville/${c.code}`, title: `${c.name} (${depCode}) : maire, élections, sécurité, prix de l’immobilier`, h1: `${c.name} (${depCode})`,
      desc: `${c.name}${c.name === depName ? "" : `, ${depName}`}${bits ? ` — ${bits}` : ""}.${win?.head?.name ? ` Municipales 2026 : liste ${de(titleCase(win.head.name))}.` : ""}${flat ? ` Appartements : ${nf(flat)} €/m².` : ""} Élus, résultats des élections, sécurité, écoles et finances de la commune.`,
      trail: [["Accueil", "/"], ["Toutes les communes", "/explorer"], [`${depName} (${depCode})`, `/explorer/${depCode}`]],
      sections, image: img,
      ld: [{ "@type": "City", name: c.name, ...(c.centroid ? { geo: { "@type": "GeoCoordinates", longitude: c.centroid[0], latitude: c.centroid[1] } } : {}), containedInPlace: { "@type": "AdministrativeArea", name: depName }, ...(c.media?.wikidata?.url ? { sameAs: [c.media.wikidata.url] } : {}), ...(img ? { image: img } : {}), ...(c.postcodes?.[0] ? { address: { "@type": "PostalAddress", postalCode: c.postcodes[0], addressLocality: c.name, addressCountry: "FR" } } : {}) }],
      group: "communes", priority: pop > 20000 ? 0.6 : 0.4,
    });
    towns++;
  }
}

// ---------------------------------------------------------------- app shell, sitemaps, robots
// any other address (a simulator scenario, a two-town comparison) gets the bare app; it sets its own tags once drawn
writeFileSync(join(DIST, "app.html"), template
  .replace(/\s*<link rel="canonical"[^>]*>/, "")
  .replace(/\s*<meta property="og:url"[^>]*>/, "")
  // comparisons, simulator and quiz links have no page of their own: kept out of the index, their links followed
  .replace("</title>", '</title>\n    <meta name="robots" content="noindex, follow" />'));

const groups = [...new Set(urls.map((u) => u.group))];
const files = [];
for (const g of groups) {
  const list = urls.filter((u) => u.group === g);
  for (let i = 0; i < list.length; i += 45000) {
    const name = `sitemap-${g}${i ? `-${i / 45000 + 1}` : ""}.xml`;
    writeFileSync(join(DIST, name), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list.slice(i, i + 45000).map((u) => `<url><loc>${esc(u.loc)}</loc><lastmod>${TODAY}</lastmod><priority>${u.priority.toFixed(1)}</priority></url>`).join("\n")}\n</urlset>\n`);
    files.push(name);
  }
}
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((f) => `<sitemap><loc>${ORIGIN}/${f}</loc><lastmod>${TODAY}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`);
writeFileSync(join(DIST, "llms.txt"), `# Third Estate

> Données électorales et civiques françaises, de la commune à l’Élysée : sondages et prévision de la présidentielle 2027, programmes des candidats, résultats de chaque élection depuis 1848, les 577 députés, 348 sénateurs et eurodéputés français avec leurs votes, et une page pour chacune des 34 920 communes (maire, municipales 2026, sécurité, prix de l’immobilier, services). Sources publiques, citées sur chaque page. Site en français et en anglais.

Citer : « Source : Third Estate (thirdestate.fr) » avec un lien vers la page.

## Présidentielle 2027
${SECTIONS.filter(([p]) => /^\/(2027|sondages|programmes|quiz|simulateur)/.test(p)).map(([p, t, d]) => `- [${t}](${ORIGIN}${p}): ${d}`).join("\n")}
${candidates.map((c) => `- [${c.name}](${ORIGIN}/candidat/${c.slug}): ${c.party?.fr ?? ""}`).join("\n")}

## Élus
${SECTIONS.filter(([p]) => /^\/(elus|assemblee|senat|europe)/.test(p)).map(([p, t, d]) => `- [${t}](${ORIGIN}${p}): ${d}`).join("\n")}

## Communes et données
${SECTIONS.filter(([p]) => /^\/(explorer|comparer|classements|resultats|chiffres|sources)/.test(p)).map(([p, t, d]) => `- [${t}](${ORIGIN}${p}): ${d}`).join("\n")}

## Plan complet
- [Sitemap](${ORIGIN}/sitemap.xml)
`);

// Search engines and AI *search* crawlers are welcome (they send readers); crawlers that collect pages to train
// AI models are not. Each company names its training crawler separately from its search crawler.
const AI_TRAINING = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "meta-externalagent", "FacebookBot", "cohere-training-data-crawler", "Diffbot", "Omgilibot", "Timpibot", "ImagesiftBot"];
writeFileSync(join(DIST, "robots.txt"), [
  ...AI_TRAINING.map((b) => `User-agent: ${b}\nDisallow: /\n`),
  `User-agent: *\nAllow: /\nDisallow: /kit\nDisallow: /compte\n`,
  `Sitemap: ${ORIGIN}/sitemap.xml\n`,
].join("\n"));

console.log(`prerender: ${urls.length} pages (${towns} towns), ${files.length} sitemaps`);
