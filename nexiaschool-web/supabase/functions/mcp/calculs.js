// Calculs de moyennes, rangs et appréciations (repris du logiciel d'origine).
// Les notes ont au plus deux décimales : les calculs se font en centièmes entiers pour éviter les erreurs d'arrondi.

export const MOYENNE_REUSSITE = 10

const APPRECIATIONS = [
  [0, 3, "Nul"], [3, 4.5, "Très faible"], [4.5, 7.5, "Faible"], [7.5, 9, "Insuffisant"], [9, 10, "Médiocre"],
  [10, 12, "Passable"], [12, 14, "Assez bien"], [14, 16, "Bien"], [16, 18, "Très bien"], [18, 20, "Excellent"],
]

/** Arrondi à deux décimales, la moitié vers le haut (11,125 -> 11,13). */
export function arrondi(x) {
  if (x === null || x === undefined) return null
  return Math.round(x * 100 + 1e-7) / 100
}

export function appreciation(m) {
  if (m === null || m === undefined) return ""
  for (const [bas, haut, libelle] of APPRECIATIONS) if (m >= bas && m < haut) return libelle
  return m === 20 ? "Excellent" : ""
}

/** Moyenne simple des valeurs présentes (null si aucune). */
export function moyenneSimple(valeurs) {
  const v = valeurs.filter((x) => x !== null && x !== undefined)
  if (!v.length) return null
  return arrondi(v.reduce((s, x) => s + Math.round(x * 100), 0) / v.length / 100)
}

/** Rang olympique (1, 2, 2, 4) : liste de { rang, exAequo } alignée sur `valeurs` (null = non classé). */
export function rangs(valeurs) {
  const presentes = valeurs.filter((v) => v !== null && v !== undefined).sort((a, b) => b - a)
  const premier = new Map(), compte = new Map()
  presentes.forEach((v, i) => { if (!premier.has(v)) premier.set(v, i + 1); compte.set(v, (compte.get(v) || 0) + 1) })
  return valeurs.map((v) => (v === null || v === undefined ? { rang: null, exAequo: false } : { rang: premier.get(v), exAequo: compte.get(v) > 1 }))
}

/** Moyenne pondérée des lignes évaluées : { totalCoef, totalPoints, moyenne }. */
export function moyennePonderee(lignes) {
  let coef = 0, centiemes = 0
  for (const l of lignes) {
    if (l.note === null || l.note === undefined) continue
    coef += l.coefficient
    centiemes += Math.round(l.note * 100) * l.coefficient
  }
  return { totalCoef: coef, totalPoints: centiemes / 100, moyenne: coef ? arrondi(centiemes / coef / 100) : null }
}

/**
 * Note d'une matière pour une période.
 * notesSeq : Map séquence_id -> note ; sequences : [{ id, numero, trimestre }]
 * Séquence : la note ; trimestre : moyenne des notes séquentielles du trimestre ;
 * année : moyenne des notes trimestrielles.
 */
export function notePeriode(periode, notesSeq, sequences) {
  const note = (s) => (notesSeq.has(s.id) ? notesSeq.get(s.id) : null)
  if (periode.type === "sequence") return notesSeq.has(periode.sequenceId) ? notesSeq.get(periode.sequenceId) : null
  const trimestre = (t) => moyenneSimple(sequences.filter((s) => s.trimestre === t).map(note))
  if (periode.type === "trimestre") return trimestre(periode.trimestre)
  return moyenneSimple([1, 2, 3].map(trimestre))
}

/**
 * Résultats d'une classe pour une période.
 * eleves : [{ inscriptionId, eleve }] ; attributions : [{ id, matiere, enseignant, coefficient, groupe }]
 * notes : Map `${inscriptionId}|${attributionId}` -> note de la période ; coefMin : seuil de coefficients pour être classé
 */
export function calculerResultats(eleves, attributions, notes, coefMin = 0) {
  const resultats = eleves.map(({ inscriptionId, eleve }) => {
    const lignes = attributions.map((a) => {
      const n = notes.get(`${inscriptionId}|${a.id}`)
      const note = n === undefined ? null : n
      return { attributionId: a.id, matiere: a.matiere, enseignant: a.enseignant, coefficient: a.coefficient,
               groupe: a.groupe, note, points: note === null ? null : arrondi(note * a.coefficient), rang: null, exAequo: false }
    })
    const groupes = [...new Set(lignes.map((l) => l.groupe))].sort().map((g) => {
      const lg = lignes.filter((l) => l.groupe === g)
      return { groupe: g, lignes: lg, ...moyennePonderee(lg) }
    })
    const total = moyennePonderee(lignes)
    let moyenne = total.moyenne, moyenneNonClassee = null
    if (moyenne !== null && total.totalCoef < coefMin) { moyenneNonClassee = moyenne; moyenne = null }
    return { inscriptionId, eleve, lignes, groupes, totalCoef: total.totalCoef, totalPoints: total.totalPoints,
             moyenne, moyenneNonClassee, rang: null, exAequo: false, appreciation: appreciation(moyenne) }
  })
  rangs(resultats.map((r) => r.moyenne)).forEach((x, i) => Object.assign(resultats[i], x))
  attributions.forEach((a, k) => {
    rangs(resultats.map((r) => r.lignes[k].note)).forEach((x, i) => Object.assign(resultats[i].lignes[k], x))
  })
  const moyennes = resultats.map((r) => r.moyenne).filter((m) => m !== null)
  const reussis = moyennes.filter((m) => m >= MOYENNE_REUSSITE).length
  const stats = {
    effectif: resultats.length,
    classes: moyennes.length,
    moyenneClasse: moyennes.length ? moyenneSimple(moyennes) : null,
    max: moyennes.length ? Math.max(...moyennes) : null,
    min: moyennes.length ? Math.min(...moyennes) : null,
    reussis,
    tauxReussite: moyennes.length ? arrondi((100 * reussis) / moyennes.length) : null,
  }
  return { resultats, stats }
}
