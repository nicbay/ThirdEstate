// Voting in 2027 (#/2027/voter): am I registered, the deadline, how to register, proxy votes, polling
// station, ID, voting from abroad. Every fact links to its official page (service-public.gouv.fr, Légifrance).
// Checked 13 Nov 2026. The round dates come from the Council of Ministers of 1 July 2026; the decree calling
// voters is not out yet, so the dates are "expected" (see public/data/2027/calendar.json).
import "../styles/civic.css";
import { L, colon } from "../i18n";

const SP = "https://www.service-public.gouv.fr/particuliers/vosdroits/";
const S = {
  check: `${SP}R51788`,
  registerOnline: `${SP}R16396`,
  register: `${SP}F1367`,
  sameYear: `${SP}F34240`,
  proxy: `${SP}F1604`,
  maproc: "https://www.maprocuration.gouv.fr/",
  franceId: "https://france-identite.gouv.fr/actualite/procuration-de-vote-dematerialisee.html",
  id: `${SP}F1361`,
  abroad: `${SP}F16904`,
  consular: `${SP}R43248`,
  dates: "https://www.service-public.gouv.fr/particuliers/actualites/A15053",
  law: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000684037",
};

const ext = (url: string, label: string) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
const src = (url: string, label: string) => `<p class="cv-src">Source${colon()}${ext(url, label)}</p>`;

