// The note of the day, at the top of the homepage: a dated front page readers can step through (◀ ▶, or the arrow
// keys), built each day by scripts/build-editions.mjs. Under the day's headline, a ledger of labelled lines: the
// world's main story, France's, the surprise, the candidates in the news, and Third Estate's read (who had the
// momentum), beside one table of the polls and the odds of winning. It is about the day (changes since yesterday);
// on a Sunday it reviews the week, with a longer recap. The last line is the city of the day, with its coat of
// arms. "What could have moved them", candidate by candidate, stays folded underneath.
import { fetchJson } from "../data";
import { L, fmtDate } from "../i18n";
import { meta } from "../lib/candidates";
import { armsSlot, paintArms } from "../lib/arms";
import { foxSvg } from "../lib/fox";
import { dec, pct } from "../lib/format";
import { gradeColor, pollsterName, pollsterRating } from "../lib/polls";
import { esc, safeUrl } from "../util";

type T = { fr: string; en: string };
interface Row { name: string; market: number | null; d1: number | null; d7: number | null; polls: number | null; polls1?: number | null; polls7: number | null }
interface Headline { title: string; link: string | null; outlet: string; n?: number }
type Factor =
  | { kind: "polls"; same: boolean; d: number }
  | { kind: "poll"; pollster: string; url: string | null; v: number; avg: number; same: boolean }
  | { kind: "news"; headlines: Headline[] }
  | { kind: "split"; kalshi: number; poly: number }
  | { kind: "none" };
interface Pick { name: string; fr: string; en: string; story: Headline | null }
interface Insight { head: T; surprise: Pick | null; good: Pick[]; bad: Pick[]; by: string }
interface Mv { name: string; market: number | null; polls: number | null }
interface Ext { name: string; now: number | null; d: number }
interface Borrow { span: "day" | "week"; asOf: string; spread: number; dSpread: number; oat10: number | null; bund10: number | null; dOat: number | null; basis: "oat" | "spread"; base: number | null; cost: number | null; why: Headline | null }
interface BriefLine { lead: T; fr: string; en: string; story?: Headline | null }
type Line = { name: string; fr: string; en: string; story: Headline | null };
interface Kpi { id: string; period: string; value: number; prev: number | null; yearAgo: number | null; updated: string | null; url: string | null; fresh?: boolean }
interface Ledger {
  span: "day" | "week";
  kpis?: { items: Kpi[] } | null;
  take?: { fr: string; en: string; story: Headline | null } | null; surprises?: Line[]; declarations?: Line[];
  post?: { handle: string; name: string | null; text: string; url: string; outlets: string[] } | null;
  trend?: { date: string; v: Record<string, number | null> }[] | null;
  notes?: { polls: T[]; kpis: T | null; cac: T | null } | null;
  cac?: { asOf: string; level: number; d7: number; movers: { name: string; d7: number }[] } | null;
  borrow?: Borrow | null; brief?: BriefLine[] | null;
  world: Headline | null; france: Headline | null; candidates: (Headline & { name: string })[];
  lead: { span: "day" | "week"; up: Mv[]; down: Mv[] };
  recap: { polls: { up: Ext | null; down: Ext | null }; markets: { up: Ext | null; down: Ext | null }; newPolls: { pollster: string; end: string; url: string | null }[]; stories: Headline[] } | null;
  table: Row[];
  city: { code: string; name: string; depName: string; arms: string; title: string; link: string; outlet: string } | null;
}
interface Edition {
  date: string; head: T; rows: Row[]; provisional?: boolean; insight?: Insight; ledger?: Ledger;
  analysis: { name: string; market: number | null; d1: number | null; d7: number | null; factors: Factor[] }[];
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sur = (n: string) => esc(meta(n).surname);
const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${dec(Math.abs(v))}`;
const chip = (d: number | null, span: string) => d == null ? "" : `<span class="ed-chip ${Math.abs(d) < 0.05 ? "" : d > 0 ? "is-up" : "is-down"}"><small>${span}</small>${Math.abs(d) < 0.05 ? "=" : `${d > 0 ? "▲" : "▼"} ${sgn(d)}`}</span>`;
/** A headline without the "Présidentielle 2027 :" prefix every election story carries. */
const short = (t: string) => t.replace(/^(EN DIRECT\s*[-–]\s*)?(Présidentielle|Élection présidentielle)\s*2027\s*:\s*/i, "");
const story = (h: Headline) => `${h.link ? `<a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(short(h.title))}</a>` : esc(short(h.title))} <span class="ed-src">${esc(h.outlet)}${(h.n ?? 1) > 1 ? ` · ${h.n} ${L("médias", "outlets")}` : ""}</span>`;

function factorHtml(f: Factor, name: string) {
  switch (f.kind) {
    case "polls": return f.same
      ? L(`<b>Les sondages vont dans le même sens</b> : ${sgn(f.d)} point en 7 jours.`, `<b>The polls point the same way</b>: ${sgn(f.d)} in 7 days.`)
      : L(`<b>Pas les sondages</b> : ils l’ont fait bouger de ${sgn(f.d)} en 7 jours, dans l’autre sens.`, `<b>Not the polls</b>: they moved ${sgn(f.d)} in 7 days, the other way.`);
    case "poll": {
      const g = pollsterRating(f.pollster)?.grade;
      const who = `${f.url ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(pollsterName(f.pollster))}</a>` : esc(pollsterName(f.pollster))}${g ? ` <b style="color:${esc(gradeColor(g))}">${esc(g)}</b>` : ""}`;
      return L(`<b>Un sondage du jour</b> : ${who} ${f.same ? "le confirme" : "va dans l’autre sens"}, ${sur(name)} à ${pct(f.v)}, ${sgn(f.v - f.avg)} par rapport à sa moyenne.`, `<b>A poll that day</b>: ${who} ${f.same ? "backs it" : "points the other way"}, ${sur(name)} on ${pct(f.v)}, ${sgn(f.v - f.avg)} from their average.`);
    }
    case "news": return `<b>${L("Dans l’actualité", "In the news")}</b>${L(" :", ":")}<ul>${f.headlines.map((h) => `<li>${story(h)}</li>`).join("")}</ul>`;
    case "split": return L(`<b>Un seul marché a bougé</b> : Kalshi ${sgn(f.kalshi)}, Polymarket ${sgn(f.poly)}. Peut-être un seul gros pari.`, `<b>Only one market moved</b>: Kalshi ${sgn(f.kalshi)}, Polymarket ${sgn(f.poly)}. Possibly a single large bet.`);
    default: return L("<b>Rien dans les sondages ni dans l’actualité ne l’explique.</b> Ces marchés sont peu profonds : un seul gros pari peut les faire bouger.", "<b>Nothing in the polls or the news explains it.</b> These markets are thin: a single large bet can move them.");
  }
}

