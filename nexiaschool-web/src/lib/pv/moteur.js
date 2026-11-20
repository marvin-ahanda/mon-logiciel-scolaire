// Moteur unifié des PV et rapports (rubrique Notes) : un seul jeu de calculs pour le PV de classe (notes brutes, sans
// moyennes obligatoires), le PV par cycle, le PV général de l'établissement et le PV de performances individuelles.
// Fonctions pures : les données arrivent déjà chargées (voir donnees.js), rien n'est écrit ici. Les seuils viennent des
// réglages de l'établissement (table pv_reglages) : aucune règle propre à un établissement n'est codée en dur.
import { arrondi, moyenneSimple } from "../calculs.js"
import { TRANCHES } from "../statistiques.js"

/** Réglages par défaut (remplacés par ceux de l'établissement). */
export const REGLAGES_DEFAUT = Object.freeze({
  seuil_reussite: 10, seuil_difficulte: 8, part_echecs: 50, baisse_alerte: 2,
  signataires: [], afficher_cachet: true, comparer_cycle: false, repartition_sexe: true,
})

/** Réglages effectifs (valeurs numériques garanties). */
export function reglagesPv(r) {
  const x = { ...REGLAGES_DEFAUT, ...(r || {}) }
  const num = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v))
  return {
    ...x,
    seuil_reussite: num(x.seuil_reussite, 10), seuil_difficulte: num(x.seuil_difficulte, 8),
    part_echecs: num(x.part_echecs, 50), baisse_alerte: num(x.baisse_alerte, 2),
    signataires: Array.isArray(x.signataires) ? x.signataires : [],
  }
}

const present = (v) => v !== null && v !== undefined
/** Pourcentage arrondi à deux décimales (null si le total est nul). */
export const taux = (n, total) => (total ? arrondi((100 * n) / total) : null)

/** Effectif, réussites et échecs d'une liste de notes ou de moyennes, au seuil donné. */
export function bilanValeurs(valeurs, seuil) {
  const v = valeurs.filter(present)
  const reussis = v.filter((x) => x >= seuil).length
  return {
    n: v.length, reussis, echecs: v.length - reussis,
    tauxReussite: taux(reussis, v.length), tauxEchec: taux(v.length - reussis, v.length),
    moyenne: v.length ? moyenneSimple(v) : null, max: v.length ? Math.max(...v) : null, min: v.length ? Math.min(...v) : null,
  }
}

/** Absences : { nj, j, retards } d'un élève (zéros s'il n'en a pas). */
const absencesDe = (bilans, inscriptionId) => {
  const b = bilans?.get?.(inscriptionId)
  return { nj: b?.nj ?? 0, j: b?.j ?? 0, retards: b?.retards ?? 0 }
}

// =============================================================================================================
// PV de classe : notes obtenues par matière (et par période), sans calcul obligatoire des moyennes
// =============================================================================================================

/**
 * entree = {
 *   eleves: [{ inscriptionId, eleve }], attributions: [{ id, matiere, enseignant }], periodes: [{ code, libelle }],
 *   notes: Map `${inscriptionId}|${attributionId}|${codePeriode}` -> note,
 *   moyennes?: Map `${inscriptionId}|${codePeriode}` -> moyenne (option « afficher les moyennes »),
 *   bilans?: Map inscriptionId -> { nj, j, retards }, reglages, incomplets (true : garder les élèves aux notes manquantes)
 * }
 */
/** Matières les plus faibles : seulement celles qui ont des échecs, et s'il y a au moins deux matières notées (sinon « la plus faible » n'a pas de sens). */
const faibles = (liste) => { const notees = liste.filter((m) => m.n > 0 && m.tauxReussite !== null && m.tauxReussite !== undefined)
  return notees.length < 2 ? [] : notees.filter((m) => m.tauxReussite < 100).sort((a, b) => a.tauxReussite - b.tauxReussite).slice(0, 3) }

