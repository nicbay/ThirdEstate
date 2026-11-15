// Instagram stories (1080×1920) from the site's own data and code, so every figure matches the site.
//   node scripts/build-stories.mjs            → docs/social/stories/<date>/NN-*.html + .png
// PNGs are screenshots by headless Chrome (CHROME env var, or the default Windows/macOS/Linux path).
// Story safe zone: Instagram covers ~250px at the top and ~340px at the bottom, so all text sits between.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { average, pollsInWindow } from "../src/lib/polls.ts";
import { combineOdds, winShare } from "../src/lib/markets.ts";
import { meta, registerParties, surname } from "../src/lib/candidates.ts";
import { foxSvg } from "../src/lib/fox.ts";

const root = new URL("../", import.meta.url);
const J = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const fontUrl = (f) => new URL(`public/fonts/${f}`, root).href;

// ---------- data ----------
const polls = J("public/data/polls/2027.json");
registerParties(polls.parties ?? {});
const asOf = polls.firstRound.map((p) => p.end).sort().at(-1);
const win = pollsInWindow(polls.firstRound, asOf);
const avg = average(polls.firstRound, asOf);
const odds = combineOdds(J("public/data/markets.json").markets);
const economy = J("public/data/economy.json");
const deputes = J("public/data/an/deputes.json");
const loyalty = J("public/data/an/loyalty.json");

