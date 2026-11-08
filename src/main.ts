import "./style.css";
import { L, getLang, setLang, t } from "./i18n";
import { renderHome } from "./views/home";
import { renderPolls } from "./views/polls";
import { renderSimulator } from "./views/simulator";
import { renderResults } from "./views/results";
import { renderAssemblee } from "./views/assemblee";
import { renderCirco } from "./views/circo";
import { renderDepute } from "./views/depute";
import { renderSources } from "./views/sources";
import { initTooltip } from "./lib/tooltip";
import { joinPresence } from "./lib/cloud";
import { renderElection } from "./views/history";
import { renderFeed } from "./views/feed";
import { renderRace } from "./views/race";
import { renderSenat, renderSenateur } from "./views/senat";
import { depOf, loadDepartmentTowns, plmWhole, renderExplorer, renderTown } from "./views/explore";
import { getHome, onHome } from "./lib/cloud";
import { esc } from "./util";
import { renderEconomy } from "./views/economy";
import { renderQuiz } from "./views/quiz";
import { loadDeputes } from "./data";
import { foxSvg } from "./lib/fox";
import { pixelIcon, type PixelIcon } from "./lib/pixel-icons";
import { initSearch, openSearch } from "./lib/search";
import { foxBusy, initFox, initMotion, pageTransition } from "./lib/motion";
import { renderCandidate } from "./views/candidate";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const langBtn = document.getElementById("lang") as HTMLButtonElement;
const footer = document.getElementById("footer")!;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const quizBtn = document.getElementById("quiz-cta") as HTMLAnchorElement;
const tabbar = document.getElementById("tabbar")!;
const skip = document.getElementById("skip") as HTMLAnchorElement;
document.querySelector(".topbar .brand")!.insertAdjacentHTML("afterbegin", foxSvg(28, true));
initFox(document.querySelector<SVGSVGElement>(".topbar .brand .fox"));
initMotion(app);

// Full-bleed bands size themselves on --vw: the viewport minus a classic (non-overlay) scrollbar, which 100vw includes.
const setVw = () => document.documentElement.style.setProperty("--vw", `${document.documentElement.clientWidth}px`);
setVw();
new ResizeObserver(setVw).observe(document.documentElement);

