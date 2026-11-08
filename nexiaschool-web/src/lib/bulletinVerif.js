// Bulletins : QR code anti-fraude, filigrane du logo, adresse de la plateforme.
import qrcode from "qrcode-generator"
import { EDITEUR } from "./editeur.js"
import { rpc } from "../supabase.js"

/** Adresse de la plateforme telle qu'imprimée sur le bulletin : « nexiaschool.netlify.app ». */
export const sitePlateforme = () => EDITEUR.site.replace(/^https?:\/\//, "")

/** Adresse ouverte par le QR code d'un bulletin. */
export const urlVerification = (code) => `${EDITEUR.site}/verifier/${code}`

/** Matrice du QR code (true = module noir), niveau de correction M. */
export function matriceQr(texte) {
  const q = qrcode(0, "M")
  q.addData(texte)
  q.make()
  const n = q.getModuleCount()
  return Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => q.isDark(l, c)))
}

/** Contenu du bulletin qui compte pour la vérification ; deux contenus identiques donnent le même code. */
function contenu(r, periode) {
  return JSON.stringify([periode.code, r.moyenne, r.moyenneNonClassee, r.rang, r.exAequo,
    r.lignes.map((l) => [l.attributionId, l.note, l.coefficient, l.rang, l.details || []])])
}

async function sha256(texte) {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte))
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("")
}

/**
 * Enregistre les bulletins affichés et renvoie leurs codes : Map inscriptionId -> code.
 * Sans connexion (ou en cas d'erreur), renvoie une Map vide : les bulletins s'affichent alors sans QR code.
 */
export async function emettreBulletins(periode, resultats, stats) {
  const codes = new Map()
  try {
    const bulletins = await Promise.all(resultats.map(async (r) => ({
      inscription_id: r.inscriptionId, empreinte: await sha256(contenu(r, periode)),
      moyenne: r.moyenne ?? r.moyenneNonClassee, rang: r.rang, classes: stats.classes, effectif: stats.effectif, appreciation: r.appreciation || "",
    })))
    for (let i = 0; i < bulletins.length; i += 300) {
      const lot = await rpc("emettre_bulletins", { p: { periode: periode.code, periode_libelle: periode.libelle, bulletins: bulletins.slice(i, i + 300) } })
      for (const [id, code] of Object.entries(lot || {})) codes.set(id, code)
    }
  } catch { /* hors ligne : pas de QR code */ }
  return codes
}

/**
 * Logo flouté et très pâle, à placer au centre du bulletin, derrière le texte.
 * image : { donnees, largeur, hauteur } (voir image() dans bulletinPdf.js). Renvoie une image PNG (data URL) carrée.
 */
export async function filigrane(image, { taille = 600, opacite = 0.08 } = {}) {
  if (!image) return null
  try {
    const source = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = image.donnees })
    const k = Math.min(taille / image.largeur, taille / image.hauteur)
    const l = Math.round(image.largeur * k), h = Math.round(image.hauteur * k)
    // Flou : réduction puis agrandissement lissé (fonctionne sur tous les navigateurs), et filtre si disponible
    const petit = document.createElement("canvas")
    petit.width = Math.max(1, Math.round(l / 9)); petit.height = Math.max(1, Math.round(h / 9))
    const cp = petit.getContext("2d")
    cp.imageSmoothingQuality = "high"
    cp.drawImage(source, 0, 0, petit.width, petit.height)
    const toile = document.createElement("canvas")
    toile.width = taille; toile.height = taille
    const c = toile.getContext("2d")
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"
    if ("filter" in c) c.filter = "blur(4px)"
    c.globalAlpha = opacite
    c.drawImage(petit, (taille - l) / 2, (taille - h) / 2, l, h)
    return toile.toDataURL("image/png")
  } catch { return null }
}