// ---------- formatting (French) ----------
const nf = (x, d = 0) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\u202f/g, "\u2009");
const pct = (x, d = 0) => `${nf(x, d)}\u2009%`;
const day = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dayShort = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- page shell ----------
const css = `
@font-face{font-family:Archivo;src:url(${fontUrl("archivo-100-900-latin.woff2")}) format("woff2");font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:Archivo;src:url(${fontUrl("archivo-100-900-latin-ext.woff2")}) format("woff2");font-weight:100 900;font-stretch:62% 125%;unicode-range:U+0100-024F,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:Plex;src:url(${fontUrl("ibm-plex-mono-500-latin.woff2")}) format("woff2");font-weight:500}
@font-face{font-family:Plex;src:url(${fontUrl("ibm-plex-mono-600-latin.woff2")}) format("woff2");font-weight:600}
*{box-sizing:border-box}
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#111216;color:#fff;font-family:Archivo,sans-serif;font-variant-numeric:tabular-nums lining-nums}
.page{position:absolute;inset:0;padding:250px 84px 340px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:18px;margin-bottom:44px}
.brand svg{display:block}
.word{font-size:40px;font-weight:850;font-stretch:75%;text-transform:uppercase;letter-spacing:.01em}
.word span{font-weight:300;color:#d8d9de;margin-left:.22em}
.kicker{font:600 26px Plex,monospace;text-transform:uppercase;letter-spacing:.09em;color:#b9bcc4;display:flex;align-items:center;gap:16px;margin-bottom:22px}
.kicker::before{content:"";width:44px;height:8px;background:linear-gradient(90deg,#d4253a 0 50%,#1f5fcf 50% 100%)}
h1{font-size:96px;font-weight:800;font-stretch:76%;line-height:.95;letter-spacing:-.022em;margin:0 0 30px}
.dek{font-size:36px;line-height:1.3;color:#c9cbd1;margin:0 0 44px;max-width:30ch}
.body{flex:1;display:flex;flex-direction:column;justify-content:center}
.foot{display:flex;flex-direction:column;gap:18px;margin-top:34px;border-top:2px solid #2c2e36;padding-top:24px}
.src{font:500 20px/1.45 Plex,monospace;color:#8e919b;text-transform:uppercase;letter-spacing:.05em}
.url{font-size:44px;font-weight:800;font-stretch:80%;letter-spacing:-.01em;white-space:nowrap}
.url b{color:#7d93ff}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:linear-gradient(90deg,#d4253a 0 50%,#1f5fcf 50% 100%)}
.row{display:grid;grid-template-columns:260px 1fr 200px;align-items:center;gap:22px;margin:15px 0}
.row .n{font-size:40px;font-weight:700;font-stretch:85%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .t{height:54px;background:#24262d;position:relative}
.row .f{position:absolute;inset:0 auto 0 0}
.row .v{font-size:52px;font-weight:800;font-stretch:78%;text-align:right;white-space:nowrap}
.mono{font:500 24px Plex,monospace;color:#8e919b;text-transform:uppercase;letter-spacing:.06em}
`;
const page = (kicker, title, dek, body, source, path = "") => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="page">
<div class="brand">${foxSvg(64, true)}<div class="word">Third<span>Estate</span></div></div>
<div class="kicker">${esc(kicker)}</div>
<h1>${title}</h1>
${dek ? `<p class="dek">${dek}</p>` : ""}
<div class="body">${body}</div>
<div class="foot"><div class="url">thirdestate.fr<b>${esc(path)}</b></div><div class="src">${source}</div></div>
</div><div class="bar"></div></body></html>`;

const stories = [];

// 1. The polling average
{
  const top = avg.slice(0, 8);
  const max = Math.max(...top.map((r) => r.avg));
  const from = win.map((p) => p.end).sort()[0];
  const rows = top.map((r) => `<div class="row"><div class="n">${esc(surname(r.name))}</div><div class="t"><div class="f" style="width:${(100 * r.avg) / max}%;background:${meta(r.name).color}"></div></div><div class="v">${pct(r.avg, 1)}</div></div>`).join("");
  stories.push(["sondages", page(
    "Présidentielle 2027 · 1er tour",
    "Où en sont les sondages\u202f?",
    `La moyenne de ${win.length} sondages, du ${dayShort(from)} au ${day(asOf)}.`,
    rows,
    `Moyenne des intentions de vote sur 21 jours.<br>Sondages compilés par Wikipédia (CC BY-SA)`,
    "/#/2027",
  )]);
}

// 2. Polls vs prediction markets
{
  const names = avg.slice(0, 6).map((r) => r.name);
  const pairs = names.map((n) => ({ n, poll: avg.find((r) => r.name === n).avg, mk: winShare(odds, odds.find((o) => o.name === n)) })).filter((x) => x.mk != null).slice(0, 4);
  const rows = pairs.map(({ n, poll, mk }) => `
  <div style="margin:14px 0">
    <div style="font-size:44px;font-weight:800;font-stretch:80%;margin-bottom:10px">${esc(surname(n))}</div>
    <div class="row" style="grid-template-columns:1fr 150px;margin:6px 0"><div class="t" style="height:40px"><div class="f" style="width:${poll}%;background:${meta(n).color}"></div></div><div class="v" style="font-size:42px">${pct(poll)}</div></div>
    <div class="row" style="grid-template-columns:1fr 150px;margin:6px 0"><div class="t" style="height:40px"><div class="f" style="width:${mk}%;background:repeating-linear-gradient(135deg,${meta(n).color} 0 10px,#24262d 10px 16px)"></div></div><div class="v" style="font-size:42px;color:#c9cbd1">${mk < 1 ? "< 1 %" : pct(mk)}</div></div>
  </div>`).join("");
  const sw = (bg) => `<span style="display:inline-block;width:40px;height:22px;vertical-align:-3px;margin-right:12px;background:${bg}"></span>`;
  const legend = `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px" class="mono"><span>${sw("#c9cbd1")}Intentions de vote, 1er tour</span><span>${sw("repeating-linear-gradient(135deg,#c9cbd1 0 8px,#24262d 8px 13px)")}Chances de gagner l’élection (marchés)</span></div>`;
  stories.push(["sondages-vs-marches", page(
    "Présidentielle 2027",
    "Les sondés votent. Les parieurs misent.",
    "Intentions de vote contre paris sur la victoire finale.",
    legend + rows,
    `Sondages : moyenne au ${day(asOf)}. Marchés : Kalshi et Polymarket, pondérés par volume, ramenés à 100\u2009%`,
    "/#/sondages",
  )]);
}

