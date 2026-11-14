// One 2027 candidate, the hub for everything the site knows about them: polls, forecast and markets; campaign;
// programme summary; votes in Parliament; recent headlines; the quiz; then the same factual blocks for everyone
// (patrimoine, convictions, candidacies, public pay, career, links), every item sourced. Each block says so
// plainly when there is nothing to show (not polled, no programme yet, not in Parliament, no headline).
// Data: public/data/candidates/<slug>.json, hand-curated and checked at build time (scripts/check-candidates.mjs);
// the rest is looked up by slug or name, so a new candidate file is enough (docs/data-candidates.md).
import { fetchJson, loadFeed, loadMarkets, loadPolls, loadScrutins, loadVotes, type Depute, type FeedStory } from "../data";
import { infoTip } from "../lib/infotip";
import { L, fmtNum, getLang } from "../i18n";
import { meta, registerParties, surname } from "../lib/candidates";
import { average, pollsInWindow, trend } from "../lib/polls";
import { forecast } from "../lib/forecast";
import { combineOdds, oddsFor, winShare } from "../lib/markets";
import { lineChart } from "../lib/chart";
import { pct, signed } from "../lib/format";
import { estimatePay, UNPRICED, type Mandate, type PayScales } from "../lib/public-pay";
import { esc, safeUrl } from "../util";
import { shiftDays } from "./home";
import "../styles/candidate.css";

type Bi = { fr: string; en: string };
interface Source { title: string; publisher: string; url: string; date: string }
interface Sourced { sources: Source[] }
export interface CandidateFile {
  slug: string; name: string; pollName: string; verified: string; wikidata?: string;
  born?: { date: string; place?: string } & Sourced;
  photo: { file: string; src: string; page: string; author: string; licence: string; licenceUrl?: string; year?: number };
  party: Bi & Sourced; role: Bi & Sourced;
  links: (Bi & { url: string; kind: string })[];
  an: string | null;
  /** senator id (#/senateur/<id>); when absent the page looks the name up in the Senate list */
  senat?: string | null;
  background?: (Bi & Sourced) | null;
  supporters?: { name: string; role: Bi; sources: Source[] }[];
  campaign?: (Bi & { date: string; sources: Source[] })[];
  /** words that identify the candidate in headlines (default: full name and surname) */
  newsMatch?: string[] | null;
  wealth: { status: "published" | "none"; declarations: { date: string; context: Bi; net: number | null; gross?: number | null; note: Bi | null; sources: Source[] }[]; explanation: Bi; sources: Source[] };
  convictions: {
    definitive: { date: string; court: Bi; offence: Bi; sentence: Bi; kind: "penal" | "press" | "civil"; final: Bi; sources: Source[] }[];
    pending: { since: string; court: Bi; subject: Bi; status: Bi; sources: Source[] }[];
    sources: Source[];
  };
  candidacies: { date: string; type: string; office: Bi; place: string | null; list: Bi | null; pct: number | null; round: number | null; elected: boolean; result: Bi; sources: Source[] }[];
  mandates: (Mandate & { place: string | null; sources: Source[] })[];
  partyFunding: { year: number; kind: "campaign" | "party"; label: Bi; amount: number; sources: Source[] }[];
  programme: string | null;
  quiz: { groups: string[]; note: Bi | null };
}
export interface CandidateIndex { candidates: { slug: string; name: string; pollName: string; photo: string; party: Bi; role: Bi }[] }
export const loadCandidateIndex = () => fetchJson<CandidateIndex>("/data/candidates/index.json");

const tr = (b: Bi | null | undefined) => (b ? L(b.fr, b.en) : "");
const loc = () => (getLang() === "fr" ? "fr-FR" : "en-GB");
/** "2022-03-08" → "8 mars 2022", "2010-12" → "déc. 2010", "1997" → "1997". */
function when(s: string | null | undefined) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  if (d) return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(loc(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (m) return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc(), { month: "short", year: "numeric", timeZone: "UTC" });
  return String(y);
}
const euro = (n: number) => (getLang() === "fr" ? `${fmtNum(Math.round(n))} €` : `€${fmtNum(Math.round(n))}`);
const meuro = (n: number) => (n >= 1e6 ? (getLang() === "fr" ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€` : `€${(n / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 2 })}m`) : euro(n));

/** "Sources : franceinfo (8 mars 2022) · France 24 (9 mars 2022)" */
function src(sources: Source[]) {
  if (!sources?.length) return "";
  return `<p class="cand-src">${L("Sources", "Sources")}${L(" : ", ": ")}${sources
    .map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.publisher)}</a> <span>(${esc(when(s.date))})</span>`)
    .join(" · ")}</p>`;
}

const TYPE: Record<string, Bi> = {
  presidential: { fr: "Présidentielle", en: "Presidential" },
  legislative: { fr: "Législatives", en: "Legislative" },
  european: { fr: "Européennes", en: "European" },
  regional: { fr: "Régionales", en: "Regional" },
  departmental: { fr: "Départementales", en: "Departmental" },
  cantonal: { fr: "Cantonales", en: "Cantonal" },
  municipal: { fr: "Municipales", en: "Municipal" },
  senatorial: { fr: "Sénatoriales", en: "Senatorial" },
};
const OFFICE_GROUP: Record<string, Bi> = {
  gov: { fr: "Gouvernement", en: "Government" },
  parl: { fr: "Parlement", en: "Parliament" },
  local: { fr: "Mandats locaux", en: "Local office" },
  other: { fr: "Autres fonctions", en: "Other posts" },
};
const groupOf = (o: string) => (/ministre|secretaire-etat/.test(o) ? "gov" : /depute|senateur|mep/.test(o) ? "parl" : /fonctionnaire|other/.test(o) ? "other" : "local");