/** A short line on what most likely played a part, from the factors (never stated as a cause). */
function verdict(fs: Factor[]) {
  const same = fs.some((f) => (f.kind === "polls" || f.kind === "poll") && f.same), news = fs.some((f) => f.kind === "news");
  if (same && news) return L("Les sondages et l’actualité vont dans le même sens.", "Polls and news point the same way.");
  if (same) return L("En ligne avec les sondages.", "In line with the polls.");
  if (news) return L("Les sondages n’expliquent pas ce mouvement ; l’actualité a pu jouer.", "The polls don’t explain it; the news may have played a part.");
  if (fs.some((f) => f.kind === "split")) return L("Un mouvement d’un seul marché.", "A move on one market only.");
  return L("Pas d’explication dans nos données.", "No explanation in our records.");
}

/** One labelled line of the ledger. */
const row = (k: string, body: string, cls = "") => (body ? `<div class="lg-row${cls ? ` ${cls}` : ""}"><span class="lg-k">${k}</span><div class="lg-b">${body}</div></div>` : "");
const moved = (v: number | null): v is number => v != null && Math.abs(v) >= 0.05;
/** Percentage points, written "%pt". */
const ppt = () => L("\u00a0%pt", "%pt");
/** A signed figure in bold: green when the move is good, red when it is bad (`goodUp` false for a rate, a gap, a fear). */
const delta = (v: number, unit = "", goodUp = true, digits = 1) => `<b class="${Math.abs(v) < 10 ** -digits / 2 ? "" : (v > 0) === goodUp ? "num-up" : "num-down"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${dec(Math.abs(v), digits)}${unit}</b>`;

