// "La France en chiffres": the main economic indicators (public/data/economy.json, scripts/sync-economy.mjs),
// a live public-debt counter extrapolated from the latest quarterly Maastricht figure, and the debt added
// since the reader opened the page, translated into things public money buys (src/lib/equivalents.ts).
import { fetchJson } from "../data";
import { L, colon, fmtDate, getLang } from "../i18n";
import { EQUIVALENTS, type Equivalent } from "../lib/equivalents";
import { esc, safeUrl } from "../util";

interface Kpi {
  id: string;
  unit: "eur" | "pct" | "pct_gdp" | "people";
  period: string;
  value: number;
  prev: number | null;
  series: [string, number][];
  updated: string | null;
  source: { name: string; dataset: string; url: string | null };
  stale?: boolean;
  fallback?: string;
}
interface Economy {
  fetchedAt: string;
  debt: { eur: number; pct: number | null; period: string; asOf: string; ratePerYear: number; rateFrom: string | null; rateTo: string; rateBasis: "4q" | "deficit" };
  people: { population: number; populationPeriod: string; employed: number; employedPeriod: string };
  kpis: Kpi[];
  debtHistory?: { fr?: DebtSide; de?: DebtSide };
}
interface Src { name: string; dataset: string; url: string | null; from?: string | null }
interface DebtSide {
  annual: [string, number][];
  latest?: { period: string; value: number; source: Src };
  source?: Src;
  sources?: Src[];
  link?: { year: string; factor: number };
  stale?: boolean;
}

