// Construction des PV individuels d'un ensemble de classes déjà chargées (voir donnees.chargerGroupe) : moyennes de la
// classe et, si l'établissement l'autorise, du cycle ; courbe d'évolution séquence par séquence ; distinctions,
// décision de passage, commentaire et (en option) situation financière.
import { moyenneSimple } from "../calculs.js"
import { recalculerGroupe } from "./donnees.js"
import { moyennesMatieres, pvIndividuel } from "./moteur.js"

const moyenneDe = (r) => r.moyenne ?? r.moyenneNonClassee ?? null

/** Moyennes du cycle : générale et par matière (libellé), à partir des classes du groupe. */
export function moyennesCycles(groupe) {
  const parCycle = new Map()
  for (const g of groupe) {
    const k = g.classe.cycleId || ""
    if (!parCycle.has(k)) parCycle.set(k, { moyennes: [], matieres: new Map() })
    const c = parCycle.get(k)
    for (const r of g.resultats) {
      c.moyennes.push(moyenneDe(r))
      for (const l of r.lignes) { if (!c.matieres.has(l.matiere)) c.matieres.set(l.matiere, []); c.matieres.get(l.matiere).push(l.note) }
    }
  }
  return new Map([...parCycle].map(([k, c]) => [k, { moyenne: moyenneSimple(c.moyennes), matieres: new Map([...c.matieres].map(([m, v]) => [m, moyenneSimple(v)])) }]))
}

/** Points d'évolution par élève : Map inscription -> [{ libelle, eleve, classe, cycle }]. */
export function evolutions(groupe, sequencesPeriodes, toutes, { avecCycle = false } = {}) {
  const parEleve = new Map()
  for (const p of sequencesPeriodes) {
    const g2 = recalculerGroupe(groupe, p, toutes)
    const cycles = avecCycle ? moyennesCycles(g2) : null
    for (const g of g2) {
      const moyClasse = g.stats?.moyenneClasse ?? moyenneSimple(g.resultats.map(moyenneDe))
      for (const r of g.resultats) {
        if (!parEleve.has(r.inscriptionId)) parEleve.set(r.inscriptionId, [])
        parEleve.get(r.inscriptionId).push({ libelle: p.code.toUpperCase(), eleve: moyenneDe(r), classe: moyClasse,
          cycle: cycles ? cycles.get(g.classe.cycleId || "")?.moyenne ?? null : null })
      }
    }
  }
  // on retire les séquences sans aucune note pour la classe (fin d'année pas encore atteinte)
  for (const [k, pts] of parEleve) parEleve.set(k, pts.filter((p) => p.classe !== null))
  return parEleve
}

/**
 * x = { groupe, periode, toutes (périodes), annee, reglages, complements: { distinctions, decisions, commentaires },
 *       finances: Map | null, inclurePaiement, cible: Set d'inscriptions retenues (null = toutes) }
 * Renvoie [{ inscriptionId, classe, contenu }].
 */
export function construireIndividuels(x) {
  const avecCycle = !!x.reglages?.comparer_cycle
  const cycles = avecCycle ? moyennesCycles(x.groupe) : null
  const sequences = x.toutes.filter((p) => p.type === "sequence")
  const evol = evolutions(x.groupe, sequences, x.toutes, { avecCycle })
  const prec = x.precedent ? new Map(x.precedent.flatMap((g) => g.resultats.map((r) => [r.inscriptionId, r]))) : new Map()
  const sortie = []
  for (const g of x.groupe) {
    const moyennesClasse = moyennesMatieres(g.resultats)
    const moyenneClasse = g.stats?.moyenneClasse ?? moyenneSimple(g.resultats.map(moyenneDe))
    const cycle = cycles?.get(g.classe.cycleId || "")
    for (const r of g.resultats) {
      if (x.cible && !x.cible.has(r.inscriptionId)) continue
      const com = x.complements?.commentaires?.get(r.inscriptionId)
      const contenu = pvIndividuel({
        r, entetes: g.entetes, moyenneClasse, moyennesClasse,
        moyenneCycle: cycle ? cycle.moyenne : null, moyennesCycle: cycle ? r.lignes.map((l) => cycle.matieres.get(l.matiere) ?? null) : null,
        precedente: prec.get(r.inscriptionId) || null, evolution: evol.get(r.inscriptionId) || [],
        bilan: g.bilans.get(r.inscriptionId), distinctions: x.complements?.distinctions?.get(r.inscriptionId) || [],
        paiement: x.inclurePaiement && x.finances ? x.finances.get(r.inscriptionId) ?? null : null,
        decision: x.periode.type === "annee" ? x.complements?.decisions?.get(r.inscriptionId) || null : null,
        commentaires: (com || []).map((c) => ({ texte: c.commentaire, auteur: c.auteur, fonction: c.fonction, auteurId: c.auteur_id })),
        reglages: x.reglages,
      })
      sortie.push({ inscriptionId: r.inscriptionId, classe: g.classe, contenu: {
        ...contenu, classe: g.classe.libelle, cycle: g.classe.cycleLibelle || "", annee: x.annee, periode: { code: x.periode.code, libelle: x.periode.libelle } } })
    }
  }
  return sortie
}