/** Third Estate's read: who had the momentum (candidate and party), on the day or over the week, with the figures. */
function leadHtml(g: Ledger) {
  const one = (m: Mv) => {
    const party = meta(m.name).party;
    const bits = [moved(m.market) ? `${delta(m.market, ppt())} ${L("sur les marchés", "on the markets")}` : "", moved(m.polls) ? `${delta(m.polls, ppt())} ${L("dans les sondages", "in the polls")}` : ""].filter(Boolean).join(", ");
    return `<b class="lg-who" style="--c:${meta(m.name).color}"><i aria-hidden="true"></i>${sur(m.name)}</b>${party ? ` (${esc(party)})` : ""}, ${bits}`;
  };
  const { up, down, span } = g.lead;
  if (!up.length && !down.length) return L("Rien n’a bougé, ni en un jour ni sur la semaine.", "Nothing moved, in a day or over the week.");
  const when = span === "day" ? L("Dynamique du jour", "Momentum today") : g.span === "week" ? L("Dynamique de la semaine", "Momentum this week") : L("Journée calme. Sur la semaine, la dynamique", "A still day. Over the week, momentum");
  return [
    up.length ? `${when}${L(" : ", ": ")}${up.map(one).join(" ; ")}.` : `${span === "day" ? L("Personne ne progresse aujourd’hui", "Nobody gained today") : L("Personne ne progresse sur la semaine", "Nobody gained over the week")}.`,
    down.length ? `${L("En recul", "Losing ground")}${L(" : ", ": ")}${down.map(one).join(" ; ")}.` : "",
  ].filter(Boolean).join(" ");
}

/** The borrowing line: the OAT rate and the gap with Germany, how they moved, what the move is worth in interest on a
 *  year of new debt (a notional figure), and the headline that may have played a part (a lead, not a cause). */
function borrowHtml(b: Borrow, short = false) {
  const when = b.span === "week" ? L("en une semaine", "in a week") : L("en une séance", "in one session");
  const flatOat = b.dOat == null || Math.abs(b.dOat) < 0.005, flatGap = !moved(b.dSpread);
  const level = [
    b.oat10 != null ? `${L("OAT à 10 ans à", "10-year OAT at")} <b>${pct(b.oat10, 2)}</b>${flatOat ? "" : ` (${delta(b.dOat!, ppt(), false, 2)} ${when})`}` : "",
    `${L("écart avec l’Allemagne à", "gap with Germany at")} <b>${dec(b.spread / 100, 2)}${ppt()}</b> (${flatGap ? L("stable", "unchanged") : `${delta(b.dSpread / 100, ppt(), false, 3)} ${when}`})`,
  ].filter(Boolean).join(L(" ; ", "; "));
  const still = b.basis === "oat" ? flatOat : flatGap;
  const m = b.cost == null ? 0 : Math.abs(b.cost) / 1e6;
  const sum = L(`${dec(m, m < 10 ? 1 : 0)} M€`, `€${dec(m, m < 10 ? 1 : 0)}m`), base = b.base ? L(`${dec(b.base / 1e9, 0)} Md€`, `€${dec(b.base / 1e9, 0)}bn`) : "";
  const more = (b.cost ?? 0) > 0;
  const cost = still || !b.cost || !b.base || m < 0.1 ? "" : b.basis === "oat"
    ? L(`Coût théorique : à ce taux, la dette ajoutée en un an (${base}) coûterait <b class="${more ? "num-down" : "num-up"}">${sum} d’intérêts de ${more ? "plus" : "moins"} par an</b>.`, `Notional cost: at this rate, a year of new debt (${base}) would cost <b class="${more ? "num-down" : "num-up"}">${sum} ${more ? "more" : "less"} in interest each year</b>.`)
    : L(`Coût théorique : sur la dette ajoutée en un an (${base}), ce mouvement de l’écart pèse <b class="${more ? "num-down" : "num-up"}">${sum} d’intérêts de ${more ? "plus" : "moins"} par an</b> par rapport à l’Allemagne.`, `Notional cost: on a year of new debt (${base}), this move in the gap is worth <b class="${more ? "num-down" : "num-up"}">${sum} ${more ? "more" : "less"} in interest each year</b>, relative to Germany.`);
  const why = still ? "" : b.why ? `${L("Dans l’actualité", "In the news")}${L(" : ", ": ")}${story(b.why)}` : L("Aucun titre de nos flux ne l’explique.", "No headline in our feeds explains it.");
  return `${short ? "" : `${level.charAt(0).toUpperCase()}${level.slice(1)}. `}${cost} ${why} <a class="lg-more" href="#/chiffres#taux">${L("Le détail", "The detail")} →</a>`;
}

