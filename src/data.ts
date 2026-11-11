// Data access. Election results are queried live from the data.gouv.fr tabular API;
// Assemblée nationale data is read from files produced by `npm run sync:an`.

const TABULAR = "https://tabular-api.data.gouv.fr/api/resources";

export interface Election {
  year: number;
  /** data.gouv.fr resource holding results by department (both rounds). */
  resourceId: string;
  candidates: Record<string, { color: string; party: string }>;
}

export const ELECTIONS: Election[] = [
  {
    year: 2022,
    resourceId: "4341e25f-f339-4833-a532-b81519784e88",
    candidates: {
      MACRON: { color: "#F2A900", party: "LREM" },
      "LE PEN": { color: "#0D2C6C", party: "RN" },
      "MÉLENCHON": { color: "#C9302C", party: "LFI" },
      ZEMMOUR: { color: "#5C3A21", party: "Reconquête" },
      "PÉCRESSE": { color: "#2E6FD8", party: "LR" },
      JADOT: { color: "#3E9B48", party: "EELV" },
      LASSALLE: { color: "#8E7CC3", party: "Résistons !" },
      ROUSSEL: { color: "#E0115F", party: "PCF" },
      "DUPONT-AIGNAN": { color: "#4C6A92", party: "DLF" },
      HIDALGO: { color: "#F06292", party: "PS" },
      POUTOU: { color: "#B71C1C", party: "NPA" },
      ARTHAUD: { color: "#7F0000", party: "LO" },
    },
  },
];

export interface CandidateResult {
  nom: string;
  prenom: string;
  voix: number;
  pct: number; // % of votes cast
}
export interface AreaResult {
  code: string;
  name: string;
  inscrits: number;
  votants: number;
  exprimes: number;
  candidates: CandidateResult[]; // sorted desc
}
export interface RoundResult {
  departments: Map<string, AreaResult>;
  national: AreaResult;
}

interface TabularRow {
  dep_code: string;
  dep_name: string;
  num_tour: number | boolean;
  inscrits_nb: number;
  votants_nb: number;
  exprimes_nb: number;
  cand_nom: string;
  cand_prenom: string;
  cand_nb_voix: number;
}

async function fetchAllRows(resourceId: string): Promise<TabularRow[]> {
  const size = 200;
  const url = (p: number) => `${TABULAR}/${resourceId}/data/?page_size=${size}&page=${p}`;
  const first = await fetchJson<{ data: TabularRow[]; meta: { total: number } }>(url(1));
  const pages = Math.ceil(first.meta.total / size);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchJson<{ data: TabularRow[] }>(url(i + 2))));
  return [first, ...rest].flatMap((r) => r.data);
}

const cache = new Map<string, Promise<[RoundResult, RoundResult]>>();

/** Both rounds of a presidential election, by department + national totals. */
export function presidentialResults(e: Election) {
  if (!cache.has(e.resourceId)) {
    cache.set(
      e.resourceId,
      fetchAllRows(e.resourceId).then((rows) => {
        const round = (n: number): RoundResult => {
          const departments = new Map<string, AreaResult>();
          for (const r of rows.filter((r) => Number(r.num_tour) === n)) {
            const code = normaliseDep(r.dep_code);
            let a = departments.get(code);
            if (!a) departments.set(code, (a = { code, name: r.dep_name, inscrits: r.inscrits_nb, votants: r.votants_nb, exprimes: r.exprimes_nb, candidates: [] }));
            a.candidates.push({ nom: r.cand_nom, prenom: r.cand_prenom, voix: r.cand_nb_voix, pct: 0 });
          }
          const nat: AreaResult = { code: "FR", name: "France", inscrits: 0, votants: 0, exprimes: 0, candidates: [] };
          const natVotes = new Map<string, CandidateResult>();
          for (const a of departments.values()) {
            nat.inscrits += a.inscrits;
            nat.votants += a.votants;
            nat.exprimes += a.exprimes;
            for (const c of a.candidates) {
              c.pct = (100 * c.voix) / a.exprimes;
              const n = natVotes.get(c.nom) ?? { ...c, voix: 0 };
              n.voix += c.voix;
              natVotes.set(c.nom, n);
            }
            a.candidates.sort((x, y) => y.voix - x.voix);
          }
          nat.candidates = [...natVotes.values()].map((c) => ({ ...c, pct: (100 * c.voix) / nat.exprimes })).sort((x, y) => y.voix - x.voix);
          return { departments, national: nat };
        };
        return [round(1), round(2)];
      }),
    );
  }
  return cache.get(e.resourceId)!;
}