const YEAR_MS = 365.25 * 86400e3;
const loadEconomy = () => fetchJson<Economy>("/data/economy.json");
const locale = () => (getLang() === "fr" ? "fr-FR" : "en-GB");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- formatting ----------
const nf = (d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v: number, d = 0) => nf(d).format(v);
/** Whole euros, the way each language writes them: "3 612 345 €" / "€3,612,345". */
const eur = (v: number, d = 0) => (getLang() === "fr" ? `${num(v, d)} €` : `${v < 0 ? "−" : ""}€${num(Math.abs(v), d)}`);
/** Large sums: "3 595,5 Md€" / "€3,595.5bn", "8,5 M€" / "€8.5m". */
function big(v: number, d = 1) {
  const fr = getLang() === "fr";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  const [n, fu, eu] = a >= 1e9 ? [a / 1e9, "Md€", "bn"] : a >= 1e6 ? [a / 1e6, "M€", "m"] : a >= 1e4 ? [a / 1e3, "k€", "k"] : [a, "€", ""];
  if (!eu && !fr) return `${s}€${num(n, 0)}`;
  return fr ? `${s}${num(n, d)} ${fu}` : `${s}€${num(n, d)}${eu}`;
}
const pct = (v: number, d = 1) => (getLang() === "fr" ? `${num(v, d)} %` : `${num(v, d)}%`);
const signed = (s: string, v: number) => (v > 0 ? `+${s}` : v < 0 ? `−${s.replace(/^[−-]/, "")}` : s);
/** "2026-Q2" → "T2 2026" / "Q2 2026"; "2026-10" → "oct. 2026"; "2025" → "2025". */
function period(p: string) {
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${L("T", "Q")}${q[2]} ${q[1]}`;
  if (/^\d{4}-\d{2}$/.test(p)) return new Date(`${p}-15`).toLocaleDateString(locale(), { month: "short", year: "numeric" });
  return p;
}
function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return `${d} ${L("j", "d")} ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(r).padStart(2, "0")} s`;
  return `${r} s`;
}

// ---------- the indicators ----------
interface Def { id: string; fr: string; en: string; show: (k: Kpi) => string; delta?: (k: Kpi) => string; noteFr: string; noteEn: string; sub?: (by: Map<string, Kpi>) => string }
const pp = (k: Kpi) => (k.prev == null ? "" : signed(L(`${num(Math.abs(k.value - k.prev), 1)} pt`, `${num(Math.abs(k.value - k.prev), 1)} pt`), Math.round((k.value - k.prev) * 10)));
const rel = (k: Kpi) => (k.prev ? signed(pct(Math.abs((100 * (k.value - k.prev)) / Math.abs(k.prev))), Math.round((1000 * (k.value - k.prev)) / Math.abs(k.prev))) : "");
const DEFS: Def[] = [
  { id: "debt_eur", fr: "Dette publique", en: "Public debt", show: (k) => big(k.value), delta: rel,
    sub: (by) => (by.get("debt_pct") ? L(`${pct(by.get("debt_pct")!.value)} du PIB`, `${pct(by.get("debt_pct")!.value)} of GDP`) : ""),
    noteFr: "Dette brute consolidée des administrations publiques (État, collectivités, sécurité sociale), au sens de Maastricht, en fin de trimestre.",
    noteEn: "Consolidated gross debt of general government (state, local authorities, social security), Maastricht definition, end of quarter." },
  { id: "deficit", fr: "Déficit public", en: "Budget deficit", show: (k) => L(`${pct(Math.abs(k.value))} du PIB`, `${pct(Math.abs(k.value))} of GDP`),
    delta: (k) => (k.prev == null ? "" : L(`${pct(Math.abs(k.prev))} l’année précédente`, `${pct(Math.abs(k.prev))} the year before`)),
    noteFr: "Besoin de financement des administrations publiques sur l’année. Le plafond européen est de 3 %.", noteEn: "General government net borrowing over the year. The EU ceiling is 3%." },
  { id: "gdp", fr: "Produit intérieur brut", en: "Gross domestic product", show: (k) => big(k.value, 0), delta: rel,
    sub: (by) => (by.get("growth_y") ? L(`croissance en volume ${signed(pct(Math.abs(by.get("growth_y")!.value)), by.get("growth_y")!.value)}`, `real growth ${signed(pct(Math.abs(by.get("growth_y")!.value)), by.get("growth_y")!.value)}`) : ""),
    noteFr: "Richesse produite sur l’année, en euros courants. La croissance est corrigée de l’inflation.", noteEn: "Output over the year, in current euros. Growth is adjusted for inflation." },
  { id: "growth_q", fr: "Croissance du trimestre", en: "Quarterly growth", show: (k) => signed(pct(Math.abs(k.value)), k.value),
    delta: (k) => (k.prev == null ? "" : L(`${signed(pct(Math.abs(k.prev)), k.prev)} le trimestre précédent`, `${signed(pct(Math.abs(k.prev)), k.prev)} the quarter before`)),
    noteFr: "Évolution du PIB en volume par rapport au trimestre précédent, corrigée des variations saisonnières.", noteEn: "Change in real GDP on the previous quarter, seasonally adjusted." },
  { id: "inflation", fr: "Inflation", en: "Inflation", show: (k) => pct(k.value), delta: pp,
    noteFr: "Hausse des prix à la consommation sur un an (indice des prix INSEE, ensemble des ménages).", noteEn: "Year-on-year rise in consumer prices (INSEE consumer price index, all households)." },
  { id: "unemployment", fr: "Chômage", en: "Unemployment", show: (k) => pct(k.value), delta: pp,
    noteFr: "Part des actifs sans emploi qui en cherchent un, au sens du BIT. France entière, données corrigées des variations saisonnières.", noteEn: "Share of the labour force out of work and looking, ILO definition. All of France, seasonally adjusted." },
  { id: "employment", fr: "Taux d’emploi", en: "Employment rate", show: (k) => pct(k.value), delta: pp,
    sub: (by) => (by.get("employed") ? L(`${num(by.get("employed")!.value / 1e6, 1)} millions de personnes en emploi`, `${num(by.get("employed")!.value / 1e6, 1)} million people in work`) : ""),
    noteFr: "Part des 15-64 ans qui ont un emploi, au sens du BIT.", noteEn: "Share of 15 to 64-year-olds in work, ILO definition." },
  { id: "spending", fr: "Dépenses publiques", en: "Public spending", show: (k) => L(`${pct(k.value)} du PIB`, `${pct(k.value)} of GDP`), delta: pp,
    noteFr: "Total des dépenses des administrations publiques, rapporté au PIB.", noteEn: "Total general government expenditure, as a share of GDP." },
  { id: "tax", fr: "Prélèvements obligatoires", en: "Tax burden", show: (k) => L(`${pct(k.value)} du PIB`, `${pct(k.value)} of GDP`), delta: pp,
    noteFr: "Impôts et cotisations sociales, définition Eurostat (cotisations imputées comprises). Le taux publié par l’INSEE, plus étroit, est inférieur de deux à trois points.",
    noteEn: "Taxes and social contributions, Eurostat definition (including imputed contributions). INSEE’s narrower national rate is two to three points lower." },
  { id: "trade", fr: "Solde commercial", en: "Trade balance", show: (k) => big(k.value), delta: (k) => (k.prev == null ? "" : L(`${big(k.prev)} le trimestre précédent`, `${big(k.prev)} the quarter before`)),
    noteFr: "Exportations moins importations de biens et services sur le trimestre, comptes nationaux, données corrigées des variations saisonnières.", noteEn: "Exports minus imports of goods and services over the quarter, national accounts, seasonally adjusted." },
  { id: "interest", fr: "Charge d’intérêts", en: "Interest on the debt", show: (k) => big(k.value), delta: rel,
    sub: (by) => (by.get("interest_pct") ? L(`${pct(by.get("interest_pct")!.value)} du PIB`, `${pct(by.get("interest_pct")!.value)} of GDP`) : ""),
    noteFr: "Intérêts versés sur l’année par l’ensemble des administrations publiques, pas seulement l’État.", noteEn: "Interest paid over the year by all of general government, not only the state." },
  { id: "population", fr: "Population", en: "Population", show: (k) => L(`${num(k.value / 1e6, 1)} millions`, `${num(k.value / 1e6, 1)} million`), delta: rel,
    noteFr: "Habitants au 1er janvier, France entière.", noteEn: "Residents on 1 January, all of France." },
];

function spark(series: [string, number][]) {
  const pts = series.slice(-20);
  if (pts.length < 3) return "";
  const W = 120, H = 34, P = 3;
  const vs = pts.map((p) => p[1]);
  const lo = Math.min(...vs, vs.some((v) => v < 0) ? 0 : Infinity), hi = Math.max(...vs, vs.some((v) => v < 0) ? 0 : -Infinity);
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const zero = lo < 0 && hi > 0 ? `<line x1="${P}" x2="${W - P}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="z"/>` : "";
  return `<svg class="eco-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMid meet" aria-hidden="true">${zero}<path d="${d}"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(vs.at(-1)!).toFixed(1)}" r="2.4"/></svg>`;
}

function kpiCard(def: Def, k: Kpi, by: Map<string, Kpi>) {
  const first = k.series[0]?.[0];
  const delta = def.delta?.(k) ?? "";
  const sub = def.sub?.(by) ?? "";
  const src = k.source.url
    ? `<a href="${esc(safeUrl(k.source.url))}" target="_blank" rel="noopener">${esc(k.source.name)}</a>`
    : esc(k.source.name);
  return `<article class="eco-kpi">
    <h3>${esc(L(def.fr, def.en))}</h3>
    <p class="eco-v">${esc(def.show(k))}</p>
    <p class="eco-p">${esc(period(k.period))}${delta ? ` · ${esc(delta)}` : ""}</p>
    ${sub ? `<p class="eco-sub">${esc(sub)}</p>` : ""}
    ${spark(k.series)}${first && k.series.length > 2 ? `<p class="eco-range">${esc(L(`depuis ${period(first)}`, `since ${period(first)}`))}</p>` : ""}
    <p class="eco-note">${esc(L(def.noteFr, def.noteEn))}</p>
    <p class="eco-src">${src}${k.updated ? `, ${L("publié le", "released")} ${fmtDate(k.updated)}` : ""}${k.fallback ? ` · ${L("valeur de secours", "fallback value")}` : k.stale ? ` · ${L("dernière valeur connue", "last known value")}` : ""}</p>
  </article>`;
}

