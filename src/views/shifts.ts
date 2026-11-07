// Shift map in the manner of the NYT county arrows: one arrow per district (2012–2024) or per
// department (1848–2024), drawn from its centre.
//
// Direction carries meaning and is never reused:
//   • Left/right metric (lr = right share − left share): the arrow tilts RIGHT and is BLUE when the
//     margin rose (moved right), tilts LEFT and is RED when it fell (moved left).
//   • Far-right vote and turnout are not left/right movements, so they use VERTICAL arrows
//     (up = rose, down = fell) and never point left or right.
import { geoConicConformal, geoPath, type GeoProjection } from "d3-geo";
import { loadCircoGeo, loadDepartements, loadShifts, type ShiftPair, type ShiftUnit } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { rewind } from "../lib/map";
import { esc } from "../util";
import { zoomable, type Zoomable } from "../lib/zoom";

export type Metric = "lr" | "farRight" | "turnout";
type Side = [fr: string, en: string, color: string];
export const METRICS: Record<Metric, { fr: string; en: string; axis: "x" | "y"; pos: Side; neg: Side; unit: [string, string] }> = {
  lr: { fr: "Gauche ou droite", en: "Left or right", axis: "x", pos: ["Vers la droite", "Moved right", "#1f5fcf"], neg: ["Vers la gauche", "Moved left", "#d4253a"], unit: ["pts d’écart", "pt margin"] },
  farRight: { fr: "Extrême droite", en: "Far right", axis: "y", pos: ["Extrême droite en hausse", "Far right up", "#1c2c6c"], neg: ["Extrême droite en baisse", "Far right down", "#8e9cc6"], unit: ["pts", "pts"] },
  turnout: { fr: "Participation", en: "Turnout", axis: "y", pos: ["Participation en hausse", "Turnout up", "#4b2fd0"], neg: ["Participation en baisse", "Turnout down", "#9aa0aa"], unit: ["pts", "pts"] },
};
const ui = { pair: "", metric: "lr" as Metric };
/** Arrow tilt for the left/right metric: 30° above horizontal, like the NYT maps. */
const TILT = Math.PI / 6;
/** Paris and the inner suburbs, drawn again at a larger scale. */
const PARIS = ["75", "92", "93", "94"];
const inParis = (u: ShiftUnit) => u.lon > 2.2 && u.lon < 2.62 && u.lat > 48.72 && u.lat < 48.96;

