// Group loyalty ("doigt sur la couture") for every sitting MP, from the raw AN scrutin records.
//
// Method (also shown on the site):
// - Each scrutin lists every MP under the political group they sat in *on the day of the vote*,
//   so an MP who changed group is always compared with the group they belonged to at the time.
// - The group line is the plurality position (pour / contre / abstention) of the *other* members of
//   that group who cast a vote, counted from the nominative lists. We recompute it rather than use the
//   AN's own `positionMajoritaire`, which contradicts the group's nominative count in ~3% of group-votes
//   (e.g. "abstention" when 18 voted pour and 3 abstained). Leaving the MP out means a member of a
//   two-person turnout cannot "set" the line themselves.
// - A vote counts only if at least MIN_OTHERS colleagues voted and their plurality is not a tie.
// - Non-inscrits have no group line: votes cast as NI are not counted (reported separately).
// - Non-votants (session president, ministers' substitutes…) and absences are not votes.
// - loyalty = votes matching the line / votes counted. Ranked only with at least MIN_VOTES counted votes.

export const MIN_VOTES = 30;
export const MIN_OTHERS = 3;
// "PO0" is a placeholder the AN uses on a handful of scrutins (a mixed bag of MPs from every group): skipped.
const UNKNOWN = new Set(["PO0"]);
// Organs that no longer exist in the "active" AMO export, so their names cannot be read from it.
const RETIRED = { PO847173: { abrev: "UDR", libelle: "Union des droites pour la République (avant sept. 2025)" } };
const KEYS = { pours: "P", contres: "C", abstentions: "A" };

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Fresh accumulator; feed it every raw scrutin with add(), then call result(). */
export function loyaltyTracker({ sitting, organes, deputes }) {
  const isNI = (ref) => organes.get(ref)?.libelleAbrev === "NI";
  const abrevOf = (ref) => organes.get(ref)?.libelleAbrev ?? RETIRED[ref]?.abrev ?? ref;
  const acc = new Map([...sitting].map((id) => [id, { n: 0, ok: 0, opp: 0, ni: 0, few: 0, groups: {}, rebels: [] }]));

  function add(s) {
    const num = Number(s.numero);
    for (const grp of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
      if (UNKNOWN.has(grp.organeRef)) continue;
      const nom = grp.vote?.decompteNominatif ?? {};
      const voters = Object.entries(KEYS).map(([k, letter]) => [letter, arr(nom[k]?.votant).map((v) => v.acteurRef)]);
      const count = Object.fromEntries(voters.map(([l, ids]) => [l, ids.length]));
      const ni = isNI(grp.organeRef);
      for (const [mine, ids] of voters) {
        for (const id of ids) {
          const a = acc.get(id);
          if (!a) continue;
          if (ni) { a.ni++; continue; }
          const others = { ...count, [mine]: count[mine] - 1 };
          const total = others.P + others.C + others.A;
          const max = Math.max(others.P, others.C, others.A);
          const leaders = Object.keys(others).filter((k) => others[k] === max);
          if (total < MIN_OTHERS || leaders.length > 1) { a.few++; continue; }
          const line = leaders[0];
          const ab = abrevOf(grp.organeRef);
          a.groups[ab] = (a.groups[ab] ?? 0) + 1;
          a.n++;
          if (mine === line) { a.ok++; continue; }
          const opposite = (mine === "P" && line === "C") || (mine === "C" && line === "P");
          if (opposite) a.opp++;
          // How notable the break was: how united the rest of the group was, damped for small turnouts.
          const cohesion = max / total;
          a.rebels.push({ num, mine, line, cohesion, others: total, score: cohesion * (total / (total + 8)) + (opposite ? 0.1 : 0) });
        }
      }
    }
  }

  function result() {
    const byId = new Map(deputes.map((d) => [d.id, d]));
    const mps = [];
    for (const [id, a] of acc) {
      const d = byId.get(id);
      const currentNI = !d.groupe || d.groupe.abrev === "NI";
      const groups = [...Object.entries(a.groups), ...(a.ni ? [["NI", a.ni]] : [])].sort((x, y) => y[1] - x[1]);
      mps.push({
        id,
        g: currentNI ? null : d.groupe.abrev,
        n: a.n,
        ok: a.ok,
        opp: a.opp,
        ni: a.ni,
        few: a.few,
        loyalty: a.n ? a.ok / a.n : null,
        part: Math.round(d.stats.participation * 1000) / 1000,
        // groups voted under (by label), only when there was more than one, incl. time as NI
        moved: groups.length > 1 ? groups : undefined,
        top: a.rebels.sort((x, y) => y.score - x.score || y.num - x.num).slice(0, 8).map((r) => [r.num, r.mine, r.line, Math.round(r.cohesion * 1000) / 1000, r.others]),
      });
    }
    const ranked = mps.filter((m) => m.g && m.n >= MIN_VOTES).sort((a, b) => b.loyalty - a.loyalty || b.n - a.n);
    ranked.forEach((m, i) => {
      // ties share a rank
      m.rank = i && ranked[i - 1].loyalty === m.loyalty ? ranked[i - 1].rank : i + 1;
    });
    const groups = {};
    for (const m of ranked) {
      const g = (groups[m.g] ??= { n: 0, sum: 0, min: 1, max: 0, ok: 0, votes: 0 });
      g.n++; g.sum += m.loyalty; g.min = Math.min(g.min, m.loyalty); g.max = Math.max(g.max, m.loyalty);
      g.ok += m.ok; g.votes += m.n;
    }
    const r3 = (x) => Math.round(x * 10000) / 10000;
    for (const g of Object.values(groups)) { g.avg = r3(g.sum / g.n); g.pooled = r3(g.ok / g.votes); g.min = r3(g.min); g.max = r3(g.max); delete g.sum; delete g.ok; }
    for (const m of mps) if (m.loyalty != null) m.loyalty = r3(m.loyalty);
    return { generatedAt: new Date().toISOString(), minVotes: MIN_VOTES, minOthers: MIN_OTHERS, ranked: ranked.length, groups, mps };
  }

  return { add, result };
}
