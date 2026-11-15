// What a typical resident pays in and gets back, from INSEE's "redistribution élargie" (Insee Analyses n° 88,
// 19 September 2023, distributed national accounts for 2019): for every 5 % band of standard of living, the taxes
// and social contributions paid (VAT and other taxes on products included), the cash benefits received (pensions
// included), the public services used individually (health, education…) and a share of collective spending.
// A town's median standard of living (INSEE Filosofi) is placed among the national bands (INSEE, distribution of
// standards of living, ERFS) and the band's averages are read off. Euros per consumption unit per year, in 2019
// euros. An estimate for a typical resident, not a measure of the town: people in the same band differ a lot.

export const REDISTRIBUTION_SOURCE = {
  title: "Insee Analyses n° 88 : la redistribution élargie (comptes nationaux distribués 2019)",
  page: "https://www.insee.fr/fr/statistiques/7669723",
  data: "https://www.insee.fr/fr/statistiques/fichier/7669723/IA88.xlsx",
  thresholds: "https://www.insee.fr/fr/statistiques/2416808",
};

// Tableau complémentaire 2, vingtiles V1…V20 (midpoints at the 2.5th…97.5th percentiles), € per UC, 2019
const PAID = [6550, 7820, 8290, 9630, 10760, 12090, 13410, 15140, 16770, 17780, 20700, 20800, 22200, 24400, 26400, 29490, 33010, 37820, 46350, 99560];
const CASH = [6430, 8900, 9610, 9970, 10350, 10600, 10310, 9870, 9760, 10580, 11020, 10990, 11290, 11530, 12020, 12060, 13190, 14220, 15120, 15640];
const IN_KIND = [12970, 12710, 12850, 11380, 10370, 9710, 9230, 8690, 8470, 8350, 8020, 7890, 7760, 7710, 7390, 7260, 7650, 7540, 6360, 6470];
const COLLECTIVE = [4240, 4400, 4290, 4180, 4190, 4150, 4160, 4120, 4130, 4190, 4220, 4220, 4210, 4210, 4190, 4190, 4200, 4150, 4180, 4160];
const NET = [17507, 18554, 18764, 16147, 14367, 12523, 10398, 7596, 5593, 5319, 2452, 2172, 889, -1214, -3137, -6414, -8548, -12669, -21788, -76691];

// Standard of living by percentile, France 2023 (INSEE ERFS, D1…D9 and P95, 2024 euros brought back to 2023 euros
// with the 2024 consumer price rise, 2.0 %), to place a Filosofi 2023 median
const CUTS: [number, number][] = [[10, 13730], [20, 17330], [30, 20610], [40, 23490], [50, 26280], [60, 29230], [70, 32920], [80, 38170], [90, 47900], [95, 60050]].map(([p, v]) => [p, Math.round(v / 1.02)]);

/** Percentile (1–99) of a standard of living in France. */
export function percentileOf(income: number) {
  if (income <= CUTS[0][1]) return Math.max(1, (CUTS[0][0] * income) / CUTS[0][1]);
  for (let i = 1; i < CUTS.length; i++) {
    const [p0, v0] = CUTS[i - 1], [p1, v1] = CUTS[i];
    if (income <= v1) return p0 + ((p1 - p0) * (income - v0)) / (v1 - v0);
  }
  const [p0, v0] = CUTS[CUTS.length - 2], [p1, v1] = CUTS[CUTS.length - 1];
  return Math.min(99, p1 + ((p1 - p0) * (income - v1)) / (v1 - v0));
}

const at = (xs: number[], p: number) => {
  const f = Math.max(0, Math.min(19, (p - 2.5) / 5));
  const i = Math.floor(f), t = f - i;
  return i >= 19 ? xs[19] : xs[i] + (xs[i + 1] - xs[i]) * t;
};

export interface ResidentBalance {
  /** the median standard of living used, € per UC per year */
  income: number;
  percentile: number;
  paid: number;
  cash: number;
  inKind: number;
  collective: number;
  /** received − paid: positive = comes out ahead */
  net: number;
}

/** The average balance of people at this standard of living (€ per UC per year, 2019 euros). */
export function residentBalance(income: number): ResidentBalance {
  const p = percentileOf(income);
  return { income, percentile: p, paid: at(PAID, p), cash: at(CASH, p), inKind: at(IN_KIND, p), collective: at(COLLECTIVE, p), net: at(NET, p) };
}