export async function renderShifts(pane: HTMLElement) {
  const [data, geo] = await Promise.all([loadShifts(), loadDepartements()]);
  const pairs = data.pairs;
  const key = (p: ShiftPair) => `${p.fromId}>${p.toId}:${p.level}`;
  if (!pairs.some((p) => key(p) === ui.pair)) ui.pair = key(pairs.filter((p) => p.level === "district").at(-1) ?? pairs.at(-1)!);
  const deps = geo.features.map(rewind);
  const depName = new Map(deps.map((f) => [f.properties!.code as string, f.properties!.nom as string]));
  const metro = { type: "FeatureCollection", features: deps.filter((f) => f.properties!.code.length === 2) } as GeoJSON.FeatureCollection;
  const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], metro);
  const base = geoPath(proj);
  const outlines = metro.features.map((f) => `<path d="${base(f)}" class="shift-base" data-dep="${f.properties!.code}"/>`).join("");
  const depBounds = new Map(metro.features.map((f) => [f.properties!.code as string, base.bounds(f)]));
  let zoom: Zoomable | null = null;
  // district outlines, loaded per department when the reader zooms in (district-level maps only)
  const circoLayers = new Map<string, string>();
  let isDistrictMap = true;

  // Paris inset: district outlines of the four inner departments, at their own projection.
  const parisGeo = await Promise.all(PARIS.map((c) => loadCircoGeo(c).catch(() => null)));
  const parisFeatures = parisGeo.flatMap((g) => (g ? g.features.map(rewind) : []));
  const parisFc = { type: "FeatureCollection", features: parisFeatures.length ? parisFeatures : deps.filter((f) => PARIS.includes(f.properties!.code)) } as GeoJSON.FeatureCollection;
  const projP = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[12, 12], [348, 288]], parisFc);
  const parisBase = parisFc.features.map((f) => `<path d="${geoPath(projP)(f)}" class="shift-base"/>`).join("");
  const [[px0, py0], [px1, py1]] = base.bounds({ type: "FeatureCollection", features: deps.filter((f) => PARIS.includes(f.properties!.code)) } as GeoJSON.FeatureCollection);

  const unitLabel = (code: string, u: ShiftUnit) => u.name ?? (code.length >= 4 ? `${depName.get(code.slice(0, -2).padStart(2, "0")) ?? code.slice(0, -2)} · ${Number(code.slice(-2))}${L("e", "")}` : depName.get(code) ?? code);

  let drawArrows = (_z: number) => {};
  const draw = () => {
    const pair = pairs.find((p) => key(p) === ui.pair)!;
    const m = METRICS[ui.metric];
    const units = mainland(pair, ui.metric);
    const svg = pane.querySelector<SVGSVGElement>("#shift-svg")!;
    const k = unitsPerPx(svg, 800);
    const scale = pair.level === "district" ? 2.2 : 3;
    const district = pair.level === "district";
    drawArrows = (z: number) => {
      const box = district ? `<rect class="paris-box" x="${(px0 - 6).toFixed(1)}" y="${(py0 - 6).toFixed(1)}" width="${(px1 - px0 + 12).toFixed(1)}" height="${(py1 - py0 + 12).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="${((1.2 * k) / z).toFixed(2)}"/>` : "";
      svg.style.setProperty("--sw", `${((1.7 * k) / z).toFixed(2)}px`);
      svg.style.setProperty("--fs", `${((11 * k) / z).toFixed(2)}px`);
      const circos = district ? [...circoLayers.values()].join("") : "";
      svg.innerHTML = outlines + circos + arrowPaths(pair, ui.metric, proj, { scale: scale / z, k: k / z, cap: 90 / z }) + box;
    };

    const nat = pair.national[ui.metric];
    const sorted = [...units].sort((a, b) => b[1][ui.metric][2] - a[1][ui.metric][2]);
    const nPos = units.filter(([, u]) => u[ui.metric][2] > 0).length;
    const fr = getLang() === "fr";
    const what = district ? L("circonscriptions", "districts") : L("départements", "departments");
    const natWord = nat ? (nat[2] > 0 ? L(m.pos[0], m.pos[1]) : L(m.neg[0], m.neg[1])).toLowerCase() : "";
    pane.querySelector("#shift-head")!.innerHTML = `
      <h2>${fr ? `De ${pair.from} à ${pair.to}` : `From ${pair.from} to ${pair.to}`}${district ? L(", par circonscription", ", by district") : L(", par département", ", by department")}</h2>
      ${nat ? `<div class="shift-stat"><strong style="color:${nat[2] > 0 ? m.pos[2] : m.neg[2]}">${signed(nat[2])}</strong><span><b>${L("points au niveau national", "points nationally")}</b> · ${natWord} <span class="muted">(${fmt1(nat[0])} → ${fmt1(nat[1])})</span></span></div>` : ""}
      <p class="muted small">${fr ? `${nPos} ${what} sur ${units.length} : ${m.pos[0].toLowerCase()}` : `${nPos} of ${units.length} ${what}: ${m.pos[1].toLowerCase()}`}. ${L("Premier tour des législatives.", "Legislative first round.")}</p>`;

    isDistrictMap = district;
    drawArrows(zoom?.level() ?? 1);

    // the inset keeps the same on-screen length per point as the main map
    const inset = pane.querySelector<HTMLElement>("#paris-inset")!;
    inset.hidden = !district;
    if (district) {
      const isvg = inset.querySelector<SVGSVGElement>("svg")!;
      const ki = unitsPerPx(isvg, 360);
      isvg.style.setProperty("--sw", `${(1.7 * ki).toFixed(2)}px`);
      isvg.innerHTML = parisBase + arrowPaths(pair, ui.metric, projP, { scale: (scale / k) * ki, k: ki, cap: 90 * (ki / k), only: inParis });
    }

    pane.querySelector("#shift-legend")!.innerHTML = legend(ui.metric, scale / k, district);
    pane.querySelector("#shift-caption")!.textContent = m.axis === "x"
      ? L(
          "Chaque flèche part du centre de la zone. Elle penche vers la droite (en bleu) si la droite et l’extrême droite ont progressé par rapport à la gauche et aux écologistes, vers la gauche (en rouge) dans le cas contraire ; sa longueur est proportionnelle à la variation de l’écart, en points. Le centre n’est compté dans aucun camp. France métropolitaine et Corse.",
          "Each arrow starts at the area’s centre. It tilts right (blue) if the right and far right gained on the left and greens, left (red) otherwise; its length is proportional to the change in the margin, in points. The centre counts for neither side. Mainland France and Corsica.",
        )
      : L(
          "Chaque flèche part du centre de la zone. Elle monte si la part a augmenté, descend si elle a baissé ; sa longueur est proportionnelle à la variation, en points. Ces flèches sont verticales pour ne pas être confondues avec un glissement à gauche ou à droite. France métropolitaine et Corse.",
          "Each arrow starts at the area’s centre. It points up if the share rose, down if it fell; its length is proportional to the change, in points. These arrows are vertical so they can’t be mistaken for a shift left or right. Mainland France and Corsica.",
        );

    const up = sorted.filter(([, u]) => u[ui.metric][2] > 0).slice(0, 8);
    const down = sorted.filter(([, u]) => u[ui.metric][2] < 0).reverse().slice(0, 8);
    const maxAbs = Math.max(1, ...units.map(([, u]) => Math.abs(u[ui.metric][2])));
    pane.querySelector("#movers")!.innerHTML = ([[m.pos, up], [m.neg, down]] as const)
      .map(([side, list]) => `<section><h3><span class="mover-bar" style="width:18px;background:${side[2]}"></span>${L(side[0], side[1])}</h3>${
        list.length
          ? `<table class="table"><thead><tr><th>${district ? L("Circonscription", "District") : L("Département", "Department")}</th><th class="num">${L("Variation", "Change")}</th></tr></thead><tbody>${list
              .map(([code, u]) => { const d = u[ui.metric][2]; return `<tr><td><a href="${unitHref(code)}">${esc(unitLabel(code, u))}</a></td><td class="num"><span class="mover-bar" style="width:${Math.round((48 * Math.abs(d)) / maxAbs)}px;background:${side[2]}"></span>${signed(d)}</td></tr>`; })
              .join("")}</tbody></table>`
          : `<p class="muted small">${L("Aucune.", "None.")}</p>`
      }</section>`)
      .join("");
    pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.metric === ui.metric)));
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
        <div class="tabs small-tabs" role="tablist">${(Object.keys(METRICS) as Metric[]).map((k) => `<button type="button" role="tab" data-metric="${k}">${L(METRICS[k].fr, METRICS[k].en)}</button>`).join("")}</div>
      </div>
      <div id="shift-head" class="shift-head"></div>
      <div class="shift-legend" id="shift-legend"></div>
      <div class="shift-layout">
        <div class="shift-wrap reveal">
          <svg id="shift-svg" viewBox="0 0 800 780" role="img" aria-label="${L("Carte des bascules", "Shift map")}"></svg>
          <div class="map-ctrl" role="group" aria-label="${L("Zoom", "Zoom")}">
            <button type="button" data-z="in" aria-label="${L("Zoomer", "Zoom in")}">+</button>
            <button type="button" data-z="out" aria-label="${L("Dézoomer", "Zoom out")}">−</button>
            <button type="button" data-z="reset" class="map-reset" hidden>${L("France entière", "All of France")}</button>
          </div>
          <p class="map-hint" id="map-hint" aria-live="polite"></p>
        </div>
        <aside class="shift-key">
          <figure class="paris-inset" id="paris-inset" style="margin:0">
            <p>${L("Paris et petite couronne", "Paris and inner suburbs")}</p>
            <svg viewBox="0 0 360 300" class="reveal" role="img" aria-label="${L("Paris et petite couronne", "Paris and inner suburbs")}"></svg>
          </figure>
        </aside>
      </div>
      <p class="small map-help">${L("Cliquez sur une flèche pour ouvrir la circonscription : résultats et député élu. Cliquez sur un département, double-cliquez ou pincez pour zoomer ; glissez pour vous déplacer.", "Click an arrow to open its district: results and the elected MP. Click a department, double-click or pinch to zoom; drag to move around.")}</p>
      <p class="muted small" id="shift-caption"></p>
    </section>
    <section class="card movers"><header class="card-head"><h2>${L("Les plus fortes bascules", "Biggest moves")}</h2></header><div class="grid-2" id="movers"></div></section>
    <p class="source">${L("Résultats : ministère de l’Intérieur (data.gouv.fr) depuis 2012 ; Cagé et Piketty, « Une histoire du conflit politique », pour les élections antérieures. Méthode détaillée dans le dépôt.", "Results: Ministry of the Interior (data.gouv.fr) since 2012; Cagé and Piketty, “Une histoire du conflit politique”, for earlier elections. Full method in the repository.")}</p>`;

  pane.querySelector<HTMLSelectElement>("#pair")!.addEventListener("change", (e) => { ui.pair = (e.target as HTMLSelectElement).value; draw(); });
  pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => b.addEventListener("click", () => { ui.metric = b.dataset.metric as Metric; draw(); }));
  draw();
  revealOnScroll(pane);
  redrawOnResize(pane, draw);

  // ---- zoom, pan, and arrows → district pages
  const svg = pane.querySelector<SVGSVGElement>("#shift-svg")!;
  const wrap = svg.parentElement!;
  const hint = pane.querySelector<HTMLElement>("#map-hint")!;
  let hintT = 0;
  const showHint = (t: string) => { hint.textContent = t; hint.classList.add("on"); clearTimeout(hintT); hintT = window.setTimeout(() => hint.classList.remove("on"), 1600); };
  zoom = zoomable(svg, {
    maxZoom: 12,
    onChange: (z, settled) => {
      pane.querySelector<HTMLElement>(".map-reset")!.hidden = z <= 1.001;
      wrap.classList.add("drawn"); // no grow-in animation once the map has been touched
      if (settled) {
        drawArrows(z);
        if (z >= 2.5 && isDistrictMap) {
          const v = svg.viewBox.baseVal, cx = v.x + v.width / 2, cy = v.y + v.height / 2;
          for (const [d, b] of depBounds) if (b[1][0] > v.x && b[0][0] < v.x + v.width && b[1][1] > v.y && b[0][1] < v.y + v.height && Math.hypot((b[0][0] + b[1][0]) / 2 - cx, (b[0][1] + b[1][1]) / 2 - cy) < v.width) loadCircos(d);
        }
      }
    },
    onHint: () => showHint(L("Ctrl + molette (⌘ sur Mac) pour zoomer", "Ctrl + scroll (⌘ on Mac) to zoom")),
  });
  pane.querySelectorAll<HTMLButtonElement>("[data-z]").forEach((b) => b.addEventListener("click", () => (b.dataset.z === "in" ? zoom!.zoomBy(2) : b.dataset.z === "out" ? zoom!.zoomBy(0.5) : zoom!.reset())));
  const loadCircos = async (dep: string) => {
    if (!isDistrictMap || circoLayers.has(dep)) return;
    circoLayers.set(dep, "");
    const g = await loadCircoGeo(dep).catch(() => null);
    if (!g) return;
    const path = geoPath(proj);
    circoLayers.set(dep, g.features.map(rewind).map((cf) => {
      const c = cf.properties!.code as string;
      const [x, y] = path.centroid(cf);
      return `<a href="#/circo/${c}" class="circo-link"><path class="shift-circo" d="${path(cf)}" data-tip="${esc(`${depName.get(dep) ?? dep}, ${L("circonscription", "district")} ${Number(c.slice(-2))}\n${L("Cliquez : résultats et député", "Click: results and MP")}`)}"/><text class="circo-num" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${Number(c.slice(-2))}</text></a>`;
    }).join(""));
    drawArrows(zoom!.level());
  };
  svg.addEventListener("click", (e) => {
    if (zoom!.wasDrag()) { e.preventDefault(); return; }
    const t = e.target as Element;
    const a = t.closest<SVGGElement>(".arrow");
    if (a?.dataset.href) { location.hash = a.dataset.href; return; }
    const dep = t.closest<SVGPathElement>("[data-dep]")?.dataset.dep;
    const b = dep && depBounds.get(dep);
    if (b) { zoom!.zoomToBox(b[0][0], b[0][1], b[1][0], b[1][1]); loadCircos(dep!); }
  });
}

/** Where an arrow (or a movers row) leads: the district page (results, elected MP) or the department's MPs. */
export const unitHref = (code: string) => (code.length >= 4 ? `#/circo/${code}` : `#/assemblee/${code.padStart(2, "0")}`);

