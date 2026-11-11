// Mentions légales, données personnelles and cookies (#/mentions-legales).
// What the law asks a French site to state: who publishes it, who hosts it, what personal data it handles
// and what it stores in the reader's browser. Keep in step with src/lib/cloud.ts (what is sent to Supabase)
// and with every localStorage key the site writes.
import { L } from "../i18n";

const REPO = "https://github.com/nicbay/ThirdEstate";

export function renderLegal(app: HTMLElement) {
  app.innerHTML = `
    <section class="page narrow legal">
      <div class="page-head">
        <p class="eyebrow">${L("Le site", "About")}</p>
        <h1>${L("Mentions légales, vos données", "Legal notice, your data")}</h1>
        <p class="dek">${L("Qui publie Third Estate, qui l’héberge, ce que le site sait de vous (presque rien) et ce qu’il garde dans votre navigateur.", "Who publishes Third Estate, who hosts it, what the site knows about you (next to nothing) and what it keeps in your browser.")}</p>
      </div>

      <article class="card prose" id="editeur">
        <header class="card-head"><h2>${L("Éditeur", "Publisher")}</h2></header>
        <p>${L("Third Estate (thirdestate.fr) est un site personnel, publié à titre non professionnel, sans publicité ni abonnement. Conformément à la loi du 21 juin 2004 pour la confiance dans l’économie numérique, son éditeur, personne physique, a communiqué son identité à l’hébergeur, qui la tient à la disposition de l’autorité judiciaire.", "Third Estate (thirdestate.fr) is a personal site, published on a non-professional basis, with no advertising and no subscription. As allowed by the French law of 21 June 2004 on confidence in the digital economy, its publisher, a private individual, has given their identity to the host, which holds it at the disposal of the courts.")}</p>
        <p>${L("Contact, demande de rectification ou droit de réponse : ", "Contact, correction requests and right of reply: ")}<a href="${REPO}/issues" target="_blank" rel="noopener">${L("ouvrir un signalement sur GitHub", "open an issue on GitHub")}</a>. ${L("Toute personne citée sur le site peut demander la correction d’une information inexacte ; chaque fait concernant un candidat ou un élu est accompagné de sa source.", "Anyone named on the site can ask for an inaccurate statement to be corrected; every fact about a candidate or an elected official carries its source.")}</p>
      </article>

      <article class="card prose" id="hebergeur">
        <header class="card-head"><h2>${L("Hébergement", "Hosting")}</h2></header>
        <ul>
          <li><b>${L("Site", "Site")}</b> — Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, ${L("États-Unis", "United States")} · <a href="https://vercel.com" target="_blank" rel="noopener">vercel.com</a></li>
          <li><b>${L("Code et données mises à jour en continu (sondages, marchés, fil d’actualité)", "Code and continuously updated data (polls, markets, news feed)")}</b> — GitHub Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, ${L("États-Unis", "United States")} · <a href="${REPO}" target="_blank" rel="noopener">github.com/nicbay/ThirdEstate</a></li>
          <li><b>${L("Compteur de visiteurs et scénarios enregistrés", "Visitor counter and saved scenarios")}</b> — Supabase Inc. · <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a></li>
        </ul>
      </article>

      <article class="card prose" id="donnees">
        <header class="card-head"><h2>${L("Vos données personnelles", "Your personal data")}</h2></header>
        <p>${L("Le site se consulte sans compte. Il ne vous identifie pas, ne vous suit pas d’une visite à l’autre et ne transmet rien à des régies publicitaires ou à des outils de mesure d’audience.", "The site is read without an account. It does not identify you, does not follow you from one visit to the next, and sends nothing to advertising networks or audience-measurement tools.")}</p>
        <ul>
          <li><b>${L("« N personnes en ce moment »", "‘N people here now’")}</b> — ${L("pendant votre visite, votre navigateur signale sa présence au compteur avec un identifiant aléatoire créé pour cette visite et, si vous avez choisi une commune, le numéro de son département. Rien d’autre, et rien n’est conservé une fois l’onglet fermé.", "during your visit your browser signals its presence to the counter with a random identifier created for that visit and, if you chose a town, its department number. Nothing else, and nothing is kept once the tab is closed.")}</li>
          <li><b>${L("Scénarios enregistrés", "Saved scenarios")}</b> — ${L("le simulateur permet d’enregistrer un scénario en ligne en se connectant par un lien envoyé par courriel. Dans ce cas seulement, votre adresse électronique et vos scénarios sont conservés chez Supabase, jusqu’à ce que vous les supprimiez ou en demandiez la suppression. Base légale : votre demande.", "the simulator lets you save a scenario online by signing in with a link sent by email. Only then are your email address and your scenarios stored with Supabase, until you delete them or ask for their deletion. Legal basis: your request.")}</li>
          <li><b>${L("Recherche d’une commune", "Town search")}</b> — ${L("le code postal ou le nom saisi est envoyé à l’API publique geo.api.gouv.fr (État français) pour trouver la commune.", "the postcode or name you type is sent to the public API geo.api.gouv.fr (French state) to find the town.")}</li>
          <li><b>${L("Journaux techniques", "Technical logs")}</b> — ${L("comme tout hébergeur, Vercel et GitHub reçoivent votre adresse IP pour servir les pages ; l’éditeur n’y a pas accès sous une forme qui permette de vous identifier.", "like any host, Vercel and GitHub receive your IP address to serve the pages; the publisher has no access to it in a form that identifies you.")}</li>
        </ul>
        <p>${L("Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement par le contact ci-dessus, et saisir la CNIL (cnil.fr) si vous estimez que vos droits ne sont pas respectés.", "You can ask to access, correct or erase your data through the contact above, and complain to the CNIL (cnil.fr) if you believe your rights are not respected.")}</p>
        <p>${L("Les personnes publiques citées (candidats, élus) le sont au titre de l’information du public sur la vie politique, à partir de sources publiques citées sur chaque page ; elles disposent des mêmes droits.", "Public figures named on the site (candidates, elected officials) appear for the public’s information on political life, from public sources cited on each page; they have the same rights.")}</p>
      </article>

      <article class="card prose" id="cookies">
        <header class="card-head"><h2>${L("Cookies : aucun, d’où l’absence de bandeau", "Cookies: none, hence no banner")}</h2></header>
        <p>${L("Third Estate ne dépose aucun cookie, ni publicitaire ni de mesure d’audience. La loi n’impose de recueillir votre accord que pour les traceurs qui ne sont pas strictement nécessaires au service ; le site n’en a pas, il n’affiche donc pas de bandeau de consentement.", "Third Estate sets no cookie at all, neither for advertising nor for audience measurement. The law requires your consent only for trackers that are not strictly necessary to the service; the site has none, so it shows no consent banner.")}</p>
        <p>${L("Pour fonctionner, il garde quelques réglages dans le stockage local de votre navigateur. Ils ne quittent pas votre appareil et vous pouvez les effacer à tout moment :", "To work, it keeps a few settings in your browser’s local storage. They never leave your device and you can erase them at any time:")}</p>
        <ul>
          <li>${L("la langue choisie ;", "the language you chose;")}</li>
          <li>${L("votre commune, si vous cliquez « J’habite ici », et le député qui lui correspond ;", "your town, if you click ‘I live here’, and its MP;")}</li>
          <li>${L("vos dernières recherches et vos scénarios du simulateur ;", "your recent searches and your simulator scenarios;")}</li>
          <li>${L("ce que vous saisissez dans le simulateur de foyer (revenus, composition) : ces chiffres restent dans votre navigateur et ne sont jamais envoyés ;", "what you enter in the household simulator (income, household): these figures stay in your browser and are never sent;")}</li>
          <li>${L("si vous vous connectez pour enregistrer un scénario, le jeton de session de Supabase.", "if you sign in to save a scenario, Supabase’s session token.")}</li>
        </ul>
        <p><button type="button" class="button" id="wipe">${L("Effacer tout ce que le site garde dans ce navigateur", "Erase everything the site keeps in this browser")}</button> <span id="wipe-msg" class="muted small" role="status"></span></p>
        <p class="muted small">${L("Les vidéos d’archives (YouTube en mode « sans cookie », INA, Internet Archive) ne se chargent que sur les pages qui en contiennent ; ces services peuvent alors appliquer leurs propres règles.", "Archive videos (YouTube in ‘no-cookie’ mode, INA, Internet Archive) load only on the pages that contain them; those services may then apply their own rules.")}</p>
      </article>

      <article class="card prose" id="contenus">
        <header class="card-head"><h2>${L("Contenus et réutilisation", "Content and reuse")}</h2></header>
        <p>${L("Les données viennent de sources publiques, listées avec leur licence sur la page ", "The data comes from public sources, listed with their licence on the ")}<a href="#/sources">${L("Sources et méthode", "Sources and method")}</a>${L(". Les photographies viennent de Wikimedia Commons et sont créditées là où elles apparaissent. Le code du site est public sur GitHub.", " page. Photographs come from Wikimedia Commons and are credited where they appear. The site’s code is public on GitHub.")}</p>
        <p>${L("Les prévisions, simulations et quiz sont des calculs à partir de ces données ; ce ne sont ni des pronostics garantis ni des consignes de vote.", "Forecasts, simulations and quizzes are computations from that data; they are neither guaranteed predictions nor voting advice.")}</p>
      </article>
    </section>`;
  app.querySelector("#wipe")?.addEventListener("click", () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode: nothing was kept */ }
    app.querySelector("#wipe-msg")!.textContent = L("C’est fait.", "Done.");
  });
}
