// Town page: what the commune receives from the state and equalisation funds, and what it pays into them,
// per inhabitant. Data and method: scripts/sync-state-balance.mjs → public/data/state-balance/<dep>.json.
// loadStateBalance() is exported for other views (e.g. comparing two towns).
import { fetchJson } from "../data";
import { L, colon, fmtNum, getLang } from "../i18n";
import "../styles/state-balance.css";

type Row = [pop: number, dgf: number, fpic: number | null, fsrif: number, ir: number | null, dilico: number, strate: string, fpicScope: "c" | "e"];
interface Stratum { label: string; n: number; balance: number; contributors: number; ir: number | null }
interface File {
  year: number;
  irYear: number;
  sources: { dotations: string; fpic: string; ircom: string };
  france: { pop: number; dgf: number; fpic: number; fsrif: number; ir: number };
  strata: Record<string, Stratum>;
  communes: Record<string, Row>;
}
export interface StateBalance {
  code: string; // the code the figures belong to (Paris/Lyon/Marseille for an arrondissement)
  year: number;
  pop: number;
  /** € per inhabitant: DGF received, FPIC net (the intercommunal ensemble's, spread per inhabitant, unless fpicScope is "c"), FSRIF net */
  dgf: number;
  fpic: number | null;
  fsrif: number;
  /** received − paid, € per inhabitant: dgf + fpic + fsrif. Negative = net contributor. */
  balance: number;
  fpicScope: "c" | "e";
  /** not in the balance: DILICO 2025 reserve levy, and income tax paid by the town's tax households (DGFiP IRCOM) */
  dilico: number;
  ir: number | null;
  irYear: number;
  stratum: Stratum | null;
  france: File["france"];
  sources: File["sources"];
}

const depOf = (code: string) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));
const plmCity = (c: string) => (/^751\d\d$/.test(c) ? "75056" : /^6938\d$/.test(c) ? "69123" : /^132\d\d$/.test(c) ? "13055" : c);
const files = new Map<string, Promise<File | null>>();

export async function loadStateBalance(code: string): Promise<StateBalance | null> {
  const dep = depOf(code);
  if (!files.has(dep)) files.set(dep, fetchJson<File>(`/data/state-balance/${dep}.json`).catch(() => null));
  const f = await files.get(dep)!;
  const own = plmCity(code);
  const r = f?.communes[code] ?? f?.communes[own];
  if (!f || !r) return null;
  const [pop, dgf, fpic, fsrif, ir, dilico, strate, fpicScope] = r;
  return { code: f.communes[code] ? code : own, year: f.year, pop, dgf, fpic, fsrif, balance: dgf + (fpic ?? 0) + fsrif, fpicScope, dilico, ir, irYear: f.irYear, stratum: f.strata[strate] ?? null, france: f.france, sources: f.sources };
}

const eur = (n: number, sign = false) => `${sign && n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))}${L(" €", " €")}`;
/** "20 000 - 34 999 habitants" → "de 20 000 à 34 999 habitants" / "20,000–34,999 people" */
function stratumName(s: Stratum) {
  const n = (s.label.match(/\d[\d ]*/g) ?? []).map((x) => Number(x.replace(/\s/g, "")));
  if (n.length === 2) return L(`de ${fmtNum(n[0])} à ${fmtNum(n[1])} habitants`, `of ${fmtNum(n[0])}–${fmtNum(n[1])} people`);
  if (n.length === 1) return L(`de ${fmtNum(n[0])} habitants et plus`, `of ${fmtNum(n[0])}+ people`);
  return s.label;
}

