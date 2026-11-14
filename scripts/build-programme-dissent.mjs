// Who in a candidate's own party voted against their programme. For every programme whose measures are matched to
// Assemblée votes (the `votes` block of public/data/programmes/<slug>.json, curated in scripts/data/programmes/),
// each MP of the party's group whose vote went the other way from the promise (against, or abstained) on one of
// those votes. Run after build-programme and the Assemblée sync.
//
//   node scripts/build-programme-dissent.mjs
//
// Output: public/data/programmes/dissent/<slug>.json
//   { group, total, mps: [{ id, name, against, abstained, votes: [{ num, date, title, topic, pos, expect }] }] }
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const ROOT = new URL("../public/data/", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const deputes = await read("an/deputes.json");
await mkdir(new URL("programmes/dissent/", ROOT), { recursive: true });

for (const f of (await readdir(new URL("programmes/", ROOT))).filter((x) => x.endsWith(".json") && !/^(index|compare)/.test(x))) {
  const prog = await read(`programmes/${f}`);
  if (!prog.votes?.length || !prog.group) continue;
  const mps = deputes.filter((d) => d.groupe?.abrev === prog.group);
  const out = [];
  let total = 0;
  for (const d of mps) {
    let votes = {};
    try { votes = await read(`an/votes/${d.id}.json`); } catch { continue; }
    const off = [];
    for (const v of prog.votes) for (const s of v.scrutins) {
      const pos = votes[s.num];
      if (!pos || !s.expect || pos === s.expect || !["P", "C", "A"].includes(pos)) continue;
      off.push({ num: s.num, date: s.date, title: s.title, topic: v.topic, pos, expect: s.expect });
    }
    if (!off.length) continue;
    total += off.length;
    out.push({ id: d.id, name: `${d.prenom} ${d.nom}`, against: off.filter((x) => x.pos !== "A").length, abstained: off.filter((x) => x.pos === "A").length, votes: off.sort((a, b) => b.date.localeCompare(a.date)) });
  }
  // votes against first (the clearest break with the programme), then abstentions
  out.sort((a, b) => b.against - a.against || b.abstained - a.abstained);
  const nScrutins = prog.votes.reduce((s, v) => s + v.scrutins.length, 0);
  await writeFile(new URL(`programmes/dissent/${prog.slug}.json`, ROOT), JSON.stringify({ group: prog.group, groupSize: mps.length, scrutins: nScrutins, total, mps: out }));
  console.log(`${prog.slug}: ${out.length} of ${mps.length} ${prog.group} MPs voted against the programme at least once (${total} votes, ${nScrutins} matched scrutins)`);
}
