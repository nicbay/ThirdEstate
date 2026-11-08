// "Qui vous ressemble ?" (#/quiz): answer 17 real votes of the 17th legislature and pick the subjects that matter
// to you; the page ranks MPs, groups and 2027 candidates by how close their votes and speeches are to your answers.
// Data: public/data/an/quiz.json (scripts/build-quiz.mjs, which also documents how the questions were chosen).
// Answers never leave the browser: everything is computed here, and the share link carries them in the URL hash
// (#/quiz/<code>), which browsers do not send to any server.
import { fetchJson, loadPolls } from "../data";
import { L, colon, fmtDate, fmtNum, fmtPct } from "../i18n";
import { meta, registerParties } from "../lib/candidates";
import { getHome } from "../lib/cloud";
import { esc, safeColor } from "../util";
import { photoUrl } from "./deputes";
import { THEME_COLOR } from "./speeches";

type Pos = "P" | "C" | "A";
interface QuizQuestion { id: string; n: number; d: string; theme: string; inv: boolean; censure: boolean; fr: { q: string; c: string }; en: { q: string; c: string }; sort: string; res: [number, number, number] }
interface QuizGroup { libelle: string; couleur: string; n: number; line: string; cohesion: number[]; t: string }
/** [id, name, group, département, positions (one char per question: P/C/A/-), theme ranks 0–9 or "", top words] */
type QuizMp = [string, string, string, string, string, string, string[]];
interface QuizData { generatedAt: string; questions: QuizQuestion[]; themes: { id: string; fr: string; en: string }[]; groups: Record<string, QuizGroup>; mps: QuizMp[] }

interface Answers { v: (Pos | null)[]; w: boolean[]; top: number[]; least: number[] }
type Step = { kind: "top" } | { kind: "vote"; k: number } | { kind: "least" };

/** Blend of the two parts of the score. */
const VOTE_WEIGHT = 0.8;
const IMPORTANT = 2;
const MAX_PICKS = 3;
/** Fewer answered votes than this and there is nothing meaningful to rank. */
const MIN_ANSWERED = 3;
/** Weight of a neutral (½) pseudo-vote added to every vote score, so few shared votes pull the score towards 50 %. */
const PRIOR = 1;

/**
 * 2027 candidates → the Assemblée group(s) of the party they belong to or lead. A candidate's score is the
 * mean score of those groups. `note` marks candidates whose party has no MPs: the nearest group(s) stand in,
 * which is our approximation and is said so next to their bar.
 */
const CANDIDATE_GROUPS: Record<string, { g: string[]; note?: [string, string] }> = {
  "Nathalie Arthaud": { g: ["LFI-NFP", "GDR"], note: ["Lutte ouvrière n’a pas de député : moyenne des deux groupes les plus à gauche, LFI-NFP et GDR.", "Lutte ouvrière has no MPs: average of the two groups furthest left, LFI-NFP and GDR."] },
  "Philippe Poutou": { g: ["LFI-NFP", "GDR"], note: ["Le NPA n’a pas de député : moyenne des deux groupes les plus à gauche, LFI-NFP et GDR.", "The NPA has no MPs: average of the two groups furthest left, LFI-NFP and GDR."] },
  "Jean-Luc Mélenchon": { g: ["LFI-NFP"] },
  "Fabien Roussel": { g: ["GDR"] }, // the PCF's MPs sit in the GDR group
  "Emmanuel Maurel": { g: ["GDR"] },
  "François Ruffin": { g: ["ECOS"] }, // sits with the ecologists
  "Marine Tondelier": { g: ["ECOS"] },
  "Yannick Jadot": { g: ["ECOS"] },
  "Sandrine Rousseau": { g: ["ECOS"] },
  "Raphaël Glucksmann": { g: ["SOC"] }, // Place publique's MPs sit in the socialist group
  "Olivier Faure": { g: ["SOC"] },
  "François Hollande": { g: ["SOC"] },
  "Carole Delga": { g: ["SOC"] },
  "Karim Bouamrane": { g: ["SOC"] },
  "Jérôme Guedj": { g: ["SOC"] },
  "Bernard Cazeneuve": { g: ["SOC"], note: ["La Convention n’a pas de groupe : groupe le plus proche, les socialistes.", "La Convention has no group of its own: nearest group, the socialists."] },
  "Gabriel Attal": { g: ["EPR"] },
  "Élisabeth Borne": { g: ["EPR"] },
  "Gérald Darmanin": { g: ["EPR"] },
  "Bruno Le Maire": { g: ["EPR"] },
  "Sébastien Lecornu": { g: ["EPR"] },
  "Yaël Braun-Pivet": { g: ["EPR"] },
  "François Bayrou": { g: ["DEM"] },
  "Édouard Philippe": { g: ["HOR"] },
  "Dominique de Villepin": { g: ["DEM", "DR"], note: ["La France humaniste n’a pas de député : moyenne des Démocrates et de la Droite républicaine, notre approximation de son positionnement gaulliste et centriste.", "La France humaniste has no MPs: average of Les Démocrates and Droite républicaine, our approximation of his Gaullist, centrist stance."] },
  "David Lisnard": { g: ["DR"], note: ["Nouvelle Énergie n’a pas de groupe : groupe le plus proche, la Droite républicaine, dont il est issu.", "Nouvelle Énergie has no group: nearest group, Droite républicaine, where he comes from."] },
  "Bruno Retailleau": { g: ["DR"] }, // Les Républicains' MPs sit in Droite républicaine
  "Laurent Wauquiez": { g: ["DR"] },
  "Xavier Bertrand": { g: ["DR"] },
  "Michel Barnier": { g: ["DR"] },
  "Nicolas Dupont-Aignan": { g: ["UDR", "RN"], note: ["Debout la France n’a pas de député : moyenne des groupes UDR et RN, les plus proches.", "Debout la France has no MPs: average of the UDR and RN groups, the nearest."] },
  "Marine Le Pen": { g: ["RN"] },
  "Jordan Bardella": { g: ["RN"] },
  "Éric Zemmour": { g: ["UDR", "RN"], note: ["Reconquête n’a pas de député : moyenne des groupes UDR et RN, les plus proches.", "Reconquête has no MPs: average of the UDR and RN groups, the nearest."] },
  "Sarah Knafo": { g: ["UDR", "RN"], note: ["Reconquête n’a pas de député : moyenne des groupes UDR et RN, les plus proches.", "Reconquête has no MPs: average of the UDR and RN groups, the nearest."] },
};

