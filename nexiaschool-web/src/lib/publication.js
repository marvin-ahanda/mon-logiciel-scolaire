// Publication des bulletins pour les parents : copie figée de chaque bulletin (contenu, décision, QR code, photo réduite)
// et partie commune à la classe (en-tête de l'établissement, logo réduit, statistiques). Le parent ne reçoit que celle de son enfant.
import { image } from "./bulletinPdf.js"

/** Image { donnees, largeur, hauteur } réduite à `max` px (PNG ou JPEG) : data URL, ou null. */
export async function reduire(img, max, format = "image/png", qualite = 0.82) {
  if (!img) return null
  try {
    const source = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = img.donnees })
    const k = Math.min(1, max / Math.max(img.largeur, img.hauteur))
    const toile = document.createElement("canvas")
    toile.width = Math.max(1, Math.round(img.largeur * k)); toile.height = Math.max(1, Math.round(img.hauteur * k))
    const c = toile.getContext("2d"); c.imageSmoothingQuality = "high"
    if (format === "image/jpeg") { c.fillStyle = "#fff"; c.fillRect(0, 0, toile.width, toile.height) }
    c.drawImage(source, 0, 0, toile.width, toile.height)
    return toile.toDataURL(format, qualite)
  } catch { return null }
}

const eleveVisible = (e) => ({ nom: e.nom, prenom: e.prenom, matricule: e.matricule, sexe: e.sexe, date_naissance: e.date_naissance, lieu_naissance: e.lieu_naissance })

/**
 * Données envoyées à publier_bulletins.
 * x = { etablissement, logoImage, exercice, periode, classe, stats, entetes, resultats, photos (chemin -> URL signée), conduite (Map),
 *       decisionDe (r -> décision), codes (Map inscription -> code QR) }
 */
export async function preparerPublication(x) {
  const e = x.etablissement || {}
  const commun = {
    etablissement: { nom: e.nom, devise: e.devise, adresse: e.adresse, ville: e.ville, telephone: e.telephone, site_web: e.site_web, nom_chef: e.nom_chef },
    logo: await reduire(x.logoImage, 320),
    exercice: { libelle: x.exercice.libelle },
    periode: { code: x.periode.code, type: x.periode.type, libelle: x.periode.libelle },
    classe: { libelle: x.classe.libelle },
    stats: x.stats, entetes: x.entetes,
  }
  const bulletins = []
  for (const r of x.resultats) {
    const url = x.photos?.[r.eleve.photo]
    const photo = url ? await reduire(await image(url), 160, "image/jpeg") : null
    bulletins.push({ inscription_id: r.inscriptionId, contenu: {
      r: { ...r, eleve: eleveVisible(r.eleve) }, conduite: x.conduite.get(r.inscriptionId) || null, decision: x.decisionDe(r) || null,
      code: x.codes.get(r.inscriptionId) || null, photo } })
  }
  return { classe_id: x.classe.id, periode: x.periode.code, periode_libelle: x.periode.libelle, commun, bulletins }
}

/** Nombre de notes manquantes (matières non évaluées) dans les bulletins d'une classe. */
export const notesManquantes = (resultats) => resultats.reduce((n, r) => n + r.lignes.filter((l) => l.note === null).length, 0)
