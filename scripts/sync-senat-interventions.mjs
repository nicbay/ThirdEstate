// What senators say in the chamber: word clouds and theme rankings from the Senate's official verbatim
// record (comptes rendus intégraux de la séance publique), the Senate counterpart of sync-interventions.mjs.
// Source: data.senat.fr, base « Comptes rendus », XML export (cri.zip, one file per sitting day, refreshed
// nightly, Licence Ouverte): https://data.senat.fr/la-base-comptes-rendus/
//
//   npm run sync:senat-interventions            (re-downloads the zip, ~550 MB, if the cached copy is older than 20 h)
//   npm run sync:senat-interventions -- --cache (always use the cached zip in .cache/senat-debats/)
//
// Each <cri:intervenant mat="…"> of the record is one speech by one person, tagged with the speaker's Senate
// matricule (the `id` of public/data/senat/senateurs.json). We keep speeches by sitting senators (type="1",
// not qua="président de séance") from FROM onwards, strip the speaker's name and title, stage directions,
// amendment and article texts read out, tokenise, drop stopwords and procedural boilerplate, fold
// plurals/feminines crudely, and count words and two-word phrases ("pouvoir d’achat", "fin de vie").
// Every speech is also classified into themes with the same keyword lexicon as the Assemblée (THEMES below),
// helped by the titles of the agenda item being debated.
//
// The text processing (THEMES, STOP, fold, tokenize, TF-IDF, quotes) is copied from sync-interventions.mjs
// so the two chambers are read the same way; keep THEMES identical in both (the site colours themes by id).
// Differences: Senate boilerplate words are added to STOP, the XML is the Senate's CRI schema, and "brief"
// interventions (a single paragraph of fewer than BRIEF words: "Très bien !", "C’est faux !") stand in for
// the Assemblée's interjection tag, which the Senate record doesn't have.
//
// Output (public/data/senat/interventions/), same shapes as public/data/an/interventions/:
//   summary.json   themes, chamber + per-group theme shares and top terms, per-senator theme shares (`mps`)
//   meta.json      sync time and source timestamp (kept apart so data files only change with the data)
//   <matricule>.json  one senator: speech counts, top ~60 distinctive terms (TF-IDF vs the other senators), theme shares
//   words.json     chamber/group cloud words: count, senators, recent quotes
//   ranks/NN.json  for every cloud word, every senator who said it (sharded like the Assemblée's)

import { safeName } from "./lib/safe-name.mjs";
import { makeCache, fetchRetry } from "./lib/http-cache.mjs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";

const SOURCE = "https://data.senat.fr/data/debats/cri.zip";
const PAGE = "https://data.senat.fr/la-base-comptes-rendus/";
const RECORD = "https://www.senat.fr/seances/"; // + sYYYYMM/sYYYYMMDD/sYYYYMMDD_mono.html#par_N
const FROM = "2023-10-01"; // the current Senate (renewal of September 2023), as for the votes
const CACHE = new URL("../.cache/senat-debats/", import.meta.url);
const OUT = new URL("../public/data/senat/interventions/", import.meta.url);
const SENATEURS = new URL("../public/data/senat/senateurs.json", import.meta.url);
const TOP_TERMS = 60;
const BRIEF = 15;

// ---------- themes: keyword lexicon (identical to sync-interventions.mjs) ----------
const THEMES = [
  ["securite", "Sécurité", "Security", "police polic* gendarme* délinquan* criminalit* criminel crime cambriolage narcotrafic* trafiquant drogue stupéfiant terroris* attentat émeute vidéoprotection vidéosurveillance insécurité sécuritaire forces_de_l’ordre ordre_public féminicide* agression"],
  ["immigration", "Immigration", "Immigration", "immigr* migra* asile demandeur_d’asile titre_de_séjour régularisation expulsion oqtf clandestin* sans-papier* naturalisation réfugié* frontex étranger regroupement_familial aide_médicale ame"],
  ["sante", "Santé", "Health", "santé hôpital hospital* médecin* médical* soignant infirmier* patient maladie soin médicament pharmac* ehpad psychiatr* cancer vaccin* sécurité_sociale assurance_maladie fin_de_vie mourir euthanasie urgence_hospitalière désert_médical ars sanitaire kinésithérap* ondam"],
  ["social", "Solidarités et famille", "Welfare & family", "pauvreté pauvre précarité précaire handicap* famille familial* allocation rsa caf solidarité aidant autonomie dépendance minimum_social aide_sociale personne_âgée enfance protection_de_l’enfance sans-abri crèche petite_enfance pension_alimentaire"],
  ["education", "Éducation et recherche", "Education & research", "école scolai* élève enseignant* professeur* éducation éducatif lycée lycéen collège collégien université universitaire étudiant* chercheur jeunesse baccalauréat parcoursup enseignement maternelle périscolaire pédagog* recherche_publique"],
  ["travail", "Travail et retraites", "Work & pensions", "travail travailleur emploi chômage chômeur salarié salaire salarial* retraite retraité syndica* smic licenciement apprenti* âge_légal pénibilité cotisation france_travail assurance_chômage conditions_de_travail temps_de_travail"],
  ["economie", "Économie et entreprises", "Economy & business", "entreprise entrepreneur* industri* commerce commerçant artisan* pme tpe économique croissance investissement investisseur concurrence innovation usine numérique inflation pouvoir_d’achat start-up actionnaire dividende banque bancaire"],
  ["budget", "Budget et fiscalité", "Budget & tax", "budget* impôt fiscal* fiscalité taxe taxation dette déficit tva milliard dépense_publique finance_publique loi_de_finance contribuable plf plfss csg niche_fiscale prélèvement exonération superprofit* recette_fiscale"],
  ["ecologie", "Écologie, énergie, transports", "Ecology, energy & transport", "écolog* environnement* climat* énergi* électricité nucléaire renouvelable éolien* solaire carbone pollution biodiversité réchauffement sobriété déchet plastique forêt littoral pétrole edf transport ferroviaire train sncf voiture carburant automobile rénovation_énergétique zfe eau"],
  ["agriculture", "Agriculture et alimentation", "Farming & food", "agricul* agriculteur paysan* élevage éleveur pêche pêcheur alimentation alimentaire ferme pesticide glyphosate phytosanitaire mercosur viticult* viticole laitier egalim pac exploitation_agricole agroalimentaire"],
  ["logement", "Logement", "Housing", "logement locataire propriétaire loyer hlm bailleur immobilier hébergement squat* copropriété habitat urbanisme foncier airbnb meublé locatif logement_social"],
  ["international", "International et défense", "Foreign affairs & defence", "guerre ukrain* russ* poutine israël* gaza palestin* hamas otan diplomat* militaire armée armement soldat géopolit* afrique chine états-unis trump iran liban onu défense_nationale affaire_étrangère loi_de_programmation_militaire génocide"],
  ["justice", "Justice", "Justice", "justice judiciaire juge magistrat* tribunal prison détenu pénitentiaire pénal* procès avocat incarcér* condamnation condamné victime mineur_délinquant récidive garde_à_vue code_pénal"],
  ["europe", "Europe", "Europe", "europe européen union_européenne bruxelles directive commission_européenne eurodéputé schengen parlement_européen"],
  ["institutions", "Institutions et territoires", "Institutions & local government", "constitution* constitutionnel référendum démocratie proportionnelle dissolution censure motion_de_censure parlement parlementarisme décentralisation collectivité maire commune communal* intercommunal* département* région* élection électoral* scrutin_proportionnel conseil_constitutionnel"],
  ["outremer", "Outre-mer", "Overseas France", "outre-mer ultramarin* guadeloup* martiniqu* guyan* réunionnais mayotte mahorais nouvelle-calédonie calédonien* kanak* polynésie polynésien* octroi_de_mer chlordécone saint-pierre-et-miquelon wallis vie_chère hexagone"],
  ["culture", "Culture, médias, sport", "Culture, media & sport", "culture culturel patrimoine musée artiste cinéma audiovisuel média presse journaliste sport sportif olympique paralympique théâtre spectacle langue_régionale audiovisuel_public"],
];

