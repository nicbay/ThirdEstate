// "Le quiz : qui vous ressemble ?" (#/quiz). The landing page is the quiz: the first question of an express run
// is on it, and answering it starts the run. Every run draws its own questions from three kinds of source:
//   votes       real Assembly votes, where each candidate takes the line of their party's group(s);
//   programme   a measure from one candidate's own programme, asked without saying whose it is;
//   statement   a measure a candidate has announced publicly (no programme document yet), asked the same way.
// Two lengths:
//   Express:  SHORT_V votes and SHORT_M measures (one from each quarter of the left–right order), about three minutes.
//   Complete: LONG_V votes and PER_CAND measures from every candidate, about ten minutes; its results add the deal breakers.
// Both end on the same screens: the candidates ranked by weighted agreement, your place on the left–right axis
// (overall, then subject by subject), who proposed what, your closest MPs and groups.
// Data: public/data/an/quiz.json (scripts/build-quiz.mjs, which documents how the pool is chosen).
// Answers never leave the browser: everything is computed here, an unfinished run is kept in sessionStorage (this
// tab only), and the share link carries the answers in the URL hash (#/quiz/<code>), which browsers do not send.
import { setQuizResult } from "../lib/profile";
import "../styles/quiz.css";
import { toast } from "../lib/toast";
import { fetchJson, loadPolls } from "../data";
import { L, colon, fmtDate, fmtNum, fmtPct } from "../i18n";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { foxSvg } from "../lib/fox";
import { esc, safeColor, safeUrl } from "../util";
import { photoUrl } from "./deputes";
import { THEME_COLOR } from "./speeches";

type Pos = "P" | "C" | "A";
type Mode = "s" | "l";
type Two = { fr: string; en: string };
interface QuizQuestion { id: string; n: number; d: string; theme: string; hook: boolean; fr: { q: string; c: string }; en: { q: string; c: string } }
interface QuizGroup { libelle: string; couleur: string; n: number; line: string }
interface QuizCand { slug: string; name: string; pollName: string; photo: string | null; party: Two; groups: string[]; note: Two | null }
interface QuizMeasure { slug: string; id: string; theme: string; fr: string; en: string; text: string; src: { kind: "programme" | "statement"; year: number } }
/** [id, name, group, département, positions (one char per vote: P/C/A/-), …] */
type QuizMp = [string, string, string, string, string, string, string[]];
interface QuizData {
  generatedAt: string; rev: string; order: number[];
  questions: QuizQuestion[]; measures: QuizMeasure[]; candidates: QuizCand[];
  themes: { id: string; fr: string; en: string }[]; groups: Record<string, QuizGroup>; mps: QuizMp[];
}
interface Ans { p: Pos; w: boolean }
type Answers = Map<string, Ans>;

/** "This matters a lot to me" doubles a question. */
const IMPORTANT = 2;
/** A candidate's own measure counts double a vote of their group in the complete version, where every candidate has
 *  the same number of measures; in the express one, where only a few candidates have one, it counts as one vote. */
const ownWeight = (m: Mode) => (m === "l" ? 2 : 1);
/** What a run draws: express = SHORT_V votes + SHORT_M measures; complete = LONG_V votes + PER_CAND measures per candidate. */
const SHORT_V = 8, SHORT_M = 4, LONG_V = 14, PER_CAND = 2;
/** Answers needed before "see my results now" is offered. */
const MIN_NOW = 6;
/** Fewer comparable questions than this and a candidate (or an MP) is not ranked. */
const MIN_COMPARED = 3;
/** Weight of a neutral (½) pseudo-answer added to every score, so few shared questions pull the score towards 50 %. */
const PRIOR = 1;
const VAL: Record<Pos, number> = { P: 1, A: 0, C: -1 };

let dataP: Promise<QuizData> | null = null;
const loadQuiz = () => (dataP ??= fetchJson<QuizData>("/data/an/quiz.json"));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const themeName = (d: QuizData, id: string) => { const t = d.themes.find((x) => x.id === id); return t ? L(t.fr, t.en) : id; };

// Progress survives a language switch and a visit to another page (module state), and a reload (sessionStorage).
// `w` is the pending "very important" flag of the question on screen.
// `ts` is what this run asks; `all` is every question behind the results (more than `ts` when an express run
// is continued into a complete one: the answers already given are kept and not asked again).
interface Run { mode: Mode; step: number; a: Answers; started: boolean; w?: boolean; ts: string[]; all: string[]; shared?: boolean }
let st: Run | null = null;

const STORE = "te-quiz-run";
function saveRun(d: QuizData) {
  try {
    const s = st;
    if (!s || !s.started || s.step >= s.ts.length) sessionStorage.removeItem(STORE);
    else sessionStorage.setItem(STORE, JSON.stringify({ rev: d.rev, mode: s.mode, step: s.step, ts: s.ts, all: s.all, a: [...s.a].map(([k, v]) => [k, v.p, v.w]) }));
  } catch { /* private mode: the run simply does not survive a reload */ }
}
function savedRun(d: QuizData): Run | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
    const ok = (t: unknown): t is string => typeof t === "string" && /^[vm]\d+$/.test(t) && Number(t.slice(1)) < (t[0] === "v" ? d.questions.length : d.measures.length);
    if (!x || x.rev !== d.rev || !Array.isArray(x.ts) || !Array.isArray(x.all) || ![...x.ts, ...x.all].every(ok) || !(x.step >= 0 && x.step < x.ts.length)) return null;
    const a: Answers = new Map();
    for (const [k, p, w] of x.a ?? []) if (ok(k) && (p === "P" || p === "C" || (p === "A" && k[0] === "v"))) a.set(k, { p, w: !!w });
    return { mode: x.mode === "l" ? "l" : "s", step: x.step, a, started: true, ts: x.ts, all: x.all };
  } catch { return null; }
}

// ---------- share code: <version>-<stamp of the pool>-<three characters per question of the run> ----------
// two base-36 characters for the question (votes first, then measures), then one digit for the answer:
// 0 skipped, 1 for / agree, 2 against / disagree, 3 abstain, +4 when marked important
const POS: (Pos | null)[] = [null, "P", "C", "A"];
function encode(d: QuizData, m: Mode, all: string[], a: Answers) {
  const n = (t: string) => (t[0] === "v" ? 0 : d.questions.length) + Number(t.slice(1));
  return `${m}-${d.rev}-${all.map((t) => { const x = a.get(t); return n(t).toString(36).padStart(2, "0") + (x ? POS.indexOf(x.p) + (x.w ? 4 : 0) : 0); }).join("")}`;
}
function decode(code: string, d: QuizData): { mode: Mode; all: string[]; a: Answers } | null {
  const m = /^([sl])-([0-9a-z]+)-((?:[0-9a-z]{2}[0-7])+)$/.exec(code);
  if (!m || m[2] !== d.rev) return null;
  const all: string[] = [], a: Answers = new Map(), nV = d.questions.length;
  for (let i = 0; i < m[3].length; i += 3) {
    const g = parseInt(m[3].slice(i, i + 2), 36), x = Number(m[3][i + 2]);
    const key = g < nV ? `v${g}` : `m${g - nV}`;
    if (g >= nV + d.measures.length || all.includes(key)) return null;
    all.push(key);
    const p = POS[x % 4];
    if (p && !(key[0] === "m" && p === "A")) a.set(key, { p, w: x >= 4 });
  }
  return { mode: m[1] as Mode, all, a };
}

// ---------- questions ----------
interface Q { key: string; kind: "v" | "m"; k: number; theme: string; q: string; ctx: string; vote?: QuizQuestion; measure?: QuizMeasure }
function question(d: QuizData, key: string): Q {
  const k = Number(key.slice(1));
  if (key[0] === "v") { const v = d.questions[k]; return { key, kind: "v", k, theme: v.theme, q: L(v.fr.q, v.en.q), ctx: L(v.fr.c, v.en.c), vote: v }; }
  const m = d.measures[k];
  return { key, kind: "m", k, theme: m.theme, q: L(m.fr, m.en), ctx: "", measure: m };
}

// ---------- scoring ----------
interface Item { q: Q; u: Pos; agree: number; w: number; important: boolean; theirs: string }
interface CandScore { c: QuizCand; s: number | null; n: number; same: number; items: Item[] }
/** A candidate's position on a vote: the lines of the group(s) standing for them (see `groups` in the candidate file). */
function lines(d: QuizData, c: QuizCand, k: number): Pos[] {
  return c.groups.map((g) => d.groups[g]?.line[k]).filter((x): x is Pos => x === "P" || x === "C" || x === "A");
}
/**
 * Agreement with one candidate. On a vote: 1 if your position is their group's, ½ if one of you abstained, 0 if
 * opposite (the mean over the groups when two stand in). On one of their own measures: 1 if you agree, 0 if not.
 * Score = weighted share of agreement, with one neutral half-point so two questions cannot give 100 %.
 */
function scoreCand(d: QuizData, c: QuizCand, a: Answers, own: number): CandScore {
  const items: Item[] = [];
  for (const [key, ans] of a) {
    const q = question(d, key);
    const imp = ans.w ? IMPORTANT : 1;
    if (q.kind === "v") {
      const ls = lines(d, c, q.k);
      if (!ls.length) continue;
      const agree = ls.reduce((s, l) => s + 1 - Math.abs(VAL[ans.p] - VAL[l]) / 2, 0) / ls.length;
      items.push({ q, u: ans.p, agree, w: imp, important: ans.w, theirs: [...new Set(ls)].join("/") });
    } else if (q.measure!.slug === c.slug) {
      items.push({ q, u: ans.p, agree: ans.p === "P" ? 1 : 0, w: imp * own, important: ans.w, theirs: "P" });
    }
  }
  const sw = items.reduce((s, i) => s + i.w, 0), sa = items.reduce((s, i) => s + i.w * i.agree, 0);
  return { c, items, n: items.length, same: items.filter((i) => i.agree === 1).length, s: items.length >= MIN_COMPARED ? (sa + PRIOR / 2) / (sw + PRIOR) : null };
}
function scoreVotes(pos: string, d: QuizData, a: Answers) {
  let sw = 0, sa = 0, n = 0;
  for (const [key, ans] of a) {
    if (key[0] !== "v") continue;
    const m = pos[Number(key.slice(1))] as Pos | "-";
    if (m !== "P" && m !== "C" && m !== "A") continue;
    const w = ans.w ? IMPORTANT : 1;
    sw += w; sa += w * (1 - Math.abs(VAL[ans.p] - VAL[m]) / 2); n++;
  }
  return n ? { s: (sa + PRIOR / 2) / (sw + PRIOR), n } : null;
}

