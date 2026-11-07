// Political blocs for legislative-election history, and one nuance → bloc table per election.
// Documented in docs/data-legislative-history.md (keep both in sync).
//
// Blocs (French convention: left = red, right = blue):
//   XG   far left                     ┐
//   G    left (PCF, LFI, PS, PRG, Greens inside left alliances, misc. left)  ├ "left side"
//   ECO  ecologists outside a left alliance                                  ┘
//   C    centre (MoDem, Macron's parties, opposition centrists of the 1960s–70s)   — neutral
//   D    right (Gaullists, UDF/UMP/LR, UDI when allied with LR, sovereigntists)  ┐ "right side"
//   XD   far right (FN/RN, Ciotti's UXD, Reconquête, MNR, Poujadists…)          ┘
//   DIV  regionalists and miscellaneous — counted in valid votes, on neither side
//
// Codes are the Ministry of the Interior's "nuances" (2012–2024), or the CDSP's party codes /
// tendency columns for 1958–2007 (see the doc for what each code means).

export const BLOCS = {
  XG: { fr: "Extrême gauche", en: "Far left", side: "left" },
  G: { fr: "Gauche", en: "Left", side: "left" },
  ECO: { fr: "Écologistes (hors union de la gauche)", en: "Ecologists (outside left alliance)", side: "left" },
  C: { fr: "Centre", en: "Centre", side: null },
  D: { fr: "Droite", en: "Right", side: "right" },
  XD: { fr: "Extrême droite", en: "Far right", side: "right" },
  DIV: { fr: "Divers et régionalistes", en: "Miscellaneous and regionalists", side: null },
};
export const BLOC_KEYS = Object.keys(BLOCS);
export const LEFT = BLOC_KEYS.filter((b) => BLOCS[b].side === "left");
export const RIGHT = BLOC_KEYS.filter((b) => BLOCS[b].side === "right");

const m = (spec) => {
  const out = {};
  for (const [bloc, codes] of Object.entries(spec)) for (const c of codes.split(/\s+/).filter(Boolean)) out[c] = bloc;
  return out;
};

// ---------- Ministry of the Interior nuances (districts with today's boundaries) ----------
export const NUANCE_BLOC = {
  2024: m({
    XG: "EXG",
    G: "UG COM FI SOC RDG VEC DVG",
    ECO: "ECO",
    C: "ENS HOR UDI DVC", // UDI ran inside the Ensemble coalition in 2024
    D: "LR DVD DSV",
    XD: "RN UXD REC EXD",
    DIV: "REG DIV",
  }),
  2022: m({
    XG: "DXG",
    G: "NUP RDG DVG",
    ECO: "ECO",
    C: "ENS DVC",
    D: "UDI LR DVD DSV", // UDI was in the LR-led "Union de la droite et du centre" in 2022
    XD: "RN REC DXD",
    DIV: "REG DIV",
  }),
  2017: m({
    XG: "EXG",
    G: "COM FI SOC RDG DVG",
    ECO: "ECO", // includes most EELV candidates, who ran under this nuance in 2017
    C: "REM MDM",
    D: "UDI LR DVD DLF",
    XD: "FN EXD",
    DIV: "REG DIV",
  }),
  2012: m({
    XG: "EXG",
    G: "FG SOC RDG DVG VEC", // VEC = EELV, allied with the PS in 2012
    ECO: "ECO",
    C: "CEN ALLI", // CEN = MoDem, ALLI = Alliance centriste
    D: "NCE PRV UMP DVD", // Nouveau Centre and Parti radical were allied with the UMP
    XD: "FN EXD",
    DIV: "AUT REG",
  }),
};

