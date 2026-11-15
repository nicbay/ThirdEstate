// Programmes hub (#/programmes): every 2027 candidate's programme side by side.
// 1. the candidates, left to right, with how far each programme has got and how it changed;
// 2. theme by theme: what each one proposes on the same subject;
// 3. the cost: what the party announced against the latest independent estimate;
// 4. law and feasibility: how many measures meet a legal obstacle or are judged hard to deliver.
// Data: /data/programmes/index.json and compare.json (scripts/build-programmes-index.mjs), /data/candidates/index.json.
// Tone: descriptive only, same criteria for everyone; the detail and every source live on each candidate's page.
import { fetchJson, loadPolls } from "../data";
import { L, fmtDate, fmtNum } from "../i18n";
import { meta, registerParties, spectrumRank } from "../lib/candidates";
import { pixelIcon, type PixelIcon } from "../lib/pixel-icons";
import { esc, safeColor, safeUrl } from "../util";

type Two = { fr: string; en: string };
type Status = "maintained" | "modified" | "new" | "dropped";
type Legal = "ok" | "risk" | "unconstitutional-precedent" | "eu-law" | "constitutional-revision-needed" | "unknown";
type Feas = "high" | "medium" | "low" | null;
interface IndexEntry {
  slug: string; candidate: string; party: string; programme: string | null; lite: boolean; status: "published" | "partial" | "none";
  summary?: Two; counts?: Record<Status, number>; total: number; inLatest?: number;
  flow?: { kept: number; changed: number; drop22: number; add25: number; drop25: number; new27: number; inW: number };
  lastEstimate: { year: number; label?: Two; horizon?: Two; announced: number | null; by: string; net: number } | null;
}
interface CMeasure { id: string; theme: string; status: Status; label: Two; text: string; legal: Legal; feasibility: Feas; cost: number | null; by: string | null; broad: boolean }
interface Compare { generatedAt: string; themes: { id: string; fr: string; en: string }[]; candidates: { slug: string; lite: boolean; measures: CMeasure[] }[] }
interface CandidateCard { slug: string; name: string; pollName?: string; photo?: string; party: Two }

const THEME_ICON: Record<string, PixelIcon> = {
  securite: "shield", immigration: "globe", sante: "cross", social: "heart", education: "book", travail: "briefcase", economie: "chart", budget: "coin",
  ecologie: "leaf", agriculture: "wheat", logement: "home", international: "flag", justice: "scales", europe: "star", institutions: "parliament", outremer: "island", culture: "note",
};
const SERIOUS: Legal[] = ["unconstitutional-precedent", "eu-law", "constitutional-revision-needed"];
const md = (v: number) => { const sg = v > 0 ? "+" : v < 0 ? "−" : ""; const a = Math.abs(v); return L(`${sg}${fmtNum(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10)} Md€`, `${sg}€${fmtNum(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10)}bn`); };
const legalShort = (l: Legal) => ({
  ok: "", unknown: "", risk: L("Risque juridique", "Legal risk"), "unconstitutional-precedent": L("Censure probable", "Likely struck down"),
  "eu-law": L("Contraire au droit de l’UE", "Conflicts with EU law"), "constitutional-revision-needed": L("Révision de la Constitution", "Needs constitutional change"),
})[l];
const statusLabel = (s: Status) => ({ maintained: L("Gardée", "Kept"), modified: L("Modifiée", "Changed"), new: L("Nouvelle", "New"), dropped: L("Abandonnée", "Dropped") })[s];
const STATUS_TXT = { published: () => L("Programme publié", "Program published"), partial: () => L("Annonces partielles", "Partial announcements"), none: () => L("Pas encore publié", "Not yet published") };

let theme = "";