export function pvClasse(entree) {
  const reg = reglagesPv(entree.reglages)
  const seuil = reg.seuil_reussite
  const colonnes = entree.periodes.flatMap((p) => entree.attributions.map((a) => ({
    attributionId: a.id, matiere: a.matiere, enseignant: a.enseignant || "", periode: p.code, periodeLibelle: p.libelle })))
  const toutes = entree.eleves.map(({ inscriptionId, eleve }) => {
    const notes = colonnes.map((c) => { const v = entree.notes.get(`${inscriptionId}|${c.attributionId}|${c.periode}`); return present(v) ? v : null })
    const presentes = notes.filter(present)
    const echecs = presentes.filter((v) => v < seuil).length
    const partEchecs = taux(echecs, presentes.length)
    return {
      inscriptionId, eleve, notes,
      presentes: presentes.length, manquantes: notes.length - presentes.length, echecs, partEchecs,
      moyennes: entree.moyennes ? entree.periodes.map((p) => entree.moyennes.get(`${inscriptionId}|${p.code}`) ?? null) : null,
      enDifficulte: presentes.length > 0 && partEchecs >= reg.part_echecs,
      absences: absencesDe(entree.bilans, inscriptionId),
    }
  })
  const lignes = entree.incomplets === false ? toutes.filter((l) => l.manquantes === 0) : toutes
  const matieres = colonnes.map((c, k) => {
    const valeurs = lignes.map((l) => l.notes[k])
    const b = bilanValeurs(valeurs, seuil)
    const meilleure = lignes.filter((l) => present(l.notes[k])).sort((x, y) => y.notes[k] - x.notes[k])[0]
    return { ...c, ...b, manquantes: valeurs.length - b.n, meilleure: meilleure ? { eleve: meilleure.eleve, note: meilleure.notes[k] } : null }
  })
  const notesAttendues = lignes.length * colonnes.length
  const notesPresentes = lignes.reduce((s, l) => s + l.presentes, 0)
  const echecs = lignes.reduce((s, l) => s + l.echecs, 0)
  const absents = lignes.filter((l) => l.absences.nj + l.absences.j > 0).length
  const meilleures = lignes.flatMap((l) => l.notes.map((note, k) => ({ eleve: l.eleve, matiere: colonnes[k].matiere, periode: colonnes[k].periodeLibelle, note })))
    .filter((x) => present(x.note)).sort((a, b) => b.note - a.note).slice(0, 5)
  return {
    colonnes, lignes, matieres,
    exclus: toutes.length - lignes.length,
    global: {
      effectif: lignes.length, notesAttendues, notesPresentes, notesManquantes: notesAttendues - notesPresentes,
      tauxManquantes: taux(notesAttendues - notesPresentes, notesAttendues),
      reussis: notesPresentes - echecs, echecs, tauxReussite: taux(notesPresentes - echecs, notesPresentes), tauxEchec: taux(echecs, notesPresentes),
      heuresNJ: lignes.reduce((s, l) => s + l.absences.nj, 0), heuresJ: lignes.reduce((s, l) => s + l.absences.j, 0),
      retards: lignes.reduce((s, l) => s + l.absences.retards, 0),
      elevesAbsents: absents, tauxAbsents: taux(absents, lignes.length),
    },
    meilleures,
    enDifficulte: lignes.filter((l) => l.enDifficulte).sort((a, b) => b.partEchecs - a.partEchecs || b.echecs - a.echecs),
    matieresFaibles: faibles(matieres),
    seuil,
  }
}

/** Contrôle avant génération : ce qui bloque (données essentielles absentes) et ce qui mérite un avertissement. */
export function completude(pv) {
  const bloquants = [], avertissements = []
  if (!pv.lignes.length) bloquants.push({ code: "eleves" })
  if (!pv.colonnes.length) bloquants.push({ code: "matieres" })
  if (pv.lignes.length && pv.colonnes.length && pv.global.notesPresentes === 0) bloquants.push({ code: "notes" })
  if (!bloquants.length && pv.global.notesManquantes > 0) {
    avertissements.push({ code: "manquantes", n: pv.global.notesManquantes, eleves: pv.lignes.filter((l) => l.manquantes > 0).length })
  }
  const sansNote = pv.lignes.filter((l) => l.presentes === 0).length
  if (!bloquants.length && sansNote) avertissements.push({ code: "sans_note", n: sansNote })
  const matieresVides = pv.matieres.filter((m) => m.n === 0).length
  if (!bloquants.length && matieresVides) avertissements.push({ code: "matieres_vides", n: matieresVides })
  if (pv.exclus) avertissements.push({ code: "exclus", n: pv.exclus })
  return { bloquants, avertissements, partiel: avertissements.some((a) => a.code !== "exclus") }
}

// =============================================================================================================
// PV de groupe : par cycle ou pour tout l'établissement
// =============================================================================================================

