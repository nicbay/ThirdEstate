// Red feed / blue feed: the news stories of the last few days, and what politicians said about them.
// First the X posts the articles themselves quote (embedded or linked by the newsroom: no guessing which
// story they belong to, and X is where much of the right speaks), placed left / centre / right from their
// rated content or else their author's group; then, secondarily, MPs' posts on other networks that link to
// the story or clearly match it. Claims the AI doubts are flagged "à vérifier", never "false".
import { loadFeed, type FeedPress, type FeedReaction, type FeedStory } from "../data";
import { L, fmtDate, getLang } from "../i18n";
import { esc, safeUrl, safeColor } from "../util";

const ui = { populist: false, checks: false };
type Side = "left" | "centre" | "right";
const SIDE_LABEL: Record<Side, [string, string]> = { left: ["À gauche", "On the left"], centre: ["Au centre", "In the centre"], right: ["À droite", "On the right"] };

export async function renderFeed(app: HTMLElement) {
  const feed = await loadFeed();
  const outletName = new Map(feed.outlets.map((o) => [o.id, o.name]));
  const fr = getLang() === "fr";

  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("Fil rouge, fil bleu", "Red feed, blue feed")}</p>
        <h1>${L("L’actualité, et ce qu’en disent les responsables politiques à gauche et à droite", "The news, and what politicians on the left and right say about it")}</h1>
        <p class="dek">${L(
          `Les sujets des ${feed.windowHours} dernières heures dans la presse, avec les messages X que les articles eux-mêmes citent : c’est la rédaction qui les relie au sujet. Chaque message est placé à gauche, au centre ou à droite d’après son contenu quand il a été analysé, sinon d’après le groupe ou le parti de son auteur.`,
          `The stories of the last ${feed.windowHours} hours in the press, with the X posts the articles themselves quote: the newsroom ties them to the story. Each post is placed left, centre or right from its content when it has been rated, otherwise from its author’s group or party.`,
        )}</p>
        <div class="filters">
          <label class="check"><input type="checkbox" id="f-pop" ${ui.populist ? "checked" : ""}/> ${L("Seulement les messages au ton populiste", "Only posts with a populist tone")}</label>
          <label class="check"><input type="checkbox" id="f-chk" ${ui.checks ? "checked" : ""}/> ${L("Seulement les affirmations à vérifier", "Only claims to verify")}</label>
        </div>
      </header>
      <div id="stories"></div>
      <p class="source">${L(
        `Mis à jour le ${fmtDate(feed.generatedAt)}. Presse : flux RSS publics ; les messages X sont ceux intégrés ou liés dans les articles (X n’est pas lu directement, son accès est payant). Quelques réactions de députés sur Bluesky, YouTube ou Mastodon s’y ajoutent quand elles renvoient à l’article ou correspondent nettement au sujet, jamais plus nombreuses que les messages cités par la presse. Analyse du contenu par Claude Haiku 5.5 : une IA peut se tromper, chaque note est expliquée.`,
        `Updated ${fmtDate(feed.generatedAt)}. Press: public RSS feeds; the X posts are those embedded in or linked from the articles (X itself isn’t read because access is paid). A few MPs’ posts on Bluesky, YouTube or Mastodon are added when they link to the article or clearly match the story, never outnumbering the posts the press quoted. Content rated by Claude Haiku 5.5: an AI can be wrong, and every rating is explained.`,
      )} <a href="#/sources">${L("Méthode", "Method")}</a></p>
    </section>`;

  const filtering = () => ui.populist || ui.checks;
  const keepRated = (r: FeedReaction["rating"] | null | undefined) =>
    !!r && r.political !== false && (!ui.populist || (r.populism.score ?? 0) >= 0.5) && (!ui.checks || !!r.check);
  // unrated press posts only drop out when a content filter is on
  const keepPress = (p: FeedPress) => (filtering() ? keepRated(p.rating) : p.rating?.political !== false);
  const draw = () => {
    const stories = feed.stories
      .filter((s) => s.political !== false)
      .map((s) => ({ s, ps: (s.press ?? []).filter(keepPress), rs: (s.reactions ?? []).filter((r) => keepRated(r.rating)) }))
      .filter((x) => x.ps.length || x.rs.length)
      .sort((a, b) => b.s.lastTime.localeCompare(a.s.lastTime));
    app.querySelector("#stories")!.innerHTML = stories.length
      ? stories.map(({ s, ps, rs }) => storyBlock(s, ps, rs, outletName, fr)).join("")
      : `<p class="muted">${L("Aucun message ne correspond à ces filtres pour le moment.", "No posts match these filters right now.")}</p>`;
  };
  app.querySelector<HTMLInputElement>("#f-pop")!.addEventListener("change", (e) => { ui.populist = (e.target as HTMLInputElement).checked; draw(); });
  app.querySelector<HTMLInputElement>("#f-chk")!.addEventListener("change", (e) => { ui.checks = (e.target as HTMLInputElement).checked; draw(); });
  draw();
}

function storyBlock(s: FeedStory, ps: FeedPress[], rs: FeedReaction[], outletName: Map<string, string>, fr: boolean) {
  const lead = s.items[0];
  // only the sides that have something: no "no left-leaning reaction" placeholders
  const sides = (["left", "centre", "right"] as Side[])
    .map((side) => ({ side, list: ps.filter((p) => p.side === side) }))
    .filter((x) => x.list.length);
  const others = ps.filter((p) => !p.side);
  return `
    <article class="story">
      <header>
        <h2><a href="${esc(safeUrl(lead.link))}" target="_blank" rel="noopener">${esc(lead.title)}</a></h2>
        <p class="muted small">${s.outlets.map((o) => esc(outletName.get(o) ?? o)).join(", ")}${s.items.length > 1 ? ` (${s.items.length} ${L("articles", "articles")})` : ""}, ${fmtDate(s.lastTime)}</p>
      </header>
      ${
        sides.length
          ? `<div class="feed-cols" style="--n:${sides.length}">${sides
              .map(({ side, list }) => `<div class="feed-col side-${side}"><p class="feed-col-head">${L(...SIDE_LABEL[side])}</p>${list.map((p) => pressPost(p, outletName, fr)).join("")}</div>`)
              .join("")}</div>`
          : ""
      }
      ${
        others.length
          ? `<div class="feed-others"><p class="feed-col-head">${L("Autres comptes cités par la presse", "Other accounts quoted by the press")}</p>${others.map((p) => pressPost(p, outletName, fr)).join("")}</div>`
          : ""
      }
      ${
        rs.length
          ? `<div class="feed-others"><p class="feed-col-head">${L("Aussi sur les réseaux (députés)", "Also on social media (MPs)")}</p>${rs.map((r) => reaction(r, fr)).join("")}</div>`
          : ""
      }
    </article>`;
}

const PLATFORM: Record<string, string> = { bluesky: "Bluesky", youtube: "YouTube", mastodon: "Mastodon", twitter: "X", x: "X" };
/** Populism markers emitted by scripts/rate-reactions.mjs (MARKERS), as readers see them. */
const MARKER: Record<string, [string, string]> = {
  anti_elites: ["anti-élites", "anti-elite"],
  peuple_vs_elites: ["peuple contre élites", "people vs elites"],
  peuple_homogene: ["le peuple comme un bloc", "the people as one bloc"],
  souverainete_populaire: ["volonté du peuple contre les institutions", "popular will over institutions"],
  delegitimation: ["délégitimation de l’adversaire", "delegitimising opponents"],
  complot: ["complot", "conspiracy"],
  simplisme: ["solution simpliste", "simplistic solution"],
  nativisme: ["nativisme", "nativism"],
  appel_emotionnel: ["appel à l’émotion", "emotional appeal"],
};
const markerLabel = (k: string) => (MARKER[k] ? L(...MARKER[k]) : k.replace(/_/g, " "));
const clip = (t: string) => esc(t.length > 420 ? t.slice(0, 420) + "…" : t);

function pressPost(p: FeedPress, outletName: Map<string, string>, fr: boolean) {
  const a = p.author;
  const name = a.name ?? `@${p.handle}`;
  const href = a.kind === "mp" ? `#/depute/${a.id}` : a.kind === "senator" ? `#/senateur/${a.id}` : a.kind === "candidate" ? `#/candidat/${a.id}` : null;
  const chip = a.group
    ? `<span class="chip" style="--c:${safeColor(a.group.couleur)}">${esc(a.group.abrev)}</span>`
    : a.party
      ? `<span class="muted small">${esc(a.party)}</span>`
      : "";
  // say why the post sits in its column: the content rating, or only the author's camp
  const why =
    p.sideFrom === "content"
      ? L("placé d’après le contenu du message", "placed from the post’s content")
      : p.sideFrom === "group"
        ? L(`placé d’après le groupe de l’auteur (${a.group?.abrev ?? ""})`, `placed from the author’s group (${a.group?.abrev ?? ""})`)
        : p.sideFrom === "party"
          ? L(`placé d’après le parti de l’auteur (${a.party ?? ""})`, `placed from the author’s party (${a.party ?? ""})`)
          : "";
  const quoted = p.quotedBy
    .map((q) => `<a href="${esc(safeUrl(q.link))}" target="_blank" rel="noopener" title="${esc(q.title)}">${esc(outletName.get(q.outlet) ?? q.outlet)}</a>`)
    .join(", ");
  return `
    <div class="reaction press${p.side ? ` side-${p.side}` : ""}">
      <p class="who">${href ? `<a href="${esc(href)}"><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`} ${chip} <span class="muted small">@${esc(p.handle)}, X${p.time ? `, ${fmtDate(p.time)}` : ""}</span></p>
      ${p.text ? `<blockquote>${clip(p.text)}</blockquote>` : `<p class="muted small">${L("Texte non disponible.", "Text not available.")}</p>`}
      <div class="meters small">
        <a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${L("Voir le message", "See the post")}</a>
        <span>${L("Cité par", "Quoted by")} ${quoted}</span>
        ${why ? `<span class="muted">${why}</span>` : ""}
      </div>
      ${p.rating ? ratingBlock(p.rating, fr) : ""}
    </div>`;
}

