// Optional backend (Supabase): accounts, saved scenarios, live visitors.
// Configured with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the anon key is public by design;
// access is restricted by row-level security, see supabase/schema.sql). Without them the site
// works offline: scenarios are saved in the browser and the live map shows only this visit.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const env = import.meta.env;
const url = (env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const key = (env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string | undefined;
export const cloud: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const cloudEnabled = () => !!cloud;

// ---------- where the visitor is from (asked, never inferred from the IP) ----------
/** Where the reader lives: the department (shared anonymously with live presence) and, once chosen, their town. */
export interface Home { dep: string; depName: string; commune?: string; code?: string }
const HOME_KEY = "pv-home";
export function getHome(): Home | null {
  try {
    // re-validate what comes back from storage: these values end up in links and regexes
    const h = JSON.parse(localStorage.getItem(HOME_KEY) ?? "null") as Home | null;
    if (!h || typeof h.dep !== "string" || !/^(\d{2,3}|2[AB])$/.test(h.dep)) return null;
    return {
      dep: h.dep, depName: String(h.depName ?? h.dep).slice(0, 80),
      ...(typeof h.commune === "string" ? { commune: h.commune.slice(0, 80) } : {}),
      ...(typeof h.code === "string" && /^(\d{5}|2[AB]\d{3})$/.test(h.code) ? { code: h.code } : {}),
    };
  } catch {
    return null;
  }
}
export function setHome(h: Home | null) {
  try {
    h ? localStorage.setItem(HOME_KEY, JSON.stringify(h)) : localStorage.removeItem(HOME_KEY);
  } catch {
    /* private mode */
  }
  presence?.track({ dep: h?.dep ?? null });
  for (const fn of homeListeners) fn(h);
}
const homeListeners = new Set<(h: Home | null) => void>();
export const onHome = (fn: (h: Home | null) => void) => (homeListeners.add(fn), () => homeListeners.delete(fn));

/** Postcode → communes, from the government's geo API (geo.api.gouv.fr). */
export async function lookupPostcode(cp: string) {
  const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(cp)}&fields=nom,codeDepartement,departement&format=json`);
  if (!r.ok) throw new Error(`geo.api.gouv.fr ${r.status}`);
  return (await r.json()) as { nom: string; code: string; codeDepartement: string; departement?: { nom: string } }[];
}

// ---------- live visitors (Realtime Presence: only a department code is shared) ----------
type Counts = Map<string, number>;
let presence: ReturnType<SupabaseClient["channel"]> | null = null;
const presenceListeners = new Set<(c: Counts, total: number) => void>();

export function joinPresence() {
  if (!cloud || presence) return;
  const id = crypto.randomUUID();
  presence = cloud.channel("visitors", { config: { presence: { key: id } } });
  presence
    .on("presence", { event: "sync" }, () => {
      const state = presence!.presenceState<{ dep: string | null }>();
      const counts: Counts = new Map();
      let total = 0;
      for (const metas of Object.values(state)) {
        total++;
        const dep = metas[0]?.dep;
        if (dep) counts.set(dep, (counts.get(dep) ?? 0) + 1);
      }
      for (const fn of presenceListeners) fn(counts, total);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") presence!.track({ dep: getHome()?.dep ?? null });
    });
}
export function onPresence(fn: (c: Counts, total: number) => void) {
  presenceListeners.add(fn);
  if (!cloud) {
    // offline: only this visit
    const h = getHome();
    fn(new Map(h ? [[h.dep, 1]] : []), 1);
  }
  return () => presenceListeners.delete(fn);
}

// ---------- accounts ----------
export async function currentUser(): Promise<User | null> {
  if (!cloud) return null;
  return (await cloud.auth.getUser()).data.user;
}
export async function sendLoginLink(email: string) {
  if (!cloud) throw new Error("offline");
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.hash } });
  if (error) throw error;
}
export const signOut = () => cloud?.auth.signOut();
export const onAuth = (fn: (u: User | null) => void) => cloud?.auth.onAuthStateChange((_e, s) => fn(s?.user ?? null));

// ---------- scenarios: cloud when signed in, browser storage otherwise ----------
export interface SavedScenario<T = unknown> { id: string; name: string; data: T; updated_at: string; cloud: boolean }
const LOCAL_KEY = "pv-scenarios";
const readLocal = (): SavedScenario[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const writeLocal = (list: SavedScenario[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
};

export async function listScenarios<T>(): Promise<SavedScenario<T>[]> {
  const local = readLocal() as SavedScenario<T>[];
  const user = await currentUser();
  if (!cloud || !user) return local;
  const { data } = await cloud.from("scenarios").select("id,name,data,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false });
  return [...(data ?? []).map((r) => ({ ...(r as Omit<SavedScenario<T>, "cloud">), cloud: true })), ...local];
}
export async function saveScenario<T>(name: string, data: T): Promise<SavedScenario<T>> {
  const user = await currentUser();
  const now = new Date().toISOString();
  if (cloud && user) {
    const { data: row, error } = await cloud.from("scenarios").insert({ user_id: user.id, name, data }).select("id,name,data,updated_at").single();
    if (error) throw error;
    return { ...(row as Omit<SavedScenario<T>, "cloud">), cloud: true };
  }
  const item: SavedScenario<T> = { id: crypto.randomUUID(), name, data, updated_at: now, cloud: false };
  writeLocal([item, ...readLocal()]);
  return item;
}
export async function deleteScenario(s: SavedScenario) {
  if (s.cloud && cloud) await cloud.from("scenarios").delete().eq("id", s.id);
  else writeLocal(readLocal().filter((x) => x.id !== s.id));
}
