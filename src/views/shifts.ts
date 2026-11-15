// Shift map in the manner of the NYT county arrows: one arrow per district (2012–2024) or per
// department (1848–2024), drawn from its centre, on a dark stage.
//
// Direction carries meaning and is never reused:
//   • Left/right metric (lr = right share − left share): the arrow tilts RIGHT and is BLUE when the
//     margin rose (moved right), tilts LEFT and is RED when it fell (moved left).
//   • Far-right vote and turnout are not left/right movements, so they use VERTICAL arrows
//     (up = rose, down = fell) and never point left or right.
//
// The page (#/resultats/bascules):
//   • a headline that states the finding for the two elections and the measure chosen;
//   • a timeline: one bar per pair of consecutive elections since 1848 (the national change), which is
//     also the control — click, drag, arrow keys or play; arrows swing from one pair to the next;
//   • the map: hover or tap an arrow for its card (before → after), click through to the district;
//     zoom, pan, "my department", and Paris again at a larger scale;
//   • the biggest moves, each row lighting its arrow on the map.
import "../styles/shifts.css";
import { geoConicConformal, geoPath, type GeoProjection } from "d3-geo";
import { loadCircoGeo, loadDepartements, loadShifts, type ShiftPair, type ShiftUnit } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { getHome } from "../lib/cloud";
import { colon, dec, pct, signed as signedFmt } from "../lib/format";
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
/** The same families of colour, lifted for the dark stage (navy and ink would vanish on it). */
const NIGHT: Record<Metric, [pos: string, neg: string]> = { lr: ["#6b9bff", "#ff5a6a"], farRight: ["#aab6ff", "#5e6aa0"], turnout: ["#c3a2ff", "#8f94ad"] };
const colorOf = (metric: Metric, positive: boolean, dark = false) => (dark ? NIGHT[metric][positive ? 0 : 1] : METRICS[metric][positive ? "pos" : "neg"][2]);

const ui = { pair: "", level: "district" as "district" | "department", metric: "lr" as Metric };
/** Opens the page on a given pair ("fromId>toId"), e.g. the one picked on the homepage's small shift map. */
export const preselectShift = (pairId: string) => { ui.pair = pairId; ui.level = "district"; ui.metric = "lr"; };
/** Arrow tilt for the left/right metric: 30° above horizontal, like the NYT maps. */
const TILT = Math.PI / 6;
/** Paris and the inner suburbs, drawn again at a larger scale. */
const PARIS = ["75", "92", "93", "94"];
const inParis = (u: ShiftUnit) => u.lon > 2.2 && u.lon < 2.62 && u.lat > 48.72 && u.lat < 48.96;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Department of a unit: "1001" → "01", "2A01" → "2A", "75" → "75". */
const depOf = (code: string) => (code.length >= 4 ? code.slice(0, -2).padStart(2, "0") : code.padStart(2, "0"));

