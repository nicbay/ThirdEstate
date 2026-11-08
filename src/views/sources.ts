// Every source, when it was last refreshed, its licence, and how figures are computed.
// Audited against scripts/sync-*.mjs and the schedules in .github/workflows/ (keep both in step when adding a source).
import { fetchJson, loadAnMeta, loadMarkets, loadPolls } from "../data";
import { L, fmtDate } from "../i18n";
import { WINDOW } from "../lib/polls";
import { esc, safeUrl } from "../util";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
interface Row {
  data: string;
  source: string;
  url: string;
  refresh: string;
  licence: string;
}

const LO = () => L("Licence Ouverte 2.0 (Etalab)", "Licence Ouverte 2.0 (Etalab open licence)");
const ODBL = "ODbL";
const BYSA = "CC BY-SA 4.0";
const at = (label: string, iso?: string | null) => (iso ? `${label} · ${fmtDate(iso)}` : label);

export async function renderSources(app: HTMLElement) {
  const [an, polls, markets, senat, speeches, economy] = await Promise.all([
    loadAnMeta().catch(() => null),
    loadPolls("2027").catch(() => null),
    loadMarkets().catch(() => null),
    fetchJson<Any>("/data/senat/meta.json").catch(() => null),
    fetchJson<Any>("/data/an/interventions/meta.json").catch(() => null),
    fetchJson<Any>("/data/economy.json").catch(() => null),
  ]);
  const daily = L("Quotidienne", "Daily"), hourly = L("Toutes les heures", "Hourly"), live = L("En direct", "Live");
  const manual = L("À chaque nouveau millésime (reconstruction manuelle)", "With each new release (rebuilt by hand)");
  const once = L("Données historiques, chargées une fois", "Historical data, loaded once");
  const mi = L("Ministère de l’Intérieur, data.gouv.fr", "Ministry of the Interior, data.gouv.fr");

  const groups: [string, Row[]][] = [
    [L("Élections", "Elections"), [
      { data: L("Résultats présidentielle 2022", "2022 presidential results"), source: mi, url: "https://tabular-api.data.gouv.fr", refresh: L("API data.gouv.fr, en direct", "data.gouv.fr API, live"), licence: LO() },
      { data: L("Résultats législatives 2024", "2024 legislative results"), source: mi, url: "https://www.data.gouv.fr/fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/", refresh: L("Agrégats précalculés, détail par circonscription en direct", "National totals precomputed, district detail live"), licence: LO() },
      { data: L("Législatives 1848–2024 et carte des bascules", "Legislative elections 1848–2024 and the shift map"), source: L("Ministère de l’Intérieur (2012–2024), Sciences Po CDSP (1958–2007, ODbL), Cagé et Piketty (1848–1956)", "Ministry of the Interior (2012–2024), Sciences Po CDSP (1958–2007, ODbL), Cagé & Piketty (1848–1956)"), url: "https://unehistoireduconflitpolitique.fr", refresh: once, licence: `${LO()}, ${ODBL}, ${L("citation", "citation")}` },
      { data: L("Présidentielles 1848–2022", "Presidential elections 1848–2022"), source: L("Wikipédia (résultats du Conseil constitutionnel), Sciences Po CDSP, ministère de l’Intérieur, Cagé et Piketty", "Wikipedia (Constitutional Council figures), Sciences Po CDSP, Ministry of the Interior, Cagé & Piketty"), url: "https://fr.wikipedia.org/wiki/%C3%89lection_pr%C3%A9sidentielle_en_France", refresh: once, licence: `${BYSA}, ${ODBL}, ${LO()}` },
      { data: L("Municipales 2020 et 2026, par commune", "2020 and 2026 municipal elections, by town"), source: mi, url: "https://www.data.gouv.fr/datasets/69b82a7de5d58cc06ad35ce0", refresh: L("Après chaque scrutin", "After each election"), licence: L("Licence Ouverte 2.0 (2026) ; 2020 : non précisée sur data.gouv.fr", "Licence Ouverte 2.0 (2026); 2020: not stated on data.gouv.fr") },
      { data: L("Sénatoriales 2026", "2026 Senate elections"), source: mi, url: "https://www.data.gouv.fr/datasets/elections-senatoriales-2026-resultats/", refresh: L("Après le scrutin", "After the election"), licence: LO() },
      { data: L("Promesses de la liste élue (communes de 30 000 habitants et plus)", "The winning list’s promises (towns of 30,000+)"), source: L("Professions de foi officielles (programme-candidats.interieur.gouv.fr), résumées par IA (Claude Haiku)", "Official campaign leaflets (programme-candidats.interieur.gouv.fr), summarised by AI (Claude Haiku)"), url: "https://programme-candidats.interieur.gouv.fr/", refresh: L("Manuelle, document par document", "By hand, one document at a time"), licence: L("Documents publics des candidats", "Candidates’ public documents") },
      { data: L("Sondages", "Polls"), source: L("Wikipédia (tableaux compilés à partir des instituts)", "Wikipedia (tables compiled from pollsters)"), url: polls?.source ?? "https://fr.wikipedia.org", refresh: at(hourly, polls?.fetchedAt), licence: BYSA },
      { data: L("Marchés prédictifs", "Prediction markets"), source: "Kalshi, Polymarket", url: "https://kalshi.com", refresh: at(hourly, markets?.fetchedAt), licence: L("Conditions des plateformes (API publiques)", "Platform terms (public APIs)") },
    ]],
    [L("Parlement", "Parliament"), [
      { data: L("Députés, groupes, scrutins, loyauté", "MPs, groups, votes, loyalty"), source: L("Assemblée nationale (open data)", "Assemblée nationale (open data)"), url: "https://data.assemblee-nationale.fr", refresh: at(daily, an?.syncedAt), licence: LO() },
      { data: L("Interventions en séance (nuages de mots, thèmes)", "Speeches in the chamber (word clouds, themes)"), source: L("Comptes rendus des débats de l’Assemblée (XML Syceron)", "Assemblée verbatim records (Syceron XML)"), url: "https://data.assemblee-nationale.fr", refresh: at(daily, speeches?.syncedAt), licence: LO() },
      { data: L("Sénateurs et scrutins du Sénat", "Senators and Senate votes"), source: "data.senat.fr, senat.fr, Wikidata", url: "https://data.senat.fr", refresh: at(daily, senat?.syncedAt), licence: `${LO()}, CC0 (Wikidata)` },
      { data: L("Comptes de réseaux sociaux des députés", "MPs’ social media accounts"), source: L("Déclarations à l’Assemblée, Wikidata, sites des députés et des groupes, archive NosDéputés.fr", "Declarations to the Assemblée, Wikidata, MPs’ and groups’ websites, NosDéputés.fr archive"), url: "https://www.wikidata.org", refresh: L("Hebdomadaire (lundi)", "Weekly (Monday)"), licence: `${LO()}, CC0` },
      { data: L("Fil Rouge/Bleu : actualité et messages des députés", "Red/Blue feed: news and MPs’ posts"), source: L("Flux RSS des médias nationaux ; Bluesky, YouTube, Mastodon (API publiques)", "National outlets’ RSS feeds; Bluesky, YouTube, Mastodon (public APIs)"), url: "https://bsky.app", refresh: L("Toutes les 2 heures", "Every 2 hours"), licence: L("Titres et liens seulement, droits des éditeurs", "Titles and links only, publishers’ rights") },
    ]],
    [L("Votre commune et votre circonscription", "Your town and district"), [
      { data: L("Délinquance enregistrée, par commune, depuis 2016", "Recorded crime, by town, since 2016"), source: L("SSMSI (ministère de l’Intérieur), data.gouv.fr", "SSMSI (Ministry of the Interior), data.gouv.fr"), url: "https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales", refresh: L("Vérifiée chaque mois (publication annuelle)", "Checked monthly (published yearly)"), licence: LO() },
      { data: L("Niveau de vie, pauvreté (Filosofi), chômage et population (recensement)", "Standard of living, poverty (Filosofi), unemployment and population (census)"), source: L("INSEE, API Melodi", "INSEE, Melodi API"), url: "https://catalogue-donnees.insee.fr/fr/catalogue/recherche/DS_FILOSOFI_CC", refresh: manual, licence: LO() },
      { data: L("Quartiers (IRIS)", "Neighbourhoods (IRIS)"), source: L("INSEE (recensement 2022, Filosofi 2021), contours IGN, photos Wikimedia Commons, Wikipédia", "INSEE (2022 census, Filosofi 2021), IGN outlines, Wikimedia Commons photos, Wikipedia"), url: "https://www.insee.fr/fr/statistiques/8647014", refresh: manual, licence: `${LO()} ; ${L("photos : licence de chaque fichier", "photos: each file’s licence")} ; ${BYSA}` },
      { data: L("Collèges et lycées : IPS, réussite, valeur ajoutée", "Secondary schools: social index (IPS), pass rates, value added"), source: L("Éducation nationale (annuaire, IPS, IVAC, IVAL)", "Ministry of Education (directory, IPS, IVAC, IVAL)"), url: "https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/", refresh: manual, licence: LO() },
      { data: L("Dépenses des communes", "Town spending"), source: L("OFGL (comptes consolidés, source DGFiP)", "OFGL (consolidated accounts, from the DGFiP)"), url: "https://data.ofgl.fr/explore/dataset/ofgl-base-communes-consolidee/", refresh: manual, licence: LO() },
      { data: L("Maire, conseil municipal, conseillers départementaux", "Mayor, town council, departmental councillors"), source: L("Répertoire national des élus (ministère de l’Intérieur)", "National register of elected officials (Ministry of the Interior)"), url: "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1", refresh: manual, licence: LO() },
      { data: L("Monuments, musées, bibliothèques, équipements sportifs", "Monuments, museums, libraries, sports facilities"), source: L("Ministère de la Culture (Mérimée, Muséofile, bibliothèques), ministère des Sports (Data ES)", "Ministry of Culture (Mérimée, Muséofile, libraries), Ministry of Sport (Data ES)"), url: "https://www.data.gouv.fr/datasets/immeubles-proteges-au-titre-des-monuments-historiques-2", refresh: manual, licence: LO() },
      { data: L("Prix de l’immobilier au m²", "Property prices per m²"), source: L("DGFiP, Demandes de valeurs foncières (DVF)", "DGFiP, land value requests (DVF)"), url: "https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees", refresh: manual, licence: LO() },
      { data: L("Accès aux médecins, fibre", "Access to GPs, fibre broadband"), source: L("DREES (APL), ARCEP", "DREES (APL), ARCEP"), url: "https://www.data.gouv.fr/datasets/accessibilite-potentielle-localisee-apl-aux-professionnels-de-sante", refresh: manual, licence: LO() },
      { data: L("Photo et présentation de la commune", "Town photo and introduction"), source: L("Wikidata, Wikimedia Commons, Wikipédia en français", "Wikidata, Wikimedia Commons, French Wikipedia"), url: "https://fr.wikipedia.org", refresh: manual, licence: `CC0 ; ${L("licence de chaque photo", "each photo’s licence")} ; ${BYSA}` },
      { data: L("Votes du conseil municipal (Toulouse, Bordeaux, Nantes)", "Town council votes (Toulouse, Bordeaux, Nantes)"), source: L("Open data des métropoles", "The cities’ open data"), url: "https://data.toulouse-metropole.fr", refresh: manual, licence: LO() },
      { data: L("Événements à venir", "Upcoming events"), source: "ADN Tourisme, DATAtourisme", url: "https://www.data.gouv.fr/datasets/datatourisme-la-plateforme-nationale-des-donnees-touristiques", refresh: manual, licence: LO() },
      { data: L("Actualité locale", "Local news"), source: L("Flux RSS de la presse régionale et locale", "Regional and local press RSS feeds"), url: "https://france3-regions.francetvinfo.fr", refresh: L("Toutes les 3 heures", "Every 3 hours"), licence: L("Titres, liens et courts résumés seulement, droits des éditeurs", "Titles, links and short summaries only, publishers’ rights") },
      { data: L("Recherche d’adresse et de commune", "Address and town search"), source: L("Base adresse nationale (Géoplateforme), geo.api.gouv.fr", "National address base (Géoplateforme), geo.api.gouv.fr"), url: "https://geo.api.gouv.fr/decoupage-administratif", refresh: live, licence: LO() },
    ]],
    [L("Économie", "Economy"), [
      { data: L("Dette, déficit, croissance, prix, chômage", "Debt, deficit, growth, prices, unemployment"), source: L("Eurostat (API de diffusion), INSEE (Banque de données macroéconomiques)", "Eurostat (dissemination API), INSEE (macroeconomic database)"), url: "https://ec.europa.eu/eurostat/data/database", refresh: at(L("Hebdomadaire (mardi)", "Weekly (Tuesday)"), economy?.fetchedAt), licence: `CC BY 4.0 (Eurostat), ${LO()}` },
    ]],
    [L("Cartes", "Maps"), [
      { data: L("Contours des départements", "Department outlines"), source: "Etalab / IGN", url: "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/", refresh: L("Statique", "Static"), licence: LO() },
      { data: L("Contours des circonscriptions", "District outlines"), source: "data.gouv.fr", url: "https://www.data.gouv.fr/fr/datasets/contours-geographiques-des-circonscriptions-legislatives/", refresh: L("Statique", "Static"), licence: LO() },
      { data: L("Contours des communes", "Town outlines"), source: "geo.api.gouv.fr (IGN Admin Express)", url: "https://geo.api.gouv.fr/decoupage-administratif", refresh: live, licence: LO() },
    ]],
  ];

  app.innerHTML = `
    <section class="page narrow">
      <div class="page-head"><h1>${L("D’où viennent les chiffres", "Where the numbers come from")}</h1><p class="dek">${L("Chaque donnée vient d’une source publique et gratuite. Voici lesquelles, quand elles sont mises à jour, sous quelle licence, et comment nous les calculons.", "Every figure comes from a free, public source. Here is which, how often it’s refreshed, under what licence, and how we calculate it.")}</p></div>
      ${groups
        .map(([title, rows]) => `<article class="card">
        <header class="card-head"><h2>${title}</h2></header>
        <table class="table sources-table">
          <thead><tr><th>${L("Donnée", "Data")}</th><th>${L("Source et licence", "Source and licence")}</th><th>${L("Mise à jour", "Refresh")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r.data)}</b></td><td><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${esc(r.source)}</a><br><span class="muted tiny">${esc(r.licence)}</span></td><td class="muted small">${esc(r.refresh)}</td></tr>`).join("")}</tbody>
        </table>
      </article>`)
        .join("")}
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
          "Reports de voix par défaut : pour un duel de même forme qu’en 2022 (droite nationale contre centre ou droite), ceux mesurés par Ipsos / Sopra Steria au second tour de 2022 (électeurs de Mélenchon, Jadot, Pécresse, Zemmour ; enquête du 21 au 23 avril 2022 auprès de 4 000 inscrits), appliqués par famille politique. Ailleurs, des hypothèses selon la distance entre familles politiques (même famille 85 %, voisine 50 %, deux crans 40 %, au-delà 15 %), plafonnées à 90 % au total. « Front républicain » et sa version fissurée sont des hypothèses en chiffres ronds. Tout est modifiable.",
          "Default vote transfers: for a duel shaped like 2022 (nationalist right against centre or right), those Ipsos / Sopra Steria measured in the 2022 runoff (Mélenchon, Jadot, Pécresse and Zemmour voters; poll of 4,000 registered voters, 21–23 April 2022), applied by political family. Elsewhere, assumptions based on the distance between political families (same family 85%, neighbouring 50%, two steps 40%, further 15%), capped at 90% in total. “Republican front” and its cracked version are round-number assumptions. Everything is editable.",
        )}</p>
        <h2>${L("Loyauté envers le groupe", "Group loyalty")}</h2>
        <p>${L(
          "Pour chaque scrutin public, la ligne du groupe est la position (pour, contre, abstention) la plus fréquente parmi les <i>autres</i> membres du groupe qui ont voté, le jour du vote : un député qui a changé de groupe est comparé au groupe auquel il appartenait alors. Un scrutin ne compte que si assez de collègues ont voté et sans égalité. Les non-inscrits, les non-votants et les absences ne comptent pas. Score = votes conformes à la ligne ÷ votes comptés ; un député n’est classé qu’au-delà d’un nombre minimal de votes comptés.",
          "On each public vote, the group line is the most common position (for, against, abstain) among the <i>other</i> group members who voted, on the day of the vote: an MP who changed group is compared with the group they belonged to then. A vote counts only if enough colleagues voted and there is no tie. Non-attached MPs, non-voting members and absences are not counted. Score = votes matching the line ÷ votes counted; an MP is ranked only above a minimum number of counted votes.",
        )}</p>
        <h2>${L("Ce que disent les députés", "What MPs say")}</h2>
        <p>${L(
          "Chaque paragraphe du compte rendu officiel attribué à un député en exercice (hors présidence de séance) est une intervention. Les mots sont comptés après retrait des mots vides et des formules de procédure ; les mots propres à un député sont pondérés par rapport aux autres (TF-IDF). Les thèmes sont attribués par un lexique de mots-clés, aidé par le titre du point de l’ordre du jour.",
          "Each paragraph of the official record attributed to a sitting MP (not chairing the sitting) is one speech. Words are counted after removing stopwords and procedural phrases; words distinctive of an MP are weighted against the others (TF-IDF). Themes come from a keyword lexicon, helped by the title of the agenda item.",
        )}</p>
        <h2>${L("Votre commune en bref", "Your town in brief")}</h2>
        <p>${L(
          "Le résumé en tête de chaque commune est écrit automatiquement à partir des données ci-dessus : député, résultat des législatives dans la circonscription principale, niveau de vie comparé à la médiane nationale des circonscriptions, et l’indicateur de délinquance le plus éloigné de la moyenne nationale. Paris, Lyon et Marseille ne publient la délinquance qu’à l’échelle de la ville entière.",
          "The summary at the top of each town is written automatically from the data above: MP, legislative result in the main district, standard of living against the national median of districts, and the crime indicator furthest from the national average. Paris, Lyon and Marseille crime is published for the whole city only.",
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
