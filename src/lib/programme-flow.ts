// Node graph of a programme's evolution (n8n-style): each source version on the left feeds its branches
// (kept, changed, added, dropped…), which end either in the latest programme or in "dropped".
// Shared by the programme pages and the homepage feature. Layout is computed from the branch list,
// so a 3-version programme (2022 → 2025 → 2027) and a 2-version one (2022 → 2027) use the same code.
import { L, fmtNum } from "../i18n";
import { esc, safeUrl } from "../util";

export interface FlowBranch { id: string; icon: string; title: string; n: number; drop?: boolean }
/** A source document: where a version box (and the final programme box) links to. `kind` is the data's version kind. */
export interface FlowDoc { url: string; kind?: string }
export interface FlowSource { id: string; icon: string; title: string; sub: string; out: string[]; doc?: FlowDoc }
export interface FlowSpec { sources: FlowSource[]; branches: FlowBranch[]; keepTitle: string; keepN: number; goneN: number; label: string; keepDoc?: FlowDoc }

interface Box { id: string; x: number; y: number; w: number; h: number; kind: "source" | "branch" | "sink"; icon: string; title: string; sub: string; branch?: string; drop?: boolean; doc?: FlowDoc }

/** "PDF" for a manifesto file, "site" for a campaign website, "source" for an article or announcement page. */
const docLabel = (d: FlowDoc) => (/pdf/i.test(d.kind ?? "") || /\.pdf(\?|#|$)/i.test(d.url) ? "PDF" : d.kind === "site" ? L("site", "site") : L("source", "source"));

/** Node titles must fit their box: cut at a word boundary and add an ellipsis (full text in the tooltip). */
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n).replace(/[\s,:;(–-]+\S*$/, "")}…`);
const items = (k: number) => `${fmtNum(k)} ${k > 1 ? L("mesures", "measures") : L("mesure", "measure")}`;

/** `pick`: the highlighted branch id. `compact`: no edge labels, no ports (homepage teaser). */
export function flowSvg(spec: FlowSpec, pick = "", compact = false) {
  const BH = 58, GAP = 22, top = 14;
  const branchY = new Map(spec.branches.map((b, i) => [b.id, top + i * (BH + GAP)]));
  const H = top * 2 + spec.branches.length * (BH + GAP) - GAP;
  const mid = (ids: string[]) => { const ys = ids.map((id) => branchY.get(id)! + BH / 2); return ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : H / 2; };
  const N: Box[] = [];
  for (const s of spec.sources) N.push({ id: s.id, x: 10, y: mid(s.out) - 32, w: 180, h: 64, kind: "source", icon: s.icon, title: s.title, sub: s.sub, doc: s.doc });
  for (const b of spec.branches) N.push({ id: b.id, x: 360, y: branchY.get(b.id)!, w: 220, h: BH, kind: "branch", icon: b.icon, title: b.title, sub: items(b.n), branch: b.id, drop: b.drop });
  const keepIds = spec.branches.filter((b) => !b.drop).map((b) => b.id), goneIds = spec.branches.filter((b) => b.drop).map((b) => b.id);
  let keepY = mid(keepIds) - 35, goneY = mid(goneIds) - 35;
  if (goneIds.length && Math.abs(keepY - goneY) < 90) { // keep the two sinks apart
    if (keepY < goneY) goneY = keepY + 90; else keepY = goneY + 90;
  }
  N.push({ id: "keep", x: 712, y: Math.max(4, keepY), w: 186, h: 70, kind: "sink", icon: "✓", title: spec.keepTitle, sub: items(spec.keepN), doc: spec.keepDoc });
  if (goneIds.length) N.push({ id: "gone", x: 712, y: Math.max(4, goneY), w: 186, h: 70, kind: "sink", icon: "×", title: L("Abandonnées", "Dropped"), sub: items(spec.goneN), drop: true });
  const byId = Object.fromEntries(N.map((x) => [x.id, x]));
  const nOf = Object.fromEntries(spec.branches.map((b) => [b.id, b.n]));
  const E: [string, string, number][] = [
    ...spec.sources.flatMap((s) => s.out.map((b) => [s.id, b, nOf[b]] as [string, string, number])),
    ...spec.branches.map((b) => [b.id, b.drop ? "gone" : "keep", b.n] as [string, string, number]),
  ];
  const max = Math.max(1, ...E.map((e) => e[2]));
  const vbH = Math.max(H, ...N.map((x) => x.y + x.h + 8));
  const edges = E.map(([a, b, k], i) => {
    const A = byId[a], B = byId[b];
    const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, dx = Math.max(30, (x2 - x1) / 2);
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    const w = k ? 1.6 + 9 * Math.sqrt(k / max) : 1;
    const drop = !!(B.drop || A.drop);
    const on = pick && (A.branch === pick || B.branch === pick);
    const dots = k ? Array.from({ length: Math.min(3, 1 + Math.floor(Math.log10(k + 1))) }, (_, j) => `<circle class="flow-dot" r="${Math.min(4, 1.6 + w / 4).toFixed(1)}"><animateMotion dur="${(2.6 + (i % 3) * 0.4).toFixed(1)}s" begin="${(j * 0.9).toFixed(1)}s" repeatCount="indefinite" path="${d}"/></circle>`).join("") : "";
    // labels on edges into a sink sit early, away from where those edges converge
    const t = B.kind === "sink" ? 0.28 : 0.5, u = 1 - t;
    const mx = u * u * u * x1 + 3 * u * u * t * (x1 + dx) + 3 * u * t * t * (x2 - dx) + t * t * t * x2;
    const my = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
    return `<g class="flow-edge${drop ? " is-drop" : ""}${on ? " is-on" : ""}${k ? "" : " is-empty"}" style="--i:${i}">
      <path d="${d}" pathLength="1" style="stroke-width:${w.toFixed(1)}"/>${dots}
      ${compact ? "" : `<g class="flow-elabel" transform="translate(${mx.toFixed(0)},${my.toFixed(0)})"><rect x="-21" y="-9" width="42" height="18" rx="9"/><text y="4">${fmtNum(k)}</text></g>`}</g>`;
  }).join("");
  const nodes = N.map((x, i) => {
    const btn = x.branch && !compact ? ` role="button" tabindex="0" data-branch="${x.branch}" aria-pressed="${pick === x.branch}" aria-label="${esc(`${x.title}, ${x.sub}`)}"` : "";
    const ports = compact ? "" : `${x.kind !== "source" ? `<circle class="flow-port" cx="0" cy="${x.h / 2}" r="4.5"/>` : ""}${x.kind !== "sink" ? `<circle class="flow-port" cx="${x.w}" cy="${x.h / 2}" r="4.5"/>` : ""}`;
    // a version box opens its source document (the manifesto PDF, else the website) in a new tab
    const doc = x.doc && !compact ? x.doc : null;
    const tag = doc ? docLabel(doc) : "";
    const node = `<g class="flow-node is-${x.kind}${x.drop ? " is-drop" : ""}${pick && x.branch === pick ? " is-on" : ""}${doc ? " is-link" : ""}" transform="translate(${x.x},${x.y.toFixed(0)})" style="--i:${i}"${btn}>
      <rect class="flow-box" width="${x.w}" height="${x.h}" rx="10"/>
      <rect class="flow-tile" x="10" y="${(x.h - 34) / 2}" width="34" height="34" rx="7"/><text class="flow-icon" x="27" y="${x.h / 2 + 6}">${esc(x.icon)}</text>
      <text class="flow-title" x="54" y="${x.h / 2 - 3}">${esc(clip(x.title, x.kind === "branch" ? 24 : 19))}</text><title>${esc(doc ? `${x.title} — ${L("ouvrir le document", "open the document")} (${tag})` : `${x.title} — ${x.sub}`)}</title>
      <text class="flow-sub" x="54" y="${x.h / 2 + 14}">${esc(x.sub)}</text>
      ${doc ? `<text class="flow-doc" x="${x.w - 10}" y="15" text-anchor="end">${esc(tag)} ↗</text>` : ""}
      ${ports}</g>`;
    return doc ? `<a class="flow-link" href="${esc(safeUrl(doc.url))}" target="_blank" rel="noopener" aria-label="${esc(`${x.title} : ${L("ouvrir le document", "open the document")} (${tag}, ${L("nouvel onglet", "new tab")})`)}">${node}</a>` : node;
  }).join("");
  return `<svg class="flow-svg${compact ? " is-compact" : ""}" viewBox="0 0 910 ${vbH.toFixed(0)}" role="group" aria-label="${esc(spec.label)}">${edges}${nodes}</svg>`;
}