/** Figures in a line of ours ("2,6 %", "3 %pt"), in bold. */
const figures = (html: string) => html.replace(/\d+(?:[.,]\d+)?[ \u00a0]?%(?:pt)?/g, (m) => `<b>${m}</b>`);
/** Sunday's brief: three to five lines that take a stand, each a bold lead, a sentence, and its source (the outlet alone). */
const briefHtml = (lines: BriefLine[]) => `<ol class="lg-brief">${lines.slice(0, 5).map((l) => `<li><b>${esc(L(l.lead.fr, l.lead.en))}</b> ${figures(esc(L(l.fr, l.en)))}${l.story ? ` ${src(l.story)}` : ""}</li>`).join("")}</ol>`;

/** Sunday's longer recap: the week's largest rise and fall in the polls and in the odds, the polls published, the most-covered stories. */
function recapHtml(r: NonNullable<Ledger["recap"]>) {
  const ext = (x: Ext | null, up: boolean) => (x ? `<b>${sur(x.name)}</b> ${up ? L("gagne le plus", "gains the most") : L("perd le plus", "loses the most")}, ${delta(x.d, ppt())} ${L("à", "to")} <b>${pct(x.now)}</b>` : "");
  const pair = (p: { up: Ext | null; down: Ext | null }) => [ext(p.up, true), ext(p.down, false)].filter(Boolean).join(" ; ");
  const who = [...new Map(r.newPolls.map((p) => [p.pollster, p])).values()].map((p) => (p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(pollsterName(p.pollster))}</a>` : esc(pollsterName(p.pollster)))).join(", ");
  return `<ul class="lg-recap">
    ${pair(r.polls) ? `<li><span>${L("Sondages", "Polls")}</span>${pair(r.polls)}.</li>` : ""}
    ${pair(r.markets) ? `<li><span>${L("Chances de victoire", "Odds of winning")}</span>${pair(r.markets)}.</li>` : ""}
    <li><span>${L("Publiés", "Published")}</span>${r.newPolls.length ? `${r.newPolls.length} ${L(r.newPolls.length > 1 ? "sondages" : "sondage", r.newPolls.length > 1 ? "polls" : "poll")}${L(" : ", ": ")}${who}.` : L("Aucun sondage cette semaine.", "No poll this week.")}</li>
    ${r.stories.length ? `<li><span>${L("Les plus repris", "Most covered")}</span><ol>${r.stories.map((s) => `<li>${story(s)}</li>`).join("")}</ol></li>` : ""}
  </ul>`;
}

/** The polls and the odds of winning in one table, each figure with its change over the day (or the week on a Sunday). */
function tableHtml(g: Ledger) {
  const wk = g.span === "week", span = wk ? L("7 j", "7 days") : L("24 h", "24h");
  const d = (v: number | null | undefined) => v == null ? `<small class="flat"></small>` : `<small class="${moved(v) ? (v > 0 ? "up" : "down") : "flat"}">${moved(v) ? `${v > 0 ? "▲" : "▼"} ${dec(Math.abs(v))}` : "="}</small>`;
  return `<table class="lg-table">
    <caption><span>${L("Sondages et marchés de prédiction", "Polls and prediction markets")}</span><a class="ed-wk-go" href="#trend">${L("Tous les sondages", "Every poll")} ↓</a></caption>
    <thead><tr><th scope="col">${L("Candidat", "Candidate")}</th><th scope="col">${L("Sondages", "Polls")}, ${span}</th><th scope="col">${L("Chance de victoire", "Chance to win")}, ${span}</th></tr></thead>
    <tbody>${g.table.map((r) => `<tr><th scope="row"><i style="background:${esc(meta(r.name).color)}" aria-hidden="true"></i>${sur(r.name)}</th><td>${r.polls == null ? "–" : pct(r.polls)}${d(wk ? r.polls7 : r.polls1)}</td><td>${r.market == null ? "–" : pct(r.market)}${d(wk ? r.d7 : r.d1)}</td></tr>`).join("")}</tbody>
  </table>
  <p class="lg-cap">${L("Moyenne des sondages (intentions de vote) ; Kalshi et Polymarket, en moyenne.", "Poll average (voting intention); Kalshi and Polymarket, averaged.")}</p>`;
}

// ---------- the week's key numbers (Sundays) ----------
// Only what matters that week: the rates France borrows at, and the figures INSEE or Eurostat published in the
// last seven days. The full set, with its history, is on the "France in numbers" page (views/economy.ts).
const KPIS: Record<string, { fr: string; en: string; unit: "pct" | "index" | "count"; goodUp: boolean }> = {
  growth_q: { fr: "Croissance du PIB, sur le trimestre", en: "GDP growth, on the quarter", unit: "pct", goodUp: true },
  inflation: { fr: "Inflation, sur un an", en: "Inflation, year on year", unit: "pct", goodUp: false },
  unemployment: { fr: "Chômage", en: "Unemployment", unit: "pct", goodUp: false },
  confidence: { fr: "Confiance des ménages (moyenne : 100)", en: "Household confidence (average: 100)", unit: "index", goodUp: true },
  climate: { fr: "Climat des affaires (moyenne : 100)", en: "Business climate (average: 100)", unit: "index", goodUp: true },
  jobsClimate: { fr: "Climat de l’emploi (moyenne : 100)", en: "Employment climate (average: 100)", unit: "index", goodUp: true },
  cars: { fr: "Voitures neuves immatriculées, par mois", en: "New cars registered, a month", unit: "count", goodUp: true },
};
/** "2026-10" → "oct. 2026", "2026-Q3" → "T3 2026". */
function per(p: string) {
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${L("T", "Q")}${q[2]} ${q[1]}`;
  return /^\d{4}-\d{2}$/.test(p) ? new Date(`${p}-15`).toLocaleDateString(L("fr-FR", "en-GB"), { month: "short", year: "numeric" }) : p;
}
const whole = (v: number) => Math.round(v).toLocaleString(L("fr-FR", "en-GB"));

/** A comment of ours above a table: short, signed by the fox, its figures in bold. */
const noteHtml = (t: T | null | undefined) => (t?.fr ? `<p class="lg-note">${foxSvg(18, true)}<span>${figures(esc(L(t.fr, t.en)))}</span></p>` : "");

function kpisHtml(g: Ledger) {
  const b = g.borrow, c = g.cac, fresh = (g.kpis?.items ?? []).filter((x) => x.fresh && KPIS[x.id]);
  if (!b && !c && !fresh.length) return "";
  const line = (label: string, sub: string, value: string, change: string) => `<tr><th scope="row">${label}<small>${sub}</small></th><td>${value}</td><td>${change}</td></tr>`;
  const close = b ? `${L("clôture du", "close of")} ${esc(fmtDate(b.asOf).replace(/\s\d{4}$/, ""))}, ${L("sur 7 jours", "over 7 days")}` : "";
  const rates = b ? [
    b.oat10 != null ? line(`<a href="#/chiffres#taux">${L("Taux de l’OAT à 10 ans", "10-year OAT rate")}</a>`, close, pct(b.oat10, 2), b.dOat == null ? "–" : delta(b.dOat, ppt(), false, 2)) : "",
    line(`<a href="#/chiffres#taux">${L("Écart avec l’Allemagne", "Gap with Germany")}</a>`, close, `${dec(b.spread / 100, 2)}${ppt()}`, delta(b.dSpread / 100, ppt(), false, 3)),
  ].join("") : "";
  const rows = fresh.map((x) => {
    const d = KPIS[x.id], label = `<a href="#/chiffres#conjoncture">${L(d.fr, d.en)}</a>`, sub = `${per(x.period)} · ${L("publié cette semaine", "out this week")}`;
    if (d.unit === "count") return line(label, sub, whole(x.value), x.yearAgo ? `${delta((x.value / x.yearAgo - 1) * 100, L(" %", "%"), d.goodUp)} <small>${L("sur un an", "on the year")}</small>` : "–");
    return line(label, sub, d.unit === "pct" ? pct(x.value) : dec(x.value, x.value % 1 ? 1 : 0), x.prev == null ? "–" : delta(x.value - x.prev, d.unit === "pct" ? ppt() : "", d.goodUp));
  }).join("");
  const wk7 = c ? `${L("clôture du", "close of")} ${esc(fmtDate(c.asOf).replace(/\s\d{4}$/, ""))}, ${L("sur 7 jours", "over 7 days")}` : "";
  const pc = (v: number) => delta(v, L("\u00a0%", "%"), true);
  const market = c ? [line("CAC 40", wk7, whole(c.level), pc(c.d7)), ...c.movers.map((m) => line(esc(m.name), L("la plus forte variation du CAC 40, sur 7 jours", "among the CAC 40’s biggest moves, over 7 days"), "", pc(m.d7)))].join("") : "";
  // the column opens with our reads, as the polls column does: the CAC 40's first, then the week's figures'
  return `${noteHtml(g.notes?.cac)}${noteHtml(g.notes?.kpis)}<table class="lg-table lg-kpi">
    <caption><span>${L("Les chiffres de la semaine", "The week’s numbers")}</span><a href="#/chiffres#conjoncture">${L("Tous les chiffres", "Every figure")} →</a></caption>
    <thead><tr><th scope="col">${L("Indicateur", "Indicator")}</th><th scope="col">${L("Niveau", "Level")}</th><th scope="col">${L("Variation", "Change")}</th></tr></thead>
    <tbody>${rates}${rows}${market}</tbody>
  </table>
  ${b ? `<p class="lg-cost">${borrowHtml(b, true)}</p>` : ""}
  <p class="lg-cap">${L("Vert : mieux, rouge : moins bien. Sources : Insee, Eurostat, Teleborsa via Borsa Italiana, Yahoo Finance.", "Green: better, red: worse. Sources: INSEE, Eurostat, Teleborsa via Borsa Italiana, Yahoo Finance.")}</p>`;
}

/** The polling averages over the last weeks, one line per candidate: the simple version of the big chart below. */
function trendHtml(g: Ledger) {
  const t = g.trend ?? [], names = g.table.filter((r) => r.polls != null).slice(0, 5).map((r) => r.name);
  const vals = t.flatMap((d) => names.map((n) => d.v[n])).filter((v): v is number => v != null);
  if (t.length < 3 || !vals.length) return "";
  const W = 520, H = 170, P = { l: 6, r: 118, t: 8, b: 18 };
  const max = Math.ceil(Math.max(...vals) / 5) * 5, x = (i: number) => P.l + (i * (W - P.l - P.r)) / (t.length - 1), y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const ends: { n: string; y: number; v: number }[] = [];
  const paths = names.map((n) => {
    const pts = t.map((d, i) => (d.v[n] == null ? null : `${x(i).toFixed(1)},${y(d.v[n]!).toFixed(1)}`)).filter(Boolean);
    const last = t.at(-1)!.v[n];
    if (last != null) ends.push({ n, y: y(last), v: last });
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${esc(meta(n).color)}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }).join("");
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const day = (iso: string) => new Date(iso).toLocaleDateString(L("fr-FR", "en-GB"), { day: "numeric", month: "short" });
  return `<figure class="lg-trend"><figcaption>${L(`La tendance des sondages, ${t.length} jours`, `The polling trend, ${t.length} days`)}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L("Moyenne des sondages des cinq premiers candidats", "Poll average of the five leading candidates"))}">
      ${[0, max / 2, max].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="lg-trend-grid"/>`).join("")}
      ${paths}
      ${ends.map((e2) => `<text x="${W - P.r + 6}" y="${(e2.y + 4).toFixed(1)}" fill="${esc(meta(e2.n).color)}" class="lg-trend-end">${sur(e2.n)} ${pct(e2.v)}</text>`).join("")}
      <text x="${P.l}" y="${H - 3}" class="lg-trend-ax">${esc(day(t[0].date))}</text>
      <text x="${W - P.r}" y="${H - 3}" text-anchor="end" class="lg-trend-ax">${esc(day(t.at(-1)!.date))}</text>
    </svg></figure>`;
}

/** The source of one of our own lines: the outlet alone, linked, never the article's title (it would compete with the line). */
const src = (h: Headline) => (h.link ? `<a class="ed-src" href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.outlet)}</a>` : `<span class="ed-src">${esc(h.outlet)}</span>`);
/** Our lines as a list; a line with no text of its own (no AI that day) shows its headline instead. */
const linesHtml = (xs: Line[]) => `<ul class="lg-list">${xs.map((l) => `<li>${l.fr ? `${figures(esc(L(l.fr, l.en)))}${l.story ? ` ${src(l.story)}` : ""}` : l.story ? story(l.story) : ""}</li>`).join("")}</ul>`;
/** The X post the press quoted most, with who wrote it and which outlets carried it. */
const postHtml = (p: NonNullable<Ledger["post"]>) => `<blockquote class="lg-post">${esc(p.text)}</blockquote>
  <span class="ed-src"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">@${esc(p.handle)}</a>${p.name ? ` (${esc(p.name)})` : ""} · X · ${L("repris par", "quoted by")} ${esc(p.outlets.join(", "))}</span>`;

