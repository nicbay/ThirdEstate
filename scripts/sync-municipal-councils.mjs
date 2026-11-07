// "How do they vote": municipal council deliberations with outcome and, where published, votes by political group.
//
//   node scripts/sync-municipal-councils.mjs            fetch (cached 24 h in .cache/municipal/councils/) and write
//   node scripts/sync-municipal-councils.mjs --refresh  ignore the cache
//
// There is no national register of council votes. Only a few cities publish deliberations as open data, and only
// Toulouse publishes how each political group voted (see docs/data-municipal.md for the survey of the large cities):
//   31555 Toulouse  — data.toulouse-metropole.fr: outcome + groups/councillors voting against, abstaining or not voting
//                     ("pour" is not listed: it is everyone else). Per-group positions are derived from that text.
//   33063 Bordeaux  — opendata.bordeaux-metropole.fr: outcome only (unanimity / majority), no counts, no groups.
//   44109 Nantes    — data.nantesmetropole.fr (SCDL): totals for / against / abstention, no groups; nothing after the
//                     March 2026 election has been published yet (last council: 2026-02-19, previous mandate).
//
// Output: public/data/municipal/councils/<code>.json and councils/index.json (coverage, including cities NOT covered).

import { mkdir, writeFile } from "node:fs/promises";
import { makeCache } from "./lib/http-cache.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("public/data/municipal/councils/", ROOT);
const C = makeCache(new URL(".cache/municipal/councils/", ROOT), { refresh: process.argv.includes("--refresh") });
const TODAY = new Date().toISOString().slice(0, 10);
const MANDATE_START = "2026-03-15";
const LO = "Licence Ouverte / Open Licence v2.0 (Etalab)";

