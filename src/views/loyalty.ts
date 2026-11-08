// Group loyalty: how often each MP votes with their group's line, ranked from "doigt sur la couture"
// (always with the group, i.e. blind obedience) to "frondeur" (rebel). Data: public/data/an/loyalty.json,
// computed by scripts/lib/loyalty.mjs during `npm run sync:an`.
import { fetchJson, loadAnMeta, loadDeputes, loadScrutins, type Depute, type Scrutin } from "../data";
import { L, colon, fmtDate, fmtNum, fmtPct, t } from "../i18n";
import { esc, safeColor } from "../util";

type Pos = "P" | "C" | "A";
export interface LoyaltyMp {
  id: string;
  /** current group (null for non-inscrits) */
  g: string | null;
  /** votes counted (cast as a group member, with a clear group line) */
  n: number;
  /** of which matching the group line */
  ok: number;
  /** of which the opposite of the line (pour vs contre) */
  opp: number;
  /** votes cast while non-inscrit (no group line, not counted) */
  ni: number;
  /** votes skipped: fewer than minOthers colleagues voted, or their vote was tied */
  few: number;
  loyalty: number | null;
  part: number;
  /** groups voted under, by number of votes, when more than one */
  moved?: [string, number][];
  /** most notable breaks: [scrutin, MP's vote, group line, share of colleagues on the line, colleagues voting] */
  top: [number, Pos, Pos, number, number][];
  rank?: number;
}
interface LoyaltyGroup { n: number; min: number; max: number; votes: number; avg: number; pooled: number }
interface LoyaltyFile { generatedAt: string; minVotes: number; minOthers: number; ranked: number; groups: Record<string, LoyaltyGroup>; mps: LoyaltyMp[] }

let cache: Promise<LoyaltyFile> | null = null;
export const loadLoyalty = () => (cache ??= fetchJson<LoyaltyFile>("/data/an/loyalty.json"));

/** Descriptive tiers. High loyalty is framed as obedience, not merit. */
const TIERS: [number, string, string][] = [
  [0.99, "Doigt sur la couture", "Toes the line"],
  [0.97, "Bon petit soldat", "Good little soldier"],
  [0.93, "Quelques écarts", "The odd step out of line"],
  [0.85, "Électron libre", "Free spirit"],
  [0, "Frondeur", "Rebel"],
];
export const tier = (l: number) => { const x = TIERS.find(([min]) => l >= min)!; return L(x[1], x[2]); };

const posLabel = (p: string) => { const s = t(); return ({ P: s.for, C: s.against, A: s.abstention } as Record<string, string>)[p] ?? p; };
const pct = (x: number, d = 1) => fmtPct(100 * x, d);
const groupColors = (deputes: Depute[]) => {
  const m = new Map<string, string>();
  for (const d of deputes) if (d.groupe) m.set(d.groupe.abrev, safeColor(d.groupe.couleur));
  return m;
};
const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Strip plot of every ranked MP on the obedience scale: left = always with the group, right = rebel.
 * x is the loyalty share; the axis stops at the lowest score, rounded down to 5 points.
 */