// ---------- public debt, president by president ----------
// Convention: each calendar year belongs to whoever was in office on 31 December. A term's change is the
// debt-to-GDP ratio at its last year-end in office minus the ratio at the last year-end before it began; an
// ongoing term ends at the latest published quarter. Per year = that change divided by the years between the
// two points. No party colours: ink for everyone, one accent for the largest rise.
interface Term { name: string; short: string; init: string; from: string; to: string | null }
const PRESIDENTS: Term[] = [
  { name: "Valéry Giscard d’Estaing", short: "Giscard", init: "VGE", from: "1974-05-27", to: "1981-05-21" },
  { name: "François Mitterrand", short: "Mitterrand", init: "FM", from: "1981-05-21", to: "1995-05-17" },
  { name: "Jacques Chirac", short: "Chirac", init: "JC", from: "1995-05-17", to: "2007-05-16" },
  { name: "Nicolas Sarkozy", short: "Sarkozy", init: "NS", from: "2007-05-16", to: "2012-05-15" },
  { name: "François Hollande", short: "Hollande", init: "FH", from: "2012-05-15", to: "2017-05-14" },
  { name: "Emmanuel Macron", short: "Macron", init: "EM", from: "2017-05-14", to: null },
];
const CHANCELLORS: Term[] = [
  { name: "Helmut Schmidt", short: "Schmidt", init: "HS", from: "1974-05-16", to: "1982-10-01" },
  { name: "Helmut Kohl", short: "Kohl", init: "HK", from: "1982-10-01", to: "1998-10-27" },
  { name: "Gerhard Schröder", short: "Schröder", init: "GS", from: "1998-10-27", to: "2005-11-22" },
  { name: "Angela Merkel", short: "Merkel", init: "AM", from: "2005-11-22", to: "2021-12-08" },
  { name: "Olaf Scholz", short: "Scholz", init: "OS", from: "2021-12-08", to: "2025-05-06" },
  { name: "Friedrich Merz", short: "Merz", init: "FMz", from: "2025-05-06", to: null },
];
const SHOCKS = [
  { year: 1993, fr: "Récession de 1993", en: "1993 recession", frS: "Récession", enS: "Recession" },
  { year: 2009, fr: "Crise financière 2008-2009", en: "2008–09 financial crisis", frS: "Crise 2008-09", enS: "2008–09 crisis" },
  { year: 2020, fr: "Covid-19", en: "Covid-19", frS: "Covid", enS: "Covid" },
];

/** A dated observation: x is the position in decimal years of its end date (31 Dec 1994 → 1995). */
interface Pt { x: number; v: number; p: string; q: boolean }
const decYear = (iso: string) => { const d = new Date(iso); return d.getUTCFullYear() + (d.getUTCMonth() * 30.44 + d.getUTCDate()) / 365.25; };
function points(s: DebtSide | undefined): Pt[] {
  if (!s?.annual?.length) return [];
  const pts = s.annual.map(([y, v]) => ({ x: +y + 1, v, p: y, q: false }));
  const m = s.latest?.period.match(/^(\d{4})-Q([1-4])$/);
  if (m && +m[1] + +m[2] / 4 > pts.at(-1)!.x) pts.push({ x: +m[1] + +m[2] / 4, v: s.latest!.value, p: s.latest!.period, q: true });
  return pts;
}
/** "fin 1994" / "end-1994", "fin T2 2026" / "end Q2 2026". */
const ptLabel = (p: Pt) => (p.q ? L(`fin ${period(p.p)}`, `end ${period(p.p)}`) : L(`fin ${p.p}`, `end-${p.p}`));

interface TermStat { t: Term; a: Pt; b: Pt; d: number; years: number; rate: number; partial: boolean; ongoing: boolean }
function termStats(terms: Term[], pts: Pt[]): TermStat[] {
  const at = (x: number) => pts.find((p) => Math.abs(p.x - x) < 0.01);
  return terms.flatMap((t) => {
    const ongoing = !t.to;
    const b = ongoing ? pts.at(-1) : at(new Date(t.to!).getUTCFullYear()); // last 31 Dec in office
    let a = at(new Date(t.from).getUTCFullYear()); // last 31 Dec before taking office
    const partial = !a;
    if (!a) a = pts.find((p) => p.x > decYear(t.from));
    if (!a || !b || b.x <= a.x) return [];
    const years = b.x - a.x, d = Math.round((b.v - a.v) * 10) / 10;
    return [{ t, a, b, d, years, rate: d / years, partial, ongoing }];
  });
}
const pts1 = (v: number, d = 1) => signed(num(Math.abs(v), d), Math.round(v * 10 ** d));
const ptsU = (v: number) => `${pts1(v)} pts`;
const rateU = (v: number) => `${pts1(v)} ${L("pt/an", "pt/yr")}`;
const yrs = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? num(Math.round(n)) : num(n, 1));
const termYears = (t: Term) => `${t.from.slice(0, 4)}–${t.to ? t.to.slice(0, 4) : ""}`;
const inOffice = (terms: Term[], x: number) => terms.find((t) => decYear(t.from) < x && (!t.to || decYear(t.to) >= x));

function debtHeadline(st: TermStat[]) {
  const byD = [...st].sort((a, b) => b.d - a.d), byR = [...st].filter((s) => !s.partial).sort((a, b) => b.rate - a.rate);
  const top = byD[0], fast = byR[0];
  if (!top) return "";
  const lead = L(
    `${top.t.name} est le président sous lequel la dette publique a le plus augmenté en points de PIB : ${ptsU(top.d)} en ${yrs(top.years)} ans (${pct(top.a.v)} ${ptLabel(top.a)}, ${pct(top.b.v)} ${ptLabel(top.b)}).`,
    `${top.t.name} is the president under whom public debt rose most in points of GDP: ${ptsU(top.d)} over ${yrs(top.years)} years (${pct(top.a.v)} at ${ptLabel(top.a)}, ${pct(top.b.v)} at ${ptLabel(top.b)}).`,
  );
  const pace = fast && fast.t !== top.t
    ? L(` Rapporté à la durée du mandat, le rythme le plus rapide est celui de ${fast.t.name} : ${rateU(fast.rate)}.`, ` Per year in office, the fastest pace was under ${fast.t.name}: ${rateU(fast.rate)}.`)
    : fast ? L(` C’est aussi le rythme annuel le plus rapide : ${rateU(fast.rate)}.`, ` It is also the fastest pace per year: ${rateU(fast.rate)}.`) : "";
  return lead + pace;
}

