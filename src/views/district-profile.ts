// "Your district" profile: local public data aggregated to the legislative district
// (crime, unemployment, income, local spending, schools, events), each figure compared with
// the national distribution across districts. Data: scripts/sync-district-profiles.mjs.
import { fetchJson } from "../data";
import { L, fmtDate, fmtNum, getLang } from "../i18n";
import { esc, safeUrl } from "../util";

type Bench = { fr: string; en: string; unit: string; year?: number; n: number; median: number; deciles: number[]; min: number; max: number };
interface Index { indicators: Record<string, Bench>; national: Record<string, { rates?: Record<string, number>; france?: number; year?: number }> }
let indexP: Promise<Index> | null = null;
const loadIndex = () => (indexP ??= fetchJson<Index>("/data/districts/index.json"));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Profile = any;

/** Rough position among districts: "higher than 80% of districts". */
function rank(b: Bench | undefined, v: number | null | undefined) {
  if (!b || v == null) return null;
  const below = b.deciles.filter((d) => v > d).length; // 0..9
  return below * 10;
}
function compare(b: Bench | undefined, v: number | null | undefined, higherIsWorse = true) {
  const r = rank(b, v);
  if (r == null || !b) return "";
  const fr = getLang() === "fr";
  const pos = r >= 50 ? (fr ? `plus élevé que dans ${r} % des circonscriptions` : `higher than in ${r}% of districts`) : fr ? `plus bas que dans ${100 - r - 10} % des circonscriptions` : `lower than in ${100 - r - 10}% of districts`;
  const tone = r >= 70 ? (higherIsWorse ? "worse" : "better") : r <= 20 ? (higherIsWorse ? "better" : "worse") : "mid";
  return `<span class="cmp cmp-${tone}">${pos}</span>`;
}
/** Small bar: where the value sits between the national min and max, with the median marked. */
function scale(b: Bench | undefined, v: number | null | undefined) {
  if (!b || v == null) return "";
  const lo = b.deciles[0], hi = b.deciles[8];
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo || 1)) * 100));
  return `<span class="scale" data-tip="${esc(`${L("Médiane des circonscriptions : ", "District median: ")}${fmt(b.median)}\n${L("1er–9e décile : ", "1st–9th decile: ")}${fmt(lo)} – ${fmt(hi)}`)}"><i class="med" style="left:${pct(b.median)}%"></i><i class="val" style="left:${pct(v)}%"></i></span>`;
}
/** "2026-T2" / "2026-Q2" → "T2 2026" in French, "Q2 2026" in English. */
const quarter = (p: string) => {
  const m = /^(\d{4})-?[TQ]([1-4])$/i.exec(String(p ?? ""));
  return m ? L(`T${m[2]} ${m[1]}`, `Q${m[2]} ${m[1]}`) : String(p ?? "");
};
const fmt = (n: number) => (Math.abs(n) >= 1000 ? fmtNum(Math.round(n)) : n.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 }));
const src = (s: { name: string; url?: string } | undefined, year?: number | string) => (s ? `<a href="${s.url ? esc(safeUrl(s.url)) : "#"}" target="_blank" rel="noopener">${esc(s.name.split(" — ")[0])}</a>${year ? ` ${year}` : ""}` : "");