export async function renderShifts(pane: HTMLElement) {
  const [data, geo] = await Promise.all([loadShifts(), loadDepartements()]);
  const id = (p: ShiftPair) => `${p.fromId}>${p.toId}`;
  // the timeline is the department series (1848 → today); the last pairs also exist district by district
  const series = data.pairs.filter((p) => p.level === "department");
  const districts = new Map(data.pairs.filter((p) => p.level === "district").map((p) => [id(p), p]));
  if (!series.some((p) => id(p) === ui.pair)) { ui.pair = id(series.at(-1)!); ui.level = "district"; }
  const current = () => { const dep = series.find((p) => id(p) === ui.pair)!; return ui.level === "district" ? districts.get(ui.pair) ?? dep : dep; };

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

  // Paris inset: district outlines of the four inner departments, at their own projection.
  const parisGeo = await Promise.all(PARIS.map((c) => loadCircoGeo(c).catch(() => null)));
  const parisFeatures = parisGeo.flatMap((g) => (g ? g.features.map(rewind) : []));
  const parisFc = { type: "FeatureCollection", features: parisFeatures.length ? parisFeatures : deps.filter((f) => PARIS.includes(f.properties!.code)) } as GeoJSON.FeatureCollection;
  const projP = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[12, 12], [348, 288]], parisFc);
  const parisBase = parisFc.features.map((f) => `<path d="${geoPath(projP)(f)}" class="shift-base"/>`).join("");
  const [[px0, py0], [px1, py1]] = base.bounds({ type: "FeatureCollection", features: deps.filter((f) => PARIS.includes(f.properties!.code)) } as GeoJSON.FeatureCollection);

  const unitLabel = (code: string, u: ShiftUnit) => u.name ?? (code.length >= 4 ? `${depName.get(depOf(code)) ?? depOf(code)} · ${Number(code.slice(-2))}${L("e", "")}` : depName.get(code) ?? code);
  const home = getHome();
  const homeDep = home && depBounds.has(home.dep) ? home.dep : null;
  const fr = getLang() === "fr";
  const pairLabel = (p: ShiftPair) => `${p.from} → ${p.to}${p.fromId !== String(p.from) || p.toId !== String(p.to) ? ` (${fmtDate(p.fromDate)} → ${fmtDate(p.toDate)})` : ""}`;

  pane.innerHTML = `
    <section class="sx" aria-labelledby="sx-title">
      <header class="sx-top">
        <div id="shift-head" class="sx-head"></div>
        <div class="sx-tools">
          <div class="sx-seg" role="group" aria-label="${L("Mesure", "Measure")}">${(Object.keys(METRICS) as Metric[]).map((k) => `<button type="button" data-metric="${k}">${L(METRICS[k].fr, METRICS[k].en)}</button>`).join("")}</div>
          <div class="sx-seg" id="sx-level" role="group" aria-label="${L("Découpage", "Level")}"><button type="button" data-level="district">${L("Circonscriptions", "Districts")}</button><button type="button" data-level="department">${L("Départements", "Departments")}</button></div>
        </div>
      </header>
      <p class="sx-note" id="shift-note" role="status" hidden></p>

      <div class="sx-time">
        <div class="sx-play" role="group" aria-label="${L("Parcourir les élections", "Step through the elections")}">
          <button type="button" data-step="-1" aria-label="${L("Élections précédentes", "Previous elections")}">◀</button>
          <button type="button" id="sx-play" aria-pressed="false"><span class="sx-play-i" aria-hidden="true"></span><span id="sx-play-t">${L("Lecture", "Play")}</span></button>
          <button type="button" data-step="1" aria-label="${L("Élections suivantes", "Next elections")}">▶</button>
        </div>
        <div class="sx-strip-box">
          <p class="sx-axis"><span id="sx-axis-pos"></span><span id="sx-axis-neg"></span></p>
          <div class="sx-strip" id="sx-strip" role="listbox" aria-orientation="horizontal" aria-label="${L("Élections comparées, de 1848 à aujourd’hui : variation nationale", "Elections compared, 1848 to today: national change")}" tabindex="0"></div>
          <div class="sx-years" id="sx-years" aria-hidden="true"></div>
        </div>
      </div>

      <div class="sx-stage">
        <div class="shift-wrap reveal" id="sx-wrap">
          <svg id="shift-svg" viewBox="0 0 800 780" role="img" aria-label="${L("Carte des bascules", "Shift map")}"><g id="sx-base"></g><g id="sx-arrows"></g><g id="sx-box"></g></svg>
          <div class="map-ctrl" role="group" aria-label="${L("Zoom", "Zoom")}">
            <button type="button" data-z="in" aria-label="${L("Zoomer", "Zoom in")}">+</button>
            <button type="button" data-z="out" aria-label="${L("Dézoomer", "Zoom out")}">−</button>
            <button type="button" data-z="reset" class="map-reset" hidden>${L("France entière", "All of France")}</button>
            ${homeDep ? `<button type="button" data-z="home" class="map-reset sx-home">${esc(L(`Chez vous : ${home!.depName}`, `Yours: ${home!.depName}`))}</button>` : ""}
          </div>
          <p class="map-hint" id="map-hint" aria-live="polite"></p>
          <div class="sx-card" id="sx-card" aria-live="polite"></div>
        </div>
        <aside class="sx-side">
          <div class="shift-legend" id="shift-legend"></div>
          <figure class="paris-inset" id="paris-inset">
            <p>${L("Paris et petite couronne", "Paris and inner suburbs")}</p>
            <svg viewBox="0 0 360 300" role="img" aria-label="${L("Paris et petite couronne", "Paris and inner suburbs")}"></svg>
          </figure>
          <p class="sx-help">${L("Survolez ou touchez une flèche pour ses chiffres, cliquez pour ouvrir la circonscription. Cliquez sur un département, double-cliquez ou pincez pour zoomer ; glissez pour vous déplacer.", "Hover or tap an arrow for its figures, click to open the district. Click a department, double-click or pinch to zoom; drag to move around.")}</p>
          <p class="sx-help" id="shift-caption"></p>
        </aside>
      </div>
    </section>
    <section class="card movers"><header class="card-head"><h2>${L("Les plus fortes bascules", "Biggest moves")}</h2></header><p class="muted small">${L("Passez sur une ligne pour repérer sa flèche sur la carte.", "Point at a row to find its arrow on the map.")}</p><div class="grid-2" id="movers"></div></section>
    <p class="source">${L("Résultats : ministère de l’Intérieur (data.gouv.fr) depuis 2012 ; Cagé et Piketty, « Une histoire du conflit politique », pour les élections antérieures. Méthode détaillée dans le dépôt.", "Results: Ministry of the Interior (data.gouv.fr) since 2012; Cagé and Piketty, “Une histoire du conflit politique”, for earlier elections. Full method in the repository.")}</p>`;

  const svg = pane.querySelector<SVGSVGElement>("#shift-svg")!;
  const wrap = pane.querySelector<HTMLElement>("#sx-wrap")!;
  const layerBase = svg.querySelector<SVGGElement>("#sx-base")!, layerArrows = svg.querySelector<SVGGElement>("#sx-arrows")!, layerBox = svg.querySelector<SVGGElement>("#sx-box")!;
  const card = pane.querySelector<HTMLElement>("#sx-card")!;
  const strip = pane.querySelector<HTMLElement>("#sx-strip")!;

  // ---------- what is on screen: the change shown for each unit (tweened from one pair to the next) ----------
  let shown = new Map<string, number>();
  let tween = 0, tweenGuard = 0;
  let hot: string | null = null; // unit under the pointer (or picked from the list)
  let hotDep: string | null = null; // "my department"
  const k0 = () => unitsPerPx(svg, 800);
  // user units per point; on a narrow map a point gets up to 1.6× more length so that short arrows stay readable (the legend follows)
  const scaleOf = (p: ShiftPair) => (p.level === "district" ? 2.2 : 3) * Math.min(1.6, Math.max(1, Math.sqrt(k0())));
  const drawBase = () => { layerBase.innerHTML = outlines + (current().level === "district" ? [...circoLayers.values()].join("") : ""); };
  const drawArrows = (z: number, values?: Map<string, number>) => {
    const pair = current(), k = k0();
    svg.style.setProperty("--sw", `${((1.9 * k) / z).toFixed(2)}px`);
    svg.style.setProperty("--fs", `${((11 * k) / z).toFixed(2)}px`);
    layerArrows.innerHTML = arrowPaths(pair, ui.metric, proj, { scale: scaleOf(pair) / z, k: k / z, cap: 90 / z, dark: true, card: true, at: values ? (code) => values.get(code) ?? 0 : undefined });
    layerBox.innerHTML = pair.level === "district" ? `<rect class="paris-box" x="${(px0 - 6).toFixed(1)}" y="${(py0 - 6).toFixed(1)}" width="${(px1 - px0 + 12).toFixed(1)}" height="${(py1 - py0 + 12).toFixed(1)}" fill="none" stroke-width="${((1.2 * k) / z).toFixed(2)}"/>` : "";
    markHot();
  };
  const markHot = () => {
    svg.classList.toggle("has-hot", !!(hot || hotDep));
    layerArrows.querySelectorAll<SVGGElement>(".arrow.is-hot").forEach((a) => a.classList.remove("is-hot"));
    if (hot) layerArrows.querySelector<SVGGElement>(`.arrow[data-code="${CSS.escape(hot)}"]`)?.classList.add("is-hot");
    else if (hotDep) layerArrows.querySelectorAll<SVGGElement>(".arrow").forEach((a) => a.classList.toggle("is-hot", depOf(a.dataset.code!) === hotDep));
  };

  // ---------- the card: one unit's figures, or the national picture when nothing is picked ----------
  const drawCard = () => {
    const pair = current(), m = METRICS[ui.metric];
    const u = hot ? pair.units[hot] : null;
    const col = (d: number) => colorOf(ui.metric, d > 0, true);
    const line = (label: string, t: [number, number, number] | undefined, pctUnit = true) => (t ? `<p class="sx-row"><span>${label}</span><b>${pctUnit ? pct(t[0]) : fmt1(t[0])} → ${pctUnit ? pct(t[1]) : fmt1(t[1])}</b></p>` : "");
    if (hot && u?.[ui.metric]) {
      const t = u[ui.metric], d = t[2];
      card.innerHTML = `<p class="sx-k">${pair.from} → ${pair.to}</p>
        <h3>${esc(unitLabel(hot, u))}</h3>
        <p class="sx-big" style="color:${col(d)}">${signed(d)} <span>${L("pts", "pts")} · ${(d > 0 ? L(m.pos[0], m.pos[1]) : d < 0 ? L(m.neg[0], m.neg[1]) : L("Stable", "No change")).toLowerCase()}</span></p>
        ${ui.metric === "lr" ? `${line(L("Écart droite − gauche", "Right − left margin"), t, false)}${line(L("Gauche et écologistes", "Left and greens"), u.left)}${line(L("Droite et extrême droite", "Right and far right"), u.right)}` : line(L(m.fr, m.en), t)}
        <a href="${unitHref(hot)}">${hot.length >= 4 ? L("Résultats et député", "Results and MP") : L("Les députés du département", "The department’s MPs")} →</a>`;
      return;
    }
    const units = mainland(pair, ui.metric);
    const inDep = hotDep ? units.filter(([c]) => depOf(c) === hotDep) : [];
    if (hotDep && inDep.length) {
      const nPos = inDep.filter(([, x]) => x[ui.metric][2] > 0).length;
      const mean = inDep.reduce((s, [, x]) => s + x[ui.metric][2], 0) / inDep.length;
      card.innerHTML = `<p class="sx-k">${L("Chez vous", "Where you live")} · ${pair.from} → ${pair.to}</p>
        <h3>${esc(depName.get(hotDep) ?? hotDep)}</h3>
        <p class="sx-big" style="color:${col(mean)}">${signed(mean)} <span>${L("pts", "pts")}${inDep.length > 1 ? ` ${L("en moyenne", "on average")}` : ""}</span></p>
        ${inDep.length > 1 ? `<p class="sx-row"><span>${L(m.pos[0], m.pos[1])}</span><b>${nPos} ${L("circonscriptions sur", "districts of")} ${inDep.length}</b></p>` : ""}
        <a href="#/assemblee/${hotDep}">${L("Les députés du département", "The department’s MPs")} →</a>`;
      return;
    }
    const nat = pair.national[ui.metric];
    card.innerHTML = `<p class="sx-k">${L("France entière", "All of France")} · ${pair.from} → ${pair.to}</p>
      ${nat ? `<p class="sx-big" style="color:${col(nat[2])}">${signed(nat[2])} <span>${L("pts", "pts")}</span></p>${ui.metric === "lr" ? `${line(L("Écart droite − gauche", "Right − left margin"), nat, false)}${line(L("Gauche et écologistes", "Left and greens"), pair.national.left)}${line(L("Droite et extrême droite", "Right and far right"), pair.national.right)}` : line(L(m.fr, m.en), nat)}` : ""}
      <p class="sx-hint">${L("Survolez ou touchez une flèche.", "Hover or tap an arrow.")}</p>`;
  };
  const setHot = (code: string | null) => { if (code === hot) return; hot = code; markHot(); drawCard(); };

  // ---------- timeline: one bar per pair, the national change for the measure ----------
  const drawStrip = () => {
    const m = METRICS[ui.metric];
    const vals = series.map((p) => (metricAvailable(p, ui.metric) ? p.national[ui.metric]?.[2] ?? null : null));
    const max = Math.max(1, ...vals.map((v) => Math.abs(v ?? 0)));
    strip.innerHTML = series.map((p, i) => {
      const v = vals[i], on = id(p) === ui.pair;
      const what = v == null ? L("pas de données", "no data") : `${signed(v)} ${L("points", "points")}, ${(v > 0 ? L(m.pos[0], m.pos[1]) : L(m.neg[0], m.neg[1])).toLowerCase()}`;
      return `<button type="button" role="option" tabindex="-1" class="sx-bar${v == null ? " is-na" : v > 0 ? " is-pos" : " is-neg"}${districts.has(id(p)) ? " has-district" : ""}" data-pair="${id(p)}" aria-selected="${on}" aria-label="${esc(`${pairLabel(p)} : ${what}`)}" style="--h:${v == null ? 0 : ((48 * Math.abs(v)) / max).toFixed(1)}%;--c:${v == null ? "transparent" : colorOf(ui.metric, v > 0, true)}"><i></i></button>`;
    }).join("");
    pane.querySelector("#sx-axis-pos")!.textContent = `▲ ${L(m.pos[0], m.pos[1])}`;
    pane.querySelector("#sx-axis-neg")!.textContent = `▼ ${L(m.neg[0], m.neg[1])}`;
    // a year label every quarter-century or so, never closer than five bars apart
    const marks: number[] = [0];
    series.forEach((p, i) => { if (i - marks.at(-1)! >= 5 && i < series.length - 3 && Math.floor(p.from / 25) !== Math.floor(series[i - 1].from / 25)) marks.push(i); });
    pane.querySelector("#sx-years")!.innerHTML = marks.map((i) => `<span style="left:${(((i + 0.5) / series.length) * 100).toFixed(2)}%">${series[i].from}</span>`).join("") + `<span class="is-last" style="left:100%">${series.at(-1)!.to}</span>`;
  };

  // ---------- one full draw: headline, timeline state, map, inset, legend, lists ----------
  const draw = (animate = false) => {
    const dep = series.find((p) => id(p) === ui.pair)!;
    const hasDistrict = districts.has(ui.pair);
    const pair = current();
    const district = pair.level === "district";
    // a measure with no data for these two elections (far right before 1956) is disabled, with a note
    const missing = (Object.keys(METRICS) as Metric[]).filter((k) => !metricAvailable(pair, k));
    const fellBack = !metricAvailable(pair, ui.metric) ? ui.metric : null;
    if (fellBack) { ui.metric = "lr"; drawStrip(); }
    pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => {
      const off = missing.includes(b.dataset.metric as Metric);
      b.disabled = off;
      b.title = off ? L(`Pas de données pour ${pair.from} → ${pair.to}`, `No data for ${pair.from} → ${pair.to}`) : "";
      b.setAttribute("aria-pressed", String(b.dataset.metric === ui.metric));
    });
    const lv = pane.querySelector<HTMLElement>("#sx-level")!;
    lv.hidden = !hasDistrict;
    lv.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === pair.level)));
    const note = pane.querySelector<HTMLElement>("#shift-note")!;
    note.hidden = !missing.length;
    note.textContent = missing.length
      ? `${fellBack ? L(`« ${METRICS[fellBack].fr} » n’est pas disponible pour cette période : affichage gauche-droite. `, `“${METRICS[fellBack].en}” isn’t available for this period, showing left–right instead. `) : ""}${missing.map((k) => L(METRICS[k].fr, METRICS[k].en)).join(", ")}${L(
          " : aucune liste de cette famille dans les résultats de l’une des deux élections, donc rien à comparer.",
          ": no list of that family in the results of one of the two elections, so nothing to compare.",
        )}`
      : "";
    strip.querySelectorAll<HTMLButtonElement>(".sx-bar").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pair === ui.pair)));
    strip.setAttribute("aria-activedescendant", "");

    const m = METRICS[ui.metric];
    const units = mainland(pair, ui.metric);
    const k = k0();
    const scale = scaleOf(pair);
    const nat = pair.national[ui.metric];
    const sorted = [...units].sort((a, b) => b[1][ui.metric][2] - a[1][ui.metric][2]);
    const nPos = units.filter(([, u]) => u[ui.metric][2] > 0).length, nNeg = units.filter(([, u]) => u[ui.metric][2] < 0).length;
    const what = district ? L("circonscriptions", "districts") : L("départements", "departments");
    const lead = nPos >= nNeg ? { n: nPos, side: m.pos, top: sorted[0] } : { n: nNeg, side: m.neg, top: sorted.at(-1) };
    const natCol = nat ? colorOf(ui.metric, nat[2] > 0, true) : "#fff";
    pane.querySelector("#shift-head")!.innerHTML = `
      <p class="sx-k">${district ? L("Législatives, 1er tour · par circonscription", "Legislative first round · by district") : L("Législatives, 1er tour · par département", "Legislative first round · by department")}${dep.fromId !== String(dep.from) || dep.toId !== String(dep.to) ? ` · ${fmtDate(dep.fromDate)} → ${fmtDate(dep.toDate)}` : ""}</p>
      <h2 id="sx-title">${fr ? `De ${pair.from} à ${pair.to}` : `From ${pair.from} to ${pair.to}`}${nat ? `<span style="color:${natCol}"> ${signed(nat[2])} ${L("points", "points")}</span>` : ""}</h2>
      <p class="sx-dek">${nat ? `${nat[2] > 0 ? L(m.pos[0], m.pos[1]) : L(m.neg[0], m.neg[1])} ${L("au niveau national", "nationally")} (${ui.metric === "lr" ? `${L("écart droite − gauche", "right − left margin")} ${fmt1(nat[0])} → ${fmt1(nat[1])}` : `${pct(nat[0])} → ${pct(nat[1])}`}). ` : ""}${units.length ? `${fr ? `${lead.n} ${what} sur ${units.length} : ${lead.side[0].toLowerCase()}` : `${lead.n} of ${units.length} ${what}: ${lead.side[1].toLowerCase()}`}${lead.top ? L(` ; la plus forte variation, ${unitLabel(lead.top[0], lead.top[1])} (${signed(lead.top[1][ui.metric][2])}).`, `; the largest change, ${unitLabel(lead.top[0], lead.top[1])} (${signed(lead.top[1][ui.metric][2])}).`) : "."}` : ""}</p>`;

    // the map: swing from what is shown to the new values, or draw (and let the arrows grow) the first time
    const target = new Map(units.map(([c, u]) => [c, u[ui.metric][2]]));
    cancelAnimationFrame(tween);
    clearTimeout(tweenGuard);
    drawBase();
    if (hot && !target.has(hot)) hot = null;
    const z = () => zoom?.level() ?? 1;
    if (animate && shown.size && !reduced()) {
      const from = shown, t0 = performance.now(), dur = district ? 520 : 700;
      wrap.classList.add("drawn");
      const step = (t: number) => {
        if (!document.body.contains(svg)) return;
        const q = Math.min(1, (t - t0) / dur), e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
        const now = new Map<string, number>();
        for (const [c, v] of target) now.set(c, (from.get(c) ?? 0) + (v - (from.get(c) ?? 0)) * e);
        shown = now;
        drawArrows(z(), q < 1 ? now : undefined);
        if (q < 1) tween = requestAnimationFrame(step); else shown = target;
      };
      tween = requestAnimationFrame(step);
      // a tab that isn’t painting gets no frames: land on the final state anyway
      tweenGuard = window.setTimeout(() => { if (shown !== target) { cancelAnimationFrame(tween); shown = target; drawArrows(z()); } }, dur + 250);
    } else {
      shown = target;
      drawArrows(z());
    }
    drawCard();

    // the inset keeps the same on-screen length per point as the main map
    const inset = pane.querySelector<HTMLElement>("#paris-inset")!;
    inset.hidden = !district;
    if (district) {
      const isvg = inset.querySelector<SVGSVGElement>("svg")!;
      const ki = unitsPerPx(isvg, 360);
      isvg.style.setProperty("--sw", `${(1.9 * ki).toFixed(2)}px`);
      isvg.innerHTML = parisBase + arrowPaths(pair, ui.metric, projP, { scale: (scale / k) * ki, k: ki, cap: 90 * (ki / k), only: inParis, dark: true });
    }

    pane.querySelector("#shift-legend")!.innerHTML = legend(ui.metric, scale / k, district, true);
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
          ? `<table class="table"><thead><tr><th>${district ? L("Circonscription", "District") : L("Département", "Department")}</th><th class="num">${pair.from}</th><th class="num">${pair.to}</th><th class="num">${L("Variation", "Change")}</th></tr></thead><tbody>${list
              .map(([code, u]) => { const t = u[ui.metric], d = t[2]; return `<tr data-code="${esc(code)}"><td><a href="${unitHref(code)}">${esc(unitLabel(code, u))}</a></td><td class="num muted">${fmt1(t[0])}</td><td class="num muted">${fmt1(t[1])}</td><td class="num"><span class="mover-bar" style="width:${Math.round((48 * Math.abs(d)) / maxAbs)}px;background:${side[2]}"></span>${signed(d)}</td></tr>`; })
              .join("")}</tbody></table>`
          : `<p class="muted small">${L("Aucune.", "None.")}</p>`
      }</section>`)
      .join("");
  };

  // ---------- controls ----------
  let playing = 0;
  const playBtn = pane.querySelector<HTMLButtonElement>("#sx-play")!;
  const stop = () => { clearTimeout(playing); playing = 0; playBtn.setAttribute("aria-pressed", "false"); pane.querySelector("#sx-play-t")!.textContent = L("Lecture", "Play"); };
  const select = (pairId: string, animate = true) => {
    if (pairId === ui.pair || !series.some((p) => id(p) === pairId)) return;
    const wasDistrict = current().level === "district";
    if (!districts.has(ui.pair) && !playing) ui.level = "district"; // coming from a pair with departments only: the finest view by default
    ui.pair = pairId;
    const nowDistrict = current().level === "district";
    draw(animate && wasDistrict === nowDistrict);
    strip.querySelector<HTMLElement>(`[data-pair="${CSS.escape(pairId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const stepBy = (n: number) => { const i = series.findIndex((p) => id(p) === ui.pair); const j = Math.min(series.length - 1, Math.max(0, i + n)); if (j !== i) select(id(series[j])); return j !== i; };
  pane.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) => b.addEventListener("click", () => { stop(); stepBy(Number(b.dataset.step)); }));
  playBtn.addEventListener("click", () => {
    if (playing) return stop();
    // from the start when already on the last pair; department arrows throughout, so the map keeps its units
    if (series.findIndex((p) => id(p) === ui.pair) === series.length - 1) { ui.pair = id(series[0]); ui.level = "department"; draw(false); }
    else if (ui.level !== "department") { ui.level = "department"; draw(false); }
    playBtn.setAttribute("aria-pressed", "true");
    pane.querySelector("#sx-play-t")!.textContent = L("Pause", "Pause");
    const tick = () => {
      if (!document.body.contains(pane)) return;
      if (!stepBy(1)) return stop();
      playing = window.setTimeout(tick, 1500);
    };
    playing = window.setTimeout(tick, 900);
  });
  // the strip: click or drag across the bars, arrow keys when focused
  const barAt = (x: number) => { const bars = [...strip.querySelectorAll<HTMLElement>(".sx-bar")]; return bars.find((b) => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right; }) ?? null; };
  let scrubbing = false;
  strip.addEventListener("pointerdown", (e) => { scrubbing = true; stop(); const b = barAt(e.clientX); if (b) select(b.dataset.pair!); });
  strip.addEventListener("pointermove", (e) => { if (!scrubbing || e.pointerType === "touch") return; const b = barAt(e.clientX); if (b) select(b.dataset.pair!); });
  window.addEventListener("pointerup", function up() { if (!document.body.contains(pane)) return window.removeEventListener("pointerup", up); scrubbing = false; });
  strip.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>(".sx-bar"); if (b) { stop(); select(b.dataset.pair!); } });
  strip.addEventListener("keydown", (e) => {
    const move = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -999 : e.key === "End" ? 999 : 0;
    if (!move) return;
    e.preventDefault(); stop(); stepBy(move);
  });
  pane.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((b) => b.addEventListener("click", () => { if (b.disabled) return; ui.metric = b.dataset.metric as Metric; drawStrip(); draw(true); }));
  pane.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => b.addEventListener("click", () => { stop(); ui.level = b.dataset.level as "district" | "department"; draw(false); }));

  drawStrip();
  draw();
  strip.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  revealOnScroll(pane);
  redrawOnResize(pane, () => draw());

  // ---------- zoom, pan, arrows → card → district pages ----------
  const hint = pane.querySelector<HTMLElement>("#map-hint")!;
  let hintT = 0;
  const showHint = (t: string) => { hint.textContent = t; hint.classList.add("on"); clearTimeout(hintT); hintT = window.setTimeout(() => hint.classList.remove("on"), 1600); };
  zoom = zoomable(svg, {
    maxZoom: 12,
    onChange: (z, settled) => {
      pane.querySelector<HTMLElement>(".map-reset")!.hidden = z <= 1.001;
      wrap.classList.add("drawn"); // no grow-in animation once the map has been touched
      wrap.classList.toggle("is-busy", !settled);
      if (z <= 1.001 && hotDep) { hotDep = null; markHot(); drawCard(); }
      if (settled) {
        drawArrows(z);
        if (z >= 2.5 && current().level === "district") {
          const v = svg.viewBox.baseVal, cx = v.x + v.width / 2, cy = v.y + v.height / 2;
          for (const [d, b] of depBounds) if (b[1][0] > v.x && b[0][0] < v.x + v.width && b[1][1] > v.y && b[0][1] < v.y + v.height && Math.hypot((b[0][0] + b[1][0]) / 2 - cx, (b[0][1] + b[1][1]) / 2 - cy) < v.width) loadCircos(d);
        }
      }
    },
    onHint: () => showHint(L("Ctrl + molette (⌘ sur Mac) pour zoomer", "Ctrl + scroll (⌘ on Mac) to zoom")),
  });
  const loadCircos = async (dep: string) => {
    if (current().level !== "district" || circoLayers.has(dep)) return;
    circoLayers.set(dep, "");
    const g = await loadCircoGeo(dep).catch(() => null);
    if (!g) return;
    const path = geoPath(proj);
    circoLayers.set(dep, g.features.map(rewind).map((cf) => {
      const c = cf.properties!.code as string;
      const [x, y] = path.centroid(cf);
      return `<a href="#/circo/${c}" class="circo-link"><path class="shift-circo" d="${path(cf)}" data-tip="${esc(`${depName.get(dep) ?? dep}, ${L("circonscription", "district")} ${Number(c.slice(-2))}\n${L("Cliquez : résultats et député", "Click: results and MP")}`)}"/><text class="circo-num" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${Number(c.slice(-2))}</text></a>`;
    }).join(""));
    drawBase();
  };
  const toDep = (dep: string) => { const b = depBounds.get(dep); if (b) { zoom!.zoomToBox(b[0][0], b[0][1], b[1][0], b[1][1]); loadCircos(dep); } };
  pane.querySelectorAll<HTMLButtonElement>("[data-z]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.z;
    if (a === "in") zoom!.zoomBy(2);
    else if (a === "out") zoom!.zoomBy(0.5);
    else if (a === "home" && homeDep) { hot = null; hotDep = homeDep; toDep(homeDep); markHot(); drawCard(); }
    else zoom!.reset();
  }));

  let pointer = "mouse";
  svg.addEventListener("pointerdown", (e) => { pointer = e.pointerType; }, true);
  svg.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse" || wrap.classList.contains("is-busy")) return; setHot((e.target as Element).closest<SVGGElement>(".arrow")?.dataset.code ?? null); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setHot(null); });
  svg.addEventListener("click", (e) => {
    if (zoom!.wasDrag()) { e.preventDefault(); return; }
    const t = e.target as Element;
    const a = t.closest<SVGGElement>(".arrow");
    if (a?.dataset.code) {
      // a finger has no hover: the first tap shows the card (with its link), the second opens the page
      if (pointer !== "mouse" && hot !== a.dataset.code) { setHot(a.dataset.code); return; }
      location.hash = unitHref(a.dataset.code);
      return;
    }
    if (pointer !== "mouse" && hot) setHot(null);
    const dep = t.closest<SVGPathElement>("[data-dep]")?.dataset.dep;
    if (dep) toDep(dep);
  });
  // the lists light their arrow on the map
  const movers = pane.querySelector<HTMLElement>("#movers")!;
  const rowCode = (e: Event) => (e.target as Element).closest<HTMLElement>("tr[data-code]")?.dataset.code ?? null;
  movers.addEventListener("pointerover", (e) => { if ((e as PointerEvent).pointerType === "mouse") setHot(rowCode(e)); });
  movers.addEventListener("pointerleave", () => setHot(null));
  movers.addEventListener("focusin", (e) => setHot(rowCode(e)));
  movers.addEventListener("focusout", () => setHot(null));
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
  opts: {
    scale?: number; cap?: number; k?: number; only?: (u: ShiftUnit) => boolean;
    /** colours for the dark stage */ dark?: boolean;
    /** the page shows its own card: no tooltip text on the arrows */ card?: boolean;
    /** value to draw instead of the pair's own change (used to swing arrows from one pair to the next) */ at?: (code: string, u: ShiftUnit) => number;
  } = {},
) {
  const m = METRICS[metric];
  const k = opts.k ?? 1;
  const scale = opts.scale ?? (pair.level === "district" ? 2.2 : 3); // user units per point of change
  const cap = opts.cap ?? 90;
  const val = (code: string, u: ShiftUnit) => (opts.at ? opts.at(code, u) : u[metric][2]);
  return mainland(pair, metric)
    .filter(([, u]) => !opts.only || opts.only(u))
    .sort((a, b) => Math.abs(val(b[0], b[1])) - Math.abs(val(a[0], a[1]))) // small arrows on top
    .map(([code, u]) => {
      const p = proj([u.lon, u.lat]);
      if (!p) return "";
      const d = val(code, u);
      if (Math.abs(d) < 0.3) return "";
      const len = Math.min(cap, Math.abs(d) * scale);
      const { shaft, head } = arrowGeometry(p[0], p[1], d, m.axis, len, k);
      const color = colorOf(metric, d > 0, opts.dark);
      const dir = d > 0 ? L(m.pos[0], m.pos[1]) : L(m.neg[0], m.neg[1]);
      const tip = opts.card ? "" : `${u.name ?? labelFor(code)}\n${dir}\n${tip3(u, metric, pair)}\n${code.length >= 4 ? L("Cliquez : résultats et député", "Click: results and MP") : L("Cliquez : les députés du département", "Click: the department's MPs")}`;
      const delay = Math.round((p[0] / 800) * 700);
      return `<g class="arrow" data-code="${esc(code)}" data-href="${unitHref(code)}"${tip ? ` data-tip="${esc(tip)}"` : ""} stroke="${color}" fill="${color}" style="--ox:${f(p[0])}px;--oy:${f(p[1])}px;--d:${delay}">${shaft ? `<path class="shaft" d="${shaft}"/>` : ""}<path class="head" d="${head}"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(6 * k)}" class="hit"/></g>`;
    })
    .join("");
}