/** Units drawn on the mainland map (mainland France + Corsica). */
export const mainland = (pair: ShiftPair, metric: Metric) => Object.entries(pair.units).filter(([, u]) => u[metric] && u.lon > -6 && u.lon < 10 && u.lat > 41 && u.lat < 52);

/** SVG user units per CSS pixel, so arrowheads and strokes keep a readable size on phones. */
export function unitsPerPx(svg: SVGSVGElement, viewWidth: number) {
  const w = svg.getBoundingClientRect().width || viewWidth;
  return Math.min(2.6, Math.max(0.75, viewWidth / w));
}

/** Arrow path from (x, y) for a signed change d. Returns shaft, head and tip. */
export function arrowGeometry(x: number, y: number, d: number, axis: "x" | "y", len: number, k: number) {
  const ux = axis === "x" ? Math.sign(d) * Math.cos(TILT) : 0;
  const uy = axis === "x" ? -Math.sin(TILT) : -Math.sign(d);
  const headLen = Math.min(6.5 * k, len), headW = headLen * 0.5;
  const tx = x + ux * len, ty = y + uy * len;
  const bx = tx - ux * headLen, by = ty - uy * headLen; // base of the head
  const px = -uy * headW, py = ux * headW; // perpendicular
  const head = `M${f(tx)},${f(ty)}L${f(bx + px)},${f(by + py)}L${f(bx - px)},${f(by - py)}Z`;
  const shaft = len > headLen * 1.05 ? `M${f(x)},${f(y)}L${f(bx + ux * 0.6 * k)},${f(by + uy * 0.6 * k)}` : "";
  return { shaft, head };
}