// ---------- the left–right axis ----------
// The 13 candidates stand at equal intervals in the site's left-to-right order. Each answer that splits them
// puts you at the average place of the candidates on your side (a vote), or at its author's place (a measure you
// agree with; disagreeing with one candidate says nothing about where you are). Your position is the weighted
// mean of those places: overall, then subject by subject.
interface Placed { theme: string; x: number; w: number }
function placements(d: QuizData, order: QuizCand[], a: Answers): Placed[] {
  const xOf = new Map(order.map((c, i) => [c.slug, i / (order.length - 1)]));
  const out: Placed[] = [];
  for (const [key, ans] of a) {
    const q = question(d, key), w = ans.w ? IMPORTANT : 1;
    if (q.kind === "m") { if (ans.p === "P") out.push({ theme: q.theme, x: xOf.get(q.measure!.slug)!, w }); continue; }
    if (ans.p === "A") continue;
    let forW = 0, forX = 0, agW = 0, agX = 0;
    for (const c of order) {
      const ls = lines(d, c, q.k);
      if (!ls.length) continue;
      const v = ls.reduce((s, l) => s + VAL[l], 0) / ls.length, x = xOf.get(c.slug)!;
      if (v > 0) { forW += v; forX += v * x; } else if (v < 0) { agW -= v; agX -= v * x; }
    }
    if (!forW || !agW) continue; // everyone on one side: the vote says nothing about left and right
    out.push({ theme: q.theme, x: ans.p === "P" ? forX / forW : agX / agW, w });
  }
  return out;
}
const mean = (ps: Placed[]) => (ps.length ? ps.reduce((s, p) => s + p.w * p.x, 0) / ps.reduce((s, p) => s + p.w, 0) : null);

// ---------- the draw: which questions a run asks, and in what order ----------
const rnd = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** How well a set of votes tells the candidates apart: the sum over pairs of candidates of their distance on these
 *  votes, each pair counting up to three votes' worth (the measure build-quiz.mjs sorts the votes by). */
function separation(d: QuizData, ks: number[]) {
  const cv = d.candidates.map((c) => ks.map((k) => { const ls = lines(d, c, k); return ls.length ? ls.reduce((s, l) => s + VAL[l], 0) / ls.length : null; }));
  let total = 0;
  for (let i = 0; i < cv.length; i++) for (let j = i + 1; j < cv.length; j++) {
    let dist = 0;
    ks.forEach((_, x) => { const p = cv[i][x], q = cv[j][x]; if (p != null && q != null) dist += Math.abs(p - q) / 2; });
    total += Math.min(3, dist);
  }
  return total;
}
/** `n` votes at random (at most two per subject, `keep` always in, one well-known "hook" vote to open on), taking
 *  the best of sixteen random draws by `separation`: no two runs alike, none that leaves the candidates in a heap. */
function drawVotes(d: QuizData, n: number, keep: number[] = []): number[] {
  const rest = d.questions.map((_, k) => k).filter((k) => !keep.includes(k));
  const hooks = rest.filter((k) => d.questions[k].hook);
  let best = keep, bestS = -1;
  for (let t = 0; t < 16; t++) {
    const pick = [...keep];
    if (hooks.length && pick.length < n && !pick.some((k) => d.questions[k].hook)) pick.push(hooks[rnd(hooks.length)]);
    for (const k of shuffle(rest)) {
      if (pick.length >= n) break;
      if (pick.includes(k) || pick.filter((p) => d.questions[p].theme === d.questions[k].theme).length >= 2) continue;
      pick.push(k);
    }
    const s = separation(d, pick);
    if (s > bestS) { bestS = s; best = pick; }
  }
  return best;
}
/** Complete: PER_CAND measures of every candidate (a programme measure and a public announcement when they have both).
 *  Express: SHORT_M measures, one candidate drawn from each quarter of the left–right order, so every run crosses the
 *  whole spectrum; of twelve such draws, the one with the most subjects and both kinds of source. */
function drawMeasures(d: QuizData, mode: Mode, keep: number[] = []): number[] {
  const of = (slug: string) => d.measures.map((m, i) => ({ m, i })).filter((x) => x.m.slug === slug);
  if (mode === "l") return d.candidates.flatMap((c) => {
    const mine = of(c.slug), pick = mine.filter((x) => keep.includes(x.i)).slice(0, PER_CAND);
    const pool = shuffle(mine.filter((x) => !pick.includes(x)));
    while (pick.length < PER_CAND && pool.length) {
      const j = pick.length ? pool.findIndex((x) => x.m.src.kind !== pick[0].m.src.kind) : 0;
      pick.push(pool.splice(Math.max(0, j), 1)[0]);
    }
    return pick.map((x) => x.i);
  });
  const order = [...d.candidates].sort((x, y) => spectrumRank(x.pollName) - spectrumRank(y.pollName));
  const blocs = Array.from({ length: SHORT_M }, (_, b) => order.slice(Math.round((b * order.length) / SHORT_M), Math.round(((b + 1) * order.length) / SHORT_M))).filter((b) => b.length);
  let best: number[] = [], bestS = -1;
  for (let t = 0; t < 12; t++) {
    const pick = blocs.map((b) => { const mine = of(b[rnd(b.length)].slug); return mine[rnd(mine.length)]; }).filter(Boolean);
    const s = new Set(pick.map((x) => x.m.theme)).size + 2 * new Set(pick.map((x) => x.m.src.kind)).size;
    if (s > bestS) { bestS = s; best = pick.map((x) => x.i); }
  }
  return best;
}
/** The order of a run: it opens on a well-known vote, votes and measures alternate in proportion, a candidate's two
 *  measures are a round apart, and the same subject does not come twice in a row where a swap can avoid it. */