/** The line chart as an SVG string, sized for a container `W` pixels wide. */
function debtChart(W: number, fr: Pt[], de: Pt[], showDe: boolean, topName: string, animate: boolean) {
  const narrow = W < 560;
  const H = narrow ? 300 : 380;
  const m = { l: 34, r: narrow ? 66 : 92, t: narrow ? 40 : 34, b: 26 };
  const x0 = fr[0].x, x1 = fr.at(-1)!.x;
  const visDe = showDe ? de.filter((p) => p.x >= x0 - 0.01) : [];
  const vmax = Math.max(...fr.map((p) => p.v), ...visDe.map((p) => p.v));
  const ymax = Math.ceil((vmax + 6) / 20) * 20;
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number) => m.t + (1 - v / ymax) * (H - m.t - m.b);
  const f = (n: number) => n.toFixed(1);
  const out: string[] = [];
  // term bands
  const fs = narrow ? 10 : 11, cw = fs * 0.61;
  let lastEnd = -Infinity, row = 0;
  PRESIDENTS.forEach((t, i) => {
    const a = Math.max(decYear(t.from), x0), b = Math.min(t.to ? decYear(t.to) : x1, x1);
    if (b <= a) return;
    const xa = X(a), xb = X(b), w = xb - xa;
    const top = t.name === topName;
    out.push(`<rect class="debtp-band${i % 2 ? " alt" : ""}${top ? " top" : ""}" x="${f(xa)}" y="${m.t - 4}" width="${f(w)}" height="${f(H - m.b - m.t + 4)}"/>`);
    if (i) out.push(`<line class="debtp-sep" x1="${f(xa)}" x2="${f(xa)}" y1="${m.t - 4}" y2="${H - m.b}"/>`);
    const lbl = t.short.length * cw + 4 <= w ? t.short : t.init;
    const lw = lbl.length * cw;
    let cx = Math.max(xa + lw / 2, Math.min(xb - lw / 2, (xa + xb) / 2));
    cx = Math.max(lw / 2 + 1, cx);
    row = cx - lw / 2 < lastEnd + 3 ? 1 - row : 0;
    lastEnd = cx + lw / 2;
    out.push(`<text class="debtp-bl${top ? " top" : ""}" x="${f(cx)}" y="${m.t - 10 - row * (fs + 2)}" text-anchor="middle"><title>${esc(t.name)}</title>${esc(lbl)}</text>`);
  });
  // grid
  for (let v = 0; v <= ymax; v += 20) {
    out.push(`<line class="debtp-grid${v ? "" : " zero"}" x1="${m.l}" x2="${W - m.r}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`);
    out.push(`<text class="debtp-ax" x="${m.l - 5}" y="${f(Y(v) + 3.5)}" text-anchor="end">${v === ymax ? (getLang() === "fr" ? `${v} %` : `${v}%`) : v}</text>`);
  }
  const step = narrow ? 10 : 5;
  for (let y = Math.ceil(x0 / step) * step; y <= x1; y += step)
    out.push(`<text class="debtp-ax" x="${f(X(y))}" y="${H - m.b + 16}" text-anchor="middle">${y}</text>`);
  // lines: annual path, then a dashed hop to the latest quarter
  const line = (pts: Pt[], cls: string) => {
    const ann = pts.filter((p) => !p.q), q = pts.find((p) => p.q);
    const d = ann.map((p, i) => `${i ? "L" : "M"}${f(X(p.x))},${f(Y(p.v))}`).join("");
    return `<path class="debtp-halo" d="${d}"/><path class="debtp-line ${cls}${animate ? " draw" : ""}" d="${d}" pathLength="1"/>`
      + (q && ann.length ? `<path class="debtp-line q ${cls}" d="M${f(X(ann.at(-1)!.x))},${f(Y(ann.at(-1)!.v))}L${f(X(q.x))},${f(Y(q.v))}"/>` : "");
  };
  if (visDe.length) out.push(line(visDe, "de"));
  out.push(line(fr, "fr"));
  // shocks: a small mark on the French line, the label above and to the left (a rising line leaves that space empty)
  for (const s of SHOCKS) {
    const p = fr.find((q) => !q.q && +q.p === s.year);
    if (!p) continue;
    const px = X(p.x), py = Y(p.v);
    out.push(`<line class="debtp-tick" x1="${f(px)}" x2="${f(px - 8)}" y1="${f(py - 4)}" y2="${f(py - 14)}"/><text class="debtp-note" x="${f(px - 10)}" y="${f(py - 17)}" text-anchor="end">${esc(narrow ? L(s.frS, s.enS) : L(s.fr, s.en))}</text>`);
  }
  // direct end labels, nudged apart
  const ends = [{ p: fr.at(-1)!, n: L("France", "France"), c: "fr" }, ...(visDe.length ? [{ p: visDe.at(-1)!, n: L("Allemagne", "Germany"), c: "de" }] : [])]
    .map((e) => ({ ...e, y: Y(e.p.v) }));
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 26) { const mid = (ends[0].y + ends[1].y) / 2, s = ends[0].y < ends[1].y ? -13 : 13; ends[0].y = mid + s; ends[1].y = mid - s; }
  for (const e of ends)
    out.push(`<circle class="debtp-end ${e.c}" cx="${f(X(e.p.x))}" cy="${f(Y(e.p.v))}" r="3"/><text class="debtp-el ${e.c}" x="${f(X(e.p.x) + 6)}" y="${f(e.y - 2)}">${esc(e.n)}</text><text class="debtp-ev ${e.c}" x="${f(X(e.p.x) + 6)}" y="${f(e.y + 11)}">${esc(pct(e.p.v))}</text>`);
  out.push(`<g class="debtp-cross" aria-hidden="true"><line y1="${m.t - 4}" y2="${H - m.b}"/><circle class="fr" r="4.5"/><circle class="de" r="4"/></g>`);
  return { svg: `<svg class="debtp-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">${out.join("")}</svg>`, X, Y };
}

