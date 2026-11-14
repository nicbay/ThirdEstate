// Hand-curated record review for Marine Tondelier (Les Écologistes), read by scripts/record/tondelier.mjs.
// Keywords shortlist the votes touching each measure of public/data/programmes/tondelier.json; every
// contradiction below was checked by hand against the vote's text. A wrong accusation is worse than a missed one.

export default {
  people: [
    { name: "Marine Tondelier", role: { fr: "Candidate, secrétaire nationale des Écologistes ; aucun mandat parlementaire", en: "Candidate, national secretary of Les Écologistes; no seat in Parliament" } },
    { name: "Cyrielle Chatelain", role: { fr: "Présidente du groupe Écologiste et social à l'Assemblée, députée de l'Isère depuis 2022", en: "President of the Ecologist and Social group in the Assembly, MP for Isère since 2022" }, an: { id: "PA794008", legs: [16, 17] } },
  ],
  notCovered: [
    { person: "Marine Tondelier", chamber: "AN", from: 2006, to: 2026, why: "jamais élue députée, sénatrice ou députée européenne : aucun vote parlementaire à analyser" },
  ],
  anSkipAmendments: true,
  keywords: {
    m01: /smic|salaire minimum|salaires/i,
    m02: /retraite/i,
    m03: /nucléaire|énergie|électricité|hydro/i,
    m04: /fortune|ISF|patrimoine|plancher/i,
    m05: /succession|héritage|transmission/i,
    m07: /revenu|minima|RSA|jeunes|autonomie/i,
    m08: /enseignant|point d'indice|fonctionnaires|fonction publique/i,
    m09: /logement|HLM/i,
    m10: /fiscalité|aérien|avion|ferroviaire|train|billet/i,
    m11: /bio|restauration collective|Egalim|alimentation/i,
    m12: /proportionnel|mode de scrutin|élection des députés/i,
    m13: /droit de vote/i,
    m14: /Constitution|constitutionnelle|justice|magistrat/i,
    m15: /Ukraine|programmation militaire|défense|armée/i,
    m16: /Palestin|Israël|Gaza|colonies/i,
    m17: /rémunération|dirigeants/i,
    m18: /temps de travail|32 heures|semaine de quatre|durée du travail/i,
    m19: /chaleur|climatique|maladie professionnelle|santé au travail/i,
    m20: /coupure|énergie|gaz|électricité|chèque/i,
    m21: /justice/i,
    m22: /grand âge|EHPAD|autonomie|vieillir/i,
    m23: /prix|vie chère|blocage/i,
    m24: /LBD|maintien de l.ordre|police|forces de l.ordre/i,
    m25: /cantine|gratuité/i,
  },
  measures: {
    m01: { fr: "Smic à 2 000 euros brut", en: "Minimum wage at 2,000 euros gross" },
    m02: { fr: "Retour à la retraite à 62 ans", en: "Back to pension age 62" },
    m03: { fr: "Sortir du nucléaire en vingt ans", en: "Phase out nuclear power over twenty years" },
    m04: { fr: "Taxe Zucman et ISF climatique", en: "Zucman tax and climate wealth tax" },
    m05: { fr: "Un impôt sur l'héritage plus progressif", en: "A more progressive inheritance tax" },
    m07: { fr: "Garantie d'autonomie dès 18 ans", en: "Guaranteed income from age 18" },
    m08: { fr: "Hausse des salaires des enseignants et fonctionnaires", en: "Pay rises for teachers and civil servants" },
    m09: { fr: "200 000 logements publics par an", en: "200,000 public homes a year" },
    m10: { fr: "Fiscalité verte, train moins cher que l'avion", en: "Green taxation, trains cheaper than planes" },
    m11: { fr: "Du bio dans la restauration collective", en: "Organic food in public catering" },
    m12: { fr: "La proportionnelle", en: "Proportional representation" },
    m13: { fr: "Droit de vote des étrangers aux élections locales", en: "Local voting rights for foreign residents" },
    m14: { fr: "Une République écologique, la fin du présidentialisme", en: "An ecological Republic, an end to presidentialism" },
    m15: { fr: "Soutenir l'Ukraine, une défense européenne", en: "Support Ukraine, a European defence" },
    m16: { fr: "Reconnaître la Palestine", en: "Recognise Palestine" },
    m17: { fr: "Écart de rémunération de 1 à 20", en: "A 1-to-20 pay ratio" },
    m18: { fr: "Vers les 32 heures", en: "Towards a 32-hour week" },
    m19: { fr: "Congés climatiques, santé au travail", en: "Climate leave, health at work" },
    m20: { fr: "Gratuité des premiers kWh, fin des coupures", en: "Free first kWh, no more cut-offs" },
    m21: { fr: "Plus de moyens pour la justice", en: "More resources for justice" },
    m22: { fr: "Un plan Grand âge", en: "An elderly care plan" },
    m23: { fr: "Contrôle des prix en cas d'inflation anormale", en: "Price controls in abnormal inflation" },
    m24: { fr: "Abolir les LBD et la Brav-M", en: "Abolish rubber-bullet guns and the Brav-M" },
    m25: { fr: "Cantine : un tarif avantageux pour les familles monoparentales", en: "School meals: lower rates for single-parent families" },
  },
  // Reviewed and NOT kept: votes against the nuclear acceleration and nuclear safety laws and the 2025 energy
  // programming bill (in line with a nuclear exit); abstentions on the 2023 renewables law and military programming
  // law (abstaining is not voting against); housing bills of the 17th legislature (not public housing construction).
  contradictions: [
    { person: "Cyrielle Chatelain", chamber: "AN", legislature: 17, num: 217, position: "C", measure: "m02", strength: "clear",
      explanation: {
        fr: "A voté contre la proposition de loi du Rassemblement national qui rétablissait l'âge légal de 62 ans, exactement ce que promet le programme ; la gauche a refusé de voter ce texte du RN, rejeté.",
        en: "Voted against the National Rally bill that restored the legal pension age of 62, exactly what the programme promises; the left refused to back this RN bill, which was rejected.",
      } },
    { person: "Cyrielle Chatelain", chamber: "AN", legislature: 16, num: 2719, position: "C", measure: "m21", strength: "partial",
      explanation: {
        fr: "A voté contre la loi de programmation de la justice 2023-2027 (texte final), qui augmentait le budget et les effectifs de la justice, alors que le programme veut plus de moyens ; le texte contenait aussi d'autres mesures.",
        en: "Voted against the 2023–2027 justice programming law (final text), which raised the justice budget and staff, while the programme wants more resources; the text also held other measures.",
      } },
    { person: "Cyrielle Chatelain", chamber: "AN", legislature: 17, num: 7905, position: "C", measure: "m15", strength: "partial",
      explanation: {
        fr: "A voté contre l'actualisation de la loi de programmation militaire (texte final, 2026), qui renforçait les moyens des armées, alors que le programme veut préparer l'armée à une guerre de haute intensité ; le programme insiste sur le cadre européen, absent du texte.",
        en: "Voted against the update of the military programming law (final text, 2026), which boosted the armed forces' resources, while the programme wants to prepare the army for high-intensity war; the programme stresses a European framework the text lacked.",
      } },
  ],
};
