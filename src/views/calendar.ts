// Campaign calendar (#/2027/calendrier): a timeline of public/data/2027/calendar.json, with a countdown to
// the first round, the next item highlighted and past items muted. "expected" = announced by the government
// or derived from the law, pending the decree calling voters; "confirmed" = happened or legally fixed.
// "proposed" = floated by a candidate or party, not agreed (e.g. the centre and right primary).
import "../styles/civic.css";
import { fetchJson } from "../data";
import { L, colon, fmtNum, plural } from "../i18n";
import { esc, safeUrl } from "../util";

type Kind = "deadline" | "vote" | "debate" | "official" | "other";
interface Item {
  date: string;
  end?: string;
  kind: Kind;
  status: "confirmed" | "expected" | "proposed";
  round?: number;
  fr: string;
  en: string;
  basis?: { fr: string; en: string };
  source: { url: string; title: string; publisher: string };
}
interface Calendar {
  updated: string;
  decree?: { published: boolean; fr: string; en: string };
  items: Item[];
}

const KINDS: [Kind, () => string][] = [
  ["vote", () => L("Scrutins", "Votes")],
  ["deadline", () => L("Échéances", "Deadlines")],
  ["official", () => L("Étapes officielles", "Official steps")],
  ["debate", () => L("Débats", "Debates")],
];

/** Local calendar date as YYYY-MM-DD (not UTC: a reader in France at 00:30 is already on the next day). */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const daysBetween = (from: string, to: string) => Math.round(dayNum(to) - dayNum(from));
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(L("fr-FR", "en-GB"), { weekday: "short", day: "numeric", month: "long", year: "numeric" });
const range = (it: Item) => (it.end && it.end !== it.date ? `${longDate(it.date)} → ${longDate(it.end)}` : longDate(it.date));

export async function renderCalendar(app: HTMLElement) {
  app.innerHTML = `<section class="page narrow cv-page"><p class="muted">${L("Chargement du calendrier…", "Loading the calendar…")}</p></section>`;
  let cal: Calendar;
  try {
    cal = await fetchJson<Calendar>("/data/2027/calendar.json");
  } catch {
    app.innerHTML = `<section class="page narrow cv-page"><p>${L("Le calendrier n’a pas pu être chargé. Réessayez dans un instant.", "The calendar could not be loaded. Please try again shortly.")}</p></section>`;
    return;
  }
  const items = [...cal.items].sort((a, b) => a.date.localeCompare(b.date));
  const today = todayIso();
  const isPast = (it: Item) => (it.end ?? it.date) < today;
  const next = items.find((it) => !isPast(it));
  const first = items.find((it) => it.kind === "vote" && it.round === 1);
  const days = first ? daysBetween(today, first.date) : null;
  const sources = [...new Map(items.map((it) => [it.source.url, it.source])).values()];

  const countdown = first && days !== null && days >= 0
    ? `<div class="cv-count-box"><span>${L("Premier tour dans", "First round in")}</span><b>${days === 0 ? L("Aujourd’hui", "Today") : `${fmtNum(days)} ${plural(days, ["jour", "jours"], ["day", "days"])}`}</b><span>${esc(longDate(first.date))}${first.status === "expected" ? ` · ${L("date prévue", "expected date")}` : ""}</span></div>`
    : "";
  const nextBox = next
    ? `<div class="cv-count-box next"><span>${L("Prochaine étape", "Next up")} · ${esc(range(next))}</span><b>${esc(L(next.fr, next.en))}</b></div>`
    : "";

  const row = (it: Item) => {
    const past = isPast(it);
    const isNext = it === next;
    const ongoing = !past && it.date <= today;
    const tag = isNext
      ? `<span class="cv-tag next">${ongoing ? L("En cours", "Now") : L("Prochaine étape", "Next")}</span>`
      : "";
    const status = `<span class="cv-tag ${it.status}">${it.status === "confirmed" ? L("Confirmé", "Confirmed") : it.status === "proposed" ? L("Proposé", "Proposed") : L("Prévu", "Expected")}</span>`;
    const left = !past && !ongoing ? daysBetween(today, it.date) : null;
    const inDays = left !== null && left > 0 ? `<span>${L("dans", "in")} ${fmtNum(left)} ${plural(left, ["jour", "jours"], ["day", "days"])}</span>` : "";
    const basis = it.basis ? `<p class="cv-basis">${esc(L(it.basis.fr, it.basis.en))}</p>` : "";
    return `<li class="k-${esc(it.kind)}${past ? " past" : ""}${isNext ? " is-next" : ""}" data-kind="${esc(it.kind)}">
      <div class="cv-tl-body">
        <p class="cv-tl-date"><time datetime="${esc(it.date)}">${esc(range(it))}</time> ${tag} ${status} ${inDays}</p>
        <p class="cv-tl-title">${esc(L(it.fr, it.en))}</p>
        ${basis}
        <p class="cv-src">Source${colon()}<a href="${esc(safeUrl(it.source.url))}" target="_blank" rel="noopener">${esc(it.source.title)}</a> — ${esc(it.source.publisher)}</p>
      </div>
    </li>`;
  };

  app.innerHTML = `
    <section class="page narrow cv-page">
      <div class="page-head">
        <p class="crumbs"><a href="#/2027">${L("Présidentielle 2027", "2027 presidential election")}</a></p>
        <p class="eyebrow">${L("Calendrier", "Calendar")}</p>
        <h1>${L("Le calendrier de la campagne", "The campaign calendar")}</h1>
        <p class="dek">${L("Des parrainages au second tour, les dates qui comptent, chacune avec sa source. Les étapes passées sont estompées.", "From sponsorships to the run-off, the dates that matter, each with its source. Past steps are faded.")}</p>
      </div>

      <div class="cv-count">${countdown}${nextBox}</div>

      ${cal.decree && !cal.decree.published ? `<p class="cv-note"><b>${L("Dates prévues, pas encore officielles.", "Expected dates, not yet official.")}</b> ${esc(L(cal.decree.fr, cal.decree.en))}</p>` : ""}

      <section class="card">
        <header class="card-head"><h2>${L("Chronologie", "Timeline")}</h2></header>
        <div class="cv-filters" role="group" aria-label="${L("Filtrer", "Filter")}">
          <button type="button" data-k="all" aria-pressed="true">${L("Tout", "All")}</button>
          ${KINDS.map(([k, label]) => `<button type="button" data-k="${k}" aria-pressed="false">${label()}</button>`).join("")}
        </div>
        <ol class="cv-tl">${items.map(row).join("")}</ol>
        <p class="muted small">${L("Aucun débat télévisé entre les candidats officiels n’a encore de date annoncée ; ils seront ajoutés ici dès qu’ils le seront.", "No TV debate between the official candidates has an announced date yet; they will be added here when they do.")}</p>
      </section>

      <section class="cv-sources card">
        <header class="card-head"><h2>${L("Sources", "Sources")}</h2></header>
        <ol>${sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a> — ${esc(s.publisher)}</li>`).join("")}</ol>
        <p class="muted small">${L("Mis à jour le ", "Updated ")}${esc(longDate(cal.updated))}. <a href="#/2027/comment-ca-marche">${L("Comment ça marche", "How it works")}</a> · <a href="#/2027/voter">${L("Voter en 2027", "Voting in 2027")}</a></p>
      </section>
    </section>`;

  const buttons = app.querySelectorAll<HTMLButtonElement>(".cv-filters button");
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.k!;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      app.querySelectorAll<HTMLLIElement>(".cv-tl li").forEach((li) => (li.hidden = k !== "all" && li.dataset.kind !== k));
    }),
  );
}
