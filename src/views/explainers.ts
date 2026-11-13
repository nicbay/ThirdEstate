// How it works (#/2027/comment-ca-marche): the presidential election in four short explainers, each sourced
// to the Constitution, the law of 6 November 1962 (consolidated text on Légifrance), the Constitutional
// Council, Arcom, the CNCCFP or vie-publique.fr. Checked 13 Nov 2026.
import "../styles/civic.css";
import { L, colon } from "../i18n";

const U = {
  constitution: "https://www.conseil-constitutionnel.fr/le-bloc-de-constitutionnalite/texte-integral-de-la-constitution-du-4-octobre-1958-en-vigueur",
  law: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000684037",
  ccParrainages: "https://presidentielle2022.conseil-constitutionnel.fr/les-parrainages/parrainages-les-regles/quels-sont-les-controles-operes-par-le-conseil-constitutionnel-sur-les-parrainages.html",
  arcom: "https://www.arcom.fr/nous-connaitre-nos-missions/garantir-le-pluralisme-et-la-cohesion-sociale/proteger-le-pluralisme-politique",
  cnccfp: "https://www.cnccfp.fr/",
  viePublique: "https://www.vie-publique.fr/fiches/19437-les-relations-entre-le-president-de-la-republique-et-le-parlement",
};

const ext = (url: string, label: string) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
const srcs = (...links: [string, string][]) => `<p class="cv-src">${L("Sources", "Sources")}${colon()}${links.map(([u, t]) => ext(u, t)).join(" · ")}</p>`;

