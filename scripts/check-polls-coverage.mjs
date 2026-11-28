// Watchdog: did a presidential poll come out that our polls file (read from Wikipedia) doesn't have yet?
// Reads the press feed (public/data/feed: French outlets, refreshed every 2 hours) for the last 4 days, keeps the
// headlines and summaries about a 2027 presidential poll that name an institute, and checks that this institute has
// a poll in public/data/polls/2027.json whose fieldwork ended no more than 6 days before the story.
//
//   node scripts/check-polls-coverage.mjs
//
// Exit 1 (so the GitHub job fails and its owner gets the failure email) when a named poll is missing; poll
// headlines that name no institute are printed as warnings only (often popularity polls, not voting intention).
// Reviewed false alarms (a popularity barometer, say): add the story id to public/data/polls/coverage-ignore.json
// ({ "ignore": [{ "id": "s-…", "why": "…" }] }) and it is no longer reported.
import { readFile, readdir } from "node:fs/promises";

const ROOT = new URL("../public/data/", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const DAY = 86400000;
const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// institute → how the polls file spells it (Wikipedia's names)
const INSTITUTES = [
  [/\bifop\b/, "Ifop"], [/\belabe\b/, "Elabe"], [/\bipsos\b/, "Ipsos"], [/\bopinion ?way\b/, "OpinionWay"],
  [/\bodoxa\b/, "Odoxa"], [/\bharris\b/, "Harris Interactive"], [/\btoluna\b/, "Harris Interactive"],
  [/\bcluster ?17\b/, "Cluster17"], [/\bverian\b|\bkantar\b/, "Verian"], [/\bviavoice\b/, "Viavoice"],
  [/\bcsa\b/, "CSA"], [/\bbva\b/, "Ipsos"], [/\bhexagone\b/, "Ifop/Hexagone"], [/\bportland\b/, "Portland"],
];
const PRESIDENTIAL = /presidentielle|2027|intentions? de vote|premier tour|second tour|podium/;
const POLL = /sondage|barometre|enquete/;
const NOT_VOTE = /popularite|cote de confiance|personnalites|approuvent|favorables? a|jugent/; // opinion, not vote

const polls = (await read("polls/2027.json")).firstRound;
const latestEnd = polls.reduce((m, p) => (p.end > m ? p.end : m), "");
const since = Date.now() - 4 * DAY;

const files = (await readdir(new URL("feed/archive/", ROOT))).filter((f) => f.endsWith(".json")).sort().slice(-5);
const stories = new Map();
for (const f of files) for (const s of (await read(`feed/archive/${f}`)).stories ?? []) stories.set(s.id, s);
for (const s of (await read("feed/latest.json").catch(() => ({ stories: [] }))).stories) stories.set(s.id, s);

const ignored = new Set(((await read("polls/coverage-ignore.json").catch(() => ({ ignore: [] }))).ignore ?? []).map((x) => x.id));
const missing = [], unnamed = [];
for (const s of stories.values()) {
  const t = Date.parse(s.firstTime);
  if (!(t >= since) || ignored.has(s.id)) continue;
  const texts = [s.title, ...(s.items ?? []).flatMap((i) => [i.title, i.summary ?? ""])];
  const all = norm(texts.join(" "));
  if (!POLL.test(all) || !PRESIDENTIAL.test(all) || NOT_VOTE.test(norm(s.title))) continue;
  const link = s.items?.[0]?.link ?? null;
  const named = [...new Set(INSTITUTES.filter(([re]) => re.test(all)).map(([, n]) => n))];
  if (!named.length) { unnamed.push({ date: s.firstTime.slice(0, 10), title: s.title, link }); continue; }
  for (const inst of named) {
    const has = polls.some((p) => p.pollster === inst && Date.parse(p.end) >= t - 6 * DAY);
    if (!has) missing.push({ id: s.id, institute: inst, date: s.firstTime.slice(0, 10), title: s.title, link });
  }
}

console.log(`latest poll in file: ${latestEnd}`);
for (const u of unnamed) console.log(`warning: poll headline with no institute (${u.date}): ${u.title}\n  ${u.link ?? ""}`);
if (missing.length) {
  for (const m of missing) console.error(`MISSING [${m.id}]: ${m.institute} poll reported ${m.date} not in polls/2027.json: ${m.title}\n  ${m.link ?? ""}`);
  console.error("::error::A presidential poll reported in the press is missing from the polls file (Wikipedia not updated yet?). Add it by hand or wait for Wikipedia.");
  process.exit(1);
}
console.log("ok: every poll named in the press in the last 4 days is in the file");
