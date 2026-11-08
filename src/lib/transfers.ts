// Vote transfers for the scenario planner: where an eliminated candidate's voters go in the runoff.
// Each rule returns [to finalist A, to finalist B] in % of that candidate's first-round voters;
// the rest (100 − A − B) abstains or votes blank/void.
//
// 1. "2022": the only measured transfers we have, from the 2022 Macron–Le Pen runoff.
//    Ipsos / Sopra Steria, « Second tour : profil des abstentionnistes et sociologie des électorats »,
//    fieldwork 21–23 April 2022, 4,000 registered voters, published 24 April 2022
//    (https://www.ipsos.com/fr-fr/presidentielle-2022/second-tour-profil-des-abstentionnistes-et-sociologie-des-electorats).
//    Mélenchon voters: Macron 42 %, Le Pen 17 %, no vote 41 %. Jadot: 65 / 6 / 29. Pécresse: 53 / 18 / 29.
//    Zemmour: Le Pen 73 % (the release gives no Macron figure: our 7 % is an assumption).
//    They are applied by family, and only to a duel shaped like 2022: a nationalist-right finalist
//    against a centre or right one, the 2022 "Macron" share going to the latter. A voter of the same
//    family as the non-RN finalist, or any other duel, falls back on rule 2.
// 2. "prox": the site's political-distance assumption (same family 85 %, next 50 %, two steps 40 %,
//    further 15 %, capped at 90 % in total), the one the forecast uses (lib/forecast.ts).
// 3. "front" / "fissure": a strong or a cracked « front républicain » against a nationalist-right
//    finalist. Round numbers, assumptions only, for playing out the two stories.
import { defaultTransfer } from "./forecast";
import type { Bloc } from "./candidates";

export type TransferPreset = "2022" | "prox" | "front" | "fissure";
export const TRANSFER_PRESETS: TransferPreset[] = ["2022", "front", "fissure", "prox"];

export interface Side { bloc: Bloc | null; party: string | null }

/** 2022 electorates, keyed by the 2027 party codes that carry them on. [to Macron, to Le Pen] */
const SURVEY_2022: { parties: string[]; macron: number; lePen: number; who: string; partial?: boolean }[] = [
  { parties: ["LFI"], macron: 42, lePen: 17, who: "Mélenchon" },
  { parties: ["LE", "EELV"], macron: 65, lePen: 6, who: "Jadot" },
  { parties: ["LR", "NE", "NF"], macron: 53, lePen: 18, who: "Pécresse" },
  { parties: ["REC", "R!"], macron: 7, lePen: 73, who: "Zemmour", partial: true },
];

export const SURVEY_SOURCE = {
  url: "https://www.ipsos.com/fr-fr/presidentielle-2022/second-tour-profil-des-abstentionnistes-et-sociologie-des-electorats",
  fr: "Ipsos / Sopra Steria, sondage du 21 au 23 avril 2022 auprès de 4 000 inscrits, publié le 24 avril 2022 (« Second tour : profil des abstentionnistes et sociologie des électorats »)",
  en: "Ipsos / Sopra Steria, poll of 4,000 registered voters, 21–23 April 2022, published 24 April 2022 (“Second tour : profil des abstentionnistes et sociologie des électorats”)",
};

/** Index (0 or 1) of the nationalist-right finalist when exactly one of the two is. */
export const rnSide = (a: Side, b: Side): 0 | 1 | null => (a.bloc === 4 && b.bloc !== 4 ? 0 : b.bloc === 4 && a.bloc !== 4 ? 1 : null);

export interface Transfer { t: [number, number]; src: "survey" | "survey-partial" | "prox" | "assumption"; who?: string }

const orient = (toOther: number, toRn: number, rn: 0 | 1): [number, number] => (rn === 1 ? [toOther, toRn] : [toRn, toOther]);

export function transferFor(preset: TransferPreset, from: Side, a: Side, b: Side): Transfer {
  const prox = (): Transfer => ({ t: defaultTransfer(from.bloc, a.bloc, b.bloc), src: "prox" });
  const rn = rnSide(a, b);
  if (preset === "prox" || rn == null) return prox();
  const other = rn === 1 ? a : b;
  if (preset === "2022") {
    if (other.bloc !== 2 && other.bloc !== 3) return prox();
    const row = SURVEY_2022.find((r) => from.party && r.parties.includes(from.party));
    if (!row || (from.bloc != null && from.bloc === other.bloc)) return prox();
    return { t: orient(row.macron, row.lePen, rn), src: row.partial ? "survey-partial" : "survey", who: row.who };
  }
  // [to the other finalist, to the RN finalist] by the eliminated candidate's family (0 radical left … 4 nationalist right)
  const FRONT: [number, number][] = [[75, 5], [80, 5], [85, 5], [70, 15], [10, 75]];
  const CRACKED: [number, number][] = [[30, 20], [50, 10], [65, 15], [40, 35], [5, 80]];
  const row = from.bloc == null ? (preset === "front" ? [60, 10] : [35, 25]) : (preset === "front" ? FRONT : CRACKED)[from.bloc];
  return { t: orient(row[0], row[1], rn), src: "assumption" };
}
