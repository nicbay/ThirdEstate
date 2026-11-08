// Town page, local politics and news: municipal elections (2026 vs 2020), how the town council
// votes (where the city publishes it), campaign promises (when available), the department's
// senators, and local news from regional press.
// Data: scripts/sync-municipal*.mjs, scripts/sync-senat.mjs, scripts/sync-local-news.mjs.
import { fetchJson } from "../data";
import { L, colon, fmtDate, fmtNum, getLang, plural } from "../i18n";
import { esc, safeColor, safeUrl } from "../util";
import { loadSenateurs, senPhoto } from "./senat";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const cache = new Map<string, Promise<Any>>();
const once = (url: string) => {
  if (!cache.has(url)) cache.set(url, fetchJson<Any>(url).catch(() => null));
  return cache.get(url)!;
};

/** Council votes and campaign promises exist for a handful of towns only. Their index files (written by
 *  scripts/sync-municipal-councils.mjs and sync-municipal-promises.mjs) say which, so a town page never
 *  requests a file that isn't there. */
async function optionalFiles(code: string): Promise<[Any, Any]> {
  const [councils, promises] = await Promise.all([once("/data/municipal/councils/index.json"), once("/data/municipal/promises/index.json")]);
  const hasCouncil = (councils?.covered ?? []).some((c: Any) => c.code === code);
  const hasPromises = (promises?.rows ?? []).some((r: Any) => r.code === code && r.status === "summarised");
  return Promise.all([hasCouncil ? once(`/data/municipal/councils/${code}.json`) : null, hasPromises ? once(`/data/municipal/promises/${code}.json`) : null]);
}

