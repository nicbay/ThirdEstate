// French Members of the European Parliament (eurodéputés): the list (#/europe) and one MEP (#/eurodepute/<id>),
// with how they vote in plenary roll calls and what they say in plenary debates.
// Data: scripts/sync-europarl.mjs (European Parliament Open Data Portal, API v2) into public/data/pe/.
import { fetchJson } from "../data";
import { L, colon, fmtDate, fmtNum, fmtPct, getLang } from "../i18n";
import { hemicycle } from "../lib/hemicycle";
import { esc, safeColor, safeUrl } from "../util";
import { renderChamberCloud, renderSpeakerSpeech, type SpeechChamber } from "./speeches";

type Pos = "P" | "C" | "A";
export interface Mep {
  id: string; civ: string; prenom: string; nom: string; sort: string; feminin: boolean; naissance: string | null;
  photo: string; email: string | null; url: string; current: boolean; mandats: [string, string | null][];
  groupe: { abrev: string; libelle: string; libelleEn: string; couleur: string };
  parti: { id: string; abrev: string; libelle: string; libelleEn: string } | null;
  stats: {
    eligible: number; cast: number; pour: number; contre: number; abstention: number; participation: number | null;
    group: { n: number; ok: number; opp: number; ni: number; rate: number | null };
    france: { n: number; ok: number; opp: number; rate: number | null };
    /** French national delegation -> [votes compared, same position] */
    parties: Record<string, [number, number]>;
    /** [votingId, own position, group line, share of colleagues on the line, colleagues voting] */
    breaks: [string, Pos, Pos, number, number][];
  } | null;
  speeches: { total: number; french: number; notFrench: number; langs: Record<string, number>; chair: number } | null;
}
/** [votingId, date, vote item id, label fr, label en, outcome, for, against, abstention, French line, {group: line}] */
type VoteRow = [string, string, string, string, string, string, number, number, number, Pos | null, Record<string, Pos>];
interface VotesFile {
  groups: Record<string, { fr: string; en: string; couleur: string; rank: number }>;
  parties: Record<string, { fr: string; en: string }>;
  items: Record<string, { fr: string | null; en: string | null; rec: string | null; date: string }>;
  votes: VoteRow[];
}
interface Meta {
  syncedAt: string;
  window: { from: string; to: string; fullTerm: boolean };
  meps: { current: number; term: number };
  votes: { from: string; to: string; sittings: number; sittingsWithRollCalls: number; rollCalls: number; items: number } | null;
  speeches: { total: number; french: number; notFrench: number; langs: Record<string, number>; chair: number; meps: number; from: string | null; to: string | null };
  missing: string[];
}

let mepsP: Promise<Mep[]> | null = null;
export const loadMeps = () => (mepsP ??= fetchJson<Mep[]>("/data/pe/meps.json"));
let votesP: Promise<VotesFile> | null = null;
const loadVotes = () => (votesP ??= fetchJson<VotesFile>("/data/pe/votes.json"));
let metaP: Promise<Meta> | null = null;
const loadMeta = () => (metaP ??= fetchJson<Meta>("/data/pe/meta.json"));

const SEATS_FR = 81; // France's seats in the 10th term
const photo = (id: string) => esc(safeUrl(`https://www.europarl.europa.eu/mepphoto/${encodeURIComponent(id)}.jpg`));
const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : fmtPct(100 * x, d));
const groupName = (m: Mep) => L(m.groupe.libelle, m.groupe.libelleEn);
const partyName = (m: Mep) => (m.parti ? L(m.parti.libelle, m.parti.libelleEn) : "");
const DOCEO = "https://www.europarl.europa.eu/doceo/document/";
const ln = () => (getLang() === "fr" ? "FR" : "EN");
/** The roll-call results of a sitting, opened at the vote item (official page, anchors are the item numbers). */
const rcvUrl = (date: string, item: string) => `${DOCEO}PV-10-${date}-RCV_${ln()}.html${item ? `#${item.replace(/^.*VOT-ITM-/, "")}` : ""}`;
const rcvPdf = (date: string) => `https://data.europarl.europa.eu/distribution/doc/PV-10-${date}-RCV_${ln().toLowerCase()}.pdf`;
const posLabel = (p: string, fem = false) => ({ P: L("Pour", "For"), C: L("Contre", "Against"), A: L("Abstention", "Abstain"), "-": L(fem ? "Absente" : "Absent", "Absent") } as Record<string, string>)[p] ?? p;
const outcomeLabel = (o: string) => ({ ADOPTED: L("adopté", "adopted"), REJECTED: L("rejeté", "rejected"), LAPSED: L("caduc", "lapsed") } as Record<string, string>)[o] ?? o.toLowerCase();
const groupOrder = (g: string) => ({ "The Left": 1, "S&D": 2, "Verts/ALE": 3, Renew: 4, PPE: 6, ECR: 7, PfE: 8, ESN: 9, NI: 10 } as Record<string, number>)[g] ?? 11;