let dataP: Promise<QuizData> | null = null;
const loadQuiz = () => (dataP ??= fetchJson<QuizData>("/data/an/quiz.json"));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Progress survives a language switch (the route re-renders) but not a reload.
let st: { step: number; a: Answers; started: boolean } | null = null;
const fresh = (n: number): Answers => ({ v: Array(n).fill(null), w: Array(n).fill(false), top: [], least: [] });

// ---------- share code: "a" + one digit per vote (0 skip, 1 pour, 2 contre, 3 abst., +4 important) + "-" + top themes + "-" + least ----------
const POS: (Pos | null)[] = [null, "P", "C", "A"];
function encode(a: Answers) {
  const v = a.v.map((p, k) => POS.indexOf(p) + (a.w[k] ? 4 : 0)).join("");
  return `a${v}-${a.top.map((k) => k.toString(36)).join("")}-${a.least.map((k) => k.toString(36)).join("")}`;
}
function decode(code: string, d: QuizData): Answers | null {
  const m = /^a([0-7]+)-([0-9a-z]*)-([0-9a-z]*)$/.exec(code);
  if (!m || m[1].length !== d.questions.length) return null;
  const themes = (s: string) => [...new Set([...s].map((c) => parseInt(c, 36)).filter((k) => k < d.themes.length))].slice(0, MAX_PICKS);
  const a = fresh(d.questions.length);
  [...m[1]].forEach((c, k) => { const x = Number(c); a.v[k] = POS[x % 4]; a.w[k] = x >= 4 && x % 4 > 0; });
  a.top = themes(m[2]);
  a.least = themes(m[3]).filter((k) => !a.top.includes(k));
  return a;
}

// ---------- scoring ----------
const VAL: Record<Pos, number> = { P: 1, A: 0, C: -1 };
interface Score { s: number; vote: number; theme: number | null; n: number; agree: number }
/**
 * Agreement on one vote: 1 same position, ½ when one side abstained, 0 opposite; "important" counts double.
 * Votes the MP missed are left out. Theme part: where they rank (0–9) on the subjects you picked, reversed for
 * the ones you care least about. Score = 80 % votes + 20 % themes (votes only when there is no theme data).
 */
function score(pos: string, ranks: string, a: Answers): Score | null {
  let sw = 0, sa = 0, n = 0, agree = 0;
  a.v.forEach((u, k) => {
    const m = pos[k] as Pos | "-";
    if (!u || m === "-" || !m) return;
    const w = a.w[k] ? IMPORTANT : 1;
    sw += w;
    sa += w * (1 - Math.abs(VAL[u] - VAL[m]) / 2);
    n++;
    if (u === m) agree++;
  });
  if (!n) return null;
  // one neutral half-point of prior: a perfect record on 9 votes should not outrank a near-perfect one on 16
  const vote = (sa + PRIOR / 2) / (sw + PRIOR);
  const parts = ranks ? [...a.top.map((k) => Number(ranks[k]) / 9), ...a.least.map((k) => 1 - Number(ranks[k]) / 9)] : [];
  const theme = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
  return { s: theme == null ? vote : VOTE_WEIGHT * vote + (1 - VOTE_WEIGHT) * theme, vote, theme, n, agree };
}
const answered = (a: Answers) => a.v.filter(Boolean).length;
/** An MP must have voted on at least half the votes you answered (and at least 3) to be ranked. */
const minOverlap = (a: Answers) => Math.max(MIN_ANSWERED, Math.ceil(answered(a) / 2));

