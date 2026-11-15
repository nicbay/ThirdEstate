// French Members of the European Parliament (eurodéputés), 10th term (from 16 July 2024): who they are,
// how they vote in plenary roll calls, and what they say in plenary debates.
// Source: European Parliament Open Data Portal, API v2 (https://data.europarl.europa.eu/api/v2), official data only.
//
//   npm run sync:pe                                (whole term; first run ~15 min, then minutes from .cache/europarl/)
//   npm run sync:pe -- --since 2026-09-01          (a sample: only sittings from that date)
//   npm run sync:pe -- --until 2026-10-31
//   npm run sync:pe -- --refresh                   (ignore the cache)
//   npm run sync:pe -- --no-speeches | --no-votes
//
// Endpoints (all JSON-LD, polite: one request at a time, throttled, every response memoised in .cache/europarl/):
//   meps/show-current?country-of-representation=FR    sitting French MEPs (id, names, EP group)
//   meps?parliamentary-term=10                        every MEP of the term (all countries) – needed for group lines
//   meps/{id}                                         memberships with dates: EP group, national party, mandate
//   corporate-bodies/{org}                            names of groups and national parties
//   meetings?year=YYYY                                plenary sittings
//   meetings/{MTG-PL-date}/decisions                  every decision; roll calls list each voter (for / against / abstention)
//   meetings/{MTG-PL-date}/vote-results               the vote items (official titles) the decisions belong to
//   speeches?person-id={id}&parliamentary-term=10&include-output=xml_fragment&language=fr
//                                                     each plenary speech with its verbatim text
//
// Output (public/data/pe/):
//   meps.json                 French MEPs of the term (current first), with vote stats and speech counts
//   votes.json                roll-call votes in the window, newest first, with each EP group's and the French line
//   votes/<id>.json           one MEP's positions { votingId: "P" | "C" | "A" | "-" } for the votes held while sitting
//   interventions/summary.json, interventions/<id>.json   word clouds and themes (same shape as an/interventions)
//   meta.json                 sync time, coverage (date range, sittings, votes, speeches), what is missing
//
// Word clouds: the tokeniser, French stopwords, folding, theme lexicon and TF-IDF below are copied from
// scripts/sync-interventions.mjs (MPs), with a few European Parliament procedural words added to the stopwords.
// Keep the two in step by hand. Only speeches whose original language is French are used (the API also serves
// machine translations, marked "-t-…-mtec"; those are never used); the others are counted and reported.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { fetchRetry, makeCache, throttle } from "./lib/http-cache.mjs";
import { safeName } from "./lib/safe-name.mjs";

const API = "https://data.europarl.europa.eu/api/v2";
const TERM = 10;
const TERM_START = "2024-07-16";
const OUT = new URL("../public/data/pe/", import.meta.url);
const CACHE = new URL("../.cache/europarl/", import.meta.url);

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const SINCE = opt("--since") ?? TERM_START;
const TODAY = new Date().toISOString().slice(0, 10);
const UNTIL = opt("--until") ?? TODAY;
const cache = makeCache(CACHE, { refresh: flag("--refresh") });
const wait = throttle(350);
const missing = []; // what could not be fetched, written to meta.json

// ---------- API helpers ----------
async function api(path, params = {}) {
  const q = new URLSearchParams({ ...params, format: "application/ld+json" });
  const url = `${API}/${path}?${q}`;
  await wait();
  const res = await fetchRetry(url, { headers: { Accept: "application/ld+json" } });
  const txt = res.status === 204 ? "" : await res.text();
  return txt ? JSON.parse(txt).data ?? [] : [];
}
/** Pages through a list (some endpoints ignore `limit` and return everything: stop when nothing new comes back). */
async function apiAll(path, params = {}, limit = 500) {
  const out = [];
  const seen = new Set();
  for (let offset = 0; offset < 50 * limit; offset += limit) {
    const page = await api(path, { ...params, offset: String(offset), limit: String(limit) });
    let fresh = 0;
    for (const x of page) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); fresh++; }
    if (page.length < limit || !fresh) break;
  }
  return out;
}
const tail = (s) => (s == null ? null : String(s).split("/").pop());
const pid = (s) => Number(tail(s));
const lang = (o, l) => (o && typeof o === "object" ? o[l] ?? null : o ?? null);
const daysAgo = (iso) => (Date.parse(TODAY) - Date.parse(iso)) / 864e5;
const fileKey = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

// ---------- people ----------
function reducePerson(p) {
  const mem = (p.hasMembership ?? []).map((m) => ({ c: m.membershipClassification ?? "", o: m.organization, r: tail(m.role), s: m.memberDuring?.startDate ?? null, e: m.memberDuring?.endDate ?? null }));
  return {
    id: p.identifier,
    given: p.givenName ?? "",
    family: p.familyName ?? "",
    label: p.label ?? "",
    sort: p.sortLabel ?? "",
    gender: tail(p.hasGender),
    bday: p.bday ?? null,
    img: p.img ?? null,
    email: typeof p.hasEmail === "string" ? p.hasEmail.replace(/^mailto:/, "") : null,
    groups: mem.filter((m) => m.c.endsWith("/EU_POLITICAL_GROUP")).map((m) => [m.s, m.e, tail(m.o), m.r]),
    parties: mem.filter((m) => m.c.endsWith("/NATIONAL_POLITICAL_GROUP")).map((m) => [m.s, m.e, tail(m.o)]),
    term: mem.filter((m) => m.o === `org/ep-${TERM}` && m.r === "MEMBER_PARLIAMENT").map((m) => [m.s, m.e]),
  };
}
const person = (id, maxAgeH) => cache.memo(`person-${fileKey(id)}.json`, async () => reducePerson((await api(`meps/${id}`))[0] ?? { identifier: String(id) }), { maxAgeH });
const orgP = new Map();
function org(id) {
  if (!orgP.has(id))
    orgP.set(id, cache.memo(`org-${fileKey(id)}.json`, async () => {
      const o = (await api(`corporate-bodies/${id}`))[0] ?? {};
      return { id, label: o.label ?? id, fr: lang(o.prefLabel, "fr") ?? lang(o.altLabel, "fr") ?? o.label ?? id, en: lang(o.prefLabel, "en") ?? lang(o.altLabel, "en") ?? o.label ?? id, altFr: lang(o.altLabel, "fr"), altEn: lang(o.altLabel, "en"), kind: tail(o.classification) };
    }, { maxAgeH: 24 * 90 }));
  return orgP.get(id);
}
const within = (s, e, d) => (!s || s <= d) && (!e || d <= e);
const at = (periods, d) => periods.find(([s, e]) => within(s, e, d));

// EP groups: short labels as the API gives them; colours are the usual ones on europarl.europa.eu charts.
const GROUP_META = {
  PPE: { fr: "Parti populaire européen (démocrates-chrétiens)", en: "European People’s Party (Christian Democrats)", couleur: "#3399ff", rank: 6 },
  "S&D": { fr: "Alliance progressiste des socialistes et démocrates", en: "Progressive Alliance of Socialists and Democrats", couleur: "#e3001b", rank: 2 },
  PfE: { fr: "Patriotes pour l’Europe", en: "Patriots for Europe", couleur: "#2a3768", rank: 8 },
  ECR: { fr: "Conservateurs et réformistes européens", en: "European Conservatives and Reformists", couleur: "#0b6fb8", rank: 7 },
  Renew: { fr: "Renew Europe", en: "Renew Europe", couleur: "#e0b100", rank: 4 },
  "Verts/ALE": { fr: "Les Verts/Alliance libre européenne", en: "Greens/European Free Alliance", couleur: "#3e9a3a", rank: 3 },
  "The Left": { fr: "La Gauche au Parlement européen", en: "The Left in the European Parliament", couleur: "#9b1b30", rank: 1 },
  ESN: { fr: "L’Europe des nations souveraines", en: "Europe of Sovereign Nations", couleur: "#5b3a1e", rank: 9 },
  NI: { fr: "Non-inscrits", en: "Non-attached Members", couleur: "#9aa0aa", rank: 10 },
};

