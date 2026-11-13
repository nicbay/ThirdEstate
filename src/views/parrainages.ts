// Sponsorship tracker (#/2027/parrainages): who has the 500 sponsorships ("parrainages") from elected officials
// needed to stand for president. Before the collection window opens: the expected calendar and the 2022 race as
// a reference. While it is open: candidates ranked by validated sponsorships, with the 30-department rule.
// Data: /data/2027/parrainages.json and /data/2027/parrainages-2022.json, written by scripts/sync-parrainages.mjs
// from the Conseil constitutionnel's open data (see docs/data-parrainages.md).
import "../styles/parrainages.css";
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, fmtPct, getLang, plural } from "../i18n";
import { esc, safeUrl } from "../util";

interface Candidate {
  name: string;
  displayName: string;
  total: number;
  departments: number;
  topDepartment: { name: string; count: number; share: number };
  rule: { reached500: boolean; departments30: boolean; share10: boolean };
  qualifiedOnPublishedData: boolean;
  reached500On: string | null;
  byDate: [string, number][];
  byMandate: Record<string, number>;
  byDepartment: Record<string, number>;
}
interface Window2027 {
  firstRound: string; secondRound: string; roundsDecided: string; opens: string | null;
  opensExpected: { fr: string; en: string }; deadline: string; listBy: string;
}
interface Window2022 { opened: string; deadline: string; list: string; firstRound: string }
interface FileBase {
  year: number; status: "open" | "not-open" | "final"; fetchedAt: string; updatedAt: string | null;
  source: { name: string; url: string | null; dataset?: string | null };
  rules: { threshold: number; minDepartments: number; maxShare: number };
  totals?: { sponsorships: number; candidates: number; reached500: number; qualifiedOnPublishedData: number };
  publications?: string[];
  candidates: Candidate[];
}
type File2027 = FileBase & { window: Window2027 };
type File2022 = FileBase & { window: Window2022 };
interface Index { candidates: { slug: string; name: string; pollName?: string }[] }

const THRESHOLD = 500;
const DAY = 86_400_000;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const longDate = (iso: string) => new Date(iso).toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

// Mandate groups for the stacked bar (keys written by the sync script)
const GROUPS: { keys: string[]; fr: string; en: string; cls: string }[] = [
  { keys: ["maire", "maire-delegue", "maire-arrondissement"], fr: "Maires", en: "Mayors", cls: "g-maire" },
  { keys: ["conseiller-departemental", "conseiller-regional", "conseiller-paris", "conseiller-metropole-lyon", "assemblee-corse", "outre-mer", "president-epci"], fr: "Élus départementaux, régionaux et territoriaux", en: "Departmental, regional and territorial councillors", cls: "g-local" },
  { keys: ["depute", "senateur", "depute-europeen"], fr: "Parlementaires (députés, sénateurs, eurodéputés)", en: "Members of Parliament (MPs, senators, MEPs)", cls: "g-parl" },
];
const groupCounts = (c: Candidate) => {
  const counts = GROUPS.map((g) => g.keys.reduce((s, k) => s + (c.byMandate[k] ?? 0), 0));
  return [...counts, c.total - counts.reduce((a, b) => a + b, 0)];
};
const GROUP_LABELS = () => [...GROUPS.map((g) => ({ label: L(g.fr, g.en), cls: g.cls })), { label: L("Autres (Français de l’étranger…)", "Others (French abroad…)"), cls: "g-other" }];

