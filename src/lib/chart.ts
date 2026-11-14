// Minimal SVG line chart: polling-average lines with individual poll dots.
import { esc, safeUrl } from "../util";
import { L, fmtDate } from "../i18n";
import { gradeColor, pollValue, pollWeight, pollsterName, pollsterRating, type Poll } from "./polls";
import { dec, pct } from "./format";

export interface Series {
  name: string;
  label: string;
  color: string;
  line: { date: string; value: number }[];
  dots?: { date: string; value: number; title: string; href?: string; /** part of the title shown in colour */ mark?: { text: string; color: string } }[];
  /** Final value shown as a diamond (e.g. actual election result). */
  final?: { date: string; value: number; title: string };
  /** Projection: a dotted line through the knots' `mid` inside a band through their [lo, hi]; the first knot is
   *  today (lo = mid = hi), and the band opens like a funnel from there. */
  /** a ring around one point (the latest poll), in a given colour */
  ring?: { date: string; value: number; color: string; title: string; mark?: string };
  proj?: { knots: { date: string; mid: number; lo: number; hi: number }[]; label?: string; title?: string; /** the candidate withdraws at the last knot: the line stops there with a cross */ out?: boolean };
}

/** One mark per poll under the plot: a short text (the institute's grade) in a colour, linked. */
export interface RugMark { date: string; text: string; color: string; href: string; title: string }

