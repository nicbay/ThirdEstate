// "Qui vous ressemble ?" (#/quiz): two versions of the same quiz.
//   Short: the ten Assembly votes that tell the 2027 candidates apart fastest (about two minutes).
//   Long:  fourteen votes and two measures from each candidate's own programme, asked without saying whose
//          they are (about eight minutes). Its results add, candidate by candidate, the deal breakers (what you
//          oppose and marked as important) and what could be compatible, and reveal who proposed what.
// Both end on the same screens: the candidates ranked by weighted agreement, your place on the left–right
// axis (overall, then subject by subject), your closest MPs and groups.
// Data: public/data/an/quiz.json (scripts/build-quiz.mjs, which documents how the questions are chosen).
// Answers never leave the browser: everything is computed here, and the share link carries them in the URL hash
// (#/quiz/<code>), which browsers do not send to any server.
import "../styles/quiz.css";
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
interface QuizQuestion { id: string; n: number; d: string; theme: string; fr: { q: string; c: string }; en: { q: string; c: string } }
interface QuizGroup { libelle: string; couleur: string; n: number; line: string }
interface QuizCand { slug: string; name: string; pollName: string; photo: string | null; party: Two; groups: string[]; note: Two | null }
interface QuizMeasure { slug: string; id: string; theme: string; fr: string; en: string; text: string }
/** [id, name, group, département, positions (one char per vote: P/C/A/-), …] */
type QuizMp = [string, string, string, string, string, string, string[]];
interface QuizData {
  generatedAt: string; rev: string; short: string[]; long: string[];
  questions: QuizQuestion[]; measures: QuizMeasure[]; candidates: QuizCand[];
  themes: { id: string; fr: string; en: string }[]; groups: Record<string, QuizGroup>; mps: QuizMp[];
}
interface Ans { p: Pos; w: boolean }
type Answers = Map<string, Ans>;

/** "This matters a lot to me" doubles a question; a candidate's own measure counts double a vote of their party's group. */
const IMPORTANT = 2, OWN = 2;
/** Fewer comparable questions than this and a candidate (or an MP) is not ranked. */
const MIN_COMPARED = 3;
/** Weight of a neutral (½) pseudo-answer added to every score, so few shared questions pull the score towards 50 %. */
const PRIOR = 1;
const VAL: Record<Pos, number> = { P: 1, A: 0, C: -1 };

let dataP: Promise<QuizData> | null = null;
const loadQuiz = () => (dataP ??= fetchJson<QuizData>("/data/an/quiz.json"));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const tokens = (d: QuizData, m: Mode) => (m === "s" ? d.short : d.long);
const themeName = (d: QuizData, id: string) => { const t = d.themes.find((x) => x.id === id); return t ? L(t.fr, t.en) : id; };

// Progress survives a language switch (the route re-renders) but not a reload.
// `w` is the pending "very important" flag of the question on screen.
// `ts` is the list of questions of this run when it is not the whole version (continuing from short to long).
let st: { mode: Mode; step: number; a: Answers; started: boolean; w?: boolean; ts?: string[] } | null = null;

