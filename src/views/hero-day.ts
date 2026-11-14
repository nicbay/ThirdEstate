// Homepage parts, built from the day's numbers: the headline; "the note of the day" (key takeaways, then the polls,
// new and departing candidates, the day's stories, what MPs are posting); and two widgets for the foot of the page,
// the Assembly (577 districts coloured by the sitting MP, which fly into the seats) and a small shift map (how each
// district moved between the last two legislative elections, with the national change at every election since 1848).
import "../styles/hero-day.css";
import { infoTip } from "../lib/infotip";
import { geoConicConformal, geoPath } from "d3-geo";
import { getHome, onPresence } from "../lib/cloud";
import { fetchJson, loadDepartements, loadDeputes, loadFeed, loadMarkets, loadPolls, loadShifts, type FeedReaction } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { ELECTION_DAY } from "../lib/forecast";
import { average, latestPollDate, pollsterName, pollsterRating, trend } from "../lib/polls";
import { colon, dec, pct, signed } from "../lib/format";
import { rewind } from "../lib/map";
import { esc, safeUrl } from "../util";
import { heroViz } from "./hero";
import { arrowPaths, legend, unitsPerPx } from "./shifts";
import { pollMoves } from "./daily";
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

  // ---- key takeaways: three or four sentences written from the numbers
  const fav = fc.rows[0];
  const pair0 = fc.pairs[0];
  const movers = top
    .map((r) => ({ r, d: moves.get(r.name)?.d7 ?? null }))
    .filter((x): x is { r: (typeof top)[number]; d: number } => x.d != null && Math.abs(x.d) >= 0.5)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const pts = (v: number) => `${dec(Math.abs(v))} point${Math.abs(v) >= 2 ? "s" : ""}`;
  const takeaways: string[] = [];
  if (a && b) takeaways.push(fr
    ? `<b>${esc(meta(a.name).surname)}</b> est en tête avec ${pct(a.avg)}, ${pts(gap)} devant ${esc(meta(b.name).surname)} (${pct(b.avg)}).`
    : `<b>${esc(meta(a.name).surname)}</b> leads on ${pct(a.avg)}, ${pts(gap)} ahead of ${esc(meta(b.name).surname)} (${pct(b.avg)}).`);
  if (movers[0]) {
    const { r, d } = movers[0];
    takeaways.push(fr
      ? `Le plus fort mouvement de la semaine : <b>${esc(meta(r.name).surname)}</b>, ${d > 0 ? "+" : "−"}${pts(d)} en 7 jours.`
      : `Biggest move of the week: <b>${esc(meta(r.name).surname)}</b>, ${d > 0 ? "+" : "−"}${pts(d)} in 7 days.`);
  } else takeaways.push(L("Aucun candidat n’a bougé d’un demi-point ou plus en 7 jours.", "No candidate moved half a point or more in 7 days."));
  if (fav) takeaways.push(fr
    ? `Notre prévision donne à <b>${esc(meta(fav.name).surname)}</b> ${pct(fav.win, 0)} de chances d’être élu${pair0 ? ` ; second tour le plus probable : ${esc(meta(pair0.a).surname)} – ${esc(meta(pair0.b).surname)} (${Math.round(pair0.p)} % des simulations)` : ""}.`
    : `Our forecast gives <b>${esc(meta(fav.name).surname)}</b> a ${pct(fav.win, 0)} chance of being elected${pair0 ? `; most likely runoff: ${esc(meta(pair0.a).surname)} – ${esc(meta(pair0.b).surname)} (${Math.round(pair0.p)}% of simulations)` : ""}.`);
  if (events[0]) takeaways.push(`${L("Dans la campagne", "On the trail")}${colon()}${events[0].html.replace(/\.\s*$/, "")}.`);

  // ---- the poll average (bars, 7-day move, 60-day sparkline): shown inside the note of the day at the top
  const pollsHtml = `<section class="hday-block ed-polls">
        <header><h2>${L(`Moyenne des sondages au ${fmtDate(latest)}`, `Poll average, ${fmtDate(latest)}`)}</h2><a href="#/sondages">${L("Chaque sondage", "Every poll")} →</a></header>
        <ol class="hdp">${pollRows}</ol>
        <p class="hday-small">${L("Intentions de vote aujourd’hui, pondérées par la note des instituts, corrigées de leurs penchants · variation sur 7 jours. Le graphique au-dessus prolonge ces moyennes jusqu’au premier tour.", "Voting intention today, weighted by institute grade, corrected for their leans · change over 7 days. The chart above carries these averages forward to the first round.")}${infoTip(L("Chaque sondage compte selon la note de son institut (de A+ à F), gagnée par l’écart entre ses derniers sondages et les résultats depuis 2002. La flèche donne la variation sur les 7 derniers jours.", "Each poll counts by its institute’s grade (A+ to F), earned from how far its final polls landed from the results since 2002. The arrow is the change over the last 7 days."), L("À propos de la moyenne", "About the average"))}${lastLine ? ` · ${lastLine}` : ""}</p>
      </section>`;

  // ---- the note of the day: takeaways, then the polls, what changed, the stories and the posts
  // a dated desk brief: a few run-in lines under an ink rule, no boxes, no counters
  const dayLabel = new Date(today()).toLocaleDateString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "long" });
  const dayLabelFr = dayLabel.replace(/^1 /, "1er ");
  const noteHtml = `<section class="hday-panel" aria-labelledby="hday-note-title">
    <header class="hday-panel-head"><h2 id="hday-note-title">${L(`Ce qu’il faut retenir du ${dayLabelFr}`, `What to know on ${dayLabel}`)}</h2></header>
    <ul class="hday-take">${takeaways.map((t) => `<li>${t}</li>`).join("")}</ul>
    <div class="hday-note">
      ${eventsHtml ? `<section class="hday-block"><header><h2>${L("Ce qui a bougé", "What changed")}</h2><a href="#/2027">${L("Les candidats", "Candidates")} →</a></header><ul class="hde">${eventsHtml}</ul></section>` : ""}
      ${storiesHtml ? `<section class="hday-block"><header><h2>${L("Fil rouge, fil bleu", "Red feed, blue feed")}</h2><a href="#/fil">${L("Tout le fil", "The whole feed")} →</a></header><ul class="hdn">${storiesHtml}</ul></section>` : ""}
      ${postsHtml ? `<section class="hday-block"><header><h2>${L("Ce que publient les députés", "What MPs are posting")}</h2><a href="#/fil">${L("Tout le fil", "The whole feed")} →</a></header><ul class="hds">${postsHtml}</ul></section>` : ""}
    </div>
  </section>`;

  // ---- widget 1: the Assembly, 577 dots that fly from the map into the seats
  const pair = shifts?.pairs.filter((p) => p.level === "district").at(-1);
  const viz = heroViz(geo, deputes, pair, true); // drawn on the night band, whatever the theme
  // widget 1: who is reading right now, department by department, and the towns readers marked as theirs
  const parliamentHtml = `<section class="hw hw-live" aria-labelledby="hw-live">
    <div class="hw-head"><span class="hero-kicker"><i class="live-dot" aria-hidden="true"></i>${L("En direct", "Live")}</span><b id="hw-live">${L("Qui lit Third Estate en ce moment", "Who's reading Third Estate right now")}</b><span id="live-sum">${L("Connexion…", "Connecting…")}</span></div>
    <figure class="hw-fig"><svg id="live-map" viewBox="0 0 600 580" role="img" aria-label="${L("Lecteurs en ligne par département", "Readers online by department")}"></svg>
      <figcaption><p class="live-k">${L("Communes revendiquées par les lecteurs en ligne", "Towns claimed by readers online")}</p><ul class="live-towns" id="live-towns"></ul>
      <p class="small">${getHome()?.code ? L(`Vous : <a href="#/ville/${getHome()!.code}">${esc(getHome()!.commune ?? "")}</a>`, `You: <a href="#/ville/${getHome()!.code}">${esc(getHome()!.commune ?? "")}</a>`) : `<a href="#/explorer">${L("Revendiquez votre commune", "Claim your town")} →</a>`}</p>
      <p class="tiny muted">${L("Anonyme : seuls le département et, si vous l’avez choisie, la commune sont partagés, le temps de la visite.", "Anonymous: only the department and, if you chose it, the town are shared, for the length of the visit.")}</p></figcaption>
    </figure>
  </section>`;
  // the hero's art: the 577 districts on the map of France, flying into the 577 seats of the Assembly and back
  const artHtml = `<figure class="hday-art hw-fig">${viz.svg}<figcaption><div class="hd-toggle" role="group" aria-label="${L("Vue", "View")}"><button type="button" data-hd="map">${L("Circonscriptions", "Districts")}</button><button type="button" data-hd="hemi">${L("Sièges", "Seats")}</button></div><p id="hd-caption"></p>${viz.legend}</figcaption></figure>`;

  // ---- widget 2: the shift map, small: the latest district arrows and the national change since 1848
  const series = (shifts?.pairs ?? []).filter((p) => p.level === "department" && p.national.lr).sort((x, y) => x.from - y.from);
  const nat = pair?.national.lr;
  const maxV = Math.max(1, ...series.map((p) => Math.abs(p.national.lr![2])));
  const strip = series.map((p, n) => {
    const v = p.national.lr![2];
    return `<i class="${v > 0 ? "is-pos" : "is-neg"}${n === series.length - 1 ? " is-on" : ""}" style="--h:${((48 * Math.abs(v)) / maxV).toFixed(1)}%" title="${p.from} → ${p.to} : ${signed(v)}"></i>`;
  }).join("");
  const shiftsHtml = pair && nat ? `<section class="hw hw-shift" aria-labelledby="hw-shift">
    <a class="hw-head" href="#/resultats/bascules"><span class="hero-kicker">${L("Cartes des bascules", "Shift maps")} · ${pair.from} → ${pair.to}</span><b id="hw-shift">${nat[2] > 0 ? L("La France a glissé à droite", "France moved right") : L("La France a glissé à gauche", "France moved left")} <span class="hw-big ${nat[2] > 0 ? "is-pos" : "is-neg"}">${signed(nat[2])} ${L("pts", "pts")}</span></b><span>${L(`Une flèche par circonscription : écart droite − gauche au premier tour des législatives, de ${fmt1(nat[0])} à ${fmt1(nat[1])} points au niveau national.`, `One arrow per district: right − left margin in the legislative first round, ${fmt1(nat[0])} to ${fmt1(nat[1])} points nationally.`)}</span></a>
    <figure class="hw-fig">
      <svg id="hday-arrows" viewBox="0 0 800 780" class="home-arrows" role="img" aria-label="${L(`Bascules ${pair.from}–${pair.to}`, `Shifts ${pair.from}–${pair.to}`)}"></svg>
      <figcaption><div class="shift-legend" id="hday-legend"></div>
        ${series.length > 3 ? `<div class="hw-strip" aria-hidden="true">${strip}</div><p class="hw-years"><span>${series[0].from}</span><span>${L("variation nationale à chaque élection", "national change at each election")}</span><span>${series.at(-1)!.to}</span></p>` : ""}
        <a class="hw-more" href="#/resultats/bascules">${L("Remonter jusqu’à 1848", "Go back to 1848")} →</a></figcaption>
    </figure>
  </section>` : "";

  // what the site is, before any number: neutral, so no reader is turned away by the race's state
  const headHtml = `<div class="hday-intro">
      <p class="hday-kicker">${L("Présidentielle 2027", "2027 presidential election")} · ${fmtDate(today())} · ${L(`premier tour dans ${daysToGo} jours`, `first round in ${daysToGo} days`)}</p>
      <h1 id="hday-title">${L("La présidentielle, chiffres en main.", "The French election, by the numbers.")}</h1>
      <p class="hday-dek">${L("Chaque sondage pesé, chaque promesse chiffrée, chaque vote de votre député. Pour se faire son avis sur pièces.", "Every poll weighed, every promise costed, every vote your MP casts. Make up your own mind, on the evidence.")}</p>
      <nav class="hday-doors" aria-label="${L("Par où commencer", "Where to start")}">
        <a href="#/2027">${L("La prévision", "The forecast")}</a><a class="hday-quiz" href="#/quiz">${L("Le quiz : qui vous ressemble ?", "The quiz: who's closest to you?")}</a><a href="${"#/explorer"}">${L("Votre commune", "Your town")}</a><a href="#/assemblee/deputes">${L("Votre député", "Your MP")}</a><a href="#/programmes">${L("Les programmes", "The programmes")}</a>
      </nav>
    </div>`;

  const start = (root: HTMLElement) => {
    const art = root.querySelector<HTMLElement>(".hday-art");
    if (art) viz.start(art);
    // the live map: departments shaded by readers online, refreshed on every presence change
    const liveSvg = root.querySelector<SVGSVGElement>("#live-map");
    if (liveSvg) {
      const deps = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
      const lproj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[8, 8], [592, 572]], { type: "FeatureCollection", features: deps } as GeoJSON.FeatureCollection);
      const lpath = geoPath(lproj);
      const centre = new Map(deps.map((f) => [f.properties!.code as string, lpath.centroid(f)]));
      liveSvg.innerHTML = deps.map((f) => `<path d="${lpath(f)}" data-dep="${f.properties!.code}" class="live-dep"/>`).join("") + `<g id="live-pings"></g>`;
      const off = onPresence((counts, total, towns) => {
        if (!document.body.contains(liveSvg)) return off();
        const max = Math.max(1, ...counts.values());
        liveSvg.querySelectorAll<SVGPathElement>(".live-dep").forEach((p) => {
          const n = counts.get(p.dataset.dep!) ?? 0;
          p.style.setProperty("--k", n ? (0.25 + 0.75 * (n / max)).toFixed(2) : "0");
          p.classList.toggle("is-on", n > 0);
          p.dataset.tip = `${geo.features.find((f) => f.properties!.code === p.dataset.dep)?.properties?.nom ?? p.dataset.dep}\n${n} ${L(n > 1 ? "lecteurs en ligne" : "lecteur en ligne", n > 1 ? "readers online" : "reader online")}`;
        });
        // a soft ping on every department with readers
        root.querySelector("#live-pings")!.innerHTML = [...counts].map(([d]) => { const c = centre.get(d); return c ? `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="5" class="live-ping"/>` : ""; }).join("");
        const located = [...counts.values()].reduce((a, b) => a + b, 0);
        root.querySelector("#live-sum")!.textContent = L(`${total} ${total > 1 ? "lecteurs" : "lecteur"} en ce moment, dont ${located} ${located > 1 ? "situés" : "situé"} sur la carte.`, `${total} ${total > 1 ? "readers" : "reader"} right now, ${located} of them on the map.`);
        const list = [...towns].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
        root.querySelector("#live-towns")!.innerHTML = list.length
          ? list.map(([code, t]) => `<li><a href="#/ville/${code}">${esc(t.name)}</a>${t.n > 1 ? ` <b>${t.n}</b>` : ""}</li>`).join("")
          : `<li class="muted">${L("Aucune pour l’instant.", "None yet.")}</li>`;
      });
    }
    const svg = root.querySelector<SVGSVGElement>("#hday-arrows");
    if (!svg || !pair) return;
    const draw = () => {
      const features = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
      const fcGeo = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
      const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], fcGeo);
      const k = unitsPerPx(svg, 800);
      svg.style.setProperty("--sw", `${(1.7 * k).toFixed(2)}px`);
      svg.innerHTML = features.map((f) => `<path d="${geoPath(proj)(f)}" class="shift-base"/>`).join("") + arrowPaths(pair, "lr", (p) => proj(p) as [number, number] | null, { k, dark: isDarkTheme() });
      root.querySelector("#hday-legend")!.innerHTML = legend("lr", 2.2 / k, true, isDarkTheme());
    };
    // drawn once it comes near the screen (it sits at the foot of the page)
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); draw(); } }, { rootMargin: "300px" });
    io.observe(svg);
    svg.addEventListener("click", (e) => { const href = (e.target as Element).closest<SVGGElement>(".arrow")?.dataset.href; if (href) location.hash = href; });
  };
  void head; // the race's headline now lives in the note of the day, not as the page's first words
  return { headHtml, artHtml, noteHtml, pollsHtml, parliamentHtml, shiftsHtml, start };
}

/** The widgets sit on paper: party colours as they are, lifted only when the reader's paper is dark. */
const isDarkTheme = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
const fmt1 = (v: number) => (getLang() === "fr" ? v.toFixed(1).replace(".", ",") : v.toFixed(1)).replace("-", "−");
