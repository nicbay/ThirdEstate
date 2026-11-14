// Town page, safety section: municipal police officers per 10,000 inhabitants, compared with the median of
// surveyed towns of the same size. Data: scripts/sync-police.mjs (Ministry of the Interior survey of municipal
// police services, data.gouv.fr). National police and gendarmerie headcounts are not published per town.
// loadMunicipalPolice() is the reusable part (e.g. for comparing two towns); renderTownPolice() draws the line.
import { fetchJson } from "../data";
import { L, colon, fmtNum, getLang, plural } from "../i18n";
import { esc, safeUrl } from "../util";

interface Band { min: number; max: number | null; n: number; median: number | null }
interface PoliceFile { year: number; source: string; url: string; bands: Band[]; communes: Record<string, [number, number, number, number]> }

export interface MunicipalPolice {
  code: string;
  year: number;
  /** municipal police officers (agents de police municipale) */
  agents: number;
  /** agents de surveillance de la voie publique (in Paris, agents de surveillance de Paris): not police officers */
  asvp: number;
  /** gardes champêtres (rural police) */
  gardes: number;
  /** INSEE legal population used for the rate */
  population: number;
  /** municipal police officers per 10,000 inhabitants */
  per10k: number;
  /** median per 10,000 among surveyed towns of the same population band that have at least one officer */
  band: Band | null;
  /** dataset page on data.gouv.fr */
  url: string;
}

const files = new Map<string, Promise<PoliceFile | null>>();
const depOf = (code: string) => (/^97/.test(code) ? code.slice(0, 3) : code.slice(0, 2));

/** The town's entry in the latest municipal police survey, or null when the town isn't in it (for Paris, Lyon
 *  and Marseille, pass the city code: the survey has no arrondissement figures). */
export async function loadMunicipalPolice(code: string): Promise<MunicipalPolice | null> {
  const dep = depOf(code);
  if (!files.has(dep)) files.set(dep, fetchJson<PoliceFile>(`/data/police/${dep}.json`).catch(() => null));
  const f = await files.get(dep)!;
  const row = f?.communes[code];
  if (!f || !row) return null;
  const [agents, asvp, gardes, population] = row;
  return {
    code, year: f.year, agents, asvp, gardes, population, url: f.url,
    per10k: (1e4 * agents) / population,
    band: f.bands.find((b) => population >= b.min && (b.max == null || population < b.max)) ?? null,
  };
}

const dec = (n: number) => n.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sizeLabel = (b: Band) =>
  b.max == null ? L(`de plus de ${fmtNum(b.min)} habitants`, `over ${fmtNum(b.min)} people`)
  : b.min === 0 ? L(`de moins de ${fmtNum(b.max)} habitants`, `under ${fmtNum(b.max)} people`)
  : L(`de ${fmtNum(b.min)} à ${fmtNum(b.max)} habitants`, `of ${fmtNum(b.min)} to ${fmtNum(b.max)} people`);

/** Fills `box` with the municipal police line, or leaves it empty when the town isn't in the survey. */
export async function renderTownPolice(box: HTMLElement, cityCode: string, wholeCity: string | null) {
  const p = await loadMunicipalPolice(cityCode);
  if (!p || (!p.agents && !p.asvp && !p.gardes)) return;
  const others = [
    p.asvp ? `${fmtNum(p.asvp)} ${cityCode === "75056" ? plural(p.asvp, ["agent de surveillance de Paris", "agents de surveillance de Paris"], ["parking and street warden", "parking and street wardens"]) : plural(p.asvp, ["agent de surveillance de la voie publique (ASVP)", "agents de surveillance de la voie publique (ASVP)"], ["parking and street warden (ASVP)", "parking and street wardens (ASVP)"])}` : "",
    p.gardes ? `${fmtNum(p.gardes)} ${plural(p.gardes, ["garde champêtre", "gardes champêtres"], ["rural constable", "rural constables"])}` : "",
  ].filter(Boolean).join(L(" et ", " and "));
  let cmp = "";
  if (p.agents && p.band?.median) {
    const d = ((p.per10k - p.band.median) / p.band.median) * 100;
    const ref = L(`la médiane des communes ${sizeLabel(p.band)} dotées d’une police municipale`, `the median for towns ${sizeLabel(p.band)} with a municipal police`);
    cmp = Math.abs(d) < 10
      ? L(`, proche de ${ref} (${dec(p.band.median)})`, `, close to ${ref} (${dec(p.band.median)})`)
      : `, ${L(`${Math.round(Math.abs(d))} % ${d > 0 ? "au-dessus" : "en dessous"} de ${ref}`, `${Math.round(Math.abs(d))}% ${d > 0 ? "above" : "below"} ${ref}`)} (${dec(p.band.median)})`;
  }
  const main = p.agents
    ? `<b>${fmtNum(p.agents)}</b> ${plural(p.agents, ["policier municipal", "policiers municipaux"], ["municipal police officer", "municipal police officers"])}, ${L("soit", "that is")} <b>${dec(p.per10k)}</b> ${L("pour 10 000 habitants", "per 10,000 people")}${cmp}.`
    : `${L("Aucun policier municipal déclaré", "No municipal police officer reported")}.`;
  box.innerHTML = `<h3 class="small">${L("Police municipale", "Municipal police")}${wholeCity ? ` (${L(`${esc(wholeCity)} entier`, `whole of ${esc(wholeCity)}`)})` : ""}</h3>
    <p class="small">${main}${others ? ` ${L("S’y ajoutent", "Plus")} ${others}.` : ""}</p>
    <p class="muted tiny">${L("Effectifs au 31 décembre", "Staff at 31 December")} ${p.year}${colon()}<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${L("enquête polices municipales, ministère de l’Intérieur", "municipal police survey, Ministry of the Interior")}</a>${L(" ; population Insee", "; population from Insee")}. ${L("Les effectifs de la police nationale et de la gendarmerie ne sont pas publiés par commune.", "National police and gendarmerie headcounts aren’t published per town.")}</p>`;
}
