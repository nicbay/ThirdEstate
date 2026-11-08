// Household simulator for Jean-Luc Mélenchon's 2027 programme (L'Avenir en commun, melenchon2027.fr).
// Pure functions, no DOM and no imports, so the rules can be tested in Node (`node scripts/test-household.ts`).
//
// Every line of the result names the programme measure it comes from (`measure` = lineage id on
// #/programmes/melenchon, anchor #m-<id>). Every figure that the programme does not give is marked
// `assumption: true` and listed for the reader. Amounts are € per year for the household; positive = the
// household gains, negative = it pays more. Static: no behavioural response, no financing side effects.

export type T = { fr: string; en: string };
// numbers are written with French grouping ("17 690"); English text gets commas ("17,690")
const t = (fr: string, en: string): T => ({ fr, en: en.replace(/(\d) (?=\d{3}(?!\d))/g, "$1,") });

// ---------------------------------------------------------------------------------------------
// Current law, 2026 parameters
// ---------------------------------------------------------------------------------------------

/** Income tax scale 2026 (on 2025 income), per part. Loi de finances pour 2026 (promulgated 19 Feb 2026), +0.9 %.
 *  Source: service-public.gouv.fr, actualité A18045 « Impôt sur le revenu 2026 : le barème ». */
export const IR_2026: [number, number][] = [[0, 0], [11600, 0.11], [29579, 0.30], [84577, 0.41], [181917, 0.45]];
/** Quotient familial cap per extra half-part (2026), and the cap for the first child of a single parent (case T).
 *  Source: LF 2026, art. 197 CGI as indexed (+0.9 %); moneyvox / legifiscal summaries of the 2026 scale. */
export const QF_CAP = 1807;
export const QF_CAP_PARENT_ISOLE = 4262;
/** Décote 2026: 897 € (single) / 1 483 € (couple), minus 45.25 % of gross tax. Art. 197 I 4 CGI, 2026 indexation. */
export const DECOTE = { single: 897, couple: 1483, rate: 0.4525 };
/** 10 % standard deduction on wages (2025 income): min 509 €, max 14 555 € per person. Art. 83 3° CGI. */
export const WAGE_DEDUCTION = { rate: 0.1, min: 509, max: 14555 };
/** 10 % deduction on pensions, capped per tax household (2025 income, 2024 cap 4 399 € indexed +0.9 %). Art. 158 5 a CGI. */
export const PENSION_DEDUCTION = { rate: 0.1, min: 454, max: 4439 };
/** Flat tax (PFU) since 1 Jan 2026: 12.8 % income tax + 18.6 % social levies = 31.4 % (LFSS 2026 raised CSG on
 *  capital income from 9.2 % to 10.6 %). 6.8 points of CSG are deductible when income is taxed at the scale. */
export const PFU = { ir: 0.128, ps: 0.186, csgDeductible: 0.068 };
/** SMIC since 1 June 2026: 12.31 €/h gross, 1 867.02 € gross a month (35 h), ≈ 1 477.93 € net (info.gouv.fr, May 2026). */
export const SMIC_NET_2026 = 1477.93;
/** Poverty line (60 % of median), 2024, per consumption unit: 1 337 € a month. Insee Première n° 2117 (July 2026). */
export const POVERTY_LINE = 1337;
/** Rent reference index, Q2 2026: +1.15 % over a year (Insee, Informations rapides n° 167, 10 July 2026). */
export const IRL_2026 = 0.0115;
/** IFI (current wealth tax on real estate) and ISF 2017 scale: same brackets. Art. 977 CGI; ISF 2017 scale. */
export const WEALTH_SCALE: [number, number][] = [[0, 0], [800000, 0.005], [1300000, 0.007], [2570000, 0.01], [5000000, 0.0125], [10000000, 0.015]];
export const WEALTH_THRESHOLD = 1300000;
/** Inheritance tax, direct line (art. 777 CGI): 100 000 € allowance per child then the scale. */
export const INHERIT_ALLOWANCE = 100000;
export const INHERIT_SCALE: [number, number][] = [[0, 0.05], [8072, 0.1], [12109, 0.15], [15932, 0.2], [552324, 0.3], [902838, 0.4], [1805677, 0.45]];

