// "Du nouveau aujourd'hui": a small box at the top of the homepage that says, in three lines, whether there are new
// polls, new programme pieces and the day's main event. Everything is read from the data files at page load, so the
// box can never go stale on its own: when no poll has come out, it says since when.
//   polls:      public/data/polls/2027.json (fieldwork ended in the last 3 days, latest first)
//   programmes: public/data/programmes/updates.json (dated log, written when a candidate publishes: own documents only)
//   events:     the latest edition (public/data/daily/editions/<date>.json): the day's French story and the surprise
import { fetchJson, loadPolls } from "../data";
import { L, fmtDate } from "../i18n";
import { esc, safeUrl } from "../util";

type T = { fr: string; en: string };
type ProgUpdate = { date: string; slug: string; candidate: string; fr: string; en: string; url?: string };
type EdLite = { date: string; ledger?: { france?: { title: string; link?: string } | null } | null; insight?: { surprise?: { fr: string; en: string } | null } | null };

const DAY = 86400000;
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY);
const short = (iso: string) => fmtDate(iso).replace(/\s\d{4}$/, "");

export async function mountDayUpdates(box: HTMLElement) {
  const [polls, progs, idx] = await Promise.all([
    loadPolls("2027").catch(() => null),
    fetchJson<{ updates: ProgUpdate[] }>("/data/programmes/updates.json").catch(() => ({ updates: [] })),
    fetchJson<{ date: string; head: T }[]>("/data/daily/editions/index.json").catch(() => null),
  ]);
  const ed = idx?.length ? await fetchJson<EdLite>(`/data/daily/editions/${idx.at(-1)!.date}.json`).catch(() => null) : null;

  // ---- polls: every poll whose fieldwork ended in the last 3 days; else how long since the last one
  const fr = [...(polls?.firstRound ?? [])].sort((a, b) => b.end.localeCompare(a.end));
  const fresh = fr.filter((p) => daysAgo(p.end) <= 3);
  const pollLink = (p: (typeof fr)[number]) => `${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.pollster)}</a>` : esc(p.pollster)} <span class="du-d">${esc(short(p.end))}</span>`;
  const pollsHtml = fresh.length
    ? `<b>${fresh.length} ${L(fresh.length > 1 ? "nouveaux sondages" : "nouveau sondage", fresh.length > 1 ? "new polls" : "new poll")}</b> · ${fresh.map(pollLink).join(", ")} · <a href="#/sondages">${L("Tous les sondages", "All polls")}</a>`
    : fr[0]
      ? `${L("Pas de nouveau sondage depuis le", "No new poll since")} ${esc(short(fr[0].end))} (${pollLink(fr[0])})`
      : L("Aucun sondage chargé", "No polls loaded");

  // ---- programmes: pieces published in the last 7 days, newest first
  const newProgs = progs.updates.filter((u) => daysAgo(u.date) <= 7).sort((a, b) => b.date.localeCompare(a.date));
  const progHtml = newProgs.length
    ? newProgs.map((u) => `<a href="#/programmes/${esc(u.slug)}"><b>${esc(u.candidate)}</b></a>${L(" : ", ": ")}${esc(L(u.fr, u.en))} <span class="du-d">${esc(short(u.date))}</span>${u.url ? ` <a class="du-src" href="${esc(safeUrl(u.url))}" target="_blank" rel="noopener">${L("source", "source")}</a>` : ""}`).join("<br>")
    : `${L("Rien de nouveau cette semaine", "Nothing new this week")} · <a href="#/programmes">${L("Les programmes", "The programs")}</a>`;

  // ---- the day's events: the main French story, and the surprise of the day when there is one
  const ev: string[] = [];
  const fra = ed?.ledger?.france;
  if (fra?.title) ev.push(fra.link ? `<a href="${esc(safeUrl(fra.link))}" target="_blank" rel="noopener">${esc(fra.title)}</a>` : esc(fra.title));
  const s = ed?.insight?.surprise;
  if (s) ev.push(esc(L(s.fr, s.en)));
  const evHtml = ev.length ? ev.join("<br>") : L("Rien de marquant pour l’instant", "Nothing major so far");

  const row = (k: string, on: boolean, html: string) => `<li class="${on ? "is-new" : ""}"><span class="du-k">${k}</span><span class="du-v">${html}</span></li>`;
  box.innerHTML = `
    <div class="ed-nav"><span></span><p class="ed-k"><b>${L("Du nouveau aujourd’hui", "What’s new today")}</b><span>${esc(fmtDate(new Date().toISOString()))}</span></p><span></span></div>
    <ul class="du-list">
      ${row(L("Sondages", "Polls"), fresh.length > 0, pollsHtml)}
      ${row(L("Programmes", "Programs"), newProgs.length > 0, progHtml)}
      ${row(L("À la une", "Top story"), ev.length > 0, evHtml)}
    </ul>`;
}