/** Ministry codes use "ZA".."ZZ" for overseas; map them to INSEE codes used by the map. */
function normaliseDep(code: string) {
  const map: Record<string, string> = { ZA: "971", ZB: "972", ZC: "973", ZD: "974", ZM: "976", ZN: "988", ZP: "987", ZS: "975", ZW: "986", ZX: "977", ZZ: "99" };
  return map[code] ?? code;
}

// ---------- Assemblée nationale ----------
export interface Depute {
  id: string;
  civ: string;
  prenom: string;
  nom: string;
  alpha: string;
  naissance: string | null;
  profession: string | null;
  catSocPro: string | null;
  famSocPro: string | null;
  hatvp: string | null;
  email: string | null;
  socials: Record<string, string>;
  /** where each account was found (merged from socials.json) */
  socialSources?: Record<string, { source: string; confidence: string }>;
  groupe: { id: string; abrev: string; libelle: string; couleur: string } | null;
  region: string | null;
  departement: string | null;
  numDepartement: string | null;
  numCirco: number | null;
  circo: string | null;
  /** the day the MP took the seat (later than the election for substitutes and returning ministers) */
  debutMandat: string;
  elected?: string;
  entree?: "general" | "byelection" | "returned" | "substitute";
  /** the Assembly's wording of how the seat was obtained */
  cause?: string | null;
  stats: { pour: number; contre: number; abstention: number; nonVotant: number; scrutins: number; participation: number };
}
/** [numero, date, titre, sort, demandeur, pour, contre, abstentions] */
export type Scrutin = [number, string, string, string, string, number, number, number];

const memo = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
};
/** MPs, with accounts found by scripts/sync-socials.mjs merged over the ones declared to the Assemblée. */
export const loadDeputes = memo(async () => {
  type Found = Record<string, Record<string, { url: string; handle?: string; source: string; confidence: string }>>;
  const [deps, found] = await Promise.all([
    fetchJson<Depute[]>("/data/an/deputes.json"),
    fetchJson<Found>("/data/an/socials.json").catch((): Found => ({})),
  ]);
  for (const d of deps) {
    const f = found[d.id];
    if (!f) continue;
    d.socialSources = {};
    for (const [platform, acc] of Object.entries(f)) {
      if (!acc?.url) continue;
      d.socials[platform] = acc.url;
      d.socialSources[platform] = { source: acc.source, confidence: acc.confidence };
    }
  }
  return deps;
});
export const loadScrutins = memo(() => fetchJson<Scrutin[]>("/data/an/scrutins.json"));
export const loadAnMeta = memo(() => fetchJson<{ syncedAt: string }>("/data/an/meta.json"));
export const loadVotes = (id: string) => fetchJson<Record<string, "P" | "C" | "A" | "N">>(`/data/an/votes/${id}.json`);
export const loadDepartements = memo(() => fetchJson<GeoJSON.FeatureCollection>("/data/geo/departements.geojson"));
export const loadCircoGeo = (dep: string) => fetchJson<GeoJSON.FeatureCollection>(`/data/geo/circo/${dep}.geojson`);

// ---------- polls, markets, legislative results ----------
import type { PollFile } from "./lib/polls";
export const loadPolls = (key: "2027" | "2022" | "legislatives-2024") => (pollCache[key] ??= fetchJson<PollFile>(`/data/polls/${key}.json`));
const pollCache: Record<string, Promise<PollFile>> = {};

