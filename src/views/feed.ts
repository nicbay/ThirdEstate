// Red feed / blue feed: the news stories of the last few days, and how MPs reacted on social
// media — left-leaning reactions in the red column, right-leaning in the blue one, as rated by AI
// from each post's content. Claims the AI doubts are flagged "à vérifier", never "false".
import { loadFeed, type FeedReaction, type FeedStory } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { esc, safeUrl, safeColor } from "../util";

const ui = { populist: false, checks: false };
const RED = "#d4253a", BLUE = "#1f5fcf";

export async function renderFeed(app: HTMLElement) {
  const feed = await loadFeed();
  const outletName = new Map(feed.outlets.map((o) => [o.id, o.name]));
  const fr = getLang() === "fr";

  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Fil rouge, fil bleu", "Red feed, blue feed")}</p>
        <h1>${L("L’actualité, et ce qu’en disent les députés à gauche et à droite", "The news, and what MPs on the left and right say about it")}</h1>
        <p class="dek">${L(
          `Les sujets des ${feed.windowHours} dernières heures dans la presse, et les réactions des députés sur les réseaux sociaux. Chaque réaction est classée de gauche à droite d’après son contenu, pas d’après le parti de son auteur.`,
          `The stories of the last ${feed.windowHours} hours in the press, and MPs’ reactions on social media. Each reaction is placed left or right from what it says, not from its author’s party.`,
        )}</p>
        <div class="filters">
          <label class="check"><input type="checkbox" id="f-pop" ${ui.populist ? "checked" : ""}/> ${L("Seulement les réactions au ton populiste", "Only reactions with a populist tone")}</label>
          <label class="check"><input type="checkbox" id="f-chk" ${ui.checks ? "checked" : ""}/> ${L("Seulement les affirmations à vérifier", "Only claims to verify")}</label>
        </div>
      </header>
      <div class="feed-cols-head"><span style="--c:${RED}">${L("Fil rouge : réactions de gauche", "Red feed: left-leaning reactions")}</span><span style="--c:${BLUE}">${L("Fil bleu : réactions de droite", "Blue feed: right-leaning reactions")}</span></div>
      <div id="stories"></div>
      <p class="source">${L(
        `Mis à jour le ${fmtDate(feed.generatedAt)}. Presse : flux RSS publics (titres et liens). Réactions : Bluesky, YouTube, Mastodon et quelques messages X repris dans la presse ; X n’est pas lu directement car son accès est payant. Classement par Claude Haiku 5.5 : une IA peut se tromper, chaque note est expliquée.`,
        `Updated ${fmtDate(feed.generatedAt)}. Press: public RSS feeds (headlines and links). Reactions: Bluesky, YouTube, Mastodon and some X posts quoted in the press; X itself isn’t read because access is paid. Rated by Claude Haiku 5.5: an AI can be wrong, and every rating is explained.`,
      )} <a href="#/sources">${L("Méthode", "Method")}</a></p>
    </section>`;

  const keep = (r: FeedReaction) => r.rating?.political !== false && (!ui.populist || (r.rating?.populism.score ?? 0) >= 0.5) && (!ui.checks || !!r.rating?.check);
  const draw = () => {
    const stories = feed.stories
      .map((s) => ({ s, rs: (s.reactions ?? []).filter((r) => r.rating && keep(r)) }))
      .filter((x) => x.rs.length)
      .sort((a, b) => b.s.lastTime.localeCompare(a.s.lastTime));
    app.querySelector("#stories")!.innerHTML = stories.length
      ? stories.map(({ s, rs }) => storyBlock(s, rs, outletName, fr)).join("")
      : `<p class="muted">${L("Aucune réaction ne correspond à ces filtres pour le moment.", "No reactions match these filters right now.")}</p>`;
  };
  app.querySelector<HTMLInputElement>("#f-pop")!.addEventListener("change", (e) => { ui.populist = (e.target as HTMLInputElement).checked; draw(); });
  app.querySelector<HTMLInputElement>("#f-chk")!.addEventListener("change", (e) => { ui.checks = (e.target as HTMLInputElement).checked; draw(); });
  draw();
}

function storyBlock(s: FeedStory, rs: FeedReaction[], outletName: Map<string, string>, fr: boolean) {
  const lead = s.items[0];
  const left = rs.filter((r) => r.rating!.lean.score < 0).sort((a, b) => a.rating!.lean.score - b.rating!.lean.score);
  const right = rs.filter((r) => r.rating!.lean.score >= 0).sort((a, b) => b.rating!.lean.score - a.rating!.lean.score);
  return `
    <article class="story">
      <header>
        <h2><a href="${esc(safeUrl(lead.link))}" target="_blank" rel="noopener">${esc(lead.title)}</a></h2>
        <p class="muted small">${s.outlets.map((o) => esc(outletName.get(o) ?? o)).join(", ")}${s.items.length > 1 ? ` (${s.items.length} ${L("articles", "articles")})` : ""}, ${fmtDate(s.lastTime)}</p>
      </header>
      <div class="feed-cols">
        <div class="col-red">${left.map((r) => reaction(r, fr)).join("") || `<p class="muted small">${L("Pas de réaction de gauche.", "No left-leaning reaction.")}</p>`}</div>
        <div class="col-blue">${right.map((r) => reaction(r, fr)).join("") || `<p class="muted small">${L("Pas de réaction de droite.", "No right-leaning reaction.")}</p>`}</div>
      </div>
    </article>`;
}

const PLATFORM: Record<string, string> = { bluesky: "Bluesky", youtube: "YouTube", mastodon: "Mastodon", twitter: "X", x: "X" };

function reaction(r: FeedReaction, fr: boolean) {
  const rt = r.rating!;
  const lean = rt.lean.score; // -1 left … +1 right
  const pop = rt.populism.score;
  return `
    <div class="reaction">
      <p class="who"><a href="#/depute/${esc(r.mp.id)}"><b>${esc(r.mp.name)}</b></a> ${r.mp.group ? `<span class="chip" style="--c:${safeColor(r.mp.group.couleur)}">${esc(r.mp.group.abrev)}</span>` : ""} <span class="muted small">${esc(PLATFORM[r.platform] ?? r.platform)}, ${fmtDate(r.time)}</span></p>
      <blockquote>${esc(r.text.length > 420 ? r.text.slice(0, 420) + "…" : r.text)}</blockquote>
      <div class="meters small">
        <span class="meter" data-tip="${esc(fr ? rt.lean.rationale_fr : rt.lean.rationale_en)}"><span class="meter-track"><i style="left:${((lean + 1) / 2) * 100}%"></i></span>${L("Gauche", "Left")} / ${L("droite", "right")}</span>
        <span data-tip="${esc(fr ? rt.populism.rationale_fr : rt.populism.rationale_en)}">${L("Populisme", "Populism")} <b>${Math.round(pop * 10)}/10</b>${rt.populism.markers.length ? ` (${esc(rt.populism.markers.join(", "))})` : ""}</span>
        <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${L("Voir le message", "See the post")}</a>
      </div>
      ${
        rt.check
          ? `<div class="verify"><b>${L("À vérifier :", "To verify:")}</b> « ${esc(rt.check.claim)} » ${esc(fr ? rt.check.why_fr : rt.check.why_en)}${rt.check.sources.length ? ` <span class="small">${rt.check.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("; ")}</span>` : ""}</div>`
          : ""
      }
    </div>`;
}
