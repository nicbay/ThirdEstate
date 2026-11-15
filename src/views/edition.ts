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
interface Ledger {
  span: "day" | "week";
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

/** Third Estate's read: who had the momentum (candidate and party), on the day or over the week, with the figures. */
function leadHtml(g: Ledger) {
  const one = (m: Mv) => {
    const party = meta(m.name).party;
    const bits = [moved(m.market) ? `${sgn(m.market)} ${L("pt sur les marchés", "pt on the markets")}` : "", moved(m.polls) ? `${sgn(m.polls)} ${L("pt dans les sondages", "pt in the polls")}` : ""].filter(Boolean).join(", ");
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

/** Sunday's longer recap: the week's largest rise and fall in the polls and in the odds, the polls published, the most-covered stories. */
function recapHtml(r: NonNullable<Ledger["recap"]>) {
  const ext = (x: Ext | null, up: boolean) => (x ? `<b>${sur(x.name)}</b> ${up ? L("gagne le plus", "gains the most") : L("perd le plus", "loses the most")}, ${sgn(x.d)} pt ${L("à", "to")} ${pct(x.now)}` : "");
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
    ${g ? `<div class="ed-lg">
      <div class="lg">
        ${g.recap ? row(L("La semaine", "The week"), recapHtml(g.recap), "is-week") : ""}
        ${g.world ? row(L("Monde", "World"), story(g.world)) : ""}
        ${g.france ? row("France", story(g.france)) : ""}
        ${s ? row(L("La surprise", "Surprise"), `${esc(L(s.fr, s.en))}${s.story ? ` <span class="ed-ev">${story(s.story)}</span>` : ""}`) : ""}
        ${g.candidates.length ? row(L("Candidats", "Candidates"), `<ul class="lg-list">${g.candidates.map((c) => `<li>${story(c)}</li>`).join("")}</ul>`) : ""}
        ${row("Third Estate", leadHtml(g), "is-te")}
      </div>
      <div class="lg-side">${tableHtml(g)}</div>
    </div>` : ""}
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