console.log(`European Parliament, term ${TERM}: sittings ${SINCE} → ${UNTIL}`);
const currentFr = await cache.memo("meps-current-FR.json", () => api("meps/show-current", { "country-of-representation": "FR", offset: "0", limit: "500" }), { maxAgeH: 20 });
const termFr = await cache.memo(`meps-term${TERM}-FR.json`, () => api("meps", { "parliamentary-term": String(TERM), "country-of-representation": "FR", offset: "0", limit: "500" }), { maxAgeH: 20 });
const currentIds = new Set(currentFr.map((m) => m.identifier));
const frIds = [...new Set([...currentFr, ...termFr].map((m) => m.identifier))];
console.log(`✓ ${currentIds.size} sitting French MEPs, ${frIds.length} over the term`);

const fr = new Map();
for (const id of frIds) fr.set(id, await person(id, 24 * 6));
const frNum = new Set(frIds.map(Number));

// ---------- votes ----------
const sittings = [];
let votes = []; // reduced roll-call decisions in the window
let items = {}; // vote item id -> { fr, en, date }
const groupOf = new Map(); // person number -> periods [[s, e, abrev]]
const voteSittings = new Set();
if (!flag("--no-votes")) {
  // every MEP of the term, for the groups' lines (a group line is computed from all its members, not only the French)
  const all = await cache.memo(`meps-term${TERM}.json`, () => apiAll("meps", { "parliamentary-term": String(TERM) }, 2000), { maxAgeH: 24 * 6 });
  console.log(`· group memberships of ${all.length} MEPs of the term (cached ${30} days)…`);
  let done = 0;
  for (const m of all) {
    const p = fr.get(m.identifier) ?? (await person(m.identifier, 24 * 30));
    const periods = [];
    for (const [s, e, o] of p.groups) if (!e || e >= TERM_START) periods.push([s, e, (await org(o)).label]);
    groupOf.set(Number(m.identifier), periods);
    if (++done % 100 === 0) console.log(`  ${done}/${all.length}`);
  }

  const years = [];
  for (let y = Number(SINCE.slice(0, 4)); y <= Number(UNTIL.slice(0, 4)); y++) years.push(y);
  for (const y of years) {
    const list = await cache.memo(`meetings-${y}.json`, () => apiAll("meetings", { year: String(y) }, 200), { maxAgeH: y < Number(TODAY.slice(0, 4)) ? 24 * 90 : 20 });
    for (const m of list) if (m.parliamentary_term === `org/ep-${TERM}` && m.activity_date >= SINCE && m.activity_date <= UNTIL && m.activity_date < TODAY) sittings.push(m.activity_date);
  }
  sittings.sort();
  console.log(`✓ ${sittings.length} plenary sittings in the window`);

  for (const d of sittings) {
    const maxAgeH = daysAgo(d) > 60 ? 24 * 365 : 20;
    let decs, its;
    try {
      decs = await cache.memo(`decisions-${d}.json`, async () => {
        // a sitting without any decision (opening day, debates only) answers 404: no votes that day
        const raw = await apiAll(`meetings/MTG-PL-${d}/decisions`).catch((e) => { if (/HTTP 404/.test(e.message)) return []; throw e; });
        return raw
          .filter((x) => String(x.decision_method ?? "").endsWith("VOTE_ELECTRONIC_ROLLCALL") && (x.had_voter_favor || x.had_voter_against || x.had_voter_abstention))
          .map((x) => ({
            v: x.notation_votingId ?? tail(x.id),
            id: x.activity_id,
            d: x.activity_date,
            time: x.activity_start_date ?? null,
            ord: Number(x.activity_order ?? 0),
            fr: lang(x.activity_label, "fr") ?? lang(x.referenceText, "fr"),
            en: lang(x.activity_label, "en") ?? lang(x.referenceText, "en"),
            item: tail(x.inverse_consists_of?.[0]),
            rec: tail(x.recorded_in_a_realization_of?.[0]),
            o: tail(x.decision_outcome),
            n: [x.number_of_votes_favor ?? 0, x.number_of_votes_against ?? 0, x.number_of_votes_abstention ?? 0],
            P: (x.had_voter_favor ?? []).map(pid),
            C: (x.had_voter_against ?? []).map(pid),
            A: (x.had_voter_abstention ?? []).map(pid),
          }));
      }, { maxAgeH });
      its = await cache.memo(`vote-items-${d}.json`, async () => {
        const raw = await apiAll(`meetings/MTG-PL-${d}/vote-results`).catch((e) => { if (/HTTP 404/.test(e.message)) return []; throw e; });
        const o = {};
        for (const x of raw) if (/VOT-ITM-\d+$/.test(x.activity_id ?? "")) o[x.activity_id] = { fr: lang(x.activity_label, "fr"), en: lang(x.activity_label, "en"), rec: tail(x.recorded_in_a_realization_of?.[0]) };
        return o;
      }, { maxAgeH });
    } catch (e) {
      // a sitting whose decisions are not (yet) published answers 404
      missing.push(/HTTP 404/.test(e.message) ? `votes of ${d}: no decisions published by the API (404)` : `votes of ${d}: ${e.message}`);
      console.warn(`  ! ${d}: ${e.message}`);
      continue;
    }
    if (decs.length) voteSittings.add(d);
    votes.push(...decs);
    for (const [k, v] of Object.entries(its)) items[k] = { ...v, date: d };
  }
  // newest first; within a day, last vote first
  votes.sort((a, b) => (a.d !== b.d ? (a.d < b.d ? 1 : -1) : (b.time ?? "").localeCompare(a.time ?? "") || b.ord - a.ord));
  console.log(`✓ ${votes.length} roll-call votes on ${voteSittings.size} sittings`);
}

// ---------- French MEPs: who they are ----------
const meps = [];
for (const id of frIds) {
  const p = fr.get(id);
  const g = at(p.groups, TODAY) ?? p.groups.filter(([s]) => s >= TERM_START).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  const pa = at(p.parties, TODAY) ?? p.parties.filter(([s]) => s >= TERM_START).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  const go = g ? await org(g[2]) : null;
  const po = pa ? await org(pa[2]) : null;
  const term = p.term.filter(([, e]) => !e || e >= TERM_START).sort();
  const ab = go?.label ?? "NI";
  meps.push({
    id,
    civ: p.gender === "FEMALE" ? "Mme" : "M.",
    prenom: p.given,
    nom: p.family,
    sort: p.sort,
    feminin: p.gender === "FEMALE",
    naissance: p.bday,
    photo: p.img ?? `https://www.europarl.europa.eu/mepphoto/${id}.jpg`,
    email: p.email,
    url: `https://www.europarl.europa.eu/meps/fr/${id}`,
    current: currentIds.has(id),
    mandats: term,
    groupe: { abrev: ab, libelle: GROUP_META[ab]?.fr ?? go?.fr ?? ab, libelleEn: GROUP_META[ab]?.en ?? go?.en ?? ab, couleur: GROUP_META[ab]?.couleur ?? "#9aa0aa" },
    parti: po ? { id: po.id, abrev: po.label, libelle: po.fr, libelleEn: po.en } : null,
  });
}
meps.sort((a, b) => Number(b.current) - Number(a.current) || a.sort.localeCompare(b.sort, "fr"));
const partyOf = new Map(); // French MEP number -> periods [[s, e, abrev]]
for (const id of frIds) {
  const p = fr.get(id);
  const periods = [];
  // "Sans parti" / "Indépendant" (no party) is not a delegation: those MEPs get no party line
  for (const [s, e, o] of p.parties) if (!e || e >= TERM_START) { const lb = (await org(o)).label; periods.push([s, e, /^(sans parti|indépendant)$/i.test(lb) ? "?" : lb]); }
  partyOf.set(Number(id), periods);
}
const partyNames = {};
for (const id of frIds) for (const [, e, o] of fr.get(id).parties) if (!e || e >= TERM_START) { const x = await org(o); partyNames[x.label] = { fr: x.fr, en: x.en }; }

