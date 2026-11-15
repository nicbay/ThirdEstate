// Dominique de Villepin's parliamentary record: none. Minister (2002–2005) and Prime Minister (2005–2007),
// never elected to the Assembly, the Senate or the European Parliament (checked in _no-mandate.mjs; the
// Senate roster's "de Villepin" is his father Xavier).
import { writeNoMandateRecord } from "./_no-mandate.mjs";

await writeNoMandateRecord({
  slug: "villepin",
  first: "Dominique",
  last: "de Villepin",
  people: [{ name: "Dominique de Villepin", role: { fr: "Ancien Premier ministre (2005-2007), fondateur de La France humaniste", en: "Former Prime Minister (2005–2007), founder of La France humaniste" } }],
  notCovered: [
    { person: "Dominique de Villepin", chamber: "AN", from: null, to: null, why: { fr: "Aucun mandat parlementaire : il n'a jamais été élu député, sénateur ni député européen. Ses décisions comme ministre puis Premier ministre ne sont pas des votes parlementaires.", en: "No parliamentary mandate: never elected MP, senator or MEP. His decisions as minister and Prime Minister are not parliamentary votes." } },
    { person: "La France humaniste", chamber: "AN", from: "2024-07-18", to: null, why: { fr: "La France humaniste n'a pas de groupe ni de député à l'Assemblée.", en: "La France humaniste has no group and no MP in the Assembly." } },
  ],
});