function debtBars(st: TermStat[], mode: "d" | "rate") {
  const val = (s: TermStat) => (mode === "d" ? s.d : s.rate);
  const rows = [...st].sort((a, b) => val(b) - val(a));
  const lo = Math.min(0, ...rows.map(val)), hi = Math.max(0, ...rows.map(val));
  const span = hi - lo || 1, z = (-lo / span) * 100;
  const best = rows.find((s) => !s.partial || mode === "d");
  return rows.map((s) => {
    const v = val(s), w = (Math.abs(v) / span) * 100, left = v < 0 ? z - w : z;
    const tags = [s.ongoing ? L("en cours", "ongoing") : "", s.partial ? L("partiel", "partial") : ""].filter(Boolean);
    return `<li class="${s === best ? "is-top" : ""}">
      <span class="debtp-bn">${esc(s.t.name)} <span class="debtp-by">${termYears(s.t)}${tags.map((t) => ` <span class="tag">${esc(t)}</span>`).join("")}</span></span>
      <span class="debtp-bt" aria-hidden="true"><span style="left:${left.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%"></span></span>
      <b class="debtp-bv">${esc(mode === "d" ? ptsU(v) : rateU(v))}</b>
      <span class="debtp-bs">${esc(`${pct(s.a.v)} ${ptLabel(s.a)} → ${pct(s.b.v)} ${ptLabel(s.b)} · ${yrs(s.years)} ${L("ans", "years")} · ${mode === "d" ? rateU(s.rate) : ptsU(s.d)}`)}</span>
    </li>`;
  }).join("");
}

function chancellorTable(st: TermStat[]) {
  const rows = [...st].sort((a, b) => b.d - a.d);
  return `<table class="table debtp-table">
    <thead><tr><th>${L("Chancelier", "Chancellor")}</th><th>${L("Mandat", "Term")}</th><th class="num">${L("Départ", "From")}</th><th class="num">${L("Arrivée", "To")}</th><th class="num">${L("Points de PIB", "Points of GDP")}</th><th class="num">${L("Par an", "Per year")}</th></tr></thead>
    <tbody>${rows.map((s) => `<tr><td>${esc(s.t.name)}${s.ongoing ? ` <span class="tag">${L("en cours", "ongoing")}</span>` : ""}</td><td>${termYears(s.t)}</td>
      <td class="num muted">${esc(pct(s.a.v))} <small>${esc(ptLabel(s.a))}</small></td><td class="num muted">${esc(pct(s.b.v))} <small>${esc(ptLabel(s.b))}</small></td>
      <td class="num">${esc(ptsU(s.d))}</td><td class="num">${esc(rateU(s.rate))}</td></tr>`).join("")}</tbody>
  </table>`;
}

const srcLink = (s: Src | undefined) => (s ? (s.url ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)) + ` (${esc(s.dataset)})` : "");

