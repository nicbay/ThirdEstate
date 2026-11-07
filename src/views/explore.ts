// "My neighbourhood": search any address or town, explore a department as a list + map
// (Homes.com-style split view), and open a town page with its elected officials, how its MP
// votes, local figures and what's good about the place.
// Sources: national address base (Géoplateforme geocoding), geo.api.gouv.fr town outlines,
// district profiles (crime, income, jobs, schools, spending, events) and, when built,
// per-town files from scripts/sync-communes.mjs (councillors, monuments, prices, photos).
import { geoMercator, geoPath } from "d3-geo";
import { fetchJson, loadDeputes, type Depute } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { rewind } from "../lib/map";
import { esc, safeUrl, safeColor } from "../util";
import { PLATFORMS, age, presence } from "./assemblee";
import { photoUrl } from "./deputes";
import { renderTownLocal } from "./town-local";
import { renderQuartiers } from "./quartiers";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ---------- data helpers ----------
interface TownData {
  code: string;
  name: string;
  pop: number;
  districts: { code: string; share: number }[];
  unemployment?: number;
  income?: number;
  poverty?: number;
  crime?: Record<string, [number, number]>;
  spending?: number[];
  schools: Any[];
  events: Any[];
}
const depCache = new Map<string, Promise<{ towns: Map<string, TownData>; profiles: Map<string, Any> }>>();

/** Every town of a department, assembled from the district profiles that cover it. */
function loadDepartmentTowns(dep: string) {
  if (!depCache.has(dep)) {
    depCache.set(
      dep,
      (async () => {
        const deputes = await loadDeputes();
        const codes = [...new Set(deputes.filter((d) => d.numDepartement === dep && d.circo).map((d) => d.circo!))];
        const profiles = new Map<string, Any>();
        await Promise.all(codes.map(async (c) => { try { profiles.set(c, await fetchJson(`/data/districts/${c}.json`)); } catch { /* none */ } }));
        const events = new Map<string, Any[]>();
        await Promise.all(codes.map(async (c) => { try { events.set(c, (await fetchJson<Any>(`/data/districts/events/${c}.json`)).events ?? []); } catch { /* none */ } }));
        const towns = new Map<string, TownData>();
        for (const [c, p] of profiles) {
          const I = p.indicators ?? {};
          for (const u of p.geography?.units ?? []) {
            const t: TownData = towns.get(u.code) ?? { code: u.code, name: u.name, pop: u.pop ?? 0, districts: [], schools: [], events: [] };
            t.districts.push({ code: c, share: u.share });
            t.unemployment ??= I.unemploymentCensus?.communes?.[u.code];
            const inc = I.income?.communes?.[u.code];
            if (inc) { t.income ??= inc[0]; t.poverty ??= inc[1]; }
            t.crime ??= I.crime?.communes?.[u.code];
            t.spending ??= I.localSpending?.communes?.values?.[u.code];
            for (const s of I.schools?.list ?? []) if (s.commune === u.code && !t.schools.some((x: Any) => x.uai === s.uai)) t.schools.push(s);
            for (const e of events.get(c) ?? []) if ((e.commune === u.name || e.postcode?.startsWith(dep)) && e.commune === u.name && !t.events.some((x: Any) => x.name === e.name)) t.events.push(e);
            towns.set(u.code, t);
          }
        }
        return { towns, profiles };
      })(),
    );
  }
  return depCache.get(dep)!;
}
let natP: Promise<Any> | null = null;
const loadNational = () => (natP ??= fetchJson<Any>("/data/districts/index.json"));
/** Optional per-town file from scripts/sync-communes.mjs (councillors, monuments, prices, photo). */
const bundleCache = new Map<string, Promise<Any>>();
/** All town files of a department (scripts/sync-communes.mjs + scripts/bundle-communes.mjs). */
export const loadTownBundle = (dep: string) => {
  if (!bundleCache.has(dep)) bundleCache.set(dep, fetchJson<Any>(`/data/communes-dep/${dep}.json`).then((b) => b.communes ?? {}).catch(() => ({})));
  return bundleCache.get(dep)!;
};
/** Map a town file onto the shape the town page renders. */
export function townExtra(d: Any) {
  if (!d) return null;
  const ok = (x: Any) => x && x.status === "ok";
  const img = d.media?.image, wiki = d.media?.wikipedia, el = d.elected ?? {}, as = d.assets ?? {};
  return {
    photo: ok(img) ? { url: img.thumb, author: img.author, licence: img.licence, page: img.page } : null,
    description: ok(wiki) ? { text: String(wiki.extract ?? "").split(/(?<=\.)\s/).slice(0, 2).join(" "), url: wiki.url } : null,
    officials: {
      mayor: ok(el.mayor) ? { name: titleCase(el.mayor.name), since: el.mayor.since } : null,
      councillors: ok(el.council) ? { count: el.council.count } : null,
      departmental: ok(el.departmental) ? el.departmental.cantons?.flatMap((c: Any) => c.councillors.map((x: Any) => titleCase(x.name))) : null,
      senators: ok(el.senators) ? el.senators.list.map((x: Any) => ({ name: titleCase(x.name) })) : [],
    },
    assets: {
      monuments: ok(as.monuments) ? { count: as.monuments.count, names: as.monuments.list?.filter((m: Any) => m.level === "classé").map((m: Any) => m.name) ?? [] } : null,
      museums: ok(as.museums) ? { count: as.museums.count, names: as.museums.list?.map((m: Any) => m.name) ?? [] } : null,
      sports: ok(as.sports) ? { count: as.sports.count } : null,
      libraries: ok(as.libraries) ? { count: as.libraries.count } : null,
    },
    prices: ok(d.property) ? { year: d.property.year, apartment: d.property.apartment?.medianPerM2 ? { median: d.property.apartment.medianPerM2, sales: d.property.apartment.sales } : null, house: d.property.house?.medianPerM2 ? { median: d.property.house.medianPerM2, sales: d.property.house.sales } : null } : null,
    health: ok(d.health?.gpAccess) ? { apl: d.health.gpAccess.value, national: d.health.gpAccess.national } : null,
    broadband: ok(d.broadband?.ftth) ? { fibre: d.broadband.ftth.share } : null,
  };
}
const titleCase = (n: string) => String(n ?? "").replace(/\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'-]+)\b/g, (w) => (w.length > 1 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w));
const loadTownExtra = async (code: string) => townExtra((await loadTownBundle(depOf(code)))[code]);
const depOf = (code: string) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));

