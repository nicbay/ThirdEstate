// Campaign programme over time: every measure of a candidate's programme across its versions
// (e.g. 2022 abridged booklet → 2025 full edition → 2027 online book), what was kept, reworded,
// added or dropped, and how the candidate's Assembly group voted on matching texts since 2024.
// Data: public/data/programmes/<slug>.json, built by scripts/build-programme.mjs. Generic over slug.
// Tone: descriptive only. Status chips use neutral ink/grey styles; colour is kept for vote positions.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, fmtPct } from "../i18n";
import { esc, safeUrl } from "../util";

type VersionId = "a22" | "e25" | "w27" | string;
type Status = "maintained" | "modified" | "new2025" | "new2027" | "dropped";
interface Measure { id: string; t: string; s: number; p?: number; k?: 1; f?: string[] }
interface Change { from: number; to: number; kinds: string[]; before: string[]; after: string[] }
interface Lineage { id: string; theme: string; status: Status; droppedIn?: number; changed?: 1; key?: 1; a?: Measure; e?: Measure; w?: Measure; changes?: Change[] }
interface Version { id: VersionId; year: number; label: { fr: string; en: string }; title: string; date: string; kind: string; url?: string; count: number; key: number; financing?: { page: number; fr: string; en: string } }
interface VoteItem { num: number; date: string; title: string; result: string; total: { P: number; C: number; A: number }; group: { P: number; C: number; A: number }; majority: "P" | "C" | "A" | null; expect: "P" | "C"; agrees: boolean | null }
interface VoteLink { lineage: string; topic: { fr: string; en: string }; note: { fr: string; en: string } | null; scrutins: VoteItem[] }
type Counts = Record<Status, number>;
interface ProgrammeFile {
  slug: string; candidate: string; party: string; programme: string; group: string; generatedAt: string;
  themes: { id: string; fr: string; en: string }[];
  versions: Version[];
  sections: Record<string, [string | null, string, string | null, string | null][]>;
  summary: { overall: Counts & { total: number; changed: number }; byTheme: Record<string, Counts> };
  highlights: { lineage: string; kind: string; fr: string; en: string }[];
  votes: VoteLink[];
  themeWeights: { programme: Record<string, Record<string, number>>; speeches: Record<string, number> | null; chamber: Record<string, number> | null; speechesPeriod: { from: string; to: string } | null; speechesCount: number | null };
  lineages: Lineage[];
}

const cache = new Map<string, Promise<ProgrammeFile>>();
const load = (slug: string) => {
  if (!cache.has(slug)) cache.set(slug, fetchJson<ProgrammeFile>(`/data/programmes/${slug}.json`));
  return cache.get(slug)!;
};

const STATUSES: Status[] = ["maintained", "modified", "new2025", "new2027", "dropped"];
const statusLabel = (s: Status, short = false): string =>
  ({
    maintained: L("Maintenue", "Kept"),
    modified: L("Modifiée", "Changed"),
    new2025: short ? L("Apparue en 2025", "Added 2025") : L("Apparue en 2025", "Added in 2025"),
    new2027: short ? L("Nouvelle en 2027", "New 2027") : L("Nouvelle en 2027", "New in 2027"),
    dropped: L("Abandonnée", "Dropped"),
  })[s];
const statusHelp = (s: Status): string =>
  ({
    maintained: L("présente en 2022 et en 2027, même engagement et mêmes chiffres", "in 2022 and 2027, same commitment and figures"),
    modified: L("présente en 2022 et en 2027, chiffre ou formulation modifiés", "in 2022 and 2027, figure or wording changed"),
    new2025: L("absente de l’abrégé 2022, présente dans l’édition 2025 et en 2027", "not in the 2022 booklet, in the 2025 edition and in 2027"),
    new2027: L("présente seulement dans le programme 2027", "only in the 2027 programme"),
    dropped: L("absente du programme 2027", "not in the 2027 programme"),
  })[s];