export async function renderDistrictProfile(box: HTMLElement, code: string) {
  let p: Profile;
  try {
    [p] = await Promise.all([fetchJson<Profile>(`/data/districts/${code}.json`), loadIndex()]);
  } catch {
    box.innerHTML = `<p class="muted">${L("Pas de données locales pour cette circonscription.", "No local data for this district.")}</p>`;
    return;
  }
  const idx = await loadIndex();
  const B = idx.indicators;
  const I = p.indicators;
  const ok = (x: any) => x && x.status === "ok";
  const fr = getLang() === "fr";

  const kpi = (label: string, value: string, bench: Bench | undefined, v: number | null | undefined, sub: string, higherIsWorse = true) =>
    `<div class="lk"><span class="muted small">${label}</span><strong>${value}</strong>${scale(bench, v)}<span class="small">${compare(bench, v, higherIsWorse)}</span><span class="muted tiny">${sub}</span></div>`;

  const k: string[] = [];
  if (p.geography?.population) k.push(kpi(L("Habitants", "Inhabitants"), fmtNum(p.geography.population), B.population, p.geography.population, `INSEE ${p.geography.populationYear}`, false));
  if (ok(I.unemploymentCensus)) k.push(kpi(L("Chômage (recensement)", "Unemployment (census)"), `${fmt(I.unemploymentCensus.district.rate)}${L(" %", "%")}`, B["unemploymentCensus.rate"], I.unemploymentCensus.district.rate, `${L("15–64 ans", "aged 15–64")}, ${I.unemploymentCensus.year}`));
  if (ok(I.unemploymentQuarterly)) k.push(kpi(L("Chômage, dernier trimestre", "Unemployment, latest quarter"), `${fmt(I.unemploymentQuarterly.district.rate)}${L(" %", "%")}`, B["unemploymentQuarterly.rate"], I.unemploymentQuarterly.district.rate, `${L("estimé, BIT", "estimated, ILO")}, ${quarter(I.unemploymentQuarterly.period)}`));
  if (ok(I.income)) {
    k.push(kpi(L("Niveau de vie médian", "Median standard of living"), `${fmtNum(Math.round(I.income.district.medianIncomeApprox))} €`, B["income.median"], I.income.district.medianIncomeApprox, `${L("par an et par unité de consommation, approx.", "per year per consumption unit, approx.")}, ${I.income.year}`, false));
    k.push(kpi(L("Taux de pauvreté", "Poverty rate"), `${fmt(I.income.district.povertyRateApprox)}${L(" %", "%")}`, B["income.poverty"], I.income.district.povertyRateApprox, `${L("approx.", "approx.")}, ${I.income.year}`));
  }
  if (ok(I.localSpending) && I.localSpending.communes?.district) k.push(kpi(L("Dépense des communes", "Municipal spending"), `${fmtNum(I.localSpending.communes.district.total)} €`, B["localSpending.commune.total"], I.localSpending.communes.district.total, `${L("par habitant", "per inhabitant")}, ${I.localSpending.year}`, false));

  // crime table
  const crime = ok(I.crime)
    ? Object.entries(I.crime.district as Record<string, { rate: number; rateEstimated?: number; coverage: number }>)
        .filter(([key]) => I.crime.indicators[key])
        .map(([key, v]) => {
          const meta = I.crime.indicators[key];
          const nat = idx.national.crime?.rates?.[key];
          const val = v.rateEstimated ?? v.rate;
          return `<tr><td>${esc(fr ? meta.fr : meta.en)}${v.coverage < 0.9 ? ` <span class="muted tiny">${L("partiel", "partial")}</span>` : ""}</td><td class="num"><b>${fmt(val)}</b></td><td class="num muted">${nat != null ? fmt(nat) : "–"}</td><td>${scale(B[`crime.${key}`], val)}</td></tr>`;
        })
        .join("")
    : "";

  // schools
  const schools = ok(I.schools) ? (I.schools.list as any[]) : [];
  const colleges = schools.filter((s) => s.type === "college").sort((a, b) => (b.ips?.value ?? 0) - (a.ips?.value ?? 0));
  const lycees = schools.filter((s) => s.type === "lycee").sort((a, b) => (b.ips?.value ?? 0) - (a.ips?.value ?? 0));
  const va = (n: number | null | undefined) => (n == null ? "–" : `<span class="${n > 0 ? "up" : n < 0 ? "down" : "muted"}">${n > 0 ? "+" : ""}${n}</span>`);
  const sector = (s: any) => (s.sector === "private" ? L("privé", "private") : L("public", "public"));

  // events
  const ev = await fetchJson<{ events: any[]; source?: any }>(`/data/districts/events/${code}.json`).catch(() => null);

  box.innerHTML = `
    <section class="card">
      <header class="card-head"><h2>${L("La circonscription en chiffres", "The district in figures")}</h2><span class="muted small">${L("Comparé aux 577 circonscriptions", "Compared with all 577 districts")}</span></header>
      ${k.length ? `<div class="local-kpis">${k.join("")}</div>` : `<p class="muted">${L("Pas d’indicateurs disponibles ici.", "No indicators available here.")}</p>`}
      <p class="muted small">${L("Le trait noir sur chaque barre marque la médiane des circonscriptions, le point la valeur d’ici.", "On each bar, the black line marks the median district and the dot this district.")} ${p.geography?.units?.length ? `${L("Communes : ", "Communes: ")}${p.geography.units.slice(0, 12).map((u: any) => esc(u.name)).join(", ")}${p.geography.units.length > 12 ? "…" : ""}.` : ""}</p>
    </section>

    ${
      crime
        ? `<section class="card">
            <header class="card-head"><h2>${L("Délinquance enregistrée", "Recorded crime")}</h2><span class="muted small">${L("pour 1 000 habitants", "per 1,000 inhabitants")}, ${I.crime.year}</span></header>
            <table class="table"><thead><tr><th>${L("Infraction", "Offence")}</th><th class="num">${L("Ici", "Here")}</th><th class="num">France</th><th>${L("Position", "Position")}</th></tr></thead><tbody>${crime}</tbody></table>
            <p class="muted small">${L("Faits enregistrés par la police et la gendarmerie, pas la délinquance réelle. Les communes avec très peu de faits ne sont pas publiées ; elles sont estimées avec la moyenne départementale du ministère.", "Offences recorded by police and gendarmerie, not actual crime. Communes with very few offences aren’t published; they’re estimated with the ministry’s department average.")} ${L("Cambriolages : pour 1 000 logements.", "Burglary: per 1,000 dwellings.")} ${src(I.crime.source)}</p>
          </section>`
        : ""
    }

    ${
      schools.length
        ? `<section class="card">
            <header class="card-head"><h2>${L("Collèges et lycées", "Secondary schools")}</h2><span class="muted small">${colleges.length} ${L("collèges", "collèges")}, ${lycees.length} ${L("lycées", "lycées")}</span></header>
            <p class="muted small">${L("IPS : indice de position sociale des familles (100 = moyenne nationale). VA : valeur ajoutée, l’écart entre le résultat de l’établissement et celui attendu compte tenu de ses élèves ; c’est le meilleur indicateur de ce que l’école apporte.", "IPS: social position index of pupils’ families (100 = national average). VA: value added, the gap between the school’s result and the one expected given its pupils; it’s the best indicator of what the school adds.")}</p>
            <div class="grid-2">
              <div><h3>${L("Collèges", "Collèges")}</h3><table class="table"><thead><tr><th>${L("Établissement", "School")}</th><th class="num">IPS</th><th class="num">${L("Brevet", "Brevet")}</th><th class="num">VA</th></tr></thead><tbody>${colleges.slice(0, 25).map((s) => `<tr><td>${esc(titleCase(s.name))}<br><span class="muted tiny">${esc(s.communeName)}, ${sector(s)}${s.priorityEducation ? `, ${esc(s.priorityEducation)}` : ""}</span></td><td class="num">${s.ips?.value != null ? fmt(s.ips.value) : "–"}</td><td class="num">${s.dnb?.successRate != null ? `${s.dnb.successRate}${L(" %", "%")}` : "–"}</td><td class="num">${va(s.dnb?.successVA)}</td></tr>`).join("")}</tbody></table></div>
              <div><h3>${L("Lycées", "Lycées")}</h3><table class="table"><thead><tr><th>${L("Établissement", "School")}</th><th class="num">IPS</th><th class="num">Bac</th><th class="num">VA</th></tr></thead><tbody>${lycees.slice(0, 25).map((s) => { const r = s.bacGT ?? s.bacPro; return `<tr><td>${esc(titleCase(s.name))}<br><span class="muted tiny">${esc(s.communeName)}, ${sector(s)}</span></td><td class="num">${s.ips?.value != null ? fmt(s.ips.value) : "–"}</td><td class="num">${r?.successRate != null ? `${r.successRate}${L(" %", "%")}` : "–"}</td><td class="num">${va(r?.successVA)}</td></tr>`; }).join("")}</tbody></table></div>
            </div>
            <p class="source">${L("Ministère de l’Éducation nationale, open data.", "Ministry of Education open data.")}</p>
          </section>`
        : ""
    }

    <div class="grid-2">
      ${
        ok(I.localSpending)
          ? `<section class="card">
              <header class="card-head"><h2>${L("Dépense publique locale", "Local public spending")}</h2><span class="muted small">${L("€ par habitant", "€ per inhabitant")}, ${I.localSpending.year}</span></header>
              <table class="table"><tbody>
                ${[["communes", L("Communes", "Communes")], ["intercommunal", L("Intercommunalités", "Inter-communal bodies")], ["department", L("Département", "Department")], ["region", L("Région", "Region")]]
                  .map(([key, label]) => { const b = I.localSpending[key]; const v = b?.district?.total ?? b?.perCapita?.total; return v != null ? `<tr><td>${label}</td><td class="num"><b>${fmtNum(v)} €</b></td></tr>` : ""; })
                  .join("")}
              </tbody></table>
              <p class="muted small">${I.stateSpending?.status !== "ok" ? L("Les dépenses de l’État ne sont pas publiées par territoire : elles ne figurent donc pas ici.", "State spending isn’t published by territory, so it isn’t shown here.") : ""} ${src(I.localSpending.communes?.source)}</p>
            </section>`
          : ""
      }
      ${
        ev?.events?.length
          ? `<section class="card">
              <header class="card-head"><h2>${L("À venir près de chez vous", "Coming up nearby")}</h2></header>
              <ul class="events">${ev.events.slice(0, 8).map((e) => `<li><span class="muted small">${fmtDate(e.start)}${e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ""}, ${esc(e.commune ?? "")}</span><br><a href="${esc(safeUrl(e.url ?? e.datatourisme))}" target="_blank" rel="noopener">${esc(e.name)}</a></li>`).join("")}</ul>
              <p class="source">DATAtourisme, ${L("offices de tourisme", "tourist offices")}.</p>
            </section>`
          : ""
      }
    </div>`;
}

function titleCase(s: string) {
  return s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s;
}
