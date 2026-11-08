// How a sitting MP got their seat, in words. 53 of the 574 MPs of the 17th legislature sit as substitutes
// (suppléants): they were on the ballot as the running mate of the candidate voters elected, and took the seat
// when that MP left (appointed minister, incompatible office, death, mission over 6 months). They did not win
// an election in their own name; the site says so wherever it presents them. Data: scripts/sync-assemblee.mjs.
import { L, fmtDate } from "../i18n";
import type { Depute } from "../data";

const fem = (d: Depute) => d.civ === "Mme";

/** Short tag for lists and cards, or null for an MP elected in their own name. */
export function entryTag(d: Depute): string | null {
  if (d.entree === "substitute") return fem(d) ? L("Suppléante", "Substitute") : L("Suppléant", "Substitute");
  if (d.entree === "byelection") return L("Élection partielle", "By-election");
  if (d.entree === "returned") return L("Retour du Gouvernement", "Back from government");
  return null;
}

/** One sentence: how and since when the MP holds the seat. */
export function entrySentence(d: Depute): string {
  const since = fmtDate(d.debutMandat);
  const e = fem(d);
  const c = d.cause ?? "";
  // the Assembly's reason, in a few words, in each language
  const why = /Gouvernement/i.test(c) ? L("nommé au Gouvernement", "appointed to the government")
    : /incompatibilit/i.test(c) ? L("démission pour un mandat incompatible", "resigned for an incompatible office")
    : /décédé/i.test(c) ? L("décédé", "died")
    : /mission/i.test(c) ? L("en mission de plus de six mois", "on a government mission of over six months")
    : c.replace(/^remplacement d['’]un député /i, "");
  switch (d.entree) {
    case "substitute":
      return L(
        `${e ? "Suppléante" : "Suppléant"} : siège depuis le ${since}, à la place du député élu en 2024 (${why}). ${e ? "Elle" : "Il"} figurait sur le bulletin comme ${e ? "remplaçante" : "remplaçant"} et n’a pas été ${e ? "élue" : "élu"} en son nom propre.`,
        `Substitute: has held the seat since ${since}, in place of the MP elected in 2024 (${why}). ${e ? "She" : "He"} was on the ballot as the running mate and did not win the seat in ${e ? "her" : "his"} own name.`,
      );
    case "byelection":
      return L(`${e ? "Élue" : "Élu"} lors d’une élection partielle ; siège depuis le ${since}.`, `Won a by-election; has held the seat since ${since}.`);
    case "returned":
      return L(`${e ? "Élue" : "Élu"} en 2024, ${e ? "a quitté" : "a quitté"} son siège pour le Gouvernement puis l’a repris le ${since}.`, `Elected in 2024, left the seat for government and took it back on ${since}.`);
    default:
      return L(`${e ? "Élue" : "Élu"} aux législatives de 2024 ; siège depuis le ${since}.`, `Elected at the 2024 general election; has held the seat since ${since}.`);
  }
}