// ---------- stopwords and parliamentary boilerplate (sync-interventions.mjs + the Senate's own) ----------
const STOP = new Set(`
a à afin ah ai aie aient aies ait alors as au aucun aucune aujourd’hui auquel aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront aussi autant autre autres aux auxquelles auxquels avaient avais avait avant avec avez aviez avions avoir avons ayant ayez ayons
bah beaucoup bien bon bonne c ça car ce ceci cela celle celles celui cependant certain certaine certaines certains ces cet cette ceux chacun chacune chaque chez ci comme comment contre d dans de dedans dehors déjà demain depuis des desquelles desquels dessous dessus devant devra devrait devraient devons devez doit doivent donc dont du duquel durant
eh elle elles en encore entre es est et étaient étais était étant été êtes étiez étions être eu eue eues eûmes eurent eus eut eux fait faire fais faisons faites font fois fut furent fûmes ici il ils j je jamais jusqu jusque l la là laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me même mêmes mes moi moins mon n ne ni non nos notre nôtre nous
o oh on ont ou où par parce parmi pas peu peut peuvent peux plus plusieurs pour pourquoi pourra pourrait pourraient pouvez pouvons près puis puisque qu quand que quel quelle quelles quels qui quoi s sa sans se sera serai seraient serais serait seras serez seriez serions serons seront ses si sien sienne soi soient sois soit sommes son sont sous soyez soyons suis sur t ta tandis tant te tel telle telles tels tes toi ton tous tout toute toutes très trop tu un une unes uns vers via voici voilà vos votre vôtre vous vu y
voire ainsi enfin donc également notamment surtout toujours souvent parfois vraiment simplement seulement plutôt peut-être c’est-à-dire d’ailleurs ailleurs effectivement évidemment justement totalement absolument précisément exactement directement clairement réellement aujourd plus là-dessus celui-ci celle-ci ceux-ci celles-ci là-bas vous-même vous-mêmes nous-mêmes moi-même lui-même elle-même eux-mêmes soi-même
avoir être faire dire aller voir savoir pouvoir vouloir devoir falloir venir prendre donner mettre passer croire trouver rendre permettre parler demander tenir sembler rester entendre penser arriver laisser porter comprendre connaître proposer souhaiter agir
ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront eu eus suis es est sommes êtes sont étais était étions étiez étaient serai seras sera serons serez seront été fais fait faisons faites font faisait ferai fera ferons ferez feront dis dit disons dites disent disait dirai dira vais va allons allez vont allait irai ira irons vois voit voyons voyez voient vu sais sait savons savez savent su peux peut pouvons pouvez peuvent pu pourrait veux veut voulons voulez veulent voulu voudrais voudrait dois doit devons devez doivent dû devrait faut fallait faudra faudrait viens vient venons venez viennent venu prends prend prenons prenez prennent pris donne donnons donnez donnent donné mets met mettons mettez mettent mis passe passons passez passent passé crois croit croyons croyez croient cru trouve trouvons trouvez trouvent trouvé rends rend rendons rendez rendent rendu permet permettent permis permettra permettrait parle parlons parlez parlent parlé demande demandons demandez demandent demandé tiens tient tenons tenez tiennent tenu semble semblent semblé reste restons restez restent resté entends entend entendons entendez entendent entendu pense pensons pensez pensent pensé arrive arrivent arrivé laisse laissons laissez laissent laissé porte portons portez portent porté comprends comprend comprenons comprenez comprennent compris connais connaît connaissons connaissez connaissent connu propose proposons proposez proposent proposé souhaite souhaitons souhaitez souhaitent souhaité agit agissons agissez agissent
monsieur madame messieurs mesdames mesdemoiselles président présidente ministre ministres rapporteur rapporteure rapporteurs rapporteuse collègue collègues cher chère chers chères député députée députés députées gouvernement amendement amendements sous-amendement sous-amendements article articles alinéa alinéas texte textes commission commissions séance séances avis favorable défavorable sagesse retrait retire retirer retiré retirons rédactionnel rédactionnels adopté adoptée adoptés adoptées rejeté rejetée rejetés rejetées adopter rejeter voter vote votes votons votez voté scrutin parole merci remercie remercions question questions réponse répondre rappel règlement suspension minute minutes heure heures cours lecture discussion examen proposition propositions projet projets loi lois disposition dispositions mesure mesures dispositif dispositifs alinéa objet but sens fond cas point points chose choses fait faits manière façon moment temps jour jours année années an ans mois semaine aujourd’hui hier demain fin début part parts place niveau nombre ensemble cadre égard effet terme termes travail_parlementaire hémicycle assemblée nationale sénat sénateur sénateurs groupe groupes banc bancs applaudissements exclamations protestations rires
bah oui non bref ok voilà tiens allez
premier première premiers premières deuxième second seconde troisième dernier dernière derniers dernières nouveau nouvelle nouveaux nouvelles grand grande grands grandes petit petite petits petites tel telle vrai vraie juste simple important importante importants importantes essentiel essentielle possible nécessaire nécessaires certain certaine même autre seul seule seuls seules plein pleine long longue bonne bon bons bonnes meilleur meilleure mauvais mauvaise différent différents différente différentes besoin
un deux trois quatre cinq six sept huit neuf dix vingt trente cent cents mille million millions
mme votera voteront voterons votrons chargé délégué apparenté vise visent visant viser abord est-à-dire bravo exactement excellent formidable sûr sûrement quelque quelques chose rien personne tout_à_fait cela celles
sénatrice sénatrices haute rectifié rectifiée rectifiés rectifiées bis ter quater quinquies sexies septies octies nonies decies identique identiques présenté présentée présentés présentées libellé libellée défendu défendue défendus défendues explication explications intervention interventions orateur oratrice inscrit inscrits mm
émet émets émettons émettra émettrai émettrons émis émise toutefois conséquent outre sollicite sollicitons satisfait satisfaite satisfaits défaut rédaction relative relatif relatives relatifs saluer salue secrétaire
`.split(/\s+/).filter(Boolean));
// "de" connects the two words of a phrase ("pouvoir d’achat") instead of breaking it.
const CONNECT = new Set(["de", "d"]);
const ELISION = /^(?:l|d|j|qu|n|s|c|m|t|jusqu|lorsqu|puisqu|quoiqu|presqu)['’]/;

// ---------- crude French folding (plural, feminine) ----------
const INVARIANT = new Set("pays fois temps corps prix choix paix voix mois français anglais procès accès succès progrès cours discours recours concours secours sens dos bras poids taux lors gens fils avis refus abus virus campus bus mœurs puits repos mépris travaux impôts".split(" "));
function fold(w) {
  if (w.length <= 3 || INVARIANT.has(w)) return w;
  if (w.endsWith("aux") && w.length > 5) return w.slice(0, -3) + "al"; // hôpitaux, sociaux
  if (/(?:[^su]s|x)$/.test(w) && !/(?:ès|ys|is|as)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5) {
    if (w.endsWith("ée")) return w.slice(0, -1);
    if (w.endsWith("euse")) return w.slice(0, -4) + "eux";
    if (w.endsWith("trice") && w.length > 7) return w.slice(0, -5) + "teur";
    if (w.endsWith("ive")) return w.slice(0, -3) + "if";
    if (w.endsWith("elle")) return w.slice(0, -2);
    if (w.endsWith("enne")) return w.slice(0, -2);
    if (w.endsWith("ère")) return w.slice(0, -3) + "er";
    if (w.endsWith("ale")) return w.slice(0, -1);
  }
  return w;
}

// ---------- vocabulary: lemma ↔ id, with the surface form used most often for display ----------
const lemmaId = new Map();
const lemmas = [];
const surfaces = []; // id -> Map(surface -> n)
const lemmaTheme = []; // id -> theme index | -1
const prefixRules = [];
const exactRules = new Map();
const pairRules = new Map(); // "a|b" lemmas -> theme
const T = THEMES.length;
THEMES.forEach(([, , , words], ti) => {
  for (const raw of words.split(" ")) {
    if (raw.endsWith("*")) prefixRules.push([raw.slice(0, -1), ti]);
    else if (raw.includes("_")) {
      const parts = raw.split(/_|’/).filter((p) => p && !STOP.has(p) && !CONNECT.has(p) && p !== "à" && p !== "l");
      if (parts.length >= 2) pairRules.set(`${fold(parts[0])}|${fold(parts[parts.length - 1])}`, ti);
    } else exactRules.set(fold(raw), ti);
  }
});
const caps = []; // id -> occurrences written with a capital (proper nouns)
const ups = []; // id -> occurrences in capitals (acronyms)
const occ = [];
const surfIds = new Map();
const surfList = [];
function idOf(lemma, surface, cap, upper) {
  let id = lemmaId.get(lemma);
  if (id === undefined) {
    id = lemmas.length;
    lemmaId.set(lemma, id);
    lemmas.push(lemma);
    surfaces.push(new Map());
    let th = exactRules.get(lemma) ?? -1;
    if (th < 0) for (const [p, ti] of prefixRules) if (lemma.startsWith(p)) { th = ti; break; }
    lemmaTheme.push(th);
    caps.push(0);
    ups.push(0);
    occ.push(0);
  }
  occ[id]++;
  if (cap) caps[id]++;
  if (upper) ups[id]++;
  const s = surfaces[id];
  if (s.size < 8 || s.has(surface)) s.set(surface, (s.get(surface) ?? 0) + 1);
  return id;
}
const isProper = (id) => caps[id] > 0.7 * occ[id];
const isAcronym = (id) => ups[id] > 0.7 * occ[id];
const capitalise = (w) => w.replace(/(^|-)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/-(De|Et|La|Le|Les|Du|Des|Sur|En)-/g, (x) => x.toLowerCase());
const shape = (id, w) => (isAcronym(id) ? w.toUpperCase() : isProper(id) ? capitalise(w) : w);
const display = (id) => shape(id, [...surfaces[id].entries()].sort((a, b) => b[1] - a[1])[0][0]);
const surfId = (w) => {
  let i = surfIds.get(w);
  if (i === undefined) { i = surfList.length; surfIds.set(w, i); surfList.push(w); }
  return i;
};

// ---------- text cleaning (Senate CRI XML) and tokenising ----------
// The files say ISO-8859-1 but carry a few Windows-1252 bytes (’ œ …); most accents are numeric entities.
const CP1252 = { 0x80: "€", 0x85: "…", 0x8c: "Œ", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x9c: "œ" };
const decodeFile = (buf) => buf.toString("latin1").replace(/[\x80-\x9f]/g, (c) => CP1252[c.charCodeAt(0)] ?? " ");
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (e, n) => ENT[n.toLowerCase()] ?? " ")
    .replace(/[  ]/g, " ");