/** Legend glyph: the same arrow as on the map. */
export function arrowGlyph(metric: Metric, sign: 1 | -1, len = 26, dark = false) {
  const m = METRICS[metric];
  const color = colorOf(metric, sign > 0, dark);
  const W = m.axis === "x" ? len * Math.cos(TILT) + 6 : 16, H = m.axis === "x" ? len * Math.sin(TILT) + 6 : len + 4;
  const x0 = m.axis === "x" ? (sign > 0 ? 3 : W - 3) : W / 2, y0 = m.axis === "x" ? H - 3 : sign > 0 ? H - 2 : 2;
  const { shaft, head } = arrowGeometry(x0, y0, sign, m.axis, len, 1);
  return `<svg width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true"><path d="${shaft}" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="${head}" fill="${color}"/></svg>`;
}

/** Legend: direction key, then a length key (an arrow of 10 points at screen scale). */
export function legend(metric: Metric, pxPerPoint: number, district = true, dark = false) {
  const m = METRICS[metric];
  const ten = Math.round(10 * pxPerPoint);
  const pos = colorOf(metric, true, dark), neg = colorOf(metric, false, dark);
  const lenKey = `<span class="muted" style="font-weight:500"><svg width="${ten + 4}" height="10" aria-hidden="true"><path d="M2,5H${ten + 2}M2,1V9M${ten + 2},1V9" stroke="currentColor" stroke-width="1.2"/></svg>10 ${L("points", "points")}</span>`;
  void district;
  return m.axis === "x"
    ? `<span style="color:${neg}">${arrowGlyph(metric, -1, 26, dark)}${L(m.neg[0], m.neg[1])}</span><i class="sep"></i><span style="color:${pos}">${L(m.pos[0], m.pos[1])}${arrowGlyph(metric, 1, 26, dark)}</span>${lenKey}`
    : `<span style="color:${pos}">${arrowGlyph(metric, 1, 20, dark)}${L(m.pos[0], m.pos[1])}</span><span style="color:${!dark && neg === "#9aa0aa" ? "var(--ink-2)" : neg}">${arrowGlyph(metric, -1, 20, dark)}${L(m.neg[0], m.neg[1])}</span>${lenKey}`;
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

/** SVG coordinate (not display text). */
const f = (n: number) => n.toFixed(1);
const fmt1 = (n: number | null | undefined) => dec(n, 1);
const signed = (n: number | null | undefined) => signedFmt(n, 1);
const labelFor = (code: string) => (code.length >= 4 ? `${code.slice(0, -2)} · ${Number(code.slice(-2))}` : code);
function tip3(u: ShiftUnit, m: Metric, p: ShiftPair) {
  const [a, b, d] = u[m] ?? [];
  if (m === "lr") return `${L("Écart droite − gauche", "Right − left margin")}${colon()}${fmt1(a)} → ${fmt1(b)} (${signed(d)})\n${L("Gauche", "Left")} ${fmt1(u.left?.[0])} → ${fmt1(u.left?.[1])} · ${L("droite", "right")} ${fmt1(u.right?.[0])} → ${fmt1(u.right?.[1])}`;
  return `${p.from}${colon()}${pct(a)} · ${p.to}${colon()}${pct(b)} (${signed(d)})`;
}

/** Whether a metric has data for both elections of a pair. The build marks a category nobody stood
 *  under (e.g. no far-right lists before 1956) as `absent`, and its figures are then zeros, not data. */
export function metricAvailable(pair: ShiftPair, metric: Metric) {
  const absent = (pair.national as { absent?: string[] }).absent ?? [];
  if (metric === "lr") return true;
  return !absent.includes(`${metric}@${pair.fromId}`) && !absent.includes(`${metric}@${pair.toId}`) && !!pair.national[metric];
}