/** The speeches section and chamber cloud reuse src/views/speeches.ts with this chamber description. */
const PE: SpeechChamber = {
  base: "/data/pe/interventions/",
  people: () => loadMeps(),
  href: (id) => `#/eurodepute/${id}`,
  photo: (p) => photo(p.id),
  record: DOCEO,
  link: () => ["#/europe", L("Ce que disent les eurodéputés français", "What French MEPs say")],
  members: () => L("eurodéputés français", "French MEPs"),
  house: () => L("eurodéputés français", "French MEPs"),
  barNote: () => L("Barre : part de ses interventions ; trait : moyenne des eurodéputés français.", "Bar: share of their speeches; tick: average of French MEPs."),
  methodNote: (she) => L(`Les mots du nuage sont ceux que ${she ? "cette eurodéputée" : "cet eurodéputé"} emploie nettement plus que les autres eurodéputés français (TF-IDF)`, "Cloud words are those this MEP uses far more than the other French MEPs (TF-IDF)"),
  briefLabel: () => L("Pas en français (écartées)", "Not in French (left out)"),
  sourceLine: (p) =>
    `<p class="source muted">${L(
      `Source : Parlement européen, données ouvertes (API des interventions, texte du compte rendu in extenso dans la langue de l’orateur). Seules les interventions prononcées en français sont analysées ; les traductions automatiques ne sont jamais utilisées. ${p.sittings} séances, du ${fmtDate(p.from)} au ${fmtDate(p.to)}.`,
      `Source: European Parliament open data (speeches API, verbatim report text in the speaker’s language). Only speeches given in French are analysed; machine translations are never used. ${p.sittings} sittings, ${fmtDate(p.from)} to ${fmtDate(p.to)}.`,
    )}</p>`,
};

function coverage(meta: Meta) {
  const v = meta.votes;
  const s = meta.speeches;
  return L(
    `Votes : ${v ? `${fmtNum(v.rollCalls)} votes par appel nominal sur ${fmtNum(v.sittingsWithRollCalls)} séances, du ${fmtDate(v.from)} au ${fmtDate(v.to)}` : "non chargés"}. Interventions : ${fmtNum(s.total)} relevées${s.from ? ` du ${fmtDate(s.from)} au ${fmtDate(s.to!)}` : ""}, dont ${fmtNum(s.french)} en français analysées et ${fmtNum(s.notFrench)} dans une autre langue écartées. Mise à jour le ${fmtDate(meta.syncedAt)}.`,
    `Votes: ${v ? `${fmtNum(v.rollCalls)} roll-call votes on ${fmtNum(v.sittingsWithRollCalls)} sittings, ${fmtDate(v.from)} to ${fmtDate(v.to)}` : "not loaded"}. Speeches: ${fmtNum(s.total)} recorded${s.from ? ` from ${fmtDate(s.from)} to ${fmtDate(s.to!)}` : ""}, of which ${fmtNum(s.french)} in French analysed and ${fmtNum(s.notFrench)} in another language left out. Updated ${fmtDate(meta.syncedAt)}.`,
  );
}
const SOURCE = () => L(
  `Source : Parlement européen, portail des données ouvertes (data.europarl.europa.eu), © Union européenne.`,
  `Source: European Parliament Open Data Portal (data.europarl.europa.eu), © European Union.`,
);
const crumbs = (last?: string) =>
  `<nav class="crumbs muted small"><a href="#/elus">${L("Élus", "Elected officials")}</a> › <a href="#/europe">${L("Eurodéputés", "MEPs")}</a>${last ? ` › ${esc(last)}` : ""}</nav>`;

