// "Qui a dit ça ?" (#/quiz/citations): the third quiz. A real, sourced quote; four faces; guess who said it.
// Ten rounds drawn at random from public/data/quiz-quotes.json: people are drawn first, then one of their quotes, and always one from
// Teddy Riner, whose lines about judo sound enough like campaign bravado to throw the reader off. After each pick
// the card says who, when and where, gives one line of context and links the source.
// Every quote in the data file is verbatim and carries its source; nothing here scores or ranks the candidates.
import "../styles/quiz.css";
import { fetchJson, loadPolls } from "../data";
import { L, fmtDate } from "../i18n";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { esc, safeColor, safeUrl } from "../util";
import { quizBoxes } from "./quiz";

type Two = { fr: string; en: string };
interface Quote { slug: string; kind?: string; fr: string; en: string; date: string; where: string; context: Two; source: { title: string; publisher: string; url: string }; legal: string | null; legalUrl?: string | null }
interface Person { slug: string; name: string; pollName: string; photo: string | null; party: Two }
interface QuotesData { generated: string; quotes: Quote[] }

const ROUNDS = 10, PER_PERSON = 2, CHOICES = 4, DECOY = "riner";
const rnd = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(xs: readonly T[]): T[] { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Round { q: Quote; choices: string[]; pick: string | null }
let game: { rounds: Round[]; step: number } | null = null;

/** Ten quotes: one from the decoy, the rest at random with at most two per person; the four faces of a round are
 *  the author and three others, the nearest neighbours on the left–right order among them half the time (harder). */
function deal(d: QuotesData, people: Person[]): Round[] {
  const known = new Set(people.map((p) => p.slug));
  // people first, then one of their quotes: every politician is as likely to come up as any other, however many
  // quotes each has in the file (a second quote from someone only once everyone has had one)
  const of = (slug: string) => shuffle(d.quotes.filter((q) => q.slug === slug));
  const picked: Quote[] = of(DECOY).slice(0, 1);
  const others = shuffle([...known].filter((x) => x !== DECOY));
  for (let round = 0; picked.length < ROUNDS && round < PER_PERSON; round++) for (const slug of others) { if (picked.length >= ROUNDS) break; const q = of(slug).find((x) => !picked.includes(x)); if (q) picked.push(q); }
  const order = [...people].sort((a, b) => spectrumRank(a.pollName) - spectrumRank(b.pollName)).map((p) => p.slug);
  return shuffle(picked).map((q) => {
    const others = order.filter((s) => s !== q.slug), i = order.indexOf(q.slug);
    const near = [...others].sort((a, b) => Math.abs(order.indexOf(a) - i) - Math.abs(order.indexOf(b) - i));
    const wrong = rnd(2) && q.slug !== DECOY ? [...shuffle(near.slice(0, 4)).slice(0, 2), ...shuffle(near.slice(4)).slice(0, 1)] : shuffle(others).slice(0, CHOICES - 1);
    return { q, choices: shuffle([q.slug, ...wrong.slice(0, CHOICES - 1)]), pick: null };
  });
}

const face = (p: Person, size: number) => (p.photo
  ? `<img class="qz-ph" src="${esc(safeUrl(p.photo))}" alt="" width="${size}" height="${size}" data-hide-broken>`
  : `<span class="qz-ph qz-ph-none" style="width:${size}px;height:${size}px"></span>`);
const when = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(d) : /^\d{4}-\d{2}$/.test(d) ? new Date(`${d}-01`).toLocaleDateString(L("fr-FR", "en-GB"), { month: "long", year: "numeric" }) : d);

