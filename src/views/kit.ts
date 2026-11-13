// The kit (#/kit, beta and local only): every token and component of the Pixel Desk v2 design on one page,
// in the current theme (the masthead toggle flips it). It is the review surface for the UI overhaul
// (todo/ui-overhaul.md) and the place to check a component against its Astryx behaviour spec.
import { L } from "../i18n";
import { hemicycle } from "../lib/hemicycle";
import { pixelIcon, type PixelIcon } from "../lib/pixel-icons";
import { detailSheet } from "../lib/sheet";

export const kitAllowed = () => /^(localhost|127\.0\.0\.1|\[::1\]|beta\.thirdestate\.fr)$/.test(location.hostname) || location.hostname.endsWith(".vercel.app");

const swatch = (name: string, note = "") => `<li class="kit-sw"><i style="background:var(${name})"></i><code>${name}</code>${note ? `<small>${note}</small>` : ""}</li>`;

export function renderKit(app: HTMLElement) {
  if (!kitAllowed()) { location.hash = "#/"; return; }
  const icons: PixelIcon[] = ["home", "parliament", "ballot", "archive", "search", "menu", "close", "up", "sun", "moon", "chart", "scales", "star", "flag"];
  app.innerHTML = `
  <section class="page kit">
    <div class="page-head">
      <p class="eyebrow">${L("Bêta · système de design", "Beta · design system")}</p>
      <h1>${L("Le kit Pixel Desk, chaque pièce sur une page", "The Pixel Desk kit, every piece on one page")}</h1>
      <p class="dek">${L("Jetons, composants et règles de la refonte. Le bouton soleil/lune du bandeau bascule le thème ; sur téléphone, le dernier panneau devient une feuille.", "Tokens, components and rules of the overhaul. The sun/moon button in the masthead flips the theme; on a phone, the last panel becomes a sheet.")}</p>
    </div>

    <article class="card">
      <header class="card-head"><h2>${L("Couleurs du cadre", "Frame colours")}</h2></header>
      <p class="muted small">${L("Le cadre est en noir, blanc et gris chaud. Noms sémantiques à la manière d’Astryx ; les noms courts restent la palette brute.", "The frame is black, white and warm grey. Semantic names follow Astryx; the short names stay the raw palette.")}</p>
      <ul class="kit-sws">
        ${swatch("--color-background-body", "--bg")}${swatch("--color-background-surface", "--paper")}${swatch("--color-background-muted", "--panel")}${swatch("--color-background-wash", "--wash")}
        ${swatch("--color-text-primary", "--ink")}${swatch("--color-text-secondary", "--ink-2")}${swatch("--color-text-tertiary", "--ink-3")}${swatch("--color-border", "--rule")}${swatch("--color-border-strong", "--rule-2")}${swatch("--color-accent", L("liens, focus", "links, focus"))}
      </ul>
      <h3>${L("Bandes de nuit", "Night bands")}</h3>
      <ul class="kit-sws">${swatch("--night")}${swatch("--night-2")}${swatch("--night-rule")}${swatch("--night-rule-2")}${swatch("--night-text-2")}${swatch("--night-text-3")}${swatch("--split-red")}${swatch("--split-violet")}${swatch("--split-blue")}</ul>
      <h3>${L("La couleur, c’est la donnée", "Colour is data")}</h3>
      <ul class="kit-sws">${swatch("--far-left", "LO, NPA")}${swatch("--left", "LFI, NFP")}${swatch("--soc", "PS")}${swatch("--eco", L("écologistes", "greens"))}${swatch("--centre", "Ensemble")}${swatch("--right", "LR")}${swatch("--far-right", L("RN (éclairci en sombre)", "RN (lifted in dark)"))}${swatch("--other")}${swatch("--P", L("pour", "for"))}${swatch("--C", L("contre", "against"))}${swatch("--A", L("abstention", "abstain"))}</ul>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Typographie", "Type")}</h2></header>
      <div class="kit-type">
        <p class="eyebrow">${L("Surtitre en pixels (Silkscreen), jamais pour une phrase", "Pixel kicker (Silkscreen), never for a sentence")}</p>
        <p class="kit-h1">${L("Titre de page, Archivo 850 étroit", "Page headline, Archivo 850 condensed")}</p>
        <h2>${L("Titre de section", "Section head")}</h2>
        <h3>${L("Sous-titre", "Sub-head")}</h3>
        <p class="dek">${L("Chapô : une ou deux phrases qui disent la réponse.", "Dek: one or two sentences that give the answer.")}</p>
        <p>${L("Texte courant en Archivo 17 px. Les nombres sont tabulaires : 1 234,5 · 33,1 %.", "Body text in Archivo 17px. Numbers are tabular: 1,234.5 · 33.1%.")}</p>
        <p class="muted small">${L("Note et source en gris, Plex Mono pour les annotations.", "Notes and sources in grey, Plex Mono for annotation.")}</p>
      </div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Chiffres et barres", "Numbers and bars")}</h2></header>
      <div class="kpis kpis-4"><div><strong>68 %</strong>${L("Chance de gagner", "Chance of winning")}</div><div><strong>33,1</strong>${L("Moyenne des sondages", "Poll average")}</div><div><strong>577</strong>${L("Sièges", "Seats")}</div><div><strong>156</strong>${L("Jours avant le vote", "Days to the vote")}</div></div>
      <p><span class="chip" style="--c:var(--far-right)">RN</span> <span class="up">2,1</span><span class="down">1,4</span></p>
      <div class="bar"><div style="width:68%;background:var(--far-right)"></div></div>
      <div class="bar"><div style="width:18%;background:var(--left)"></div></div>
      <div class="kit-hemi">${hemicycle([{ label: "Left", color: "#d4253a", seats: 193 }, { label: "Centre", color: "#f2a400", seats: 166 }, { label: "Right", color: "#1f5fcf", seats: 49 }, { label: "Far right", color: "#1c2c6c", seats: 142 }, { label: "Other", color: "#9aa0aa", seats: 27 }], 577)}</div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Commandes", "Controls")}</h2></header>
      <div class="kit-row"><a class="button" href="#/kit">${L("Bouton", "Button")}</a><button type="button" class="linkish">${L("Lien-bouton", "Link button")}</button><span class="px-tag">${L("Nouveau", "New")}</span><span class="tag">${L("étiquette", "tag")}</span></div>
      <div class="kit-row"><div class="tabs small-tabs" role="group" aria-label="${L("Exemple de bascule", "Example switch")}"><button type="button" aria-selected="true">${L("Député actuel", "Current MP")}</button><button type="button" aria-selected="false">${L("Tour 2024", "2024 round")}</button></div></div>
      <div class="kit-row kit-icons">${icons.map((i) => `<span title="${i}">${pixelIcon(i, 24)}</span>`).join("")}</div>
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Panneaux : calmes ou cliquables", "Panels: calm or clickable")}</h2></header>
      <p class="muted small">${L("Une section est une feuille blanche ouverte par un filet d’encre. Le cadre pixel et l’ombre dure veulent dire : ça se clique.", "A section is a white sheet opened by an ink rule. The pixel frame and the hard shadow mean: you can click this.")}</p>
      <nav class="next-steps" aria-label="${L("Exemple", "Example")}"><p>${L("Et ensuite", "What next")}</p><a href="#/2027">${L("Où en est la présidentielle", "Where the race stands")}<span aria-hidden="true">→</span></a><a href="#/assemblee">${L("Les députés et leurs votes", "The MPs and their votes")}<span aria-hidden="true">→</span></a></nav>
    </article>

    <aside class="card panel" id="kit-sheet">
      <h2>${L("Panneau de détail", "Detail panel")}</h2>
      <p>${L("Sur grand écran il reste à côté de la carte. Sur téléphone il monte en feuille : glisser lentement pour s’arrêter au cran le plus proche, d’un coup sec pour passer au suivant, Échap pour le replier.", "On a wide screen it stays beside the map. On a phone it rises as a sheet: drag slowly to stop at the nearest snap point, flick to move on to the next one, Escape to fold it.")}</p>
      <ul class="legend-list">${["LFI", "PS", "EPR", "LR", "RN"].map((g, i) => `<li><i class="dot" style="background:${["#d4253a", "#e8559a", "#f2a400", "#1f5fcf", "#1c2c6c"][i]}"></i>${g}<b>${[71, 66, 91, 49, 121][i]}</b></li>`).join("")}</ul>
    </aside>
  </section>`;
  detailSheet(app.querySelector<HTMLElement>("#kit-sheet")!, L("Panneau de détail", "Detail panel"), { start: 0 });
}