function arrange(d: QuizData, votes: number[], measures: number[]): string[] {
  const v = shuffle(votes);
  const h = v.findIndex((k) => d.questions[k].hook);
  if (h > 0) [v[0], v[h]] = [v[h], v[0]];
  const rounds: number[][] = [];
  for (const i of shuffle(measures)) { const r = rounds.find((x) => !x.some((j) => d.measures[j].slug === d.measures[i].slug)); if (r) r.push(i); else rounds.push([i]); }
  const m = rounds.flat();
  const out: string[] = [];
  for (let vi = 0, mi = 0; vi < v.length || mi < m.length;) {
    if (vi < v.length && (mi >= m.length || vi * m.length <= mi * v.length)) out.push(`v${v[vi++]}`);
    else out.push(`m${m[mi++]}`);
  }
  const theme = (t: string) => question(d, t).theme;
  for (let i = 1; i < out.length; i++) if (theme(out[i]) === theme(out[i - 1])) {
    const j = out.findIndex((t, x) => x > i && t[0] === out[i][0] && theme(t) !== theme(out[i - 1]) && theme(out[i]) !== theme(out[x - 1]));
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** The questions of a new run. `keep`: answers already given (an express run continued into a complete one). */
function drawRun(d: QuizData, mode: Mode, keep: string[] = []): string[] {
  const kv = keep.filter((t) => t[0] === "v").map((t) => Number(t.slice(1))), km = keep.filter((t) => t[0] === "m").map((t) => Number(t.slice(1)));
  return arrange(d, drawVotes(d, mode === "l" ? LONG_V : SHORT_V, kv), [...new Set([...km, ...drawMeasures(d, mode, km)])]);
}
const freshRun = (d: QuizData, mode: Mode = "s", started = false): Run => { const ts = drawRun(d, mode); return { mode, step: 0, a: new Map(), started, ts, all: ts }; };

// ---------- abroad: the closest well-known politicians in the reader's own country ----------
// public/data/quiz-abroad.json: for seven countries, eight well-known figures and their stance (P/C) on the general
// idea behind some of the quiz's questions, coded from their public record. Far rougher than the French side (the
// idea, not the French text; other institutions; fewer questions), which the section says, with the number of
// questions each rate rests on.
interface AbroadFigure { name: string; role: Two; s: Record<string, "P" | "C"> }
interface AbroadCountry { code: string; name: Two; figures: AbroadFigure[] }
let abroadP: Promise<{ rev: string; countries: AbroadCountry[] }> | null = null;
const loadAbroad = () => (abroadP ??= fetchJson<{ rev: string; countries: AbroadCountry[] }>("/data/quiz-abroad.json"));
/** Fewer comparable questions than this and a foreign figure is not ranked. */
const MIN_ABROAD = 2;
/** Small flags drawn as pixels' worth of rectangles (emoji flags do not render on Windows). */
const FLAGS: Record<string, string> = {
  us: `<rect width="30" height="20" fill="#fff"/>${[0, 2, 4, 6].map((i) => `<rect y="${i * 2.86}" width="30" height="2.86" fill="#b22234"/>`).join("")}<rect width="13" height="11.4" fill="#3c3b6e"/>${[2, 5, 8, 11].flatMap((x) => [2, 5, 8].map((y) => `<rect x="${x - 0.6}" y="${y}" width="1.2" height="1.2" fill="#fff"/>`)).join("")}`,
  gb: `<rect width="30" height="20" fill="#012169"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.6"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6.4"/><path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="3.6"/>`,
  de: `<rect width="30" height="6.67" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/><rect y="13.33" width="30" height="6.67" fill="#ffce00"/>`,
  it: `<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/>`,
  es: `<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>`,
  ca: `<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#d80621"/><rect x="22.5" width="7.5" height="20" fill="#d80621"/><path d="M15 3l1.6 3 2.4-1-.8 4 3-1.4-.6 2.2 1.8.8-3.6 3 .4 1.6-3.6-.6V17h-1.2v-2.4l-3.6.6.4-1.6-3.6-3 1.8-.8-.6-2.2 3 1.4-.8-4 2.4 1z" fill="#d80621"/>`,
  be: `<rect width="10" height="20" fill="#000"/><rect x="10" width="10" height="20" fill="#fdda24"/><rect x="20" width="10" height="20" fill="#ef3340"/>`,
};
const flag = (code: string) => `<svg class="qz-flag" viewBox="0 0 30 20" width="30" height="20" aria-hidden="true">${FLAGS[code] ?? ""}</svg>`;
/** Agreement with a foreign figure on the questions both the reader and the figure have a position on. */
function scoreAbroad(f: AbroadFigure, a: Answers) {
  let sw = 0, sa = 0, n = 0;
  for (const [key, ans] of a) {
    const t = f.s[key];
    if (!t) continue;
    const w = ans.w ? IMPORTANT : 1;
    sw += w; sa += w * (ans.p === "A" ? 0.5 : ans.p === t ? 1 : 0); n++;
  }
  return n >= MIN_ABROAD ? { s: (sa + PRIOR / 2) / (sw + PRIOR), n } : null;
}

// ---------- page ----------
export async function renderQuiz(app: HTMLElement, code?: string) {
  const [d, polls] = await Promise.all([loadQuiz(), loadPolls("2027").catch(() => null)]);
  if (polls) registerParties(polls.parties);
  const shared = code ? decode(code, d) : null;
  if (shared) st = { mode: shared.mode, step: shared.all.length, a: shared.a, started: true, ts: shared.all, all: shared.all, shared: true };
  else if (!st || (st.step >= st.ts.length && !code)) st = freshRun(d);
  const stale = !!code && !shared;

  app.innerHTML = `
    <section class="page quiz-page qz-page">
      <div class="qz-headrow">
      <header class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027", "2027 presidential")}</p>
        <h1>${L("Le quiz : qui vous ressemble ?", "The quiz: who is closest to you?")}</h1>
        <p class="dek">${L(`${d.candidates.length} candidats, leurs votes, leurs programmes, leurs annonces. Duquel êtes-vous vraiment le plus proche ?`, `${d.candidates.length} candidates, their votes, their programs, their announcements. Which one are you really closest to?`)}</p>
      </header>
      <div class="qz-side" id="qz-side"></div>
      </div>
      ${stale ? `<p class="qz-stale">${L("Ce lien de résultats correspond à une ancienne série de questions : il ne peut plus être relu. Vous pouvez refaire le quiz.", "This results link was made for an earlier set of questions and can no longer be read. You can take the quiz again.")}</p>` : ""}
      <div class="quiz qz" id="quiz"></div>
      ${methodNote(d)}
    </section>`;
  draw(app.querySelector<HTMLElement>("#quiz")!, d, 1);
}

let keyHandler: ((e: KeyboardEvent) => void) | null = null;
function bindKeys(stage: HTMLElement, fn: ((e: KeyboardEvent) => void) | null) {
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = fn && ((e) => {
    if (!document.body.contains(stage)) { document.removeEventListener("keydown", keyHandler!); keyHandler = null; return; }
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || document.querySelector("dialog[open]")) return;
    fn(e);
  });
  if (keyHandler) document.addEventListener("keydown", keyHandler);
}

/** Starts a run in place (another draw, the complete version, a resumed run): the frame is rebuilt. */
function begin(stage: HTMLElement, d: QuizData, run: Run) {
  st = run;
  if (location.pathname !== "/quiz" || location.hash) history.replaceState(null, "", "/quiz");
  saveRun(d);
  stage.innerHTML = "";
  draw(stage, d, 1);
  keepInView(stage);
}

/** Moves one question forward or back. The run's frame (back button, progress, keys line) stays put; only the
 *  question card is swapped, so nothing above or below it is rebuilt. The first answer, given on the landing page,
 *  starts the run: what surrounds the card there is taken away, the card staying where it is on screen. */
function go(stage: HTMLElement, d: QuizData, delta: 1 | -1) {
  const s = st!;
  if (delta < 0 && s.step === 0) return;
  s.w = false;
  if (!s.started) {
    s.started = true;
    const run = stage.querySelector<HTMLElement>(":scope > .qz-run"), y0 = run?.getBoundingClientRect().top ?? 0;
    stage.closest(".qz-page")?.querySelectorAll(".qz-only-intro").forEach((el) => el.remove());
    stage.classList.remove("is-intro");
    if (run) window.scrollBy(0, run.getBoundingClientRect().top - y0);
  }
  s.step = Math.max(0, s.step + delta);
  if (s.step >= s.ts.length) history.replaceState(null, "", `/quiz/${encode(d, s.mode, s.all, s.a)}`);
  saveRun(d);
  draw(stage, d, delta);
  keepInView(stage);
}

/** Where a question comes from, as shown on its card. */
function origin(q: Q): { cls: string; label: string; more: string; note: string } {
  if (q.kind === "v") return { cls: "v", label: L("Vote à l’Assemblée", "Assembly vote"), more: fmtDate(q.vote!.d), note: "" };
  const src = q.measure!.src, hidden = L("Son auteur est révélé avec vos résultats.", "Its author is revealed with your results.");
  if (src.kind === "statement") return { cls: "s", label: L("Annonce publique", "Public announcement"), more: L("d’un candidat", "by a candidate"),
    note: `${L("Position annoncée publiquement par un des candidats (discours, entretien, annonce de campagne), reformulée en termes neutres.", "A position one of the candidates has announced publicly (speech, interview, campaign announcement), reworded in neutral terms.")} ${hidden}` };
  const old = src.year < 2026 ? ` ${src.year}` : "";
  return { cls: "p", label: L(`Programme${old}`, `${old ? `${src.year} program` : "Program"}`), more: L("d’un candidat", "of a candidate"),
    note: `${L(`Mesure tirée du programme${old} d’un des candidats, reformulée en termes neutres.`, `A measure taken from one candidate’s${old} program, reworded in neutral terms.`)} ${hidden}` };
}

function draw(stage: HTMLElement, d: QuizData, dir: 1 | -1) {
  const s = st!;
  const ts = s.ts;
  const side = stage.closest(".qz-page")?.querySelector<HTMLElement>("#qz-side");
  if (s.step >= ts.length) {
    bindKeys(stage, null);
    stage.classList.remove("is-intro");
    if (side) side.innerHTML = "";
    results(stage, d);
    // no live region on the quiz: focus carries the reader to the new content, so it is read out once
    const h = stage.querySelector<HTMLElement>(".qz-results h2, .qz-q");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    return;
  }
  const q = question(d, ts[s.step]);
  const ans = s.a.get(q.key);
  const total = ts.length;
  const isVote = q.kind === "v";

  // the frame: built once per run, then only updated. On the landing page it sits between the two halves of the intro.
  let run = stage.querySelector<HTMLElement>(":scope > .qz-run");
  const fresh = !run;
  if (!run) {
    const intro = !s.started;
    stage.classList.toggle("is-intro", intro);
    if (side) side.innerHTML = intro ? introSide(d) : "";
    stage.innerHTML = `${intro ? introTop(d, total) : ""}<div class="qz-run">
      <div class="qz-top">
        <button type="button" class="qz-back"><span aria-hidden="true">←</span> ${L("Retour", "Back")}</button>
        <div class="qz-progress" role="progressbar" aria-label="${L("Progression du quiz", "Quiz progress")}" aria-valuemin="0" aria-valuemax="${total}">${ts.map(() => "<i></i>").join("")}</div>
        <span class="qz-count" aria-hidden="true"></span>
      </div>
      <div class="qz-stage"></div>
      <div class="qz-under">
        <button type="button" class="qz-now" hidden>${L("Voir mes résultats maintenant", "See my results now")} <i aria-hidden="true">→</i></button>
        <p class="qz-keys muted small">${L("Clavier : 1, 2, 3 pour répondre, I pour « important », 0 pour passer, ← pour revenir.", "Keyboard: 1, 2, 3 to answer, I for “important”, 0 to skip, ← to go back.")}</p>
      </div>
    </div>${intro ? introBelow(d) : ""}`;
    run = stage.querySelector<HTMLElement>(".qz-run")!;
    run.querySelector(".qz-back")!.addEventListener("click", () => go(stage, d, -1));
    // enough answers to rank: the rest of the run can be left unanswered
    run.querySelector(".qz-now")!.addEventListener("click", () => { const r = st!; r.step = r.ts.length - 1; go(stage, d, 1); });
    stage.querySelector(".qz-go-long")?.addEventListener("click", () => begin(stage, d, freshRun(d, "l", true)));
    stage.querySelector(".qz-go-short")?.addEventListener("click", () => begin(stage, d, { ...st!, started: true }));
    stage.querySelector(".qz-redraw")?.addEventListener("click", () => { st = freshRun(d); stage.innerHTML = ""; draw(stage, d, 1); });
    stage.querySelector(".qz-resume")?.addEventListener("click", () => { const r = savedRun(d); if (r) begin(stage, d, r); });
  }
  const back = run.querySelector<HTMLButtonElement>(".qz-back")!;
  back.disabled = s.step === 0;
  const bar = run.querySelector<HTMLElement>(".qz-progress")!;
  bar.setAttribute("aria-valuenow", String(s.step));
  bar.setAttribute("aria-valuetext", L(`Question ${s.step + 1} sur ${total}`, `Question ${s.step + 1} of ${total}`));
  bar.querySelectorAll("i").forEach((el, i) => { el.className = i < s.step ? (s.a.has(ts[i]) ? "is-done" : "is-skip") : i === s.step ? "is-now" : ""; });
  run.querySelector(".qz-count")!.innerHTML = `${s.step + 1}<span>/${total}</span>`;
  run.querySelector<HTMLElement>(".qz-now")!.hidden = !(s.a.size >= MIN_NOW && s.step < total - 1);

  // the question card
  const opt = (p: Pos, n: number, label: string, icon: string) =>
    `<button type="button" class="qz-ans qz-ans-${p}" data-a="${p}" aria-pressed="${ans?.p === p}"><span class="qz-ans-i" aria-hidden="true">${icon}</span><span class="qz-ans-l">${label}</span><kbd aria-hidden="true">${n}</kbd></button>`;
  const from = origin(q);
  const card = document.createElement("div");
  card.className = "qz-card";
  card.innerHTML = `
      <p class="qz-kicker"><span class="qz-src qz-src-${from.cls}">${from.label}</span><span>${from.more}</span><span class="qz-kt"><i style="background:${THEME_COLOR[q.theme] ?? "var(--other)"}"></i>${esc(themeName(d, q.theme))}</span></p>
      <h2 class="qz-q" tabindex="-1"><span class="sr-only">${L(`Question ${s.step + 1} sur ${total} : `, `Question ${s.step + 1} of ${total}: `)}</span>${esc(q.q)}</h2>
      <p class="qz-ctx">${isVote
        ? `${esc(q.ctx)} <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${q.vote!.n}" target="_blank" rel="noopener">${L(`Scrutin n° ${q.vote!.n}`, `Vote no. ${q.vote!.n}`)} ↗</a>`
        : from.note}</p>
      <div class="qz-answers${isVote ? "" : " is-two"}" role="group" aria-label="${L("Votre position", "Your position")}">
        ${isVote ? opt("P", 1, L("Pour", "For"), "✓") + opt("C", 2, L("Contre", "Against"), "✕") + opt("A", 3, L("Abstention", "Abstain"), "–")
          : opt("P", 1, L("D’accord", "Agree"), "✓") + opt("C", 2, L("Pas d’accord", "Disagree"), "✕")}
      </div>
      <div class="qz-foot">
        <button type="button" class="qz-weight" aria-pressed="false"><span aria-hidden="true">★</span> ${L("C’est très important pour moi", "This matters a lot to me")} <kbd aria-hidden="true">I</kbd></button>
        <button type="button" class="qz-skip">${L("Sans avis · passer", "No opinion · skip")} <kbd aria-hidden="true">0</kbd></button>
      </div>`;

  // the "important" toggle applies to the answer about to be given, or to the one already there
  s.w = ans?.w ?? false;
  const wb = card.querySelector<HTMLButtonElement>(".qz-weight")!;
  wb.setAttribute("aria-pressed", String(s.w));
  const toggleW = () => { s.w = !s.w; wb.setAttribute("aria-pressed", String(s.w)); const cur = s.a.get(q.key); if (cur) cur.w = !!s.w; };
  let busy = false;
  // a short beat on the picked answer, so the choice is seen before the next question slides in
  const next = (wait: number) => { busy = true; setTimeout(() => go(stage, d, 1), reduced() ? 60 : wait); };
  const pick = (p: Pos) => {
    if (busy || (!isVote && p === "A")) return;
    s.a.set(q.key, { p, w: !!s.w });
    card.querySelectorAll<HTMLElement>(".qz-ans").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.a === p)));
    next(220);
  };
  const skip = () => { if (busy) return; s.a.delete(q.key); next(80); };
  card.querySelectorAll<HTMLButtonElement>(".qz-ans").forEach((b) => b.addEventListener("click", () => pick(b.dataset.a as Pos)));
  wb.addEventListener("click", toggleW);
  card.querySelector(".qz-skip")!.addEventListener("click", skip);
  bindKeys(stage, (e) => {
    if (busy) return;
    if (e.key === "1") pick("P");
    else if (e.key === "2") pick("C");
    else if (e.key === "3") pick("A");
    else if (e.key === "0" || e.key === "ArrowRight") skip();
    else if (e.key === "i" || e.key === "I" || e.key === "*") toggleW();
    else if (e.key === "ArrowLeft" && s.step > 0) go(stage, d, -1);
    else return;
    e.preventDefault();
  });

  const box = run.querySelector<HTMLElement>(".qz-stage")!;
  const hadFocus = stage.contains(document.activeElement) && document.activeElement !== document.body;
  swapCard(box, card, fresh ? 0 : dir);
  // keep the reader's place: focus moves to the new question (read out by screen readers), without scrolling
  if (hadFocus || !fresh) card.querySelector<HTMLElement>(".qz-q")!.focus({ preventScroll: true });
}

/** Replaces the question card in place: the old one fades out, the new one slides in from the side it came
 *  from, and the box eases from the old height to the new one, so the page under it never jumps. */
function swapCard(box: HTMLElement, card: HTMLElement, dir: 0 | 1 | -1) {
  box.querySelectorAll(".qz-card.is-leaving").forEach((el) => el.remove());
  const prev = box.querySelector<HTMLElement>(".qz-card");
  box.getAnimations().forEach((a) => a.cancel());
  if (!prev || reduced() || typeof box.animate !== "function") {
    box.replaceChildren(card);
    if (!prev && !reduced() && typeof card.animate === "function") card.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    return;
  }
  const h0 = box.offsetHeight;
  prev.classList.add("is-leaving");
  prev.setAttribute("aria-hidden", "true");
  prev.inert = true;
  box.append(card);
  const h1 = card.offsetHeight;
  const ease = "cubic-bezier(0.16, 1, 0.3, 1)", dx = 28 * (dir || 1);
  box.classList.add("is-swapping");
  const grow = box.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 300, easing: ease });
  const out = prev.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dx}px)` }], { duration: 150, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  const enter = card.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], { duration: 300, delay: 70, easing: ease, fill: "backwards" });
  const done = () => { prev.remove(); box.classList.remove("is-swapping"); };
  out.finished.then(() => prev.remove(), () => prev.remove());
  grow.finished.then(done, done);
  // a background tab pauses animations: never leave two cards stacked
  setTimeout(() => { if (prev.isConnected) { [out, grow, enter].forEach((a) => a.finish()); done(); } }, 600);
}

