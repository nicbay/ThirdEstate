// Homepage hero, "the note of the day": on the left what moved (polls, new and departing candidates, the day's
// stories, what MPs are posting); on the right one France: its 577 districts coloured by the sitting MP, which
// fly into the Assembly's seats, or the arrows of how each district shifted between the last two legislative
// elections. Preview at #/apercu until it replaces the current hero.
import "../styles/hero-day.css";
import { infoTip } from "../lib/infotip";
import { geoConicConformal, geoPath } from "d3-geo";
import { fetchJson, loadDepartements, loadDeputes, loadFeed, loadMarkets, loadPolls, loadShifts, type FeedReaction } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { ELECTION_DAY } from "../lib/forecast";
import { average, latestPollDate, pollsterName, pollsterRating, trend } from "../lib/polls";
import { colon, dec, pct } from "../lib/format";
import { rewind } from "../lib/map";
import { getHome } from "../lib/cloud";
import { esc, safeUrl } from "../util";
import { heroViz } from "./hero";
import { arrowPaths, legend, unitsPerPx } from "./shifts";
import { pollMoves } from "./daily";
import { bindSearch, searchBox } from "./explore";
import { scenarioForecast, scenarioFromUrl, scenarioLabel } from "./forecast-chart";
import type { Forecast } from "../lib/forecast";

/** Our forecast in one line; under a scenario (picked in the chart below), its figure and the like-for-like one. */
export function forecastLine(fc: Forecast, base?: Forecast) {
  const fav = fc.rows[0];
  if (!fav) return "";
  if (!fc.scenarios.length) return `<p class="hday-fc">${L("Notre prévision", "Our forecast")}${colon()}<b>${esc(fav.name)}</b> ${pct(fav.win, 0)} ${L("de chances", "chance")} · <a href="#/2027">${L("comment", "how")}</a></p>`;
  const ref = base?.rows.find((r) => r.name === fav.name)?.polls?.win;
  return `<p class="hday-fc is-scenario">${L("Scénario", "Scenario")} « ${esc(scenarioLabel(fc.scenarios))} »${colon()}<b>${esc(fav.name)}</b> ${pct(fav.win, 0)} ${L("de chances", "chance")}${ref == null ? "" : ` (${L("sans", "without")} : ${pct(ref, 0)})`}, ${L("modèle des sondages seul", "polls model alone")} · <a href="#/">${L("revenir aux sondages du jour", "back to today’s polls")}</a></p>`;
}

interface CandFile { slug: string; name: string; pollName: string; campaign?: { date: string; fr: string; en: string }[]; withdrawn?: { date: string; fr?: string; en?: string } }
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const ago = (iso: string, days: number) => Date.parse(iso) >= Date.now() - days * DAY;

