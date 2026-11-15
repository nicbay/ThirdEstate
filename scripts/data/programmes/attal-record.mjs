// Hand-curated record check for Gabriel Attal, read by scripts/record/attal.mjs.
// people: whose votes are collected, and where (AN acteur ids "PA…").
// keywords: per measure id of public/data/programmes/attal.json, the title patterns used to shortlist votes.
// contradictions: the votes kept after reading each shortlisted vote (and its text when the title is unclear).
// A vote is kept only when the position plainly goes against the measure; "partial" = against a text that
// contained the measure among other things.

export default {
  people: [
    {
      name: "Gabriel Attal",
      role: { fr: "Candidat ; député des Hauts-de-Seine (2017–2018, depuis 2024), Premier ministre (2024), président du groupe Ensemble pour la République", en: "Candidate; MP for Hauts-de-Seine (2017–2018, since 2024), Prime Minister (2024), leader of the Ensemble pour la République group" },
      sources: [
        { chamber: "AN", legislature: 15, id: "PA722190" },
        { chamber: "AN", legislature: 17, id: "PA722190" },
      ],
    },
  ],
  notCovered: [
    { person: "Gabriel Attal", chamber: "AN", from: "2018-10-16", to: "2024-09-21", why: { fr: "Membre du Gouvernement (secrétaire d’État, porte-parole, ministre puis Premier ministre) : élu député en 2022 mais remplacé par son suppléant, il n’a pas voté durant la 16e législature.", en: "Member of the government (junior minister, spokesman, minister, then Prime Minister): elected MP in 2022 but replaced by his substitute, he cast no vote in the 16th legislature." } },
    { person: "Gabriel Attal", chamber: "Sénat", from: null, to: null, why: { fr: "N’a jamais été sénateur.", en: "Never a senator." } },
    { person: "Gabriel Attal", chamber: "PE", from: null, to: null, why: { fr: "N’a jamais été député européen.", en: "Never an MEP." } },
  ],
  keywords: {
    m01: [/retraite/i],
    m02: [/épargne retraite|capitalisation|intéressement|participation des salariés/i],
    m04: [/programmation des finances publiques|déficit/i],
    m08: [/impôt|taxe|contribution sociale généralisée|\bCSG\b|prélèvement/i],
    m10: [/assurance chômage|demandeurs d.emploi/i],
    m12: [/partage de la valeur|intéressement/i],
    m16: [/redoublement|groupes de niveau|brevet/i],
    m22: [/collectivité unique|millefeuille|échelon|fusion.*(départements|régions)/i],
    m23: [/référendum/i],
    m24: [/mineurs/i],
    m26: [/imprescriptib|prescription|infractions sexuelles|violences sexuelles/i],
    m27: [/immigration|quotas|regroupement familial|droit d.asile/i],
    m28: [/Mercosur|CETA|accord économique et commercial|clauses? miroir|prix plancher/i],
    m32: [/succession|donation/i],
    m34: [/service national universel/i],
  },
  contradictions: [],
};
