// Neighbourhoods (INSEE IRIS) of a town: a map coloured by a chosen figure and a card per
// neighbourhood with photos, description and figures compared with the town.
// Data: scripts/sync-quartiers.mjs (IGN contours, INSEE census and Filosofi, Wikimedia Commons, Wikipedia).
import { geoMercator, geoPath } from "d3-geo";
import { fetchJson } from "../data";
import { L, fmtNum, getLang } from "../i18n";
import { rewind } from "../lib/map";
import { esc, safeUrl } from "../util";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const KEYS = ["medianIncome", "povertyRate", "unemployment", "socialHousing", "owners", "higherEducation", "over65", "under15"] as const;
type Key = (typeof KEYS)[number];
const LABELS: Record<Key, [string, string, string]> = {
  medianIncome: ["Niveau de vie médian", "Median standard of living", "€"],
  povertyRate: ["Taux de pauvreté", "Poverty rate", "%"],
  unemployment: ["Chômage", "Unemployment", "%"],
  socialHousing: ["Logement social", "Social housing", "%"],
  owners: ["Propriétaires", "Home owners", "%"],
  higherEducation: ["Diplômés du supérieur", "University graduates", "%"],
  over65: ["65 ans et plus", "Aged 65+", "%"],
  under15: ["Moins de 15 ans", "Under 15", "%"],
};
let metric: Key = "medianIncome";

