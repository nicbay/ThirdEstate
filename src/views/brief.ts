// "In brief": a town told in four sentences, the way a reporter would open a story about it.
// Used at the top of the town page and on the homepage for the reader's own town.
// Everything comes from data the site already holds: district profiles (crime, income), the MPs,
// and the 2022 → 2024 legislative first rounds by district.
import { loadDeputes, loadShifts, type Depute } from "../data";
import { L, fmtNum, getLang, plural } from "../i18n";
import { esc, safeColor } from "../util";
import { photoUrl } from "./deputes";
import { CRIME_LABELS, depOf, loadDepartmentTowns, loadNational, plmWhole, type TownData } from "./explore";

export interface Brief {
  code: string;
  name: string;
  town?: TownData;
  mps: { mp: Depute; circo: string; share: number }[];
  vote?: { circo: string; year: number; from: number; left: number; centre: number; farRight: number; farRightShift: number; leftShift: number };
  sentences: string[];
}

const pct = (v: number) => (getLang() === "fr" ? `${Math.round(v)} %` : `${Math.round(v)}%`);
const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v))} ${L("pt", "pt")}${Math.abs(Math.round(v)) > 1 ? "s" : ""}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${L("et", "and")} ${xs.at(-1)}`);

export async function townBrief(code: string, name: string): Promise<Brief> {
  const [{ towns }, deputes, nat, shifts] = await Promise.all([loadDepartmentTowns(depOf(code)), loadDeputes(), loadNational().catch(() => null), loadShifts().catch(() => null)]);
  const t = towns.get(code) ?? plmWhole(towns, code);
  const fr = getLang() === "fr";
  const mps = (t?.districts ?? [])
    .map((d) => ({ mp: deputes.find((x) => x.circo === d.code)!, circo: d.code, share: d.share }))
    .filter((x) => x.mp)
    .sort((a, b) => b.share - a.share);
  const s: string[] = [];

  // 1. who represents the town
  if (mps.length === 1) {
    const { mp } = mps[0];
    const f = mp.civ === "Mme";
    s.push(fr
      ? `${f ? "Votre députée" : "Votre député"} est <a href="#/depute/${mp.id}">${esc(mp.prenom)} ${esc(mp.nom)}</a> (${esc(mp.groupe?.abrev ?? "")}), qui a pris part à ${pct(100 * mp.stats.participation)} des scrutins publics de l’Assemblée.`
      : `Your MP is <a href="#/depute/${mp.id}">${esc(mp.prenom)} ${esc(mp.nom)}</a> (${esc(mp.groupe?.abrev ?? "")}), who took part in ${pct(100 * mp.stats.participation)} of the Assembly’s recorded votes.`);
  } else if (mps.length > 1) {
    const names = mps.slice(0, 4).map(({ mp }) => `<a href="#/depute/${mp.id}">${esc(mp.prenom)} ${esc(mp.nom)}</a> (${esc(mp.groupe?.abrev ?? "")})`);
    s.push(fr ? `La commune est partagée entre ${mps.length} circonscriptions\u00a0: ${list(names)}${mps.length > 4 ? "…" : ""}.` : `The town is split between ${mps.length} districts: ${list(names)}${mps.length > 4 ? "…" : ""}.`);
  }

  // 2. how its (main) district voted at the last legislative election, and the swing since the one before
  const pair = shifts?.pairs.filter((p) => p.level === "district").at(-1);
  const u = mps[0] && pair?.units[mps[0].circo];
  let vote: Brief["vote"];
  if (u && pair) {
    vote = { circo: mps[0].circo, year: pair.to, from: pair.from, left: u.left[1], centre: u.centre[1], farRight: u.farRight[1], farRightShift: u.farRight[2], leftShift: u.left[2] };
    // a bloc with no candidate (or under half a point) is left out rather than reported as "0 %"
    const has = (v: number | null | undefined) => v != null && Math.round(v) > 0;
    const blocs = [
      has(vote.farRight) && (fr ? `${pct(vote.farRight)} à l’extrême droite (${pts(vote.farRightShift)} depuis ${pair.from})` : `the far right ${pct(vote.farRight)} (${pts(vote.farRightShift)} since ${pair.from})`),
      has(vote.left) && (fr ? `${pct(vote.left)} à la gauche (${pts(vote.leftShift)}${has(vote.farRight) ? "" : ` depuis ${pair.from}`})` : `the left ${pct(vote.left)} (${pts(vote.leftShift)}${has(vote.farRight) ? "" : ` since ${pair.from}`})`),
      has(vote.centre) && (fr ? `${pct(vote.centre)} au centre` : `the centre ${pct(vote.centre)}`),
    ].filter((x): x is string => !!x);
    if (blocs.length)
      s.push(fr
        ? `Au premier tour des législatives de ${pair.to}, ${mps.length > 1 ? "la principale circonscription" : "la circonscription"} a donné ${list(blocs)}.`
        : `In the ${pair.to} legislative first round, ${mps.length > 1 ? "its main district" : "the district"} gave ${list(blocs)}.`);
  }

  // 3. how well off it is
  const natIncome = nat?.indicators?.["income.median"]?.median;
  if (t?.income && natIncome) {
    const d = (100 * (t.income - natIncome)) / natIncome;
    s.push(fr
      ? `Le niveau de vie médian y est de ${fmtNum(t.income)} € par an, ${Math.abs(d) < 5 ? "proche de la moyenne nationale" : `${Math.round(Math.abs(d))} % ${d > 0 ? "au-dessus" : "en dessous"} de la moyenne nationale`}${t.unemployment != null ? `, avec ${t.unemployment.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de chômage` : ""}.`
      : `The median standard of living is €${fmtNum(t.income)} a year, ${Math.abs(d) < 5 ? "close to the national average" : `${Math.round(Math.abs(d))}% ${d > 0 ? "above" : "below"} the national average`}${t.unemployment != null ? `, with ${t.unemployment.toLocaleString("en-GB", { maximumFractionDigits: 1 })}% unemployment` : ""}.`);
  }

  // 4. safety: the indicator furthest above the national rate, or a clean bill
  const natCrime: Record<string, number> = nat?.national?.crime?.rates ?? {};
  const rows = Object.keys(CRIME_LABELS).filter((k) => t?.crime?.[k] && natCrime[k]).map((k) => ({ k, ratio: t!.crime![k][1] / natCrime[k] }));
  if (rows.length) {
    const worst = rows.sort((a, b) => b.ratio - a.ratio)[0];
    const above = rows.filter((r) => r.ratio > 1.1).length;
    const lab = CRIME_LABELS[worst.k][fr ? 0 : 1].toLowerCase();
    s.push(worst.ratio < 1.1
      ? rows.length === 1
        ? L("La délinquance enregistrée y est sous la moyenne nationale sur le seul indicateur publié.", "Recorded crime is below the national average on the only published indicator.")
        : L(`La délinquance enregistrée y est sous la moyenne nationale sur ${rows.length === 8 ? "les huit" : `les ${rows.length}`} indicateurs publiés.`, `Recorded crime is below the national average on all ${rows.length} published indicators.`)
      : fr
        ? `Côté sécurité, ${above} ${plural(above, ["indicateur", "indicateurs"], ["", ""])} sur ${rows.length} ${above > 1 ? "dépassent" : "dépasse"} la moyenne nationale ; l’écart le plus net : ${lab}, ${worst.ratio >= 1.95 ? `${worst.ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} fois la moyenne` : `+${Math.round(100 * (worst.ratio - 1))} %`}.`
        : `On safety, ${above} of ${rows.length} ${plural(rows.length, ["", ""], ["indicator", "indicators"])} ${above === 1 ? "is" : "are"} above the national average; the widest gap is ${lab}, ${worst.ratio >= 1.95 ? `${worst.ratio.toLocaleString("en-GB", { maximumFractionDigits: 1 })} times the average` : `+${Math.round(100 * (worst.ratio - 1))}%`}.`);
  }
  return { code, name, town: t, mps, vote, sentences: s };
}

/** Small MP card used by the homepage block. */
export function mpChip(mp: Depute) {
  return `<a class="brief-mp" href="#/depute/${mp.id}" style="--c:${safeColor(mp.groupe?.couleur) ?? "#999"}"><img src="${photoUrl(mp.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/><span><b>${esc(mp.prenom)} ${esc(mp.nom)}</b><span class="muted small">${esc(mp.groupe?.abrev ?? "")}, ${L("circ.", "district")} ${Number(mp.circo?.slice(-2))}</span></span></a>`;
}
