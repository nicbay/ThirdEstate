// The day's edition, at the top of the homepage: a dated front page readers can step through (◀ ▶, or the arrow
// keys), built each day by scripts/build-editions.mjs. The week's headline; four moves of the day (the favourite
// on the markets, the day's biggest mover, the new poll, the most-covered story), with figures that count up;
// "what could have moved them", candidate by candidate (the polls, the day's polls, the headlines naming them, a
// gap between the two markets, or nothing in the record); and the week in review as a small drawn chart.
import { fetchJson } from "../data";
import { L, fmtDate } from "../i18n";
import { meta } from "../lib/candidates";
import { dec } from "../lib/format";
import { gradeColor, pollsterName, pollsterRating } from "../lib/polls";
import { esc, safeUrl } from "../util";

type T = { fr: string; en: string };
interface Row { name: string; market: number | null; d1: number | null; d7: number | null; polls: number | null; polls7: number | null }
interface Headline { title: string; link: string | null; outlet: string; n: number }
type Factor =
  | { kind: "polls"; same: boolean; d: number }
  | { kind: "poll"; pollster: string; url: string | null; v: number; avg: number; same: boolean }
  | { kind: "news"; headlines: Headline[] }
  | { kind: "split"; kalshi: number; poly: number }
  | { kind: "none" };
