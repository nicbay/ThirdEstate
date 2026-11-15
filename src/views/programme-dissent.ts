// "In their own camp, who voted against?" on a programme page, in the party's own colour. Three numbers first
// (voted against at least once, only abstained, always with the programme); then measure by measure, how many of
// the party's MPs went the other way (click: who); then every MP concerned as a photo with a count badge (click:
// each vote, the measure it touches, the official record). Below a dashed line, the leaders' past votes against
// what they now propose, when the record has been analysed (public/data/programmes/record/<slug>.json).
// Data: scripts/build-programme-dissent.mjs; the record: scripts/build-record.mjs.
import { fetchJson, loadDeputes } from "../data";
import { L, fmtDate } from "../i18n";
import { esc, safeColor, safeUrl } from "../util";
import { photoUrl } from "./deputes";

type T = { fr: string; en: string };
interface Vote { num: number; date: string; title: string; topic: T; pos: "P" | "C" | "A"; expect: "P" | "C" | "A" }
interface Mp { id: string; name: string; against: number; abstained: number; votes: Vote[] }
interface Dissent { group: string; groupSize: number; scrutins: number; total: number; mps: Mp[] }
interface Contradiction { person: string; chamber: "AN" | "Sénat" | "PE"; legislature?: string | number; date: string; num?: string | number; title: string; url: string; position: "P" | "C" | "A"; measure: { lineage: string; label: T }; explanation: T; strength: "clear" | "partial" }
interface Record { coverage: { person: string; chamber: string; from: string | number; to: string | number; votes: number }[]; notCovered: { person: string; chamber: string; from: string | number; to: string | number; why: string }[]; contradictions: Contradiction[] }

const posLabel = (p: string) => ({ P: L("pour", "for"), C: L("contre", "against"), A: L("abstention", "abstained") })[p] ?? p;
const chamberLabel = (c: string) => ({ AN: L("Assemblée", "Assembly"), "Sénat": L("Sénat", "Senate"), PE: L("Parlement européen", "European Parliament") })[c] ?? c;