// ---------- page ----------
export async function renderQuiz(app: HTMLElement, code?: string) {
  const d = await loadQuiz();
  const N = d.questions.length;
  const shared = code ? decode(code, d) : null;
  if (shared) st = { step: stepsOf(d).length, a: shared, started: true };
  else if (!st || st.a.v.length !== N || (st.step >= stepsOf(d).length && !code)) st = { step: 0, a: fresh(N), started: false };

  app.innerHTML = `
    <section class="page quiz-page">
      <p class="muted small crumbs"><a href="#/assemblee">${L("Assemblée", "Assembly")}</a> › ${L("Quiz", "Quiz")}</p>
      <header class="page-head">
        <p class="eyebrow">${L(`Quiz · ${N} votes réels de l’Assemblée`, `Quiz · ${N} real Assembly votes`)}</p>
        <h1>${L("Qui vous ressemble, à l’Assemblée et en 2027 ?", "Who’s closest to you, in the Assembly and in 2027?")}</h1>
        <p class="dek">${L("Répondez aux textes sur lesquels les députés ont vraiment voté, choisissez les sujets qui comptent pour vous : découvrez le député, le groupe et le candidat dont les votes vous ressemblent le plus.", "Answer the texts MPs actually voted on and pick the subjects that matter to you: find the MP, the group and the candidate whose votes are closest to yours.")}</p>
      </header>
      <div class="quiz" id="quiz" aria-live="polite"></div>
      ${methodNote(d)}
    </section>`;
  const stage = app.querySelector<HTMLElement>("#quiz")!;
  draw(stage, d, 1);
}

function stepsOf(d: QuizData): Step[] {
  return [{ kind: "top" }, ...d.questions.map((_, k) => ({ kind: "vote" as const, k })), { kind: "least" }];
}

function draw(stage: HTMLElement, d: QuizData, dir: 1 | -1) {
  const s = st!;
  const steps = stepsOf(d);
  if (!s.started) return intro(stage, d);
  if (s.step >= steps.length) return results(stage, d, s.a);
  const step = steps[s.step];
  const total = steps.length;
  const top = `<div class="quiz-top">
      <button type="button" class="quiz-back" ${s.step === 0 ? "disabled" : ""}><span aria-hidden="true">←</span> ${L("Retour", "Back")}</button>
      <div class="quiz-progress" role="progressbar" aria-label="${L("Progression", "Progress")}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.step}"><span style="width:${(100 * s.step) / total}%"></span></div>
      <span class="quiz-count">${s.step + 1}<span>/${total}</span></span>
    </div>`;
  stage.innerHTML = top + `<div class="quiz-card ${dir > 0 ? "quiz-in-fwd" : "quiz-in-back"}">${step.kind === "vote" ? voteCard(d, step.k, s.a) : themeCard(d, step.kind, s.a)}</div>`;
  const go = (delta: 1 | -1, delay = 0) => {
    const run = () => { s.step = Math.max(0, s.step + delta); draw(stage, d, delta); keepInView(stage); };
    if (delay && !reduced()) { stage.querySelector(".quiz-card")?.classList.add(delta > 0 ? "quiz-out-fwd" : "quiz-out-back"); setTimeout(run, delay); } else run();
  };
  stage.querySelector(".quiz-back")!.addEventListener("click", () => go(-1));

  if (step.kind === "vote") {
    const k = step.k;
    stage.querySelectorAll<HTMLButtonElement>(".quiz-ans").forEach((b) => b.addEventListener("click", () => {
      s.a.v[k] = b.dataset.a as Pos;
      stage.querySelectorAll(".quiz-ans").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      b.classList.add("is-picked");
      go(1, 260);
    }));
    const wb = stage.querySelector<HTMLButtonElement>(".quiz-weight")!;
    wb.addEventListener("click", () => { s.a.w[k] = !s.a.w[k]; wb.setAttribute("aria-pressed", String(s.a.w[k])); });
    stage.querySelector(".quiz-skip")!.addEventListener("click", () => { s.a.v[k] = null; s.a.w[k] = false; go(1, 160); });
    return;
  }
  // theme picks
  const key = step.kind;
  const list = () => s.a[key];
  const sync = () => {
    stage.querySelectorAll<HTMLButtonElement>(".quiz-theme").forEach((b) => {
      const t = Number(b.dataset.t);
      const on = list().includes(t);
      b.setAttribute("aria-pressed", String(on));
      b.disabled = (key === "least" && s.a.top.includes(t)) || (!on && list().length >= MAX_PICKS);
    });
    stage.querySelector(".quiz-picked")!.textContent = L(`${list().length} sur ${MAX_PICKS}`, `${list().length} of ${MAX_PICKS}`);
    stage.querySelector<HTMLButtonElement>(".quiz-next")!.textContent = list().length ? L("Continuer", "Continue") : L("Passer", "Skip");
  };
  stage.querySelectorAll<HTMLButtonElement>(".quiz-theme").forEach((b) => b.addEventListener("click", () => {
    const t = Number(b.dataset.t);
    const l = list();
    const i = l.indexOf(t);
    if (i >= 0) l.splice(i, 1);
    else if (l.length < MAX_PICKS) l.push(t);
    sync();
  }));
  stage.querySelector(".quiz-next")!.addEventListener("click", () => {
    if (key === "least") history.replaceState(null, "", `#/quiz/${encode(s.a)}`);
    go(1, 160);
  });
  sync();
}

