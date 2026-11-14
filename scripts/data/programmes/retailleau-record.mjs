// Hand-curated record check for Bruno Retailleau, read by scripts/record/retailleau.mjs.
// people: whose votes are collected, and where (AN acteur ids "PA…", Sénat matricules).
// keywords: per measure id of public/data/programmes/retailleau.json, the title patterns used to shortlist votes.
// contradictions: the votes kept after reading each shortlisted vote (and its text when the title is unclear).
// A vote is kept only when the position plainly goes against the measure; "partial" = against a text that
// contained the measure among other things.

export default {
  people: [
    {
      name: "Bruno Retailleau",
      role: { fr: "Candidat ; sénateur de la Vendée (2004–2024, depuis novembre 2025), président du groupe LR au Sénat (2014–2024), ministre de l’Intérieur (2024–2025)", en: "Candidate; senator for Vendée (2004–2024, again since November 2025), leader of the LR group in the Senate (2014–2024), Interior minister (2024–2025)" },
      sources: [{ chamber: "Sénat", id: "04033B", fromSession: 2006, toSession: 2026, exclude: [["2024-09-21", "2025-11-12"]] }],
    },
    {
      name: "Mathieu Darnaud",
      role: { fr: "Lieutenant ; sénateur de l’Ardèche depuis 2014, président du groupe Les Républicains au Sénat depuis octobre 2024", en: "Lieutenant; senator for Ardèche since 2014, leader of the Les Républicains group in the Senate since October 2024" },
      sources: [{ chamber: "Sénat", id: "14259Y", fromSession: 2014, toSession: 2026 }],
    },
  ],
  notCovered: [
    { person: "Bruno Retailleau", chamber: "Sénat", from: "2004-10-01", to: "2006-09-30", why: { fr: "Votes antérieurs à la session 2006-2007, hors du périmètre retenu (listes nominatives publiées en JSON à partir de cette session).", en: "Votes before the 2006-2007 session, outside the period covered (machine-readable vote lists start with that session)." } },
    { person: "Bruno Retailleau", chamber: "Sénat", from: "2024-09-21", to: "2025-11-12", why: { fr: "Ministre de l’Intérieur : son siège était tenu par son remplaçant ; les votes émis au nom du siège pendant le premier mois de ses fonctions ministérielles sont écartés.", en: "Interior minister: his seat was held by his substitute; votes cast for the seat during his first month in office are left out." } },
    { person: "Bruno Retailleau", chamber: "AN", from: null, to: null, why: { fr: "Pas député depuis 2012 (son mandat de député de la Vendée remonte aux années 1990).", en: "Not an MP since 2012 (his term as an MP for Vendée dates from the 1990s)." } },
    { person: "Bruno Retailleau", chamber: "PE", from: "2019-07-01", to: null, why: { fr: "N’a pas été député européen depuis 2019.", en: "Not an MEP since 2019." } },
    { person: "Mathieu Darnaud", chamber: "AN", from: null, to: null, why: { fr: "N’a jamais été député.", en: "Never an MP." } },
    { person: "Mathieu Darnaud", chamber: "PE", from: null, to: null, why: { fr: "N’a jamais été député européen.", en: "Never an MEP." } },
    { person: "Bruno Retailleau, Mathieu Darnaud", chamber: "Sénat", from: null, to: null, why: { fr: "Au Sénat, la plupart des scrutins publics sont exprimés par délégation au sein des groupes : la position enregistrée est souvent celle du groupe plutôt qu’un choix individuel.", en: "In the Senate most public votes are cast by delegation within each group: the recorded position is often the group’s rather than an individual choice." } },
  ],
  keywords: {
    r01: [/retraite/i],
    r02: [/fonction publique|fonctionnaires/i],
    r03: [/prestations sociales|condition de résidence|résidence régulière/i],
    r04: [/plafonnement des aides|allocation sociale unique|compte social/i],
    r05: [/revenu de solidarité active|RSA|prime d.activité|minima sociaux/i],
    r06: [/assurance chômage|demandeurs d.emploi/i],
    r07: [/heures supplémentaires|durée (légale )?du travail|35 heures|temps de travail/i],
    r08: [/impôts? de production|valeur ajoutée des entreprises|CVAE|contribution sociale de solidarité|cotisation foncière/i],
    r09: [/référendum/i],
    r11: [/peines? plancher|peines? minimales|Cour européenne des droits|Convention européenne de sauvegarde/i],
    r12: [/droit du sol|accès à la nationalité|nationalité française/i],
    r13: [/stupéfiants|narcotrafic|trafic de drogue|criminalité organisée|détention provisoire/i],
    r14: [/pénitentiaire|exécution des peines|programmation.*justice|justice pénale des mineurs|délinquance des mineurs|mineurs délinquants/i],
    r15: [/règle d.or|programmation des finances publiques|équilibre des finances publiques/i],
    r17: [/énergies renouvelables|éolien|photovoltaïque|énergie solaire|service national universel|audiovisuel public/i],
    r18: [/carence|indemnités journalières|arrêts? de travail/i],
    r19: [/aide médicale/i],
    r20: [/simplification/i],
  },
  contradictions: [
    {
      person: "Bruno Retailleau", chamber: "Sénat", legislature: "2023-2024", num: 64, position: "C", strength: "partial", lineage: "r09",
      label: { fr: "Abaisser le seuil du référendum d’initiative partagée", en: "Lower the threshold of the shared-initiative referendum" },
      explanation: {
        fr: "Il a voté contre une proposition de loi constitutionnelle qui abaissait le seuil du référendum d’initiative partagée (un million d’électeurs et un dixième des parlementaires au lieu d’un dixième des électeurs et d’un cinquième des parlementaires) ; il propose aujourd’hui de passer à 2,5 millions de signatures, un seuil moins bas que celui de ce texte.",
        en: "He voted against a constitutional bill lowering the threshold of the shared-initiative referendum (one million voters and a tenth of parliamentarians instead of a tenth of voters and a fifth of parliamentarians); he now proposes 2.5 million signatures, a higher bar than that bill’s.",
      },
    },
  ],
};
