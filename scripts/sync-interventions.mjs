// What MPs say in the chamber: word clouds and theme rankings from the official verbatim record
// (comptes rendus des débats, séance publique) of the 17th legislature.
// Source: https://data.assemblee-nationale.fr (Syceron XML, refreshed nightly).
//
//   npm run sync:interventions            (re-downloads the zip if the cached copy is older than 20 h)
//   npm run sync:interventions -- --cache (always use the cached zip in .cache/interventions/)
//
// Each <paragraphe id_acteur="PA…"> of the record is one speech by one person. We keep the ones by
// sitting MPs (ids from public/data/an/deputes.json) while not chairing the sitting, strip stage
// directions, tokenise, drop stopwords and procedural boilerplate, fold plurals/feminines crudely,
// and count words and two-word phrases ("pouvoir d’achat", "fin de vie").
// Every speech is also classified into themes with a keyword lexicon (THEMES below), helped by the
// title of the agenda item being debated.
//
// Output (public/data/an/interventions/):
//   summary.json   themes, chamber + per-group theme shares and top terms, per-MP theme shares
//   meta.json      sync time and source timestamp (kept apart so data files only change with the data)
//   <PA>.json      one MP: speech counts, top ~60 distinctive terms (TF-IDF vs the other MPs), theme shares

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

const LEG = 17;
const SOURCE = `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}/vp/syceronbrut/syseron.xml.zip`;
const CACHE = new URL("../.cache/interventions/", import.meta.url);
const ZIP = new URL("syseron.xml.zip", CACHE);
const OUT = new URL("../public/data/an/interventions/", import.meta.url);
const DEPUTES = new URL("../public/data/an/deputes.json", import.meta.url);
const TOP_TERMS = 60;

// ---------- themes: keyword lexicon ----------
// Words are matched after the same folding as speech text (lowercase, plural/feminine folded);
// "x*" matches any word starting with x; two-word entries match phrases ("de" between allowed).
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

// ---------- stopwords and parliamentary boilerplate ----------
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