/** After a step, bring the card back into view on small screens (the page header sits above it). */
function keepInView(stage: HTMLElement) {
  const r = stage.getBoundingClientRect();
  if (r.top < 110 || r.top > innerHeight * 0.5) window.scrollTo({ top: scrollY + r.top - 120, behavior: reduced() ? "auto" : "smooth" });
}

function intro(stage: HTMLElement, d: QuizData) {
  const N = d.questions.length;
  const nGroups = Object.keys(d.groups).filter((g) => g !== "NI").length;
  const themes = [...new Set(d.questions.map((q) => q.theme))].map((id) => d.themes.find((t) => t.id === id)!);
  stage.innerHTML = `<div class="quiz-card quiz-intro quiz-in-fwd">
      <ol class="quiz-how">
        <li><b>${N}</b><span>${L("votes réels de la législature, reformulés en questions simples", "real votes of this legislature, rewritten as plain questions")}</span></li>
        <li><b>2</b><span>${L("questions sur les sujets qui comptent pour vous, comparés aux discours des députés", "questions on the subjects that matter to you, compared with what MPs say")}</span></li>
        <li><b>${d.mps.length}</b><span>${L(`députés, ${nGroups} groupes et les candidats de 2027 classés selon vos réponses`, `MPs, ${nGroups} groups and the 2027 candidates ranked by your answers`)}</span></li>
      </ol>
      <p class="quiz-topics">${themes.map((t) => `<span style="--c:${THEME_COLOR[t.id] ?? "#9a9ea6"}">${esc(L(t.fr, t.en))}</span>`).join("")}</p>
      <button type="button" class="quiz-start">${L("Commencer", "Start")} <span aria-hidden="true">→</span></button>
      <p class="muted small">${L("Environ 4 minutes. Vous pouvez passer une question, revenir en arrière et marquer celles qui comptent le plus. Vos réponses restent dans votre navigateur.", "About 4 minutes. You can skip a question, go back, and mark the ones that matter most. Your answers stay in your browser.")}</p>
    </div>`;
  stage.querySelector(".quiz-start")!.addEventListener("click", () => {
    st!.started = true;
    draw(stage, d, 1);
    keepInView(stage);
  });
}

function voteCard(d: QuizData, k: number, a: Answers) {
  const q = d.questions[k];
  const t = d.themes.find((x) => x.id === q.theme);
  const ans = (p: Pos, label: string, icon: string) =>
    `<button type="button" class="quiz-ans quiz-ans-${p}" data-a="${p}" aria-pressed="${a.v[k] === p}"><span class="quiz-ans-i" aria-hidden="true">${icon}</span>${label}</button>`;
  return `
    <p class="quiz-kicker"><span class="quiz-dot" style="--c:${THEME_COLOR[q.theme] ?? "#9a9ea6"}"></span>${esc(t ? L(t.fr, t.en) : "")} · ${L("Vote", "Vote")} ${fmtDate(q.d)}</p>
    <h2 class="quiz-q">${esc(L(q.fr.q, q.en.q))}</h2>
    <p class="quiz-ctx">${esc(L(q.fr.c, q.en.c))} <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${q.n}" target="_blank" rel="noopener">${L(`Scrutin n° ${q.n}`, `Vote no. ${q.n}`)} ↗</a></p>
    <div class="quiz-answers" role="group" aria-label="${L("Votre position", "Your position")}">
      ${ans("P", L("Pour", "For"), "✓")}${ans("C", L("Contre", "Against"), "✕")}${ans("A", L("Abstention", "Abstain"), "–")}
    </div>
    <div class="quiz-foot">
      <button type="button" class="quiz-weight" aria-pressed="${a.w[k]}"><span aria-hidden="true">★</span> ${L("Important pour moi", "Important to me")}</button>
      <button type="button" class="quiz-skip">${L("Passer · sans avis", "Skip · no opinion")} <span aria-hidden="true">→</span></button>
    </div>`;
}

function themeCard(d: QuizData, kind: "top" | "least", a: Answers) {
  const title = kind === "top"
    ? L("Quels sont les 3 sujets qui comptent le plus pour vous ?", "Which 3 subjects matter most to you?")
    : L("Et ceux qui vous intéressent le moins ?", "And the ones you care least about?");
  const ctx = kind === "top"
    ? L("Pour commencer. Ils seront comparés à la part de leurs interventions que chaque député et chaque groupe consacre à ces sujets dans l’hémicycle.", "To start with. They are compared with the share of their speeches each MP and group gives to these subjects in the chamber.")
    : L("Dernière question, facultative : jusqu’à 3 sujets. Un député qui en parle peu se rapproche de vous.", "Last question, optional: up to 3 subjects. MPs who rarely talk about them move closer to you.");
  return `
    <p class="quiz-kicker">${kind === "top" ? L("Vos priorités", "Your priorities") : L("Vos priorités, suite", "Your priorities, continued")}</p>
    <h2 class="quiz-q">${title}</h2>
    <p class="quiz-ctx">${ctx}</p>
    <div class="quiz-themes">${d.themes.map((t, i) => `<button type="button" class="quiz-theme" data-t="${i}" aria-pressed="false" style="--c:${THEME_COLOR[t.id] ?? "#9a9ea6"}">${esc(L(t.fr, t.en))}</button>`).join("")}</div>
    <div class="quiz-foot">
      <span class="quiz-picked muted small"></span>
      <button type="button" class="quiz-next"></button>
    </div>`;
}

// ---------- results ----------
const pctS = (x: number) => fmtPct(100 * x, 0);
const posLabel = (p: Pos | "-") => (p === "P" ? L("Pour", "For") : p === "C" ? L("Contre", "Against") : p === "A" ? L("Abstention", "Abstain") : L("n’a pas voté", "did not vote"));

async function results(stage: HTMLElement, d: QuizData, a: Answers) {
  const nAns = answered(a);
  if (nAns < MIN_ANSWERED) {
    stage.innerHTML = `<div class="quiz-card quiz-in-fwd"><h2 class="quiz-q">${L("Encore quelques réponses", "A few more answers")}</h2>
      <p class="quiz-ctx">${L(`Répondez à au moins ${MIN_ANSWERED} votes pour obtenir un classement : vous en avez passé ${d.questions.length - nAns}.`, `Answer at least ${MIN_ANSWERED} votes to get a ranking: you skipped ${d.questions.length - nAns}.`)}</p>
      <button type="button" class="quiz-start">${L("Reprendre le quiz", "Back to the quiz")}</button></div>`;
    stage.querySelector(".quiz-start")!.addEventListener("click", () => { st = { step: 1, a, started: true }; draw(stage, d, -1); });
    return;
  }
  const min = minOverlap(a);
  const rows = d.mps
    .map((m) => ({ m, sc: score(m[4], m[5], a) }))
    .filter((r): r is { m: QuizMp; sc: Score } => !!r.sc && r.sc.n >= min)
    .sort((x, y) => y.sc.s - x.sc.s || y.sc.n - x.sc.n);
  const groups = Object.entries(d.groups)
    .filter(([g]) => g !== "NI")
    .map(([g, x]) => ({ g, x, sc: score(x.line, x.t, a) }))
    .filter((r): r is { g: string; x: QuizGroup; sc: Score } => !!r.sc)
    .sort((x, y) => y.sc.s - x.sc.s);
  const best = rows[0];
  const far = rows.at(-1);
  const gcol = (g: string) => safeColor(d.groups[g]?.couleur, "#8d949a");
  const code = encode(a);
  const home = getHome();

  const mpRow = (r: { m: QuizMp; sc: Score }, i: number | null) => `<li${i == null ? ` class="quiz-solo"` : ""}>
      ${i != null ? `<span class="quiz-rk">${i + 1}</span>` : ""}
      <img src="${photoUrl(r.m[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />
      <span class="quiz-who"><a href="#/depute/${esc(r.m[0])}">${esc(r.m[1])}</a> <span class="chip" style="--c:${gcol(r.m[2])}">${esc(r.m[2])}</span></span>
      <span class="quiz-bar"><span style="width:${(100 * r.sc.s).toFixed(1)}%;background:${gcol(r.m[2])}"></span></span>
      <b>${pctS(r.sc.s)}</b></li>`;

  const disagreements = best ? d.questions
    .map((q, k) => ({ q, k, u: a.v[k], m: best.m[4][k] as Pos | "-" }))
    .filter((x) => x.u && x.m !== "-" && x.u !== x.m) : [];

  const bestWords = best?.m[6] ?? [];
  const mine = home?.dep ? d.mps.filter((m) => m[3] === home.dep) : [];

  stage.innerHTML = `<div class="quiz-results">
    ${best ? `<section class="quiz-match" style="--c:${gcol(best.m[2])}">
      <p class="quiz-kicker">${L("Votre député le plus proche", "Your closest MP")}</p>
      <div class="quiz-match-in">
        <img src="${photoUrl(best.m[0])}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />
        <div>
          <h2><a href="#/depute/${esc(best.m[0])}">${esc(best.m[1])}</a></h2>
          <p><span class="chip" style="--c:${gcol(best.m[2])}">${esc(best.m[2])}</span> ${esc(d.groups[best.m[2]]?.libelle ?? "")}</p>
          <p class="quiz-big"><span data-count="${Math.round(100 * best.sc.s)}">${pctS(best.sc.s)}</span> <small>${L("de proximité", "match")}</small></p>
          <p class="muted small">${L(`Même position sur ${best.sc.agree} des ${best.sc.n} votes que vous avez en commun`, `Same position on ${best.sc.agree} of the ${best.sc.n} votes you share`)}${best.sc.theme != null ? L(`, ${pctS(best.sc.theme)} sur vos sujets`, `, ${pctS(best.sc.theme)} on your subjects`) : ""}.</p>
          ${bestWords.length ? `<p class="quiz-words"><span class="muted small">${L("Ses mots dans l’hémicycle", "Their words in the chamber")}${colon()}</span>${bestWords.map((w) => `<span>${esc(w)}</span>`).join("")}</p>` : ""}
        </div>
      </div>
    </section>` : `<p class="quiz-ctx">${L("Aucun député n’a assez de votes en commun avec vos réponses.", "No MP shares enough votes with your answers.")}</p>`}

    <div class="quiz-actions">
      <button type="button" class="quiz-share"><span aria-hidden="true">🔗</span> ${L("Copier le lien de mes résultats", "Copy a link to my results")}</button>
      <button type="button" class="quiz-restart">${L("Refaire le quiz", "Take the quiz again")}</button>
      <span class="quiz-copied muted small" role="status"></span>
    </div>

    <section class="card">
      <header class="card-head"><h2>${L("Vos 5 députés les plus proches", "Your 5 closest MPs")}</h2><span class="muted small">${L(`${fmtNum(rows.length)} députés classés`, `${fmtNum(rows.length)} MPs ranked`)}</span></header>
      <ol class="quiz-rank">${rows.slice(0, 5).map((r, i) => mpRow(r, i)).join("")}</ol>
      ${far && far !== best ? `<p class="quiz-sub">${L("Le plus éloigné", "Furthest from you")}</p><ol class="quiz-rank">${mpRow(far, null)}</ol>` : ""}
      <p class="muted small">${L(`Classés : les députés qui ont voté sur au moins ${min} des ${nAns} votes auxquels vous avez répondu.`, `Ranked: MPs who voted on at least ${min} of the ${nAns} votes you answered.`)}</p>
    </section>

    <section class="card">
      <header class="card-head"><h2>${L("Les groupes", "The groups")}</h2></header>
      <ol class="quiz-bars">${groups.map((r, i) => `<li>
        <span class="quiz-rk">${i + 1}</span>
        <span class="quiz-who"><span class="chip" style="--c:${gcol(r.g)}">${esc(r.g)}</span> <span class="quiz-lib">${esc(r.x.libelle)}</span></span>
        <span class="quiz-bar"><span style="width:${(100 * r.sc.s).toFixed(1)}%;background:${gcol(r.g)}"></span></span>
        <b>${pctS(r.sc.s)}</b></li>`).join("")}</ol>
      <p class="muted small">${L("Position de chaque groupe : celle de la majorité de ses membres actuels qui ont voté.", "Each group’s position: that of the majority of its current members who voted.")}</p>
    </section>

    <section class="card" id="quiz-cands">
      <header class="card-head"><h2>${L("Les candidats de 2027", "The 2027 candidates")}</h2><a href="#/2027">${L("La course", "The race")}</a></header>
      <p class="quiz-caveat">${L("À lire avec prudence : ce classement repose sur les votes et les discours des députés du parti de chaque candidat à l’Assemblée, pas sur les programmes des candidats.", "Read with care: this ranking rests on the votes and speeches of each candidate’s party in the Assembly, not on the candidates’ manifestos.")}</p>
      <div id="quiz-cand-list"><p class="muted small">${L("Chargement…", "Loading…")}</p></div>
    </section>

    ${best ? `<section class="card">
      <header class="card-head"><h2>${L(`Là où vous n’êtes pas d’accord avec ${best.m[1]}`, `Where you disagree with ${best.m[1]}`)}</h2></header>
      ${disagreements.length ? `<ul class="quiz-diff">${disagreements.map((x) => `<li>
        <p>${esc(L(x.q.fr.q, x.q.en.q))}</p>
        <p class="quiz-vs"><span class="quiz-pos quiz-pos-${x.u}">${L("Vous", "You")}${colon()}${posLabel(x.u!)}</span><span class="quiz-pos quiz-pos-${x.m}">${esc(best.m[1])}${colon()}${posLabel(x.m)}</span>
        <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${x.q.n}" target="_blank" rel="noopener" class="small">${L(`Scrutin n° ${x.q.n}`, `Vote no. ${x.q.n}`)} ↗</a></p></li>`).join("")}</ul>`
        : `<p class="quiz-ctx">${L("Aucun désaccord sur les votes que vous avez en commun.", "No disagreement on the votes you share.")}</p>`}
    </section>` : ""}

    ${home?.dep ? `<section class="card">
      <header class="card-head"><h2>${L(`Les députés de votre département, ${esc(home.depName)}`, `MPs from your département, ${esc(home.depName)}`)}</h2></header>
      ${mine.length ? `<ol class="quiz-rank">${mine
        .map((m) => ({ m, sc: score(m[4], m[5], a) }))
        .sort((x, y) => (y.sc && y.sc.n >= min ? y.sc.s : -1) - (x.sc && x.sc.n >= min ? x.sc.s : -1))
        .map((r) => r.sc && r.sc.n >= min ? mpRow(r as { m: QuizMp; sc: Score }, null) : `<li class="quiz-na"><img src="${photoUrl(r.m[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" /><span class="quiz-who"><a href="#/depute/${esc(r.m[0])}">${esc(r.m[1])}</a> <span class="chip" style="--c:${gcol(r.m[2])}">${esc(r.m[2])}</span></span><span class="muted small">${L("trop peu de votes en commun", "too few votes in common")}</span></li>`)
        .join("")}</ol>` : `<p class="muted">${L("Aucun député trouvé pour ce département.", "No MP found for this département.")}</p>`}
    </section>` : `<p class="muted small">${L("Enregistrez votre commune pour voir aussi les députés de votre département.", "Save your town to also see the MPs from your département.")} <a href="#/explorer">${L("Choisir ma commune", "Choose my town")}</a></p>`}
  </div>`;

  stage.querySelector(".quiz-restart")!.addEventListener("click", () => {
    st = { step: 0, a: fresh(d.questions.length), started: true };
    if (location.hash !== "#/quiz") location.hash = "#/quiz";
    else draw(stage, d, 1);
  });
  stage.querySelector(".quiz-share")!.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#/quiz/${code}`;
    const out = stage.querySelector<HTMLElement>(".quiz-copied")!;
    try {
      await navigator.clipboard.writeText(url);
      out.textContent = L("Lien copié. Il contient vos réponses, rien n’est envoyé ailleurs.", "Link copied. It holds your answers; nothing is sent anywhere.");
    } catch {
      out.innerHTML = `<input class="quiz-url" readonly value="${esc(url)}" aria-label="${L("Lien de vos résultats", "Link to your results")}" />`;
      out.querySelector<HTMLInputElement>("input")!.select();
    }
  });
  drawCandidates(stage.querySelector<HTMLElement>("#quiz-cand-list")!, groups);
}

