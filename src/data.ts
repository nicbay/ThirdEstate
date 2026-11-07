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
  groupe: { id: string; abrev: string; libelle: string; couleur: string } | null;
  region: string | null;
  departement: string | null;
  numDepartement: string | null;
  numCirco: number | null;
  debutMandat: string;
  stats: { pour: number; contre: number; abstention: number; nonVotant: number; scrutins: number; participation: number };
}
/** [numero, date, titre, sort, demandeur, pour, contre, abstentions] */
export type Scrutin = [number, string, string, string, string, number, number, number];

const memo = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
};
export const loadDeputes = memo(() => fetchJson<Depute[]>("/data/an/deputes.json"));
export const loadScrutins = memo(() => fetchJson<Scrutin[]>("/data/an/scrutins.json"));
export const loadAnMeta = memo(() => fetchJson<{ syncedAt: string }>("/data/an/meta.json"));
export const loadVotes = (id: string) => fetchJson<Record<string, "P" | "C" | "A" | "N">>(`/data/an/votes/${id}.json`);
export const loadDepartements = memo(() => fetchJson<GeoJSON.FeatureCollection>("/data/geo/departements.geojson"));

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}
