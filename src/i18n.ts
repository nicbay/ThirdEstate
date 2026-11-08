export type Lang = "fr" | "en";

const dict = {
  fr: {
    navPresidential: "Présidentielle",
    navMPs: "Députés",
    langSwitch: "English",
    loading: "Chargement…",
    error: "Impossible de charger les données",
    round1: "1er tour",
    round2: "2nd tour",
    presidentialTitle: (y: number) => `Élection présidentielle ${y}`,
    nationalResult: "Résultat national",
    turnout: "Participation",
    registered: "Inscrits",
    votes: "voix",
    clickDept: "Cliquez sur un département pour voir le détail.",
    leader: "En tête",
    overseas: "Outre-mer et étranger",
    sourceResults: "Source : ministère de l’Intérieur via l’API data.gouv.fr (requête en direct)",
    mpsTitle: "Députés de la 17e législature",
    search: "Rechercher un nom, un département…",
    allGroups: "Tous les groupes",
    participation: "Participation",
    district: (dep: string, n: number) => `${dep} · ${n}${n === 1 ? "re" : "e"} circ.`,
    backToMPs: "← Tous les députés",
    born: "Né(e) le",
    profession: "Profession",
    socioCategory: "Catégorie socio-professionnelle",
    hatvp: "Déclarations HATVP",
    contact: "Contact et réseaux",
    scrutins: "Scrutins",
    for: "Pour",
    against: "Contre",
    abstention: "Abstention",
    nonVoting: "Non-votant",
    absent: "Absent",
    adopted: "adopté",
    rejected: "rejeté",
    allPositions: "Toutes positions",
    allOutcomes: "Tous résultats",
    requestedBy: "Demandé par",
    searchVotes: "Rechercher dans les scrutins…",
    page: (p: number, n: number) => `Page ${p} / ${n}`,
    prev: "Précédent",
    next: "Suivant",
    sourceAN: (d: string) => `Source : open data de l’Assemblée nationale, synchronisé le ${d}`,
    shareFor: "Part de « pour » parmi les suffrages exprimés",
    results: (n: number) => `${n} résultat${n > 1 ? "s" : ""}`,
  },
  en: {
    navPresidential: "Presidential",
    navMPs: "MPs",
    langSwitch: "Français",
    loading: "Loading…",
    error: "Could not load data",
    round1: "1st round",
    round2: "Runoff",
    presidentialTitle: (y: number) => `${y} presidential election`,
    nationalResult: "National result",
    turnout: "Turnout",
    registered: "Registered voters",
    votes: "votes",
    clickDept: "Click a department to see its results.",
    leader: "Leading",
    overseas: "Overseas & abroad",
    sourceResults: "Source: Ministry of the Interior via the data.gouv.fr API (live query)",
    mpsTitle: "MPs of the 17th legislature",
    search: "Search a name, a department…",
    allGroups: "All groups",
    participation: "Participation",
    district: (dep: string, n: number) => `${dep} · district ${n}`,
    backToMPs: "← All MPs",
    born: "Born",
    profession: "Occupation",
    socioCategory: "Socio-professional category",
    hatvp: "HATVP declarations",
    contact: "Contact & social media",
    scrutins: "Votes",
    for: "For",
    against: "Against",
    abstention: "Abstain",
    nonVoting: "Non-voting",
    absent: "Absent",
    adopted: "adopted",
    rejected: "rejected",
    allPositions: "All positions",
    allOutcomes: "All outcomes",
    requestedBy: "Requested by",
    searchVotes: "Search votes…",
    page: (p: number, n: number) => `Page ${p} of ${n}`,
    prev: "Previous",
    next: "Next",
    sourceAN: (d: string) => `Source: Assemblée nationale open data, synced ${d}`,
    shareFor: "Share of “for” among votes cast",
    results: (n: number) => `${n} result${n > 1 ? "s" : ""}`,
  },
};

const stored = (() => {
  try {
    return localStorage.getItem("lang");
  } catch {
    return null;
  }
})();
let lang: Lang = stored === "en" || stored === "fr" ? stored : navigator.language.startsWith("fr") ? "fr" : "en";

export const getLang = () => lang;
/** French typography: a no-break space before : ; ! ? » and after «, so the mark never starts a line. */
const frSpaces = (s: string) => s.replace(/ ([:;!?»])/g, " $1").replace(/« /g, "« ");
/** Inline translation: L("Sondages", "Polls"). French strings get no-break spaces before : ; ! ? ». */
export const L = (fr: string, en: string) => (lang === "fr" ? frSpaces(fr) : en);
/** "Label : value" in French (no-break space), "Label: value" in English. */
export const colon = () => (lang === "fr" ? " : " : ": ");
/** The singular or plural noun for n: French uses the singular for 0 and 1, English only for 1.
 *  plural(3, ["bibliothèque", "bibliothèques"], ["library", "libraries"]) */
export const plural = (n: number, fr: [string, string], en: [string, string]) => (lang === "fr" ? (Math.abs(n) < 2 ? fr[0] : fr[1]) : Math.abs(n) === 1 ? en[0] : en[1]);
export const t = () => dict[lang];
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem("lang", l);
  } catch {
    /* ignore */
  }
}
export const fmtNum = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
export const fmtPct = (n: number, digits = 1) => `${n.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`.replace(" %", lang === "fr" ? " %" : "%");
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
