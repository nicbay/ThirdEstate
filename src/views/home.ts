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
import { forecast } from "../lib/forecast";
import { esc, safeColor } from "../util";
import { arrowPaths, legend, unitsPerPx } from "./shifts";
import { bindSearch, searchBox } from "./explore";
import { countUp, heroViz } from "./hero";
import { mpChip, townBrief } from "./brief";

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
  void duels; void winner; void now; void pollValue; void second;
  const fav = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], new Date().toISOString().slice(0, 10)).rows[0];
  const home = getHome();
  const viz = heroViz(geo, deputes, shifts?.pairs.filter((p) => p.level === "district").at(-1));

  app.innerHTML = `
    <section class="page home">
      <section class="hero-x" aria-labelledby="hero-title">
        <div class="hero-x-in">
          <div class="hero-x-copy">
            <p class="hero-kicker">${L("Présidentielle 2027 · Assemblée · Sénat · 34 920 communes", "2027 presidential · Assembly · Senate · 34,920 towns")} <span class="live-badge" id="live-badge" hidden><i></i><span id="live-count"></span></span></p>
            <h1 id="hero-title"><span class="ln"><span>${L("La politique française,", "French politics,")}</span></span><span class="ln"><span><em>${L("en données.", "in data.")}</em></span></span></h1>
            <p class="hero-dek">${L("Qui va gagner en 2027. Comment votent vos députés et sénateurs. Ce qui se passe dans votre commune. Et toutes les élections depuis 1848, archives à l’appui.", "Who will win in 2027. How your MPs and senators vote. What is happening in your town. And every election since 1848, with the archive footage.")}</p>
            <p class="hero-search-label">${home?.code ? `${L("Votre commune", "Your town")} : <a href="#/ville/${home.code}">${esc(home.commune ?? home.code)}</a>. ${L("Ou cherchez ailleurs", "Or look somewhere else")}` : L("Commencez par chez vous", "Start with where you live")}</p>
            ${searchBox(L("Votre ville ou votre code postal", "Your town or postcode"))}
          </div>
          <figure class="hero-x-viz">
            ${viz.svg}
            <figcaption>
              <div class="hd-toggle" role="group" aria-label="${L("Vue", "View")}"><button type="button" data-hd="map">${L("577 circonscriptions", "577 districts")}</button><button type="button" data-hd="hemi">${L("577 sièges", "577 seats")}</button></div>
              <p id="hd-caption"></p>
              ${viz.legend}
            </figcaption>
          </figure>
        </div>
        <nav class="hero-x-doors" aria-label="${L("Rubriques", "Sections")}">
          ${fav ? `<a href="#/2027"><span class="hx-k">${L("Présidentielle 2027", "2027 presidential")}</span><strong data-count="${Math.round(fav.win)}" data-suffix=" %">${Math.round(fav.win)} %</strong><span>${fr ? `de chances pour ${esc(fav.name)} selon notre prévision (sondages et marchés)` : `chance for ${esc(fav.name)} in our forecast (polls and markets)`}</span></a>` : ""}
          <a href="#/assemblee"><span class="hx-k">${L("Vos élus", "Your officials")}</span><strong data-count="${deputes.length || 577}">${deputes.length || 577}</strong><span>${L("députés et 348 sénateurs, chacun de leurs votes", "MPs and 348 senators, every vote they cast")}</span></a>
          <a href="${home?.code ? `#/ville/${home.code}` : "#/explorer"}"><span class="hx-k">${L("Chez vous", "Where you live")}</span><strong data-count="34920">34 920</strong><span>${L("communes : maire, conseil, quartiers, écoles, sécurité, actualité", "towns: mayor, council, neighbourhoods, schools, safety, news")}</span></a>
          <a href="#/resultats"><span class="hx-k">${L("Archives", "Archives")}</span><strong>1848</strong><span>${L("chaque présidentielle depuis, avec l’annonce en vidéo ou à la radio", "every presidential election since, with the announcement on film or radio")}</span></a>
        </nav>
      </section>

      <div id="mine"></div>

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
                  return `<li><a href="#/fil"><b>${esc(s.items[0].title)}</b></a><span class="lean-split"><span style="flex:${l || 0.001};background:#d4253a"></span><span style="flex:${r || 0.001};background:#1f5fcf"></span></span><span class="muted small">${l} ${L("réactions à gauche", "left-leaning reactions")}, ${r} ${L("à droite", "right-leaning")}</span></li>`;
                })
                .join("")}</ul>
            </section>`
          : ""
      }

      ${
        shifts
          ? `<section class="card arrows-card">
              <header class="card-head"><h2>${L("De 2022 à 2024, presque toute la France a basculé à droite", "From 2022 to 2024, almost all of France moved right")}</h2><a href="#/resultats/bascules">${L("Toutes les élections depuis 1848", "Every election since 1848")}</a></header>
              <p class="muted small">${L("Une flèche par circonscription, premier tour des législatives. Écart entre la droite (droite et extrême droite) et la gauche (gauche et écologistes).", "One arrow per district, legislative first round. Margin between the right (right and far right) and the left (left and greens).")}</p>
              <div class="shift-legend" id="home-legend"></div>
              <div class="reveal"><svg id="home-arrows" viewBox="0 0 800 780" class="home-arrows" role="img" aria-label="${L("Carte des bascules 2022–2024", "Shift map 2022–2024")}"></svg></div>
            </section>`
          : ""
      }

      <section class="charter">
        <blockquote>${L("« La société a le droit de demander compte à tout agent public de son administration. »", "“Society has the right to ask every public official to account for their administration.”")}</blockquote>
        <p>${L("Déclaration des droits de l’homme et du citoyen, article 15, 1789. Third Estate s’efforce de rendre ce droit praticable : des données publiques, une méthode ouverte, pour chacun.", "Declaration of the Rights of Man and of the Citizen, article 15, 1789. Third Estate tries to make that right practical: public data and an open method, for everyone.")}</p>
      </section>
    </section>`;
  bindSearch(app);
  viz.start(app);
  if (home?.code) drawMine(app.querySelector<HTMLElement>("#mine")!, home.code, home.commune ?? home.code);
  countUp(app.querySelector<HTMLElement>(".hero-x-doors")!);

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
          return `<a href="#/circo/${c}"><path class="district" d="${path(cf)}" fill="${safeColor(d?.groupe?.couleur) ?? "#ccc"}" data-tip="${esc(`${L("Circonscription", "District")} ${Number(c.slice(-2))}\n${d ? `${d.prenom} ${d.nom} (${d.groupe?.abrev ?? ""})` : ""}`)}"/><text x="${pc[0]}" y="${pc[1]}" class="district-num" style="font-size:${(side / 40).toFixed(1)}px">${Number(c.slice(-2))}</text></a>`;
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
             <ul class="circo-list">${mps.map((d) => `<li><a href="#/circo/${d.circo}"><span class="num-badge">${d.numCirco}</span><span><b>${esc(d.prenom)} ${esc(d.nom)}</b> <span class="chip" style="--c:${safeColor(d.groupe?.couleur) ?? "#999"}">${esc(d.groupe?.abrev ?? "")}</span></span></a></li>`).join("")}</ul>`
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
    const svgA = app.querySelector<SVGSVGElement>("#home-arrows")!;
    const k = unitsPerPx(svgA, 800);
    svgA.style.setProperty("--sw", `${(1.7 * k).toFixed(2)}px`);
    svgA.innerHTML = outlines.join("") + arrowPaths(pair, "lr", (p) => projA(p) as [number, number] | null, { k });
    app.querySelector("#home-legend")!.innerHTML = legend("lr", 2.2 / k);
    svgA.addEventListener("click", (e) => { const href = (e.target as Element).closest<SVGGElement>(".arrow")?.dataset.href; if (href) location.hash = href; });
  }

  // draw-in when scrolled into view
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.25 });
  app.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/** The reader's own town, first thing under the hero: the four-sentence brief, their MPs, shortcuts into the town page. */
async function drawMine(box: HTMLElement, code: string, name: string) {
  box.innerHTML = `<section class="card mine"><header class="card-head"><h2>${L("Chez vous", "Where you live")} : ${esc(name)}</h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header><p class="muted small">${L("Chargement…", "Loading…")}</p></section>`;
  try {
    const b = await townBrief(code, name);
    box.innerHTML = `<section class="card mine">
      <header class="card-head"><h2>${L("Chez vous", "Where you live")} : <a href="#/ville/${code}">${esc(name)}</a></h2><a href="#/ville/${code}">${L("Toute la commune", "The whole town")}</a></header>
      <div class="mine-grid">
        <div class="brief-text">${b.sentences.length ? `<p>${b.sentences.join(" ")}</p>` : `<p class="muted">${L("Pas assez de données publiées pour résumer cette commune.", "Not enough published data to sum up this town.")}</p>`}</div>
        <aside>
          ${b.mps.length ? `<p class="mine-k">${L(b.mps.length > 1 ? "Vos députés" : "Votre député", b.mps.length > 1 ? "Your MPs" : "Your MP")}</p>${b.mps.slice(0, 3).map((x) => mpChip(x.mp)).join("")}` : ""}
          <nav class="jump">${[["securite", "Sécurité", "Safety"], ["chiffres", "Chiffres", "Figures"], ["ecoles", "Écoles", "Schools"], ["town-quartiers", "Quartiers", "Neighbourhoods"]].map(([id, f, e]) => `<a href="#/ville/${code}#${id}">${L(f, e)}</a>`).join("")}${b.vote ? `<a href="#/circo/${b.vote.circo}">${L("Votre circonscription", "Your district")}</a>` : ""}</nav>
        </aside>
      </div>
    </section>`;
  } catch {
    box.innerHTML = "";
  }
}

export const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
