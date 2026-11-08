// Home hero: 577 dots, one per district, coloured by the sitting MP's group. They gather into the
// map of France, then fly into the Assemblée's hemicycle, and back: from where you live to where it
// is decided. Hover a dot for its MP, click it for the district page.
import { geoConicConformal, geoPath } from "d3-geo";
import type { Depute, ShiftPair } from "../data";
import { L, getLang } from "../i18n";
import { AN_SEATS, seatRank, seatSummary } from "../lib/hemicycle";
import { rewind } from "../lib/map";
import { esc, safeColor } from "../util";

const W = 640, H = 560, R = 4;
/** Group colours are chosen for white paper; lift the darkest ones (RN navy, GDR maroon) so they read on black. */
function onDark(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum > 0.3) return hex;
  const k = 0.3 + (0.3 - lum); // lift darker colours more
  return `rgb(${rgb.map((c) => Math.round(c + (255 - c) * k * 0.6)).join(",")})`;
}
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Dot { code: string; mp?: Depute; mx: number; my: number; hx: number; hy: number; color: string }

/** Seat positions, swept left → right (same geometry as lib/hemicycle, larger canvas). */
function seats(total: number, rows = 12) {
  const cx = W / 2, cy = H - 30, outer = 300, inner = 118;
  const radii = Array.from({ length: rows }, (_, i) => inner + ((outer - inner) * i) / (rows - 1));
  const sumR = radii.reduce((a, b) => a + b, 0);
  const per = radii.map((r) => Math.floor((total * r) / sumR));
  for (let i = rows - 1; per.reduce((a, b) => a + b, 0) < total; i = (i - 1 + rows) % rows) per[i]++;
  const out: { x: number; y: number; a: number }[] = [];
  radii.forEach((r, i) => {
    for (let k = 0; k < per[i]; k++) {
      const a = Math.PI - (Math.PI * (k + 0.5)) / per[i];
      out.push({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a), a });
    }
  });
  return out.sort((p, q) => q.a - p.a);
}

/** Push overlapping dots apart so dense areas (Paris, Lyon, Marseille) stay readable. */
function relax(ds: Dot[], min: number) {
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i], b = ds[j];
        let dx = b.mx - a.mx, dy = b.my - a.my;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        if (d === 0.01) { dx = Math.cos(i); dy = Math.sin(i); }
        const push = (min - d) / 2;
        a.mx -= (dx / d) * push; a.my -= (dy / d) * push;
        b.mx += (dx / d) * push; b.my += (dy / d) * push;
      }
    }
  }
}

