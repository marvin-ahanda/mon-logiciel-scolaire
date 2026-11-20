// Propositions de décisions de passage pour une classe : moyenne annuelle, décision de fin d'année (critères de
// l'établissement, y compris matières en échec, note minimale par matière et portée), orientation acceptée,
// règles de passage. Partagé par « Décisions de passage » et « Transition d'année ».
import { chargerClasse, resultatsPeriode } from "./donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "./donneesDiscipline.js"
import { decisionProposee, sanctionsParEleve } from "./decisions.js"
import { proposer } from "./parcours.js"
import { supabase, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * reference = { regles, niveaux } ; avecCriteres : l'offre comprend les décisions de fin de période.
 * Renvoie [{ inscription_id, eleve, moyenne, fin (libellé), decisionFin, orientation, existante, proposition }].
 */
export async function propositionsClasse(classe, reference, exercice, { avecCriteres = true } = {}) {
  const d = await chargerClasse(classe, exercice)
  const periode = { type: "annee", code: "a", libelle: t("Bilan annuel") }
  const res = resultatsPeriode(d, periode)
  const ids = d.eleves.map((e) => e.inscriptionId)
  const [discipline, criteres, orientations, existantes] = await Promise.all([chargerDiscipline(ids, exercice),
    supabase.from("criteres_decision").select("*").then(verifier).catch(() => []),
    ids.length ? supabase.from("orientations").select("*").in("inscription_id", ids).eq("statut", "acceptee").neq("type", "changement_serie").then(verifier) : [],
    ids.length ? supabase.from("decisions_passage").select("*").in("inscription_id", ids).then(verifier) : []])
  const conduite = bilansPeriode(discipline, ids, periode, d.sequences)
  const sanctions = sanctionsParEleve(discipline.incidents, d.sequences)
  const codes = new Map(d.attributions.map((a) => [a.id, a.code]))
  const contexte = { niveau_id: classe.niveau_id, section_id: classe.section_id, cycle_id: reference.niveaux.find((n) => n.id === classe.niveau_id)?.cycle_id || null }
  return res.resultats.map((x) => {
    const moyenne = x.moyenne ?? x.moyenneNonClassee
    const fin = avecCriteres ? decisionProposee(criteres, "a", { moyenne, conduite: conduite.get(x.inscriptionId), sanctions: sanctions.get(x.inscriptionId),
      notes: x.lignes.map((l) => l.note), classe: contexte }) : null
    const orientation = orientations.find((o) => o.inscription_id === x.inscriptionId) || null
    const proposition = proposer({ niveauId: classe.niveau_id, serieId: classe.serie_id, moyenne, decisionFin: fin?.decision ?? null,
      lignes: x.lignes.map((l) => ({ code: codes.get(l.attributionId), note: l.note })), orientation }, reference.regles, { niveaux: reference.niveaux })
    return { inscription_id: x.inscriptionId, eleve: x.eleve, moyenne, fin: fin?.libelle || "—", decisionFin: fin?.decision ?? null, orientation,
      existante: existantes.find((e) => e.inscription_id === x.inscriptionId) || null, proposition }
  })
}