// ---------------------------------------------------------------------------------------------
// Programme parameters (with the source of each number)
// ---------------------------------------------------------------------------------------------

/** 14-bracket scale. The programme (L846994) gives no rates. Most precise public LFI text: amendment I-CF748 to the
 *  2025 finance bill (LFI-NFP group, 13 Oct 2024, rejected), « comme le fait le programme commun ». Applied as published
 *  (thresholds not re-indexed). The amendment only rewrites art. 197 I 1, so décote and QF caps stay. */
export const IR_LFI_14: [number, number][] = [
  [0, 0], [10434, 0.05], [15639, 0.10], [20856, 0.15], [28152, 0.20], [32290, 0.25], [35415, 0.275], [38836, 0.325],
  [44849, 0.40], [62579, 0.45], [104291, 0.50], [146015, 0.55], [261173, 0.65], [400000, 0.70],
];
export const IR_LFI_SOURCE = "https://www.assemblee-nationale.fr/dyn/17/amendements/0324A/CION_FIN/CF748.pdf";
/** SMIC at 1 700 € net a month (Lc140d0). */
export const SMIC_NET_LFI = 1700;
/** Civil servants: point d'indice +10 % (Lcc5726). Share of net pay that is index-based (the rest is bonuses):
 *  assumption 80 % (DGAFP: bonuses are roughly a fifth of pay on average, much more in some corps). */
export const POINT_INDICE_RISE = 0.10;
export const INDEX_SHARE = 0.8;
/** Wealth tax: amendment n° 1069 (M. Tavel, LFI-NFP) to the 2027 finance bill, rejected 16 Oct 2026, restores the
 *  ISF on the 2017 scale plus a climate component indexed on the assets' emissions. Its own example: 2.25 M€ of
 *  wealth → 9 150 € ISF + 8 474 € climate. We apply that ratio (0.926) to everyone: an assumption, since the
 *  climate part depends on what the wealth is invested in. */
export const CLIMATE_RATIO = 8474 / 9150;
/** Zucman tax (L165b15): at least 2 % a year on wealth above 100 M€, minus income and wealth taxes already paid. */
export const ZUCMAN = { threshold: 100e6, rate: 0.02 };
/** Inheritance (L9dd3b8, L5e0934): no duty under 150 000 €; « héritage maximal » of 12 M€ (excess taken). */
export const INHERIT_LFI = { exempt: 150000, cap: 12e6 };
/** Housing benefit +10 % (Le46f33). */
export const APL_RISE = 0.10;
/** Free school (L1875be): canteen, transport, supplies. Assumptions, no national price exists: 140 meals × 3.50 €
 *  (families pay 0.5–5 € depending on town and income) and 150 € (primary) / 300 € (secondary) of supplies,
 *  textbooks and transport. */
export const SCHOOL = { meals: 140, mealPrice: 3.5, kit3_10: 150, kit11_17: 300 };
/** Free higher education (Lb9633f) and no CVEC (L2f1555): 2025-26 licence fee 178 € + CVEC 105 €. */
export const UNI_FEES = 178 + 105;
/** Free first tranche of electricity (L0bd9c8): the programme gives no volume. Assumption: 1 000 kWh a year at
 *  ≈ 0.19 €/kWh (regulated blue tariff, base option, order of magnitude 2026). */
export const ENERGY = { kwh: 1000, price: 0.19 };
/** 100 % Sécu (L171b77): complementary health premiums disappear. Default premiums when the user gives none
 *  (assumptions, € a month): employee share of a company contract 30, civil servant 45, individual contract 60,
 *  retiree 110, child 20 (DREES orders of magnitude). */
export const MUTUELLE_DEFAULT = { private: 30, public: 45, other: 60, retired: 110, child: 20 };

// ---------------------------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------------------------

