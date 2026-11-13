import "./fonts.css";
import "./styles/tokens.css";
import "./style.css";
import "./redesign.css";
import "./styles/overhaul.css";
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
import { fetchJson, loadDeputes } from "./data";
import { foxCells, foxSvg } from "./lib/fox";
import { pixelIcon, type PixelIcon } from "./lib/pixel-icons";
import { initSearch, openSearch } from "./lib/search";
import { foxBusy, initFox, initMotion, pageTransition } from "./lib/motion";
import { renderCandidate } from "./views/candidate";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const langBtn = document.getElementById("lang") as HTMLButtonElement;
const themeBtn = document.getElementById("theme") as HTMLButtonElement;
// light / dark: follows the system until the reader picks one (kept in localStorage, applied before paint by public/theme-boot.js)
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
function paintThemeBtn() {
  const dark = isDark();
  themeBtn.innerHTML = pixelIcon(dark ? "sun" : "moon", 12);
  themeBtn.setAttribute("aria-label", dark ? L("Passer en thème clair", "Switch to light theme") : L("Passer en thème sombre", "Switch to dark theme"));
  themeBtn.setAttribute("aria-pressed", String(dark));
}
themeBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  // back to "follow the system" when the pick matches it, so a later system change is followed again
  const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try { if (next === sys) localStorage.removeItem("te-theme"); else localStorage.setItem("te-theme", next); } catch { /* private mode */ }
  if (next === sys) delete document.documentElement.dataset.theme;
  paintThemeBtn();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeBtn);
const footer = document.getElementById("footer")!;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const quizBtn = document.getElementById("quiz-cta") as HTMLAnchorElement;
const tabbar = document.getElementById("tabbar")!;
const skip = document.getElementById("skip") as HTMLAnchorElement;
document.querySelector(".topbar .brand")!.insertAdjacentHTML("afterbegin", foxSvg(28, true));
initFox(document.querySelector<SVGSVGElement>(".topbar .brand .fox"));
initMotion(app);
// A portrait that fails to load disappears (instead of a broken-image icon). One capturing listener replaces
// per-image onerror attributes, which the Content-Security-Policy forbids.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.hasAttribute("data-hide-broken")) t.style.visibility = "hidden";
}, true);

// Full-bleed bands size themselves on --vw: the viewport minus a classic (non-overlay) scrollbar, which 100vw includes.
const setVw = () => document.documentElement.style.setProperty("--vw", `${document.documentElement.clientWidth}px`);
setVw();
new ResizeObserver(setVw).observe(document.documentElement);

