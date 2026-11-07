import "./style.css";
import { getLang, setLang, t } from "./i18n";
import { renderPresidential } from "./views/presidential";
import { renderDeputes } from "./views/deputes";
import { renderDepute } from "./views/depute";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const langBtn = document.getElementById("lang") as HTMLButtonElement;

const routes: [RegExp, (m: RegExpMatchArray) => Promise<void> | void][] = [
  [/^#\/deputes$/, () => renderDeputes(app)],
  [/^#\/depute\/(PA\d+)$/, (m) => renderDepute(app, m[1])],
  [/^#\/(presidentielle\/(\d{4}))?$/, (m) => renderPresidential(app, m[2] ? Number(m[2]) : undefined)],
];

function renderNav() {
  const h = location.hash || "#/";
  const s = t();
  nav.innerHTML = `
    <a href="#/" class="${h === "#/" || h.startsWith("#/presidentielle") ? "active" : ""}">${s.navPresidential}</a>
    <a href="#/deputes" class="${h.startsWith("#/depute") ? "active" : ""}">${s.navMPs}</a>`;
  langBtn.textContent = s.langSwitch;
  langBtn.setAttribute("aria-label", getLang() === "fr" ? "Switch to English" : "Passer en français");
}

async function route() {
  renderNav();
  const h = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      app.innerHTML = `<p class="muted pad">${t().loading}</p>`;
      try {
        await fn(m);
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
  route();
});
window.addEventListener("hashchange", () => {
  route();
  window.scrollTo(0, 0);
});
setLang(getLang());
route();
