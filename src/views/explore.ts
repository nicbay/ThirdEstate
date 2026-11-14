// "My neighbourhood": search any address or town, explore a department as a list + map
// (Homes.com-style split view), and open a town page with its elected officials, how its MP
// votes, local figures and what's good about the place.
// Sources: national address base (Géoplateforme geocoding), geo.api.gouv.fr town outlines,
// district profiles (crime, income, jobs, schools, spending, events) and, when built,
// per-town files from scripts/sync-communes.mjs (councillors, monuments, prices, photos).
import { geoMercator, geoPath } from "d3-geo";
import { toast } from "../lib/toast";
import { detailSheet } from "../lib/sheet";
import { fetchJson, loadDeputes, type Depute } from "../data";
import { getHome, setHome } from "../lib/cloud";
import { L, colon, fmtDate, fmtNum, getLang, plural } from "../i18n";
import { rewind } from "../lib/map";
import { esc, safeUrl, safeColor } from "../util";
import { PLATFORMS, age, presence } from "./assemblee";
import { photoUrl } from "./deputes";
import { renderTownLocal } from "./town-local";
import { renderTownPolice } from "./town-police";
import { renderTownState } from "./town-state";
import { renderQuartiers } from "./quartiers";
import { mpChip, townBrief } from "./brief";
import { armsSlot, loadCommuneArms, loadDepartmentArms, paintArms } from "../lib/arms";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ---------- data helpers ----------
export interface TownData {
  code: string;
  name: string;
  pop: number;
  districts: { code: string; share: number }[];
  unemployment?: number;
  income?: number;
  poverty?: number;
  /** vintage of the figures above (INSEE census / Filosofi year published in the district profiles) */
  years?: { unemployment?: number; income?: number };
  crime?: Record<string, [number, number]>;
  spending?: number[];
  schools: Any[];
  events: Any[];
}
const depCache = new Map<string, Promise<{ towns: Map<string, TownData>; profiles: Map<string, Any> }>>();