/** After a step, bring the card back into view on small screens (the page header sits above it). */
function keepInView(stage: HTMLElement) {
  const r = stage.getBoundingClientRect();
  if (r.top < 110 || r.top > innerHeight * 0.5) window.scrollTo({ top: scrollY + r.top - 120, behavior: reduced() ? "auto" : "smooth" });
}

/** Beside the page title: the candidates on the left–right line with the reader's fox still in the middle (the
 *  result, before the answers). */
function introSide(d: QuizData) {
  const order = [...d.candidates].sort((x, y) => spectrumRank(x.pollName) - spectrumRank(y.pollName));
  return `<section class="qz-only-intro qz-spec qz-hero is-on" aria-label="${L("Ce que le quiz compare", "What the quiz compares")}">
      <div class="qz-axis" aria-hidden="true">
        <div class="qz-you" style="--x:50%"><span>${L("Vous ?", "You?")}</span>${foxSvg(32, true)}</div>
        <div class="qz-line"></div>
        ${order.map((c, i) => `<span class="qz-face" style="--x:${((100 * i) / (order.length - 1)).toFixed(2)}%;--c:${colorOf(c)};--i:${i}">${face(c, 40)}<span>${esc(meta(c.pollName).surname)}</span></span>`).join("")}
      </div>
      <div class="qz-ends" aria-hidden="true"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
    </section>`;
}

/** One of the three experiences, as a box: a big figure, what it is, and one clear button. Shared with the
 *  "Who said it?" page (quiz-quotes.ts), so the three are presented the same way wherever they are offered. */
export function quizBox(o: { cls?: string; big: string; unit: string; title: string; text: string; cta: string; href?: string; primary?: boolean }) {
  const btn = `<span class="qz-exp-go">${o.cta} <i aria-hidden="true">→</i></span>`;
  const inner = `<span class="qz-exp-n"><b>${o.big}</b><span>${o.unit}</span></span><span class="qz-exp-t">${o.title}</span><span class="qz-exp-d">${o.text}</span>${btn}`;
  const cls = `qz-exp-b${o.primary ? " is-primary" : ""}${o.cls ? ` ${o.cls}` : ""}`;
  return o.href ? `<a class="${cls}" href="${o.href}">${inner}</a>` : `<button type="button" class="${cls}">${inner}</button>`;
}
/** The three boxes. `skip` leaves one out (the page the reader is already on). */
export function quizBoxes(nShort: number, nLong: number, nCand: number, skip?: "s" | "l" | "q") {
  const boxes = [
    skip === "s" ? "" : quizBox({ cls: "qz-go-short", primary: true, big: String(nShort), unit: L("questions · 3 min", "questions · 3 min"), title: L("Le quiz express", "The express quiz"),
      text: L("Des votes, des programmes et des annonces, tirés au sort. À la fin : le candidat le plus proche de vous et votre place de la gauche à la droite.", "Votes, programs and announcements, drawn at random. At the end: the candidate closest to you and your place from left to right."), cta: L("Commencer", "Start"), href: skip ? "#/quiz" : undefined }),
    skip === "l" ? "" : quizBox({ cls: "qz-go-long", big: String(nLong), unit: L("questions · 10 min", "questions · 10 min"), title: L("Le quiz complet", "The complete quiz"),
      text: L(`Deux mesures de chacun des ${nCand} candidats, sans leur nom. À la fin : vos points de rupture, et qui proposait quoi.`, `Two measures from each of the ${nCand} candidates, unnamed. At the end: your deal breakers, and who proposed what.`), cta: L("Faire le complet", "Take the full one"), href: skip ? "#/quiz" : undefined }),
    skip === "q" ? "" : quizBox({ cls: "qz-go-quotes", big: "10", unit: L("citations · 2 min", "quotes · 2 min"), title: L("Qui a dit ça ?", "Who said it?"),
      text: L("Des phrases qui ont fait parler, toutes réelles, tweets compris. Retrouvez leur auteur, et méfiez-vous du judoka.", "Lines that got people talking, all real, tweets included. Find who said each one, and watch out for the judoka."), cta: L("Deviner", "Guess"), href: "#/quiz/citations" }),
  ].filter(Boolean);
  return `<div class="qz-exp" style="--n:${boxes.length}">${boxes.join("")}</div>`;
}