/** SVG arrows for one pair of elections. Arrows grow from their origin when their parent gets `.in`. */
export function arrowPaths(
  pair: ShiftPair,
  metric: Metric,
  proj: GeoProjection | ((p: [number, number]) => [number, number] | null),
  opts: { scale?: number; cap?: number; k?: number; only?: (u: ShiftUnit) => boolean } = {},
) {
  const m = METRICS[metric];
  const k = opts.k ?? 1;
  const scale = opts.scale ?? (pair.level === "district" ? 2.2 : 3); // user units per point of change
  const cap = opts.cap ?? 90;
  return mainland(pair, metric)
    .filter(([, u]) => !opts.only || opts.only(u))
    .sort((a, b) => Math.abs(b[1][metric][2]) - Math.abs(a[1][metric][2])) // small arrows on top
    .map(([code, u]) => {
      const p = proj([u.lon, u.lat]);
      if (!p) return "";
      const d = u[metric][2];
      if (Math.abs(d) < 0.3) return "";
      const len = Math.min(cap, Math.abs(d) * scale);
      const { shaft, head } = arrowGeometry(p[0], p[1], d, m.axis, len, k);
      const color = d > 0 ? m.pos[2] : m.neg[2];
      const dir = d > 0 ? L(m.pos[0], m.pos[1]) : L(m.neg[0], m.neg[1]);
      const tip = `${u.name ?? labelFor(code)}\n${dir}\n${tip3(u, metric, pair)}\n${code.length >= 4 ? L("Cliquez : résultats et député", "Click: results and MP") : L("Cliquez : les députés du département", "Click: the department's MPs")}`;
      const delay = Math.round((p[0] / 800) * 700);
      return `<g class="arrow" data-href="${unitHref(code)}" data-tip="${esc(tip)}" stroke="${color}" fill="${color}" style="--ox:${f(p[0])}px;--oy:${f(p[1])}px;--d:${delay}">${shaft ? `<path class="shaft" d="${shaft}"/>` : ""}<path class="head" d="${head}"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(6 * k)}" class="hit"/></g>`;
    })
    .join("");
}

