// Situation de chaque élève pour une période (moyenne, rang, notes, conduite, paiement, période précédente),
// classe par classe, pour calculer la présélection d'une distinction.
import { chargerClasse, resultatsPeriode } from "./donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "./donneesDiscipline.js"
import { dansCible, periodePrecedente } from "./distinctions.js"
import { rpc } from "../supabase.js"

/**
 * classes : toutes les classes (avec niveau, cycle, section_id) ; periode : période choisie ; toutes : liste des périodes.
 * avancement(fait, total) : progression facultative. Renvoie la liste des situations des élèves concernés.
 */
export async function situationsEleves(distinction, classes, periode, toutes, exercice, avancement = () => {}) {
  const cibles = classes.filter((c) => dansCible(distinction.cible, c))
  const prec = periodePrecedente(periode, toutes)
  const criteres = distinction.criteres || {}
  let finances = null
  if (criteres.paiement === "en_regle" || criteres.paiement === "solde") {
    const f = await rpc("finance_eleves", { p_classe: null })
    finances = new Map((f?.eleves || []).map((e) => [e.inscription_id, { en_regle: !!e.en_regle, solde: e.statut === "solde" }]))
  }
  const situations = []
  let fait = 0
  for (const classe of cibles) {
    const d = await chargerClasse(classe, exercice)
    const ids = d.eleves.map((e) => e.inscriptionId)
    const discipline = await chargerDiscipline(ids, exercice)
    const bilans = bilansPeriode(discipline, ids, periode, d.sequences)
    const res = resultatsPeriode(d, periode)
    const avant = prec ? new Map(resultatsPeriode(d, prec).resultats.map((r) => [r.inscriptionId, r.moyenne ?? r.moyenneNonClassee])) : new Map()
    const codes = new Map(d.attributions.map((a) => [a.id, a.code]))
    for (const r of res.resultats) {
      const b = bilans.get(r.inscriptionId) || {}
      situations.push({
        inscriptionId: r.inscriptionId, eleve: r.eleve, classe,
        moyenne: r.moyenne, moyenneNonClassee: r.moyenneNonClassee, rang: r.rang,
        lignes: r.lignes.map((l) => ({ code: codes.get(l.attributionId), matiere: l.matiere, note: l.note, groupe: l.groupe })),
        groupes: r.groupes.map((g) => ({ groupe: g.groupe, moyenne: g.moyenne })),
        conduite: { nj: b.nj ?? 0, retards: b.retards ?? 0, note: b.note ?? null, sanctions: (b.incidents || []).length },
        paiement: finances ? finances.get(r.inscriptionId) || null : null,
        precedente: avant.get(r.inscriptionId) ?? null,
      })
    }
    avancement(++fait, cibles.length)
  }
  return situations
}
