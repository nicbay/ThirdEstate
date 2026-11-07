// Shift map in the manner of the NYT county arrows: one arrow per district (2012–2024) or per
// department (1848–2024), drawn at its centre. Leaning right = moved right, leaning left = moved left.
// French colours: right blue, left red. Far-right and turnout modes use their own pair of colours.
import { geoConicConformal, geoPath } from "d3-geo";
import { loadDepartements, loadShifts, type ShiftPair, type ShiftUnit } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { rewind } from "../lib/map";
import { esc } from "../util";

type Metric = "lr" | "farRight" | "turnout";
const METRICS: Record<Metric, { fr: string; en: string; pos: [string, string, string]; neg: [string, string, string] }> = {
  lr: { fr: "Gauche ou droite", en: "Left or right", pos: ["Plus à droite", "More right", "#2e5fb8"], neg: ["Plus à gauche", "More left", "#c9302c"] },
  farRight: { fr: "Extrême droite", en: "Far right", pos: ["Extrême droite en hausse", "Far right up", "#1b2a5e"], neg: ["Extrême droite en baisse", "Far right down", "#8fa3c8"] },
  turnout: { fr: "Participation", en: "Turnout", pos: ["Participation en hausse", "Turnout up", "#2f8f5b"], neg: ["Participation en baisse", "Turnout down", "#b07a2a"] },
};
const ui = { pair: "", metric: "lr" as Metric };

