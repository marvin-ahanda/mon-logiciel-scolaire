// Bilan disciplinaire (rubriques du logiciel d'origine : ponctualité, assiduité, autres cas).
// note = note maximale − (retards × points par retard + heures non justifiées × points par heure + points des sanctions), minimum 0.
import { appreciation, arrondi } from "./calculs.js"

/**
 * inscriptionIds : identifiants des élèves ; absences : [{ inscription_id, heures_non_justifiees, heures_justifiees }]
 * retards : [{ inscription_id }] ; incidents : [{ inscription_id, libelle, points }] ;
 * bareme : { note_max, points_par_retard, points_par_heure }
 */
export function calculerBilans(inscriptionIds, absences, retards, incidents, bareme) {
  const b = new Map(inscriptionIds.map((i) => [i, { nj: 0, j: 0, retards: 0, incidents: [], pointsAutres: 0 }]))
  for (const a of absences) if (b.has(a.inscription_id)) { b.get(a.inscription_id).nj += a.heures_non_justifiees; b.get(a.inscription_id).j += a.heures_justifiees }
  for (const r of retards) if (b.has(r.inscription_id)) b.get(r.inscription_id).retards += 1
  for (const x of incidents) if (b.has(x.inscription_id)) { b.get(x.inscription_id).incidents.push(x.libelle); b.get(x.inscription_id).pointsAutres += Number(x.points) }
  for (const v of b.values()) {
    v.pointsPonctualite = arrondi(v.retards * Number(bareme.points_par_retard))
    v.pointsAssiduite = arrondi(v.nj * Number(bareme.points_par_heure))
    v.pointsAutres = arrondi(v.pointsAutres)
    v.note = arrondi(Math.max(0, Number(bareme.note_max) - (v.pointsPonctualite + v.pointsAssiduite + v.pointsAutres)))
    v.appreciation = appreciation(v.note)
  }
  return b
}

/** Séquences couvertes par une période. */
export function sequencesDePeriode(periode, sequences) {
  if (periode.type === "sequence") return sequences.filter((s) => s.id === periode.sequenceId)
  if (periode.type === "trimestre") return sequences.filter((s) => s.trimestre === periode.trimestre)
  return sequences
}