export interface Market {
  platform: string;
  id: string;
  question: string;
  url: string;
  volume: number;
  outcomes: { name: string; prob: number }[];
}
export const loadMarkets = memo(() => fetchJson<{ fetchedAt: string; markets: Market[]; errors: { platform: string; error: string }[] }>("/data/markets.json"));

export interface Leg24 {
  source: string;
  resource: string;
  national: { inscrits: number; votants: number; exprimes: number; nuances: Record<string, number> };
  circos: Record<string, { e: number; c: [string, number, string][] }>;
}
export const loadLeg24 = memo(() => fetchJson<Leg24>("/data/results/legislatives-2024-t1.json"));

/** Live: every 2024 first-round candidate in one district, from the data.gouv.fr tabular API. */
export async function districtResults2024(circo: string) {
  const code = circo.startsWith("99") ? "ZZ" + circo.slice(2) : circo;
  const url = `${TABULAR}/a04f8cae-c94d-4ade-804d-ec024ee554ac/data/?page_size=50&CodCirElec__exact=${code}`;
  const r = await fetchJson<{ data: { NomPsn: string; PrenomPsn: string; CodNuaCand: string; NbVoix: number; RapportExprimes: number; Elu: string; Inscrits: number; Votants: number; Exprimes: number }[] }>(url);
  // third-party data at runtime: coerce every field to the type it is used as (some end up in style attributes)
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const rows = (Array.isArray(r?.data) ? r.data : []).map((x) => ({
    NomPsn: repairDosMojibake(String(x.NomPsn ?? "")), PrenomPsn: repairDosMojibake(String(x.PrenomPsn ?? "")), CodNuaCand: String(x.CodNuaCand ?? ""),
    NbVoix: num(x.NbVoix), RapportExprimes: Math.max(0, Math.min(100, num(x.RapportExprimes))), Elu: String(x.Elu ?? ""),
    Inscrits: num(x.Inscrits), Votants: num(x.Votants), Exprimes: num(x.Exprimes),
  }));
  return { url, rows: rows.sort((a, b) => b.NbVoix - a.NbVoix) };
}

/**
 * The ministry's 2024 candidate file was written in a DOS code page (CP850) and read back as CP775 (Baltic
 * DOS) before reaching data.gouv.fr, so "Naïma" arrives as "Naŗma", "Hélène" as "HélŖne", "François" as
 * "Franćois". Both are single-byte code pages, so the damage is reversible: each CP775 letter that differs
 * from CP850 maps back through its byte. These are the upper halves (0x80–0xFF) of both code pages, letters
 * only, aligned by byte. None of the CP775 letters below occur in French names, so a string containing one
 * is treated as mojibake and fully mapped back; clean strings are returned unchanged.
 */
const CP775 = "ĆāģćłēŖŗīŹōĢ¢ŚśĀĪŻżźĄČĘŲŪęėįųūž▐ŌŃķĻļņĒ";
const CP850 = "ÇâàçêëèïîìôòûùÿáíúñÑÁÂÀãÃÊËÈÍÎÏÌÔÒÚÛÙýÝ";
const DOS_FIX = new Map([...CP775].map((c, i) => [c, CP850[i]]));
export function repairDosMojibake(s: string) {
  if (![...s].some((c) => DOS_FIX.has(c))) return s;
  return [...s].map((c) => DOS_FIX.get(c) ?? c).join("");
}

/**
 * Data the bots refresh several times a day (polls, markets, forecast, red/blue feed, local news) is read
 * in production straight from the public GitHub repo, so those commits don't need a new Vercel deployment
 * (each one is ~360 MB; see `ignoreCommand` in vercel.json). Everything else ships with the site.
 */