// ---------- share code: <version>-<stamp of the question set>-<one digit per question, in the version's order> ----------
// digit: 0 skipped, 1 for / agree, 2 against / disagree, 3 abstain, +4 when marked important
const POS: (Pos | null)[] = [null, "P", "C", "A"];
function encode(d: QuizData, m: Mode, a: Answers) {
  return `${m}-${d.rev}-${tokens(d, m).map((t) => { const x = a.get(t); return x ? POS.indexOf(x.p) + (x.w ? 4 : 0) : 0; }).join("")}`;
}
function decode(code: string, d: QuizData): { mode: Mode; a: Answers } | null {
  const m = /^([sl])-([0-9a-z]+)-([0-7]+)$/.exec(code);
  if (!m || m[2] !== d.rev) return null;
  const mode = m[1] as Mode, ts = tokens(d, mode);
  if (m[3].length !== ts.length) return null;
  const a: Answers = new Map();
  [...m[3]].forEach((c, i) => { const x = Number(c), p = POS[x % 4]; if (p && !(ts[i][0] === "m" && p === "A")) a.set(ts[i], { p, w: x >= 4 }); });
  return { mode, a };
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
function scoreCand(d: QuizData, c: QuizCand, a: Answers): CandScore {
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
      items.push({ q, u: ans.p, agree: ans.p === "P" ? 1 : 0, w: imp * OWN, important: ans.w, theirs: "P" });
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

// ---------- page ----------
export async function renderQuiz(app: HTMLElement, code?: string) {
  const [d, polls] = await Promise.all([loadQuiz(), loadPolls("2027").catch(() => null)]);
  if (polls) registerParties(polls.parties);
  const shared = code ? decode(code, d) : null;
  if (shared) st = { mode: shared.mode, step: tokens(d, shared.mode).length, a: shared.a, started: true };
  else if (!st || (st.step >= (st.ts ?? tokens(d, st.mode)).length && !code)) st = { mode: "s", step: 0, a: new Map(), started: false };
  const stale = !!code && !shared;

  app.innerHTML = `
    <section class="page quiz-page qz-page">
      <header class="page-head">
        <p class="eyebrow">${L("Quiz · présidentielle 2027", "Quiz · 2027 presidential")}</p>
        <h1>${L("Qui vous ressemble, parmi les candidats de 2027 ?", "Who is closest to you, among the 2027 candidates?")}</h1>
        <p class="dek">${L("Des votes réels de l’Assemblée et des mesures tirées des programmes : répondez, marquez ce qui compte vraiment pour vous, et voyez de quel candidat vos réponses vous rapprochent, sur quoi vous divergez, et où vous vous situez de la gauche à la droite.", "Real Assembly votes and measures taken from the programmes: answer, mark what really matters to you, and see which candidate your answers bring you closest to, where you differ, and where you stand from left to right.")}</p>
      </header>
      ${stale ? `<p class="qz-stale">${L("Ce lien de résultats correspond à une ancienne série de questions : il ne peut plus être relu. Vous pouvez refaire le quiz.", "This results link was made for an earlier set of questions and can no longer be read. You can take the quiz again.")}</p>` : ""}
      <div class="quiz qz" id="quiz" aria-live="polite"></div>
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

function draw(stage: HTMLElement, d: QuizData, dir: 1 | -1) {
  const s = st!;
  const ts = s.ts ?? tokens(d, s.mode);
  if (!s.started) { bindKeys(stage, null); return intro(stage, d); }
  if (s.step >= ts.length) { bindKeys(stage, null); return results(stage, d); }
  const q = question(d, ts[s.step]);
  const ans = s.a.get(q.key);
  const total = ts.length;
  const isVote = q.kind === "v";
  const btn = (p: Pos, n: number, label: string, icon: string) =>
    `<button type="button" class="qz-ans qz-ans-${p}" data-a="${p}" aria-pressed="${ans?.p === p}"><kbd aria-hidden="true">${n}</kbd><span class="qz-ans-i" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
  stage.innerHTML = `
    <div class="qz-top">
      <button type="button" class="qz-back" ${s.step === 0 ? "disabled" : ""}><span aria-hidden="true">←</span> ${L("Retour", "Back")}</button>
      <div class="qz-progress" role="progressbar" aria-label="${L("Progression", "Progress")}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.step}">${ts.map((t, i) => `<i class="${i < s.step ? (s.a.has(t) ? "is-done" : "is-skip") : i === s.step ? "is-now" : ""}"></i>`).join("")}</div>
      <span class="qz-count">${s.step + 1}<span>/${total}</span></span>
    </div>
    <div class="qz-card ${dir > 0 ? "qz-in-fwd" : "qz-in-back"}">
      <p class="qz-kicker"><i style="background:${THEME_COLOR[q.theme] ?? "#9a9ea6"}"></i>${esc(themeName(d, q.theme))} · ${isVote ? `${L("Vote à l’Assemblée,", "Assembly vote,")} ${fmtDate(q.vote!.d)}` : L("Proposition d’un candidat", "A candidate’s proposal")}</p>
      <h2 class="qz-q">${esc(q.q)}</h2>
      <p class="qz-ctx">${isVote
        ? `${esc(q.ctx)} <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${q.vote!.n}" target="_blank" rel="noopener">${L(`Scrutin n° ${q.vote!.n}`, `Vote no. ${q.vote!.n}`)} ↗</a>`
        : L("Mesure tirée du programme ou des annonces d’un des candidats. Son auteur est révélé avec vos résultats.", "A measure taken from one candidate’s programme or announcements. Its author is revealed with your results.")}</p>
      <div class="qz-answers${isVote ? "" : " is-two"}" role="group" aria-label="${L("Votre position", "Your position")}">
        ${isVote ? btn("P", 1, L("Pour", "For"), "✓") + btn("C", 2, L("Contre", "Against"), "✕") + btn("A", 3, L("Abstention", "Abstain"), "–")
          : btn("P", 1, L("D’accord", "Agree"), "✓") + btn("C", 2, L("Pas d’accord", "Disagree"), "✕")}
      </div>
      <div class="qz-foot">
        <button type="button" class="qz-weight" aria-pressed="${!!s.w}"><span aria-hidden="true">★</span> ${L("C’est très important pour moi", "This matters a lot to me")} <kbd aria-hidden="true">I</kbd></button>
        <button type="button" class="qz-skip">${L("Sans avis · passer", "No opinion · skip")} <kbd aria-hidden="true">0</kbd></button>
      </div>
    </div>
    <p class="qz-keys muted small">${L("Clavier : 1, 2, 3 pour répondre, I pour « important », 0 pour passer, ← pour revenir.", "Keyboard: 1, 2, 3 to answer, I for “important”, 0 to skip, ← to go back.")}</p>`;
  const go = (delta: 1 | -1, delay = 0) => {
    const run = () => {
      s.w = false;
      s.step = Math.max(0, s.step + delta);
      if (s.step >= ts.length) history.replaceState(null, "", `#/quiz/${encode(d, s.mode, s.a)}`);
      draw(stage, d, delta);
      keepInView(stage);
    };
    if (delay && !reduced()) { stage.querySelector(".qz-card")?.classList.add(delta > 0 ? "qz-out-fwd" : "qz-out-back"); setTimeout(run, delay); } else run();
  };
  // the "important" toggle applies to the answer about to be given, or to the one already there
  s.w = ans?.w ?? false;
  const wb = stage.querySelector<HTMLButtonElement>(".qz-weight")!;
  wb.setAttribute("aria-pressed", String(s.w));
  const toggleW = () => { s.w = !s.w; wb.setAttribute("aria-pressed", String(s.w)); const cur = s.a.get(q.key); if (cur) cur.w = !!s.w; };
  let busy = false;
  const pick = (p: Pos) => {
    if (busy || (!isVote && p === "A")) return;
    busy = true;
    s.a.set(q.key, { p, w: !!s.w });
    stage.querySelectorAll<HTMLElement>(".qz-ans").forEach((x) => { const on = x.dataset.a === p; x.setAttribute("aria-pressed", String(on)); x.classList.toggle("is-picked", on); });
    go(1, 240);
  };
  const skip = () => { if (busy) return; busy = true; s.a.delete(q.key); go(1, 140); };
  stage.querySelector(".qz-back")!.addEventListener("click", () => go(-1));
  stage.querySelectorAll<HTMLButtonElement>(".qz-ans").forEach((b) => b.addEventListener("click", () => pick(b.dataset.a as Pos)));
  wb.addEventListener("click", toggleW);
  stage.querySelector(".qz-skip")!.addEventListener("click", skip);
  bindKeys(stage, (e) => {
    if (e.key === "1") pick("P");
    else if (e.key === "2") pick("C");
    else if (e.key === "3") pick("A");
    else if (e.key === "0" || e.key === "ArrowRight") skip();
    else if (e.key === "i" || e.key === "I" || e.key === "*") toggleW();
    else if (e.key === "ArrowLeft" && s.step > 0) go(-1);
    else return;
    e.preventDefault();
  });
}