/** Above the first question: the three experiences, a run to pick up again if there is one, and what answering starts. */
function introTop(d: QuizData, total: number) {
  const saved = savedRun(d);
  return `<div class="qz-only-intro">${quizBoxes(total, LONG_V + PER_CAND * d.candidates.length, d.candidates.length)}</div>
    ${saved ? `<button type="button" class="qz-only-intro qz-resume"><b>${L("Reprendre votre quiz en cours", "Pick up your quiz where you left off")}</b><span>${L(`question ${saved.step + 1} sur ${saved.ts.length}`, `question ${saved.step + 1} of ${saved.ts.length}`)}</span><i aria-hidden="true">→</i></button>` : ""}
    <p class="qz-only-intro qz-pitch"><b>${L("Ou commencez tout de suite", "Or start right here")}</b><span>${L(`question 1 sur ${total} du quiz express`, `question 1 of ${total} of the express quiz`)}</span><button type="button" class="qz-redraw">${L("Tirer d’autres questions", "Draw other questions")} <i aria-hidden="true">↻</i></button></p>`;
}

/** Below the first question: the faces on a narrow screen, what the questions are made of, what the reader can count on. */
function introBelow(d: QuizData) {
  const nS = d.measures.filter((m) => m.src.kind === "statement").length, nP = d.measures.length - nS;
  const tile = (cls: string, n: number, strong: string, rest: string) => `<li class="is-${cls}"><b>${n}</b><span><strong>${strong}</strong> ${rest}</span></li>`;
  return `<div class="qz-only-intro qz-below">
      <div class="qz-hero-m">${introSide(d)}</div>
      <ul class="qz-srcs" aria-label="${L("Ce dont les questions sont faites", "What the questions are made of")}">
        ${tile("v", d.questions.length, L("votes réels", "real votes"), L("de l’Assemblée nationale", "of the National Assembly"))}
        ${tile("p", nP, L("mesures", "measures"), L("tirées de leurs programmes", "from their programs"))}
        ${tile("s", nS, L("annonces publiques", "public announcements"), L("des candidats", "by the candidates"))}
      </ul>
      <ul class="qz-trust">
        <li>${L("Vos réponses restent dans votre navigateur", "Your answers stay in your browser")}</li>
        <li>${L("Sans compte ni e-mail", "No account, no email")}</li>
        <li>${L("Chaque question renvoie à sa source", "Every question links to its source")}</li>
        <li>${L("Une proximité, pas une consigne de vote", "Closeness, not voting advice")}</li>
      </ul>
    </div>`;
}

// ---------- results ----------
const pctS = (x: number) => fmtPct(100 * x, 0);
const posWord = (q: Q, p: string): string => (q.kind === "m" ? (p === "P" ? L("D’accord", "Agree") : L("Pas d’accord", "Disagree")) : p === "P" ? L("Pour", "For") : p === "C" ? L("Contre", "Against") : p === "A" ? L("Abstention", "Abstain") : p.split("/").map((x) => posWord(q, x)).join(" / "));
const face = (c: QuizCand, size: number, cls = "") => (c.photo
  ? `<img class="qz-ph ${cls}" src="${esc(safeUrl(c.photo))}" alt="" width="${size}" height="${size}" data-hide-broken>`
  : `<span class="qz-ph qz-ph-none ${cls}" style="width:${size}px;height:${size}px"></span>`);
const colorOf = (c: QuizCand) => safeColor(meta(c.pollName).color, "#8d949a");

