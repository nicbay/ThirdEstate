// Every source, when it was last refreshed, and how figures are computed.
import { loadAnMeta, loadMarkets, loadPolls } from "../data";
import { L, fmtDate } from "../i18n";
import { WINDOW } from "../lib/polls";
import { esc } from "../util";

export async function renderSources(app: HTMLElement) {
  const [an, polls, markets] = await Promise.all([loadAnMeta(), loadPolls("2027"), loadMarkets().catch(() => null)]);
  const rows: [string, string, string, string][] = [
    [L("Résultats présidentielle 2022", "2022 presidential results"), L("Ministère de l’Intérieur", "Ministry of the Interior"), L("API data.gouv.fr, en direct", "data.gouv.fr API, live"), "https://tabular-api.data.gouv.fr"],
    [L("Résultats législatives 2024", "2024 legislative results"), L("Ministère de l’Intérieur", "Ministry of the Interior"), L("API data.gouv.fr ; agrégats précalculés, détail par circonscription en direct", "data.gouv.fr API; national totals precomputed, district detail live"), "https://www.data.gouv.fr/fr/datasets/resultats-du-1er-tour-des-elections-legislatives-2024-par-circonscription/"],
    [L("Députés, groupes, votes", "MPs, groups, votes"), L("Assemblée nationale (open data)", "Assemblée nationale (open data)"), `${L("Quotidien", "Daily")} · ${fmtDate(an.syncedAt)}`, "https://data.assemblee-nationale.fr"],
    [L("Sondages", "Polls"), L("Wikipédia (tableaux compilés à partir des instituts, CC BY-SA)", "Wikipedia (tables compiled from pollsters, CC BY-SA)"), `${L("Toutes les heures", "Hourly")} · ${fmtDate(polls.fetchedAt)}`, polls.source],
    [L("Marchés prédictifs", "Prediction markets"), "Kalshi, Polymarket", markets ? `${L("Toutes les heures", "Hourly")} · ${fmtDate(markets.fetchedAt)}` : "–", "https://kalshi.com"],
    [L("Contours des départements", "Department outlines"), "Etalab / IGN", L("Statique", "Static"), "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/"],
    [L("Contours des circonscriptions", "District outlines"), "data.gouv.fr", L("Statique", "Static"), "https://www.data.gouv.fr/fr/datasets/contours-geographiques-des-circonscriptions-legislatives/"],
  ];
  app.innerHTML = `
    <section class="page narrow">
      <div class="page-head"><h1>${L("D’où viennent les chiffres", "Where the numbers come from")}</h1><p class="dek">${L("Chaque donnée vient d’une source publique et gratuite. Voici lesquelles, quand elles sont mises à jour et comment nous les calculons.", "Every figure comes from a free, public source. Here is which, how often it’s refreshed and how we calculate it.")}</p></div>
      <article class="card">
        <table class="table">
          <thead><tr><th>${L("Donnée", "Data")}</th><th>${L("Source", "Source")}</th><th>${L("Mise à jour", "Refresh")}</th></tr></thead>
          <tbody>${rows.map(([d, s, u, url]) => `<tr><td><b>${d}</b></td><td><a href="${esc(url)}" target="_blank" rel="noopener">${s}</a></td><td class="muted">${u}</td></tr>`).join("")}</tbody>
        </table>
      </article>
      <article class="card prose">
        <h2>${L("Moyenne des sondages", "Polling average")}</h2>
        <p>${L(
          `Un sondage teste souvent plusieurs hypothèses de candidatures. Le score d’un candidat dans un sondage est la moyenne des hypothèses où il figure. La moyenne du jour est celle des sondages publiés sur les ${WINDOW} derniers jours, chaque sondage comptant une fois (au moins les 3 derniers sondages si la fenêtre en contient moins). Les candidats testés dans moins de 40 % de ces sondages sont écartés.`,
          `A poll often tests several candidate line-ups. A candidate’s figure in a poll is the mean of the line-ups that include them. The current average covers polls from the last ${WINDOW} days, each poll counting once (at least the last 3 polls if the window has fewer). Candidates tested in under 40% of those polls are left out.`,
        )}</p>
        <h2>${L("Précision des sondages", "Poll accuracy")}</h2>
        <p>${L("Pour chaque institut, on prend son dernier sondage publié dans la semaine précédant le scrutin, et on le compare au résultat officiel. L’erreur moyenne est la moyenne des écarts absolus sur tous les candidats ou blocs.", "For each pollster, we take its last poll published in the week before the vote and compare it with the official result. Mean error is the average absolute miss across all candidates or blocs.")}</p>
        <h2>${L("Simulateur", "Simulator")}</h2>
        <p>${L(
          "Les reports de voix par défaut sont des hypothèses, pas des données : ils dépendent de la distance entre familles politiques (même famille 85 %, voisine 50 %, deux crans 40 %, au-delà 15 %), plafonnés à 90 % au total. Tout est modifiable.",
          "Default vote transfers are assumptions, not data: they depend on the distance between political families (same family 85%, neighbouring 50%, two steps 40%, further 15%), capped at 90% in total. Everything is editable.",
        )}</p>
        <h2>${L("Présence numérique et réseaux sociaux", "Digital presence and social media")}</h2>
        <p>${L(
          "Le score compte les réseaux que chaque député déclare officiellement à l’Assemblée (X, Facebook, Instagram, LinkedIn, site web). Mesurer l’audience (abonnés, engagement) exige les API des plateformes : celle de X est payante, celles de Meta et LinkedIn ne donnent pas accès aux comptes de tiers. Aucun profil n’est collecté par scraping.",
          "The score counts the channels each MP officially declares to the Assemblée (X, Facebook, Instagram, LinkedIn, website). Measuring audience (followers, engagement) needs the platforms’ APIs: X’s is paid, and Meta’s and LinkedIn’s don’t give access to third-party accounts. No profile is scraped.",
        )}</p>
        <h2>${L("Origine socio-professionnelle", "Socio-professional background")}</h2>
        <p>${L("Catégorie INSEE de la profession déclarée par le député à l’Assemblée. Le parcours détaillé et les intérêts déclarés sont sur la fiche HATVP de chaque député.", "INSEE category of the occupation the MP declared to the Assemblée. Detailed career and declared interests are on each MP’s HATVP page.")}</p>
        <h2>${L("Cadre légal", "Legal note")}</h2>
        <p>${L("La loi interdit la publication de nouveaux sondages la veille et le jour du scrutin, ainsi que de résultats avant 20 h le jour du vote.", "French law bans publishing new polls the day before and on election day, and any results before 8 pm on election day.")}</p>
      </article>
    </section>`;
}