export function heroViz(geo: GeoJSON.FeatureCollection, deputes: Depute[], pair: ShiftPair | undefined) {
  if (!pair) return { svg: "", legend: "", start: () => {} };
  const mainland = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
  const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[110, 8], [W - 8, H - 8]], { type: "FeatureCollection", features: mainland } as GeoJSON.FeatureCollection);
  const byCirco = new Map(deputes.filter((d) => d.circo).map((d) => [d.circo!, d]));
  const far: Dot[] = [];
  const dots: Dot[] = Object.entries(pair.units).map(([code, u]) => {
    const mp = byCirco.get(code);
    const p = /^(97|98|99)/.test(code) ? null : proj([u.lon, u.lat]);
    const d: Dot = { code, mp, mx: p?.[0] ?? 0, my: p?.[1] ?? 0, hx: 0, hy: 0, color: onDark(safeColor(mp?.groupe?.couleur) ?? "#5a5d66") };
    if (!p) far.push(d);
    return d;
  });
  relax(dots.filter((d) => !far.includes(d)), 2 * R + 0.5);
  // overseas and abroad: a small grid in the Atlantic, labelled
  far.sort((a, b) => a.code.localeCompare(b.code)).forEach((d, i) => { d.mx = 14 + (i % 6) * 11; d.my = 400 + Math.floor(i / 6) * 11; });
  // seats: groups left → right, and within a group west → east so the flight reads as a sweep
  const order = [...dots].sort((a, b) => (a.mp ? seatRank(a.mp.groupe?.abrev) : 99) - (b.mp ? seatRank(b.mp.groupe?.abrev) : 99) || a.mx - b.mx);
  const pos = seats(order.length);
  order.forEach((d, i) => { d.hx = pos[i].x; d.hy = pos[i].y; });
  const maxX = Math.max(...dots.map((d) => d.mx));
  const seatIndex = new Map(order.map((d, i) => [d, i]));
  // one dot per district = one per statutory seat; vacant seats are the dots without an MP
  const sum = seatSummary(Math.max(order.length, AN_SEATS), order.filter((d) => d.mp).length);

  const svg = `<svg class="hero-dots" id="hero-dots" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Les 577 circonscriptions sur la carte de France, puis les 577 sièges de l’Assemblée nationale", "The 577 districts on the map of France, then the 577 seats of the National Assembly")}">
    <g class="hd-map">${mainland.map((f) => `<path d="${geoPath(proj)(f)}"/>`).join("")}<text x="14" y="388" class="hd-note">${L("Outre-mer et étranger", "Overseas and abroad")}</text></g>
    <g class="hd-hemi"><line x1="${W / 2}" x2="${W / 2}" y1="${H - 30 - 312}" y2="${H - 30 - 104}"/><text x="${W / 2}" y="${H - 72}" text-anchor="middle" class="hd-total">${sum.statutory}</text><text x="${W / 2}" y="${H - 44}" text-anchor="middle" class="hd-note">${sum.vacant ? `${sum.sitting} ${L("députés", "MPs")} · ` : `${L("sièges", "seats")} · `}${L("majorité", "majority")} ${sum.majority}</text></g>
    ${dots
      .map((d) => {
        const tip = d.mp ? `${d.mp.prenom} ${d.mp.nom}\n${d.mp.groupe?.libelle ?? ""}\n${L("Circonscription", "District")} ${Number(d.code.slice(-2))}, ${d.code.startsWith("99") ? L("Français de l’étranger", "French abroad") : d.code.slice(0, d.code.length - 2)}` : `${L("Siège vacant", "Vacant seat")}\n${L("Circonscription", "District")} ${d.code}`;
        return `<circle class="hd" r="${R}" fill="${d.color}" data-code="${d.code}" data-tip="${esc(tip)}" style="--mx:${d.mx.toFixed(1)}px;--my:${d.my.toFixed(1)}px;--hx:${d.hx.toFixed(1)}px;--hy:${d.hy.toFixed(1)}px;--dm:${Math.round((d.mx / maxX) * 900)}ms;--dh:${Math.round((seatIndex.get(d)! / order.length) * 900)}ms"/>`;
      })
      .join("")}
  </svg>`;

  const groups = new Map<string, { abrev: string; label: string; color: string; n: number }>();
  for (const d of order) if (d.mp?.groupe) { const g = d.mp.groupe; const x = groups.get(g.abrev) ?? { abrev: g.abrev, label: g.libelle, color: onDark(safeColor(g.couleur) ?? "#999"), n: 0 }; x.n++; groups.set(g.abrev, x); }
  const vacantTip = L(
    `${sum.vacant > 1 ? "Sièges vacants" : "Siège vacant"}, en attente d’une élection partielle. Majorité absolue des ${sum.sitting} membres en exercice : ${sum.majority} (${sum.fullMajority} quand les ${sum.statutory} sièges sont pourvus).`,
    `${sum.vacant > 1 ? "Vacant seats" : "Vacant seat"}, pending a by-election. Absolute majority of the ${sum.sitting} sitting members: ${sum.majority} (${sum.fullMajority} when all ${sum.statutory} seats are filled).`,
  );
  const legend = `<ul class="hd-legend">${[...groups.values()].map((g) => `<li data-tip="${esc(g.label)}"><i style="background:${g.color}"></i>${esc(g.abrev)} <b>${g.n}</b></li>`).join("")}${sum.vacant ? `<li data-tip="${esc(vacantTip)}"><i style="background:#5a5d66"></i>${L("Vacants", "Vacant")} <b>${sum.vacant}</b></li>` : ""}</ul>`;

  const start = (root: HTMLElement) => {
    const el = root.querySelector<SVGSVGElement>("#hero-dots");
    if (!el) return;
    const caption = root.querySelector<HTMLElement>("#hd-caption")!;
    const buttons = root.querySelectorAll<HTMLButtonElement>("[data-hd]");
    const text = {
      map: L("Chaque point est une circonscription, coloré selon le groupe de son député.", "Each dot is a district, coloured by its MP’s group."),
      hemi: L("Les mêmes 577 points, assis à l’Assemblée, de gauche à droite.", "The same 577 dots, seated in the Assembly, left to right."),
    };
    let mode: "map" | "hemi" = "map", auto = !reduced(), paused = false, timer = 0;
    const set = (m: "map" | "hemi") => {
      mode = m;
      el.classList.toggle("is-hemi", m === "hemi");
      caption.textContent = text[m];
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hd === m)));
    };
    const tick = () => {
      if (!document.body.contains(el)) return;
      if (auto && !paused && !document.hidden) set(mode === "map" ? "hemi" : "map");
      timer = window.setTimeout(tick, mode === "hemi" ? 6500 : 5000);
    };
    set("map");
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("ready")));
    if (auto) timer = window.setTimeout(tick, 3800);
    el.addEventListener("mouseenter", () => (paused = true));
    el.addEventListener("mouseleave", () => (paused = false));
    buttons.forEach((b) => b.addEventListener("click", () => { auto = false; clearTimeout(timer); set(b.dataset.hd as "map" | "hemi"); }));
    el.addEventListener("click", (e) => { const c = (e.target as Element).closest<SVGCircleElement>("circle.hd"); if (c) location.hash = `#/circo/${c.dataset.code}`; });
  };
  return { svg, legend, start };
}

/** Count numbers up from zero once, when shown. */
export function countUp(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el, i) => {
    const target = Number(el.dataset.count), suffix = el.dataset.suffix ?? "";
    const fmt = (v: number) => `${Math.round(v).toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB").replace(/ /g, " ")}${suffix}`;
    if (reduced() || !Number.isFinite(target)) { el.textContent = fmt(target); return; }
    const t0 = performance.now() + 500 + i * 120, dur = 1100;
    const step = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / dur));
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  });
}
