// Minimal SVG line chart: polling-average lines with individual poll dots.
import { esc, safeUrl } from "../util";
import { L, fmtDate } from "../i18n";
import { pollValue, pollsterName, type Poll } from "./polls";
import { dec, pct } from "./format";

export interface Series {
  name: string;
  label: string;
  color: string;
  line: { date: string; value: number }[];
  dots?: { date: string; value: number; title: string; href?: string }[];
  /** Final value shown as a diamond (e.g. actual election result). */
  final?: { date: string; value: number; title: string };
  /** Projection: a dotted line through the knots' `mid` inside a band through their [lo, hi]; the first knot is
   *  today (lo = mid = hi), and the band opens like a funnel from there. */
  proj?: { knots: { date: string; mid: number; lo: number; hi: number }[]; label?: string; title?: string };
}

export function lineChart(series: Series[], opts: { height?: number; yMax?: number; markers?: { date: string; label: string }[] } = {}) {
  // Phones get a narrower canvas so 11px labels stay ~11px instead of shrinking to 4px.
  const compact = typeof window !== "undefined" && window.innerWidth < 640;
  const W = compact ? 520 : 900, H = Math.round((opts.height ?? 380) * (compact ? 1.05 : 1)), L = compact ? 40 : 44, R = compact ? 172 : 150, T = 12, B = compact ? 34 : 28;
  const gap = compact ? 19 : 13;
  const all = series.flatMap((s) => [...s.line, ...(s.dots ?? []), ...(s.final ? [s.final] : []), ...(s.proj ? s.proj.knots.map((k) => ({ date: k.date, value: k.hi })) : [])]);
  if (!all.length) return "";
  const t = (d: string) => Date.parse(d);
  const x0 = Math.min(...all.map((p) => t(p.date))), x1 = Math.max(...all.map((p) => t(p.date)));
  const yMax = opts.yMax ?? Math.ceil(Math.max(...all.map((p) => p.value)) / 5) * 5 + 5;
  const x = (d: string) => L + ((t(d) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);

  const grid = [];
  for (let v = 0; v <= yMax; v += yMax > 40 ? 10 : 5) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid${v === 0 ? " base" : ""}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v + (yMax > 40 ? 10 : 5) > yMax ? pct(v, 0) : v}</text>`);
  // month ticks (at most ~8)
  const months: string[] = [];
  const d = new Date(x0);
  d.setUTCDate(1);
  while (d.getTime() <= x1) {
    if (d.getTime() >= x0) months.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const step = Math.ceil(months.length / (compact ? 4 : 8));
  const ticks = months.filter((_, i) => i % step === 0).map((m) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" class="axis">${fmtDate(m).replace(/^\d+\s/, "")}</text>`);

  // end labels, nudged apart so they don't overlap
  const endValue = (s: Series) => (s.proj ? s.proj.knots.at(-1)!.mid : s.line.at(-1)!.value);
  const ends = series
    .filter((s) => s.line.length)
    .map((s) => ({ s, y: y(endValue(s)) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
  // if the stack ran past the bottom, push it back up from the last label
  if (ends.length && ends[ends.length - 1].y > H - B) {
    ends[ends.length - 1].y = H - B;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < gap) ends[i].y = ends[i + 1].y - gap;
  }

  // projection: a band that opens like a funnel (width grows with the square root of time) and a dotted centre line
  const proj = (s: Series) => {
    const ks = s.proj?.knots;
    if (!ks || ks.length < 2) return "";
    const up: string[] = [], dn: string[] = [], mid: string[] = [];
    for (let k = 0; k + 1 < ks.length; k++) {
      const A = ks[k], B = ks[k + 1];
      const N = k === 0 ? 14 : 4;
      for (let i = k === 0 ? 0 : 1; i <= N; i++) {
        const f = i / N, g = k === 0 ? Math.sqrt(f) : f; // the first stretch opens like a funnel
        const xx = x(new Date(t(A.date) + f * (t(B.date) - t(A.date))).toISOString());
        const m = A.mid + (B.mid - A.mid) * f;
        const lo = A.lo + (B.lo - A.lo) * g, hi = A.hi + (B.hi - A.hi) * g;
        up.push(`${xx},${y(Math.max(m, hi))}`);
        dn.push(`${xx},${y(Math.max(0, Math.min(m, lo)))}`);
        mid.push(`${xx},${y(m)}`);
      }
    }
    return `<g class="proj"><polygon class="band" points="${[...up, ...dn.reverse()].join(" ")}" fill="${s.color}"><title>${esc(s.proj?.title ?? "")}</title></polygon>
      <polyline class="proj-line" fill="none" stroke="${s.color}" points="${mid.join(" ")}"/></g>`;
  };
  const markers = (opts.markers ?? []).filter((m) => t(m.date) >= x0 && t(m.date) <= x1).map((m, i) =>
    `<line class="marker" x1="${x(m.date)}" x2="${x(m.date)}" y1="${T}" y2="${H - B}"/><text class="marker-label" x="${x(m.date) - 4}" y="${T + 10 + i * 13}" text-anchor="end">${esc(m.label)}</text>`).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart${compact ? " compact" : ""}" role="img" aria-label="${esc(series.map((s) => `${s.label} ${dec(s.line.at(-1)?.value)}`).join(", "))}">
    ${grid.join("")}${ticks.join("")}${markers}
    ${series
      .map(
        (s) => `<g class="series" data-name="${esc(s.name)}" style="--c:${s.color}">
          ${(s.dots ?? []).map((p) => { const c = `<circle cx="${x(p.date)}" cy="${y(p.value)}" r="${compact ? 3.6 : 3}" class="dot" fill="${s.color}"><title>${esc(p.title)}</title></circle>`; return p.href ? `<a href="${esc(safeUrl(p.href))}" target="_blank" rel="noopener" class="dot-link">${c}</a>` : c; }).join("")}
          ${proj(s)}
          <polyline class="halo" points="${s.line.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}"/>
          <polyline class="line" pathLength="1" fill="none" stroke="${s.color}" stroke-width="${compact ? 3.4 : 2.6}" stroke-linejoin="round" stroke-linecap="round" points="${s.line.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}"/>
          ${s.final ? `<path d="M${x(s.final.date)},${y(s.final.value) - 6}l6,6l-6,6l-6,-6z" fill="${s.color}" stroke="var(--card)"><title>${esc(s.final.title)}</title></path>` : ""}
        </g>`,
      )
      .join("")}
    ${ends.map(({ s, y: yy }) => `<text x="${W - R + 8}" y="${yy + 4}" class="end-label" fill="${s.color}"><title>${esc(s.label)}</title>${esc(compact && (s.proj?.label ?? s.label).length > 14 ? `${(s.proj?.label ?? s.label).slice(0, 13).trim()}…` : s.proj?.label ?? s.label)} <tspan class="v">${s.proj ? "≈" : ""}${dec(endValue(s))}</tspan></text>`).join("")}
  </svg>`;
}

/** Every poll that tested `name` since `from`, as chart dots: hover for the figure, click for the poll's source
 *  (the pollster's or outlet's page when the record cites one, else the page the record comes from). */
export function pollDots(polls: Poll[], name: string, from: string, fallback?: string) {
  return polls.filter((p) => p.end >= from).flatMap((p) => {
    const v = pollValue(p, name);
    if (v == null) return [];
    const href = p.url ?? fallback;
    return [{ date: p.end, value: v, href, title: `${pollsterName(p.pollster)} · ${fmtDate(p.end)}
${name} ${dec(v)} %${href ? `
${L("Cliquer pour ouvrir la source", "Click to open the source")}` : ""}` }];
  });
}
