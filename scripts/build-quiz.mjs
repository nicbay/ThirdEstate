// The "Qui vous ressemble ?" quiz (#/quiz): a compact dataset so the page never downloads the 574 vote files.
//
//   npm run build:quiz                  writes public/data/an/quiz.json (runs after sync:an and sync:interventions)
//   node scripts/build-quiz.mjs --rank  lists candidate votes, most divisive first (optional regex on the title, count)
//                                       e.g. node scripts/build-quiz.mjs --rank "ensemble" 60
//
// How the questions were chosen: --rank scores every public vote by participation × divergence between the
// groups (weighted standard deviation of each group's (pour − contre) / votes cast). From the top of that list,
// one or two votes per subject were picked by hand (final votes or the key article/amendment), so that the
// winning side varies: left against the rest, the right and the RN against the rest, government against
// opposition, and votes that cut across blocs (pensions, doctors, ZFE). Each is rewritten as a plain question
// with one neutral line of context; the wording describes what the text does, not what its sponsors or
// opponents call it. When the recorded vote was on deleting the text (`inv`), positions are flipped so that
// "Pour" always means for the proposal in the question.
//
// Output (public/data/an/quiz.json):
//   questions[]  id, scrutin number, date, theme, fr/en question + context, official result
//   themes[]     the 17 speech themes (same order as interventions/summary.json)
//   groups{}     per group: name, colour, size, line (one char per question: P/C/A/-), cohesion %, theme ranks
//   mps[]        [id, name, group, département, positions (P/C/A/-), theme ranks (0–9 per theme or ""), top words]
// Theme ranks: where the MP (or group) stands among all MPs (groups) by share of their speeches on that theme,
// 0 = least, 9 = most. MPs with fewer than 10 classified speeches get "".
import { readFile, readdir, writeFile } from "node:fs/promises";

const AN = new URL("../public/data/an/", import.meta.url);
const readJson = async (u) => JSON.parse(await readFile(u, "utf8"));