// ---------- the list ----------
const filter = { q: "", g: "", p: "" };
export async function renderEurope(app: HTMLElement) {
  const [all, meta] = await Promise.all([loadMeps(), loadMeta().catch(() => null)]);
  const meps = all.filter((m) => m.current);
  const former = all.filter((m) => !m.current);
  const groups = [...new Map(meps.map((m) => [m.groupe.abrev, m.groupe])).values()].sort((a, b) => groupOrder(a.abrev) - groupOrder(b.abrev));
  const count = (g: string) => meps.filter((m) => m.groupe.abrev === g).length;
  const parties = [...new Map(meps.filter((m) => m.parti).map((m) => [m.parti!.abrev, m.parti!])).values()].sort((a, b) => meps.filter((m) => m.parti?.abrev === b.abrev).length - meps.filter((m) => m.parti?.abrev === a.abrev).length);
  const big = [...groups].sort((a, b) => count(b.abrev) - count(a.abrev))[0];
  app.innerHTML = `
    <section class="page">
      ${crumbs()}
      <header class="page-head">
        <p class="eyebrow">${L("Parlement européen", "European Parliament")}</p>
        <h1>${big ? esc(L(`Les ${meps.length} eurodéputés français : ${count(big.abrev)} siègent chez les ${big.abrev}`, `France’s ${meps.length} MEPs: ${count(big.abrev)} sit with ${big.abrev}`)) : L("Les eurodéputés français", "France’s MEPs")}</h1>
        <p class="dek">${L(
          `Élus en juin 2024 pour la 10e législature. Au Parlement, ils siègent dans des groupes européens, pas par pays. Leur participation aux votes par appel nominal, leur accord avec leur groupe et avec les autres Français, et ce qu’ils disent en séance.`,
          `Elected in June 2024 for the 10th term. In Parliament they sit in European groups, not by country. Their turnout in roll-call votes, how often they side with their group and with the other French MEPs, and what they say in plenary.`,
        )}</p>
      </header>
      <div class="pres-grid">
        <section class="card">${hemicycle(groups.map((g) => ({ label: `${g.abrev} · ${L(g.libelle, g.libelleEn)}`, color: safeColor(g.couleur), seats: count(g.abrev) })), SEATS_FR)}</section>
        <section class="card"><ul class="legend-list">${groups.map((g) => `<li><i class="dot" style="background:${safeColor(g.couleur)}"></i>${esc(g.abrev)} <span class="muted">${esc(L(g.libelle, g.libelleEn))}</span><b>${count(g.abrev)}</b></li>`).join("")}</ul>
          <p class="muted small">${L("Groupes politiques du Parlement européen, membres français seulement.", "European Parliament political groups, French members only.")}</p></section>
      </div>
      <section class="card">
        <div class="filters">
          <input id="q" type="search" placeholder="${L("Nom ou parti…", "Name or party…")}" value="${esc(filter.q)}"/>
          <select id="g" aria-label="${L("Groupe", "Group")}"><option value="">${L("Tous les groupes", "All groups")}</option>${groups.map((g) => `<option value="${esc(g.abrev)}" ${g.abrev === filter.g ? "selected" : ""}>${esc(g.abrev)}</option>`).join("")}</select>
          <select id="p" aria-label="${L("Parti", "Party")}"><option value="">${L("Tous les partis", "All parties")}</option>${parties.map((p) => `<option value="${esc(p.abrev)}" ${p.abrev === filter.p ? "selected" : ""}>${esc(L(p.libelle, p.libelleEn))}</option>`).join("")}</select>
          <span id="count" class="muted small"></span>
        </div>
        <div class="mp-grid" id="list"></div>
      </section>
      <div id="pe-cloud"></div>
      ${former.length ? `<section class="card"><header class="card-head"><h2>${L("Ont quitté le Parlement depuis 2024", "Left Parliament since 2024")}</h2></header><div class="mp-grid">${former.map(card).join("")}</div></section>` : ""}
      ${meta ? `<p class="muted small">${coverage(meta)}</p>` : ""}
      <p class="source">${SOURCE()}</p>
    </section>`;
  const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const draw = () => {
    const q = norm(filter.q);
    const rows = meps.filter((m) => (!filter.g || m.groupe.abrev === filter.g) && (!filter.p || m.parti?.abrev === filter.p) && (!q || norm(`${m.prenom} ${m.nom} ${m.parti?.libelle ?? ""} ${m.parti?.abrev ?? ""} ${m.groupe.abrev}`).includes(q)));
    app.querySelector("#count")!.textContent = `${rows.length} ${L("eurodéputés", "MEPs")}`;
    app.querySelector("#list")!.innerHTML = rows.map(card).join("");
  };
  app.querySelector<HTMLInputElement>("#q")!.addEventListener("input", (e) => { filter.q = (e.target as HTMLInputElement).value; draw(); });
  app.querySelector<HTMLSelectElement>("#g")!.addEventListener("change", (e) => { filter.g = (e.target as HTMLSelectElement).value; draw(); });
  app.querySelector<HTMLSelectElement>("#p")!.addEventListener("change", (e) => { filter.p = (e.target as HTMLSelectElement).value; draw(); });
  draw();
  void renderChamberCloud(app.querySelector<HTMLElement>("#pe-cloud")!, PE, L("Ce que disent les eurodéputés français en séance", "What French MEPs say in plenary"), (s) =>
    L(
      `${fmtNum(s.chamber.speeches)} interventions en français en séance plénière, ${fmtNum(s.period.sittings)} séances du ${fmtDate(s.period.from)} au ${fmtDate(s.period.to)}. Survolez un mot pour un extrait, cliquez pour voir qui le prononce.`,
      `${fmtNum(s.chamber.speeches)} speeches in French in plenary, ${fmtNum(s.period.sittings)} sittings from ${fmtDate(s.period.from)} to ${fmtDate(s.period.to)}. Hover a word for a quote, click it to see who says it.`,
    ),
  ).catch(console.error);
}
function card(m: Mep) {
  const part = m.stats?.participation;
  return `<a class="mp-card card" href="#/eurodepute/${esc(m.id)}" style="--c:${safeColor(m.groupe.couleur)}"><img src="${photo(m.id)}" alt="" loading="lazy" data-hide-broken/><div><strong>${esc(m.prenom)} ${esc(m.nom)}</strong><span class="chip">${esc(m.groupe.abrev)}</span><div class="muted small">${esc(partyName(m))}${part != null ? `${m.parti ? " · " : ""}${L("participation", "turnout")} ${pct(part)}` : ""}</div></div></a>`;
}