const parCle = (liste, cle) => {
  const m = new Map()
  for (const x of liste) { const k = cle(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}

/** Synthèse d'un ensemble d'élèves (moyennes de la période) : réussite, difficulté, progression, absences, sexes, finances. */
function synthesePopulation(eleves, reg) {
  const moyennes = eleves.map((e) => e.moyenne)
  const b = bilanValeurs(moyennes, reg.seuil_reussite)
  const evalues = eleves.filter((e) => present(e.moyenne))
  const difficulte = evalues.filter((e) => e.moyenne < reg.seuil_difficulte).length
  const comparables = evalues.filter((e) => present(e.precedente))
  const progression = comparables.filter((e) => e.moyenne > e.precedente).length
  const regression = comparables.filter((e) => e.moyenne < e.precedente).length
  const finances = eleves.filter((e) => e.paiement !== null && e.paiement !== undefined)
  const aJour = finances.filter((e) => e.paiement.en_regle).length
  const absents = eleves.filter((e) => e.absences.nj + e.absences.j > 0).length
  const sexe = (s) => bilanValeurs(eleves.filter((e) => e.eleve.sexe === s).map((e) => e.moyenne), reg.seuil_reussite)
  return {
    effectif: eleves.length, evalues: b.n, moyenne: b.moyenne, max: b.max, min: b.min,
    reussis: b.reussis, tauxReussite: b.tauxReussite, tauxEchec: b.tauxEchec,
    enDifficulte: difficulte, tauxDifficulte: taux(difficulte, b.n),
    comparables: comparables.length, progression, regression, stables: comparables.length - progression - regression,
    tauxProgression: taux(progression, comparables.length), tauxRegression: taux(regression, comparables.length),
    heuresNJ: eleves.reduce((s, e) => s + e.absences.nj, 0), heuresJ: eleves.reduce((s, e) => s + e.absences.j, 0),
    retards: eleves.reduce((s, e) => s + e.absences.retards, 0),
    elevesAbsents: absents, tauxAbsenteisme: taux(absents, eleves.length), tauxPresence: eleves.length ? arrondi(100 - taux(absents, eleves.length)) : null,
    garcons: eleves.filter((e) => e.eleve.sexe === "M").length, filles: eleves.filter((e) => e.eleve.sexe === "F").length,
    reussiteGarcons: sexe("M").tauxReussite, reussiteFilles: sexe("F").tauxReussite,
    financeConnue: finances.length, aJour, insolvables: finances.length - aJour,
    tauxAJour: taux(aJour, finances.length), tauxInsolvables: taux(finances.length - aJour, finances.length),
  }
}

/**
 * classes : [{ classe: { id, libelle, cycleId, cycleLibelle, niveauLibelle, sectionLibelle }, attributions, resultats (resultatsPeriode().resultats),
 *              bilans: Map, precedentes: Map inscriptionId -> moyenne, finances: Map inscriptionId -> { en_regle } | null }]
 * options : { parEnseignant }
 */
export function pvGroupe(classes, reglages, options = {}) {
  const reg = reglagesPv(reglages)
  const eleves = classes.flatMap(({ classe, resultats, bilans, precedentes, finances }) => resultats.map((r) => ({
    inscriptionId: r.inscriptionId, eleve: r.eleve, classe, moyenne: r.moyenne ?? r.moyenneNonClassee ?? null,
    precedente: precedentes?.get(r.inscriptionId) ?? null, paiement: finances ? finances.get(r.inscriptionId) ?? null : null,
    absences: absencesDe(bilans, r.inscriptionId), lignes: r.lignes,
  })))
  const global = synthesePopulation(eleves, reg)
  const groupe = (cle, libelle) => [...parCle(eleves, cle)].map(([k, liste]) => ({ cle: k, libelle: libelle(liste[0]), ...synthesePopulation(liste, reg) }))
  const parClasse = classes.map(({ classe }) => ({ classe, ...synthesePopulation(eleves.filter((e) => e.classe.id === classe.id), reg) }))
  const parCycle = groupe((e) => e.classe.cycleId ?? "", (e) => e.classe.cycleLibelle || "")
  const parNiveau = groupe((e) => e.classe.niveauLibelle || "", (e) => e.classe.niveauLibelle || "")
  const parSection = groupe((e) => e.classe.sectionLibelle || "", (e) => e.classe.sectionLibelle || "")
  // Matières (regroupées par libellé d'une classe à l'autre) et enseignants
  const notes = eleves.flatMap((e) => e.lignes.map((l) => ({ matiere: l.matiere, enseignant: l.enseignant || "", classe: e.classe.libelle, note: l.note })))
  const resumeNotes = (liste) => bilanValeurs(liste.map((x) => x.note), reg.seuil_reussite)
  const parMatiere = [...parCle(notes, (x) => x.matiere)].map(([matiere, liste]) => ({ matiere, ...resumeNotes(liste), manquantes: liste.filter((x) => !present(x.note)).length }))
    .sort((a, b) => a.matiere.localeCompare(b.matiere, "fr"))
  const parEnseignant = options.parEnseignant
    ? [...parCle(notes.filter((x) => x.enseignant), (x) => x.enseignant)].map(([enseignant, liste]) => ({
        enseignant, matieres: [...new Set(liste.map((x) => x.matiere))], classes: [...new Set(liste.map((x) => x.classe))], ...resumeNotes(liste) }))
      .sort((a, b) => (a.tauxReussite ?? 101) - (b.tauxReussite ?? 101))
    : null
  const seuilSuivi = 100 - reg.part_echecs                     // matière à suivre : taux de réussite sous ce seuil
  const evalues = eleves.filter((e) => present(e.moyenne))
  return {
    global, parClasse, parCycle, parNiveau, parSection, parMatiere, parEnseignant,
    repartition: TRANCHES.map(([bas, haut, libelle]) => {
      const n = evalues.filter((e) => e.moyenne >= bas && e.moyenne < haut).length
      return { libelle, n, pourcentage: taux(n, evalues.length) }
    }),
    meilleures: [...evalues].sort((a, b) => b.moyenne - a.moyenne).slice(0, 10).map(({ eleve, classe, moyenne }) => ({ eleve, classe, moyenne })),
    enDifficulte: evalues.filter((e) => e.moyenne < reg.seuil_difficulte).sort((a, b) => a.moyenne - b.moyenne)
      .map(({ eleve, classe, moyenne }) => ({ eleve, classe, moyenne })),
    matieresFaibles: faibles(parMatiere),
    classesFaibles: parClasse.filter((c) => c.evalues > 0).sort((a, b) => a.tauxReussite - b.tauxReussite).slice(0, 3),
    aSuivre: {
      matieres: parMatiere.filter((m) => m.n > 0 && m.tauxReussite < seuilSuivi),
      enseignants: (parEnseignant || []).filter((x) => x.n > 0 && x.tauxReussite < seuilSuivi),
      seuil: seuilSuivi,
    },
    seuil: reg.seuil_reussite,
  }
}

/** Écart entre deux valeurs (null si l'une manque). */
export const ecart = (a, b) => (present(a) && present(b) ? arrondi(a - b) : null)

const INDICATEURS = ["effectif", "moyenne", "tauxReussite", "tauxEchec", "tauxDifficulte", "tauxAbsenteisme", "tauxProgression", "tauxAJour"]

/** Comparaison de deux PV de groupe (deux périodes, deux années…) : indicateurs globaux et classe par classe. */
export function comparer(courant, reference) {
  const global = INDICATEURS.map((cle) => ({ cle, courant: courant.global[cle], reference: reference.global[cle], ecart: ecart(courant.global[cle], reference.global[cle]) }))
  const avant = new Map(reference.parClasse.map((c) => [c.classe.id, c]))
  const classes = courant.parClasse.map((c) => {
    const r = avant.get(c.classe.id)
    return { classe: c.classe, courant: c.tauxReussite, reference: r?.tauxReussite ?? null, ecart: ecart(c.tauxReussite, r?.tauxReussite),
             moyenne: c.moyenne, moyenneReference: r?.moyenne ?? null }
  })
  const matieresAvant = new Map(reference.parMatiere.map((m) => [m.matiere, m]))
  const matieres = courant.parMatiere.map((m) => ({ matiere: m.matiere, courant: m.tauxReussite, reference: matieresAvant.get(m.matiere)?.tauxReussite ?? null,
                                                    ecart: ecart(m.tauxReussite, matieresAvant.get(m.matiere)?.tauxReussite) }))
  return { global, classes, matieres }
}

/** Point d'une courbe d'évolution à partir d'un PV de groupe. */
export const pointEvolution = (libelle, pv) => ({ libelle, moyenne: pv.global.moyenne, tauxReussite: pv.global.tauxReussite })

// =============================================================================================================
// PV de performances individuelles
// =============================================================================================================

/** Moyenne de chaque matière (alignée sur les lignes) parmi les résultats donnés : seule la moyenne est gardée. */
export function moyennesMatieres(resultats) {
  if (!resultats.length) return []
  return resultats[0].lignes.map((_, k) => moyenneSimple(resultats.map((r) => r.lignes[k]?.note)))
}

/**
 * Contenu d'un PV individuel (copie autonome, publiable telle quelle aux parents : aucune note d'un autre élève, seulement
 * des moyennes de classe ou de cycle).
 * x = { r (résultat de l'élève), entetes, moyenneClasse, moyennesClasse: [par matière], moyenneCycle?, moyennesCycle?,
 *       precedente?: résultat de la période précédente, evolution: [{ libelle, eleve, classe, cycle? }], bilan: { nj, j, retards },
 *       distinctions: [noms], paiement?: { en_regle, reste }, decision?, commentaires?: [{ texte, auteur, fonction }], reglages }
 */
export function pvIndividuel(x) {
  const reg = reglagesPv(x.reglages)
  const precedentes = new Map((x.precedente?.lignes || []).map((l) => [l.matiere, l.note]))
  const matieres = x.r.lignes.map((l, k) => {
    const prec = precedentes.has(l.matiere) ? precedentes.get(l.matiere) : null
    const variation = ecart(l.note, prec)
    return {
      matiere: l.matiere, enseignant: l.enseignant || "", coefficient: l.coefficient, note: l.note,
      moyenneClasse: x.moyennesClasse?.[k] ?? null, moyenneCycle: x.moyennesCycle?.[k] ?? null,
      ecartClasse: ecart(l.note, x.moyennesClasse?.[k]), precedente: prec, variation,
      tendance: variation === null ? null : variation > 0 ? "hausse" : variation < 0 ? "baisse" : "stable",
      details: l.details || [],
    }
  })
  const notees = matieres.filter((m) => present(m.note))
  const fortes = notees.filter((m) => m.note >= reg.seuil_reussite).sort((a, b) => b.note - a.note).slice(0, 3).map((m) => m.matiere)
  const faibles = notees.filter((m) => m.note < reg.seuil_reussite).sort((a, b) => a.note - b.note).slice(0, 3).map((m) => m.matiere)
  const moyenne = x.r.moyenne ?? x.r.moyenneNonClassee ?? null
  const moyennePrecedente = x.precedente ? (x.precedente.moyenne ?? x.precedente.moyenneNonClassee ?? null) : null
  const alertes = matieres.filter((m) => m.variation !== null && m.variation <= -reg.baisse_alerte).map((m) => ({ matiere: m.matiere, variation: m.variation }))
  const baisseGenerale = ecart(moyenne, moyennePrecedente)
  const bilan = { nj: x.bilan?.nj ?? 0, j: x.bilan?.j ?? 0, retards: x.bilan?.retards ?? 0 }
  return {
    eleve: { nom: x.r.eleve.nom, prenom: x.r.eleve.prenom, matricule: x.r.eleve.matricule, sexe: x.r.eleve.sexe },
    moyenne, moyenneClasse: x.moyenneClasse ?? null, moyenneCycle: x.moyenneCycle ?? null,
    moyennePrecedente, variationGenerale: baisseGenerale,
    alerteGenerale: baisseGenerale !== null && baisseGenerale <= -reg.baisse_alerte,
    matieres, entetes: x.entetes || [], fortes, faibles, alertes,
    progressions: matieres.filter((m) => m.tendance === "hausse").map((m) => m.matiere),
    regressions: matieres.filter((m) => m.tendance === "baisse").map((m) => m.matiere),
    evolution: x.evolution || [], absences: bilan, distinctions: x.distinctions || [],
    paiement: x.paiement ?? null, decision: x.decision || null,
    commentaires: x.commentaires || [], seuil: reg.seuil_reussite,
    recommandations: recommandations({ faibles, alertes, bilan, moyenne, seuil: reg.seuil_reussite }),
  }
}

/** Recommandations (codes, traduits à l'affichage) tirées des seules données disponibles. */
export function recommandations({ faibles, alertes, bilan, moyenne, seuil }) {
  const r = []
  for (const m of faibles) r.push({ code: "renforcer", matiere: m })
  for (const a of alertes) if (!faibles.includes(a.matiere)) r.push({ code: "surveiller", matiere: a.matiere })
  if (bilan.nj > 0) r.push({ code: "assiduite", heures: bilan.nj })
  if (bilan.retards > 2) r.push({ code: "ponctualite", retards: bilan.retards })
  if (present(moyenne) && moyenne >= seuil + 4 && !faibles.length) r.push({ code: "encourager" })
  return r
}