function ratingBlock(rt: NonNullable<FeedReaction["rating"]>, fr: boolean) {
  const lean = rt.lean.score; // -1 left … +1 right
  const pop = rt.populism.score;
  return `
      <div class="meters small">
        ${typeof lean === "number" ? `<span class="meter" data-tip="${esc(fr ? rt.lean.rationale_fr : rt.lean.rationale_en)}"><span class="meter-track"><i style="left:${((lean + 1) / 2) * 100}%"></i></span>${L("Gauche", "Left")} / ${L("droite", "right")}</span>` : ""}
        <span data-tip="${esc(fr ? rt.populism.rationale_fr : rt.populism.rationale_en)}">${L("Populisme", "Populism")} <b>${Math.round(pop * 10)}/10</b>${rt.populism.markers.length ? ` (${esc(rt.populism.markers.map(markerLabel).join(", "))})` : ""}</span>
      </div>
      ${
        rt.check
          ? `<div class="verify"><b>${L("À vérifier", "To verify")}</b>${L(" : « ", ": “")}${esc(rt.check.claim)}${L(" »", "”")} ${esc(fr ? rt.check.why_fr : rt.check.why_en)}${rt.check.sources.length ? ` <span class="small">${rt.check.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("; ")}</span>` : ""}</div>`
          : ""
      }`;
}

function reaction(r: FeedReaction & { match?: { how: string | null } }, fr: boolean) {
  const rt = r.rating!;
  const lean = rt.lean.score;
  const side = typeof lean === "number" ? (lean <= -0.2 ? "left" : lean >= 0.2 ? "right" : "centre") : "";
  // how the post was tied to the story, so a keyword match is never mistaken for a citation
  const how = r.match?.how === "link" || r.match?.how === "embed" ? L("renvoie à l’article", "links to the article") : L("rapproché par mots-clés", "matched by keywords");
  return `
    <div class="reaction${side ? ` side-${side}` : ""}">
      <p class="who"><a href="#/depute/${esc(r.mp.id)}"><b>${esc(r.mp.name)}</b></a> ${r.mp.group ? `<span class="chip" style="--c:${safeColor(r.mp.group.couleur)}">${esc(r.mp.group.abrev)}</span>` : ""} <span class="muted small">${esc(PLATFORM[r.platform] ?? r.platform)}, ${fmtDate(r.time)}, ${how}</span></p>
      <blockquote>${clip(r.text)}</blockquote>
      <div class="meters small"><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${L("Voir le message", "See the post")}</a></div>
      ${ratingBlock(rt, fr)}
    </div>`;
}