export async function renderProgrammesHub(app: HTMLElement, wanted?: string) {
  const [idx, cmp, cands, polls] = await Promise.all([
    fetchJson<{ generatedAt: string; programmes: IndexEntry[] }>("/data/programmes/index.json"),
    fetchJson<Compare>("/data/programmes/compare.json"),
    fetchJson<{ candidates: CandidateCard[] }>("/data/candidates/index.json").catch(() => ({ candidates: [] as CandidateCard[] })),
    loadPolls("2027").catch(() => null),
  ]);
  if (polls) registerParties(polls.parties);
  const card = new Map(cands.candidates.map((c) => [c.slug, c]));
  const measures = new Map(cmp.candidates.map((c) => [c.slug, c.measures]));
  // left → right, the order of the hemicycle: the same order everywhere on the page
  const rows = idx.programmes
    .map((p) => { const name = card.get(p.slug)?.pollName ?? p.candidate; const m = meta(name); return { p, c: card.get(p.slug), color: safeColor(m.color) ?? "#9aa0aa", rank: spectrumRank(name), ms: measures.get(p.slug) ?? [], surname: m.surname }; })
    .sort((a, b) => a.rank - b.rank);
  const live = (ms: CMeasure[]) => ms.filter((m) => m.status !== "dropped");
  const all = rows.flatMap((r) => live(r.ms));
  const nObstacle = all.filter((m) => SERIOUS.includes(m.legal)).length;
  const nCosted = all.filter((m) => m.cost != null).length;
  const themes = cmp.themes.map((t) => ({ ...t, n: all.filter((m) => m.theme === t.id).length, who: rows.filter((r) => live(r.ms).some((m) => m.theme === t.id)).length })).filter((t) => t.n).sort((a, b) => b.who - a.who || b.n - a.n);
  if (wanted && themes.some((t) => t.id === wanted)) theme = wanted;
  if (!themes.some((t) => t.id === theme)) theme = themes.find((t) => t.id === "travail")?.id ?? themes[0]?.id ?? "";
  const nPub = rows.filter((r) => r.p.status === "published").length;
  const maxN = Math.max(...rows.map((r) => live(r.ms).length)), minN = Math.min(...rows.map((r) => live(r.ms).length));

  // ---------- candidates ----------
  const stack = (p: IndexEntry) => {
    const c = p.counts ?? (p.flow ? { maintained: p.flow.kept, modified: p.flow.changed, new: p.flow.add25 + p.flow.new27, dropped: p.flow.drop22 + p.flow.drop25 } : null);
    if (!c) return "";
    const tot = c.maintained + c.modified + c.new + c.dropped || 1;
    const seg = (k: Status, cls: string) => (c[k] ? `<span class="prog-${cls}" style="flex:${c[k]}" data-tip="${esc(`${statusLabel(k)}
${fmtNum(c[k])} (${Math.round((100 * c[k]) / tot)} %)`)}"></span>` : "");
    return `<span class="ph-flow"><span class="ph-stack prog-stack">${seg("maintained", "maintained")}${seg("modified", "modified")}${seg("new", "new2027")}${seg("dropped", "dropped")}</span>
      <span class="ph-stack-k">${fmtNum(c.maintained)} ${L("gardées", "kept")} · ${fmtNum(c.modified)} ${L("modifiées", "changed")} · ${fmtNum(c.new)} ${L("nouvelles", "new")} · ${fmtNum(c.dropped)} ${L("abandonnées", "dropped")}</span></span>`;
  };
  // cost: two short boxed lines (what the party says, what an independent institute estimates) and a link to the
  // detail; the row itself is a link, so the detail link is a span that navigates on click
  const costCell = (p: IndexEntry) => {
    const e = p.lastEstimate;
    if (!e) return `<span class="ph-cost"><span class="ph-cbox is-none"><span class="ph-ck">${L("Estimation", "Estimate")}</span><span>${L("aucune pour l’instant", "none yet")}</span></span></span>`;
    const line = (k: string, v: string, title = "") => `<span class="ph-cbox"${title ? ` title="${esc(title)}"` : ""}><span class="ph-ck">${k}</span>${v}</span>`;
    return `<span class="ph-cost">
        ${line(L("Parti", "Party"), e.announced != null ? `<b>${md(e.announced)}</b>` : `<span class="ph-cnone">${L("non chiffré", "not costed")}</span>`)}
        ${line(L("Estimation", "Estimate"), `<b class="${e.net < 0 ? "is-neg" : "is-pos"}">${md(e.net)}</b>`, e.by)}
        <span class="ph-ccta" role="link" tabindex="-1" data-href="#/programmes/${esc(p.slug)}#cout">${esc(e.by)}, ${e.year} →</span>
      </span>`;
  };
  // one row per candidate, left to right; the whole row is the link
  const candRow = (r: (typeof rows)[number]) => {
    const { p, c } = r, e = p.lastEstimate;
    return `<li style="--c:${r.color}"><a class="ph-row" href="#/programmes/${esc(p.slug)}">
      <i class="ph-mark" aria-hidden="true"></i>
      <span class="ph-who">${c?.photo ? `<img src="${esc(safeUrl(c.photo))}" alt="" loading="lazy" width="40" height="40" data-hide-broken>` : `<span class="ph-noimg"></span>`}
        <b>${esc(p.candidate)}</b><span>${esc(c ? L(c.party.fr, c.party.en) : p.party)}</span>
        <span class="ph-status${p.status === "published" ? " is-out" : ""}">${p.lite ? esc(STATUS_TXT[p.status]()) : L("Analysé en entier", "Analysed in full")}</span></span>
      <span class="ph-n"><strong>${fmtNum(p.inLatest ?? p.total)}</strong>${p.lite ? L("mesures étudiées", "measures reviewed") : L("mesures en 2027", "measures in 2027")}</span>
      ${stack(p)}
      ${costCell(p)}
    </a></li>`;
  };

  // ---------- cost ----------
  const costed = rows.filter((r) => r.p.lastEstimate);
  const vals = costed.flatMap((r) => [r.p.lastEstimate!.net, r.p.lastEstimate!.announced ?? 0]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  const pos = (v: number) => (100 * (v - lo)) / span;
  const bar = (v: number, kind: string) => { const a = pos(Math.min(0, v)), b = pos(Math.max(0, v)); return `<i class="ph-cbar is-${kind}${v < 0 ? " is-neg" : ""}" style="left:${a.toFixed(2)}%;width:${Math.max(0.5, b - a).toFixed(2)}%"></i>`; };
  const costRows = costed.map((r, i) => {
    const e = r.p.lastEstimate!;
    return `<a class="ph-crow" href="#/programmes/${esc(r.p.slug)}#cout" style="--c:${r.color};--i:${i}">
      <span class="ph-cwho"><b>${esc(r.p.candidate)}</b><span>${esc(e.label ? L(e.label.fr, e.label.en) : String(e.year))}</span></span>
      <span class="ph-ctrack"><i class="ph-czero" style="left:${pos(0).toFixed(2)}%"></i>${e.announced != null ? bar(e.announced, "ann") : ""}${bar(e.net, "est")}</span>
      <span class="ph-cval">${e.announced != null ? `<span>${L("annoncé", "claimed")} <b>${md(e.announced)}</b></span>` : `<span class="muted">${L("pas de chiffrage du parti", "no party costing")}</span>`}<span>${esc(e.by)} <b class="${e.net < 0 ? "is-neg" : "is-pos"}">${md(e.net)}</b></span></span>
    </a>`;
  }).join("");
  const uncosted = rows.filter((r) => !r.p.lastEstimate);

  // ---------- law and feasibility ----------
  const share = (n: number, tot: number) => (tot ? (100 * n) / tot : 0);
  const lawRows = rows.map((r, i) => {
    const ms = live(r.ms), n = ms.length || 1;
    const lg = { ok: ms.filter((m) => m.legal === "ok").length, risk: ms.filter((m) => m.legal === "risk").length, serious: ms.filter((m) => SERIOUS.includes(m.legal)).length, unknown: ms.filter((m) => m.legal === "unknown").length };
    const fs = { high: ms.filter((m) => m.feasibility === "high").length, medium: ms.filter((m) => m.feasibility === "medium").length, low: ms.filter((m) => m.feasibility === "low").length, na: ms.filter((m) => !m.feasibility).length };
    // each segment opens the candidate's measures of that kind, with the reason and its sources
    const seg = (cls: string, k: number, label: string) => (k ? `<a class="${cls}" style="flex:${k}" href="#/programmes/${esc(r.p.slug)}#eval-${cls}" aria-label="${esc(`${label} : ${k}`)}" data-tip="${esc(`${label}\n${k} ${L("mesures", "measures")} (${Math.round(share(k, n))} %)\n${L("Cliquer : lesquelles et pourquoi", "Click: which ones and why")}`)}"></a>` : "");
    return `<tr style="--i:${i}">
      <th scope="row"><a href="#/programmes/${esc(r.p.slug)}#evaluation"><i class="dot" style="background:${r.color}"></i>${esc(r.p.candidate)}</a></th>
      <td class="num">${ms.length}</td>
      <td><span class="ph-lstack">${seg("l-ok", lg.ok, L("Pas d’obstacle identifié", "No obstacle found"))}${seg("l-risk", lg.risk, L("Risque juridique", "Legal risk"))}${seg("l-serious", lg.serious, L("Obstacle sérieux : censure probable, droit de l’UE ou révision de la Constitution", "Serious obstacle: likely struck down, EU law, or constitutional change"))}${seg("l-na", lg.unknown, L("Non évalué", "Not assessed"))}</span><span class="ph-lnum"><b>${lg.serious}</b> ${L("obstacles sérieux", "serious obstacles")}</span></td>
      <td><span class="ph-lstack">${seg("f-high", fs.high, L("Réalisable", "Feasible"))}${seg("f-medium", fs.medium, L("Difficile", "Difficult"))}${seg("f-low", fs.low, L("Peu réalisable", "Hard to deliver"))}${seg("l-na", fs.na, L("Non évalué", "Not assessed"))}</span><span class="ph-lnum"><b>${fs.low}</b> ${L("peu réalisables", "hard to deliver")}</span></td>
    </tr>`;
  }).join("");

  app.innerHTML = `
    <section class="page prog ph">
      <div class="page-head">
        <p class="eyebrow">${L("Présidentielle 2027 · Programmes", "2027 presidential · Programs")}</p>
        <h1>${L("Les programmes 2027, mesure par mesure", "The 2027 programs, measure by measure")}</h1>
        <p class="dek">${L(
          `Ce que proposent les ${rows.length} candidats testés dans les sondages, sur les mêmes sujets et avec la même grille : ce qui a changé depuis leur dernière campagne, ce que ça coûte selon eux et selon les instituts indépendants, ce que la Constitution et le droit européen permettent.`,
          `What the ${rows.length} candidates tested in the polls propose, on the same subjects and by the same yardstick: what changed since their last campaign, what it costs according to them and to independent institutes, and what the Constitution and EU law allow.`)}</p>
        <p class="dek ph-tally">${L(
          `En tout, <b>${rows.length}</b> candidats et <b>${fmtNum(all.length)}</b> mesures mises côte à côte, dont <b>${fmtNum(nCosted)}</b> chiffrées et <b>${fmtNum(nObstacle)}</b> qui se heurtent à un obstacle juridique sérieux.`,
          `In all, <b>${rows.length}</b> candidates and <b>${fmtNum(all.length)}</b> measures side by side, <b>${fmtNum(nCosted)}</b> of them costed and <b>${fmtNum(nObstacle)}</b> facing a serious legal obstacle.`)}</p>
        <nav class="prog-jump" aria-label="${L("Sur cette page", "On this page")}">
          <a href="#/programmes#candidats">${L("Les candidats", "The candidates")}</a>
          <a href="#/programmes#comparer">${L("Comparer par thème", "Compare by theme")}</a>
          <a href="#/programmes#couts">${L("Ce que ça coûte", "What it costs")}</a>
          <a href="#/programmes#droit">${L("Droit et faisabilité", "Law and feasibility")}</a>
          <a href="#/programmes#methode">${L("Méthode", "Method")}</a>
        </nav>
      </div>

      <article class="card" id="candidats">
        <header class="card-head"><h2>${L(`${rows.length} programmes, de la gauche à la droite`, `${rows.length} programs, from left to right`)}</h2></header>
        <p class="prog-lede">${L(`${nPub} sur ${rows.length} ont publié un programme complet ; les autres avancent par annonces, que nous relevons au fil de la campagne. La barre montre ce que chaque programme a gardé, modifié, ajouté ou abandonné depuis la campagne précédente.`, `${nPub} of ${rows.length} have published a full program; the others are moving by announcements, which we log as the campaign goes on. The bar shows what each program kept, changed, added or dropped since the previous campaign.`)}</p>
        <div class="ph-axis" aria-hidden="true"><span>${L("Gauche", "Left")}</span><i></i><span>${L("Droite", "Right")}</span></div>
        <ol class="ph-rows">
          <li class="ph-rows-head" aria-hidden="true"><span>${L("Candidat", "Candidate")}</span><span>${L("Mesures", "Measures")}</span><span>${L("Depuis la campagne précédente", "Since the previous campaign")}</span><span>${L("Coût, dernière estimation", "Cost, latest estimate")}</span></li>
          ${rows.map(candRow).join("")}</ol>
        <ul class="prog-legend ph-legend">
          <li><i class="prog-sw prog-maintained"></i><b>${L("Gardées", "Kept")}</b></li><li><i class="prog-sw prog-modified"></i><b>${L("Modifiées", "Changed")}</b></li>
          <li><i class="prog-sw prog-new2027"></i><b>${L("Nouvelles", "New")}</b></li><li><i class="prog-sw prog-dropped"></i><b>${L("Abandonnées", "Dropped")}</b></li>
        </ul>
        <a class="ph-sim" href="#/programmes/melenchon/simulateur"><span class="px-tag">${L("Simulateur", "Simulator")}</span><strong>${L("Le programme de Mélenchon vous coûterait-il ou vous rapporterait-il ?", "Would Mélenchon’s program cost you or pay you?")}</strong><span>${L("Revenus, enfants, logement, patrimoine : l’effet estimé sur votre foyer, mesure par mesure.", "Income, children, housing, wealth: the estimated effect on your household, measure by measure.")} <i aria-hidden="true">→</i></span></a>
      </article>

      <article class="card" id="comparer">
        <header class="card-head"><h2>${L("Sur le même sujet, qui propose quoi", "On the same subject, who proposes what")}</h2></header>
        <p class="prog-lede">${L("Choisissez un thème : les mesures de chaque candidat s’alignent de gauche à droite. Ouvrez une mesure pour lire son texte ; son évaluation complète et ses sources sont sur la page du candidat.", "Pick a theme: each candidate’s measures line up from left to right. Open a measure to read its wording; its full assessment and sources are on the candidate’s page.")}</p>
        <div class="ph-themes" role="tablist" aria-label="${L("Thèmes", "Themes")}">${themes.map((t) => `<button type="button" role="tab" data-theme="${esc(t.id)}" aria-selected="${t.id === theme}">${pixelIcon(THEME_ICON[t.id] ?? "ballot", 12)}<span>${esc(L(t.fr, t.en))}</span><b>${t.n}</b></button>`).join("")}</div>
        <div id="ph-theme" class="ph-theme" aria-live="polite"></div>
      </article>

      <article class="card" id="couts">
        <header class="card-head"><h2>${L("Ce que ça coûte : l’annonce et l’estimation", "What it costs: the claim and the estimate")}</h2></header>
        <p class="prog-lede">${L("Solde pour les finances publiques, en milliards d’euros par an, du dernier programme que quelqu’un d’indépendant a chiffré. À gauche du zéro, le programme creuse le déficit ; à droite, il le réduit. Le trait fin est le chiffre du parti, la barre pleine celui de l’institut.", "Balance for public finances, in € billions a year, of the latest program someone independent has costed. Left of zero the program widens the deficit; right of zero it narrows it. The thin line is the party’s figure, the solid bar the institute’s.")}</p>
        <div class="ph-costs reveal-on">${costRows}</div>
        <p class="muted small">${L(
          `Ces chiffrages ne portent pas tous sur la même élection : la ligne sous chaque nom dit laquelle. Les programmes de 2024 étaient ceux de coalitions (Nouveau Front populaire, Ensemble), d’où des chiffres identiques pour leurs membres. Aucun programme 2027 n’a encore été chiffré par un institut indépendant.${uncosted.length ? ` Pas d’estimation indépendante disponible pour ${uncosted.map((r) => r.p.candidate).join(", ")}.` : ""}`,
          `These costings are not all for the same election: the line under each name says which. The 2024 programs were coalition platforms (New Popular Front, Ensemble), hence identical figures for their members. No 2027 program has been costed by an independent institute yet.${uncosted.length ? ` No independent estimate available for ${uncosted.map((r) => r.p.candidate).join(", ")}.` : ""}`)}</p>
      </article>

      <article class="card" id="droit">
        <header class="card-head"><h2>${L("Droit et faisabilité : ce qui peut bloquer", "Law and feasibility: what could stand in the way")}</h2></header>
        <p class="prog-lede">${L("Pour chaque mesure, deux questions posées de la même façon à tous : se heurte-t-elle à la Constitution ou au droit européen, et peut-elle être mise en œuvre avec la majorité, le calendrier et l’argent disponibles ?", "For every measure, two questions asked the same way of everyone: does it run into the Constitution or EU law, and can it be delivered with the majority, the calendar and the money available?")}</p>
        <table class="table ph-law"><thead><tr><th>${L("Candidat", "Candidate")}</th><th class="num">${L("Mesures", "Measures")}</th><th>${L("Constitution, droit européen", "Constitution, EU law")}</th><th>${L("Faisabilité", "Feasibility")}</th></tr></thead><tbody>${lawRows}</tbody></table>
        <ul class="ph-key">
          <li><i class="l-ok"></i>${L("Pas d’obstacle", "No obstacle")}</li><li><i class="l-risk"></i>${L("Risque", "Risk")}</li><li><i class="l-serious"></i>${L("Obstacle sérieux", "Serious obstacle")}</li>
          <li><i class="f-high"></i>${L("Réalisable", "Feasible")}</li><li><i class="f-medium"></i>${L("Difficile", "Difficult")}</li><li><i class="f-low"></i>${L("Peu réalisable", "Hard to deliver")}</li><li><i class="l-na"></i>${L("Non évalué", "Not assessed")}</li>
        </ul>
        <p class="muted small">${L(`Les programmes ne sont pas relevés avec la même profondeur (de ${minN} à ${maxN} mesures selon ce que le candidat a publié) : comparez les proportions, pas les totaux. Un obstacle juridique n’est pas un jugement sur la mesure ; il dit quelle procédure elle suppose.`, `The programs are not logged to the same depth (from ${minN} to ${maxN} measures depending on what the candidate has published): compare proportions, not totals. A legal obstacle is not a verdict on the measure; it says what procedure it would take.`)}</p>
      </article>

      <article class="card prose prog-method" id="methode">
        <header class="card-head"><h2>${L("Méthode", "Method")}</h2></header>
        <p>${L("Chaque mesure est citée depuis le document du candidat ou, à défaut, depuis un compte rendu de presse daté ; chacune a ses sources sur la page du candidat. Le statut compare la version la plus ancienne et la plus récente du programme. Les coûts repris sont ceux de l’Institut Montaigne et de la Fondation iFRAP quand ils existent ; sinon l’estimation de la rédaction est donnée avec son calcul.", "Every measure is quoted from the candidate’s document or, failing that, from a dated press report; each has its sources on the candidate’s page. The status compares the oldest and newest versions of the program. Costs are Institut Montaigne’s and Fondation iFRAP’s where they exist; otherwise our own estimate is given with its calculation.")}</p>
        <p>${L("La lecture juridique s’appuie sur les décisions du Conseil constitutionnel et les textes européens cités mesure par mesure. La faisabilité tient compte de la majorité nécessaire, du calendrier et du financement. Ce relevé décrit ; il ne note pas les candidats et ne dit pas pour qui voter.", "The legal reading rests on Conseil constitutionnel decisions and the EU texts cited measure by measure. Feasibility weighs the majority needed, the calendar and the funding. This record describes; it does not grade the candidates or say who to vote for.")}</p>
        <p class="source">${L("Relevé mis à jour le", "Record updated on")} ${fmtDate(cmp.generatedAt)} · <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>
      </article>
    </section>`;

  // ---------- theme comparison ----------
  const box = app.querySelector<HTMLElement>("#ph-theme")!;
  const tabs = [...app.querySelectorAll<HTMLButtonElement>(".ph-themes button")];
  const CAP = 5;
  const drawTheme = () => {
    const withM = rows.map((r) => ({ r, ms: r.ms.filter((m) => m.theme === theme).sort((a, b) => Number(a.status === "dropped") - Number(b.status === "dropped") || Math.abs(b.cost ?? 0) - Math.abs(a.cost ?? 0)) }));
    const has = withM.filter((x) => x.ms.length), none = withM.filter((x) => !x.ms.length);
    box.innerHTML = `<div class="ph-cols">${has.map(({ r, ms }, i) => `<section class="ph-col" style="--c:${r.color};--i:${i}">
        <h3><a href="#/programmes/${esc(r.p.slug)}">${esc(r.p.candidate)}</a><span>${esc(r.c ? L(r.c.party.fr, r.c.party.en) : r.p.party)}</span></h3>
        <ul>${ms.slice(0, CAP).map((m) => {
          const flags = [
            m.status === "dropped" ? `<span class="prog-chip prog-dropped">${L("Abandonnée", "Dropped")}</span>` : m.status === "new" ? `<span class="prog-chip prog-new2027">${L("Nouvelle", "New")}</span>` : m.status === "modified" ? `<span class="prog-chip prog-modified">${L("Modifiée", "Changed")}</span>` : "",
            m.cost != null ? `<span class="ph-flag ${m.cost < 0 ? "is-neg" : "is-pos"}">${md(m.cost)}${L(" / an", " / yr")}</span>` : "",
            legalShort(m.legal) ? `<span class="ph-flag ${SERIOUS.includes(m.legal) ? "is-serious" : "is-risk"}">${esc(legalShort(m.legal))}</span>` : "",
            m.feasibility === "low" ? `<span class="ph-flag is-low">${L("Peu réalisable", "Hard to deliver")}</span>` : "",
          ].join("");
          return `<li class="${m.status === "dropped" ? "is-dropped" : ""}"><details><summary><span class="ph-m">${esc(L(m.label.fr, m.label.en))}</span>${flags ? `<span class="ph-flags">${flags}</span>` : ""}</summary>
            <p lang="fr">« ${esc(m.text)} »</p><a href="#/programmes/${esc(r.p.slug)}#m-${esc(m.id)}">${L("Évaluation et sources", "Assessment and sources")} →</a></details></li>`;
        }).join("")}</ul>
        ${ms.length > CAP ? `<a class="ph-more" href="#/programmes/${esc(r.p.slug)}#mesures">${L(`+ ${ms.length - CAP} autres mesures`, `+ ${ms.length - CAP} more measures`)} →</a>` : ""}
      </section>`).join("")}</div>
      ${none.length ? `<p class="muted small ph-none">${L("Rien de relevé sur ce thème pour", "Nothing logged on this theme for")} ${none.map((x) => `<a href="#/programmes/${esc(x.r.p.slug)}">${esc(x.r.p.candidate)}</a>`).join(", ")}.</p>` : ""}`;
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.theme === theme)));
  };
  tabs.forEach((b) => b.addEventListener("click", () => { theme = b.dataset.theme!; drawTheme(); }));
  // the cost cell's link inside the row's link: straight to the costing section
  app.querySelectorAll<HTMLElement>(".ph-ccta").forEach((x) => x.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); location.hash = x.dataset.href!; }));
  drawTheme();
}