/** After a step, bring the card back into view on small screens (the page header sits above it). */
function keepInView(stage: HTMLElement) {
  const r = stage.getBoundingClientRect();
  if (r.top < 110 || r.top > innerHeight * 0.5) window.scrollTo({ top: scrollY + r.top - 120, behavior: reduced() ? "auto" : "smooth" });
}

function intro(stage: HTMLElement, d: QuizData) {
  const nV = d.long.filter((t) => t[0] === "v").length, nM = d.long.length - nV;
  const per = nM / d.candidates.length;
  const themes = [...new Set(d.long.map((t) => question(d, t).theme))];
  const card = (m: Mode, title: string, time: string, n: number, lines: string[], tag: string) => `
    <button type="button" class="qz-pick is-${m}" data-mode="${m}">
      <span class="px-tag">${tag}</span>
      <strong>${title}</strong>
      <span class="qz-pick-n"><b>${n}</b> ${L("questions", "questions")} · ${time}</span>
      <span class="qz-pick-lines">${lines.map((x) => `<span>${x}</span>`).join("")}</span>
      <span class="qz-pick-go">${L("Commencer", "Start")} <i aria-hidden="true">→</i></span>
    </button>`;
  stage.innerHTML = `<div class="qz-intro qz-in-fwd">
      <div class="qz-picks">
        ${card("s", L("Version courte", "Short version"), L("2 minutes", "2 minutes"), d.short.length, [
          L(`Les ${d.short.length} votes de l’Assemblée qui départagent le mieux les candidats`, `The ${d.short.length} Assembly votes that best tell the candidates apart`),
          L("Votre classement des candidats et votre place sur l’axe gauche-droite", "Your ranking of the candidates and your place on the left–right axis"),
        ], L("Rapide", "Quick"))}
        ${card("l", L("Version longue", "Long version"), L("8 minutes", "8 minutes"), d.long.length, [
          L(`${nV} votes et ${nM} mesures tirées des programmes : ${per} par candidat, sans dire de qui`, `${nV} votes and ${nM} measures from the programmes: ${per} per candidate, without saying whose`),
          L("En plus : vos points de rupture avec chaque candidat, ce qui pourrait vous rapprocher, votre position sujet par sujet", "Also: your deal breakers with each candidate, what could bring you closer, your position subject by subject"),
        ], L("La plus précise", "Most precise"))}
      </div>
      <p class="qz-topics">${themes.map((t) => `<span><i style="background:${THEME_COLOR[t] ?? "#9a9ea6"}"></i>${esc(themeName(d, t))}</span>`).join("")}</p>
      <p class="muted small">${L("Vous pouvez passer une question, revenir en arrière, et marquer celles qui comptent vraiment pour vous : elles pèsent double. Vos réponses restent dans votre navigateur. Ce quiz mesure une proximité avec des votes et des mesures ; il ne dit pas pour qui voter.", "You can skip a question, go back, and mark the ones that really matter to you: they count double. Your answers stay in your browser. This quiz measures how close you are to votes and measures; it does not say who to vote for.")}</p>
    </div>`;
  stage.querySelectorAll<HTMLButtonElement>(".qz-pick").forEach((b) => b.addEventListener("click", () => {
    st = { mode: b.dataset.mode as Mode, step: 0, a: new Map(), started: true };
    draw(stage, d, 1);
    keepInView(stage);
  }));
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
  const ts = tokens(d, s.mode);
  const nAns = a.size;
  if (nAns < MIN_COMPARED) {
    stage.innerHTML = `<div class="qz-card qz-in-fwd"><h2 class="qz-q">${L("Encore quelques réponses", "A few more answers")}</h2>
      <p class="qz-ctx">${L(`Répondez à au moins ${MIN_COMPARED} questions pour obtenir un classement : vous en avez passé ${ts.length - nAns} sur ${ts.length}.`, `Answer at least ${MIN_COMPARED} questions to get a ranking: you skipped ${ts.length - nAns} of ${ts.length}.`)}</p>
      <button type="button" class="qz-cta" id="qz-resume">${L("Reprendre le quiz", "Back to the quiz")}</button></div>`;
    stage.querySelector("#qz-resume")!.addEventListener("click", () => { s.step = 0; history.replaceState(null, "", "#/quiz"); draw(stage, d, -1); });
    return;
  }
  const order = [...d.candidates].sort((x, y) => spectrumRank(x.pollName) - spectrumRank(y.pollName));
  const scored = d.candidates.map((c) => scoreCand(d, c, a));
  const ranked = scored.filter((r): r is CandScore & { s: number } => r.s != null).sort((x, y) => y.s - x.s || y.n - x.n);
  const unranked = scored.filter((r) => r.s == null);
  const top = ranked[0];
  const ties = top ? ranked.filter((r) => Math.abs(r.s - top.s) < 0.005) : [];
  const nImportant = [...a.values()].filter((x) => x.w).length;
  const code = encode(d, s.mode, a);

  // ----- items of a candidate, sorted into the three lists -----
  const itemLi = (c: QuizCand, i: Item) => `<li>
      <p>${i.important ? `<span class="qz-star" title="${L("Important pour vous", "Important to you")}">★</span> ` : ""}${esc(i.q.q)}</p>
      ${i.q.kind === "m" ? `<p class="qz-quote" lang="fr">« ${esc(i.q.measure!.text.length > 240 ? `${i.q.measure!.text.slice(0, 240)}…` : i.q.measure!.text)} »</p>` : ""}
      <p class="qz-vs"><span class="qz-pos qz-pos-${i.u}">${L("Vous", "You")}${colon()}${posWord(i.q, i.u)}</span>${i.q.kind === "v" ? `<span class="qz-pos qz-pos-${i.theirs.length === 1 ? i.theirs : "X"}">${esc(c.groups.join(" + "))}${colon()}${posWord(i.q, i.theirs)}</span>` : `<span class="qz-pos qz-pos-own">${L("Sa mesure", "Their measure")}</span>`}
      ${i.q.kind === "m" ? `<a class="small" href="#/programmes/${esc(c.slug)}#m-${esc(i.q.measure!.id)}">${L("La mesure dans son programme", "The measure in their programme")} →</a>` : `<a class="small" href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${i.q.vote!.n}" target="_blank" rel="noopener">${L(`Scrutin n° ${i.q.vote!.n}`, `Vote no. ${i.q.vote!.n}`)} ↗</a>`}</p></li>`;
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
      <p class="qz-links"><a href="#/programmes/${esc(r.c.slug)}">${L("Son programme, mesure par mesure", "Their programme, measure by measure")} →</a><a href="#/candidat/${esc(r.c.slug)}">${L("Sa fiche", "Their file")} →</a></p></div>`;
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

  // ----- who proposed what (long version) -----
  const reveal = long ? ts.filter((t) => t[0] === "m" && a.has(t)).map((t) => { const q = question(d, t), c = d.candidates.find((k) => k.slug === q.measure!.slug)!; return { q, c, u: a.get(t)! }; }) : [];

  // ----- MPs and groups (votes only) -----
  const nVotes = [...a.keys()].filter((k) => k[0] === "v").length;
  const minMp = Math.max(MIN_COMPARED, Math.ceil(nVotes / 2));
  const mps = d.mps.map((m) => ({ m, sc: scoreVotes(m[4], d, a) })).filter((r): r is { m: QuizMp; sc: { s: number; n: number } } => !!r.sc && r.sc.n >= minMp).sort((p, q) => q.sc.s - p.sc.s || q.sc.n - p.sc.n);
  const groups = Object.entries(d.groups).filter(([g]) => g !== "NI").map(([g, v]) => ({ g, v, sc: scoreVotes(v.line, d, a) })).filter((r): r is { g: string; v: QuizGroup; sc: { s: number; n: number } } => !!r.sc).sort((p, q) => q.sc.s - p.sc.s);
  const gcol = (g: string) => safeColor(d.groups[g]?.couleur, "#8d949a");

  stage.innerHTML = `<div class="qz-results">
    ${top ? `<section class="qz-match" style="--c:${colorOf(top.c)}">
      <p class="qz-match-k">${ties.length > 1 ? L("Les candidats les plus proches de vos réponses, à égalité", "The candidates closest to your answers, level") : L("Le candidat le plus proche de vos réponses", "The candidate closest to your answers")}</p>
      <div class="qz-match-in">
        <div class="qz-match-ph">${ties.slice(0, 3).map((r) => face(r.c, 120)).join("")}</div>
        <div>
          <h2>${ties.slice(0, 3).map((r) => `<a href="#/candidat/${esc(r.c.slug)}">${esc(r.c.name)}</a>`).join(`<span>${L(" et ", " and ")}</span>`)}</h2>
          <p class="qz-big"><span data-count="${Math.round(100 * top.s)}" data-suffix="${L(" %", "%")}">${pctS(top.s)}</span> <small>${L("d’accord, en tenant compte de ce qui compte pour vous", "agreement, weighted by what matters to you")}</small></p>
          <p class="qz-match-n">${L(`Calculé sur ${top.n} questions comparables, parmi vos ${nAns} réponses.`, `Based on ${top.n} comparable questions, out of your ${nAns} answers.`)}${ties.length > 1 ? ` ${long ? L("Vos réponses ne les départagent pas.", "Your answers do not separate them.") : L("Ces votes ne les départagent pas : la version longue, qui ajoute leurs propres mesures, peut le faire.", "These votes do not separate them: the long version, which adds their own measures, can.")}` : ""}</p>
        </div>
      </div>
      <p class="qz-disc">${L("Une proximité de réponses, pas une consigne de vote : ce classement ne dit rien de la personne, de sa crédibilité ni de ce qui n’a pas été demandé.", "Closeness of answers, not voting advice: this ranking says nothing about the person, their credibility, or anything that was not asked.")}</p>
    </section>` : `<div class="qz-card"><p class="qz-ctx">${L("Trop peu de réponses comparables pour classer les candidats.", "Too few comparable answers to rank the candidates.")}</p></div>`}

    <div class="qz-actions">
      ${long ? "" : `<button type="button" class="qz-cta" id="qz-longer">${L(`Continuer en version longue : ${d.long.filter((t) => !a.has(t)).length} questions de plus`, `Continue with the long version: ${d.long.filter((t) => !a.has(t)).length} more questions`)} <i aria-hidden="true">→</i></button>`}
      <button type="button" class="qz-btn" id="qz-share">${L("Copier le lien de mes résultats", "Copy a link to my results")}</button>
      <button type="button" class="qz-btn" id="qz-restart">${L("Recommencer", "Start again")}</button>
      <span class="qz-copied muted small" role="status"></span>
    </div>

    ${axis}

    <section class="card qz-cands" id="quiz-cands">
      <header class="card-head"><h2>${L("Les candidats, du plus proche au plus éloigné", "The candidates, closest first")}</h2><a href="#/programmes">${L("Comparer les programmes", "Compare the programmes")}</a></header>
      <p class="prog-lede">${long
        ? L("Ouvrez un candidat pour voir vos points de rupture (désaccords sur ce que vous jugez très important) et ce qui pourrait être compatible.", "Open a candidate to see your deal breakers (disagreements on what you marked as very important) and what could be compatible.")
        : L("Version courte : le score repose sur les votes du groupe parlementaire qui représente chaque candidat. Ouvrez un candidat pour voir accords et désaccords.", "Short version: the score rests on the votes of the parliamentary group standing for each candidate. Open a candidate to see where you agree and differ.")}</p>
      <ol class="qz-rank">${ranked.map(row).join("")}</ol>
      ${unranked.length ? `<p class="muted small">${L(`Pas assez de questions comparables (moins de ${MIN_COMPARED}) pour classer`, `Not enough comparable questions (fewer than ${MIN_COMPARED}) to rank`)} ${unranked.map((r) => esc(r.c.name)).join(", ")}.</p>` : ""}
      <p class="muted small">${L("Score : part d’accord pondérée. Une question marquée très importante compte double ; une mesure du candidat compte double d’un vote de son groupe ; un demi-point neutre évite qu’un score repose sur trois réponses. * : parti sans député, représenté par le ou les groupes les plus proches.", "Score: weighted share of agreement. A question marked very important counts double; a candidate’s own measure counts double a vote of their group; a neutral half-point stops a score resting on three answers. *: party with no MPs, represented by the nearest group or groups.")}</p>
    </section>

    ${reveal.length ? `<section class="card">
      <header class="card-head"><h2>${L("Qui proposait quoi", "Who proposed what")}</h2></header>
      <ul class="qz-reveal">${reveal.map((r) => `<li style="--c:${colorOf(r.c)}">
        <span class="qz-pos qz-pos-${r.u.p}">${r.u.w ? "★ " : ""}${posWord(r.q, r.u.p)}</span>
        <span class="qz-rq">${esc(r.q.q)}</span>
        <a class="qz-rc" href="#/programmes/${esc(r.c.slug)}#m-${esc(r.q.measure!.id)}">${face(r.c, 28)}<b>${esc(r.c.name)}</b></a></li>`).join("")}</ul>
      <p class="muted small">${L("Chaque candidat a le même nombre de mesures dans le quiz. D’autres candidats peuvent défendre une mesure voisine : seul son auteur est compté.", "Every candidate has the same number of measures in the quiz. Other candidates may back a similar measure: only its author is counted.")}</p>
    </section>` : ""}

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
  stage.querySelector("#qz-restart")!.addEventListener("click", () => {
    st = { mode: "s", step: 0, a: new Map(), started: false };
    if (location.hash !== "#/quiz") history.replaceState(null, "", "#/quiz");
    draw(stage, d, 1);
    keepInView(stage);
  });
  stage.querySelector("#qz-longer")?.addEventListener("click", () => {
    // keep the answers already given: this run only asks the long-version questions still unanswered
    st = { mode: "l", step: 0, a, started: true, ts: d.long.filter((t) => !a.has(t)) };
    history.replaceState(null, "", "#/quiz");
    draw(stage, d, 1);
    keepInView(stage);
  });
  stage.querySelector("#qz-share")!.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#/quiz/${code}`;
    const out = stage.querySelector<HTMLElement>(".qz-copied")!;
    try {
      await navigator.clipboard.writeText(url);
      out.textContent = L("Lien copié. Il contient vos réponses ; rien n’est envoyé ailleurs.", "Link copied. It holds your answers; nothing is sent anywhere.");
    } catch {
      out.innerHTML = `<input class="quiz-url" readonly value="${esc(url)}" aria-label="${L("Lien de vos résultats", "Link to your results")}" />`;
      out.querySelector<HTMLInputElement>("input")!.select();
    }
  });
}

