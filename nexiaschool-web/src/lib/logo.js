import { supabase } from "../supabase.js"

const COTE_MAX = 512                  // pixels : net à l'impression, léger à charger
const POIDS_MAX = 500 * 1024          // limite du compartiment « logos »

/** Vérifie et réduit le logo (512 px au plus) : PNG pour garder la transparence, JPEG si le PNG est trop lourd. */
export async function preparerLogo(fichier) {
  if (!/^image\/(png|jpeg|webp)$/.test(fichier.type)) throw new Error("Format accepté pour le logo : PNG, JPEG ou WEBP.")
  if (fichier.size > 10 * 1024 * 1024) throw new Error("Logo trop lourd (10 Mo au plus).")
  let image
  try { image = await createImageBitmap(fichier) } catch { throw new Error("Image illisible : choisissez un autre fichier.") }
  if (image.width < 32 || image.height < 32) throw new Error("Logo trop petit (32 × 32 pixels au minimum).")
  const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height))
  const toile = document.createElement("canvas")
  toile.width = Math.round(image.width * echelle); toile.height = Math.round(image.height * echelle)
  const ctx = toile.getContext("2d")
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, toile.width, toile.height)
  const blob = (type, qualite) => new Promise((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("Conversion du logo impossible."))), type, qualite))
  let resultat = await blob("image/png")
  if (resultat.size > POIDS_MAX) {                       // logo photographique : JPEG sur fond blanc
    ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, toile.width, toile.height)
    resultat = await blob("image/jpeg", 0.9)
    if (resultat.size > POIDS_MAX) resultat = await blob("image/jpeg", 0.75)
  }
  return resultat
}

/** Envoie le logo, l'associe à l'établissement et supprime l'ancien fichier. Renvoie le chemin enregistré. */
export async function envoyerLogo(etablissementId, blob, ancien) {
  const extension = blob.type === "image/jpeg" ? "jpg" : "png"
  const chemin = `${etablissementId}/logo-${Date.now()}.${extension}`
  const envoi = await supabase.storage.from("logos").upload(chemin, blob, { contentType: blob.type, cacheControl: "3600" })
  if (envoi.error) throw new Error(`Envoi du logo impossible : ${envoi.error.message}`)
  const maj = await supabase.from("etablissements").update({ logo: chemin }).eq("id", etablissementId)
  if (maj.error) {
    await supabase.storage.from("logos").remove([chemin])
    throw new Error(`Enregistrement du logo impossible : ${maj.error.message}`)
  }
  if (ancien && ancien !== chemin) await supabase.storage.from("logos").remove([ancien])
  return chemin
}

export async function retirerLogo(etablissementId, ancien) {
  const maj = await supabase.from("etablissements").update({ logo: null }).eq("id", etablissementId)
  if (maj.error) throw new Error(maj.error.message)
  if (ancien) await supabase.storage.from("logos").remove([ancien])
}

/** Adresse temporaire (24 h) du logo, ou null. */
export async function adresseLogo(chemin) {
  if (!chemin) return null
  const { data, error } = await supabase.storage.from("logos").createSignedUrl(chemin, 86400)
  return error ? null : data.signedUrl
}

/** « https://www.ecole.cm/ » -> « www.ecole.cm » (affichage) */
export const siteAffiche = (s) => String(s || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "")

/** Initiales pour la bulle quand il n'y a pas de logo : « Collège Saint-Joseph » -> « CS » */
export function initiales(nom) {
  const mots = String(nom || "").replace(/['’]/g, " ").split(/[\s-]+/).filter((m) => m.length > 2 || /^[A-Z]/.test(m))
  return (mots.slice(0, 2).map((m) => m[0]).join("") || "?").toUpperCase()
}