/** Legend glyph: the same arrow as on the map. */
export function arrowGlyph(metric: Metric, sign: 1 | -1, len = 26) {
  const m = METRICS[metric];
  const color = sign > 0 ? m.pos[2] : m.neg[2];
  const W = m.axis === "x" ? len * Math.cos(TILT) + 6 : 16, H = m.axis === "x" ? len * Math.sin(TILT) + 6 : len + 4;
  const x0 = m.axis === "x" ? (sign > 0 ? 3 : W - 3) : W / 2, y0 = m.axis === "x" ? H - 3 : sign > 0 ? H - 2 : 2;
  const { shaft, head } = arrowGeometry(x0, y0, sign, m.axis, len, 1);
  return `<svg width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true"><path d="${shaft}" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="${head}" fill="${color}"/></svg>`;
}

/** Legend: direction key, then a length key (an arrow of 10 points at screen scale). */
export function legend(metric: Metric, pxPerPoint: number, district = true) {
  const m = METRICS[metric];
  const ten = Math.round(10 * pxPerPoint);
  const lenKey = `<span class="muted" style="font-weight:500"><svg width="${ten + 4}" height="10" aria-hidden="true"><path d="M2,5H${ten + 2}M2,1V9M${ten + 2},1V9" stroke="currentColor" stroke-width="1.2"/></svg>10 ${L("points", "points")}</span>`;
  void district;
  return m.axis === "x"
    ? `<span style="color:${m.neg[2]}">${arrowGlyph(metric, -1)}${L(m.neg[0], m.neg[1])}</span><i class="sep"></i><span style="color:${m.pos[2]}">${L(m.pos[0], m.pos[1])}${arrowGlyph(metric, 1)}</span>${lenKey}`
    : `<span style="color:${m.pos[2]}">${arrowGlyph(metric, 1, 20)}${L(m.pos[0], m.pos[1])}</span><span style="color:${m.neg[2] === "#9aa0aa" ? "var(--ink-2)" : m.neg[2]}">${arrowGlyph(metric, -1, 20)}${L(m.neg[0], m.neg[1])}</span>${lenKey}`;
}

