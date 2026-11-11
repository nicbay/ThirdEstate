import { existsSync, readFileSync } from "node:fs";
// Campaign-programme analysis: extracts every measure from each version of a candidate's programme,
// matches them across versions, labels what changed, and cross-checks with Assembly votes and speeches.
//
//   node scripts/build-programme.mjs [slug] [--fetch] [--force]
//
// slug        a config in scripts/data/programmes/<slug>.mjs (default: melenchon)
// --baseline  only (re)attach the older baseline edition (cfg.baseline) to the published file; see attachBaseline
// --fetch  crawl the online version(s) into .cache/programmes/<dir>/ (3 s between requests;
//          pages already cached are kept unless --force)
//
// Inputs  .cache/programmes/*.txt   text of the PDF versions, from `pdftotext -layout`-free extraction
//                                   with "=== page N ===" markers (one block per PDF page)
//         .cache/programmes/<dir>/  raw HTML of the online version
//         public/data/an/           scrutins, per-MP votes, deputes, interventions/summary.json
// Output  public/data/programmes/<slug>.json
//         .cache/programmes/review-<slug>.json  borderline matches for manual review (config link/unlink)
//
// Themes are the 17 of scripts/sync-interventions.mjs (its THEMES lexicon is read from that file so the
// two never drift): section-title rules from the config first, then keyword scoring on the measure
// text with the chapter's default theme as a tie-breaker.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { crawlBook, pageFile } from "./lib/fetch-programme-site.mjs";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "melenchon";
const FETCH = args.includes("--fetch");
const FORCE = args.includes("--force");
const ROOT = new URL("../", import.meta.url);
const CACHE = new URL(".cache/programmes/", ROOT);
const OUT = new URL("public/data/programmes/", ROOT);
const cfg = (await import(new URL(`scripts/data/programmes/${slug}.mjs`, ROOT).href)).default;

// ---------- text helpers ----------
const clean = (s) =>
  s
    .replace(/­/g, "")
    .replace(/[​⁠﻿]/g, "")
    .replace(/̀/g, "")
    .replace(/[ \t  -  ]+/g, " ")
    .replace(/\s+([,.;:)»])/g, (m, p) => (p === ":" || p === "»" ? " " + p : p))
    .replace(/«\s*/g, "« ")
    .replace(/\s*»/g, " »")
    .replace(/ {2,}/g, " ")
    .trim();
const deaccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(
  "a au aux avec ce ces cet cette d dans de des du elle en et etre il ils l la le les leur leurs lui mais me meme ne ni nos notre nous on ou par pas plus pour qu que qui sa se ses son sont sur ta tous tout toute toutes un une vos votre y afin ainsi entre sans sous vers chaque ete fait faire leurs dont tres etc lors".split(" "),
);
const stem = (w) => {
  w = w.replace(/(?:ements?|ations?|ateurs?|atrices?|ements|iques?|ites?|ances?|ences?|eaux?|aux|euses?|eurs?|ives?|ifs?|ees?|es|s|e|x)$/, "");
  return w.length > 7 ? w.slice(0, 7) : w;
};
const tokens = (s) =>
  deaccent(s.toLowerCase().replace(/[’']/g, " "))
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w) && (w.length > 2 || /\d/.test(w)))
    .map((w) => (/\d/.test(w) ? w : stem(w)));
const norm = (s) => deaccent(s.toLowerCase()).replace(/[’']/g, "'").replace(/[^a-z0-9%€]+/g, " ").trim();
const hash = (s) => createHash("sha1").update(norm(s)).digest("hex").slice(0, 6);
// Quantities: "1 600 euros", "65 %", "200 milliards", "60 ans", "32 heures". Thin spaces folded.
const NUM_RE = /(?<![A-Za-z\d])(\d{1,3}(?: \d{3})+(?:[,.]\d+)?|\d+(?:[,.]\d+)?)(?!\d|[,.]\d|e\b|er\b|re\b|ème)\s*(%|€|euros?|milliards?|millions?|heures|h\b|ans|années?|annuités|places|logements|emplois|semaines?|jours|km|élèves|mois|gigawatts?|GW)?/g;
function figures(s) {
  const out = [];
  for (const m of s.matchAll(NUM_RE)) {
    const n = m[1].replace(/ /g, "").replace(",", ".");
    if (/^(19|20)\d\d$/.test(n) && !m[2]) { out.push(n); continue; } // years
    if (/^\d+$/.test(n) && Number(n) < 2 && !m[2]) continue;
    const unit = (m[2] ?? "").replace(/^euros?$/, "€").replace(/^heures$|^h$/, "h").replace(/s$/, "");
    out.push(n + (unit ? " " + unit : ""));
  }
  return out;
}
const hasFigure = (s) => /\d/.test(s.replace(/\b(article|chapitre)\s+\d+/gi, "").replace(/\b\d+(e|er|ème)\b/g, ""));
const CONNECT = /(?:\b(?:de|des|du|la|le|les|l’|d’|et|à|au|aux|en|pour|sur|par|un|une|dans|avec|ou|qui|que|ne|leur|leurs|son|sa|ses|nos|notre|ce|cette|ces|entre|sans|plus|moins|tout|tous|toute|toutes|afin|dont|selon|vers|contre|sous|chez|lors|dès|jusqu’à|notamment|comme|ainsi)|[,:;(’«–-])$/i;

// ---------- themes (lexicon from sync-interventions.mjs) ----------
const interventionsSrc = await readFile(new URL("scripts/sync-interventions.mjs", ROOT), "utf8");
const THEMES = Function(`return ${interventionsSrc.match(/const THEMES = (\[[\s\S]*?\n\]);/)[1]}`)();
const THEME_IDS = THEMES.map((t) => t[0]);
const themeRules = THEMES.map(([id, , , words]) => ({
  id,
  rules: words.split(" ").map((w) => {
    const phrase = w.includes("_");
    const prefix = w.endsWith("*");
    const base = norm(w.replace(/\*$/, "").replace(/_/g, " "));
    return phrase ? { phrase: base } : prefix ? { prefix: base } : { exact: base };
  }),
}));
// Extra programme vocabulary the speech lexicon lacks (word starts, after norm()).
const EXTRA = {
  institutions: ["constituant", "6e republique", "proportionnel", "ric ", "referendum", "vote blanc", "droit de vote", "laicit", "parlementaire", "elus", "lobby", "corruption", "service public", "services publics"],
  budget: ["isf", "impot", "heritage", "succession", "tranches", "quotient", "niches", "evasion", "fraude fiscale", "dette"],
  travail: ["smic", "35 heures", "32 heures", "conges payes", "precaire", "chomeur", "licenciement", "retraite", "syndic"],
  social: ["handicap", "aah", "pauvret", "garantie d'autonomie", "femmes", "violences faites", "discrimination", "lgbt", "creche", "jeunes", "egalite salariale", "parit"],
  ecologie: ["renouvelable", "nucleaire", "fossile", "ferroviaire", "train", "velo", "plastique", "ocean", "mer ", "climat", "emissions", "animaux", "chasse", "eau "],
  agriculture: ["pesticide", "glyphosate", "agricol", "paysan", "cantine", "elevage"],
  economie: ["dividende", "actionna", "banque", "numerique", "internet", "fibre", "spatial", "espace", "industri", "relocalis", "entreprises"],
  sante: ["sante", "hopita", "soignant", "medicament", "deserts medicaux", "mutuelle", "securite sociale"],
  securite: ["police", "bac ", "igpn", "cannabis", "renseignement", "terroris"],
  international: ["otan", "onu", "osce", "paix", "armement", "conscription", "militaire", "palestin", "ukraine"],
  education: ["ecole", "enseignant", "eleves", "universit", "etudiant", "bac ", "lycee", "recherche"],
  culture: ["culture", "musee", "artiste", "intermittent", "sport", "medias", "presse"],
  europe: ["europeen", "traites", "bce", "opt-out"],
  immigration: ["migrant", "asile", "titre de sejour", "regularis"],
  justice: ["tribunaux", "magistrat", "prison", "juge", "justice"],
  logement: ["logement", "loyer", "expulsion", "sans-abri", "hlm"],
  outremer: ["outre-mer", "outre mer", "ultramarin", "guadeloupe", "martinique", "guyane", "mayotte", "reunion", "kanak", "caledoni", "polynesi"],
};
function themeScores(text) {
  const n = " " + norm(text) + " ";
  const words = n.trim().split(" ").map((w) => w.replace(/(?:s|x)$/, ""));
  const sc = new Map();
  for (const { id, rules } of themeRules) {
    let s = 0;
    for (const r of rules) {
      if (r.phrase) { if (n.includes(" " + r.phrase)) s += 1.5; }
      else if (r.prefix) { if (words.some((w) => w.startsWith(r.prefix))) s += 1; }
      else if (words.includes(r.exact.replace(/(?:s|x)$/, ""))) s += 1;
    }
    for (const e of EXTRA[id] ?? []) if (n.includes(" " + e)) s += 1;
    if (s) sc.set(id, s);
  }
  return sc;
}
function assignTheme(text, section, chapterTheme) {
  let forced = null;
  for (const [re, th] of cfg.sectionThemes ?? []) if (section && re.test(section)) { forced = th; break; }
  const base = forced ?? chapterTheme;
  const sc = themeScores(text);
  let best = base, bestS = 1.5; // a measure leaves its section/chapter theme only on clear evidence
  for (const [id, s] of sc) {
    const v = s + (id === base ? 1.5 : 0);
    if (id !== base && v > bestS + 0.5) { best = id; bestS = v; }
    else if (id === base) bestS = Math.max(bestS, v);
  }
  return THEME_IDS.includes(best) ? best : chapterTheme;
}

// ---------- parsers ----------
const pagesOf = (txt) => {
  const pages = [];
  for (const m of txt.matchAll(/=== page (\d+) ===\r?\n([\s\S]*?)(?=\r?\n=== page \d+ ===|$)/g)) pages.push({ n: Number(m[1]), lines: m[2].split(/\r?\n/) });
  return pages;
};
const isCaps = (l) => l.length > 2 && /\p{Lu}/u.test(l) && l === l.toUpperCase() && !/\d{3}/.test(l);
const startsLower = (l) => /^[\p{Ll}0-9(«»"“”,;.–-]/u.test(l) || /^[ld]’\p{Ll}/u.test(l) || /^[A-Z]{2,}\s/.test(l) === false && /^(?:[ld]’|qu’)/.test(l);
const STAT = /^\d[\d  ,.]*\s?(?:%\s+(?:des|de|d’)\s|personnes\s|Français\s)/;

// v1: abridged booklet. Bullets "•" under ALL-CAPS sub-headings (followed by a dotted rule).
function parseAbridged(v, txt) {
  const out = [];
  for (const { n, lines } of pagesOf(txt)) {
    const ch = v.pages[n];
    if (!ch) continue;
    const [chTitle, chTheme] = v.chapters[ch];
    let sub = null, cur = null;
    const flush = () => { if (cur) { out.push(mk(cur)); cur = null; } };
    const mk = (c) => ({ text: clean(c.text), chapter: `${String(ch).padStart(2, "0")}. ${chTitle}`, section: c.sub, page: n, chTheme });
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) { continue; }
      if (/^\.{5,}$/.test(l) || /^p\.\d+$/.test(l) || /^©/.test(l) || /^L’Avenir en commun - La version abrégée/.test(l) || /^\d{2}$/.test(l)) { if (cur && /^\.{5,}$/.test(l)) flush(); continue; }
      if (l.startsWith("•")) {
        flush();
        cur = { text: l.slice(1).trim(), sub };
        continue;
      }
      // sub-heading: caps line (possibly over two lines) — next non-empty line is a dotted rule or a bullet
      if (isCaps(l) && !/^[A-ZÉ]+\s?:/.test(l.slice(0, 3))) {
        flush();
        const prevCaps = i > 0 && isCaps(lines[i - 1].trim()) && sub && sub.endsWith("+");
        sub = clean((prevCaps ? sub.slice(0, -1) + " " : "") + l) + "+";
        continue;
      }
      if (cur) {
        if (!cur.text || startsLower(l) || CONNECT.test(cur.text) || /^\(/.test(l)) cur.text += (cur.text ? " " : "") + l;
        else flush(); // chapter intro prose after the last bullet
      }
      if (sub && sub.endsWith("+")) sub = sub; // keep
    }
    flush();
  }
  return out
    .map((m) => ({ ...m, section: m.section ? titleCase(m.section.replace(/\+$/, "")) : null }))
    .filter((m) => m.text.length > 8);
}
const titleCase = (s) => {
  const t = s.toLowerCase().replace(/\s*\.{3,}\s*/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// v2: full edition. Sections come from the table of contents (pages tocPages), body bullets "•",
// key measures in "MESURE CLÉ" boxes (text right after the marker, or the short block just before it).
function parseFull(v, txt) {
  const pages = pagesOf(txt);
  // table of contents → [{chapter, title}]
  const toc = [];
  let chap = 0, buf = null;
  const pushBuf = () => { if (buf) toc.push({ chapter: chap, title: clean(buf) }); buf = null; };
  for (const p of pages.filter((p) => p.n >= v.tocPages[0] && p.n <= v.tocPages[1])) {
    for (let l of p.lines) {
      l = l.trim();
      const mc = l.match(/^Chapitre (\d+)\s*:/);
      if (mc) { pushBuf(); chap = Number(mc[1]); continue; }
      if (l.startsWith("∴")) { pushBuf(); buf = l.slice(1); continue; }
      if (!l || /^\.\d+$/.test(l) || /^\d+$/.test(l) || isCaps(l)) { if (/^\.\d+$/.test(l) || isCaps(l)) pushBuf(); continue; }
      if (buf !== null) buf += " " + l;
    }
  }
  pushBuf();
  const tocKeys = toc.map((t) => ({ ...t, key: norm(t.title) }));
  const out = [];
  let section = null, sectionCh = 0, cur = null, lastBullet = null, prose = [];
  const chapterOf = () => sectionCh || 1;
  const push = (text, page, key = false) => {
    const t = clean(text);
    if (t.length < 9) return null;
    const [chTitle, chTheme] = v.chapters[chapterOf()];
    const m = { text: t, chapter: `${chapterOf()}. ${chTitle}`, section, page, chTheme, key };
    out.push(m);
    return m;
  };
  let inStat = false; // inside an "À SAVOIR" poll figure box
  let bulletOpen = false; // the last thing read was a bullet (no prose since): a page-top lowercase line continues it
  const flush = (page) => { if (cur) { lastBullet = push(cur.text, cur.page); cur = null; bulletOpen = true; } };
  for (const p of pages.filter((p) => p.n >= v.bodyFrom)) {
    const L = p.lines.map((l) => l.replace(/\t/g, " ").trim());
    let firstContent = true, pageProse = 0;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!l) continue;
      if (/^\d{1,3}$/.test(l) && firstContent) continue; // printed page number
      // section heading (matches a TOC title over 1–3 lines)
      const join = norm([L[i], L[i + 1] ?? "", L[i + 2] ?? ""].join(" "));
      const hit = tocKeys.find((t) => t.key.length > 8 && (join === t.key || join.startsWith(t.key + " ")) && norm(l).length >= Math.min(12, t.key.length));
      if (hit && !cur) {
        section = hit.title; sectionCh = hit.chapter;
        const nl = hit.key.split(" ").length;
        let used = 0, k = i;
        while (k < L.length && used < nl) { used += norm(L[k]).split(" ").filter(Boolean).length; k++; }
        i = k - 1; prose = []; firstContent = false;
        continue;
      }
      if (STAT.test(l) && !(cur && !cur.text)) { flush(p.n); inStat = true; continue; }
      if (inStat) {
        if (l === "À SAVOIR") { inStat = false; continue; }
        if (l !== "MESURE CLÉ" && !l.startsWith("•") && !isCaps(l)) { if (/\)$/.test(l)) inStat = false; continue; }
        inStat = false;
      }
      if (l === "•") { flush(p.n); cur = { text: "", page: p.n }; firstContent = false; continue; }
      if (l.startsWith("•")) { flush(p.n); cur = { text: l.slice(1).trim(), page: p.n }; firstContent = false; continue; }
      if (/^MESURE CLÉ$/.test(l)) {
        flush(p.n);
        // forward capture
        let k = i + 1, txtK = [];
        while (k < L.length && (/^CHAPITRE \d+$/.test(L[k]) || (isCaps(L[k]) && L[k] !== "MESURE CLÉ" && L[k] !== "À SAVOIR"))) k++;
        while (k < L.length && L[k] && L[k] !== "MESURE CLÉ" && L[k] !== "À SAVOIR" && !L[k].startsWith("•") && !isCaps(L[k]) && !STAT.test(L[k])) { txtK.push(L[k]); k++; }
        let key = txtK.join(" ");
        if (key && /^\p{Lu}/u.test(key) && key.length < 420) { push(key, p.n, true); i = k - 1; }
        else if (!key) {
          // backward: short block just before the marker (after the last sentence-ending line)
          const back = [];
          for (let j = prose.length - 1; j >= 0; j--) { if (/[.!?»)]$/.test(prose[j]) && back.length) break; if (/[.!?]$/.test(prose[j])) break; back.unshift(prose[j]); }
          const b = back.join(" ");
          if (b && back.length <= 5 && /^\p{Lu}/u.test(b) && !back.some((x) => STAT.test(x) || /^(Par la loi|Dans le cadre)/.test(x)) && b.length < 300 && !tocKeys.some((t) => t.key === norm(b))) push(b, p.n, true);
        }
        prose = [];
        continue;
      }
      if (cur && cur.text && CONNECT.test(cur.text) && isCaps(l) && l.split(" ").length <= 2 && !/^CHAPITRE/.test(l)) { cur.text += " " + l; continue; }
      if (l === "À SAVOIR" || /^CHAPITRE \d+$/.test(l) || isCaps(l)) { flush(p.n); prose = []; continue; }
      if (cur) {
        const openParen = (cur.text.match(/\(/g) ?? []).length > (cur.text.match(/\)/g) ?? []).length;
        if (!cur.text || ((startsLower(l) || CONNECT.test(cur.text) || openParen) && !STAT.test(l))) { cur.text += (cur.text ? " " : "") + l; continue; }
        flush(p.n);
      } else if (firstContent && !pageProse && bulletOpen && lastBullet && /^\p{Ll}/u.test(l) && !/[.;]$/.test(lastBullet.text)) {
        // bullet broken by a page footer: continuation at the top of the next page
        lastBullet.text = clean(lastBullet.text + " " + l);
        let k = i + 1;
        while (k < L.length && L[k] && startsLower(L[k]) && !L[k].startsWith("•")) { lastBullet.text = clean(lastBullet.text + " " + L[k]); k++; }
        i = k - 1; firstContent = false;
        continue;
      }
      pageProse++;
      if (/[.!?]$/.test(l)) { bulletOpen = false; firstContent = false; } // a prose paragraph, not a key-measure box
      prose.push(l);
    }
    flush(p.n);
  }
  // A bullet whose last line ends on a connector and was continued on the next page by a lowercase
  // line is handled above; one ending without a connector but cut mid-phrase is rare enough to curate.
  return { measures: out, toc };
}

// v3: online book. <h1 id="chapitreN">, <h3 id class="section-title">, .mesure-cle p, li.mesure,
// li.sous_mesure (sub-measures listed under the previous measure).
const decode = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&laquo;|&#171;/g, "«")
    .replace(/&raquo;|&#187;/g, "»")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)));
async function parseSite(v) {
  const dir = new URL(`${v.dir}/`, CACHE);
  const out = [];
  for (const part of Object.keys(v.parts)) {
    for (let c = 1; c <= 12; c++) {
      const slugC = `${part}/chapitre${c}`;
      if (!(slugC in v.chapters)) continue;
      const html = await readFile(pageFile(dir, slugC), "utf8");
      const h1 = decode(html.match(/<h1 id="chapitre\d+">([\s\S]*?)<\/h1>/)?.[1] ?? `Chapitre ${c}`).replace(/\s+/g, " ").trim();
      const chTheme = v.chapters[slugC];
      const pageUrl = `${v.base}${slugC}/`;
      let section = null, anchor = `chapitre${c}`, parent = null;
      const re = /<h3 id="([^"]+)" class="section-title">([\s\S]*?)<\/h3>|<div class="mesure-cle">\s*<h6>[^<]*<\/h6>\s*<p>([\s\S]*?)<\/p>|<li class='(mesure|sous_mesure)'>([\s\S]*?)<\/li>/g;
      for (const m of html.matchAll(re)) {
        if (m[1]) { section = clean(decode(m[2])); anchor = m[1]; continue; }
        const key = m[3] !== undefined;
        const text = clean(decode(key ? m[3] : m[5]));
        if (!text) continue;
        const sub = m[4] === "sous_mesure";
        const rec = { text, part: v.parts[part], chapter: `${h1}`, section, url: `${pageUrl}#${anchor}`, chTheme, key, ...(sub && parent ? { parentText: parent.text } : {}) };
        if (!sub) parent = rec;
        out.push(rec);
      }
    }
  }
  return out;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
// ---------- baseline: an older, complete edition laid under the lineages (cfg.baseline) ----------
// The lineages are built from the versions above and never change here: ids, statuses and counts stay
// what they were. The baseline only adds, to each lineage it matches, its wording in that older edition
// (field `f`), so the page can tell a measure that is new from one the abridged 2022 booklet left out.
// It runs at the end of a full build, or alone on the published file:
//   node scripts/build-programme.mjs [slug] --baseline
// (the lineages are read back from public/data/programmes/<slug>.json; nothing else is recomputed).

// Layout text (`pdftotext -layout`, "=== page N ===" markers): measures are "- " bullets, sub-measures "o "
// bullets under them, continuation lines are indented deeper than their bullet; section titles are single
// lines between blank lines; footnotes (numbered, at the foot of the page) and page numbers are dropped.
function parseBaseline(v, txt) {
  const out = [];
  let chapter = 0, section = null, cur = null, parent = null, dashIndent = 10, lastFoot = 0;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (const { n, lines } of pagesOf(txt)) {
    if (n < v.bodyFrom || n > v.bodyTo) continue;
    let foot = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].replace(/\t/g, " "), l = raw.trim();
      if (!l || foot) continue;
      const indent = raw.length - raw.trimStart().length;
      if (/^\d{1,3}$/.test(l)) continue; // printed page number
      const mc = l.match(/^Chapitre (\d+)\s*:\s*(.*)$/);
      if (mc) {
        flush(); chapter = Number(mc[1]); section = null; parent = null;
        while (lines[i + 1]?.trim()) i++; // the title wraps; the config has it
        continue;
      }
      if (!chapter) continue;
      const mf = l.match(/^(\d{1,3}) \S/);
      if (mf && indent <= dashIndent && Number(mf[1]) > lastFoot && Number(mf[1]) <= lastFoot + 8) { lastFoot = Number(mf[1]); foot = true; continue; }
      if (/^- \S/.test(l) || /^-\S/.test(l) && indent >= 4) {
        flush(); dashIndent = indent;
        cur = parent = { text: l.replace(/^-\s*/, ""), chapter, section, page: n, indent, sub: false };
        continue;
      }
      if (/^[o§] \S/.test(l) && parent) {
        flush();
        cur = { text: l.slice(2), chapter, section, page: n, indent, sub: true, parentText: parent.text };
        parent.hasSub = true;
        continue;
      }
      if (cur && indent > (cur.sub ? dashIndent : cur.indent)) { cur.text += " " + l; continue; }
      flush();
      // a section title: one line on its own, capitalised, not a sentence
      const alone = !lines[i - 1]?.trim() && !lines[i + 1]?.trim();
      if (alone && /^[\p{Lu}«]/u.test(l) && !/[.;,]$/.test(l) && l.length < 130) { section = l; parent = null; }
    }
  }
  flush();
  return out
    // a bullet that only introduces its sub-bullets ("Faire France de tout bois :") is not a measure
    .filter((m) => !(/:\s*$/.test(m.text) && (m.hasSub || m.text.length < 60)))
    .map((m) => {
      const [chTitle, chTheme] = v.chapters[m.chapter];
      // footnote calls glued to the end of a word: "loi1", "assistance)3"
      // …or to a year ("en 202026" is 2020 and call 26)
      const text = clean(m.text.replace(/(?<=[\p{Ll}»)”"])\d{1,3}(?=$|[\s,;.:)])/gu, "").replace(/\b((?:19|20)\d\d)\d{1,3}(?=$|[\s,;.:)])/g, "$1"));
      return { text, chapter: `${m.chapter}. ${chTitle}`, section: m.section ? clean(m.section) : null, page: m.page, chTheme, ...(m.sub ? { parentText: clean(m.parentText) } : {}) };
    })
    .filter((m) => m.text.length > 8);
}

async function attachBaseline(out) {
  const v = cfg.baseline;
  if (!v) return;
  // a clean slate, so the step can be re-run on a file that already carries a baseline
  delete out.baseline; delete out.sections[v.id];
  for (const L of out.lineages) { delete L.f; delete L.fScore; delete L.fChange; }

  const seen = new Set();
  const F = parseBaseline(v, await readFile(new URL(v.text, CACHE), "utf8"))
    .filter((m) => { const h = hash(m.text); if (seen.has(h)) return false; seen.add(h); return true; })
    .map((m) => ({ ...m, id: `${v.id}-${hash(m.text)}`, theme: assignTheme(m.text + (m.parentText ? " " + m.parentText : ""), m.section, m.chTheme), figures: figures(m.text) }));

  // same similarity as between versions (IDF-weighted Dice + containment), IDF over the lineages' wordings and the baseline
  const tokSet = (t) => [...new Set(tokens(t))];
  const B = out.lineages.map((L) => ({ L, ms: [L.a, L.e, L.w].filter(Boolean).map((m) => ({ text: m.t, tok: tokSet(m.t) })) }));
  for (const m of F) m.tok = tokSet(m.text + (m.parentText && m.text.length < 60 ? " " + m.parentText : ""));
  const docs = [...F, ...B.flatMap((b) => b.ms)];
  const DF = new Map();
  for (const d of docs) for (const t of d.tok) DF.set(t, (DF.get(t) ?? 0) + 1);
  const idf = (t) => Math.log(1 + docs.length / (DF.get(t) ?? 1));
  for (const d of docs) { d.tset = new Set(d.tok); d.w = d.tok.reduce((s, t) => s + idf(t), 0); }
  const sim = (a, b) => {
    if (norm(a.text) === norm(b.text)) return 1;
    let inter = 0, n = 0;
    for (const t of a.tok) if (b.tset.has(t)) { inter += idf(t); n++; }
    if (n < 2 || !a.w || !b.w) return 0;
    return 0.65 * ((2 * inter) / (a.w + b.w)) + 0.35 * (inter / Math.min(a.w, b.w));
  };
  const idx = new Map();
  B.forEach((b, j) => { for (const t of new Set(b.ms.flatMap((m) => m.tok))) { if (!idx.has(t)) idx.set(t, []); idx.get(t).push(j); } });
  const link = new Map((v.link ?? []).map(([f, l]) => [f, l])), unlink = new Set((v.unlink ?? []).map(([f, l]) => `${f}|${l}`));
  const pairs = [];
  F.forEach((a, i) => {
    const cand = new Set();
    for (const t of a.tok) for (const j of idx.get(t) ?? []) cand.add(j);
    for (const j of cand) { const s = Math.max(...B[j].ms.map((m) => sim(a, m))); if (s >= v.border) pairs.push([s, i, j]); }
    if (link.has(a.id)) { const j = B.findIndex((b) => b.L.id === link.get(a.id)); if (j >= 0) pairs.push([2, i, j]); else console.warn(`baseline link not applied: ${a.id}`); }
  });
  pairs.sort((p, q) => q[0] - p[0]);
  const mA = new Map(), mB = new Set(), review = [];
  for (const [s, i, j] of pairs) {
    if (mA.has(i) || mB.has(j) || unlink.has(`${F[i].id}|${B[j].L.id}`)) continue;
    if (s < v.accept) { review.push({ score: r3(s), f: F[i].id, lineage: B[j].L.id, fText: F[i].text, lText: B[j].ms.at(-1).text }); continue; }
    mA.set(i, j); mB.add(j);
    F[i].score = s === 2 ? null : r3(s);
  }

  const sections = [], sIdx = new Map();
  const pack = (m) => {
    const k = `${m.chapter}|${m.section ?? ""}`;
    if (!sIdx.has(k)) { sIdx.set(k, sections.length); sections.push([null, m.chapter, m.section ?? null, null]); }
    return { id: m.id, t: m.text, s: sIdx.get(k), p: m.page, ...(m.figures.length ? { f: [...new Set(m.figures)] } : {}) };
  };
  const figs = (list) => [...new Set(list ?? [])].filter((x) => !/^(19|20)\d\d$/.test(x)).sort(); // quantities, not years cited in passing
  const already = { maintained: 0, modified: 0, new2025: 0, new2027: 0, dropped: 0 };
  const only = [];
  F.forEach((m, i) => {
    const j = mA.get(i);
    if (j === undefined) { only.push({ ...pack(m), theme: m.theme }); return; }
    const L = B[j].L;
    L.f = pack(m);
    if (m.score != null) L.fScore = m.score;
    already[L.status]++;
    // a figure that differs between the baseline and the next complete wording (the 2022 booklet abridges: skipped when a fuller one exists)
    const next = L.e ?? L.w ?? L.a, yr = L.e ? 2025 : L.w ? 2027 : 2022;
    const fx = figs(m.figures), fy = figs(next.f);
    if (fx.length && fy.length && JSON.stringify(fx) !== JSON.stringify(fy)) L.fChange = { from: v.year, to: yr, before: fx, after: fy };
  });
  const totals = Object.fromEntries(Object.keys(already).map((s) => [s, out.lineages.filter((L) => L.status === s).length]));
  out.sections[v.id] = sections;
  out.baseline = {
    id: v.id, year: v.year, label: v.label, title: v.title, date: v.date, pages: v.pagesTotal, ...(v.url ? { url: v.url } : {}),
    count: F.length, matched: mA.size, unmatched: only.length, accept: v.accept, doubtful: review.length,
    already, totals, figureChanges: out.lineages.filter((L) => L.fChange).length, only,
  };
  review.sort((x, y) => y.score - x.score);
  const sample = [...mA].map(([i, j]) => ({ score: F[i].score, f: F[i].id, lineage: B[j].L.id, status: B[j].L.status, fText: F[i].text, lText: B[j].ms.at(-1).text })).sort((x, y) => (x.score ?? 9) - (y.score ?? 9));
  await writeFile(new URL(`review-${slug}-baseline.json`, CACHE), JSON.stringify({ borderline: review, weakestAccepted: sample.slice(0, 150) }, null, 1));
  console.log(`${v.id}: ${F.length} measures; ${mA.size} matched to a lineage, ${only.length} without a later equivalent; ${review.length} doubtful pairs left unlinked`);
  console.log(`already in ${v.year}:`, already, "of", totals);
}

if (args.includes("--baseline")) {
  const file = new URL(`${slug}.json`, OUT);
  const out = JSON.parse(await readFile(file, "utf8"));
  await attachBaseline(out);
  await writeFile(file, JSON.stringify(out));
  process.exit(0);
}

// ---------- load + parse every version ----------
if (FETCH) {
  for (const v of cfg.versions.filter((v) => v.kind === "site")) {
    console.log(`fetching ${v.base}`);
    await crawlBook({ base: v.base, dir: new URL(`${v.dir}/`, CACHE), force: FORCE });
  }
}
const byVersion = {};
let fullToc = null;
for (const v of cfg.versions) {
  let list;
  if (v.kind === "abridged-pdf") list = parseAbridged(v, await readFile(new URL(v.text, CACHE), "utf8"));
  else if (v.kind === "full-pdf") { const r = parseFull(v, await readFile(new URL(v.text, CACHE), "utf8")); list = r.measures; fullToc = r.toc; }
  else list = await parseSite(v);
  // manual fixes for text the layout broke apart (config textFixes: [version, prefix, full text])
  for (const [vid, prefix, full] of cfg.textFixes ?? []) {
    if (vid !== v.id) continue;
    const m = list.find((x) => x.text.startsWith(prefix));
    if (m) m.text = full; else console.warn(`textFix not applied: ${prefix}`);
  }
  // de-duplicate identical texts within a version (a key measure repeated as a bullet keeps key=true)
  const seen = new Map();
  for (const m of list) {
    const h = hash(m.text);
    if (seen.has(h)) { if (m.key) seen.get(h).key = true; continue; }
    seen.set(h, m);
  }
  byVersion[v.id] = [...seen.values()].map((m) => ({
    id: `${v.id}-${hash(m.text)}`,
    v: v.id,
    ...m,
    theme: assignTheme(m.text + (m.parentText ? " " + m.parentText : ""), m.section, m.chTheme),
    figures: figures(m.text),
  }));
  console.log(`${v.id}: ${byVersion[v.id].length} measures (${byVersion[v.id].filter((m) => m.key).length} key)`);
}

if (args.includes("--dump")) {
  await mkdir(CACHE, { recursive: true });
  await writeFile(new URL(`parsed-${slug}.json`, CACHE), JSON.stringify({ byVersion, fullToc }, null, 1));
  console.log("dumped");
  process.exit(0);
}


// ---------- similarity ----------
const ALL = Object.values(byVersion).flat();
for (const m of ALL) { m.tok = [...new Set(tokens(m.text))]; m.tset = new Set(m.tok); }
const DF = new Map();
for (const m of ALL) for (const t of m.tok) DF.set(t, (DF.get(t) ?? 0) + 1);
const idf = (t) => Math.log(1 + ALL.length / (DF.get(t) ?? 1));
for (const m of ALL) m.w = m.tok.reduce((s, t) => s + idf(t), 0);
// IDF-weighted overlap: mostly Dice, part containment (an abridged bullet is often a shorter wording)
function sim(a, b) {
  if (norm(a.text) === norm(b.text)) return 1;
  let inter = 0, n = 0;
  for (const t of a.tok) if (b.tset.has(t)) { inter += idf(t); n++; }
  if (n < 2 || !a.w || !b.w) return 0;
  return 0.65 * ((2 * inter) / (a.w + b.w)) + 0.35 * (inter / Math.min(a.w, b.w));
}
// Within a version, a "mesure clé" box usually restates a bullet of the same section: merge near-duplicates
// (similarity >= 0.75) into one measure that keeps the key flag and the longer wording.
const MERGED = new Map(); // removed id -> kept id
for (const [v, list] of Object.entries(byVersion)) {
  const keep = [];
  for (const m of list) {
    const twin = keep.find((k) => sim(k, m) >= 0.75);
    if (!twin) { keep.push(m); continue; }
    if (m.text.length > twin.text.length) {
      MERGED.set(twin.id, m.id);
      for (const [x, y] of MERGED) if (y === twin.id) MERGED.set(x, m.id);
      m.key = m.key || twin.key;
      keep[keep.indexOf(twin)] = m;
    } else { twin.key = twin.key || m.key; MERGED.set(m.id, twin.id); }
  }
  byVersion[v] = keep;
  console.log(`${v}: ${keep.length} after merging restated key measures`);
}
const canon = (id) => MERGED.get(id) ?? id;
const pairKey = (x, y) => `${canon(x)}|${canon(y)}`;
const LINK = new Set((cfg.link ?? []).map(([x, y]) => pairKey(x, y)));
const UNLINK = new Set((cfg.unlink ?? []).map(([x, y]) => pairKey(x, y)));
const review = [];
const accepted = [];

// Greedy one-to-one matching of A onto B (B items expose .ids, .tok and .sim(a)). Pairs at or above
// `accept` link; pairs in [border, accept) link only when listed in cfg.link, and go to the review file.
function match(A, B, { accept, border, label }) {
  const idx = new Map();
  B.forEach((b, j) => { for (const t of b.tok) { if (!idx.has(t)) idx.set(t, []); idx.get(t).push(j); } });
  const pairs = [];
  A.forEach((a, i) => {
    const seen = new Set();
    for (const t of a.tok) for (const j of idx.get(t) ?? []) {
      if (seen.has(j)) continue;
      seen.add(j);
      const s = B[j].sim(a);
      if (s >= border) pairs.push([s, i, j]);
    }
  });
  for (const k of LINK) {
    const [x, y] = k.split("|");
    const i = A.findIndex((a) => a.id === x), j = B.findIndex((b) => b.ids.includes(y));
    if (i >= 0 && j >= 0) pairs.push([2, i, j]);
    else if (A.some((a) => a.v === x.slice(0, 3))) console.warn(`link not applied (${label}): ${x} → ${y}`);
  }
  pairs.sort((p, q) => q[0] - p[0]);
  const mA = new Map(), mB = new Map();
  for (const [s, i, j] of pairs) {
    if (mA.has(i) || mB.has(j)) continue;
    const a = A[i], b = B[j];
    if (b.ids.some((y) => UNLINK.has(pairKey(a.id, y)))) continue;
    const forced = s === 2;
    if (!forced && s < accept) {
      review.push({ step: label, score: r3(s), a: a.id, b: b.ids[b.ids.length - 1], aText: a.text, bText: b.text });
      continue;
    }
    mA.set(i, j); mB.set(j, i);
    a.score = forced ? null : r3(s);
    accepted.push({ step: label, score: forced ? "link" : r3(s), a: a.id, b: b.ids[b.ids.length - 1], aText: a.text, bText: b.text });
  }
  return mA;
}

// step 1: 2025 edition ↔ 2027 site
const E = byVersion.e25, W = byVersion.w27, A22 = byVersion.a22;
const asB = (m) => ({ ...m, ids: [m.id], sim: (a) => sim(a, m) });
const ew = match(E, W.map(asB), { accept: 0.42, border: 0.3, label: "e25→w27" });
const lineages = [];
const wUsed = new Set();
E.forEach((e, i) => {
  const j = ew.get(i);
  if (j !== undefined) { wUsed.add(j); lineages.push({ e, w: W[j], ew: e.score }); }
  else lineages.push({ e });
});
W.forEach((w, j) => { if (!wUsed.has(j)) lineages.push({ w }); });
// step 2: 2022 abridged → lineages (best of its 2025 and 2027 wordings)
const LB = lineages.map((L) => {
  const ms = [L.e, L.w].filter(Boolean);
  const tok = [...new Set(ms.flatMap((m) => m.tok))];
  return { L, ids: ms.map((m) => m.id), tok, text: ms.map((m) => m.text).join(" / "), sim: (a) => Math.max(...ms.map((m) => sim(a, m))) };
});
const al = match(A22, LB, { accept: 0.45, border: 0.28, label: "a22→e25/w27" });
A22.forEach((a, i) => {
  const j = al.get(i);
  if (j !== undefined) { LB[j].L.a = a; LB[j].L.ae = a.score; }
  else lineages.push({ a });
});

// ---------- statuses ----------
const figSet = (m) => [...new Set(m.figures)].sort();
const sameFigs = (x, y) => JSON.stringify(figSet(x)) === JSON.stringify(figSet(y));
function wordDelta(x, y) {
  let d = 0;
  for (const t of x.tok) if (!y.tset.has(t)) d++;
  for (const t of y.tok) if (!x.tset.has(t)) d++;
  return d;
}
const YEAR = { a22: 2022, e25: 2025, w27: 2027 };
for (const L of lineages) {
  const seq = [L.a, L.e, L.w].filter(Boolean);
  L.changes = [];
  for (let k = 1; k < seq.length; k++) {
    const x = seq[k - 1], y = seq[k];
    const fx = figSet(x), fy = figSet(y);
    const kinds = [];
    if (fx.length && fy.length && !sameFigs(x, y)) kinds.push("figure");
    else if (x.v !== "a22" && fx.length && !fy.length) kinds.push("figure-removed");
    else if (x.v !== "a22" && !fx.length && fy.length) kinds.push("figure-added");
    // wording: only between the two full versions (the 2022 booklet abridges by design)
    if (x.v !== "a22" && norm(x.text) !== norm(y.text) && wordDelta(x, y) >= 3) kinds.push("wording");
    if (kinds.length) L.changes.push({ from: YEAR[x.v], to: YEAR[y.v], kinds, before: fx, after: fy });
  }
  const changed = L.changes.length > 0;
  if (!L.w) { L.status = "dropped"; L.droppedIn = L.e ? 2027 : 2025; }
  else if (!L.a && !L.e) L.status = "new2027";
  else if (!L.a) L.status = "new2025";
  else L.status = changed ? "modified" : "maintained";
  L.changed = changed;
  const last = L.w ?? L.e ?? L.a;
  L.theme = last.theme;
  L.key = !!(L.a?.key || L.e?.key || L.w?.key);
  L.id = "L" + last.id.slice(4);
}
const STATUSES = ["maintained", "modified", "new2025", "new2027", "dropped"];
const count = (list) => Object.fromEntries(STATUSES.map((s) => [s, list.filter((L) => L.status === s).length]));
const summary = {
  overall: { ...count(lineages), total: lineages.length, changed: lineages.filter((L) => L.changed && L.w).length },
  byTheme: Object.fromEntries(THEMES.map(([id]) => [id, count(lineages.filter((L) => L.theme === id))])),
};

// ---------- highlights (curated) and auto candidates for review ----------
const lineageOf = (id) => lineages.find((L) => L.id === id || [L.a, L.e, L.w].some((m) => m?.id === canon(id)));
const highlights = (cfg.highlights ?? []).map((h) => {
  const L = lineageOf(h.id);
  if (!L) { console.warn(`highlight not found: ${h.id}`); return null; }
  return { lineage: L.id, kind: h.kind, fr: h.fr, en: h.en };
}).filter(Boolean);
const autoHighlights = lineages
  .filter((L) => (L.key || L.changes.some((c) => c.kinds.includes("figure"))) && L.status !== "maintained")
  .map((L) => ({ id: L.id, status: L.status, key: L.key, changes: L.changes, a: L.a?.text, e: L.e?.text, w: L.w?.text }));

// ---------- Assembly cross-check ----------
const AN = new URL("public/data/an/", ROOT);
const scrutins = JSON.parse(await readFile(new URL("scrutins.json", AN), "utf8"));
const scrutinBy = new Map(scrutins.map((s) => [s[0], s]));
const deputes = JSON.parse(await readFile(new URL("deputes.json", AN), "utf8"));
const groupIds = deputes.filter((d) => d.groupe?.abrev === cfg.group).map((d) => d.id);
const groupVotes = await Promise.all(groupIds.map(async (id) => { try { return JSON.parse(await readFile(new URL(`votes/${id}.json`, AN), "utf8")); } catch { return {}; } }));
const tally = (num) => {
  const t = { P: 0, C: 0, A: 0 };
  for (const v of groupVotes) { const x = v[num]; if (x && t[x] !== undefined) t[x]++; }
  const maj = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
  return { ...t, majority: maj[1] ? maj[0] : null };
};
const votes = [];
for (const entry of cfg.votes ?? []) {
  const L = lineages.find((L) => [L.w, L.e, L.a].some((m) => m && entry.match.test(m.text)));
  if (!L) { console.warn(`vote link: no measure for ${entry.match}`); continue; }
  const items = entry.scrutins.map(([num, expect]) => {
    const s = scrutinBy.get(num);
    if (!s) { console.warn(`scrutin ${num} missing`); return null; }
    const t = tally(num);
    return { num, date: s[1], title: s[2], result: s[3], total: { P: s[5], C: s[6], A: s[7] }, group: { P: t.P, C: t.C, A: t.A }, majority: t.majority, expect, agrees: t.majority ? t.majority === expect : null };
  }).filter(Boolean);
  votes.push({ lineage: L.id, topic: entry.topic, note: entry.note ?? null, scrutins: items });
}

// ---------- programme weight vs speech time ----------
const speeches = JSON.parse(await readFile(new URL("interventions/summary.json", AN), "utf8"));
const share = (list) => {
  const n = list.length || 1;
  return Object.fromEntries(THEMES.map(([id]) => [id, r3(list.filter((m) => m.theme === id).length / n)]));
};
const themeWeights = {
  programme: Object.fromEntries(Object.entries(byVersion).map(([v, list]) => [v, share(list)])),
  speeches: speeches.groups?.[cfg.group]?.themes ?? null,
  chamber: speeches.chamber?.themes ?? null,
  speechesPeriod: speeches.period ?? null,
  speechesCount: speeches.groups?.[cfg.group]?.speeches ?? null,
};

// ---------- output ----------
// Measures reference a per-version sections table [part, chapter, section, url] to keep the file small.
const sectionsOut = {};
const packMeasure = (m) => {
  if (!m) return undefined;
  const tbl = (sectionsOut[m.v] ??= { list: [], idx: new Map() });
  const k = `${m.part ?? ""}|${m.chapter}|${m.section ?? ""}|${m.url ?? ""}`;
  if (!tbl.idx.has(k)) { tbl.idx.set(k, tbl.list.length); tbl.list.push([m.part ?? null, m.chapter, m.section ?? null, m.url ?? null]); }
  const o = { id: m.id, t: m.text, s: tbl.idx.get(k) };
  if (m.page) o.p = m.page;
  if (m.key) o.k = 1;
  if (m.figures.length) o.f = [...new Set(m.figures)];
  return o;
};
const outLineages = lineages.map((L) => ({
  id: L.id, theme: L.theme, status: L.status, ...(L.droppedIn ? { droppedIn: L.droppedIn } : {}),
  ...(L.changed ? { changed: 1 } : {}), ...(L.key ? { key: 1 } : {}),
  a: packMeasure(L.a), e: packMeasure(L.e), w: packMeasure(L.w),
  ...(L.changes.length ? { changes: L.changes } : {}),
}));
const out = {
  slug: cfg.slug,
  candidate: cfg.candidate,
  party: cfg.party,
  programme: cfg.programme,
  group: cfg.group,
  generatedAt: new Date().toISOString().slice(0, 10),
  themes: THEMES.map(([id, fr, en]) => ({ id, fr, en })),
  versions: cfg.versions.map((v) => ({
    id: v.id, year: v.year, label: v.label, title: v.title, date: v.date, kind: v.kind,
    url: v.url ?? v.base, ...(v.file ? { file: v.file } : {}), ...(v.pagesTotal ? { pages: v.pagesTotal } : {}),
    count: byVersion[v.id].length, key: byVersion[v.id].filter((m) => m.key).length,
    ...(v.financing ? { financing: v.financing } : {}),
  })),
  sections: Object.fromEntries(Object.entries(sectionsOut).map(([v, t]) => [v, t.list])),
  summary,
  highlights,
  ...(cfg.costing ? { costing: cfg.costing } : {}),
  ...(existsSync(new URL(`scripts/data/programmes/${slug}-assessment.json`, ROOT)) ? { assessment: JSON.parse(readFileSync(new URL(`scripts/data/programmes/${slug}-assessment.json`, ROOT), "utf8")) } : {}),
  votes,
  themeWeights,
  lineages: outLineages,
};
await attachBaseline(out);
await mkdir(OUT, { recursive: true });
await writeFile(new URL(`${slug}.json`, OUT), JSON.stringify(out));
review.sort((x, y) => y.score - x.score);
await writeFile(new URL(`review-${slug}.json`, CACHE), JSON.stringify({ borderline: review, accepted: accepted.filter((x) => x.score === "link" || x.score < 0.6), autoHighlights }, null, 1));
console.log(`lineages ${lineages.length}`, summary.overall);
console.log(`borderline pairs for review: ${review.length}; vote links: ${votes.length} measures, ${votes.reduce((s, v) => s + v.scrutins.length, 0)} scrutins`);