function methodNote(d: QuizData) {
  const nV = d.long.filter((t) => t[0] === "v").length, nM = d.long.length - nV;
  return `<details class="quiz-method card">
    <summary>${L("Méthode, limites et confidentialité", "Method, limits and privacy")}</summary>
    <div class="prose">
      <p>${L(`<b>Les votes.</b> ${d.questions.length} scrutins publics de la 17e législature ont été retenus parmi les plus clivants, un ou deux par sujet, en variant le camp gagnant ; chaque question décrit ce que fait le texte et renvoie au scrutin officiel. Quand le vote portait sur la suppression du texte, les positions sont inversées pour que « Pour » signifie toujours pour la proposition. Un programme range ensuite ces votes dans l’ordre qui sépare le plus vite les candidats (chacun prend la position du ou des groupes de son parti), en évitant de poser deux fois le même sujet : la version courte pose les ${d.short.length} premiers, la version longue les ${nV} premiers.`,
        `<b>The votes.</b> ${d.questions.length} public votes of the 17th legislature were kept from among the most divisive, one or two per subject, varying which side won; each question describes what the text does and links to the official record. When the vote was on deleting the text, positions are flipped so that “For” always means for the proposal. A program then sorts these votes in the order that separates the candidates fastest (each takes the position of their party’s group or groups), avoiding the same subject twice: the short version asks the first ${d.short.length}, the long one the first ${nV}.`)}</p>
      <p>${L(`<b>Les mesures.</b> La version longue ajoute ${nM} mesures : ${nM / d.candidates.length} pour chacun des ${d.candidates.length} candidats, choisies dans le relevé de leur programme ou de leurs annonces pour être des propositions concrètes, sur des sujets variés. Elles sont reformulées en termes neutres et posées sans nom d’auteur ; le texte du candidat et sa source sont donnés avec les résultats. Seul l’auteur d’une mesure est compté : nous ne supposons pas ce que les autres en pensent.`,
        `<b>The measures.</b> The long version adds ${nM} measures: ${nM / d.candidates.length} for each of the ${d.candidates.length} candidates, chosen from the record of their programme or announcements to be concrete proposals on varied subjects. They are reworded in neutral terms and asked without their author’s name; the candidate’s own wording and source come with the results. Only a measure’s author is counted: we do not assume what the others think of it.`)}</p>
      <p>${L(`<b>Le calcul.</b> Sur un vote : 1 point si votre position est celle du groupe du candidat, ½ si l’un de vous s’abstient, 0 si elles s’opposent. Sur une mesure du candidat : 1 si vous êtes d’accord, 0 sinon. Une question marquée « très importante » compte double ; une mesure du candidat compte double d’un vote de son groupe, parce que c’est son propre engagement. Le score est la part d’accord ainsi pondérée, avec un demi-point neutre ; il faut au moins ${MIN_COMPARED} questions comparables pour être classé. Un « point de rupture » est un désaccord complet sur une question que vous avez marquée très importante. Les députés et les groupes sont classés sur les seuls votes.`,
        `<b>The scoring.</b> On a vote: 1 point if your position is that of the candidate’s group, ½ if one of you abstains, 0 if opposite. On one of the candidate’s measures: 1 if you agree, 0 if not. A question marked “very important” counts double; a candidate’s own measure counts double a vote of their group, because it is their own commitment. The score is that weighted share of agreement, with a neutral half-point; at least ${MIN_COMPARED} comparable questions are needed to be ranked. A “deal breaker” is a complete disagreement on a question you marked very important. MPs and groups are ranked on the votes alone.`)}</p>
      <p>${L("<b>Les limites.</b> Un candidat n’est pas son groupe parlementaire : les votes sont ceux des députés de son parti, ou des groupes les plus proches quand il n’en a pas, ce qui est signalé. Quelques dizaines de questions ne résument ni un programme ni une personne ; les programmes évoluent pendant la campagne. Sur une motion de censure seuls les votes pour existent : un député en fonction qui n’a pas voté pour est compté contre. Ce n’est ni un sondage ni une consigne de vote.", "<b>Limits.</b> A candidate is not their parliamentary group: the votes are those of their party’s MPs, or of the nearest groups when it has none, which is flagged. A few dozen questions sum up neither a programme nor a person; programmes change during the campaign. On a censure motion only votes for exist: a sitting MP who did not vote for it counts as against. This is neither a poll nor voting advice.")}</p>
      <p>${L("<b>Vos réponses</b> ne quittent pas votre navigateur : tout est calculé sur votre appareil, rien n’est enregistré ni envoyé. Le lien de partage contient vos réponses, codées dans l’adresse après le #, que les navigateurs ne transmettent pas aux serveurs.", "<b>Your answers</b> never leave your browser: everything is computed on your device, nothing is stored or sent. The share link holds your answers, encoded in the address after the #, which browsers do not send to servers.")}</p>
    </div>
    <p class="source">${L(`Sources : open data de l’Assemblée nationale (scrutins) et relevé des programmes du site ; jeu de données du quiz généré le ${fmtDate(d.generatedAt)}.`, `Sources: Assemblée nationale open data (votes) and the site’s record of the programmes; quiz dataset built ${fmtDate(d.generatedAt)}.`)} <a href="#/programmes">${L("Les programmes", "The programmes")}</a></p>
  </details>`;
}