// 3. Public debt
{
  const d = economy.debt;
  const perSec = d.ratePerYear / 31557600;
  const perHead = d.eur / economy.people.population;
  const q = d.period.replace(/(\d{4})-Q(\d)/, "T$2 $1");
  const body = `
  <div style="font-size:250px;font-weight:850;font-stretch:72%;line-height:.9;letter-spacing:-.03em;color:#ff5a6a">+${nf(perSec)}\u2009€</div>
  <div class="mono" style="margin:10px 0 70px;font-size:28px">de dette publique en plus, chaque seconde</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;border-top:3px solid #fff;padding-top:36px">
    <div><div style="font-size:84px;font-weight:800;font-stretch:76%">${nf(d.eur / 1e9)}\u2009Md€</div><div class="mono">Dette totale, ${q}</div></div>
    <div><div style="font-size:84px;font-weight:800;font-stretch:76%">${pct(d.pct, 1)}</div><div class="mono">du PIB</div></div>
    <div><div style="font-size:84px;font-weight:800;font-stretch:76%">${nf(perHead)}\u2009€</div><div class="mono">par habitant</div></div>
    <div><div style="font-size:84px;font-weight:800;font-stretch:76%">${nf(d.ratePerYear / 1e9)}\u2009Md€</div><div class="mono">de plus en un an</div></div>
  </div>`;
  stories.push(["dette", page(
    "La France en chiffres",
    "Pendant que vous lisez ceci…",
    "",
    body,
    `Eurostat, dette publique au sens de Maastricht, ${q}. Rythme : hausse sur les 4 derniers trimestres. Population : Insee`,
    "/#/chiffres",
  )]);
}

// 4. Who the MPs are: socio-professional background
{
  const fam = {};
  for (const x of deputes) { const k = x.famSocPro && x.famSocPro !== "null" ? x.famSocPro : "Non renseigné"; fam[k] = (fam[k] ?? 0) + 1; }
  const short = { "Cadres et professions intellectuelles supérieures": "Cadres, professions intellectuelles sup.", "Professions intermédiaires": "Professions intermédiaires", "Artisans, commerçants et chefs d'entreprise": "Artisans, commerçants, chefs d’entreprise", "Sans profession déclarée": "Sans profession déclarée", Employés: "Employés", "Agriculteurs exploitants": "Agriculteurs", Ouvriers: "Ouvriers", "Non renseigné": "Non renseigné" };
  const colors = ["#7d93ff", "#f2a400", "#1e9e57", "#8e919b", "#e8559a", "#c99a2e", "#ff5a6a", "#474c56"];
  const order = Object.entries(fam).sort((a, b) => b[1] - a[1]);
  const ouv = fam["Ouvriers"] ?? 0;
  const cad = fam["Cadres et professions intellectuelles supérieures"] ?? 0;
  const cells = order.flatMap(([k, n], i) => Array.from({ length: n }, () => `<i style="background:${colors[i % colors.length]}"></i>`)).join("");
  const legend = order.map(([k, n], i) => `<div style="display:flex;align-items:center;gap:16px;font-size:28px;margin:3px 0"><span style="width:22px;height:22px;background:${colors[i % colors.length]};flex:none"></span><span style="flex:1">${esc(short[k] ?? k)}</span><b style="font-size:32px;font-stretch:80%">${n}</b></div>`).join("");
  const body = `<div style="display:grid;grid-template-columns:repeat(41,1fr);gap:4px;margin-bottom:30px">${cells}</div><style>.body i{display:block;aspect-ratio:1}</style>${legend}`;
  stories.push(["deputes-metiers", page(
    "Assemblée nationale",
    `${cad} cadres. ${ouv} ouvriers.`,
    `D’où viennent les ${deputes.length} députés en exercice\u202f? Un carré = un député.`,
    body,
    "Assemblée nationale, données ouvertes. Catégorie socioprofessionnelle déclarée",
    "/#/assemblee/composition",
  )]);
}