/** Builds the hero HTML and returns it with a start() that wires the maps once it's in the page. */
export async function heroDay() {
  const [polls, markets, geo, deputes, shifts, feed, idx] = await Promise.all([
    loadPolls("2027"), loadMarkets().catch(() => null), loadDepartements(), loadDeputes(), loadShifts().catch(() => null), loadFeed().catch(() => null),
    fetchJson<{ candidates: { slug: string; pollName: string }[] }>("/data/candidates/index.json").catch(() => null),
  ]);
  registerParties(polls.parties);
  const fr = getLang() === "fr";
  const latest = latestPollDate(polls.firstRound);
  const now = average(polls.firstRound, latest);
  const moves = pollMoves(polls.firstRound);
  const daysToGo = Math.max(0, Math.round((Date.parse(ELECTION_DAY) - Date.parse(today())) / DAY));
  const fc = scenarioForecast(polls, markets, scenarioFromUrl());
  const [a, b, c] = now;

  // ---- headline, written from the numbers
  const gap = a && b ? a.avg - b.avg : 0;
  const head = a && b
    ? fr
      ? `${meta(a.name).surname}${gap >= 8 ? " largement" : ""} en tête, ${meta(b.name).surname} deuxième${c && b.avg - c.avg < 3 ? `, ${meta(c.name).surname} à ${dec(b.avg - c.avg)} point${b.avg - c.avg >= 2 ? "s" : ""}` : ""}`
      : `${meta(a.name).surname} leads${gap >= 8 ? " comfortably" : ""}, ${meta(b.name).surname} second${c && b.avg - c.avg < 3 ? `, ${meta(c.name).surname} ${dec(b.avg - c.avg)} point${b.avg - c.avg >= 2 ? "s" : ""} behind` : ""}`
    : L("La course à l’Élysée", "The race for the Élysée");

  // ---- polls: the top six with a 60-day sparkline and the 7-day move
  const spark = trend(polls.firstRound, new Date(Date.parse(latest) - 60 * DAY).toISOString().slice(0, 10));
  const top = now.slice(0, 6);
  const max = Math.max(...top.map((r) => r.avg), 1);
  const sparkline = (name: string, color: string) => {
    const vs = spark.map((p) => p.values[name]).filter((v): v is number => v != null);
    if (vs.length < 2) return "";
    const lo = Math.min(...vs) - 1, hi = Math.max(...vs) + 1;
    const pts = vs.map((v, i) => `${((i / (vs.length - 1)) * 56).toFixed(1)},${(16 - ((v - lo) / (hi - lo)) * 14).toFixed(1)}`).join(" ");
    return `<svg class="hd-spark" viewBox="0 0 56 18" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  };
  const slugOf = new Map((idx?.candidates ?? []).map((x) => [x.pollName, x.slug]));
  const pollRows = top.map((r) => {
    const m = meta(r.name), mv = moves.get(r.name)?.d7 ?? null;
    const cls = mv == null || Math.abs(mv) < 0.3 ? "flat" : mv > 0 ? "up" : "down";
    const name = slugOf.has(r.name) ? `<a href="#/candidat/${slugOf.get(r.name)}">${esc(m.surname)}</a>` : esc(m.surname);
    return `<li><span class="hdp-name"><i style="background:${m.color}"></i>${name}</span><span class="hdp-bar"><b style="width:${((r.avg / max) * 100).toFixed(1)}%;background:${m.color}"></b></span><span class="hdp-v">${pct(r.avg)}</span><span class="hdp-d ${cls}">${mv == null ? "" : cls === "flat" ? "=" : `${cls === "up" ? "+" : "−"}${dec(Math.abs(mv))}`}</span>${sparkline(r.name, m.color)}</li>`;
  }).join("");
  const last = [...polls.firstRound].sort((x, y) => y.end.localeCompare(x.end))[0];
  const lastLine = last ? `${L("Dernier sondage", "Latest poll")}${colon()}${last.url ? `<a href="${esc(safeUrl(last.url))}" target="_blank" rel="noopener">${esc(pollsterName(last.pollster))}</a>` : esc(pollsterName(last.pollster))}${pollsterRating(last.pollster)?.grade ? ` <span class="hdp-grade">${pollsterRating(last.pollster)!.grade}</span>` : ""}, ${fmtDate(last.end)}` : "";

  // ---- what changed: candidates who entered or left the race lately, names new to the polls
  const files = await Promise.all((idx?.candidates ?? []).map((x) => fetchJson<CandFile>(`/data/candidates/${x.slug}.json`).catch(() => null)));
  const events: { date: string; html: string }[] = [];
  for (const f of files) {
    if (!f) continue;
    if (f.withdrawn && ago(f.withdrawn.date, 21)) events.push({ date: f.withdrawn.date, html: `<b>${esc(meta(f.pollName).surname)}</b> ${L("se retire", "drops out")}` });
    // one line per candidate: their latest milestone
    const m = (f.campaign ?? []).filter((x) => ago(x.date, 10)).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (m) events.push({ date: m.date, html: `<a href="#/candidat/${f.slug}"><b>${esc(meta(f.pollName).surname)}</b></a> · ${esc(L(m.fr, m.en))}` });
  }
  const firstSeen = new Map<string, string>();
  for (const p of [...polls.firstRound].sort((x, y) => x.end.localeCompare(y.end))) for (const h of p.hyps) for (const n of Object.keys(h)) if (!firstSeen.has(n)) firstSeen.set(n, p.end);
  for (const [n, d] of firstSeen) if (ago(d, 14) && polls.firstRound.length > 5) events.push({ date: d, html: `<b>${esc(meta(n).surname)}</b> ${L("testé pour la première fois", "polled for the first time")} (${esc(pollsterName(polls.firstRound.find((p) => p.hyps.some((h) => n in h) && p.end === d)?.pollster ?? ""))})` });
  events.sort((x, y) => y.date.localeCompare(x.date));
  const eventsHtml = events.slice(0, 4).map((e) => `<li><time>${fmtDate(e.date).replace(/\s\d{4}$/, "")}</time><span>${e.html}</span></li>`).join("");

  // ---- the day's stories (most outlets), and the MPs' most shared posts
  const stories = [...(feed?.stories ?? [])].sort((x, y) => y.outlets.length - x.outlets.length).slice(0, 3);
  const storiesHtml = stories.map((s) => `<li><a href="${esc(safeUrl(s.items[0].link))}" target="_blank" rel="noopener">${esc(s.title)}</a><span>${s.outlets.length} ${L("médias", "outlets")}</span></li>`).join("");
  const reach = (r: FeedReaction) => (r.metrics?.likes ?? 0) + 2 * (r.metrics?.reposts ?? 0);
  // the most shared posts that say something (60+ characters), one per MP
  const seenMp = new Set<string>();
  const posts = (feed?.stories ?? []).flatMap((s) => s.reactions ?? [])
    .filter((r) => r.rating?.political !== false && r.text.trim().length >= 60)
    .sort((x, y) => reach(y) - reach(x))
    .filter((r) => (seenMp.has(r.mp.id) ? false : (seenMp.add(r.mp.id), true)))
    .slice(0, 2);
  const postsHtml = posts.map((r) => `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener"><span class="hds-who"><i style="background:${esc(r.mp.group?.couleur ?? "#888")}"></i>${esc(r.mp.name)}${r.mp.group ? ` <span>${esc(r.mp.group.abrev)}</span>` : ""}</span><span class="hds-text">${esc(r.text.length > 150 ? `${r.text.slice(0, 147).trim()}…` : r.text)}</span></a></li>`).join("");

  // ---- the visual: seats or shifts
  const pair = shifts?.pairs.filter((p) => p.level === "district").at(-1);
  const viz = heroViz(geo, deputes, pair);
  const home = getHome();

  const html = `<section class="hero-x hday" aria-labelledby="hday-title">
    <p class="hero-kicker">${L("Le point du jour", "The note of the day")} · ${fmtDate(today())} · ${L(`premier tour dans ${daysToGo} jours`, `first round in ${daysToGo} days`)}</p>
    <h1 id="hday-title">${esc(head)}</h1>
    <div class="hday-grid">
      <div class="hday-note">
        <section class="hday-block">
          <header><h2>${L("Sondages", "Polls")}</h2><a href="#/sondages">${L("Tous", "All")} →</a></header>
          <ol class="hdp">${pollRows}</ol>
          <p class="hday-small">${L("Moyenne pondérée par la note des instituts · variation sur 7 jours", "Average weighted by institute grade · change over 7 days")}${infoTip(L("Chaque sondage compte selon la note de son institut (de A+ à F), gagnée par l’écart entre ses derniers sondages et les résultats depuis 2002. La flèche donne la variation sur les 7 derniers jours.", "Each poll counts by its institute’s grade (A+ to F), earned from how far its final polls landed from the results since 2002. The arrow is the change over the last 7 days."), L("À propos de la moyenne", "About the average"))}${lastLine ? ` · ${lastLine}` : ""}</p>
          <div id="hq-num">${forecastLine(fc, fc.scenarios.length ? scenarioForecast(polls, markets, []) : undefined)}</div>
        </section>
        ${eventsHtml ? `<section class="hday-block"><header><h2>${L("Ce qui a bougé", "What changed")}</h2><a href="#/2027">${L("Les candidats", "Candidates")} →</a></header><ul class="hde">${eventsHtml}</ul></section>` : ""}
        ${storiesHtml ? `<section class="hday-block"><header><h2>${L("À la une", "Top stories")}</h2><a href="#/fil">${L("Fil rouge, fil bleu", "Red feed, blue feed")} →</a></header><ul class="hdn">${storiesHtml}</ul></section>` : ""}
        ${postsHtml ? `<section class="hday-block"><header><h2>${L("Sur les réseaux", "On social media")}</h2><a href="#/fil">${L("Tout", "All")} →</a></header><ul class="hds">${postsHtml}</ul></section>` : ""}
      </div>
      <figure class="hday-viz">
        <div class="hday-tabs" role="tablist" aria-label="${L("Carte", "Map")}">
          <button type="button" role="tab" data-v="seats" aria-selected="true">${L("L’Assemblée · 577 sièges", "The Assembly · 577 seats")}</button>
          ${pair ? `<button type="button" role="tab" data-v="shifts" aria-selected="false">${L(`Les bascules ${pair.from}→${pair.to}`, `Shifts ${pair.from}→${pair.to}`)}</button>` : ""}
        </div>
        <div class="hday-pane" data-p="seats">
          ${viz.svg}
          <figcaption><div class="hd-toggle" role="group" aria-label="${L("Vue", "View")}"><button type="button" data-hd="map">${L("Circonscriptions", "Districts")}</button><button type="button" data-hd="hemi">${L("Sièges", "Seats")}</button></div><p id="hd-caption"></p>${viz.legend}</figcaption>
        </div>
        ${pair ? `<div class="hday-pane" data-p="shifts" hidden>
          <svg id="hday-arrows" viewBox="0 0 800 780" class="home-arrows" role="img" aria-label="${L(`Bascules ${pair.from}–${pair.to}`, `Shifts ${pair.from}–${pair.to}`)}"></svg>
          <figcaption><p>${L(`Une flèche par circonscription : écart droite–gauche au premier tour des législatives, de ${pair.from} à ${pair.to}. Survolez, cliquez.`, `One arrow per district: right–left margin in the legislative first round, ${pair.from} to ${pair.to}. Hover, click.`)}</p><div class="shift-legend" id="hday-legend"></div></figcaption>
        </div>` : ""}
      </figure>
    </div>
    <div class="hday-actions">
      <div class="hday-town">${searchBox(home?.code ? L(`Votre commune : ${home.commune ?? ""} — ou une autre`, `Your town: ${home.commune ?? ""} — or another`) : L("Votre ville ou votre code postal", "Your town or postcode"))}</div>
      <a href="#/programmes">${L("Comparer les programmes", "Compare the programmes")} →</a>
      <a href="#/quiz">${L("Faire le quiz", "Take the quiz")} →</a>
    </div>
    <div class="px-edge" aria-hidden="true"></div>
  </section>`;

  const start = (root: HTMLElement) => {
    bindSearch(root);
    viz.start(root);
    let drawn = false;
    const drawArrows = () => {
      if (drawn || !pair) return;
      drawn = true;
      const features = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
      const fcGeo = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
      const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], fcGeo);
      const svg = root.querySelector<SVGSVGElement>("#hday-arrows")!;
      const k = unitsPerPx(svg, 800);
      svg.style.setProperty("--sw", `${(1.7 * k).toFixed(2)}px`);
      svg.innerHTML = features.map((f) => `<path d="${geoPath(proj)(f)}" class="shift-base"/>`).join("") + arrowPaths(pair, "lr", (p) => proj(p) as [number, number] | null, { k, dark: true });
      root.querySelector("#hday-legend")!.innerHTML = legend("lr", 2.2 / k, true, true);
      svg.addEventListener("click", (e) => { const href = (e.target as Element).closest<SVGGElement>(".arrow")?.dataset.href; if (href) location.hash = href; });
    };
    root.querySelectorAll<HTMLButtonElement>(".hday-tabs [data-v]").forEach((t) =>
      t.addEventListener("click", () => {
        root.querySelectorAll<HTMLButtonElement>(".hday-tabs [data-v]").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
        root.querySelectorAll<HTMLElement>(".hday-pane").forEach((p) => (p.hidden = p.dataset.p !== t.dataset.v));
        if (t.dataset.v === "shifts") drawArrows();
      }),
    );
  };
  return { html, start };
}
