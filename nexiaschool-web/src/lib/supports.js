// SmartEval : documents supports (PDF, images, Word) joints à une évaluation et téléchargés par les élèves
import { supabase } from "../supabase.js"
import { t } from "../i18n.jsx"

export const SUPPORTS_MAX = 3
export const TAILLE_MAX = 10 * 1024 * 1024          // limite du serveur, par fichier
export const TAILLE_CONSEILLEE = 2 * 1024 * 1024     // téléchargement rapide par les élèves, sur téléphone
const IMAGE_MAX_PX = 2000                            // les photos plus grandes sont réduites avant l'envoi

const TYPES = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
}
export const ACCEPTES = Object.keys(TYPES).map((e) => "." + e).join(",")

export const tailleLisible = (o) => (o == null ? "" : o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`)
export const typeDe = (nom) => TYPES[(nom.split(".").pop() || "").toLowerCase()] || ""
export const icone = (type) => (type === "application/pdf" ? "📕" : type.startsWith("image/") ? "🖼️" : "📄")

/** Réduit une photo trop lourde (dimension et qualité) ; renvoie le fichier tel quel sinon. */
async function alleger(fichier, type) {
  if (!type.startsWith("image/") || fichier.size <= TAILLE_CONSEILLEE) return { blob: fichier, type }
  try {
    const img = await createImageBitmap(fichier)
    const r = Math.min(1, IMAGE_MAX_PX / Math.max(img.width, img.height))
    const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r)
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82))
    return blob && blob.size < fichier.size ? { blob, type: "image/jpeg" } : { blob: fichier, type }
  } catch { return { blob: fichier, type } }
}

/** Envoie un document dans le dossier de l'auteur. Renvoie { chemin, nom, type, taille }. */
export async function envoyerSupport(fichier, etablissementId, auteurId) {
  const type = typeDe(fichier.name)
  if (!type) throw new Error(t("Format non accepté : PDF, image (JPG, PNG) ou texte Word (.doc, .docx, .odt)."))
  const { blob, type: typeFinal } = await alleger(fichier, type)
  if (blob.size > TAILLE_MAX) throw new Error(t("Fichier trop lourd ({v0}) : 10 Mo au maximum. Réduisez-le (PDF compressé, photo moins grande) puis réessayez.", { v0: tailleLisible(blob.size) }))
  const base = fichier.name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document"
  const ext = typeFinal === "image/jpeg" && type !== "image/jpeg" ? "jpg" : (fichier.name.split(".").pop() || "").toLowerCase()
  const chemin = `${etablissementId}/${auteurId}/${Date.now().toString(36)}-${base}.${ext}`
  const nom = typeFinal === "image/jpeg" && type !== "image/jpeg" ? fichier.name.replace(/\.[^.]+$/, ".jpg") : fichier.name
  const { error } = await supabase.storage.from("smarteval").upload(chemin, blob, { contentType: typeFinal, cacheControl: "3600" })
  if (error) throw new Error(t("Envoi du document impossible : {v0}", { v0: error.message }))
  return { chemin, nom, type: typeFinal, taille: blob.size }
}

export async function retirerSupports(chemins) {
  if (chemins?.length) await supabase.storage.from("smarteval").remove(chemins)
}

/** Lien de téléchargement temporaire (2 h) d'un document support. */
export async function lienSupport(support) {
  const { data, error } = await supabase.storage.from("smarteval").createSignedUrl(support.chemin, 7200, { download: support.nom })
  if (error || !data?.signedUrl) throw new Error(t("Document indisponible : l'évaluation est peut-être close."))
  return data.signedUrl
}