/** The curated questions, in the order the quiz asks them. */
const QUESTIONS = [
  {
    id: "retraites", n: 3684, theme: "travail",
    fr: ["Faut-il suspendre jusqu’en 2028 la réforme des retraites de 2023, qui relève progressivement l’âge légal de départ à 64 ans ?", "Article du budget de la Sécurité sociale pour 2026 qui gèle le relèvement de l’âge légal et de la durée de cotisation."],
    en: ["Should the 2023 pension reform, which gradually raises the legal retirement age to 64, be suspended until 2028?", "Article of the 2026 Social Security budget freezing the rise in the legal age and in required years of contributions."],
  },
  {
    id: "fin-de-vie", n: 2107, theme: "sante",
    fr: ["Faut-il créer un droit à l’aide à mourir pour les malades majeurs atteints d’une affection grave et incurable, à certaines conditions ?", "Proposition de loi sur la fin de vie, vote sur l’ensemble en première lecture. Un texte distinct sur les soins palliatifs a été voté le même jour."],
    en: ["Should adults with a serious and incurable illness have a right to assisted dying, under certain conditions?", "End-of-life bill, final vote at first reading. A separate bill on palliative care was voted the same day."],
  },
  {
    id: "mayotte", n: 1308, theme: "immigration",
    fr: ["Faut-il restreindre le droit du sol à Mayotte, en exigeant que les parents d’un enfant né sur l’île y résident régulièrement depuis plus d’un an ?", "Texte de compromis entre députés et sénateurs (commission mixte paritaire), dernier vote de l’Assemblée."],
    en: ["Should birthright citizenship be restricted in Mayotte, by requiring the parents of a child born there to have lived there legally for over a year?", "Compromise text agreed by MPs and senators (joint committee), the Assembly’s final vote."],
  },
  {
    id: "zucman", n: 881, theme: "budget",
    fr: ["Faut-il créer un impôt minimum de 2 % par an sur les patrimoines de plus de 100 millions d’euros ?", "Proposition de loi dite « taxe Zucman », du nom de l’économiste qui l’a conçue ; vote sur l’ensemble en première lecture."],
    en: ["Should fortunes above €100 million pay a minimum tax of 2% a year?", "The so-called “Zucman tax” bill, named after the economist who designed it; final vote at first reading."],
  },
  {
    id: "duplomb", n: 2957, theme: "agriculture",
    fr: ["Faut-il assouplir plusieurs règles imposées aux agriculteurs (élevages, stockage de l’eau, pesticides), y compris la réautorisation par dérogation d’un insecticide néonicotinoïde ?", "Loi dite « Duplomb », texte de compromis députés-sénateurs. La réautorisation de l’acétamipride a ensuite été censurée par le Conseil constitutionnel."],
    en: ["Should several rules on farmers (livestock buildings, water storage, pesticides) be relaxed, including a waiver allowing a neonicotinoid insecticide again?", "The so-called “Duplomb law”, compromise text of MPs and senators. The waiver for acetamiprid was later struck down by the Constitutional Council."],
  },
  {
    id: "legitime-defense", n: 7987, theme: "securite",
    fr: ["Faut-il instaurer une présomption de légitime défense pour les policiers et les gendarmes dans l’exercice de leurs fonctions ?", "Proposition de loi, vote sur l’ensemble en première lecture."],
    en: ["Should police officers and gendarmes on duty be presumed to have acted in self-defence?", "Private member’s bill, final vote at first reading."],
  },
  {
    id: "ukraine", n: 988, theme: "international",
    fr: ["Faut-il appeler au renforcement du soutien de la France et de l’Union européenne à l’Ukraine ?", "Proposition de résolution européenne : un texte qui exprime la position de l’Assemblée, sans force contraignante."],
    en: ["Should France and the European Union step up their support for Ukraine?", "European resolution: a text stating the Assembly’s position, with no binding force."],
  },
  {
    id: "zfe", n: 8613, theme: "ecologie", inv: true,
    fr: ["Faut-il supprimer les zones à faibles émissions (ZFE), qui restreignent la circulation des véhicules les plus polluants dans certaines agglomérations ?", "Le vote portait sur un amendement supprimant l’article unique de la proposition d’abrogation : voter pour revenait à garder les ZFE. Les positions sont affichées dans le sens de la question."],
    en: ["Should low-emission zones (ZFE), which restrict the most polluting vehicles in some cities, be abolished?", "The vote was on an amendment deleting the repeal bill’s only article: voting for it meant keeping the zones. Positions are shown in the direction of the question."],
  },
  {
    id: "medecins", n: 1214, theme: "sante",
    fr: ["Faut-il réguler l’installation des médecins, en n’autorisant une nouvelle installation dans les zones déjà bien dotées qu’en cas de départ d’un confrère ?", "Amendement rétablissant l’article principal de la proposition de loi transpartisane contre les déserts médicaux."],
    en: ["Should doctors’ freedom to set up practice be regulated, allowing a new practice in well-served areas only when another doctor leaves?", "Amendment restoring the main article of the cross-party bill on medical deserts."],
  },
  {
    id: "sejour-irregulier", n: 3261, theme: "immigration", inv: true,
    fr: ["Faut-il rétablir le délit de séjour irrégulier, supprimé en 2012 ?", "Le vote portait sur des amendements supprimant l’article unique de la proposition : voter pour revenait à rejeter le rétablissement. Les positions sont affichées dans le sens de la question."],
    en: ["Should staying in France without valid papers become a criminal offence again, as it was until 2012?", "The vote was on amendments deleting the bill’s only article: voting for them meant rejecting it. Positions are shown in the direction of the question."],
  },
  {
    id: "arcelormittal", n: 4438, theme: "economie",
    fr: ["Faut-il nationaliser ArcelorMittal France, premier producteur d’acier du pays ?", "Proposition de loi, vote sur l’ensemble en première lecture."],
    en: ["Should ArcelorMittal France, the country’s largest steelmaker, be nationalised?", "Private member’s bill, final vote at first reading."],
  },
  {
    id: "corse", n: 7454, theme: "institutions",
    fr: ["Faut-il réviser la Constitution pour donner à la Corse un statut d’autonomie au sein de la République ?", "Projet de loi constitutionnel, première lecture. Une révision doit être votée dans les mêmes termes par le Sénat, puis approuvée par le Congrès ou par référendum."],
    en: ["Should the Constitution be amended to give Corsica autonomous status within the Republic?", "Constitutional bill, first reading. A revision must pass the Senate in the same terms, then the Congress or a referendum."],
  },
  {
    id: "energie", n: 2653, theme: "ecologie",
    fr: ["Faut-il adopter la programmation énergie-climat 2025-2035, qui relance le nucléaire et, après un amendement des députés, gelait les nouveaux projets éoliens et solaires ?", "Proposition de loi venue du Sénat ; le moratoire sur l’éolien et le solaire avait été ajouté quelques jours avant ce vote sur l’ensemble."],
    en: ["Should the 2025–2035 energy and climate plan be adopted, relaunching nuclear power and, after an MPs’ amendment, freezing new wind and solar projects?", "Bill from the Senate; the moratorium on wind and solar had been added a few days before this final vote."],
  },
  {
    id: "schengen", n: 8611, theme: "europe",
    fr: ["Faut-il refonder l’espace Schengen avec une double frontière, en ajoutant des contrôles aux frontières nationales à ceux des frontières extérieures de l’Union ?", "Proposition de résolution : un texte qui exprime la position de l’Assemblée, sans force contraignante."],
    en: ["Should the Schengen area be rebuilt around a double border, adding checks at national borders to those at the EU’s external borders?", "Resolution: a text stating the Assembly’s position, with no binding force."],
  },
  {
    id: "passoires", n: 219, theme: "logement", inv: true,
    fr: ["Faut-il assouplir l’interdiction progressive de louer les logements les moins bien isolés (les « passoires thermiques ») ?", "Le vote portait sur des amendements supprimant l’article unique de la proposition : voter pour revenait à maintenir le calendrier actuel. Les positions sont affichées dans le sens de la question."],
    en: ["Should the gradual ban on renting out the worst-insulated homes be relaxed?", "The vote was on amendments deleting the bill’s only article: voting for them meant keeping the current timetable. Positions are shown in the direction of the question."],
  },
  {
    id: "censure", n: 519, theme: "institutions", censure: true,
    fr: ["Fallait-il renverser le gouvernement de Michel Barnier, en décembre 2024, après son recours au 49.3 sur le budget de la Sécurité sociale ?", "Motion de censure adoptée : le gouvernement a démissionné. Seuls les votes pour sont décomptés lors d’une censure ; un député en fonction qui n’a pas voté pour est compté ici comme contre."],
    en: ["Should Michel Barnier’s government have been brought down in December 2024, after it forced the Social Security budget through with article 49.3?", "The censure motion passed and the government resigned. Only votes for are counted on a censure motion; a sitting MP who did not vote for it counts here as against."],
  },
  {
    id: "plfss-2026", n: 4758, theme: "budget",
    fr: ["Faut-il adopter le budget de la Sécurité sociale pour 2026 ?", "Dernier vote de l’Assemblée sur ce budget, qui comprenait notamment la suspension de la réforme des retraites."],
    en: ["Should the 2026 Social Security budget be adopted?", "The Assembly’s final vote on this budget, which included the suspension of the pension reform."],
  },
];