/** The note's body. A day: our take, then the facts on the left and the table on the right. A week: the brief across
 *  the box, a rule, the polls (table and trend) beside the week's key numbers, then the recap and the facts across the box. */
function bodyHtml(g: Ledger, s: Pick | null | undefined) {
  const wk = g.span === "week";
  const surprises: Line[] = g.surprises ?? (s ? [s] : []);
  // a longer take may come in paragraphs (blank lines); the source sits at the end of the last one
  const paras = (t: string) => t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const takeText = g.take ? paras(L(g.take.fr, g.take.en)) : [];
  const take = g.brief?.length ? briefHtml(g.brief) : takeText.length ? takeText.map((p, i) => `<p>${figures(esc(p))}${i === takeText.length - 1 && g.take!.story ? ` ${src(g.take!.story)}` : ""}</p>`).join("") : "";
  // our own voice is signed: the fox sits under the label
  const takeRow = take ? row(`${L("Notre analyse", "Our analysis")}<span class="lg-logo">${foxSvg(30, true, 'role="img" aria-label="Third Estate"')}</span>`, take, "is-te") : "";
  const facts = `${g.world ? row(L("Monde", "World"), story(g.world)) : ""}${g.france ? row("France", story(g.france)) : ""}
    ${surprises.length ? row(surprises.length > 1 ? L("Les surprises", "Surprises") : L("La surprise", "Surprise"), linesHtml(surprises)) : ""}
    ${g.declarations?.length ? row(L("Déclarations", "Statements"), linesHtml(g.declarations)) : ""}
    ${g.post ? row(wk ? L("Le post de la semaine", "Post of the week") : L("Le post du jour", "Post of the day"), postHtml(g.post)) : ""}
    ${row(L("Dynamique", "Momentum"), leadHtml(g))}`;
  const why = (g.notes?.polls ?? []).slice(0, 2).map(noteHtml).join("");
  // a day: our analysis across the whole note, then the facts on the left and the table on the right
  if (!wk) return `${takeRow ? `<div class="lg lg-take">${takeRow}</div>` : ""}<div class="ed-lg"><div class="lg">${facts}</div><div class="lg-side">${why}${tableHtml(g)}</div></div>`;
  return `<div class="ed-lg is-week">
    ${takeRow ? `<div class="lg">${takeRow}</div>` : ""}
    <div class="lg-mid"><div class="lg-side">${why}${tableHtml(g)}${trendHtml(g)}</div><div class="lg-side">${kpisHtml(g)}</div></div>
    <div class="lg">${g.recap ? row(L("La semaine", "The week"), recapHtml(g.recap), "is-week") : ""}${facts}</div>
  </div>`;
}