// ---------- text cleaning and tokenising ----------
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
function clean(xml) {
  return xml
    .replace(/<italique>\s*\([\s\S]*?\)\s*<\/italique>/g, " ") // (Applaudissements…), (Exclamations…)
    .replace(/<exposant>[\s\S]*?<\/exposant>/g, "") // n<exposant>o</exposant>
    .replace(/<br\s*\/?>/g, " . ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, (e) => ENT[e] ?? " ")
    .replace(/\([^)]{0,200}\)/g, " ") // remaining stage directions
    .replace(/['`]/g, "’");
}
const SPLIT = /([\p{L}][\p{L}’\-]*[\p{L}]|[\p{L}])|([.!?;:,«»"–—()…])/gu;
const AMEND = /\b(?:amendements?|sous-amendements?|articles?|alinéas?)\s+(?:n\s*[o°]s?\s*)?\d+[\w\s,et]*?/gi;
/** Text → sequence of lemma ids; -1 marks a break (punctuation, stopword), -2 a "de" connector. Surface forms go to `surf`. */
function tokenize(text, surf) {
  const seq = [];
  text = text.replace(AMEND, " . ").replace(/\b(?:monsieur|madame|mme|m\.)\s+(?:le|la)\s+(?:président|présidente|ministre|rapporteur|rapporteure|garde des sceaux)\b/gi, " . ");
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
await mkdir(CACHE, { recursive: true });
let cached = await stat(ZIP).catch(() => null);
let lastModified = null;
if (!args.has("--cache") && (!cached || Date.now() - cached.mtimeMs > 20 * 3600e3)) {
  console.log(`↓ ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${SOURCE}`);
  lastModified = res.headers.get("last-modified");
  await writeFile(ZIP, new Uint8Array(await res.arrayBuffer()));
  cached = await stat(ZIP);
} else console.log(`· using cached ${ZIP.pathname}`);
lastModified ??= cached.mtime.toUTCString();

const deputes = JSON.parse(await readFile(DEPUTES, "utf8"));
const mpById = new Map(deputes.map((d) => [d.id, d]));
const files = unzipSync(new Uint8Array(await readFile(ZIP)), { filter: (f) => f.name.endsWith(".xml") });
const names = Object.keys(files).sort();
console.log(`✓ ${names.length} sittings in the archive`);

// ---------- pass 1: parse every sitting into speeches ----------
const speeches = []; // { mp, seq: Int32Array, words, themes: Float32Array | null, weight }
const mpStat = new Map(); // mp -> { n, inter, words, first, last }
let firstDate = "9999", lastDate = "0000";
const RE = /<point nivpoint="(\d+)"[^>]*>\s*(?:<orateurs\s*\/>)?\s*(?:<texte[^>]*>([\s\S]*?)<\/texte>)?|<paragraphe ([^>]*)>([\s\S]*?)<\/paragraphe>/g;
const attr = (s, k) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "";
const titleThemes = (txt) => {
  const v = new Float32Array(T);
  const seq = tokenize(clean(txt));
  for (const id of seq) if (id >= 0 && lemmaTheme[id] >= 0) v[lemmaTheme[id]] = 1;
  for (const k of pairs(seq)) {
    const [a, b] = pairParts(k);
    const th = pairRules.get(`${lemmas[a]}|${lemmas[b]}`);
    if (th !== undefined) v[th] = 1;
  }
  return v;
};

let sittings = 0;
const sitMeta = []; // sitting index -> { uid, iso }
const debateTitles = []; // agenda item titles, referenced by index from speeches
const titleIdx = new Map();
const plain = (x) => clean(x).replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").trim();
for (const name of names) {
  sittings++;
  const xml = strFromU8(files[name]);
  delete files[name];
  const date = xml.match(/<dateSeance>(\d{8})/)?.[1];
  if (!date) continue;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const sit = sitMeta.push({ uid: xml.match(/<uid>([^<]+)<\/uid>/)?.[1] ?? "", iso }) - 1;
  let debate = -1;
  if (iso < firstDate) firstDate = iso;
  if (iso > lastDate) lastDate = iso;
  const titles = [null, new Float32Array(T), new Float32Array(T)];
  for (const m of xml.matchAll(RE)) {
    if (m[1]) {
      const lvl = Number(m[1]);
      if (lvl <= 2 && m[2]) {
        titles[lvl] = titleThemes(m[2]);
        if (lvl === 1) {
          titles[2] = new Float32Array(T);
          const t = plain(m[2]).replace(/\s*\(n[o°]?\s*[\d\s,et]*\)\s*$/i, "");
          if (!titleIdx.has(t)) titleIdx.set(t, debateTitles.push(t) - 1);
          debate = titleIdx.get(t);
        }
      }
      continue;
    }
    const a = m[3];
    const mp = attr(a, "id_acteur");
    if (!mpById.has(mp) || attr(a, "roledebat") === "president") continue;
    const body = m[4].match(/<texte[^>]*>([\s\S]*?)<\/texte>/)?.[1];
    if (!body) continue;
    const surf = [];
    const text = clean(body);
    const seq = tokenize(text, surf);
    const words = seq.reduce((n, x) => n + (x >= 0 ? 1 : 0), 0);
    const st = mpStat.get(mp) ?? { n: 0, inter: 0, words: 0, first: iso, last: iso };
    mpStat.set(mp, st);
    if (iso < st.first) st.first = iso;
    if (iso > st.last) st.last = iso;
    const interruption = attr(a, "code_grammaire").startsWith("INTERRUPTION");
    if (interruption) st.inter++;
    else st.n++;
    if (!words) continue;
    st.words += words;

    // theme scores: lexicon hits in the speech, plus the agenda item's title as a prior
    let themes = null;
    if (!interruption && words >= 12) {
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
    speeches.push({ sit, debate, pid: attr(a, "id_syceron"), text, mp, seq: Int32Array.from(seq), surf: Int32Array.from(seq, (x, i) => (x >= 0 ? surf[i] : -1)), words, themes, weight: Math.sqrt(Math.min(words, 800)) });
  }
}
console.log(`✓ ${speeches.length} speeches by ${mpStat.size} sitting MPs (${firstDate} → ${lastDate}), ${lemmas.length} distinct words`);

// ---------- pass 2: counts ----------
// phrases worth keeping: frequent across the chamber and used by several MPs
const pairCount = new Map();
const pairMps = new Map();
for (const s of speeches) {
  for (const k of pairs(s.seq)) {
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
}
for (const [k, n] of pairCount) if (n < 25) pairCount.delete(k);
for (const s of speeches) for (const k of pairs(s.seq)) if (pairCount.has(k)) (pairMps.get(k) ?? pairMps.set(k, new Set()).get(k)).add(s.mp);
for (const [k, set] of pairMps) if (set.size < 4) pairCount.delete(k);
pairMps.clear();
// a phrase id lives after the word ids
const pairIds = new Map([...pairCount.keys()].map((k, i) => [k, lemmas.length + i]));
const isPair = (id) => id >= lemmas.length;
const pairOf = [...pairCount.keys()];
const pairSurf = new Map(); // phrase id -> Map("sa|sb" -> n): the phrase as people actually say it
const pairDisplay = (k) => {
  const [a, b, de] = pairParts(k);
  const best = [...(pairSurf.get(pairIds.get(k))?.entries() ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0].split("|").map(Number);
  const A = best ? shape(a, surfList[best[0]]) : display(a);
  const B = best ? shape(b, surfList[best[1]]) : display(b);
  return `${A} ${de ? (/^[aeiouyhéèêâîôûœ]/i.test(B) ? "d’" : "de ") : ""}${B}`;
};
// Not what anyone talks about: colleagues' names (proper nouns matching an MP's name) and group names.
const NAMES = new Set(deputes.flatMap((d) => `${d.prenom} ${d.nom}`.toLowerCase().split(/[\s\-’']+/)).filter((w) => w.length >= 3).map(fold));
const GROUP_WORDS = new Set(["liot", "udr", "gdr", "horizons", "apparentés", "démocrates", "modem", "rassemblement", "epr", "indépendants", "insoumis", "socialistes", "écologistes", "communistes", "républicaine"].map(fold));
const GROUP_PAIRS = new Set(["rassemblement national", "droite républicaine", "horizons indépendants", "gauche démocrates", "ensemble république", "titre personnel", "insoumise nouveau", "nouveau populaire", "front populaire", "france insoumise"].map((x) => x.split(" ").map(fold).join("|")));
const excluded = (id) => {
  if (!isPair(id)) return GROUP_WORDS.has(lemmas[id]) || (NAMES.has(lemmas[id]) && isProper(id));
  const [a, b] = pairParts(pairOf[id - lemmas.length]);
  return excluded(a) || excluded(b) || GROUP_PAIRS.has(`${lemmas[a]}|${lemmas[b]}`);
};
const termText = (id) => (isPair(id) ? pairDisplay(pairOf[id - lemmas.length]) : display(id));
console.log(`✓ ${pairIds.size} recurring phrases`);

const mpCounts = new Map(); // mp -> Map(term -> n)
const groupOf = (mp) => mpById.get(mp)?.groupe?.abrev ?? "NI";
const groupCounts = new Map();
const chamber = new Map();
const termTheme = new Map(); // term -> Float32Array(T)
const mpThemes = new Map(); // mp -> Float32Array(T) (weights)
const groupThemes = new Map();
const chamberThemes = new Float32Array(T);
const mpClassified = new Map();
const sittingDf = new Map(); // term -> number of sittings it appears in
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

// a word's theme: from the lexicon, else the theme of the speeches it mostly appears in
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

// TF-IDF with each MP as a document: words everyone uses (gouvernement, France) fade out,
// each MP's own subjects and places stand out.
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
  // drop a single word when a chosen phrase already covers most of its uses
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
for (const mp of mpStat.keys()) {
  const mc = mpCounts.get(mp) ?? new Map();
  const total = [...mc.values()].reduce((s, x) => s + x, 0) || 1;
  mpTerms.set(mp, topTerms(mc, (id, c) => (c < 3 ? 0 : (c / total) * Math.log((N + 1) / ((df.get(id) ?? 1) + 0.5)) * (isPair(id) ? 1.4 : 1))));
}

// chamber: frequent words weighted by how topical they are (rare across sittings = more topical)
const S = names.length;
const chamberTotal = [...chamber.values()].reduce((s, x) => s + x, 0);
const chamberTerms = topTerms(chamber, (id, c) => (c < 50 ? 0 : c * Math.log((S + 1) / (sittingDf.get(id) ?? S)) * (isPair(id) ? 1.5 : 1)), 80);
// groups: words a group uses far more than the chamber as a whole (log-ratio keyness)
const groups = {};
const groupTerms = new Map();
for (const [g, gc] of groupCounts) {
  const d = deputes.find((x) => (x.groupe?.abrev ?? "NI") === g);
  const gTotal = [...gc.values()].reduce((s, x) => s + x, 0) || 1;
  const terms = topTerms(gc, (id, c) => {
    if (c < 15) return 0;
    const ratio = c / gTotal / ((chamber.get(id) ?? 1) / chamberTotal);
    return ratio > 1.2 ? c * Math.log(ratio) : 0;
  }, 60);
  groupTerms.set(g, terms);
  const members = deputes.filter((x) => (x.groupe?.abrev ?? "NI") === g).map((x) => x.id);
  groups[g] = {
    libelle: d?.groupe?.libelle ?? g,
    couleur: d?.groupe?.couleur ?? "#999999",
    mps: members.length,
    speeches: members.reduce((s, id) => s + (mpStat.get(id)?.n ?? 0), 0),
    words: members.reduce((s, id) => s + (mpStat.get(id)?.words ?? 0), 0),
    themes: shares(groupThemes.get(g)),
    // [text, weight, theme, times the group said it]
    terms: pack(terms).map((t, i) => [...t, gc.get(terms[i][0]) ?? 0]),
  };
}

// ---------- sources: where each cloud word was said ----------
// For every word in an MP's cloud, their two most recent speeches using it; for every word in the
// chamber and group clouds, the MPs who say it most and three recent quotes by different MPs.
// Each quote links to its paragraph in the official record (the anchor is the paragraph's id_syceron).
const wantMp = new Map([...mpTerms].map(([mp, t]) => [mp, new Set(t.map(([id]) => id))]));
const wantAll = new Set([...chamberTerms, ...[...groupTerms.values()].flat()].map(([id]) => id));
const mpSrc = new Map(); // "mp|id" -> [[speech, pos]] newest first
const allSrc = new Map(); // id -> [[speech, pos]] newest first
const isoOf = (si) => sitMeta[speeches[si].sit].iso;
/** Keeps the k newest refs, skipping one that clashes (same sitting, or same MP) with a kept one. */
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
  if (s.words < 8) return; // a heckle makes a poor quote
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
/** A ~200-character extract around the word, with the word's span in it. */
function quote([si, pos, pos2], withMp) {
  const s = speeches[si];
  const surf = surfList[s.surf[pos]] ?? "";
  const surf2 = pos2 >= 0 ? surfList[s.surf[pos2]] ?? "" : "";
  const text = s.text.replace(/\s+/g, " ").replace(/\s+([,.;:!?)])/g, "$1").trim();
  // a phrase: both words, with "de", "d’", "l’"… allowed in between
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
for (const [mp, st] of mpStat) {
  const sh = shares(mpThemes.get(mp));
  mps[mp] = { n: st.n, i: st.inter, w: st.words, c: mpClassified.get(mp) ?? 0, t: THEMES.map(([id]) => sh[id]) };
  await writeFile(new URL(`${mp}.json`, OUT), JSON.stringify({ id: mp, speeches: st.n, interjections: st.inter, words: st.words, classified: mpClassified.get(mp) ?? 0, first: st.first, last: st.last, terms: packMp(mp, mpTerms.get(mp)), themes: sh }));
  written++;
}
// words.json: every chamber/group cloud word: how often, by how many MPs, recent quotes
const words = {};
for (const id of wantAll) {
  let m = 0;
  for (const mc of mpCounts.values()) if (mc.has(id)) m++;
  words[termText(id)] = { n: chamber.get(id) ?? 0, m, src: (allSrc.get(id) ?? []).map((r) => quote(r, true)) };
}
await writeFile(new URL("words.json", OUT), JSON.stringify(words));

// ranks/NN.json: for every word in any cloud (chamber, group or MP), every MP who said it, most first.
// Sharded by a hash of the word (same FNV-1a as src/views/speeches.ts) so a click loads ~1/32 of it.
// MPs are written as indexes into the shard's `ids` list to keep files small.
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
  // n: times said in the chamber; then [mp index, times] for every MP who said it
  shards[shardOf(text)][text] = [chamber.get(id) ?? 0, ...by.flat()];
}
await mkdir(new URL("ranks/", OUT), { recursive: true });
for (let i = 0; i < SHARDS; i++) await writeFile(new URL(`ranks/${String(i).padStart(2, "0")}.json`, OUT), JSON.stringify({ ids, w: shards[i] }));
console.log(`✓ MP rankings for ${ranked.size} words`);
speeches.length = 0;

// Data files only change when the record does (the daily workflow commits only real changes);
// sync time and source timestamp go to meta.json.
const summary = {
  legislature: LEG,
  source: { url: SOURCE },
  period: { from: firstDate, to: lastDate, sittings: S },
  themes: THEMES.map(([id, fr, en]) => ({ id, fr, en })),
  chamber: {
    speeches: [...mpStat.values()].reduce((s, x) => s + x.n, 0),
    words: [...mpStat.values()].reduce((s, x) => s + x.words, 0),
    themes: shares(chamberThemes),
    terms: pack(chamberTerms),
  },
  groups,
  /** per MP: n speeches, i interjections, w words, c speeches classified into a theme, t shares in `themes` order */
  mps,
};
await writeFile(new URL("summary.json", OUT), JSON.stringify(summary));
await writeFile(new URL("meta.json", OUT), JSON.stringify({ syncedAt: new Date().toISOString(), source: { url: SOURCE, lastModified } }, null, 2));
console.log(`✓ wrote public/data/an/interventions/ (summary + ${written} MPs)`);
