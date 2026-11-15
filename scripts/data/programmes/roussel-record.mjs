// Hand-curated record review for Fabien Roussel (PCF), read by scripts/record/roussel.mjs.
// Keywords shortlist the votes touching each measure of public/data/programmes/roussel.json; every
// contradiction below was checked by hand against the vote's text. A wrong accusation is worse than a missed one.

export default {
  people: [
    { name: "Fabien Roussel", role: { fr: "Candidat, député du Nord de 2017 à 2024 (GDR)", en: "Candidate, MP for Nord 2017–2024 (GDR)" }, an: { id: "PA720692", legs: [15, 16] } },
    { name: "Stéphane Peu", role: { fr: "Président du groupe GDR à l'Assemblée, député de Seine-Saint-Denis depuis 2017", en: "GDR group president in the Assembly, MP for Seine-Saint-Denis since 2017" }, an: { id: "PA721270", legs: [15, 16, 17] } },
  ],
  notCovered: [
    { person: "Fabien Roussel", chamber: "AN", from: 2024, to: 2026, why: "battu aux législatives de 2024, plus de mandat parlementaire depuis" },
  ],
  anSkipAmendments: true,
  keywords: {
    m01: /smic|salaire minimum|salaires/i,
    m04: /retraite/i,
    m05: /minimum contributif|minimum vieillesse|pensions/i,
    m06: /durée du travail|35 heures|32 heures|temps de travail|travail/i,
    m07: /fortune|ISF|patrimoine|dividende|multinationales|finances/i,
    m09: /hôpita|soignant|santé/i,
    m10: /nucléaire|énergie|électricité|hydro/i,
    m11: /industri|nationalis|souveraineté/i,
    m12: /fraude|évasion fiscale/i,
    m13: /logement|HLM|ELAN/i,
    m14: /Parcoursup|orientation et à la réussite|université|enseignement supérieur/i,
    m15: /proportionnel|mode de scrutin|élection des députés|démocratie plus représentative/i,
    m16: /droit de vote/i,
    m17: /police|sécurité globale|sécurité intérieure/i,
    m18: /bancaire|Caisse des dépôts|Banque publique|PACTE/i,
    m19: /stabilité|pacte budgétaire|traité|gouvernance économique|programmation des finances/i,
    m20: /interruption volontaire|IVG|avortement/i,
    m21: /égalité (professionnelle|salariale)|menstruel/i,
    m22: /AAH|adultes handicapés|déconjugalisation|handicap/i,
    m23: /prix|blocage|carburant|vie chère|pouvoir d.achat/i,
    m24: /APL|aides personnalisées au logement/i,
    m25: /cantine|gratuité|fournitures/i,
    m26: /immigration|asile|séjour|étrangers|intégration/i,
  },
  measures: {
    m01: { fr: "Smic à 2 200 euros brut", en: "Minimum wage at 2,200 euros gross" },
    m04: { fr: "Abroger la retraite à 64 ans, objectif 60 ans", en: "Repeal pension age 64, aim for 60" },
    m05: { fr: "Minimum contributif au niveau du Smic", en: "Minimum pension at the minimum wage" },
    m06: { fr: "35 heures effectives, 32 heures dans les métiers pénibles", en: "35 actual hours, 32 in arduous jobs" },
    m07: { fr: "Rétablir l'impôt sur la fortune", en: "Restore the wealth tax" },
    m09: { fr: "Recruter à l'hôpital public", en: "Hire in public hospitals" },
    m10: { fr: "Doubler la production d'électricité nucléaire et renouvelable", en: "Double nuclear and renewable electricity output" },
    m11: { fr: "Doubler la part de l'industrie", en: "Double industry's share of GDP" },
    m12: { fr: "Combattre la fraude fiscale", en: "Fight tax fraud" },
    m13: { fr: "200 000 logements publics par an", en: "200,000 public homes a year" },
    m14: { fr: "Abolir Parcoursup et la sélection à l'université", en: "Abolish Parcoursup and university selection" },
    m15: { fr: "La proportionnelle", en: "Proportional representation" },
    m16: { fr: "Droit de vote des étrangers aux élections locales", en: "Local voting rights for foreign residents" },
    m17: { fr: "Rétablir la police de proximité", en: "Bring back community policing" },
    m18: { fr: "Un pôle public bancaire", en: "A public banking hub" },
    m19: { fr: "Refuser les règles budgétaires européennes", en: "Reject EU budget rules" },
    m20: { fr: "Garantir le droit à l'IVG", en: "Guarantee abortion rights" },
    m21: { fr: "Égalité salariale et arrêt menstruel", en: "Equal pay and menstrual leave" },
    m22: { fr: "AAH au niveau du Smic", en: "Disability allowance at the minimum wage" },
    m23: { fr: "Bloquer les prix des biens essentiels", en: "Freeze prices of essentials" },
    m24: { fr: "Revaloriser les APL de 10 %", en: "Raise housing benefit by 10%" },
    m25: { fr: "Gratuité de l'école", en: "Free schooling" },
    m26: { fr: "Abroger les lois asile et immigration de Macron", en: "Repeal Macron's asylum and immigration laws" },
  },
  // Reviewed and NOT kept: votes against the 2024 nuclear safety governance law (merger of the ASN and IRSN, not
  // nuclear output); against government budgets and the Parcoursup law (in line with the programme); the 2019
  // "pouvoir d'achat" bill articles (content not stated in the titles). Both voted for the 2023 nuclear acceleration law.
  // No clear contradiction found; the partial ones below are votes against wider texts that held a smaller version.
  contradictions: [
    { person: "Stéphane Peu", chamber: "AN", legislature: 17, num: 217, position: "C", measure: "m04", strength: "partial",
      explanation: {
        fr: "A voté contre la proposition de loi du Rassemblement national qui abrogeait le report de l'âge à 64 ans (retour à 62 ans), ce que promet le programme ; la gauche a refusé de voter ce texte du RN, rejeté.",
        en: "Voted against the National Rally bill that repealed the move to age 64 (back to 62), which the programme promises; the left refused to back this RN bill, which was rejected.",
      } },
    { person: "Fabien Roussel", chamber: "AN", legislature: 15, num: 1215, position: "C", measure: "m12", strength: "partial",
      explanation: {
        fr: "A voté contre la loi de 2018 relative à la lutte contre la fraude (texte final), qui durcissait les sanctions de la fraude fiscale et assouplissait le « verrou de Bercy », alors qu'il fait de ce combat une priorité.",
        en: "Voted against the 2018 anti-fraud law (final text), which toughened penalties for tax fraud and loosened the 'Bercy lock', while he makes that fight a priority.",
      } },
    ...["Fabien Roussel", "Stéphane Peu"].map((person) => ({
      person, chamber: "AN", legislature: 16, num: 186, position: "C", measure: "m24", strength: "partial",
      explanation: {
        fr: "A voté contre la loi pouvoir d'achat de 2022 (texte final), qui revalorisait notamment les APL de 3,5 % ; le programme promet 10 %, mais ce vote a rejeté une hausse plus faible.",
        en: "Voted against the 2022 purchasing-power law (final text), which among other things raised housing benefit by 3.5%; the programme promises 10%, but this vote turned down a smaller rise.",
      },
    })),
    { person: "Stéphane Peu", chamber: "AN", legislature: 16, num: 897, position: "C", measure: "m10", strength: "partial",
      explanation: {
        fr: "A voté contre la loi d'accélération de la production d'énergies renouvelables (texte final, 2023), alors que le programme veut doubler la production d'électricité, renouvelables comprises.",
        en: "Voted against the law speeding up renewable energy production (final text, 2023), while the programme wants to double electricity output, renewables included.",
      } },
    { person: "Stéphane Peu", chamber: "AN", legislature: 17, num: 6319, position: "C", measure: "m12", strength: "partial",
      explanation: {
        fr: "A voté contre la loi de 2026 relative à la lutte contre les fraudes sociales et fiscales (texte final), qui comportait des mesures contre la fraude fiscale, alors que le programme fait de ce combat une priorité.",
        en: "Voted against the 2026 law on social and tax fraud (final text), which included measures against tax fraud, while the programme makes that fight a priority.",
      } },
  ],
};
