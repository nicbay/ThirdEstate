// Hand checks of the household simulator rules: `node scripts/test-household.ts` (Node ≥ 23, type stripping).
import { simulate, DEFAULT_HOUSEHOLD, incomeTax, IR_2026, type Household } from "../src/lib/household-rules.ts";

const base = (o: Partial<Household>): Household => ({ ...DEFAULT_HOUSEHOLD, kids: { u3: 0, k3_10: 0, k11_17: 0, s18_24: 0 }, ...o });

// sanity check against service-public.gouv.fr's 2026 example: single, 30 000 € taxable → 2 103.99 €
const ex = incomeTax(30000, { couple: false, nKids: 0, isolated: false, brackets: IR_2026 });
console.log(`check: single 30 000 € taxable → ${ex} € (service-public: 2 104 €)`);

const cases: [string, Household][] = [
  ["Single at SMIC (private, tenant 650 €/month)", base({ status: "single", adults: [{ job: "private", net: 1478 }], housing: "tenant", rent: 650 })],
  ["Married, 2 kids (4 and 12), 3 000 + 2 000 net, owners", base({ status: "married", adults: [{ job: "private", net: 3000 }, { job: "public", net: 2000 }], kids: { u3: 0, k3_10: 1, k11_17: 1, s18_24: 0 }, housing: "owner", rent: 0 })],
  ["Retired, 1 200 € pension, full career, tenant 500 €", base({ status: "single", adults: [{ job: "retired", net: 1200, fullCareer: true }], housing: "tenant", rent: 500 })],
  ["Executive, 8 000 net, single, 50 000 € capital income, 1.5 M€ wealth (1 M€ property)", base({ status: "single", adults: [{ job: "private", net: 8000 }], housing: "owner", rent: 0, capital: 50000, wealth: 1500000, realEstate: 1000000 })],
  ["Top 0.1 %: married, 50 M€ wealth (5 M€ property), 1 M€ capital income, 20 000 net salary", base({ status: "married", adults: [{ job: "private", net: 20000 }, { job: "inactive", net: 0 }], housing: "owner", rent: 0, capital: 1000000, wealth: 50e6, realEstate: 5e6, inheritance: 0 })],
  ["Zucman case: single, 500 M€ wealth (20 M€ property), 2 M€ capital income", base({ status: "single", adults: [{ job: "inactive", net: 0 }], housing: "owner", rent: 0, capital: 2e6, wealth: 500e6, realEstate: 20e6, inheritance: 0 })],
];

for (const [name, h] of cases) {
  const r = simulate(h);
  console.log(`\n== ${name}`);
  console.log(`   income tax today ${r.irToday} €, under the programme ${r.irReform} €; standard of living ${Math.round(r.nivVie)} €/UC`);
  for (const l of r.lines) console.log(`   ${String(l.amount).padStart(9)}  ${l.label.en}${l.assumption ? " [assumption]" : ""}`);
  for (const l of r.oneOff) console.log(`   ${String(l.amount).padStart(9)}  ${l.label.en} (one-off)`);
  console.log(`   TOTAL ${r.total} € a year (tax rises ${r.taxRise} €)`);
}