// ---------- Toulouse ----------
const TLS = "https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/";
const MONTHS = { janv: 1, "févr": 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, "août": 8, aout: 8, sept: 9, oct: 10, nov: 11, "déc": 12, dec: 12 };
const frDate = (s) => {
  const m = /^(\d{1,2})-([a-zéû]+)\.?-(\d{2})$/i.exec(String(s ?? "").trim());
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `20${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};
const HEADINGS = [
  [/^contre/i, "against"],
  [/^abstention/i, "abstain"],
  [/^ne (participe|prend) pas (part )?au vote/i, "notVoting"],
  [/^pour/i, "for"],
];
// Toulouse council groups of the 2026–2032 mandate, as they appear in the open data, with the 2026 list they come from
// (official results, public/data/municipal/31.json). Positions are only published for these names.
const TLS_GROUPS = {
  "Aimer Toulouse": { family: "right", basis: "Group of the majority of mayor Jean-Luc Moudenc (winning list 'Avec Jean-Luc MOUDENC, Protégeons l'Avenir de Toulouse', nuance LDVD)." },
  "Demain Toulouse": { family: "radical_left", basis: "Same name as François Piquemal's first-round list 'Demain Toulouse à gauche et écologiste' (nuance LFI); merged second-round list LDVG." },
  "Vivre mieux, élu.e.s socialistes, écologistes, communistes et citoyen.ne.s": { family: "left", basis: "Same name as the first-round list 'Vivre mieux La gauche unie, écologiste, citoyenne et solidaire' (nuance LUG); merged second-round list LDVG." },
};

function parseToulouseVote(text) {
  const out = { against: [], abstain: [], notVoting: [], for: [] };
  if (!text) return out;
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const h = HEADINGS.find(([re]) => re.test(t));
    if (h && !raw.startsWith("\t")) { cur = h[1]; continue; }
    if (!cur) continue;
    const m = /^(.*?)\s+sauf\s+(.+)$/i.exec(t);
    const name = (m ? m[1] : t).trim();
    const except = m ? m[2].split(/\s*(?:,| et )\s*/).filter(Boolean) : [];
    const isGroup = Object.hasOwn(TLS_GROUPS, name) || /^groupe\b/i.test(name);
    out[cur].push(isGroup ? { group: name, ...(except.length ? { except } : {}) } : { councillor: name });
  }
  return out;
}

function outcomeToulouse(typeVote) {
  const t = (typeVote ?? "").toLowerCase();
  if (t.includes("unanimit")) return { outcome: "adopted", unanimous: true };
  if (t.startsWith("adopt")) return { outcome: "adopted", unanimous: false };
  if (t.startsWith("rejet")) return { outcome: "rejected", unanimous: false };
  if (t.includes("retir")) return { outcome: "withdrawn", unanimous: null };
  if (t.includes("prend acte")) return { outcome: "noted", unanimous: null };
  return { outcome: "other", unanimous: null };
}

async function toulouse() {
  const id = "deliberations-a-partir-de-mars-2026-mairie-de-toulouse";
  const rows = await C.cachedJson(`tls-${id}.json`, `${TLS}${id}/exports/json`, { maxAgeH: 24 });
  const meta = await C.cachedJson(`tls-${id}-meta.json`, `${TLS}${id}`, { maxAgeH: 24 });
  const groups = Object.keys(TLS_GROUPS);
  const items = rows
    .map((r) => {
      const date = frDate(r.date_conseil) ?? r.date_prefecture ?? null;
      const { outcome, unanimous } = outcomeToulouse(r.type_vote);
      const listed = parseToulouseVote(r.vote);
      const voted = outcome === "adopted" || outcome === "rejected";
      // per-group position: listed heading, else (a vote took place) "for" — the official format lists only against /
      // abstention / not voting, so every group not listed voted for. Councillors named individually are kept apart.
      const byGroup = voted
        ? Object.fromEntries(
            groups.map((g) => {
              for (const k of ["against", "abstain", "notVoting", "for"]) {
                const e = listed[k].find((x) => x.group === g);
                if (e) return [g, { position: k, implied: false, ...(e.except ? { except: e.except } : {}) }];
              }
              return [g, { position: "for", implied: true }];
            }),
          )
        : null;
      const individuals = ["against", "abstain", "notVoting", "for"].flatMap((k) => listed[k].filter((x) => x.councillor).map((x) => ({ name: x.councillor, position: k })));
      const otherGroups = ["against", "abstain", "notVoting"].flatMap((k) => listed[k].filter((x) => x.group && !groups.includes(x.group)).map((x) => ({ group: x.group, position: k })));
      return {
        id: r.reference,
        date,
        order: r.ndeg_passage_cm ?? null,
        title: r.titre,
        theme: r.libelle_theme_prefecture ?? null,
        rapporteur: r.nom_rapporteur ?? null,
        outcome,
        unanimous,
        outcomeLabel: r.type_vote ?? null,
        byGroup,
        ...(individuals.length ? { individuals } : {}),
        ...(otherGroups.length ? { otherGroups } : {}),
        voteText: r.vote ?? null,
      };
    })
    .filter((d) => !d.date || d.date >= MANDATE_START)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (a.order ?? 0) - (b.order ?? 0));
  return {
    code: "31555",
    name: "Toulouse",
    granularity: "group",
    council: "Conseil municipal de Toulouse",
    mandate: "2026–2032",
    groups: Object.entries(TLS_GROUPS).map(([name, g]) => ({ name, ...g })),
    method:
      "Outcome from 'type_vote'. The 'vote' field lists, under 'Contre', 'Abstention' and 'Ne participe pas au vote', the groups (or individual councillors) concerned; votes in favour are not listed. byGroup therefore marks a group 'for' with implied=true when it is not listed and a vote took place. 'except' = members of the group who did not follow it (named in the source). Individual councillors named outside a group are in 'individuals'. Unanimous votes: every group 'for' (implied).",
    source: {
      name: "Délibérations à partir de mars 2026 - Mairie de Toulouse",
      publisher: "Toulouse Métropole / Mairie de Toulouse",
      url: `https://data.toulouse-metropole.fr/explore/dataset/${id}/`,
      api: `${TLS}${id}/records`,
      licence: meta?.metas?.default?.license ?? "Not stated in the dataset metadata (the 2020–2026 edition of the same dataset is under Licence Ouverte v2.0)",
      modified: meta?.metas?.default?.modified ?? null,
    },
    deliberations: items,
  };
}