function debtSection(e: Economy) {
  const h = e.debtHistory;
  const fr = points(h?.fr), de = points(h?.de);
  if (fr.length < 5) return "";
  const st = termStats(PRESIDENTS, fr), stDe = termStats(CHANCELLORS, de);
  const top = [...st].sort((a, b) => b.d - a.d)[0];
  const last = fr.at(-1)!;
  const giscard = st.find((s) => s.partial);
  const link = h?.de?.link;
  return `<section class="card debtp" id="dette-presidents">
    <header class="card-head"><h2>${L("La dette publique, président par président", "Public debt, president by president")}</h2></header>
    <p class="debtp-lede">${esc(debtHeadline(st))}</p>
    <p class="muted small">${L(
      "Dette des administrations publiques au sens de Maastricht, en % du PIB, au 31 décembre de chaque année. En fond, les mandats présidentiels de la Ve République couverts par les données.",
      "General government debt, Maastricht definition, as a share of GDP, at 31 December each year. Behind it, the Fifth Republic presidential terms the data covers.")}</p>
    <div class="debtp-controls">
      ${de.length ? `<button type="button" class="chip-toggle debtp-de-toggle" aria-pressed="true" style="--c:var(--ink-3)">${L("Allemagne", "Germany")}</button>` : ""}
    </div>
    <p class="debtp-read" id="debtp-read" aria-hidden="true"></p>
    <div class="debtp-chart" tabindex="0" role="slider" aria-label="${esc(L("Dette publique en % du PIB, année par année. Flèches gauche et droite pour parcourir.", "Public debt as % of GDP, year by year. Use the left and right arrow keys to move."))}"
      aria-valuemin="${fr[0].x}" aria-valuemax="${last.x}" aria-valuenow="${last.x}"></div>
    <h3 class="debtp-h3">${L("Points de PIB ajoutés par mandat", "Points of GDP added per term")}</h3>
    <div class="tabs small-tabs debtp-mode" role="group" aria-label="${esc(L("Mesure", "Measure"))}">
      <button type="button" data-mode="d" aria-pressed="true">${L("Sur le mandat", "Whole term")}</button><button type="button" data-mode="rate" aria-pressed="false">${L("Par année en fonctions", "Per year in office")}</button>
    </div>
    <ol class="debtp-bars" id="debtp-bars">${debtBars(st, "d")}</ol>
    ${stDe.length ? `<details class="debtp-de">
      <summary>${L("Le même calcul pour les chanceliers allemands", "The same calculation for German chancellors")}</summary>
      ${chancellorTable(stDe)}
      <p class="muted small">${L(
        `Allemagne de l’Ouest jusqu’en 1990, Allemagne réunifiée ensuite : la hausse de 1995 sous Helmut Kohl reflète en partie la reprise des dettes de l’ex-RDA (Treuhandanstalt). Avant 1995, FMI${link ? `, raccordé au niveau Eurostat de ${link.year} (×${num(link.factor, 3)})` : ""}.`,
        `West Germany until 1990, unified Germany after: the 1995 jump under Helmut Kohl partly reflects the takeover of former East German debts (Treuhandanstalt). Before 1995, IMF${link ? `, linked to the Eurostat level of ${link.year} (×${num(link.factor, 3)})` : ""}.`)}</p>
    </details>` : ""}
    <p class="source debtp-src">${L("Calcul", "Method")}${colon()}${esc(L(
      `chaque année est attribuée à qui était en fonctions au 31 décembre. Variation d’un mandat = ratio à la dernière fin d’année passée en fonctions, moins le ratio à la dernière fin d’année précédant l’entrée en fonctions (ainsi 1981 compte pour François Mitterrand, 1995 pour Jacques Chirac). Mandat en cours : jusqu’au dernier trimestre publié (${period(last.p)}). Par an : variation divisée par le nombre d’années entre ces deux dates.${giscard ? ` Les séries officielles commencent fin ${giscard.a.p} : seule la fin du mandat de ${giscard.t.name} est couverte.` : ""} Le ratio dépend aussi de la croissance, de l’inflation et des chocs traversés ; il compte des points de PIB, pas des euros.`,
      `each year is credited to whoever was in office on 31 December. A term’s change = the ratio at its last year-end in office minus the ratio at the last year-end before it began (so 1981 counts for François Mitterrand, 1995 for Jacques Chirac). Ongoing term: up to the latest published quarter (${period(last.p)}). Per year: that change divided by the years between the two points.${giscard ? ` Official series start at end-${giscard.a.p}: only the end of ${giscard.t.name}’s term is covered.` : ""} The ratio also moves with growth, inflation and the shocks each term met; it counts points of GDP, not euros.`))}<br>
      ${L("Sources", "Sources")}${colon()}${L("France", "France")} ${srcLink(h?.fr?.source)}${h?.fr?.latest ? `, ${L("dernier trimestre", "latest quarter")} ${srcLink(h.fr.latest.source)}` : ""}.
      ${de.length ? `${L("Allemagne", "Germany")} ${(h?.de?.sources ?? []).map((s) => `${srcLink(s)}${s.from ? ` ${L("depuis", "from")} ${esc(s.from)}` : ""}`).join(", ")}${h?.de?.latest ? `, ${L("dernier trimestre", "latest quarter")} ${srcLink(h.de.latest.source)}` : ""}.` : ""}
      ${h?.fr?.stale || h?.de?.stale ? ` ${L("Dernière valeur connue", "Last known values")}.` : ""}</p>
  </section>`;
}

function mountDebtChart(app: HTMLElement, e: Economy) {
  const root = app.querySelector<HTMLElement>("#dette-presidents");
  if (!root) return;
  const fr = points(e.debtHistory?.fr), de = points(e.debtHistory?.de);
  const st = termStats(PRESIDENTS, fr);
  const topName = [...st].sort((a, b) => b.d - a.d)[0]?.t.name ?? "";
  const box = root.querySelector<HTMLElement>(".debtp-chart")!, read = root.querySelector<HTMLElement>("#debtp-read")!;
  let showDe = de.length > 0, idx = fr.length - 1, width = 0;
  let scale: ReturnType<typeof debtChart> | null = null;

  const deAt = (x: number) => de.find((p) => Math.abs(p.x - x) < 0.01);
  const text = (p: Pt) => {
    const d = showDe ? deAt(p.x) : undefined, who = inOffice(PRESIDENTS, p.x - 0.001);
    return [ptLabel(p).replace(/^./, (c) => c.toUpperCase()), `${L("France", "France")} ${pct(p.v)}`, d ? `${L("Allemagne", "Germany")} ${pct(d.v)}` : "", who ? who.name : ""].filter(Boolean);
  };
  const place = () => {
    const p = fr[idx];
    const parts = text(p);
    read.innerHTML = parts.map((s, i) => (i === 1 ? `<b>${esc(s)}</b>` : `<span>${esc(s)}</span>`)).join(" · ");
    box.setAttribute("aria-valuenow", String(p.x));
    box.setAttribute("aria-valuetext", parts.join(", "));
    if (!scale) return;
    const g = box.querySelector<SVGGElement>(".debtp-cross")!;
    const cx = scale.X(p.x).toFixed(1);
    g.querySelector("line")!.setAttribute("x1", cx); g.querySelector("line")!.setAttribute("x2", cx);
    const cf = g.querySelector<SVGCircleElement>("circle.fr")!, cd = g.querySelector<SVGCircleElement>("circle.de")!;
    cf.setAttribute("cx", cx); cf.setAttribute("cy", scale.Y(p.v).toFixed(1));
    const d = showDe ? deAt(p.x) : undefined;
    cd.style.display = d ? "" : "none";
    if (d) { cd.setAttribute("cx", cx); cd.setAttribute("cy", scale.Y(d.v).toFixed(1)); }
  };
  const draw = () => {
    width = Math.round(box.clientWidth) || 640;
    scale = debtChart(width, fr, de, showDe, topName, !scale); // draw the lines in once, not on every redraw
    box.innerHTML = scale.svg;
    place();
  };
  draw();
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) return ro.disconnect();
    if (Math.abs(box.clientWidth - width) > 8) draw();
  });
  ro.observe(box);

  const pick = (ev: PointerEvent) => {
    if (!scale) return;
    const r = box.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * width;
    let best = 0;
    fr.forEach((p, i) => { if (Math.abs(scale!.X(p.x) - x) < Math.abs(scale!.X(fr[best].x) - x)) best = i; });
    if (best !== idx) { idx = best; place(); }
  };
  box.addEventListener("pointermove", pick);
  box.addEventListener("pointerdown", pick);
  box.addEventListener("keydown", (ev) => {
    const k = ev.key, n = fr.length - 1;
    const next = k === "ArrowLeft" || k === "ArrowDown" ? idx - 1 : k === "ArrowRight" || k === "ArrowUp" ? idx + 1
      : k === "PageDown" ? idx - 5 : k === "PageUp" ? idx + 5 : k === "Home" ? 0 : k === "End" ? n : null;
    if (next == null) return;
    ev.preventDefault();
    idx = Math.max(0, Math.min(n, next));
    place();
  });

  root.querySelector<HTMLButtonElement>(".debtp-de-toggle")?.addEventListener("click", (ev) => {
    showDe = !showDe;
    (ev.currentTarget as HTMLElement).setAttribute("aria-pressed", String(showDe));
    draw();
  });
  const bars = root.querySelector<HTMLElement>("#debtp-bars")!;
  root.querySelectorAll<HTMLButtonElement>(".debtp-mode button").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll(".debtp-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    bars.innerHTML = debtBars(st, b.dataset.mode === "rate" ? "rate" : "d");
  }));
}