async function drawCandidates(box: HTMLElement, groups: { g: string; sc: Score }[]) {
  const polls = await loadPolls("2027").catch(() => null);
  let names = Object.keys(CANDIDATE_GROUPS);
  if (polls) {
    registerParties(polls.parties);
    // the candidates tested in the ten most recent first-round polls
    const recent = [...polls.firstRound].sort((x, y) => y.end.localeCompare(x.end)).slice(0, 10);
    const tested = new Set(recent.flatMap((p) => p.hyps.flatMap((h) => Object.keys(h))));
    names = names.filter((n) => tested.has(n));
  }
  const gs = new Map(groups.map((r) => [r.g, r.sc.s]));
  const rows = names
    .map((name) => {
      const map = CANDIDATE_GROUPS[name];
      const vals = map.g.map((g) => gs.get(g)).filter((x): x is number => x != null);
      return { name, map, s: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null };
    })
    .filter((r): r is typeof r & { s: number } => r.s != null)
    .sort((x, y) => y.s - x.s);
  if (!rows.length) { box.innerHTML = ""; return; }
  const top = rows[0].s;
  box.innerHTML = `<ol class="quiz-bars quiz-cands">${rows.map((r, i) => {
    const c = safeColor(meta(r.name).color, "#8d949a");
    return `<li class="${r.s >= top - 0.005 ? "is-best" : ""}">
      <span class="quiz-rk">${i + 1}</span>
      <span class="quiz-who"><strong>${esc(r.name)}</strong> <span class="muted small">${r.map.g.map(esc).join(" + ")}${r.map.note ? " *" : ""}</span></span>
      <span class="quiz-bar"><span style="width:${(100 * r.s).toFixed(1)}%;background:${c}"></span></span>
      <b>${pctS(r.s)}</b>
      ${r.map.note ? `<span class="quiz-note">* ${esc(L(r.map.note[0], r.map.note[1]))}</span>` : ""}</li>`;
  }).join("")}</ol>
  <p class="muted small">${L("Candidats testés dans les dix derniers sondages de premier tour. Chacun reçoit le score du groupe de son parti à l’Assemblée.", "Candidates tested in the ten latest first-round polls. Each gets the score of their party’s group in the Assembly.")}</p>`;
}

