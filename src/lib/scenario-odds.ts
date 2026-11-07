// How likely is a scenario (these two finalists, this winner) according to today's polls?
// Monte Carlo: each candidate's first-round share = poll average + a random polling error
// (normal, σ = ROUND1_SD points, the typical miss six months before a French presidential vote);
// the top two go to the runoff, whose margin = the runoff polls for that pair when they exist,
// otherwise the default vote-transfer model, plus a random error (σ = ROUND2_SD).
// Indicative only: errors are treated as independent between candidates.

export const ROUND1_SD = 3.5;
export const ROUND2_SD = 5;
const RUNS = 20000;

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

// ---------- same odds, everyday life ----------
// Every probability below is exact arithmetic (dice, coins, cards, galettes, roulette), so the
// comparison is honest even when the phrasing is not.
const EVENTS: { p: number; fr: string; en: string }[] = [
  { p: 0.97, fr: "que votre tartine ne vous trahisse pas : ne pas faire « 1 » avec un dé à 30 faces", en: "not rolling a 1 on a 30-sided die" },
  { p: 0.875, fr: "ne PAS avoir la fève quand la galette est coupée en 8", en: "NOT getting the bean when the galette is cut into 8" },
  { p: 0.75, fr: "qu’au moins une de deux pièces tombe sur pile", en: "at least one of two coins landing heads" },
  { p: 2 / 3, fr: "ne faire ni 1 ni 2 au dé pendant le Monopoly de Noël", en: "rolling neither a 1 nor a 2 during the Christmas Monopoly" },
  { p: 0.5, fr: "gagner le pile ou face contre votre beau-frère pour savoir qui fait la vaisselle", en: "winning the coin toss against your brother-in-law over who does the dishes" },
  { p: 1 / 3, fr: "trouver la bille sous le bon gobelet au premier essai (bonneteau honnête, si si)", en: "finding the ball under the right cup first time (an honest shell game, yes really)" },
  { p: 0.25, fr: "tirer un cœur du premier coup dans un jeu de 52 cartes", en: "drawing a heart first time from a 52-card deck" },
  { p: 1 / 6, fr: "faire un 6 du premier coup pour sortir un petit cheval", en: "rolling a 6 first time to get your piece out at ludo" },
  { p: 0.125, fr: "avoir la fève quand la galette est coupée en 8", en: "getting the bean when the galette is cut into 8" },
  { p: 1 / 12, fr: "avoir la fève dans une galette XXL coupée en 12 pour tout le bureau", en: "getting the bean in an XXL galette cut into 12 for the whole office" },
  { p: 1 / 16, fr: "faire pile 4 fois de suite (et crier à la triche)", en: "flipping heads 4 times in a row (and crying foul)" },
  { p: 1 / 26, fr: "deviner du premier coup la lettre qu’a choisie votre neveu", en: "guessing first time which letter of the alphabet your nephew picked" },
  { p: 1 / 37, fr: "voir la bille s’arrêter sur le zéro à la roulette du casino", en: "the ball landing on zero at the casino roulette" },
  { p: 1 / 52, fr: "tirer l’as de pique du premier coup, comme dans les films", en: "drawing the ace of spades first time, like in the movies" },
  { p: 1 / 64, fr: "faire pile 6 fois de suite", en: "flipping heads 6 times in a row" },
  { p: 1 / 100, fr: "tomber pile sur le bon numéro de casier sur 100 en se trompant de couloir", en: "picking the right locker out of 100 at random" },
  { p: 1 / 216, fr: "faire un triple 6 avec trois dés", en: "rolling three sixes with three dice" },
  { p: 1 / 365, fr: "que le premier inconnu croisé dans le métro soit né le même jour que vous", en: "the first stranger you meet on the metro sharing your birthday" },
  { p: 1 / 1024, fr: "faire pile 10 fois de suite", en: "flipping heads 10 times in a row" },
  { p: 1 / 1296, fr: "faire quatre 6 avec quatre dés au 421", en: "rolling four sixes with four dice" },
  { p: 1 / 32768, fr: "faire pile 15 fois de suite (filmez-le)", en: "flipping heads 15 times in a row (film it)" },
  { p: 1 / 19068840, fr: "gagner le jackpot du Loto avec une seule grille", en: "winning the French Loto jackpot with a single ticket" },
];
/** The everyday event whose probability is closest to p, on a log scale. */
export function sameOdds(p: number) {
  const lp = Math.log(Math.max(p, 1e-9));
  return EVENTS.reduce((best, e) => (Math.abs(Math.log(e.p) - lp) < Math.abs(Math.log(best.p) - lp) ? e : best));
}
