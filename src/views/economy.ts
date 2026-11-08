// "La France en chiffres": the main economic indicators (public/data/economy.json, scripts/sync-economy.mjs),
// a live public-debt counter extrapolated from the latest quarterly Maastricht figure, and the debt added
// since the reader opened the page, translated into things public money buys (src/lib/equivalents.ts).
import { fetchJson } from "../data";
import { L, fmtDate, getLang } from "../i18n";
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
          ? `Le dernier chiffre officiel date de la fin du ${period(e.debt.period)} : ${big(e.debt.eur)}. Depuis, elle a continué. Estimation à cet instant, au rythme de l’année écoulée, soit environ ${eur(Math.round(perSec))} par seconde, nuits et week-ends compris.`
          : `The latest official figure is for the end of ${period(e.debt.period)}: ${big(e.debt.eur)}. It has carried on since. Estimated as of now, at the past year’s pace: about ${eur(Math.round(perSec))} a second, nights and weekends included.`}</p>
        <div class="debt-live" aria-live="off">
          <p class="debt-k">${L("Dette publique estimée", "Estimated public debt")}</p>
          <p class="debt-n" id="debt-n">${eur(Math.round(debtAt(e, Date.now())))}</p>
          <dl class="debt-per">
            <div><dt>${L("Par habitant", "Per resident")}</dt><dd id="debt-pop">–</dd></div>
            <div><dt>${L("Par personne en emploi", "Per person in work")}</dt><dd id="debt-emp">–</dd></div>
            <div><dt>${L("En plus chaque jour", "Added each day")}</dt><dd>${big(perDay, 0)}</dd></div>
            ${e.debt.pct != null ? `<div><dt>${L(`Rapportée au PIB, ${period(e.debt.period)}`, `As a share of GDP, ${period(e.debt.period)}`)}</dt><dd>${pct(e.debt.pct)}</dd></div>` : ""}
          </dl>
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

      <details class="card eco-method" id="methode">
        <summary>${L("Comment le compteur est calculé", "How the counter works")}</summary>
        <ul class="small">
          <li>${fr
            ? `Point de départ : la dette publique au sens de Maastricht à la fin du ${period(e.debt.period)}, ${eur(e.debt.eur)}, publiée par l’INSEE et Eurostat environ trois mois plus tard.`
            : `Starting point: Maastricht public debt at the end of ${period(e.debt.period)}, ${eur(e.debt.eur)}, published by INSEE and Eurostat about three months later.`}</li>
          <li>${fr
            ? `Rythme : ${basis}, soit ${big(e.debt.ratePerYear)} sur un an, réparti uniformément à la seconde.`
            : `Pace: ${basis}, ${big(e.debt.ratePerYear)} over a year, spread evenly over every second.`}</li>
          <li>${L(
            "En réalité, la dette ne monte pas en ligne droite : elle suit le calendrier des émissions de l’Agence France Trésor et la trésorerie de l’État, et peut baisser d’un trimestre à l’autre. Le compteur donne un ordre de grandeur, pas un relevé.",
            "In reality the debt does not rise in a straight line: it follows the Agence France Trésor’s issuance calendar and the state’s cash position, and can fall from one quarter to the next. The counter gives an order of magnitude, not a reading.",
          )}</li>
          <li>${fr
            ? `Par habitant : ${num(population)} habitants au 1er janvier ${e.people.populationPeriod}. Par personne en emploi : ${num(employed)} personnes en emploi en ${e.people.employedPeriod} (comptes nationaux).`
            : `Per resident: ${num(population)} residents on 1 January ${e.people.populationPeriod}. Per person in work: ${num(employed)} people in employment in ${e.people.employedPeriod} (national accounts).`}</li>
          <li>${L(
            "Les équivalents sont des coûts publiés et datés, cités sous chaque ligne. Ils servent d’échelle, pas de proposition budgétaire.",
            "The equivalents are published, dated costs, cited under each line. They are there for scale, not as a budget proposal.",
          )}</li>
        </ul>
      </details>

      <p class="source">${L("Sources", "Sources")} : Eurostat (API de diffusion), INSEE (Banque de données macroéconomiques). ${L("Données mises à jour le", "Data refreshed")} ${fmtDate(e.fetchedAt)}.</p>
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

  const md = app.querySelector<HTMLDetailsElement>("#methode");
  app.querySelectorAll('a[href="#/chiffres#methode"]').forEach((x) => x.addEventListener("click", () => md && (md.open = true)));
  if (md && location.hash.endsWith("#methode")) md.open = true;
}

/** One-line live debt figure for the homepage, linking to the page. */
export async function mountDebtTeaser(el: HTMLElement | null) {
  if (!el) return;
  const e = await loadEconomy().catch(() => null);
  if (!e || !el.isConnected) return;
  const perSec = e.debt.ratePerYear / (YEAR_MS / 1000);
  el.innerHTML = `<a class="debt-teaser" href="#/chiffres">
    <span class="hx-k">${L("Dette publique, estimée à cet instant", "Public debt, estimated as of now")}</span>
    <strong id="teaser-n">${eur(Math.round(debtAt(e, Date.now())))}</strong>
    <span>${L(`environ ${eur(Math.round(perSec))} de plus par seconde. La France en chiffres`, `about ${eur(Math.round(perSec))} more every second. France in numbers`)}</span>
  </a>`;
  const n = el.querySelector<HTMLElement>("#teaser-n")!;
  tick(n, (now) => { n.textContent = eur(Math.round(debtAt(e, now))); });
}