// ---------- vote analysis ----------
// Same method as scripts/lib/loyalty.mjs for MPs: a "line" is the plurality position (for / against / abstention)
// of the *other* members who voted, at least MIN_OTHERS of them, no tie. Non-attached members have no group line.
const MIN_OTHERS = 3;
const MIN_OTHERS_PARTY = 1; // French national delegations are small (1 to 30 MEPs)
const POS = ["P", "C", "A"];
const lineOf = (count, mine, min) => {
  const o = { ...count };
  if (mine) o[mine]--;
  const total = o.P + o.C + o.A;
  const max = Math.max(o.P, o.C, o.A);
  const lead = POS.filter((k) => o[k] === max);
  return total >= min && lead.length === 1 ? lead[0] : null;
};
const posOf = (v) => { const m = new Map(); for (const k of POS) for (const x of v[k]) m.set(x, k); return m; };
const periodsAt = (map, x, d) => at(map.get(x) ?? [], d)?.[2] ?? null;

const stats = new Map(frIds.map((id) => [Number(id), { eligible: 0, P: 0, C: 0, A: 0, group: { n: 0, ok: 0, opp: 0, ni: 0 }, france: { n: 0, ok: 0, opp: 0 }, parties: {}, mates: {}, breaks: [] }]));
const perMep = new Map(frIds.map((id) => [Number(id), {}]));
const voteRows = [];
for (const v of votes) {
  const pos = posOf(v);
  // counts by EP group (all MEPs), by French party, and all French MEPs
  const g = {}, fp = {}, frc = { P: 0, C: 0, A: 0 };
  for (const [x, k] of pos) {
    const ab = periodsAt(groupOf, x, v.d) ?? "?";
    (g[ab] ??= { P: 0, C: 0, A: 0 })[k]++;
    if (frNum.has(x)) {
      frc[k]++;
      const pa = periodsAt(partyOf, x, v.d) ?? "?";
      (fp[pa] ??= { P: 0, C: 0, A: 0 })[k]++;
    }
  }
  const gl = {};
  for (const [ab, c] of Object.entries(g)) if (ab !== "NI" && ab !== "?") { const l = lineOf(c, null, MIN_OTHERS); if (l) gl[ab] = l; }
  const pl = {};
  for (const [pa, c] of Object.entries(fp)) if (pa !== "?") { const l = lineOf(c, null, 1); if (l) pl[pa] = l; }
  const fl = lineOf(frc, null, MIN_OTHERS);
  for (const id of frNum) {
    const p = fr.get(String(id));
    if (!at(p.term, v.d)) continue;
    const s = stats.get(id);
    s.eligible++;
    const mine = pos.get(id) ?? null;
    perMep.get(id)[v.v] = mine ?? "-";
    if (!mine) continue;
    s[mine]++;
    const ab = periodsAt(groupOf, id, v.d);
    if (!ab || ab === "NI") s.group.ni++;
    else {
      const l = lineOf(g[ab], mine, MIN_OTHERS);
      if (l) {
        s.group.n++;
        if (l === mine) s.group.ok++;
        else {
          const opp = (mine === "P" && l === "C") || (mine === "C" && l === "P");
          if (opp) s.group.opp++;
          const c = g[ab];
          const others = c.P + c.C + c.A - 1;
          const cohesion = (c[l]) / others;
          s.breaks.push([v.v, mine, l, Math.round(cohesion * 100) / 100, others, cohesion * (others / (others + 8)) + (opp ? 0.1 : 0)]);
        }
      }
    }
    const l = lineOf(frc, mine, MIN_OTHERS);
    if (l) { s.france.n++; if (l === mine) s.france.ok++; else if ((mine === "P" && l === "C") || (mine === "C" && l === "P")) s.france.opp++; }
    for (const [pa, c] of Object.entries(fp)) {
      if (pa === "?") continue;
      const own = periodsAt(partyOf, id, v.d) === pa;
      const lp = lineOf(c, own ? mine : null, MIN_OTHERS_PARTY);
      if (!lp) continue;
      const t = (s.parties[pa] ??= [0, 0]);
      t[0]++;
      if (lp === mine) t[1]++;
    }
  }
  voteRows.push([v.v, v.d, v.item ?? "", v.fr ?? "", v.en ?? "", v.o ?? "", v.n[0], v.n[1], v.n[2], fl, gl]); // party lines (pl) feed the stats only: kept out of the file to keep it small
}

const r3 = (x) => Math.round(x * 1000) / 1000;
for (const m of meps) {
  const s = stats.get(Number(m.id));
  const cast = s.P + s.C + s.A;
  const rate = (o) => (o.n ? r3(o.ok / o.n) : null);
  m.stats = votes.length
    ? {
        eligible: s.eligible, cast, pour: s.P, contre: s.C, abstention: s.A,
        participation: s.eligible ? r3(cast / s.eligible) : null,
        group: { ...s.group, rate: rate(s.group) },
        france: { ...s.france, rate: rate(s.france) },
        // agreement with each French national delegation: [votes compared, same position]
        parties: Object.fromEntries(Object.entries(s.parties).sort((a, b) => b[1][0] - a[1][0])),
        // most notable breaks from the group line: [votingId, own position, group line, share of colleagues on the line, colleagues voting]
        breaks: s.breaks.sort((a, b) => b[5] - a[5]).slice(0, 12).map((x) => x.slice(0, 5)),
      }
    : null;
}

// ---------- speeches ----------
const speechMeta = { total: 0, french: 0, notFrench: 0, langs: {}, chair: 0, empty: 0, meps: 0, from: null, to: null };
const speechesBy = new Map();
if (!flag("--no-speeches")) {
  for (const id of frIds) {
    let list;
    try {
      list = await cache.memo(`speeches-${fileKey(id)}.json`, async () => {
        const raw = await apiAll("speeches", { "person-id": id, "parliamentary-term": String(TERM), "include-output": "xml_fragment", language: "fr" }, 100);
        return raw.map((x) => {
          const r = x.recorded_in_a_realization_of?.[0] ?? {};
          const xml = lang(r["api:xmlFragment"], "fr") ?? "";
          const xl = xml.match(/<(?:speech|from)\b[^>]*xml:lang="([^"]+)"/)?.[1] ?? null;
          const orig = (r.originalLanguage ?? []).map(tail);
          const original = orig.includes("FRA") && !/-t-/.test(xl ?? "");
          return {
            id: x.activity_id,
            d: x.activity_date,
            t: lang(x.activity_label, "fr"),
            te: lang(x.activity_label, "en"),
            role: tail(x.had_participation?.participation_role),
            orig,
            xl,
            item: tail(r.is_part_of),
            // text kept only when French is the original language
            text: original ? xml.replace(/<from\b[\s\S]*?<\/from>/g, " ").replace(/<\/p>/g, "\n") : null,
          };
        });
      }, { maxAgeH: 20 });
    } catch (e) {
      missing.push(`speeches of MEP ${id}: ${e.message}`);
      console.warn(`  ! speeches ${id}: ${e.message}`);
      continue;
    }
    list = list.filter((s) => s.d >= SINCE && s.d <= UNTIL);
    speechesBy.set(id, list);
  }
}