// ---------- Bordeaux ----------
async function bordeaux() {
  const base = "https://opendata.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets/bor_deliberations/";
  const rows = await C.cachedJson("bor_deliberations.json", `${base}exports/json?where=${encodeURIComponent(`tech_delibs_dde_dt_vote>='${MANDATE_START}'`)}`, { maxAgeH: 24 });
  const map = (s) => {
    const t = (s ?? "").toUpperCase();
    if (t.startsWith("ADOPTE A L'UNANIMITE")) return { outcome: "adopted", unanimous: true };
    if (t.startsWith("ADOPTE")) return { outcome: "adopted", unanimous: false };
    if (t.startsWith("REJETE")) return { outcome: "rejected", unanimous: false };
    if (t.includes("RETIRE")) return { outcome: "withdrawn", unanimous: null };
    if (t.includes("INFORMATION")) return { outcome: "noted", unanimous: null };
    return { outcome: "other", unanimous: null };
  };
  const items = rows
    .filter((r) => (r.sea_assemblee ?? "Conseil Municipal") === "Conseil Municipal")
    .map((r) => ({
      id: r.tech_delibs_dde_numero,
      date: r.tech_delibs_dde_dt_vote,
      title: r.tech_delibs_dde_titre,
      theme: r.tech_delibs_rap_com_princip ?? null,
      ...map(r.tech_delibs_dde_resultat),
      outcomeLabel: r.tech_delibs_dde_resultat ?? null,
      url: r.delib_url ?? null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  return {
    code: "33063",
    name: "Bordeaux",
    granularity: "outcome",
    council: "Conseil municipal de Bordeaux",
    mandate: "2026–2032",
    method: "Outcome only, from 'tech_delibs_dde_resultat' ('ADOPTE A L'UNANIMITE', '… DES VOTANTS', 'ADOPTE A LA MAJORITE', …). The dataset publishes no vote counts and no group positions.",
    source: {
      name: "Délibérations du conseil municipal de Bordeaux",
      publisher: "Ville de Bordeaux / Bordeaux Métropole",
      url: "https://opendata.bordeaux-metropole.fr/explore/dataset/bor_deliberations/",
      api: `${base}records`,
      licence: LO,
    },
    deliberations: items,
  };
}

// ---------- Nantes ----------
async function nantes() {
  const base = "https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_deliberations-instances-metropole-nantes/";
  const where = encodeURIComponent("instance='Conseil Municipal' AND delib_date>='2025-01-01'");
  const rows = await C.cachedJson("nantes-cm.json", `${base}exports/json?where=${where}`, { maxAgeH: 24 });
  const n = (s) => (s == null || s === "" ? null : Number(s));
  const items = rows
    .map((r) => {
      const pour = n(r.vote_pour), contre = n(r.vote_contre), abst = n(r.vote_abstention);
      const has = pour != null && (pour || contre || abst);
      return {
        id: r.delib_id,
        date: r.delib_date,
        title: r.delib_objet,
        theme: r.delib_matiere_nom ?? null,
        outcome: has ? (pour > (contre ?? 0) ? "adopted" : "rejected") : "unknown",
        unanimous: has ? !contre && !abst : null,
        totals: has ? { for: pour, against: contre, abstain: abst, members: n(r.vote_effectif), voting: n(r.vote_reel) } : null,
        mandate: r.mandat ?? null,
        url: r.delib_url ?? null,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Number(a.id) - Number(b.id));
  const latest = items[0]?.date ?? null;
  return {
    code: "44109",
    name: "Nantes",
    granularity: "totals",
    council: "Conseil municipal de Nantes",
    mandate: latest && latest >= MANDATE_START ? "2026–2032" : "2020–2026 (no deliberation of the new council published yet)",
    method: "Totals for / against / abstention from the SCDL fields VOTE_POUR, VOTE_CONTRE, VOTE_ABSTENTION. 'outcome' is derived (for > against). No group or councillor breakdown is published. Deliberations since 2025-01-01.",
    source: {
      name: "Délibérations des instances de Nantes Métropole et de la Ville de Nantes",
      publisher: "Nantes Métropole",
      url: "https://data.nantesmetropole.fr/explore/dataset/244400404_deliberations-instances-metropole-nantes/",
      api: `${base}records`,
      licence: LO,
    },
    deliberations: items,
  };
}

// Cities checked and NOT covered (survey of 2026-11-07; see docs/data-municipal.md)
const NOT_COVERED = [
  { code: "75056", name: "Paris", reason: "opendata.paris.fr has no deliberation/vote dataset (only Conseil de Paris agendas, last updated 2018). Votes are in the Bulletin officiel / minutes (PDF/HTML)." },
  { code: "13055", name: "Marseille", reason: "SCDL-like deliberation lists without votes (datasud.fr), last edition 2024." },
  { code: "69123", name: "Lyon", reason: "No deliberation dataset on data.grandlyon.com or data.gouv.fr." },
  { code: "06088", name: "Nice", reason: "No deliberation dataset found." },
  { code: "34172", name: "Montpellier", reason: "No deliberation dataset found." },
  { code: "67482", name: "Strasbourg", reason: "Only legal postings (publiactes) with PDF + OCR text; no structured votes." },
  { code: "59350", name: "Lille", reason: "Only a one-off June 2022 dataset; the MEL deliberation dataset has no votes." },
  { code: "35238", name: "Rennes", reason: "SCDL deliberations with vote totals stopped in 2021; current data is recusals (déports) only." },
  { code: "38185", name: "Grenoble", reason: "No deliberation dataset found (portal did not respond)." },
  { code: "49007", name: "Angers", reason: "Deliberations published (data.angers.fr, ODbL) but without any vote field." },
  { code: "63113", name: "Clermont-Ferrand", reason: "SCDL vote totals, but only 2020-02 to 2024-09 (stale)." },
  { code: "37261", name: "Tours", reason: "SCDL dataset, but every vote field is 0." },
  { code: "42218", name: "Saint-Étienne", reason: "SCDL file with vote totals but no dates; last update 2026-01 (previous mandate)." },
  { code: "29019", name: "Brest", reason: "SCDL files with empty vote fields." },
  { code: "25056", name: "Besançon", reason: "Agenda API with PDF links only, no votes." },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const covered = [];
  for (const fn of [toulouse, bordeaux, nantes]) {
    try {
      const d = await fn();
      const file = { generated: TODAY, schemaVersion: 1, ...d };
      await writeFile(new URL(`${d.code}.json`, OUT), JSON.stringify(file, null, 1));
      const dates = d.deliberations.map((x) => x.date).filter(Boolean).sort();
      covered.push({ code: d.code, name: d.name, granularity: d.granularity, mandate: d.mandate, deliberations: d.deliberations.length, from: dates[0] ?? null, to: dates.at(-1) ?? null, source: d.source.url, licence: d.source.licence });
      console.log(`${d.code} ${d.name}: ${d.deliberations.length} deliberations (${dates[0]} → ${dates.at(-1)})`);
    } catch (e) {
      console.error(`${fn.name}: ${e.message ?? e}`);
    }
  }
  await writeFile(
    new URL("index.json", OUT),
    JSON.stringify(
      {
        generated: TODAY,
        schemaVersion: 1,
        note: "granularity: 'group' = position of each political group; 'totals' = for/against/abstention counts; 'outcome' = adopted/rejected only.",
        covered,
        notCovered: NOT_COVERED,
      },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