// URL shape: #/<section>[/<param>][#<anchor>]
const routes: [RegExp, (m: RegExpMatchArray) => Promise<void> | void][] = [
  [/^#\/$/, () => renderHome(app)],
  [/^#\/apercu$/, () => void (location.hash = "#/")], // the hero preview became the homepage
  [/^#\/sondages$/, () => renderPolls(app)],
  [/^#\/sondages\/instituts$/, () => import("./views/pollsters").then((v) => v.renderPollsters(app))],
  [/^#\/simulateur(?:\/([\w-]+))?$/, (m) => renderSimulator(app, m[1])],
  [/^#\/resultats(?:\/([\w-]+))?$/, (m) => renderResults(app, m[1])],
  [/^#\/presidentielle(?:\/\d{4})?$/, () => void (location.hash = "#/resultats/presidentielle-2022")], // old links
  [/^#\/assemblee(?:\/(deputes|composition|loyaute|themes))?$/, (m) => renderAssemblee(app, m[1] ?? "carte")],
  [/^#\/assemblee\/(\w{2,3})$/, (m) => renderAssemblee(app, "carte", m[1])],
  [/^#\/deputes$/, () => void (location.hash = "#/assemblee/deputes")], // old links
  [/^#\/circo\/(\w{4,5})$/, (m) => renderCirco(app, m[1])],
  [/^#\/depute\/(PA\d+)$/, (m) => renderDepute(app, m[1])],
  [/^#\/sources$/, () => renderSources(app)],
  [/^#\/mentions-legales$/, () => import("./views/legal").then((v) => v.renderLegal(app))],
  [/^#\/histoire\/([\w-]+)$/, (m) => renderElection(app, m[1])],
  [/^#\/fil$/, () => renderFeed(app)],
  [/^#\/2027$/, () => renderRace(app)],
  [/^#\/2027\/voter$/, () => import("./views/vote").then((v) => v.renderVote(app))],
  [/^#\/2027\/comment-ca-marche$/, () => import("./views/explainers").then((v) => v.renderExplainers(app))],
  [/^#\/2027\/calendrier$/, () => import("./views/calendar").then((v) => v.renderCalendar(app))],
  [/^#\/2027\/parrainages$/, () => import("./views/parrainages").then((v) => v.renderParrainages(app))],
  [/^#\/senat(?:\/(\w{2,3}))?$/, (m) => renderSenat(app, m[1])],
  [/^#\/candidat\/([\w-]+)$/, (m) => renderCandidate(app, m[1])],
  [/^#\/senateur\/([\w-]+)$/, (m) => renderSenateur(app, m[1])],
  [/^#\/elus$/, () => renderAssemblee(app, "carte")],
  [/^#\/explorer(?:\/(\w{2,3}))?$/, (m) => renderExplorer(app, m[1])],
  [/^#\/ville\/(\w{5})$/, (m) => renderTown(app, m[1])],
  [/^#\/chiffres$/, () => renderEconomy(app)],
  [/^#\/quiz(?:\/([\w-]+))?$/, (m) => renderQuiz(app, m[1])],
  // section names as paths, so a typed or shared section link lands somewhere
  // (old six-section names included: "la-france" and "france" now live under Data & archives)
  [/^#\/(chez-vous|votre-ville|parlement|la-france|france|archives|donnees)$/, (m) => void (location.hash = { "chez-vous": homeHref(), "votre-ville": homeHref(), parlement: "#/assemblee", "la-france": "#/chiffres", france: "#/chiffres", archives: "#/resultats", donnees: "#/resultats" }[m[1]]!)],
  [/^#\/2027\/(simulateur|programmes|sondages|quiz)$/, (m) => void (location.hash = `#/${m[1]}`)], // guessed paths under the 2027 section
  [/^#\/(budget|simulateur-foyer)$/, () => void (location.hash = "#/programmes/melenchon/simulateur")],
  [/^#\/programmes(?:\/theme\/([\w-]+))?$/, (m) => import("./views/programmes-hub").then((v) => v.renderProgrammesHub(app, m[1]))],
  [/^#\/programmes\/melenchon\/simulateur$/, () => import("./views/household").then((v) => v.renderHousehold(app))],
  [/^#\/programmes\/([\w-]+)$/, (m) => import("./views/programme").then((v) => v.renderProgramme(app, m[1]))],
];

// ---------- the reader's own officials (remembered town → its MP, its department → its senators) ----------
const homeHref = () => { const h = getHome(); return h?.code ? `#/ville/${h.code}` : "#/explorer"; };
const MY_MP = "te-my-mp";
type MyMp = { code: string; id: string | null; name?: string };
function myMp(code: string): MyMp | null {
  try { const v = JSON.parse(localStorage.getItem(MY_MP) ?? "null") as MyMp | null; return v?.code === code && (v.id === null || /^PA\d+$/.test(String(v.id))) ? v : null; } catch { return null; }
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

// Information architecture: four sections, organised by what the reader wants to know.
// 1. 2027: the presidential race — who leads, what they propose, how to take part (polls, programmes, simulators,
//    the red/blue feed, the quiz, and how voting, sponsorships and the calendar work).
// 2. Chez vous: the reader's town (remembered), their MP and senators, every town.
// 3. Parlement: the MPs (map, composition, discipline, speeches — one page with tabs), finding an MP, the Senate.
// 4. Données et archives: every election since 1848, the shift maps, France in numbers.
// Each page carries a one-line description: the masthead menus and the phone menu say what is behind every link.
// `group` splits a long menu into columns; `minor` keeps a page out of the second-level row (it stays in the menus);
// `sub` is a shorter label for that row.
type Item = { href: string; match: RegExp; fr: string; en: string; note?: string; desc?: [string, string]; group?: [string, string]; minor?: boolean; sub?: [string, string] };
type Section = Item & { key: string; icon: PixelIcon; short: [string, string]; blurb: [string, string]; children: Item[] };
const NEVER = /$^/;
function sections(): Section[] {
  const home = getHome();
  const mine = homeHref();
  const mp = home?.code ? myMp(home.code) : null;
  const RACE: [string, string] = ["Suivre la course", "Follow the race"];
  const PROG: [string, string] = ["Les programmes", "The programmes"];
  const VOTE: [string, string] = ["Voter en 2027", "Voting in 2027"];
  const SIM: [string, string] = ["Simuler", "Try it yourself"];
  return [
    {
      key: "2027", icon: "ballot", short: ["2027", "2027"], href: "#/2027", match: /^#\/(2027|sondages|simulateur|fil|quiz|candidat|programmes)/, fr: "2027", en: "2027",
      blurb: ["La présidentielle : qui est en tête, ce qu’ils proposent, comment voter.", "The presidential race: who leads, what they propose, how to vote."],
      children: [
        { group: RACE, href: "#/2027", match: /^#\/(2027$|candidat)/, fr: "La course", en: "The race", desc: ["La prévision, les candidats, leurs fiches", "The forecast, the candidates, their files"] },
        { group: RACE, href: "#/sondages", match: /^#\/sondages$/, fr: "Sondages et marchés", en: "Polls and markets", desc: ["Chaque sondage, et ce que parient les marchés", "Every poll, and what the markets are betting"] },
        { group: RACE, href: "#/sondages/instituts", match: /^#\/sondages\/instituts/, fr: "Les instituts notés", en: "Pollsters graded", sub: ["Instituts", "Pollsters"], desc: ["De A+ à F, sur leurs sondages passés face aux résultats", "A+ to F, on their past polls against the results"] },
        { group: RACE, href: "#/sondages#point", match: NEVER, minor: true, fr: "Le point du jour", en: "Today’s brief", desc: ["Ce qui a bougé en 24 heures, et pourquoi peut-être", "What moved in 24 hours, and perhaps why"] },
        { group: RACE, href: "#/fil", match: /^#\/fil/, fr: "Fil rouge, fil bleu", en: "Red feed, blue feed", desc: ["L’actualité vue de gauche et de droite", "The news as left and right see it"] },
        { group: RACE, href: "#/2027/calendrier", match: /^#\/2027\/calendrier/, fr: "Calendrier de la campagne", en: "Campaign calendar", sub: ["Calendrier", "Calendar"], desc: ["Les dates clés jusqu’au second tour", "Key dates up to the runoff"] },
        { group: RACE, href: "#/2027/parrainages", match: /^#\/2027\/parrainages/, minor: true, fr: "Les parrainages", en: "Sponsorships", desc: ["Les 500 signatures d’élus pour être candidat", "The 500 officials’ signatures needed to run"] },
        { group: PROG, href: "#/programmes", match: /^#\/programmes(\/theme\/[\w-]+)?$/, fr: "Les programmes", en: "Programmes", desc: ["Tous les candidats, de la gauche à la droite", "Every candidate, from left to right"] },
        { group: PROG, href: "#/programmes#comparer", match: NEVER, minor: true, fr: "Comparer par thème", en: "Compare by theme", desc: ["Sur le même sujet, qui propose quoi", "On the same subject, who proposes what"] },
        { group: PROG, href: "#/programmes#couts", match: NEVER, minor: true, fr: "Ce que ça coûte", en: "What it costs", desc: ["Le chiffre du parti, celui des instituts", "The party’s figure and the institutes’"] },
        { group: PROG, href: "#/programmes#droit", match: NEVER, minor: true, fr: "Droit et faisabilité", en: "Law and feasibility", desc: ["Constitution, droit européen, majorités", "Constitution, EU law, majorities"] },
        { group: VOTE, href: "#/2027/voter", match: /^#\/2027\/voter/, fr: "Comment voter", en: "How to vote", desc: ["S’inscrire, voter par procuration, trouver son bureau", "Registering, proxy votes, your polling station"] },
        { group: VOTE, href: "#/2027/comment-ca-marche", match: /^#\/2027\/comment-ca-marche/, minor: true, fr: "Comment ça marche", en: "How it works", desc: ["L’élection présidentielle expliquée, étape par étape", "The presidential election explained, step by step"] },
        { group: VOTE, href: "#/quiz", match: /^#\/quiz/, fr: "Le quiz", en: "The quiz", desc: ["Quel député, quel candidat vous ressemble ?", "Which MP and candidate are closest to you?"] },
        { group: SIM, href: "#/simulateur", match: /^#\/simulateur/, fr: "Simulateur de second tour", en: "Second-round simulator", sub: ["Simulateur de second tour", "Runoff simulator"], desc: ["Composez votre second tour, report de voix par report", "Build your own runoff, vote transfer by transfer"] },
        { group: SIM, href: "#/programmes/melenchon/simulateur", match: /^#\/programmes\/[\w-]+\/simulateur/, fr: "Votre budget selon un programme", en: "Your budget under a programme", sub: ["Votre budget", "Your budget"], desc: ["L’effet d’un programme sur le budget de votre foyer", "A programme’s effect on your household budget"] },
      ],
    },
    {
      key: "chez-vous", icon: "home", short: ["Chez vous", "Your town"], href: mine, match: /^#\/(explorer|ville)/, fr: "Chez vous", en: "Your town",
      blurb: ["Votre commune, votre député, vos sénateurs.", "Your town, your MP, your senators."],
      children: [
        ...(home?.code ? [{ href: mine, match: new RegExp(`^#\\/ville\\/${home.code}$`), fr: "Ma commune", en: "My town", note: home.commune ?? home.code }] : []),
        ...(mp?.id ? [{ href: `#/depute/${mp.id}`, match: NEVER, fr: "Mon député", en: "My MP", note: mp.name }] : []),
        ...(home?.dep ? [{ href: `#/senat/${home.dep}`, match: NEVER, fr: "Mes sénateurs", en: "My senators", note: home.depName }] : []),
        { href: "#/explorer", match: home?.code ? new RegExp(`^#\\/(explorer|ville\\/(?!${home.code}$))`) : /^#\/(explorer|ville)/, fr: "Toutes les communes", en: "Every town", desc: ["Maire, conseil, écoles, sécurité, quartiers : 34 920 communes", "Mayor, council, schools, safety, neighbourhoods: 34,920 towns"] },
      ],
    },
    {
      key: "parlement", icon: "parliament", short: ["Parlement", "Parliament"], href: "#/assemblee", match: /^#\/(assemblee|elus|circo|depute|senat|senateur)/, fr: "Parlement", en: "Parliament",
      blurb: ["577 députés, 348 sénateurs : chacun de leurs votes.", "577 MPs, 348 senators: every vote they cast."],
      children: [
        { href: "#/assemblee", match: /^#\/(elus$|assemblee(\/(\w{2,3}|composition|loyaute|themes))?$|circo\/)/, fr: "Les députés", en: "The MPs", desc: ["La carte, qui ils sont, comment ils votent, ce qu’ils disent", "The map, who they are, how they vote, what they say"] },
        { href: "#/assemblee/deputes", match: /^#\/(assemblee\/deputes|depute\/)/, fr: "Trouver un député", en: "Find an MP", desc: ["Chercher un député, par nom ou par groupe", "Find an MP by name or group"] },
        { href: "#/senat", match: /^#\/(senat|senateur)/, fr: "Sénat", en: "Senate", desc: ["Les 348 sénateurs et leurs votes", "The 348 senators and their votes"] },
      ],
    },
    {
      key: "archives", icon: "archive", short: ["Données", "Data"], href: "#/resultats", match: /^#\/(resultats|histoire|presidentielle|chiffres)/, fr: "Données et archives", en: "Data & archives",
      blurb: ["Chaque élection depuis 1848, et le pays en chiffres.", "Every election since 1848, and the country in numbers."],
      children: [
        { href: "#/resultats", match: /^#\/(resultats(\/presidentielles)?$|histoire)/, fr: "Toutes les élections depuis 1848", en: "Every election since 1848", desc: ["Résultats, cartes, annonces filmées", "Results, maps, filmed announcements"] },
        { href: "#/resultats/presidentielle-2022", match: /^#\/resultats\/presidentielle-2022/, fr: "Présidentielle 2022", en: "2022 presidential", desc: ["Les sondages face au résultat", "The polls against the result"] },
        { href: "#/resultats/legislatives-2024", match: /^#\/resultats\/legislatives-2024/, fr: "Législatives 2024", en: "2024 legislative", desc: ["Circonscription par circonscription", "District by district"] },
        { href: "#/resultats/bascules", match: /^#\/resultats\/bascules/, fr: "Cartes des bascules", en: "Shift maps", desc: ["Où la France a glissé à gauche, à droite", "Where France moved left, and right"] },
        { href: "#/chiffres", match: /^#\/chiffres/, fr: "La France en chiffres", en: "France in numbers", desc: ["Dette, emploi, prix, déficit", "Debt, jobs, prices, deficit"] },
        { href: "#/chiffres#depuis", match: NEVER, minor: true, fr: "La dette en direct", en: "The debt, live", desc: ["Le compteur, président par président", "The counter, president by president"] },
      ],
    },
  ];
}

/** Where to go next from each part of the site, so no page is a dead end. */
function nextSteps(path: string) {
  const home = getHome();
  const mine = home?.code ? { href: `#/ville/${home.code}`, fr: `Votre commune, ${home.commune ?? ""}`, en: `Your town, ${home.commune ?? ""}` } : { href: "#/explorer", fr: "Trouver votre commune", en: "Find your town" };
  const race = { href: "#/2027", fr: "Où en est la présidentielle 2027", en: "Where the 2027 race stands" };
  const sim = { href: "#/simulateur", fr: "Le simulateur de second tour", en: "The second-round simulator" };
  const budget = { href: "#/programmes/melenchon/simulateur", fr: "Votre budget selon un programme", en: "Your budget under a programme" };
  const vote = { href: "#/2027/voter", fr: "Comment voter en 2027", en: "How to vote in 2027" };
  const how = { href: "#/2027/comment-ca-marche", fr: "Comment marche la présidentielle", en: "How the presidential election works" };
  const cal = { href: "#/2027/calendrier", fr: "Le calendrier de la campagne", en: "The campaign calendar" };
  const polls = { href: "#/sondages", fr: "Tous les sondages et les marchés", en: "Every poll and market" };
  const mps = { href: "#/assemblee", fr: "Les députés et leurs votes", en: "The MPs and their votes" };
  const words = { href: "#/assemblee/themes", fr: "Ce que disent les députés en séance", en: "What MPs say in the chamber" };
  const hist = { href: "#/resultats", fr: "Toutes les élections depuis 1848", en: "Every election since 1848" };
  const feed = { href: "#/fil", fr: "Ce que disent la gauche et la droite aujourd’hui", en: "What left and right are saying today" };
  const quiz = { href: "#/quiz", fr: "Le quiz : qui vous ressemble ?", en: "The quiz: who is most like you?" };
  const progs = { href: "#/programmes", fr: "Comparer les programmes des candidats", en: "Compare the candidates’ programmes" };
  const byTheme = { href: "#/programmes#comparer", fr: "Sur le même sujet, qui propose quoi", en: "On the same subject, who proposes what" };
  const france = { href: "#/chiffres", fr: "La France en chiffres", en: "France in numbers" };
  const shifts = { href: "#/resultats/bascules", fr: "Les cartes des bascules gauche-droite", en: "The left–right shift maps" };
  const pick = /^#\/(ville|explorer)/.test(path) ? [race, mps, quiz]
    : /^#\/(circo|depute|assemblee|elus|senat|senateur)/.test(path) ? [mine, /themes/.test(path) ? feed : words, race]
    : /^#\/quiz/.test(path) ? [race, progs, mps]
    : /^#\/programmes$/.test(path) ? [race, quiz, mps]
    : /^#\/programmes\/[\w-]+\/simulateur/.test(path) ? [byTheme, sim, vote]
    : /^#\/programmes\//.test(path) ? [byTheme, budget, race]
    : /^#\/candidat/.test(path) ? [progs, polls, quiz]
    : /^#\/2027\/voter/.test(path) ? [cal, how, mine]
    : /^#\/2027\/parrainages/.test(path) ? [race, cal, how]
    : /^#\/2027\//.test(path) ? [vote, race, progs]
    : /^#\/2027$/.test(path) ? [progs, vote, quiz]
    : /^#\/(2027|sondages|simulateur)/.test(path) ? [progs, /simulateur/.test(path) ? polls : sim, quiz]
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
// The 2027 menu also lists the candidates' programmes, by surname: loaded once, after first paint.
let progNames: { slug: string; candidate: string }[] | null = null;
let progAsked = false;
function loadProgNames() {
  if (progAsked) return;
  progAsked = true;
  const last = (n: string) => n.split(" ").slice(-1)[0];
  fetchJson<{ programmes: { slug: string; candidate: string }[] }>("/data/programmes/index.json")
    .then((d) => { progNames = d.programmes.map((p) => ({ slug: p.slug, candidate: p.candidate })).sort((a, b) => last(a.candidate).localeCompare(last(b.candidate), "fr")); renderChrome(split().path); })
    .catch(() => { /* the menu simply has no candidate list */ });
}
const sheet = document.createElement("dialog");
sheet.className = "menu-sheet";
sheet.id = "menu-sheet";
document.body.append(sheet);
const closeSheet = () => { if (sheet.open) sheet.close(); };

function renderChrome(path: string) {
  const SECTIONS = sections();
  const current = SECTIONS.find((s) => s.match.test(path));
  const home = getHome();
  if (home?.code && !myMp(home.code)) setTimeout(() => void findMyMp(home.code!), 1200);
  if (!progAsked) setTimeout(loadProgNames, 600);
  const candLinks = (cls: string) => (progNames?.length ? `<div class="${cls}"><p>${L("Programme par candidat", "Programme by candidate")}</p><div>${progNames.map((p) => `<a href="#/programmes/${esc(p.slug)}"${path === `#/programmes/${p.slug}` ? ` aria-current="page"` : ""}>${esc(p.candidate)}</a>`).join("")}</div></div>` : "");
  const itemLink = (c: Item) => `<a href="${c.href}"${c.match.test(path) ? ` aria-current="page"` : ""}><span>${esc(L(c.fr, c.en))}</span>${c.note ? `<small class="nm-note">${esc(c.note)}</small>` : c.desc ? `<small>${esc(L(...c.desc))}</small>` : ""}</a>`;

  // a section's pages, in columns when they carry a group (2027), each under its heading
  const groupsOf = (s: Section) => {
    const out: { head: [string, string] | null; items: Item[] }[] = [];
    for (const c of s.children) {
      const last = out[out.length - 1];
      if (last && last.head === (c.group ?? null)) last.items.push(c);
      else out.push({ head: c.group ?? null, items: [c] });
    }
    return out;
  };
  const isGrouped = (s: Section) => s.children.some((c) => c.group);
  const withCands = (s: Section) => s.key === "2027";
  const menuBody = (s: Section) => isGrouped(s)
    ? `<div class="nm-body"><div class="nm-groups">${groupsOf(s).map((g) => `<div class="nm-group">${g.head ? `<p>${esc(L(...g.head))}</p>` : ""}<ul>${g.items.map((c) => `<li>${itemLink(c)}</li>`).join("")}</ul></div>`).join("")}</div>${withCands(s) ? candLinks("nm-extra") : ""}</div>`
    : `<ul>${s.children.map((c) => `<li>${itemLink(c)}</li>`).join("")}</ul>`;

  // masthead: four sections, each a link plus a disclosure button for its menu (a panel: what the section is, then its pages)
  nav.innerHTML = `<ul class="nav-list">${SECTIONS.map((s, n) => `<li class="nav-item${s === current ? " active" : ""}">
      <a class="nav-top" href="${s.href}"${s === current ? ` aria-current="true"` : ""}>${L(s.fr, s.en)}</a>
      <button type="button" class="nav-caret" aria-expanded="false" aria-controls="nm-${s.key}"><span class="sr-only">${L(`Menu ${s.fr}`, `${s.en} menu`)}</span>${caret}</button>
      <div class="nav-menu${isGrouped(s) ? " is-grouped" : ""}" id="nm-${s.key}"><div class="nm-in">
        <div class="nm-lead">${pixelIcon(s.icon, 36)}<span class="nm-idx">0${n + 1}/0${SECTIONS.length}</span><b>${L(s.fr, s.en)}</b><p>${esc(L(...s.blurb))}</p></div>
        ${menuBody(s)}
      </div></div>
    </li>`).join("")}</ul>`;

  // phones and small tablets: the four sections and a Menu button in a bottom tab bar; the menu sheet has everything
  tabbar.innerHTML = SECTIONS.map((s) => `<a href="${s.href}"${s === current ? ` aria-current="true" class="active"` : ""}>${pixelIcon(s.icon, 24)}<span>${L(...s.short)}</span></a>`).join("")
    + `<button type="button" id="menu-btn" aria-haspopup="dialog" aria-controls="menu-sheet">${pixelIcon("menu", 24)}<span>Menu</span></button>`;
  sheet.setAttribute("aria-label", L("Menu du site", "Site menu"));
  sheet.innerHTML = `<div class="ms-box">
    <header class="ms-head"><span class="ms-brand">${foxSvg(32, true)}<b>Third<span>Estate</span></b></span><button type="button" class="ms-close" data-ms="close" aria-label="${L("Fermer le menu", "Close the menu")}">${pixelIcon("close", 24)}</button></header>
    <div class="ms-tools">
      <button type="button" data-ms="search">${pixelIcon("search", 12)}<span>${L("Rechercher une commune, un élu, un mot", "Search a town, an official, a word")}</span></button>
      <a class="ms-quiz" href="#/quiz">${L("Le quiz : qui vous ressemble ?", "The quiz: who’s like you?")}</a>
    </div>
    <nav class="ms-nav" aria-label="${L("Rubriques", "Sections")}">${SECTIONS.map((s, n) => `<details${s === current || (!current && n === 0) ? " open" : ""}>
        <summary>${pixelIcon(s.icon, 24)}<span><b>${L(s.fr, s.en)}</b><small>${esc(L(...s.blurb))}</small></span>${caret}</summary>
        <div class="ms-links">${groupsOf(s).map((g) => `${g.head ? `<p class="ms-group">${esc(L(...g.head))}</p>` : ""}${g.items.map(itemLink).join("")}`).join("")}${withCands(s) ? candLinks("ms-extra") : ""}</div>
      </details>`).join("")}</nav>
    <footer class="ms-foot"><a href="#/">${L("Accueil", "Home")}</a><a href="#/sources">${L("Sources et méthode", "Sources & method")}</a><a href="#/mentions-legales">${L("Mentions légales", "Legal notice")}</a><button type="button" data-ms="lang">${getLang() === "fr" ? "English" : "Français"}</button></footer>
  </div>`;

  const sub = document.getElementById("subnav")!;
  sub.hidden = !current;
  sub.setAttribute("aria-label", current ? L(`Rubrique ${current.fr}`, `${current.en} section`) : "");
  sub.innerHTML = current ? `<div><span class="sub-k">${pixelIcon(current.icon, 12)}${L(current.fr, current.en)}</span>${current.children.filter((c) => !c.minor || c.match.test(path)).map((c) => `<a href="${c.href}"${c.match.test(path) ? ` class="active" aria-current="page"` : ""}>${esc(L(...(c.sub ?? [c.fr, c.en])))}</a>`).join("")}</div>` : "";
  // phones: the row scrolls sideways; bring the current page's link into view without moving the page
  const row = sub.firstElementChild as HTMLElement | null, on = sub.querySelector<HTMLElement>("a.active");
  if (row && on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);

  searchBtn.innerHTML = `${pixelIcon("search", 12)}<span class="sb-label">${L("Rechercher", "Search")}</span><kbd>${isMac ? "⌘" : "Ctrl"} K</kbd>`;
  searchBtn.setAttribute("aria-label", L(`Rechercher (${isMac ? "Cmd" : "Ctrl"}+K)`, `Search (${isMac ? "Cmd" : "Ctrl"}+K)`));
  quizBtn.innerHTML = `<span class="q-long">${L("Qui vous ressemble ?", "Who’s like you?")}</span><span class="q-short">${L("Le quiz", "Quiz")}</span>`;
  quizBtn.toggleAttribute("aria-current", /^#\/quiz/.test(path));
  paintThemeBtn();
  langBtn.innerHTML = `<span class="l-long">${t().langSwitch}</span><span class="l-short" aria-hidden="true">${getLang() === "fr" ? "EN" : "FR"}</span>`;
  langBtn.setAttribute("aria-label", getLang() === "fr" ? "Switch to English" : "Passer en français");
  skip.textContent = L("Aller au contenu", "Skip to content");
  toTop.setAttribute("aria-label", L("Haut de page", "Back to top"));

  footer.innerHTML = `<div class="foot-strip" aria-hidden="true"></div><div class="foot">
    <div class="foot-id"><a class="brand" href="#/" aria-label="Third Estate">${foxSvg(64, true)}<b>Third<span>Estate</span></b></a>
      <p>${L("Données électorales françaises, de la commune à l’Élysée. Sources publiques, méthode ouverte, code libre.", "French election data, from your town hall to the Élysée. Public sources, open method, open code.")}</p>
      <p class="foot-quote">${L("« Qu’est-ce que le tiers état ? Tout. Qu’a-t-il été jusqu’à présent dans l’ordre politique ? Rien. Que demande-t-il ? À y devenir quelque chose. »", "“What is the Third Estate? Everything. What has it been until now in the political order? Nothing. What does it ask? To become something.”")} <span>Sieyès, 1789</span></p></div>
    <nav class="foot-map" aria-label="${L("Plan du site", "Site map")}">${SECTIONS.map((s) => `<div${isGrouped(s) ? ` class="foot-wide"` : ""}><a class="foot-h" href="${s.href}">${pixelIcon(s.icon, 12)}${L(s.fr, s.en)}</a>${isGrouped(s)
        ? `<div class="foot-cols">${groupsOf(s).map((g) => `<div>${g.head ? `<span class="foot-g">${esc(L(...g.head))}</span>` : ""}${g.items.map((c) => `<a href="${c.href}">${esc(L(c.fr, c.en))}</a>`).join("")}</div>`).join("")}</div>`
        : s.children.map((c) => `<a href="${c.href}">${esc(L(c.fr, c.en))}</a>`).join("")}</div>`).join("")}
      <div><span class="foot-h">${L("Le site", "About")}</span><a href="#/sources">${L("Sources et méthode", "Sources & method")}</a><a href="#/mentions-legales">${L("Mentions légales, vos données", "Legal notice, your data")}</a><a href="https://github.com/nicbay/ThirdEstate" target="_blank" rel="noopener">GitHub</a></div></nav>
    <p class="foot-legal">${L("Aucun cookie, aucune publicité, aucun suivi.", "No cookies, no ads, no tracking.")} <a href="#/mentions-legales#cookies">${L("Pourquoi il n’y a pas de bandeau", "Why there is no banner")}</a></p>
  </div>`;
}

// ---------- phone menu sheet: opened from the tab bar, closed by a link, the close button, Esc or the backdrop ----------
tabbar.addEventListener("click", (e) => { if ((e.target as Element).closest("#menu-btn") && !sheet.open) sheet.showModal(); });
sheet.addEventListener("click", (e) => {
  const el = e.target as Element;
  const act = el.closest<HTMLElement>("[data-ms]")?.dataset.ms;
  if (el === sheet || act === "close" || el.closest("a")) return closeSheet();
  if (act === "search") { closeSheet(); openSearch(document.getElementById("menu-btn")); }
  if (act === "lang") { closeSheet(); langBtn.click(); }
});
window.addEventListener("hashchange", closeSheet);

// ---------- scroll: a pixel progress bar under the masthead, a back-to-top button, the masthead's shadow ----------
const progress = document.createElement("div");
progress.className = "scroll-px";
progress.setAttribute("aria-hidden", "true");
progress.innerHTML = "<i></i>";
document.querySelector(".topbar")!.append(progress);
const toTop = document.createElement("button");
toTop.type = "button";
toTop.className = "to-top";
toTop.innerHTML = pixelIcon("up", 24);
toTop.hidden = true;
document.body.append(toTop);
toTop.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); app.focus({ preventScroll: true }); });
let scrollQueued = false;
function onScroll() {
  scrollQueued = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 40 ? Math.min(1, scrollY / max) : 0;
  // 40 steps: the bar advances block by block, like the mark's pixels
  (progress.firstElementChild as HTMLElement).style.width = `${(Math.round(p * 40) / 40) * 100}%`;
  document.documentElement.classList.toggle("is-scrolled", scrollY > 8);
  toTop.hidden = scrollY < innerHeight * 1.2;
}
window.addEventListener("scroll", () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });

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

// Sections below the fold rise in as they enter the screen. Nothing waits hidden: a section already on screen
// (or one the observer never reports) simply stays as drawn; the class only starts a short entrance.
const rise = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("rv-in"); rise!.unobserve(e.target); } }), { rootMargin: "0px 0px -6% 0px" }) : null;
function reveal() {
  if (!rise || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  app.querySelectorAll<HTMLElement>(":scope > .page > .card, :scope > .page > article, :scope > .page > .next-steps").forEach((el) => {
    if (el.dataset.rv) return;
    el.dataset.rv = "1";
    if (el.getBoundingClientRect().top > innerHeight * 0.92) rise.observe(el);
  });
}
/** Presentation pass after each render: wide tables scroll inside their own box on small screens. */
function enhance() {
  sectionHero();
  mergeLocalTabs();
  reveal();
  onScroll();
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
  box.insertAdjacentHTML("beforeend", `<div class="px-edge" aria-hidden="true"></div>`);
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

/**
 * One local bar, not two rows: a page's own view links (`.page-tabs`, e.g. the Assemblée's map / who they are /
 * toeing the line…) move into the sticky section bar, nested right after the section page they belong to.
 * A view that is already a page of the section (Find an MP) stays where the section bar has it.
 */
let mergedTabs: Element | null = null;
function mergeLocalTabs() {
  const sub = document.getElementById("subnav");
  const row = sub?.firstElementChild as HTMLElement | null;
  const tabs = app.querySelector<HTMLElement>(":scope > .page .page-tabs");
  if (tabs && tabs === mergedTabs && sub?.querySelector(".sub-tabs")) return; // already merged for this render
  mergedTabs = tabs;
  sub?.querySelector(".sub-tabs")?.remove();
  sub?.classList.remove("has-tabs");
  if (!sub || !row || !tabs) return;
  const owner = row.querySelector<HTMLAnchorElement>("a.active");
  if (!owner) return;
  const known = new Set([...row.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.getAttribute("href")));
  const views = [...tabs.querySelectorAll<HTMLAnchorElement>("a")].filter((a) => !known.has(a.getAttribute("href")) || a.getAttribute("href") === owner.getAttribute("href"));
  if (views.length < 2) return;
  const group = document.createElement("span");
  group.className = "sub-tabs";
  group.setAttribute("role", "list");
  for (const a of views) {
    const c = a.cloneNode(true) as HTMLAnchorElement;
    c.setAttribute("role", "listitem");
    if (a.getAttribute("href") === owner.getAttribute("href") && !a.hasAttribute("aria-current")) c.removeAttribute("aria-current");
    group.append(c);
  }
  owner.after(group);
  sub.classList.add("has-tabs");
  tabs.hidden = true;
  const on = group.querySelector<HTMLElement>("[aria-current]");
  if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; enhance(); });
}).observe(app, { childList: true, subtree: true });

/** While a page's data loads: the fox assembles pixel by pixel (diagonal sweep), over a row of marching blocks. */
const loaderHtml = () => `<div class="pad px-loading" role="status"><svg class="fox" viewBox="0 0 16 16" width="96" height="96" shape-rendering="crispEdges" aria-hidden="true">${foxCells(false).map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="${c.fill}" style="animation-delay:${(c.x + c.y) * 22}ms"/>`).join("")}</svg><p class="muted">${t().loading}</p><i aria-hidden="true"></i></div>`;

let lastPath = "";
async function route() {
  const { path, anchor } = split();
  // in-page anchor on the same page: just scroll
  // (a scenario anchor, #scenario-<key>, is page state, not a place: it re-renders)
  if (path === lastPath && anchor && !anchor.startsWith("scenario-")) return document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
  const firstRender = !lastPath;
  lastPath = path;
  // the first page just appears (the fox is assembling); later ones cross over with the masthead held still
  return firstRender ? render(path, anchor) : pageTransition(() => render(path, anchor));
}
// A tab opened before a deploy still runs the old bundle, whose lazily loaded pages no longer exist on the
// server (404). Reload once to pick up the new version; the sessionStorage stamp stops a reload loop if the
// file is genuinely missing.
const STALE_KEY = "te-stale-reload";
function reloadForNewVersion(err: unknown) {
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String((err as Error)?.message ?? err))) return false;
  try {
    const last = Number(sessionStorage.getItem(STALE_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(STALE_KEY, String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (e) => { if (reloadForNewVersion((e as Event & { payload?: unknown }).payload)) e.preventDefault(); });
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
      app.innerHTML = loaderHtml();
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
        if (reloadForNewVersion(err)) return;
        app.innerHTML = `<p class="error pad">${t().error} — ${esc((err as Error).message)}</p>`;
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
