// Hand-curated record check for Édouard Philippe, read by scripts/record/philippe.mjs.
// people: whose votes are collected, and where (AN acteur ids "PA…").
// keywords: per measure id of public/data/programmes/philippe.json, the title patterns used to shortlist votes.
// contradictions: the votes kept after reading each shortlisted vote (and its text when the title is unclear).
// A vote is kept only when the position plainly goes against the measure; "partial" = against a text that
// contained the measure among other things.

export default {
  people: [
    {
      name: "Édouard Philippe",
      role: { fr: "Candidat ; député de la Seine-Maritime (2012–2017, groupe UMP puis Les Républicains), Premier ministre (2017–2020), maire du Havre, président d’Horizons", en: "Candidate; MP for Seine-Maritime (2012–2017, UMP then Les Républicains group), Prime Minister (2017–2020), mayor of Le Havre, leader of Horizons" },
      sources: [{ chamber: "AN", legislature: 14, id: "PA345619" }],
    },
  ],
  notCovered: [
    { person: "Édouard Philippe", chamber: "AN", from: "2016-11-25", to: "2017-06-15", why: { fr: "Le fichier de données ouvertes de la 14e législature s’arrête au 24 novembre 2016 : ses derniers mois de mandat ne sont pas couverts.", en: "The 14th-legislature open-data file stops on 24 November 2016: his last months as an MP are not covered." } },
    { person: "Édouard Philippe", chamber: "AN", from: "2017-06-21", to: null, why: { fr: "Premier ministre (2017–2020) puis maire du Havre : il n’a plus siégé à l’Assemblée depuis 2017.", en: "Prime Minister (2017–2020), then mayor of Le Havre: he has not sat in the Assembly since 2017." } },
    { person: "Édouard Philippe", chamber: "Sénat", from: null, to: null, why: { fr: "N’a jamais été sénateur.", en: "Never a senator." } },
    { person: "Édouard Philippe", chamber: "PE", from: null, to: null, why: { fr: "N’a pas été député européen depuis 2019.", en: "Not an MEP since 2019." } },
  ],
  keywords: {
    m01: [/retraite/i],
    m02: [/capitalisation|épargne retraite/i],
    m03: [/règle d.or|programmation des finances publiques|équilibre des finances publiques/i],
    m05: [/fonction publique|fonctionnaires/i],
    m07: [/impôts? de production|cotisation foncière|valeur ajoutée des entreprises|compétitivité/i],
    m08: [/impôt|taxe|contribution/i],
    m09: [/durée (légale )?du travail|35 heures|temps de travail|dialogue social|code du travail/i],
    m10: [/heures supplémentaires/i],
    m11: [/assurance chômage|demandeurs d.emploi|sécurisation de l.emploi/i],
    m12: [/carence/i],
    m13: [/allocations familiales|prestations familiales|politique familiale/i],
    m17: [/donation|succession/i],
    m18: [/refondation de l.école|école/i],
    m20: [/téléphone|portable/i],
    m21: [/peines? plancher|récidive|individualisation des peines|exécution des peines|contrainte pénale/i],
    m22: [/application des peines|parquet|polices? municipales?|maires/i],
    m23: [/stupéfiants|criminalité organisée|blanchiment|terrorisme/i],
    m24: [/mineurs/i],
    m25: [/immigration|droit des étrangers|asile/i],
    m26: [/Algérie/i],
    m28: [/asile/i],
    m30: [/Mayotte|Guyane|droit du sol/i],
    m31: [/nucléaire|transition énergétique|électricité|énergie/i],
    m36: [/ordonnances?/i],
  },
  contradictions: [
    {
      person: "Édouard Philippe", chamber: "AN", legislature: 14, num: 647, position: "C", strength: "partial", lineage: "m01",
      label: { fr: "Allonger la durée de cotisation (45 ans) et relever l’âge de départ", en: "Longer contribution period (45 years) and a higher pension age" },
      explanation: {
        fr: "Il a voté contre la réforme Touraine, qui allongeait la durée de cotisation à 43 ans (172 trimestres) d’ici 2035 ; il propose aujourd’hui de la porter à 45 ans. Son groupe reprochait au texte de ne pas relever l’âge légal et d’augmenter les cotisations.",
        en: "He voted against the Touraine pension reform, which lengthened the contribution period to 43 years (172 quarters) by 2035; he now proposes 45 years. His group objected that the bill left the legal age untouched and raised contributions.",
      },
    },
    {
      person: "Édouard Philippe", chamber: "AN", legislature: 14, num: 726, position: "C", strength: "partial", lineage: "m01",
      label: { fr: "Allonger la durée de cotisation (45 ans) et relever l’âge de départ", en: "Longer contribution period (45 years) and a higher pension age" },
      explanation: {
        fr: "Il a voté contre la réforme Touraine (nouvelle lecture), qui allongeait la durée de cotisation à 43 ans (172 trimestres) d’ici 2035 ; il propose aujourd’hui de la porter à 45 ans. Son groupe reprochait au texte de ne pas relever l’âge légal et d’augmenter les cotisations.",
        en: "He voted against the Touraine pension reform (new reading), which lengthened the contribution period to 43 years (172 quarters) by 2035; he now proposes 45 years. His group objected that the bill left the legal age untouched and raised contributions.",
      },
    },
  ],
};
