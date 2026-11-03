import { supabase, toutCharger, verifier } from "../supabase.js"
import { calculerResultats, notePeriode } from "./calculs.js"
import { comparerNoms, nomComplet } from "./format.js"

/** Toutes les données nécessaires aux résultats d'une classe pour l'exercice. */
export async function chargerClasse(classe, exercice) {
  const [attributions, inscriptions, sequences, personnels] = await Promise.all([
    toutCharger(() => supabase.from("attributions").select("id, coefficient, groupe, enseignant_id, matieres(code, libelle)")
      .eq("classe_id", classe.id).eq("exercice_id", exercice.id)),
    toutCharger(() => supabase.from("inscriptions").select("id, redoublant, eleves(*)").eq("classe_id", classe.id).eq("exercice_id", exercice.id)),
    supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero").then(verifier),
    supabase.from("personnels").select("id, nom, prenom").then(verifier),
  ])
  const noms = new Map(personnels.map((p) => [p.id, nomComplet(p)]))
  const ids = attributions.map((a) => a.id)
  const notes = ids.length ? await toutCharger(() => supabase.from("notes").select("inscription_id, attribution_id, sequence_id, valeur").in("attribution_id", ids)) : []
  return {
    classe, sequences, notes,
    attributions: attributions.map((a) => ({ id: a.id, matiere: a.matieres.libelle, code: a.matieres.code, coefficient: a.coefficient,
                                             groupe: a.groupe, enseignant: noms.get(a.enseignant_id) || "" }))
      .sort((a, b) => a.groupe - b.groupe || comparerNoms(a.matiere, b.matiere)),
    eleves: inscriptions.map((i) => ({ inscriptionId: i.id, redoublant: i.redoublant, eleve: i.eleves }))
      .sort((a, b) => comparerNoms(nomComplet(a.eleve), nomComplet(b.eleve))),
  }
}

/** Résultats d'une classe pour une période. */
export function resultatsPeriode(donnees, periode) {
  const parCle = new Map()
  for (const n of donnees.notes) {
    const cle = `${n.inscription_id}|${n.attribution_id}`
    if (!parCle.has(cle)) parCle.set(cle, new Map())
    parCle.get(cle).set(n.sequence_id, Number(n.valeur))
  }
  const notes = new Map()
  for (const [cle, seqs] of parCle) {
    const v = notePeriode(periode, seqs, donnees.sequences)
    if (v !== null) notes.set(cle, v)
  }
  return calculerResultats(donnees.eleves, donnees.attributions, notes, donnees.classe.coef_min || 0)
}