const GROUPS = ["LFI-NFP", "GDR", "ECOS", "SOC", "LIOT", "DEM", "EPR", "HOR", "DR", "UDR", "RN"];

/**
 * Long version: two measures from each candidate's own 2027 programme (public/data/programmes/compare.json),
 * asked as a proposal without saying whose it is. Chosen by hand from each candidate's logged measures so that
 * every candidate has the same number, the wording is a concrete proposal (not a slogan or a budget total), and
 * the set covers different subjects. The statement restates the measure in neutral terms; the quiz shows the
 * candidate's own wording (`text` in compare.json) next to it once the results are out. The build fails if a
 * measure no longer exists or has been dropped from the programme.
 */
const MEASURES = [
  ["arthaud", "m08", "Faut-il exproprier sans indemnité les actionnaires des grandes entreprises, en commençant par l’industrie pétrolière et l’armement ?", "Should the shareholders of large companies be expropriated without compensation, starting with the oil and arms industries?"],
  ["arthaud", "m09", "Faut-il régulariser tous les sans-papiers et garantir à chacun la liberté de circuler et de s’installer ?", "Should all undocumented migrants be regularised and everyone be free to move and settle?"],
  ["melenchon", "L919a7c", "Faut-il rétablir la retraite à 60 ans à taux plein, après 40 années de cotisation ?", "Should retirement at 60 on a full pension, after 40 years of contributions, be restored?"],
  ["melenchon", "L171b77", "Faut-il que la Sécurité sociale rembourse à 100 % les soins prescrits, en absorbant les complémentaires santé ?", "Should Social Security reimburse 100% of prescribed care, absorbing top-up health insurers?"],
  ["roussel", "m06", "Faut-il passer à la semaine de 32 heures, sans baisse de salaire ?", "Should the working week go down to 32 hours, with no cut in pay?"],
  ["roussel", "m18", "Faut-il nationaliser les grandes banques et compagnies d’assurance pour créer un pôle public financier ?", "Should the big banks and insurers be nationalised to form a public financial group?"],
  ["tondelier", "m07", "Faut-il créer un revenu versé automatiquement à partir de 18 ans, garantissant à chacun au moins 918 € par mois ?", "Should an income be paid automatically from the age of 18, guaranteeing everyone at least €918 a month?"],
  ["tondelier", "m11", "Faut-il que toute la nourriture servie dans les cantines publiques soit bio, locale et moins carnée ?", "Should all food served in public canteens be organic, local and less meat-based?"],
  ["glucksmann", "m06", "Faut-il instaurer un service civique obligatoire de dix mois pour tous les jeunes ?", "Should a compulsory ten-month civic service be introduced for all young people?"],
  ["glucksmann", "m10", "Faut-il saisir les 206 milliards d’euros d’avoirs publics russes gelés en Europe pour financer le soutien à l’Ukraine ?", "Should the €206bn of Russian state assets frozen in Europe be seized to fund support for Ukraine?"],
  ["attal", "m01", "Faut-il supprimer l’âge légal de départ à la retraite et ne retenir que la durée de cotisation ?", "Should the legal retirement age be scrapped, keeping only the number of years of contributions?"],
  ["attal", "m16", "Faut-il rétablir le redoublement, un certificat d’études en fin de CM2 et les groupes de niveau au collège ?", "Should repeating a year, a primary-school leaving certificate and ability groups in lower secondary school be brought back?"],
  ["philippe", "m01", "Faut-il porter progressivement l’âge de départ à la retraite à 65 ans ?", "Should the retirement age be raised gradually to 65?"],
  ["philippe", "m27", "Faut-il suspendre le regroupement familial pendant cinq ans ?", "Should family reunification be suspended for five years?"],
  ["villepin", "m04", "Faut-il créer un impôt unique et fortement progressif sur le patrimoine des 1 % les plus riches, à partir de 2,2 millions d’euros ?", "Should there be a single, steeply progressive tax on the wealth of the richest 1%, starting at €2.2 million?"],
  ["villepin", "m12", "Faut-il reprendre les autoroutes en gestion publique à la fin des concessions ?", "Should motorways return to public management when the concessions end?"],
  ["lisnard", "m11", "Faut-il remplacer les départements et les régions par des provinces ?", "Should départements and regions be replaced by provinces?"],
  ["lisnard", "m13", "Faut-il réserver le statut de fonctionnaire aux missions régaliennes et passer les autres agents publics sous contrat de droit privé ?", "Should civil-servant status be kept for core state functions only, with other public employees on private-law contracts?"],
  ["retailleau", "r05", "Faut-il fusionner le RSA, la prime d’activité et l’ASS en un revenu réduit de 30 %, avec 15 heures d’activité obligatoires par semaine ?", "Should the RSA, the in-work bonus and the ASS be merged into one benefit cut by 30%, with 15 compulsory hours of activity a week?"],
  ["retailleau", "r10", "Faut-il permettre au président, quand le Conseil constitutionnel censure une loi, de la soumettre au référendum ou au Congrès ?", "Should the president be able to put a law struck down by the Constitutional Council to a referendum or to Congress?"],
  ["dupont-aignan", "d01", "Faut-il organiser un référendum sur l’appartenance de la France à l’Union européenne ?", "Should a referendum be held on France’s membership of the European Union?"],
  ["dupont-aignan", "d16", "Faut-il supprimer la TVA sur 50 produits de première nécessité ?", "Should VAT be removed from 50 basic necessities?"],
  ["le-pen", "m03", "Faut-il réserver les prestations familiales aux foyers dont au moins un parent est français ?", "Should family benefits be reserved for households where at least one parent is French?"],
  ["le-pen", "m23", "Faut-il abroger la loi qui interdit la recherche d’hydrocarbures sur le sol français ?", "Should the law banning exploration for oil and gas on French soil be repealed?"],
  ["zemmour", "z03", "Faut-il expulser tout étranger, même en situation régulière, après un an de chômage ?", "Should any foreigner, even one legally resident, be expelled after a year of unemployment?"],
  ["zemmour", "z23", "Faut-il sortir la France de l’OTAN ?", "Should France leave NATO?"],
];

