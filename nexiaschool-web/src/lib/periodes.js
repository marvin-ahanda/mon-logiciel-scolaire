/** Périodes d'un exercice : 6 séquences, 3 trimestres, l'année. */
export function periodes(sequences) {
  return [
    ...sequences.map((s) => ({ code: `s${s.numero}`, type: "sequence", sequenceId: s.id, libelle: `Séquence ${s.numero}` })),
    ...[1, 2, 3].map((t) => ({ code: `t${t}`, type: "trimestre", trimestre: t, libelle: `Trimestre ${t}` })),
    { code: "a", type: "annee", libelle: "Bilan annuel" },
  ]
}
