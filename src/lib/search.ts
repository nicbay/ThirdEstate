// Site-wide search (command palette): Ctrl/Cmd+K or "/" opens it, from any page.
// Searches towns (geo API, via searchPlaces), MPs and senators (name, group, department), words said in the
// chamber (public/data/an/interventions/words-index.json, exact or prefix) and every page of the site.
// Data loads on first open. Recent picks are kept in localStorage.
import { fetchJson, loadDeputes, type Depute } from "../data";
import { L, fmtNum, getLang } from "../i18n";
import { esc, safeColor } from "../util";
/** Recent searches come back from localStorage: only in-site routes are allowed as links. */
const safeHref = (h: string | undefined) => (typeof h === "string" && /^#\/[\w\-/#.%]*$/.test(h) ? h : "#/assemblee/themes");
import { searchPlaces } from "../views/explore";
import { loadSenateurs, type Senateur } from "../views/senat";
import { openWordByText } from "../views/speeches";
import { pixelIcon } from "./pixel-icons";

type Kind = "page" | "town" | "mp" | "senator" | "word";
interface Hit { kind: Kind; label: string; context: string; href?: string; word?: string; color?: string; score: number }

/** Every section and page, both languages searchable whatever the current one. */
const PAGES: { href: string; fr: string; en: string; k?: string }[] = [
  { href: "#/", fr: "Accueil", en: "Home", k: "une home" },
  { href: "#/explorer", fr: "Toutes les communes", en: "Every town", k: "chez vous ville commune town maire" },
  { href: "#/assemblee", fr: "Les 577 députés, la carte", en: "The 577 MPs, the map", k: "parlement assemblée nationale assembly circonscriptions" },
  { href: "#/assemblee/deputes", fr: "Liste des députés", en: "List of MPs", k: "parlement deputes mps" },
  { href: "#/assemblee/loyaute", fr: "Doigt sur la couture : la discipline de vote", en: "Toeing the line: party discipline", k: "loyauté loyalty rebelles frondeurs" },
  { href: "#/assemblee/themes", fr: "Ce qu’ils disent : les mots de l’hémicycle", en: "What they say: words in the chamber", k: "thèmes themes nuage cloud discours speeches" },
  { href: "#/assemblee/composition", fr: "Composition de l’Assemblée", en: "Who sits in the Assembly", k: "professions métiers sociologie" },
  { href: "#/senat", fr: "Sénat : les 348 sénateurs", en: "Senate: the 348 senators", k: "parlement senateurs senators" },
  { href: "#/2027", fr: "Présidentielle 2027 : la course", en: "2027 presidential: the race", k: "prévision forecast élection" },
  { href: "#/sondages", fr: "Sondages et marchés prédictifs", en: "Polls and prediction markets", k: "polls polymarket intentions de vote" },
  { href: "#/simulateur", fr: "Simulateur du second tour", en: "Runoff simulator", k: "simulateur simulation reports de voix" },
  { href: "#/fil", fr: "Fil rouge, fil bleu : l’actualité vue de gauche et de droite", en: "Red feed, blue feed: the news from left and right", k: "feed actualité news presse" },
  { href: "#/quiz", fr: "Le quiz : qui vous ressemble ?", en: "The quiz: who is most like you?", k: "candidat test" },
  { href: "#/chiffres", fr: "La France en chiffres", en: "France in numbers", k: "économie economy dette debt chômage inflation" },
  { href: "#/chiffres#depuis", fr: "La dette en direct", en: "The debt, live", k: "économie economy compteur" },
  { href: "#/resultats/bascules", fr: "Cartes des bascules gauche-droite", en: "Left–right shift maps", k: "flèches arrows shifts carte map" },
  { href: "#/resultats", fr: "Toutes les élections depuis 1848", en: "Every election since 1848", k: "archives présidentielles histoire history" },
  { href: "#/resultats/presidentielle-2022", fr: "Présidentielle 2022 : sondages et résultat", en: "2022 presidential: polls vs result", k: "archives résultats results" },
  { href: "#/resultats/legislatives-2024", fr: "Législatives 2024", en: "2024 legislative election", k: "archives résultats results" },
  { href: "#/sources", fr: "Sources et méthode", en: "Sources and method", k: "données data méthodologie" },
];

const KIND_LABEL: Record<Kind, [string, string]> = {
  page: ["Pages", "Pages"], town: ["Communes", "Towns"], mp: ["Députés", "MPs"], senator: ["Sénateurs", "Senators"], word: ["Mots de l’hémicycle", "Words in the chamber"],
};
const KIND_TAG: Record<Kind, [string, string]> = { page: ["Page", "Page"], town: ["Commune", "Town"], mp: ["Député", "MP"], senator: ["Sénateur", "Senator"], word: ["Mot", "Word"] };
const ORDER: Kind[] = ["town", "mp", "senator", "word", "page"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
/** 4 exact, 3 prefix, 2 every query word starts a word (first word first), 1 every query word inside; 0 none. */
function score(q: string, text: string) {
  if (!q) return 0;
  if (text === q) return 4;
  if (text.startsWith(q)) return 3;
  const qt = q.split(" "), tt = text.split(/[\s-]+/);
  if (qt.every((w) => tt.some((t) => t.startsWith(w)))) return tt[0].startsWith(qt[0]) ? 2.5 : 2;
  if (q.length >= 3 && qt.every((w) => text.includes(w))) return 1;
  return 0;
}

// ---------- data, loaded on first open ----------
type Person = { label: string; n: string; extra: string; context: string; href: string; color?: string; kind: "mp" | "senator" };
let peopleP: Promise<Person[]> | null = null;
const loadPeople = () =>
  (peopleP ??= Promise.all([loadDeputes().catch((): Depute[] => []), loadSenateurs().catch((): Senateur[] => [])]).then(([ds, ss]) => [
    ...ds.map((d) => ({
      kind: "mp" as const, label: `${d.prenom} ${d.nom}`, n: norm(`${d.prenom} ${d.nom}`), extra: norm(`${d.nom} ${d.groupe?.abrev ?? ""} ${d.groupe?.libelle ?? ""} ${d.departement ?? ""} ${d.numDepartement ?? ""}`),
      context: [d.groupe?.abrev, d.departement && `${d.departement}${d.numCirco ? ` · ${L(`${d.numCirco}${d.numCirco === 1 ? "re" : "e"} circ.`, `district ${d.numCirco}`)}` : ""}`].filter(Boolean).join(" · "),
      href: `#/depute/${d.id}`, color: safeColor(d.groupe?.couleur),
    })),
    ...ss.map((s) => ({
      kind: "senator" as const, label: `${s.prenom} ${s.nom}`, n: norm(`${s.prenom} ${s.nom}`), extra: norm(`${s.nom} ${s.groupe?.abrev ?? ""} ${s.groupe?.libelle ?? ""} ${s.circonscription} ${s.numDepartement}`),
      context: [s.groupe?.abrev, s.circonscription].filter(Boolean).join(" · "), href: `#/senateur/${s.id}`, color: safeColor(s.groupe?.couleur),
    })),
  ]));
type WordRow = [string, number];
let wordsP: Promise<{ rows: WordRow[]; n: string[] }> | null = null;
const loadWordIndex = () =>
  (wordsP ??= fetchJson<WordRow[]>("/data/an/interventions/words-index.json").catch((): WordRow[] => []).then((rows) => ({ rows, n: rows.map((r) => norm(r[0])) })));

// ---------- recent picks ----------
const RECENT = "te-search-recent";
const getRecent = (): Hit[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]").slice(0, 6); } catch { return []; } };
function remember(h: Hit) {
  try {
    const list = [h, ...getRecent().filter((x) => !(x.kind === h.kind && x.label === h.label && x.href === h.href))].slice(0, 6);
    localStorage.setItem(RECENT, JSON.stringify(list.map(({ kind, label, context, href, word, color }) => ({ kind, label, context, href, word, color, score: 0 }))));
  } catch { /* private mode */ }
}

// ---------- matching ----------
async function localHits(raw: string): Promise<Hit[]> {
  const q = norm(raw);
  if (!q) return [];
  const hits: Hit[] = [];
  for (const p of PAGES) {
    const s = Math.max(score(q, norm(p.fr)), score(q, norm(p.en)), score(q, norm(p.k ?? "")) * 0.8);
    if (s) hits.push({ kind: "page", label: L(p.fr, p.en), context: p.href.replace(/^#/, ""), href: p.href, score: s });
  }
  const [people, words] = await Promise.all([loadPeople(), q.length >= 2 ? loadWordIndex() : null]);
  for (const p of people) {
    const s = Math.max(score(q, p.n), score(q, p.extra) * 0.7);
    if (s) hits.push({ kind: p.kind, label: p.label, context: p.context, href: p.href, color: p.color, score: s });
  }
  if (words && q.length >= 2) {
    // exact or prefix only, most said first (the index is sorted by count)
    let n = 0;
    for (let i = 0; i < words.n.length && n < 6; i++) {
      const w = words.n[i];
      if (w === q || w.startsWith(q)) {
        const [text, count] = words.rows[i];
        hits.push({ kind: "word", label: text, context: L(`dit ${fmtNum(count)} fois en séance`, `said ${fmtNum(count)} times in the chamber`), word: text, score: w === q ? 4 : 3 });
        n++;
      }
    }
  }
  return hits;
}

// ---------- the dialog ----------
let dlg: HTMLDialogElement | null = null;
let input: HTMLInputElement;
let list: HTMLElement;
let items: Hit[] = [];
let active = -1;
let seq = 0;
let timer = 0;
let opener: Element | null = null;

function build() {
  dlg = document.createElement("dialog");
  dlg.className = "cmdk";
  dlg.setAttribute("aria-labelledby", "cmdk-title");
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg!.close(); });
  dlg.addEventListener("close", () => { (opener as HTMLElement | null)?.focus?.(); });
  window.addEventListener("hashchange", () => dlg?.open && dlg.close());
}
function frame() {
  dlg!.innerHTML = `<div class="cmdk-box">
    <h2 id="cmdk-title" class="sr-only">${L("Rechercher sur Third Estate", "Search Third Estate")}</h2>
    <div class="cmdk-in">${pixelIcon("search", 24)}
      <input type="search" id="cmdk-q" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"
        placeholder="${L("Une commune, un élu, un mot, une page…", "A town, an official, a word, a page…")}" aria-label="${L("Rechercher", "Search")}"/>
      <button type="button" class="cmdk-esc" aria-label="${L("Fermer", "Close")}">Esc</button></div>
    <div id="cmdk-list" class="cmdk-list" role="listbox" aria-label="${L("Résultats", "Results")}"></div>
    <p class="cmdk-help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${L("parcourir", "move")}</span><span><kbd>↵</kbd> ${L("ouvrir", "open")}</span><span><kbd>Esc</kbd> ${L("fermer", "close")}</span></p>
    <p class="sr-only" aria-live="polite" id="cmdk-status"></p>
  </div>`;
  input = dlg!.querySelector<HTMLInputElement>("#cmdk-q")!;
  list = dlg!.querySelector<HTMLElement>("#cmdk-list")!;
  dlg!.querySelector(".cmdk-esc")!.addEventListener("click", () => dlg!.close());
  input.addEventListener("input", () => update());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      setActive((active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    }
  });
  list.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (!el) return;
    e.preventDefault();
    choose(items[Number(el.dataset.i)]);
  });
  list.addEventListener("mousemove", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (el && Number(el.dataset.i) !== active) setActive(Number(el.dataset.i), false);
  });
}
function setActive(i: number, scroll = true) {
  active = i;
  list.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.i) === i)));
  const el = list.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (el) { input.setAttribute("aria-activedescendant", el.id); if (scroll) el.scrollIntoView({ block: "nearest" }); }
  else input.removeAttribute("aria-activedescendant");
}
function draw(hits: Hit[], note = "", pending = false) {
  // groups, strongest first (ties in a fixed order), at most 6 rows each
  const by = new Map<Kind, Hit[]>();
  for (const h of hits) by.set(h.kind, [...(by.get(h.kind) ?? []), h]);
  const groups = [...by.entries()]
    .map(([k, hs]) => [k, hs.sort((a, b) => b.score - a.score).slice(0, 6)] as const)
    .sort((a, b) => b[1][0].score - a[1][0].score || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  items = groups.flatMap(([, hs]) => hs);
  let i = 0;
  list.innerHTML =
    (note ? `<p class="cmdk-note">${note}</p>` : "") +
    groups
      .map(([k, hs]) => `<div role="group" aria-labelledby="cmdk-g-${k}"><p class="cmdk-g" id="cmdk-g-${k}" role="presentation">${L(...KIND_LABEL[k])}</p>${hs
        .map((h) => {
          const n = i++;
          return `<a role="option" id="cmdk-o-${n}" data-i="${n}" href="${esc(safeHref(h.href))}" aria-selected="false" tabindex="-1">
            <span class="cmdk-t">${safeColor(h.color) ? `<i style="background:${safeColor(h.color)}"></i>` : ""}<b>${esc(h.label)}</b><span>${esc(h.context)}</span></span>
            <span class="cmdk-k">${L(...KIND_TAG[h.kind])}</span></a>`;
        })
        .join("")}</div>`)
      .join("") +
    (pending ? `<p class="cmdk-note">${L("Recherche des communes…", "Looking up towns…")}</p>` : "");
  if (!items.length && !note && !pending) list.innerHTML = `<p class="cmdk-note">${L("Aucun résultat.", "No results.")}</p>`;
  setActive(items.length ? 0 : -1, false);
  dlg!.querySelector("#cmdk-status")!.textContent = pending ? "" : L(`${items.length} résultats`, `${items.length} results`);
}
function drawEmpty() {
  const recent = getRecent();
  if (recent.length) return draw(recent.map((h, n) => ({ ...h, score: 10 - n })), L("Recherches récentes", "Recent searches"));
  draw(["#/2027", "#/assemblee", "#/explorer", "#/quiz"].map((href, n) => { const p = PAGES.find((x) => x.href === href)!; return { kind: "page" as Kind, label: L(p.fr, p.en), context: href.slice(1), href, score: 5 - n }; }), L("Par exemple : « Panot », « 75011 », « palliatifs », « simulateur »", "For example: “Panot”, “75011”, “palliative”, “simulator”"));
}
async function update() {
  const raw = input.value.trim();
  const my = ++seq;
  clearTimeout(timer);
  if (!raw) return drawEmpty();
  const local = await localHits(raw);
  if (my !== seq) return;
  const townish = raw.length >= 3 && !/^#/.test(raw);
  draw(local, "", townish);
  if (!townish) return;
  timer = window.setTimeout(async () => {
    const places = await searchPlaces(raw).catch(() => []);
    if (my !== seq) return;
    const q = norm(raw);
    // street addresses only when the query looks like one (it has a number); a name query wants towns
    const towns: Hit[] = places.filter((p) => /\d/.test(raw) || !/\b\d{5}\b/.test(p.label)).slice(0, 6).map((p, n) => ({
      kind: "town", label: p.label, context: p.context, href: `#/ville/${p.code}`,
      // a postcode puts towns first; otherwise they rank by name match, just below an equal match of another kind
      score: /^\d{5}$/.test(raw) ? 5 - n * 0.01 : Math.max(score(q, norm(p.label)), 1) - 0.05 - n * 0.01,
    }));
    draw([...local, ...towns]);
  }, 200);
}
function choose(h: Hit) {
  remember(h);
  if (h.kind === "town" && h.href) { try { sessionStorage.setItem("te-picked", h.href.split("/").pop()!); } catch { /* private mode */ } }
  dlg!.close();
  if (h.kind === "word" && h.word) void openWordByText(h.word);
  else if (h.href) location.hash = h.href;
}

export function openSearch(from?: Element | null) {
  if (!dlg) build();
  if (dlg!.open) return input.focus();
  opener = from ?? document.activeElement;
  frame();
  dlg!.lang = getLang();
  dlg!.showModal();
  input.focus();
  drawEmpty();
  void loadPeople();
  void loadWordIndex();
}

/** Ctrl/Cmd+K anywhere, or "/" when not typing, opens the search. */
export function initSearch() {
  document.addEventListener("keydown", (e) => {
    const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); openSearch(); }
    else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector("dialog[open]")) { e.preventDefault(); openSearch(); }
  });
}
