// INSEE socio-professional categories (PCS): English names, and the shares of the French population in
// employment, to compare with the occupations MPs declare to the Assemblée.
import { L } from "../i18n";

const key = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

/** The six PCS groups ("familles"), plus "not stated". Keys are normalised French labels. */
export type PcsGroup = "agri" | "artisans" | "cadres" | "intermediaires" | "employes" | "ouvriers" | "none";
const GROUPS: Record<PcsGroup, [fr: string, en: string]> = {
  agri: ["Agriculteurs exploitants", "Farmers"],
  artisans: ["Artisans, commerçants et chefs d’entreprise", "Craftspeople, shopkeepers and business owners"],
  cadres: ["Cadres et professions intellectuelles supérieures", "Managers and higher professionals"],
  intermediaires: ["Professions intermédiaires", "Intermediate professions"],
  employes: ["Employés", "Clerical, sales and service workers"],
  ouvriers: ["Ouvriers", "Manual workers"],
  none: ["Sans profession déclarée", "No occupation stated"],
};
export const PCS_ORDER: PcsGroup[] = ["agri", "artisans", "cadres", "intermediaires", "employes", "ouvriers", "none"];
const BY_FR = new Map(Object.entries(GROUPS).map(([k, [fr]]) => [key(fr), k as PcsGroup]));

/** Group of an MP's declared family; missing and "Sans profession déclarée" are the same thing: not stated. */
export function pcsGroup(fam: string | null | undefined): PcsGroup {
  if (!fam) return "none";
  const k = BY_FR.get(key(fam));
  if (k) return k;
  const s = key(fam); // tolerate small label changes upstream
  if (s.startsWith("agricult")) return "agri";
  if (s.startsWith("artisan") || s.includes("chefs d'entreprise")) return "artisans";
  if (s.startsWith("cadre")) return "cadres";
  if (s.startsWith("professions interm")) return "intermediaires";
  if (s.startsWith("employ")) return "employes";
  if (s.startsWith("ouvrier")) return "ouvriers";
  return "none";
}
export const pcsGroupLabel = (g: PcsGroup) => L(GROUPS[g][0], GROUPS[g][1]);

/** The detailed categories (2-digit PCS) used by the Assemblée, in English. */
const CATEGORIES: Record<string, string> = {
  "agriculteurs exploitants": "Farmers",
  "artisans": "Craftspeople",
  "commerçants et assimilés": "Shopkeepers and related",
  "chefs d'entreprise de plus de 10 personnes": "Heads of businesses with over 10 staff",
  "chefs d'entreprise de 10 salariés ou plus": "Heads of businesses with 10 or more employees",
  "professions libérales": "Self-employed professionals",
  "cadres de la fonction publique, professions intellectuelles et artistiques": "Public-sector managers, intellectual and artistic professions",
  "cadres administratifs et techniques de la fonction publique": "Public-sector administrative and technical managers",
  "professeurs et professions scientifiques supérieures": "Teachers and higher scientific professions",
  "professions de l'information, de l'art et des spectacles": "Media, arts and entertainment professions",
  "cadres d'entreprise": "Business managers",
  "cadres des services administratifs et commerciaux d'entreprise": "Administrative and sales managers in business",
  "ingénieurs et cadres techniques d'entreprise": "Engineers and technical managers in business",
  "professions de l'enseignement primaire et professionnel, de la formation continue et du sport": "Primary and vocational teachers, adult-education and sports professions",
  "professions intermédiaires de la santé et du travail social": "Intermediate health and social-work professions",
  "professions intermédiaires administratives de la fonction publique": "Intermediate public-sector administrative professions",
  "professions intermédiaires administratives et commerciales des entreprises": "Intermediate administrative and sales professions in business",
  "techniciens": "Technicians",
  "agents de maîtrise (hors maîtrise administrative)": "Supervisors and foremen (non-administrative)",
  "employés administratifs de la fonction publique, agents de service et auxiliaires de santé": "Public-sector clerical staff, service staff and care assistants",
  "policiers, militaires, pompiers, agents de sécurité privée": "Police, military, firefighters and private security",
  "policiers et militaires": "Police and military",
  "employés administratifs d'entreprise": "Office clerks in business",
  "employés de commerce": "Retail workers",
  "personnels des services directs aux particuliers": "Personal-service workers",
  "ouvriers qualifiés de type industriel": "Skilled industrial workers",
  "ouvriers qualifiés de type artisanal": "Skilled craft workers",
  "chauffeurs": "Drivers",
  "ouvriers qualifiés de la manutention, du magasinage et du transport": "Skilled handling, warehouse and transport workers",
  "ouvriers peu qualifiés de type industriel": "Low-skilled industrial workers",
  "ouvriers peu qualifiés de type artisanal": "Low-skilled craft workers",
  "ouvriers agricoles, des travaux forestiers, de la pêche et de l'aquaculture": "Farm, forestry, fishing and fish-farming workers",
  "ouvriers agricoles": "Farm workers",
  "anciens agriculteurs exploitants": "Retired farmers",
  "anciens artisans, commerçants, chefs d'entreprise": "Retired craftspeople, shopkeepers and business owners",
  "anciens cadres": "Retired managers",
  "anciennes professions intermédiaires": "Retired intermediate professions",
  "anciens employés": "Retired clerical, sales and service workers",
  "anciens ouvriers": "Retired manual workers",
  "chômeurs n'ayant jamais travaillé": "Unemployed, never worked",
  "élèves, étudiants": "Pupils and students",
  "sans profession déclarée": "No occupation stated",
  "autres personnes sans activité professionnelle": "Other people without an occupation",
};
/** French label as published, English translation when known (falls back to the French label). */
export const pcsCategoryLabel = (cat: string) => L(cat.replace(/\s+/g, " ").trim(), CATEGORIES[key(cat)] ?? cat);

/**
 * People in employment by PCS group, France, 2024, in %: INSEE, enquête Emploi 2024, « Emploi, chômage,
 * revenus du travail », édition 2025, figure 1 (people living in ordinary housing). "none" = non renseigné.
 */
export const INSEE_EMPLOYED_2024: Record<PcsGroup, number> = { agri: 1.3, artisans: 6.8, cadres: 23.0, intermediaires: 25.2, employes: 24.8, ouvriers: 18.0, none: 0.9 };
export const INSEE_SOURCE = {
  url: "https://www.insee.fr/fr/statistiques/8376826",
  name: () => L("INSEE, enquête Emploi 2024, personnes en emploi", "INSEE, 2024 Labour Force Survey, people in employment"),
};