const deputes = await readJson(new URL("deputes.json", AN));
const scrutins = await readJson(new URL("scrutins.json", AN));
const byNum = new Map(scrutins.map((s) => [s[0], s]));
const votes = new Map();
for (const f of await readdir(new URL("votes/", AN))) votes.set(f.slice(0, -5), await readJson(new URL(`votes/${f}`, AN)));
const groupOf = (d) => d.groupe?.abrev ?? "NI";

if (process.argv[2] === "--rank") {
  const re = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
  const rows = [];
  for (const s of scrutins) {
    if (re && !re.test(s[2])) continue;
    const c = {};
    for (const d of deputes) {
      const x = votes.get(d.id)?.[s[0]];
      if (x && x !== "N" && GROUPS.includes(groupOf(d))) (c[groupOf(d)] ??= { P: 0, C: 0, A: 0 })[x]++;
    }
    const gs = Object.entries(c).map(([g, k]) => ({ g, t: k.P + k.C + k.A, pos: (k.P - k.C) / (k.P + k.C + k.A), line: k.P >= k.C && k.P >= k.A ? "P" : k.C >= k.A ? "C" : "A" }));
    const tot = gs.reduce((a, x) => a + x.t, 0);
    const mean = gs.reduce((a, x) => a + x.pos * x.t, 0) / (tot || 1);
    const sd = Math.sqrt(gs.reduce((a, x) => a + x.t * (x.pos - mean) ** 2, 0) / (tot || 1));
    rows.push({ s, tot, sd, line: GROUPS.map((g) => gs.find((x) => x.g === g)?.line ?? "-").join("") });
  }
  console.log(`numero date cast divergence lines(${GROUPS.join(" ")}) result title`);
  for (const r of rows.sort((a, b) => b.tot * b.sd - a.tot * a.sd).slice(0, Number(process.argv[4] ?? 80)))
    console.log(r.s[0], r.s[1], r.tot, r.sd.toFixed(2), r.line, r.s[3], r.s[2].slice(0, 180));
  process.exit(0);
}

