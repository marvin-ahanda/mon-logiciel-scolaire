import { t } from "../i18n.jsx"
/** Périodes d'un exercice : 6 séquences, 3 trimestres, l'année. */
export function periodes(sequences) {
  return [
    ...sequences.map((s) => ({ code: `s${s.numero}`, type: "sequence", sequenceId: s.id, libelle: t("Séquence {v0}", {
      v0: s.numero
    }) })),
    ...[1, 2, 3].map((n) => ({ code: `t${n}`, type: "trimestre", trimestre: n, libelle: t("Trimestre {v0}", { v0: n }) })),
    { code: "a", type: "annee", libelle: t("Bilan annuel") },
  ];
}