// ---------- the live counter ----------
/** Debt at instant t (ms), extrapolated linearly from the last published quarter at the last four quarters' pace. */
const debtAt = (e: Economy, t: number) => e.debt.eur + (e.debt.ratePerYear * (t - Date.parse(e.debt.asOf))) / YEAR_MS;

/** Calls `fn` every frame (or once a second with reduced motion) until `root` leaves the page. */
function tick(root: Element, fn: (now: number) => void) {
  const slow = reduced();
  const step = () => {
    if (!root.isConnected) return;
    fn(Date.now());
    if (slow) setTimeout(step, 1000);
    else requestAnimationFrame(step);
  };
  step();
}

const label = (q: Equivalent, n: number) => {
  const [one, many] = getLang() === "fr" ? q.fr : q.en;
  return getLang() === "fr" ? (n >= 2 ? many : one) : n === 1 ? one : many;
};
const count = (n: number) => (n < 10 ? num(n, 1) : num(Math.floor(n)));

export async function renderEconomy(app: HTMLElement) {
  const e = await loadEconomy();
  const by = new Map(e.kpis.map((k) => [k.id, k]));
  const fr = getLang() === "fr";
  const perSec = e.debt.ratePerYear / (YEAR_MS / 1000);
  const perDay = perSec * 86400;
  const { population, employed } = e.people;
  const interest = by.get("interest");
  const items: Equivalent[] = [
    ...EQUIVALENTS,
    ...(interest ? [{
      id: "interest", cost: interest.value / 365,
      fr: ["journée d’intérêts de la dette publique", "journées d’intérêts de la dette publique"] as [string, string],
      en: ["day of interest on the public debt", "days of interest on the public debt"] as [string, string],
      srcFr: `Intérêts versés par les administrations publiques en ${interest.period}, ${big(interest.value)} (Eurostat), divisés par 365.`,
      srcEn: `Interest paid by general government in ${interest.period}, ${big(interest.value)} (Eurostat), divided by 365.`,
      url: interest.source.url ?? undefined,
    }] : []),
  ].sort((a, b) => a.cost - b.cost);
  const basis = e.debt.rateBasis === "4q" && e.debt.rateFrom
    ? L(`la hausse observée entre la fin du ${period(e.debt.rateFrom)} et la fin du ${period(e.debt.rateTo)}`, `the increase between the end of ${period(e.debt.rateFrom)} and the end of ${period(e.debt.rateTo)}`)
    : L("le déficit public de la dernière année", "the latest annual budget deficit");

  app.innerHTML = `
    <section class="page economy">
      <header class="page-head">
        <p class="eyebrow">${L("La France en chiffres", "France in numbers")}</p>
        <h1>${L("La dette publique, à la seconde près", "The public debt, to the second")}</h1>
        <p class="dek">${fr
          ? `Le dernier chiffre officiel date de la fin du ${period(e.debt.period)}\u00a0: ${big(e.debt.eur)}. Depuis, elle a continué. Estimation à cet instant, au rythme de l’année écoulée, soit environ ${eur(Math.round(perSec))} par seconde, nuits et week-ends compris.`
          : `The latest official figure is for the end of ${period(e.debt.period)}: ${big(e.debt.eur)}. It has carried on since. Estimated as of now, at the past year’s pace: about ${eur(Math.round(perSec))} a second, nights and weekends included.`}</p>
        <div class="debt-live" aria-live="off">
          <p class="debt-k">${L("Dette publique estimée", "Estimated public debt")}</p>
          <p class="debt-n" id="debt-n">${eur(Math.round(debtAt(e, Date.now())))}</p>
          <p class="debt-per">
            <span><b id="debt-pop">–</b> ${L("par habitant", "per resident")}</span><span class="debt-sep" aria-hidden="true"> · </span>
            <span><b id="debt-emp">–</b> ${L("par personne en emploi", "per person in work")}</span><span class="debt-sep" aria-hidden="true"> · </span>
            <span><b>${big(perDay, 0)}</b> ${L("de plus chaque jour", "added each day")}</span>${e.debt.pct != null ? `<span class="debt-sep" aria-hidden="true"> · </span>
            <span><b>${pct(e.debt.pct)}</b> ${L(`du PIB (${period(e.debt.period)})`, `of GDP (${period(e.debt.period)})`)}</span>` : ""}
          </p>
        </div>
      </header>

      <section class="card since" id="depuis">
        <header class="card-head"><h2>${L("Depuis que vous êtes sur cette page", "Since you opened this page")}</h2><span class="since-t" id="since-t"></span></header>
        <div class="since-grid">
          <div>
            <p class="since-n" id="since-n">${eur(0)}</p>
            <p class="since-what" id="since-what"></p>
          </div>
          <ol class="since-list" id="since-list">${items
            .map((q) => `<li data-eq="${q.id}" class="locked">
              <div class="sl-row"><span class="sl-name">${esc(label(q, 2))}</span><span class="sl-n" data-n></span></div>
              <p class="sl-src"><b>${esc(q.cost < 1e6 ? eur(Math.round(q.cost)) : big(q.cost))}</b> ·${q.url ? `<a href="${esc(safeUrl(q.url))}" target="_blank" rel="noopener">${esc(fr ? q.srcFr : q.srcEn)}</a>` : esc(fr ? q.srcFr : q.srcEn)}</p>
            </li>`)
            .join("")}</ol>
        </div>
      </section>

      <section class="card" id="indicateurs">
        <header class="card-head"><h2>${L("Les grands indicateurs", "The headline indicators")}</h2><a href="#/chiffres#methode">${L("Méthode", "Method")}</a></header>
        <p class="muted small">${L("Dernière valeur officielle de chaque série, sa date et son évolution sur cinq ans environ.", "The latest official value of each series, its date, and roughly five years of history.")}</p>
        <div class="eco-grid">${DEFS.filter((d) => by.has(d.id)).map((d) => kpiCard(d, by.get(d.id)!, by)).join("")}</div>
      </section>

      ${debtSection(e)}

      <details class="card eco-method" id="methode">
        <summary>${L("Comment le compteur est calculé", "How the counter works")}</summary>
        <ul class="small">
          <li>${fr
            ? `Point de départ\u00a0: la dette publique au sens de Maastricht à la fin du ${period(e.debt.period)}, ${eur(e.debt.eur)}, publiée par l’INSEE et Eurostat environ trois mois plus tard.`
            : `Starting point: Maastricht public debt at the end of ${period(e.debt.period)}, ${eur(e.debt.eur)}, published by INSEE and Eurostat about three months later.`}</li>
          <li>${fr
            ? `Rythme\u00a0: ${basis}, soit ${big(e.debt.ratePerYear)} sur un an, réparti uniformément à la seconde.`
            : `Pace: ${basis}, ${big(e.debt.ratePerYear)} over a year, spread evenly over every second.`}</li>
          <li>${L(
            "En réalité, la dette ne monte pas en ligne droite : elle suit le calendrier des émissions de l’Agence France Trésor et la trésorerie de l’État, et peut baisser d’un trimestre à l’autre. Le compteur donne un ordre de grandeur, pas un relevé.",
            "In reality the debt does not rise in a straight line: it follows the Agence France Trésor’s issuance calendar and the state’s cash position, and can fall from one quarter to the next. The counter gives an order of magnitude, not a reading.",
          )}</li>
          <li>${fr
            ? `Par habitant\u00a0: ${num(population)} habitants au 1er janvier ${e.people.populationPeriod}. Par personne en emploi\u00a0: ${num(employed)} personnes en emploi en ${e.people.employedPeriod} (comptes nationaux).`
            : `Per resident: ${num(population)} residents on 1 January ${e.people.populationPeriod}. Per person in work: ${num(employed)} people in employment in ${e.people.employedPeriod} (national accounts).`}</li>
          <li>${L(
            "Les équivalents sont des coûts publiés et datés, cités sous chaque ligne. Ils servent d’échelle, pas de proposition budgétaire.",
            "The equivalents are published, dated costs, cited under each line. They are there for scale, not as a budget proposal.",
          )}</li>
        </ul>
      </details>

      <p class="source">${L("Sources", "Sources")}${colon()}Eurostat (API de diffusion), INSEE (Banque de données macroéconomiques). ${L("Données mises à jour le", "Data refreshed")} ${fmtDate(e.fetchedAt)}.</p>
    </section>`;

  // ---------- live ----------
  const $ = <T extends Element>(s: string) => app.querySelector<T>(s)!;
  const nEl = $("#debt-n"), popEl = $("#debt-pop"), empEl = $("#debt-emp");
  const sinceN = $("#since-n"), sinceT = $("#since-t"), sinceWhat = $("#since-what");
  const rows = items.map((q) => ({ q, li: app.querySelector<HTMLElement>(`[data-eq="${q.id}"]`)!, n: app.querySelector<HTMLElement>(`[data-eq="${q.id}"] [data-n]`)! }));
  const t0 = Date.now();
  let lastSlow = 0;
  tick(nEl, (now) => {
    const d = debtAt(e, now);
    nEl.textContent = eur(Math.round(d));
    const added = (perSec * (now - t0)) / 1000;
    sinceN.textContent = eur(Math.floor(added));
    if (now - lastSlow < 200) return; // the rest changes slowly: four updates a second is plenty
    lastSlow = now;
    popEl.textContent = eur(d / population, 2);
    empEl.textContent = eur(d / employed, 2);
    sinceT.textContent = duration(now - t0);
    let top: { q: Equivalent; n: number } | null = null;
    for (const r of rows) {
      const n = added / r.q.cost;
      const on = n >= 1;
      r.li.classList.toggle("locked", !on);
      if (on) top = { q: r.q, n };
      r.n.textContent = on ? `≈ ${count(n)}` : L(`dans ${duration(((r.q.cost - added) / perSec) * 1000)}`, `in ${duration(((r.q.cost - added) / perSec) * 1000)}`);
      const name = r.li.querySelector(".sl-name")!;
      const want = label(r.q, on ? n : 2);
      if (name.textContent !== want) name.textContent = want;
    }
    sinceWhat.textContent = top
      ? fr ? `Soit environ ${count(top.n)} ${label(top.q, top.n)}.` : `About ${count(top.n)} ${label(top.q, top.n)}.`
      : L(`Pas encore une ${label(items[0], 1)}.`, `Not yet one ${label(items[0], 1)}.`);
  });

  mountDebtChart(app, e);

  const md = app.querySelector<HTMLDetailsElement>("#methode");
  app.querySelectorAll('a[href="#/chiffres#methode"]').forEach((x) => x.addEventListener("click", () => md && (md.open = true)));
  if (md && location.hash.endsWith("#methode")) md.open = true;
}