export async function renderShifts(pane: HTMLElement) {
  const [data, geo] = await Promise.all([loadShifts(), loadDepartements()]);
  const pairs = data.pairs;
  const key = (p: ShiftPair) => `${p.fromId}>${p.toId}:${p.level}`;
  if (!pairs.some((p) => key(p) === ui.pair)) ui.pair = key(pairs.filter((p) => p.level === "district").at(-1) ?? pairs.at(-1)!);
  const metro = { type: "FeatureCollection", features: geo.features.map(rewind).filter((f) => f.properties!.code.length === 2) } as GeoJSON.FeatureCollection;
  const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], metro);
  const base = geoPath(proj);
  const outlines = metro.features.map((f) => `<path d="${base(f)}" class="shift-base"/>`).join("");

  const draw = () => {
    const pair = pairs.find((p) => key(p) === ui.pair)!;
    const m = METRICS[ui.metric];
    const units = Object.entries(pair.units).filter(([, u]) => u[ui.metric] && u.lon > -6 && u.lon < 10 && u.lat > 41 && u.lat < 52); // mainland + Corsica
    const deltas = units.map(([, u]) => Math.abs(u[ui.metric][2]));
    const scale = pair.level === "district" ? 2.2 : 3; // px per point of shift
    const cap = 90;
    const arrows = units
      .map(([code, u]) => {
        const p = proj([u.lon, u.lat]);
        if (!p) return "";
        const d = u[ui.metric][2];
        if (Math.abs(d) < 0.3) return "";
        const len = Math.min(cap, Math.abs(d) * scale);
        const dx = Math.sign(d) * len * Math.cos(Math.PI / 6), dy = -len * Math.sin(Math.PI / 6);
        const [x2, y2] = [p[0] + dx, p[1] + dy];
        const color = d > 0 ? m.pos[2] : m.neg[2];
        // arrowhead: two short strokes back from the tip
        const a = Math.atan2(dy, dx), h = Math.min(6, len * 0.35);
        const head = `M${(x2 - h * Math.cos(a - 0.5)).toFixed(1)},${(y2 - h * Math.sin(a - 0.5)).toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}L${(x2 - h * Math.cos(a + 0.5)).toFixed(1)},${(y2 - h * Math.sin(a + 0.5)).toFixed(1)}`;
        const tip = `${u.name ?? code}\n${tip3(u, ui.metric, pair)}`;
        return `<g class="arrow" data-tip="${esc(tip)}" stroke="${color}"><path d="M${p[0].toFixed(1)},${p[1].toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}${head}"/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6" class="hit"/></g>`;
      })
      .join("");

    const nat = pair.national[ui.metric];
    const sorted = [...units].sort((a, b) => b[1][ui.metric][2] - a[1][ui.metric][2]);
    const fr = getLang() === "fr";
    pane.querySelector("#shift-head")!.innerHTML = `
      <h2>${fr ? `De ${pair.from} à ${pair.to}` : `From ${pair.from} to ${pair.to}`}${pair.level === "district" ? L(", par circonscription", ", by district") : L(", par département", ", by department")}</h2>
      <p class="muted small">${L("Au niveau national", "Nationally")} : ${nat ? `${signed(nat[2])} ${L("points", "points")} (${nat[0].toFixed(1)} → ${nat[1].toFixed(1)})` : "–"}. ${units.length} ${pair.level === "district" ? L("circonscriptions", "districts") : L("départements", "departments")}, ${L("premier tour", "first round")}.</p>`;
    pane.querySelector("#shift-svg")!.innerHTML = outlines + arrows;
    pane.querySelector("#shift-legend")!.innerHTML = `<span><svg width="34" height="16"><path d="M2,14L28,2" stroke="${m.neg[2]}" stroke-width="2.4" transform="scale(-1,1) translate(-30,0)"/></svg>${L(m.neg[0], m.neg[1])}</span><span><svg width="34" height="16"><path d="M2,14L28,2" stroke="${m.pos[2]}" stroke-width="2.4"/></svg>${L(m.pos[0], m.pos[1])}</span>`;
    pane.querySelector("#movers")!.innerHTML = [
      [L(m.pos[0], m.pos[1]), sorted.slice(0, 8)],
      [L(m.neg[0], m.neg[1]), sorted.slice(-8).reverse()],
    ]
      .map(([title, list]) => `<section><h3>${title as string}</h3><table class="table"><tbody>${(list as [string, ShiftUnit][]).map(([code, u]) => `<tr><td>${esc(u.name ?? labelFor(code))}</td><td class="num">${signed(u[ui.metric][2])}</td></tr>`).join("")}</tbody></table></section>`)
      .join("");
    pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.metric === ui.metric)));
    void deltas;
  };

  const groups = [
    [L("Par circonscription (découpage actuel)", "By district (current boundaries)"), pairs.filter((p) => p.level === "district")],
    [L("Par département", "By department"), pairs.filter((p) => p.level === "department").reverse()],
  ] as const;
  pane.innerHTML = `
    <section class="card">
      <div class="shift-controls">
        <select id="pair" aria-label="${L("Élections comparées", "Elections compared")}">${groups
          .map(([label, ps]) => `<optgroup label="${label}">${ps.map((p) => `<option value="${key(p)}" ${key(p) === ui.pair ? "selected" : ""}>${p.from} → ${p.to}${p.fromId !== String(p.from) || p.toId !== String(p.to) ? ` (${fmtDate(p.fromDate)} → ${fmtDate(p.toDate)})` : ""}</option>`).join("")}</optgroup>`)
          .join("")}</select>
        <div class="tabs small-tabs">${(Object.keys(METRICS) as Metric[]).map((k) => `<button type="button" data-metric="${k}">${L(METRICS[k].fr, METRICS[k].en)}</button>`).join("")}</div>
      </div>
      <div id="shift-head"></div>
      <div class="shift-wrap">
        <svg id="shift-svg" viewBox="0 0 800 780" role="img" aria-label="${L("Carte des bascules", "Shift map")}"></svg>
        <div class="shift-legend" id="shift-legend"></div>
      </div>
      <p class="muted small">${L(
        "Chaque flèche part du centre de la zone. Elle penche à droite si la droite (droite + extrême droite) a progressé par rapport à la gauche (gauche + écologistes), à gauche sinon ; sa longueur est proportionnelle à l’écart. Le centre n’est compté dans aucun camp. France métropolitaine et Corse.",
        "Each arrow starts at the area’s centre. It leans right if the right (right + far right) gained on the left (left + greens), left otherwise; its length is proportional to the change. The centre counts for neither side. Mainland France and Corsica.",
      )}</p>
    </section>
    <section class="card"><header class="card-head"><h2>${L("Les plus fortes bascules", "Biggest moves")}</h2></header><div class="grid-2" id="movers"></div></section>
    <p class="source">${L("Résultats : ministère de l’Intérieur (data.gouv.fr) depuis 2012 ; Cagé et Piketty, « Une histoire du conflit politique », pour les élections antérieures. Méthode détaillée dans le dépôt.", "Results: Ministry of the Interior (data.gouv.fr) since 2012; Cagé and Piketty, “Une histoire du conflit politique”, for earlier elections. Full method in the repository.")}</p>`;

  pane.querySelector<HTMLSelectElement>("#pair")!.addEventListener("change", (e) => { ui.pair = (e.target as HTMLSelectElement).value; draw(); });
  pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => b.addEventListener("click", () => { ui.metric = b.dataset.metric as Metric; draw(); }));
  draw();
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const labelFor = (code: string) => (code.length >= 4 ? `${code.slice(0, -2)} · ${Number(code.slice(-2))}` : code);
function tip3(u: ShiftUnit, m: Metric, p: ShiftPair) {
  const [a, b, d] = u[m];
  if (m === "lr") return `${L("Écart droite − gauche", "Right − left margin")} : ${a.toFixed(1)} → ${b.toFixed(1)} (${signed(d)})\n${L("Gauche", "Left")} ${u.left[0].toFixed(1)} → ${u.left[1].toFixed(1)}, ${L("droite", "right")} ${u.right[0].toFixed(1)} → ${u.right[1].toFixed(1)}`;
  return `${p.from} : ${a.toFixed(1)} %, ${p.to} : ${b.toFixed(1)} % (${signed(d)})`;
}
