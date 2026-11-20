// Images des cartes scolaires, traitées dans le navigateur :
//  * cachet et signature : PNG, JPG ou SVG → fond blanc rendu transparent (facultatif), recadrage automatique sur le
//    tracé, réduction (800 px au plus), compression PNG ; empreinte SHA-256 conservée pour la traçabilité ;
//  * photo d'identité : recadrage automatique au format 3:4 (centré, légèrement vers le haut), compression JPEG.
import { t } from "../i18n.jsx"

const COTE_MAX = 800

async function chargerImage(fichierOuUrl) {
  const url = typeof fichierOuUrl === "string" ? fichierOuUrl : URL.createObjectURL(fichierOuUrl)
  try {
    return await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(t("Image illisible : choisissez un autre fichier."))); i.src = url })
  } finally { if (typeof fichierOuUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

export async function sha256Hex(octets) {
  const h = await crypto.subtle.digest("SHA-256", octets instanceof ArrayBuffer || ArrayBuffer.isView(octets) ? octets : new TextEncoder().encode(String(octets)))
  return [...new Uint8Array(h)].map((o) => o.toString(16).padStart(2, "0")).join("")
}

/** Boîte englobante des pixels visibles (non transparents et, si demandé, non blancs). */
export function boiteVisible(pixels, largeur, hauteur, seuilBlanc = 245) {
  let x0 = largeur, y0 = hauteur, x1 = -1, y1 = -1
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) {
    const k = (y * largeur + x) * 4
    if (pixels[k + 3] < 16) continue
    if (pixels[k] >= seuilBlanc && pixels[k + 1] >= seuilBlanc && pixels[k + 2] >= seuilBlanc) continue
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return x1 < 0 ? null : { x: x0, y: y0, l: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Rend transparent le fond clair (papier scanné) en conservant l'encre, avec un fondu doux. */
export function fondTransparent(pixels, seuil = 225) {
  for (let k = 0; k < pixels.length; k += 4) {
    const clarte = Math.min(pixels[k], pixels[k + 1], pixels[k + 2])
    if (clarte >= seuil) pixels[k + 3] = 0
    else if (clarte > seuil - 40) pixels[k + 3] = Math.round(pixels[k + 3] * ((seuil - clarte) / 40))
  }
  return pixels
}

/**
 * Prépare un cachet ou une signature importé : renvoie { blob (PNG), empreinte, apercu (data URL), largeur, hauteur }.
 */
export async function preparerSignature(fichier, { transparence = true } = {}) {
  if (!/^image\/(png|jpeg|svg\+xml)$/.test(fichier.type)) throw new Error(t("Format accepté : PNG, JPG ou SVG."))
  if (fichier.size > 5 * 1024 * 1024) throw new Error(t("Image trop lourde (5 Mo au plus)."))
  const img = await chargerImage(fichier)
  let l = img.naturalWidth || img.width || 600, h = img.naturalHeight || img.height || 300
  if (fichier.type === "image/svg+xml" && (!img.naturalWidth || l < 400)) { const k = 1200 / Math.max(l, h); l = Math.round(l * k); h = Math.round(h * k) }
  if (l < 40 || h < 20) throw new Error(t("Image trop petite."))
  const k0 = Math.min(1, 2000 / Math.max(l, h))
  const toile = document.createElement("canvas")
  toile.width = Math.round(l * k0); toile.height = Math.round(h * k0)
  const ctx = toile.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, toile.width, toile.height)
  const donnees = ctx.getImageData(0, 0, toile.width, toile.height)
  if (transparence) fondTransparent(donnees.data)
  ctx.putImageData(donnees, 0, 0)
  const b = boiteVisible(donnees.data, toile.width, toile.height)
  if (!b) throw new Error(t("L'image semble vide : aucun tracé détecté."))
  const marge = Math.round(Math.max(b.l, b.h) * 0.03)
  const x = Math.max(0, b.x - marge), y = Math.max(0, b.y - marge)
  const lr = Math.min(toile.width - x, b.l + 2 * marge), hr = Math.min(toile.height - y, b.h + 2 * marge)
  const k = Math.min(1, COTE_MAX / Math.max(lr, hr))
  const sortie = document.createElement("canvas")
  sortie.width = Math.max(1, Math.round(lr * k)); sortie.height = Math.max(1, Math.round(hr * k))
  const cs = sortie.getContext("2d"); cs.imageSmoothingQuality = "high"
  cs.drawImage(toile, x, y, lr, hr, 0, 0, sortie.width, sortie.height)
  const blob = await new Promise((ok, ko) => sortie.toBlob((x2) => (x2 ? ok(x2) : ko(new Error(t("Conversion impossible.")))), "image/png"))
  if (blob.size > 512 * 1024) throw new Error(t("Image trop détaillée une fois convertie : utilisez une image plus simple."))
  return { blob, empreinte: await sha256Hex(await blob.arrayBuffer()), apercu: sortie.toDataURL("image/png"), largeur: sortie.width, hauteur: sortie.height }
}

/** Photo d'identité recadrée au format 3:4 et compressée : { donnees, format, largeur, hauteur } ou null. */
export async function photoCarte(url, { largeur = 300, qualite = 0.82 } = {}) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const img = await createImageBitmap(blob)
    const hauteur = Math.round(largeur * 4 / 3), ratio = 3 / 4
    let sl = img.width, sh = img.height
    if (sl / sh > ratio) sl = Math.round(sh * ratio); else sh = Math.round(sl / ratio)
    const sx = Math.round((img.width - sl) / 2), sy = Math.round(Math.max(0, (img.height - sh) * 0.35))   // visage : plutôt en haut
    const toile = document.createElement("canvas"); toile.width = largeur; toile.height = hauteur
    const c = toile.getContext("2d"); c.imageSmoothingQuality = "high"; c.fillStyle = "#fff"; c.fillRect(0, 0, largeur, hauteur)
    c.drawImage(img, sx, sy, sl, sh, 0, 0, largeur, hauteur)
    return { donnees: toile.toDataURL("image/jpeg", qualite), format: "JPEG", largeur, hauteur }
  } catch { return null }
}
