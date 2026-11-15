// "Who voted against the programme in the Assembly?" at a glance, on a programme page: the votes matched to its
// measures, the ones that count (the party's group voted the other way, or the promise lost by fewer votes than
// the group left on the table), then, folded, every contrary vote and abstention line by line.
// Data: the programme file's `votes` (scripts/build-programme.mjs or the curated files) and, when it exists,
// public/data/programmes/dissent/<slug>.json (scripts/build-programme-dissent.mjs) for each MP's position.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum } from "../i18n";
import { esc } from "../util";

type T = { fr: string; en: string };
type Pos = "P" | "C" | "A";
export interface VoteItem { num: number; date: string; title: string; result: string; total: { P: number; C: number; A: number }; group: { P: number; C: number; A: number }; majority: Pos | null; expect: "P" | "C"; agrees: boolean | null }
export interface VoteLink { lineage: string; topic: T; note: T | null; scrutins: VoteItem[] }
interface DissentVote { num: number; date: string; title: string; topic: T; pos: Pos; expect: Pos }
interface Dissent { group: string; groupSize: number; scrutins: number; total: number; mps: { id: string; name: string; against: number; abstained: number; votes: DissentVote[] }[] }

type Kind = "against" | "decisive" | "lost" | "won";
const AN = (n: number) => `https://www.assemblee-nationale.fr/dyn/17/scrutins/${n}`;
const pos = (p: Pos) => ({ P: L("pour", "for"), C: L("contre", "against"), A: L("abstention", "abstained") })[p];