// URL shape: #/<section>[/<param>][#<anchor>]
const routes: [RegExp, (m: RegExpMatchArray) => Promise<void> | void][] = [
  [/^#\/$/, () => renderHome(app)],
  [/^#\/sondages$/, () => renderPolls(app)],
  [/^#\/simulateur(?:\/([\w-]+))?$/, (m) => renderSimulator(app, m[1])],
  [/^#\/resultats(?:\/([\w-]+))?$/, (m) => renderResults(app, m[1])],
  [/^#\/presidentielle(?:\/\d{4})?$/, () => void (location.hash = "#/resultats/presidentielle-2022")], // old links
  [/^#\/assemblee(?:\/(deputes|composition|loyaute|themes))?$/, (m) => renderAssemblee(app, m[1] ?? "carte")],
  [/^#\/assemblee\/(\w{2,3})$/, (m) => renderAssemblee(app, "carte", m[1])],
  [/^#\/deputes$/, () => void (location.hash = "#/assemblee/deputes")], // old links
  [/^#\/circo\/(\w{4,5})$/, (m) => renderCirco(app, m[1])],
  [/^#\/depute\/(PA\d+)$/, (m) => renderDepute(app, m[1])],
  [/^#\/sources$/, () => renderSources(app)],
  [/^#\/histoire\/([\w-]+)$/, (m) => renderElection(app, m[1])],
  [/^#\/fil$/, () => renderFeed(app)],
  [/^#\/2027$/, () => renderRace(app)],
  [/^#\/senat(?:\/(\w{2,3}))?$/, (m) => renderSenat(app, m[1])],
  [/^#\/candidat\/([\w-]+)$/, (m) => renderCandidate(app, m[1])],
  [/^#\/senateur\/([\w-]+)$/, (m) => renderSenateur(app, m[1])],
  [/^#\/elus$/, () => renderAssemblee(app, "carte")],
  [/^#\/explorer(?:\/(\w{2,3}))?$/, (m) => renderExplorer(app, m[1])],
  [/^#\/ville\/(\w{5})$/, (m) => renderTown(app, m[1])],
  [/^#\/chiffres$/, () => renderEconomy(app)],
  [/^#\/quiz(?:\/([\w-]+))?$/, (m) => renderQuiz(app, m[1])],
  // section names as paths, so a typed or shared section link lands somewhere
  [/^#\/(chez-vous|parlement|la-france|france|archives)$/, (m) => void (location.hash = { "chez-vous": homeHref(), parlement: "#/assemblee", "la-france": "#/chiffres", france: "#/chiffres", archives: "#/resultats" }[m[1]]!)],
  [/^#\/programmes\/melenchon\/simulateur$/, () => import("./views/household").then((v) => v.renderHousehold(app))],
  [/^#\/programmes\/([\w-]+)$/, (m) => import("./views/programme").then((v) => v.renderProgramme(app, m[1]))],
];

// ---------- the reader's own officials (remembered town → its MP, its department → its senators) ----------
const homeHref = () => { const h = getHome(); return h?.code ? `#/ville/${h.code}` : "#/explorer"; };
const MY_MP = "te-my-mp";
type MyMp = { code: string; id: string | null; name?: string };
function myMp(code: string): MyMp | null {
  try { const v = JSON.parse(localStorage.getItem(MY_MP) ?? "null") as MyMp | null; return v?.code === code ? v : null; } catch { return null; }
}
let mpLookup = "";
/** The town's MP when one district covers (nearly) all of it; otherwise none ("Mon député" stays hidden). */
async function findMyMp(code: string) {
  if (mpLookup === code) return;
  mpLookup = code;
  try {
    const [{ towns }, deputes] = await Promise.all([loadDepartmentTowns(depOf(code)), loadDeputes()]);
    const ds = [...((towns.get(code) ?? plmWhole(towns, code))?.districts ?? [])].sort((a, b) => b.share - a.share);
    const one = ds.length === 1 || (ds[0] && ds[0].share >= 0.9) ? ds[0] : null;
    const mp = one ? deputes.find((d) => d.circo === one.code) : undefined;
    try { localStorage.setItem(MY_MP, JSON.stringify(mp ? { code, id: mp.id, name: `${mp.prenom} ${mp.nom}` } : { code, id: null })); } catch { /* private mode */ }
    if (mp && getHome()?.code === code) renderChrome(split().path);
  } catch { /* offline: try again next visit */ mpLookup = ""; }
}

// Information architecture: five sections, the site's promise "de votre mairie à l'Élysée".
// 1. Chez vous: the reader's town (remembered), their MP and senators, every town.
// 2. Parlement: the 577 MPs, how they vote and what they say, the Senate.
// 3. 2027: the race (forecast, polls and markets, simulator, the red/blue feed, the quiz).
// 4. La France: the country in numbers and the left–right shift maps.
// 5. Archives: results, every election since 1848.
type Item = { href: string; match: RegExp; fr: string; en: string; note?: string };
type Section = Item & { key: string; icon: PixelIcon; short: [string, string]; children: Item[] };
const NEVER = /$^/;
function sections(): Section[] {
  const home = getHome();
  const mine = homeHref();
  const mp = home?.code ? myMp(home.code) : null;
  return [
    {
      key: "chez-vous", icon: "home", short: ["Chez vous", "Local"], href: mine, match: /^#\/(explorer|ville)/, fr: "Chez vous", en: "Where you live",
      children: [
        ...(home?.code ? [{ href: mine, match: new RegExp(`^#\\/ville\\/${home.code}$`), fr: "Ma commune", en: "My town", note: home.commune ?? home.code }] : []),
        ...(mp?.id ? [{ href: `#/depute/${mp.id}`, match: NEVER, fr: "Mon député", en: "My MP", note: mp.name }] : []),
        ...(home?.dep ? [{ href: `#/senat/${home.dep}`, match: NEVER, fr: "Mes sénateurs", en: "My senators", note: home.depName }] : []),
        { href: "#/explorer", match: home?.code ? new RegExp(`^#\\/(explorer|ville\\/(?!${home.code}$))`) : /^#\/(explorer|ville)/, fr: "Toutes les communes", en: "Every town" },
      ],
    },
    {
      key: "parlement", icon: "parliament", short: ["Parlement", "Parliament"], href: "#/assemblee", match: /^#\/(assemblee|elus|circo|depute|senat|senateur)/, fr: "Parlement", en: "Parliament",
      children: [
        { href: "#/assemblee", match: /^#\/(elus$|assemblee(\/\w{2,3})?$|circo\/)/, fr: "Les 577 députés", en: "The 577 MPs" },
        { href: "#/assemblee/deputes", match: /^#\/(assemblee\/deputes|depute\/)/, fr: "Liste", en: "List" },
        { href: "#/assemblee/loyaute", match: /^#\/assemblee\/loyaute/, fr: "Doigt sur la couture", en: "Toeing the line" },
        { href: "#/assemblee/themes", match: /^#\/assemblee\/themes/, fr: "Ce qu’ils disent", en: "What they say" },
        { href: "#/assemblee/composition", match: /^#\/assemblee\/composition/, fr: "Composition", en: "Who they are" },
        { href: "#/senat", match: /^#\/(senat|senateur)/, fr: "Sénat", en: "Senate" },
      ],
    },
    {
      key: "2027", icon: "ballot", short: ["2027", "2027"], href: "#/2027", match: /^#\/(2027|sondages|simulateur|fil|quiz|candidat|programmes)/, fr: "2027", en: "2027",
      children: [
        { href: "#/2027", match: /^#\/2027/, fr: "La course", en: "The race" },
        { href: "#/sondages", match: /^#\/sondages/, fr: "Sondages et marchés", en: "Polls and markets" },
        { href: "#/simulateur", match: /^#\/simulateur/, fr: "Simulateur", en: "Simulator" },
        { href: "#/fil", match: /^#\/fil/, fr: "Fil rouge, fil bleu", en: "Red feed, blue feed" },
        { href: "#/quiz", match: /^#\/quiz/, fr: "Le quiz", en: "The quiz" },
      ],
    },
    {
      key: "la-france", icon: "france", short: ["France", "France"], href: "#/chiffres", match: /^#\/(chiffres|resultats\/bascules)/, fr: "La France", en: "France",
      children: [
        { href: "#/chiffres", match: /^#\/chiffres/, fr: "En chiffres", en: "In numbers" },
        { href: "#/chiffres#depuis", match: NEVER, fr: "La dette en direct", en: "The debt, live" },
        { href: "#/resultats/bascules", match: /^#\/resultats\/bascules/, fr: "Cartes des bascules", en: "Shift maps" },
      ],
    },
    {
      key: "archives", icon: "archive", short: ["Archives", "Archives"], href: "#/resultats", match: /^#\/(resultats(?!\/bascules)|histoire|presidentielle)/, fr: "Archives", en: "Archives",
      children: [
        { href: "#/resultats", match: /^#\/(resultats(\/presidentielles)?$|histoire)/, fr: "Toutes les élections depuis 1848", en: "Every election since 1848" },
        { href: "#/resultats/presidentielle-2022", match: /^#\/resultats\/presidentielle-2022/, fr: "Présidentielle 2022", en: "2022 presidential" },
        { href: "#/resultats/legislatives-2024", match: /^#\/resultats\/legislatives-2024/, fr: "Législatives 2024", en: "2024 legislative" },
      ],
    },
  ];
}

/** Where to go next from each part of the site, so no page is a dead end. */
function nextSteps(path: string) {
  const home = getHome();
  const mine = home?.code ? { href: `#/ville/${home.code}`, fr: `Votre commune, ${home.commune ?? ""}`, en: `Your town, ${home.commune ?? ""}` } : { href: "#/explorer", fr: "Trouver votre commune", en: "Find your town" };
  const race = { href: "#/2027", fr: "Où en est la présidentielle 2027", en: "Where the 2027 race stands" };
  const sim = { href: "#/simulateur", fr: "Simuler le second tour", en: "Simulate the runoff" };
  const polls = { href: "#/sondages", fr: "Tous les sondages et les marchés", en: "Every poll and market" };
  const mps = { href: "#/assemblee", fr: "Les 577 députés et leurs votes", en: "The 577 MPs and their votes" };
  const words = { href: "#/assemblee/themes", fr: "Ce que disent les députés en séance", en: "What MPs say in the chamber" };
  const hist = { href: "#/resultats", fr: "Toutes les élections depuis 1848", en: "Every election since 1848" };
  const feed = { href: "#/fil", fr: "Ce que disent la gauche et la droite aujourd’hui", en: "What left and right are saying today" };
  const quiz = { href: "#/quiz", fr: "Le quiz : qui vous ressemble ?", en: "The quiz: who is most like you?" };
  const france = { href: "#/chiffres", fr: "La France en chiffres", en: "France in numbers" };
  const shifts = { href: "#/resultats/bascules", fr: "Les cartes des bascules gauche-droite", en: "The left–right shift maps" };
  const pick = /^#\/(ville|explorer)/.test(path) ? [race, mps, quiz]
    : /^#\/(circo|depute|assemblee|elus|senat|senateur)/.test(path) ? [mine, /themes/.test(path) ? feed : words, race]
    : /^#\/quiz/.test(path) ? [race, sim, mps]
    : /^#\/(2027|sondages|simulateur)/.test(path) ? [mine, /simulateur/.test(path) ? polls : sim, quiz]
    : /^#\/fil/.test(path) ? [race, mps, mine]
    : /^#\/resultats\/bascules/.test(path) ? [france, hist, mine]
    : /^#\/(resultats|histoire)/.test(path) ? [race, shifts, mine]
    : /^#\/chiffres/.test(path) ? [race, shifts, mine]
    : null;
  if (!pick) return "";
  return `<nav class="next-steps" aria-label="${L("Et ensuite", "What next")}"><p>${L("Et ensuite", "What next")}</p>${pick.map((x) => `<a href="${x.href}">${esc(L(x.fr, x.en))}<span aria-hidden="true">→</span></a>`).join("")}</nav>`;
}

const split = () => {
  const h = location.hash || "#/";
  const i = h.indexOf("#", 1);
  return i < 0 ? { path: h, anchor: "" } : { path: h.slice(0, i), anchor: h.slice(i + 1) };
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const caret = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor"><rect x="1" y="3" width="8" height="1"/><rect x="2" y="4" width="6" height="1"/><rect x="3" y="5" width="4" height="1"/><rect x="4" y="6" width="2" height="1"/></svg>`;
function renderChrome(path: string) {
  const SECTIONS = sections();
  const current = SECTIONS.find((s) => s.match.test(path));
  const home = getHome();
  if (home?.code && !myMp(home.code)) setTimeout(() => void findMyMp(home.code!), 1200);

  // masthead: five sections, each a link plus a disclosure button for its menu
  nav.innerHTML = `<ul class="nav-list">${SECTIONS.map((s) => `<li class="nav-item${s === current ? " active" : ""}">
      <a class="nav-top" href="${s.href}"${s === current ? ` aria-current="true"` : ""}>${L(s.fr, s.en)}</a>
      <button type="button" class="nav-caret" aria-expanded="false" aria-controls="nm-${s.key}"><span class="sr-only">${L(`Menu ${s.fr}`, `${s.en} menu`)}</span>${caret}</button>
      <div class="nav-menu" id="nm-${s.key}"><ul>${s.children.map((c) => `<li><a href="${c.href}"${c.match.test(path) ? ` aria-current="page"` : ""}><span>${esc(L(c.fr, c.en))}</span>${c.note ? `<small>${esc(c.note)}</small>` : ""}</a></li>`).join("")}</ul></div>
    </li>`).join("")}</ul>`;

  // phones: the same five as a bottom tab bar
  tabbar.innerHTML = SECTIONS.map((s) => `<a href="${s.href}"${s === current ? ` aria-current="true" class="active"` : ""}>${pixelIcon(s.icon, 24)}<span>${L(...s.short)}</span></a>`).join("");

  const sub = document.getElementById("subnav")!;
  sub.hidden = !current;
  sub.setAttribute("aria-label", current ? L(`Rubrique ${current.fr}`, `${current.en} section`) : "");
  sub.innerHTML = current ? `<div>${current.children.map((c) => `<a href="${c.href}"${c.match.test(path) ? ` class="active" aria-current="page"` : ""}>${esc(L(c.fr, c.en))}</a>`).join("")}</div>` : "";
  // phones: the row scrolls sideways; bring the current page's link into view without moving the page
  const row = sub.firstElementChild as HTMLElement | null, on = sub.querySelector<HTMLElement>("a.active");
  if (row && on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);

  searchBtn.innerHTML = `${pixelIcon("search", 12)}<span class="sb-label">${L("Rechercher", "Search")}</span><kbd>${isMac ? "⌘" : "Ctrl"} K</kbd>`;
  searchBtn.setAttribute("aria-label", L(`Rechercher (${isMac ? "Cmd" : "Ctrl"}+K)`, `Search (${isMac ? "Cmd" : "Ctrl"}+K)`));
  quizBtn.innerHTML = `<span class="q-long">${L("Qui vous ressemble ?", "Who’s like you?")}</span><span class="q-short">${L("Le quiz", "Quiz")}</span>`;
  quizBtn.toggleAttribute("aria-current", /^#\/quiz/.test(path));
  langBtn.innerHTML = `<span class="l-long">${t().langSwitch}</span><span class="l-short" aria-hidden="true">${getLang() === "fr" ? "EN" : "FR"}</span>`;
  langBtn.setAttribute("aria-label", getLang() === "fr" ? "Switch to English" : "Passer en français");
  skip.textContent = L("Aller au contenu", "Skip to content");

  footer.innerHTML = `<div class="foot">
    <div class="foot-id">${document.querySelector(".topbar .brand")!.outerHTML}
      <p>${L("Données électorales françaises, de la commune à l’Élysée. Sources publiques, méthode ouverte, code libre.", "French election data, from your town hall to the Élysée. Public sources, open method, open code.")}</p>
      <p class="foot-quote">${L("« Qu’est-ce que le tiers état ? Tout. Qu’a-t-il été jusqu’à présent dans l’ordre politique ? Rien. Que demande-t-il ? À y devenir quelque chose. »", "“What is the Third Estate? Everything. What has it been until now in the political order? Nothing. What does it ask? To become something.”")} <span>Sieyès, 1789</span></p></div>
    <nav class="foot-map" aria-label="${L("Plan du site", "Site map")}">${SECTIONS.map((s) => `<div><a class="foot-h" href="${s.href}">${L(s.fr, s.en)}</a>${s.children.map((c) => `<a href="${c.href}">${esc(L(c.fr, c.en))}</a>`).join("")}</div>`).join("")}
      <div><span class="foot-h">${L("Le site", "About")}</span><a href="#/sources">${L("Sources et méthode", "Sources & method")}</a><a href="https://github.com/nicbay/projectview" target="_blank" rel="noopener">GitHub</a></div></nav>
  </div>`;
}

// ---------- masthead menus: hover on desktop, the caret button for keyboard and touch ----------
const closeMenus = (except?: Element | null) =>
  nav.querySelectorAll<HTMLElement>(".nav-item.open").forEach((li) => { if (li !== except) { li.classList.remove("open"); li.querySelector(".nav-caret")!.setAttribute("aria-expanded", "false"); } });
nav.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>(".nav-caret");
  if (!btn) return;
  const li = btn.closest(".nav-item")!;
  const open = !li.classList.contains("open");
  closeMenus(li);
  li.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", String(open));
  if (open) li.querySelector<HTMLElement>(".nav-menu a")?.focus();
});
nav.addEventListener("keydown", (e) => {
  const li = (e.target as Element).closest(".nav-item");
  if (!li) return;
  if (e.key === "Escape" && li.classList.contains("open")) { closeMenus(); li.querySelector<HTMLElement>(".nav-caret")!.focus(); }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (e.target as Element).closest(".nav-menu")) {
    e.preventDefault();
    const links = [...li.querySelectorAll<HTMLElement>(".nav-menu a")];
    const i = links.indexOf(e.target as HTMLElement);
    links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
  }
});
document.addEventListener("click", (e) => { if (!(e.target as Element).closest?.(".nav-item.open")) closeMenus(); });
nav.addEventListener("focusout", (e) => { const to = e.relatedTarget as Element | null; if (!to || !to.closest(".nav-item.open")) closeMenus(to?.closest(".nav-item")); });
searchBtn.addEventListener("click", () => openSearch(searchBtn));
skip.addEventListener("click", (e) => { e.preventDefault(); app.focus(); app.scrollIntoView(); });
initSearch();

/** Presentation pass after each render: wide tables scroll inside their own box on small screens. */
function enhance() {
  sectionHero();
  app.querySelectorAll<HTMLTableElement>("table.table").forEach((t) => {
    if (t.parentElement?.classList.contains("table-scroll")) return;
    const box = document.createElement("div");
    box.className = "table-scroll";
    t.replaceWith(box);
    box.append(t);
  });
}
/**
 * Every page opens like the homepage: its crumbs and header are lifted into one dark, full-width band,
 * the headline rises in line by line and the clause after the first comma takes the red→blue gradient.
 * That is the page's one entrance; what moves below it (figures, seats, lines) is in src/lib/motion.ts.
 */
function sectionHero() {
  const page = app.querySelector<HTMLElement>(":scope > .page");
  if (!page || page.classList.contains("home") || page.dataset.hx) return;
  const kids = [...page.children];
  let i = 0;
  const band: Element[] = [];
  if (kids[i]?.matches(".crumbs")) band.push(kids[i++]);
  if (!kids[i]?.matches(".page-head, .mp-head, .town-hero")) return;
  band.push(kids[i]);
  page.dataset.hx = "1";
  const box = document.createElement("div");
  box.className = "sec-hero";
  const inner = document.createElement("div");
  inner.className = "sec-hero-in";
  box.append(inner);
  band[0].before(box);
  inner.append(...band);
  const h1 = inner.querySelector("h1");
  if (h1 && h1.children.length === 0 && h1.id !== "sim-h1") {
    const text = h1.textContent ?? "";
    // two lines after the first comma or colon; the colon (and the no-break space French puts before it) stays on line one
    const m = /(,|\s?:)\s/.exec(text);
    const cut = m ? m.index + m[1].length : -1;
    const lines = cut > 0 && cut < text.length - 4 ? [text.slice(0, cut), text.slice(cut).trim()] : [text];
    h1.textContent = "";
    lines.forEach((t, n) => {
      const ln = document.createElement("span");
      ln.className = "ln";
      const sp = document.createElement("span");
      if (n === 1) { const em = document.createElement("em"); em.textContent = t; sp.append(em); } else sp.textContent = t;
      sp.style.animationDelay = `${n * 0.1}s`;
      ln.append(sp);
      h1.append(ln);
    });
  }
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; enhance(); });
}).observe(app, { childList: true, subtree: true });

let lastPath = "";
async function route() {
  const { path, anchor } = split();
  // in-page anchor on the same page: just scroll
  if (path === lastPath && anchor) return document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
  const firstRender = !lastPath;
  lastPath = path;
  // the first page just appears (the fox is assembling); later ones cross over with the masthead held still
  return firstRender ? render(path, anchor) : pageTransition(() => render(path, anchor));
}
let renderSeq = 0;
async function render(path: string, anchor: string | undefined) {
  // A view transition runs its update on the next painted frame, so a quick second navigation (or a
  // background tab) can leave an older render queued: drop it if the address has moved on since.
  if (split().path !== path) return;
  const seq = ++renderSeq;
  renderChrome(path);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      app.innerHTML = `<p class="muted pad">${t().loading}</p>`;
      foxBusy(true);
      try {
        await fn(m);
        if (seq !== renderSeq) return; // a newer navigation took over while this one loaded
        const page = app.querySelector(":scope > .page");
        if (page && !page.querySelector(".next-steps")) page.insertAdjacentHTML("beforeend", nextSteps(path));
        if (anchor) document.getElementById(anchor)?.scrollIntoView();
        else window.scrollTo(0, 0);
      } catch (err) {
        console.error(err);
        app.innerHTML = `<p class="error pad">${t().error} — ${(err as Error).message}</p>`;
      } finally {
        foxBusy(false);
      }
      return;
    }
  }
  location.hash = "#/";
}

langBtn.addEventListener("click", () => {
  setLang(getLang() === "fr" ? "en" : "fr");
  lastPath = "";
  route();
});
window.addEventListener("hashchange", route);
onHome(() => renderChrome(split().path));
setLang(getLang());
initTooltip();
joinPresence();
route();