export function renderVote(app: HTMLElement) {
  app.innerHTML = `
    <section class="page narrow cv-page">
      <div class="page-head">
        <p class="crumbs"><a href="#/2027">${L("Présidentielle 2027", "2027 presidential election")}</a></p>
        <p class="eyebrow">${L("Mode d’emploi", "How to")}</p>
        <h1>${L("Voter en 2027", "Voting in 2027")}</h1>
        <p class="dek">${L("Êtes-vous inscrit, jusqu’à quand pouvez-vous le faire, comment voter si vous êtes absent. L’essentiel en six points, chacun relié à la page officielle.", "Are you registered, how long you have to do it, how to vote if you’re away. The essentials in six points, each linked to the official page.")}</p>
      </div>

      <div class="cv-key" role="note">
        <div><span>${L("Inscription", "Registration")}</span><b>${L("12 mars 2027", "12 March 2027")}</b></div>
        <div><span>${L("1er tour", "1st round")}</span><b>${L("18 avril 2027", "18 April 2027")}</b></div>
        <div><span>${L("2d tour", "Run-off")}</span><b>${L("2 mai 2027", "2 May 2027")}</b></div>
      </div>
      <p class="muted small cv-under">${L("Dates retenues par le gouvernement le 1er juillet 2026 ; elles seront officielles à la parution du décret de convocation, attendu au plus tard le 7 février 2027. ", "Dates chosen by the government on 1 July 2026; they become official when the decree calling voters is published, due by 7 February 2027 at the latest. ")}<a href="#/2027/calendrier">${L("Tout le calendrier", "Full calendar")}</a></p>

      <div class="cv-grid">
        <article class="cv-card" id="inscrit">
          <p class="cv-num">1</p>
          <h2>${L("Suis-je inscrit ?", "Am I registered?")}</h2>
          <p>${L("Le service officiel vous le dit en une minute, avec votre commune et votre bureau de vote. Vérifiez même si vous avez déjà voté : un déménagement ou une radiation peut vous avoir fait sortir de la liste.", "The official service tells you in a minute, with your town and polling station. Check even if you’ve voted before: a move or a removal can take you off the list.")}</p>
          <a class="cv-cta" href="${S.check}" target="_blank" rel="noopener">${L("Vérifier mon inscription", "Check my registration")}</a>
          <p>${L("À 18 ans, vous êtes inscrit d’office si vous avez fait votre recensement citoyen à 16 ans.", "At 18 you are registered automatically if you did your citizen census (recensement) at 16.")}</p>
          ${src(S.check, L("Vérifier son inscription et son bureau de vote, service-public.gouv.fr", "Check your registration and polling station, service-public.gouv.fr"))}
        </article>

        <article class="cv-card" id="date-limite">
          <p class="cv-num">2</p>
          <h2>${L("Date limite : vendredi 12 mars 2027", "Deadline: Friday 12 March 2027")}</h2>
          <p>${L("La règle : s’inscrire au plus tard le sixième vendredi avant le premier tour. Pour un premier tour le 18 avril, c’est le 12 mars. Elle vaut en ligne, en mairie et par courrier (le courrier doit être arrivé).", "The rule: register by the sixth Friday before the first round. With a first round on 18 April, that’s 12 March. It applies online, at the town hall and by post (the letter must have arrived).")}</p>
          <p>${L("Exceptions jusqu’au 10e jour avant le scrutin, en mairie ou par courrier : vous avez 18 ans après la date limite, vous déménagez pour raison professionnelle, vous êtes naturalisé ou retrouvez le droit de vote.", "Exceptions until the 10th day before the vote, at the town hall or by post: you turn 18 after the deadline, you move for work, you are naturalised or get your voting rights back.")}</p>
          ${src(S.sameYear, L("S’inscrire et voter la même année, service-public.gouv.fr", "Registering and voting in the same year, service-public.gouv.fr"))}
        </article>

        <article class="cv-card" id="inscription">
          <p class="cv-num">3</p>
          <h2>${L("S’inscrire", "How to register")}</h2>
          <ul class="cv-check">
            <li>${L("<b>En ligne</b> : ", "<b>Online</b>: ")}${ext(S.registerOnline, L("demande d’inscription", "registration request"))}${L(", avec une pièce d’identité et un justificatif de domicile de moins de 3 mois, numérisés.", ", with a scanned ID and proof of address less than 3 months old.")}</li>
            <li>${L("<b>En mairie</b> : avec les mêmes pièces et le formulaire cerfa n° 12669 (disponible sur place).", "<b>At the town hall</b>: with the same documents and form cerfa no. 12669 (available there).")}</li>
            <li>${L("<b>Par courrier</b> : le formulaire et les copies, envoyés à votre mairie.", "<b>By post</b>: the form and copies, sent to your town hall.")}</li>
          </ul>
          <p>${L("Vous avez déménagé ? Il faut vous réinscrire dans votre nouvelle commune.", "Moved house? You need to register again in your new town.")}</p>
          ${src(S.register, L("Listes électorales : première inscription, service-public.gouv.fr", "Electoral rolls: first registration, service-public.gouv.fr"))}
        </article>

        <article class="cv-card" id="procuration">
          <p class="cv-num">4</p>
          <h2>${L("Absent ? Votez par procuration", "Away? Vote by proxy")}</h2>
          <p>${L("Vous choisissez un électeur de confiance, qui vote à votre place dans <b>votre</b> bureau de vote. Il peut être inscrit dans une autre commune que vous.", "You choose a voter you trust, who votes for you at <b>your</b> polling station. They can be registered in a different town from you.")}</p>
          <ul class="cv-check">
            <li>${L("Faites la demande sur ", "Apply on ")}${ext(S.maproc, "Maprocuration")}${L(", puis validez-la en personne dans un commissariat ou une gendarmerie avec une pièce d’identité.", ", then confirm it in person at a police or gendarmerie station with ID.")}</li>
            <li>${L("Ou entièrement en ligne si vous avez une identité numérique certifiée ", "Or fully online if you have a certified digital identity with ")}${ext(S.franceId, "France Identité")}.</li>
            <li>${L("Ou avec le formulaire papier, déposé au commissariat, à la gendarmerie ou au tribunal.", "Or with the paper form, handed in at a police station, gendarmerie or court.")}</li>
          </ul>
          <p>${L("Pas de date limite légale, mais faites-la <b>le plus tôt possible</b> : la mairie doit l’avoir reçue avant le vote. Une procuration peut couvrir un tour, les deux tours, ou une durée jusqu’à un an. Une personne ne peut détenir qu’une seule procuration établie en France.", "There is no legal deadline, but do it <b>as early as possible</b>: the town hall must have received it before the vote. A proxy can cover one round, both rounds, or a period of up to a year. One person can hold only one proxy made in France.")}</p>
          ${src(S.proxy, L("Vote par procuration, service-public.gouv.fr", "Voting by proxy, service-public.gouv.fr"))}
        </article>

        <article class="cv-card" id="bureau">
          <p class="cv-num">5</p>
          <h2>${L("Où et quand voter", "Where and when to vote")}</h2>
          <p>${L("Votre bureau de vote figure sur votre carte électorale et sur le service de vérification de l’inscription. Les bureaux ouvrent à 8 h et ferment à 19 h, jusqu’à 20 h au plus tard dans certaines villes selon l’arrêté du préfet.", "Your polling station is on your voter card and on the registration-check service. Polling stations open at 8 am and close at 7 pm, at 8 pm at the latest in some towns by prefectoral order.")}</p>
          <a class="cv-cta" href="${S.check}" target="_blank" rel="noopener">${L("Trouver mon bureau de vote", "Find my polling station")}</a>
          ${src(S.law, L("Loi n° 62-1292 du 6 novembre 1962, art. 3, II bis, Légifrance", "Law no. 62-1292 of 6 November 1962, art. 3, II bis, Légifrance"))}
        </article>

        <article class="cv-card" id="identite">
          <p class="cv-num">6</p>
          <h2>${L("La pièce d’identité à apporter", "What ID to bring")}</h2>
          <p>${L("Obligatoire dans les communes de 1 000 habitants et plus. L’original, pas une photo ni une copie.", "Required in towns of 1,000 inhabitants or more. The original, not a photo or a copy.")}</p>
          <ul class="cv-check">
            <li>${L("Carte d’identité ou passeport, valide ou périmé depuis moins de 5 ans", "ID card or passport, valid or expired less than 5 years ago")}</li>
            <li>${L("Permis de conduire en cours de validité", "Valid driving licence")}</li>
            <li>${L("Carte Vitale avec photo, carte d’invalidité ou mobilité inclusion avec photo, et quelques autres cartes officielles avec photo", "Carte Vitale with photo, disability or mobility card with photo, and a few other official photo cards")}</li>
          </ul>
          <p>${L("La carte électorale n’est pas obligatoire et ne remplace pas une pièce d’identité.", "The voter card is not required and does not replace an ID.")}</p>
          ${src(S.id, L("Papiers d’identité à présenter pour voter, service-public.gouv.fr", "ID documents to show when voting, service-public.gouv.fr"))}
        </article>

        <article class="cv-card" id="etranger">
          <p class="cv-num">+</p>
          <h2>${L("Vous vivez à l’étranger", "You live abroad")}</h2>
          <p>${L("Inscrivez-vous sur la liste électorale consulaire, en ligne (", "Register on the consular electoral roll, online (")}${ext(S.consular, L("registre des Français de l’étranger", "register of French nationals abroad"))}${L(") ou au consulat. Ensuite, deux façons de voter à la présidentielle : en personne, au bureau ouvert par votre ambassade ou consulat, ou par procuration. Le vote par internet ne s’applique pas à la présidentielle.", ") or at the consulate. Then two ways to vote in the presidential election: in person at the polling station set up by your embassy or consulate, or by proxy. Internet voting does not apply to the presidential election.")}</p>
          <p>${L("Sur le continent américain, on vote le samedi : 17 avril et 1er mai.", "In the Americas, voting is on Saturday: 17 April and 1 May.")}</p>
          ${src(S.abroad, L("Vote d’un Français installé à l’étranger, service-public.gouv.fr", "Voting as a French national living abroad, service-public.gouv.fr"))}
        </article>
      </div>

      <section class="cv-sources card">
        <header class="card-head"><h2>${L("Sources", "Sources")}</h2></header>
        <ol>
          <li>${ext(S.dates, L("Les dates de l’élection présidentielle de 2027 sont annoncées", "The dates of the 2027 presidential election are announced"))} — Service-Public.gouv.fr, ${L("2 juillet 2026", "2 July 2026")}</li>
          <li>${ext(S.check, L("Vérifier son inscription électorale et son bureau de vote", "Check your registration and polling station"))} — Service-Public.gouv.fr</li>
          <li>${ext(S.register, L("Listes électorales : première inscription", "Electoral rolls: first registration"))} · ${ext(S.sameYear, L("S’inscrire et voter la même année", "Registering and voting in the same year"))} — Service-Public.gouv.fr</li>
          <li>${ext(S.proxy, L("Vote par procuration", "Voting by proxy"))} — Service-Public.gouv.fr · ${ext(S.maproc, "maprocuration.gouv.fr")}</li>
          <li>${ext(S.id, L("Élections : papiers d’identité à présenter pour voter", "Elections: ID to show when voting"))} — Service-Public.gouv.fr</li>
          <li>${ext(S.abroad, L("Vote d’un Français installé à l’étranger", "Voting as a French national abroad"))} — Service-Public.gouv.fr</li>
          <li>${ext(S.law, L("Loi n° 62-1292 du 6 novembre 1962 relative à l’élection du Président de la République", "Law no. 62-1292 of 6 November 1962 on the presidential election"))} — Légifrance</li>
        </ol>
        <p class="muted small">${L("Vérifié le 13 novembre 2026. En cas de doute, la page officielle fait foi.", "Checked 13 November 2026. If in doubt, the official page prevails.")}</p>
      </section>
    </section>`;
}