/** Inserts the card before `before` (or at the end of the page). `measureHref` points a topic at its measure. */
export async function mountVotesCard(app: HTMLElement, o: { slug: string; group?: string; votes?: VoteLink[]; before: Element | null; measureHref?: (lineage: string) => string }) {
  const votes = o.votes ?? [];
  if (!votes.length) return;
  const d = await fetchJson<Dissent>(`/data/programmes/dissent/${o.slug}.json`).catch(() => null);
  const group = o.group ?? d?.group ?? "";
  const size = d?.groupSize ?? null;

  const rows = votes.flatMap((v) => v.scrutins.filter((s) => s.total && s.group).map((s) => {
    const g = s.group, cast = g.P + g.C + g.A;
    const absent = size != null ? Math.max(0, size - cast) : null;
    const adopted = /^adopt/i.test(s.result);
    const won = s.expect === "P" ? adopted : !adopted;
    const margin = Math.abs(s.total.P - s.total.C);
    const contrary = s.expect === "P" ? g.C : g.P;
    // the group's missing support (absentees, abstentions, and contrary votes counted twice) would have flipped it
    const missing = (absent ?? 0) + g.A + 2 * contrary;
    const kind: Kind = s.agrees === false ? "against" : !won && missing > margin ? "decisive" : !won ? "lost" : "won";
    return { v, s, cast, absent, won, margin, contrary, missing, kind };
  }));
  if (!rows.length) return;
  const rank: Record<Kind, number> = { against: 0, decisive: 1, lost: 2, won: 3 };
  const main = [...rows].sort((a, b) => rank[a.kind] - rank[b.kind] || b.s.date.localeCompare(a.s.date)).slice(0, 6);
  const n = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const inLine = rows.filter((r) => r.s.agrees === true).length;
  // line by line: each MP of the group who voted against what the measure implies or abstained
  const lines = (d?.mps ?? []).flatMap((m) => m.votes.map((v) => ({ m, v }))).sort((a, b) => b.v.date.localeCompare(a.v.date) || a.v.num - b.v.num || (a.v.pos === "A" ? 1 : 0) - (b.v.pos === "A" ? 1 : 0) || a.m.name.localeCompare(b.m.name));
  const table = [
          ...rows.filter((r) => r.kind === "against").map((r) => ({ date: r.s.date, num: r.s.num, topic: r.v.topic, who: `<b>${L(`Groupe ${esc(group)}`, `${esc(group)} group`)}</b> <span class="muted small">(${r.s.group.P}–${r.s.group.C}–${r.s.group.A})</span>`, p: r.s.majority as Pos, e: r.s.expect as Pos })),
          ...lines.map(({ m, v }) => ({ date: v.date, num: v.num, topic: v.topic, who: `<a href="#/depute/${esc(m.id)}">${esc(m.name)}</a>`, p: v.pos, e: v.expect })),
          ...(!d ? rows.filter((r) => r.s.group.A > 0).map((r) => ({ date: r.s.date, num: r.s.num, topic: r.v.topic, who: `${L(`${r.s.group.A} députés ${esc(group)}`, `${r.s.group.A} ${esc(group)} MPs`)}`, p: "A" as Pos, e: r.s.expect as Pos })) : []),
        ].sort((a, b) => b.date.localeCompare(a.date) || a.num - b.num);

  const verdict = (r: (typeof rows)[number]) => ({
    against: `<span class="pv-chip is-against">${L(`${esc(group)} a voté contre`, `${esc(group)} voted against`)}</span>`,
    decisive: `<span class="pv-chip is-decisive">${L("Voix manquantes décisives", "Missing votes were decisive")}</span>`,
    lost: `<span class="pv-chip is-lost">${L("Perdu malgré le groupe", "Lost despite the group")}</span>`,
    won: `<span class="pv-chip is-won">${L("Dans le sens de la promesse", "In line with the promise")}</span>`,
  })[r.kind];
  const bar = (r: (typeof rows)[number]) => {
    const g = r.s.group, tot = r.cast + (r.absent ?? 0) || 1;
    const seg = (k: string, v: number, label: string) => (v ? `<i class="pv-${k}" style="flex:${v}" title="${esc(`${v} ${label}`)}"></i>` : "");
    return `<span class="pv-bar" role="img" aria-label="${esc(`${group} : ${g.P} ${pos("P")}, ${g.C} ${pos("C")}, ${g.A} ${pos("A")}${r.absent != null ? `, ${r.absent} ${L("non votants", "not voting")}` : ""}`)}" style="--tot:${tot}">${seg("P", g.P, pos("P"))}${seg("C", g.C, pos("C"))}${seg("A", g.A, pos("A"))}${seg("N", r.absent ?? 0, L("non votants", "not voting"))}</span>`;
  };
  const why = (r: (typeof rows)[number]) => r.kind === "decisive"
    ? L(`Texte ${/^adopt/i.test(r.s.result) ? "adopté" : "rejeté"} à ${fmtNum(r.margin)} voix d’écart ; ${r.absent != null ? `${fmtNum(r.absent)} députés ${esc(group)} n’ont pas voté` : ""}${r.s.group.A ? `${r.absent != null ? ", " : ""}${fmtNum(r.s.group.A)} se sont abstenus` : ""}${r.contrary ? `, ${fmtNum(r.contrary)} ont voté contre la mesure` : ""}.`,
        `${/^adopt/i.test(r.s.result) ? "Adopted" : "Rejected"} by ${fmtNum(r.margin)} votes; ${r.absent != null ? `${fmtNum(r.absent)} ${esc(group)} MPs did not vote` : ""}${r.s.group.A ? `${r.absent != null ? ", " : ""}${fmtNum(r.s.group.A)} abstained` : ""}${r.contrary ? `, ${fmtNum(r.contrary)} voted against the measure` : ""}.`)
    : r.kind === "against"
    ? L(`La majorité des députés ${esc(group)} a voté ${pos(r.s.majority!)}, la mesure implique de voter ${pos(r.s.expect)}.`, `Most ${esc(group)} MPs voted ${pos(r.s.majority!)}; the measure implies voting ${pos(r.s.expect)}.`)
    : "";

  const sec = document.createElement("article");
  sec.className = "card pv";
  sec.id = "votes";
  sec.innerHTML = `
    <header class="card-head"><h2>${L("À l’Assemblée : qui a voté contre ces mesures ?", "In the Assembly: who voted against these measures?")}</h2></header>
    <p class="prog-lede">${L(
      `Les ${fmtNum(rows.length)} scrutins publics depuis 2024 qui portent sur une mesure du programme, et ce qu’en a fait le groupe ${esc(group)}${size ? ` (${fmtNum(size)} députés aujourd’hui)` : ""}.`,
      `The ${fmtNum(rows.length)} public votes since 2024 on a measure of the program, and what the ${esc(group)} group${size ? ` (${fmtNum(size)} MPs today)` : ""} did with them.`)}</p>
    <div class="pv-kpis">
      <div class="is-won"><b>${fmtNum(inLine)}</b><span>${L("votes du groupe dans le sens de la promesse", "group votes in line with the promise")}</span></div>
      <div class="is-against"><b>${fmtNum(n("against"))}</b><span>${L("votes où le groupe est allé contre", "votes where the group went against")}</span></div>
      <div class="is-decisive"><b>${fmtNum(n("decisive"))}</b><span>${L("défaites où ses voix manquantes auraient suffi", "defeats its missing votes would have reversed")}</span></div>
      <div><b>${fmtNum(d ? d.mps.filter((m) => m.against).length : n("lost"))}</b><span>${d ? L(`députés ${esc(group)} contre au moins une fois`, `${esc(group)} MPs against at least once`) : L("défaites malgré le groupe", "defeats despite the group")}</span></div>
    </div>
    <h3 class="dis-h">${L("Les votes qui comptent", "The votes that matter")}</h3>
    <ol class="pv-list">${main.map((r) => `<li class="pv-row is-${r.kind}">
      <div class="pv-top"><span class="pv-date">${fmtDate(r.s.date)}</span>${verdict(r)}</div>
      <p class="pv-topic">${o.measureHref ? `<a href="${esc(o.measureHref(r.v.lineage))}">${esc(L(r.v.topic.fr, r.v.topic.en))}</a>` : esc(L(r.v.topic.fr, r.v.topic.en))}</p>
      <div class="pv-mid">${bar(r)}<span class="pv-n small">${esc(group)} ${r.s.group.P}–${r.s.group.C}–${r.s.group.A}${r.absent != null ? ` · ${fmtNum(r.absent)} ${L("non votants", "not voting")}` : ""}</span></div>
      ${why(r) ? `<p class="pv-why small">${why(r)}</p>` : ""}
      <p class="small muted"><a href="${AN(r.s.num)}" target="_blank" rel="noopener">${L("Scrutin", "Vote")} n° ${r.s.num}</a> · <span lang="fr">${esc(r.s.title.replace(/^./, (c) => c.toUpperCase()))}</span> · ${esc(r.s.result)} ${r.s.total.P}–${r.s.total.C}–${r.s.total.A}</p>
    </li>`).join("")}</ol>
    <p class="pv-key small"><span><i class="pv-P"></i>${pos("P")}</span><span><i class="pv-C"></i>${pos("C")}</span><span><i class="pv-A"></i>${pos("A")}</span><span><i class="pv-N"></i>${L("non votants (effectif actuel)", "not voting (current membership)")}</span></p>
    <p><a class="button pv-open" href="#votes-lignes">${L(`Toutes les voix contraires et abstentions, ligne par ligne (${fmtNum(table.length)})`, `Every contrary vote and abstention, line by line (${fmtNum(table.length)})`)} ↓</a></p>
    <details class="pv-all" id="votes-lignes">
      <summary>${L("Le détail, ligne par ligne", "The detail, line by line")}</summary>
      <div class="table-wrap"><table class="table pv-table">
        <thead><tr><th>${L("Date", "Date")}</th><th>${L("Scrutin", "Vote")}</th><th>${L("Mesure", "Measure")}</th><th>${L("Qui", "Who")}</th><th>${L("Vote", "Vote")}</th><th>${L("La mesure implique", "Measure implies")}</th></tr></thead>
        <tbody>${table.map((x) => `<tr>
          <td class="nowrap">${fmtDate(x.date)}</td>
          <td class="nowrap"><a href="${AN(x.num)}" target="_blank" rel="noopener">n° ${x.num}</a></td>
          <td>${esc(L(x.topic.fr, x.topic.en))}</td>
          <td>${x.who}</td>
          <td class="nowrap"><b class="pos-${x.p}">${pos(x.p)}</b></td>
          <td class="nowrap muted">${pos(x.e)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">${L("Aucune voix contraire ni abstention enregistrée.", "No contrary vote or abstention recorded.")}</td></tr>`}</tbody>
      </table></div>
      <p class="muted small">${L(
        `Position attendue : celle qu’implique la mesure du programme (voter pour un texte qui l’applique, contre un texte qui la défait). « Non votants » : effectif actuel du groupe moins les votants, il compte aussi les députés arrivés après le scrutin. Une voix contraire pèse double dans le calcul des voix manquantes (elle s’ajoute au camp d’en face). Source : open data de l’Assemblée nationale.`,
        `Expected position: what the program's measure implies (for a text that applies it, against a text that undoes it). “Not voting”: the group's current membership minus those who voted, so it also counts MPs who arrived after the vote. A contrary vote counts twice in the missing votes (it adds to the other side). Source: Assemblée nationale open data.`)}</p>
    </details>`;
  if (o.before) o.before.before(sec); else app.querySelector(".page")?.append(sec);
  sec.querySelector(".pv-open")?.addEventListener("click", (e) => {
    e.preventDefault();
    const det = sec.querySelector<HTMLDetailsElement>("#votes-lignes")!;
    det.open = true;
    det.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
}