/** A speech's XML → plain text: without the speaker's name and title, stage directions, texts read out. */
function clean(xml) {
  return decode(
    xml
      .replace(/<cri:(orateurnom|orateurqualite|infoentreparentheses|amendements|textearticle|scrutin|mentionarticle|mentiontitre|mentionchapitre|intituletitre|numencadre)\b[\s\S]*?<\/cri:\1>/g, " ")
      .replace(/<cri:titreS\d[\s\S]*?<\/cri:titreS\d[^>]*>/g, " ")
      .replace(/<table[\s\S]*?<\/table>/g, " ")
      .replace(/<sup>[\s\S]*?<\/sup>/g, "") // n<sup>o</sup>, XIX<sup>e</sup>
      .replace(/<br\s*\/?>/g, " . ")
      .replace(/<\/p>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\([^)]{0,200}\)/g, " ") // remaining stage directions
    .replace(/['`]/g, "’");
}
const SPLIT = /([\p{L}][\p{L}’\-]*[\p{L}]|[\p{L}])|([.!?;:,«»"–—()…])/gu;
const AMEND = /\b(?:amendements?|sous-amendements?|articles?|alinéas?)\s+(?:n\s*[o°]s?\s*)?\d+[\w\s,et]*?/gi;
/** Text → sequence of lemma ids; -1 marks a break (punctuation, stopword), -2 a "de" connector. Surface forms go to `surf`. */
function tokenize(text, surf) {
  const seq = [];
  text = text.replace(AMEND, " . ").replace(/\b(?:monsieur|madame|mme|m\.)\s+(?:le|la)\s+(?:président|présidente|ministre|rapporteur|rapporteure|garde des sceaux|sénateur|sénatrice)\b/gi, " . ");
  for (const m of text.matchAll(SPLIT)) {
    if (m[2]) { seq.push(-1); continue; }
    let w = m[1].toLowerCase();
    if (ELISION.test(w)) {
      const head = w.slice(0, w.search(/['’]/));
      w = w.replace(ELISION, "");
      if (head === "d") { seq.push(-2); }
      else if (head !== "l" || STOP.has(w)) seq.push(-1);
    }
    w = w.replace(/^[\-’]+|[\-’]+$/g, "").replace(/-(?:t-)?(?:il|ils|elle|elles|on|je|tu|nous|vous|ce|là|ci|moi|toi|lui|leur)$/, "");
    if (!w) continue;
    if (CONNECT.has(w)) { seq.push(-2); continue; }
    if (w.length < 3 || STOP.has(w) || /\d/.test(w)) { seq.push(-1); continue; }
    const lemma = fold(w);
    if (STOP.has(lemma)) { seq.push(-1); continue; }
    const orig = m[1].replace(ELISION, "");
    const head = orig[0] ?? "";
    seq.push(idOf(lemma, w, head !== head.toLowerCase(), orig.length >= 2 && orig === orig.toUpperCase()));
    if (surf) surf[seq.length - 1] = surfId(w);
  }
  return seq;
}
/** Phrase key for two lemma ids, with a flag for a "de" between them. */
const pairKey = (a, b, de) => (a * 2 ** 21 + b) * 2 + (de ? 1 : 0);
const pairParts = (k) => [Math.floor(k / 2 ** 22), Math.floor(k / 2) % 2 ** 21, k % 2];
function* pairs(seq, at = false) {
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    if (a < 0) continue;
    let j = i + 1, de = false;
    if (seq[j] === -2) { de = true; j++; }
    const b = seq[j];
    if (b >= 0 && b !== a) yield at ? [pairKey(a, b, de), i, j] : pairKey(a, b, de);
  }
}

// ---------- download (cached) ----------
const args = new Set(process.argv.slice(2));
const cache = makeCache(CACHE);
let lastModified = null;
if (!args.has("--cache")) {
  lastModified = (await fetchRetry(SOURCE, { method: "HEAD" }).catch(() => null))?.headers.get("last-modified") ?? null;
}
const zipFile = await cache.cached("cri.zip", SOURCE, { maxAgeH: args.has("--cache") ? null : 20 });
lastModified ??= (await stat(zipFile)).mtime.toUTCString();

const senateurs = JSON.parse(await readFile(SENATEURS, "utf8"));
const senById = new Map(senateurs.map((d) => [d.id, d]));
const fromKey = FROM.replaceAll("-", "");
// The archive holds a stale, misdated copy (d20261204.xml, written in January 2026, is the sitting of
// 4 December 2025, also present as d20251204.xml): a day after today can't have been sat yet, skip it.
const todayKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const skipped = [];
const files = unzipSync(new Uint8Array(await readFile(zipFile)), {
  filter: (f) => {
    if (!/^cri\/d\d{8}\.xml$/.test(f.name) || f.name.slice(5, 13) < fromKey) return false;
    if (f.name.slice(5, 13) > todayKey) { skipped.push(f.name); return false; }
    return true;
  },
});
if (skipped.length) console.warn(`! skipped ${skipped.length} file(s) dated after today: ${skipped.join(", ")}`);
const names = Object.keys(files).sort();
console.log(`✓ ${names.length} sitting days since ${FROM} in the archive`);

// ---------- pass 1: parse every sitting day into speeches ----------
const speeches = []; // { sen, seq: Int32Array, words, themes: Float32Array | null, weight }
const senStat = new Map(); // matricule -> { n, inter, words, first, last }
let firstDate = "9999", lastDate = "0000";
const RE = /<cri:titreS(\d)\b([^>]*)>([\s\S]*?)<\/cri:titreS\1>|<cri:intervenant ([^>]*)>([\s\S]*?)<\/cri:intervenant>/g;
const TITLE = /<cri:titreS(\d)\b([^>]*)>([\s\S]*?)<\/cri:titreS\1>/g;
const attr = (s, k) => decode(s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "");
const titleThemes = (txt) => {
  const v = new Float32Array(T);
  const seq = tokenize(txt);
  for (const id of seq) if (id >= 0 && lemmaTheme[id] >= 0) v[lemmaTheme[id]] = 1;
  for (const k of pairs(seq)) {
    const [a, b] = pairParts(k);
    const th = pairRules.get(`${lemmas[a]}|${lemmas[b]}`);
    if (th !== undefined) v[th] = 1;
  }
  return v;
};
const plain = (x) => x.replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").trim();
const titleText = (a, inner) => plain(attr(a, "libelle") || clean(inner));
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const sitMeta = []; // sitting-day index -> { uid, iso }
const debateTitles = []; // agenda item titles, referenced by index from speeches
const titleIdx = new Map();
for (const name of names) {
  const xml = decodeFile(Buffer.from(files[name]));
  delete files[name];
  const date = name.slice(5, 13);
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const sit = sitMeta.push({ uid: `s${date.slice(0, 6)}/s${date}/s${date}_mono.html`, iso }) - 1;
  if (iso < firstDate) firstDate = iso;
  if (iso > lastDate) lastDate = iso;
  // level 1: the agenda item (bill, "Questions orales"…); level 2: its sub-heading (article, the question asked)
  const titles = [null, new Float32Array(T), new Float32Array(T)];
  let s1 = "", s1Type = "", debate = -1;
  const setDebate = (t) => {
    if (!titleIdx.has(t)) titleIdx.set(t, debateTitles.push(t) - 1);
    debate = titleIdx.get(t);
  };
  const onTitle = (lvl, a, inner) => {
    const txt = titleText(a, inner);
    // a change of chair ("Présidence de M. …") interrupts nothing: the debate goes on
    if (!txt || (lvl === 1 && /^présidence\b/i.test(txt))) return;
    if (lvl === 1) {
      titles[1] = titleThemes(txt);
      titles[2] = new Float32Array(T);
      s1 = txt.replace(/\s*\(n[o°]?\s*[\d\s,et]*\)\s*$/i, "");
      s1Type = attr(a, "type");
      setDebate(s1);
    } else {
      titles[2] = titleThemes(txt);
      // questions: the question's own subject is the better caption for a quote
      if (/question/.test(s1Type) && s1) setDebate(`${s1} : ${sentence(txt)}`);
    }
  };
  for (const m of xml.matchAll(RE)) {
    if (m[1]) { onTitle(Number(m[1]), m[2], m[3]); continue; }
    const a = m[4];
    const sen = attr(a, "mat").toUpperCase();
    const inner = m[5];
    const chair = /président de séance/i.test(attr(a, "qua"));
    if (senById.has(sen) && !chair && attr(a, "type") === "1") {
      const text = clean(inner);
      const surf = [];
      const seq = tokenize(text, surf);
      const words = seq.reduce((n, x) => n + (x >= 0 ? 1 : 0), 0);
      const raw = (text.match(/\p{L}+/gu) ?? []).length;
      if (raw) {
        const st = senStat.get(sen) ?? { n: 0, inter: 0, words: 0, first: iso, last: iso };
        senStat.set(sen, st);
        if (iso < st.first) st.first = iso;
        if (iso > st.last) st.last = iso;
        const brief = raw < BRIEF && (inner.match(/<p\b/g) ?? []).length <= 1;
        if (brief) st.inter++;
        else st.n++;
        st.words += words;
        // theme scores: lexicon hits in the speech, plus the agenda item's titles as a prior
        let themes = null;
        if (!brief && words >= 12) {
          const sc = new Float32Array(T);
          let own = 0;
          for (const id of seq) if (id >= 0 && lemmaTheme[id] >= 0) { sc[lemmaTheme[id]]++; own++; }
          for (const k of pairs(seq)) {
            const [x, y] = pairParts(k);
            const th = pairRules.get(`${lemmas[x]}|${lemmas[y]}`);
            if (th !== undefined) { sc[th] += 2; own++; }
          }
          for (let t = 0; t < T; t++) sc[t] += 1.5 * titles[1][t] + 1.5 * titles[2][t];
          const max = Math.max(...sc);
          const total = sc.reduce((s, x) => s + x, 0);
          if (own >= 1 && total >= 2) {
            // keep the themes within reach of the strongest one, share the speech between them
            let kept = 0;
            for (let t = 0; t < T; t++) if (sc[t] < 0.4 * max) sc[t] = 0; else kept += sc[t];
            for (let t = 0; t < T; t++) sc[t] /= kept;
            themes = sc;
          }
        }
        if (words) speeches.push({ sit, debate, pid: attr(a, "parid"), text, mp: sen, seq: Int32Array.from(seq), surf: Int32Array.from(seq, (x, i) => (x >= 0 ? surf[i] : -1)), words, themes, weight: Math.sqrt(Math.min(words, 800)) });
      }
    }
    // headings announced inside a speech (usually the chair calling the next question) apply to what follows
    for (const t of inner.matchAll(TITLE)) onTitle(Number(t[1]), t[2], t[3]);
  }
}
const S = names.length;
console.log(`✓ ${speeches.length} speeches by ${senStat.size} sitting senators (${firstDate} → ${lastDate}), ${lemmas.length} distinct words`);
if (!speeches.length) throw new Error("no speech parsed: has the CRI XML format changed?");

// ---------- pass 2: counts (as in sync-interventions.mjs; `mp` = the senator's matricule) ----------
const pairCount = new Map();
const pairMps = new Map();
for (const s of speeches) for (const k of pairs(s.seq)) pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
for (const [k, n] of pairCount) if (n < 25) pairCount.delete(k);
for (const s of speeches) for (const k of pairs(s.seq)) if (pairCount.has(k)) (pairMps.get(k) ?? pairMps.set(k, new Set()).get(k)).add(s.mp);
for (const [k, set] of pairMps) if (set.size < 4) pairCount.delete(k);
pairMps.clear();
const pairIds = new Map([...pairCount.keys()].map((k, i) => [k, lemmas.length + i]));
const isPair = (id) => id >= lemmas.length;
const pairOf = [...pairCount.keys()];
const pairSurf = new Map();
const pairDisplay = (k) => {
  const [a, b, de] = pairParts(k);
  const best = [...(pairSurf.get(pairIds.get(k))?.entries() ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0].split("|").map(Number);
  const A = best ? shape(a, surfList[best[0]]) : display(a);
  const B = best ? shape(b, surfList[best[1]]) : display(b);
  return `${A} ${de ? (/^[aeiouyhéèêâîôûœ]/i.test(B) ? "d’" : "de ") : ""}${B}`;
};
// Not what anyone talks about: colleagues' names (proper nouns matching a senator's name) and group names.
const NAMES = new Set(senateurs.flatMap((d) => `${d.prenom} ${d.nom}`.toLowerCase().split(/[\s\-’']+/)).filter((w) => w.length >= 3).map(fold));
const GROUP_WORDS = new Set(["rdpi", "rdse", "crce", "crce-k", "gest", "ser", "uci", "unt", "républicains", "centriste", "centristes", "indépendants", "socialistes", "écologistes", "communistes", "kanaky"].map(fold));
const GROUP_PAIRS = new Set(["union centriste", "les républicains", "rassemblement démocrates", "démocrates progressistes", "progressistes indépendants", "socialiste écologiste", "écologiste républicain", "communiste républicain", "républicain citoyen", "citoyen écologiste", "rassemblement démocratique", "démocratique social", "social européen", "écologiste solidarité", "solidarité territoires", "république territoires", "union nationale", "nationale territoires"].map((x) => x.split(" ").map(fold).join("|")));
// "Union" on its own is mostly "Union centriste" ("Union européenne" as a phrase stays)
const GROUP_SINGLES = new Set(["union"]);
const excludedWord = (id) => GROUP_WORDS.has(lemmas[id]) || (NAMES.has(lemmas[id]) && isProper(id));
const excluded = (id) => {
  if (!isPair(id)) return GROUP_SINGLES.has(lemmas[id]) || excludedWord(id);
  const [a, b] = pairParts(pairOf[id - lemmas.length]);
  return excludedWord(a) || excludedWord(b) || GROUP_PAIRS.has(`${lemmas[a]}|${lemmas[b]}`);
};
const termText = (id) => (isPair(id) ? pairDisplay(pairOf[id - lemmas.length]) : display(id));
console.log(`✓ ${pairIds.size} recurring phrases`);

const mpCounts = new Map();
const groupOf = (mp) => senById.get(mp)?.groupe?.abrev ?? "NI";
const groupCounts = new Map();
const chamber = new Map();
const termTheme = new Map();
const mpThemes = new Map();
const groupThemes = new Map();
const chamberThemes = new Float32Array(T);
const mpClassified = new Map();
const sittingDf = new Map();
const lastSit = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
for (const s of speeches) {
  const mc = mpCounts.get(s.mp) ?? mpCounts.set(s.mp, new Map()).get(s.mp);
  const g = groupOf(s.mp);
  const gc = groupCounts.get(g) ?? groupCounts.set(g, new Map()).get(g);
  const terms = [];
  for (const id of s.seq) if (id >= 0) terms.push(id);
  for (const [k, i, j] of pairs(s.seq, true)) {
    const pid = pairIds.get(k);
    if (pid === undefined) continue;
    terms.push(pid);
    const ps = pairSurf.get(pid) ?? pairSurf.set(pid, new Map()).get(pid);
    const key = `${s.surf[i]}|${s.surf[j]}`;
    if (ps.size < 6 || ps.has(key)) bump(ps, key);
  }
  for (const id of terms) {
    bump(mc, id); bump(gc, id); bump(chamber, id);
    if (lastSit.get(id) !== s.sit) { lastSit.set(id, s.sit); bump(sittingDf, id); }
  }
  if (s.themes) {
    const mt = mpThemes.get(s.mp) ?? mpThemes.set(s.mp, new Float32Array(T)).get(s.mp);
    const gt = groupThemes.get(g) ?? groupThemes.set(g, new Float32Array(T)).get(g);
    bump(mpClassified, s.mp);
    for (let t = 0; t < T; t++) {
      const w = s.themes[t] * s.weight;
      if (!w) continue;
      mt[t] += w; gt[t] += w; chamberThemes[t] += w;
    }
    for (const id of terms) {
      const v = termTheme.get(id) ?? termTheme.set(id, new Float32Array(T)).get(id);
      for (let t = 0; t < T; t++) v[t] += s.themes[t];
    }
  }
}

const themeOfTerm = (id) => {
  if (!isPair(id) && lemmaTheme[id] >= 0) return lemmaTheme[id];
  if (isPair(id)) {
    const [a, b] = pairParts(pairOf[id - lemmas.length]);
    const th = pairRules.get(`${lemmas[a]}|${lemmas[b]}`);
    if (th !== undefined) return th;
  }
  const v = termTheme.get(id);
  if (!v) return -1;
  const total = v.reduce((s, x) => s + x, 0);
  const n = chamber.get(id) ?? 0;
  if (total < 5 || total < 0.25 * n) return -1;
  let best = 0;
  for (let t = 1; t < T; t++) if (v[t] > v[best]) best = t;
  return v[best] / total >= 0.5 ? best : -1;
};
const shares = (v) => {
  const total = v ? v.reduce((s, x) => s + x, 0) : 0;
  return Object.fromEntries(THEMES.map(([id], t) => [id, total ? Math.round((1000 * v[t]) / total) / 1000 : 0]));
};
const r3 = (x) => Math.round(x * 1000) / 1000;
const pack = (list) => list.map(([id, w]) => [termText(id), r3(w), themeOfTerm(id) >= 0 ? THEMES[themeOfTerm(id)][0] : null]);

// TF-IDF with each senator as a document
const df = new Map();
for (const mc of mpCounts.values()) for (const id of mc.keys()) bump(df, id);
const N = mpCounts.size;
function topTerms(counts, score, n = TOP_TERMS) {
  const scored = [];
  for (const [id, c] of counts) {
    if (excluded(id)) continue;
    const s = score(id, c);
    if (s > 0) scored.push([id, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const picked = [];
  const covered = new Set();
  for (const [id, s] of scored) {
    if (picked.length >= n) break;
    if (!isPair(id) && covered.has(id)) continue;
    picked.push([id, s]);
    if (isPair(id)) {
      const k = pairOf[id - lemmas.length];
      const pc = counts.get(id);
      for (const w of pairParts(k).slice(0, 2)) if (pc >= 0.6 * (counts.get(w) ?? 0)) covered.add(w);
    }
  }
  const max = picked[0]?.[1] ?? 1;
  return picked.map(([id, s]) => [id, s / max]);
}

const mpTerms = new Map();
for (const mp of senStat.keys()) {
  const mc = mpCounts.get(mp) ?? new Map();
  const total = [...mc.values()].reduce((s, x) => s + x, 0) || 1;
  mpTerms.set(mp, topTerms(mc, (id, c) => (c < 3 ? 0 : (c / total) * Math.log((N + 1) / ((df.get(id) ?? 1) + 0.5)) * (isPair(id) ? 1.4 : 1))));
}

const chamberTotal = [...chamber.values()].reduce((s, x) => s + x, 0);
const chamberTerms = topTerms(chamber, (id, c) => (c < 50 ? 0 : c * Math.log((S + 1) / (sittingDf.get(id) ?? S)) * (isPair(id) ? 1.5 : 1)), 80);
const groups = {};
const groupTerms = new Map();
for (const [g, gc] of groupCounts) {
  const d = senateurs.find((x) => (x.groupe?.abrev ?? "NI") === g);
  const gTotal = [...gc.values()].reduce((s, x) => s + x, 0) || 1;
  const terms = topTerms(gc, (id, c) => {
    if (c < 15) return 0;
    const ratio = c / gTotal / ((chamber.get(id) ?? 1) / chamberTotal);
    return ratio > 1.2 ? c * Math.log(ratio) : 0;
  }, 60);
  groupTerms.set(g, terms);
  const members = senateurs.filter((x) => (x.groupe?.abrev ?? "NI") === g).map((x) => x.id);
  groups[g] = {
    libelle: d?.groupe?.libelle ?? g,
    couleur: d?.groupe?.couleur ?? "#999999",
    mps: members.length,
    speeches: members.reduce((s, id) => s + (senStat.get(id)?.n ?? 0), 0),
    words: members.reduce((s, id) => s + (senStat.get(id)?.words ?? 0), 0),
    themes: shares(groupThemes.get(g)),
    terms: pack(terms).map((t, i) => [...t, gc.get(terms[i][0]) ?? 0]),
  };
}

// ---------- sources: where each cloud word was said ----------
// Each quote links to its paragraph in the single-page record of that day on senat.fr (…_mono.html#par_N).
const wantMp = new Map([...mpTerms].map(([mp, t]) => [mp, new Set(t.map(([id]) => id))]));
const wantAll = new Set([...chamberTerms, ...[...groupTerms.values()].flat()].map(([id]) => id));
const mpSrc = new Map();
const allSrc = new Map();
const isoOf = (si) => sitMeta[speeches[si].sit].iso;
function keepNewest(list, ref, k, clash) {
  if (list.length >= k && isoOf(ref[0]) <= isoOf(list[k - 1][0])) return list;
  const i = list.findIndex((r) => clash(speeches[r[0]]));
  if (i >= 0) {
    if (isoOf(ref[0]) <= isoOf(list[i][0])) return list;
    list.splice(i, 1);
  }
  list.push(ref);
  list.sort((a, b) => (isoOf(b[0]) < isoOf(a[0]) ? -1 : isoOf(b[0]) > isoOf(a[0]) ? 1 : 0));
  if (list.length > k) list.length = k;
  return list;
}
speeches.forEach((s, si) => {
  if (s.words < 8) return;
  const mine = wantMp.get(s.mp);
  const seen = new Set();
  const visit = (id, pos, pos2 = -1) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (mine?.has(id)) {
      const key = `${s.mp}|${id}`;
      mpSrc.set(key, keepNewest(mpSrc.get(key) ?? [], [si, pos, pos2], 2, (o) => o.sit === s.sit));
    }
    if (wantAll.has(id)) allSrc.set(id, keepNewest(allSrc.get(id) ?? [], [si, pos, pos2], 3, (o) => o.mp === s.mp));
  };
  s.seq.forEach((id, i) => { if (id >= 0) visit(id, i); });
  for (const [k, i, j] of pairs(s.seq, true)) { const pid = pairIds.get(k); if (pid !== undefined) visit(pid, i, j); }
});
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function quote([si, pos, pos2], withMp) {
  const s = speeches[si];
  const surf = surfList[s.surf[pos]] ?? "";
  const surf2 = pos2 >= 0 ? surfList[s.surf[pos2]] ?? "" : "";
  const text = s.text.replace(/\s+/g, " ").replace(/\s+([,.;:!?)])/g, "$1").trim();
  const word = (w) => `(?<![\\p{L}])${reEsc(w)}(?![\\p{L}])`;
  const link = "[\\s’'\\-]+(?:(?:de|du|des|d|l|la)[\\s’']+){0,2}";
  const m = (surf2 ? new RegExp(`${word(surf)}${link}${word(surf2)}`, "iu").exec(text) : null) ?? (surf ? new RegExp(word(surf), "iu").exec(text) : null);
  const at = m ? m.index : 0, len = m ? m[0].length : 0;
  let a = Math.max(0, at - 80), b = Math.min(text.length, at + len + 80);
  if (a > 0) a = text.indexOf(" ", a) + 1 || a;
  if (b < text.length) { const sp = text.lastIndexOf(" ", b); if (sp > at + len) b = sp; }
  const lead = a > 0 ? "…" : "";
  const x = `${lead}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
  const sm = sitMeta[s.sit];
  const out = { d: sm.iso, t: debateTitles[s.debate] ?? "", u: `${sm.uid}#${s.pid}`, x, h: m ? [at - a + lead.length, at - a + lead.length + len] : null };
  if (withMp) out.m = s.mp;
  return out;
}
const packMp = (mp, list) => {
  const mc = mpCounts.get(mp) ?? new Map();
  return list.map(([id, w]) => [termText(id), r3(w), themeOfTerm(id) >= 0 ? THEMES[themeOfTerm(id)][0] : null, mc.get(id) ?? 0, (mpSrc.get(`${mp}|${id}`) ?? []).map((r) => quote(r))]);
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const mps = {};
let written = 0;
for (const [mp, st] of senStat) {
  const sh = shares(mpThemes.get(mp));
  mps[mp] = { n: st.n, i: st.inter, w: st.words, c: mpClassified.get(mp) ?? 0, t: THEMES.map(([id]) => sh[id]) };
  if (!safeName(mp)) continue;
  await writeFile(new URL(`${mp}.json`, OUT), JSON.stringify({ id: mp, speeches: st.n, interjections: st.inter, words: st.words, classified: mpClassified.get(mp) ?? 0, first: st.first, last: st.last, terms: packMp(mp, mpTerms.get(mp)), themes: sh }));
  written++;
}
const words = {};
for (const id of wantAll) {
  let m = 0;
  for (const mc of mpCounts.values()) if (mc.has(id)) m++;
  words[termText(id)] = { n: chamber.get(id) ?? 0, m, src: (allSrc.get(id) ?? []).map((r) => quote(r, true)) };
}
await writeFile(new URL("words.json", OUT), JSON.stringify(words));

// ranks/NN.json: same FNV-1a sharding as the Assemblée (src/views/speeches.ts)
const SHARDS = 32;
const shardOf = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h % SHARDS;
};
const ids = [...mpCounts.keys()].sort();
const idIndex = new Map(ids.map((id, i) => [id, i]));
const ranked = new Set(wantAll);
for (const list of mpTerms.values()) for (const [id] of list) ranked.add(id);
const shards = Array.from({ length: SHARDS }, () => ({}));
for (const id of ranked) {
  const by = [];
  for (const [mp, mc] of mpCounts) { const c = mc.get(id); if (c) by.push([idIndex.get(mp), c]); }
  by.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const text = termText(id);
  shards[shardOf(text)][text] = [chamber.get(id) ?? 0, ...by.flat()];
}
await mkdir(new URL("ranks/", OUT), { recursive: true });
for (let i = 0; i < SHARDS; i++) await writeFile(new URL(`ranks/${String(i).padStart(2, "0")}.json`, OUT), JSON.stringify({ ids, w: shards[i] }));
console.log(`✓ senator rankings for ${ranked.size} words`);
speeches.length = 0;

const summary = {
  source: { url: PAGE, file: SOURCE, record: RECORD },
  period: { from: firstDate, to: lastDate, sittings: S },
  themes: THEMES.map(([id, fr, en]) => ({ id, fr, en })),
  chamber: {
    speeches: [...senStat.values()].reduce((s, x) => s + x.n, 0),
    words: [...senStat.values()].reduce((s, x) => s + x.words, 0),
    themes: shares(chamberThemes),
    terms: pack(chamberTerms),
  },
  groups,
  /** per senator (matricule): n speeches, i brief interventions, w words, c speeches classified into a theme, t shares in `themes` order */
  mps,
};
await writeFile(new URL("summary.json", OUT), JSON.stringify(summary));
await writeFile(new URL("meta.json", OUT), JSON.stringify({ syncedAt: new Date().toISOString(), source: { url: SOURCE, page: PAGE, lastModified }, coverage: { from: firstDate, to: lastDate, sittingDays: S, senatorsWithSpeeches: senStat.size, senatorsWithCloud: [...mpTerms.values()].filter((t) => t.length).length, senators: senateurs.length }, skippedFiles: skipped }, null, 2));
console.log(`✓ wrote public/data/senat/interventions/ (summary + ${written} senators, ${[...mpTerms.values()].filter((t) => t.length).length} with a cloud)`);
