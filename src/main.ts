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
import { renderExplorer, renderTown } from "./views/explore";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const langBtn = document.getElementById("lang") as HTMLButtonElement;
const footer = document.getElementById("footer")!;

// URL shape: #/<section>[/<param>][#<anchor>]
const routes: [RegExp, (m: RegExpMatchArray) => Promise<void> | void][] = [
  [/^#\/$/, () => renderHome(app)],
  [/^#\/sondages$/, () => renderPolls(app)],
  [/^#\/simulateur(?:\/([\w-]+))?$/, (m) => renderSimulator(app, m[1])],
  [/^#\/resultats(?:\/([\w-]+))?$/, (m) => renderResults(app, m[1])],
  [/^#\/presidentielle(?:\/\d{4})?$/, () => void (location.hash = "#/resultats/presidentielle-2022")], // old links
  [/^#\/assemblee(?:\/(deputes|composition))?$/, (m) => renderAssemblee(app, m[1] ?? "carte")],
  [/^#\/assemblee\/(\w{2,3})$/, (m) => renderAssemblee(app, "carte", m[1])],
  [/^#\/deputes$/, () => void (location.hash = "#/assemblee/deputes")], // old links
  [/^#\/circo\/(\w{4,5})$/, (m) => renderCirco(app, m[1])],
  [/^#\/depute\/(PA\d+)$/, (m) => renderDepute(app, m[1])],
  [/^#\/sources$/, () => renderSources(app)],
  [/^#\/histoire\/([\w-]+)$/, (m) => renderElection(app, m[1])],
  [/^#\/fil$/, () => renderFeed(app)],
  [/^#\/2027$/, () => renderRace(app)],
  [/^#\/senat$/, () => renderSenat(app)],
  [/^#\/senateur\/([\w-]+)$/, (m) => renderSenateur(app, m[1])],
  [/^#\/elus$/, () => renderAssemblee(app, "carte")],
  [/^#\/explorer(?:\/(\w{2,3}))?$/, (m) => renderExplorer(app, m[1])],
  [/^#\/ville\/(\w{5})$/, (m) => renderTown(app, m[1])],
];

// Information architecture: local first (your town, your officials), then the national race,
// the feed, and history. Sections with sub-pages get a second row of links.
const SECTIONS: { href: string; match: RegExp; fr: string; en: string; children?: { href: string; match: RegExp; fr: string; en: string }[] }[] = [
  { href: "#/explorer", match: /^#\/(explorer|ville)/, fr: "Ma commune", en: "My town" },
  {
    href: "#/elus", match: /^#\/(elus|assemblee|circo|depute|senat|senateur)/, fr: "Vos élus", en: "Your officials",
    children: [
      { href: "#/assemblee", match: /^#\/(elus|assemblee|circo|depute)/, fr: "Députés", en: "MPs" },
      { href: "#/senat", match: /^#\/(senat|senateur)/, fr: "Sénateurs", en: "Senators" },
      { href: "#/explorer", match: /^$/, fr: "Maires et conseils municipaux", en: "Mayors and town councils" },
    ],
  },
  {
    href: "#/2027", match: /^#\/(2027|sondages|simulateur)/, fr: "Présidentielle 2027", en: "2027 presidential",
    children: [
      { href: "#/2027", match: /^#\/2027/, fr: "Vue d’ensemble", en: "Overview" },
      { href: "#/sondages", match: /^#\/sondages/, fr: "Sondages et marchés", en: "Polls and markets" },
      { href: "#/simulateur", match: /^#\/simulateur/, fr: "Simulateur", en: "Simulator" },
    ],
  },
  { href: "#/fil", match: /^#\/fil/, fr: "Fil rouge, fil bleu", en: "Red feed, blue feed" },
  { href: "#/resultats", match: /^#\/(resultats|histoire)/, fr: "Histoire électorale", en: "Electoral history" },
];

const split = () => {
  const h = location.hash || "#/";
  const i = h.indexOf("#", 1);
  return i < 0 ? { path: h, anchor: "" } : { path: h.slice(0, i), anchor: h.slice(i + 1) };
};

function renderChrome(path: string) {
  nav.innerHTML = SECTIONS.map((s) => `<a href="${s.href}" class="${s.match.test(path) ? "active" : ""}">${L(s.fr, s.en)}</a>`).join("");
  const current = SECTIONS.find((s) => s.match.test(path));
  const sub = document.getElementById("subnav")!;
  sub.hidden = !current?.children;
  sub.innerHTML = current?.children ? `<div>${current.children.map((c) => `<a href="${c.href}" class="${c.match.test(path) ? "active" : ""}">${L(c.fr, c.en)}</a>`).join("")}</div>` : "";
  langBtn.textContent = t().langSwitch;
  langBtn.setAttribute("aria-label", getLang() === "fr" ? "Switch to English" : "Passer en français");
  footer.innerHTML = `<div class="foot">
    <div>${document.querySelector(".topbar .brand")!.outerHTML}
      <p>${L("Données électorales françaises, de la commune à l’Élysée. Sources publiques, méthode ouverte, code libre.", "French election data, from your town hall to the Élysée. Public sources, open method, open code.")}</p>
      <p class="foot-quote">${L("« Qu’est-ce que le tiers état ? Tout. Qu’a-t-il été jusqu’à présent dans l’ordre politique ? Rien. Que demande-t-il ? À y devenir quelque chose. »", "“What is the Third Estate? Everything. What has it been until now in the political order? Nothing. What does it ask? To become something.”")} <span>Sieyès, 1789</span></p></div>
    <nav aria-label="${L("Pied de page", "Footer")}"><a href="#/sources">${L("Sources et méthode", "Sources & method")}</a><a href="#/resultats/bascules">${L("Bascules", "Shifts")}</a><a href="#/2027">2027</a><a href="https://github.com/nicbay/projectview" target="_blank" rel="noopener">GitHub</a></nav>
  </div>`;
}

/** Presentation pass after each render: wide tables scroll inside their own box on small screens. */
function enhance() {
  app.querySelectorAll<HTMLTableElement>("table.table").forEach((t) => {
    if (t.parentElement?.classList.contains("table-scroll")) return;
    const box = document.createElement("div");
    box.className = "table-scroll";
    t.replaceWith(box);
    box.append(t);
  });
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
  lastPath = path;
  renderChrome(path);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      app.innerHTML = `<p class="muted pad">${t().loading}</p>`;
      try {
        await fn(m);
        if (anchor) document.getElementById(anchor)?.scrollIntoView();
        else window.scrollTo(0, 0);
      } catch (err) {
        console.error(err);
        app.innerHTML = `<p class="error pad">${t().error} — ${(err as Error).message}</p>`;
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
setLang(getLang());
initTooltip();
joinPresence();
route();