// ---------- search (address, street or town) ----------
export function searchBox(placeholder?: string) {
  return `<form class="town-search" role="search" autocomplete="off">
    <input type="search" name="q" placeholder="${esc(placeholder ?? L("Une adresse, une ville, un code postal", "An address, a town, a postcode"))}" aria-label="${L("Rechercher", "Search")}"/>
    <ul class="suggest" role="listbox" hidden></ul>
  </form>`;
}
export function bindSearch(root: HTMLElement) {
  root.querySelectorAll<HTMLFormElement>(".town-search").forEach((form) => {
    const input = form.querySelector("input")!;
    const list = form.querySelector<HTMLUListElement>(".suggest")!;
    let timer = 0, seq = 0;
    const go = (code: string) => { list.hidden = true; location.hash = `#/ville/${code}`; };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { list.hidden = true; return; }
      timer = window.setTimeout(async () => {
        const my = ++seq;
        try {
          const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
          const j = await r.json();
          if (my !== seq) return;
          const items = (j.features ?? []) as Any[];
          list.innerHTML = items.map((f, i) => `<li role="option" data-code="${esc(f.properties.citycode)}" data-i="${i}"><b>${esc(f.properties.label)}</b><span class="muted small">${esc(f.properties.context ?? "")}</span></li>`).join("");
          list.hidden = !items.length;
          list.querySelectorAll<HTMLLIElement>("li").forEach((li) => li.addEventListener("mousedown", (e) => { e.preventDefault(); go(li.dataset.code!); }));
        } catch { list.hidden = true; }
      }, 220);
    });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
    form.addEventListener("submit", (e) => { e.preventDefault(); const first = list.querySelector<HTMLLIElement>("li"); if (first) go(first.dataset.code!); });
  });
}