function render(e: Edition, idx: { date: string }[]) {
  const i = idx.findIndex((x) => x.date === e.date);
  const prev = idx[i - 1], next = idx[i + 1];
  const day = new Date(e.date).toLocaleDateString(L("fr-FR", "en-GB"), { weekday: "long", day: "numeric", month: "long" });
  const g = e.ledger, s = e.insight?.surprise;
  const city = g?.city;
  return `<div class="ed-nav">
      ${prev ? `<button type="button" class="ed-go" data-d="${esc(prev.date)}" aria-label="${esc(L(`Édition du ${fmtDate(prev.date)}`, `Edition of ${fmtDate(prev.date)}`))}">◀ ${esc(fmtDate(prev.date).replace(/\s\d{4}$/, ""))}</button>` : `<span></span>`}
      <p class="ed-k"><b>${g?.span === "week" ? L("La note de la semaine", "Note of the week") : L("La note du jour", "Note of the day")}</b><span>${esc(day)}</span></p>
      ${next ? `<button type="button" class="ed-go" data-d="${esc(next.date)}" aria-label="${esc(L(`Édition du ${fmtDate(next.date)}`, `Edition of ${fmtDate(next.date)}`))}">${esc(fmtDate(next.date).replace(/\s\d{4}$/, ""))} ▶</button>` : `<span></span>`}
    </div>
    <h2 class="ed-head">${esc(L((e.insight?.head ?? e.head).fr, (e.insight?.head ?? e.head).en))}</h2>
    ${e.provisional ? `<p class="ed-prov">${L("Édition du jour en cours : cours des marchés de la dernière heure ; les sondages et l’analyse complète arrivent avec la synthèse quotidienne.", "Today's edition in progress: the latest hourly market prices; the polls and the full analysis come with the daily brief.")}</p>` : ""}
    ${g ? bodyHtml(g, s) : ""}
    <details class="ed-why"><summary>${L("Le détail : ce qui a pu les faire bouger", "In detail: what could have moved them")}</summary>
      ${e.analysis.length ? `<ol>${e.analysis.map((a) => `<li style="--c:${meta(a.name).color}">
        <p class="ed-who"><b>${sur(a.name)}</b> ${chip(a.d1, L("24 h", "24h"))}${chip(a.d7, L("7 j", "7d"))} <span class="ed-verdict-line">${verdict(a.factors)}</span></p>
        <ul class="ed-factors">${a.factors.map((f) => `<li>${factorHtml(f, a.name)}</li>`).join("")}</ul>
      </li>`).join("")}</ol>` : `<p>${L("Aucun candidat n’a bougé d’un point en un jour, ni de 2,5 points en une semaine.", "No candidate moved a point in a day or 2.5 points in a week.")}</p>`}
      <p class="ed-note">${L("Des pistes, pas des causes : les titres sont ceux qui citent le candidat ce jour-là et la veille.", "Leads, not causes: the headlines are those naming the candidate that day and the day before.")}</p>
    </details>
    ${city ? `<div class="ed-city">${armsSlot(city.arms, city.name, "s", `#/ville/${city.code}`)}<p><span class="lg-k">${L("La ville du jour", "City of the day")}</span><a class="ed-city-name" href="#/ville/${esc(city.code)}">${esc(city.name)}</a> <span class="ed-src">${esc(city.depName)}</span><br>${story(city)}</p></div>` : ""}
    <p class="ed-by">${L("La lecture de Third Estate, à partir des sondages, des marchés et des titres du jour. Elle juge la position dans la course, jamais les idées.", "Third Estate's read, from the day's polls, markets and headlines. It judges standing in the race, never ideas.")}</p>`;
}

