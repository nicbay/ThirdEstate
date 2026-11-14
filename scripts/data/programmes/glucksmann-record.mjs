// Hand-curated record review for Raphaël Glucksmann (Place publique), read by scripts/record/glucksmann.mjs.
// Keywords shortlist the votes touching each measure of public/data/programmes/glucksmann.json; every
// contradiction below was checked by hand against the vote's text. A wrong accusation is worse than a missed one.

export default {
  people: [
    { name: "Raphaël Glucksmann", role: { fr: "Candidat, député européen depuis 2019 (S&D)", en: "Candidate, Member of the European Parliament since 2019 (S&D)" }, ep: { id: 197694 } },
    { name: "Aurore Lalucq", role: { fr: "Coprésidente de Place publique, députée européenne depuis 2019 (S&D)", en: "Place publique co-leader, Member of the European Parliament since 2019 (S&D)" }, ep: { id: 197697 } },
  ],
  notCovered: [
    { person: "Raphaël Glucksmann", chamber: "AN", from: 2019, to: 2026, why: "jamais député ni sénateur ; seul mandat parlementaire : Parlement européen" },
    { person: "Aurore Lalucq", chamber: "AN", from: 2019, to: 2026, why: "jamais députée ni sénatrice ; seul mandat parlementaire : Parlement européen" },
  ],
  epMainOnly: true,
  keywords: {
    m01: /inheritance|succession/i,
    m03: /minimum wage/i,
    m09: /nuclear|taxonomy|renewable|fossil/i,
    m10: /Russian assets|frozen|immobili[sz]ed|confiscat|reparation loan/i,
    m11: /defen[cs]e industr|EDIP|ASAP|ammunition|SAFE|defen[cs]e fund|rearm|readiness/i,
    m12: /Mercosur|trade agreement|free trade|CETA|New Zealand|Chile|Mexico|Kenya|Singapore|Vietnam|Buy European|public procurement/i,
    m13: /carbon border|CBAM|kerosene|aviation|ETS|emissions trading/i,
    m14: /common agricultural|CAP |farmers|agricultur/i,
    m15: /minimum (level of )?tax|wealth|windfall|Pillar|corporate tax|tax avoidance|tax evasion|digital tax|BEFIT/i,
    m16: /own resources|multiannual financial framework|MFF|common borrowing|NextGeneration|joint debt/i,
    m17: /unanimity|qualified majority|amendments? (of|to) the Treaties|treaty change|right of initiative/i,
    m18: /abortion|reproductive|Charter of Fundamental Rights/i,
    m19: /enlargement|accession|candidate status|Ukraine/i,
    m20: /working time|four-day|right to disconnect|telework/i,
    m21: /medicin|pharmaceutical/i,
    m22: /housing/i,
  },
  measures: {
    m01: { fr: "Taxer les très gros héritages", en: "Tax the largest inheritances" },
    m03: { fr: "Smic à 1 700 euros net", en: "Minimum wage at 1,700 euros net" },
    m09: { fr: "Sortir des fossiles, garder le nucléaire comme transition", en: "Exit fossil fuels, keep nuclear as a transition" },
    m10: { fr: "Saisir les avoirs russes gelés pour l'Ukraine", en: "Seize frozen Russian assets for Ukraine" },
    m11: { fr: "Fonds européen de défense par l'emprunt commun", en: "European defence fund through joint borrowing" },
    m12: { fr: "Acheter européen, refuser les nouveaux accords de libre-échange", en: "Buy European, refuse new free-trade deals" },
    m13: { fr: "Étendre la taxe carbone aux frontières, taxer le kérosène", en: "Extend the carbon border tax, tax kerosene" },
    m14: { fr: "Prix planchers agricoles, sortir l'agriculture du libre-échange", en: "Farm price floors, take farming out of free trade" },
    m15: { fr: "Impôt minimum sur les grandes fortunes et les multinationales", en: "Minimum tax on great fortunes and multinationals" },
    m16: { fr: "Un budget européen plus grand, ressources propres, dette commune", en: "A bigger EU budget, own resources, joint debt" },
    m17: { fr: "Majorité qualifiée au Conseil, initiative au Parlement européen", en: "Qualified majority in the Council, initiative for Parliament" },
    m18: { fr: "Le droit à l'IVG dans la Charte des droits fondamentaux", en: "Abortion rights in the Charter of Fundamental Rights" },
    m19: { fr: "Élargir l'Union, notamment à l'Ukraine", en: "Enlarge the EU, notably to Ukraine" },
    m20: { fr: "Réduire le temps de travail", en: "Cut working time" },
    m21: { fr: "Service public et production européenne du médicament", en: "Public medicines service and European production" },
    m22: { fr: "Logement abordable", en: "Affordable housing" },
  },
  // Reviewed and NOT kept: "My voice, my choice" (182713) and Mercosur Court referral (183885) are rival resolutions
  // that both voted down while voting for the adopted ones (182767, 183884); EDIP 181879 and Omnibus V 196482/196519,
  // Critical Medicines 183244 are rejection motions (they voted for the texts); CAP 2020–2021 votes against a reform
  // without the capping the programme wants; trade-quota modifications (Korea 150181, NZ 150070, Chile 156843) are not
  // new agreements; Lalucq against the public procurement report (178384) only asks for a study of European preference.
  contradictions: [
    ...["Raphaël Glucksmann", "Aurore Lalucq"].map((person) => ({
      person, chamber: "PE", legislature: 9, num: 146888, position: "P", measure: "m09", strength: "partial",
      explanation: {
        fr: "A voté l'objection visant à retirer le gaz et le nucléaire de la taxonomie des activités durables, alors que le programme garde le nucléaire comme énergie de transition ; l'acte visait aussi le gaz fossile, que le programme veut faire décliner.",
        en: "Voted for the objection removing gas and nuclear from the EU taxonomy of sustainable activities, while the programme keeps nuclear as a transition energy; the act also covered fossil gas, which the programme wants to phase down.",
      },
    })),
  ],
};