/** Adds the section after the programme's measure-by-measure table, when the programme's votes are matched. */
export async function mountDissent(app: HTMLElement, slug: string, candidate: string) {
  const [d, record, deputes] = await Promise.all([
    fetchJson<Dissent>(`/data/programmes/dissent/${slug}.json`).catch(() => null),
    fetchJson<Record>(`/data/programmes/record/${slug}.json`).catch(() => null),
    loadDeputes().catch(() => []),
  ]);
  const anchor = app.querySelector("#evaluation");
  if (!anchor || (!d?.mps.length && !record?.contradictions.length)) return;
  // the party's own colour (LFI red for Mélenchon), from the Assembly's group colour
  const color = safeColor(deputes.find((x) => x.groupe?.abrev === d?.group)?.groupe?.couleur) ?? "var(--split-red)";

  const sec = document.createElement("article");
  sec.className = "card dissent";
  sec.id = "contre";
  sec.style.setProperty("--party", color);
  let html = `<header class="card-head"><h2>${L("Dans son propre camp, qui a voté contre ?", "In their own camp, who voted against?")}</h2></header>`;

  if (d?.mps.length) {
    const against = d.mps.filter((m) => m.against > 0), onlyAbst = d.mps.filter((m) => !m.against);
    const loyal = d.groupSize - d.mps.length;
    // measure by measure: how many MPs went the other way on its votes
    // (an MP who voted against on one of a measure's votes and abstained on another counts once, as against)
    const byTopic = new Map<string, { topic: T; against: Set<string>; abst: Set<string> }>();
    for (const m of d.mps) for (const v of m.votes) {
      const k = v.topic.fr;
      const e = byTopic.get(k) ?? { topic: v.topic, against: new Set(), abst: new Set() };
      (v.pos === "A" ? e.abst : e.against).add(m.id);
      byTopic.set(k, e);
    }
    for (const e of byTopic.values()) for (const id of e.against) e.abst.delete(id);
    const topics = [...byTopic.values()].sort((a, b) => b.against.size * 2 + b.abst.size - (a.against.size * 2 + a.abst.size));
    const maxT = Math.max(1, ...topics.map((t) => t.against.size + t.abst.size));
    const ordered = [...against.sort((a, b) => b.against - a.against || b.abstained - a.abstained), ...onlyAbst.sort((a, b) => b.abstained - a.abstained)];
    html += `
      <p class="prog-lede">${L(
        `Les ${d.scrutins} votes de l’Assemblée (depuis 2024) rattachés aux mesures du programme, et comment s’y sont prononcés les ${d.groupSize} députés ${esc(d.group)}.`,
        `The ${d.scrutins} Assembly votes (since 2024) matched to the program's measures, and how the ${d.groupSize} ${esc(d.group)} MPs voted on them.`,
      )}</p>
      <div class="dis-kpis">
        <div class="is-against"><b>${against.length}</b><span>${L("ont voté contre au moins une fois", "voted against at least once")}</span></div>
        <div class="is-abst"><b>${onlyAbst.length}</b><span>${L("se sont seulement abstenus", "only abstained")}</span></div>
        <div><b>${loyal}</b><span>${L("ont toujours voté avec le programme", "always voted with the program")}</span></div>
      </div>
      <h3 class="dis-h">${L("Mesure par mesure", "Measure by measure")}</h3>
      <ol class="dis-topics">${topics.map((t, i) => `<li><button type="button" class="dis-topic-btn" data-t="${i}" aria-expanded="false">
        <span class="dis-topic-name">${esc(L(t.topic.fr, t.topic.en))}</span>
        <span class="dis-tbar"><i class="c" style="width:${((100 * t.against.size) / maxT).toFixed(1)}%"></i><i class="a" style="width:${((100 * t.abst.size) / maxT).toFixed(1)}%"></i></span>
        <span class="dis-tn">${t.against.size ? `<b>${t.against.size}</b> ${L("contre", "against")}` : ""}${t.against.size && t.abst.size ? " · " : ""}${t.abst.size ? `${t.abst.size} ${L("abst.", "abst.")}` : ""}</span>
      </button><div class="dis-topic-who" hidden>${[...new Set([...t.against, ...t.abst])].map((id) => { const m = d.mps.find((x) => x.id === id)!; return `<button type="button" class="dis-chip${t.against.has(id) ? " is-c" : ""}" data-mp="${esc(id)}"><img src="${photoUrl(id)}" alt="" loading="lazy" data-hide-broken/>${esc(m.name)}</button>`; }).join("")}</div></li>`).join("")}</ol>
      <h3 class="dis-h">${L("Député par député", "MP by MP")} <span class="muted small">${L("cliquez une photo pour ses votes et leur source", "click a photo for their votes and the source")}</span></h3>
      <ul class="dis-grid">${ordered.map((m) => `<li><button type="button" class="dis-face${m.against ? " is-c" : ""}" data-mp="${esc(m.id)}" aria-label="${esc(`${m.name} : ${m.against} ${L("contre", "against")}, ${m.abstained} ${L("abstentions", "abstentions")}`)}">
        <span class="dis-ph"><img src="${photoUrl(m.id)}" alt="" loading="lazy" data-hide-broken/>${m.against ? `<b class="dis-badge">${m.against}</b>` : `<b class="dis-badge is-a">${m.abstained}</b>`}</span>
        <span class="dis-nm">${esc(m.name)}</span>
      </button></li>`).join("")}</ul>
      <p class="dis-key small"><span class="k-c"></span>${L("contre ce que la mesure implique", "against what the measure implies")} <span class="k-a"></span>${L("abstention", "abstained")}</p>
      <div class="dis-panel" id="dis-panel" aria-live="polite"></div>`;
  }

  // the leaders' past votes, below a dashed line
  if (record) {
    const cs = record.contradictions;
    const people = [...new Set(cs.map((c) => c.person))];
    html += `<div class="dis-past">
      <h3 class="dis-h">${L("Leurs votes passés contre ce qu’ils proposent aujourd’hui", "Their past votes against what they propose today")}</h3>
      <p class="small muted">${L("Analysé", "Analysed")}${L(" : ", ": ")}${record.coverage.map((c) => `${esc(c.person)}, ${esc(chamberLabel(c.chamber))} ${esc(String(c.from))}–${esc(String(c.to))} (${c.votes.toLocaleString()} ${L("votes", "votes")})`).join(" · ")}.${record.notCovered.length ? ` ${L("Non couvert", "Not covered")}${L(" : ", ": ")}${record.notCovered.map((n) => `${esc(n.person)}, ${esc(chamberLabel(n.chamber))} ${esc(String(n.from))}–${esc(String(n.to))} (${esc(n.why)})`).join(" · ")}.` : ""}</p>
      ${cs.length ? people.map((p) => `<section class="dis-person"><h4>${esc(p)}</h4><ul class="dis-votes">${cs.filter((c) => c.person === p).sort((a, b) => b.date.localeCompare(a.date)).map((c) => `<li>
          <p class="dis-topic">${esc(L(c.measure.label.fr, c.measure.label.en))}${c.strength === "partial" ? ` <span class="muted small">${L("(en partie)", "(partly)")}</span>` : ""}</p>
          <p>${esc(L(c.explanation.fr, c.explanation.en))}</p>
          <p class="small"><span class="dis-pos dis-${c.position}">${esc(posLabel(c.position))}</span> <a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(chamberLabel(c.chamber))}${c.num != null ? `, ${L("scrutin", "vote")} n° ${esc(String(c.num))}` : ""}, ${fmtDate(c.date)}</a></p>
        </li>`).join("")}</ul></section>`).join("") : `<p>${L(`Dans ces votes, aucun ne va clairement contre ce que propose aujourd’hui ${esc(candidate)}.`, `In these votes, none clearly goes against what ${esc(candidate)} proposes today.`)}</p>`}
    </div>`;
  }
  sec.innerHTML = html;
  anchor.after(sec);

  if (!d?.mps.length) return;
  const panel = sec.querySelector<HTMLElement>("#dis-panel")!;
  const open = (id: string) => {
    const m = d.mps.find((x) => x.id === id);
    if (!m) return;
    sec.querySelectorAll(".dis-face").forEach((g) => g.classList.toggle("is-on", (g as HTMLElement).dataset.mp === id));
    panel.innerHTML = `<h3><img src="${photoUrl(m.id)}" alt="" data-hide-broken/><a href="#/depute/${esc(m.id)}">${esc(m.name)}</a> <span class="muted small">${m.against} ${L("contre", "against")}, ${m.abstained} ${L("abstention(s)", "abstention(s)")}</span></h3>
      <ul class="dis-votes">${m.votes.map((v) => `<li>
        <p class="dis-topic">${esc(L(v.topic.fr, v.topic.en))}</p>
        <p><span class="dis-pos dis-${v.pos}">${esc(posLabel(v.pos))}</span> <span class="muted small">${L("la mesure implique :", "the measure implies:")} ${esc(posLabel(v.expect))}</span></p>
        <p class="small"><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${v.num}" target="_blank" rel="noopener">${L("Scrutin", "Vote")} n° ${v.num}, ${fmtDate(v.date)}</a> · <span lang="fr">${esc(v.title)}</span></p>
      </li>`).join("")}</ul>`;
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  sec.querySelectorAll<HTMLElement>("[data-mp]").forEach((el) => el.addEventListener("click", () => open(el.dataset.mp!)));
  sec.querySelectorAll<HTMLButtonElement>(".dis-topic-btn").forEach((b) => b.addEventListener("click", () => {
    const who = b.nextElementSibling as HTMLElement;
    who.hidden = !who.hidden;
    b.setAttribute("aria-expanded", String(!who.hidden));
  }));
}