function animate(root: HTMLElement) {
  if (reduced()) return;
  root.classList.remove("is-in");
  void root.offsetWidth;
  root.classList.add("is-in");
}

/** Mounts the edition into `box` (latest first); returns nothing, draws asynchronously. */
export async function mountEdition(box: HTMLElement) {
  const idx = await fetchJson<{ date: string; head: T }[]>("/data/daily/editions/index.json").catch(() => null);
  if (!idx?.length) { box.remove(); return; }
  const cache = new Map<string, Promise<Edition | null>>();
  const get = (d: string) => { if (!cache.has(d)) cache.set(d, fetchJson<Edition>(`/data/daily/editions/${d}.json`).catch(() => null)); return cache.get(d)!; };
  const show = async (d: string) => {
    const e = await get(d);
    if (!e) return;
    box.innerHTML = render(e, idx);
    paintArms(box);
    box.querySelectorAll<HTMLButtonElement>(".ed-go").forEach((b) => b.addEventListener("click", () => void show(b.dataset.d!)));
    // "every poll" leads to the polls chart below (an in-page scroll, not a route change)
    box.querySelector(".ed-wk-go")?.addEventListener("click", (ev) => { ev.preventDefault(); document.getElementById("trend")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); });
    animate(box);
  };
  box.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const b = box.querySelector<HTMLButtonElement>(`.ed-go:${ev.key === "ArrowLeft" ? "first-child" : "last-child"}`);
    if (b) { ev.preventDefault(); b.click(); box.querySelector<HTMLButtonElement>(".ed-go")?.focus(); }
  });
  // the latest edition, or the one before if it can't be read
  for (let i = idx.length - 1; i >= Math.max(0, idx.length - 4); i--) {
    if (await get(idx[i].date)) { await show(idx[i].date); return; }
  }
  box.remove();
}
