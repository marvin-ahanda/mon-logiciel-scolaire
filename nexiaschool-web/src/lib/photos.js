import { supabase } from "../supabase.js"

const TAILLE = 400

/** Réduit une image (400 px au plus, JPEG) avant l'envoi : quelques dizaines de Ko par photo. */
export async function preparerPhoto(fichier) {
  if (!/^image\/(jpeg|png|webp)$/.test(fichier.type)) throw new Error("Format accepté : JPEG, PNG ou WEBP.")
  if (fichier.size > 8 * 1024 * 1024) throw new Error("Photo trop lourde (8 Mo au plus).")
  const image = await createImageBitmap(fichier)
  const echelle = Math.min(1, TAILLE / Math.max(image.width, image.height))
  const toile = document.createElement("canvas")
  toile.width = Math.round(image.width * echelle); toile.height = Math.round(image.height * echelle)
  toile.getContext("2d").drawImage(image, 0, 0, toile.width, toile.height)
  return await new Promise((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("Conversion impossible."))), "image/jpeg", 0.85))
}

export async function envoyerPhoto(etablissementId, eleveId, fichier) {
  const chemin = `${etablissementId}/${eleveId}.jpg`
  const blob = await preparerPhoto(fichier)
  const { error } = await supabase.storage.from("photos").upload(chemin, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" })
  if (error) throw new Error(error.message)
  return chemin
}

/** Adresses temporaires (1 h) des photos : { chemin: url }. */
export async function adressesPhotos(chemins) {
  const liste = [...new Set(chemins.filter(Boolean))]
  if (!liste.length) return {}
  const { data, error } = await supabase.storage.from("photos").createSignedUrls(liste, 3600)
  if (error) return {}
  return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
}
