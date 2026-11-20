import { t } from "../i18n.jsx"
/** Périodes d'un exercice : 6 séquences, 3 trimestres, l'année, puis les périodes personnalisées de l'établissement
 *  (ex. « Semestre 1 » = séquences 1 à 3 ; table periodes_personnalisees). */
export function periodes(sequences, personnalisees = []) {
  return [
    ...sequences.map((s) => ({ code: `s${s.numero}`, type: "sequence", sequenceId: s.id, libelle: t("Séquence {v0}", {
      v0: s.numero
    }) })),
    ...[1, 2, 3].map((n) => ({ code: `t${n}`, type: "trimestre", trimestre: n, libelle: t("Trimestre {v0}", { v0: n }) })),
    { code: "a", type: "annee", libelle: t("Bilan annuel") },
    ...personnalisees.map((p) => ({ code: `p:${p.id}`, type: "perso", numeros: p.sequences.map(Number), libelle: p.libelle })),
  ];
}