function results(stage: HTMLElement, d: QuizData) {
  const s = st!, a = s.a, long = s.mode === "l";
  const ts = s.all;
  saveRun(d); // the run is over: nothing to resume
  const nAns = a.size;
  if (nAns < MIN_COMPARED) {
    stage.innerHTML = `<div class="qz-card qz-in-fwd"><h2 class="qz-q">${L("Encore quelques réponses", "A few more answers")}</h2>
      <p class="qz-ctx">${L(`Répondez à au moins ${MIN_COMPARED} questions pour obtenir un classement : vous en avez passé ${ts.length - nAns} sur ${ts.length}.`, `Answer at least ${MIN_COMPARED} questions to get a ranking: you skipped ${ts.length - nAns} of ${ts.length}.`)}</p>
      <button type="button" class="qz-cta" id="qz-resume">${L("Reprendre le quiz", "Back to the quiz")}</button></div>`;
    stage.querySelector("#qz-resume")!.addEventListener("click", () => { s.step = 0; history.replaceState(null, "", "/quiz"); stage.innerHTML = ""; draw(stage, d, -1); });
    return;
  }
  const order = [...d.candidates].sort((x, y) => spectrumRank(x.pollName) - spectrumRank(y.pollName));
  const scored = d.candidates.map((c) => scoreCand(d, c, a, ownWeight(s.mode)));
  const ranked = scored.filter((r): r is CandScore & { s: number } => r.s != null).sort((x, y) => y.s - x.s || y.n - x.n);
  const unranked = scored.filter((r) => r.s == null);
  const top = ranked[0];
  const ties = top ? ranked.filter((r) => Math.abs(r.s - top.s) < 0.005) : [];
  const nImportant = [...a.values()].filter((x) => x.w).length;
  const code = encode(d, s.mode, ts, a);
  // express: the complete version keeps these answers and asks only what it still needs
  const more = long ? [] : drawRun(d, "l", [...a.keys()]);
  const moreAsk = more.filter((t) => !a.has(t));

  // ----- items of a candidate, sorted into the three lists -----
  const itemLi = (c: QuizCand, i: Item) => `<li>
      <p>${i.important ? `<span class="qz-star" title="${L("Important pour vous", "Important to you")}">★</span> ` : ""}${esc(i.q.q)}</p>
      ${i.q.kind === "m" ? `<p class="qz-quote" lang="fr">« ${esc(i.q.measure!.text.length > 240 ? `${i.q.measure!.text.slice(0, 240)}…` : i.q.measure!.text)} »</p>` : ""}
      <p class="qz-vs"><span class="qz-pos qz-pos-${i.u}">${L("Vous", "You")}${colon()}${posWord(i.q, i.u)}</span>${i.q.kind === "v" ? `<span class="qz-pos qz-pos-${i.theirs.length === 1 ? i.theirs : "X"}">${esc(c.groups.join(" + "))}${colon()}${posWord(i.q, i.theirs)}</span>` : `<span class="qz-pos qz-pos-own">${L("Sa mesure", "Their measure")}</span>`}
      ${i.q.kind === "m" ? `<a class="small" href="#/programmes/${esc(c.slug)}#m-${esc(i.q.measure!.id)}">${L("La mesure dans son programme", "The measure in their program")} →</a>` : `<a class="small" href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${i.q.vote!.n}" target="_blank" rel="noopener">${L(`Scrutin n° ${i.q.vote!.n}`, `Vote no. ${i.q.vote!.n}`)} ↗</a>`}</p></li>`;
  const own = (x: Item, y: Item) => Number(y.q.kind === "m") - Number(x.q.kind === "m") || Number(y.important) - Number(x.important);
  const list = (c: QuizCand, items: Item[], max = 6) => `<ul class="qz-items">${items.slice(0, max).map((i) => itemLi(c, i)).join("")}</ul>${items.length > max ? `<p class="muted small">${L(`et ${items.length - max} autres`, `and ${items.length - max} more`)}</p>` : ""}`;
  const detail = (r: CandScore, isTop: boolean) => {
    const against = r.items.filter((i) => i.agree === 0).sort(own), breakers = against.filter((i) => i.important), other = against.filter((i) => !i.important);
    const withThem = r.items.filter((i) => i.agree === 1).sort(own);
    const blocks: string[] = [];
    if (isTop) {
      blocks.push(`<div class="qz-block is-diff"><h4>${L("Là où vous divergez encore", "Where you still differ")} <b>${against.length}</b></h4>${against.length ? list(r.c, against) : `<p class="muted small">${L("Aucun désaccord sur les questions comparables.", "No disagreement on the comparable questions.")}</p>`}</div>`);
      blocks.push(`<div class="qz-block is-ok"><h4>${L("Ce que vous partagez", "What you share")} <b>${withThem.length}</b></h4>${list(r.c, withThem, 4)}</div>`);
    } else {
      blocks.push(`<div class="qz-block is-break"><h4>${L("Points de rupture", "Deal breakers")} <b>${breakers.length}</b></h4>${breakers.length ? list(r.c, breakers)
        : `<p class="muted small">${nImportant ? L("Aucun désaccord sur une question que vous avez marquée comme très importante.", "No disagreement on a question you marked as very important.") : L("Vous n’avez marqué aucune question comme très importante : rien ne peut être compté comme point de rupture.", "You marked no question as very important, so nothing can count as a deal breaker.")}</p>`}
        ${other.length ? `<details class="qz-more"><summary>${L(`${other.length} autre${other.length > 1 ? "s" : ""} désaccord${other.length > 1 ? "s" : ""}`, `${other.length} other disagreement${other.length > 1 ? "s" : ""}`)}</summary>${list(r.c, other, 12)}</details>` : ""}</div>`);
      blocks.push(`<div class="qz-block is-ok"><h4>${L("Ce qui pourrait être compatible", "What could be compatible")} <b>${withThem.length}</b></h4>${withThem.length ? list(r.c, withThem, 5) : `<p class="muted small">${L("Aucun accord complet sur les questions comparables.", "No full agreement on the comparable questions.")}</p>`}</div>`);
    }
    return `<div class="qz-detail">${blocks.join("")}
      <p class="qz-links"><a href="#/programmes/${esc(r.c.slug)}">${L("Son programme, mesure par mesure", "Their program, measure by measure")} →</a><a href="#/candidat/${esc(r.c.slug)}">${L("Sa fiche", "Their profile")} →</a></p></div>`;
  };
  const row = (r: CandScore & { s: number }, i: number) => {
    const col = colorOf(r.c), isTop = ties.includes(r);
    const nB = r.items.filter((x) => x.agree === 0 && x.important).length;
    return `<li class="qz-row${isTop ? " is-top" : ""}" style="--c:${col};--i:${i}"><details${i === 0 ? " open" : ""}>
      <summary><span class="qz-rk">${i + 1}</span>${face(r.c, 44)}
        <span class="qz-who"><b>${esc(r.c.name)}</b><span>${esc(L(r.c.party.fr, r.c.party.en))}${r.c.note ? " *" : ""}</span></span>
        <span class="qz-bar"><i style="width:${(100 * r.s).toFixed(1)}%"></i></span>
        <span class="qz-pct">${pctS(r.s)}</span>
        <span class="qz-meta">${L(`sur ${r.n} questions comparables`, `on ${r.n} comparable questions`)}${long && nB ? ` · <span class="qz-nb">${L(`${nB} point${nB > 1 ? "s" : ""} de rupture`, `${nB} deal breaker${nB > 1 ? "s" : ""}`)}</span>` : ""}</span>
      </summary>
      ${r.c.note ? `<p class="qz-note">* ${esc(L(r.c.note.fr, r.c.note.en))}</p>` : ""}
      ${detail(r, i === 0)}
    </details></li>`;
  };

  // ----- the axis -----
  const placed = placements(d, order, a);
  const x = mean(placed);
  const xPct = (v: number) => (100 * v).toFixed(2);
  const near = (v: number) => order.reduce((b, c, i) => (Math.abs(i / (order.length - 1) - v) < Math.abs(b.i / (order.length - 1) - v) ? { c, i } : b), { c: order[0], i: 0 });
  let where = "";
  if (x != null) {
    const step = 1 / (order.length - 1), n = near(x), off = x - n.i * step;
    const other = order[n.i + (off > 0 ? 1 : -1)];
    where = Math.abs(off) < step * 0.25 || !other
      ? L(`Sur cet axe, vos réponses vous placent au plus près de ${n.c.name}.`, `On this axis your answers put you closest to ${n.c.name}.`)
      : L(`Sur cet axe, vos réponses vous placent entre ${(off > 0 ? n.c : other).name} et ${(off > 0 ? other : n.c).name}.`, `On this axis your answers put you between ${(off > 0 ? n.c : other).name} and ${(off > 0 ? other : n.c).name}.`);
  }
  const byTheme = [...new Set(placed.map((p) => p.theme))].map((t) => { const ps = placed.filter((p) => p.theme === t); return { t, x: mean(ps)!, n: ps.length }; }).sort((p, q) => p.x - q.x);
  const spread = byTheme.length > 1 ? byTheme[byTheme.length - 1].x - byTheme[0].x : 0;
  const axis = x == null ? "" : `
    <section class="qz-spec" aria-labelledby="qz-spec-h">
      <p class="qz-spec-k">${L("Votre place", "Your place")}</p>
      <h2 id="qz-spec-h">${L("De la gauche à la droite, où vos réponses vous situent", "From left to right, where your answers put you")}</h2>
      <p class="qz-spec-where">${esc(where)}</p>
      <div class="qz-axis" role="img" aria-label="${esc(where)}">
        <div class="qz-you" style="--x:${xPct(x)}%"><span>${L("Vous", "You")}</span>${foxSvg(32, true)}</div>
        <div class="qz-line"></div>
        ${order.map((c, i) => `<a class="qz-face${top && ties.some((r) => r.c === c) ? " is-top" : ""}" href="#/candidat/${esc(c.slug)}" style="--x:${xPct(i / (order.length - 1))}%;--c:${colorOf(c)};--i:${i}" data-tip="${esc(`${c.name}\n${L(c.party.fr, c.party.en)}`)}" aria-label="${esc(c.name)}">${face(c, 40)}<span>${esc(meta(c.pollName).surname)}</span></a>`).join("")}
      </div>
      <div class="qz-ends"><span>${L("Gauche", "Left")}</span><span>${L("Droite", "Right")}</span></div>
      ${byTheme.length > 1 ? `
      <h3>${L("Mais vous n’êtes pas à un seul endroit", "But you are not in one place")}</h3>
      <p class="qz-spec-sub">${spread > 0.3
        ? L(`Sujet par sujet, vos réponses vont de « ${esc(themeName(d, byTheme[0].t))} », où vous êtes le plus à gauche, à « ${esc(themeName(d, byTheme[byTheme.length - 1].t))} », où vous êtes le plus à droite.`, `Subject by subject, your answers range from “${esc(themeName(d, byTheme[0].t))}”, where you are furthest left, to “${esc(themeName(d, byTheme[byTheme.length - 1].t))}”, where you are furthest right.`)
        : L("Sujet par sujet, vos réponses restent proches de votre position d’ensemble.", "Subject by subject, your answers stay close to your overall position.")}</p>
      <ul class="qz-themes">${byTheme.map((t, i) => { const n = near(t.x); return `<li style="--i:${i}">
          <span class="qz-tl">${esc(themeName(d, t.t))}</span>
          <span class="qz-track"><i class="qz-ghost" style="left:${xPct(x)}%"></i><i class="qz-dot" style="--from:${xPct(x)}%;--to:${xPct(t.x)}%;--c:${colorOf(n.c)}"></i></span>
          <span class="qz-tn"><b>${esc(meta(n.c.pollName).surname)}</b> <span>${t.n} ${L(t.n > 1 ? "réponses" : "réponse", t.n > 1 ? "answers" : "answer")}</span></span></li>`; }).join("")}</ul>
      <p class="qz-spec-note">${L("Le trait clair rappelle votre position d’ensemble ; le nom est le candidat le plus proche sur l’axe pour ce sujet.", "The pale tick is your overall position; the name is the nearest candidate on the axis for that subject.")}</p>` : ""}
      <p class="qz-spec-note">${L(`Comment c’est calculé : les ${order.length} candidats sont rangés à intervalles égaux, dans l’ordre gauche-droite utilisé partout sur le site. Chaque vote qui les départage vous place à la moyenne des candidats de votre camp ; chaque mesure que vous approuvez, à la place de son auteur. Votre position est la moyenne de ces ${placed.length} placements (les réponses très importantes comptent double). Un seul axe simplifie : il range sur une ligne des désaccords qui ne sont pas tous de même nature.`, `How this is computed: the ${order.length} candidates stand at equal intervals, in the left–right order used across the site. Each vote that splits them puts you at the average of the candidates on your side; each measure you agree with, at its author’s place. Your position is the mean of these ${placed.length} placements (very important answers count double). A single axis simplifies: it puts on one line disagreements that are not all of the same kind.`)}</p>
    </section>`;

  // ----- who proposed what -----
  const reveal = ts.filter((t) => t[0] === "m" && a.has(t)).map((t) => { const q = question(d, t), c = d.candidates.find((k) => k.slug === q.measure!.slug)!; return { q, c, u: a.get(t)! }; });

  // ----- MPs and groups (votes only) -----
  const nVotes = [...a.keys()].filter((k) => k[0] === "v").length;
  const minMp = Math.max(MIN_COMPARED, Math.ceil(nVotes / 2));
  const mps = d.mps.map((m) => ({ m, sc: scoreVotes(m[4], d, a) })).filter((r): r is { m: QuizMp; sc: { s: number; n: number } } => !!r.sc && r.sc.n >= minMp).sort((p, q) => q.sc.s - p.sc.s || q.sc.n - p.sc.n);
  const groups = Object.entries(d.groups).filter(([g]) => g !== "NI").map(([g, v]) => ({ g, v, sc: scoreVotes(v.line, d, a) })).filter((r): r is { g: string; v: QuizGroup; sc: { s: number; n: number } } => !!r.sc).sort((p, q) => q.sc.s - p.sc.s);
  const gcol = (g: string) => safeColor(d.groups[g]?.couleur, "#8d949a");

  // a results link someone shared shows their answers: only a run played here becomes the reader's own result
  if (!s.shared) setQuizResult({ code, top: top ? { slug: top.c.slug, name: top.c.name, score: top.s } : null, n: nAns });
  stage.innerHTML = `<div class="qz-results">
    ${top ? `<section class="qz-match" style="--c:${colorOf(top.c)}">
      <p class="qz-match-k">${ties.length > 1 ? L("Les candidats les plus proches de vos réponses, à égalité", "The candidates closest to your answers, tied") : L("Le candidat le plus proche de vos réponses", "The candidate closest to your answers")}</p>
      <div class="qz-match-in">
        <div class="qz-match-ph">${ties.slice(0, 3).map((r) => face(r.c, 120)).join("")}</div>
        <div>
          <h2>${ties.slice(0, 3).map((r) => `<a href="#/candidat/${esc(r.c.slug)}">${esc(r.c.name)}</a>`).join(`<span>${L(" et ", " and ")}</span>`)}</h2>
          <p class="qz-big"><span data-count="${Math.round(100 * top.s)}" data-suffix="${L(" %", "%")}">${pctS(top.s)}</span> <small>${L("d’accord, en tenant compte de ce qui compte pour vous", "agreement, weighted by what matters to you")}</small></p>
          <p class="qz-match-n">${L(`Calculé sur ${top.n} questions comparables, parmi vos ${nAns} réponses.`, `Based on ${top.n} comparable questions, out of your ${nAns} answers.`)}${ties.length > 1 ? ` ${long ? L("Vos réponses ne les départagent pas.", "Your answers do not separate them.") : L("Ces questions ne les départagent pas : la version complète, qui pose deux mesures de chacun, peut le faire.", "These questions do not separate them: the complete version, which asks two measures from each, can.")}` : ""}</p>
          ${long ? "" : `<p class="qz-match-n">${L(`Version express : un premier aperçu. ${ts.length} questions classent moins sûrement que ${LONG_V + PER_CAND * d.candidates.length}.`, `Express version: a first look. ${ts.length} questions rank less reliably than ${LONG_V + PER_CAND * d.candidates.length}.`)}</p>`}
        </div>
      </div>
      <p class="qz-disc">${L("Une proximité de réponses, pas une consigne de vote : ce classement ne dit rien de la personne, de sa crédibilité ni de ce qui n’a pas été demandé.", "Closeness of answers, not voting advice: this ranking says nothing about the person, their credibility, or anything that was not asked.")}</p>
    </section>` : `<div class="qz-card"><p class="qz-ctx">${L("Trop peu de réponses comparables pour classer les candidats.", "Too few comparable answers to rank the candidates.")}</p></div>`}

    <div class="qz-actions">
      ${long ? "" : `<button type="button" class="qz-cta" id="qz-longer">${L(`Affiner avec la version complète : ${moreAsk.length} questions de plus`, `Sharpen it with the complete version: ${moreAsk.length} more questions`)} <i aria-hidden="true">→</i></button>`}
      ${top && ties.length === 1 ? `<button type="button" class="qz-btn" data-my-cand="${esc(top.c.slug)}" data-name="${esc(top.c.name)}">${L(`Suivre ${esc(top.c.name)}`, `Follow ${esc(top.c.name)}`)}</button>` : ""}
      <a class="qz-btn" href="#/compte">${L("Mon profil citoyen", "My civic profile")} →</a>
      <button type="button" class="qz-btn" id="qz-share">${L("Copier le lien de mes résultats", "Copy a link to my results")}</button>
      <button type="button" class="qz-btn" id="qz-restart">${L("Recommencer", "Start again")}</button>
      <span class="qz-copied muted small" role="status"></span>
    </div>

    ${axis}

    <section class="card qz-cands" id="quiz-cands">
      <header class="card-head"><h2>${L("Les candidats, du plus proche au plus éloigné", "The candidates, closest first")}</h2><a href="#/programmes">${L("Comparer les programmes", "Compare the programs")}</a></header>
      <p class="prog-lede">${long
        ? L("Ouvrez un candidat pour voir vos points de rupture (désaccords sur ce que vous jugez très important) et ce qui pourrait être compatible.", "Open a candidate to see your deal breakers (disagreements on what you marked as very important) and what could be compatible.")
        : L("Version express : le score repose surtout sur les votes du groupe parlementaire qui représente chaque candidat. Ouvrez un candidat pour voir accords et désaccords.", "Express version: the score rests mostly on the votes of the parliamentary group standing for each candidate. Open a candidate to see where you agree and differ.")}</p>
      <ol class="qz-rank">${ranked.map(row).join("")}</ol>
      ${unranked.length ? `<p class="muted small">${L(`Pas assez de questions comparables (moins de ${MIN_COMPARED}) pour classer`, `Not enough comparable questions (fewer than ${MIN_COMPARED}) to rank`)} ${unranked.map((r) => esc(r.c.name)).join(", ")}.</p>` : ""}
      <p class="muted small">${L(`Score : part d’accord pondérée. Une question marquée très importante compte double ; une mesure du candidat compte ${long ? "double d’un vote de son groupe" : "comme un vote de son groupe"} ; un demi-point neutre évite qu’un score repose sur trois réponses. * : parti sans député, représenté par le ou les groupes les plus proches.`, `Score: weighted share of agreement. A question marked very important counts double; a candidate’s own measure counts ${long ? "double a vote of their group" : "as one vote of their group"}; a neutral half-point stops a score resting on three answers. *: party with no MPs, represented by the nearest group or groups.`)}</p>
    </section>

    ${reveal.length ? `<section class="card">
      <header class="card-head"><h2>${L("Qui proposait quoi", "Who proposed what")}</h2></header>
      <ul class="qz-reveal">${reveal.map((r) => `<li style="--c:${colorOf(r.c)}">
        <span class="qz-pos qz-pos-${r.u.p}">${r.u.w ? "★ " : ""}${posWord(r.q, r.u.p)}</span>
        <span class="qz-rq">${esc(r.q.q)} <small class="qz-rsrc">${origin(r.q).label}</small></span>
        <a class="qz-rc" href="#/programmes/${esc(r.c.slug)}#m-${esc(r.q.measure!.id)}">${face(r.c, 28)}<b>${esc(r.c.name)}</b></a></li>`).join("")}</ul>
      <p class="muted small">${long ? L("Chaque candidat a le même nombre de mesures dans la version complète.", "Every candidate has the same number of measures in the complete version.") : L("La version express tire une mesure dans chaque quart de l’éventail gauche-droite ; la version complète en pose deux de chaque candidat.", "The express version draws one measure from each quarter of the left–right range; the complete one asks two from every candidate.")} ${L("D’autres candidats peuvent défendre une mesure voisine : seul son auteur est compté.", "Other candidates may back a similar measure: only its author is counted.")}</p>
    </section>` : ""}

    ${quizBoxes(SHORT_V + SHORT_M, LONG_V + PER_CAND * d.candidates.length, d.candidates.length, long ? "l" : "s").replace('class="qz-exp"', 'class="qz-exp qz-exp-more"')}

    <section class="card qz-abroad">
      <header class="card-head"><h2>${L("Vous venez d’un de ces pays ?", "Are you from one of these countries?")}</h2></header>
      <p class="prog-lede">${L("Choisissez le vôtre : voici, chez vous, les personnalités politiques dont les positions connues se rapprochent le plus de vos réponses.", "Pick yours: here are the politicians at home whose known positions come closest to your answers.")}</p>
      <div class="qz-flags" role="group" aria-label="${L("Votre pays", "Your country")}">${[["us", "États-Unis", "United States"], ["gb", "Royaume-Uni", "United Kingdom"], ["de", "Allemagne", "Germany"], ["it", "Italie", "Italy"], ["es", "Espagne", "Spain"], ["ca", "Canada", "Canada"], ["be", "Belgique", "Belgium"]].map(([c, fr, en]) => `<button type="button" class="qz-flag-b" data-c="${c}" aria-pressed="false">${flag(c)}<span>${L(fr, en)}</span></button>`).join("")}</div>
      <div class="qz-abroad-out" id="qz-abroad" aria-live="polite"></div>
    </section>

    <section class="card">
      <header class="card-head"><h2>${L("À l’Assemblée : vos députés et groupes les plus proches", "In the Assembly: your closest MPs and groups")}</h2><span class="muted small">${L(`sur vos ${nVotes} réponses à des votes`, `on your ${nVotes} answers to votes`)}</span></header>
      ${mps.length ? `<ol class="quiz-rank">${mps.slice(0, 5).map((r, i) => `<li><span class="quiz-rk">${i + 1}</span>
        <img src="${photoUrl(r.m[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken />
        <span class="quiz-who"><a href="#/depute/${esc(r.m[0])}">${esc(r.m[1])}</a> <span class="chip" style="--c:${gcol(r.m[2])}">${esc(r.m[2])}</span></span>
        <span class="quiz-bar"><span style="width:${(100 * r.sc.s).toFixed(1)}%;background:${gcol(r.m[2])}"></span></span><b>${pctS(r.sc.s)}</b></li>`).join("")}</ol>
        <p class="muted small">${L(`${fmtNum(mps.length)} députés classés : ceux qui ont voté sur au moins ${minMp} des votes auxquels vous avez répondu.`, `${fmtNum(mps.length)} MPs ranked: those who voted on at least ${minMp} of the votes you answered.`)}</p>` : `<p class="muted">${L("Trop peu de réponses à des votes pour classer les députés.", "Too few answers to votes to rank MPs.")}</p>`}
      <ol class="quiz-bars">${groups.map((r, i) => `<li><span class="quiz-rk">${i + 1}</span>
        <span class="quiz-who"><span class="chip" style="--c:${gcol(r.g)}">${esc(r.g)}</span> <span class="quiz-lib">${esc(r.v.libelle)}</span></span>
        <span class="quiz-bar"><span style="width:${(100 * r.sc.s).toFixed(1)}%;background:${gcol(r.g)}"></span></span><b>${pctS(r.sc.s)}</b></li>`).join("")}</ol>
      <p class="muted small">${L("Position de chaque groupe : celle de la majorité de ses membres actuels qui ont voté.", "Each group’s position: that of the majority of its current members who voted.")}</p>
    </section>
  </div>`;

  // the fox walks to its place, then the subjects spread out, once the axis is on screen
  const spec = stage.querySelector<HTMLElement>(".qz-spec");
  if (spec) {
    const go = () => spec.classList.add("is-on");
    if (reduced() || !("IntersectionObserver" in window)) go();
    else { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); setTimeout(go, 150); } }, { threshold: 0.35 }); io.observe(spec.querySelector(".qz-axis")!); setTimeout(go, 4000); /* never leave the marker in the middle if the observer stays silent */ }
  }
  // abroad: the figures of the chosen country, closest first
  stage.querySelectorAll<HTMLButtonElement>(".qz-flag-b").forEach((b) => b.addEventListener("click", async () => {
    const box = stage.querySelector<HTMLElement>("#qz-abroad")!;
    stage.querySelectorAll(".qz-flag-b").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const data = await loadAbroad().catch(() => null);
    const c = data?.countries.find((x) => x.code === b.dataset.c);
    if (!data || !c || data.rev !== d.rev) { box.innerHTML = `<p class="muted small">${L("Ces comparaisons ne sont pas disponibles pour le moment.", "These comparisons are not available right now.")}</p>`; return; }
    const rows = c.figures.map((f) => ({ f, sc: scoreAbroad(f, a) })).filter((r): r is { f: AbroadFigure; sc: { s: number; n: number } } => !!r.sc).sort((p, q) => q.sc.s - p.sc.s || q.sc.n - p.sc.n);
    const none = c.figures.filter((f) => !scoreAbroad(f, a));
    box.innerHTML = rows.length ? `
      <ol class="qz-ab">${rows.map((r, i) => `<li class="${i === 0 ? "is-top" : ""}" style="--i:${i}"><span class="qz-rk">${i + 1}</span>
        <span class="qz-who"><b>${esc(r.f.name)}</b><span>${esc(L(r.f.role.fr, r.f.role.en))}</span></span>
        <span class="qz-bar"><i style="width:${(100 * r.sc.s).toFixed(1)}%"></i></span><span class="qz-pct">${pctS(r.sc.s)}</span>
        <span class="qz-meta">${L(`sur ${r.sc.n} question${r.sc.n > 1 ? "s" : ""}`, `on ${r.sc.n} question${r.sc.n > 1 ? "s" : ""}`)}</span></li>`).join("")}</ol>
      ${none.length ? `<p class="muted small">${L("Pas assez de questions en commun pour", "Not enough questions in common for")} ${none.map((f) => esc(f.name)).join(", ")}.</p>` : ""}
      <p class="muted small">${L("Un taux très approximatif : il compare vos réponses à la position publique connue de chacun sur l’idée générale de la question (taxer les grandes fortunes, légaliser l’aide à mourir, reculer l’âge de la retraite…), pas sur le texte français, et seulement là où cette position est documentée. Le nombre de questions est indiqué : en dessous de cinq, prenez-le comme un indice.", "A very rough rate: it compares your answers with each figure’s known public position on the general idea behind the question (taxing large fortunes, legalising assisted dying, raising the retirement age…), not on the French text, and only where that position is documented. The number of questions is shown: below five, take it as a hint.")}${long ? "" : ` ${L("La version complète compare sur environ trois fois plus de questions.", "The complete version compares on about three times as many questions.")}`}</p>`
      : `<p class="muted small">${L("Trop peu de vos réponses portent sur des questions comparables à l’étranger. La version complète en pose davantage.", "Too few of your answers are on questions that compare abroad. The complete version asks more of them.")}</p>`;
  }));
  stage.querySelector("#qz-restart")!.addEventListener("click", () => begin(stage, d, freshRun(d)));
  // keep the answers already given: this run only asks what the complete version still needs
  stage.querySelector("#qz-longer")?.addEventListener("click", () => begin(stage, d, { mode: "l", step: 0, a, started: true, ts: moreAsk, all: more }));
  stage.querySelector("#qz-share")!.addEventListener("click", async () => {
    const url = `${location.origin}/quiz/${code}`;
    const out = stage.querySelector<HTMLElement>(".qz-copied")!;
    try {
      await navigator.clipboard.writeText(url);
      out.textContent = "";
      toast(L("Lien copié. Il contient vos réponses ; rien n’est envoyé ailleurs.", "Link copied. It holds your answers; nothing is sent anywhere."), { uniqueID: "quiz-link" });
    } catch {
      out.innerHTML = `<input class="quiz-url" readonly value="${esc(url)}" aria-label="${L("Lien de vos résultats", "Link to your results")}" />`;
      out.querySelector<HTMLInputElement>("input")!.select();
    }
  });
}

