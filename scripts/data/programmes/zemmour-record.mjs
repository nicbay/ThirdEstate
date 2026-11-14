// Hand-reviewed record of Éric Zemmour and Sarah Knafo against the Reconquête programme
// (public/data/programmes/zemmour.json). Read by scripts/record/zemmour.mjs.
//
// Mandates checked (November 2026):
// - Éric Zemmour has never held a parliamentary seat (Assemblée nationale, Sénat or European Parliament):
//   beaten in the 4th constituency of the Var in June 2022, not a candidate in the 2024 European election.
// - Sarah Knafo: MEP since 16 July 2024 (Reconquête list, Europe of Sovereign Nations group). Never an MP or senator.
//
// Review (Knafo, European Parliament, 10th term): her final votes and amendment votes were shortlisted by keyword
// for every measure with a European angle (immigration and asylum, return policy, development aid, nuclear,
// defence and NATO, EU budget and own resources, public broadcasting, pensions). Every hit followed the programme
// (against development-aid and EU-budget resolutions, for the return regulation and the safe-country lists, for
// the Euratom and nuclear-safety programmes). No contradiction is recorded.
export default {
  people: [
    { name: "Éric Zemmour", role: { fr: "Candidat, président de Reconquête", en: "Candidate, president of Reconquête" } },
    { name: "Sarah Knafo", role: { fr: "Députée européenne Reconquête depuis 2024", en: "Reconquête MEP since 2024" }, ep: { htv: 256924 } },
  ],
  notCovered: [
    {
      person: "Éric Zemmour",
      chamber: null,
      from: null,
      to: null,
      why: {
        fr: "N'a jamais siégé au Parlement : aucun vote enregistré.",
        en: "Has never sat in Parliament: no recorded votes.",
      },
    },
  ],
  contradictions: [],
};