// ---------- positions, in the direction of each question ----------
const flip = { P: "C", C: "P", A: "A" };
function position(d, q, s) {
  const v = votes.get(d.id)?.[q.n];
  if (q.censure) {
    // only "pour" ballots exist on a censure motion: a sitting MP who did not cast one opposed it
    if (v === "P") return "P";
    return d.debutMandat <= s[1] ? "C" : "-";
  }
  if (v !== "P" && v !== "C" && v !== "A") return "-";
  return q.inv ? flip[v] : v;
}

const summary = await readJson(new URL("interventions/summary.json", AN));
const themes = summary.themes.map((t) => ({ id: t.id, fr: t.fr, en: t.en }));
for (const q of QUESTIONS) {
  if (!byNum.has(q.n)) throw new Error(`scrutin ${q.n} not found`);
  if (!themes.some((t) => t.id === q.theme)) throw new Error(`theme ${q.theme}`);
}

/** rank of each value among all values, 0–9 (ties share the average rank) */
function deciles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v);
    const r = sorted.length > 1 ? (lo + hi) / 2 / (sorted.length - 1) : 0.5;
    return Math.round(r * 9);
  });
}
// MP theme ranks (only MPs with enough classified speeches take part)
const eligible = deputes.filter((d) => (summary.mps[d.id]?.c ?? 0) >= 10);
const mpRank = new Map(eligible.map((d) => [d.id, ""]));
themes.forEach((_, k) => {
  const r = deciles(eligible.map((d) => summary.mps[d.id].t[k] ?? 0));
  eligible.forEach((d, i) => mpRank.set(d.id, mpRank.get(d.id) + r[i]));
});
// group theme ranks
const gThemes = GROUPS.filter((g) => summary.groups[g]);
const gRank = Object.fromEntries(gThemes.map((g) => [g, ""]));
themes.forEach((t) => {
  const r = deciles(gThemes.map((g) => summary.groups[g].themes[t.id] ?? 0));
  gThemes.forEach((g, i) => (gRank[g] += r[i]));
});

