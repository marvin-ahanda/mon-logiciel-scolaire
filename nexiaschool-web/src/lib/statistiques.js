// Statistiques avancées : répartition des moyennes, statistiques par matière, comparaison des classes, effectifs.
import { MOYENNE_REUSSITE, arrondi, moyenneSimple } from "./calculs.js"

export const TRANCHES = [[0, 5, "[0 ; 5["], [5, 8, "[5 ; 8["], [8, 10, "[8 ; 10["], [10, 12, "[10 ; 12["],
  [12, 14, "[12 ; 14["], [14, 16, "[14 ; 16["], [16, 21, "[16 ; 20]"]]
export const SEXES = [["M", "Garçons"], ["F", "Filles"]]

/** Effectif, moyenne, min, max, nombre ≥ 10 et taux de réussite. */
export function resume(valeurs) {
  const v = valeurs.filter((x) => x !== null && x !== undefined)
  if (!v.length) return { n: 0, moyenne: null, min: null, max: null, reussite: 0, taux: null }
  const reussite = v.filter((x) => x >= MOYENNE_REUSSITE).length
  return { n: v.length, moyenne: moyenneSimple(v), min: Math.min(...v), max: Math.max(...v), reussite, taux: arrondi((100 * reussite) / v.length) }
}

/** { M: [moyennes], F: [...] } -> lignes par tranche avec effectifs par sexe, total et pourcentage. */
export function repartition(parSexe) {
  const toutes = Object.values(parSexe).flat()
  return TRANCHES.map(([bas, haut, libelle]) => {
    const dans = (m) => m >= bas && m < haut
    const total = toutes.filter(dans).length
    return { libelle, parSexe: Object.fromEntries(SEXES.map(([s]) => [s, (parSexe[s] || []).filter(dans).length])), total,
             pourcentage: toutes.length ? arrondi((100 * total) / toutes.length) : null }
  })
}

/** À partir du résultat de calculerResultats : statistiques complètes d'une classe. */
export function statistiquesClasse(resultats, attributions) {
  const moyennes = { M: [], F: [] }
  for (const r of resultats) if (r.moyenne !== null) (moyennes[r.eleve.sexe] ||= []).push(r.moyenne)
  const matieres = attributions.map((a, k) => {
    const notes = { M: [], F: [] }
    for (const r of resultats) { const n = r.lignes[k].note; if (n !== null) (notes[r.eleve.sexe] ||= []).push(n) }
    return { attribution: a, tous: resume(Object.values(notes).flat()), parSexe: { M: resume(notes.M), F: resume(notes.F) } }
  })
  return { global: resume(Object.values(moyennes).flat()), parSexe: { M: resume(moyennes.M), F: resume(moyennes.F) },
           repartition: repartition(moyennes), matieres }
}

/** Âge au 1er janvier de la seconde année de l'exercice (« 2026-2027 » -> 1/1/2027). */
export function dateDeReference(libelle) {
  const annee = Number(String(libelle).split("-")[1])
  return Number.isFinite(annee) && annee > 1900 ? new Date(Date.UTC(annee, 0, 1)) : new Date()
}
export function age(naissance, ref) {
  const n = new Date(naissance + "T00:00:00Z")
  return ref.getUTCFullYear() - n.getUTCFullYear() - ((ref.getUTCMonth() < n.getUTCMonth() || (ref.getUTCMonth() === n.getUTCMonth() && ref.getUTCDate() < n.getUTCDate())) ? 1 : 0)
}

/** classes : [{ id, libelle }] ; inscriptions : [{ classe_id, eleves: { sexe, date_naissance } }] */
export function effectifsSexeAge(classes, inscriptions, libelleExercice) {
  const ref = dateDeReference(libelleExercice)
  const cle = (e) => {
    if (!e.date_naissance) return "inconnu"
    const a = age(e.date_naissance, ref)
    return a < 9 ? "≤ 9" : a > 21 ? "≥ 21" : a
  }
  const presentes = new Set(), parClasse = new Map()
  let inconnus = false
  for (const i of inscriptions) {
    const k = cle(i.eleves)
    if (k === "inconnu") inconnus = true; else presentes.add(k)
    if (!parClasse.has(i.classe_id)) parClasse.set(i.classe_id, new Map())
    const m = parClasse.get(i.classe_id), c = `${k}|${i.eleves.sexe}`
    m.set(c, (m.get(c) || 0) + 1)
  }
  const nombres = [...presentes].filter((x) => typeof x === "number").sort((a, b) => a - b)
  const colonnes = [...(presentes.has("≤ 9") ? ["≤ 9"] : []), ...nombres, ...(presentes.has("≥ 21") ? ["≥ 21"] : []), ...(inconnus ? ["inconnu"] : [])]
  const lignes = classes.filter((c) => parClasse.has(c.id)).map((c) => {
    const m = parClasse.get(c.id)
    const cellules = colonnes.map((a) => [m.get(`${a}|M`) || 0, m.get(`${a}|F`) || 0])
    return { classe: c, cellules, garcons: cellules.reduce((s, x) => s + x[0], 0), filles: cellules.reduce((s, x) => s + x[1], 0) }
  })
  const totaux = colonnes.map((_, k) => [lignes.reduce((s, l) => s + l.cellules[k][0], 0), lignes.reduce((s, l) => s + l.cellules[k][1], 0)])
  return { ref, colonnes, lignes, totaux }
}
