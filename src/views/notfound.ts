// A branded 404: the fox, what happened, and a way back to every section. Routes that match nothing land here
// instead of being sent silently to the homepage.
import { L } from "../i18n";
import { foxSvg } from "../lib/fox";
import { esc } from "../util";

export function renderNotFound(app: HTMLElement, path: string) {
  document.title = `${L("Page introuvable", "Page not found")} · Third Estate`;
  const links: [string, string, string][] = [
    ["#/2027", "La prévision 2027", "The 2027 forecast"],
    ["#/explorer", "Votre commune", "Your town"],
    ["#/assemblee", "Les députés et leurs votes", "The MPs and their votes"],
    ["#/resultats", "Toutes les élections depuis 1848", "Every election since 1848"],
  ];
  app.innerHTML = `<section class="page nf on-paper">
    <div class="nf-in">
      <div class="nf-fox" aria-hidden="true">${foxSvg(112, false)}</div>
      <p class="nf-code" aria-hidden="true">404</p>
      <h1>${L("Cette page n’existe pas", "This page does not exist")}</h1>
      <p class="nf-dek">${L(`Rien ne répond à l’adresse <code>${esc(path)}</code>. Le lien est peut-être ancien, ou mal recopié.`, `Nothing answers at <code>${esc(path)}</code>. The link may be old, or mistyped.`)}</p>
      <span class="cta-wrap"><a class="cta" href="#/">${L("Retour à l’accueil", "Back to the homepage")}</a></span>
      <ul class="nf-links">${links.map(([h, fr, en]) => `<li><a href="${h}">${L(fr, en)}</a></li>`).join("")}</ul>
    </div>
  </section>`;
}