// ---------- explorer: list + map for one department ----------
type Metric = "income" | "unemployment" | "poverty" | "burglary" | "pop";
const METRICS: Record<Metric, { fr: string; en: string; unit: string; get: (t: TownData) => number | undefined; better: "high" | "low" | null }> = {
  income: { fr: "Niveau de vie médian", en: "Median standard of living", unit: "€", get: (t) => t.income, better: "high" },
  unemployment: { fr: "Chômage", en: "Unemployment", unit: "%", get: (t) => t.unemployment, better: "low" },
  poverty: { fr: "Taux de pauvreté", en: "Poverty rate", unit: "%", get: (t) => t.poverty, better: "low" },
  burglary: { fr: "Cambriolages", en: "Burglaries", unit: "‰", get: (t) => t.crime?.burglary?.[1], better: "low" },
  pop: { fr: "Population", en: "Population", unit: "", get: (t) => t.pop, better: null },
};
const ui = { metric: "income" as Metric, sort: "pop" as Metric | "name" };

export async function renderExplorer(app: HTMLElement, dep?: string) {
  const deputes = await loadDeputes();
  const deps = [...new Map(deputes.filter((d) => d.numDepartement && d.numDepartement !== "99").map((d) => [d.numDepartement!, d.departement!])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  dep ??= (() => { try { return JSON.parse(localStorage.getItem("pv-home") ?? "null")?.dep; } catch { return null; } })() ?? "75";
  const depName = deps.find(([c]) => c === dep)?.[1] ?? dep;

  app.innerHTML = `
    <section class="page explorer">
      <header class="page-head">
        <p class="eyebrow">${L("Ma commune", "My town")}</p>
        <h1>${L("Ce qui se passe près de chez vous", "What’s happening where you live")}</h1>
        <p class="dek">${L("Vos élus et leurs votes, la vie locale, l’emploi, les écoles, la sécurité, et ce qui fait le charme du coin. Cherchez une adresse ou parcourez un département.", "Your elected officials and how they vote, local life, jobs, schools, safety, and what makes the place good. Search an address or browse a department.")}</p>
        ${searchBox()}
      </header>
      <div class="explore-bar">
        <select id="dep" aria-label="${L("Département", "Department")}">${deps.map(([c, n]) => `<option value="${c}" ${c === dep ? "selected" : ""}>${c} ${esc(n)}</option>`).join("")}</select>
        <label class="small">${L("Couleur", "Colour")} <select id="metric">${(Object.keys(METRICS) as Metric[]).map((k) => `<option value="${k}" ${k === ui.metric ? "selected" : ""}>${L(METRICS[k].fr, METRICS[k].en)}</option>`).join("")}</select></label>
        <label class="small">${L("Trier par", "Sort by")} <select id="sort"><option value="pop">${L("Population", "Population")}</option><option value="income">${L("Niveau de vie", "Standard of living")}</option><option value="unemployment">${L("Chômage", "Unemployment")}</option><option value="name">${L("Nom", "Name")}</option></select></label>
        <span id="count" class="muted small"></span>
      </div>
      <div class="split">
        <ol class="town-list" id="towns"><li class="muted">${L("Chargement de", "Loading")} ${esc(depName)}…</li></ol>
        <div class="split-map"><svg id="dep-map" viewBox="0 0 600 600" role="img" aria-label="${esc(depName)}"></svg><div class="legend-scale" id="legend"></div></div>
      </div>
      <p class="source">${L("Contours : geo.api.gouv.fr. Recherche : Base adresse nationale (Géoplateforme). Chiffres : INSEE, SSMSI, Éducation nationale, OFGL.", "Outlines: geo.api.gouv.fr. Search: National address base (Géoplateforme). Figures: INSEE, SSMSI, Ministry of Education, OFGL.")}</p>
    </section>`;
  bindSearch(app);
  app.querySelector<HTMLSelectElement>("#dep")!.addEventListener("change", (e) => (location.hash = `#/explorer/${(e.target as HTMLSelectElement).value}`));

  const depCode: string = dep ?? "75";
  const [{ towns }, geo, bundle] = await Promise.all([
    loadDepartmentTowns(depCode),
    fetchJson<GeoJSON.FeatureCollection>(`https://geo.api.gouv.fr/communes?codeDepartement=${dep}&type=commune-actuelle,arrondissement-municipal&format=geojson&geometry=contour&fields=nom,code,population`),
    loadTownBundle(depCode),
  ]);
  // Paris, Lyon and Marseille: draw their arrondissements, not the city-wide outline on top of them.
  const CITIES_WITH_ARR = new Set(["75056", "69123", "13055"]);
  const features = geo.features.filter((f) => !CITIES_WITH_ARR.has(f.properties!.code)).map(rewind);
  const proj = geoMercator().fitExtent([[6, 6], [594, 594]], { type: "FeatureCollection", features } as GeoJSON.FeatureCollection);
  const path = geoPath(proj);
  const byDistrict = new Map(deputes.filter((d) => d.circo).map((d) => [d.circo!, d]));

  const draw = () => {
    const m = METRICS[ui.metric];
    const vals = [...towns.values()].map(m.get).filter((v): v is number => v != null).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const breaks = [0.2, 0.4, 0.6, 0.8].map(q);
    const ramp = ["#f1eef6", "#cfc4e0", "#a996c9", "#7d68ad", "#4f3f86"];
    const colour = (v?: number) => (v == null ? "var(--wash)" : ramp[breaks.filter((b) => v > b).length]);
    app.querySelector("#dep-map")!.innerHTML = features
      .map((f) => {
        const t = towns.get(f.properties!.code);
        const v = t ? m.get(t) : undefined;
        return `<path class="area town" data-code="${f.properties!.code}" d="${path(f)}" fill="${colour(v)}" data-tip="${esc(`${f.properties!.nom}\n${L(m.fr, m.en)} : ${v != null ? `${fmt(v)} ${m.unit}` : "–"}`)}"/>`;
      })
      .join("");
    app.querySelector("#legend")!.innerHTML = `<span>${L(m.fr, m.en)}</span>${ramp.map((c, i) => `<i style="background:${c}" title="${i ? `> ${fmt(breaks[i - 1])}` : `≤ ${fmt(breaks[0])}`}"></i>`).join("")}<span class="muted">${vals.length ? `${fmt(vals[0])} – ${fmt(vals[vals.length - 1])} ${m.unit}` : ""}</span>`;
    const sorter = ui.sort === "name" ? (a: TownData, b: TownData) => a.name.localeCompare(b.name, "fr") : (a: TownData, b: TownData) => (METRICS[ui.sort as Metric].get(b) ?? -1) - (METRICS[ui.sort as Metric].get(a) ?? -1);
    const list = [...towns.values()].sort(sorter);
    app.querySelector("#count")!.textContent = `${list.length} ${L("communes", "towns")}`;
    app.querySelector("#towns")!.innerHTML = list
      .slice(0, 150)
      .map((t) => {
        const mp = byDistrict.get(t.districts[0]?.code);
        const ex = townExtra(bundle[t.code]);
        return `<li><a href="#/ville/${t.code}" class="town-card${ex?.photo ? " has-photo" : ""}" data-code="${t.code}">
          ${ex?.photo ? `<img class="tc-photo" src="${esc(safeUrl(ex.photo.url))}" alt="" loading="lazy"/>` : ""}
          <span class="tc-head"><b>${esc(t.name)}</b><span class="muted small">${fmtNum(t.pop)} ${L("hab.", "people")}</span></span>
          <span class="tc-stats small">${t.income ? `<span><i>${L("Niveau de vie", "Living standard")}</i>${fmtNum(t.income)} €</span>` : ""}${t.unemployment != null ? `<span><i>${L("Chômage", "Unemployment")}</i>${fmt(t.unemployment)} %</span>` : ""}${t.schools.length ? `<span><i>${L("Écoles", "Schools")}</i>${t.schools.length}</span>` : ""}${t.events.length ? `<span><i>${L("Événements", "Events")}</i>${t.events.length}</span>` : ""}</span>
          ${mp ? `<span class="small muted">${L("Député·e", "MP")} : ${esc(mp.prenom)} ${esc(mp.nom)} <span class="chip" style="--c:${safeColor(mp.groupe?.couleur) ?? "#999"}">${esc(mp.groupe?.abrev ?? "")}</span></span>` : ""}
        </a></li>`;
      })
      .join("") + (list.length > 150 ? `<li class="muted small">${L("Les 150 premières ; cherchez une commune pour les autres.", "First 150 shown; search for others.")}</li>` : "");
    // hover sync list ↔ map
    const hl = (code: string, on: boolean) => app.querySelector(`#dep-map [data-code="${code}"]`)?.classList.toggle("hl", on);
    app.querySelectorAll<HTMLElement>(".town-card").forEach((a) => { a.addEventListener("mouseenter", () => hl(a.dataset.code!, true)); a.addEventListener("mouseleave", () => hl(a.dataset.code!, false)); });
    app.querySelectorAll<SVGPathElement>("#dep-map .town").forEach((p) => p.addEventListener("click", () => (location.hash = `#/ville/${p.dataset.code}`)));
  };
  app.querySelector<HTMLSelectElement>("#metric")!.addEventListener("change", (e) => { ui.metric = (e.target as HTMLSelectElement).value as Metric; draw(); });
  app.querySelector<HTMLSelectElement>("#sort")!.addEventListener("change", (e) => { ui.sort = (e.target as HTMLSelectElement).value as Metric; draw(); });
  draw();
}
const fmt = (n: number) => (Math.abs(n) >= 1000 ? fmtNum(Math.round(n)) : n.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 }));

// ---------- town page ----------
const CRIME_LABELS: Record<string, [string, string]> = {
  burglary: ["Cambriolages de logement", "Home burglaries"], theftFromPersons: ["Vols sans violence contre des personnes", "Non-violent theft from persons"],
  physicalViolenceOther: ["Violences physiques hors famille", "Physical violence outside the family"], physicalViolenceFamily: ["Violences intrafamiliales", "Domestic violence"],
  vehicleTheft: ["Vols de véhicules", "Vehicle theft"], criminalDamage: ["Destructions et dégradations", "Criminal damage"], drugTrafficking: ["Trafic de stupéfiants", "Drug trafficking"], fraud: ["Escroqueries", "Fraud"],
};

export async function renderTown(app: HTMLElement, code: string) {
  const dep = depOf(code);
  const [{ towns }, deputes, nat, extra, info] = await Promise.all([
    loadDepartmentTowns(dep),
    loadDeputes(),
    loadNational(),
    loadTownExtra(code),
    fetchJson<Any>(`https://geo.api.gouv.fr/communes/${code}?fields=nom,code,codesPostaux,population,departement,region,surface,centre`).catch(() => null),
  ]);
  const t = towns.get(code);
  const name = info?.nom ?? t?.name ?? code;
  const mps = (t?.districts ?? []).map((d) => ({ d, mp: deputes.find((x) => x.circo === d.code) })).filter((x) => x.mp) as { d: { code: string; share: number }; mp: Depute }[];
  const fr = getLang() === "fr";
  const natCrime = nat?.national?.crime?.rates ?? {};
  const cmpPct = (v: number, ref: number | undefined, higherIsWorse = true) => {
    if (ref == null || !ref) return "";
    const d = ((v - ref) / ref) * 100;
    if (Math.abs(d) < 10) return `<span class="cmp">${L("proche de la moyenne nationale", "close to the national average")}</span>`;
    const good = higherIsWorse ? d < 0 : d > 0;
    return `<span class="cmp ${good ? "cmp-better" : "cmp-worse"}">${d > 0 ? "+" : ""}${Math.round(d)} % ${L("vs France", "vs France")}</span>`;
  };
  const photo = extra?.photo;
  const positives: string[] = [];
  if (extra?.assets) {
    const a = extra.assets;
    if (a.monuments?.count) positives.push(`<li><b>${a.monuments.count}</b> ${L("monuments historiques", "historic monuments")}${a.monuments.names?.length ? ` : ${a.monuments.names.slice(0, 4).map(esc).join(", ")}` : ""}</li>`);
    if (a.museums?.count) positives.push(`<li><b>${a.museums.count}</b> ${L("musées de France", "museums")}${a.museums.names?.length ? ` : ${a.museums.names.slice(0, 3).map(esc).join(", ")}` : ""}</li>`);
    if (a.sports?.count) positives.push(`<li><b>${a.sports.count}</b> ${L("équipements sportifs", "sports facilities")}</li>`);
    if (a.libraries?.count) positives.push(`<li><b>${a.libraries.count}</b> ${L("bibliothèques", "libraries")}</li>`);
  }
  if (t?.schools.length) positives.push(`<li><b>${t.schools.length}</b> ${L("collèges et lycées", "secondary schools")}</li>`);
  if (t?.events.length) positives.push(`<li><b>${t.events.length}</b> ${L("événements à venir", "upcoming events")}</li>`);

  app.innerHTML = `
    <section class="page town">
      <p class="crumbs"><a href="#/explorer/${dep}">${esc(info?.departement?.nom ?? dep)}</a></p>
      <header class="town-hero ${photo ? "has-photo" : ""}">
        ${photo ? `<figure><img src="${esc(safeUrl(photo.url))}" alt="${esc(name)}" loading="eager"/><figcaption class="tiny">${esc(photo.author ?? "")} ${photo.licence ? `(${esc(photo.licence)})` : ""}, Wikimedia Commons</figcaption></figure>` : ""}
        <div>
          <p class="eyebrow">${esc(info?.departement?.nom ?? "")}${info?.region?.nom ? `, ${esc(info.region.nom)}` : ""}</p>
          <h1>${esc(name)}</h1>
          <p class="dek">${info?.population ? `${fmtNum(info.population)} ${L("habitants", "inhabitants")}` : ""}${info?.codesPostaux?.length ? `, ${info.codesPostaux.slice(0, 3).join(", ")}` : ""}.${extra?.description?.text ? ` ${esc(extra.description.text)}` : ""}</p>
          ${extra?.description?.url ? `<p class="tiny muted">${L("Extrait de", "From")} <a href="${esc(safeUrl(extra.description.url))}" target="_blank" rel="noopener">Wikipédia</a> (CC BY-SA)</p>` : ""}
          ${searchBox(L("Chercher une autre adresse", "Search another address"))}
        </div>
      </header>

      <section class="card">
        <header class="card-head"><h2>${L("Vos élus", "Your elected officials")}</h2></header>
        <div class="grid-2">
          <div>${mps.map(({ d, mp }) => `<a class="mp-mini" href="#/depute/${mp.id}" style="--c:${safeColor(mp.groupe?.couleur) ?? "#999"}"><img src="${photoUrl(mp.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/><span><span class="muted small">${L("Député·e", "MP")}, ${esc(mp.departement ?? "")} ${d.code.slice(-2)}${d.share < 1 ? ` (${L("partie de la commune", "part of the town")})` : ""}</span><br><b>${esc(mp.prenom)} ${esc(mp.nom)}</b> <span class="chip">${esc(mp.groupe?.abrev ?? "")}</span><br><span class="small muted">${age(mp) ?? "?"} ${L("ans", "years old")}, ${L("participation aux votes", "votes attended")} ${Math.round(100 * mp.stats.participation)} %, ${L("présence en ligne", "online presence")} ${presence(mp)}/${PLATFORMS.length}</span></span></a>`).join("") || `<p class="muted">${L("Député non trouvé pour cette commune.", "No MP found for this town.")}</p>`}</div>
          <div>${
            extra?.officials
              ? `<ul class="officials">${extra.officials.mayor ? `<li><span class="muted small">${L("Maire", "Mayor")}${extra.officials.mayor.since ? `, ${L("depuis le", "since")} ${fmtDate(extra.officials.mayor.since)}` : ""}</span><br><b>${esc(extra.officials.mayor.name)}</b></li>` : ""}${extra.officials.councillors ? `<li><span class="muted small">${L("Conseil municipal", "Town council")}</span><br><b>${extra.officials.councillors.count}</b> ${L("élus", "councillors")}</li>` : ""}${extra.officials.departmental?.length ? `<li><span class="muted small">${L("Conseillers départementaux", "Departmental councillors")}</span><br>${extra.officials.departmental.slice(0, 6).map((n: string) => esc(n)).join(", ")}</li>` : ""}</ul><p class="muted tiny">${L("Répertoire national des élus (ministère de l’Intérieur).", "National register of elected officials (Ministry of the Interior).")}</p>`
              : `<p class="muted small">${L("Maire, conseil municipal et sénateurs : bientôt, depuis le Répertoire national des élus.", "Mayor, town council and senators: coming soon, from the national register of elected officials.")}</p>`
          }</div>
        </div>
      </section>

      ${
        t
          ? `<section class="card">
              <header class="card-head"><h2>${L("La commune en chiffres", "The town in figures")}</h2></header>
              <div class="local-kpis">
                ${t.income ? `<div class="lk"><span class="muted small">${L("Niveau de vie médian", "Median standard of living")}</span><strong>${fmtNum(t.income)} €</strong><span class="small">${cmpPct(t.income, nat?.indicators?.["income.median"]?.median, false)}</span></div>` : ""}
                ${t.poverty != null ? `<div class="lk"><span class="muted small">${L("Taux de pauvreté", "Poverty rate")}</span><strong>${fmt(t.poverty)} %</strong><span class="small">${cmpPct(t.poverty, nat?.indicators?.["income.poverty"]?.median)}</span></div>` : ""}
                ${t.unemployment != null ? `<div class="lk"><span class="muted small">${L("Chômage (recensement)", "Unemployment (census)")}</span><strong>${fmt(t.unemployment)} %</strong><span class="small">${cmpPct(t.unemployment, nat?.national?.unemploymentCensus?.france)}</span></div>` : ""}
                ${t.spending ? `<div class="lk"><span class="muted small">${L("Dépense de la commune", "Town spending")}</span><strong>${fmtNum(t.spending[0])} €</strong><span class="muted tiny">${L("par habitant", "per inhabitant")}</span></div>` : ""}
                ${extra?.prices?.apartment?.median ? `<div class="lk"><span class="muted small">${L("Prix au m², appartements", "Price per m², flats")}</span><strong>${fmtNum(extra.prices.apartment.median)} €</strong><span class="muted tiny">DVF ${esc(String(extra.prices.year ?? ""))}</span></div>` : ""}
                ${extra?.prices?.house?.median ? `<div class="lk"><span class="muted small">${L("Prix au m², maisons", "Price per m², houses")}</span><strong>${fmtNum(extra.prices.house.median)} €</strong><span class="muted tiny">DVF ${esc(String(extra.prices.year ?? ""))}</span></div>` : ""}
                ${extra?.health?.apl != null ? `<div class="lk"><span class="muted small">${L("Accès aux médecins généralistes", "Access to GPs")}</span><strong>${fmt(extra.health.apl)}</strong><span class="muted tiny">${L("consultations / an / habitant (APL)", "consultations / year / person (APL)")}</span></div>` : ""}
                ${extra?.broadband?.fibre != null ? `<div class="lk"><span class="muted small">${L("Locaux raccordables à la fibre", "Premises with fibre")}</span><strong>${fmt(extra.broadband.fibre)} %</strong><span class="muted tiny">ARCEP</span></div>` : ""}
              </div>
            </section>`
          : ""
      }

      <div class="grid-2">
        <section class="card">
          <header class="card-head"><h2>${L("Ce qui fait vivre la commune", "What makes the town tick")}</h2></header>
          ${positives.length ? `<ul class="positives">${positives.join("")}</ul>` : `<p class="muted small">${L("Monuments, musées et équipements : bientôt.", "Monuments, museums and facilities: coming soon.")}</p>`}
          ${t?.events.length ? `<h3>${L("À venir", "Coming up")}</h3><ul class="events">${t.events.slice(0, 6).map((e: Any) => `<li><span class="muted small">${fmtDate(e.start)}</span><br><a href="${esc(safeUrl(e.url ?? e.datatourisme))}" target="_blank" rel="noopener">${esc(e.name)}</a></li>`).join("")}</ul>` : ""}
        </section>
        <section class="card">
          <header class="card-head"><h2>${L("Sécurité", "Safety")}</h2><span class="muted small">${L("faits pour 1 000 habitants", "per 1,000 people")}</span></header>
          ${
            t?.crime
              ? `<table class="table"><tbody>${Object.entries(CRIME_LABELS)
                  .filter(([k]) => t.crime![k])
                  .map(([k, [lf, le]]) => `<tr><td>${fr ? lf : le}</td><td class="num"><b>${fmt(t.crime![k][1])}</b></td><td class="num small">${cmpPct(t.crime![k][1], natCrime[k])}</td></tr>`)
                  .join("")}</tbody></table><p class="muted tiny">${L("Faits enregistrés par la police et la gendarmerie (SSMSI). Cambriolages : pour 1 000 logements.", "Offences recorded by police and gendarmerie (SSMSI). Burglary: per 1,000 dwellings.")}</p>`
              : `<p class="muted small">${L("Pas de chiffres publiés pour cette commune : le ministère ne publie pas les communes où les faits sont très peu nombreux.", "No figures published for this town: the ministry doesn’t publish towns with very few offences.")}</p>`
          }
        </section>
      </div>

      ${
        t?.schools.length
          ? `<section class="card"><header class="card-head"><h2>${L("Collèges et lycées", "Secondary schools")}</h2></header>
              <table class="table"><thead><tr><th>${L("Établissement", "School")}</th><th class="num">IPS</th><th class="num">${L("Réussite", "Pass rate")}</th><th class="num">VA</th></tr></thead><tbody>${t.schools
                .map((s: Any) => { const r = s.dnb ?? s.bacGT ?? s.bacPro; return `<tr><td>${esc(s.name)}<br><span class="muted tiny">${s.type === "college" ? L("collège", "collège") : L("lycée", "lycée")}, ${s.sector === "private" ? L("privé", "private") : L("public", "public")}</span></td><td class="num">${s.ips?.value ?? "–"}</td><td class="num">${r?.successRate != null ? `${r.successRate} %` : "–"}</td><td class="num">${r?.successVA != null ? `${r.successVA > 0 ? "+" : ""}${r.successVA}` : "–"}</td></tr>`; })
                .join("")}</tbody></table>
              <p class="muted tiny">${L("IPS : indice de position sociale (100 = moyenne nationale). VA : valeur ajoutée de l’établissement.", "IPS: social position index (100 = national average). VA: the school’s value added.")}</p></section>`
          : ""
      }

      <div id="town-quartiers"></div>
      <div id="town-local" class="stack-col"></div>
      <nav class="doors">${mps.map(({ d }) => `<a class="door" href="#/circo/${d.code}"><b>${L("Toute la circonscription", "The whole district")} ${d.code.slice(-2)}</b><span class="muted small">${L("Résultats électoraux, député, chiffres détaillés", "Election results, MP, detailed figures")}</span></a>`).join("")}<a class="door" href="#/explorer/${dep}"><b>${L("Les autres communes du département", "Other towns in the department")}</b><span class="muted small">${L("Liste et carte", "List and map")}</span></a></nav>
    </section>`;
  bindSearch(app);
  renderTownLocal(app.querySelector<HTMLElement>("#town-local")!, code, dep);
  renderQuartiers(app.querySelector<HTMLElement>("#town-quartiers")!, code);
}
