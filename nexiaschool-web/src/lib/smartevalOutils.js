// SmartEval côté application : types de questions, lien public, en-tête figé de l'établissement, demande d'analyse pour l'IA.
import { image } from "./bulletinPdf.js"
import { siteAffiche } from "./logo.js"
import { t } from "../i18n.jsx"

export const TYPES = [
  ["choix", "Choix multiples"], ["cases", "Cases à cocher"], ["liste", "Liste déroulante"],
  ["courte", "Réponse courte"], ["paragraphe", "Paragraphe"], ["echelle", "Échelle linéaire"],
]
export const UNITES = [["heures", "heure(s)"], ["jours", "jour(s)"], ["semaines", "semaine(s)"]]
export const DUREE_MAX = { heures: 720, jours: 60, semaines: 8 }
export const STATUTS = { brouillon: "Brouillon", ouverte: "Ouverte", close: "Close", programmee: "Programmée" }

let compteur = 0
export const nouvelId = () => `q${Date.now().toString(36)}${(compteur++).toString(36)}`

export function nouvelleQuestion(type = "choix") {
  return { id: nouvelId(), type, intitule: "", aide: "", obligatoire: true, points: 1, notion: "",
           options: [t("Option {v0}", { v0: 1 })], bonnes: [], acceptees: [], echelle: { min: 1, max: 5, libelle_min: "", libelle_max: "" } }
}

/** Adresse publique de l'évaluation, sur le site où travaille l'enseignant. */
export const lienEvaluation = (jeton) => `${window.location.origin}${import.meta.env.BASE_URL}e/${jeton}`

/** Fin des réponses pour une durée donnée, à partir de maintenant (ou de la publication). */
export function finDuree(valeur, unite, debut = new Date()) {
  const h = { heures: 1, jours: 24, semaines: 24 * 7 }[unite] * Number(valeur || 0)
  return new Date(new Date(debut).getTime() + h * 3600 * 1000)
}

/** Logo réduit (PNG, 180 px au plus) pour l'en-tête figé de l'évaluation. */
async function logoReduit(url) {
  const img = await image(url)
  if (!img) return ""
  try {
    const source = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = img.donnees })
    const k = Math.min(1, 180 / Math.max(img.largeur, img.hauteur))
    const toile = document.createElement("canvas")
    toile.width = Math.max(1, Math.round(img.largeur * k)); toile.height = Math.max(1, Math.round(img.hauteur * k))
    const c = toile.getContext("2d"); c.imageSmoothingQuality = "high"; c.drawImage(source, 0, 0, toile.width, toile.height)
    return toile.toDataURL("image/png")
  } catch { return "" }
}

/** En-tête de l'établissement (comme sur le bulletin), figé au moment où le lien est généré. */
export async function enteteEtablissement(etablissement, exercice, logoUrl) {
  return { nom: etablissement?.nom || "", devise: etablissement?.devise || "", adresse: etablissement?.adresse || "", ville: etablissement?.ville || "",
           telephone: etablissement?.telephone || "", site_web: siteAffiche(etablissement?.site_web) || "", annee: exercice?.libelle || "",
           logo: await logoReduit(logoUrl) }
}

/** Demande à copier dans l'IA connectée (Claude, Grok…) pour analyser une évaluation. */
export const demandeIA = (titre) => t(
  "Analyse mon évaluation SmartEval « {v0} » avec l'outil smarteval_resultats de NexIA School. Donne-moi : le taux de réussite et les notions les moins réussies ; les élèves en difficulté et sur quelles notions, avec une orientation précise pour chacun ; des binômes ou trinômes (un élève à l'aise sur une notion avec un ou deux élèves en difficulté sur la même notion) ; des exercices complémentaires adaptés à chaque profil, avec leurs corrigés ; et le déroulé des activités d'intégration à mener en classe avant l'évaluation sur papier.",
  { v0: titre })
