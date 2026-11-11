// Household simulator: what Jean-Luc Mélenchon's 2027 programme would change for one household, measure by
// measure, and who bears the programme's tax increases across the income distribution.
// Rules: src/lib/household-rules.ts (pure, tested by scripts/test-household.ts). Distribution data and sources:
// public/data/programmes/melenchon-household.json. Route: #/programmes/melenchon/simulateur.
// Tone: estimates, not verdicts. Every line links to the programme measure; every assumption is shown.
import { fetchJson } from "../data";
import { L, fmtNum, fmtPct as pctRaw } from "../i18n";
import { esc, safeUrl } from "../util";
import {
  simulate, incomeTax, DEFAULT_HOUSEHOLD, IR_2026, IR_LFI_14, IR_LFI_SOURCE, SMIC_NET_2026, POVERTY_LINE,
  type Household, type Job, type Line, type Result, type Status, type T,
} from "../lib/household-rules";

interface Group { id: string; fr: string; en: string; share: number; nv: number; lo: number; taxable: number; assumption?: boolean }
interface DMeasure { id: string; lineage: string; revenue: number; fr: string; en: string; shares: Record<string, number>; keyFr: string; keyEn: string }
interface DistFile { checked: string; households: number; ucPerHousehold: number; groups: Group[]; measures: DMeasure[]; sources: { title: string; url: string }[] }

const SLUG = "melenchon";
const PROG = `#/programmes/${SLUG}`;
const KEY = "te-household";
const tr = (x: T) => L(x.fr, x.en);
const eur = (n: number) => `${fmtNum(Math.round(n))}${L(" €", " €")}`;
const signedEur = (n: number) => (Math.round(n) === 0 ? eur(0) : `${n > 0 ? "+" : "−"}${fmtNum(Math.abs(Math.round(n)))}${L(" €", " €")}`);
const measureHref = (id: string) => `${PROG}#m-${id}`;
/** Percent with a true minus sign. */
const fmtPct = (n: number, d = 1) => pctRaw(n, d).replace("-", "−");
/** A tax amount: plain when it is a rise, with a minus when it is a cut. */
const taxEur = (n: number) => (Math.round(n) < 0 ? `−${eur(-n)}` : eur(n));

const JOBS: [Job, T][] = [
  ["private", { fr: "Salarié·e du privé", en: "Private-sector employee" }],
  ["public", { fr: "Fonctionnaire", en: "Civil servant" }],
  ["self", { fr: "Indépendant·e", en: "Self-employed" }],
  ["retired", { fr: "Retraité·e", en: "Retired" }],
  ["unemployed", { fr: "Au chômage (indemnisé)", en: "Unemployed (on benefit)" }],
  ["student", { fr: "Étudiant·e", en: "Student" }],
  ["inactive", { fr: "Sans activité", en: "Not working" }],
];
const incomeLabel = (j: Job) => ({
  private: L("Salaire net mensuel", "Net monthly pay"), public: L("Salaire net mensuel", "Net monthly pay"),
  self: L("Revenu net mensuel", "Net monthly income"), retired: L("Pension nette mensuelle", "Net monthly pension"),
  unemployed: L("Allocation chômage nette mensuelle", "Net monthly jobless benefit"), student: L("Revenu net mensuel", "Net monthly income"),
  inactive: L("Revenu net mensuel", "Net monthly income"),
}[j]);

const WEALTH_BANDS: [number, T][] = [
  [0, { fr: "Moins de 1,3 M€ (ou aucun)", en: "Under €1.3m (or none)" }],
  [1.6e6, { fr: "1,3 à 2 M€", en: "€1.3m to €2m" }],
  [3.2e6, { fr: "2 à 5 M€", en: "€2m to €5m" }],
  [7e6, { fr: "5 à 10 M€", en: "€5m to €10m" }],
  [25e6, { fr: "10 à 50 M€", en: "€10m to €50m" }],
  [70e6, { fr: "50 à 100 M€", en: "€50m to €100m" }],
  [300e6, { fr: "100 M€ à 1 Md€", en: "€100m to €1bn" }],
  [3e9, { fr: "Plus de 1 Md€", en: "Over €1bn" }],
];
const INHERIT_BANDS: [number, T][] = [
  [0, { fr: "Aucun", en: "None" }],
  [60000, { fr: "Moins de 100 000 €", en: "Under €100,000" }],
  [125000, { fr: "100 000 à 150 000 €", en: "€100,000 to €150,000" }],
  [300000, { fr: "150 000 à 500 000 €", en: "€150,000 to €500,000" }],
  [1e6, { fr: "500 000 € à 2 M€", en: "€500,000 to €2m" }],
  [5e6, { fr: "2 à 12 M€", en: "€2m to €12m" }],
  [30e6, { fr: "Plus de 12 M€", en: "Over €12m" }],
];