export type Status = "single" | "married" | "cohab";
export type Job = "private" | "public" | "self" | "retired" | "unemployed" | "student" | "inactive";
export interface Adult { job: Job; /** € net a month: wage, self-employed income, pension or jobless benefit */ net: number; /** retired with a full career */ fullCareer?: boolean }
export interface Kids { u3: number; k3_10: number; k11_17: number; s18_24: number }
export interface Household {
  status: Status;
  adults: Adult[];
  kids: Kids;
  housing: "tenant" | "owner" | "other";
  /** € a month */ rent: number;
  /** € a month of housing benefit */ apl: number;
  /** € a month of other means-tested benefits (RSA, prime d'activité, ASPA, AAH…) */ benefits: number;
  /** € a year of PFU-eligible capital income (dividends, interest, capital gains) */ capital: number;
  /** € of net taxable wealth (after the 30 % main-home allowance) */ wealth: number;
  /** of which real estate (IFI base today) */ realEstate: number;
  /** € expected inheritance per heir, direct line (one-off) */ inheritance: number;
  /** € a month of complementary health premiums paid by the household; null = default estimate */ mutuelle: number | null;
  canteen: boolean;
}

export interface Line {
  id: string;
  /** lineage id of the programme measure */
  measure: string;
  label: T;
  amount: number;
  /** what the line is about, for grouping and for the distribution marker */
  kind: "income" | "tax" | "service";
  note: T;
  assumption?: boolean;
}
export interface Result {
  lines: Line[];
  oneOff: Line[];
  total: number;
  /** tax increases only (≥ 0 = more tax), for the distribution marker */
  taxRise: number;
  uc: number;
  /** disposable income today, € a year (approximation) */
  disposable: number;
  /** standard of living today, € a year per consumption unit */
  nivVie: number;
  irToday: number;
  irReform: number;
  assumptions: T[];
}

// ---------------------------------------------------------------------------------------------
// Tax engine
// ---------------------------------------------------------------------------------------------

/** Progressive scale applied to `x` (per part). */
export function scale(x: number, brackets: [number, number][]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (x > lo) tax += (Math.min(x, hi) - lo) * rate;
  }
  return tax;
}

/** Number of parts for one tax household. */
export function parts(couple: boolean, nKids: number, isolated: boolean): number {
  let p = couple ? 2 : 1;
  p += Math.min(nKids, 2) * 0.5 + Math.max(0, nKids - 2);
  if (isolated && nKids > 0) p += 0.5;
  return p;
}

/** Income tax of one tax household: quotient familial with its cap, then the décote. */
export function incomeTax(taxable: number, opts: { couple: boolean; nKids: number; isolated: boolean; brackets: [number, number][] }): number {
  const { couple, nKids, isolated, brackets } = opts;
  if (taxable <= 0) return 0;
  const p = parts(couple, nKids, isolated);
  const base = couple ? 2 : 1;
  const full = p * scale(taxable / p, brackets);
  let tax = full;
  if (p > base) {
    const without = base * scale(taxable / base, brackets);
    const halves = (p - base) * 2;
    const cap = isolated && nKids > 0 ? QF_CAP_PARENT_ISOLE + QF_CAP * Math.max(0, halves - 2) : QF_CAP * halves;
    tax = Math.max(full, without - cap);
  }
  const d = couple ? DECOTE.couple : DECOTE.single;
  if (tax < d / DECOTE.rate) tax = Math.max(0, tax - (d - DECOTE.rate * tax));
  return Math.round(tax);
}