/** Every town of a department, assembled from the district profiles that cover it. */
export function loadDepartmentTowns(dep: string) {
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
            t.years ??= { unemployment: I.unemploymentCensus?.year, income: I.income?.year };
            const inc = I.income?.communes?.[u.code];
            if (inc) { t.income ??= inc[0]; t.poverty ??= inc[1]; }
            // Paris, Lyon, Marseille: SSMSI publishes the whole city only, keyed by the city code
            t.crime ??= I.crime?.communes?.[u.code] ?? I.crime?.communes?.[plmCity(u.code)];
            t.spending ??= I.localSpending?.communes?.values?.[u.code];
            for (const s of I.schools?.list ?? []) if (s.commune === u.code && !t.schools.some((x: Any) => x.uai === s.uai)) t.schools.push(s);
            for (const e of upcoming(events.get(c) ?? [])) if ((e.commune === u.name || e.postcode?.startsWith(dep)) && e.commune === u.name && !t.events.some((x: Any) => x.name === e.name)) t.events.push(e);
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
export const loadNational = () => (natP ??= fetchJson<Any>("/data/districts/index.json"));
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
      // Paris, Lyon, Marseille arrondissements: the RNE mayor and council are the whole city's (level "city")
      mayor: ok(el.mayor) ? { name: titleCase(el.mayor.name), since: el.mayor.since, city: el.mayor.level === "city" } : null,
      councillors: ok(el.council) ? { count: el.council.count, city: el.council.level === "city" } : null,
      arrondissement: ok(el.arrondissementCouncil)
        ? {
            count: el.arrondissementCouncil.count,
            sector: /secteur\s*(\d+)/i.exec(el.arrondissementCouncil.sector ?? "")?.[1] ?? null,
            mayor: (() => { const m = el.arrondissementCouncil.list?.find((x: Any) => /^maire d.arrondissement$/i.test(x.role ?? "")); return m ? titleCase(m.name) : null; })(),
          }
        : null,
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
/** Events still to come (ending today or later), soonest first. The tourist-office files keep past ones for weeks. */
export function upcoming<E extends { start: string; end?: string | null }>(events: E[], today = new Date().toISOString().slice(0, 10)): E[] {
  return events.filter((e) => (e.end || e.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
}
/** An event the town hall itself publishes ("Mairie de…", "Ville de…", "Commune de…"). */
export const byTownHall = (e: { publisher?: string | null }) => /\b(mairie|ville de|commune de|h[ôo]tel de ville)\b/i.test(e.publisher ?? "");
/** The event list of a town page or card: date, place, a "Mairie" badge for the town hall's own. */
export function eventItem(e: Any, withPlace = false) {
  const when = `${fmtDate(e.start)}${e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ""}`;
  return `<li><span class="muted small">${when}${withPlace && e.commune ? `, ${esc(e.commune)}` : ""}${byTownHall(e) ? ` <span class="ev-mairie">${L("Mairie", "Town hall")}</span>` : ""}</span><br><a href="${esc(safeUrl(e.url ?? e.datatourisme))}" target="_blank" rel="noopener">${esc(e.name)}</a></li>`;
}

export const depOf = (code: string) => (code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2));

// ---------- search (address, street, town, postcode or INSEE code) ----------
type Place = { code: string; label: string; context: string };
const GEO = "https://geo.api.gouv.fr/communes";
const GEO_FIELDS = "fields=nom,code,population,departement,region";
const GEO_TYPES = "type=commune-actuelle,arrondissement-municipal";
const placeOf = (c: Any, prefix = ""): Place => ({ code: c.code, label: c.nom, context: prefix + [c.departement?.code, c.departement?.nom, c.region?.nom].filter(Boolean).join(", ") });
const getJson = (url: string): Promise<Any> => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
/** Lower case, no accents, punctuation as spaces, ordinals folded: "11ème", "11eme", "11e" → "11e"; "1re" → "1er". */
const normPlace = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(\d{1,2}) ?(eme|e|er|re)\b/g, (_, n) => (n === "1" ? "1er" : `${n}e`)).trim();
const PLM: Record<string, { max: number; code: (n: number) => string }> = {
  paris: { max: 20, code: (n) => `751${String(n).padStart(2, "0")}` },
  lyon: { max: 9, code: (n) => `6938${n}` },
  marseille: { max: 16, code: (n) => `132${String(n).padStart(2, "0")}` },
};
/** "Paris 11e", "paris 11", "Lyon 3ème arrondissement", "11e arrondissement de Paris" → the arrondissement's INSEE code. */
export function arrondissementCode(q: string): string | null {
  const s = normPlace(q).replace(/\b(arrondissement|arrdt|arr|de|du)\b/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(paris|lyon|marseille) (\d{1,2})(?:er|e)?$/.exec(s), r = /^(\d{1,2})(?:er|e)? (paris|lyon|marseille)$/.exec(s);
  const [city, n] = m ? [m[1], Number(m[2])] : r ? [r[2], Number(r[1])] : ["", 0];
  const p = PLM[city];
  return p && n >= 1 && n <= p.max ? p.code(n) : null;
}
/** How well a town name answers the query: exact, prefix, every word a word-prefix (first word first), or not at all. */
function nameScore(q: string, name: string) {
  const a = normPlace(q), b = normPlace(name);
  if (a === b) return 4;
  if (b.startsWith(a)) return 3;
  const qt = a.split(" "), nt = b.split(" ");
  if (qt.every((t) => nt.some((w) => w.startsWith(t)))) return nt[0].startsWith(qt[0]) ? 2 : 1;
  return 0;
}
export async function searchPlaces(q: string): Promise<Place[]> {
  const code = q.trim().toUpperCase();
  if (/^(\d{5}|2[AB]\d{3})$/.test(code)) {
    // a postcode: every town sharing it (some cover 20+), the arrondissement(s) of Paris, Lyon or Marseille first, then
    // the city, then the largest; and the town whose INSEE code it is ("2A004" Ajaccio, "13001" is also Aix-en-Provence)
    const [byPost, byCode] = await Promise.all([/^\d{5}$/.test(code) ? getJson(`${GEO}?codePostal=${code}&${GEO_TYPES}&${GEO_FIELDS}`) : null, getJson(`${GEO}?code=${code}&${GEO_TYPES}&${GEO_FIELDS}`)]);
    const isArr = (c: Any) => plmCity(c.code) !== c.code;
    const post = ((byPost ?? []) as Any[]).sort((a, b) => Number(isArr(b)) - Number(isArr(a)) || (b.population ?? 0) - (a.population ?? 0));
    const exact = ((byCode ?? []) as Any[]).filter((c) => !post.some((p) => p.code === c.code));
    return [...post.map((c) => placeOf(c)), ...exact.map((c) => placeOf(c, `${L("code INSEE", "INSEE code")} ${c.code} · `))];
  }
  // towns by name (arrondissements included, accent-insensitive, re-ranked: exact, prefix, word prefixes; then size),
  // an arrondissement typed as "Paris 11e" first and its city second, then street addresses
  const arr = arrondissementCode(q);
  const [arrInfo, cityInfo, towns, addr] = await Promise.all([
    arr ? getJson(`${GEO}/${arr}?${GEO_FIELDS}`) : null,
    arr ? getJson(`${GEO}/${plmCity(arr)}?${GEO_FIELDS}`) : null,
    getJson(`${GEO}?nom=${encodeURIComponent(q)}&${GEO_TYPES}&${GEO_FIELDS}&boost=population&limit=20`),
    getJson(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`),
  ]);
  const ranked = ((towns ?? []) as Any[])
    .map((c, i) => ({ c, i, s: nameScore(q, c.nom) }))
    .sort((a, b) => b.s - a.s || (a.s ? (b.c.population ?? 0) - (a.c.population ?? 0) : a.i - b.i))
    .map((x) => x.c);
  const first = [arrInfo, cityInfo].filter((c) => c?.code);
  const t = [...first, ...ranked.filter((c) => !first.some((f) => f.code === c.code))].slice(0, 6).map((c) => placeOf(c));
  const a = ((addr?.features ?? []) as Any[])
    .filter((f) => f.properties.type !== "municipality" || !t.some((x) => x.code === f.properties.citycode))
    .map((f) => ({ code: f.properties.citycode, label: f.properties.label, context: f.properties.context ?? "" }));
  return [...t, ...a].slice(0, 9);
}

export function searchBox(placeholder?: string) {
  return `<form class="town-search" role="search" autocomplete="off">
    <input type="search" name="q" placeholder="${esc(placeholder ?? L("Une adresse, une ville, un code postal", "An address, a town, a postcode"))}" aria-label="${L("Rechercher", "Search")}"/>
    <ul class="suggest" role="listbox" hidden></ul>
  </form>`;
}
/** Wire the town search boxes under root. By default a pick opens the town page; onPick overrides that (the comparison page). */
export function bindSearch(root: HTMLElement, onPick?: (code: string) => void) {
  root.querySelectorAll<HTMLFormElement>(".town-search").forEach((form) => {
    const input = form.querySelector("input")!;
    const list = form.querySelector<HTMLUListElement>(".suggest")!;
    let timer = 0, seq = 0;
    const go = (code: string) => {
      list.hidden = true;
      if (onPick) return onPick(code);
      try { sessionStorage.setItem("te-picked", code); } catch { /* private mode */ }
      location.hash = `#/ville/${code}`;
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { list.hidden = true; return; }
      timer = window.setTimeout(async () => {
        const my = ++seq;
        try {
          const items = await searchPlaces(q);
          if (my !== seq) return;
          list.innerHTML = items.map((f, i) => `<li role="option" data-code="${esc(f.code)}" data-i="${i}"><b>${esc(f.label)}</b><span class="muted small">${esc(f.context)}</span></li>`).join("");
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
        <h1>${L("Votre commune, de la mairie à l’Assemblée", "Your town, from the town hall to the Assembly")}</h1>
        <p class="dek">${L("Vos élus et leurs votes, la vie locale, l’emploi, les écoles, la sécurité, et ce qui fait le charme du coin. Cherchez une adresse ou parcourez un département.", "Your elected officials and how they vote, local life, jobs, schools, safety, and what makes the place good. Search an address or browse a department.")}</p>
        ${searchBox()}
      </header>
      <div class="explore-bar">
        <select id="dep" aria-label="${L("Département", "Department")}">${deps.map(([c, n]) => `<option value="${c}" ${c === dep ? "selected" : ""}>${c} ${esc(n)}</option>`).join("")}</select>
        <label class="small">${L("Couleur", "Colour")} <select id="metric">${(Object.keys(METRICS) as Metric[]).map((k) => `<option value="${k}" ${k === ui.metric ? "selected" : ""}>${L(METRICS[k].fr, METRICS[k].en)}</option>`).join("")}</select></label>
        <label class="small">${L("Trier par", "Sort by")} <select id="sort"><option value="pop">${L("Population", "Population")}</option><option value="income">${L("Niveau de vie", "Standard of living")}</option><option value="unemployment">${L("Chômage", "Unemployment")}</option><option value="name">${L("Nom", "Name")}</option></select></label>
        <span id="count" class="muted small"></span>
      </div>
      <section class="dep-card" id="dep-card" aria-label="${esc(depName)}"></section>
      <div class="split">
        <div class="town-pane" id="town-pane"><p class="town-pane-k">${L("Les communes de", "Towns in")} ${esc(depName)}</p><ol class="town-list" id="towns"><li class="muted">${L("Chargement de", "Loading")} ${esc(depName)}…</li></ol></div>
        <div class="split-map"><svg id="dep-map" viewBox="0 0 600 600" role="img" aria-label="${esc(depName)}"></svg><div class="legend-scale" id="legend"></div></div>
      </div>
      <p class="source">${L("Contours : geo.api.gouv.fr. Recherche : Base adresse nationale (Géoplateforme). Chiffres : INSEE, SSMSI, Éducation nationale, OFGL.", "Outlines: geo.api.gouv.fr. Search: National address base (Géoplateforme). Figures: INSEE, SSMSI, Ministry of Education, OFGL.")}</p>
    </section>`;
  bindSearch(app);
  // the department: its coat of arms and its MPs, district by district
  void (async () => {
    const card = app.querySelector<HTMLElement>("#dep-card");
    if (!card) return;
    const mps = deputes.filter((d) => d.numDepartement === dep).sort((a, b) => (a.numCirco ?? 0) - (b.numCirco ?? 0));
    const arms = (await loadDepartmentArms())[dep!];
    card.innerHTML = `<div class="dep-id">${armsSlot(arms, L(`Armoiries : ${depName}`, `Coat of arms: ${depName}`), "l")}<div><p class="eyebrow">${L("Département", "Department")} ${esc(dep!)}</p><h2>${esc(depName)}</h2><p class="muted small">${mps.length} ${plural(mps.length, ["député", "députés"], ["MP", "MPs"])}</p></div></div>
      ${mps.length ? `<div class="dep-mps">${mps.map(mpChip).join("")}</div>` : ""}`;
    paintArms(card);
  })();
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
        return `<path class="area town" data-code="${f.properties!.code}" d="${path(f)}" fill="${colour(v)}" data-tip="${esc(`${f.properties!.nom}\n${L(m.fr, m.en)}${colon()}${v != null ? `${fmt(v)} ${m.unit}` : "–"}`)}"/>`;
      })
      .join("");
    app.querySelector("#legend")!.innerHTML = `<span>${L(m.fr, m.en)}</span>${ramp.map((c, i) => `<i style="background:${c}" title="${i ? `> ${fmt(breaks[i - 1])}` : `≤ ${fmt(breaks[0])}`}"></i>`).join("")}<span class="muted">${vals.length ? `${fmt(vals[0])} – ${fmt(vals[vals.length - 1])} ${m.unit}` : ""}</span>`;
    const sorter = ui.sort === "name" ? (a: TownData, b: TownData) => a.name.localeCompare(b.name, "fr") : (a: TownData, b: TownData) => (METRICS[ui.sort as Metric].get(b) ?? -1) - (METRICS[ui.sort as Metric].get(a) ?? -1);
    const list = [...towns.values()].sort(sorter);
    app.querySelector("#count")!.textContent = `${fmtNum(list.length)} ${plural(list.length, ["commune", "communes"], ["town", "towns"])}`;
    app.querySelector("#towns")!.innerHTML = list
      .slice(0, 150)
      .map((t) => {
        const mp = byDistrict.get(t.districts[0]?.code);
        const ex = townExtra(bundle[t.code]);
        return `<li><a href="#/ville/${t.code}" class="town-card${ex?.photo ? " has-photo" : ""}" data-code="${t.code}">
          ${ex?.photo ? `<img class="tc-photo" src="${esc(safeUrl(ex.photo.url))}" alt="" loading="lazy"/>` : ""}
          <span class="tc-head"><b>${esc(t.name)}</b><span class="muted small">${fmtNum(t.pop)} ${L("hab.", "people")}</span></span>
          <span class="tc-stats small">${t.income ? `<span><i>${L("Niveau de vie", "Living standard")}</i>${fmtNum(t.income)} €</span>` : ""}${t.unemployment != null ? `<span><i>${L("Chômage", "Unemployment")}</i>${fmt(t.unemployment)} %</span>` : ""}${t.schools.length ? `<span><i>${L("Écoles", "Schools")}</i>${t.schools.length}</span>` : ""}${t.events.length ? `<span><i>${L("Événements", "Events")}</i>${t.events.length}</span>` : ""}</span>
          ${mp ? `<span class="small muted">${L(mp.civ === "Mme" ? "Députée" : "Député", "MP")}${colon()}${esc(mp.prenom)} ${esc(mp.nom)} <span class="chip" style="--c:${safeColor(mp.groupe?.couleur) ?? "#999"}">${esc(mp.groupe?.abrev ?? "")}</span></span>` : ""}
        </a></li>`;
      })
      .join("") + (list.length > 150 ? `<li class="muted small">${L("Les 150 premières ; cherchez une commune pour les autres.", "First 150 shown; search for others.")}</li>` : "");
    // hover sync list ↔ map
    const hl = (code: string, on: boolean) => app.querySelector(`#dep-map [data-code="${code}"]`)?.classList.toggle("hl", on);
    app.querySelectorAll<HTMLElement>(".town-card").forEach((a) => { a.addEventListener("mouseenter", () => hl(a.dataset.code!, true)); a.addEventListener("mouseleave", () => hl(a.dataset.code!, false)); });
    app.querySelectorAll<SVGPathElement>("#dep-map .town").forEach((p) => p.addEventListener("click", () => (location.hash = `#/ville/${p.dataset.code}`)));
    // phones: the town list rests as a sheet over the map (peek: its title), pulled up to browse
    detailSheet(app.querySelector<HTMLElement>("#town-pane")!, L("Les communes", "The towns"), { start: 0 });
  };
  app.querySelector<HTMLSelectElement>("#metric")!.addEventListener("change", (e) => { ui.metric = (e.target as HTMLSelectElement).value as Metric; draw(); });
  app.querySelector<HTMLSelectElement>("#sort")!.addEventListener("change", (e) => { ui.sort = (e.target as HTMLSelectElement).value as Metric; draw(); });
  draw();
}
/** Mayor and councils. In a Paris, Lyon or Marseille arrondissement (city given) the RNE mayor and council are the
 *  whole city's: say so, and list the arrondissement's own mayor and council (Marseille: its sector's) first. */
function officialsList(o: NonNullable<ReturnType<typeof townExtra>>["officials"], city: string | null) {
  const li = (label: string, body: string) => `<li><span class="muted small">${label}</span><br>${body}</li>`;
  const out: string[] = [];
  const a = city ? o.arrondissement : null;
  if (a) {
    const where = a.sector && city === "Marseille" ? L(`du secteur ${a.sector}`, `of sector ${a.sector}`) : L("d’arrondissement", "of the arrondissement");
    if (a.mayor) out.push(li(L(`Maire ${where}`, `Mayor ${where}`), `<b>${esc(a.mayor)}</b>`));
    out.push(li(a.sector && city === "Marseille" ? L(`Conseil ${where}`, `Council ${where}`) : L("Conseil d’arrondissement", "Arrondissement council"), `<b>${fmtNum(a.count)}</b> ${plural(a.count, ["élu", "élus"], ["councillor", "councillors"])}`));
  }
  if (o.mayor) {
    const label = city && o.mayor.city ? L(`Maire de ${city}`, `Mayor of ${city}`) : L("Maire", "Mayor");
    out.push(li(`${label}${o.mayor.since ? `, ${L("depuis le", "since")} ${fmtDate(o.mayor.since)}` : ""}`, `<b>${esc(o.mayor.name)}</b>`));
  }
  if (o.councillors) {
    const whole = !!(city && o.councillors.city);
    const label = whole ? (city === "Paris" ? L("Conseil de Paris", "Conseil de Paris (city council)") : L(`Conseil municipal de ${city}`, `${city} city council`)) : L("Conseil municipal", "Town council");
    out.push(li(label, `<b>${fmtNum(o.councillors.count)}</b> ${plural(o.councillors.count, ["élu", "élus"], ["councillor", "councillors"])}${whole ? ` ${L("pour toute la ville", "for the whole city")}` : ""}`));
  }
  return out.join("");
}
/** "75001, 75002" in full; a longer list as "75001, 75002, 75003… (20 codes postaux)". */
const yr = (y?: number) => (y ? ` <span class="muted tiny">${y}</span>` : "");
const postcodes = (codes: string[]) =>
  codes.length <= 4 ? codes.join(", ") : `<span title="${esc(codes.join(", "))}">${codes.slice(0, 3).join(", ")}… (${codes.length} ${L("codes postaux", "postcodes")})</span>`;
const fmt = (n: number) => (Math.abs(n) >= 1000 ? fmtNum(Math.round(n)) : n.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 }));

// ---------- town page ----------
export const CRIME_LABELS: Record<string, [string, string]> = {
  burglary: ["Cambriolages de logement", "Home burglaries"], theftFromPersons: ["Vols sans violence contre des personnes", "Non-violent theft from persons"],
  physicalViolenceOther: ["Violences physiques hors famille", "Physical violence outside the family"], physicalViolenceFamily: ["Violences intrafamiliales", "Domestic violence"],
  vehicleTheft: ["Vols de véhicules", "Vehicle theft"], criminalDamage: ["Destructions et dégradations", "Criminal damage"], drugTrafficking: ["Trafic de stupéfiants", "Drug trafficking"], fraud: ["Escroqueries", "Fraud"],
};

// ---------- crime over time: the town against France (SSMSI, every year since 2016) ----------
interface CrimeHistory { years: number[]; national: Record<string, (number | null)[]>; department: Record<string, (number | null)[]>; communes: Record<string, Record<string, (number | null)[]>> }
/** Paris, Lyon and Marseille are published as whole cities. */
export const plmCity = (c: string) => (/^751\d\d$/.test(c) ? "75056" : /^6938\d$/.test(c) ? "69123" : /^132\d\d$/.test(c) ? "13055" : c);
const numFmt = (v: number) => v.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 });

/** Polyline path that breaks across missing years. */
function linePath(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = "", pen = false;
  vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  return d;
}
/** Dashed bridges over missing years: from the last published year to the next one. */
function gapPath(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = "", prev = -1;
  vals.forEach((v, i) => {
    if (v == null) return;
    if (prev >= 0 && i - prev > 1) d += `M${x(prev).toFixed(1)},${y(vals[prev]!).toFixed(1)}L${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    prev = i;
  });
  return d;
}

function crimeSpark(town: (number | null)[], france: (number | null)[]) {
  const W = 96, H = 26, all = [...town, ...france].filter((v): v is number => v != null);
  const max = Math.max(...all, 0.1), x = (i: number) => 2 + (i * (W - 4)) / (town.length - 1), y = (v: number) => H - 3 - (v / max) * (H - 6);
  const last = town.map((v, i) => [v, i] as const).filter(([v]) => v != null).at(-1);
  return `<svg class="crime-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="fr" d="${linePath(france, x, y)}"/><path class="fr gap" d="${gapPath(france, x, y)}"/><path class="tw gap" d="${gapPath(town, x, y)}"/><path class="tw" d="${linePath(town, x, y)}"/>${last ? `<circle cx="${x(last[1]).toFixed(1)}" cy="${y(last[0]!).toFixed(1)}" r="2.2"/>` : ""}</svg>`;
}

function crimeChart(h: CrimeHistory, town: (number | null)[], key: string, name: string, label: string) {
  const W = 560, H = 230, m = { t: 14, r: 92, b: 26, l: 34 };
  const france = h.national[key] ?? [], dep = h.department[key] ?? [];
  const all = [...town, ...france, ...dep].filter((v): v is number => v != null);
  const step = niceStep(Math.max(...all, 1));
  const max = Math.ceil(Math.max(...all, 0.1) / step) * step;
  const x = (i: number) => m.l + (i * (W - m.l - m.r)) / (h.years.length - 1), y = (v: number) => H - m.b - (v / max) * (H - m.t - m.b);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const lastIdx = (s: (number | null)[]) => s.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).at(-1);
  const end = (s: (number | null)[], cls: string, txt: string) => { const i = lastIdx(s); return i == null ? null : { i, v: s[i]!, cls, txt }; };
  const labels = [end(town, "tw", name), end(dep, "dp", L("Département", "Department")), end(france, "fr", "France")].filter(Boolean) as { i: number; v: number; cls: string; txt: string }[];
  // keep end labels from overlapping
  labels.sort((a, b) => y(a.v) - y(b.v));
  let prev = -Infinity;
  const placed = labels.map((l) => { const ly = Math.max(y(l.v) + 4, prev + 15); prev = ly; return { ...l, ly }; });
  const fmtv = (v: number | null) => (v == null ? L("non publié", "not published") : numFmt(v));
  const sep = L(" : ", ": ");
  const tickFmt = (t: number) => t.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: Number.isInteger(step) ? 0 : 1 });
  return `<figure class="crime-chart">
    <figcaption><b>${esc(label)}</b> <span class="muted small">${key === "burglary" ? L("pour 1 000 logements", "per 1,000 dwellings") : L("pour 1 000 habitants", "per 1,000 people")}, ${h.years[0]}–${h.years.at(-1)}</span>${gapPath(town, (i) => i, (v) => v) ? ` <span class="muted small cc-gap-note">${L("· pointillés : années non publiées", "· dashed: years not published")}</span>` : ""}</figcaption>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label}: ${name} ${L("et France", "and France")}`)}">
      ${ticks.map((t) => `<line class="grid${t === 0 ? " base" : ""}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${tickFmt(t)}</text>`).join("")}
      ${h.years.map((yr, i) => (i % 2 === 0 || i === h.years.length - 1 ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>` : "")).join("")}
      <path class="cc-line dp" d="${linePath(dep, x, y)}"/><path class="cc-line dp gap" d="${gapPath(dep, x, y)}"/>
      <path class="cc-line fr" d="${linePath(france, x, y)}"/><path class="cc-line fr gap" d="${gapPath(france, x, y)}"/>
      <path class="cc-line tw gap" d="${gapPath(town, x, y)}"/>
      <path class="cc-line tw" d="${linePath(town, x, y)}"/>
      ${town.map((v, i) => (v == null ? "" : `<circle class="cc-dot" cx="${x(i)}" cy="${y(v)}" r="3.2"/>`)).join("")}
      ${placed.map((l) => `<text class="end-label cc-${l.cls}" x="${x(l.i) + 8}" y="${l.ly}">${esc(l.txt.length > 14 ? `${l.txt.slice(0, 13)}…` : l.txt)} <tspan class="v">${numFmt(l.v)}</tspan></text>`).join("")}
      ${h.years.map((yr, i) => `<rect class="cc-hit" x="${x(i) - (W - m.l - m.r) / (h.years.length - 1) / 2}" y="${m.t}" width="${(W - m.l - m.r) / (h.years.length - 1)}" height="${H - m.t - m.b}" data-tip="${esc(`${yr}\n${name}${sep}${fmtv(town[i])}\n${L("Département", "Department")}${sep}${fmtv(dep[i] ?? null)}\nFrance${sep}${fmtv(france[i] ?? null)}`)}"/>`).join("")}
    </svg>
  </figure>`;
}
function niceStep(max: number) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Paris, Lyon, Marseille as a whole: the district profiles list their arrondissements, so build the city from them. */
export function plmWhole(towns: Map<string, TownData>, code: string): TownData | undefined {
  const arrs = [...towns.values()].filter((t) => t.code !== code && plmCity(t.code) === code);
  if (!arrs.length) return undefined;
  const districts = new Map<string, number>();
  for (const a of arrs) for (const d of a.districts) districts.set(d.code, 1);
  return {
    code,
    name: code === "75056" ? "Paris" : code === "69123" ? "Lyon" : "Marseille",
    pop: arrs.reduce((s, a) => s + a.pop, 0),
    districts: [...districts.keys()].sort().map((c) => ({ code: c, share: 1 })),
    crime: arrs.find((a) => a.crime)?.crime,
    schools: arrs.flatMap((a) => a.schools),
    events: arrs.flatMap((a) => a.events),
  };
}

/** Up to this many schools, the town page lists them all; above, a summary and a short selection. */
const SCHOOLS_SHOWN = 10;
const schoolRow = (s: Any) => {
  const r = s.dnb ?? s.bacGT ?? s.bacPro;
  return `<tr><td>${esc(s.name)}<br><span class="muted tiny">${s.type === "college" ? L("collège", "collège") : L("lycée", "lycée")}, ${s.sector === "private" ? L("privé", "private") : L("public", "public")}</span></td><td class="num">${s.ips?.value ?? "–"}</td><td class="num">${r?.successRate != null ? `${r.successRate} %` : "–"}</td><td class="num">${r?.successVA != null ? `${r.successVA > 0 ? "+" : ""}${r.successVA}` : "–"}</td></tr>`;
};
const schoolTable = (rows: Any[], attrs = "") =>
  `<table class="table"${attrs}><thead><tr><th>${L("Établissement", "School")}</th><th class="num">IPS</th><th class="num">${L("Réussite", "Pass rate")}</th><th class="num">VA</th></tr></thead><tbody>${rows.map(schoolRow).join("")}</tbody></table>`;
const ordinal = (n: number) => L(`${n}${n === 1 ? "er" : "e"}`, `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`);

/** Collèges et lycées. Big towns get counts by level and sector, the schools nearest the town centre
 *  (half collèges, half lycées), links to each arrondissement for Paris, Lyon and Marseille, and a button for the full list. */
function schoolsSection(schools: Any[], town: { code: string; name: string; centre?: [number, number] }) {
  const head = `<header class="card-head" id="ecoles"><h2>${L("Collèges et lycées", "Secondary schools")}</h2></header>`;
  const foot = `<p class="muted tiny">${L("IPS : indice de position sociale (100 = moyenne nationale). VA : valeur ajoutée de l’établissement.", "IPS: social position index (100 = national average). VA: the school’s value added.")}</p>`;
  if (schools.length <= SCHOOLS_SHOWN + 2) return `<section class="card">${head}${schoolTable(schools)}${foot}</section>`;

  const n = schools.length;
  const colleges = schools.filter((s) => s.type === "college");
  const lycees = schools.filter((s) => s.type !== "college");
  const priv = schools.filter((s) => s.sector === "private").length;
  const rep = schools.filter((s) => s.priorityEducation).length;
  const b = (m: number) => `<b>${fmtNum(m)}</b>`;
  const and = L(" et ", " and ");
  const semi = L(" ; ", "; ");
  const summary = `${b(n)} ${L("établissements", "schools")}${colon()}${b(colleges.length)} ${plural(colleges.length, ["collège", "collèges"], ["collège", "collèges"])}${and}${b(lycees.length)} ${plural(lycees.length, ["lycée", "lycées"], ["lycée", "lycées"])}${semi}${b(n - priv)} ${plural(n - priv, ["public", "publics"], ["public", "public"])}${and}${b(priv)} ${plural(priv, ["privé", "privés"], ["private", "private"])}${rep ? `${semi}${b(rep)} ${L("en éducation prioritaire", "in priority education")}` : ""}.`;

  // nearest the town centre (geo.api.gouv.fr), else the schools' own midpoint
  const located = schools.filter((s) => s.lat != null && s.lon != null);
  const [cLon, cLat] = town.centre ?? (located.length ? [located.reduce((a, s) => a + s.lon, 0) / located.length, located.reduce((a, s) => a + s.lat, 0) / located.length] : [0, 0]);
  const k = Math.cos((cLat * Math.PI) / 180);
  const dist = (s: Any) => (s.lat == null || s.lon == null ? Infinity : ((s.lon - cLon) * k) ** 2 + (s.lat - cLat) ** 2);
  const near = (list: Any[]) => [...list].sort((a, b) => dist(a) - dist(b));
  const half = Math.ceil(SCHOOLS_SHOWN / 2);
  const nc = near(colleges), nl = near(lycees);
  const takeC = Math.min(nc.length, Math.max(half, SCHOOLS_SHOWN - nl.length));
  const pick = [...nc.slice(0, takeC), ...nl.slice(0, SCHOOLS_SHOWN - takeC)];
  const all = [...colleges, ...lycees].sort((a, b) => Number(a.type !== "college") - Number(b.type !== "college") || String(a.name).localeCompare(String(b.name), "fr"));

  // Paris, Lyon, Marseille as a whole: one link per arrondissement
  const byArr = new Map<string, number>();
  if (town.code === plmCity(town.code)) for (const s of schools) if (s.commune && s.commune !== town.code) byArr.set(s.commune, (byArr.get(s.commune) ?? 0) + 1);
  const arrs = byArr.size > 1
    ? `<p class="small">${L("Par arrondissement", "By arrondissement")}${colon()}${[...byArr].sort(([a], [b]) => a.localeCompare(b)).map(([c, m]) => `<a href="#/ville/${c}#ecoles">${ordinal(Number(c.slice(-2)))}</a>&nbsp;<span class="muted">(${m})</span>`).join(", ")}</p>`
    : "";

  return `<section class="card">${head}
    <p>${summary}</p>${arrs}
    <p class="muted small" data-sch-note>${L(`Les ${pick.length} plus proches du centre de ${esc(town.name)}.`, `The ${pick.length} nearest the centre of ${esc(town.name)}.`)}</p>
    ${schoolTable(pick, " data-sch-pick")}${schoolTable(all, " data-sch-all hidden")}
    <p><button type="button" class="button" data-sch-toggle aria-expanded="false" data-more="${esc(L(`Voir les ${fmtNum(n)} établissements`, `Show all ${fmtNum(n)} schools`))}" data-less="${esc(L("Revenir à la sélection", "Back to the selection"))}">${L(`Voir les ${fmtNum(n)} établissements`, `Show all ${fmtNum(n)} schools`)}</button></p>
    ${foot}</section>`;
}

export async function renderTown(app: HTMLElement, code: string) {
  const dep = depOf(code);
  const crimeHist = fetchJson<CrimeHistory>(`/data/crime-history/${dep}.json`).catch(() => null);
  const [{ towns }, deputes, nat, extra, info] = await Promise.all([
    loadDepartmentTowns(dep),
    loadDeputes(),
    loadNational(),
    loadTownExtra(code),
    fetchJson<Any>(`https://geo.api.gouv.fr/communes/${code}?fields=nom,code,codesPostaux,population,departement,region,surface,centre`).catch(() => null),
  ]);
  const t = towns.get(code) ?? plmWhole(towns, code);
  const name = info?.nom ?? t?.name ?? code;
  const cityCode = plmCity(code);
  const isArr = cityCode !== code;
  const cityName = cityCode === "75056" ? "Paris" : cityCode === "69123" ? "Lyon" : cityCode === "13055" ? "Marseille" : name;
  const mps = (t?.districts ?? []).map((d) => ({ d, mp: deputes.find((x) => x.circo === d.code) })).filter((x) => x.mp) as { d: { code: string; share: number }; mp: Depute }[];
  const fr = getLang() === "fr";
  const natCrime = nat?.national?.crime?.rates ?? {};
  const cmpPct = (v: number, ref: number | undefined, higherIsWorse = true) => {
    if (ref == null || !ref) return "";
    const d = ((v - ref) / ref) * 100;
    if (Math.abs(d) < 10) return `<span class="cmp">${L("proche de la moyenne nationale", "close to the national average")}</span>`;
    const good = higherIsWorse ? d < 0 : d > 0;
    return `<span class="cmp ${good ? "cmp-better" : "cmp-worse"}">${d > 0 ? "+" : ""}${Math.round(d)}${L(" %", "%")} ${L("vs France", "vs France")}</span>`;
  };
  const photo = extra?.photo;
  const positives: string[] = [];
  if (extra?.assets) {
    const a = extra.assets;
    const n = (k: number) => `<b>${fmtNum(k)}</b>`;
    if (a.monuments?.count) positives.push(`<li>${n(a.monuments.count)} ${plural(a.monuments.count, ["monument historique", "monuments historiques"], ["historic monument", "historic monuments"])}${a.monuments.names?.length ? `${colon()}${a.monuments.names.slice(0, 4).map(esc).join(", ")}` : ""}</li>`);
    if (a.museums?.count) positives.push(`<li>${n(a.museums.count)} ${plural(a.museums.count, ["musée de France", "musées de France"], ["museum", "museums"])}${a.museums.names?.length ? `${colon()}${a.museums.names.slice(0, 3).map(esc).join(", ")}` : ""}</li>`);
    if (a.sports?.count) positives.push(`<li>${n(a.sports.count)} ${plural(a.sports.count, ["équipement sportif", "équipements sportifs"], ["sports facility", "sports facilities"])}</li>`);
    if (a.libraries?.count) positives.push(`<li>${n(a.libraries.count)} ${plural(a.libraries.count, ["bibliothèque", "bibliothèques"], ["library", "libraries"])}</li>`);
  }
  if (t?.schools.length) positives.push(`<li><b>${t.schools.length}</b> ${plural(t.schools.length, ["collège ou lycée", "collèges et lycées"], ["secondary school", "secondary schools"])}</li>`);
  if (t?.events.length) positives.push(`<li><b>${t.events.length}</b> ${plural(t.events.length, ["événement à venir", "événements à venir"], ["upcoming event", "upcoming events"])}</li>`);

  app.innerHTML = `
    <section class="page town">
      <p class="crumbs"><a href="#/explorer/${dep}">${esc(info?.departement?.nom ?? dep)}</a></p>
      <header class="town-hero ${photo ? "has-photo" : ""}">
        ${photo ? `<figure><img src="${esc(safeUrl(photo.url))}" alt="${esc(name)}" loading="eager"/><figcaption class="tiny">${esc(photo.author ?? "")} ${photo.licence ? `(${esc(photo.licence)})` : ""}, Wikimedia Commons</figcaption></figure>` : ""}
        <div>
          <div class="town-arms" id="town-arms"></div>
          <p class="eyebrow">${esc(info?.departement?.nom ?? "")}${info?.region?.nom ? `, ${esc(info.region.nom)}` : ""}</p>
          <h1>${esc(name)}</h1>
          <p class="dek">${[info?.population ? `${fmtNum(info.population)} ${L("habitants", "inhabitants")}` : "", postcodes(info?.codesPostaux ?? [])].filter(Boolean).join(", ")}.</p>
          ${extra?.description?.text ? `<figure class="town-wiki"><blockquote lang="fr"${extra.description.url ? ` cite="${esc(safeUrl(extra.description.url))}"` : ""}><p>${esc(extra.description.text)}</p></blockquote>
            <figcaption class="tiny muted">${L("Extrait de", "Quoted from")} ${extra.description.url ? `<a href="${esc(safeUrl(extra.description.url))}" target="_blank" rel="noopener">${L("Wikipédia", "French Wikipedia")}</a>` : L("Wikipédia", "French Wikipedia")} (CC BY-SA)${fr ? "" : ", in French"}</figcaption></figure>` : ""}
          <div class="home-set" id="home-set"></div>
          ${searchBox(L("Chercher une autre adresse", "Search another address"))}
        </div>
      </header>
      <a class="cmp-band" href="#/comparer/${code}"><span class="cmp-band-k">${L("Comparer", "Compare")}</span><b>${L(`${esc(name)} face à une autre commune`, `${esc(name)} against another town`)}</b><span class="muted small">${L("Revenus, sécurité, police, écoles, ce que la commune reçoit de l’État, côte à côte", "Income, safety, police, schools, what the town gets from the state, side by side")}</span><span class="cmp-band-go" aria-hidden="true">→</span></a>

      <section class="card brief">
        <header class="card-head"><h2>${L(`${name} en bref`, `${name} in brief`)}</h2></header>
        <div id="brief-text" class="brief-text"><p class="muted small">${L("Chargement…", "Loading…")}</p></div>
        <nav class="jump" id="jump" aria-label="${L("Sur cette page", "On this page")}"></nav>
      </section>

      <section class="card">
        <header class="card-head" id="elus"><h2>${L("Vos élus", "Your elected officials")}</h2></header>
        <div class="grid-2">
          <div>${mps.map(({ d, mp }) => `<a class="mp-mini" href="#/depute/${mp.id}" style="--c:${safeColor(mp.groupe?.couleur) ?? "#999"}"><img src="${photoUrl(mp.id)}" alt="" loading="lazy" data-hide-broken/><span><span class="muted small">${L(mp.civ === "Mme" ? "Députée" : "Député", "MP")}, ${esc(mp.departement ?? "")} ${d.code.slice(-2)}${d.share < 1 ? ` (${L("partie de la commune", "part of the town")})` : ""}</span><br><b>${esc(mp.prenom)} ${esc(mp.nom)}</b> <span class="chip">${esc(mp.groupe?.abrev ?? "")}</span><br><span class="small muted">${age(mp) ?? "?"} ${L("ans", "years old")}, ${L("participation aux votes", "votes attended")} ${Math.round(100 * mp.stats.participation)} %, ${L("présence en ligne", "online presence")} ${presence(mp)}/${PLATFORMS.length}</span></span></a>`).join("") || `<p class="muted">${L("Député non trouvé pour cette commune.", "No MP found for this town.")}</p>`}</div>
          <div>${
            extra?.officials
              ? `<ul class="officials">${officialsList(extra.officials, isArr ? cityName : null)}${extra.officials.departmental?.length ? `<li><span class="muted small">${L("Conseillers départementaux", "Departmental councillors")}</span><br>${extra.officials.departmental.slice(0, 6).map((n: string) => esc(n)).join(", ")}</li>` : ""}</ul><p class="muted tiny">${L("Répertoire national des élus (ministère de l’Intérieur).", "National register of elected officials (Ministry of the Interior).")}</p>`
              : `<p class="muted small">${L("Maire, conseil municipal et sénateurs : bientôt, depuis le Répertoire national des élus.", "Mayor, town council and senators: coming soon, from the national register of elected officials.")}</p>`
          }</div>
        </div>
      </section>

      ${
        t
          ? `<section class="card">
              <header class="card-head" id="chiffres"><h2>${L("La commune en chiffres", "The town in figures")}</h2></header>
              <div class="local-kpis">
                ${t.income ? `<div class="lk"><span class="muted small">${L("Niveau de vie médian", "Median standard of living")}${yr(t.years?.income)}</span><strong>${fmtNum(t.income)} €</strong><span class="small">${cmpPct(t.income, nat?.indicators?.["income.median"]?.median, false)}</span></div>` : ""}
                ${t.poverty != null ? `<div class="lk"><span class="muted small">${L("Taux de pauvreté", "Poverty rate")}${yr(t.years?.income)}</span><strong>${fmt(t.poverty)}${L(" %", "%")}</strong><span class="small">${cmpPct(t.poverty, nat?.indicators?.["income.poverty"]?.median)}</span></div>` : ""}
                ${t.unemployment != null ? `<div class="lk"><span class="muted small">${L("Chômage (recensement)", "Unemployment (census)")}${yr(t.years?.unemployment)}</span><strong>${fmt(t.unemployment)}${L(" %", "%")}</strong><span class="small">${cmpPct(t.unemployment, nat?.national?.unemploymentCensus?.france)}</span></div>` : ""}
                ${t.spending ? `<div class="lk"><span class="muted small">${L("Dépense de la commune", "Town spending")}</span><strong>${fmtNum(t.spending[0])} €</strong><span class="muted tiny">${L("par habitant", "per inhabitant")}</span></div>` : ""}
                ${extra?.prices?.apartment?.median ? `<div class="lk"><span class="muted small">${L("Prix au m², appartements", "Price per m², flats")}</span><strong>${fmtNum(extra.prices.apartment.median)} €</strong><span class="muted tiny">DVF ${esc(String(extra.prices.year ?? ""))}</span></div>` : ""}
                ${extra?.prices?.house?.median ? `<div class="lk"><span class="muted small">${L("Prix au m², maisons", "Price per m², houses")}</span><strong>${fmtNum(extra.prices.house.median)} €</strong><span class="muted tiny">DVF ${esc(String(extra.prices.year ?? ""))}</span></div>` : ""}
                ${extra?.health?.apl != null ? `<div class="lk"><span class="muted small">${L("Accès aux médecins généralistes", "Access to GPs")}</span><strong>${fmt(extra.health.apl)}</strong><span class="muted tiny">${L("consultations / an / habitant (APL)", "consultations / year / person (APL)")}</span></div>` : ""}
                ${extra?.broadband?.fibre != null ? `<div class="lk"><span class="muted small">${L("Locaux raccordables à la fibre", "Premises with fibre")}</span><strong>${fmt(extra.broadband.fibre)}${L(" %", "%")}</strong><span class="muted tiny">ARCEP</span></div>` : ""}
              </div>
            </section>`
          : ""
      }

      <div class="grid-2">
        <section class="card">
          <header class="card-head"><h2>${L("Ce qui fait vivre la commune", "What makes the town tick")}</h2></header>
          ${positives.length ? `<ul class="positives">${positives.join("")}</ul>` : `<p class="muted small">${L("Monuments, musées et équipements : bientôt.", "Monuments, museums and facilities: coming soon.")}</p>`}
          ${t?.events.length ? `<h3>${L("À venir", "Coming up")}</h3><ul class="events">${[...upcoming(t.events)].sort((a, b) => Number(byTownHall(b)) - Number(byTownHall(a))).slice(0, 6).map((e: Any) => eventItem(e)).join("")}</ul>` : ""}
        </section>
        <section class="card">
          <header class="card-head" id="securite"><h2>${L("Sécurité", "Safety")}</h2><span class="muted small">${L("faits pour 1 000 habitants", "per 1,000 people")}</span></header>
          ${isArr && t?.crime ? `<p class="muted small">${L(`Chiffres de ${cityName} entier : le ministère ne publie pas la délinquance par arrondissement.`, `Figures for the whole of ${cityName}: the ministry doesn’t publish crime by arrondissement.`)}</p>` : ""}
          ${
            t?.crime
              ? `<div id="crime-chart"></div><table class="table crime-table"><tbody>${Object.entries(CRIME_LABELS)
                  .filter(([k]) => t.crime![k])
                  .map(([k, [lf, le]]) => `<tr data-crime="${k}"><td>${fr ? lf : le}</td><td class="num"><b>${fmt(t.crime![k][1])}</b></td><td class="spark-cell"></td><td class="num small">${cmpPct(t.crime![k][1], natCrime[k])}</td></tr>`)
                  .join("")}</tbody></table><p class="muted tiny">${L("Faits enregistrés par la police et la gendarmerie (SSMSI). Cambriolages : pour 1 000 logements. Courbes : la commune (trait plein) et la France (pointillés), chaque année depuis 2016 ; cliquez sur une ligne pour l’agrandir. Une année manque quand le ministère ne l’a pas publiée (trop peu de faits). Dans une petite commune, quelques faits suffisent à faire bondir le taux.", "Offences recorded by police and gendarmerie (SSMSI). Burglary: per 1,000 dwellings. Curves: the town (solid) and France (dotted), every year since 2016; click a row to enlarge it. A year is missing when the ministry didn’t publish it (too few offences). In a small town, a handful of offences is enough to make the rate jump.")}</p>`
              : `<p class="muted small">${L("Pas de chiffres publiés pour cette commune : le ministère ne publie pas les communes où les faits sont très peu nombreux.", "No figures published for this town: the ministry doesn’t publish towns with very few offences.")}</p>`
          }
          <div id="town-police" class="town-police"></div>
        </section>
      </div>

      ${t?.schools.length ? schoolsSection(t.schools, { code, name, centre: info?.centre?.coordinates }) : ""}

      <div id="town-state"></div>
      <div id="town-quartiers"></div>
      <div id="town-local" class="stack-col"></div>
      <nav class="doors">${mps.map(({ d }) => `<a class="door" href="#/circo/${d.code}"><b>${L("Toute la circonscription", "The whole district")} ${d.code.slice(-2)}</b><span class="muted small">${L("Résultats électoraux, député, chiffres détaillés", "Election results, MP, detailed figures")}</span></a>`).join("")}<a class="door" href="#/explorer/${dep}"><b>${L("Les autres communes du département", "Other towns in the department")}</b><span class="muted small">${L("Liste et carte", "List and map")}</span></a></nav>
    </section>`;
  bindSearch(app);
  // the town's coat of arms, and the department's beside it (a link to the department, its towns and MPs)
  void Promise.all([loadCommuneArms(dep), loadDepartmentArms()]).then(([ca, da]) => {
    const box = app.querySelector<HTMLElement>("#town-arms");
    if (!box) return;
    const depName = info?.departement?.nom ?? dep;
    box.innerHTML = armsSlot(ca[code] ?? ca[/^751/.test(code) ? "75056" : /^6938/.test(code) ? "69123" : /^132/.test(code) ? "13055" : ""], L(`Armoiries : ${name}`, `Coat of arms: ${name}`), "m")
      + armsSlot(da[dep], L(`${depName} : le département, ses communes et ses députés`, `${depName}: the department, its towns and MPs`), "s", `#/explorer/${dep}`);
    paintArms(box);
  });
  app.querySelector<HTMLButtonElement>("[data-sch-toggle]")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = (open ? btn.dataset.less : btn.dataset.more) ?? "";
    app.querySelector<HTMLElement>("[data-sch-all]")!.hidden = !open;
    app.querySelector<HTMLElement>("[data-sch-pick]")!.hidden = open;
    app.querySelector<HTMLElement>("[data-sch-note]")!.hidden = open;
    if (!open) app.querySelector("#ecoles")?.scrollIntoView({ block: "start" });
  });
  // "this is where I live": remembered on this device, and the department joins live presence
  const homeBox = app.querySelector<HTMLElement>("#home-set");
  const asHome = () => ({ dep, depName: info?.departement?.nom ?? dep, commune: name, code });
  const drawHomeSet = (justSaved = false) => {
    if (!homeBox) return;
    const h = getHome();
    homeBox.innerHTML = h?.code === code
      ? `<span class="home-is"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2a4.8 4.8 0 0 0-4.8 4.8c0 3.6 4.8 8.8 4.8 8.8s4.8-5.2 4.8-8.8A4.8 4.8 0 0 0 8 1.2Zm0 6.6a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="currentColor"/></svg>${justSaved ? L("Enregistrée comme votre commune", "Saved as your town") : L("Votre commune", "Your town")}</span> <button type="button" class="linkish" data-home="off">${justSaved ? L("Annuler", "Undo") : L("Ce n’est plus chez moi", "Not my town any more")}</button>`
      : `<button type="button" class="home-btn" data-home="on">${L("C’est chez moi", "I live here")}</button> <span class="muted small">${h?.code ? L(`à la place de ${esc(h.commune ?? h.code)}`, `instead of ${esc(h.commune ?? h.code)}`) : L("pour retrouver votre commune, vos élus et votre circonscription partout sur le site", "to keep your town, officials and district one click away across the site")}</span>`;
    homeBox.querySelector<HTMLButtonElement>("[data-home]")?.addEventListener("click", (e) => {
      const on = (e.currentTarget as HTMLElement).dataset.home === "on";
      const before = getHome();
      setHome(on ? asHome() : null);
      drawHomeSet(false);
      toast(on ? L(`${name} est maintenant votre commune`, `${name} is now your town`) : L("Commune oubliée sur cet appareil", "Town forgotten on this device"), {
        uniqueID: "home",
        action: { label: L("Annuler", "Undo"), onClick: () => { setHome(before?.code ? before : null); drawHomeSet(false); } },
      });
    });
  };
  let picked: string | null = null;
  try { picked = sessionStorage.getItem("te-picked"); sessionStorage.removeItem("te-picked"); } catch { /* private mode */ }
  if (picked === code && !getHome()?.code) { setHome(asHome()); drawHomeSet(true); } else drawHomeSet();
  // in brief + "on this page" jump links
  townBrief(code, name).then((b) => {
    const box = app.querySelector<HTMLElement>("#brief-text");
    if (box) box.innerHTML = b.sentences.length ? `<p>${b.sentences.join(" ")}</p>` : `<p class="muted small">${L("Pas assez de données publiées pour résumer cette commune.", "Not enough published data to sum up this town.")}</p>`;
  }).catch(() => app.querySelector("#brief-text")?.remove());
  const jumps: [string, string, string][] = [["elus", "Vos élus", "Officials"], ["chiffres", "Chiffres", "Figures"], ["securite", "Sécurité", "Safety"], ["ecoles", "Écoles", "Schools"], ["town-state", "Finances", "Finances"], ["town-quartiers", "Quartiers", "Neighbourhoods"], ["town-local", "Vie locale", "Local life"]];
  const drawJump = () => {
    const nav = app.querySelector<HTMLElement>("#jump");
    if (!nav) return;
    nav.innerHTML = jumps.filter(([id]) => { const el = app.querySelector(`#${id}`); return el && (el.childElementCount > 0 || el.matches("header")); }).map(([id, f, e]) => `<a href="#/ville/${code}#${id}">${L(f, e)}</a>`).join("");
  };
  drawJump();
  setTimeout(drawJump, 2500); // neighbourhoods and local life fill in asynchronously
  renderTownLocal(app.querySelector<HTMLElement>("#town-local")!, code, dep);
  renderTownPolice(app.querySelector<HTMLElement>("#town-police")!, cityCode, isArr ? cityName : null);
  renderQuartiers(app.querySelector<HTMLElement>("#town-quartiers")!, code);
  renderTownState(app.querySelector<HTMLElement>("#town-state")!, code, name);
  crimeHist.then((h) => {
    const box = app.querySelector<HTMLElement>("#crime-chart");
    const series = h?.communes[code] ?? h?.communes[plmCity(code)];
    if (!h || !box || !series) return;
    const rows = [...app.querySelectorAll<HTMLTableRowElement>(".crime-table tr[data-crime]")].filter((r) => series[r.dataset.crime!]?.some((v) => v != null));
    if (!rows.length) return;
    const show = (key: string) => {
      const lab = CRIME_LABELS[key];
      box.innerHTML = crimeChart(h, series[key], key, cityName, fr ? lab[0] : lab[1]);
      rows.forEach((r) => r.setAttribute("aria-selected", String(r.dataset.crime === key)));
    };
    for (const r of rows) {
      const k = r.dataset.crime!;
      r.querySelector(".spark-cell")!.innerHTML = crimeSpark(series[k], h.national[k] ?? []);
      r.tabIndex = 0;
      r.title = L("Voir l’évolution", "See the trend");
      r.addEventListener("click", () => show(k));
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(k); } });
    }
    show(rows[0].dataset.crime!);
  });
}
