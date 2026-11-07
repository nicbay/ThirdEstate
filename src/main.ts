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
import { renderElection } from "./views/history";
import { renderFeed } from "./views/feed";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const langBtn = document.getElementById("lang") as HTMLButtonElement;
const footer = document.getElementById("footer")!;

// URL shape: #/<section>[/<param>][#<anchor>]
const routes: [RegExp, (m: RegExpMatchArray) => Promise<void> | void][] = [
  [/^#\/$/, () => renderHome(app)],
  [/^#\/sondages$/, () => renderPolls(app)],
  [/^#\/simulateur$/, () => renderSimulator(app)],
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
];

const SECTIONS = [
  { href: "#/", match: /^#\/$/, fr: "2027", en: "2027" },
  { href: "#/fil", match: /^#\/fil/, fr: "Fil rouge, fil bleu", en: "Red feed, blue feed" },
  { href: "#/sondages", match: /^#\/sondages/, fr: "Sondages", en: "Polls" },
  { href: "#/simulateur", match: /^#\/simulateur/, fr: "Simulateur", en: "Simulator" },
  { href: "#/resultats", match: /^#\/(resultats|histoire)/, fr: "Histoire et résultats", en: "History & results" },
  { href: "#/assemblee", match: /^#\/(assemblee|circo|depute)/, fr: "Assemblée", en: "Parliament" },
];

const split = () => {
  const h = location.hash || "#/";
  const i = h.indexOf("#", 1);
  return i < 0 ? { path: h, anchor: "" } : { path: h.slice(0, i), anchor: h.slice(i + 1) };
};

function renderChrome(path: string) {
  nav.innerHTML = SECTIONS.map((s) => `<a href="${s.href}" class="${s.match.test(path) ? "active" : ""}">${L(s.fr, s.en)}</a>`).join("");
  langBtn.textContent = t().langSwitch;
  langBtn.setAttribute("aria-label", getLang() === "fr" ? "Switch to English" : "Passer en français");
  footer.innerHTML = `<a href="#/sources">${L("Sources et méthode", "Sources & method")}</a> · <a href="https://github.com/nicbay/projectview" target="_blank" rel="noopener">GitHub</a>`;
}

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
route();
