// Hand-reviewed contradictions between Nicolas Dupont-Aignan's Assembly votes (2012–2024) and his programme.
// Built by scripts/record/dupont-aignan.mjs, which checks each entry against the recorded vote (`expect`).
//
// Review notes (2026-11-14). All 643 votes he cast (130 in the 14th legislature, 328 in the 15th, 185 in the
// 16th) were read by title against the 26 measures. Consistent with the programme, so not listed: against the
// TSCG (14/30), the Aachen treaty (15/2130), CETA (15/2059), the EU own-resources decision (15/3321) and the
// 2013 pension reform (14/647); against the 2020 universal pension bill and the 2023 pension bill's articles;
// for keeping EDF whole (16/935), the BCE perpetual-debt resolution (15/2752), the AME resolution (16/1780),
// denouncing the 1968 Franco-Algerian agreement (16/3183); against the Ukraine security-agreement
// declaration (16/3461); against the 2014 Taubira law that abolished peines planchers (14/810); against
// deleting article 1 of the bill abolishing ZFEs (16/827).
//
// Considered and rejected: abstention on the 2023 immigration law (16/3213, CMP text), which then contained a
// five-year residence condition for family benefits (measure d09). An abstention is not a vote against, and he
// said publicly the text did not go far enough (Sud Radio, 20 December 2023), so it does not contradict d09.
export const contradictions = [
  {
    leg: 15,
    num: 2756,
    expect: "C",
    measure: "d22",
    label: { fr: "Faire de la dépendance une cinquième branche de la Sécurité sociale", en: "Make long-term care a fifth branch of social security" },
    explanation: {
      fr: "Il a voté contre la loi de 2020 qui a créé la cinquième branche « autonomie » qu'il propose en 2022 ; ce texte organisait surtout le transfert de 136 Md€ de dette sociale à la CADES, ce qui peut expliquer son vote.",
      en: "He voted against the 2020 law that created the 'autonomy' fifth branch he proposed in 2022; the bill mainly moved €136bn of social debt to CADES, which may explain his vote.",
    },
    strength: "partial",
  },
];