function methodNote(d: QuizData) {
  const nC = d.candidates.length, nM = d.measures.length, nS = d.measures.filter((m) => m.src.kind === "statement").length;
  const nShort = SHORT_V + SHORT_M, nLong = LONG_V + PER_CAND * nC;
  return `<details class="quiz-method card">
    <summary>${L("Méthode, limites et confidentialité", "Method, limits and privacy")}</summary>
    <div class="prose">
      <p>${L(`<b>Les votes.</b> ${d.questions.length} scrutins publics de la 17e législature ont été retenus parmi les plus clivants, un ou deux par sujet, en variant le camp gagnant ; chaque question décrit ce que fait le texte et renvoie au scrutin officiel. Quand le vote portait sur la suppression du texte, les positions sont inversées pour que « Pour » signifie toujours pour la proposition. Chaque candidat y prend la position du ou des groupes de son parti.`,
        `<b>The votes.</b> ${d.questions.length} public votes of the 17th legislature were kept from among the most divisive, one or two per subject, varying which side won; each question describes what the text does and links to the official record. When the vote was on deleting the text, positions are flipped so that “For” always means for the proposal. Each candidate takes the position of their party’s group or groups.`)}</p>
      <p>${L(`<b>Les programmes et les annonces.</b> ${nM} mesures : ${nM / nC} pour chacun des ${nC} candidats, choisies dans le relevé de leur programme pour être des propositions concrètes, sur des sujets variés. Quand un candidat n’a pas encore publié de programme, ce sont ses annonces publiques (discours, entretiens, annonces de campagne) : ${nS} mesures sont dans ce cas, et la question l’indique. Toutes sont reformulées en termes neutres et posées sans nom d’auteur ; le texte du candidat et sa source sont donnés avec les résultats. Seul l’auteur d’une mesure est compté : nous ne supposons pas ce que les autres en pensent.`,
        `<b>Programs and announcements.</b> ${nM} measures: ${nM / nC} for each of the ${nC} candidates, chosen from the record of their program to be concrete proposals on varied subjects. When a candidate has not yet published a program, they are public announcements (speeches, interviews, campaign announcements): ${nS} measures are, and the question says so. All are reworded in neutral terms and asked without their author’s name; the candidate’s own wording and source come with the results. Only a measure’s author is counted: we do not assume what the others think of it.`)}</p>
      <p>${L(`<b>Le tirage.</b> Chaque partie tire ses questions au sort. La version express en pose ${nShort} : ${SHORT_V} votes (parmi seize tirages au hasard, celui qui départage le mieux les candidats) et ${SHORT_M} mesures, une d’un candidat tiré dans chaque quart de l’éventail gauche-droite. La version complète en pose ${nLong} : ${LONG_V} votes et ${PER_CAND} mesures de chaque candidat. L’ordre est tiré au sort lui aussi ; une partie s’ouvre sur un vote connu et évite de poser deux fois de suite le même sujet.`,
        `<b>The draw.</b> Each run draws its questions at random. The express version asks ${nShort}: ${SHORT_V} votes (of sixteen random draws, the one that best tells the candidates apart) and ${SHORT_M} measures, one from a candidate drawn in each quarter of the left–right range. The complete version asks ${nLong}: ${LONG_V} votes and ${PER_CAND} measures from every candidate. The order is random too; a run opens on a well-known vote and avoids the same subject twice in a row.`)}</p>
      <p>${L(`<b>Le calcul.</b> Sur un vote : 1 point si votre position est celle du groupe du candidat, ½ si l’un de vous s’abstient, 0 si elles s’opposent. Sur une mesure du candidat : 1 si vous êtes d’accord, 0 sinon. Une question marquée « très importante » compte double. Dans la version complète, où chaque candidat a le même nombre de mesures, une mesure compte deux fois plus qu’un vote de son groupe, parce que c’est son propre engagement ; dans la version express, où seuls ${SHORT_M} candidats en ont une, elle compte comme un vote. Le score est la part d’accord ainsi pondérée, avec un demi-point neutre ; il faut au moins ${MIN_COMPARED} questions comparables pour être classé. Un « point de rupture » est un désaccord complet sur une question que vous avez marquée très importante. Les députés et les groupes sont classés sur les seuls votes.`,
        `<b>The scoring.</b> On a vote: 1 point if your position is that of the candidate’s group, ½ if one of you abstains, 0 if opposite. On one of the candidate’s measures: 1 if you agree, 0 if not. A question marked “very important” counts double. In the complete version, where every candidate has the same number of measures, a measure counts double a vote of their group, because it is their own commitment; in the express version, where only ${SHORT_M} candidates have one, it counts as one vote. The score is that weighted share of agreement, with a neutral half-point; at least ${MIN_COMPARED} comparable questions are needed to be ranked. A “deal breaker” is a complete disagreement on a question you marked very important. MPs and groups are ranked on the votes alone.`)}</p>
      <p>${L(`<b>Les limites.</b> Un candidat n’est pas son groupe parlementaire : les votes sont ceux des députés de son parti, ou des groupes les plus proches quand il n’en a pas, ce qui est signalé. La version express est un premier aperçu : ${nShort} questions classent moins sûrement que ${nLong}, et deux tirages peuvent donner des classements voisins mais différents. Quelques dizaines de questions ne résument ni un programme ni une personne ; les programmes évoluent pendant la campagne. Sur une motion de censure seuls les votes pour existent : un député en fonction qui n’a pas voté pour est compté contre. Ce n’est ni un sondage ni une consigne de vote.`,
        `<b>Limits.</b> A candidate is not their parliamentary group: the votes are those of their party’s MPs, or of the nearest groups when it has none, which is flagged. The express version is a first look: ${nShort} questions rank less reliably than ${nLong}, and two draws can give close but different rankings. A few dozen questions sum up neither a program nor a person; programs change during the campaign. On a censure motion only votes for exist: a sitting MP who did not vote for it counts as against. This is neither a poll nor voting advice.`)}</p>
      <p>${L("<b>Vos réponses</b> ne quittent pas votre navigateur : tout est calculé sur votre appareil, rien n’est envoyé. Une partie en cours est gardée dans cet onglet seulement, pour survivre à un rechargement, et effacée dès qu’elle est finie. Le lien de partage contient vos réponses, codées dans l’adresse après le #, que les navigateurs ne transmettent pas aux serveurs.", "<b>Your answers</b> never leave your browser: everything is computed on your device, nothing is sent. A run in progress is kept in this tab only, to survive a reload, and erased as soon as it is finished. The share link holds your answers, encoded in the address after the #, which browsers do not send to servers.")}</p>
    </div>
    <p class="source">${L(`Sources : open data de l’Assemblée nationale (scrutins) et relevé des programmes du site ; jeu de données du quiz généré le ${fmtDate(d.generatedAt)}.`, `Sources: Assemblée nationale open data (votes) and the site’s record of the programs; quiz dataset built ${fmtDate(d.generatedAt)}.`)} <a href="#/programmes">${L("Les programmes", "The programs")}</a></p>
  </details>`;
}