function scale(ranked: LoyaltyMp[], colors: Map<string, string>, names: Map<string, string>, mark?: LoyaltyMp) {
  const W = 1000, H = 92, top = 22, band = 44;
  const lo = Math.floor(Math.min(...ranked.map((m) => m.loyalty!)) * 20) / 20;
  const x = (l: number) => 8 + ((1 - l) / (1 - lo)) * (W - 16);
  const ticks: number[] = [];
  for (let v = 1; v >= lo - 1e-9; v -= 0.05) ticks.push(v);
  const dots = ranked
    .map((m, i) => {
      const y = top + 4 + ((i * 37) % 9) * (band / 9) + 2;
      return `<circle cx="${x(m.loyalty!).toFixed(1)}" cy="${y.toFixed(1)}" r="${m === mark ? 0 : 3.2}" fill="${colors.get(m.g!) ?? "var(--other)"}" fill-opacity="${mark ? 0.35 : 0.75}"><title>${esc(names.get(m.id) ?? m.id)} (${esc(m.g)}) · ${pct(m.loyalty!)}</title></circle>`;
    })
    .join("");
  const marker = mark?.loyalty != null
    ? `<g class="loy-mark"><line x1="${x(mark.loyalty)}" x2="${x(mark.loyalty)}" y1="${top - 6}" y2="${top + band + 8}" stroke="var(--ink)" stroke-width="2.5"/><circle cx="${x(mark.loyalty)}" cy="${top + band / 2 + 2}" r="7" fill="${colors.get(mark.g!) ?? "var(--other)"}" stroke="var(--ink)" stroke-width="2"/></g>`
    : "";
  return `<figure class="loy-scale">
    <div class="loy-ends"><span>← ${L("Doigt sur la couture", "Toes the line")}</span><span>${L("Frondeur, rebelle", "Rebel")} →</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Répartition des députés selon leur loyauté envers leur groupe", "MPs by loyalty to their group")}">
      <line x1="0" x2="${W}" y1="${top + band + 10}" y2="${top + band + 10}" stroke="var(--ink)" stroke-width="1"/>
      ${ticks.map((v) => `<g><line x1="${x(v)}" x2="${x(v)}" y1="${top + band + 10}" y2="${top + band + 15}" stroke="var(--ink)"/><text x="${x(v)}" y="${H - 2}" text-anchor="${v === 1 ? "start" : "middle"}" class="loy-tick">${pct(v, 0)}</text></g>`).join("")}
      ${dots}${marker}
    </svg>
    <figcaption class="muted small">${L("Chaque point est un député classé, à la couleur de son groupe. Échelle : part de ses votes conformes à la ligne de son groupe.", "Each dot is a ranked MP, in their group’s colour. Scale: share of their votes matching their group’s line.")}</figcaption>
  </figure>`;
}

function methodNote(f: LoyaltyFile) {
  return `<details class="loy-method"><summary>${L("Méthode", "Method")}</summary>
    <ul class="small">
      <li>${L("Pour chaque scrutin public, l’Assemblée liste chaque député sous le groupe auquel il appartenait <b>le jour du vote</b> : un député qui a changé de groupe est donc comparé au groupe qu’il avait alors.", "For every public vote the Assemblée lists each MP under the group they belonged to <b>on the day of the vote</b>, so an MP who switched groups is compared with the group they had at the time.")}</li>
      <li>${L("La ligne du groupe est la position (pour, contre, abstention) la plus fréquente parmi les <b>autres</b> membres du groupe qui ont voté, recomptée sur les listes nominatives. Nous n’utilisons pas la « position majoritaire » publiée par l’Assemblée, qui contredit le décompte nominatif dans environ 3 % des cas.", "The group line is the most common position (for, against, abstain) among the <b>other</b> group members who voted, recounted from the roll-call lists. We do not use the Assemblée’s published “majority position”, which contradicts the roll-call count in about 3% of cases.")}</li>
      <li>${L(`Un scrutin compte si au moins ${f.minOthers} collègues du groupe ont voté et que leur position n’est pas à égalité. Les non-votants et absents ne comptent pas.`, `A vote counts if at least ${f.minOthers} group colleagues voted and their position was not tied. Non-voting and absence do not count.`)}</li>
      <li>${L(`Les non-inscrits n’ont pas de ligne de groupe : leurs votes ne comptent pas et ils ne sont pas classés. Il faut au moins ${f.minVotes} votes comptés pour être classé.`, `Non-attached MPs have no group line: their votes are not counted and they are not ranked. At least ${f.minVotes} counted votes are needed to be ranked.`)}</li>
      <li>${L("S’abstenir quand son groupe vote pour ou contre compte comme un écart ; voter l’inverse (pour contre contre) est compté à part comme « vote opposé ».", "Abstaining when the group votes for or against counts as a break; voting the other way (for vs against) is also counted separately as an “opposite vote”.")}</li>
      <li>${L("Tous les scrutins publics comptent, y compris ceux où les groupes laissent la liberté de vote (fin de vie, sujets de société) : les rapporteurs et les députés très investis sur ces textes y accumulent des écarts.", "Every public vote counts, including those where groups allow a free vote (end of life, social issues): rapporteurs and MPs heavily involved in those bills rack up breaks there.")}</li>
      <li>${L("Un score élevé n’est pas un compliment : il mesure la discipline de vote, pas la qualité du travail. Les grands groupes très disciplinés tirent les scores vers le haut.", "A high score is not a compliment: it measures voting discipline, not the quality of the work. Large, tightly whipped groups push scores up.")}</li>
    </ul></details>`;
}

