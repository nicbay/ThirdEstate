import { geoConicConformal, geoMercator, geoPath, type GeoProjection } from "d3-geo";
import { ELECTIONS, loadDepartements, presidentialResults, type AreaResult, type Election, type RoundResult } from "../data";
import { L, fmtNum, fmtPct, t } from "../i18n";
import { esc } from "../util";

const OVERSEAS = ["971", "972", "973", "974", "976"];
let state = { round: 1 as 1 | 2, selected: null as string | null };

export async function renderPresidential(app: HTMLElement, year?: number) {
  const election = ELECTIONS.find((e) => e.year === year) ?? ELECTIONS[0];
  const [geo, rounds] = await Promise.all([loadDepartements(), presidentialResults(election)]);
  const s = t();

  // Embeddable block (used inside the Results section).
  app.innerHTML = `
      <div class="card-head">
        <h2>${s.presidentialTitle(election.year)} · ${L("résultats par département", "results by department")}</h2>
        <div class="tabs" role="tablist">
          <button role="tab" data-round="1">${s.round1}</button>
          <button role="tab" data-round="2">${s.round2}</button>
        </div>
      </div>
      <div class="pres-grid">
        <div class="map-card card">
          <svg id="map" viewBox="0 0 600 600" role="img" aria-label="Carte"></svg>
          <div class="overseas-label muted">${s.overseas}</div>
          <div id="overseas" class="overseas"></div>
        </div>
        <aside id="panel" class="card panel"></aside>
      </div>
      <p class="source muted">${s.sourceResults}</p>`;

  const features = geo.features.map(rewind);
  const metro = { type: "FeatureCollection", features: features.filter((f) => f.properties!.code.length === 2) } as GeoJSON.FeatureCollection;

  const draw = () => {
    const round = rounds[state.round - 1];
    app.querySelectorAll<HTMLButtonElement>("[data-round]").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.round) === state.round)));

    // metropolitan map
    const svg = app.querySelector<SVGSVGElement>("#map")!;
    svg.innerHTML = paths(metro.features, geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitSize([600, 600], metro), round, election, 600);

    // overseas insets
    const box = app.querySelector<HTMLElement>("#overseas")!;
    box.innerHTML = OVERSEAS.map((code) => {
      const f = features.find((x) => x.properties!.code === code);
      if (!f) return "";
      const fc = { type: "FeatureCollection", features: [f] } as GeoJSON.FeatureCollection;
      return `<svg viewBox="0 0 100 100" class="inset">${paths(fc.features, geoMercator().fitExtent([[6, 6], [94, 94]], fc), round, election, 100)}</svg>`;
    }).join("") + abroadTile(round, election);

    renderPanel(app.querySelector("#panel")!, round, election);

    app.querySelectorAll<SVGElement | HTMLElement>("[data-code]").forEach((el) =>
      el.addEventListener("click", () => {
        state.selected = state.selected === el.dataset.code ? null : el.dataset.code!;
        draw();
      }),
    );
  };

  app.querySelectorAll<HTMLButtonElement>("[data-round]").forEach((b) =>
    b.addEventListener("click", () => {
      state.round = Number(b.dataset.round) as 1 | 2;
      draw();
    }),
  );
  draw();
}

function color(a: AreaResult | undefined, e: Election) {
  if (!a) return "var(--wash)";
  const lead = a.candidates[0];
  return e.candidates[lead.nom]?.color ?? "#888";
}
/** Stronger fill for a wider lead. */
function opacity(a: AreaResult | undefined) {
  if (!a || a.candidates.length < 2) return 1;
  const margin = a.candidates[0].pct - a.candidates[1].pct;
  return Math.min(1, 0.35 + margin / 30);
}

function paths(fs: GeoJSON.Feature[], proj: GeoProjection, round: RoundResult, e: Election, size: number) {
  const path = geoPath(proj);
  return fs
    .map((f) => {
      const code = f.properties!.code as string;
      const a = round.departments.get(code);
      const lead = a?.candidates[0];
      const title = a && lead ? `${a.name} — ${lead.prenom} ${lead.nom} ${fmtPct(lead.pct)}` : f.properties!.nom;
      const sel = state.selected === code ? " selected" : "";
      return `<path class="dep${sel}" data-code="${code}" d="${path(f)}" fill="${color(a, e)}" fill-opacity="${opacity(a)}" stroke-width="${size > 100 ? 0.6 : 1.2}"><title>${esc(title)}</title></path>`;
    })
    .join("");
}

function abroadTile(round: RoundResult, e: Election) {
  const a = round.departments.get("99");
  if (!a) return "";
  const sel = state.selected === "99" ? " selected" : "";
  return `<button class="abroad${sel}" data-code="99" style="--c:${color(a, e)}">🌍<span>${esc(a.name)}</span></button>`;
}

function renderPanel(el: HTMLElement, round: RoundResult, e: Election) {
  const s = t();
  const a = (state.selected && round.departments.get(state.selected)) || round.national;
  const isNat = a === round.national;
  el.innerHTML = `
    <h2>${isNat ? s.nationalResult : esc(a.name)}${isNat ? "" : ` <span class="muted">(${a.code})</span>`}</h2>
    <div class="kpis">
      <div><span class="muted">${s.turnout}</span><strong>${fmtPct((100 * a.votants) / a.inscrits)}</strong></div>
      <div><span class="muted">${s.registered}</span><strong>${fmtNum(a.inscrits)}</strong></div>
    </div>
    <ol class="bars">
      ${a.candidates
        .map((c) => {
          const col = e.candidates[c.nom]?.color ?? "#888";
          return `<li>
            <div class="bar-label"><span><i class="dot" style="background:${col}"></i>${esc(c.prenom)} <b>${esc(c.nom)}</b> <span class="muted">${e.candidates[c.nom]?.party ?? ""}</span></span><b>${fmtPct(c.pct)}</b></div>
            <div class="bar"><div style="width:${c.pct}%;background:${col}"></div></div>
            <div class="muted small">${fmtNum(c.voix)} ${s.votes}</div>
          </li>`;
        })
        .join("")}
    </ol>
    ${isNat ? `<p class="muted small">${s.clickDept}</p>` : ""}`;
}

/** d3-geo expects clockwise exterior rings; RFC 7946 GeoJSON is counter-clockwise. */
function rewind(f: GeoJSON.Feature): GeoJSON.Feature {
  const area = (r: number[][]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (q[0] - p[0]) * (q[1] + p[1]); }, 0);
  const fix = (rings: number[][][]) => rings.map((r, i) => ((area(r) > 0) === (i === 0) ? r : [...r].reverse()));
  const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const coordinates = g.type === "Polygon" ? fix(g.coordinates) : g.coordinates.map(fix);
  return { ...f, geometry: { type: g.type, coordinates } as GeoJSON.Geometry };
}
