// David Lisnard's parliamentary record: none. Mayor of Cannes since 2014, never a member of the Assembly,
// the Senate or the European Parliament (checked against the open rosters in _no-mandate.mjs).
import { writeNoMandateRecord } from "./_no-mandate.mjs";

await writeNoMandateRecord({
  slug: "lisnard",
  first: "David",
  last: "Lisnard",
  people: [{ name: "David Lisnard", role: { fr: "Maire de Cannes, président de Nouvelle Énergie", en: "Mayor of Cannes, leader of Nouvelle Énergie" } }],
  notCovered: [
    { person: "David Lisnard", chamber: "AN", from: null, to: null, why: { fr: "Aucun mandat parlementaire : il n'a jamais été député, sénateur ni député européen ; ses mandats sont locaux (maire de Cannes).", en: "No parliamentary mandate: never an MP, senator or MEP; his mandates are local (mayor of Cannes)." } },
    { person: "Nouvelle Énergie", chamber: "AN", from: "2024-07-18", to: null, why: { fr: "Nouvelle Énergie n'a pas de groupe ni de député élu sous son étiquette à l'Assemblée.", en: "Nouvelle Énergie has no group and no MP elected under its label in the Assembly." } },
  ],
});
