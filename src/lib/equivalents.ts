// Concrete things public money pays for, to translate a sum of new debt into something you can picture.
// Every cost is a published, dated figure; `src` says where it comes from. Sorted by cost when used.
// Salaries are net (what the person is paid), not the employer's total cost.

export interface Equivalent {
  id: string;
  cost: number; // euros
  /** [singular, plural] */
  fr: [string, string];
  en: [string, string];
  srcFr: string;
  srcEn: string;
  url?: string;
}

export const EQUIVALENTS: Equivalent[] = [
  {
    id: "rsa", cost: 651.69 * 12,
    fr: ["année de RSA", "années de RSA"], en: ["year of RSA (minimum income)", "years of RSA (minimum income)"],
    srcFr: "Montant forfaitaire pour une personne seule sans enfant, 651,69 € par mois au 1er avril 2026.",
    srcEn: "Basic amount for a single person without children, €651.69 a month from 1 April 2026.",
    url: "https://www.service-public.fr/particuliers/vosdroits/F19778",
  },
  {
    id: "student", cost: 12_000,
    fr: ["année d’études d’un étudiant à l’université", "années d’études d’un étudiant à l’université"], en: ["year of a university student’s education", "years of a university student’s education"],
    srcFr: "Dépense publique moyenne par étudiant à l’université, environ 12 000 € par an (10 100 € en 2019 selon la DEPP, en hausse depuis).",
    srcEn: "Average public spending per university student, about €12,000 a year (€10,100 in 2019 per the DEPP, higher since).",
    url: "https://www.education.gouv.fr/depp/en-2019-le-cout-moyen-par-etudiant-est-de-11-530-euros-451902",
  },
  {
    id: "smic", cost: 1823.03 * 12,
    fr: ["année de SMIC brut", "années de SMIC brut"], en: ["year on the minimum wage (gross)", "years on the minimum wage (gross)"],
    srcFr: "SMIC à temps plein, 1 823,03 € brut par mois au 1er janvier 2026.",
    srcEn: "Full-time minimum wage, €1,823.03 gross a month from 1 January 2026.",
    url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-au-1er-janvier-2026",
  },
  {
    id: "carer", cost: 2538 * 12,
    fr: ["année de salaire d’un soignant de l’hôpital public", "années de salaire d’un soignant de l’hôpital public"], en: ["year of a public-hospital nurse’s or carer’s pay", "years of a public-hospital nurse’s or carer’s pay"],
    srcFr: "Salaire net moyen du personnel soignant (infirmiers, aides-soignants) de l’hôpital public, 2 538 € par mois en équivalent temps plein (DREES, 2022).",
    srcEn: "Average net pay of care staff (nurses, care assistants) in public hospitals, €2,538 a month full-time equivalent (DREES, 2022).",
    url: "https://www.drees.solidarites-sante.gouv.fr/sites/default/files/2025-07/ES%202025%20-%20Fiche%2008%20-%20Les%20salaires%20dans%20les%20%C3%A9tablissements%20de%20sant%C3%A9.pdf",
  },
  {
    id: "teacher", cost: 3090 * 12,
    fr: ["année de salaire d’enseignant", "années de salaire d’enseignant"], en: ["year of a teacher’s salary", "years of a teacher’s salary"],
    srcFr: "Salaire net moyen des enseignants du public, 3 090 € par mois (DEPP, note d’information 26.36, 2026).",
    srcEn: "Average net salary of state-school teachers, €3,090 a month (DEPP, note d’information 26.36, 2026).",
    url: "https://www.education.gouv.fr/sites/default/files/document/depp-ni-2026-36pdf-519727.pdf",
  },
  {
    id: "mp", cost: 7637.39 * 12,
    fr: ["année d’indemnité de député", "années d’indemnité de député"], en: ["year of an MP’s salary", "years of an MP’s salary"],
    srcFr: "Indemnité parlementaire, 7 637,39 € brut par mois depuis le 1er janvier 2024, hors frais de mandat (Assemblée nationale).",
    srcEn: "Parliamentary allowance, €7,637.39 gross a month since 1 January 2024, excluding office expenses (Assemblée nationale).",
    url: "https://www.assemblee-nationale.fr/dyn/contenu/telechargement/631144/file/Fiche%207%20-%20Situation%20mat%C3%A9rielle%20du%20d%C3%A9put%C3%A9.pdf",
  },
  {
    id: "career", cost: 3090 * 12 * 42,
    fr: ["carrière complète d’enseignant", "carrières complètes d’enseignant"], en: ["full teaching career", "full teaching careers"],
    srcFr: "42 années au salaire net moyen d’un enseignant (3 090 € par mois, DEPP). Calcul Third Estate.",
    srcEn: "42 years on a teacher’s average net salary (€3,090 a month, DEPP). Third Estate calculation.",
  },
  {
    id: "motorway", cost: 450e6 / 53,
    fr: ["kilomètre d’autoroute", "kilomètres d’autoroute"], en: ["kilometre of motorway", "kilometres of motorway"],
    srcFr: "Autoroute A69 Toulouse–Castres : 53 km pour environ 450 M€, soit 8,5 M€ le kilomètre.",
    srcEn: "A69 motorway, Toulouse–Castres: 53 km for about €450m, or €8.5m per kilometre.",
  },
  {
    id: "leclerc", cost: 15.91e6,
    fr: ["char Leclerc", "chars Leclerc"], en: ["Leclerc main battle tank", "Leclerc main battle tanks"],
    srcFr: "Coût unitaire complet (développement compris), 15,91 M€ (Cour des comptes, 2001).",
    srcEn: "Full unit cost including development, €15.91m (Cour des comptes, 2001).",
  },
  {
    id: "tgv", cost: 7.8e9 / 302,
    fr: ["kilomètre de ligne TGV", "kilomètres de ligne TGV"], en: ["kilometre of high-speed rail line", "kilometres of high-speed rail line"],
    srcFr: "LGV Sud Europe Atlantique Tours–Bordeaux : 302 km pour 7,8 Md€, soit 25,8 M€ le kilomètre (mise en service 2017).",
    srcEn: "Tours–Bordeaux high-speed line (LGV SEA): 302 km for €7.8bn, or €25.8m per kilometre (opened 2017).",
  },
  {
    id: "college", cost: 26.1e6,
    fr: ["collège neuf de 800 élèves", "collèges neufs de 800 élèves"], en: ["new secondary school for 800 pupils", "new secondary schools for 800 pupils"],
    srcFr: "Collège François-Villon de Mulhouse, 800 élèves : 26,1 M€ TTC (Collectivité européenne d’Alsace, valeur février 2023).",
    srcEn: "Collège François-Villon, Mulhouse, 800 pupils: €26.1m incl. VAT (Collectivité européenne d’Alsace, February 2023 prices).",
    url: "https://www.alsace.eu/delib-cea/6212.1.1.pdf",
  },
  {
    id: "rafale", cost: 5e9 / 42,
    fr: ["Rafale", "Rafale"], en: ["Rafale fighter jet", "Rafale fighter jets"],
    srcFr: "Tranche 5 : 42 Rafale F4 commandés en janvier 2024 pour plus de 5 Md€, soit environ 119 M€ l’avion (ministère des Armées).",
    srcEn: "Batch 5: 42 Rafale F4 ordered in January 2024 for over €5bn, about €119m per aircraft (ministère des Armées).",
    url: "https://www.dassault-aviation.com/en/group/press/press-kits/dassault-aviation-receives-an-order-for-42-rafales-for-the-french-air-and-space-force",
  },
  {
    id: "defence", cost: 50.5e9 / 365,
    fr: ["journée du budget des armées", "journées du budget des armées"], en: ["day of the defence budget", "days of the defence budget"],
    srcFr: "Budget des armées 2025, 50,5 Md€ hors pensions (loi de programmation militaire), divisé par 365.",
    srcEn: "2025 defence budget, €50.5bn excluding pensions (military programming law), divided by 365.",
  },
  {
    id: "chu", cost: 1.2e9,
    fr: ["CHU neuf", "CHU neufs"], en: ["new teaching hospital", "new teaching hospitals"],
    srcFr: "Nouvel hôpital de l’île de Nantes (CHU de Nantes), environ 1,2 Md€.",
    srcEn: "New Île de Nantes hospital (Nantes university hospital), about €1.2bn.",
  },
  {
    id: "carrier", cost: 10e9,
    fr: ["porte-avions de nouvelle génération", "porte-avions de nouvelle génération"], en: ["next-generation aircraft carrier", "next-generation aircraft carriers"],
    srcFr: "Successeur du Charles-de-Gaulle (PA-NG), estimé à environ 10 Md€ (ministère des Armées).",
    srcEn: "Successor to the Charles de Gaulle (PA-NG), estimated at about €10bn (ministère des Armées).",
  },
];