export function renderExplainers(app: HTMLElement) {
  const C = L("Constitution", "Constitution");
  const LAW = L("Loi du 6 novembre 1962, art. 3", "Law of 6 November 1962, art. 3");
  app.innerHTML = `
    <section class="page narrow cv-page">
      <div class="page-head">
        <p class="crumbs"><a href="#/2027">${L("Présidentielle 2027", "2027 presidential election")}</a></p>
        <p class="eyebrow">${L("Les règles du jeu", "The rules of the game")}</p>
        <h1>${L("Comment ça marche", "How it works")}</h1>
        <p class="dek">${L("Deux tours, 500 signatures, des règles strictes sur l’argent et le temps d’antenne, et un président aux pouvoirs larges mais pas illimités. En quatre explications courtes.", "Two rounds, 500 signatures, strict rules on money and airtime, and a president with wide but not unlimited powers. In four short explainers.")}</p>
        <ul class="cv-toc">
          <li><a href="#/2027/comment-ca-marche" data-to="tours">${L("Les deux tours", "The two rounds")}</a></li>
          <li><a href="#/2027/comment-ca-marche" data-to="parrainages">${L("Les 500 parrainages", "The 500 sponsorships")}</a></li>
          <li><a href="#/2027/comment-ca-marche" data-to="campagne">${L("Règles de campagne", "Campaign rules")}</a></li>
          <li><a href="#/2027/comment-ca-marche" data-to="pouvoirs">${L("Ce que peut le président", "What a president can do")}</a></li>
        </ul>
      </div>

      <div class="cv-explain">
        <article class="cv-card" id="tours">
          <p class="cv-num">1</p>
          <h2>${L("Deux tours, deux semaines d’écart", "Two rounds, two weeks apart")}</h2>
          <p>${L("Pour être élu au premier tour, il faut la majorité absolue des suffrages exprimés, soit plus de la moitié des votes valides (blancs et nuls ne comptent pas). Cela n’est jamais arrivé depuis la première élection au suffrage universel, en 1965.", "To win in the first round, a candidate needs an absolute majority of votes cast: more than half of valid votes (blank and spoiled ballots don’t count). That has never happened since the first direct election, in 1965.")}</p>
          <p>${L("Sinon, un second tour a lieu quatorze jours plus tard. Seuls deux candidats peuvent s’y présenter : les deux arrivés en tête au premier tour, après d’éventuels retraits. Celui qui obtient le plus de voix l’emporte.", "Otherwise, a run-off is held fourteen days later. Only two candidates can stand: the top two from the first round, after any withdrawals. Whoever gets more votes wins.")}</p>
          <p>${L("L’élection doit avoir lieu entre 20 et 35 jours avant la fin du mandat en cours, qui s’achève le 13 mai 2027 : d’où un premier tour à la mi-avril.", "The election must take place 20 to 35 days before the current term ends, on 13 May 2027: hence a first round in mid-April.")}</p>
          ${srcs([U.constitution, `${C}, art. 7 — ${L("Conseil constitutionnel", "Constitutional Council")}`])}
        </article>

        <article class="cv-card" id="parrainages">
          <p class="cv-num">2</p>
          <h2>${L("500 parrainages pour être sur le bulletin", "500 sponsorships to get on the ballot")}</h2>
          <p>${L("Pour être candidat, il faut être présenté par au moins 500 élus : maires, parlementaires, conseillers régionaux et départementaux, députés européens élus en France, présidents d’intercommunalité, entre autres. Plus de 40 000 élus peuvent parrainer.", "To stand, a candidate must be put forward by at least 500 elected officials: mayors, members of parliament, regional and departmental councillors, French MEPs, heads of inter-municipal bodies, among others. More than 40,000 officials can sponsor.")}</p>
          <p>${L("Ces signatures doivent venir d’au moins 30 départements ou collectivités d’outre-mer, et pas plus d’un dixième (50) d’un même département. Chaque élu ne parraine qu’un candidat, et ne peut pas retirer sa signature.", "The signatures must come from at least 30 departments or overseas territories, with no more than a tenth (50) from any one department. Each official sponsors only one candidate and cannot withdraw.")}</p>
          <p>${L("Les parrainages arrivent au Conseil constitutionnel, qui publie au moins deux fois par semaine le nom des élus et le candidat qu’ils soutiennent. Date limite : le sixième vendredi avant le premier tour à 18 h, soit le 12 mars 2027 si le premier tour a bien lieu le 18 avril. Le Conseil arrête ensuite la liste officielle des candidats.", "Sponsorships go to the Constitutional Council, which publishes at least twice a week the names of the officials and whom they back. Deadline: 6 pm on the sixth Friday before the first round, so 12 March 2027 if the first round is held on 18 April as planned. The Council then draws up the official list of candidates.")}</p>
          ${srcs([U.law, LAW], [U.ccParrainages, L("Conseil constitutionnel, présidentielle 2022 : les contrôles des parrainages", "Constitutional Council, 2022 election: how sponsorships are checked")])}
        </article>

        <article class="cv-card" id="campagne">
          <p class="cv-num">3</p>
          <h2>${L("Temps de parole et argent : les règles de campagne", "Airtime and money: the campaign rules")}</h2>
          <p>${L("<b>Temps d’antenne.</b> Dès la publication de la liste officielle, radios et télévisions doivent traiter les candidats avec <b>équité</b> : un temps proportionné à leur représentativité (résultats passés, sondages) et à leur rôle dans le débat. Pendant la campagne officielle, qui commence le deuxième lundi avant le scrutin, c’est l’<b>égalité</b> stricte. L’Arcom contrôle et publie chaque semaine les temps relevés ; sa recommandation détaillée pour 2027 n’est pas encore parue.", "<b>Airtime.</b> From the publication of the official list, radio and TV must treat candidates <b>fairly</b>: time in proportion to their standing (past results, polls) and their part in the debate. During the official campaign, which starts on the second Monday before the vote, it is strict <b>equality</b>. Arcom monitors this and publishes the figures weekly; its detailed recommendation for 2027 is not out yet.")}</p>
          <p>${L("<b>Plafond de dépenses.</b> La loi le fixe à 13,7 millions d’euros par candidat au premier tour et 18,3 millions pour les deux finalistes, montants actualisés par décret. Un candidat qui dépasse doit reverser l’excédent au Trésor. Les particuliers ne peuvent pas prêter d’argent aux candidats.", "<b>Spending cap.</b> The law sets it at €13.7 million per candidate in the first round and €18.3 million for the two finalists, amounts updated by decree. A candidate who overspends must pay the excess back to the Treasury. Private individuals cannot lend money to candidates.")}</p>
          <p>${L("<b>Remboursement.</b> Chaque candidat reçoit une avance de 200 000 €. L’État rembourse ensuite forfaitairement 4,75 % du plafond, ou 47,5 % pour ceux qui dépassent 5 % des suffrages exprimés au premier tour, sans dépasser les dépenses réelles. Il faut pour cela que la CNCCFP approuve le compte de campagne, déposé au plus tard le onzième vendredi après le premier tour.", "<b>Reimbursement.</b> Each candidate gets a €200,000 advance. The state then refunds a flat 4.75% of the cap, or 47.5% for those above 5% of votes cast in the first round, never more than actual spending. This requires the CNCCFP to approve the campaign account, filed by the eleventh Friday after the first round.")}</p>
          ${srcs([U.law, LAW], [U.arcom, L("Arcom, protéger le pluralisme politique", "Arcom, protecting political pluralism")], [U.cnccfp, "CNCCFP"])}
        </article>

        <article class="cv-card" id="pouvoirs">
          <p class="cv-num">4</p>
          <h2>${L("Ce que peut (et ne peut pas) un président", "What a president can (and can’t) do")}</h2>
          <p>${L("Le président nomme le Premier ministre, préside le Conseil des ministres, est chef des armées, peut dissoudre l’Assemblée nationale, soumettre certains projets de loi au référendum et, en cas de menace grave, exercer des pouvoirs exceptionnels (article 16). Il ne peut pas faire plus de deux mandats de suite.", "The president appoints the Prime Minister, chairs the Council of Ministers, commands the armed forces, can dissolve the National Assembly, put some bills to a referendum and, under grave threat, take emergency powers (article 16). No more than two terms in a row.")}</p>
          <p>${L("Mais c’est le gouvernement qui « détermine et conduit la politique de la nation », et il est responsable devant l’Assemblée, qui peut le renverser par une motion de censure. Les lois et le budget sont votés par le Parlement. Le président choisit donc en pratique un Premier ministre capable d’éviter la censure.", "But it is the government that ‘determines and conducts the policy of the nation’, and it answers to the Assembly, which can bring it down with a censure motion. Laws and the budget are voted by Parliament. In practice the president must pick a Prime Minister who can survive censure.")}</p>
          <p>${L("Quand l’Assemblée a une majorité opposée au président, c’est la <b>cohabitation</b> (1986, 1993, 1997) : le Premier ministre gouverne, le président garde surtout la défense et la diplomatie.", "When the Assembly has a majority opposed to the president, that’s <b>cohabitation</b> (1986, 1993, 1997): the Prime Minister governs, and the president keeps mainly defence and foreign affairs.")}</p>
          <p>${L("<b>Et les législatives ?</b> De 2002 à 2022, elles suivaient la présidentielle de quelques semaines. La dissolution de 2024 a cassé ce calendrier : l’Assemblée élue en juillet 2024 siège jusqu’en 2029, sauf si le nouveau président la dissout, ce qu’il peut faire dès son arrivée. Les élections ont alors lieu 20 à 40 jours plus tard.", "<b>What about legislative elections?</b> From 2002 to 2022 they came a few weeks after the presidential election. The 2024 dissolution broke that rhythm: the Assembly elected in July 2024 sits until 2029, unless the new president dissolves it, which they may do as soon as they take office. Elections then follow 20 to 40 days later.")}</p>
          ${srcs([U.constitution, `${C}, art. 6, 8, 9, 11, 12, 15, 16, 20, 49`], [U.viePublique, L("Les relations entre le président et le Parlement, vie-publique.fr", "The president and Parliament, vie-publique.fr")])}
        </article>
      </div>

      <section class="cv-sources card">
        <header class="card-head"><h2>${L("Sources", "Sources")}</h2></header>
        <ol>
          <li>${ext(U.constitution, L("Texte intégral de la Constitution du 4 octobre 1958", "Full text of the Constitution of 4 October 1958"))} — ${L("Conseil constitutionnel", "Constitutional Council")}</li>
          <li>${ext(U.law, L("Loi n° 62-1292 du 6 novembre 1962 relative à l’élection du Président de la République", "Law no. 62-1292 of 6 November 1962 on the presidential election"))} — Légifrance</li>
          <li>${ext(U.ccParrainages, L("Quels sont les contrôles opérés sur les parrainages ?", "How are sponsorships checked?"))} — ${L("Conseil constitutionnel", "Constitutional Council")}</li>
          <li>${ext(U.arcom, L("Protéger le pluralisme politique", "Protecting political pluralism"))} — Arcom</li>
          <li>${ext(U.cnccfp, L("Commission nationale des comptes de campagne et des financements politiques", "National Commission for Campaign Accounts and Political Financing"))} — CNCCFP</li>
          <li>${ext(U.viePublique, L("Les relations entre le Président de la République et le Parlement", "Relations between the President and Parliament"))} — vie-publique.fr</li>
        </ol>
        <p class="muted small">${L("Vérifié le 13 novembre 2026. ", "Checked 13 November 2026. ")}<a href="#/2027/calendrier">${L("Voir le calendrier de la campagne", "See the campaign calendar")}</a> · <a href="#/2027/voter">${L("Voter en 2027", "Voting in 2027")}</a></p>
      </section>
    </section>`;
  app.querySelectorAll<HTMLAnchorElement>(".cv-toc a[data-to]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app.querySelector(`#${a.dataset.to}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
}