function loadState(): Household {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Household | null;
    if (s && Array.isArray(s.adults) && s.kids) return sanitize(s);
  } catch { /* storage blocked: defaults */ }
  return structuredClone(DEFAULT_HOUSEHOLD);
}
/** Saved state is untrusted (it can be edited by hand): keep only known values and finite, bounded numbers. */
function sanitize(s: Partial<Household>): Household {
  const d = DEFAULT_HOUSEHOLD;
  const n = (v: unknown, def: number, max = 1e10) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : def; };
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T) => (ok.includes(v as T) ? (v as T) : def);
  const JOBS = ["private", "public", "self", "retired", "unemployed", "student", "inactive"] as const;
  const adults = (Array.isArray(s.adults) ? s.adults : d.adults).slice(0, 2).map((a) => ({ job: pick(a?.job, JOBS, "private"), net: n(a?.net, 1478, 1e7), ...(a?.fullCareer ? { fullCareer: true } : {}) }));
  const k = (s.kids ?? d.kids) as Partial<Household["kids"]>;
  return {
    status: pick(s.status, ["single", "married", "cohab"] as const, "single"), adults: adults.length ? adults : structuredClone(d.adults),
    kids: { u3: n(k.u3, 0, 12), k3_10: n(k.k3_10, 0, 12), k11_17: n(k.k11_17, 0, 12), s18_24: n(k.s18_24, 0, 12) },
    housing: pick(s.housing, ["tenant", "owner", "other"] as const, "tenant"),
    rent: n(s.rent, d.rent, 1e5), apl: n(s.apl, 0, 1e5), benefits: n(s.benefits, 0, 1e5), capital: n(s.capital, 0), wealth: n(s.wealth, 0, 1e12),
    realEstate: n(s.realEstate, 0, 1e12), inheritance: n(s.inheritance, 0, 1e12), mutuelle: s.mutuelle == null ? null : n(s.mutuelle, 0, 1e4), canteen: s.canteen !== false,
  };
}
function saveState(h: Household) { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* ignore */ } }

