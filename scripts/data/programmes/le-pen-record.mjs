// Hand-reviewed record of Marine Le Pen and Jordan Bardella against the RN programme
// (public/data/programmes/le-pen.json). Read by scripts/record/le-pen.mjs, which re-checks every entry
// against the downloaded votes.
//
// Mandates checked (November 2026):
// - Marine Le Pen: MP for Pas-de-Calais (11th constituency) since June 2017, so 15th, 16th and 17th legislatures
//   (not an MP in the 14th: beaten in 2012). Never a senator. MEP 2004–2017: those votes predate the
//   HowTheyVote.eu data (July 2019) and are not covered.
// - Jordan Bardella: RN president, MEP since July 2019 (ID group, then Patriots for Europe from 2024). Never an
//   MP or senator. Matches the description.
//
// Review method: every recorded vote was shortlisted by keyword on its title for each measure (pensions,
// immigration and nationality, prestations, AME, VAT and fuel, wealth tax, family tax shares, public
// broadcasting, prisons, health agencies, voting system, EU budget and own resources, hydrocarbons and climate),
// then read. Amendment titles at the Assemblée do not state their content, so for the 17th legislature the texts
// of the RN and UDR budget amendments were read on assemblee-nationale.fr; Le Pen voted with the programme on all
// of them. Only votes that plainly go against a measure are kept.
//
// Reviewed and left out:
// - AN 15th, scrutin 139 (10 Oct 2017): Le Pen abstained on the Hulot law ending hydrocarbon exploration, which the
//   programme now promises to repeal. An abstention, not a vote for the law: not counted.
// - PE, European Media Freedom Act and the 2024 single-permit recast: Bardella voted against, in line with the
//   programme (privatising public broadcasting, national preference).
// - PE, EU budgets, MFF and own-resources decisions 2019–2026: Bardella voted against throughout, in line with
//   cutting France's contribution.
export default {
  people: [
    { name: "Marine Le Pen", role: { fr: "Candidate, présidente du groupe RN à l'Assemblée nationale", en: "Candidate, leader of the RN group in the National Assembly" }, an: { acteur: "PA720614", legislatures: [15, 16, 17] } },
    { name: "Jordan Bardella", role: { fr: "Président du RN, député européen depuis 2019", en: "RN president, MEP since 2019" }, ep: { htv: 131580 } },
  ],
  notCovered: [
    {
      person: "Marine Le Pen",
      chamber: "PE",
      from: "2004-07-20",
      to: "2017-06-18",
      why: {
        fr: "Les votes nominatifs du Parlement européen antérieurs à juillet 2019 ne sont pas couverts par les données de HowTheyVote.eu.",
        en: "European Parliament roll-call votes before July 2019 are not covered by the HowTheyVote.eu data.",
      },
    },
  ],
  contradictions: [
    {
      person: "Jordan Bardella",
      chamber: "PE",
      legislature: 9,
      num: 134029,
      // HowTheyVote lists the adoption of the agreement with the Council as "Am 176" (442 for, 203 against)
      title: "European Climate Law — adoption of the provisional agreement with the Council",
      position: "C",
      measure: { lineage: "m23", label: { fr: "Neutralité carbone « avant 2050 »", en: "Carbon neutrality 'before 2050'" } },
      explanation: {
        fr: "A voté contre la loi européenne sur le climat, qui inscrit l'objectif de neutralité climatique de l'Union d'ici 2050 (avec une baisse d'au moins 55 % des émissions en 2030), alors que le programme vise la neutralité carbone « avant 2050 ».",
        en: "Voted against the European Climate Law, which sets the EU's climate-neutrality target for 2050 (with emissions cut by at least 55% by 2030), while the programme aims for carbon neutrality 'before 2050'.",
      },
      strength: "partial",
    },
  ],
};