export async function renderTownLocal(box: HTMLElement, code: string, dep: string) {
  const [muni, fams, news, [council, promises], sens] = await Promise.all([
    once(`/data/municipal/${dep}.json`),
    once("/data/municipal/families.json"),
    once(`/data/news/${dep}.json`),
    optionalFiles(code),
    loadSenateurs().catch(() => [] as Any[]),
  ]);
  const fr = getLang() === "fr";
  const F = fams?.families ?? {};
  const famColor = (f?: string) => safeColor(F[f ?? ""]?.color, "#a3a7ae");
  const famName = (f?: string) => (f && F[f] && f !== "unclassified" ? (fr ? F[f].fr : F[f].en) : L("sans étiquette attribuée", "no label assigned"));
  const c = muni?.communes?.[code];
  const items: Any[] = news?.communes?.[code] ?? [];
  const mySens = (sens as Any[]).filter((s) => s.numDepartement === dep || s.codeCirconscription === dep);
  const parts: string[] = [];

  // ---------- local news ----------
  parts.push(`<section class="card">
    <header class="card-head"><h2>${L("L’actualité locale", "Local news")}</h2><span class="muted small">${L("presse régionale, 14 derniers jours", "regional press, last 14 days")}</span></header>
    ${
      items.length
        ? `<ul class="events">${items.slice(0, 8).map((n) => `<li><span class="muted small">${esc(n.outlet)}, ${fmtDate(n.time)}</span><br><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a>${n.summary ? `<br><span class="small muted">${esc(String(n.summary).slice(0, 180))}</span>` : ""}</li>`).join("")}</ul>`
        : `<p class="muted small">${L("Aucun article récent ne mentionne la commune dans les flux de la presse régionale suivis.", "No recent article in the regional press feeds we follow mentions this town.")}</p>`
    }
  </section>`);

  // ---------- municipal elections ----------
  if (c?.y2026) {
    const y = c.y2026;
    const decisive = y.rounds?.find((r: Any) => r.round === y.decidedRound) ?? y.rounds?.at(-1);
    const lists = [...(decisive?.lists ?? [])].sort((a: Any, b: Any) => (b.votes ?? 0) - (a.votes ?? 0));
    const w = y.winner;
    const prev = Array.isArray(c.y2020) ? c.y2020[0] : c.y2020;
    const prevRound = prev?.rounds?.at(-1);
    const prevWinner = prevRound?.lists ? [...prevRound.lists].sort((a: Any, b: Any) => (b.seats ?? 0) - (a.seats ?? 0) || (b.votes ?? 0) - (a.votes ?? 0))[0] : null;
    parts.push(`<section class="card">
      <header class="card-head"><h2>${L("Élections municipales 2026", "2026 municipal elections")}</h2><span class="muted small">${y.decidedRound === 1 ? L("élue au 1er tour", "won in the first round") : L("2nd tour", "runoff")}${decisive?.turnoutPct != null ? `, ${L("participation", "turnout")} ${decisive.turnoutPct.toFixed(1)} %` : ""}</span></header>
      ${w ? `<p class="lead-result" style="--c:${famColor(w.family)}"><b>${esc(w.label ?? "")}</b>${w.head?.name ? `, ${L("menée par", "led by")} ${esc(titleName(w.head.name))}` : ""}<br><span class="small">${esc(famName(w.family))}${w.nuance ? ` (${esc(w.nuance)})` : ""}, ${w.seats ?? "?"} ${L("sièges sur", "seats out of")} ${c.seats ?? "?"}</span></p>` : ""}
      <ol class="bars">${lists
        .slice(0, 8)
        .map((l: Any) => `<li><div class="bar-label"><span>${esc(l.label ?? l.head?.name ?? "")} <span class="muted small">${l.head?.name ? esc(titleName(l.head.name)) : ""}${l.family && l.family !== "unclassified" ? `, ${esc(famName(l.family))}` : ""}</span></span><b>${(l.pctExpressed ?? 0).toFixed(1)} %</b></div><div class="bar"><div style="width:${l.pctExpressed ?? 0}%;background:${famColor(l.family)}"></div></div></li>`)
        .join("")}</ol>
      ${prevWinner ? `<p class="muted small">${L("En 2020", "In 2020")}${colon()}${esc(prevWinner.label ?? "")}${prevWinner.head?.name ? ` (${esc(titleName(prevWinner.head.name))})` : ""}, ${esc(famName(prevWinner.family))}.${prevWinner.family && w?.family && prevWinner.family !== w.family && prevWinner.family !== "unclassified" && w.family !== "unclassified" ? ` <b>${L("La mairie a changé de camp.", "The town hall changed hands.")}</b>` : ""}</p>` : ""}
      <p class="muted tiny">${L("Étiquettes politiques attribuées par le ministère de l’Intérieur aux listes des communes de 3 500 habitants et plus. Le maire est élu ensuite par le conseil municipal.", "Political labels assigned by the Ministry of the Interior to lists in towns of 3,500+. The mayor is then elected by the town council.")}</p>
    </section>`);
  }

  // ---------- campaign promises ----------
  // file shape (scripts/sync-municipal-promises.mjs): { summary: { bullets: [{ fr, en, theme }], label }, source: { pdf } }
  const bullets: Any[] = promises?.summary?.bullets ?? [];
  if (bullets.length) {
    parts.push(`<section class="card"><header class="card-head"><h2>${L("Les promesses de la liste élue", "The winning list’s promises")}</h2><span class="tag">${L("résumé par IA", "AI summary")}</span></header>
      <ul class="positives">${bullets.map((p: Any) => `<li>${esc(fr ? p.fr : p.en ?? p.fr)}</li>`).join("")}</ul>
      ${promises.summary.label ? `<p class="muted tiny">${esc(fr ? promises.summary.label.fr : promises.summary.label.en)}</p>` : ""}
      ${promises.source?.pdf ? `<p class="source"><a href="${esc(safeUrl(promises.source.pdf))}" target="_blank" rel="noopener">${L("Profession de foi officielle", "Official campaign leaflet")}</a></p>` : ""}</section>`);
  } else if (c?.population >= 2500) {
    parts.push(`<p class="muted small">${L("Les professions de foi des listes sont consultables sur", "The lists’ campaign leaflets can be read on")} <a href="https://programme-candidats.interieur.gouv.fr/" target="_blank" rel="noopener">programme-candidats.interieur.gouv.fr</a>.</p>`);
  }

  // ---------- how the council votes ----------
  if (council?.deliberations?.length && council.granularity !== "outcome") {
    const groups: Any[] = council.groups ?? [];
    const tally = new Map<string, { for: number; against: number; abstain: number; nv: number }>();
    for (const d of council.deliberations) for (const [g, v] of Object.entries<Any>(d.byGroup ?? {})) {
      const t = tally.get(g) ?? { for: 0, against: 0, abstain: 0, nv: 0 };
      if (v.position === "for") t.for++; else if (v.position === "against") t.against++; else if (v.position === "abstain") t.abstain++; else t.nv++;
      tally.set(g, t);
    }
    const contested = council.deliberations.filter((d: Any) => !d.unanimous).slice(0, 6);
    parts.push(`<section class="card">
      <header class="card-head"><h2>${L("Comment vote le conseil municipal", "How the town council votes")}</h2><span class="muted small">${fmtNum(council.deliberations.length)} ${plural(council.deliberations.length, ["délibération", "délibérations"], ["decision", "decisions"])}</span></header>
      <table class="table"><thead><tr><th>${L("Groupe", "Group")}</th><th class="num">${L("Pour", "For")}</th><th class="num">${L("Contre", "Against")}</th><th class="num">${L("Abst.", "Abst.")}</th></tr></thead><tbody>${groups
        .map((g) => { const t = tally.get(g.name) ?? { for: 0, against: 0, abstain: 0, nv: 0 }; return `<tr><td><i class="dot" style="background:${famColor(g.family)}"></i>${esc(g.name)}</td><td class="num">${t.for}</td><td class="num">${t.against}</td><td class="num">${t.abstain}</td></tr>`; })
        .join("")}</tbody></table>
      ${contested.length ? `<h3>${L("Derniers votes disputés", "Latest contested votes")}</h3><ul class="events">${contested.map((d: Any) => `<li><span class="muted small">${fmtDate(d.date)}, ${esc(d.outcomeLabel ?? d.outcome ?? "")}</span><br>${esc(d.title)}<br><span class="small">${Object.entries<Any>(d.byGroup ?? {}).map(([g, v]) => `${esc(g.split(",")[0])}${colon()}<b>${esc(v.position === "for" ? L("pour", "for") : v.position === "against" ? L("contre", "against") : v.position === "abstain" ? L("abstention", "abstain") : L("ne vote pas", "not voting"))}</b>`).join(" ; ")}</span></li>`).join("")}</ul>` : ""}
      <p class="muted tiny">${L("Source : open data de la ville. Le vote « pour » est déduit quand un groupe n’est cité ni contre ni en abstention.", "Source: the city’s open data. A “for” vote is inferred when a group isn’t listed as against or abstaining.")}</p>
    </section>`);
  }

  // ---------- senators of the department ----------
  if (mySens.length) {
    parts.push(`<section class="card"><header class="card-head"><h2>${L("Vos sénateurs", "Your senators")}</h2><a href="#/senat">${L("Tout le Sénat", "The whole Senate")}</a></header>
      <div class="grid-2">${mySens.map((s: Any) => `<a class="mp-mini" href="#/senateur/${esc(s.id)}" style="--c:${safeColor(s.groupe?.couleur)}"><img src="${senPhoto(s)}" alt="" loading="lazy" data-hide-broken/><span><b>${esc(s.prenom)} ${esc(s.nom)}</b> <span class="chip">${esc(s.groupe?.abrev ?? "")}</span><br><span class="small muted">${s.stats ? `${fmtNum(s.stats.pour)} ${L("pour", "for")}, ${fmtNum(s.stats.contre)} ${L("contre", "against")}` : ""}</span></span></a>`).join("")}</div></section>`);
  }
  box.innerHTML = parts.join("");
}

const titleName = (n: string) => n.replace(/\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'-]+)\b/g, (w) => (w.length > 1 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w));