export async function renderHousehold(app: HTMLElement) {
  const dist = await fetchJson<DistFile>(`/data/programmes/${SLUG}-household.json`).catch(() => null);
  const h = loadState();

  app.innerHTML = `
    <section class="page hh">
      <div class="page-head">
        <p class="eyebrow">${L("Programmes 2027", "2027 programmes")} · Jean-Luc Mélenchon · ${L("Simulateur", "Simulator")}</p>
        <h1>${L("Le programme de Mélenchon vous coûterait-il ou vous rapporterait-il ?", "Would Mélenchon’s programme cost you or pay you?")}</h1>
        <p class="dek">${L(
          "Décrivez votre foyer : le simulateur applique les mesures chiffrables de L’Avenir en commun (version 2027) aux règles fiscales et sociales de 2026, mesure par mesure. Ce sont des estimations : chaque hypothèse est affichée.",
          "Describe your household: the simulator applies the measures of L’Avenir en commun (2027 version) that can be costed to 2026 tax and benefit rules, measure by measure. These are estimates: every assumption is shown.")}</p>
        <nav class="prog-jump" aria-label="${L("Sur cette page", "On this page")}">
          <a href="#/programmes/${SLUG}/simulateur#hh-sim">${L("Votre foyer", "Your household")}</a>
          <a href="#/programmes/${SLUG}/simulateur#repartition">${L("Qui paie les hausses d’impôts", "Who pays the tax rises")}</a>
          <a href="#/programmes/${SLUG}/simulateur#hypotheses">${L("Hypothèses et sources", "Assumptions and sources")}</a>
          <a href="${PROG}">${L("Le programme, mesure par mesure", "The programme, measure by measure")}</a>
        </nav>
      </div>

      <div class="hh-grid" id="hh-sim">
        <form class="hh-form" id="hhf" autocomplete="off">
          <fieldset>
            <legend>${L("Votre situation", "Your situation")}</legend>
            <div class="small-tabs hh-status" role="radiogroup" aria-label="${L("Situation familiale", "Family status")}">
              ${([["single", L("Seul·e", "Single")], ["married", L("Marié·e ou pacsé·e", "Married or civil union")], ["cohab", L("En couple, non marié·e", "Couple, not married")]] as [Status, string][])
                .map(([v, lab]) => `<button type="button" role="radio" data-status="${v}" aria-checked="${h.status === v}">${lab}</button>`).join("")}
            </div>
            <div id="hh-adults"></div>
          </fieldset>
          <fieldset>
            <legend>${L("Enfants à charge", "Dependent children")}</legend>
            <div class="hh-kids">
              ${([["u3", L("Moins de 3 ans", "Under 3")], ["k3_10", L("3 à 10 ans", "3 to 10")], ["k11_17", L("11 à 17 ans", "11 to 17")], ["s18_24", L("18 à 24 ans, étudiants", "18 to 24, students")]] as [keyof Household["kids"], string][])
                .map(([k, lab]) => `<label>${lab}<input type="number" inputmode="numeric" min="0" max="12" step="1" data-kid="${k}" value="${h.kids[k]}"></label>`).join("")}
            </div>
            <label class="check"><input type="checkbox" id="hh-canteen" ${h.canteen ? "checked" : ""}> ${L("Les enfants mangent à la cantine", "The children eat school lunches")}</label>
          </fieldset>
          <fieldset>
            <legend>${L("Logement et aides", "Housing and benefits")}</legend>
            <div class="hh-row">
              <label>${L("Logement", "Housing")}<select id="hh-housing">
                <option value="tenant" ${h.housing === "tenant" ? "selected" : ""}>${L("Locataire", "Tenant")}</option>
                <option value="owner" ${h.housing === "owner" ? "selected" : ""}>${L("Propriétaire", "Owner")}</option>
                <option value="other" ${h.housing === "other" ? "selected" : ""}>${L("Logé·e gratuitement", "Housed for free")}</option>
              </select></label>
              <label class="hh-rent">${L("Loyer mensuel (hors charges)", "Monthly rent (excl. charges)")}<input type="number" inputmode="numeric" min="0" step="10" id="hh-rent" value="${h.rent}"></label>
              <label class="hh-rent">${L("APL par mois", "Housing benefit a month")}<input type="number" inputmode="numeric" min="0" step="10" id="hh-apl" value="${h.apl}"></label>
              <label>${L("Autres aides par mois (RSA, prime d’activité, AAH, ASPA…)", "Other benefits a month (RSA, prime d’activité, AAH, ASPA…)")}<input type="number" inputmode="numeric" min="0" step="10" id="hh-benefits" value="${h.benefits}"></label>
              <label>${L("Mutuelle par mois, part payée par le foyer", "Health insurance premium a month, household share")}<input type="number" inputmode="numeric" min="0" step="5" id="hh-mutuelle" value="${h.mutuelle ?? ""}" placeholder="${L("estimation automatique", "automatic estimate")}"></label>
            </div>
          </fieldset>
          <details class="hh-more" ${h.capital || h.wealth || h.inheritance ? "open" : ""}>
            <summary>${L("Épargne, patrimoine, héritage", "Savings, wealth, inheritance")}</summary>
            <div class="hh-row">
              <label>${L("Revenus du capital par an (dividendes, intérêts, plus-values hors livrets, PEA et assurance-vie)", "Capital income a year (dividends, interest, capital gains, excluding tax-free savings accounts, PEA and life insurance)")}<input type="number" inputmode="numeric" min="0" step="500" id="hh-capital" value="${h.capital}"></label>
              <label>${L("Patrimoine net taxable", "Net taxable wealth")}<select id="hh-wealth">${bandOptions(WEALTH_BANDS, h.wealth)}</select></label>
              <label>${L("dont immobilier", "of which property")}<select id="hh-re">${[0, 0.25, 0.5, 0.75, 1].map((s) => `<option value="${s}" ${Math.abs((h.wealth ? h.realEstate / h.wealth : 0.5) - s) < 0.01 ? "selected" : ""}>${fmtPct(s * 100, 0)}</option>`).join("")}</select></label>
              <label>${L("Héritage attendu (votre part, en ligne directe)", "Expected inheritance (your share, from a parent)")}<select id="hh-inherit">${bandOptions(INHERIT_BANDS, h.inheritance)}</select></label>
            </div>
          </details>
          <p class="muted small">${L("Rien n’est envoyé : le calcul se fait dans votre navigateur, qui garde vos réponses pour votre prochaine visite.", "Nothing is sent: the calculation runs in your browser, which keeps your answers for your next visit.")} <button type="button" class="linkish" id="hh-clear">${L("Effacer mes réponses", "Clear my answers")}</button></p>
        </form>
        <div class="hh-out" id="hh-out" aria-live="polite"></div>
      </div>

      <article class="card" id="repartition">
        <div class="card-head"><h2>${L("Qui paierait les hausses d’impôts du programme", "Who would pay the programme’s tax rises")}</h2></div>
        <div id="hh-dist">${dist ? "" : `<p class="muted">${L("Données de répartition indisponibles.", "Distribution data unavailable.")}</p>`}</div>
      </article>

      <article class="card" id="hypotheses">
        <div class="card-head"><h2>${L("Hypothèses, limites et sources", "Assumptions, limits and sources")}</h2></div>
        <div id="hh-assume"></div>
        ${notCounted()}
        ${paramsBlock()}
      </article>
    </section>`;

  const form = app.querySelector<HTMLFormElement>("#hhf")!;
  form.addEventListener("submit", (e) => e.preventDefault()); // no inline handler: the CSP allows no inline script
  // income and wealth answers stay in this browser until cleared (shared computers): one click forgets them
  app.querySelector("#hh-clear")?.addEventListener("click", () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } renderHousehold(app); });
  const out = app.querySelector<HTMLElement>("#hh-out")!;
  const adultsBox = app.querySelector<HTMLElement>("#hh-adults")!;

  const drawAdults = () => {
    adultsBox.innerHTML = h.adults.map((a, i) => `
      <div class="hh-adult" data-i="${i}">
        ${h.adults.length > 1 ? `<p class="hh-who">${i === 0 ? L("Adulte 1", "Adult 1") : L("Adulte 2", "Adult 2")}</p>` : ""}
        <div class="hh-row">
          <label>${L("Statut", "Status")}<select data-f="job">${JOBS.map(([v, lab]) => `<option value="${v}" ${a.job === v ? "selected" : ""}>${tr(lab)}</option>`).join("")}</select></label>
          <label><span data-lab>${incomeLabel(a.job)}</span><input type="number" inputmode="numeric" min="0" step="50" data-f="net" value="${a.net}"></label>
          ${a.job === "retired" ? `<label class="check"><input type="checkbox" data-f="full" ${a.fullCareer ? "checked" : ""}> ${L("Carrière complète", "Full career")}</label>` : ""}
        </div>
      </div>`).join("");
    adultsBox.querySelectorAll<HTMLElement>(".hh-adult").forEach((box) => {
      const i = Number(box.dataset.i);
      box.querySelector<HTMLSelectElement>("[data-f=job]")!.addEventListener("change", (e) => { h.adults[i].job = (e.target as HTMLSelectElement).value as Job; drawAdults(); update(); });
      box.querySelector<HTMLInputElement>("[data-f=net]")!.addEventListener("input", (e) => { h.adults[i].net = num((e.target as HTMLInputElement).value); update(); });
      box.querySelector<HTMLInputElement>("[data-f=full]")?.addEventListener("change", (e) => { h.adults[i].fullCareer = (e.target as HTMLInputElement).checked; update(); });
    });
  };

  const statusBtns = [...app.querySelectorAll<HTMLButtonElement>(".hh-status button")];
  statusBtns.forEach((b) => b.addEventListener("click", () => {
    h.status = b.dataset.status as Status;
    statusBtns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    if (h.status === "single") h.adults = h.adults.slice(0, 1);
    else if (h.adults.length < 2) h.adults.push({ job: "private", net: 1800 });
    drawAdults(); update();
  }));
  form.querySelectorAll<HTMLInputElement>("[data-kid]").forEach((inp) => inp.addEventListener("input", () => { h.kids[inp.dataset.kid as keyof Household["kids"]] = Math.min(12, Math.floor(num(inp.value))); update(); }));
  const bind = (id: string, ev: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void) => app.querySelector<HTMLInputElement & HTMLSelectElement>(id)!.addEventListener(ev, (e) => { fn(e.target as HTMLInputElement & HTMLSelectElement); update(); });
  bind("#hh-canteen", "change", (el) => (h.canteen = el.checked));
  bind("#hh-housing", "change", (el) => { h.housing = el.value as Household["housing"]; });
  bind("#hh-rent", "input", (el) => (h.rent = num(el.value)));
  bind("#hh-apl", "input", (el) => (h.apl = num(el.value)));
  bind("#hh-benefits", "input", (el) => (h.benefits = num(el.value)));
  bind("#hh-mutuelle", "input", (el) => (h.mutuelle = el.value.trim() === "" ? null : num(el.value)));
  bind("#hh-capital", "input", (el) => (h.capital = num(el.value)));
  const reSel = app.querySelector<HTMLSelectElement>("#hh-re")!;
  bind("#hh-wealth", "change", (el) => { h.wealth = Number(el.value); h.realEstate = h.wealth * Number(reSel.value); });
  bind("#hh-re", "change", (el) => (h.realEstate = h.wealth * Number(el.value)));
  bind("#hh-inherit", "change", (el) => (h.inheritance = Number(el.value)));

  // motion: the total counts up and the bars grow on the first render only (later edits update in place);
  // the distribution bars grow the first time they come into view
  out.classList.add("hh-first");
  setTimeout(() => out.classList.remove("hh-first"), 900);
  const distBox = app.querySelector<HTMLElement>("#hh-dist")!;
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      distBox.classList.add("hh-first");
      setTimeout(() => distBox.classList.remove("hh-first"), 1000);
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(distBox);
  }

  let timer = 0, first = true;
  function update() {
    app.querySelectorAll<HTMLElement>(".hh-rent").forEach((el) => (el.hidden = h.housing !== "tenant"));
    const r = simulate(h);
    out.innerHTML = resultHtml(r, first);
    first = false;
    app.querySelector("#hh-assume")!.innerHTML = `<ul class="hh-assume">${r.assumptions.map((a) => `<li>${esc(tr(a))}</li>`).join("")}</ul>`;
    if (dist) app.querySelector("#hh-dist")!.innerHTML = distHtml(dist, r);
    clearTimeout(timer);
    timer = window.setTimeout(() => saveState(h), 300);
  }
  drawAdults();
  update();
}