// ---------- ranking page ----------
type Key = "rank" | "nom" | "g" | "reb" | "opp" | "n" | "part";
const state = { q: "", g: "", sort: "rank" as Key, dir: 1 };

export async function renderLoyalty(pane: HTMLElement) {
  const [f, deputes, meta] = await Promise.all([loadLoyalty(), loadDeputes(), loadAnMeta()]);
  const byId = new Map(deputes.map((d) => [d.id, d]));
  const colors = groupColors(deputes);
  const names = new Map(deputes.map((d) => [d.id, `${d.prenom} ${d.nom}`]));
  const ranked = f.mps.filter((m) => m.rank).sort((a, b) => a.rank! - b.rank!);
  const unranked = f.mps.filter((m) => !m.rank);
  const groups = Object.entries(f.groups).sort((a, b) => b[1].avg - a[1].avg);
  const libelle = new Map(deputes.filter((d) => d.groupe).map((d) => [d.groupe!.abrev, d.groupe!.libelle]));
  const chip = (g: string | null) => `<span class="chip" style="--c:${colors.get(g ?? "") ?? "#999"}">${esc(g ?? "NI")}</span>`;
  const first = ranked[0], last = ranked[ranked.length - 1];

  pane.innerHTML = `
    <article class="card">
      <header class="card-head"><h2>${L("Tous les députés, du plus obéissant au plus frondeur", "Every MP, from most obedient to most rebellious")}</h2></header>
      <p>${L(`Voter comme son groupe à chaque fois n’a rien d’un exploit : c’est le « doigt sur la couture du pantalon ». Sur ${fmtNum(ranked.length)} députés classés, le plus discipliné, ${esc(names.get(first.id))}, suit la ligne dans ${pct(first.loyalty!)} des votes ; le plus frondeur, ${esc(names.get(last.id))}, dans ${pct(last.loyalty!)}.`, `Voting with your group every time is no achievement: it is toeing the line. Of ${fmtNum(ranked.length)} ranked MPs, the most disciplined, ${esc(names.get(first.id))}, follows the line in ${pct(first.loyalty!)} of votes; the most rebellious, ${esc(names.get(last.id))}, in ${pct(last.loyalty!)}.`)}</p>
      ${scale(ranked, colors, names)}
      ${methodNote(f)}
    </article>

    <article class="card">
      <header class="card-head"><h2>${L("Loyauté moyenne par groupe", "Average loyalty by group")}</h2></header>
      <table class="table loy-groups">
        <thead><tr><th>${L("Groupe", "Group")}</th><th class="num">${L("Députés classés", "Ranked MPs")}</th><th class="loy-avg">${L("Moyenne", "Average")}</th><th class="num">${L("Fourchette (min – max)", "Range (min – max)")}</th></tr></thead>
        <tbody>${groups.map(([g, x]) => `<tr data-g="${esc(g)}" tabindex="0" title="${L("Filtrer le classement sur ce groupe", "Filter the ranking to this group")}">
          <td>${chip(g)} <span class="muted small">${esc(libelle.get(g) ?? "")}</span></td>
          <td class="num">${x.n}</td>
          <td class="loy-avg loy-cell"><div class="loy-bar"><div style="width:${(100 * (x.avg - 0.6)) / 0.4}%;background:${colors.get(g) ?? "var(--other)"}"></div></div><b>${pct(x.avg)}</b> <span class="muted small">${esc(tier(x.avg))}</span></td>
          <td class="num muted">${pct(x.min)} – ${pct(x.max)}</td></tr>`).join("")}</tbody>
      </table>
      <p class="muted small">${L("Moyenne des scores des députés classés du groupe (groupe actuel). Barre : de 60 % à 100 %.", "Mean score of the group’s ranked MPs (current group). Bar: 60% to 100%.")}</p>
    </article>

    <article class="card">
      <div class="filters">
        <input id="lq" type="search" placeholder="${t().search}" value="${esc(state.q)}" />
        <select id="lg"><option value="">${t().allGroups}</option>${groups.map(([g]) => `<option value="${esc(g)}" ${g === state.g ? "selected" : ""}>${esc(g)} — ${esc(libelle.get(g) ?? "")}</option>`).join("")}</select>
        <span id="lcount" class="muted"></span>
      </div>
      <table class="table loy-table">
        <thead><tr>
          <th data-k="rank" class="num">${L("Rang", "Rank")}</th>
          <th data-k="nom">${L("Député", "MP")}</th>
          <th data-k="g">${L("Groupe", "Group")}</th>
          <th data-k="rank">${L("Avec son groupe", "With group")}</th>
          <th data-k="reb" class="num">${L("Écarts", "Breaks")}</th>
          <th data-k="opp" class="num">${L("Votes opposés", "Opposite votes")}</th>
          <th data-k="n" class="num">${L("Votes comptés", "Votes counted")}</th>
          <th data-k="part" class="num">${t().participation}</th>
        </tr></thead>
        <tbody id="lrows"></tbody>
      </table>
    </article>

    <details class="card loy-unranked">
      <summary><b>${L(`Non classés (${unranked.length})`, `Not ranked (${unranked.length})`)}</b> <span class="muted small">${L(`non-inscrits, ou moins de ${f.minVotes} votes comptés`, `non-attached, or fewer than ${f.minVotes} counted votes`)}</span></summary>
      <ul class="loy-list">${unranked
        .sort((a, b) => (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? "", "fr"))
        .map((m) => `<li><a href="#/depute/${m.id}">${esc(names.get(m.id))}</a> ${chip(m.g)} <span class="muted small">${m.g ? L(`${m.n} votes comptés`, `${m.n} votes counted`) : L(`non-inscrit · ${fmtNum(m.ni)} votes hors groupe`, `non-attached · ${fmtNum(m.ni)} votes outside a group`)}${m.n && !m.g ? L(` · ${pct(m.loyalty!)} avec son ancien groupe (${m.n} votes)`, ` · ${pct(m.loyalty!)} with former group (${m.n} votes)`) : ""}</span></li>`)
        .join("")}</ul>
    </details>
    <p class="source muted">${t().sourceAN(fmtDate(meta.syncedAt))}</p>`;

  const val = (m: LoyaltyMp, k: Key): number | string => {
    const d = byId.get(m.id);
    return k === "rank" ? m.rank! : k === "nom" ? d?.alpha ?? "" : k === "g" ? m.g ?? "" : k === "reb" ? m.n - m.ok : k === "opp" ? m.opp : k === "n" ? m.n : m.part;
  };
  const tbody = pane.querySelector<HTMLElement>("#lrows")!;
  const draw = () => {
    const q = norm(state.q);
    const rows = ranked
      .filter((m) => (!state.g || m.g === state.g) && (!q || norm(`${names.get(m.id)} ${m.g} ${byId.get(m.id)?.departement ?? ""}`).includes(q)))
      .sort((a, b) => {
        const va = val(a, state.sort), vb = val(b, state.sort);
        const c = typeof va === "string" ? va.localeCompare(vb as string, "fr") : va - (vb as number);
        return state.dir * c || a.rank! - b.rank!;
      });
    pane.querySelector("#lcount")!.textContent = t().results(rows.length);
    pane.querySelectorAll<HTMLElement>("th[data-k]").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === state.sort ? (state.dir > 0 ? "ascending" : "descending") : "none"));
    tbody.innerHTML = rows
      .map((m) => {
        const w = (100 * (m.loyalty! - 0.6)) / 0.4;
        return `<tr>
          <td class="num">${m.rank}</td>
          <td><a href="#/depute/${m.id}">${esc(names.get(m.id))}</a>${m.moved ? ` <span class="muted small" title="${esc(m.moved.map(([g, k]) => `${g}${colon()}${k}`).join(" · "))}">${L("a changé de groupe", "switched group")}</span>` : ""}</td>
          <td>${chip(m.g)}</td>
          <td class="loy-cell"><div class="loy-bar"><div style="width:${Math.max(0, w)}%;background:${colors.get(m.g!) ?? "var(--other)"}"></div></div><b>${pct(m.loyalty!)}</b> <span class="muted small">${esc(tier(m.loyalty!))}</span></td>
          <td class="num">${fmtNum(m.n - m.ok)}</td>
          <td class="num">${fmtNum(m.opp)}</td>
          <td class="num muted">${fmtNum(m.n)}</td>
          <td class="num muted">${pct(m.part, 0)}</td>
        </tr>`;
      })
      .join("");
  };
  pane.querySelector<HTMLInputElement>("#lq")!.addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; draw(); });
  const sel = pane.querySelector<HTMLSelectElement>("#lg")!;
  sel.addEventListener("change", () => { state.g = sel.value; draw(); });
  pane.querySelectorAll<HTMLElement>("th[data-k]").forEach((th) => {
    th.tabIndex = 0;
    const go = () => {
      const k = th.dataset.k as Key;
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === "reb" || k === "opp" || k === "n" || k === "part" ? -1 : 1; }
      draw();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
  pane.querySelectorAll<HTMLElement>(".loy-groups tr[data-g]").forEach((tr) => {
    const go = () => { state.g = tr.dataset.g!; sel.value = state.g; draw(); pane.querySelector(".loy-table")!.scrollIntoView({ behavior: "smooth", block: "start" }); };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
  draw();
}

// ---------- block on one MP's page ----------
/** Inserts the MP's loyalty card right after `after`. Fails quietly if the data is missing. */
export async function mountMpLoyalty(after: Element, d: Depute) {
  try {
    const [f, deputes, scrutins] = await Promise.all([loadLoyalty(), loadDeputes(), loadScrutins()]);
    const m = f.mps.find((x) => x.id === d.id);
    if (!m) return;
    after.insertAdjacentHTML("afterend", mpCard(f, m, deputes, scrutins));
  } catch (err) {
    console.warn("loyalty", err);
  }
}

function mpCard(f: LoyaltyFile, m: LoyaltyMp, deputes: Depute[], scrutins: Scrutin[]) {
  const colors = groupColors(deputes);
  const names = new Map(deputes.map((d) => [d.id, `${d.prenom} ${d.nom}`]));
  const ranked = f.mps.filter((x) => x.rank).sort((a, b) => a.rank! - b.rank!);
  const byNum = new Map(scrutins.map((s) => [s[0], s]));
  const grp = m.g ? f.groups[m.g] : null;
  const head = `<header class="card-head"><h2>${L("Doigt sur la couture ou frondeur ?", "Toeing the line or rebel?")}</h2> <a class="small" href="#/assemblee/loyaute">${L("Voir le classement", "See the ranking")} →</a></header>`;

  let body: string;
  if (m.rank && m.loyalty != null) {
    const reb = m.n - m.ok;
    body = `
      <div class="kpis kpis-4">
        <div><span class="muted">${L("Votes avec son groupe", "Votes with group")}</span><strong>${pct(m.loyalty)}</strong></div>
        <div><span class="muted">${L(`Rang (1 = le plus obéissant)`, `Rank (1 = most obedient)`)}</span><strong>${m.rank}<small> / ${ranked.length}</small></strong></div>
        <div><span class="muted">${L("Écarts avec le groupe", "Breaks with group")}</span><strong>${fmtNum(reb)}</strong></div>
        <div><span class="muted">${t().participation}</span><strong>${pct(m.part, 0)}</strong></div>
      </div>
      <p><b>${esc(tier(m.loyalty))}.</b> ${L(
        `Sur ${fmtNum(m.n)} votes comptés, ${fmtNum(m.ok)} suivent la ligne de son groupe ; ${fmtNum(reb)} s’en écartent, dont ${fmtNum(m.opp)} votes dans le sens opposé.`,
        `Of ${fmtNum(m.n)} counted votes, ${fmtNum(m.ok)} follow the group line; ${fmtNum(reb)} break from it, ${fmtNum(m.opp)} of them voting the opposite way.`,
      )}${grp ? L(` Moyenne du groupe ${esc(m.g)} : ${pct(grp.avg)}.`, ` ${esc(m.g)} group average: ${pct(grp.avg)}.`) : ""}</p>
      ${scale(ranked, colors, names, m)}`;
  } else if (!m.g) {
    body = `<p>${L("Non-inscrit : sans groupe, pas de ligne à suivre, donc pas de score.", "Non-attached: no group, no line to follow, so no score.")}${m.n ? L(` Avec son ancien groupe, ce député votait la ligne dans ${pct(m.loyalty!)} des cas (${fmtNum(m.n)} votes).`, ` With their former group, this MP voted the line ${pct(m.loyalty!)} of the time (${fmtNum(m.n)} votes).`) : ""}</p>`;
  } else {
    body = `<p>${L(`Pas assez de votes comptés pour être classé (${m.n}, minimum ${f.minVotes}).`, `Not enough counted votes to be ranked (${m.n}, minimum ${f.minVotes}).`)}${m.loyalty != null ? L(` Score provisoire : ${pct(m.loyalty)}.`, ` Provisional score: ${pct(m.loyalty)}.`) : ""}</p>`;
  }
  const moved = m.moved
    ? `<p class="muted small">${L("A voté sous plusieurs étiquettes :", "Voted under more than one label:")} ${m.moved.map(([g, k]) => `${esc(g)} (${fmtNum(k)})`).join(", ")}. ${L("Chaque vote est comparé au groupe du moment ; les votes comme non-inscrit ne comptent pas.", "Each vote is compared with the group at the time; votes cast as non-attached are not counted.")}</p>`
    : "";
  const top = m.top.slice(0, 5);
  const list = top.length
    ? `<h3>${L("Ses écarts les plus marquants", "Most notable breaks")}</h3>
      <p class="muted small">${L("Les votes où le reste du groupe était le plus uni.", "Votes where the rest of the group was most united.")}</p>
      <ul class="votes loy-rebels">${top
        .map(([num, mine, line, coh, others]) => {
          const s = byNum.get(num);
          return `<li>
            <div class="vote-meta muted small">${s ? `${fmtDate(s[1])} · ` : ""}n° ${num}</div>
            <div class="vote-title"><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${num}" target="_blank" rel="noopener">${esc(s?.[2] ?? L(`Scrutin n° ${num}`, `Vote no. ${num}`))}</a></div>
            <div class="small">${L("Groupe :", "Group:")} <b class="pos-${line}">${esc(posLabel(line))}</b> ${L(`(${pct(coh, 0)} des ${others} collègues votants)`, `(${pct(coh, 0)} of ${others} colleagues voting)`)} · ${L("Ce député :", "This MP:")} <b class="pos-${mine}">${esc(posLabel(mine))}</b></div>
          </li>`;
        })
        .join("")}</ul>`
    : m.g ? `<p class="muted small">${L("Aucun écart avec son groupe.", "Never broke with the group.")}</p>` : "";
  return `<div class="card loy-mp">${head}${body}${moved}${list}${methodNote(f)}</div>`;
}