// ---------- one MEP ----------
const PAGE = 20;
export async function renderEurodepute(app: HTMLElement, id: string) {
  const [all, meta, vf, mine] = await Promise.all([
    loadMeps(),
    loadMeta().catch(() => null),
    loadVotes().catch(() => null),
    fetchJson<Record<string, Pos | "-">>(`/data/pe/votes/${encodeURIComponent(id)}.json`).catch(() => ({}) as Record<string, Pos | "-">),
  ]);
  const m = all.find((x) => x.id === id);
  if (!m) throw new Error(id);
  const st = m.stats;
  const byId = new Map((vf?.votes ?? []).map((v) => [v[0], v]));
  const rows = (vf?.votes ?? []).filter((v) => mine[v[0]]);
  const itemTitle = (v: VoteRow) => { const it = vf?.items[v[2]]; return (it ? L(it.fr ?? it.en ?? "", it.en ?? it.fr ?? "") : "") || L(v[3], v[4] || v[3]); };
  const mandate = m.mandats.map(([s, e]) => (e ? L(`du ${fmtDate(s)} au ${fmtDate(e)}`, `${fmtDate(s)} to ${fmtDate(e)}`) : L(`depuis le ${fmtDate(s)}`, `since ${fmtDate(s)}`))).join(", ");
  const age = m.naissance ? Math.floor((Date.now() - Date.parse(m.naissance)) / (365.25 * 864e5)) : null;
  const partyRows = st
    ? Object.entries(st.parties)
        .filter(([, [n]]) => n >= 20)
        .map(([p, [n, ok]]) => ({ p, n, rate: ok / n, own: p === m.parti?.abrev }))
        .sort((a, b) => b.rate - a.rate)
    : [];
  const partyLabel = (p: string) => { const x = vf?.parties[p]; return x ? L(x.fr, x.en) : p; };
  const f = { q: "", pos: "", page: 1 };

  app.innerHTML = `
    <section class="page">
      ${crumbs(`${m.prenom} ${m.nom}`)}
      <div class="mp-head card" style="--c:${safeColor(m.groupe.couleur)}">
        <img src="${photo(m.id)}" alt="" data-hide-broken/>
        <div class="mp-id">
          <p class="eyebrow">${L(m.feminin ? "Eurodéputée" : "Eurodéputé", "Member of the European Parliament")}, France${m.current ? "" : ` · ${L("ancien mandat", "former member")}`}</p>
          <h1>${esc(m.prenom)} ${esc(m.nom)}</h1>
          <p><span class="chip">${esc(m.groupe.abrev)}</span> ${esc(groupName(m))}</p>
          ${m.parti ? `<p class="small">${L("Parti national", "National party")}${colon()}<b>${esc(partyName(m))}</b></p>` : ""}
          <p class="muted small">${age != null ? `${age} ${L("ans", "years old")} · ` : ""}${L("Mandat", "Term of office")} ${mandate}</p>
        </div>
      </div>

      <div class="mp-grid-2">
        <div class="card">
          <h3>${L("Liens", "Links")}</h3>
          <ul class="socials">
            <li><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${L("Fiche officielle au Parlement européen", "Official European Parliament page")} ↗</a></li>
            ${m.email ? `<li><a href="mailto:${esc(m.email)}">✉ ${esc(m.email)}</a></li>` : ""}
          </ul>
        </div>
        <div class="card">
          ${st ? `<div class="kpis kpis-4">
            <div><span class="muted">${L("Participation", "Turnout")}</span><strong>${pct(st.participation)}</strong></div>
            <div><span class="muted">${L("Avec son groupe", "With their group")}</span><strong>${pct(st.group.rate)}</strong></div>
            <div><span class="muted">${L("Avec les Français", "With French MEPs")}</span><strong>${pct(st.france.rate)}</strong></div>
            <div><span class="muted">${L("Votes", "Votes")}</span><strong>${fmtNum(st.cast)}</strong></div>
          </div>
          <div class="stack" aria-hidden="true"><div class="bg-P" style="width:${st.cast ? (100 * st.pour) / st.cast : 0}%"></div><div class="bg-A" style="width:${st.cast ? (100 * st.abstention) / st.cast : 0}%"></div><div class="bg-C" style="width:${st.cast ? (100 * st.contre) / st.cast : 0}%"></div></div>
          <p class="small">${L("Pour", "For")} <b class="pos-P">${fmtNum(st.pour)}</b> · ${L("Contre", "Against")} <b class="pos-C">${fmtNum(st.contre)}</b> · ${L("Abstention", "Abstain")} <b class="pos-A">${fmtNum(st.abstention)}</b> · ${L(`${m.feminin ? "présente" : "présent"} à ${fmtNum(st.cast)} votes sur ${fmtNum(st.eligible)}`, `voted in ${fmtNum(st.cast)} of ${fmtNum(st.eligible)}`)}</p>
          <p class="muted tiny">${L(
            `Votes par appel nominal en séance plénière pendant son mandat. « Avec son groupe » : part de ses votes identiques à la position majoritaire des autres membres de son groupe européen (tous pays) ayant voté, quand au moins 3 ont voté et sans égalité (${fmtNum(st.group.n)} votes comparés${st.group.ni ? `, ${fmtNum(st.group.ni)} comme ${m.feminin ? "non-inscrite" : "non-inscrit"} non comptés` : ""}). « Avec les Français » : même calcul avec les autres eurodéputés français (${fmtNum(st.france.n)} votes). L’abstention compte comme une participation.`,
            `Plenary roll-call votes held during their term. “With their group”: share of their votes matching the majority position of the other members of their European group (all countries) who voted, when at least 3 voted and there was no tie (${fmtNum(st.group.n)} votes compared${st.group.ni ? `, ${fmtNum(st.group.ni)} as non-attached not counted` : ""}). “With French MEPs”: same with the other French MEPs (${fmtNum(st.france.n)} votes). Abstaining counts as taking part.`,
          )}</p>` : `<p class="muted">${L("Pas de vote par appel nominal chargé pour ce mandat.", "No roll-call vote loaded for this term.")}</p>`}
        </div>
      </div>

      ${partyRows.length ? `<article class="card">
        <header class="card-head"><h2>${L(`Avec quelles délégations françaises vote-t-${m.feminin ? "elle" : "il"} ?`, "Which French delegations do they vote with?")}</h2></header>
        <p class="muted small">${L(`Part de ses votes identiques à la position majoritaire de chaque délégation nationale française (parti), ${m.feminin ? "elle exclue" : "lui exclu"}, sur les votes où la délégation avait une position claire. Délégations comparées sur au moins 20 votes.`, "Share of their votes matching the majority position of each French national delegation (party), excluding themselves, on votes where the delegation had a clear position. Delegations compared on at least 20 votes.")}</p>
        <ul class="bars compact">${partyRows
          .map((r) => `<li><div class="bar-label"><span>${esc(partyLabel(r.p))}${r.own ? ` <span class="muted small">(${L("son parti", "own party")})</span>` : ""} <span class="muted small">${fmtNum(r.n)} ${L("votes", "votes")}</span></span><b>${pct(r.rate)}</b></div><div class="bar"><div style="width:${100 * r.rate}%;background:${r.own ? safeColor(m.groupe.couleur) : "var(--ink-3)"}"></div></div></li>`)
          .join("")}</ul>
      </article>` : ""}

      ${st?.breaks.length ? `<article class="card">
        <header class="card-head"><h2>${L("Ses votes les plus marquants contre son groupe", "Their most notable votes against their group")}</h2></header>
        <ul class="votes">${st.breaks
          .map(([vid, own, line, share, others]) => {
            const v = byId.get(vid);
            if (!v) return "";
            return `<li><div class="vote-meta muted small">${fmtDate(v[1])} · ${L(`groupe ${m.groupe.abrev}`, `${m.groupe.abrev} group`)}${colon()}${posLabel(line)} (${pct(share)} ${L(`de ${others} votants`, `of ${others} voting`)})</div>
              <div class="vote-title"><a href="${esc(rcvUrl(v[1], v[2]))}" target="_blank" rel="noopener">${esc(itemTitle(v))}</a></div>
              <div class="muted small">${esc(L(v[3], v[4] || v[3]))}</div>
              <span class="pos pos-${own} bg-${own}">${posLabel(own, m.feminin)}</span></li>`;
          })
          .join("")}</ul>
      </article>` : ""}

      <div id="pe-speech"></div>
      ${m.speeches?.notFrench ? `<p class="muted small">${L(
        `${fmtNum(m.speeches.notFrench)} intervention${m.speeches.notFrench > 1 ? "s" : ""} sur ${fmtNum(m.speeches.total)} prononcée${m.speeches.notFrench > 1 ? "s" : ""} dans une autre langue que le français (${Object.entries(m.speeches.langs).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}) ne ${m.speeches.notFrench > 1 ? "sont" : "est"} pas dans le nuage.`,
        `${fmtNum(m.speeches.notFrench)} of ${fmtNum(m.speeches.total)} speeches given in a language other than French (${Object.entries(m.speeches.langs).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}) are not in the cloud.`,
      )}</p>` : ""}

      ${vf ? `<details class="card mp-votes" open>
        <summary><h2>${L(`Ses votes, un par un (${fmtNum(rows.length)})`, `Their votes, one by one (${fmtNum(rows.length)})`)}</h2></summary>
        <div class="filters">
          <input id="vq" type="search" placeholder="${L("Rechercher dans les votes…", "Search votes…")}"/>
          <select id="vpos"><option value="">${L("Toutes positions", "All positions")}</option>${["P", "C", "A", "-"].map((k) => `<option value="${k}">${posLabel(k, m.feminin)}</option>`).join("")}</select>
          <span id="vcount" class="muted small"></span>
        </div>
        <ul class="votes" id="votes"></ul>
        <div class="pager"><button type="button" id="vprev">${L("Précédent", "Previous")}</button><span id="vpage" class="muted small"></span><button type="button" id="vnext">${L("Suivant", "Next")}</button></div>
        <p class="muted small">${L("Chaque titre renvoie au résultat officiel des votes par appel nominal de la séance (procès-verbal du Parlement européen).", "Each title links to the official roll-call results of the sitting (European Parliament minutes).")}</p>
      </details>` : ""}
      ${meta ? `<p class="muted small">${coverage(meta)}</p>` : ""}
      <p class="source">${SOURCE()}</p>
    </section>`;

  if (vf) {
    const draw = () => {
      const q = f.q.toLowerCase();
      const list = rows.filter((v) => (!f.pos || mine[v[0]] === f.pos) && (!q || `${itemTitle(v)} ${v[3]} ${v[4]}`.toLowerCase().includes(q)));
      const pages = Math.max(1, Math.ceil(list.length / PAGE));
      f.page = Math.min(f.page, pages);
      app.querySelector("#vcount")!.textContent = `${fmtNum(list.length)} ${L("votes", "votes")}`;
      app.querySelector("#vpage")!.textContent = `${f.page} / ${pages}`;
      (app.querySelector("#vprev") as HTMLButtonElement).disabled = f.page <= 1;
      (app.querySelector("#vnext") as HTMLButtonElement).disabled = f.page >= pages;
      app.querySelector("#votes")!.innerHTML = list
        .slice((f.page - 1) * PAGE, f.page * PAGE)
        .map((v) => {
          const [vid, date, item, lfr, len, o, p, c, a, frLine, gl] = v;
          const pos = mine[vid] ?? "-";
          const g = gl[m.groupe.abrev];
          return `<li>
            <div class="vote-meta muted small">${fmtDate(date)} · <span class="${o === "ADOPTED" ? "sort-ok" : "sort-ko"}">${esc(outcomeLabel(o))}</span> (${p}–${c}–${a})${g ? ` · ${esc(m.groupe.abrev)}${colon()}${posLabel(g)}` : ""}${frLine ? ` · ${L("Français", "French MEPs")}${colon()}${posLabel(frLine)}` : ""}</div>
            <div class="vote-title"><a href="${esc(rcvUrl(date, item))}" target="_blank" rel="noopener">${esc(itemTitle(v))}</a></div>
            <div class="muted small">${esc(L(lfr, len || lfr))} · <a href="${esc(rcvPdf(date))}" target="_blank" rel="noopener">PDF ↗</a></div>
            <span class="pos pos-${pos} bg-${pos}">${posLabel(pos, m.feminin)}</span>
          </li>`;
        })
        .join("");
    };
    app.querySelector<HTMLInputElement>("#vq")!.addEventListener("input", (e) => { f.q = (e.target as HTMLInputElement).value; f.page = 1; draw(); });
    app.querySelector<HTMLSelectElement>("#vpos")!.addEventListener("change", (e) => { f.pos = (e.target as HTMLSelectElement).value; f.page = 1; draw(); });
    app.querySelector("#vprev")!.addEventListener("click", () => { f.page--; draw(); });
    app.querySelector("#vnext")!.addEventListener("click", () => { f.page++; draw(); });
    draw();
  }
  void renderSpeakerSpeech(app.querySelector<HTMLElement>("#pe-speech")!, { id: m.id, civ: m.civ, prenom: m.prenom, nom: m.nom, groupe: m.groupe }, PE).catch(console.error);
}