export const NUANCE_LABEL = {
  2024: { EXG: "Extrême gauche", UG: "Union de la gauche (NFP)", COM: "Parti communiste", FI: "La France insoumise", SOC: "Parti socialiste", RDG: "Radicaux de gauche", VEC: "Les Écologistes", DVG: "Divers gauche", ECO: "Écologistes", ENS: "Ensemble", HOR: "Horizons", UDI: "UDI", DVC: "Divers centre", LR: "Les Républicains", DVD: "Divers droite", DSV: "Droite souverainiste", RN: "Rassemblement national", UXD: "Union de l'extrême droite (Ciotti)", REC: "Reconquête", EXD: "Extrême droite", REG: "Régionalistes", DIV: "Divers" },
  2022: { DXG: "Divers extrême gauche", NUP: "NUPES", RDG: "Radicaux de gauche", DVG: "Divers gauche", ECO: "Écologistes", ENS: "Ensemble", DVC: "Divers centre", UDI: "UDI", LR: "Les Républicains", DVD: "Divers droite", DSV: "Droite souverainiste", RN: "Rassemblement national", REC: "Reconquête", DXD: "Divers extrême droite", REG: "Régionalistes", DIV: "Divers" },
  2017: { EXG: "Extrême gauche", COM: "Parti communiste", FI: "La France insoumise", SOC: "Parti socialiste", RDG: "Radicaux de gauche", DVG: "Divers gauche", ECO: "Écologistes", REM: "La République en marche", MDM: "MoDem", UDI: "UDI", LR: "Les Républicains", DVD: "Divers droite", DLF: "Debout la France", FN: "Front national", EXD: "Extrême droite", REG: "Régionalistes", DIV: "Divers" },
  2012: { EXG: "Extrême gauche", FG: "Front de gauche", SOC: "Parti socialiste", RDG: "Radicaux de gauche", DVG: "Divers gauche", VEC: "Europe Écologie Les Verts", ECO: "Écologistes", CEN: "Le Centre pour la France (MoDem)", ALLI: "Alliance centriste", NCE: "Nouveau Centre", PRV: "Parti radical", UMP: "UMP", DVD: "Divers droite", FN: "Front national", EXD: "Extrême droite", AUT: "Autres", REG: "Régionalistes" },
};

// ---------- CDSP (Sciences Po) codes, 1958–2007, old district boundaries ----------
// 1958–1986: columns are party "tendencies" (votes already aggregated by the BDSP);
// 1988–2007: one nuance per candidate. 1988 and 1993 were not fully cleaned by the CDSP:
// a few obviously mistyped codes (SCO, PRP, UOF, RFN…) are mapped to the family their
// candidates' labels show (see doc).
export const CDSP_BLOC = {
  1958: m({ G: "COM UFD SFIO RADSOC RADUFD UDSRMIN", C: "RADCENT MRP", D: "UNR CRR DIVGAUL CNI MOD", XD: "EXD POUJ", DIV: "DIV" }),
  1962: m({ XG: "EXG", G: "COM PSU SFIO RADSOC", C: "RADCENT MRP", D: "UNR-UDT DIVGAULL INDVREP MRPVREP CNI MOD", XD: "EXD POUJ", DIV: "DIV" }),
  1967: m({ XG: "EXG", G: "COM PSU FGDS", C: "CENTDEM", D: "RADDROIT UD5 DIVGAULL RI RALLIE MOD", XD: "EXD ALLREP", DIV: "DIV" }),
  1968: m({ XG: "EXG", G: "COM PSU FGDS RADSOC", C: "CPDM", D: "RADDROIT UDR DIVGAULL RI RIUDR MOD", XD: "EXD", DIV: "DIV" }),
  1973: m({ XG: "LO LCR OCI", G: "COM PSU SOC MRG DVG", C: "REFRAD DIVREF", D: "DVD UDRURP RIURP CDPURP DIVURP UDR RI CDP DIVGAULL", XD: "EXD" }),
  1978: m({ XG: "EXG", G: "COM PSMRG DVG", ECO: "ECO", D: "GAULOPP UDF RPR DVD", XD: "EXD" }),
  1981: m({ XG: "EXG", G: "COM SOC DVG", ECO: "ECO", D: "UDF RPR DVD UDF-RPR", XD: "FRN EXD", DIV: "REG" }),
  1986: m({ XG: "EXG", G: "COM SOC DVG", ECO: "ECO", D: "UDF RPR DVD UDF-RPR", XD: "FRN EXD", DIV: "REG" }),
  1988: m({ XG: "EXG EXE", G: "COM SOC RDG DVG MAJ SDC SCO RDC", ECO: "ECO ECI", D: "RPR UDF DVD UOF UDP UDR PRP", XD: "FRN EXD RFN RRN", DIV: "REG EXO ROG" }),
  1993: m({ XG: "EXG", G: "COM SOC RDG MAJ", ECO: "VEC GEC", D: "UDF RPR DVD", XD: "FRN EXD", DIV: "REG DIV" }),
  1997: m({ XG: "EXG", G: "COM SOC PRG DVG", ECO: "ECO", D: "UDF RPR DVD", XD: "FRN EXD", DIV: "DIV" }),
  2002: m({ XG: "EXG", G: "COM SOC PRG DVG", ECO: "ECO", D: "UDF UMP DVD", XD: "FRN EXD", DIV: "DIV" }), // UDF stayed in the right-wing majority in 2002
  2007: m({ XG: "EXG", G: "COM SOC PRG DVG", ECO: "ECO", C: "MODEM", D: "PSLE UMP DVD", XD: "FRN EXD", DIV: "DIV" }), // PSLE = Nouveau Centre's legal name
};
// "RADICAUX GAUCHE" has a space, so it can't go through m()
CDSP_BLOC[1981]["RADICAUX GAUCHE"] = "G";
CDSP_BLOC[1986]["RADICAUX GAUCHE"] = "G";

