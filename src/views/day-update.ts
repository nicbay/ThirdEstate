// The update of the day, right under the homepage chart: one card per candidate the markets take seriously, with
// their chance of winning on the prediction markets (Kalshi and Polymarket together), how it moved in 24 hours and
// in 7 days, their polling average and its weekly move, and the headlines about them that most outlets ran.
// Everything comes from the once-a-day brief (/data/daily/latest.json, scripts/daily-brief.ts): no text blocks,
// figures and short lines a reader can scan.
import { fetchJson } from "../data";
import { L, fmtDate } from "../i18n";
import { meta } from "../lib/candidates";
import { dec } from "../lib/format";
import { esc, safeUrl } from "../util";

interface Src { now: number; d1: number | null; d7: number | null }
interface Row { name: string; polls: Src | null; kalshi: Src | null; poly: Src | null }
interface Headline { title: string; link: string; outlet: string; time: string; n: number }
interface Brief { date: string; rows: Row[]; movers?: { name: string; headlines: Headline[] }[] }

/** The markets' figure: Kalshi and Polymarket averaged (or whichever has the candidate). */
function market(r: Row): Src | null {
  const xs = [r.kalshi, r.poly].filter((x): x is Src => x != null);
  if (!xs.length) return null;
  const avg = (f: (s: Src) => number | null) => { const v = xs.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return { now: avg((s) => s.now)!, d1: avg((s) => s.d1), d7: avg((s) => s.d7) };
}

const chip = (d: number | null, span: string) => {
  if (d == null) return "";
  const cls = Math.abs(d) < 0.05 ? "is-flat" : d > 0 ? "is-up" : "is-down";
  const v = cls === "is-flat" ? "=" : `${d > 0 ? "▲ +" : "▼ −"}${dec(Math.abs(d))}`;
  return `<span class="dup-chip ${cls}"><small>${span}</small>${v}</span>`;
};
const ago = (iso: string) => {
  const h = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 3600000));
  return h < 48 ? L(`il y a ${h} h`, `${h}h ago`) : L(`il y a ${Math.round(h / 24)} j`, `${Math.round(h / 24)}d ago`);
};

export async function drawDayUpdate(box: HTMLElement) {
  const b = await fetchJson<Brief>("/data/daily/latest.json").catch(() => null);
  if (!b?.rows?.length) { box.innerHTML = ""; return; }
  const news = new Map((b.movers ?? []).map((m) => [m.name, m.headlines]));
  const cards = b.rows
    .map((r) => ({ r, m: market(r) }))
    .filter((x): x is { r: Row; m: Src } => x.m != null && x.m.now >= 2)
    .sort((x, y) => y.m.now - x.m.now)
    .slice(0, 6);
  if (!cards.length) { box.innerHTML = ""; return; }
  // the headline: the biggest weekly move on the markets, up and down
  const byMove = [...cards].filter((c) => c.m.d7 != null).sort((x, y) => y.m.d7! - x.m.d7!);
  const up = byMove[0]?.m.d7! >= 1 ? byMove[0] : null, down = byMove.at(-1)?.m.d7! <= -1 ? byMove.at(-1)! : null;
  const sur = (n: string) => esc(meta(n).surname);
  const pts = (v: number) => L(`${dec(Math.abs(v))} point${Math.abs(v) >= 2 ? "s" : ""}`, `${dec(Math.abs(v))} point${Math.abs(v) >= 2 ? "s" : ""}`);
  const head = up && down
    ? L(`Sur les marchés cette semaine : ${sur(up.r.name)} +${pts(up.m.d7!)}, ${sur(down.r.name)} −${pts(down.m.d7!)}`, `On the markets this week: ${sur(up.r.name)} +${pts(up.m.d7!)}, ${sur(down.r.name)} −${pts(down.m.d7!)}`)
    : up ? L(`Sur les marchés cette semaine : ${sur(up.r.name)} +${pts(up.m.d7!)}`, `On the markets this week: ${sur(up.r.name)} +${pts(up.m.d7!)}`)
    : down ? L(`Sur les marchés cette semaine : ${sur(down.r.name)} −${pts(down.m.d7!)}`, `On the markets this week: ${sur(down.r.name)} −${pts(down.m.d7!)}`)
    : L("Les marchés n’ont presque pas bougé cette semaine", "The markets barely moved this week");
  const big = (up ?? down)?.r.name;

  const html = cards.map(({ r, m }) => {
    const c = meta(r.name);
    const hs = (news.get(r.name) ?? []).slice(0, 2);
    return `<li class="dup-card${r.name === big ? " is-big" : ""}" style="--c:${c.color}">
      <p class="dup-name"><i></i>${esc(c.surname)}${r.name === big ? `<span class="dup-tag">${L("Plus gros mouvement", "Biggest move")}</span>` : ""}</p>
      <p class="dup-big">${dec(m.now)}<small> %</small></p>
      <p class="dup-lab">${L("chance de victoire, marchés", "chance of winning, markets")}</p>
      <p class="dup-chips">${chip(m.d1, L("24 h", "24h"))}${chip(m.d7, L("7 j", "7d"))}</p>
      ${r.polls ? `<p class="dup-polls">${L("Sondages", "Polls")} <b>${dec(r.polls.now)} %</b>${chip(r.polls.d7, L("7 j", "7d"))}</p>` : `<p class="dup-polls muted">${L("Pas dans les sondages", "Not in the polls")}</p>`}
      ${hs.length ? `<ul class="dup-news">${hs.map((h) => `<li><a href="${esc(safeUrl(h.link))}" target="_blank" rel="noopener">${esc(h.title)}</a><span>${esc(h.outlet)}${h.n > 1 ? ` · ${h.n} ${L("articles", "articles")}` : ""} · ${ago(h.time)}</span></li>`).join("")}</ul>` : ""}
    </li>`;
  }).join("");

  box.innerHTML = `<section class="dup" aria-labelledby="dup-title">
    <header class="dup-head">
      <p class="dup-k">${L("La mise à jour du jour", "Update of the day")} · ${fmtDate(b.date)}</p>
      <h2 id="dup-title">${head}</h2>
      <p class="dup-src">${L("Chance de victoire sur Kalshi et Polymarket (moyenne), variation sur 24 h et 7 jours · moyenne des sondages · les titres les plus repris sur chaque candidat.", "Chance of winning on Kalshi and Polymarket (averaged), change over 24 hours and 7 days · polling average · the most-run headlines on each candidate.")} <a href="#/sondages#point">${L("Le point complet", "The full brief")} →</a></p>
    </header>
    <ol class="dup-cards">${html}</ol>
  </section>`;
}