export async function renderParrainages(app: HTMLElement) {
  app.innerHTML = `<section class="page pg"><p class="muted">${L("Chargement…", "Loading…")}</p></section>`;
  const [cur, ref, index] = await Promise.all([
    fetchJson<File2027>("/data/2027/parrainages.json").catch(() => null),
    fetchJson<File2022>("/data/2027/parrainages-2022.json").catch(() => null),
    fetchJson<Index>("/data/candidates/index.json").catch(() => null),
  ]);

  // published names ("LE PEN Marine") → the site's candidate pages, when the person has one
  const slugs = new Map<string, string>();
  for (const c of index?.candidates ?? []) for (const n of [c.name, c.pollName]) if (n) slugs.set(fold(n), c.slug);
  const who = (c: Candidate) => {
    const slug = slugs.get(fold(c.displayName));
    return slug ? `<a href="#/candidat/${esc(slug)}">${esc(c.displayName)}</a>` : esc(c.displayName);
  };

  const open = cur?.status === "open" && cur.candidates.length > 0;
  const rule = `<p class="dek">${L(
    "Pour être candidat à l’élection présidentielle, il faut recueillir au moins 500 parrainages d’élus (maires, parlementaires, conseillers départementaux et régionaux…), chacun ne pouvant en donner qu’un. Ces élus doivent venir d’au moins 30 départements ou collectivités d’outre-mer, sans que plus d’un dixième d’entre eux soient élus d’un même département.",
    "To stand for president, a candidate needs at least 500 sponsorships from elected officials (mayors, members of parliament, departmental and regional councillors…), each of whom can sponsor only one candidate. They must come from at least 30 departments or overseas collectivities, with no more than a tenth of them elected in any single department.",
  )}</p>`;

  const body = open ? openView(cur!, who) : notOpenView(cur);
  app.innerHTML = `<section class="page pg">
    <div class="page-head">
      <p class="eyebrow">${L("Présidentielle 2027", "2027 presidential election")}</p>
      <h1>${open ? L("Qui a ses 500 parrainages ?", "Who has their 500 sponsorships?") : L("Les 500 parrainages : la course avant la course", "The 500 sponsorships: the race before the race")}</h1>
      ${rule}
    </div>
    ${body}
    ${ref ? referenceView(ref, who, open) : `<p class="muted small">${L("La référence de 2022 n’a pas pu être chargée.", "The 2022 reference could not be loaded.")}</p>`}
    <p class="muted small pg-src">${L("Source : Conseil constitutionnel, liste des parrainages validés publiée en données ouvertes", "Source: Conseil constitutionnel, list of validated sponsorships published as open data")}${ref?.source.url ? ` (<a href="${esc(safeUrl(ref.source.url))}" rel="noopener" target="_blank">2022</a>${ref.source.dataset ? `, <a href="${esc(safeUrl(ref.source.dataset))}" rel="noopener" target="_blank">data.gouv.fr</a>` : ""})` : ""}${open && cur!.source.url ? ` · <a href="${esc(safeUrl(cur!.source.url))}" rel="noopener" target="_blank">${L("fichier 2027", "2027 file")}</a>` : ""}. ${L("Le respect de la règle des 30 départements est calculé ici sur les parrainages publiés, à titre indicatif : seule la liste des candidats arrêtée par le Conseil fait foi.", "The 30-department check is computed here from the published sponsorships, as an indication: only the list of candidates decided by the Conseil is authoritative.")}${cur?.fetchedAt ? ` ${L("Dernière vérification", "Last checked")} ${esc(fmtDate(cur.fetchedAt))}.` : ""}</p>
  </section>`;

  for (const btn of app.querySelectorAll<HTMLButtonElement>("[data-pg-more]")) {
    btn.addEventListener("click", () => {
      const list = app.querySelector<HTMLElement>(`#${btn.dataset.pgMore}`);
      if (!list) return;
      const shown = list.classList.toggle("is-all");
      btn.setAttribute("aria-expanded", String(shown));
      btn.textContent = shown ? L("Réduire", "Show fewer") : btn.dataset.label!;
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Bars against the 500 line. The scale stops at 1,000 so the threshold stays readable; longer bars are cut
// and carry their number.
// ---------------------------------------------------------------------------------------------------------
function bars(id: string, list: Candidate[], who: (c: Candidate) => string, opts: { minDeps: number; maxShare: number; extra?: (c: Candidate) => string; visible?: number }) {
  const top = Math.max(...list.map((c) => c.total), THRESHOLD);
  const max = top > 1000 ? 1000 : Math.ceil((top * 1.08) / 50) * 50;
  const at = (n: number) => Math.min(100, (100 * n) / max);
  const visible = opts.visible ?? list.length;
  const row = (c: Candidate, i: number) => {
    const g = groupCounts(c);
    const deps = c.departments >= opts.minDeps, share = c.topDepartment.share <= opts.maxShare;
    const cut = c.total > max;
    return `<li class="pg-row${c.total >= THRESHOLD ? " is-in" : ""}${i >= visible ? " pg-extra" : ""}">
      <div class="pg-who"><span class="pg-rank">${i + 1}</span><span class="pg-name">${who(c)}</span></div>
      <div class="pg-track" role="img" aria-label="${esc(`${c.displayName}, ${fmtNum(c.total)} ${L("parrainages", "sponsorships")}`)}">
        <span class="pg-bar${cut ? " is-cut" : ""}" style="width:${at(c.total).toFixed(2)}%">${g.map((n, k) => (n ? `<i class="${GROUP_LABELS()[k].cls}" style="flex:${n}"></i>` : "")).join("")}</span>
        <span class="pg-line" style="left:${at(THRESHOLD).toFixed(2)}%" aria-hidden="true"></span>
      </div>
      <div class="pg-val"><b>${fmtNum(c.total)}</b></div>
      <div class="pg-meta small">
        <span class="pg-check ${deps ? "ok" : "ko"}" title="${L("Départements différents parmi les parrains", "Distinct departments among sponsors")}">${deps ? "✓" : "✗"} ${fmtNum(c.departments)} ${plural(c.departments, ["département", "départements"], ["department", "departments"])}</span>
        <span class="pg-check ${share ? "ok" : "ko"}" title="${esc(L(`Département le plus représenté : ${c.topDepartment.name}`, `Most represented department: ${c.topDepartment.name}`))}">${share ? "✓" : "✗"} ${L("max.", "max.")} ${fmtPct(100 * c.topDepartment.share, 1)} ${L("dans un département", "from one department")} <span class="muted">(${esc(c.topDepartment.name)})</span></span>
        ${opts.extra ? opts.extra(c) : ""}
      </div>
    </li>`;
  };
  const more = list.length - visible;
  return `<ol class="pg-bars" id="${id}" style="--line:${at(THRESHOLD).toFixed(2)}%">
      <li class="pg-axis" aria-hidden="true"><span></span><span class="pg-axis-t"><span style="left:0">0</span><span class="pg-axis-500" style="left:${at(THRESHOLD).toFixed(2)}%">500</span><span style="right:0">${fmtNum(max)}${top > max ? "+" : ""}</span></span><span></span></li>
      ${list.map(row).join("")}
    </ol>
    ${more > 0 ? `<button type="button" class="pg-more" data-pg-more="${id}" aria-expanded="false" data-label="${esc(L(`Voir les ${more} autres`, `Show the other ${more}`))}">${esc(L(`Voir les ${more} autres`, `Show the other ${more}`))}</button>` : ""}
    <ul class="pg-legend small">${GROUP_LABELS().map((g) => `<li><i class="${g.cls}"></i>${esc(g.label)}</li>`).join("")}<li><i class="pg-legend-line"></i>${L("Seuil de 500", "500 threshold")}</li></ul>`;
}

// ---------------------------------------------------------------------------------------------------------
function openView(d: File2027, who: (c: Candidate) => string) {
  const t = d.totals!;
  const pubs = d.publications ?? [];
  const now = Date.now();
  const left = Math.ceil((Date.parse(d.window.deadline) - now) / DAY);
  return `<article class="card pg-card">
    <header class="card-head"><h2>${L("Parrainages validés", "Validated sponsorships")}</h2></header>
    <p class="pg-when"><span class="px-tag">${L("Collecte en cours", "Collection open")}</span>
      ${d.updatedAt ? `${L("Publication du Conseil constitutionnel du", "Conseil constitutionnel publication of")} ${esc(longDate(d.updatedAt))}` : ""}
      ${pubs.length ? ` · ${pubs.length} ${plural(pubs.length, ["publication", "publications"], ["publication", "publications"])}` : ""}
      · ${left > 0 ? L(`clôture le ${longDate(d.window.deadline)} à 18 h (J−${left})`, `closes ${longDate(d.window.deadline)} at 6 pm (${left} days left)`) : L("collecte close", "collection closed")}</p>
    <div class="kpis pg-kpis">
      <div><span class="muted">${L("Parrainages validés", "Validated sponsorships")}</span><strong>${fmtNum(t.sponsorships)}</strong></div>
      <div><span class="muted">${L("Personnes parrainées", "People sponsored")}</span><strong>${fmtNum(t.candidates)}</strong></div>
      <div><span class="muted">${L("Au-dessus de 500", "Above 500")}</span><strong>${fmtNum(t.reached500)}</strong></div>
      <div><span class="muted">${L("Règles remplies", "All rules met")}</span><strong>${fmtNum(t.qualifiedOnPublishedData)}</strong></div>
    </div>
    ${bars("pg-now", d.candidates, who, {
      minDeps: d.rules.minDepartments, maxShare: d.rules.maxShare, visible: 15,
      extra: (c) => (c.reached500On ? `<span class="pg-check ok">${L("500 atteint le", "Reached 500 on")} ${esc(shortDate(c.reached500On))}</span>` : `<span class="muted">${L(`encore ${fmtNum(THRESHOLD - c.total)}`, `${fmtNum(THRESHOLD - c.total)} to go`)}</span>`),
    })}
    <p class="muted small">${L("Un parrainage n’apparaît qu’une fois validé par le Conseil constitutionnel ; les formulaires reçus mais pas encore vérifiés n’y figurent pas.", "A sponsorship appears only once validated by the Conseil constitutionnel; forms received but not yet checked are not included.")}</p>
  </article>`;
}

// ---------------------------------------------------------------------------------------------------------
function notOpenView(d: File2027 | null) {
  const w = d?.window;
  const today = new Date().toISOString().slice(0, 10);
  const steps: { date: string | null; when?: string; label: string; note?: string }[] = w
    ? [
      { date: w.roundsDecided, label: L("Dates des deux tours fixées en Conseil des ministres", "Election dates set by the Council of Ministers") },
      { date: w.opens, when: L("Fin janvier – début février 2027", "Late January – early February 2027"), label: L("Ouverture de la collecte des parrainages", "Sponsorship collection opens"), note: L(w.opensExpected.fr, w.opensExpected.en) },
      { date: null, when: L("Février – mars 2027", "February – March 2027"), label: L("Le Conseil constitutionnel publie les parrainages validés, au moins deux fois par semaine", "The Conseil constitutionnel publishes the validated sponsorships, at least twice a week"), note: L("Cette page se met à jour automatiquement à chaque publication.", "This page updates automatically with each publication.") },
      { date: w.deadline, label: L("Date limite de réception des parrainages, à 18 h", "Deadline for sponsorships, 6 pm") },
      { date: w.listBy, label: L("Liste officielle des candidats, au plus tard", "Official list of candidates, at the latest"), note: L("En 2022, elle avait été publiée le 7 mars, trois jours après la clôture.", "In 2022 it came out on 7 March, three days after the deadline.") },
      { date: w.firstRound, label: L("Premier tour", "First round") },
      { date: w.secondRound, label: L("Second tour", "Second round") },
    ]
    : [];
  let marked = false;
  const li = (s: (typeof steps)[number]) => {
    const past = s.date != null && s.date.slice(0, 10) <= today;
    let mark = "";
    if (!marked && !past) { marked = true; mark = `<li class="pg-today"><span>${L("Aujourd’hui", "Today")} · ${esc(fmtDate(today))}</span></li>`; }
    return `${mark}<li class="${past ? "is-past" : ""}"><span class="pg-tl-date">${s.date ? esc(longDate(s.date)) : esc(s.when ?? "")}</span><span class="pg-tl-label">${s.label}</span>${s.note ? `<span class="pg-tl-note muted small">${esc(s.note)}</span>` : ""}</li>`;
  };
  return `<article class="card pg-card">
    <header class="card-head"><h2>${L("La collecte n’a pas commencé", "Collection has not started")}</h2></header>
    <p>${L("Aucun parrainage pour 2027 n’a encore été publié : la collecte s’ouvre au lendemain de la publication du décret de convocation des électeurs. D’ici là, voici le calendrier prévu et, plus bas, la course de 2022.", "No 2027 sponsorship has been published yet: collection opens the day after the decree convening the voters is published. Until then, here is the expected calendar and, below, the 2022 race.")}</p>
    ${steps.length ? `<ol class="pg-timeline">${steps.map(li).join("")}</ol>` : `<p class="muted">${L("Calendrier indisponible.", "Calendar unavailable.")}</p>`}
  </article>`;
}

// ---------------------------------------------------------------------------------------------------------
function referenceView(d: File2022, who: (c: Candidate) => string, open: boolean) {
  const t = d.totals!;
  const w = d.window;
  const pubs = d.publications ?? [];
  const inRace = d.candidates.filter((c) => c.total >= 100);
  const rest = d.candidates.filter((c) => c.total < 100);
  const fast = d.candidates.filter((c) => c.reached500On).sort((a, b) => a.reached500On!.localeCompare(b.reached500On!) || b.total - a.total);
  const first = fast[0], last = fast.at(-1);
  const short = d.candidates.filter((c) => !c.reached500On).slice(0, 3);
  const pubNo = (date: string) => pubs.indexOf(date) + 1;
  const extra = (c: Candidate) => c.reached500On
    ? `<span class="pg-check ok">${L("500 atteint le", "Reached 500 on")} ${esc(shortDate(c.reached500On))} <span class="muted">(${L("publication", "publication")} ${pubNo(c.reached500On)}/${pubs.length}, J+${days(w.opened, c.reached500On)})</span></span>`
    : `<span class="muted">${L(`manquait ${fmtNum(THRESHOLD - c.total)}`, `${fmtNum(THRESHOLD - c.total)} short`)}</span>`;
  const surname = (c: Candidate) => c.displayName;
  return `<article class="card pg-card pg-ref">
    <header class="card-head"><h2>${L("Référence : la course de 2022", "Reference: the 2022 race")}</h2></header>
    <p>${L(
      `En 2022, la collecte a duré du ${longDate(w.opened)} au ${longDate(w.deadline)}. Le Conseil constitutionnel a validé ${fmtNum(t.sponsorships)} parrainages pour ${fmtNum(t.candidates)} personnes et publié ${pubs.length} listes ; ${t.qualifiedOnPublishedData} candidats ont franchi les 500 et tous ont figuré sur la liste officielle du ${longDate(w.list)}.`,
      `In 2022, collection ran from ${longDate(w.opened)} to ${longDate(w.deadline)}. The Conseil constitutionnel validated ${fmtNum(t.sponsorships)} sponsorships for ${fmtNum(t.candidates)} people and published ${pubs.length} lists; ${t.qualifiedOnPublishedData} candidates crossed 500 and all of them were on the official list of ${longDate(w.list)}.`,
    )}</p>
    <div class="kpis pg-kpis">
      ${first ? `<div><span class="muted">${L("Premier à 500", "First to 500")}</span><strong>${esc(surname(first))}</strong><span class="small muted">${esc(shortDate(first.reached500On!))}, J+${days(w.opened, first.reached500On!)}</span></div>` : ""}
      ${last ? `<div><span class="muted">${L("Dernier qualifié", "Last to qualify")}</span><strong>${esc(surname(last))}</strong><span class="small muted">${esc(shortDate(last.reached500On!))}, ${L("dernière liste", "final list")}</span></div>` : ""}
      ${short[0] ? `<div><span class="muted">${L("Le plus proche sans y parvenir", "Closest to miss")}</span><strong>${esc(surname(short[0]))}</strong><span class="small muted">${fmtNum(short[0].total)} ${L("parrainages", "sponsorships")}</span></div>` : ""}
      <div><span class="muted">${L("Parrainages validés", "Validated sponsorships")}</span><strong>${fmtNum(t.sponsorships)}</strong></div>
    </div>
    ${bars("pg-2022", inRace, who, { minDeps: d.rules.minDepartments, maxShare: d.rules.maxShare, extra, visible: open ? 12 : inRace.length })}
    ${rest.length ? `<p class="muted small">${L(
      `Et ${rest.length} autres personnes, avec moins de 100 parrainages chacune (${fmtNum(rest.reduce((s, c) => s + c.total, 0))} au total), dont beaucoup n’étaient pas candidates : un élu peut parrainer qui il veut, et le parrainage est compté.`,
      `Plus ${rest.length} other people with fewer than 100 sponsorships each (${fmtNum(rest.reduce((s, c) => s + c.total, 0))} in all), many of whom were not running: an official may sponsor anyone, and the sponsorship still counts.`,
    )}</p>` : ""}
    ${short.length ? `<p class="small">${L("Ceux qui n’ont pas atteint le seuil", "Those who fell short")}${getLang() === "fr" ? " : " : ": "}${short.map((c) => `${who(c)} (${fmtNum(c.total)}${c.topDepartment.share > d.rules.maxShare ? `, ${L("dont", "with")} ${fmtPct(100 * c.topDepartment.share, 1)} ${L("dans un seul département", "from a single department")}` : ""})`).join(", ")}.</p>` : ""}
  </article>`;
}
