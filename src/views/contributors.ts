// #/contributeurs: the 577 districts coloured by who pays in more than they get back. Two readings, switchable:
// the typical resident (taxes and contributions against benefits and public services, INSEE's averages for the
// district's median standard of living, src/lib/redistribution.ts) and the town halls (state grants and
// equalisation funds, per inhabitant, scripts/build-district-balance.mjs). Metropolitan France with an
// Île-de-France inset; overseas and abroad districts are in the lists only.
import { geoConicConformal, geoPath } from "d3-geo";
import { fetchJson, loadDeputes } from "../data";
import { L, fmtNum } from "../i18n";
import { rewind } from "../lib/map";
import { REDISTRIBUTION_SOURCE, residentBalance } from "../lib/redistribution";
import { esc } from "../util";
import "../styles/state-balance.css";

type Mode = "residents" | "towns";
interface Data { year: number; incomeYear: number; districts: Record<string, [string, number | null, number | null]> }

const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const depOfCirco = (c: string) => (c.startsWith("97") ? c.slice(0, 3) : c.slice(0, 2));
/** contributor shades (net out) and beneficiary shades (net in), lightest first */
const OUT = ["#cfe9d8", "#8fcca6", "#3f9c68", "#1d6b43"], IN = ["#fbe3c7", "#f5b97b", "#e0823a", "#a84f14"];
const STEPS: Record<Mode, number[]> = { residents: [1000, 3000, 6000], towns: [100, 200, 350] };
const eur = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(Math.round(n)))} €`;

export async function renderContributors(app: HTMLElement) {
  const [data, geo, deputes] = await Promise.all([
    fetchJson<Data>("/data/state-balance/districts.json"),
    fetchJson<GeoJSON.FeatureCollection>("/data/geo/circo-france.geojson"),
    loadDeputes(),
  ]);
  const mpOf = new Map(deputes.filter((d) => d.circo).map((d) => [d.circo!, d]));
  const nameOf = (c: string) => { const d = mpOf.get(c); return d ? `${d.departement} ${L(`(${Number(c.slice(-2))}ᵉ)`, `(district ${Number(c.slice(-2))})`)}` : c; };
  let mode: Mode = "residents";
  const value = (c: string): number | null => {
    const row = data.districts[c];
    if (!row) return null;
    return mode === "residents" ? (row[1] == null ? null : residentBalance(row[1]).net) : row[2];
  };
  const colour = (v: number | null) => {
    if (v == null) return "var(--wash)";
    const i = STEPS[mode].filter((s) => Math.abs(v) >= s).length;
    return (v < 0 ? OUT : IN)[i];
  };

  app.innerHTML = `<section class="page contributors">
    <header class="page-head">
      <p class="eyebrow">${L("Ce que chacun verse et reçoit", "Who pays in, who gets back")}</p>
      <h1>${L("Circonscriptions contributrices et bénéficiaires", "Net contributor and net beneficiary districts")}</h1>
      <p class="dek">${L("Deux lectures : un habitant typique (impôts et cotisations face aux prestations et services publics) et les mairies (dotations de l’État et péréquation).", "Two readings: a typical resident (taxes and contributions against benefits and public services) and the town halls (state grants and equalisation).")}</p>
    </header>
    <div class="cb-modes" role="group" aria-label="${L("Lecture", "Reading")}">
      <button type="button" data-m="residents">${L("Habitants", "Residents")}</button>
      <button type="button" data-m="towns">${L("Mairies", "Town halls")}</button>
    </div>
    <p class="cb-count" id="cb-count"></p>
    <div class="cb-maps">
      <figure><svg id="cb-fr" viewBox="0 0 600 600" role="img" aria-label="${L("France métropolitaine", "Metropolitan France")}"></svg></figure>
      <figure><figcaption class="muted small">Île-de-France</figcaption><svg id="cb-idf" viewBox="0 0 400 400" role="img" aria-label="Île-de-France"></svg></figure>
    </div>
    <div class="cb-legend" id="cb-legend"></div>
    <div class="cb-lists" id="cb-lists"></div>
    <p class="muted small" id="cb-method"></p>
  </section>`;

  const features = geo.features.map(rewind);
  const metro = features.filter((f) => !/^(97|98|99)/.test(f.properties!.code));
  const idf = metro.filter((f) => IDF.has(depOfCirco(f.properties!.code)));
  const projFr = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[8, 8], [592, 592]], { type: "FeatureCollection", features: metro } as GeoJSON.FeatureCollection);
  const projIdf = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[6, 6], [394, 394]], { type: "FeatureCollection", features: idf } as GeoJSON.FeatureCollection);

  const draw = () => {
    for (const b of app.querySelectorAll<HTMLButtonElement>(".cb-modes button")) b.setAttribute("aria-pressed", String(b.dataset.m === mode));
    const unit = mode === "residents" ? L("par an et par unité de consommation", "per year per consumption unit") : L("par habitant et par an", "per inhabitant per year");
    const paths = (fs: GeoJSON.Feature[], proj: ReturnType<typeof geoConicConformal>) => {
      const p = geoPath(proj);
      return fs.map((f) => {
        const c = f.properties!.code as string, v = value(c);
        const tip = `${nameOf(c)}\n${v == null ? L("pas de données", "no data") : `${v < 0 ? L("Contributeur net", "Net contributor") : L("Bénéficiaire net", "Net beneficiary")} : ${eur(v)} ${unit}`}`;
        return `<a href="#/circo/${c}"><path class="area" d="${p(f)}" fill="${colour(v)}" data-tip="${esc(tip)}"/></a>`;
      }).join("");
    };
    app.querySelector("#cb-fr")!.innerHTML = paths(metro, projFr);
    app.querySelector("#cb-idf")!.innerHTML = paths(idf, projIdf);

    const all = Object.keys(data.districts).map((c) => ({ c, v: value(c) })).filter((x): x is { c: string; v: number } => x.v != null);
    const nOut = all.filter((x) => x.v < 0).length, nIn = all.length - nOut;
    app.querySelector("#cb-count")!.innerHTML = L(
      `<b>${nOut}</b> circonscriptions contributrices nettes, <b>${nIn}</b> bénéficiaires nettes${all.length < 577 ? ` (${577 - all.length} sans données)` : ""}.`,
      `<b>${nOut}</b> net contributor districts, <b>${nIn}</b> net beneficiaries${all.length < 577 ? ` (${577 - all.length} without data)` : ""}.`,
    );
    const s = STEPS[mode];
    const lab = (lo: number, hi?: number) => hi == null ? `${fmtNum(lo)} € +` : `${fmtNum(lo)}–${fmtNum(hi)} €`;
    const ranges = [lab(0, s[0]), lab(s[0], s[1]), lab(s[1], s[2]), lab(s[2])];
    app.querySelector("#cb-legend")!.innerHTML = `<div><span class="muted small">${L("Contributeurs nets", "Net contributors")}</span>${OUT.map((c, i) => `<i style="background:${c}" title="${ranges[i]}"></i>`).join("")}</div>
      <div><span class="muted small">${L("Bénéficiaires nets", "Net beneficiaries")}</span>${IN.map((c, i) => `<i style="background:${c}" title="${ranges[i]}"></i>`).join("")}</div>
      <span class="muted small">${ranges.join(" · ")} ${unit}</span>`;
    const list = (xs: { c: string; v: number }[], title: string) => `<section><h2>${title}</h2><ol>${xs.map((x) => `<li><a href="#/circo/${x.c}">${esc(nameOf(x.c))}</a><b>${eur(x.v)}</b></li>`).join("")}</ol></section>`;
    const sorted = [...all].sort((a, b) => a.v - b.v);
    app.querySelector("#cb-lists")!.innerHTML = list(sorted.slice(0, 10), L("Les plus contributrices", "Biggest net contributors")) + list(sorted.slice(-10).reverse(), L("Les plus bénéficiaires", "Biggest net beneficiaries"));
    app.querySelector("#cb-method")!.innerHTML = mode === "residents"
      ? L(`Habitants : pour le niveau de vie médian de la circonscription (Filosofi ${data.incomeYear}, moyenne des communes pondérée par la population), les montants moyens que l’Insee mesure pour les personnes de même niveau de vie : impôts, TVA et cotisations payés, prestations et pensions reçues, services publics individualisés et dépenses collectives (comptes nationaux distribués 2019, euros 2019). Une estimation : à niveau de vie égal, les situations varient beaucoup, et les retraites comptent comme des prestations. <a href="${REDISTRIBUTION_SOURCE.page}" target="_blank" rel="noopener">Insee, la redistribution élargie</a>.`, `Residents: for the district's median standard of living (Filosofi ${data.incomeYear}, population-weighted mean of its towns), the average amounts INSEE measures for people at the same standard of living: taxes, VAT and contributions paid, benefits and pensions received, individual public services and collective spending (2019 distributed national accounts, 2019 euros). An estimate: at the same standard of living, situations vary a lot, and pensions count as benefits. <a href="${REDISTRIBUTION_SOURCE.page}" target="_blank" rel="noopener">INSEE, extended redistribution</a>.`)
      : L(`Mairies : dotation globale de fonctionnement reçue, plus FPIC et FSRIF nets (reversements moins prélèvements), par habitant, ${data.year} ; chaque commune pèse selon sa population et la part de ses électeurs dans la circonscription. Presque toutes les communes reçoivent la DGF : seules celles aux ressources fiscales nettement au-dessus de la moyenne versent plus qu’elles ne reçoivent.`, `Town halls: state operating grant (DGF) received, plus net FPIC and FSRIF (payouts minus levies), per inhabitant, ${data.year}; each town weighs by its population and the share of its voters in the district. Nearly every town receives the DGF: only those with tax resources well above average pay in more than they get.`);
  };
  for (const b of app.querySelectorAll<HTMLButtonElement>(".cb-modes button")) b.addEventListener("click", () => { mode = b.dataset.m as Mode; draw(); });
  draw();
}