// 5. Group loyalty
{
  const groups = Object.fromEntries(deputes.map((x) => [x.groupe.abrev, x.groupe]));
  const rows = Object.entries(loyalty.groups).sort((a, b) => b[1].pooled - a[1].pooled);
  const lo = 70;
  const list = rows.map(([g, v]) => `<div class="row" style="grid-template-columns:170px 1fr 190px;margin:7px 0"><div class="n" style="font-size:38px">${esc(g)}</div><div class="t" style="height:44px"><div class="f" style="width:${((v.pooled * 100 - lo) / (100 - lo)) * 100}%;background:${groups[g]?.couleur ?? "#8e919b"}"></div></div><div class="v" style="font-size:48px">${pct(v.pooled * 100, 1)}</div></div>`).join("");
  const axis = `<div class="mono" style="display:grid;grid-template-columns:170px 1fr 190px;gap:22px;font-size:20px"><span></span><span style="display:flex;justify-content:space-between"><span>${lo}\u2009%</span><span>100\u2009%</span></span><span></span></div>`;
  stories.push(["loyaute", page(
    "Assemblée nationale",
    "Qui vote toujours comme son groupe\u202f?",
    "Part des votes des députés de chaque groupe conformes à la ligne du groupe.",
    list + axis,
    `Assemblée nationale, tous les scrutins publics de la législature au ${day(loyalty.generatedAt)}. Attention : l’axe commence à ${lo}\u2009%`,
    "/#/assemblee/loyaute",
  )]);
}

// 6. The quiz (call to action)
{
  const body = `
  <div style="display:flex;flex-direction:column;gap:26px">
    ${["Pour ou contre\u202f? 17 vrais votes de l’Assemblée.", "Vos priorités parmi les grands thèmes.", "Votre classement\u2009: députés, groupes et candidats 2027 les plus proches de vous."].map((t, i) => `<div style="display:flex;gap:28px;align-items:baseline;border-top:3px solid #fff;padding-top:24px"><b style="font-size:72px;font-stretch:72%;color:#7d93ff;min-width:60px">${i + 1}</b><span style="font-size:44px;line-height:1.2;font-weight:600">${t}</span></div>`).join("")}
  </div>
  <div style="margin-top:70px;align-self:flex-start;background:#fff;color:#111216;font-size:48px;font-weight:800;font-stretch:80%;padding:26px 40px">Faire le quiz →</div>`;
  stories.push(["quiz", page(
    "Quiz · 19 questions",
    "Quel député vous ressemble vraiment\u202f?",
    "Pas des promesses\u2009: des votes réels.",
    body,
    "Votes : Assemblée nationale, données ouvertes",
    "/#/quiz",
  )]);
}

// ---------- write + render ----------
const date = new Date().toISOString().slice(0, 10);
const outDir = new URL(`docs/social/stories/${date}/`, root);
mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => existsSync(p));
stories.forEach(([name, html], i) => {
  const base = `${String(i + 1).padStart(2, "0")}-${name}`;
  const htmlUrl = new URL(`${base}.html`, outDir);
  writeFileSync(htmlUrl, html);
  if (!chrome) return;
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--allow-file-access-from-files", "--virtual-time-budget=3000", "--window-size=1080,1920", `--screenshot=${fileURLToPath(new URL(`${base}.png`, outDir))}`, pathToFileURL(fileURLToPath(htmlUrl)).href], { stdio: "ignore" });
});
console.log(`✓ ${stories.length} stories in docs/social/stories/${date}/${chrome ? "" : " (HTML only: set CHROME to render PNGs)"}`);
