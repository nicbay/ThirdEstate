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

// ---------- Cagé & Piketty (2023), 1848–1956, communes mapped to today's departments ----------
// Their own classification of every party column into five families — G (left), CG (centre-left),
// C (centre), CD (centre-right), D (right) — taken from their Stata code
// (CagePiketty2023CodesInformatiques → doAnnexeA2nuancespolitiqueslegislatives.txt). Where they split a
// party between two families (e.g. 1848 DEMSOC 0.7 G / 0.3 CG) the larger share is used; their "DIV"
// (split evenly across all five) stays DIV here. Families → our blocs: G, CG → G; C → C; CD, D → D,
// then the overrides in CP_OVERRIDE.
const f = (spec) => {
  const out = {};
  for (const [fam, codes] of Object.entries(spec)) for (const c of codes.split(/\s+/)) out[c] = fam;
  return out;
};
export const CP_FAMILY = {
  "1848": f({ G: "DEMSOC", C: "REPMOD", D: "CONS" }),
  "1849": f({ G: "DEMSOC", C: "REPCONS", D: "CONS" }),
  "1871": f({ G: "RAD REP", CG: "REPMOD", CD: "LIB BON PLEB CONS", D: "MON LEG CLE" }),
  "1876": f({ G: "RAD", CG: "REP", C: "REPCONS CONST CENT CED", CD: "BON", D: "MON LEG CONS CLE" }),
  "1881": f({ G: "SOCOUV RAD", CG: "UR", C: "DVG REP", CD: "CENT BON", D: "MON LEG REAC" }),
  "1885": f({ G: "SOC RAD", CG: "RADREP", C: "REP OPP REPIND", CD: "BON MON", D: "CONS" }),
  "1889": f({ G: "SOC RADSOC RAD", CG: "RADDIV", C: "REP OPP REPDIV", CD: "LIB REVIS BOUL BON", D: "MON CONS REAC" }),
  "1893": f({ G: "SOCREV SOC RADSOC", CG: "RAD RADDIV", C: "REP REPDIV", CD: "REPLIB RALLIE REVIS BOUL BON", D: "REAC" }),
  "1898": f({ G: "SOCREV SOC RADSOC", CG: "RAD", C: "REP OPP", CD: "REPDIV REPLIB RALLIE REVIS BON", D: "CONS MON ANT" }),
  "1902": f({ G: "SOCGUES SOC", CG: "RADSOC RAD RADDIS", C: "REP REPMIN REPDIV", CD: "REPLIB RALLIE", D: "NATI REAC PLEBI" }),
  "1906": f({ G: "SOCUNI SOC", CG: "RADSOC RAD", C: "REP", CD: "REPPROG REPLIB PROG LIB", D: "NATI REAC PLEBI CONS MON" }),
  "1910": f({ G: "SFIO SOCIND", CG: "RADSOC RADIND", C: "RADDIV PROG RADARD", CD: "ARD FRARD FR", D: "FRLIB LIB CONS" }),
  "1914": f({ G: "SFIO", CG: "REPSOC RADSOC", C: "RADIND", CD: "ADPRD", D: "FRPR ALP" }),
  "1919": f({ G: "COM SFIO", CG: "REPSOC PRRS", C: "RADIND", CD: "ARD FRURD", D: "UNR ERD BN AF" }),
  "1924": f({ G: "BOP", CG: "SFIO DVG REPSOC", C: "RADSOC REPRAD", CD: "RG", D: "URERD CONSAF" }),
  "1928": f({ G: "PCF", CG: "SFIO DVG REPSOC", C: "RADSOC", CD: "ADRG ADIND", D: "FRURD DVD" }),
  "1932": f({ G: "PCF", CG: "SFIO DVG REPSOC", C: "RADSOC", CD: "ADRG ADIND", D: "ADPDP FRURD AGR DVD" }),
  "1936": f({ G: "PCF", CG: "SFIO DVG USR", C: "RADSOC", CD: "AD", D: "FRURD AGR DVD" }),
  "1945": f({ G: "AUG PCF PCFSFIO", CG: "SFIO DVG", C: "RADSOC UDSR RG REP", CD: "MRP", D: "ADPAYS URDDVD PRL DVD" }),
  "1946-06": f({ G: "PCF", CG: "SFIO DVG", C: "RADSOC UDSR RGR", CD: "MRP", D: "GAUL INDPAYS PRL DVD" }),
  "1946-11": f({ G: "PCI PCF", CG: "SFIO", C: "RADSOC RGR", CD: "MRP GAULG", D: "GAUL INDPAYS PRL DVD" }),
  "1951": f({ G: "PCF", CG: "SFIO DVG", C: "RADSOC UDSR RGR", CD: "MRP RGRIF UIPRN", D: "REP RPF DVD UNIR" }),
  "1956": f({ G: "PCF", CG: "SFIO DVG", C: "RADSOC FRREP UDSR RGR", CD: "MRP CNI", D: "RFGAUL DVD UFFUDCA AUD" }),
};
const FAMILY_BLOC = { G: "G", CG: "G", C: "C", CD: "D", D: "D" };
// Where we depart from the family rule (see doc):
//  - MRP 1945–1956 → centre, as for 1958–1962 (Christian democrats of the "Third Force", not the right)
//  - Poujadists 1956, Action française 1919 and the 1898 antisemitic lists → far right
//  - PCI (Trotskyists, Nov. 1946) → far left
export const CP_OVERRIDE = { MRP: "C", UFFUDCA: "XD", AF: "XD", ANT: "XD", PCI: "XG" };
export const CP_BLOC = Object.fromEntries(
  Object.entries(CP_FAMILY).map(([id, fam]) => [id, Object.fromEntries(Object.entries(fam).map(([c, fm]) => [c, CP_OVERRIDE[c] ?? FAMILY_BLOC[fm]]).concat([["DIV", "DIV"]]))])
);
export const CP_FAMILY_LABEL = { G: "gauche", CG: "centre gauche", C: "centre", CD: "centre droit", D: "droite" };

