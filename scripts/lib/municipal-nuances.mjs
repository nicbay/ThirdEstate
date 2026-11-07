// Municipal-election list nuances (Ministry of the Interior grids, 2020 and 2026) → political families.
//
// The Ministry attributes a "nuance" to each list (circulaire on the attribution of nuances). The codes and the
// official labels below come from the 2026 candidatures file (column "Nuance de liste") and, for codes that only exist
// in 2020 (LREM, LRDG, LDLF, LGJ, LNC), from the 2020 nuance grid. The FAMILY grouping is ProjectView's own editorial
// choice, documented in docs/data-municipal.md; it follows the usual French colour convention (left in red/pink,
// ecologists in green, centre in orange, right in blue, far right in navy).

export const FAMILIES = {
  far_left: { order: 1, color: "#8B0000", fr: "Extrême gauche", en: "Far left", bloc: "left" },
  radical_left: { order: 2, color: "#C8102E", fr: "Gauche radicale", en: "Radical left", bloc: "left" },
  left: { order: 3, color: "#E8556D", fr: "Gauche", en: "Left", bloc: "left" },
  ecologist: { order: 4, color: "#2E8B3E", fr: "Écologistes", en: "Ecologists", bloc: "left" },
  centre: { order: 5, color: "#F2A500", fr: "Centre", en: "Centre", bloc: "centre" },
  right: { order: 6, color: "#1F5AA6", fr: "Droite", en: "Right", bloc: "right" },
  far_right: { order: 7, color: "#13213F", fr: "Extrême droite", en: "Far right", bloc: "far_right" },
  regionalist: { order: 8, color: "#2A9D8F", fr: "Régionalistes", en: "Regionalists", bloc: "other" },
  miscellaneous: { order: 9, color: "#8C8C8C", fr: "Divers", en: "Miscellaneous", bloc: "other" },
  unclassified: { order: 10, color: "#C9C9C9", fr: "Sans nuance attribuée", en: "No label assigned", bloc: "none" },
};

// code → { fr: official label, en: translation, family, years: grids in which the code is used }
export const NUANCES = {
  LEXG: { fr: "Liste d'extrême-gauche", en: "Far-left list", family: "far_left", years: [2020, 2026] },
  LFI: { fr: "Liste de La France insoumise", en: "La France insoumise list", family: "radical_left", years: [2020, 2026] },
  LCOM: { fr: "Liste du Parti communiste français", en: "French Communist Party list", family: "radical_left", years: [2020, 2026] },
  LSOC: { fr: "Liste du Parti socialiste", en: "Socialist Party list", family: "left", years: [2020, 2026] },
  LRDG: { fr: "Liste du Parti radical de gauche", en: "Left Radical Party list", family: "left", years: [2020] },
  LUG: { fr: "Liste d'union à gauche", en: "Left-wing union list", family: "left", years: [2020, 2026] },
  LDVG: { fr: "Liste divers gauche", en: "Miscellaneous left list", family: "left", years: [2020, 2026] },
  LVEC: { fr: "Liste Les Ecologistes", en: "Les Écologistes (Greens) list", family: "ecologist", years: [2020, 2026], note2020: "2020 label: Liste Europe-Ecologie-Les Verts" },
  LECO: { fr: "Liste écologiste", en: "Ecologist list", family: "ecologist", years: [2020, 2026] },
  LREN: { fr: "Liste Renaissance", en: "Renaissance list", family: "centre", years: [2026] },
  LREM: { fr: "Liste La République en marche", en: "La République en marche list", family: "centre", years: [2020] },
  LMDM: { fr: "Liste Mouvement démocrate (MoDem)", en: "MoDem list", family: "centre", years: [2020, 2026] },
  LHOR: { fr: "Liste Horizons", en: "Horizons list", family: "centre", years: [2026] },
  LUDI: { fr: "Liste de l'Union des Démocrates et des Indépendants", en: "UDI list", family: "centre", years: [2020, 2026] },
  LUC: { fr: "Liste d'union au centre", en: "Centre union list", family: "centre", years: [2020, 2026] },
  LDVC: { fr: "Liste divers centre", en: "Miscellaneous centre list", family: "centre", years: [2020, 2026] },
  LLR: { fr: "Liste des Républicains", en: "Les Républicains list", family: "right", years: [2020, 2026] },
  LUD: { fr: "Liste d'union à droite", en: "Right-wing union list", family: "right", years: [2020, 2026] },
  LDVD: { fr: "Liste divers droite", en: "Miscellaneous right list", family: "right", years: [2020, 2026] },
  LDLF: { fr: "Liste Debout la France", en: "Debout la France list", family: "right", years: [2020] },
  LDSV: { fr: "Liste de droite souverainiste", en: "Sovereigntist right list", family: "right", years: [2026] },
  LUDR: { fr: "Liste d'union des droites pour la République", en: "Union of the Right for the Republic (UDR) list", family: "far_right", years: [2026] },
  LRN: { fr: "Liste du Rassemblement National", en: "Rassemblement National list", family: "far_right", years: [2020, 2026] },
  LREC: { fr: "Liste Reconquête !", en: "Reconquête list", family: "far_right", years: [2026] },
  LUXD: { fr: "Liste d'union à l'extrême-droite", en: "Far-right union list", family: "far_right", years: [2026] },
  LEXD: { fr: "Liste d'extrême droite", en: "Far-right list", family: "far_right", years: [2020, 2026] },
  LREG: { fr: "Liste régionaliste", en: "Regionalist list", family: "regionalist", years: [2020, 2026] },
  LDIV: { fr: "Liste Divers", en: "Miscellaneous list", family: "miscellaneous", years: [2020, 2026] },
  LGJ: { fr: "Liste Gilets jaunes", en: "Yellow vests list", family: "miscellaneous", years: [2020] },
  LNC: { fr: "Liste non classée (nuance non attribuée)", en: "Unclassified list (no label assigned)", family: "unclassified", years: [2020] },
  NC: { fr: "Candidat non classé (nuance non attribuée)", en: "Unclassified candidate (no label assigned)", family: "unclassified", years: [2020] },
};

export const familyOf = (code) => (code && NUANCES[code] ? NUANCES[code].family : "unclassified");
