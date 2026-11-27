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
const fem = (p) => p.civ === "Mme" || p.feminin === true;

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
  ["/2027/comment-ca-marche", "Comment marche l’élection présidentielle", "L’élection présidentielle française expliquée, étape par étape : parrainages, campagne, premier et second tour.", 0.6],
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
  sections: [["Rubriques", sectionLinks], ["Candidats à la présidentielle 2027", linkList(candidates.map((c) => [c.name, `/candidat/${c.slug}`, c.party?.fr]))]],
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
    sections: [["En bref", linkList([
      [`Groupe : ${m.groupe?.libelle ?? "—"}`, "/assemblee/composition"],
      ...(m.circo ? [[`Circonscription : ${m.departement ?? ""} ${ord(m.numCirco)}`, `/circo/${m.circo}`]] : []),
      ...(m.numDepartement && m.numDepartement !== "99" ? [[`Les communes du département`, `/explorer/${m.numDepartement}`]] : []),
    ])]],
    ld: [{ "@type": "Person", name, givenName: m.prenom, familyName: m.nom, jobTitle: role, ...(m.profession ? { hasOccupation: { "@type": "Occupation", name: m.profession } } : {}), ...(m.groupe?.libelle ? { memberOf: { "@type": "Organization", name: m.groupe.libelle } } : {}), url: ORIGIN + `/depute/${m.id}`, ...(m.naissance ? { birthDate: m.naissance } : {}) }],
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
    sections: mp ? [["Le député", linkList([[`${mp.prenom} ${mp.nom}`, `/depute/${mp.id}`, mp.groupe?.libelle]])]] : [],
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
    sections: s.numDepartement ? [["Ailleurs", linkList([[`Les sénateurs du département (${s.circonscription ?? ""})`, `/senat/${s.numDepartement}`], [`Les communes du département`, `/explorer/${s.numDepartement}`]])]] : [],
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
    sections: [["À lire", linkList([...(prog ? [[`Le programme de ${c.name}`, `/programmes/${c.slug}`]] : []), ["Les sondages de la présidentielle", "/sondages"], ["Le quiz : quel candidat vous ressemble ?", "/quiz"]])]],
    ld: [{ "@type": "Person", name: c.name, ...(c.party?.fr ? { affiliation: { "@type": "Organization", name: c.party.fr } } : {}), ...(full?.born?.date ? { birthDate: full.born.date } : {}), ...(full?.wikidata ? { sameAs: [`https://www.wikidata.org/wiki/${full.wikidata}`] } : {}), url: ORIGIN + `/candidat/${c.slug}` }],
    group: "pages", priority: 0.8,
  });
}
for (const p of programmes) {
  page({
    path: `/programmes/${p.slug}`, title: `Le programme de ${p.candidate} pour 2027${p.programme ? ` : ${p.programme}` : ""}`, h1: `${p.candidate} : ${p.programme ?? "le programme"}`,
    desc: `Le programme de ${p.candidate} (${p.party ?? ""}) mesure par mesure : ce qu’il propose, ce que ça coûte selon le parti et selon les instituts, ce que dit le droit, et comment ses élus votent.`,
    trail: [["Accueil", "/"], ["Les programmes", "/programmes"]],
    sections: [["À lire", linkList([[`${p.candidate}, la fiche`, `/candidat/${p.slug}`], ["Comparer les programmes par thème", "/programmes"]])]],
    group: "pages", priority: 0.8,
  });
}

// ---------------------------------------------------------------- past elections
for (const e of elections) {
  page({
    path: `/histoire/${e.id}`, title: e.title.fr, h1: e.title.fr,
    desc: `${e.title.fr}${e.winner?.name ? ` : élection de ${e.winner.name}` : ""}. Les résultats${e.direct ? " tour par tour, la carte, la participation" : ""}, le contexte. ${e.method?.fr ?? ""}.`.replace(/\s+/g, " "),
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
    sections: [["Les communes", linkList([...list].sort((a, b) => a.name.localeCompare(b.name, "fr")).map((c) => [c.name, `/ville/${c.code}`, c.postcodes?.[0]]))]],
    group: "communes", priority: 0.5,
  });
  for (const c of list) {
    const pop = c.population?.value;
    const mayor = c.elected?.mayor?.status === "ok" ? c.elected.mayor.name : null;
    const mps = (c.districts ?? []).map((x) => mpByCirco.get(x.code)).filter(Boolean);
    const cp = c.postcodes?.[0] ? ` (${c.postcodes[0]})` : "";
    const bits = [mayor ? `maire : ${mayor.replace(/\b([A-ZÀ-Ý])([A-ZÀ-Ý'’-]+)/g, (_, a, b) => a + b.toLowerCase())}` : "", pop ? `${nf(pop)} habitants` : ""].filter(Boolean).join(", ");
    page({
      path: `/ville/${c.code}`, title: `${c.name}${cp} : mairie, élus, élections, sécurité, finances`, h1: `${c.name}${cp}`,
      desc: `${c.name}, ${depName}${bits ? ` — ${bits}` : ""}. Le maire et le conseil municipal, le député, les résultats des élections, la sécurité, les écoles, les impôts et les finances de la commune.`,
      trail: [["Accueil", "/"], ["Toutes les communes", "/explorer"], [`${depName} (${depCode})`, `/explorer/${depCode}`]],
      sections: [["Élus et comparaisons", linkList([
        ...mps.slice(0, 4).map((m) => [`${m.prenom} ${m.nom}, ${fem(m) ? "députée" : "député"} ${m.groupe?.abrev ?? ""}`, `/depute/${m.id}`]),
        [`Comparer ${c.name} à une autre commune`, `/comparer/${c.code}`],
        ["Le classement des communes", `/classements/qualite-de-vie/${c.code}`],
      ])]],
      ld: [{ "@type": "City", name: c.name, ...(c.centroid ? { geo: { "@type": "GeoCoordinates", longitude: c.centroid[0], latitude: c.centroid[1] } } : {}), containedInPlace: { "@type": "AdministrativeArea", name: depName }, ...(c.postcodes?.[0] ? { address: { "@type": "PostalAddress", postalCode: c.postcodes[0], addressLocality: c.name, addressCountry: "FR" } } : {}) }],
      group: "communes", priority: pop > 20000 ? 0.6 : 0.4,
    });
    towns++;
  }
}

// ---------------------------------------------------------------- app shell, sitemaps, robots
// any other address (a simulator scenario, a two-town comparison) gets the bare app; it sets its own tags once drawn
writeFileSync(join(DIST, "app.html"), template.replace(/\s*<link rel="canonical"[^>]*>/, "").replace(/\s*<meta property="og:url"[^>]*>/, ""));

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
// Search engines and AI *search* crawlers are welcome (they send readers); crawlers that collect pages to train
// AI models are not. Each company names its training crawler separately from its search crawler.
const AI_TRAINING = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "meta-externalagent", "FacebookBot", "cohere-training-data-crawler", "Diffbot", "Omgilibot", "Timpibot", "ImagesiftBot"];
writeFileSync(join(DIST, "robots.txt"), [
  ...AI_TRAINING.map((b) => `User-agent: ${b}\nDisallow: /\n`),
  `User-agent: *\nAllow: /\nDisallow: /kit\nDisallow: /compte\n`,
  `Sitemap: ${ORIGIN}/sitemap.xml\n`,
].join("\n"));

console.log(`prerender: ${urls.length} pages (${towns} towns), ${files.length} sitemaps`);
