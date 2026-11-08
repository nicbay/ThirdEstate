// Estimated gross public remuneration from a candidate's mandates, year by year.
// Method (shown on the candidate page and documented in docs/data-candidates.md):
// each mandate contributes, day by day, the official gross monthly amount for its office on that date
// (pay-scales.json), pro rata; local indemnities use the legal maximum rate for the population tier;
// cumulated local indemnities are capped (écrêtement); periods the scales do not cover are flagged, not guessed.

export interface Tier { maxPop: number | null; minPop?: number; rate: number }
export interface PayScales {
  verified: string;
  pointIndice: { changes: { from: string; annual: number }[] };
  parliament: { avgIndice: { from: string; value: number }[] };
  mep: { euSalaryFrom: string; values: { from: string; monthly: number }[] };
  government: { coefficients: { from: string; pm: number; ministre: number; delegue: number; secretaire: number }[] };
  local: {
    indexTerminal: { from: string; ib: number; im: number }[];
    maire: Record<string, { from: string; tiers: Tier[] } | string>;
    adjoint: Record<string, { from: string; tiers: Tier[] } | string>;
    conseillerMunicipal: { minPop: number; rate: number };
    departement: { conseiller: { tiers: Tier[] }; president: { from: string; rate: number }[] };
    region: { conseiller: { tiers: Tier[] }; president: { from: string; rate: number }[] };
    epci: { agglomerationUrbaineMetropole: { president: Tier[]; vicePresident: Tier[] } };
  };
  ecretement: { factor: number; localFrom: string; parliamentFrom: string; parliamentLocalShareMax: number };
}
export interface Mandate { office: string; from: string | null; to: string | null; population: number | null; label: { fr: string; en: string } }
export interface PayYear { year: number; amount: number; partial: boolean; days: number }
export interface PayEstimate { years: PayYear[]; total: number; first: number | null; gaps: Set<string> }

const DAY = 86400000;
const PARL = new Set(["depute", "senateur", "mep"]);
const GOV: Record<string, "pm" | "ministre" | "delegue" | "secretaire"> = { "premier-ministre": "pm", ministre: "ministre", "ministre-delegue": "delegue", "secretaire-etat": "secretaire" };
/** Offices that are listed in the career but never priced (no public scale, or not a public office). */
export const UNPRICED = new Set(["fonctionnaire", "other", "conseiller-communautaire"]);
const LOCAL_FROM_EPCI = "2002-03-01";
/** Parliamentary indemnity: base × 1.03 (residence) × 1.25 (function). */
const PARL_TOTAL = 1.03 * 1.25;

/** "1997" → 1997-01-01, "2010-12" → 2010-12-01; an open end is the verification date. */
export function parseDate(s: string | null, end = false): number | null {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] - 1 : end ? 11 : 0;
  const d = m[3] ? +m[3] : end ? new Date(Date.UTC(y, mo + 1, 0)).getUTCDate() : 1;
  return Date.UTC(y, mo, d);
}

/** Value of a step series ({from, …}) on a date; null before the first step. */
function step<T extends { from: string }>(xs: T[], t: number): T | null {
  let cur: T | null = null;
  for (const x of xs) if (Date.parse(x.from) <= t) cur = x;
  return cur;
}
const tierRate = (tiers: Tier[], pop: number) => tiers.find((x) => x.maxPop == null || pop <= x.maxPop)?.rate ?? null;