// top words of each MP's word cloud (shown for the closest match, so no request depends on the answers)
const topWords = async (id) => {
  try {
    const m = await readJson(new URL(`interventions/${id}.json`, AN));
    return (m.terms ?? []).slice(0, 6).map((t) => t[0]);
  } catch {
    return [];
  }
};

const mps = [];
const lines = {};
for (const d of deputes) {
  const pos = QUESTIONS.map((q) => position(d, q, byNum.get(q.n))).join("");
  mps.push([d.id, `${d.prenom} ${d.nom}`, groupOf(d), d.numDepartement ?? "", pos, mpRank.get(d.id) ?? "", await topWords(d.id)]);
  (lines[groupOf(d)] ??= []).push(pos);
}

const groups = {};
for (const g of [...GROUPS, "NI"]) {
  const ds = deputes.filter((d) => groupOf(d) === g);
  if (!ds.length) continue;
  const line = [], cohesion = [];
  QUESTIONS.forEach((_, k) => {
    const c = { P: 0, C: 0, A: 0 };
    for (const p of lines[g]) if (p[k] !== "-") c[p[k]]++;
    const n = c.P + c.C + c.A;
    const top = n ? (["P", "C", "A"].sort((a, b) => c[b] - c[a])[0]) : "-";
    line.push(top);
    cohesion.push(n ? Math.round((100 * c[top]) / n) : 0);
  });
  groups[g] = { libelle: ds[0].groupe?.libelle ?? "Non inscrits", couleur: ds[0].groupe?.couleur ?? "#8D949A", n: ds.length, line: line.join(""), cohesion, t: gRank[g] ?? "" };
}

// ---------- the 2027 candidates: who they are, and which group(s) stand for them on the votes ----------
const CAND = new URL("../public/data/candidates/", import.meta.url);
const candidates = [];
for (const f of (await readdir(CAND)).filter((x) => x.endsWith(".json") && !["index.json", "pay-scales.json"].includes(x))) {
  const c = await readJson(new URL(f, CAND));
  if (!c.slug || !c.quiz?.groups?.length) continue;
  for (const g of c.quiz.groups) if (!groups[g]) throw new Error(`${c.slug}: unknown group ${g}`);
  candidates.push({ slug: c.slug, name: c.name, pollName: c.pollName ?? c.name, photo: c.photo?.src ?? null, party: { fr: c.party.fr, en: c.party.en }, groups: c.quiz.groups, note: c.quiz.note ?? null });
}

// ---------- own measures (long version) ----------
const compare = await readJson(new URL("../public/data/programmes/compare.json", import.meta.url));
const measures = MEASURES.map(([slug, id, fr, en]) => {
  const m = compare.candidates.find((c) => c.slug === slug)?.measures.find((x) => x.id === id);
  if (!m) throw new Error(`measure ${slug}/${id} not found in compare.json`);
  if (m.status === "dropped") throw new Error(`measure ${slug}/${id} was dropped from the programme`);
  if (!candidates.some((c) => c.slug === slug)) throw new Error(`measure ${slug}/${id}: no candidate file`);
  return { slug, id, theme: m.theme, fr, en, text: m.text };
});
const perCand = new Map();
for (const m of measures) perCand.set(m.slug, (perCand.get(m.slug) ?? 0) + 1);
if (new Set(candidates.map((c) => perCand.get(c.slug) ?? 0)).size !== 1) throw new Error(`measures per candidate differ: ${JSON.stringify([...perCand])}`);

