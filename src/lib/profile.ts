// The reader's profile: what the site remembers about them, in this browser and — once they sign in — in their
// account (Supabase table `profiles`, supabase/migrations/2026-11-27-profiles.sql), so it follows them across devices.
//
//   home       their town (cloud.ts getHome/setHome, key pv-home)
//   household  their figures in the budget simulator (views/household.ts, key te-household)
//   candidate  the candidate they follow            } political opinions: saved to the account only with the
//   quiz       their quiz result (top match, code)   } separate consent below; otherwise they stay in this browser
//
// Browser storage stays the source while signed out. On sign-in the two are merged field by field: a field edited
// in this browser since the account was last saved wins; otherwise the account fills the browser.
import type { User } from "@supabase/supabase-js";
import { cloud, currentUser, getHome, onAuth, onHome, setHome, type Home } from "./cloud";

export interface MyCandidate { slug: string; name: string; at: string }
export interface QuizResult { code: string; top: { slug: string; name: string; score: number } | null; n: number; at: string }
type Field = "home" | "household" | "candidate" | "quiz";

const CAND_KEY = "te-my-candidate", QUIZ_KEY = "te-quiz-result", HH_KEY = "te-household", EDIT_KEY = "te-profile-edits";
const SIGNUP_CONSENT = "te-signup-political";

const read = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? "null") as T | null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const slugOk = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);
const clipName = (s: unknown) => String(s ?? "").slice(0, 80);

// ---------- local fields ----------
export function getMyCandidate(): MyCandidate | null {
  const c = read<MyCandidate>(CAND_KEY);
  return c && slugOk(c.slug) ? { slug: c.slug, name: clipName(c.name), at: String(c.at ?? "") } : null;
}
export function setMyCandidate(c: { slug: string; name: string } | null) {
  write(CAND_KEY, c && slugOk(c.slug) ? { slug: c.slug, name: clipName(c.name), at: new Date().toISOString() } : null);
  touch("candidate");
}
export function getQuizResult(): QuizResult | null {
  const q = read<QuizResult>(QUIZ_KEY);
  if (!q || typeof q.code !== "string" || q.code.length > 400) return null;
  const top = q.top && slugOk(q.top.slug) ? { slug: q.top.slug, name: clipName(q.top.name), score: Math.max(0, Math.min(1, Number(q.top.score) || 0)) } : null;
  return { code: q.code, top, n: Number(q.n) || 0, at: String(q.at ?? "") };
}
export function setQuizResult(r: Omit<QuizResult, "at">) {
  write(QUIZ_KEY, { ...r, at: new Date().toISOString() });
  touch("quiz");
}
export const getHousehold = () => read<Record<string, unknown>>(HH_KEY);
/** The MP found for the reader's town (main.ts keeps it under te-my-mp). */
export function getMyMp(): { id: string; name?: string } | null {
  const m = read<{ code?: string; id?: string | null; name?: string }>("te-my-mp");
  const h = getHome();
  return m?.id && /^PA\d+$/.test(m.id) && m.code === h?.code ? { id: m.id, name: m.name } : null;
}

// ---------- change tracking ----------
const listeners = new Set<() => void>();
export const onProfile = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => { for (const fn of listeners) fn(); };
/** Mark a field as edited in this browser, and save it to the account when signed in. */
export function touch(f: Field) {
  const e = read<Record<string, string>>(EDIT_KEY) ?? {};
  e[f] = new Date().toISOString();
  write(EDIT_KEY, e);
  emit();
  queueSave();
}

// ---------- the account copy ----------
interface Row { home: Home | null; household: Record<string, unknown> | null; candidate: MyCandidate | null; quiz: QuizResult | null; consent_political_at: string | null; updated_at?: string; created_at?: string }
let user: User | null = null;
let row: Row | null = null;
let saving: Promise<void> | null = null;
let saveTimer = 0;
export type SyncState = "off" | "saving" | "saved" | "error";
let state: SyncState = "off";
export const syncState = () => state;
export const signedInUser = () => user;
export const politicalConsent = () => !!row?.consent_political_at;

