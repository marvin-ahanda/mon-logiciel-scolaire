// Lecture d'un relevé bancaire ou mobile money exporté en CSV (séparateur « ; » ou « , »), dans le navigateur.
// Colonnes reconnues par leur en-tête : date, libellé, référence, et soit « montant » (signé), soit « débit » / « crédit ».
// Rien n'est rapproché ici : les lignes sont seulement importées, le rapprochement est confirmé à la main.

const sansAccent = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/** Découpe une ligne CSV en respectant les guillemets. */
function decouper(ligne, sep) {
  const cellules = []
  let courant = "", guillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (c === '"') { if (guillemets && ligne[i + 1] === '"') { courant += '"'; i++ } else guillemets = !guillemets }
    else if (c === sep && !guillemets) { cellules.push(courant); courant = "" }
    else courant += c
  }
  cellules.push(courant)
  return cellules.map((x) => x.trim())
}

/** « 1 250,50 » / « -1250.5 » / « 1.250,00 » -> nombre (francs CFA arrondis à l'unité) ; null si illisible. */
export function lireMontant(v) {
  let s = String(v ?? "").replace(/[\s  ]/g, "").replace(/(FCFA|XAF|CFA)$/i, "")
  if (!s) return null
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
  else s = s.replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** « 24/11/2026 », « 24-11-2026 », « 2026-11-24 » -> « 2026-11-24 » ; null si illisible. */
export function lireDate(v) {
  const s = String(v ?? "").trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (!m) return null
  const annee = m[3].length === 2 ? `20${m[3]}` : m[3]
  const d = `${annee}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) ? null : d
}

/**
 * texte CSV -> { lignes: [{ date, libelle, reference, montant, occurrence }], erreurs: [n° de ligne illisible] }
 * occurrence : rang des lignes identiques dans le fichier (deux opérations réellement identiques restent distinctes).
 */
export function lireReleve(texte) {
  const brutes = String(texte ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim())
  if (brutes.length < 2) throw new Error("Le relevé est vide ou ne contient pas de ligne d'en-tête.")
  const sep = (brutes[0].match(/;/g) || []).length >= (brutes[0].match(/,/g) || []).length ? ";" : ","
  const entetes = decouper(brutes[0], sep).map(sansAccent)
  const col = (...noms) => entetes.findIndex((e) => noms.some((n) => e.includes(n)))
  const iDate = col("date"), iLib = col("libelle", "description", "operation", "motif"), iRef = col("reference", "ref", "transaction", "id")
  const iMontant = col("montant", "amount"), iDebit = col("debit", "sortie"), iCredit = col("credit", "entree")
  if (iDate < 0 || (iMontant < 0 && iDebit < 0 && iCredit < 0)) {
    throw new Error("Colonnes introuvables : le relevé doit avoir une colonne « Date » et une colonne « Montant » (ou « Débit » / « Crédit »).")
  }
  const lignes = [], erreurs = [], vues = new Map()
  brutes.slice(1).forEach((brute, k) => {
    const c = decouper(brute, sep)
    const date = lireDate(c[iDate])
    let montant = iMontant >= 0 ? lireMontant(c[iMontant]) : null
    if (montant === null && (iDebit >= 0 || iCredit >= 0)) {
      const credit = iCredit >= 0 ? lireMontant(c[iCredit]) || 0 : 0, debit = iDebit >= 0 ? lireMontant(c[iDebit]) || 0 : 0
      montant = credit - Math.abs(debit)
    }
    if (!date || !montant) { erreurs.push(k + 2); return }
    const libelle = iLib >= 0 ? c[iLib].slice(0, 200) : "", reference = iRef >= 0 && iRef !== iDate ? c[iRef].slice(0, 80) : ""
    const cle = [date, montant, sansAccent(libelle), reference].join("|")
    const occurrence = (vues.get(cle) || 0) + 1
    vues.set(cle, occurrence)
    lignes.push({ date, libelle, reference, montant, occurrence })
  })
  return { lignes, erreurs }
}
