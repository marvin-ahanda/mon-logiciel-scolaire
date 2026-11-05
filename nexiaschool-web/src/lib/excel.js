import { t } from "../i18n.jsx"
// Lecture et écriture de classeurs Excel (.xlsx) directement dans le navigateur (aucun serveur sollicité).
// Les bibliothèques sont chargées à la demande pour ne pas alourdir le reste de l'application.

export const TAILLE_MAX = 2 * 1024 * 1024
export const LIGNES_MAX = 3000

/** « Date de naissance » -> « datedenaissance » (casse, accents, espaces et ponctuation ignorés). */
export const normaliser = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")

/** Neutralise l'injection de formules (un texte commençant par = + - @ n'est jamais interprété par Excel). */
const sur = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v)

function cellule(v, gras) {
  if (v === null || v === undefined || v === "") return null
  const valeur = sur(v)
  return { value: valeur, type: valeur instanceof Date ? Date : typeof valeur === "number" ? Number : String,
           format: valeur instanceof Date ? "dd/mm/yyyy" : undefined, fontWeight: gras ? "bold" : undefined }
}

/** feuilles : [{ titre, entetes, lignes, largeurs? }] -> téléchargement de « nom-AAAAMMJJ.xlsx » */
export async function telechargerClasseur(feuilles, nom) {
  const { default: ecrire } = await import("write-excel-file/browser")
  const donnees = feuilles.map((f) => [f.entetes.map((e) => cellule(e, true)), ...f.lignes.map((l) => l.map((v) => cellule(v)))])
  const colonnes = feuilles.map((f) => f.entetes.map((e, k) => ({
    width: f.largeurs?.[k] ?? Math.min(45, Math.max(10, String(e).length + 2, ...f.lignes.slice(0, 300).map((l) => String(l[k] ?? "").length + 2))) })))
  const jour = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  await ecrire(feuilles.map((f, k) => ({ data: donnees[k], sheet: f.titre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), columns: colonnes[k], stickyRowsCount: 1 })))
    .toFile(`${nom}-${jour}.xlsx`)
}

/**
 * Lit la première feuille. colonnes : { cle: [en-têtes acceptés] }.
 * Renvoie { lignes: [{ numero, valeurs: { cle: valeur } }], presentes: Set(cles) }.
 */
export async function lireClasseur(fichier, colonnes) {
  if (fichier.size > TAILLE_MAX) throw new Error(t("Le fichier dépasse 2 Mo."))
  const debut = new Uint8Array(await fichier.slice(0, 4).arrayBuffer())
  if (!(debut[0] === 0x50 && debut[1] === 0x4b)) {
    throw new Error(t(
      "Ce n'est pas un classeur Excel .xlsx (les anciens fichiers .xls ou .csv ne sont pas acceptés : enregistrez-le au format « Classeur Excel (.xlsx) »)."
    ))
  }
  const { default: lire } = await import("read-excel-file/browser")
  let feuilles
  try { feuilles = await lire(fichier) } catch { throw new Error(t("Classeur Excel illisible ou endommagé.")) }
  const donnees = feuilles[0]?.data || []
  if (!donnees.length) throw new Error(t("La première feuille est vide."))
  if (donnees.length - 1 > LIGNES_MAX) throw new Error(t("Le fichier dépasse {v0} lignes.", {
    v0: LIGNES_MAX
  }))
  const index = new Map(donnees[0].map((e, k) => [normaliser(e), k]))
  const positions = {}
  for (const [cle, noms] of Object.entries(colonnes)) {
    const trouve = noms.map(normaliser).find((n) => index.has(n))
    if (trouve !== undefined) positions[cle] = index.get(trouve)
  }
  const lignes = []
  donnees.slice(1).forEach((ligne, k) => {
    if (ligne.every((v) => v === null || String(v).trim() === "")) return
    lignes.push({ numero: k + 2, valeurs: Object.fromEntries(Object.entries(positions).map(([cle, i]) => [cle, ligne[i] ?? null])) })
  })
  return { lignes, presentes: new Set(Object.keys(positions)) }
}

export function texte(v, longueur) {
  if (v === null || v === undefined) return ""
  const x = (typeof v === "number" && Number.isInteger(v) ? String(v) : String(v)).trim()
  return longueur ? x.slice(0, longueur) : x
}

/** Date Excel ou texte jj/mm/aaaa, aaaa-mm-jj -> « aaaa-mm-jj » ; vide -> null. */
export function enDate(v) {
  if (v === null || v === undefined || v === "") return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const x = String(v).trim()
  let m = x.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return valider(+m[3], +m[2], +m[1], x)
  m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return valider(+m[1], +m[2], +m[3], x)
  throw new Error(t("date « {v0} » non reconnue (format attendu : jj/mm/aaaa)", {
    v0: x
  }))
}
function valider(a, mo, j, brut) {
  const d = new Date(Date.UTC(a, mo - 1, j))
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) throw new Error(`date « ${brut} » invalide`)
  return d.toISOString().slice(0, 10)
}

/** Note : nombre de 0 à 20, deux décimales ; vide -> null. */
export function enNote(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."))
  if (!Number.isFinite(n)) throw new Error(t("« {v0} » n'est pas une note", {
    v0: v
  }))
  if (n < 0 || n > 20) throw new Error(t("{v0} n'est pas compris entre 0 et 20", {
    v0: v
  }))
  return Math.round(n * 100) / 100
}

/** Sexe : M, G, garçon, masculin -> M ; F, fille, féminin -> F. */
export function enSexe(v) {
  const n = normaliser(v)
  if (["m", "g", "garcon", "masculin", "homme"].includes(n)) return "M"
  if (["f", "fille", "feminin", "femme"].includes(n)) return "F"
  return null
}