interface Edition {
  date: string; head: T; rows: Row[]; provisional?: boolean;
  polls: { pollster: string; end: string; url: string | null; top: { name: string; v: number }[] }[];
  headlines: Headline[];
  analysis: { name: string; market: number | null; d1: number | null; d7: number | null; factors: Factor[] }[];
  week: { date: string; v: Record<string, number | null> }[];
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sur = (n: string) => esc(meta(n).surname);
const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${dec(Math.abs(v))}`;
const chip = (d: number | null, span: string) => d == null ? "" : `<span class="ed-chip ${Math.abs(d) < 0.05 ? "" : d > 0 ? "is-up" : "is-down"}"><small>${span}</small>${Math.abs(d) < 0.05 ? "=" : `${d > 0 ? "▲" : "▼"} ${sgn(d)}`}</span>`;
const count = (v: number, suffix = "", signed = false) => `<b class="ed-count" data-v="${v}" data-s="${esc(suffix)}"${signed ? ` data-signed="1"` : ""}>${signed ? sgn(v) : dec(v)}${suffix}</b>`;
const story = (h: Headline) => `${h.link ? `<a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a>` : esc(h.title)} <span class="ed-src">${esc(h.outlet)}${h.n > 1 ? ` · ${h.n} ${L("médias", "outlets")}` : ""}</span>`;

function factorHtml(f: Factor, name: string) {
  switch (f.kind) {
    case "polls": return f.same
      ? L(`<b>Les sondages vont dans le même sens</b> : ${sgn(f.d)} point en 7 jours.`, `<b>The polls point the same way</b>: ${sgn(f.d)} in 7 days.`)
      : L(`<b>Pas les sondages</b> : ils l’ont fait bouger de ${sgn(f.d)} en 7 jours, dans l’autre sens.`, `<b>Not the polls</b>: they moved ${sgn(f.d)} in 7 days, the other way.`);
    case "poll": {
      const g = pollsterRating(f.pollster)?.grade;
      const who = `${f.url ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(pollsterName(f.pollster))}</a>` : esc(pollsterName(f.pollster))}${g ? ` <b style="color:${gradeColor(g)}">${g}</b>` : ""}`;
      return L(`<b>Un sondage du jour</b> : ${who} ${f.same ? "le confirme" : "va dans l’autre sens"}, ${sur(name)} à ${dec(f.v)} %, ${sgn(f.v - f.avg)} par rapport à sa moyenne.`, `<b>A poll that day</b>: ${who} ${f.same ? "backs it" : "points the other way"}, ${sur(name)} on ${dec(f.v)}%, ${sgn(f.v - f.avg)} from their average.`);
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

function weekChart(e: Edition) {
  const names = Object.keys(e.week.at(-1)?.v ?? {}).slice(0, 4);
  const vals = e.week.flatMap((d) => names.map((n) => d.v[n])).filter((v): v is number => v != null);
  if (e.week.length < 2 || !vals.length) return "";
  const W = 320, H = 150, P = 8, R = 92;
  const max = Math.ceil(Math.max(...vals) / 10) * 10, x = (i: number) => P + (i * (W - P - R)) / (e.week.length - 1), y = (v: number) => P + (1 - v / max) * (H - 2 * P);
  const ends: { n: string; y: number; v: number }[] = [];
  const lines = names.map((n) => {
    const pts = e.week.map((d, i) => (d.v[n] == null ? null : `${x(i).toFixed(1)},${y(d.v[n]!).toFixed(1)}`)).filter(Boolean);
    const last = e.week.at(-1)!.v[n];
    if (last != null) ends.push({ n, y: y(last), v: last });
    return `<polyline pathLength="1" points="${pts.join(" ")}" fill="none" stroke="${meta(n).color}" stroke-width="2.4" stroke-linejoin="round"/>`;
  }).join("");
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  return `<svg class="ed-week" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L("Chances de victoire sur les marchés, 7 jours", "Chance of winning on the markets, 7 days"))}">
    ${[0, max / 2, max].map((v) => `<line x1="${P}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ed-grid"/>`).join("")}
    ${lines}${ends.map((e2) => `<text x="${W - R + 6}" y="${e2.y + 4}" fill="${meta(e2.n).color}">${sur(e2.n)} ${dec(e2.v)}</text>`).join("")}
  </svg>`;
}

function render(e: Edition, idx: { date: string }[]) {
  const i = idx.findIndex((x) => x.date === e.date);
  const prev = idx[i - 1], next = idx[i + 1];
  const fav = e.rows[0];
  const big = [...e.rows].filter((r) => r.d1 != null).sort((a, b) => Math.abs(b.d1!) - Math.abs(a.d1!))[0];
  const poll = e.polls[0], top = e.headlines[0];
  const day = new Date(e.date).toLocaleDateString(L("fr-FR", "en-GB"), { weekday: "long", day: "numeric", month: "long" });
  const cards = [
    fav?.market != null ? `<div class="ed-card" style="--c:${meta(fav.name).color}"><p class="ed-ck">${L("Favori des marchés de prédiction", "Prediction markets' favourite")}</p><p class="ed-big">${count(fav.market, " %")}</p><p>${sur(fav.name)}</p><p class="ed-chips">${chip(fav.d1, L("24 h", "24h"))}${chip(fav.d7, L("7 j", "7d"))}</p></div>` : "",
    big && big.name !== fav?.name ? `<div class="ed-card" style="--c:${meta(big.name).color}"><p class="ed-ck">${L("Le mouvement du jour", "The move of the day")}</p><p class="ed-big">${count(big.d1!, "", true)}<small> pt</small></p><p>${sur(big.name)}, ${dec(big.market ?? 0)} %</p><p class="ed-chips">${chip(big.d7, L("7 j", "7d"))}</p></div>` : "",
    poll ? `<div class="ed-card"><p class="ed-ck">${L("Nouveau sondage", "New poll")}</p><p class="ed-poll">${poll.url ? `<a href="${esc(safeUrl(poll.url))}" target="_blank" rel="noopener">${esc(pollsterName(poll.pollster))}</a>` : esc(pollsterName(poll.pollster))}${(() => { const g = pollsterRating(poll.pollster)?.grade; return g ? ` <b style="color:${gradeColor(g)}">${g}</b>` : ""; })()}</p><p class="ed-small">${poll.top.slice(0, 3).map((t) => `${sur(t.name)} ${dec(t.v)}`).join(" · ")}</p></div>` : "",
    top ? `<div class="ed-card ed-news"><p class="ed-ck">${L("L’info la plus reprise", "Most-covered story")}</p><p>${story(top)}</p></div>` : "",
  ].filter(Boolean).join("");
  return `<div class="ed-nav">
      ${prev ? `<button type="button" class="ed-go" data-d="${prev.date}" aria-label="${esc(L(`Édition du ${fmtDate(prev.date)}`, `Edition of ${fmtDate(prev.date)}`))}">◀ ${esc(fmtDate(prev.date).replace(/\s\d{4}$/, ""))}</button>` : `<span></span>`}
      <p class="ed-k"><b>${L("La note du jour", "Note of the day")}</b><span>${esc(day)}</span></p>
      ${next ? `<button type="button" class="ed-go" data-d="${next.date}" aria-label="${esc(L(`Édition du ${fmtDate(next.date)}`, `Edition of ${fmtDate(next.date)}`))}">${esc(fmtDate(next.date).replace(/\s\d{4}$/, ""))} ▶</button>` : `<span></span>`}
    </div>
    <h2 class="ed-head">${esc(L(e.head.fr, e.head.en))}</h2>
    ${e.provisional ? `<p class="ed-prov">${L("Édition du jour en cours : cours des marchés de la dernière heure ; les sondages et l’analyse complète arrivent avec la synthèse quotidienne.", "Today's edition in progress: the latest hourly market prices; the polls and the full analysis come with the daily brief.")}</p>` : ""}
    <p class="ed-what">${L("Chaque jour : ce qui a bougé sur les marchés de prédiction (les paris en argent réel sur Kalshi et Polymarket) et dans les sondages, et ce qui a pu le faire bouger.", "Every day: what moved on the prediction markets (real-money bets on Kalshi and Polymarket) and in the polls, and what could have moved it.")}</p>
    <div class="ed-cards">${cards}</div>
    <div class="ed-body">
      <section class="ed-why"><h3>${L("Ce qui a pu les faire bouger", "What could have moved them")}</h3>
        ${e.analysis.length ? `<ol>${e.analysis.map((a) => `<li style="--c:${meta(a.name).color}">
          <p class="ed-who"><b>${sur(a.name)}</b> ${chip(a.d1, L("24 h", "24h"))}${chip(a.d7, L("7 j", "7d"))} <span class="ed-verdict">${verdict(a.factors)}</span></p>
          <ul class="ed-factors">${a.factors.map((f) => `<li>${factorHtml(f, a.name)}</li>`).join("")}</ul>
        </li>`).join("")}</ol>` : `<p>${L("Aucun candidat n’a bougé d’un point en un jour, ni de 2,5 points en une semaine.", "No candidate moved a point in a day or 2.5 points in a week.")}</p>`}
        <p class="ed-note">${L("Des pistes, pas des causes : les titres sont ceux qui citent le candidat ce jour-là et la veille.", "Leads, not causes: the headlines are those naming the candidate that day and the day before.")}</p>
      </section>
      <section class="ed-wk"><h3>${L("Chance de victoire sur les marchés de prédiction, 7 jours", "Chance of winning on the prediction markets, 7 days")}</h3>
        <a class="ed-wk-go" href="#trend" aria-label="${esc(L("Voir les sondages et le graphique complet", "See the polls and the full chart"))}">${weekChart(e)}<span>${L("Kalshi et Polymarket, en moyenne. Les sondages, plus bas", "Kalshi and Polymarket, averaged. The polls, below")} ↓</span></a></section>
    </div>`;
}

function animate(root: HTMLElement) {
  if (reduced()) return;
  root.querySelectorAll<HTMLElement>(".ed-count").forEach((el) => {
    const v = Number(el.dataset.v), s = el.dataset.s ?? "", signed = !!el.dataset.signed, t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 900), e = 1 - (1 - k) ** 3; el.textContent = `${signed ? sgn(v * e) : dec(v * e)}${s}`; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
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
    box.querySelectorAll<HTMLButtonElement>(".ed-go").forEach((b) => b.addEventListener("click", () => void show(b.dataset.d!)));
    // the small chart leads to the polls chart below (an in-page scroll, not a route change)
    box.querySelector(".ed-wk-go")?.addEventListener("click", (ev) => { ev.preventDefault(); document.getElementById("trend")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); });
    animate(box);
  };
  box.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const b = box.querySelector<HTMLButtonElement>(`.ed-go:${ev.key === "ArrowLeft" ? "first-child" : "last-child"}`);
    if (b) { ev.preventDefault(); b.click(); box.querySelector<HTMLButtonElement>(".ed-go")?.focus(); }
  });
  await show(idx.at(-1)!.date);
}