export const CDSP_LABEL = {
  COM: "Parti communiste", EXG: "Extrême gauche", PSU: "Parti socialiste unifié", SFIO: "SFIO", UFD: "Union des forces démocratiques",
  RADSOC: "Radicaux socialistes", RADCENT: "Radicaux centristes", RADUFD: "Radicaux UFD", UDSRMIN: "UDSR minoritaires", RADDROIT: "Radicaux de droite",
  UNR: "UNR (gaullistes)", "UNR-UDT": "UNR-UDT (gaullistes)", UD5: "UD-Ve République", UDR: "UDR (gaullistes)", DIVGAUL: "Divers gaullistes", DIVGAULL: "Divers gaullistes",
  CRR: "Centre républicain", MRP: "MRP", MRPVREP: "MRP Ve République", CNI: "CNI", MOD: "Modérés", INDVREP: "Indépendants Ve République", RI: "Républicains indépendants",
  RIUDR: "RI-UDR", RALLIE: "Centristes ralliés", CENTDEM: "Centre démocrate", CPDM: "Progrès et démocratie moderne", ALLREP: "Alliance républicaine", POUJ: "Poujadistes", EXD: "Extrême droite",
  FGDS: "FGDS", LO: "Lutte ouvrière", LCR: "Ligue communiste révolutionnaire", OCI: "OCI", SOC: "Parti socialiste", MRG: "Radicaux de gauche", DVG: "Divers gauche",
  REFRAD: "Réformateurs radicaux", DIVREF: "Divers réformateurs", DVD: "Divers droite", UDRURP: "UDR (URP)", RIURP: "RI (URP)", CDPURP: "CDP (URP)", DIVURP: "Divers URP", CDP: "Centre démocratie et progrès",
  PSMRG: "PS-MRG", ECO: "Écologistes", GAULOPP: "Gaullistes d'opposition", UDF: "UDF", RPR: "RPR", "UDF-RPR": "Union UDF-RPR", FRN: "Front national", REG: "Régionalistes",
  "RADICAUX GAUCHE": "Radicaux de gauche", RDG: "Radicaux de gauche", PRG: "Parti radical de gauche", MAJ: "Majorité présidentielle", VEC: "Les Verts", GEC: "Génération écologie",
  UMP: "UMP", MODEM: "MoDem", PSLE: "Nouveau Centre", DIV: "Divers",
};
