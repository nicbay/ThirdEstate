// Front page. One orchestrated reveal (headline strip), then a live map you can zoom into,
// the polling trend and the shift arrows, each drawn in as it scrolls into view.
import { geoConicConformal, geoPath } from "d3-geo";
import { loadCircoGeo, loadDepartements, loadDeputes, loadFeed, loadMarkets, loadPolls, loadShifts } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { lineChart } from "../lib/chart";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { cloudEnabled, getHome, lookupPostcode, onHome, onPresence, setHome } from "../lib/cloud";
import { rewind } from "../lib/map";
import { average, duelAverages, pollValue, referenceLineup, trend, WINDOW } from "../lib/polls";
import { esc } from "../util";
import { arrowPaths } from "./shifts";
import { bindSearch, searchBox } from "./explore";

export async function renderHome(app: HTMLElement) {
  const [polls, markets, geo, deputes, shifts] = await Promise.all([loadPolls("2027"), loadMarkets().catch(() => null), loadDepartements(), loadDeputes(), loadShifts().catch(() => null)]);
  registerParties(polls.parties);
  const fr = getLang() === "fr";
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const lineup = referenceLineup(polls.firstRound, latest);
  const strip = [...lineup.rows].sort((a, b) => spectrumRank(a.name) - spectrumRank(b.name));
  const sum = strip.reduce((s, r) => s + r.share, 0) || 1;
  const [leader, second] = [...lineup.rows].sort((a, b) => b.share - a.share);
  const nPolls = polls.firstRound.filter((p) => p.end > shiftDays(latest, -WINDOW)).length;
  const now = average(polls.firstRound, latest);
  const duels = duelAverages(polls.secondRound).slice(0, 5);
  const winner = markets?.markets.find((m) => m.id.startsWith("KXFRENCHPRES")) ?? markets?.markets[0];

  const headline = leader
    ? fr
      ? `${leader.name} en tête, ${meta(second.name).surname} deuxième à six mois du premier tour`
      : `${leader.name} leads, ${meta(second.name).surname} second, six months before the first round`
    : L("Où en est la course", "Where the race stands");

  const feed = await loadFeed().catch(() => null);
  const stories = (feed?.stories ?? []).filter((s) => (s.reactions ?? []).some((r) => r.rating)).slice(0, 3);
  void duels; void winner; void now; void pollValue;

  app.innerHTML = `
    <section class="page home">
      <header class="page-head hero welcome">
        <p class="eyebrow">ProjectView <span class="live-badge" id="live-badge" hidden><i></i><span id="live-count"></span></span></p>
        <h1>${L("Tout ce qui se décide là où vous vivez", "Everything being decided where you live")}</h1>
        <p class="dek">${L("Vos élus, du maire au député et au sénateur, comment ils votent, ce qu’ils ont promis, et la vie de votre commune : emploi, écoles, sécurité, actualité, et ce qui en fait le charme.", "Your elected officials, from mayor to MP and senator, how they vote, what they promised, and life in your town: jobs, schools, safety, news, and what makes it a good place.")}</p>
        ${searchBox(L("Votre adresse, votre ville ou votre code postal", "Your address, town or postcode"))}
      </header>

      <section class="card where-block">
        <div class="pres-grid">
          <div>
            <header class="card-head"><h2 id="map-title">${L("La France qui suit l’élection", "France following the election")}</h2><button type="button" class="linkish" id="map-back" hidden>${L("Revenir à la France entière", "Back to all of France")}</button></header>
            <svg id="live-map" viewBox="0 0 600 600" role="img" aria-label="${L("Carte de France", "Map of France")}"><g id="deps"></g><g id="districts"></g><g id="dots"></g></svg>
            <p class="muted small" id="map-note"></p>
          </div>
          <aside class="panel" id="where-panel"></aside>
        </div>
      </section>

      <section class="card">
        <header class="card-head"><h2>${esc(headline)}</h2><a href="#/2027">${L("La présidentielle 2027", "The 2027 race")}</a></header>
        <figure class="spectrum reveal-now" style="margin:0">
          <div class="spectrum-bar">${strip.map((r, i) => `<span class="grow" style="flex:${r.share};background:${meta(r.name).color};--i:${i}" data-tip="${esc(`${r.name}${meta(r.name).party ? ` (${meta(r.name).party})` : ""}\n${r.share.toFixed(1)} %`)}"></span>`).join("")}</div>
          <div class="spectrum-labels">${strip.map((r, i) => `<span class="fade" style="flex:${r.share};--i:${i}">${(100 * r.share) / sum >= 7 ? `<b>${r.share.toFixed(0)} %</b>${esc(meta(r.name).surname)}` : ""}</span>`).join("")}</div>
          <div class="spectrum-axis"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
        </figure>
        <p class="muted small">${L(`Moyenne des ${nPolls} sondages des ${WINDOW} derniers jours, au ${fmtDate(latest)}.`, `Average of the ${nPolls} polls from the last ${WINDOW} days, as of ${fmtDate(latest)}.`)}</p>
        <div id="trend" class="reveal"></div>
      </section>

      ${
        stories.length
          ? `<section class="card">
              <header class="card-head"><h2>${L("Fil rouge, fil bleu", "Red feed, blue feed")}</h2><a href="#/fil">${L("Tout le fil", "The whole feed")}</a></header>
              <ul class="teaser-stories">${stories
                .map((s) => {
                  const rs = (s.reactions ?? []).filter((r) => r.rating);
                  const l = rs.filter((r) => r.rating!.lean.score < 0).length, r = rs.length - l;
                  return `<li><a href="#/fil"><b>${esc(s.items[0].title)}</b></a><span class="lean-split"><span style="flex:${l || 0.001};background:#c9302c"></span><span style="flex:${r || 0.001};background:#2e5fb8"></span></span><span class="muted small">${l} ${L("réactions à gauche", "left-leaning reactions")}, ${r} ${L("à droite", "right-leaning")}</span></li>`;
                })
                .join("")}</ul>
            </section>`
          : ""
      }

      ${
        shifts
          ? `<section class="card reveal">
              <header class="card-head"><h2>${L("De 2022 à 2024, presque toute la France a basculé à droite", "From 2022 to 2024, almost all of France moved right")}</h2><a href="#/resultats/bascules">${L("Toutes les élections depuis 1848", "Every election since 1848")}</a></header>
              <p class="muted small">${L("Une flèche par circonscription, au premier tour des législatives. Vers la droite et en bleu : la droite a progressé ; vers la gauche et en rouge : la gauche a progressé.", "One arrow per district, legislative first round. Pointing right and blue: the right gained; pointing left and red: the left gained.")}</p>
              <svg id="home-arrows" viewBox="0 0 800 780" class="home-arrows"></svg>
            </section>`
          : ""
      }

      <nav class="doors" aria-label="${L("Rubriques", "Sections")}">
        <a class="door" href="#/explorer"><b>${L("Ma commune", "My town")}</b><span class="muted small">${L("Élus, actualité, quartiers, écoles, sécurité, prix de l’immobilier.", "Officials, news, neighbourhoods, schools, safety, property prices.")}</span></a>
        <a class="door" href="#/2027"><b>${L("Présidentielle 2027", "2027 presidential")}</b><span class="muted small">${L("Sondages, marchés, simulateur de second tour.", "Polls, markets, runoff simulator.")}</span></a>
        <a class="door" href="#/elus"><b>${L("Vos élus", "Your officials")}</b><span class="muted small">${L("Députés, sénateurs, maires : qui ils sont, comment ils votent.", "MPs, senators, mayors: who they are, how they vote.")}</span></a>
        <a class="door" href="#/resultats"><b>${L("Histoire électorale", "Electoral history")}</b><span class="muted small">${L("Toutes les présidentielles depuis 1848, les bascules par territoire.", "Every presidential election since 1848, shifts by area.")}</span></a>
      </nav>
    </section>`;
  bindSearch(app);

  // ---------- live map: departments → zoom into districts ----------
  const features = geo.features.map(rewind).filter((f) => f.properties!.code.length === 2);
  const fc = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
  const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[8, 8], [592, 592]], fc);
  const path = geoPath(proj);
  const centroid = new Map(features.map((f) => [f.properties!.code as string, path.centroid(f)]));
  const svg = app.querySelector<SVGSVGElement>("#live-map")!;
  const depName = new Map(features.map((f) => [f.properties!.code as string, f.properties!.nom as string]));
  let counts = new Map<string, number>();
  let total = 1;
  let zoomed: string | null = null;

  const drawDeps = () => {
    const home = getHome()?.dep;
    const max = Math.max(1, ...counts.values());
    svg.querySelector("#deps")!.innerHTML = features
      .map((f) => {
        const code = f.properties!.code as string;
        const n = counts.get(code) ?? 0;
        return `<path class="area live-dep${code === home ? " is-home" : ""}${code === zoomed ? " selected" : ""}" data-code="${code}" d="${path(f)}" style="--a:${n ? 0.15 + (0.55 * n) / max : 0}" data-tip="${esc(`${f.properties!.nom}${n ? `\n${n} ${L(n > 1 ? "visiteurs en ce moment" : "visiteur en ce moment", n > 1 ? "visitors right now" : "visitor right now")}` : ""}`)}"/>`;
      })
      .join("");
    svg.querySelector("#dots")!.innerHTML = zoomed
      ? ""
      : [...counts.entries()].map(([code, n]) => { const c = centroid.get(code); return c ? `<circle class="live-dot" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(3 + 3 * Math.sqrt(n)).toFixed(1)}"/>` : ""; }).join("");
    svg.querySelectorAll<SVGPathElement>("#deps [data-code]").forEach((el) => el.addEventListener("click", () => zoomTo(el.dataset.code!)));
  };

  // animate the viewBox to a department's bounds, then draw its districts at the same projection
  let anim = 0;
  const animateViewBox = (to: [number, number, number, number]) => {
    const from = svg.viewBox.baseVal;
    const start = [from.x, from.y, from.width, from.height];
    const t0 = performance.now(), dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;
    cancelAnimationFrame(anim);
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      svg.setAttribute("viewBox", start.map((v, i) => v + (to[i] - v) * e).join(" "));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  const zoomTo = async (code: string | null) => {
    zoomed = code;
    const back = app.querySelector<HTMLButtonElement>("#map-back")!;
    back.hidden = !code;
    app.querySelector("#map-title")!.textContent = code ? depName.get(code) ?? code : L("La France qui suit l’élection", "France following the election");
    svg.querySelector("#districts")!.innerHTML = "";
    drawDeps();
    drawPanel();
    if (!code) return animateViewBox([0, 0, 600, 600]);
    const f = features.find((x) => x.properties!.code === code);
    if (!f) return;
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.12;
    const side = Math.max(x1 - x0, y1 - y0) + 2 * pad;
    animateViewBox([(x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2, side, side]);
    try {
      const g = await loadCircoGeo(code);
      if (zoomed !== code) return;
      const byCirco = new Map(deputes.filter((d) => d.circo).map((d) => [d.circo!, d]));
      svg.querySelector("#districts")!.innerHTML = g.features
        .map(rewind)
        .map((cf) => {
          const c = cf.properties!.code as string;
          const d = byCirco.get(c);
          const pc = path.centroid(cf);
          return `<a href="#/circo/${c}"><path class="district" d="${path(cf)}" fill="${d?.groupe?.couleur ?? "#ccc"}" data-tip="${esc(`${L("Circonscription", "District")} ${Number(c.slice(-2))}\n${d ? `${d.prenom} ${d.nom} (${d.groupe?.abrev ?? ""})` : ""}`)}"/><text x="${pc[0]}" y="${pc[1]}" class="district-num" style="font-size:${(side / 40).toFixed(1)}px">${Number(c.slice(-2))}</text></a>`;
        })
        .join("");
    } catch {
      /* no district outlines (e.g. abroad) */
    }
  };
  app.querySelector("#map-back")!.addEventListener("click", () => zoomTo(null));

  // ---------- "where are you from?" panel ----------
  const drawPanel = () => {
    const panel = app.querySelector<HTMLElement>("#where-panel")!;
    const home = getHome();
    const dep = zoomed ?? home?.dep ?? null;
    const mps = dep ? deputes.filter((d) => d.numDepartement === dep).sort((a, b) => (a.numCirco ?? 0) - (b.numCirco ?? 0)) : [];
    panel.innerHTML = `
      ${
        home
          ? `<p class="small muted">${L("Vous suivez l’élection depuis", "You’re following from")} <b>${esc(home.commune ?? home.depName)}</b>${home.commune ? ` (${esc(home.depName)})` : ""}. <button type="button" class="linkish" id="home-change">${L("Changer", "Change")}</button></p>`
          : `<h2>${L("D’où suivez-vous l’élection ?", "Where are you following from?")}</h2>
             <form id="where-form" class="where-form"><label for="cp" class="small muted">${L("Votre code postal, pour voir votre circonscription et apparaître sur la carte. Seul votre département est partagé, de façon anonyme.", "Your postcode, to see your district and appear on the map. Only your department is shared, anonymously.")}</label>
             <div><input id="cp" inputmode="numeric" pattern="[0-9AB]{5}" maxlength="5" placeholder="84000" autocomplete="postal-code"/><button class="button" type="submit">${L("Valider", "Go")}</button></div><p id="where-msg" class="small" role="status"></p></form>`
      }
      ${
        dep
          ? `<h3>${esc(depName.get(dep) ?? dep)} : ${mps.length} ${L("circonscriptions", "districts")}</h3>
             <ul class="circo-list">${mps.map((d) => `<li><a href="#/circo/${d.circo}"><span class="num-badge">${d.numCirco}</span><span><b>${esc(d.prenom)} ${esc(d.nom)}</b> <span class="chip" style="--c:${d.groupe?.couleur ?? "#999"}">${esc(d.groupe?.abrev ?? "")}</span></span></a></li>`).join("")}</ul>`
          : `<p class="muted small">${L("Ou cliquez sur un département pour zoomer sur ses circonscriptions.", "Or click a department to zoom into its districts.")}</p>`
      }`;
    panel.querySelector("#home-change")?.addEventListener("click", () => setHome(null));
    panel.querySelector<HTMLFormElement>("#where-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cp = panel.querySelector<HTMLInputElement>("#cp")!.value.trim();
      const msg = panel.querySelector("#where-msg")!;
      try {
        const communes = await lookupPostcode(cp);
        if (!communes.length) { msg.textContent = L("Code postal inconnu.", "Unknown postcode."); return; }
        const c = communes[0];
        setHome({ dep: c.codeDepartement, depName: c.departement?.nom ?? depName.get(c.codeDepartement) ?? c.codeDepartement, commune: communes.length === 1 ? c.nom : undefined });
      } catch {
        msg.textContent = L("Le service geo.api.gouv.fr ne répond pas, réessayez.", "geo.api.gouv.fr isn’t responding, try again.");
      }
    });
  };

  const off1 = onHome((h) => { if (!document.body.contains(svg)) return off1(); zoomTo(h?.dep ?? null); });
  const off2 = onPresence((c, t) => {
    if (!document.body.contains(svg)) return off2();
    counts = c;
    total = t;
    const badge = app.querySelector<HTMLElement>("#live-badge")!;
    badge.hidden = false;
    app.querySelector("#live-count")!.textContent = cloudEnabled() ? (fr ? `${total} ${total > 1 ? "personnes" : "personne"} en ce moment` : `${total} ${total > 1 ? "people" : "person"} here now`) : L("en direct dès la mise en ligne", "live once online");
    app.querySelector("#map-note")!.textContent = cloudEnabled() ? L("Les points montrent d’où les visiteurs suivent le site en ce moment.", "Dots show where visitors are following from right now.") : L("Les visiteurs en direct apparaîtront ici une fois le site en ligne.", "Live visitors will appear here once the site is online.");
    if (!zoomed) drawDeps();
  });
  drawDeps();
  drawPanel();
  if (getHome()) zoomTo(getHome()!.dep);

  // ---------- trend chart ----------
  const from = shiftDays(latest, -365);
  const pts = trend(polls.firstRound, from);
  const shown = now.slice(0, 7).map((r) => r.name);
  app.querySelector("#trend")!.innerHTML = lineChart(
    shown.map((n) => ({ name: n, label: meta(n).surname, color: meta(n).color, line: pts.filter((p) => p.values[n] != null).map((p) => ({ date: p.date, value: p.values[n] })) })).filter((s) => s.line.length),
    { height: 340 },
  );

  // ---------- arrows ----------
  if (shifts) {
    const pair = shifts.pairs.filter((p) => p.level === "district").at(-1)!;
    const projA = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[10, 10], [790, 770]], fc);
    const outlines = features.map((f) => `<path d="${geoPath(projA)(f)}" class="shift-base"/>`);
    app.querySelector("#home-arrows")!.innerHTML = outlines.join("") + arrowPaths(pair, "lr", (p) => projA(p) as [number, number] | null);
  }

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