const LIVE = /^\/data\/(markets\.json|polls\/|forecast\/|feed\/|news\/|daily\/)/;
const LIVE_BASE = "https://raw.githubusercontent.com/nicbay/ThirdEstate/main/public";
export async function fetchJson<T>(url: string): Promise<T> {
  if (import.meta.env.PROD && LIVE.test(url)) {
    try {
      const live = await fetch(`${LIVE_BASE}${url}`, { cache: "no-cache" });
      if (live.ok) return (await live.json()) as T;
    } catch { /* GitHub unreachable: fall back to the copy deployed with the site */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}


// ---------- history ----------
export type Side = "left" | "centre" | "right" | "other";
export interface HistMedia { type: "tv" | "radio" | "newsreel" | "newspaper"; provider?: string; url: string; embed?: string | null; start?: number; title?: string; publisher?: string; date?: string | null }
export interface HistCandidate { id: string; name: string; party: string; family: string; side: Side; votes: number; pct: number; elected?: boolean; qualified?: boolean; other?: boolean }
export interface HistRound {
  id: string; round: number; date: string; decisive: boolean; turnoutPct: number | null;
  totals: { inscrits: number | null; votants: number | null; exprimes: number };
  candidates: HistCandidate[];
  departments: null | { count: number; coveragePct: number; rows: Record<string, { name: string; exprimes: number; votes: Record<string, number> }> };
  media: HistMedia | null; mediaAlternatives?: HistMedia[]; mediaSearched?: string;
  checks?: string[];
  sources: { national: { name: string; page?: string; permalink?: string; licence?: string } };
}
export interface HistElection {
  id: string; year: number; title: { fr: string; en: string }; regime: string | { id: string; fr: string; en: string };
  method: { fr: string; en: string }; direct: boolean;
  winner: { id: string; name: string; party: string; family: string; side: Side };
  rounds: HistRound[];
}
export interface HistIndex { elections: (Omit<HistElection, "rounds"> & { regime: string; rounds: { id: string; round: number; date: string; decisive: boolean; turnoutPct: number | null; top: { name: string; party: string; side: Side; pct: number }[]; departments: number; media: { type: string; url: string } | null }[] })[] }
export const loadHistIndex = memo(() => fetchJson<HistIndex>("/data/history/presidential/index.json"));
export const loadHistElection = (id: string) => fetchJson<HistElection>(`/data/history/presidential/${id}.json`);

/** [from, to, to − from] */
export type Triple = [number, number, number];
export interface ShiftUnit { lon: number; lat: number; name?: string; lr: Triple; farRight: Triple; centre: Triple; turnout: Triple; left: Triple; right: Triple }
export interface ShiftPair { from: number; to: number; fromId: string; toId: string; fromDate: string; toDate: string; level: "department" | "district"; national: Omit<ShiftUnit, "lon" | "lat">; units: Record<string, ShiftUnit> }
export const loadShifts = memo(() => fetchJson<{ metrics: Record<string, string>; pairs: ShiftPair[] }>("/data/history/legislative/shifts.json"));

// ---------- red / blue feed ----------
export interface FeedReaction {
  id: string; platform: string; url: string; time: string; text: string; handle?: string;
  mp: { id: string; name: string; group?: { abrev: string; libelle: string; couleur: string } };
  metrics?: { likes?: number; reposts?: number; replies?: number };
  rating?: {
    political: boolean;
    lean: { score: number; rationale_fr: string; rationale_en: string };
    populism: { score: number; markers: string[]; rationale_fr: string; rationale_en: string };
    check: null | { claim: string; why_fr: string; why_en: string; sources: { title: string; url: string }[] };
    model: string; ratedAt: string;
  };
}
export interface FeedStory { id: string; title: string; firstTime: string; lastTime: string; outlets: string[]; items: { outlet: string; title: string; link: string; time: string; summary?: string }[]; reactions?: FeedReaction[] }
export const loadFeed = () => fetchJson<{ generatedAt: string; windowHours: number; outlets: { id: string; name: string; lean: string }[]; counts: Record<string, number>; stories: FeedStory[] }>("/data/feed/latest.json");