export function estimatePay(mandates: Mandate[], s: PayScales, until: string): PayEstimate {
  const stop = Date.parse(until);
  const ms = mandates
    .map((m) => ({ m, a: parseDate(m.from), b: Math.min(parseDate(m.to, true) ?? stop, stop) }))
    .filter((x): x is { m: Mandate; a: number; b: number } => x.a != null && x.a <= x.b);
  const gaps = new Set<string>();
  if (!ms.length) return { years: [], total: 0, first: null, gaps };
  const start = Math.min(...ms.map((x) => x.a));

  const point = (t: number) => step(s.pointIndice.changes, t)?.annual ?? null;
  const ibtMonthly = (t: number) => { const p = point(t), i = step(s.local.indexTerminal, t); return p && i ? (p * i.im) / 12 : null; };
  // the hors-échelle average is only verified from November 2001; the cap before that uses 1190 (approximation)
  const avg = (t: number) => step(s.parliament.avgIndice, t)?.value ?? null;
  const parlBase = (t: number) => { const p = point(t), a = avg(t); return p && a ? (p * a) / 12 : null; };
  const capBase = (t: number) => { const p = point(t); return p ? (p * (avg(t) ?? 1190)) / 12 : null; };
  const schedule = (o: Record<string, { from: string; tiers: Tier[] } | string>, t: number) =>
    step(Object.values(o).filter((x): x is { from: string; tiers: Tier[] } => typeof x === "object" && x != null && "tiers" in x), t);

  /** Monthly gross for one local mandate on day t, null if the scales don't cover it. */
  function local(m: Mandate, t: number): number | null {
    if (t < Date.parse(s.ecretement.localFrom)) return null;
    const ibt = ibtMonthly(t);
    if (ibt == null) return null;
    const pop = m.population;
    let rate: number | null = null;
    switch (m.office) {
      case "maire": case "adjoint": { const sc = schedule(m.office === "maire" ? s.local.maire : s.local.adjoint, t); rate = sc && pop != null ? tierRate(sc.tiers, pop) : null; break; }
      case "conseiller-municipal": rate = pop == null ? null : pop >= s.local.conseillerMunicipal.minPop ? s.local.conseillerMunicipal.rate : 0; break;
      case "conseiller-departemental": rate = pop == null ? null : tierRate(s.local.departement.conseiller.tiers, pop); break;
      case "vice-president-departement": { const c = pop == null ? null : tierRate(s.local.departement.conseiller.tiers, pop); rate = c == null ? null : c * 1.4; break; }
      case "president-departement": rate = step(s.local.departement.president, t)?.rate ?? null; break;
      case "conseiller-regional": rate = pop == null ? null : tierRate(s.local.region.conseiller.tiers, pop); break;
      case "vice-president-region": { const c = pop == null ? null : tierRate(s.local.region.conseiller.tiers, pop); rate = c == null ? null : c * 1.4; break; }
      case "president-region": rate = step(s.local.region.president, t)?.rate ?? null; break;
      case "president-epci": rate = t < Date.parse(LOCAL_FROM_EPCI) || pop == null ? null : tierRate(s.local.epci.agglomerationUrbaineMetropole.president, pop); break;
      default: return null;
    }
    return rate == null ? null : (rate / 100) * ibt;
  }

  const byYear = new Map<number, PayYear>();
  for (let t = start; t <= stop; t += DAY) {
    const y = new Date(t).getUTCFullYear();
    const row = byYear.get(y) ?? { year: y, amount: 0, partial: false, days: 0 };
    byYear.set(y, row);
    const on = ms.filter((x) => x.a <= t && t <= x.b).map((x) => x.m);
    if (!on.length) continue;
    row.days++;
    let monthly = 0;
    let unknown = false;
    // government pay replaces the parliamentary indemnity (art. 23 of the Constitution: the seat goes to the substitute)
    const gov = on.find((m) => GOV[m.office]);
    if (gov) {
      const c = step(s.government.coefficients, t), b = parlBase(t);
      if (c && b) monthly += c[GOV[gov.office]] * b * PARL_TOTAL;
      else { unknown = true; gaps.add("government"); }
    }
    const parl = on.filter((m) => PARL.has(m.office));
    const isParl = !gov && parl.length > 0;
    if (isParl) {
      // one parliamentary indemnity at a time, even across a changeover (national and European mandates are incompatible)
      const euro = parl.some((m) => m.office === "mep") && t >= Date.parse(s.mep.euSalaryFrom);
      const nat = parl.some((m) => m.office !== "mep") || !euro;
      const b = parlBase(t);
      const vals: number[] = [];
      if (euro) vals.push(step(s.mep.values, t)?.monthly ?? 0);
      if (nat) { if (b) vals.push(b * PARL_TOTAL); else { unknown = true; gaps.add("parliament"); } }
      monthly += vals.length ? Math.max(...vals) : 0;
    }
    const locals = on.filter((m) => !PARL.has(m.office) && !GOV[m.office] && !UNPRICED.has(m.office));
    if (locals.length) {
      // in government, local indemnities are left out (cumulation rule not verified) unless they would be zero anyway
      if (gov) { if (locals.some((m) => local(m, t) !== 0)) { unknown = true; gaps.add("local-minister"); } }
      else {
        let sum = 0;
        for (const m of locals) {
          const v = local(m, t);
          if (v == null) { unknown = true; gaps.add(t < Date.parse(s.ecretement.localFrom) ? "local-pre1992" : "local-scale"); } else sum += v;
        }
        const cb = capBase(t);
        if (cb) sum = Math.min(sum, isParl ? s.ecretement.parliamentLocalShareMax * cb : s.ecretement.factor * cb);
        monthly += sum;
      }
    }
    row.amount += (monthly * 12) / 365.25;
    if (unknown) row.partial = true;
  }
  const years = [...byYear.values()].sort((a, b) => a.year - b.year);
  return { years, total: years.reduce((a, r) => a + r.amount, 0), first: new Date(start).getUTCFullYear(), gaps };
}