// ---------- which votes to ask: the order that tells the candidates apart fastest ----------
// A candidate's position on a vote is the mean of their groups' lines (P = 1, A = 0, C = −1). Greedy: at each
// step take the vote that adds the most separation between pairs of candidates (each pair's distance counts up
// to 3 votes' worth, so pairs already far apart stop attracting questions), minus a penalty when its subject
// has already been asked. The short version is the first SHORT votes of that order, the long one the first LONG.
const SHORT = 10, LONG = 14;
const VAL = { P: 1, A: 0, C: -1, "-": null };
const cv = candidates.map((c) => QUESTIONS.map((_, k) => {
  const v = c.groups.map((g) => VAL[groups[g].line[k]]).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}));
const order = [];
const dist = candidates.map(() => candidates.map(() => 0));
while (order.length < QUESTIONS.length) {
  let best = -1, bestGain = -Infinity;
  QUESTIONS.forEach((q, k) => {
    if (order.includes(k)) return;
    let gain = 0;
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      if (cv[i][k] == null || cv[j][k] == null) continue;
      const d = Math.abs(cv[i][k] - cv[j][k]) / 2;
      gain += Math.min(3, dist[i][j] + d) - Math.min(3, dist[i][j]);
    }
    gain -= 2.5 * order.filter((o) => QUESTIONS[o].theme === q.theme).length;
    if (gain > bestGain) { bestGain = gain; best = k; }
  });
  order.push(best);
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) if (cv[i][best] != null && cv[j][best] != null) dist[i][j] += Math.abs(cv[i][best] - cv[j][best]) / 2;
}
// long version: measures in two rounds (each candidate once per round, in an order that alternates sides of the
// hemicycle so neighbours on the list are not neighbours in politics), a vote after every two measures
const stride = (n) => Array.from({ length: n }, (_, i) => (i * 5) % n); // 5 and 13 are coprime: visits everyone
const bySlug = candidates.map((c) => measures.map((m, i) => ({ m, i })).filter((x) => x.m.slug === c.slug).map((x) => x.i));
const mOrder = [0, 1].flatMap((round) => stride(candidates.length).map((ci) => bySlug[ci][round]).filter((x) => x != null));
const longOrder = [];
const lv = order.slice(0, LONG);
for (let i = 0, v = 0, m = 0; v < lv.length || m < mOrder.length; i++) {
  if (i % 3 === 0 && v < lv.length) longOrder.push(`v${lv[v++]}`);
  else if (m < mOrder.length) longOrder.push(`m${mOrder[m++]}`);
  else longOrder.push(`v${lv[v++]}`);
}
// a stamp of the question set: share links made for another set are not decoded as if they were for this one
const rev = [...`${QUESTIONS.map((q) => q.id).join()}|${measures.map((m) => m.slug + m.id).join()}|${order.join()}`].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7).toString(36).slice(0, 4);

const out = {
  generatedAt: new Date().toISOString(),
  rev,
  short: order.slice(0, SHORT).map((k) => `v${k}`),
  long: longOrder,
  candidates,
  measures,
  legislature: 17,
  questions: QUESTIONS.map((q) => {
    const s = byNum.get(q.n);
    return { id: q.id, n: q.n, d: s[1], theme: q.theme, inv: !!q.inv, censure: !!q.censure, fr: { q: q.fr[0], c: q.fr[1] }, en: { q: q.en[0], c: q.en[1] }, sort: s[3], res: [s[5], s[6], s[7]] };
  }),
  themes,
  groups,
  mps,
};
await writeFile(new URL("quiz.json", AN), JSON.stringify(out));
console.log(`✓ quiz: ${QUESTIONS.length} votes (short: ${out.short.map((x) => QUESTIONS[x.slice(1)].id).join(", ")}), ${measures.length} measures, long ${longOrder.length} questions, ${candidates.length} candidates, ${mps.length} MPs, rev ${rev}`);