// ---------- word clouds: copied from sync-interventions.mjs ----------
const THEMES = [
  ["securite", "Sécurité", "Security", "police polic* gendarme* délinquan* criminalit* criminel crime cambriolage narcotrafic* trafiquant drogue stupéfiant terroris* attentat émeute vidéoprotection vidéosurveillance insécurité sécuritaire forces_de_l’ordre ordre_public féminicide* agression"],
  ["immigration", "Immigration", "Immigration", "immigr* migra* asile demandeur_d’asile titre_de_séjour régularisation expulsion oqtf clandestin* sans-papier* naturalisation réfugié* frontex étranger regroupement_familial aide_médicale ame"],
  ["sante", "Santé", "Health", "santé hôpital hospital* médecin* médical* soignant infirmier* patient maladie soin médicament pharmac* ehpad psychiatr* cancer vaccin* sécurité_sociale assurance_maladie fin_de_vie mourir euthanasie urgence_hospitalière désert_médical ars sanitaire kinésithérap* ondam"],
  ["social", "Solidarités et famille", "Welfare & family", "pauvreté pauvre précarité précaire handicap* famille familial* allocation rsa caf solidarité aidant autonomie dépendance minimum_social aide_sociale personne_âgée enfance protection_de_l’enfance sans-abri crèche petite_enfance pension_alimentaire"],
  ["education", "Éducation et recherche", "Education & research", "école scolai* élève enseignant* professeur* éducation éducatif lycée lycéen collège collégien université universitaire étudiant* chercheur jeunesse baccalauréat parcoursup enseignement maternelle périscolaire pédagog* recherche_publique"],
  ["travail", "Travail et retraites", "Work & pensions", "travail travailleur emploi chômage chômeur salarié salaire salarial* retraite retraité syndica* smic licenciement apprenti* âge_légal pénibilité cotisation france_travail assurance_chômage conditions_de_travail temps_de_travail"],
  ["economie", "Économie et entreprises", "Economy & business", "entreprise entrepreneur* industri* commerce commerçant artisan* pme tpe économique croissance investissement investisseur concurrence innovation usine numérique inflation pouvoir_d’achat start-up actionnaire dividende banque bancaire"],
  ["budget", "Budget et fiscalité", "Budget & tax", "budget* impôt fiscal* fiscalité taxe taxation dette déficit tva milliard dépense_publique finance_publique loi_de_finance contribuable plf plfss csg niche_fiscale prélèvement exonération superprofit* recette_fiscale"],
  ["ecologie", "Écologie, énergie, transports", "Ecology, energy & transport", "écolog* environnement* climat* énergi* électricité nucléaire renouvelable éolien* solaire carbone pollution biodiversité réchauffement sobriété déchet plastique forêt littoral pétrole edf transport ferroviaire train sncf voiture carburant automobile rénovation_énergétique zfe eau"],
  ["agriculture", "Agriculture et alimentation", "Farming & food", "agricul* agriculteur paysan* élevage éleveur pêche pêcheur alimentation alimentaire ferme pesticide glyphosate phytosanitaire mercosur viticult* viticole laitier egalim pac exploitation_agricole agroalimentaire"],
  ["logement", "Logement", "Housing", "logement locataire propriétaire loyer hlm bailleur immobilier hébergement squat* copropriété habitat urbanisme foncier airbnb meublé locatif logement_social"],
  ["international", "International et défense", "Foreign affairs & defence", "guerre ukrain* russ* poutine israël* gaza palestin* hamas otan diplomat* militaire armée armement soldat géopolit* afrique chine états-unis trump iran liban onu défense_nationale affaire_étrangère loi_de_programmation_militaire génocide"],
  ["justice", "Justice", "Justice", "justice judiciaire juge magistrat* tribunal prison détenu pénitentiaire pénal* procès avocat incarcér* condamnation condamné victime mineur_délinquant récidive garde_à_vue code_pénal"],
  ["europe", "Europe", "Europe", "europe européen union_européenne bruxelles directive commission_européenne eurodéputé schengen parlement_européen"],
  ["institutions", "Institutions et territoires", "Institutions & local government", "constitution* constitutionnel référendum démocratie proportionnelle dissolution censure motion_de_censure parlement parlementarisme décentralisation collectivité maire commune communal* intercommunal* département* région* élection électoral* scrutin_proportionnel conseil_constitutionnel"],
  ["outremer", "Outre-mer", "Overseas France", "outre-mer ultramarin* guadeloup* martiniqu* guyan* réunionnais mayotte mahorais nouvelle-calédonie calédonien* kanak* polynésie polynésien* octroi_de_mer chlordécone saint-pierre-et-miquelon wallis vie_chère hexagone"],
  ["culture", "Culture, médias, sport", "Culture, media & sport", "culture culturel patrimoine musée artiste cinéma audiovisuel média presse journaliste sport sportif olympique paralympique théâtre spectacle langue_régionale audiovisuel_public"],
];
const STOP = new Set(`
a à afin ah ai aie aient aies ait alors as au aucun aucune aujourd’hui auquel aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront aussi autant autre autres aux auxquelles auxquels avaient avais avait avant avec avez aviez avions avoir avons ayant ayez ayons
bah beaucoup bien bon bonne c ça car ce ceci cela celle celles celui cependant certain certaine certaines certains ces cet cette ceux chacun chacune chaque chez ci comme comment contre d dans de dedans dehors déjà demain depuis des desquelles desquels dessous dessus devant devra devrait devraient devons devez doit doivent donc dont du duquel durant
eh elle elles en encore entre es est et étaient étais était étant été êtes étiez étions être eu eue eues eûmes eurent eus eut eux fait faire fais faisons faites font fois fut furent fûmes ici il ils j je jamais jusqu jusque l la là laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me même mêmes mes moi moins mon n ne ni non nos notre nôtre nous
o oh on ont ou où par parce parmi pas peu peut peuvent peux plus plusieurs pour pourquoi pourra pourrait pourraient pouvez pouvons près puis puisque qu quand que quel quelle quelles quels qui quoi s sa sans se sera serai seraient serais serait seras serez seriez serions serons seront ses si sien sienne soi soient sois soit sommes son sont sous soyez soyons suis sur t ta tandis tant te tel telle telles tels tes toi ton tous tout toute toutes très trop tu un une unes uns vers via voici voilà vos votre vôtre vous vu y
voire ainsi enfin donc également notamment surtout toujours souvent parfois vraiment simplement seulement plutôt peut-être c’est-à-dire d’ailleurs ailleurs effectivement évidemment justement totalement absolument précisément exactement directement clairement réellement aujourd plus là-dessus celui-ci celle-ci ceux-ci celles-ci là-bas vous-même vous-mêmes nous-mêmes moi-même lui-même elle-même eux-mêmes soi-même
avoir être faire dire aller voir savoir pouvoir vouloir devoir falloir venir prendre donner mettre passer croire trouver rendre permettre parler demander tenir sembler rester entendre penser arriver laisser porter comprendre connaître proposer souhaiter agir
ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront eu eus suis es est sommes êtes sont étais était étions étiez étaient serai seras sera serons serez seront été fais fait faisons faites font faisait ferai fera ferons ferez feront dis dit disons dites disent disait dirai dira vais va allons allez vont allait irai ira irons vois voit voyons voyez voient vu sais sait savons savez savent su peux peut pouvons pouvez peuvent pu pourrait veux veut voulons voulez veulent voulu voudrais voudrait dois doit devons devez doivent dû devrait faut fallait faudra faudrait viens vient venons venez viennent venu prends prend prenons prenez prennent pris donne donnons donnez donnent donné mets met mettons mettez mettent mis passe passons passez passent passé crois croit croyons croyez croient cru trouve trouvons trouvez trouvent trouvé rends rend rendons rendez rendent rendu permet permettent permis permettra permettrait parle parlons parlez parlent parlé demande demandons demandez demandent demandé tiens tient tenons tenez tiennent tenu semble semblent semblé reste restons restez restent resté entends entend entendons entendez entendent entendu pense pensons pensez pensent pensé arrive arrivent arrivé laisse laissons laissez laissent laissé porte portons portez portent porté comprends comprend comprenons comprenez comprennent compris connais connaît connaissons connaissez connaissent connu propose proposons proposez proposent proposé souhaite souhaitons souhaitez souhaitent souhaité agit agissons agissez agissent
monsieur madame messieurs mesdames mesdemoiselles président présidente ministre ministres rapporteur rapporteure rapporteurs rapporteuse collègue collègues cher chère chers chères député députée députés députées gouvernement amendement amendements sous-amendement sous-amendements article articles alinéa alinéas texte textes commission commissions séance séances avis favorable défavorable sagesse retrait retire retirer retiré retirons rédactionnel rédactionnels adopté adoptée adoptés adoptées rejeté rejetée rejetés rejetées adopter rejeter voter vote votes votons votez voté scrutin parole merci remercie remercions question questions réponse répondre rappel règlement suspension minute minutes heure heures cours lecture discussion examen proposition propositions projet projets loi lois disposition dispositions mesure mesures dispositif dispositifs alinéa objet but sens fond cas point points chose choses fait faits manière façon moment temps jour jours année années an ans mois semaine aujourd’hui hier demain fin début part parts place niveau nombre ensemble cadre égard effet terme termes travail_parlementaire hémicycle assemblée nationale sénat sénateur sénateurs groupe groupes banc bancs applaudissements exclamations protestations rires
bah oui non bref ok voilà tiens allez
premier première premiers premières deuxième second seconde troisième dernier dernière derniers dernières nouveau nouvelle nouveaux nouvelles grand grande grands grandes petit petite petits petites tel telle vrai vraie juste simple important importante importants importantes essentiel essentielle possible nécessaire nécessaires certain certaine même autre seul seule seuls seules plein pleine long longue bonne bon bons bonnes meilleur meilleure mauvais mauvaise différent différents différente différentes besoin
un deux trois quatre cinq six sept huit neuf dix vingt trente cent cents mille million millions
mme votera voteront voterons votrons chargé délégué apparenté vise visent visant viser abord est-à-dire bravo exactement excellent formidable sûr sûrement quelque quelques chose rien personne tout_à_fait cela celles
commissaire commissaires vice-président vice-présidente eurodéputé eurodéputés parlement parlements européen européens européenne européennes union rapport rapports résolution résolutions débat débats plénière carton bleu haute représentante représentant présidence
`.split(/\s+/).filter(Boolean));
const CONNECT = new Set(["de", "d"]);
const ELISION = /^(?:l|d|j|qu|n|s|c|m|t|jusqu|lorsqu|puisqu|quoiqu|presqu)['’]/;
const INVARIANT = new Set("pays fois temps corps prix choix paix voix mois français anglais procès accès succès progrès cours discours recours concours secours sens dos bras poids taux lors gens fils avis refus abus virus campus bus mœurs puits repos mépris travaux impôts".split(" "));
function fold(w) {
  if (w.length <= 3 || INVARIANT.has(w)) return w;
  if (w.endsWith("aux") && w.length > 5) return w.slice(0, -3) + "al";
  if (/(?:[^su]s|x)$/.test(w) && !/(?:ès|ys|is|as)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5) {
    if (w.endsWith("ée")) return w.slice(0, -1);
    if (w.endsWith("euse")) return w.slice(0, -4) + "eux";
    if (w.endsWith("trice") && w.length > 7) return w.slice(0, -5) + "teur";
    if (w.endsWith("ive")) return w.slice(0, -3) + "if";
    if (w.endsWith("elle")) return w.slice(0, -2);
    if (w.endsWith("enne")) return w.slice(0, -2);
    if (w.endsWith("ère")) return w.slice(0, -3) + "er";
    if (w.endsWith("ale")) return w.slice(0, -1);
  }
  return w;
}
const lemmaId = new Map();
const lemmas = [];
const surfaces = [];
const lemmaTheme = [];
const prefixRules = [];
const exactRules = new Map();
const pairRules = new Map();
const T = THEMES.length;
THEMES.forEach(([, , , words], ti) => {
  for (const raw of words.split(" ")) {
    if (raw.endsWith("*")) prefixRules.push([raw.slice(0, -1), ti]);
    else if (raw.includes("_")) {
      const parts = raw.split(/_|’/).filter((p) => p && !STOP.has(p) && !CONNECT.has(p) && p !== "à" && p !== "l");
      if (parts.length >= 2) pairRules.set(`${fold(parts[0])}|${fold(parts[parts.length - 1])}`, ti);
    } else exactRules.set(fold(raw), ti);
  }
});
const caps = [], ups = [], occ = [];
const surfIds = new Map();
const surfList = [];
function idOf(lemma, surface, cap, upper) {
  let id = lemmaId.get(lemma);
  if (id === undefined) {
    id = lemmas.length;
    lemmaId.set(lemma, id);
    lemmas.push(lemma);
    surfaces.push(new Map());
    let th = exactRules.get(lemma) ?? -1;
    if (th < 0) for (const [p, ti] of prefixRules) if (lemma.startsWith(p)) { th = ti; break; }
    lemmaTheme.push(th);
    caps.push(0); ups.push(0); occ.push(0);
  }
  occ[id]++;
  if (cap) caps[id]++;
  if (upper) ups[id]++;
  const s = surfaces[id];
  if (s.size < 8 || s.has(surface)) s.set(surface, (s.get(surface) ?? 0) + 1);
  return id;
}
const isProper = (id) => caps[id] > 0.7 * occ[id];
const isAcronym = (id) => ups[id] > 0.7 * occ[id];
const capitalise = (w) => w.replace(/(^|-)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/-(De|Et|La|Le|Les|Du|Des|Sur|En)-/g, (x) => x.toLowerCase());
const shape = (id, w) => (isAcronym(id) ? w.toUpperCase() : isProper(id) ? capitalise(w) : w);
const display = (id) => shape(id, [...surfaces[id].entries()].sort((a, b) => b[1] - a[1])[0][0]);
const surfId = (w) => { let i = surfIds.get(w); if (i === undefined) { i = surfList.length; surfIds.set(w, i); surfList.push(w); } return i; };
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
function clean(xml) {
  return xml
    .replace(/<recordedTime[^>]*\/>/g, "")
    .replace(/<br\s*\/?>/g, " . ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, (e) => ENT[e] ?? " ")
    .replace(/\([^)]{0,200}\)/g, " ") // stage directions: (Applaudissements), (L’orateur accepte…)
    .replace(/['`]/g, "’");
}
const SPLIT = /([\p{L}][\p{L}’\-]*[\p{L}]|[\p{L}])|([.!?;:,«»"–—()…])/gu;
const AMEND = /\b(?:amendements?|sous-amendements?|articles?|alinéas?)\s+(?:n\s*[o°]s?\s*)?\d+[\w\s,et]*?/gi;
function tokenize(text, surf) {
  const seq = [];
  text = text.replace(AMEND, " . ").replace(/\b(?:monsieur|madame|mme|m\.)\s+(?:le|la)\s+(?:président|présidente|ministre|rapporteur|rapporteure|commissaire|vice-président|vice-présidente|haute représentante|haut représentant)\b/gi, " . ");
  for (const m of text.matchAll(SPLIT)) {
    if (m[2]) { seq.push(-1); continue; }
    let w = m[1].toLowerCase();
    if (ELISION.test(w)) {
      const head = w.slice(0, w.search(/['’]/));
      w = w.replace(ELISION, "");
      if (head === "d") seq.push(-2);
      else if (head !== "l" || STOP.has(w)) seq.push(-1);
    }
    w = w.replace(/^[\-’]+|[\-’]+$/g, "").replace(/-(?:t-)?(?:il|ils|elle|elles|on|je|tu|nous|vous|ce|là|ci|moi|toi|lui|leur)$/, "");
    if (!w) continue;
    if (CONNECT.has(w)) { seq.push(-2); continue; }
    if (w.length < 3 || STOP.has(w) || /\d/.test(w)) { seq.push(-1); continue; }
    const lemma = fold(w);
    if (STOP.has(lemma)) { seq.push(-1); continue; }
    const orig = m[1].replace(ELISION, "");
    const head = orig[0] ?? "";
    seq.push(idOf(lemma, w, head !== head.toLowerCase(), orig.length >= 2 && orig === orig.toUpperCase()));
    if (surf) surf[seq.length - 1] = surfId(w);
  }
  return seq;
}
const pairKey = (a, b, de) => (a * 2 ** 21 + b) * 2 + (de ? 1 : 0);
const pairParts = (k) => [Math.floor(k / 2 ** 22), Math.floor(k / 2) % 2 ** 21, k % 2];
function* pairs(seq, atPos = false) {
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    if (a < 0) continue;
    let j = i + 1, de = false;
    if (seq[j] === -2) { de = true; j++; }
    const b = seq[j];
    if (b >= 0 && b !== a) yield atPos ? [pairKey(a, b, de), i, j] : pairKey(a, b, de);
  }
}
const titleThemes = (txt) => {
  const v = new Float32Array(T);
  const seq = tokenize(clean(txt ?? ""));
  for (const id of seq) if (id >= 0 && lemmaTheme[id] >= 0) v[lemmaTheme[id]] = 1;
  for (const k of pairs(seq)) { const [a, b] = pairParts(k); const th = pairRules.get(`${lemmas[a]}|${lemmas[b]}`); if (th !== undefined) v[th] = 1; }
  return v;
};

// ---------- pass 1: speeches → token sequences ----------
const speeches = [];
const mpStat = new Map();
const debateTitles = [];
const titleIdx = new Map();
const sitDates = new Set();
const groupNow = new Map(meps.map((m) => [m.id, m.groupe.abrev]));
for (const [mp, list] of speechesBy) {
  const st = { n: 0, words: 0, first: null, last: null, total: list.length, notFrench: 0, langs: {}, chair: 0 };
  mpStat.set(mp, st);
  for (const s of list) {
    speechMeta.total++;
    if (!speechMeta.from || s.d < speechMeta.from) speechMeta.from = s.d;
    if (!speechMeta.to || s.d > speechMeta.to) speechMeta.to = s.d;
    if (s.role && s.role !== "SPEAKER") { st.chair++; speechMeta.chair++; continue; }
    if (s.text == null) {
      st.notFrench++; speechMeta.notFrench++;
      const l = s.orig.join("+") || "?";
      st.langs[l] = (st.langs[l] ?? 0) + 1;
      speechMeta.langs[l] = (speechMeta.langs[l] ?? 0) + 1;
      continue;
    }
    const text = clean(s.text);
    const surf = [];
    const seq = tokenize(text, surf);
    const words = seq.reduce((n, x) => n + (x >= 0 ? 1 : 0), 0);
    if (!words) { speechMeta.empty++; continue; }
    speechMeta.french++;
    sitDates.add(s.d);
    st.n++;
    st.words += words;
    if (!st.first || s.d < st.first) st.first = s.d;
    if (!st.last || s.d > st.last) st.last = s.d;
    const t = (s.t ?? "").trim();
    if (!titleIdx.has(t)) titleIdx.set(t, debateTitles.push(t) - 1);
    let themes = null;
    if (words >= 12) {
      const tt = titleThemes(t);
      const sc = new Float32Array(T);
      let own = 0;
      for (const id of seq) if (id >= 0 && lemmaTheme[id] >= 0) { sc[lemmaTheme[id]]++; own++; }
      for (const k of pairs(seq)) { const [x, y] = pairParts(k); const th = pairRules.get(`${lemmas[x]}|${lemmas[y]}`); if (th !== undefined) { sc[th] += 2; own++; } }
      for (let i = 0; i < T; i++) sc[i] += 1.5 * tt[i];
      const max = Math.max(...sc);
      const total = sc.reduce((a, x) => a + x, 0);
      if (own >= 1 && total >= 2) {
        let kept = 0;
        for (let i = 0; i < T; i++) if (sc[i] < 0.4 * max) sc[i] = 0; else kept += sc[i];
        for (let i = 0; i < T; i++) sc[i] /= kept;
        themes = sc;
      }
    }
    speeches.push({ mp, d: s.d, debate: titleIdx.get(t), item: s.item, sid: s.id, text, seq: Int32Array.from(seq), surf: Int32Array.from(seq, (x, i) => (x >= 0 ? surf[i] : -1)), words, themes, weight: Math.sqrt(Math.min(words, 800)) });
  }
  if (st.total) speechMeta.meps++;
}
console.log(`✓ ${speechMeta.total} speeches by ${speechMeta.meps} French MEPs: ${speechMeta.french} in French kept, ${speechMeta.notFrench} in another original language dropped, ${speechMeta.chair} as chair dropped`);

// ---------- pass 2: counts, TF-IDF (as in sync-interventions.mjs, thresholds scaled to a smaller corpus) ----------
const pairCount = new Map();
const pairMps = new Map();
for (const s of speeches) for (const k of pairs(s.seq)) pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
for (const [k, n] of pairCount) if (n < 8) pairCount.delete(k);
for (const s of speeches) for (const k of pairs(s.seq)) if (pairCount.has(k)) (pairMps.get(k) ?? pairMps.set(k, new Set()).get(k)).add(s.mp);
for (const [k, set] of pairMps) if (set.size < 3) pairCount.delete(k);
pairMps.clear();
const pairIds = new Map([...pairCount.keys()].map((k, i) => [k, lemmas.length + i]));
const isPair = (id) => id >= lemmas.length;
const pairOf = [...pairCount.keys()];
const pairSurf = new Map();
const pairDisplay = (k) => {
  const [a, b, de] = pairParts(k);
  const best = [...(pairSurf.get(pairIds.get(k))?.entries() ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0].split("|").map(Number);
  const A = best ? shape(a, surfList[best[0]]) : display(a);
  const B = best ? shape(b, surfList[best[1]]) : display(b);
  return `${A} ${de ? (/^[aeiouyhéèêâîôûœ]/i.test(B) ? "d’" : "de ") : ""}${B}`;
};
// colleagues' surnames (proper nouns matching a French MEP's name) and group names are not subjects
// first names and surnames of French MEPs ("France", a first name, stays: it is mostly the country)
const NAMES = new Set([...fr.values()].flatMap((p) => `${p.given} ${p.family}`.toLowerCase().split(/[\s\-’']+/)).filter((w) => w.length >= 3 && w !== "france").map(fold));
const GROUP_WORDS = new Set(["ppe", "renew", "ecr", "pfe", "esn", "verts", "ale", "s&d", "patriote", "socialistes", "démocrates", "réformistes", "conservateurs"].map(fold));
const GROUP_PAIRS = new Set(["renew europe", "verts ale", "patriote europe", "nations souveraine"].map((x) => x.split(" ").map(fold).join("|")));
const excluded = (id) => {
  if (!isPair(id)) return GROUP_WORDS.has(lemmas[id]) || (NAMES.has(lemmas[id]) && isProper(id));
  const [a, b] = pairParts(pairOf[id - lemmas.length]);
  return excluded(a) || excluded(b) || GROUP_PAIRS.has(`${lemmas[a]}|${lemmas[b]}`);
};
const termText = (id) => (isPair(id) ? pairDisplay(pairOf[id - lemmas.length]) : display(id));

const mpCounts = new Map();
const groupCounts = new Map();
const chamber = new Map();
const termTheme = new Map();
const mpThemes = new Map();
const groupThemes = new Map();
const chamberThemes = new Float32Array(T);
const mpClassified = new Map();
const sittingDf = new Map();
const lastSit = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
for (const s of speeches) {
  const mc = mpCounts.get(s.mp) ?? mpCounts.set(s.mp, new Map()).get(s.mp);
  const g = groupNow.get(s.mp) ?? "NI";
  const gc = groupCounts.get(g) ?? groupCounts.set(g, new Map()).get(g);
  const terms = [];
  for (const id of s.seq) if (id >= 0) terms.push(id);
  for (const [k, i, j] of pairs(s.seq, true)) {
    const p = pairIds.get(k);
    if (p === undefined) continue;
    terms.push(p);
    const ps = pairSurf.get(p) ?? pairSurf.set(p, new Map()).get(p);
    const key = `${s.surf[i]}|${s.surf[j]}`;
    if (ps.size < 6 || ps.has(key)) bump(ps, key);
  }
  for (const id of terms) {
    bump(mc, id); bump(gc, id); bump(chamber, id);
    if (lastSit.get(id) !== s.d) { lastSit.set(id, s.d); bump(sittingDf, id); }
  }
  if (s.themes) {
    const mt = mpThemes.get(s.mp) ?? mpThemes.set(s.mp, new Float32Array(T)).get(s.mp);
    const gt = groupThemes.get(g) ?? groupThemes.set(g, new Float32Array(T)).get(g);
    bump(mpClassified, s.mp);
    for (let t = 0; t < T; t++) { const w = s.themes[t] * s.weight; if (!w) continue; mt[t] += w; gt[t] += w; chamberThemes[t] += w; }
    for (const id of terms) { const v = termTheme.get(id) ?? termTheme.set(id, new Float32Array(T)).get(id); for (let t = 0; t < T; t++) v[t] += s.themes[t]; }
  }
}
const themeOfTerm = (id) => {
  if (!isPair(id) && lemmaTheme[id] >= 0) return lemmaTheme[id];
  if (isPair(id)) { const [a, b] = pairParts(pairOf[id - lemmas.length]); const th = pairRules.get(`${lemmas[a]}|${lemmas[b]}`); if (th !== undefined) return th; }
  const v = termTheme.get(id);
  if (!v) return -1;
  const total = v.reduce((s, x) => s + x, 0);
  const n = chamber.get(id) ?? 0;
  if (total < 5 || total < 0.25 * n) return -1;
  let best = 0;
  for (let t = 1; t < T; t++) if (v[t] > v[best]) best = t;
  return v[best] / total >= 0.5 ? best : -1;
};
const shares = (v) => { const total = v ? v.reduce((s, x) => s + x, 0) : 0; return Object.fromEntries(THEMES.map(([id], t) => [id, total ? Math.round((1000 * v[t]) / total) / 1000 : 0])); };
const pack = (list) => list.map(([id, w]) => [termText(id), r3(w), themeOfTerm(id) >= 0 ? THEMES[themeOfTerm(id)][0] : null]);
const df = new Map();
for (const mc of mpCounts.values()) for (const id of mc.keys()) bump(df, id);
const N = mpCounts.size;
function topTerms(counts, score, n = 60) {
  const scored = [];
  for (const [id, c] of counts) { if (excluded(id)) continue; const s = score(id, c); if (s > 0) scored.push([id, s]); }
  scored.sort((a, b) => b[1] - a[1]);
  const picked = [];
  const covered = new Set();
  for (const [id, s] of scored) {
    if (picked.length >= n) break;
    if (!isPair(id) && covered.has(id)) continue;
    picked.push([id, s]);
    if (isPair(id)) { const k = pairOf[id - lemmas.length]; const pc = counts.get(id); for (const w of pairParts(k).slice(0, 2)) if (pc >= 0.6 * (counts.get(w) ?? 0)) covered.add(w); }
  }
  const max = picked[0]?.[1] ?? 1;
  return picked.map(([id, s]) => [id, s / max]);
}
const mpTerms = new Map();
for (const [mp, mc] of mpCounts) {
  const total = [...mc.values()].reduce((s, x) => s + x, 0) || 1;
  mpTerms.set(mp, topTerms(mc, (id, c) => (c < 2 ? 0 : (c / total) * Math.log((N + 1) / ((df.get(id) ?? 1) + 0.5)) * (isPair(id) ? 1.4 : 1))));
}
const S = sitDates.size || 1;
const chamberTotal = [...chamber.values()].reduce((s, x) => s + x, 0);
const chamberTerms = topTerms(chamber, (id, c) => (c < 15 ? 0 : c * Math.log((S + 1) / (sittingDf.get(id) ?? S)) * (isPair(id) ? 1.5 : 1)), 80);
const groups = {};
const groupTermIds = [];
for (const [g, gc] of groupCounts) {
  const gTotal = [...gc.values()].reduce((s, x) => s + x, 0) || 1;
  const terms = topTerms(gc, (id, c) => { if (c < 6) return 0; const ratio = c / gTotal / ((chamber.get(id) ?? 1) / chamberTotal); return ratio > 1.2 ? c * Math.log(ratio) : 0; }, 60);
  groupTermIds.push(...terms.map(([id]) => id));
  const members = meps.filter((m) => m.groupe.abrev === g).map((m) => m.id);
  groups[g] = {
    libelle: GROUP_META[g]?.fr ?? g,
    couleur: GROUP_META[g]?.couleur ?? "#9aa0aa",
    mps: members.length,
    speeches: members.reduce((s, id) => s + (mpStat.get(id)?.n ?? 0), 0),
    words: members.reduce((s, id) => s + (mpStat.get(id)?.words ?? 0), 0),
    themes: shares(groupThemes.get(g)),
    terms: pack(terms).map((t, i) => [...t, gc.get(terms[i][0]) ?? 0]),
  };
}

// quotes: for every word of an MEP's cloud, their two most recent speeches using it, with a link to the verbatim record
// for every word of the chamber and group clouds, three recent quotes by different MEPs
const wantMp = new Map([...mpTerms].map(([mp, t]) => [mp, new Set(t.map(([id]) => id))]));
const wantAll = new Set([...chamberTerms.map(([id]) => id), ...groupTermIds]);
const mpSrc = new Map();
const allSrc = new Map();
function keepNewest(list, ref, k, clash) {
  const dOf = (r) => speeches[r[0]].d;
  if (list.length >= k && dOf(ref) <= dOf(list[k - 1])) return list;
  const i = list.findIndex((r) => clash(speeches[r[0]]));
  if (i >= 0) { if (dOf(ref) <= dOf(list[i])) return list; list.splice(i, 1); }
  list.push(ref);
  list.sort((a, b) => (dOf(b) < dOf(a) ? -1 : dOf(b) > dOf(a) ? 1 : 0));
  if (list.length > k) list.length = k;
  return list;
}
speeches.forEach((s, si) => {
  if (s.words < 8) return;
  const mine = wantMp.get(s.mp);
  const seen = new Set();
  const visit = (id, p1, p2 = -1) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (mine?.has(id)) {
      const key = `${s.mp}|${id}`;
      mpSrc.set(key, keepNewest(mpSrc.get(key) ?? [], [si, p1, p2], 2, (o) => o.d === s.d && o.debate === s.debate));
    }
    if (wantAll.has(id)) allSrc.set(id, keepNewest(allSrc.get(id) ?? [], [si, p1, p2], 3, (o) => o.mp === s.mp));
  };
  s.seq.forEach((id, i) => { if (id >= 0) visit(id, i); });
  for (const [k, i, j] of pairs(s.seq, true)) { const p = pairIds.get(k); if (p !== undefined) visit(p, i, j); }
});
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function quote([si, p1, p2], withMp = false) {
  const s = speeches[si];
  const surf = surfList[s.surf[p1]] ?? "";
  const surf2 = p2 >= 0 ? surfList[s.surf[p2]] ?? "" : "";
  const text = s.text.replace(/\s+/g, " ").replace(/\s+([,.;:!?)])/g, "$1").trim();
  const word = (w) => `(?<![\\p{L}])${reEsc(w)}(?![\\p{L}])`;
  const link = "[\\s’'\\-]+(?:(?:de|du|des|d|l|la)[\\s’']+){0,2}";
  const m = (surf2 ? new RegExp(`${word(surf)}${link}${word(surf2)}`, "iu").exec(text) : null) ?? (surf ? new RegExp(word(surf), "iu").exec(text) : null);
  const a0 = m ? m.index : 0, len = m ? m[0].length : 0;
  let a = Math.max(0, a0 - 80), b = Math.min(text.length, a0 + len + 80);
  if (a > 0) a = text.indexOf(" ", a) + 1 || a;
  if (b < text.length) { const sp = text.lastIndexOf(" ", b); if (sp > a0 + len) b = sp; }
  const lead = a > 0 ? "…" : "";
  const x = `${lead}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
  // u: appended to https://www.europarl.europa.eu/doceo/document/ (the verbatim report of the debate, in French)
  const out = { d: s.d, t: debateTitles[s.debate] ?? "", u: s.item ? `${s.item}_FR.html` : "", x, h: m ? [a0 - a + lead.length, a0 - a + lead.length + len] : null };
  if (withMp) out.m = s.mp;
  return out;
}

// ---------- write ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(new URL("votes/", OUT), { recursive: true });
await mkdir(new URL("interventions/", OUT), { recursive: true });

for (const m of meps) {
  const st = mpStat.get(m.id);
  m.speeches = st ? { total: st.total, french: st.n, notFrench: st.notFrench, langs: st.langs, chair: st.chair } : null;
}
await writeFile(new URL("meps.json", OUT), JSON.stringify(meps));

if (votes.length) {
  const usedItems = {};
  for (const v of votes) if (v.item && items[v.item]) usedItems[v.item] = items[v.item];
  // votes: [votingId, date, item id, label fr, label en, outcome, for, against, abstention, French line, {group: line}]
  await writeFile(new URL("votes.json", OUT), JSON.stringify({ groups: Object.fromEntries(Object.entries(GROUP_META).map(([k, v]) => [k, { fr: v.fr, en: v.en, couleur: v.couleur, rank: v.rank }])), parties: partyNames, items: usedItems, votes: voteRows }));
  for (const [id, pos] of perMep) if (safeName(String(id))) await writeFile(new URL(`votes/${id}.json`, OUT), JSON.stringify(pos));
}

let written = 0;
const mpsSummary = {};
for (const [mp, st] of mpStat) {
  if (!st.n) continue;
  const sh = shares(mpThemes.get(mp));
  mpsSummary[mp] = { n: st.n, i: st.notFrench, w: st.words, c: mpClassified.get(mp) ?? 0, t: THEMES.map(([id]) => sh[id]) };
  if (!safeName(mp)) continue;
  const mc = mpCounts.get(mp) ?? new Map();
  const terms = (mpTerms.get(mp) ?? []).map(([id, w]) => [termText(id), r3(w), themeOfTerm(id) >= 0 ? THEMES[themeOfTerm(id)][0] : null, mc.get(id) ?? 0, (mpSrc.get(`${mp}|${id}`) ?? []).map(quote)]);
  await writeFile(new URL(`interventions/${mp}.json`, OUT), JSON.stringify({ id: mp, speeches: st.n, interjections: st.notFrench, // "interjections" slot = speeches not in French (left out), shown by briefLabel
    words: st.words, classified: mpClassified.get(mp) ?? 0, first: st.first, last: st.last, terms, themes: sh, total: st.total, notFrench: st.notFrench, langs: st.langs, chair: st.chair }));
  written++;
}
// words.json: every chamber/group cloud word: how often, by how many MEPs, recent quotes (as an/interventions/words.json)
const wordsOut = {};
for (const id of wantAll) {
  let m = 0;
  for (const mc of mpCounts.values()) if (mc.has(id)) m++;
  wordsOut[termText(id)] = { n: chamber.get(id) ?? 0, m, src: (allSrc.get(id) ?? []).map((r) => quote(r, true)) };
}
await writeFile(new URL("interventions/words.json", OUT), JSON.stringify(wordsOut));
// ranks/NN.json: for every cloud word, every French MEP who said it, most first (same FNV-1a sharding as
// sync-interventions.mjs and src/views/speeches.ts, so the word popup works unchanged)
const SHARDS = 32;
const shardOf = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h % SHARDS; };
const rankIds = [...mpCounts.keys()].sort();
const rankIndex = new Map(rankIds.map((id, i) => [id, i]));
const ranked = new Set(wantAll);
for (const list of mpTerms.values()) for (const [id] of list) ranked.add(id);
const shards = Array.from({ length: SHARDS }, () => ({}));
for (const id of ranked) {
  const by = [];
  for (const [mp, mc] of mpCounts) { const c = mc.get(id); if (c) by.push([rankIndex.get(mp), c]); }
  by.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  shards[shardOf(termText(id))][termText(id)] = [chamber.get(id) ?? 0, ...by.flat()];
}
await mkdir(new URL("interventions/ranks/", OUT), { recursive: true });
for (let i = 0; i < SHARDS; i++) await writeFile(new URL(`interventions/ranks/${String(i).padStart(2, "0")}.json`, OUT), JSON.stringify({ ids: rankIds, w: shards[i] }));
const SPEECH_SRC = `${API}/speeches?person-id={id}&parliamentary-term=${TERM}&include-output=xml_fragment&language=fr&format=application%2Fld%2Bjson`;
await writeFile(new URL("interventions/summary.json", OUT), JSON.stringify({
  term: TERM,
  source: { url: SPEECH_SRC },
  period: { from: speechMeta.from, to: speechMeta.to, sittings: sitDates.size },
  themes: THEMES.map(([id, f, e]) => ({ id, fr: f, en: e })),
  chamber: { speeches: speechMeta.french, words: [...mpStat.values()].reduce((s, x) => s + x.words, 0), themes: shares(chamberThemes), terms: pack(chamberTerms) },
  groups,
  mps: mpsSummary,
  dropped: { notFrench: speechMeta.notFrench, langs: speechMeta.langs, chair: speechMeta.chair },
}));

if (flag("--no-votes")) missing.push("votes skipped (--no-votes)");
if (flag("--no-speeches")) missing.push("speeches skipped (--no-speeches)");
const meta = {
  syncedAt: new Date().toISOString(),
  term: TERM,
  window: { from: SINCE, to: UNTIL, fullTerm: SINCE <= TERM_START },
  sources: {
    api: API,
    docs: "https://data.europarl.europa.eu/en/developer-corner/opendata-api",
    licence: "© European Union – European Parliament, reuse authorised (https://www.europarl.europa.eu/legal-notice/en/)",
  },
  meps: { current: currentIds.size, term: frIds.length },
  votes: votes.length
    ? { from: votes.at(-1).d, to: votes[0].d, sittings: sittings.length, sittingsWithRollCalls: voteSittings.size, rollCalls: votes.length, items: new Set(votes.map((v) => v.item)).size }
    : null,
  speeches: speechMeta,
  missing,
};
await writeFile(new URL("meta.json", OUT), JSON.stringify(meta, null, 2));
console.log(`✓ wrote public/data/pe/: ${meps.length} MEPs, ${votes.length} roll-call votes, ${written} word clouds`);
if (missing.length) console.log(`! missing:\n  ${missing.join("\n  ")}`);
