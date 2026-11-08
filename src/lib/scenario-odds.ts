// How likely is a scenario (these two finalists, this winner) according to today's polls?
// Monte Carlo: each candidate's first-round share = poll average + a random polling error
// (normal, σ = ROUND1_SD points, the typical miss six months before a French presidential vote);
// the top two go to the runoff, whose margin = the runoff polls for that pair when they exist,
// otherwise the default vote-transfer model, plus a random error (σ = ROUND2_SD).
// Indicative only: errors are treated as independent between candidates.

export const ROUND1_SD = 3.5;
export const ROUND2_SD = 5;
export const RUNS = 20000;

export interface Base { name: string; share: number }
export type RunoffShare = (a: string, b: string) => number; // a's expected % of valid runoff votes

function gauss(rand: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// deterministic so the headline number doesn't flicker between renders
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const erf = (x: number) => { // Abramowitz–Stegun
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
};
export const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export interface ScenarioModel {
  /** P(these two reach the runoff) */
  pRound1: (a: string, b: string) => number;
  /** P(winner beats loser | they meet in the runoff) */
  pRound2: (winner: string, loser: string) => number;
}

export function buildModel(base: Base[], runoff: RunoffShare): ScenarioModel {
  const rand = mulberry32(2027);
  const pairs = new Map<string, number>();
  for (let r = 0; r < RUNS; r++) {
    let i1 = -1, i2 = -1, v1 = -Infinity, v2 = -Infinity;
    for (let i = 0; i < base.length; i++) {
      const v = base[i].share + ROUND1_SD * gauss(rand);
      if (v > v1) { i2 = i1; v2 = v1; i1 = i; v1 = v; } else if (v > v2) { i2 = i; v2 = v; }
    }
    const k = [base[i1].name, base[i2].name].sort().join("|");
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  return {
    pRound1: (a, b) => (pairs.get([a, b].sort().join("|")) ?? 0) / RUNS,
    pRound2: (w, l) => normCdf((runoff(w, l) - 50) / ROUND2_SD),
  };
}

// ---------- same odds, in familiar terms ----------
// Every probability is exact arithmetic (coins, dice, cards, European roulette, Loto) or, for the
// birthday and birth-month lines, the textbook approximation of 365 (or 12) equally likely days
// (months). The math sits next to each line. FR phrases are infinitives (they follow "de"/"d’"),
// EN phrases are gerunds (they follow "as likely as" / "the chance of"); the two need not be
// literal translations of each other, only equally probable.
// Poker = a five-card hand dealt from a full 52-card deck: C(52,5) = 2 598 960 hands.
const HANDS = 2598960;
export interface OddsEvent { p: number; fr: string; en: string }
const EVENTS: OddsEvent[] = [
  { p: 127 / 128, fr: "obtenir au moins un pile en sept lancers de pièce", en: "getting at least one heads in seven coin tosses" }, // 1 − 1/2^7 ≈ 99.2 %
  { p: 63 / 64, fr: "obtenir au moins un face en six lancers de pièce", en: "getting at least one tails in six coin tosses" }, // 1 − 1/2^6 ≈ 98.4 %
  { p: 0.9704, fr: "trouver deux personnes nées le même jour dans un groupe de 50", en: "two people in a group of 50 sharing a birthday" }, // birthday problem, n = 50 → 97.0 %
  { p: 19 / 20, fr: "faire plus de 1 avec un dé à vingt faces", en: "rolling higher than a one on a twenty-sided die" }, // 19/20
  { p: 12 / 13, fr: "tirer une carte qui n’est pas un as dans un jeu de 52", en: "drawing anything but an ace from a 52-card deck" }, // 48/52
  { p: 0.8912, fr: "trouver deux personnes nées le même jour dans un groupe de 40", en: "two people in a group of 40 sharing a birthday" }, // birthday problem, n = 40 → 89.1 %
  { p: 7 / 8, fr: "obtenir au moins un pile en trois lancers de pièce", en: "getting at least one heads in three coin tosses" }, // 1 − 1/2^3
  { p: 6 / 7, fr: "tomber sur un autre jour que le dimanche en choisissant une date au hasard", en: "a date picked at random not falling on a Sunday" }, // 6/7
  { p: 5 / 6, fr: "ne pas faire 6 avec un dé", en: "not rolling a six with one die" }, // 5/6
  { p: 10 / 13, fr: "tirer une carte qui n’est pas une figure dans un jeu de 52", en: "drawing a card that isn’t a jack, queen or king" }, // 40/52
  { p: 3 / 4, fr: "obtenir au moins un pile en deux lancers de pièce", en: "getting at least one heads in two coin tosses" }, // 1 − 1/2^2
  { p: 0.7063, fr: "trouver deux élèves nés le même jour dans une classe de 30", en: "two pupils in a class of 30 sharing a birthday" }, // birthday problem, n = 30 → 70.6 %
  { p: 2 / 3, fr: "faire 3 ou plus avec un dé", en: "rolling a three or higher with one die" }, // 4/6
  { p: 1 - (5 / 6) ** 5, fr: "faire au moins un 6 en cinq lancers de dé", en: "rolling at least one six in five throws of a die" }, // 1 − (5/6)^5 ≈ 59.8 %
  { p: 1 - (5 / 6) ** 4, fr: "faire au moins un 6 en quatre lancers de dé", en: "rolling at least one six in four throws of a die" }, // 1 − (5/6)^4 ≈ 51.8 % (the chevalier de Méré's winning bet, Pascal–Fermat 1654)
  { p: 0.5073, fr: "trouver deux personnes nées le même jour dans un groupe de 23", en: "two people in a group of 23 sharing a birthday" }, // birthday problem, n = 23 → 50.7 %
  { p: 1 / 2, fr: "gagner à pile ou face", en: "calling a coin toss correctly" }, // 1/2
  { p: 1 - (35 / 36) ** 24, fr: "faire au moins un double six en 24 lancers de deux dés", en: "rolling at least one double six in 24 throws of two dice" }, // 1 − (35/36)^24 ≈ 49.1 % (de Méré's losing bet)
  { p: 18 / 37, fr: "gagner en misant sur le rouge à la roulette européenne", en: "winning a bet on red at European roulette" }, // 18/37 ≈ 48.6 %
  { p: 1098240 / HANDS, fr: "recevoir exactement une paire au poker, sur une main de cinq cartes", en: "being dealt exactly one pair in five-card poker" }, // ≈ 42.3 %
  { p: 3 / 8, fr: "obtenir exactement deux piles en trois lancers de pièce", en: "getting exactly two heads in three coin tosses" }, // C(3,2)/2^3
  { p: 1 - 1712304 / HANDS, fr: "recevoir au moins un as dans une main de cinq cartes", en: "being dealt at least one ace in a five-card hand" }, // 1 − C(48,5)/C(52,5) ≈ 34.1 %
  { p: 1 / 3, fr: "faire 5 ou 6 avec un dé", en: "rolling a five or a six with one die" }, // 2/6
  { p: 11 / 36, fr: "faire au moins un 6 en lançant deux dés", en: "rolling at least one six with two dice" }, // 1 − 25/36
  { p: 1 / 4, fr: "tirer un cœur dans un jeu de 52 cartes", en: "drawing a heart from a 52-card deck" }, // 13/52
  { p: 3 / 13, fr: "tirer une figure (valet, dame ou roi) dans un jeu de 52 cartes", en: "drawing a jack, queen or king from a 52-card deck" }, // 12/52
  { p: 2 / 9, fr: "faire 7 ou 11 avec deux dés", en: "rolling a seven or an eleven with two dice" }, // (6 + 2)/36
  { p: 1 / 6, fr: "faire 6 avec un dé", en: "rolling a six with one die" }, // 1/6
  { p: 1 / 7, fr: "tomber sur un dimanche en choisissant une date au hasard", en: "a date picked at random falling on a Sunday" }, // 1/7
  { p: 1 / 8, fr: "obtenir trois piles d’affilée", en: "tossing three heads in a row" }, // 1/2^3
  { p: 1 / 9, fr: "faire exactement 9 avec deux dés", en: "rolling exactly nine with two dice" }, // 4/36
  { p: 1 / 10, fr: "deviner le dernier chiffre d’un numéro de téléphone", en: "guessing the last digit of a phone number" }, // 1/10
  { p: 1 / 12, fr: "deviner le mois de naissance d’un inconnu", en: "guessing a stranger’s birth month" }, // ≈ 1/12 (births are close to uniform across months)
  { p: 1 / 13, fr: "tirer un as dans un jeu de 52 cartes", en: "drawing an ace from a 52-card deck" }, // 4/52
  { p: 1 / 16, fr: "obtenir quatre piles d’affilée", en: "tossing four heads in a row" }, // 1/2^4
  { p: 2 / 37, fr: "gagner un pari à cheval sur deux numéros à la roulette européenne", en: "winning a split bet on two numbers at European roulette" }, // 2/37 ≈ 1 in 18.5
  { p: 123552 / HANDS, fr: "recevoir une double paire au poker, sur une main de cinq cartes", en: "being dealt two pair in five-card poker" }, // ≈ 1 in 21
  { p: 1 / 26, fr: "deviner une lettre de l’alphabet tirée au hasard", en: "guessing a letter of the alphabet picked at random" }, // 1/26
  { p: 1 / 32, fr: "obtenir cinq piles d’affilée", en: "tossing five heads in a row" }, // 1/2^5
  { p: 1 / 36, fr: "faire un double six avec deux dés", en: "rolling a double six" }, // 1/36
  { p: 54912 / HANDS, fr: "recevoir un brelan servi au poker, sur une main de cinq cartes", en: "being dealt three of a kind in five-card poker" }, // ≈ 1 in 47
  { p: 1 / 52, fr: "tirer une carte précise, l’as de pique par exemple, dans un jeu de 52", en: "drawing one named card, say the ace of spades, from a 52-card deck" }, // 1/52
  { p: 1 / 64, fr: "obtenir six piles d’affilée", en: "tossing six heads in a row" }, // 1/2^6
  { p: 1 / 100, fr: "deviner les deux derniers chiffres d’un numéro de téléphone", en: "guessing the last two digits of a phone number" }, // 1/100
  { p: 1 / 128, fr: "obtenir sept piles d’affilée", en: "tossing seven heads in a row" }, // 1/2^7
  { p: 1 / 216, fr: "faire trois 6 avec trois dés", en: "rolling three sixes with three dice" }, // 1/6^3
  { p: 10200 / HANDS, fr: "recevoir une quinte servie au poker, sur une main de cinq cartes", en: "being dealt a straight in five-card poker" }, // ≈ 1 in 255
  { p: 1 / 365, fr: "croiser un inconnu né le même jour que vous", en: "a stranger sharing your birthday" }, // 1/365
  { p: 5108 / HANDS, fr: "recevoir une couleur servie au poker, sur une main de cinq cartes", en: "being dealt a flush in five-card poker" }, // ≈ 1 in 509
  { p: 3744 / HANDS, fr: "recevoir un full servi au poker, sur une main de cinq cartes", en: "being dealt a full house in five-card poker" }, // ≈ 1 in 694
  { p: 1 / 1000, fr: "trouver du premier coup un code à trois chiffres", en: "guessing a three-digit code at the first attempt" }, // 1/10^3
  { p: 1 / 1296, fr: "faire quatre 6 avec quatre dés", en: "rolling four sixes with four dice" }, // 1/6^4
  { p: 1 / 2048, fr: "obtenir onze piles d’affilée", en: "tossing eleven heads in a row" }, // 1/2^11
  { p: 624 / HANDS, fr: "recevoir un carré servi au poker, sur une main de cinq cartes", en: "being dealt four of a kind in five-card poker" }, // 1 in 4 165
  { p: 1 / 7776, fr: "faire cinq 6 avec cinq dés", en: "rolling five sixes with five dice" }, // 1/6^5
  { p: 1 / 10000, fr: "trouver du premier coup un code à quatre chiffres", en: "guessing a four-digit code at the first attempt" }, // 1/10^4
  { p: 1 / 16384, fr: "obtenir quatorze piles d’affilée", en: "tossing fourteen heads in a row" }, // 1/2^14
  { p: 1 / 32768, fr: "obtenir quinze piles d’affilée", en: "tossing fifteen heads in a row" }, // 1/2^15
  { p: 36 / HANDS, fr: "recevoir une quinte flush servie au poker, hors quinte flush royale", en: "being dealt a straight flush, short of a royal, in five-card poker" }, // 1 in 72 193
  { p: 1 / 100000, fr: "trouver du premier coup un code à cinq chiffres", en: "guessing a five-digit code at the first attempt" }, // 1/10^5
  { p: 1 / 262144, fr: "obtenir dix-huit piles d’affilée", en: "tossing eighteen heads in a row" }, // 1/2^18
  { p: 4 / HANDS, fr: "recevoir une quinte flush royale servie au poker", en: "being dealt a royal flush in five-card poker" }, // 1 in 649 740
  { p: 1 / 1e6, fr: "trouver du premier coup un code à six chiffres", en: "guessing a six-digit code at the first attempt" }, // 1/10^6
  { p: 9 / 19068840, fr: "trouver les cinq bons numéros du Loto sur une grille, sans le numéro chance", en: "matching the five main numbers of France’s Loto, but not the bonus ball, with one ticket" }, // 9/(C(49,5) × 10) ≈ 1 in 2.1 million
  { p: 1 / 4194304, fr: "obtenir vingt-deux piles d’affilée", en: "tossing twenty-two heads in a row" }, // 1/2^22
  { p: 1 / 1e7, fr: "trouver du premier coup un code à sept chiffres", en: "guessing a seven-digit code at the first attempt" }, // 1/10^7
  { p: 1 / 19068840, fr: "gagner le jackpot du Loto avec une seule grille", en: "winning the jackpot of France’s Loto with a single ticket" }, // 1/(C(49,5) × 10) = 1 in 19 068 840
];

const logit = (p: number) => Math.log(p / (1 - p));
const EPS = 1e-12;
/** Beyond this distance in log-odds from the nearest end of the list, the match is not "about". */
const TOL = 0.4;

export interface SameOdds extends OddsEvent {
  /** "about": a close match. "below"/"above": p lies beyond the rarest / likeliest event. */
  rel: "about" | "below" | "above";
  /** the event's own odds, ready to print: "1 sur 13" / "1 in 13", or "52 %" / "52%" */
  odds: { fr: string; en: string };
}

/** The event's odds as a reader would say them: a percentage from 20 % up, "1 in N" below. */
function oddsLabel(p: number) {
  if (p >= 0.2) {
    const v = Math.round(p * 100);
    return { fr: `${v} %`, en: `${v}%` };
  }
  const n = Math.round(1 / p);
  if (n >= 1e6) {
    const m = Math.round(n / 1e5) / 10; // millions, one decimal
    return { fr: `1 sur ${String(m).replace(".", ",")} million${m >= 2 ? "s" : ""}`, en: `1 in ${m} million` };
  }
  return { fr: `1 sur ${n.toLocaleString("fr-FR")}`, en: `1 in ${n.toLocaleString("en-GB")}` };
}

/**
 * The familiar event whose probability is closest to p in log-odds, so that 98 % vs 99 % counts
 * as far apart as 1 % vs 2 % (a plain log scale would treat everything above 90 % as identical).
 * The list is dense enough that any p lies within 0.35 log-odds of an entry between 1 % and 99 %
 * (odds off by a factor of 1.4 at worst, usually far less) and within 0.48 down to 1 in 19 million;
 * past either end of the list, rel says so.
 */
export function sameOdds(p: number): SameOdds {
  const lq = logit(Math.min(Math.max(p, EPS), 1 - EPS));
  const best = EVENTS.reduce((b, e) => (Math.abs(logit(e.p) - lq) < Math.abs(logit(b.p) - lq) ? e : b));
  const d = lq - logit(best.p);
  const rel = d < -TOL && best === EVENTS[EVENTS.length - 1] ? "below" : d > TOL && best === EVENTS[0] ? "above" : "about";
  return { ...best, rel, odds: oddsLabel(best.p) };
}

/** French "de" with elision: "de faire…", "d’obtenir…". */
export const deFr = (s: string) => (/^[aeiouyàâéèêîïôûh]/i.test(s) ? `d’${s}` : `de ${s}`);

/**
 * One sentence comparing p with a familiar event:
 * "Autant de chances que de tirer un as dans un jeu de 52 cartes (1 sur 13)."
 * "About as likely as drawing an ace from a 52-card deck (1 in 13)."
 * upperBound: p is only known to be at most this value (e.g. a Monte Carlo count of zero).
 */
export function oddsSentence(p: number, fr: boolean, upperBound = false): string {
  const e = sameOdds(p);
  const rel = upperBound ? "below" : e.rel;
  // skip the parenthesis when it would only repeat the rounded percentage already on screen
  const same = !upperBound && e.p >= 0.2 && Math.round(e.p * 100) === Math.round(p * 100);
  if (fr) {
    const lead = rel === "below" ? "Moins de chances que" : rel === "above" ? "Plus de chances que" : "Autant de chances que";
    return `${lead} ${deFr(e.fr)}${same ? "" : ` (${e.odds.fr})`}.`;
  }
  const lead = rel === "below" ? "Less likely than" : rel === "above" ? "More likely than" : "About as likely as";
  return `${lead} ${e.en}${same ? "" : ` (${e.odds.en})`}.`;
}
