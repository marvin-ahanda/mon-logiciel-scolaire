import { locale } from "../i18n.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"
import { calculerBilans, sequencesDePeriode } from "./discipline.js"

/** Évènements disciplinaires d'une liste d'inscriptions (toutes séquences de l'exercice) et barème. */
export async function chargerDiscipline(inscriptionIds, exercice) {
  if (!inscriptionIds.length) return { absences: [], retards: [], incidents: [], bareme: { note_max: 20, points_par_retard: 0.25, points_par_heure: 0.25 } }
  const morceaux = []                       // filtres « in » raisonnables (adresse de requête limitée)
  for (let k = 0; k < inscriptionIds.length; k += 150) morceaux.push(inscriptionIds.slice(k, k + 150))
  const charger = async (table, colonnes) => (await Promise.all(morceaux.map((ids) =>
    toutCharger(() => supabase.from(table).select(colonnes).in("inscription_id", ids))))).flat()
  const [absences, retards, incidents, bareme] = await Promise.all([
    charger("absences", "*"), charger("retards", "*"),
    charger("incidents", "*, infractions(libelle, sanction_id, sanctions(libelle, points_perdus))"),
    supabase.from("parametres_discipline").select("*").eq("exercice_id", exercice.id).maybeSingle().then(verifier),
  ])
  return { absences, retards, incidents, bareme: bareme || { note_max: 20, points_par_retard: 0.25, points_par_heure: 0.25 } }
}

/** Bilans par inscription pour une période. */
export function bilansPeriode(discipline, inscriptionIds, periode, sequences) {
  const seqs = new Set(sequencesDePeriode(periode, sequences).map((s) => s.id))
  const dans = (x) => seqs.has(x.sequence_id)
  return calculerBilans(inscriptionIds, discipline.absences.filter(dans), discipline.retards.filter(dans),
    discipline.incidents.filter(dans).map((x) => ({ inscription_id: x.inscription_id, libelle: `${x.infractions.libelle} (${new Date(x.date).toLocaleDateString(locale())})`,
                                                    points: x.infractions.sanctions.points_perdus })),
    discipline.bareme)
}