export async function renderTownState(box: HTMLElement, code: string, name: string) {
  const b = await loadStateBalance(code);
  if (!b) { box.innerHTML = ""; return; }
  const fr = getLang() === "fr";
  const whole = b.code !== code;
  const cityName = b.code === "75056" ? "Paris" : b.code === "69123" ? "Lyon" : "Marseille";
  const received = b.dgf + Math.max(b.fpic ?? 0, 0) + Math.max(b.fsrif, 0);
  const paid = Math.max(-(b.fpic ?? 0), 0) + Math.max(-b.fsrif, 0);
  const contributor = b.balance < 0;
  const verdict = b.balance === 0 ? L("À l’équilibre", "Breaks even") : contributor ? L("Contributeur net", "Net contributor") : L("Bénéficiaire net", "Net beneficiary");
  const scale = Math.max(received, paid, Math.abs(b.stratum?.balance ?? 0), 1);
  const bar = (v: number, cls: string) => `<span class="sb-bar ${cls}" style="width:${Math.max(0, (100 * v) / scale).toFixed(1)}%"></span>`;
  const line = (label: string, v: number | null, note = "") =>
    v == null ? `<tr><td>${label}${note}</td><td class="num muted">${L("n.d.", "n/a")}</td></tr>` : `<tr><td>${label}${note}</td><td class="num"><b>${eur(v, true)}</b></td></tr>`;
  const s = b.stratum;

  box.innerHTML = `<section class="card state-balance">
    <header class="card-head" id="finances"><h2>${L("Ce que la commune reçoit et verse", "What the town receives and pays in")}</h2><span class="muted small">${L(`dotations et péréquation ${b.year}, par habitant`, `grants and equalisation, ${b.year}, per inhabitant`)}</span></header>
    ${whole ? `<p class="muted small">${L(`Chiffres de ${cityName} entier : les dotations sont versées à la ville, pas aux arrondissements.`, `Figures for the whole of ${cityName}: grants go to the city, not to its arrondissements.`)}</p>` : ""}
    <p class="sb-verdict ${contributor ? "is-out" : "is-in"}"><span>${verdict}</span><strong>${eur(b.balance, true)}</strong><span class="muted small">${L("par habitant et par an", "per inhabitant per year")}</span></p>
    <div class="sb-bars" aria-hidden="true">
      <div><span class="small">${L("Reçu", "Received")} <b>${eur(received)}</b></span>${bar(received, "in")}</div>
      <div><span class="small">${L("Versé", "Paid in")} <b>${eur(paid)}</b></span>${bar(paid, "out")}</div>
    </div>
    <table class="table sb-table"><tbody>
      ${line(L("Dotation globale de fonctionnement de l’État (DGF)", "State operating grant (DGF)"), b.dgf)}
      ${line(L("Péréquation intercommunale (FPIC)", "Inter-municipal equalisation fund (FPIC)"), b.fpic, b.fpicScope === "e" ? `<br><span class="muted tiny">${L("part de l’intercommunalité, ramenée par habitant", "the intercommunality’s amount, per inhabitant")}</span>` : "")}
      ${b.fsrif ? line(L("Fonds de solidarité d’Île-de-France (FSRIF)", "Île-de-France solidarity fund (FSRIF)"), b.fsrif) : ""}
    </tbody></table>
    ${s ? `<p class="small">${L(`Communes ${stratumName(s)}`, `Towns ${stratumName(s)}`)}${colon()}${L("solde médian", "median balance")} <b>${eur(s.balance, true)}</b>${fr ? " ; " : "; "}${fmtNum(s.contributors)}${L(" %", "%")} ${L("sont contributrices nettes", "are net contributors")} (${fmtNum(s.n)} ${L("communes", "towns")}).</p>` : ""}
    ${b.ir != null ? `<p class="small">${L("À part", "Separately")}${colon()}${L(`les foyers fiscaux ${whole ? "de la ville" : "de la commune"} ont payé`,`tax households in ${whole ? cityName : name} paid`)} <b>${eur(b.ir)}</b> ${L(`d’impôt sur le revenu par habitant (revenus ${b.irYear})`, `of income tax per inhabitant (${b.irYear} income)`)}${s?.ir != null ? `, ${L("contre", "against")} ${eur(s.ir)} ${L("pour la commune médiane de même taille", "in the median town of the same size")}` : ""}${fr ? " et " : " and "}${eur(b.france.ir)} ${L("en moyenne en France", "on average in France")}. ${L("Il finance tout le budget de l’État, pas les communes : il n’entre pas dans le solde.", "It funds the whole state budget, not the towns, so it is not in the balance.")}</p>` : ""}
    ${b.dilico > 0 ? `<p class="small muted">${L(`En ${b.year}, ${eur(b.dilico)} par habitant ont aussi été mis en réserve par l’État (DILICO), restitués à 90 % sur 2026-2028 : non comptés.`, `In ${b.year} the state also held back ${eur(b.dilico)} per inhabitant (DILICO reserve), 90% of it returned over 2026–2028: not counted.`)}</p>` : ""}
    <p class="muted tiny">${L("Méthode : solde = DGF reçue + FPIC et FSRIF nets (reversements moins prélèvements), divisés par la population Insee. Ne sont pas comptés : les autres concours de l’État (compensations d’exonérations, subventions d’investissement, FCTVA), le FNGIR et les impôts nationaux.", "Method: balance = DGF received + net FPIC and FSRIF (payouts minus levies), divided by the Insee population. Not counted: other state transfers (tax-exemption compensation, investment grants, VAT refund fund), the FNGIR, and national taxes.")}</p>
    <p class="source">${L("Sources", "Sources")}${colon()}<a href="${b.sources.dotations}" target="_blank" rel="noopener">${L("DGCL, dotations des communes", "DGCL, municipal grants")}</a>, <a href="${b.sources.fpic}" target="_blank" rel="noopener">${L("DGCL, FPIC des ensembles intercommunaux", "DGCL, FPIC by intercommunality")}</a> (${L("via l’OFGL", "via OFGL")}), <a href="${b.sources.ircom}" target="_blank" rel="noopener">${L("DGFiP, impôt sur le revenu par commune", "DGFiP, income tax by town")}</a>.</p>
  </section>`;
}