export async function renderQuartiers(box: HTMLElement, code: string) {
  const [data, geo] = await Promise.all([fetchJson<Any>(`/data/quartiers/${code}.json`).catch(() => null), fetchJson<GeoJSON.FeatureCollection>(`/data/quartiers/${code}.geojson`).catch(() => null)]);
  if (!data?.iris?.length || !geo || data.iris.length < 2) { box.innerHTML = ""; return; }
  const fr = getLang() === "fr";
  const byCode = new Map<string, Any>(data.iris.map((i: Any) => [i.code, i]));
  const town = data.comparison?.commune ?? {};
  const features = geo.features.map(rewind);
  const proj = geoMercator().fitExtent([[6, 6], [494, 394]], { type: "FeatureCollection", features } as GeoJSON.FeatureCollection);
  const path = geoPath(proj);
  const fmt = (k: Key, v: number | null | undefined) => (v == null ? "–" : k === "medianIncome" ? `${fmtNum(Math.round(v))} €` : `${v.toLocaleString(fr ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 })} %`);

  box.innerHTML = `
    <section class="card quartiers">
      <header class="card-head"><h2>${L("Les quartiers", "Neighbourhoods")}</h2>
        <select id="q-metric" aria-label="${L("Indicateur", "Indicator")}">${KEYS.map((k) => `<option value="${k}" ${k === metric ? "selected" : ""}>${L(LABELS[k][0], LABELS[k][1])}</option>`).join("")}</select></header>
      <p class="muted small">${data.iris.length} ${L("quartiers statistiques de l’INSEE (IRIS, environ 2 000 habitants chacun). Cliquez sur un quartier.", "INSEE statistical neighbourhoods (IRIS, about 2,000 residents each). Click one.")}</p>
      <div class="q-grid">
        <div><svg id="q-map" viewBox="0 0 500 400" role="img" aria-label="${L("Carte des quartiers", "Neighbourhood map")}"></svg><div class="legend-scale" id="q-legend"></div></div>
        <div id="q-detail" class="q-detail"></div>
      </div>
      <ol class="q-cards" id="q-cards"></ol>
      <p class="source">${L("INSEE, recensement 2022 et Filosofi 2021 ; contours IGN ; photos Wikimedia Commons et descriptions Wikipédia, crédités sur chaque élément.", "INSEE, 2022 census and Filosofi 2021; IGN outlines; photos from Wikimedia Commons and descriptions from Wikipedia, credited on each item.")}</p>
    </section>`;

  const ramp = ["#f1eef6", "#cfc4e0", "#a996c9", "#7d68ad", "#4f3f86"];
  let selected: string | null = null;
  const card = (i: Any, big = false) => {
    const f = i.figures ?? {};
    const photos: Any[] = i.photos ?? [];
    const name = i.quartier?.name && !String(i.name).includes(i.quartier.name.replace(/^Quartier (de la |du |de l’|des |de )?/i, "")) ? `${i.name} <span class="muted small">(${esc(i.quartier.name)})</span>` : esc(i.name);
    return `${photos.length ? `<div class="q-photos${big ? " big" : ""}">${photos.slice(0, big ? 4 : 1).map((p) => `<figure><img src="${esc(safeUrl(big ? p.thumb : String(p.thumb).replace("/960px-", "/500px-")))}" alt="${esc(p.title ?? "")}" loading="lazy"/><figcaption class="tiny"><a href="${esc(safeUrl(p.page))}" target="_blank" rel="noopener">${esc(p.author ?? "")}</a>, ${esc(p.licence ?? "")}</figcaption></figure>`).join("")}</div>` : ""}
      <div class="q-body"><b class="q-name">${name}</b> <span class="muted small">${f.population ? `${fmtNum(f.population)} ${L("hab.", "people")}` : ""}</span>
      ${i.description?.text ? `<p class="small">${esc(i.description.text)} <a class="tiny" href="${esc(safeUrl(i.description.url))}" target="_blank" rel="noopener">Wikipédia</a></p>` : ""}
      <dl class="q-figs small">${(big ? KEYS : (["medianIncome", "unemployment", "socialHousing"] as Key[])).map((k) => { const v = f[k], t = town[k]; const d = v != null && t ? v - t : null; return `<div><dt>${L(LABELS[k][0], LABELS[k][1])}</dt><dd><b>${fmt(k, v)}</b>${d != null && big ? ` <span class="muted tiny">${L("commune", "town")} ${fmt(k, t)}</span>` : ""}</dd></div>`; }).join("")}</dl>
      ${big && i.places?.length ? `<p class="small muted">${L("À voir", "Worth seeing")} : ${i.places.slice(0, 5).map((p: Any) => `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.title)}</a>`).join(", ")}</p>` : ""}
      ${f.population && f.population < 300 ? `<p class="muted tiny">${L("Peu d’habitants : chiffres fragiles.", "Few residents: figures are fragile.")}</p>` : ""}</div>`;
  };
  const draw = () => {
    const vals = data.iris.map((i: Any) => i.figures?.[metric]).filter((v: Any): v is number => v != null).sort((a: number, b: number) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const breaks = [0.2, 0.4, 0.6, 0.8].map(q);
    const colour = (v?: number | null) => (v == null ? "var(--wash, #eee)" : ramp[breaks.filter((b) => v > b).length]);
    box.querySelector("#q-map")!.innerHTML = features
      .map((f) => { const i = byCode.get(f.properties!.code); const v = i?.figures?.[metric]; return `<path class="area q-area${f.properties!.code === selected ? " selected" : ""}" data-code="${f.properties!.code}" d="${path(f)}" fill="${colour(v)}" data-tip="${esc(`${f.properties!.name}\n${L(LABELS[metric][0], LABELS[metric][1])} : ${fmt(metric, v)}`)}"/>`; })
      .join("");
    box.querySelector("#q-legend")!.innerHTML = `<span>${L(LABELS[metric][0], LABELS[metric][1])}</span>${ramp.map((c) => `<i style="background:${c}"></i>`).join("")}<span class="muted">${vals.length ? `${fmt(metric, vals[0])} – ${fmt(metric, vals[vals.length - 1])}` : ""}</span>`;
    const sel = selected ? byCode.get(selected) : [...data.iris].sort((a: Any, b: Any) => (b.photos?.length ?? 0) - (a.photos?.length ?? 0) || (b.figures?.population ?? 0) - (a.figures?.population ?? 0))[0];
    box.querySelector("#q-detail")!.innerHTML = sel ? card(sel, true) : "";
    box.querySelectorAll<SVGPathElement>("#q-map .q-area").forEach((p) => p.addEventListener("click", () => { selected = p.dataset.code!; draw(); }));
  };
  const list = [...data.iris].sort((a: Any, b: Any) => (b.photos?.length ? 1 : 0) - (a.photos?.length ? 1 : 0) || (b.description ? 1 : 0) - (a.description ? 1 : 0) || (b.figures?.population ?? 0) - (a.figures?.population ?? 0));
  box.querySelector("#q-cards")!.innerHTML = list.slice(0, 24).map((i: Any) => `<li><button type="button" class="q-card" data-code="${esc(i.code)}">${card(i)}</button></li>`).join("");
  box.querySelectorAll<HTMLButtonElement>(".q-card").forEach((b) => b.addEventListener("click", () => { selected = b.dataset.code!; draw(); box.querySelector("#q-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); }));
  box.querySelector<HTMLSelectElement>("#q-metric")!.addEventListener("change", (e) => { metric = (e.target as HTMLSelectElement).value as Key; draw(); });
  draw();
}