/** Add `.in` to `.reveal` elements as they scroll into view (arrows grow, lines draw). */
export function revealOnScroll(root: HTMLElement) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.15 });
  root.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** Arrow heads are sized in screen pixels, so redraw when the map changes width (e.g. rotation). */
export function redrawOnResize(root: HTMLElement, draw: () => void) {
  let w = window.innerWidth, t = 0;
  const on = () => {
    if (!document.body.contains(root)) return window.removeEventListener("resize", on);
    if (Math.abs(window.innerWidth - w) < 40) return;
    w = window.innerWidth;
    clearTimeout(t);
    t = window.setTimeout(draw, 150);
  };
  window.addEventListener("resize", on);
}

const f = (n: number) => n.toFixed(1);
const fmt1 = (n: number) => n.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`;
const labelFor = (code: string) => (code.length >= 4 ? `${code.slice(0, -2)} · ${Number(code.slice(-2))}` : code);
function tip3(u: ShiftUnit, m: Metric, p: ShiftPair) {
  const [a, b, d] = u[m];
  if (m === "lr") return `${L("Écart droite − gauche", "Right − left margin")} : ${fmt1(a)} → ${fmt1(b)} (${signed(d)})\n${L("Gauche", "Left")} ${fmt1(u.left[0])} → ${fmt1(u.left[1])} · ${L("droite", "right")} ${fmt1(u.right[0])} → ${fmt1(u.right[1])}`;
  return `${p.from} : ${fmt1(a)} % · ${p.to} : ${fmt1(b)} % (${signed(d)})`;
}