/** Net monthly income → net taxable income for the year (approximations of the non-deductible CSG/CRDS and the 10 % deductions). */
export function taxableOf(a: Adult, netMonthly = a.net): number {
  const y = netMonthly * 12;
  switch (a.job) {
    case "private": { const g = y * 1.037; return g - clamp(g * WAGE_DEDUCTION.rate, WAGE_DEDUCTION.min, WAGE_DEDUCTION.max); }
    case "public": { const g = y * 1.035; return g - clamp(g * WAGE_DEDUCTION.rate, WAGE_DEDUCTION.min, WAGE_DEDUCTION.max); }
    case "unemployed": { const g = y * 1.03; return g - clamp(g * WAGE_DEDUCTION.rate, WAGE_DEDUCTION.min, WAGE_DEDUCTION.max); }
    case "retired": { const g = y * 1.03; return g - clamp(g * PENSION_DEDUCTION.rate, PENSION_DEDUCTION.min, PENSION_DEDUCTION.max); }
    case "self": return y;
    case "student": return 0; // students' wages are exempt up to 3 SMIC a year (art. 81 36° CGI); treated as exempt
    default: return y;
  }
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const nKidsTax = (k: Kids) => k.u3 + k.k3_10 + k.k11_17 + k.s18_24;

/** Income tax of the whole household for given monthly incomes, with joint (married) or individual filing. */
export function householdIR(h: Household, nets: number[], brackets: [number, number][], individual: boolean, capitalAtScale: number): number {
  const taxables = h.adults.map((a, i) => Math.max(0, taxableOf(a, nets[i])));
  const nk = nKidsTax(h.kids);
  const capShare = capitalAtScale * (1 - PFU.csgDeductible);
  if (h.adults.length === 1) {
    return incomeTax(taxables[0] + capShare, { couple: false, nKids: nk, isolated: h.status === "single" || h.adults.length === 1, brackets });
  }
  if (h.status === "married" && !individual) {
    return incomeTax(taxables[0] + taxables[1] + capShare, { couple: true, nKids: nk, isolated: false, brackets });
  }
  // separate filings: children attached to the higher earner (assumption), capital income split in half
  const hi = taxables[0] >= taxables[1] ? 0 : 1;
  return taxables.reduce((s, x, i) => s + incomeTax(x + capShare / 2, { couple: false, nKids: i === hi ? nk : 0, isolated: false, brackets }), 0);
}

export function wealthTax(w: number): number {
  if (w < WEALTH_THRESHOLD) return 0;
  let tax = scale(w, WEALTH_SCALE);
  if (w < 1400000) tax -= 17500 - 0.0125 * w; // décote between 1.3 and 1.4 M€ (art. 977 CGI)
  return Math.max(0, Math.round(tax));
}

export function inheritanceTax(amount: number): number {
  return Math.round(scale(Math.max(0, amount - INHERIT_ALLOWANCE), INHERIT_SCALE));
}
export function inheritanceTaxLFI(amount: number): number {
  if (amount <= INHERIT_LFI.exempt) return 0;
  if (amount <= INHERIT_LFI.cap) return inheritanceTax(amount);
  return inheritanceTax(INHERIT_LFI.cap) + (amount - INHERIT_LFI.cap);
}

/** Consumption units (Insee/OECD scale): 1 for the first adult, 0.5 for each other person aged 14+, 0.3 under 14.
 *  11–17 band counted at 0.5 (most of it is 14+). */
export function consumptionUnits(h: Household): number {
  return 1 + 0.5 * (h.adults.length - 1) + 0.3 * (h.kids.u3 + h.kids.k3_10) + 0.5 * (h.kids.k11_17 + h.kids.s18_24);
}

// ---------------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------------

export function simulate(h: Household): Result {
  const lines: Line[] = [];
  const oneOff: Line[] = [];
  const assumptions: T[] = [
    t("Effets statiques : pas de changement de comportement, d’emploi, de prix ni de salaires au-delà de ceux que la mesure fixe.", "Static effects: no change in behaviour, jobs, prices or wages beyond what the measure sets."),
    t("Le financement des mesures (cotisations, impôts non détaillés) n’est compté que lorsque le programme ou un texte de LFI en donne le barème.", "How the measures are paid for (contributions, unspecified taxes) is counted only where the programme or an LFI text gives the rates."),
    t("Revenu imposable estimé à partir du net mensuel (CSG/CRDS non déductibles et abattement de 10 % approchés).", "Taxable income estimated from net monthly pay (non-deductible CSG/CRDS and the 10% deduction approximated)."),
  ];
  const baseNets = h.adults.map((a) => a.net);
  const nets = [...baseNets];
  const salaried = (a: Adult) => a.job === "private" || a.job === "public";

  // --- income measures ---
  let pi = 0, smic = 0, pens = 0;
  h.adults.forEach((a, i) => {
    if (a.job === "public" && a.net > 0) {
      const after = a.net * (1 + POINT_INDICE_RISE * INDEX_SHARE);
      pi += (after - a.net) * 12;
      nets[i] = after;
    }
    if (salaried(a) && a.net > 0 && nets[i] < SMIC_NET_LFI) {
      smic += (SMIC_NET_LFI - nets[i]) * 12;
      nets[i] = SMIC_NET_LFI;
    }
    if (a.job === "retired" && a.fullCareer && a.net < SMIC_NET_LFI) {
      pens += (SMIC_NET_LFI - a.net) * 12;
      nets[i] = SMIC_NET_LFI;
    }
  });
  if (pi) {
    lines.push({ id: "indice", measure: "Lcc5726", kind: "income", amount: pi, assumption: true,
      label: t("Point d’indice des fonctionnaires +10 %", "Civil-service pay index +10%"),
      note: t(`+10 % sur la part indiciaire du traitement, supposée égale à ${Math.round(INDEX_SHARE * 100)} % du net (le reste en primes).`, `+10% on the index-based part of pay, assumed to be ${Math.round(INDEX_SHARE * 100)}% of net pay (the rest is bonuses).`) });
    assumptions.push(t("Fonctionnaires : 80 % du salaire net est indiciaire, 20 % en primes non revalorisées.", "Civil servants: 80% of net pay is index-based, 20% bonuses that do not rise."));
  }
  if (smic) {
    lines.push({ id: "smic", measure: "Lc140d0", kind: "income", amount: smic,
      label: t("SMIC à 1 700 € net", "Minimum wage at €1,700 net"),
      note: t(`Salaire porté à 1 700 € net par mois (SMIC actuel ≈ ${fmt(SMIC_NET_2026)} € net depuis le 1er juin 2026), à temps plein.`, `Pay raised to €1,700 net a month (minimum wage today ≈ €${fmt(SMIC_NET_2026)} net since 1 June 2026), full-time.`) });
    assumptions.push(t("Salaire à temps plein ; pas d’effet de diffusion sur les salaires au-dessus de 1 700 € net.", "Full-time pay; no ripple effect on wages above €1,700 net."));
  }
  if (pens) {
    lines.push({ id: "pension", measure: "L2bddf3", kind: "income", amount: pens, assumption: true,
      label: t("Pension minimale au niveau du SMIC (carrière complète)", "Minimum pension at the minimum wage (full career)"),
      note: t("Pension nette portée à 1 700 € par mois ; le programme dit « au niveau du SMIC revalorisé », lu ici en net.", "Net pension raised to €1,700 a month; the programme says ‘at the level of the raised minimum wage’, read here as net.") });
  }

  // --- income tax (sequential decomposition) ---
  const cap = Math.max(0, h.capital);
  const pfuIR = cap * PFU.ir;
  const B0 = householdIR(h, baseNets, IR_2026, false, 0) + pfuIR;
  const S1 = householdIR(h, nets, IR_2026, false, 0) + pfuIR;
  const S2 = householdIR(h, nets, IR_LFI_14, false, 0) + pfuIR;
  const S3 = householdIR(h, nets, IR_LFI_14, true, 0) + pfuIR;
  const S4 = householdIR(h, nets, IR_LFI_14, true, cap);
  if (Math.round(S1 - B0)) lines.push({ id: "ir-rise", measure: smic ? "Lc140d0" : pens ? "L2bddf3" : "Lcc5726", kind: "tax", amount: -(S1 - B0),
    label: t("Impôt sur le revenu dû sur ces hausses (barème actuel)", "Income tax due on these rises (current scale)"),
    note: t("Les hausses de salaire ou de pension ci-dessus entrent dans le revenu imposable.", "The pay or pension rises above are part of taxable income.") });
  lines.push({ id: "ir14", measure: "L846994", kind: "tax", amount: -(S2 - S1), assumption: true,
    label: t("Impôt sur le revenu à 14 tranches", "Income tax with 14 brackets"),
    note: t("Barème de l’amendement LFI-NFP I-CF748 (PLF 2025) : 0 % jusqu’à 10 434 €, puis 5 % à 70 % au-delà de 400 000 € par part. Le programme ne donne pas les taux.", "Scale of LFI-NFP amendment I-CF748 (2025 budget): 0% up to €10,434, then 5% to 70% above €400,000 per part. The programme gives no rates.") });
  assumptions.push(t("Barème à 14 tranches : celui de l’amendement LFI-NFP I-CF748 au budget 2025 (rejeté), non réindexé ; décote et plafond du quotient familial inchangés.", "14-bracket scale: the one in LFI-NFP amendment I-CF748 to the 2025 budget (rejected), not re-indexed; décote and family-quotient cap unchanged."));
  if (h.status === "married" && h.adults.length === 2) {
    lines.push({ id: "conjugal", measure: "Le4b9b7", kind: "tax", amount: -(S3 - S2), assumption: true,
      label: t("Fin du quotient conjugal (imposition séparée)", "End of joint filing for married couples"),
      note: t("Chaque conjoint est imposé sur ses propres revenus ; les enfants sont rattachés au conjoint au revenu le plus élevé (le programme ne dit pas comment).", "Each spouse is taxed on their own income; children are attached to the higher earner (the programme does not say how).") });
    assumptions.push(t("Fin du quotient conjugal : enfants rattachés au conjoint qui gagne le plus, revenus du capital partagés à parts égales.", "End of joint filing: children attached to the higher-earning spouse, capital income split equally."));
  }
  if (cap > 0) {
    lines.push({ id: "flat", measure: "L0781ec", kind: "tax", amount: -(S4 - S3),
      label: t("Fin de la flat tax : revenus du capital au barème", "End of the flat tax: capital income at the scale"),
      note: t(`Aujourd’hui 31,4 % (12,8 % d’impôt + 18,6 % de prélèvements sociaux). Demain : barème à 14 tranches + 18,6 %, dont 6,8 points de CSG déductibles.`, `Today 31.4% (12.8% income tax + 18.6% social levies). Then: 14-bracket scale + 18.6%, of which 6.8 points of CSG are deductible.`) });
  }

  // --- wealth ---
  const W = Math.max(0, h.wealth);
  const RE = Math.min(W, Math.max(0, h.realEstate));
  const ifi = wealthTax(RE);
  const isf = wealthTax(W);
  const climate = Math.round(isf * CLIMATE_RATIO);
  if (isf || ifi) {
    lines.push({ id: "isf", measure: "L38b88f", kind: "tax", amount: -(isf + climate - ifi), assumption: true,
      label: t("ISF rétabli, avec volet climatique (remplace l’IFI)", "Wealth tax restored with a climate component (replaces IFI)"),
      note: t(`ISF sur le barème 2017 : ${fmt(isf)} € ; volet climatique ${fmt(climate)} € (ratio de l’exemple de l’amendement n° 1069 au PLF 2027) ; IFI actuel supprimé : ${fmt(ifi)} €.`, `ISF on the 2017 scale: €${fmt(isf)}; climate component €${fmt(climate)} (ratio from the example in amendment no. 1069 to the 2027 budget); today's IFI removed: €${fmt(ifi)}.`) });
    assumptions.push(t("ISF : barème 2017 sans plafonnement ; volet climatique égal à 93 % de l’ISF, comme dans l’exemple chiffré de l’amendement LFI (il dépend en réalité des placements).", "Wealth tax: 2017 scale with no cap; climate component equal to 93% of the ISF, as in the worked example of the LFI amendment (in reality it depends on the investments)."));
  }
  if (W > ZUCMAN.threshold) {
    const paid = S4 + isf + climate;
    const z = Math.max(0, ZUCMAN.rate * W - paid);
    lines.push({ id: "zucman", measure: "L165b15", kind: "tax", amount: -z,
      label: t("Taxe Zucman : 2 % minimum au-delà de 100 M€", "Zucman tax: 2% minimum above €100m"),
      note: t(`2 % du patrimoine (${fmt(ZUCMAN.rate * W)} €) moins l’impôt sur le revenu et l’ISF déjà payés (${fmt(paid)} €).`, `2% of wealth (€${fmt(ZUCMAN.rate * W)}) minus income tax and wealth tax already paid (€${fmt(paid)}).`) });
  }

  // --- garantie d'autonomie: resources topped up to the poverty line ---
  const uc = consumptionUnits(h);
  const resources = nets.reduce((s, x) => s + x, 0) * 12 + (h.benefits + h.apl) * 12 + cap * (1 - PFU.ir - PFU.ps);
  const ga = Math.max(0, POVERTY_LINE * uc * 12 - resources);
  if (ga > 0) {
    lines.push({ id: "autonomie", measure: "L2b42fa", kind: "income", amount: ga, assumption: true,
      label: t("Garantie d’autonomie (seuil de pauvreté)", "Autonomy guarantee (poverty line)"),
      note: t(`Ressources du foyer complétées jusqu’à 1 337 € par mois et par unité de consommation (${dfr(uc)} UC). Les aides déclarées sont comptées dans les ressources.`, `Household resources topped up to €1,337 a month per consumption unit (${fmtDec(uc)} units). The benefits you entered count as resources.`) });
    assumptions.push(t("Garantie d’autonomie : complément différentiel au niveau du foyer, échelle de l’Insee ; les aides actuelles déclarées sont comptées comme ressources.", "Autonomy guarantee: a top-up at household level on the Insee scale; the current benefits you entered count as resources."));
  }

  // --- services and prices ---
  const school = (h.kids.k3_10 + h.kids.k11_17) * (h.canteen ? SCHOOL.meals * SCHOOL.mealPrice : 0) + h.kids.k3_10 * SCHOOL.kit3_10 + h.kids.k11_17 * SCHOOL.kit11_17;
  if (school > 0) {
    lines.push({ id: "school", measure: "L1875be", kind: "service", amount: school, assumption: true,
      label: t("École gratuite : cantine, fournitures, transport", "Free school: meals, supplies, transport"),
      note: t(`Hypothèses : ${SCHOOL.meals} repas à ${dfr(SCHOOL.mealPrice, 2)} € ; ${SCHOOL.kit3_10} € (3–10 ans) ou ${SCHOOL.kit11_17} € (11–17 ans) de fournitures, manuels et transport par an. L’allocation de rentrée scolaire, si vous la touchez, couvre déjà une partie.`, `Assumptions: ${SCHOOL.meals} meals at €${fmtDec(SCHOOL.mealPrice, 2)}; €${SCHOOL.kit3_10} (3–10) or €${SCHOOL.kit11_17} (11–17) of supplies, textbooks and transport a year. The back-to-school allowance, if you get it, already covers part of this.`) });
  }
  if (h.kids.s18_24 > 0) {
    lines.push({ id: "uni", measure: "Lb9633f", kind: "service", amount: h.kids.s18_24 * UNI_FEES,
      label: t("Études supérieures gratuites, fin de la CVEC", "Free higher education, no student levy"),
      note: t("Droits d’inscription en licence (178 €) et CVEC (105 €), tarifs 2025-2026 ; les boursiers en sont déjà exonérés.", "Bachelor's fees (€178) and the CVEC levy (€105), 2025-26 rates; grant holders are already exempt.") });
  }
  if (h.housing === "tenant" && h.rent > 0) {
    lines.push({ id: "rent", measure: "Lb24fc7", kind: "service", amount: h.rent * 12 * IRL_2026, assumption: true,
      label: t("Gel des loyers", "Rent freeze"),
      note: t("Hausse annuelle évitée, au rythme de l’indice de référence des loyers (+1,15 % au 2e trimestre 2026). Économie d’une année ; elle se cumule les années suivantes.", "Annual rise avoided, at the rent reference index (+1.15% in Q2 2026). One year's saving; it adds up in later years.") });
  }
  if (h.apl > 0) {
    lines.push({ id: "apl", measure: "Le46f33", kind: "income", amount: h.apl * 12 * APL_RISE,
      label: t("Aides au logement (APL) +10 %", "Housing benefit (APL) +10%"),
      note: t("Revalorisation de 10 % de l’aide déclarée.", "A 10% rise of the benefit you entered.") });
  }
  lines.push({ id: "energy", measure: "L0bd9c8", kind: "service", amount: ENERGY.kwh * ENERGY.price, assumption: true,
    label: t("Première tranche d’énergie gratuite", "Free first tranche of energy"),
    note: t(`Le programme ne fixe pas le volume. Hypothèse : ${fmt(ENERGY.kwh)} kWh d’électricité par foyer à ≈ ${dfr(ENERGY.price, 2)} €/kWh. Le prix des tranches suivantes n’est pas connu.`, `The programme sets no volume. Assumption: ${fmt(ENERGY.kwh)} kWh of electricity per household at ≈ €${fmtDec(ENERGY.price, 2)}/kWh. The price of the following tranches is unknown.`) });
  const mutDefault = h.adults.reduce((s, a) => s + (a.job === "private" ? MUTUELLE_DEFAULT.private : a.job === "public" ? MUTUELLE_DEFAULT.public : a.job === "retired" ? MUTUELLE_DEFAULT.retired : MUTUELLE_DEFAULT.other), 0)
    + MUTUELLE_DEFAULT.child * nKidsTax(h.kids);
  const mut = h.mutuelle ?? mutDefault;
  if (mut > 0) {
    lines.push({ id: "secu", measure: "L171b77", kind: "service", amount: mut * 12, assumption: h.mutuelle == null,
      label: t("« 100 % Sécu » : plus de mutuelle à payer", "‘100% Sécu’: no complementary health premium"),
      note: h.mutuelle == null
        ? t(`Cotisation estimée à ${fmt(mutDefault)} € par mois pour le foyer (ordre de grandeur, part à votre charge). Le financement par cotisations n’est pas chiffré par le programme.`, `Premium estimated at €${fmt(mutDefault)} a month for the household (order of magnitude, your share). The programme does not cost the contributions that would replace it.`)
        : t("Votre cotisation déclarée disparaît. Le financement par cotisations n’est pas chiffré par le programme.", "The premium you entered disappears. The programme does not cost the contributions that would replace it.") });
  }

  // --- inheritance (one-off) ---
  if (h.inheritance > 0) {
    const now = inheritanceTax(h.inheritance), then = inheritanceTaxLFI(h.inheritance);
    oneOff.push({ id: "inherit", measure: h.inheritance > INHERIT_LFI.cap ? "L5e0934" : "L9dd3b8", kind: "tax", amount: now - then, assumption: h.inheritance > INHERIT_LFI.exempt && h.inheritance <= INHERIT_LFI.cap,
      label: t("Droits de succession (une fois)", "Inheritance tax (one-off)"),
      note: t(`Aujourd’hui ${fmt(now)} € en ligne directe ; avec le programme ${fmt(then)} € : exonération sous 150 000 €, héritage maximal de 12 M€. Entre les deux, le programme annonce une hausse sur « les plus hauts patrimoines » sans barème : droits actuels conservés ici.`, `Today €${fmt(now)} in direct line; under the programme €${fmt(then)}: no duty under €150,000, maximum inheritance €12m. In between, the programme announces a rise on ‘the largest estates’ with no scale: current duties kept here.`) });
  }

  for (const l of lines) l.amount = Math.round(l.amount);
  for (const l of oneOff) l.amount = Math.round(l.amount);
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].amount === 0) lines.splice(i, 1);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const taxRise = -lines.filter((l) => l.kind === "tax").reduce((s, l) => s + l.amount, 0);
  const disposable = baseNets.reduce((s, x) => s + x, 0) * 12 + (h.benefits + h.apl) * 12 + cap * (1 - PFU.ir - PFU.ps) - householdIR(h, baseNets, IR_2026, false, 0) - ifi;
  return { lines, oneOff, total, taxRise, uc, disposable, nivVie: disposable / uc, irToday: Math.round(B0), irReform: Math.round(S4), assumptions };
}

/** Grouped thousands with a plain space (the view re-formats with the reader's locale). */
function fmt(n: number) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function fmtDec(n: number, d = 1) { return n.toFixed(d); }
function dfr(n: number, d = 1) { return n.toFixed(d).replace(".", ","); }

/** Defaults for the form. */
export const DEFAULT_HOUSEHOLD: Household = {
  status: "single", adults: [{ job: "private", net: 1478 }], kids: { u3: 0, k3_10: 0, k11_17: 0, s18_24: 0 },
  housing: "tenant", rent: 650, apl: 0, benefits: 0, capital: 0, wealth: 0, realEstate: 0, inheritance: 0, mutuelle: null, canteen: true,
};