export const CP_LABEL = {
  DEMSOC: "Démocrates-socialistes (Montagne)", REPMOD: "Républicains modérés", REPCONS: "Républicains conservateurs", CONS: "Conservateurs", DIV: "Divers",
  RAD: "Radicaux", REP: "Républicains", LIB: "Libéraux", BON: "Bonapartistes", PLEB: "Plébiscitaires", MON: "Monarchistes", LEG: "Légitimistes", CLE: "Cléricaux",
  CONST: "Constitutionnels", CENT: "Centre", CED: "Centre droit", SOCOUV: "Socialistes ouvriers", UR: "Union républicaine", DVG: "Divers gauche", REAC: "Réactionnaires",
  SOC: "Socialistes", RADREP: "Radicaux républicains", OPP: "Opportunistes", REPIND: "Républicains indépendants", RADSOC: "Radicaux-socialistes", RADDIV: "Radicaux divers",
  REPDIV: "Républicains divers", REVIS: "Révisionnistes", BOUL: "Boulangistes", SOCREV: "Socialistes révolutionnaires", REPLIB: "Républicains libéraux", RALLIE: "Ralliés",
  ANT: "Antisémites", SOCGUES: "Socialistes guesdistes", RADDIS: "Radicaux dissidents", REPMIN: "Républicains ministériels", NATI: "Nationalistes", PLEBI: "Plébiscitaires",
  SOCUNI: "Socialistes unifiés (SFIO)", REPPROG: "Républicains progressistes", PROG: "Progressistes", SFIO: "SFIO", SOCIND: "Socialistes indépendants", RADIND: "Radicaux indépendants",
  RADARD: "Radicaux (Alliance démocratique)", ARD: "Alliance républicaine démocratique", FRARD: "Fédération républicaine – ARD", FR: "Fédération républicaine", FRLIB: "Fédération républicaine – libéraux",
  REPSOC: "Républicains socialistes", ADPRD: "Alliance démocratique – PRD", FRPR: "Fédération républicaine – progressistes", ALP: "Action libérale populaire", COM: "Communistes",
  PRRS: "Parti radical et radical-socialiste", FRURD: "Fédération républicaine / URD", UNR: "Union nationale républicaine", ERD: "Entente républicaine démocratique", BN: "Bloc national",
  AF: "Action française", BOP: "Bloc ouvrier et paysan (PCF)", REPRAD: "Républicains radicaux", RG: "Gauche radicale", URERD: "Union républicaine / ERD", CONSAF: "Conservateurs – Action française",
  PCF: "Parti communiste", ADRG: "Alliance démocratique – Gauche radicale", ADIND: "Alliance démocratique – indépendants", DVD: "Divers droite", ADPDP: "Alliance démocratique – PDP",
  AGR: "Agrariens", USR: "Union socialiste républicaine", AD: "Alliance démocratique", AUG: "Autres gauche", PCFSFIO: "Listes PCF-SFIO", UDSR: "UDSR", MRP: "MRP",
  ADPAYS: "Alliance démocratique – paysans", URDDVD: "URD et divers droite", PRL: "Parti républicain de la liberté", RGR: "Rassemblement des gauches républicaines",
  GAUL: "Gaullistes", INDPAYS: "Indépendants et paysans", PCI: "Parti communiste internationaliste", GAULG: "Union gaulliste", RGRIF: "RGR – indépendants", UIPRN: "Indépendants, paysans et républicains nationaux",
  RPF: "RPF (gaullistes)", UNIR: "UNIR", FRREP: "Front républicain", CNI: "CNI", RFGAUL: "Républicains sociaux (gaullistes)", UFFUDCA: "Poujadistes (UFF-UDCA)", AUD: "Autres droite",
};