export async function renderQuotes(app: HTMLElement) {
  const [d, idx, polls] = await Promise.all([
    fetchJson<QuotesData>("/data/quiz-quotes.json"),
    fetchJson<{ candidates: Person[] }>("/data/candidates/index.json"),
    loadPolls("2027").catch(() => null),
  ]);
  if (polls) registerParties(polls.parties);
  const people = idx.candidates.filter((p) => d.quotes.some((q) => q.slug === p.slug));
  const by = new Map(people.map((p) => [p.slug, p]));
  if (!game) game = { rounds: deal(d, people), step: 0 };

  app.innerHTML = `
    <section class="page quiz-page qz-page">
      <header class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027", "2027 presidential")}</p>
        <h1>${L("Qui a dit ça ?", "Who said it?")}</h1>
        <p class="dek">${L(`${ROUNDS} phrases qui ont fait parler, toutes réellement prononcées ou écrites. À vous de retrouver leur auteur.`, `${ROUNDS} lines that got people talking, all really said or written. Your job: find who said each one.`)}</p>
      </header>
      <div class="quiz qz qq" id="quiz"></div>
      <p class="muted small qq-note">${L(`Citations exactes, chacune avec sa source, tirées au sort parmi ${d.quotes.length}, une seule par personne dans une partie (hors piège). Une phrase sortie de son contexte ne résume ni une personne ni un programme ; le contexte est donné après chaque réponse.`, `Exact quotes, each with its source, drawn at random from ${d.quotes.length}, one per person in a round (the decoy aside). A line out of context sums up neither a person nor a program; the context is given after each answer.`)} <a href="#/quiz">${L("Le quiz : qui vous ressemble ?", "The quiz: who is closest to you?")}</a></p>
    </section>`;
  const stage = app.querySelector<HTMLElement>("#quiz")!;

  const draw = () => {
    const g = game!;
    if (g.step >= g.rounds.length) return end();
    const r = g.rounds[g.step], total = g.rounds.length, done = r.pick != null;
    stage.innerHTML = `<div class="qz-run">
      <div class="qz-top qq-top">
        <div class="qz-progress" role="progressbar" aria-label="${L("Progression", "Progress")}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${g.step}">${g.rounds.map((x, i) => `<i class="${i < g.step ? (x.pick === x.q.slug ? "is-done" : "is-miss") : i === g.step ? "is-now" : ""}"></i>`).join("")}</div>
        <span class="qz-count" aria-hidden="true">${g.step + 1}<span>/${total}</span></span>
      </div>
      <div class="qz-card qq-card">
        <p class="qz-kicker"><span class="qz-src qz-src-${r.q.kind === "tweet" ? "s" : "v"}">${r.q.kind === "tweet" ? L("Message publié en ligne", "Posted online") : L("Citation exacte", "Exact quote")}</span><span>${L("Qui l’a dit ?", "Who said it?")}</span></p>
        <blockquote class="qq-quote" lang="fr"><p>« ${esc(r.q.fr)} »</p></blockquote>
        ${L("", `<p class="qz-ctx qq-en">${esc(r.q.en)}</p>`)}
        <div class="qq-choices" role="group" aria-label="${L("Votre réponse", "Your answer")}">
          ${r.choices.map((s, i) => { const p = by.get(s)!; const cls = !done ? "" : s === r.q.slug ? " is-right" : s === r.pick ? " is-wrong" : " is-off";
            return `<button type="button" class="qq-choice${cls}" data-s="${esc(s)}" style="--c:${safeColor(meta(p.pollName).color, "#8d949a")}"${done ? " disabled" : ""}>${face(p, 56)}<span><b>${esc(p.name)}</b><small>${esc(L(p.party.fr, p.party.en))}</small></span><kbd aria-hidden="true">${i + 1}</kbd></button>`; }).join("")}
        </div>
        <div class="qq-reveal" ${done ? "" : "hidden"}></div>
      </div>
    </div>`;
    const reveal = stage.querySelector<HTMLElement>(".qq-reveal")!;
    const show = () => {
      const p = by.get(r.q.slug)!, ok = r.pick === r.q.slug;
      reveal.hidden = false;
      reveal.innerHTML = `
        <p class="qq-verdict ${ok ? "is-ok" : "is-ko"}">${ok ? L("Exact.", "Correct.") : L("Raté.", "Missed.")} <b>${esc(p.name)}</b>, ${esc(r.q.where)}, ${when(r.q.date)}.</p>
        <p class="qz-ctx">${esc(L(r.q.context.fr, r.q.context.en))} <a href="${esc(safeUrl(r.q.source.url))}" target="_blank" rel="noopener">${esc(r.q.source.publisher || r.q.source.title)} ↗</a></p>
        ${r.q.legal ? `<p class="qz-ctx qq-legal">${esc(r.q.legal)}${r.q.legalUrl ? ` <a href="${esc(safeUrl(r.q.legalUrl))}" target="_blank" rel="noopener">${L("Source", "Source")} ↗</a>` : ""}</p>` : ""}
        <button type="button" class="qz-cta qq-next">${g.step + 1 < total ? L("Citation suivante", "Next quote") : L("Voir mon score", "See my score")} <i aria-hidden="true">→</i></button>`;
      const next = reveal.querySelector<HTMLButtonElement>(".qq-next")!;
      next.addEventListener("click", () => { g.step++; draw(); window.scrollTo({ top: scrollY + stage.getBoundingClientRect().top - 120, behavior: reduced() ? "auto" : "smooth" }); });
      next.focus({ preventScroll: true });
    };
    const pick = (s: string) => {
      if (r.pick != null) return;
      r.pick = s;
      stage.querySelectorAll<HTMLButtonElement>(".qq-choice").forEach((b) => { b.disabled = true; b.classList.add(b.dataset.s === r.q.slug ? "is-right" : b.dataset.s === s ? "is-wrong" : "is-off"); });
      show();
    };
    stage.querySelectorAll<HTMLButtonElement>(".qq-choice").forEach((b) => b.addEventListener("click", () => pick(b.dataset.s!)));
    if (done) show();
    stage.onkeydown = null;
    keys = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (r.pick == null && n >= 1 && n <= r.choices.length) { pick(r.choices[n - 1]); e.preventDefault(); }
    };
  };

  const end = () => {
    const g = game!, right = g.rounds.filter((r) => r.pick === r.q.slug).length, total = g.rounds.length;
    const fooled = g.rounds.find((r) => r.q.slug === DECOY && r.pick !== DECOY);
    const verdict = right === total ? L("Sans faute. Vous écoutez trop la radio.", "A clean sheet. You listen to too much radio.")
      : right >= total * 0.7 ? L("Solide : vous reconnaissez les voix.", "Solid: you know the voices.")
      : right >= total * 0.4 ? L("Honorable. Les extrêmes se ressemblent parfois plus qu’on ne croit.", "Respectable. The extremes sometimes sound more alike than you would think.")
      : L("Ils parlent tous pareil, finalement ?", "So they all sound the same after all?");
    stage.innerHTML = `<div class="qz-results">
      <section class="qz-match qq-score">
        <p class="qz-match-k">${L("Votre score", "Your score")}</p>
        <p class="qz-big"><span>${right}</span><small> / ${total}</small></p>
        <h2>${verdict}</h2>
        ${fooled ? `<p class="qz-match-n">${L(`Le piège : « ${esc(fooled.q.fr)} » était de Teddy Riner, qui parlait de sport.`, `The trap: “${esc(fooled.q.en)}” was Teddy Riner, talking about sport.`)}</p>` : ""}
      </section>
      <div class="qz-actions">
        <button type="button" class="qz-cta" id="qq-again">${L("Rejouer avec d’autres citations", "Play again with other quotes")} <i aria-hidden="true">↻</i></button>
      </div>
      ${quizBoxes(12, 40, 13, "q")}
      <section class="card">
        <header class="card-head"><h2>${L("Les citations de cette partie", "This round’s quotes")}</h2></header>
        <ul class="qz-reveal qq-recap">${g.rounds.map((r) => { const p = by.get(r.q.slug)!, ok = r.pick === r.q.slug;
          return `<li style="--c:${safeColor(meta(p.pollName).color, "#8d949a")}"><span class="qz-pos qz-pos-${ok ? "P" : "C"}">${ok ? L("Trouvé", "Got it") : L("Raté", "Missed")}</span>
            <span class="qz-rq" lang="fr">« ${esc(r.q.fr)} » <small class="qz-rsrc"><a href="${esc(safeUrl(r.q.source.url))}" target="_blank" rel="noopener">${esc(r.q.source.publisher || L("Source", "Source"))}, ${when(r.q.date)} ↗</a></small></span>
            <a class="qz-rc" href="#/candidat/${esc(p.slug)}">${face(p, 28)}<b>${esc(p.name)}</b></a></li>`; }).join("")}</ul>
      </section>
    </div>`;
    keys = null;
    stage.querySelector("#qq-again")!.addEventListener("click", () => { game = { rounds: deal(d, people), step: 0 }; draw(); });
    const h = stage.querySelector<HTMLElement>(".qq-score h2");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  };

  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = (e) => { if (!document.body.contains(stage)) { document.removeEventListener("keydown", keyHandler!); keyHandler = null; return; } keys?.(e); };
  document.addEventListener("keydown", keyHandler);
  draw();
}
let keys: ((e: KeyboardEvent) => void) | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