const num = (v: string) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
function bandOptions(bands: [number, T][], v: number) {
  const pick = bands.reduce((best, b) => (Math.abs(b[0] - v) < Math.abs(best[0] - v) ? b : best), bands[0])[0];
  return bands.map(([x, lab]) => `<option value="${x}" ${x === pick ? "selected" : ""}>${esc(tr(lab))}</option>`).join("");
}

// ---------- the result ----------
function resultHtml(r: Result, first: boolean): string {
  const total = r.total;
  const max = Math.max(1, ...r.lines.map((l) => Math.abs(l.amount)));
  const dir = total > 0 ? "gain" : total < 0 ? "loss" : "zero";
  const verdict = total > 0 ? L("de plus par an pour votre foyer", "more a year for your household")
    : total < 0 ? L("de moins par an pour votre foyer", "less a year for your household") : L("par an : pas de changement estimé", "a year: no estimated change");
  const sorted = [...r.lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return `
    <div class="hh-total is-${dir}">
      <p class="hh-k">${L("Effet estimé du programme", "Estimated effect of the programme")}</p>
      <p class="hh-big"><strong${first ? " data-count" : ""}>${signedEur(total)}</strong></p>
      <p class="hh-verdict">${verdict} · ${L("soit", "that is")} ${signedEur(total / 12)} ${L("par mois", "a month")}</p>
      <p class="hh-sub muted small">${L("Impôt sur le revenu", "Income tax")}${L(" : ", ": ")}${eur(r.irToday)} ${L("aujourd’hui", "today")} → ${eur(r.irReform)} ${L("avec le programme (revenus du capital compris)", "under the programme (capital income included)")}</p>
    </div>
    <ol class="hh-lines">${sorted.map((l) => lineHtml(l, max)).join("")}</ol>
    ${r.oneOff.length ? `<div class="hh-oneoff"><p class="hh-k">${L("Une seule fois, non compté dans le total annuel", "Once only, not counted in the yearly total")}</p><ol class="hh-lines">${r.oneOff.map((l) => lineHtml(l, Math.max(max, Math.abs(l.amount)))).join("")}</ol></div>` : ""}
    <p class="muted small">${L("Positif : le foyer y gagne. Négatif : il paie davantage. « Hypothèse » : le programme ne donne pas le chiffre, la valeur retenue est expliquée.", "Positive: the household gains. Negative: it pays more. ‘Assumption’: the programme gives no figure; the value used is explained.")}</p>`;
}

function lineHtml(l: Line, max: number): string {
  const w = Math.min(100, (100 * Math.abs(l.amount)) / max);
  const side = l.amount >= 0 ? "pos" : "neg";
  return `<li class="hh-line">
    <div class="hh-lh"><span class="hh-name">${esc(tr(l.label))}${l.assumption ? ` <span class="tag">${L("hypothèse", "assumption")}</span>` : ""}</span><b class="hh-amt is-${side}">${signedEur(l.amount)}</b></div>
    <div class="hh-bar" aria-hidden="true"><span class="is-${side}" style="--w:${w.toFixed(1)}%"></span></div>
    <p class="hh-note">${esc(tr(l.note))} <a href="${esc(measureHref(l.measure))}">${L("La mesure", "The measure")}</a></p>
  </li>`;
}

// ---------- distribution ----------
const COLORS: Record<string, string> = { ir14: "#8b9099", flat: "#4a4f5a", isf: "#b46a2a", zucman: "#111216", succ: "#c9a227" };

interface Row { g: Group; parts: { id: string; v: number }[]; total: number; dispo: number; pct: number }
function distRows(d: DistFile): Row[] {
  return d.groups.map((g) => {
    const hh = d.households * g.share;
    const ir = incomeTax(g.taxable, { couple: true, nKids: 0, isolated: false, brackets: IR_LFI_14 }) - incomeTax(g.taxable, { couple: true, nKids: 0, isolated: false, brackets: IR_2026 });
    const parts = [{ id: "ir14", v: ir }, ...d.measures.map((m) => ({ id: m.id, v: ((m.shares[g.id] ?? 0) * m.revenue * 1e9) / hh }))];
    const total = parts.reduce((s, p) => s + p.v, 0);
    const dispo = g.nv * d.ucPerHousehold;
    return { g, parts, total, dispo, pct: (100 * total) / dispo };
  });
}

function distHtml(d: DistFile, r: Result): string {
  const rows = distRows(d);
  const SCALE = 12; // % of disposable income at full width; longer bars are cut and labelled
  const NEG = 2; // room left of zero for gains
  const span = SCALE + NEG;
  const x0 = (100 * NEG) / span;
  const mine = [...d.groups].reverse().find((g) => r.nivVie >= g.lo) ?? d.groups[0];
  const rawPct = r.disposable > 0 ? (100 * r.taxRise) / r.disposable : 0;
  const myPct = Math.abs(rawPct) < 0.05 ? 0 : rawPct;
  const names: Record<string, string> = { ir14: L("Impôt sur le revenu à 14 tranches", "14-bracket income tax"), ...Object.fromEntries(d.measures.map((m) => [m.id, L(m.fr, m.en)])) };
  const lineage: Record<string, string> = { ir14: "L846994", ...Object.fromEntries(d.measures.map((m) => [m.id, m.lineage])) };
  const totalRev = d.measures.reduce((s, m) => s + m.revenue, 0);
  const bar = (row: Row) => {
    let pos = 0, neg = 0;
    // a row beyond the scale keeps its composition: its positive segments are shrunk to fit, and it is labelled
    const posSum = row.parts.reduce((s, p) => s + Math.max(0, (100 * p.v) / row.dispo), 0);
    const k = posSum > SCALE ? SCALE / posSum : 1;
    const segs = row.parts.map((p) => {
      const real = (100 * p.v) / row.dispo;
      const pct = real >= 0 ? real * k : real;
      if (Math.abs(pct) < 0.005) return "";
      let left: number, width: number;
      if (pct >= 0) { left = x0 + (100 * pos) / span; width = (100 * pct) / span; pos += pct; }
      else { neg += -pct; width = (100 * Math.min(-pct, NEG)) / span; left = x0 - (100 * Math.min(neg, NEG)) / span; }
      if (width <= 0) return "";
      return `<i style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${COLORS[p.id] ?? "#999"}" title="${esc(names[p.id])}${L(" : ", ": ")}${fmtPct(real, 2)}"></i>`;
    }).join("");
    const cut = k < 1 ? `<em class="hh-cut">${fmtPct(row.pct, 0)} · ${L("barre réduite", "bar shortened")}</em>` : "";
    const me = row.g.id === mine.id ? `<b class="hh-me" style="left:${(x0 + (100 * Math.max(-NEG, Math.min(SCALE, myPct))) / span).toFixed(2)}%" title="${L("Votre foyer", "Your household")}"></b>` : "";
    return `<div class="hh-dbar">${segs}<span class="hh-zero" style="left:${x0.toFixed(2)}%"></span>${me}${cut}</div>`;
  };
  return `
    <p class="dek-s">${L(
      `Le programme chiffre ses nouvelles recettes pour 2027 à 106 Md€, dont ${fmtNum(totalRev)} Md€ pour quatre impôts sur le capital et le patrimoine. Ce graphique répartit ces quatre impôts, plus le barème à 14 tranches, entre les ménages classés par niveau de vie, en part de leur revenu disponible.`,
      `The programme puts its new revenue for 2027 at €106bn, of which €${fmtNum(totalRev)}bn from four taxes on capital and wealth. This chart spreads those four taxes, plus the 14-bracket scale, across households ranked by standard of living, as a share of their disposable income.`)}</p>
    <ul class="hh-legend">${Object.keys(names).map((id) => `<li><i style="background:${COLORS[id]}"></i><a href="${esc(measureHref(lineage[id]))}">${esc(names[id])}</a></li>`).join("")}<li><b class="hh-me-key"></b>${L("Votre foyer", "Your household")}</li></ul>
    <div class="hh-dist" role="img" aria-label="${esc(L("Hausses d’impôts par dixième de niveau de vie, en % du revenu disponible", "Tax rises by tenth of standard of living, as % of disposable income"))}">
      <div class="hh-axis"><span style="left:0">−${NEG} %</span><span style="left:${x0.toFixed(2)}%">0</span><span style="left:${(x0 + (100 * 6) / span).toFixed(2)}%">6 %</span><span style="left:100%">${SCALE} %</span></div>
      ${rows.map((row) => `<div class="hh-drow${row.g.id === mine.id ? " is-me" : ""}">
        <span class="hh-dlab">${esc(L(row.g.fr, row.g.en))}${row.g.id === mine.id ? ` <span class="tag">${L("vous", "you")}</span>` : ""}</span>
        ${bar(row)}
        <span class="hh-dval"><b>${fmtPct(row.pct, row.pct >= 10 ? 0 : 1)}</b> ${taxEur(row.total)}</span>
      </div>`).join("")}
    </div>
    <p class="hh-mine">${L(
      `Votre foyer : niveau de vie estimé ${eur(r.nivVie)} par an et par unité de consommation, soit le groupe « ${esc(mine.fr)} » (repéré par le trait vertical). Hausses d’impôts estimées pour vous : ${eur(Math.max(0, r.taxRise))}${r.taxRise < 0 ? ` (baisse de ${eur(-r.taxRise)})` : ""}, ${fmtPct(myPct, 1)} de votre revenu disponible ; moyenne du groupe : ${taxEur(rows.find((x) => x.g.id === mine.id)!.total)}.`,
      `Your household: estimated standard of living ${eur(r.nivVie)} a year per consumption unit, which is the “${esc(mine.en)}” group. Estimated tax rises for you: ${eur(Math.max(0, r.taxRise))}${r.taxRise < 0 ? ` (a cut of ${eur(-r.taxRise)})` : ""}, ${fmtPct(myPct, 1)} of your disposable income; group average: ${taxEur(rows.find((x) => x.g.id === mine.id)!.total)}.`)}</p>
    <details class="hh-table">
      <summary>${L("Le détail en euros par ménage et par an", "The detail in euros per household a year")}</summary>
      <div class="table-scroll"><table class="table">
        <thead><tr><th>${L("Groupe", "Group")}</th><th class="num">${L("Niveau de vie moyen", "Mean standard of living")}</th>${Object.keys(names).map((id) => `<th class="num">${esc(names[id])}</th>`).join("")}<th class="num">${L("Total", "Total")}</th><th class="num">${L("% du revenu disponible", "% of disposable income")}</th></tr></thead>
        <tbody>${rows.map((row) => `<tr${row.g.id === mine.id ? ` class="is-me"` : ""}><td>${esc(L(row.g.fr, row.g.en))}${row.g.assumption ? "*" : ""}</td><td class="num">${eur(row.g.nv)}</td>${row.parts.map((p) => `<td class="num">${taxEur(p.v)}</td>`).join("")}<td class="num"><b>${taxEur(row.total)}</b></td><td class="num">${fmtPct(row.pct, 1)}</td></tr>`).join("")}</tbody>
      </table></div>
    </details>
    <div class="hh-uncert">
      <h3>${L("Ce que ce graphique ne dit pas, et sa marge d’erreur", "What this chart does not say, and its margin of error")}</h3>
      <ul>
        <li>${L("Aucune étude indépendante (IPP, OFCE, Insee) n’a publié de répartition par dixième du programme 2027. Le seul exercice par dixième sur un programme proche (NFP 2024) vient de la Fondation iFRAP, think tank libéral : selon lui la hausse se concentre sur les trois derniers dixièmes, le dixième le plus aisé voyant son taux d’imposition directe monter de 10 points.", "No independent study (IPP, OFCE, Insee) has published a breakdown by tenth for the 2027 programme. The only such exercise on a close programme (NFP 2024) comes from Fondation iFRAP, a free-market think tank: in its view the rise falls on the top three tenths, with the top tenth's direct tax rate rising 10 points.")}</li>
        <li>${L("Les recettes par impôt sont celles annoncées par LFI le 14 octobre 2026 (ISF climatique 10 Md€, taxe Zucman 15, successions 20, fin de la flat tax 9). Les estimations indépendantes des programmes précédents étaient nettement plus basses ; la taxe Zucman est chiffrée entre 5 et 25 Md€ selon les auteurs et les hypothèses d’exil ou d’optimisation. Si une recette est deux fois plus faible, la barre correspondante l’est aussi.", "Revenue per tax is what LFI announced on 14 October 2026 (climate wealth tax €10bn, Zucman tax 15, inheritance 20, end of the flat tax 9). Independent estimates of previous programmes were markedly lower; the Zucman tax is put at €5bn to €25bn depending on the authors and assumptions about exile or tax planning. If a yield is half as large, so is its bar.")}</li>
        <li>${L("Les clés de répartition entre groupes sont des hypothèses de Third Estate, détaillées ci-dessous ; pour la flat tax elles s’appuient sur les données fiscales publiées par France Stratégie. Pour le 1 % et le 0,1 % les plus aisés, le revenu disponible (dénominateur) est lui-même une estimation, et le revenu fiscal sous-estime le revenu économique des plus grandes fortunes : le pourcentage y est un ordre de grandeur.", "The allocation keys between groups are Third Estate assumptions, detailed below; for the flat tax they rest on tax data published by France Stratégie. For the top 1% and 0.1%, disposable income (the denominator) is itself an estimate, and taxable income understates the economic income of the largest fortunes: the percentage there is an order of magnitude.")}</li>
        <li>${L("Le barème à 14 tranches est calculé pour un couple sans enfant représentatif de chaque groupe ; une barre à gauche du zéro signifie une baisse d’impôt. La fin du quotient conjugal n’est pas représentée (aucun chiffrage public de son rendement).", "The 14-bracket scale is computed for a childless couple typical of each group; a bar left of zero means a tax cut. The end of joint filing is not shown (no public estimate of its yield).")}</li>
        <li>${L("Seules les hausses d’impôts sont réparties ici. Les dépenses du programme (SMIC, garantie d’autonomie, cantines, retraites…) profitent surtout aux premiers dixièmes ; leur répartition n’est pas tracée faute de données comparables.", "Only tax rises are spread here. The programme's spending (minimum wage, autonomy guarantee, school meals, pensions…) mostly benefits the lower tenths; its distribution is not drawn for lack of comparable data.")}</li>
      </ul>
      <dl class="hh-keys">${d.measures.map((m) => `<dt>${esc(L(m.fr, m.en))} (${fmtNum(m.revenue)} Md€)</dt><dd>${esc(L(m.keyFr, m.keyEn))}</dd>`).join("")}
        <dt>${L("Groupes marqués *", "Groups marked *")}</dt><dd>${L("Niveau de vie moyen du 1 % et du 0,1 % estimé par Third Estate (0,1 % : 588 000 € de revenu fiscal moyen en 2020 selon France Stratégie, moins l’impôt) ; celui du reste du 10e dixième en découle pour retrouver la moyenne Insee du dixième (76 970 €). Ménages : ≈ 30 millions, 1,5 unité de consommation en moyenne.", "Mean standard of living of the top 1% and 0.1% estimated by Third Estate (0.1%: €588,000 mean taxable income in 2020 per France Stratégie, less tax); the rest of the 10th tenth follows so as to match Insee's mean for the tenth (€76,970). Households: ≈ 30 million, 1.5 consumption units on average.")}</dd></dl>
      <p class="source">${L("Sources", "Sources")}${L(" : ", ": ")}${d.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ")} · ${L("vérifié le", "checked on")} ${esc(d.checked)}</p>
    </div>`;
}

// ---------- static blocks ----------
function notCounted(): string {
  const items: [string, T][] = [
    ["L919a7c", { fr: "Retraite à 62 puis 60 ans : change l’âge de départ, pas le montant annuel ; non chiffré ici.", en: "Retirement at 62 then 60: changes the age, not the yearly amount; not costed here." }],
    ["Ledc583", { fr: "Cotisation sociale universelle remplaçant cotisations et CSG : aucun taux publié.", en: "Universal social contribution replacing contributions and CSG: no rates published." }],
    ["L4ad94f", { fr: "Taxe d’habitation progressive rétablie (80 % des ménages exonérés) : barème non publié.", en: "Progressive council tax restored (80% of households exempt): no scale published." }],
    ["L80e85c", { fr: "35 heures, heures supplémentaires majorées, 32 heures dans certains métiers : dépend de l’employeur.", en: "35-hour week, higher overtime pay, 32 hours in some jobs: depends on the employer." }],
    ["Lc140d0", { fr: "Indexation des salaires sur l’inflation : dépend de l’inflation future.", en: "Wages indexed on inflation: depends on future inflation." }],
    ["L86eca6", { fr: "Garantie d’emploi au SMIC pour les chômeurs de longue durée : dépend de votre parcours.", en: "Job guarantee at the minimum wage for the long-term unemployed: depends on your situation." }],
    ["Ldc0fbb", { fr: "AAH au niveau du SMIC, allocation de soutien familial revalorisée : non saisies dans le formulaire.", en: "Disability allowance at the minimum wage, higher single-parent allowance: not in the form." }],
    ["L8e6d31", { fr: "« TVA grand luxe », plafond de 5 logements transmissibles, refonte de la taxe foncière : taux ou modalités non publiés.", en: "‘Luxury VAT’, cap of 5 homes that can be inherited, property-tax overhaul: rates or rules not published." }],
  ];
  return `<h3>${L("Ce qui n’est pas compté", "What is not counted")}</h3>
    <ul class="hh-assume">${items.map(([id, x]) => `<li>${esc(tr(x))} <a href="${esc(measureHref(id))}">${L("La mesure", "The measure")}</a></li>`).join("")}</ul>`;
}

function paramsBlock(): string {
  return `<h3>${L("Paramètres 2026 utilisés", "2026 parameters used")}</h3>
    <ul class="hh-assume">
      <li>${L(`Barème de l’impôt 2026 (revenus 2025) : 0 % jusqu’à 11 600 €, 11 %, 30 % à partir de 29 579 €, 41 % à partir de 84 577 €, 45 % au-delà de 181 917 € ; plafond du quotient familial 1 807 € par demi-part (4 262 € pour le premier enfant d’un parent isolé) ; décote 897 € / 1 483 €.`, `2026 income tax scale (2025 income): 0% up to €11,600, 11%, 30% from €29,579, 41% from €84,577, 45% above €181,917; family-quotient cap €1,807 per half-part (€4,262 for a single parent's first child); décote €897 / €1,483.`)} <a href="https://www.service-public.gouv.fr/particuliers/actualites/A18045" target="_blank" rel="noopener">service-public.gouv.fr</a></li>
      <li>${L(`SMIC au 1er juin 2026 : 12,31 € brut de l’heure, 1 867,02 € brut par mois, ≈ ${fmtNum(Math.round(SMIC_NET_2026))} € net.`, `Minimum wage from 1 June 2026: €12.31 gross an hour, €1,867.02 gross a month, ≈ €${fmtNum(Math.round(SMIC_NET_2026))} net.`)} <a href="https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" target="_blank" rel="noopener">info.gouv.fr</a></li>
      <li>${L("Prélèvement forfaitaire unique : 31,4 % depuis le 1er janvier 2026 (12,8 % d’impôt + 18,6 % de prélèvements sociaux, LFSS 2026).", "Flat tax: 31.4% since 1 January 2026 (12.8% income tax + 18.6% social levies, 2026 social security budget act).")}</li>
      <li>${L(`Seuil de pauvreté 2024 : ${fmtNum(POVERTY_LINE)} € par mois pour une personne seule (Insee), repris par le programme pour la garantie d’autonomie.`, `Poverty line 2024: €${fmtNum(POVERTY_LINE)} a month for a single person (Insee), used by the programme for the autonomy guarantee.`)}</li>
      <li>${L("Barème à 14 tranches : amendement LFI-NFP I-CF748 au projet de loi de finances pour 2025 (13 octobre 2024, rejeté) : 5 % à partir de 10 434 €, puis 10 ; 15 ; 20 ; 25 ; 27,5 ; 32,5 ; 40 ; 45 ; 50 ; 55 ; 65 % et 70 % au-delà de 400 000 € par part. Son exposé annonce 5,7 Md€ de recettes (simulateur LexImpact).", "14-bracket scale: LFI-NFP amendment I-CF748 to the 2025 finance bill (13 October 2024, rejected): 5% from €10,434, then 10, 15, 20, 25, 27.5, 32.5, 40, 45, 50, 55, 65% and 70% above €400,000 per part. Its statement puts the yield at €5.7bn (LexImpact simulator).")} <a href="${esc(IR_LFI_SOURCE)}" target="_blank" rel="noopener">assemblee-nationale.fr</a></li>
      <li>${L("ISF : barème 2017 (0,5 % à 1,5 %, seuil 1,3 M€) et volet climatique, selon l’amendement n° 1069 au PLF 2027 (rejeté le 16 octobre 2026). IFI actuel : même barème sur l’immobilier.", "Wealth tax: 2017 scale (0.5% to 1.5%, threshold €1.3m) and climate component, per amendment no. 1069 to the 2027 finance bill (rejected 16 October 2026). Current IFI: same scale on property.")} <a href="https://datan.fr/votes/legislature-17/vote_8857" target="_blank" rel="noopener">datan.fr</a></li>
      <li>${L("Indice de référence des loyers : +1,15 % sur un an au 2e trimestre 2026 (Insee).", "Rent reference index: +1.15% over a year in Q2 2026 (Insee).")} <a href="https://www.insee.fr/fr/statistiques/9022797" target="_blank" rel="noopener">insee.fr</a></li>
    </ul>
    <p class="source">${L("Règles", "Rules")}${L(" : ", ": ")}<a href="https://github.com/nicbay/ThirdEstate/blob/main/src/lib/household-rules.ts" target="_blank" rel="noopener">src/lib/household-rules.ts</a> · <a href="${PROG}">${L("Le programme et le coût de chaque mesure", "The programme and the cost of each measure")}</a> · <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>`;
}
