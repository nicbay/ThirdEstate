// Minimal SVG line chart: polling-average lines with individual poll dots.
import { esc } from "../util";
import { fmtDate } from "../i18n";

export interface Series {
  name: string;
  label: string;
  color: string;
  line: { date: string; value: number }[];
  dots?: { date: string; value: number; title: string }[];
  /** Final value shown as a diamond (e.g. actual election result). */
  final?: { date: string; value: number; title: string };
}

export function lineChart(series: Series[], opts: { height?: number; yMax?: number } = {}) {
  const W = 900, H = opts.height ?? 380, L = 36, R = 150, T = 12, B = 28;
  const all = series.flatMap((s) => [...s.line, ...(s.dots ?? []), ...(s.final ? [s.final] : [])]);
  if (!all.length) return "";
  const t = (d: string) => Date.parse(d);
  const x0 = Math.min(...all.map((p) => t(p.date))), x1 = Math.max(...all.map((p) => t(p.date)));
  const yMax = opts.yMax ?? Math.ceil(Math.max(...all.map((p) => p.value)) / 5) * 5 + 5;
  const x = (d: string) => L + ((t(d) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);

  const grid = [];
  for (let v = 0; v <= yMax; v += yMax > 40 ? 10 : 5) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`);
  // month ticks (at most ~8)
  const months: string[] = [];
  const d = new Date(x0);
  d.setUTCDate(1);
  while (d.getTime() <= x1) {
    if (d.getTime() >= x0) months.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const step = Math.ceil(months.length / 8);
  const ticks = months.filter((_, i) => i % step === 0).map((m) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" class="axis">${fmtDate(m).replace(/^\d+\s/, "")}</text>`);

  // end labels, nudged apart so they don't overlap
  const ends = series
    .filter((s) => s.line.length)
    .map((s) => ({ s, y: y(s.line.at(-1)!.value) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">
    ${grid.join("")}${ticks.join("")}
    ${series
      .map(
        (s) => `<g class="series" data-name="${esc(s.name)}">
          ${(s.dots ?? []).map((p) => `<circle cx="${x(p.date)}" cy="${y(p.value)}" r="2.6" fill="${s.color}" class="dot"><title>${esc(p.title)}</title></circle>`).join("")}
          <polyline fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" points="${s.line.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}"/>
          ${s.final ? `<path d="M${x(s.final.date)},${y(s.final.value) - 6}l6,6l-6,6l-6,-6z" fill="${s.color}" stroke="var(--card)"><title>${esc(s.final.title)}</title></path>` : ""}
        </g>`,
      )
      .join("")}
    ${ends.map(({ s, y: yy }) => `<text x="${W - R + 8}" y="${yy + 4}" class="end-label" fill="${s.color}">${esc(s.label)} ${s.line.at(-1)!.value.toFixed(1)}</text>`).join("")}
  </svg>`;
}