export async function renderCandidate(app: HTMLElement, slug: string) {
  const [d, scales, polls, markets, progs, feed] = await Promise.all([
    fetchJson<CandidateFile>(`/data/candidates/${encodeURIComponent(slug)}.json`),
    fetchJson<PayScales>("/data/candidates/pay-scales.json"),
    loadPolls("2027"),
    loadMarkets().catch(() => null),
    fetchJson<{ programmes: ProgEntry[] }>("/data/programmes/index.json").catch(() => null),
    loadFeed().catch(() => null),
  ]);
  registerParties(polls.parties);
  const m = meta(d.pollName);
  const latest = polls.firstRound[0]?.end ?? new Date().toISOString().slice(0, 10);
  const now = average(polls.firstRound, latest);
  const row = now.find((r) => r.name === d.pollName);
  const rank = row ? now.indexOf(row) + 1 : null;
  const prev = average(polls.firstRound, shiftDays(latest, -30), undefined, 0).find((r) => r.name === d.pollName)?.avg;
  const delta = row && prev != null ? Math.round(10 * row.avg) / 10 - Math.round(10 * prev) / 10 : null;
  const fc = forecast(polls.firstRound, polls.secondRound, markets?.markets ?? [], new Date().toISOString().slice(0, 10));
  const fr = fc.rows.find((r) => r.name === d.pollName);
  const odds = combineOdds(markets?.markets ?? []).filter((o) => o.win);
  const mk = winShare(odds, oddsFor(odds, d.pollName));
  const nPolls = pollsInWindow(polls.firstRound, latest).length;
  const fmtChance = (v: number | null | undefined) => (v == null ? "–" : v < 1 ? `<1${L(" %", "%")}` : v > 99 ? `>99${L(" %", "%")}` : `${Math.round(v)}${L(" %", "%")}`);

  const pay = estimatePay(d.mandates, scales, d.verified);
  const ph = d.photo;
  const cands = [...d.candidacies].sort((a, b) => b.date.localeCompare(a.date));
  const elected = cands.filter((c) => c.elected).length;
  const polled = polls.firstRound.some((p) => p.hyps.some((h) => d.pollName in h));
  const prog = findProgramme(d, progs?.programmes ?? []);
  const news = headlines(d, feed?.stories ?? [], feed?.outlets ?? []);
  const hasCampaign = !!(d.background || d.supporters?.length || d.campaign?.length);
  const toc: [string, string][] = [
    ["c-course", L("Course", "Race")],
    ...(hasCampaign ? [["c-campagne", L("Campagne", "Campaign")] as [string, string]] : []),
    ["c-programme", L("Programme", "Manifesto")], ["c-parlement", L("Parlement", "Parliament")], ["c-actu", L("Actualité", "News")], ["c-quiz", L("Quiz", "Quiz")],
    ["c-patrimoine", L("Patrimoine", "Assets")], ["c-justice", L("Justice", "Courts")], ["c-candidatures", L("Candidatures", "Elections")], ["c-argent", L("Argent public", "Public pay")], ["c-parcours", L("Parcours", "Career")], ["c-liens", L("Liens", "Links")],
  ];

  app.innerHTML = `
    <section class="page cand" style="--c:${m.color}">
      <p class="crumbs"><a href="#/2027">${L("Présidentielle 2027", "2027 presidential election")}</a></p>
      <header class="page-head cand-head">
        <figure class="cand-photo">
          <img src="${esc(safeUrl(ph.src))}" alt="${esc(d.name)}" width="160" height="160" loading="eager" referrerpolicy="no-referrer">
          <figcaption><a href="${esc(safeUrl(ph.page))}" target="_blank" rel="noopener">${L("Photo", "Photo")}</a> ${esc(ph.author)}${ph.year ? `, ${ph.year}` : ""} · ${ph.licenceUrl ? `<a href="${esc(safeUrl(ph.licenceUrl))}" target="_blank" rel="noopener">${esc(ph.licence)}</a>` : esc(ph.licence)} · Wikimedia Commons</figcaption>
        </figure>
        <div>
          <p class="eyebrow">${polled ? L("Testé dans les sondages 2027", "Polled for 2027") : L("Présidentielle 2027", "2027 presidential election")} · <span class="chip" style="--c:${m.color}">${esc(tr(d.party))}</span></p>
          <h1>${esc(d.name)}</h1>
          <p class="dek">${esc(tr(d.role))}</p>
          <p class="cand-meta">${d.born ? `${L("Naissance", "Born")}${L(" : ", ": ")}${esc(when(d.born.date))}${d.born.place ? `, ${esc(d.born.place)}` : ""} · ` : ""}${L("Dernière vérification", "Last checked")}${L(" : ", ": ")}${esc(when(d.verified))}</p>
        </div>
      </header>

      <nav class="cand-toc" aria-label="${L("Sur cette page", "On this page")}">
        ${toc.map(([id, t]) => `<a href="#/candidat/${esc(d.slug)}#${id}">${esc(t)}</a>`).join("")}
      </nav>

      <section class="card" id="c-course">
        <header class="card-head"><h2>${L("Dans la course", "In the race")}</h2><a href="#/2027#prevision">${L("Prévision", "Forecast")}</a></header>
        ${!row && !fr && mk == null
          ? `<p class="cand-none">${polled ? L("Pas dans la moyenne récente", "Not in the recent average") : L("Pas encore testé", "Not polled yet")}</p>
             <p class="muted small">${polled
               ? L("Aucun des sondages de premier tour des trois dernières semaines ne le teste : pas de moyenne, pas de prévision, et aucun marché prédictif ne le cote.", "None of the first-round polls of the last three weeks tests this candidate: no average, no forecast, and no prediction market lists them.")
               : L("Aucun sondage publié ne le teste encore, et aucun marché prédictif ne le cote. Sa moyenne et sa prévision apparaîtront ici dès qu’il sera testé.", "No published poll tests this candidate yet and no prediction market lists them. The average and forecast will appear here once they are polled.")}</p>`
          : `${row ? `<p class="cand-race"><strong data-count>${pct(row.avg)}</strong><span>${L("moyenne des sondages de premier tour", "first-round polling average")}${rank ? `, ${rank}${L(rank === 1 ? "er" : "e", rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th")}` : ""}</span></p>` : ""}
        <p class="cand-race-s">${[
          delta == null ? "" : Math.abs(delta) < 0.05
            ? L("Stable sur 30 jours.", "Flat over 30 days.")
            : `<b class="${delta > 0 ? "cand-up" : "cand-down"}">${signed(delta)}</b> ${L(`point${Math.abs(delta) >= 2 ? "s" : ""} sur 30 jours.`, `point${Math.abs(delta) === 1 ? "" : "s"} over 30 days.`)}`,
          fr?.win != null ? `${L("Chances de victoire selon notre prévision", "Chance of winning in our forecast")}${L(" : ", ": ")}<b>${fmtChance(fr.win)}</b>${infoTip(L("Tirée de la prévision du site : les sondages passés dans 20 000 élections simulées, mêlés aux marchés prédictifs.", "From the site’s forecast: polls run through 20,000 simulated elections, blended with prediction markets."), L("À propos de cette chance", "About this chance"))}${mk != null ? L(`, <b>${fmtChance(mk)}</b> selon les marchés prédictifs.`, `; <b>${fmtChance(mk)}</b> on prediction markets.`) : "."}` : mk != null ? `${L("Chances de victoire selon les marchés prédictifs", "Chance of winning on prediction markets")}${L(" : ", ": ")}<b>${fmtChance(mk)}</b>.` : "",
          fr?.qualify != null ? L(`Au second tour dans ${fmtChance(fr.qualify)} des cas.`, `Reaches the runoff in ${fmtChance(fr.qualify)} of cases.`) : "",
        ].filter(Boolean).join(" ")}</p>
        <p class="muted small">${L(
          `Moyenne des ${nPolls} sondages de premier tour des trois dernières semaines qui le testent ; prévision : notre modèle (sondages et marchés) ; marchés : Kalshi et Polymarket ramenés à 100 %.`,
          `Average of the ${nPolls} first-round polls of the last three weeks that test this candidate; forecast: our model (polls and markets); markets: Kalshi and Polymarket rescaled to 100%.`,
        )}${row ? "" : ` ${L("Pas testé dans les sondages des trois dernières semaines.", "Not tested in the polls of the last three weeks.")}`}</p>`}
        <div id="cand-trend"></div>
        <p class="small"><a href="#/sondages">${L("Tous les sondages et les marchés", "Every poll and market")}</a> · <a href="#/simulateur">${L("Simuler le second tour", "Simulate the runoff")}</a></p>
      </section>

      ${hasCampaign ? campaignCard(d) : ""}

      ${programmeCard(d, prog)}

      <section class="card" id="c-parlement">
        <header class="card-head"><h2>${L("Au Parlement", "In Parliament")}</h2></header>
        <div id="cand-parl"><p class="muted small">${L("Chargement des votes…", "Loading votes…")}</p></div>
      </section>

      ${newsCard(d, news, feed?.windowHours ?? 72)}

      ${quizCard(d)}

      <section class="card" id="c-patrimoine">
        <header class="card-head"><h2>${L("Patrimoine déclaré", "Declared assets")}</h2></header>
        ${d.wealth.status === "published" && d.wealth.declarations.length
          ? `<ol class="cand-list">${[...d.wealth.declarations].sort((a, b) => b.date.localeCompare(a.date)).map((x) => `<li>
              <div class="cand-li-head"><b>${esc(tr(x.context))}</b><span class="cand-fig">${x.net != null ? `${meuro(x.net)} <small>${L("net", "net")}</small>` : `<small>${L("total net non publié", "no published net total")}</small>`}</span></div>
              <p class="muted small">${esc(when(x.date))}${x.note ? ` · ${esc(tr(x.note))}` : ""}</p>${src(x.sources)}</li>`).join("")}</ol>`
          : `<p class="cand-none">${L("Non publiée", "Not published")}</p>`}
        <p class="small">${esc(tr(d.wealth.explanation))}</p>
        ${src(d.wealth.sources)}
        <p class="muted tiny">${L("Seules les déclarations officielles publiées (HATVP, Conseil constitutionnel, Journal officiel) sont reprises. Aucune estimation tirée de classements de presse.", "Only official published declarations (HATVP, Constitutional Council, Journal officiel) are used. No estimate from press rankings.")}</p>
      </section>

      <section class="card" id="c-justice">
        <header class="card-head"><h2>${L("Condamnations judiciaires", "Court convictions")}</h2></header>
        <h3 class="cand-h3">${L("Condamnations définitives", "Final convictions")} <span class="muted">${d.convictions.definitive.length}</span></h3>
        ${d.convictions.definitive.length
          ? `<ol class="cand-list">${[...d.convictions.definitive].sort((a, b) => b.date.localeCompare(a.date)).map((x) => `<li>
              <div class="cand-li-head"><b>${esc(tr(x.offence))}</b><span class="cand-tag">${x.kind === "press" ? L("droit de la presse (pénal)", "press law (criminal)") : x.kind === "civil" ? L("civil", "civil") : L("pénal", "criminal")}</span></div>
              <dl class="cand-dl"><dt>${L("Juridiction", "Court")}</dt><dd>${esc(tr(x.court))}</dd><dt>${L("Peine", "Sentence")}</dt><dd>${esc(tr(x.sentence))}</dd><dt>${L("Définitive", "Final")}</dt><dd>${esc(when(x.date))} · ${esc(tr(x.final))}</dd></dl>${src(x.sources)}</li>`).join("")}</ol>`
          : `<p class="cand-none">${L("Aucune trouvée", "None found")}</p>`}
        <h3 class="cand-h3">${L("Procédures en cours", "Pending proceedings")} <span class="muted">${d.convictions.pending.length}</span></h3>
        <p class="cand-presume">${L("Toute personne poursuivie est présumée innocente tant que sa culpabilité n’a pas été établie par une décision définitive (article 9-1 du Code civil, article préliminaire du Code de procédure pénale).", "Anyone prosecuted is presumed innocent until found guilty by a final decision (article 9-1 of the Civil Code, preliminary article of the Code of Criminal Procedure).")}</p>
        ${d.convictions.pending.length
          ? `<ol class="cand-list">${d.convictions.pending.map((x) => `<li>
              <div class="cand-li-head"><b>${esc(tr(x.subject))}</b><span class="cand-tag">${L("non définitif", "not final")}</span></div>
              <dl class="cand-dl"><dt>${L("Juridiction", "Court")}</dt><dd>${esc(tr(x.court))}</dd><dt>${L("Depuis", "Since")}</dt><dd>${esc(when(x.since))}</dd><dt>${L("État", "Status")}</dt><dd>${esc(tr(x.status))}</dd></dl>${src(x.sources)}</li>`).join("")}</ol>`
          : `<p class="cand-none">${L("Aucune trouvée", "None found")}</p>`}
        <p class="muted tiny">${L(
          "Ne figurent ici que les condamnations pénales devenues définitives (et les jugements civils définitifs en matière de presse), puis les procédures où la personne est elle-même prévenue, mise en examen ou appelante, chacune appuyée sur une décision, un communiqué officiel ou deux médias de référence. Les relaxes, plaintes, enquêtes visant un parti et accusations ne sont pas reprises, ni les condamnations amnistiées, réputées non avenues ou effacées par la réhabilitation. En cas de doute, l’information est écartée.",
          "Only criminal convictions that became final (and final civil judgments under press law) are listed, then proceedings where the person is personally a defendant, under formal investigation or appellant, each backed by a decision, an official communiqué or two reference outlets. Acquittals, complaints, investigations targeting a party and accusations are left out, as are amnestied, voided or expunged convictions. When in doubt, the item is left out.",
        )}</p>
        ${src(d.convictions.sources)}
      </section>

      <section class="card" id="c-candidatures">
        <header class="card-head"><h2>${L("Candidatures", "Elections contested")}</h2>${d.candidacies.some((c) => c.type === "presidential") ? `<a href="#/resultats">${L("Archives", "Archives")}</a>` : ""}</header>
        <div class="kpis cand-kpis">
          <div><strong>${cands.length}</strong>${L("Candidatures", "Candidacies")}</div>
          <div><strong>${elected}</strong>${L("Mandat obtenu", "Seat won")}</div>
        </div>
        ${cands.length
          ? `<p class="cand-types">${Object.entries(TYPE).map(([k, v]) => { const n = cands.filter((c) => c.type === k).length; return n ? `<span>${esc(tr(v))} <b>${n}</b></span>` : ""; }).join("")}</p>
             <ol class="cand-timeline">${cands.map((c) => `<li class="${c.elected ? "is-won" : ""}">
               <span class="cand-year">${esc(c.date.slice(0, 4))}</span>
               <div><div class="cand-li-head"><b>${esc(tr(TYPE[c.type]))} · ${esc(tr(c.office))}</b><span class="cand-tag ${c.elected ? "is-won" : ""}">${c.elected ? L("mandat obtenu", "seat won") : L("sans mandat", "no seat")}</span></div>
               <p class="small">${[c.place ? esc(c.place) : "", c.list ? esc(tr(c.list)) : ""].filter(Boolean).join(" · ")}${c.place || c.list ? "<br>" : ""}${esc(tr(c.result))}</p>${src(c.sources)}</div></li>`).join("")}</ol>`
          : `<p class="cand-none">${L("Aucune candidature à une élection", "Never stood for election")}</p>`}
      </section>

      <section class="card" id="c-argent">
        <header class="card-head"><h2>${L("Argent public perçu", "Public money received")}</h2></header>
        <p class="cand-est">${L("Estimation", "Estimate")}</p>
        <div class="kpis cand-kpis">
          <div><strong>${pay.total ? meuro(pay.total) : "–"}</strong>${L(`Total brut estimé${pay.first ? ` depuis ${pay.first}` : ""}`, `Estimated gross total${pay.first ? ` since ${pay.first}` : ""}`)}</div>
          <div><strong>${pay.years.filter((y) => y.partial).length}</strong>${L("Années incomplètes", "Incomplete years")}</div>
        </div>
        <div id="cand-pay"></div>
        ${payNotes(d, pay.gaps)}
        ${d.partyFunding.length
          ? `<h3 class="cand-h3">${L("Argent public versé au parti ou à la campagne", "Public money paid to the party or campaign")}</h3>
             <p class="muted small">${L("Ce n’est pas un revenu personnel : ces sommes vont au parti ou au compte de campagne, et ne sont pas ajoutées au total ci-dessus.", "Not personal income: this money goes to the party or the campaign account and is not added to the total above.")}</p>
             <ol class="cand-list">${[...d.partyFunding].sort((a, b) => b.year - a.year).map((x) => `<li><div class="cand-li-head"><b>${esc(tr(x.label))}</b><span class="cand-fig">${meuro(x.amount)}</span></div>${src(x.sources)}</li>`).join("")}</ol>`
          : ""}
      </section>

      <section class="card" id="c-parcours">
        <header class="card-head"><h2>${L("Parcours", "Career")}</h2></header>
        <div id="cand-gantt"></div>
        ${d.mandates.length
          ? ["gov", "parl", "local", "other"].map((g) => {
              const list = d.mandates.filter((x) => groupOf(x.office) === g).sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
              return list.length ? `<h3 class="cand-h3">${esc(tr(OFFICE_GROUP[g]))}</h3><ol class="cand-list">${list.map((x) => `<li><div class="cand-li-head"><b>${esc(tr(x.label))}</b><span class="cand-when">${x.from ? esc(when(x.from)) : "?"} – ${x.to ? esc(when(x.to)) : L("en cours", "present")}</span></div>${src(x.sources)}</li>`).join("")}</ol>` : "";
            }).join("")
          : `<p class="cand-none">${L("Aucun mandat ni fonction publique", "No public office held")}</p>`}
      </section>

      <section class="card" id="c-liens">
        <header class="card-head"><h2>${L("Liens", "Links")}</h2></header>
        <ul class="cand-links">
          ${d.an ? `<li><a href="#/depute/${esc(d.an)}">${L("Sa page à l’Assemblée sur Third Estate", "Their Assembly page on Third Estate")}</a><span class="muted small">${L("votes, interventions, présence", "votes, speeches, attendance")}</span></li>` : ""}
          ${d.links.map((l) => `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(tr(l))}</a><span class="muted small">${esc(new URL(safeUrl(l.url), location.href).hostname.replace(/^www\./, ""))}</span></li>`).join("")}
          ${prog ? `<li><a href="#/programmes/${esc(prog.slug)}">${L("Son programme, mesure par mesure", "The manifesto, measure by measure")}</a><span class="muted small">Third Estate</span></li>` : ""}
          <li><a href="#/fil">${L("Fil rouge, fil bleu", "Red feed, blue feed")}</a><span class="muted small">${L("l’actualité vue de gauche et de droite", "the news as left and right see it")}</span></li>
        </ul>
      </section>

      <p class="source">${L("Fiche établie à la main à partir de sources publiques citées ligne par ligne ; vérifiée le", "Hand-built from the public sources cited line by line; checked")} ${esc(when(d.verified))}. ${L("Une erreur ? Les sources de chaque ligne permettent de la vérifier.", "Spotted an error? Each line’s sources let you check it.")}</p>
    </section>`;

  drawTrend(app, polls.firstRound, d.pollName, m.color, latest);
  drawPay(app, pay.years);
  drawGantt(app, d.mandates, d.verified);
  void fillParliament(app, d);
}

// ---------- hub blocks: everything below is looked up by slug or name, and says so when there is nothing ----------

/** Folds accents and case so "Mélenchon" matches "MELENCHON" and "melenchon". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string) => fold(a).replace(/-/g, " ") === fold(b).replace(/-/g, " ");

interface ProgEntry {
  slug: string; candidate: string; party: string; programme: string | null; lite: boolean; status: "published" | "partial" | "none";
  statusNote?: Bi; summary?: Bi; total: number; inLatest?: number;
  lastEstimate: { year: number; label?: Bi; horizon?: Bi; announced: number | null; by: string; net: number } | null;
}
/** The programme analysis for this candidate: the file's `programme` slug, else the same slug, else the same name. */
function findProgramme(d: CandidateFile, list: ProgEntry[]) {
  return list.find((p) => p.slug === d.programme) ?? list.find((p) => p.slug === d.slug) ?? list.find((p) => sameName(p.candidate, d.name)) ?? null;
}
const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; const a = Math.abs(v); const n = fmtNum(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10); return L(`${sg}${n} Md€`, `${sg}€${n}bn`); };

function programmeCard(d: CandidateFile, p: ProgEntry | null) {
  if (!p) return `<section class="card" id="c-programme">
      <header class="card-head"><h2>${L("Programme", "Manifesto")}</h2><a href="#/programmes">${L("Tous les programmes", "Every manifesto")}</a></header>
      <p class="cand-none">${L("Pas encore analysé", "Not analysed yet")}</p>
      <p class="muted small">${L(`Aucune analyse du programme de ${esc(d.name)} n’est encore publiée sur Third Estate. Elle apparaîtra ici, avec le nombre de mesures et leur coût.`, `No analysis of ${esc(d.name)}’s manifesto is published on Third Estate yet. It will appear here, with the number of measures and their cost.`)}</p>
    </section>`;
  const n = p.inLatest ?? p.total;
  const e = p.lastEstimate;
  return `<section class="card" id="c-programme">
    <header class="card-head"><h2>${L("Programme", "Manifesto")}</h2><a href="#/programmes/${esc(p.slug)}">${L("Le programme complet", "Full manifesto")}</a></header>
    ${p.programme ? `<p class="eyebrow">${esc(p.programme)}</p>` : ""}
    ${p.summary ? `<p>${esc(tr(p.summary))}</p>` : ""}
    <div class="kpis cand-kpis">
      <div><strong>${n ? fmtNum(n) : "–"}</strong>${p.lite ? L("Mesures étudiées", "Measures reviewed") : L("Mesures en 2027", "Measures in 2027")}</div>
      <div><strong>${e ? md(e.net) : "–"}</strong>${e ? `${L("Effet estimé sur le solde public", "Estimated effect on the public balance")} (${esc(e.by)}, ${e.year})` : L("Pas d’estimation indépendante du coût", "No independent cost estimate")}</div>
    </div>
    ${e ? `<p class="muted small">${e.label ? `${esc(tr(e.label))}. ` : ""}${e.announced != null ? `${L("Chiffrage annoncé", "Claimed cost")}${L(" : ", ": ")}${md(e.announced)} ; ` : `${L("Pas de chiffrage du parti", "No party costing")} ; `}${L("estimation", "estimate")} ${esc(e.by)}${L(" : ", ": ")}${md(e.net)}${e.horizon ? ` ${esc(tr(e.horizon))}` : ""}. ${L("Solde pour les finances publiques : négatif = coût net.", "Net effect on public finances: negative = net cost.")}</p>` : ""}
    ${p.status === "partial" && p.statusNote ? `<p class="muted small">${esc(tr(p.statusNote))}</p>` : ""}
    <a class="door cand-door" href="#/programmes/${esc(p.slug)}"><b>${n ? L(`Les ${fmtNum(n)} mesures de ${esc(surname(d.name))}, une par une`, `${esc(surname(d.name))}’s ${fmtNum(n)} measures, one by one`) : L(`Le programme de ${esc(surname(d.name))}, mesure par mesure`, `${esc(surname(d.name))}’s manifesto, measure by measure`)}</b><span class="muted small">${L("Mesures, coût, droit et sources, point par point.", "Measures, cost, law and sources, point by point.")}</span></a>
  </section>`;
}

function campaignCard(d: CandidateFile) {
  const events = [...(d.campaign ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return `<section class="card" id="c-campagne">
    <header class="card-head"><h2>${L("Campagne 2027", "2027 campaign")}</h2></header>
    ${d.background ? `<p>${esc(tr(d.background))}</p>${src(d.background.sources)}` : ""}
    ${d.supporters?.length ? `<h3 class="cand-h3">${L("Soutiens et équipe cités par la presse", "Backers and team named in the press")} <span class="muted">${d.supporters.length}</span></h3>
      <ol class="cand-list">${d.supporters.map((s) => `<li><div class="cand-li-head"><b>${esc(s.name)}</b></div><p class="small">${esc(tr(s.role))}</p>${src(s.sources)}</li>`).join("")}</ol>` : ""}
    ${events.length ? `<h3 class="cand-h3">${L("Étapes", "Milestones")}</h3>
      <ol class="cand-list">${events.map((x) => `<li><div class="cand-li-head"><b>${esc(tr(x))}</b><span class="cand-when">${esc(when(x.date))}</span></div>${src(x.sources)}</li>`).join("")}</ol>` : ""}
  </section>`;
}

interface Headline { title: string; link: string; time: string; outlet: string }
/** Headlines from the red/blue feed (last 72 hours) whose title or summary names the candidate. */
function headlines(d: CandidateFile, stories: FeedStory[], outlets: { id: string; name: string }[]): Headline[] {
  const terms = (d.newsMatch?.length ? d.newsMatch : [d.name, surname(d.name)]).map(fold).filter((t) => t.length >= 3);
  const res = terms.map((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`));
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const seen = new Set<string>();
  return stories
    .flatMap((s) => s.items)
    .filter((i) => { const t = fold(`${i.title} ${i.summary ?? ""}`); return res.some((r) => r.test(t)); })
    .sort((a, b) => b.time.localeCompare(a.time))
    .filter((i) => { const k = fold(i.title); if (seen.has(k) || seen.has(i.link)) return false; seen.add(k); seen.add(i.link); return true; })
    .map((i) => ({ title: i.title, link: i.link, time: i.time, outlet: outletName.get(i.outlet) ?? i.outlet }));
}

function newsCard(d: CandidateFile, items: Headline[], hours: number) {
  const shown = items.slice(0, 8);
  const t = (iso: string) => new Date(iso).toLocaleString(loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<section class="card" id="c-actu">
    <header class="card-head"><h2>${L("Dans l’actualité", "In the news")}</h2><a href="#/fil">${L("Le fil", "The feed")}</a></header>
    ${shown.length
      ? `<p class="muted small">${L(`${items.length} titre${items.length > 1 ? "s" : ""} le cit${items.length > 1 ? "ent" : "e"} dans le fil des ${hours} dernières heures (quinze médias, de gauche à droite)${items.length > shown.length ? ` ; les ${shown.length} plus récents` : ""}.`, `${items.length} headline${items.length > 1 ? "s" : ""} in the last ${hours} hours of our feed (fifteen outlets, left to right) name${items.length > 1 ? "" : "s"} this candidate${items.length > shown.length ? `; the ${shown.length} most recent` : ""}.`)}</p>
         <ol class="cand-news">${shown.map((h) => `<li><a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a><span class="muted small">${esc(h.outlet)} · ${esc(t(h.time))}</span></li>`).join("")}</ol>`
      : `<p class="cand-none">${L("Aucun titre récent", "No recent headline")}</p><p class="muted small">${L(`Aucun des titres du fil des ${hours} dernières heures ne le cite.`, `None of the headlines in the last ${hours} hours of our feed names this candidate.`)}</p>`}
  </section>`;
}

function quizCard(d: CandidateFile) {
  const g = d.quiz.groups;
  return `<section class="card" id="c-quiz">
    <header class="card-head"><h2>${L("Le quiz : qui vous ressemble ?", "The quiz: who is closest to you?")}</h2></header>
    ${g.length
      ? `<p class="small">${L(`Répondez aux votes de l’Assemblée et aux mesures des programmes : ${esc(d.name)} y est représenté par ${g.length > 1 ? "les groupes" : "le groupe"} ${g.map(esc).join(" et ")}.`, `Answer the Assembly’s votes and the manifesto measures: ${esc(d.name)} is represented by the ${g.map(esc).join(" and ")} group${g.length > 1 ? "s" : ""}.`)}${d.quiz.note ? ` ${esc(tr(d.quiz.note))}` : ""}</p>`
      : `<p class="cand-none">${L("Pas encore dans le quiz", "Not in the quiz yet")}</p><p class="muted small">${d.quiz.note ? esc(tr(d.quiz.note)) : L("Aucun groupe parlementaire ne le représente encore dans le quiz.", "No parliamentary group stands for this candidate in the quiz yet.")}</p>`}
    <a class="button" href="#/quiz">${L("Faire le quiz", "Take the quiz")}</a>
  </section>`;
}

type Vote = "P" | "C" | "A" | "N" | "-";
const VOTE: Record<string, Bi> = { P: { fr: "Pour", en: "For" }, C: { fr: "Contre", en: "Against" }, A: { fr: "Abstention", en: "Abstain" }, N: { fr: "Non-votant", en: "Non-voting" } };
interface Senator { id: string; prenom: string; nom: string; circonscription: string; groupe?: { abrev?: string; libelle?: string } | null; stats?: { pour: number; contre: number; abstention: number; scrutins: number; participation: number } }

/** Votes in Parliament: the MP (file `an`, else same name among sitting MPs) or the senator (file `senat`, else same name). */
async function fillParliament(app: HTMLElement, d: CandidateFile) {
  const box = () => app.querySelector<HTMLElement>("#cand-parl");
  try {
    const [deps, sens] = await Promise.all([
      fetchJson<Depute[]>("/data/an/deputes.json").catch(() => [] as Depute[]),
      fetchJson<Senator[]>("/data/senat/senateurs.json").catch(() => [] as Senator[]),
    ]);
    const mp = (d.an ? deps.find((x) => x.id === d.an) : null) ?? deps.find((x) => sameName(`${x.prenom} ${x.nom}`, d.name)) ?? null;
    const sen = mp ? null : (d.senat ? sens.find((x) => x.id === d.senat) : null) ?? sens.find((x) => sameName(`${x.prenom} ${x.nom}`, d.name)) ?? null;
    if (!box()) return;
    if (mp) {
      const [votes, scrutins] = await Promise.all([loadVotes(mp.id).catch(() => ({}) as Record<string, Vote>), loadScrutins().catch(() => [])]);
      const recent = scrutins.filter((s) => votes[String(s[0])]).sort((a, b) => b[1].localeCompare(a[1]) || b[0] - a[0]).slice(0, 6)
        .map((s) => ({ date: s[1], title: s[2], result: s[3], v: votes[String(s[0])] }));
      return void (box()!.innerHTML = parlBlock({
        who: L(`Député${mp.civ === "Mme" ? "e" : ""} ${mp.departement ? `(${mp.departement}, ${mp.numCirco}${mp.numCirco === 1 ? L("re", "st") : L("e", "th")} circ.)` : ""}`, `MP ${mp.departement ? `(${mp.departement}, constituency ${mp.numCirco})` : ""}`),
        group: mp.groupe?.libelle ?? "", href: `#/depute/${mp.id}`, label: L("Sa page de député : tous ses votes, interventions, présence", "Their MP page: every vote, speech, attendance"),
        stats: mp.stats, recent,
      }));
    }
    if (sen) {
      const [votes, scrutins] = await Promise.all([
        fetchJson<Record<string, Vote>>(`/data/senat/votes/${encodeURIComponent(sen.id)}.json`).catch(() => ({}) as Record<string, Vote>),
        fetchJson<[string, string, string, string, ...unknown[]][]>("/data/senat/scrutins.json").catch(() => []),
      ]);
      const recent = scrutins.filter((s) => votes[s[0]] && votes[s[0]] !== "-").sort((a, b) => b[1].localeCompare(a[1]) || b[0].localeCompare(a[0], undefined, { numeric: true })).slice(0, 6)
        .map((s) => ({ date: s[1], title: s[2], result: s[3], v: votes[s[0]] }));
      return void (box()!.innerHTML = parlBlock({
        who: L(`Au Sénat (${sen.circonscription})`, `Senator (${sen.circonscription})`), group: sen.groupe?.libelle ?? "", href: `#/senateur/${sen.id}`,
        label: L("Sa page de sénateur : tous ses votes", "Their senator page: every vote"), stats: sen.stats ?? null, recent,
      }));
    }
    const mep = d.mandates.find((m) => m.office === "mep" && !m.to);
    const ep = d.links.find((l) => l.kind === "ep");
    box()!.innerHTML = `<p class="cand-none">${L("Ne siège pas au Parlement français", "Does not sit in the French Parliament")}</p>
      <p class="muted small">${mep
        ? `${L("Député européen : ses votes au Parlement européen ne sont pas suivis sur Third Estate.", "Member of the European Parliament: votes there are not tracked on Third Estate.")}${ep ? ` <a href="${esc(safeUrl(ep.url))}" target="_blank" rel="noopener">${esc(tr(ep))}</a>` : ""}`
        : L("Ni député ni sénateur aujourd’hui : pas de votes à afficher.", "Neither an MP nor a senator today: no votes to show.")}
      <a href="#/assemblee">${L("Les députés et leurs votes", "The MPs and their votes")}</a></p>`;
  } catch {
    const b = box();
    if (b) b.innerHTML = `<p class="muted small">${L("Votes indisponibles pour le moment.", "Votes unavailable right now.")}</p>`;
  }
}

function parlBlock(o: { who: string; group: string; href: string; label: string; stats: { pour: number; contre: number; abstention: number; scrutins: number; participation: number } | null; recent: { date: string; title: string; result: string; v: string }[] }) {
  const s = o.stats;
  return `<p class="small"><b>${esc(o.who)}</b>${o.group ? ` · ${esc(o.group)}` : ""}</p>
    ${s ? `<div class="kpis kpis-4 cand-kpis">
      <div><strong>${fmtNum(s.pour + s.contre + s.abstention)}</strong>${L("Votes exprimés", "Votes cast")}</div>
      <div><strong>${Math.round(100 * s.participation)}${L(" %", "%")}</strong>${L("Participation aux scrutins", "Turnout in divisions")}</div>
      <div><strong>${fmtNum(s.pour)}</strong>${L("Pour", "For")}</div>
      <div><strong>${fmtNum(s.contre)}</strong>${L("Contre", "Against")}</div>
    </div>` : ""}
    ${o.recent.length
      ? `<h3 class="cand-h3">${L("Ses derniers votes", "Latest votes")}</h3><ol class="cand-votes">${o.recent.map((r) => `<li><span class="cand-vote v-${esc(r.v)}">${esc(tr(VOTE[r.v] ?? { fr: r.v, en: r.v }))}</span><span>${esc(r.title.replace(/^./, (c) => c.toUpperCase()))}<span class="muted small"> · ${esc(when(r.date))} · ${esc(r.result)}</span></span></li>`).join("")}</ol>`
      : `<p class="muted small">${L("Aucun vote enregistré pour l’instant.", "No recorded vote yet.")}</p>`}
    <p class="small"><a href="${esc(o.href)}">${esc(o.label)}</a></p>`;
}

function payNotes(d: CandidateFile, gaps: Set<string>) {
  const unpriced = d.mandates.filter((x) => UNPRICED.has(x.office));
  const gapText: Record<string, Bi> = {
    parliament: { fr: "l’indemnité parlementaire avant novembre 2001 (aucun barème officiel vérifié)", en: "the parliamentary indemnity before November 2001 (no verified official scale)" },
    government: { fr: "la rémunération ministérielle avant mai 2002", en: "ministerial pay before May 2002" },
    "local-pre1992": { fr: "les indemnités locales avant la loi du 3 février 1992", en: "local indemnities before the law of 3 February 1992" },
    "local-scale": { fr: "certaines indemnités locales (population ou barème non vérifiés)", en: "some local indemnities (population or scale not verified)" },
    "local-minister": { fr: "les indemnités locales pendant les fonctions ministérielles (règle de cumul non vérifiée)", en: "local indemnities while in government (cumulation rule not verified)" },
  };
  return `<details class="cand-method">
    <summary>${L("Comment l’estimation est calculée", "How the estimate works")}</summary>
    <ol class="small">
      <li>${L("Pour chaque jour où un mandat est exercé, on prend le montant mensuel brut officiel de l’année pour cette fonction, au prorata : indemnité parlementaire (base, résidence et fonction) pour les députés et sénateurs, et pour les députés européens français jusqu’au 13 juillet 2009 ; ensuite le traitement unique des députés européens ; traitement des membres du Gouvernement (barème de 2002, puis baisse de 30 % en 2012), qui remplace l’indemnité parlementaire.", "For each day a mandate is held, the year’s official gross monthly amount for that office, pro rata: parliamentary indemnity (base, residence and function) for deputies and senators, and for French MEPs until 13 July 2009; then the single MEP salary; government pay (2002 scale, then the 2012 30% cut), which replaces the parliamentary indemnity.")}</li>
      <li>${L("Mandats locaux : taux maximal légal (Code général des collectivités territoriales) selon la population, appliqué au traitement de l’indice brut terminal de la fonction publique. Les conseils peuvent voter moins : c’est une estimation haute. Les majorations facultatives ne sont pas appliquées.", "Local mandates: the legal maximum rate (local authorities code) for the population tier, applied to the pay of the top civil-service index. Councils may vote less: this is an upper estimate. Optional increases are not applied.")} ${L("Le barème des conseillers régionaux et celui des présidents d’intercommunalité ne sont vérifiés qu’à partir de 2019 (et de 2002 pour les intercommunalités) ; ils sont appliqués tels quels aux années antérieures, comme l’indice terminal de 1992 à 2001.", "The regional councillor scale and the inter-municipal president scale are only verified from 2019 (and 2002 for inter-municipal bodies); they are applied as is to earlier years, as is the 1992–2001 terminal index.")}</li>
      <li>${L("Écrêtement : un parlementaire ne peut ajouter que la moitié de l’indemnité parlementaire de base en indemnités locales ; un élu local ne peut dépasser 1,5 fois cette base au total.", "Écrêtement: a parliamentarian can add at most half the base parliamentary indemnity in local allowances; a local official cannot exceed 1.5 times that base in total.")}</li>
      <li>${L("Non compté : frais de mandat, crédits collaborateurs, retraites, traitements de fonctionnaire (grade et échelon non publics), présidences de partis et d’associations.", "Not counted: expense allowances, staff budgets, pensions, civil-service salaries (grade and step not public), party and association posts.")}${unpriced.length ? ` ${L("Ici", "Here")}${L(" : ", ": ")}${unpriced.map((x) => esc(tr(x.label))).join(" ; ")}.` : ""}</li>
      ${gaps.size ? `<li>${L("Années incomplètes (barres claires) : ", "Incomplete years (light bars): ")}${[...gaps].map((g) => esc(tr(gapText[g]))).join(" ; ")}.</li>` : ""}
    </ol>
    <p class="small"><a href="/data/candidates/pay-scales.json" target="_blank" rel="noopener">${L("Barèmes et sources (pay-scales.json)", "Scales and sources (pay-scales.json)")}</a></p>
  </details>`;
}

function drawTrend(app: HTMLElement, polls: Parameters<typeof trend>[0], name: string, color: string, latest: string) {
  const box = app.querySelector<HTMLElement>("#cand-trend");
  if (!box) return;
  const pts = trend(polls, shiftDays(latest, -365)).flatMap((p) => (p.values[name] != null ? [{ date: p.date, value: p.values[name] }] : []));
  if (pts.length < 2) return;
  box.innerHTML = `<h3 class="cand-h3">${L("Moyenne des sondages sur un an", "Polling average over a year")}</h3>${lineChart([{ name, label: meta(name).surname, color, line: pts }], { height: 220 })}`;
}

/** Bars per year (gross estimate), light when the year is incomplete; the running total is in each bar's tooltip. */
function drawPay(app: HTMLElement, years: { year: number; amount: number; partial: boolean }[]) {
  const box = app.querySelector<HTMLElement>("#cand-pay");
  if (!box) return;
  if (!years.some((y) => y.amount > 0)) { box.innerHTML = `<p class="cand-none">${L("Aucune indemnité chiffrée", "No allowance priced")}</p>`; return; }
  const compact = window.innerWidth < 640;
  const W = compact ? 360 : 900, H = compact ? 230 : 260, l = compact ? 44 : 56, r = 8, t = 14, b = 26;
  const max = Math.max(...years.map((y) => y.amount), 1);
  const nice = [20000, 50000, 100000, 150000, 200000, 250000, 300000].find((v) => v >= max) ?? Math.ceil(max / 100000) * 100000;
  const bw = (W - l - r) / years.length;
  const yy = (v: number) => t + (H - t - b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const k = (v: number) => (v === 0 ? "0" : getLang() === "fr" ? `${Math.round(v / 1000)} k€` : `€${Math.round(v / 1000)}k`);
  const every = Math.ceil(years.length / (compact ? 6 : 14));
  let cum = 0;
  box.innerHTML = `<figure class="cand-paychart" role="img" aria-label="${L("Rémunération publique brute estimée, par année", "Estimated gross public pay, by year")}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${ticks.map((v) => `<line x1="${l}" x2="${W - r}" y1="${yy(v)}" y2="${yy(v)}" class="${v ? "g" : "z"}"/><text x="${l - 6}" y="${yy(v) + 4}" text-anchor="end">${k(v)}</text>`).join("")}
      ${years.map((y, i) => {
        cum += y.amount;
        const h = H - b - yy(y.amount);
        return `<rect x="${l + i * bw + bw * 0.12}" y="${yy(y.amount)}" width="${Math.max(1, bw * 0.76)}" height="${Math.max(0, h)}" class="${y.partial ? "p" : ""}" data-tip="${esc(`${y.year}\n${euro(y.amount)}${y.partial ? L(" (incomplet)", " (incomplete)") : ""}\n${L("Cumul", "Running total")} ${euro(cum)}`)}"/>${i % every === 0 || (i === years.length - 1 && i % every >= every / 2 + 0.5) ? `<text x="${l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${y.year}</text>` : ""}`;
      }).join("")}
    </svg>
    <figcaption class="muted tiny">${L("Brut annuel estimé, en euros courants. Barres claires : année incomplète (une partie des mandats n’est pas chiffrée). Survolez une barre pour le détail et le cumul.", "Estimated gross per year, current euros. Light bars: incomplete year (some mandates not priced). Hover a bar for the detail and running total.")}</figcaption>
  </figure>`;
}

/** One row per office type, a bar for each period held. */
function drawGantt(app: HTMLElement, mandates: CandidateFile["mandates"], until: string) {
  const box = app.querySelector<HTMLElement>("#cand-gantt");
  const ms = mandates.filter((x) => x.from);
  if (!box || !ms.length) return;
  const y0 = Math.min(...ms.map((x) => +x.from!.slice(0, 4)));
  const y1 = +until.slice(0, 4) + 1;
  const pos = (s: string | null) => { const v = s ? +s.slice(0, 4) + ((+s.slice(5, 7) || 1) - 1) / 12 : y1 - 1 + (+until.slice(5, 7)) / 12; return (100 * (v - y0)) / (y1 - y0); };
  const groups = ["gov", "parl", "local", "other"].filter((g) => ms.some((x) => groupOf(x.office) === g));
  const decades: number[] = [];
  for (let y = Math.ceil(y0 / 5) * 5; y < y1; y += 5) decades.push(y);
  box.innerHTML = `<div class="cand-gantt" role="img" aria-label="${L("Frise des mandats", "Timeline of offices")}">
    ${groups.map((g) => `<div class="cand-gr"><span>${esc(tr(OFFICE_GROUP[g]))}</span><div>${ms.filter((x) => groupOf(x.office) === g).map((x) => { const a = pos(x.from), bb = pos(x.to); return `<i class="g-${g}" style="left:${a}%;width:${Math.max(0.6, bb - a)}%" data-tip="${esc(`${tr(x.label)}\n${when(x.from)} – ${x.to ? when(x.to) : L("en cours", "present")}`)}"></i>`; }).join("")}</div></div>`).join("")}
    <div class="cand-gr cand-axis"><span></span><div>${decades.map((y) => `<b style="left:${(100 * (y - y0)) / (y1 - y0)}%">${y}</b>`).join("")}</div></div>
  </div>`;
}