const POS = { P: () => L("Pour", "For"), C: () => L("Contre", "Against"), A: () => L("Abstention", "Abstain") };

/** Word-level diff (LCS) of two wordings: returns the newer one with insertions marked and the older with deletions. */
function diff(a: string, b: string): [string, string] {
  const A = a.split(/\s+/), B = b.split(/\s+/);
  if (A.length * B.length > 40000) return [esc(a), esc(b)];
  const key = (w: string) => w.toLowerCase().replace(/[.,;:!?()«»"]/g, "");
  const n = A.length, m = B.length;
  const T: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = key(A[i]) === key(B[j]) ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const outA: string[] = [], outB: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(A[i]) === key(B[j])) { outA.push(esc(A[i])); outB.push(esc(B[j])); i++; j++; }
    else if (j < m && (i >= n || T[i][j + 1] >= T[i + 1][j])) { outB.push(`<ins>${esc(B[j])}</ins>`); j++; }
    else { outA.push(`<del>${esc(A[i])}</del>`); i++; }
  }
  const join = (xs: string[], tag: string) => xs.join(" ").replace(new RegExp(`</${tag}> <${tag}>`, "g"), " ");
  return [join(outA, "del"), join(outB, "ins")];
}

interface State { q: string; theme: string; status: Status | ""; key: boolean; votes: boolean; shown: number; focus: string | null }
const state: State = { q: "", theme: "", status: "", key: false, votes: false, shown: 30, focus: null };
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export async function renderProgramme(app: HTMLElement, slug: string) {
  const f = await load(slug).catch(() => null);
  if (!f) {
    app.innerHTML = `<section class="page"><div class="page-head"><h1>${L("Programme introuvable", "Programme not found")}</h1><p class="dek">${L("Aucune analyse de programme n’est disponible pour ce candidat pour l’instant.", "No programme analysis is available for this candidate yet.")}</p></div></section>`;
    return;
  }
  const V = Object.fromEntries(f.versions.map((v) => [v.id, v])) as Record<string, Version>;
  const [va, ve, vw] = [f.versions[0], f.versions[1], f.versions[2]];
  const themeName = (id: string) => { const t = f.themes.find((x) => x.id === id); return t ? L(t.fr, t.en) : id; };
  const byId = new Map(f.lineages.map((l) => [l.id, l]));
  const votesBy = new Map(f.votes.map((v) => [v.lineage, v]));
  const o = f.summary.overall;
  const latest = (l: Lineage) => (l.w ?? l.e ?? l.a)!;
  const loc = (vid: string, m: Measure) => {
    const sec = f.sections[vid]?.[m.s];
    const where = [sec?.[0], sec?.[1], sec?.[2]].filter(Boolean).map((x) => esc(x)).join(" › ");
    const ref = sec?.[3]
      ? `<a href="${esc(safeUrl(sec[3]))}" target="_blank" rel="noopener">${L("lire en ligne", "read online")}</a>`
      : m.p ? `p. ${m.p}` : "";
    return `<span class="prog-loc">${where}${ref ? ` · ${ref}` : ""}</span>`;
  };

  const tag = (s: Status) => `<span class="prog-chip prog-${s}">${esc(statusLabel(s, true))}</span>`;
  const swatch = (s: Status) => `<i class="prog-sw prog-${s}" aria-hidden="true"></i>`;

  // ---------- stacked bars by theme ----------
  const themeRows = f.themes
    .map((t) => ({ t, c: f.summary.byTheme[t.id], n: STATUSES.reduce((s, k) => s + (f.summary.byTheme[t.id]?.[k] ?? 0), 0) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxN = Math.max(...themeRows.map((r) => r.n));
  const stack = (c: Counts, n: number, scale: number) =>
    `<div class="prog-stack" style="width:${((100 * n) / scale).toFixed(2)}%">${STATUSES.filter((s) => c[s]).map((s) => `<span class="prog-${s}" style="flex:${c[s]}" title="${esc(statusLabel(s))} : ${c[s]}"></span>`).join("")}</div>`;
  const legend = `<ul class="prog-legend">${STATUSES.map((s) => `<li>${swatch(s)}<b>${esc(statusLabel(s))}</b> <span class="muted">${fmtNum(o[s])}</span><br><span class="muted small">${esc(statusHelp(s))}</span></li>`).join("")}</ul>`;

  // ---------- programme weight vs speeches ----------
  const tw = f.themeWeights;
  const progShare = tw.programme[vw.id] ?? {};
  const weightRows = f.themes
    .map((t) => ({ t, p: progShare[t.id] ?? 0, s: tw.speeches?.[t.id] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const wMax = Math.max(...weightRows.flatMap((r) => [r.p, r.s]), 0.01);

  const voteRows = (v: VoteLink) => v.scrutins.map((s) => {
    const g = s.group, cast = g.P + g.C + g.A;
    const verdict = s.majority == null
      ? `<span class="prog-verdict prog-none">${L("Aucun vote du groupe enregistré", "No group vote recorded")}</span>`
      : s.agrees
      ? `<span class="prog-verdict prog-yes">${L("Dans le sens de la promesse", "In line with the promise")}</span>`
      : `<span class="prog-verdict prog-no">${L("Pas dans le sens de la promesse", "Not in line with the promise")}</span>`;
    return `<tr>
      <td class="nowrap">${fmtDate(s.date)}</td>
      <td><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${s.num}" target="_blank" rel="noopener">n° ${s.num}</a> · ${esc(s.title.replace(/^./, (c) => c.toUpperCase()))} <span class="muted small">(${esc(s.result)}, ${s.total.P}–${s.total.C}–${s.total.A})</span></td>
      <td class="nowrap">${cast ? `<span class="pos-P">${g.P}</span> / <span class="pos-C">${g.C}</span> / <span class="pos-A">${g.A}</span>` : "—"}${s.majority ? `<br><b class="pos-${s.majority}">${POS[s.majority]()}</b>` : ""}</td>
      <td class="nowrap">${POS[s.expect]()}</td>
      <td>${verdict}</td></tr>`;
  }).join("");
  const nVoteScrutins = f.votes.reduce((s, v) => s + v.scrutins.length, 0);
  const nAgree = f.votes.reduce((s, v) => s + v.scrutins.filter((x) => x.agrees === true).length, 0);
  const nDisagree = f.votes.reduce((s, v) => s + v.scrutins.filter((x) => x.agrees === false).length, 0);
  const nInW = f.lineages.filter((l) => l.w).length;

  app.innerHTML = `
    <section class="page prog">
      <div class="page-head">
        <p class="eyebrow">${L("Programmes 2027", "2027 programmes")} · ${esc(f.candidate)} · ${esc(f.party)}</p>
        <h1>${L(`${f.programme}, de 2022 à 2027 : ce qui reste, ce qui change`, `${f.programme} from 2022 to 2027: what stays, what changes`)}</h1>
        <p class="dek">${L(
          `${fmtNum(f.lineages.length)} engagements suivis à travers trois versions du programme : l’abrégé de 2022 (${va.count} mesures), l’édition complète de 2025 (${ve.count}) et le programme 2027 en ligne (${vw.count}). ${fmtNum(o.maintained + o.modified)} figuraient déjà dans l’abrégé de 2022, ${fmtNum(o.new2027)} n’apparaissent qu’en 2027, ${fmtNum(o.dropped)} ne figurent plus dans la version 2027.`,
          `${fmtNum(f.lineages.length)} commitments tracked across three versions of the programme: the 2022 abridged booklet (${va.count} measures), the full 2025 edition (${ve.count}) and the online 2027 programme (${vw.count}). ${fmtNum(o.maintained + o.modified)} were already in the 2022 booklet, ${fmtNum(o.new2027)} appear only in 2027, ${fmtNum(o.dropped)} are no longer in the 2027 version.`)}</p>
      </div>

      <article class="card">
        <header class="card-head"><h2>${L("Le programme, thème par thème", "The programme, theme by theme")}</h2></header>
        <div class="kpis kpis-4 prog-kpis">
          <div><strong>${fmtNum(o.maintained)}</strong>${esc(statusLabel("maintained"))}</div>
          <div><strong>${fmtNum(o.modified)}</strong>${esc(statusLabel("modified"))}</div>
          <div><strong>${fmtNum(o.new2025 + o.new2027)}</strong>${L("Ajoutées (2025 + 2027)", "Added (2025 + 2027)")}</div>
          <div><strong>${fmtNum(o.dropped)}</strong>${esc(statusLabel("dropped"))}</div>
        </div>
        ${legend}
        <div class="prog-bars" role="img" aria-label="${L("Nombre d’engagements par thème et par statut", "Commitments by theme and status")}">
          ${themeRows.map((r) => `<button type="button" class="prog-row" data-theme="${esc(r.t.id)}" title="${L("Filtrer la liste sur ce thème", "Filter the list to this theme")}">
            <span class="prog-row-label">${esc(L(r.t.fr, r.t.en))} <b>${r.n}</b></span>${stack(r.c, r.n, maxN)}</button>`).join("")}
        </div>
        <p class="muted small">${L(`Un engagement = une mesure suivie d’une version à l’autre (les mesures rapprochées par similarité de texte, puis relues). Thème : celui de la dernière version. « Apparue en 2025 » signifie absente de l’abrégé de 2022, qui ne reprend qu’une partie du programme complet de 2022.`, `One commitment = one measure followed from version to version (matched by text similarity, then reviewed). Theme: that of the latest version. ‘Added in 2025’ means absent from the 2022 booklet, which only covers part of the full 2022 programme.`)}</p>
      </article>

      <article class="card">
        <header class="card-head"><h2>${L("Les changements les plus nets", "The biggest changes")}</h2></header>
        <ol class="prog-highlights">${f.highlights.map((h) => `<li><span class="tag">${esc(({ figure: L("chiffre", "figure"), new: L("nouveau", "new"), dropped: L("retiré", "dropped"), wording: L("formulation", "wording") } as Record<string, string>)[h.kind] ?? h.kind)}</span> ${esc(L(h.fr, h.en))} <button type="button" class="linkish prog-goto" data-id="${esc(h.lineage)}">${L("voir les textes", "see the texts")}</button></li>`).join("")}</ol>
        ${va.financing ? `<p class="muted small">${L(`Chiffrage d’ensemble de 2022 (abrégé, p. ${va.financing.page}) : ${esc(va.financing.fr)}. Les éditions 2025 et 2027 étudiées ici ne donnent pas de chiffrage global équivalent.`, `Overall 2022 costing (booklet, p. ${va.financing.page}): ${esc(va.financing.en)}. The 2025 and 2027 editions studied here give no equivalent overall costing.`)}</p>` : ""}
      </article>

      <article class="card" id="mesures">
        <header class="card-head"><h2>${L("Toutes les mesures, version par version", "Every measure, version by version")}</h2></header>
        <div class="filters prog-filters">
          <input id="pq" type="search" placeholder="${L("Rechercher un mot : SMIC, retraite, nucléaire…", "Search a word: SMIC, retraite, nucléaire…")}" value="${esc(state.q)}" aria-label="${L("Rechercher dans les mesures", "Search the measures")}" />
          <select id="pt" aria-label="${L("Thème", "Theme")}"><option value="">${L("Tous les thèmes", "All themes")}</option>${themeRows.map((r) => `<option value="${esc(r.t.id)}" ${state.theme === r.t.id ? "selected" : ""}>${esc(L(r.t.fr, r.t.en))} (${r.n})</option>`).join("")}</select>
          <label class="check"><input id="pk" type="checkbox" ${state.key ? "checked" : ""}/> ${L("Mesures clés", "Key measures")}</label>
          <label class="check"><input id="pv" type="checkbox" ${state.votes ? "checked" : ""}/> ${L("Avec un vote à l’Assemblée", "With an Assembly vote")}</label>
        </div>
        <div class="prog-status" role="group" aria-label="${L("Statut", "Status")}">
          <button type="button" data-s="" aria-pressed="${state.status === ""}">${L("Tous", "All")} <span>${fmtNum(f.lineages.length)}</span></button>
          ${STATUSES.map((s) => `<button type="button" data-s="${s}" aria-pressed="${state.status === s}">${swatch(s)}${esc(statusLabel(s, true))} <span>${fmtNum(o[s])}</span></button>`).join("")}
        </div>
        <p id="pcount" class="muted small" aria-live="polite"></p>
        <ol id="plist" class="prog-list"></ol>
        <button type="button" id="pmore" class="button prog-more" hidden>${L("Afficher plus", "Show more")}</button>
      </article>

      <article class="card" id="assemblee">
        <header class="card-head"><h2>${L(`À l’Assemblée depuis 2024 : comment a voté le groupe ${esc(f.group)}`, `In the Assembly since 2024: how the ${esc(f.group)} group voted`)}</h2></header>
        <p class="prog-lede">${L(
          `${f.votes.length} engagements du programme correspondent clairement à un texte voté depuis juillet 2024 (${nVoteScrutins} scrutins publics). La position du groupe est celle de la majorité de ses députés actuels ayant voté. Elle va dans le sens de la promesse dans ${nAgree} scrutins, pas dans ${nDisagree}. Pour les ${fmtNum(nInW - f.votes.length)} autres engagements de 2027 : pas de vote correspondant identifié.`,
          `${f.votes.length} programme commitments clearly match a text voted on since July 2024 (${nVoteScrutins} public votes). The group position is that of the majority of its current MPs who voted. It is in line with the promise in ${nAgree} votes, not in ${nDisagree}. For the other ${fmtNum(nInW - f.votes.length)} 2027 commitments: no matching vote identified.`)}</p>
        <div class="prog-votes">${f.votes.map((v) => {
          const l = byId.get(v.lineage);
          const m = l ? latest(l) : null;
          return `<section class="prog-vote">
            <h3>${esc(L(v.topic.fr, v.topic.en))}</h3>
            ${m ? `<p class="prog-quote" lang="fr">« ${esc(m.t)} » <button type="button" class="linkish prog-goto" data-id="${esc(v.lineage)}">${L("voir la mesure", "see the measure")}</button></p>` : ""}
            ${v.note ? `<p class="muted small">${esc(L(v.note.fr, v.note.en))}</p>` : ""}
            <table class="table prog-vtable"><thead><tr><th>${L("Date", "Date")}</th><th>${L("Scrutin", "Vote")}</th><th title="${L("pour / contre / abstention", "for / against / abstain")}">${esc(f.group)} ${L("P/C/A", "F/A/Ab")}</th><th>${L("Sens de la promesse", "Promise implies")}</th><th></th></tr></thead><tbody>${voteRows(v)}</tbody></table>
          </section>`;
        }).join("")}</div>
      </article>

      <article class="card">
        <header class="card-head"><h2>${L("Poids dans le programme et temps de parole", "Weight in the programme vs speaking time")}</h2></header>
        <p class="prog-lede">${L(
          `Part de chaque thème parmi les ${vw.count} mesures du programme 2027, et part du même thème dans les interventions en séance des députés ${esc(f.group)}${tw.speechesPeriod ? ` (${fmtDate(tw.speechesPeriod.from)} – ${fmtDate(tw.speechesPeriod.to)}${tw.speechesCount ? `, ${fmtNum(tw.speechesCount)} interventions` : ""})` : ""}. Les deux mesures ne se comparent qu’en ordre de grandeur : une mesure n’est pas une minute de débat, et l’ordre du jour de l’Assemblée est largement fixé par le gouvernement.`,
          `Share of each theme among the ${vw.count} measures of the 2027 programme, and share of the same theme in ${esc(f.group)} MPs’ speeches in the chamber${tw.speechesPeriod ? ` (${fmtDate(tw.speechesPeriod.from)} – ${fmtDate(tw.speechesPeriod.to)}${tw.speechesCount ? `, ${fmtNum(tw.speechesCount)} speeches` : ""})` : ""}. Only orders of magnitude compare: a measure is not a minute of debate, and the Assembly’s agenda is largely set by the government.`)}</p>
        <div class="prog-weights">
          <div class="prog-wkey"><span><i class="prog-sw prog-wp"></i>${L("Programme 2027", "2027 programme")}</span><span><i class="prog-sw prog-ws"></i>${L(`Interventions ${f.group}`, `${f.group} speeches`)}</span></div>
          ${weightRows.map((r) => `<div class="prog-wrow"><span class="prog-wlabel">${esc(L(r.t.fr, r.t.en))}</span>
            <span class="prog-wbars"><span class="prog-wbar prog-wp" style="width:${((100 * r.p) / wMax).toFixed(1)}%"></span><b>${fmtPct(100 * r.p, 0)}</b>
            <span class="prog-wbar prog-ws" style="width:${((100 * r.s) / wMax).toFixed(1)}%"></span><b>${fmtPct(100 * r.s, 0)}</b></span></div>`).join("")}
        </div>
        <p class="muted small">${L("Thèmes : le même lexique de mots-clés que la page « De quoi parlent-ils ? » (17 thèmes). Une mesure reçoit le thème de sa section, sauf si son texte relève clairement d’un autre.", "Themes: the same keyword lexicon as the ‘What do they talk about?’ page (17 themes). A measure takes its section’s theme unless its text clearly belongs to another.")} <a href="#/assemblee/themes">${L("Voir les thèmes à l’Assemblée", "See themes in the Assembly")}</a></p>
      </article>

      <article class="card prose prog-method">
        <header class="card-head"><h2>${L("Sources et méthode", "Sources and method")}</h2></header>
        <ul>
          ${f.versions.map((v) => `<li><b>${esc(L(v.label.fr, v.label.en))}</b> — ${esc(v.title)} (${v.count} ${L("mesures", "measures")}, ${v.key} ${L("mesures clés", "key measures")}). ${v.url ? `<a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">${v.kind === "site" ? L("Site", "Website") : L("Adresse d’origine du PDF", "Original PDF address")}</a>${v.kind !== "site" ? L(" (redirige désormais vers le site 2027 ; copie du PDF conservée par la rédaction)", " (now redirects to the 2027 site; a copy of the PDF is kept on file)") : ""}` : ""}</li>`).join("")}
        </ul>
        <p>${L(
          "Extraction : le texte des deux PDF est découpé en puces (« • ») sous leurs chapitres et sections ; les encadrés « mesure clé » sont repérés et fusionnés avec la puce qu’ils reprennent ; les encadrés de sondages (« À savoir ») sont écartés. Le site 2027 est lu page par page (chaque chapitre de chaque partie) ; chaque mesure garde le lien de sa section. Les textes sont cités tels quels, en français.",
          "Extraction: the text of both PDFs is split into bullet points under their chapters and sections; ‘key measure’ boxes are detected and merged with the bullet they restate; poll boxes (‘À savoir’) are left out. The 2027 site is read page by page (every chapter of every part); each measure keeps the link to its section. Measures are quoted verbatim, in French.")}</p>
        <p>${L(
          "Rapprochement : chaque mesure de 2025 est associée à la mesure de 2027 la plus proche (recouvrement des mots, pondéré par leur rareté), puis chaque mesure de l’abrégé 2022 à la plus proche des deux. Les paires douteuses ont été relues une à une et confirmées ou rejetées à la main. « Modifiée » : un chiffre diffère, ou, entre 2025 et 2027, la formulation change d’au moins trois mots porteurs de sens. L’abrégé de 2022 résumant par nature, sa seule différence de formulation n’est pas comptée comme une modification.",
          "Matching: each 2025 measure is paired with the closest 2027 measure (word overlap weighted by rarity), then each 2022 booklet measure with the closest of the two. Doubtful pairs were read one by one and confirmed or rejected by hand. ‘Changed’: a figure differs or, between 2025 and 2027, the wording changes by at least three meaningful words. As the 2022 booklet summarises by design, a difference of wording alone from it does not count as a change.")}</p>
        <p>${L(
          `Votes : seuls les scrutins dont l’objet est la mesure elle-même (ou son contraire direct) sont reliés ; les amendements, dont l’intitulé ne dit pas le contenu, ne le sont pas. Position du groupe : majorité des voix exprimées par ses ${esc(f.group === "LFI-NFP" ? "députés" : "membres")} actuels (open data de l’Assemblée). Ce relevé ne juge pas les mesures.`,
          `Votes: only votes whose object is the measure itself (or its direct opposite) are linked; amendments, whose titles do not state their content, are not. Group position: majority of the votes cast by its current members (Assembly open data). This record does not judge the measures.`)}</p>
        <p class="source">${L("Analyse générée le", "Analysis generated on")} ${fmtDate(f.generatedAt)} · ${L("script", "script")} <a href="https://github.com/nicbay/projectview/blob/main/scripts/build-programme.mjs" target="_blank" rel="noopener">scripts/build-programme.mjs</a> · <a href="#/sources">${L("Toutes les sources", "All sources")}</a></p>
      </article>
    </section>`;

  // ---------- measure list ----------
  const list = app.querySelector<HTMLOListElement>("#plist")!;
  const more = app.querySelector<HTMLButtonElement>("#pmore")!;
  const countEl = app.querySelector<HTMLElement>("#pcount")!;
  const hay = new Map(f.lineages.map((l) => [l.id, fold([l.a?.t, l.e?.t, l.w?.t].filter(Boolean).join(" "))]));
  const order: Record<Status, number> = { modified: 0, new2027: 1, dropped: 2, new2025: 3, maintained: 4 };

  const col = (vid: string, year: number, m: Measure | undefined, html?: string) => `
    <div class="prog-ver${m ? "" : " prog-absent"}">
      <p class="prog-year">${year}${m?.k ? ` <span class="tag">${L("mesure clé", "key measure")}</span>` : ""}</p>
      ${m ? `<p class="prog-text" lang="fr">${html ?? esc(m.t)}</p>${loc(vid, m)}` : `<p class="prog-text muted">${L("Absente", "Absent")}</p>`}
    </div>`;
  const changeNote = (l: Lineage) => (l.changes ?? []).map((c) => {
    const bits: string[] = [];
    if (c.kinds.includes("figure")) bits.push(L(`chiffres ${c.before.join(", ")} → ${c.after.join(", ")}`, `figures ${c.before.join(", ")} → ${c.after.join(", ")}`));
    if (c.kinds.includes("figure-removed")) bits.push(L(`chiffre retiré (${c.before.join(", ")})`, `figure removed (${c.before.join(", ")})`));
    if (c.kinds.includes("figure-added")) bits.push(L(`chiffre ajouté (${c.after.join(", ")})`, `figure added (${c.after.join(", ")})`));
    if (c.kinds.includes("wording")) bits.push(L("formulation modifiée", "wording changed"));
    return `${c.from} → ${c.to}${L(" : ", ": ")}${bits.join(L(" ; ", "; "))}`;
  }).join(" · ");
  const item = (l: Lineage) => {
    // highlight differences between consecutive full versions (2025 → 2027)
    let eh: string | undefined, wh: string | undefined;
    if (l.e && l.w && l.changed) [eh, wh] = diff(l.e.t, l.w.t);
    const v = votesBy.get(l.id);
    return `<li class="prog-item" id="m-${esc(l.id)}">
      <div class="prog-item-head">${tag(l.status)}${l.status === "new2025" && l.changed ? `<span class="prog-chip prog-modified">${L("modifiée en 2027", "changed in 2027")}</span>` : ""}${l.status === "dropped" ? `<span class="muted small">${L(`absente depuis ${l.droppedIn}`, `absent since ${l.droppedIn}`)}</span>` : ""}<span class="prog-theme">${esc(themeName(l.theme))}</span></div>
      <div class="prog-vers">
        ${col(va.id, va.year, l.a)}
        ${col(ve.id, ve.year, l.e, eh)}
        ${col(vw.id, vw.year, l.w, wh)}
      </div>
      ${l.changes?.length ? `<p class="prog-change">${esc(changeNote(l))}</p>` : ""}
      <p class="prog-an">${v
        ? `${L("Assemblée", "Assembly")} : ${v.scrutins.map((s) => `<a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${s.num}" target="_blank" rel="noopener">n° ${s.num}</a> (${esc(f.group)} ${s.majority ? POS[s.majority]().toLowerCase() : "—"})`).join(", ")} · <a href="#/programmes/${esc(f.slug)}#assemblee">${L("détail", "details")}</a>`
        : `${L("Assemblée : pas de vote correspondant", "Assembly: no matching vote")}`}</p>
    </li>`;
  };
  const filtered = () => {
    if (state.focus) { const l = byId.get(state.focus); return l ? [l] : []; }
    const q = fold(state.q.trim());
    return f.lineages
      .filter((l) => (!state.theme || l.theme === state.theme) && (!state.status || l.status === state.status) && (!state.key || l.key) && (!state.votes || votesBy.has(l.id)) && (!q || hay.get(l.id)!.includes(q)))
      .sort((a, b) => (b.key ?? 0) - (a.key ?? 0) || order[a.status] - order[b.status]);
  };
  const draw = () => {
    const rows = filtered();
    list.innerHTML = rows.slice(0, state.shown).map(item).join("") || `<li class="muted">${L("Aucune mesure ne correspond.", "No measure matches.")}</li>`;
    countEl.innerHTML = state.focus
      ? `${L("Une mesure affichée.", "One measure shown.")} <button type="button" class="linkish" id="pall">${L("Revenir à toute la liste", "Back to the full list")}</button>`
      : `${fmtNum(rows.length)} ${rows.length > 1 ? L("engagements", "commitments") : L("engagement", "commitment")}${rows.length > state.shown ? L(`, ${state.shown} premiers affichés`, `, first ${state.shown} shown`) : ""}`;
    app.querySelector("#pall")?.addEventListener("click", () => { state.focus = null; draw(); });
    more.hidden = state.focus != null || rows.length <= state.shown;
  };
  const reset = () => { state.shown = 30; state.focus = null; draw(); };
  app.querySelector<HTMLInputElement>("#pq")!.addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; reset(); });
  const themeSel = app.querySelector<HTMLSelectElement>("#pt")!;
  themeSel.addEventListener("change", () => { state.theme = themeSel.value; reset(); });
  app.querySelector<HTMLInputElement>("#pk")!.addEventListener("change", (e) => { state.key = (e.target as HTMLInputElement).checked; reset(); });
  app.querySelector<HTMLInputElement>("#pv")!.addEventListener("change", (e) => { state.votes = (e.target as HTMLInputElement).checked; reset(); });
  const statusBtns = [...app.querySelectorAll<HTMLButtonElement>(".prog-status button")];
  const setStatus = (s: Status | "") => { state.status = s; statusBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === s))); reset(); };
  statusBtns.forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.s as Status | "")));
  more.addEventListener("click", () => { state.shown += 30; draw(); });
  const toList = () => app.querySelector("#mesures")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  app.querySelectorAll<HTMLButtonElement>(".prog-row").forEach((b) => b.addEventListener("click", () => { state.theme = b.dataset.theme!; themeSel.value = state.theme; reset(); toList(); }));
  app.querySelectorAll<HTMLButtonElement>(".prog-goto").forEach((b) => b.addEventListener("click", () => { state.focus = b.dataset.id!; draw(); toList(); }));
  draw();
}
