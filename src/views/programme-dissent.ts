// "Who in the party voted against the programme": the candidate's programme at the top, the MPs of their own group
// who voted against it (or abstained) on the Assemblée votes matched to its measures, as photos sized by how often.
// Click a photo: each of those votes, the measure it touches, how they voted against what the promise implies, and
// the official record on assemblee-nationale.fr. Data: scripts/build-programme-dissent.mjs.
import { fetchJson } from "../data";
import { L, fmtDate } from "../i18n";
import { esc } from "../util";
import { photoUrl } from "./deputes";

interface Vote { num: number; date: string; title: string; topic: { fr: string; en: string }; pos: "P" | "C" | "A"; expect: "P" | "C" | "A" }
interface Mp { id: string; name: string; against: number; abstained: number; votes: Vote[] }
interface Dissent { group: string; groupSize: number; scrutins: number; total: number; mps: Mp[] }

const posLabel = (p: string) => ({ P: L("pour", "for"), C: L("contre", "against"), A: L("abstention", "abstained") })[p] ?? p;
const SHOWN = 14;

/** Adds the section after the programme's measure-by-measure table, when the programme's votes are matched. */
export async function mountDissent(app: HTMLElement, slug: string, candidate: string) {
  const d = await fetchJson<Dissent>(`/data/programmes/dissent/${slug}.json`).catch(() => null);
  const anchor = app.querySelector("#evaluation");
  if (!d?.mps.length || !anchor) return;
  const top = d.mps.slice(0, SHOWN), rest = d.mps.length - top.length;
  const max = Math.max(...top.map((m) => m.against + m.abstained));
  // the programme at the top, the MPs on two staggered rows below it, each linked by a line
  const W = 900, H = 330, cx = W / 2, cy = 46;
  const nodes = top.map((m, i) => {
    const n = m.against + m.abstained;
    const r = 18 + 16 * Math.sqrt(n / max);
    const x = 50 + (i * (W - 100)) / Math.max(1, top.length - 1);
    const y = i % 2 ? 250 : 175;
    return { m, r, x, y };
  });
  const svg = `<svg class="dis-map" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(L("Les députés du groupe qui ont voté contre le programme", "The group's MPs who voted against the programme"))}">
    <defs>${nodes.map((n, i) => `<clipPath id="dis-c${i}"><circle cx="${n.x}" cy="${n.y}" r="${n.r}"/></clipPath>`).join("")}</defs>
    ${nodes.map((n) => `<line x1="${cx}" y1="${cy + 18}" x2="${n.x}" y2="${n.y - n.r}" class="dis-line"/>`).join("")}
    <g class="dis-prog"><rect x="${cx - 190}" y="${cy - 22}" width="380" height="44"/><text x="${cx}" y="${cy + 5}" text-anchor="middle">${esc(L(`Le programme de ${candidate}`, `${candidate}'s programme`))}</text></g>
    ${nodes.map((n, i) => `<g class="dis-mp" tabindex="0" role="button" data-i="${i}" aria-label="${esc(`${n.m.name} : ${n.m.against} ${L("contre", "against")}, ${n.m.abstained} ${L("abstentions", "abstentions")}`)}">
      <circle cx="${n.x}" cy="${n.y}" r="${n.r + 3}" class="dis-ring${n.m.against ? " has-against" : ""}"/>
      <image href="${photoUrl(n.m.id)}" x="${n.x - n.r}" y="${n.y - n.r}" width="${2 * n.r}" height="${2 * n.r}" clip-path="url(#dis-c${i})" preserveAspectRatio="xMidYMid slice"/>
      <text x="${n.x}" y="${n.y + n.r + 15}" text-anchor="middle" class="dis-n">${n.m.against ? `<tspan class="dis-n-c">${n.m.against}× ${L("contre", "against")}</tspan>` : ""}${n.m.abstained ? `<tspan x="${n.x}" dy="${n.m.against ? 13 : 0}">${n.m.abstained}× ${L("abst.", "abst.")}</tspan>` : ""}</text>
    </g>`).join("")}
  </svg>`;

  const sec = document.createElement("article");
  sec.className = "card dissent";
  sec.id = "contre";
  sec.innerHTML = `<header class="card-head"><h2>${L("Dans son propre camp, qui a voté contre ?", "In their own camp, who voted against?")}</h2></header>
    <p class="prog-lede">${L(
      `Sur les ${d.scrutins} votes de l’Assemblée rattachés à ses mesures, <b>${d.mps.length}</b> des ${d.groupSize} députés ${esc(d.group)} ont au moins une fois voté contre ce que la mesure implique ou se sont abstenus (${d.total} votes en tout). Taille de la photo : le nombre de fois. Cliquez une photo pour le détail et la source officielle.`,
      `Across the ${d.scrutins} Assembly votes matched to its measures, <b>${d.mps.length}</b> of the ${d.groupSize} ${esc(d.group)} MPs at least once voted against what the measure implies, or abstained (${d.total} votes in all). Photo size: how many times. Click a photo for the detail and the official record.`,
    )}</p>
    <div class="dis-wrap">${svg}</div>
    ${rest > 0 ? `<details class="dis-rest"><summary class="small">${L(`Et ${rest} autres députés`, `And ${rest} more MPs`)}</summary><p class="small">${d.mps.slice(SHOWN).map((m, i) => `<button type="button" class="linkish dis-more" data-i="${SHOWN + i}">${esc(m.name)}</button> <span class="muted">(${m.against + m.abstained})</span>`).join(", ")}</p></details>` : ""}
    <div class="dis-panel" id="dis-panel" aria-live="polite"></div>
    <p class="muted tiny">${L("Votes de la 17ᵉ législature (depuis 2024) rattachés à la main aux mesures du programme ; « contre » : un vote opposé à ce que la mesure implique (par exemple contre l’abrogation qu’elle promet). Les votes passés des dirigeants (législatures précédentes, Sénat) viendront ensuite.", "Votes of the 17th legislature (since 2024) matched by hand to the programme's measures; 'against': a vote opposite to what the measure implies (for instance against a repeal it promises). Leaders' past votes (earlier legislatures, Senate) will follow.")}</p>`;
  anchor.after(sec);

  const panel = sec.querySelector<HTMLElement>("#dis-panel")!;
  const open = (i: number) => {
    const m = d.mps[i];
    sec.querySelectorAll(".dis-mp").forEach((g) => g.classList.toggle("is-on", Number((g as HTMLElement).dataset.i) === i));
    panel.innerHTML = `<h3><a href="#/depute/${esc(m.id)}">${esc(m.name)}</a> <span class="muted small">${m.against} ${L("contre", "against")}, ${m.abstained} ${L("abstention(s)", "abstention(s)")}</span></h3>
      <ul class="dis-votes">${m.votes.map((v) => `<li>
        <p class="dis-topic">${esc(L(v.topic.fr, v.topic.en))}</p>
        <p><span class="dis-pos dis-${v.pos}">${esc(posLabel(v.pos))}</span> <span class="muted small">${L("la mesure implique :", "the measure implies:")} ${esc(posLabel(v.expect))}</span></p>
        <p class="small"><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${v.num}" target="_blank" rel="noopener">${L("Scrutin", "Vote")} n° ${v.num}, ${fmtDate(v.date)}</a> · <span lang="fr">${esc(v.title)}</span></p>
      </li>`).join("")}</ul>`;
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  sec.querySelectorAll<HTMLElement>(".dis-mp, .dis-more").forEach((el) => {
    el.addEventListener("click", () => open(Number(el.dataset.i)));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(Number(el.dataset.i)); } });
  });
}