function methodNote(d: QuizData) {
  return `<details class="quiz-method card">
    <summary>${L("Méthode, limites et confidentialité", "Method, limits and privacy")}</summary>
    <div class="prose">
      <p>${L(`<b>Les questions.</b> ${d.questions.length} scrutins publics de la 17e législature. Un script classe tous les scrutins selon la participation et l’écart entre les positions des groupes ; parmi les plus clivants, nous en avons retenu un ou deux par sujet, en variant le camp gagnant (la gauche contre le reste, la droite et le RN contre le reste, la majorité contre l’opposition, et des votes qui traversent les blocs). Chaque question décrit ce que fait le texte, sans reprendre le vocabulaire de ses partisans ni de ses opposants, et renvoie au scrutin officiel. Quand le vote portait sur la suppression du texte, les positions sont inversées pour que « Pour » signifie toujours pour la proposition.`,
        `<b>The questions.</b> ${d.questions.length} public votes of the 17th legislature. A script ranks every vote by turnout and by how far apart the groups voted; among the most divisive we kept one or two per subject, varying which side won (left against the rest, the right and the RN against the rest, government against opposition, and votes that cut across blocs). Each question describes what the text does, without the vocabulary of its supporters or opponents, and links to the official record. When the vote was on deleting the text, positions are flipped so that “For” always means for the proposal.`)}</p>
      <p>${L(`<b>Le calcul.</b> Sur chaque vote auquel vous répondez : 1 point si votre position est celle du député, ½ si l’un de vous s’est abstenu, 0 si elles s’opposent ; une question marquée « importante » compte double. Les votes où le député était absent sont ignorés, et un député doit avoir voté sur au moins la moitié de vos réponses (3 au minimum) pour être classé. Vos sujets prioritaires sont comparés à la place du député parmi tous les députés pour la part de ses interventions consacrées à chaque sujet (l’inverse pour les sujets qui vous intéressent le moins). Un demi-point neutre est ajouté à chaque score de votes, pour qu’un sans-faute sur peu de votes ne passe pas devant un quasi sans-faute sur beaucoup. Score final : 80 % votes, 20 % sujets. Un groupe vote comme la majorité de ses membres actuels ; un candidat reçoit le score du groupe de son parti, ou du groupe le plus proche quand son parti n’a pas de député, ce qui est alors signalé.`,
        `<b>The scoring.</b> On each vote you answer: 1 point if your position matches the MP’s, ½ if one of you abstained, 0 if opposite; a question marked “important” counts double. Votes the MP missed are ignored, and an MP needs to have voted on at least half your answers (3 at least) to be ranked. Your priority subjects are compared with where the MP stands among all MPs by the share of their speeches on each subject (the reverse for the subjects you care least about). A neutral half-point is added to every vote score, so a perfect record on few votes does not outrank a near-perfect one on many. Final score: 80% votes, 20% subjects. A group votes as the majority of its current members; a candidate gets the score of their party’s group, or of the nearest group when their party has no MPs, which is then flagged.`)}</p>
      <p>${L("<b>Les limites.</b> Une poignée de votes ne résume pas une famille politique ; les députés ont pu changer de groupe ; sur une motion de censure seuls les votes pour existent, un député en fonction qui n’a pas voté pour est donc compté contre. Ce n’est ni un sondage ni une consigne de vote.", "<b>Limits.</b> A handful of votes does not sum up a political family; MPs may have changed group; on a censure motion only votes for exist, so a sitting MP who did not vote for it counts as against. This is neither a poll nor voting advice.")}</p>
      <p>${L("<b>Vos réponses</b> ne quittent pas votre navigateur : tout est calculé sur votre appareil, rien n’est enregistré ni envoyé. Le lien de partage contient vos réponses, codées dans l’adresse après le #, que les navigateurs ne transmettent pas aux serveurs.", "<b>Your answers</b> never leave your browser: everything is computed on your device, nothing is stored or sent. The share link holds your answers, encoded in the address after the #, which browsers do not send to servers.")}</p>
    </div>
    <p class="source">${L(`Source : open data de l’Assemblée nationale (scrutins et compte rendu des séances), jeu de données du quiz généré le ${fmtDate(d.generatedAt)}.`, `Source: Assemblée nationale open data (votes and verbatim record), quiz dataset built ${fmtDate(d.generatedAt)}.`)}</p>
  </details>`;
}