function snapshot(): Row {
  const consent = row?.consent_political_at ?? null;
  return { home: getHome(), household: getHousehold(), candidate: consent ? getMyCandidate() : null, quiz: consent ? getQuizResult() : null, consent_political_at: consent };
}
function queueSave() {
  if (!cloud || !user) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 800);
}
async function save() {
  if (!cloud || !user) return;
  await saving;
  state = "saving"; emit();
  const body = { user_id: user.id, ...snapshot() };
  saving = (async () => {
    const { data, error } = await cloud!.from("profiles").upsert(body).select().single();
    if (error) { state = "error"; console.warn("profile save", error.message); }
    else { row = data as Row; state = "saved"; }
    emit();
  })();
  await saving;
}

/** Sign-in: bring the account and this browser together. */
async function merge(u: User) {
  if (!cloud) return;
  user = u;
  const { data, error } = await cloud.from("profiles").select("*").eq("user_id", u.id).maybeSingle();
  if (error) { state = "error"; emit(); return; }
  if (!data) {
    // a new account: the political consent chosen on the sign-up form (kept in the browser, and in the
    // account's metadata in case the link is opened in another browser)
    const asked = read<string>(SIGNUP_CONSENT) ?? (typeof u.user_metadata?.political_consent === "string" ? u.user_metadata.political_consent : null);
    row = { home: null, household: null, candidate: null, quiz: null, consent_political_at: asked };
    write(SIGNUP_CONSENT, null);
    await save();
    return;
  }
  row = data as Row;
  const edits = read<Record<string, string>>(EDIT_KEY) ?? {};
  const since = row.updated_at ?? "";
  const localWins = (f: Field, local: unknown) => local != null && (edits[f] ?? "") > since;
  let push = false;
  if (localWins("home", getHome())) push = true; else if (row.home) setHome(row.home);
  if (localWins("household", getHousehold())) push = true; else if (row.household) write(HH_KEY, row.household);
  if (localWins("candidate", getMyCandidate())) push = true; else if (row.candidate) write(CAND_KEY, row.candidate);
  if (localWins("quiz", getQuizResult())) push = true; else if (row.quiz) write(QUIZ_KEY, row.quiz);
  // fields the account lacks but this browser has
  if ((!row.home && getHome()) || (!row.household && getHousehold()) || (row.consent_political_at && ((!row.candidate && getMyCandidate()) || (!row.quiz && getQuizResult())))) push = true;
  state = "saved";
  emit();
  if (push) await save();
}

export async function setPoliticalConsent(on: boolean) {
  if (!cloud || !user) return;
  row = { ...(row ?? snapshot()), consent_political_at: on ? new Date().toISOString() : null };
  await save(); // without consent, the snapshot leaves candidate and quiz out: the account copy is cleared
}

/** The sign-up form's choices, kept until the link brings the reader back. */
export function rememberSignupConsent(political: boolean) { write(SIGNUP_CONSENT, political ? new Date().toISOString() : null); }

export async function sendSignupLink(email: string, political: boolean) {
  if (!cloud) throw new Error("offline");
  rememberSignupConsent(political);
  const { error } = await cloud.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/compte`, data: political ? { political_consent: new Date().toISOString() } : {} },
  });
  if (error) throw error;
}

/** Everything the account holds, as a file the reader keeps (GDPR right of access and portability). */
export async function exportAccount(): Promise<Blob> {
  const u = user ?? (await currentUser());
  const scenarios = cloud && u ? (await cloud.from("scenarios").select("name,data,created_at,updated_at").eq("user_id", u.id)).data ?? [] : [];
  const out = { exported_at: new Date().toISOString(), account: u ? { email: u.email, created_at: u.created_at } : null, profile: row, scenarios };
  return new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
}

export async function deleteAccount() {
  if (!cloud || !user) return;
  const { error } = await cloud.rpc("delete_my_account");
  if (error) throw error;
  row = null;
  await cloud.auth.signOut();
}

export function initProfile() {
  onHome(() => touch("home"));
  onAuth((u) => {
    if (u && u.id !== user?.id) void merge(u);
    if (!u) { user = null; row = null; state = "off"; emit(); }
  });
}
