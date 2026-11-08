import { supabase, toutCharger, verifier } from "../supabase.js"
import { calculerResultats, notePeriode } from "./calculs.js"
import { t } from "../i18n.jsx"
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

/** Colonnes de détail du bulletin : séquences du trimestre, ou trimestres de l'année ; aucune pour une séquence. */
export function sousPeriodes(periode, sequences) {
  if (periode.type === "trimestre") return sequences.filter((s) => s.trimestre === periode.trimestre)
    .map((s) => ({ libelle: t("Séq. {v0}", { v0: s.numero }), periode: { type: "sequence", sequenceId: s.id } }))
  if (periode.type === "annee") return [1, 2, 3].map((n) => ({ libelle: t("Trim. {v0}", { v0: n }), periode: { type: "trimestre", trimestre: n } }))
  return []
}

/**
 * Résultats d'une classe pour une période.
 * Chaque ligne porte aussi `details` (notes des sous-périodes, alignées sur `entetes`) ;
 * pour l'année, chaque élève porte `moyennesTrimestres` ([T1, T2, T3]).
 */
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
  const res = calculerResultats(donnees.eleves, donnees.attributions, notes, donnees.classe.coef_min || 0)
  const sous = sousPeriodes(periode, donnees.sequences)
  for (const r of res.resultats) for (const l of r.lignes) {
    const seqs = parCle.get(`${r.inscriptionId}|${l.attributionId}`)
    l.details = sous.map((s) => (seqs ? notePeriode(s.periode, seqs, donnees.sequences) : null))
  }
  if (periode.type === "annee") {
    const parTrimestre = [1, 2, 3].map((n) => new Map(resultatsPeriode(donnees, { type: "trimestre", trimestre: n }).resultats
      .map((r) => [r.inscriptionId, r.moyenne ?? r.moyenneNonClassee])))
    for (const r of res.resultats) r.moyennesTrimestres = parTrimestre.map((m) => m.get(r.inscriptionId) ?? null)
  }
  return { ...res, entetes: sous.map((s) => s.libelle) }
}