export function lineChart(series: Series[], opts: { height?: number; yMax?: number; markers?: { date: string; label: string; title?: string }[]; /** a short head over the end labels, saying what the figures there are */ endHead?: string; /** marks along the bottom, one per poll, with a label at the left */ rug?: { marks: RugMark[]; label: string } } = {}) {
  // Phones get a narrower canvas so labels stay at 11px or more on a 343px-wide chart (16px units × 343/460).
  const compact = typeof window !== "undefined" && window.innerWidth < 640;
  const head = opts.endHead ? (compact ? 24 : 18) : 0;
  const W = compact ? 460 : 900, H = Math.round((opts.height ?? 380) * (compact ? 1.05 : 1)) + head, L = compact ? 40 : 44, R = compact ? 136 : 150, T = (opts.markers?.length ? (compact ? 34 : 28) : 12) + head, B0 = compact ? 34 : 28;
  const gap = compact ? 19 : 13;
  const rugMarks = opts.rug?.marks ?? [];
  const all = series.flatMap((s) => [...s.line, ...(s.dots ?? []), ...(s.final ? [s.final] : []), ...(s.proj ? s.proj.knots.map((k) => ({ date: k.date, value: k.hi })) : [])]);
  if (!all.length) return "";
  const t = (d: string) => Date.parse(d);
  const x0 = Math.min(...all.map((p) => t(p.date))), x1 = Math.max(...all.map((p) => t(p.date)));
  const yMax = opts.yMax ?? Math.ceil(Math.max(...all.map((p) => p.value)) / 5) * 5 + 5;
  const x = (d: string) => L + ((t(d) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  // the rug: marks laid left to right in up to four rows, a new row when one would touch the previous
  const rugFs = compact ? 14 : 10, rugRow = rugFs + 2, rugMin = rugFs * 1.05;
  const rows: number[] = [];
  const placed = rugMarks.filter((m) => t(m.date) >= x0 && t(m.date) <= x1).sort((a, b) => t(a.date) - t(b.date)).map((m) => {
    const mx = x(m.date);
    let r = rows.findIndex((end) => mx - end >= rugMin);
    if (r < 0) r = rows.length < 4 ? rows.length : rows.indexOf(Math.min(...rows));
    rows[r] = mx;
    return { m, mx, r };
  });
  const rugH = placed.length ? rows.length * rugRow + 8 : 0;
  const B = B0 + rugH;
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
  // phones: month only, with the year on January ("Sept", "Nov", "Jan 27"), so the ticks don't run into each other
  const tickLabel = (m: string) => { const full = fmtDate(m).replace(/^\d+\s/, ""); if (!compact) return full; const [mon, yr] = full.split(" "); return m.slice(5, 7) === "01" && yr ? `${mon} ${yr.slice(2)}` : mon; };
  const ticks = months.filter((_, i) => i % step === 0).map((m) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(tickLabel(m))}</text>`);

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
    const endK = ks.at(-1)!;
    const cross = s.proj?.out ? (() => { const cx = x(endK.date), cy = y(endK.mid), r = compact ? 6 : 5; return `<path class="proj-out" d="M${cx - r},${cy - r}L${cx + r},${cy + r}M${cx - r},${cy + r}L${cx + r},${cy - r}" stroke="${s.color}"><title>${esc(s.proj?.title ?? "")}</title></path>`; })() : "";
    return `<g class="proj"><polygon class="band" points="${[...up, ...dn.reverse()].join(" ")}" fill="${s.color}"><title>${esc(s.proj?.title ?? "")}</title></polygon>
      <polyline class="proj-line" fill="none" stroke="${s.color}" points="${mid.join(" ")}"/>${cross}</g>`;
  };
  const markers = (opts.markers ?? []).filter((m) => t(m.date) >= x0 && t(m.date) <= x1).map((m) => {
    const mx = x(m.date), w = m.label.length * (compact ? 9.4 : 7) + 14, h = compact ? 24 : 18;
    return `<g class="marker"><title>${esc(m.title ?? m.label)}</title><line x1="${mx}" x2="${mx}" y1="${T - 4}" y2="${H - B}"/>
      <rect x="${mx - w / 2}" y="${T - 6 - h}" width="${w}" height="${h}"/><text x="${mx}" y="${T - 6 - h / 2}" text-anchor="middle" dominant-baseline="central">${esc(m.label)}</text></g>`;
  }).join("")

  return `<svg viewBox="0 0 ${W} ${H}" class="chart${compact ? " compact" : ""}" role="img" aria-label="${esc(series.map((s) => `${s.label} ${dec(s.line.at(-1)?.value)}`).join(", "))}">
    ${opts.endHead ? `<text x="${W - 2}" y="${compact ? 17 : 13}" text-anchor="end" class="axis end-head">${esc(opts.endHead)}</text>` : ""}${grid.join("")}${ticks.join("")}${markers}
    ${series
      .map(
        (s) => `<g class="series" data-name="${esc(s.name)}" style="--c:${s.color}">
          ${(s.dots ?? []).map((p) => { const c = `<circle cx="${x(p.date)}" cy="${y(p.value)}" r="${compact ? 3.6 : 3}" class="dot" fill="${s.color}"${p.mark ? ` data-tip-mark="${esc(p.mark.text)}" data-tip-color="${esc(p.mark.color)}"` : ""}><title>${esc(p.title)}</title></circle>`; return p.href ? `<a href="${esc(safeUrl(p.href))}" target="_blank" rel="noopener" class="dot-link">${c}</a>` : c; }).join("")}
          ${proj(s)}
          <polyline class="halo" points="${s.line.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}"/>
          <polyline class="line" pathLength="1" fill="none" stroke="${s.color}" stroke-width="${compact ? 3.4 : 2.6}" stroke-linejoin="round" stroke-linecap="round" points="${s.line.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}"/>
          ${s.ring ? `<circle cx="${x(s.ring.date)}" cy="${y(s.ring.value)}" r="${compact ? 8 : 6.5}" class="ring" fill="none" stroke="${s.ring.color}" stroke-width="${compact ? 2.6 : 2}"${s.ring.mark ? ` data-tip-mark="${esc(s.ring.mark)}" data-tip-color="${esc(s.ring.color)}"` : ""}><title>${esc(s.ring.title)}</title></circle>` : ""}
          ${s.final ? `<path d="M${x(s.final.date)},${y(s.final.value) - 6}l6,6l-6,6l-6,-6z" fill="${s.color}" stroke="var(--card)"><title>${esc(s.final.title)}</title></path>` : ""}
        </g>`,
      )
      .join("")}
    ${placed.length ? `<g class="rug"><text x="${L - 6}" y="${H - B + 6 + rugRow * 0.8}" text-anchor="end" class="axis">${esc(opts.rug!.label)}</text>${placed.map(({ m, mx, r }) => `<a href="${esc(m.href)}"><text x="${mx}" y="${H - B + 6 + rugRow * (r + 0.8)}" text-anchor="middle" fill="${m.color}" font-size="${rugFs}"><title>${esc(m.title)}</title>${esc(m.text)}</text></a>`).join("")}</g>` : ""}
    ${ends.map(({ s, y: yy }) => `<text x="${W - R + 8}" y="${yy + 4}" class="end-label" fill="${s.color}"><title>${esc(s.label)}</title>${esc(compact && (s.proj?.label ?? s.label).length > 11 ? `${(s.proj?.label ?? s.label).slice(0, 10).trim()}…` : s.proj?.label ?? s.label)} <tspan class="v">${s.proj?.out ? "✕" : `${s.proj ? "≈" : ""}${dec(endValue(s))}`}</tspan></text>`).join("")}
  </svg>`;
}

/** Every poll that tested `name` since `from`, as chart dots: hover for the figure, the institute's grade and the
 *  poll's weight in the average; click for the poll's own publication (the pollster's release, else its official
 *  notice at the Commission des sondages; a press article only when neither was found). Never Wikipedia. */
export function pollDots(polls: Poll[], name: string, from: string, _fallback?: string) {
  return polls.filter((p) => p.end >= from).flatMap((p) => {
    const v = pollValue(p, name);
    if (v == null) return [];
    const href = p.url;
    const r = pollsterRating(p.pollster);
    const grade = r?.grade ? L(`note ${r.grade}`, `grade ${r.grade}`) : L("pas encore noté", "not yet graded");
    const open = !href ? "" : p.urlKind === "pollster" ? L("Cliquer : la publication de l’institut", "Click: the pollster’s publication")
      : p.urlKind === "commission" ? L("Cliquer : la notice officielle (Commission des sondages)", "Click: the official notice (Commission des sondages)")
      : L("Cliquer : l’article de presse (publication de l’institut introuvable)", "Click: the press article (the pollster’s own release wasn’t found)");
    return [{ date: p.end, value: v, href, mark: r?.grade ? { text: grade, color: gradeColor(r.grade) } : undefined, title: `${pollsterName(p.pollster)} (${grade}, ${L("poids", "weight")} ${dec(pollWeight(p), 2)}) · ${fmtDate(p.end)}
${name} ${dec(v)} %${open ? `
${open}` : ""}` }];
  });
}
