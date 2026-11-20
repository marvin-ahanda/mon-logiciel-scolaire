// Cartes scolaires au format carte bancaire (ISO CR80 : 85,6 × 54 mm), recto et verso, cinq modèles originaux aux
// couleurs de l'établissement. Sorties : planche A4 recto-verso (10 cartes par feuille, verso en miroir pour
// l'impression recto-verso bord long), une carte par page (imprimante à cartes), archive ZIP (un PDF par élève).
import { matriceQr } from "./bulletinVerif.js"
import { EDITEUR } from "./editeur.js"
import { sha256Hex } from "./imagesCarte.js"
import { creerZip, telechargerZip } from "./zip.js"
import { t } from "../i18n.jsx"

export const W = 85.6, H = 54
export const urlVerificationCarte = (code) => `${EDITEUR.site}/carte/${code}`

export const MODELES_CARTE = {
  classique: "Classique institutionnel", minimaliste: "Moderne minimaliste", premium: "Premium à bandeau coloré",
  academique: "Académique formel", dynamique: "Dynamique avec QR code",
}
export const COULEURS_MODELES = {
  classique: ["#1F3A68", "#C9A227"], minimaliste: ["#111827", "#10B981"], premium: ["#0B46E5", "#F2B705"],
  academique: ["#5B1A2E", "#B08D57"], dynamique: ["#0F766E", "#F97316"],
}

/** Éléments affichables et réglage par défaut. */
export const CHAMPS_CARTE = {
  photo: ["Photo", true], matricule: ["Matricule", true], classe: ["Classe", true], niveau: ["Niveau", false], cycle: ["Cycle", false],
  section: ["Section", true], annee: ["Année scolaire", true], date_naissance: ["Date de naissance", true], sexe: ["Sexe", false],
  coordonnees: ["Adresse, téléphone et e-mail de l'établissement", true], logo: ["Logo de l'établissement", true], qr: ["QR code de vérification", true],
  cachet: ["Cachet numérique", true], signature: ["Signature numérique", true], emission: ["Date d'émission", true],
  expiration: ["Date d'expiration", true], statut: ["Statut de l'élève", true],
}
export const champActif = (cfg, k) => (cfg?.champs?.[k] ?? CHAMPS_CARTE[k][1]) !== false

/** Fiche descriptive de chaque modèle (affichée dans l'application). */
export const FICHES_MODELES = {
  classique: {
    structure: "Bandeau d'en-tête plein à la couleur principale (logo, nom de l'établissement, titre), corps blanc, liseré d'accent en pied.",
    couleurs: "Bleu marine institutionnel et or (modifiables) ; texte gris anthracite sur fond blanc.",
    hierarchie: "1. Établissement · 2. Nom et prénom de l'élève · 3. Matricule, classe, section, date de naissance · 4. Année scolaire.",
    photo: "À gauche, sous le bandeau, encadrée d'un filet à la couleur principale.", logo: "Dans une pastille blanche à gauche du bandeau.",
    qr: "Au verso, à droite, avec le code de vérification.", cachet: "En bas à droite du recto, signature par-dessus le cachet.",
    polices: "Sans empattement (Helvetica) : lisible en petit corps.",
  },
  minimaliste: {
    structure: "Fond blanc, fine barre verticale à la couleur principale, beaucoup d'espace, informations en grille à deux colonnes.",
    couleurs: "Noir profond et vert émeraude (modifiables), libellés gris clair.",
    hierarchie: "1. Nom de l'élève en grand · 2. Libellés discrets au-dessus des valeurs · 3. Établissement en petit en haut.",
    photo: "À droite, sans cadre, alignée sur le haut.", logo: "Petit, en haut à gauche, à côté du nom de l'établissement.",
    qr: "Au verso.", cachet: "En bas à droite, sous la photo.", polices: "Sans empattement, graisse forte pour le nom, légère pour les libellés.",
  },
  premium: {
    structure: "Bandeau oblique à la couleur principale souligné d'un filet d'accent ; photo à bord blanc qui chevauche le bandeau.",
    couleurs: "Bleu vif et jaune soleil (modifiables).",
    hierarchie: "1. Photo et nom · 2. Établissement dans le bandeau · 3. Informations en colonne.",
    photo: "À gauche, en relief sur le bandeau, matricule et année dessous.", logo: "Pastille blanche à droite du bandeau.",
    qr: "Au verso.", cachet: "En bas à droite.", polices: "Sans empattement, titres en gras.",
  },
  academique: {
    structure: "Double cadre fin, composition centrée et symétrique, esprit diplôme.",
    couleurs: "Bordeaux et or patiné (modifiables) sur fond ivoire.",
    hierarchie: "1. Armoiries / logo et établissement centrés · 2. Titre entre deux filets · 3. Élève et informations sur lignes pointillées.",
    photo: "À droite, cadre doré.", logo: "Centré en haut.", qr: "Au verso.", cachet: "En bas à droite, sous la photo.",
    polices: "Avec empattement (Times) pour un ton formel.",
  },
  dynamique: {
    structure: "Colonne latérale colorée portant la photo, le matricule et une étiquette de classe ; QR code visible dès le recto.",
    couleurs: "Vert canard et orange (modifiables), contraste fort.",
    hierarchie: "1. Nom en très grand · 2. Classe en étiquette · 3. QR code de contrôle rapide.",
    photo: "Dans la colonne de gauche, bord blanc.", logo: "En haut à droite.", qr: "Au recto (contrôle à l'entrée, bibliothèque, présence) et au verso.",
    cachet: "En bas à droite du recto.", polices: "Sans empattement, nom en capitales grasses.",
  },
}
export const USAGES_CARTE = "Impression (planche A4 ou imprimante à cartes), PDF, vérification par QR code, identification en bibliothèque, contrôle d'accès et suivi de présence (lecture du QR code)."

const rgb = (hex) => { const h = String(hex || "#000000").replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) }
const pdf = (v) => String(v ?? "").replace(/[   ]/g, " ").replace(/[’]/g, "'")
const NOIR = [33, 37, 41], GRIS = [110, 117, 125]

/** Carte imprimable à partir des données de l'élève. */
export function donneesCarte({ eleve, classe, section, annee, statut, code = null, version = null, emise_le = null, expire_le = null }) {
  const cycle = classe?.cycle ? t(Number(classe.cycle) === 1 ? "Premier cycle" : "Second cycle") : ""
  return { nom: String(eleve.nom || "").toUpperCase(), prenom: eleve.prenom || "", matricule: eleve.matricule || "", sexe: eleve.sexe || "",
    date_naissance: eleve.date_naissance ? new Date(eleve.date_naissance + "T00:00:00").toLocaleDateString("fr-FR") : "",
    classe: classe?.libelle || "", niveau: classe?.niveau || "", cycle, section: section || "", annee: annee || "", statut: statut || t("Actif"),
    code, version, emise_le, expire_le }
}

/** Empreinte du contenu imprimé (une modification entraîne une nouvelle carte). */
export async function empreinteCarte(c, cfg, photo) {
  const champs = Object.fromEntries(Object.keys(CHAMPS_CARTE).map((k) => [k, champActif(cfg, k)]))
  return sha256Hex(JSON.stringify([cfg.modele, cfg.couleur, cfg.couleur2, champs, cfg.textes || {}, c.nom, c.prenom, c.matricule, c.classe, c.niveau,
    c.cycle, c.section, c.date_naissance, c.sexe, c.statut, photo ? await sha256Hex(photo.donnees) : ""]))
}

function lignesInfo(c, cfg) {
  const l = []
  if (champActif(cfg, "matricule") && c.matricule) l.push([t("Matricule"), c.matricule])
  if (champActif(cfg, "classe") && c.classe) l.push([t("Classe"), c.classe])
  if (champActif(cfg, "niveau") && c.niveau) l.push([t("Niveau"), c.niveau])
  if (champActif(cfg, "cycle") && c.cycle) l.push([t("Cycle"), c.cycle])
  if (champActif(cfg, "section") && c.section) l.push([t("Section"), c.section])
  if (champActif(cfg, "date_naissance") && c.date_naissance) l.push([t("Né(e) le"), c.date_naissance])
  if (champActif(cfg, "sexe") && c.sexe) l.push([t("Sexe"), c.sexe])
  if (champActif(cfg, "statut") && c.statut) l.push([t("Statut"), c.statut])
  return l
}

/** Contexte de dessin décalé (la carte est posée en x0, y0 sur la page). */
function contexte(doc, x0, y0) {
  const X = (v) => x0 + v, Y = (v) => y0 + v
  const txt = (s, x, y, { taille = 6, gras = false, italique = false, couleur = NOIR, align = "left", police = "helvetica", max = null, espace = 0 } = {}) => {
    s = pdf(s); if (!s) return
    doc.setFont(police, gras && italique ? "bolditalic" : gras ? "bold" : italique ? "italic" : "normal")
    let tl = taille
    doc.setFontSize(tl)
    if (max) while (tl > 3.2 && doc.getTextWidth(s) + espace * s.length > max) { tl -= 0.25; doc.setFontSize(tl) }
    doc.setTextColor(...couleur)
    doc.text(s, X(x), Y(y), { align, charSpace: espace || undefined })
  }
  const rect = (x, y, l, h, couleur, style = "F") => { if (style.includes("F")) doc.setFillColor(...couleur); else doc.setDrawColor(...couleur); doc.rect(X(x), Y(y), l, h, style) }
  const image = (img, x, y, l, h, { couvrir = false } = {}) => {
    if (!img) return null
    let lw = l, hw = h
    if (!couvrir) { const k = Math.min(l / img.largeur, h / img.hauteur); lw = img.largeur * k; hw = img.hauteur * k }
    const xi = x + (l - lw) / 2, yi = y + (h - hw) / 2
    try { doc.addImage(img.donnees, img.format || "PNG", X(xi), Y(yi), lw, hw, undefined, "FAST") } catch { return null }
    return { x: xi, y: yi, l: lw, h: hw }
  }
  const qr = (texte, x, y, taille) => {
    const m = matriceQr(texte), n = m.length, k = taille / n
    rect(x - 0.6, y - 0.6, taille + 1.2, taille + 1.2, [255, 255, 255])
    doc.setFillColor(0, 0, 0)
    m.forEach((ligne, l) => ligne.forEach((noir, c) => { if (noir) doc.rect(X(x + c * k), Y(y + l * k), k + 0.01, k + 0.01, "F") }))
  }
  return { X, Y, txt, rect, image, qr }
}

/** Cachet et signature, recouverts d'un filigrane au code de la carte (contre la réutilisation par découpage). */
function signer(doc, g, cfg, img, carte, x, y, couleur) {
  const cachet = champActif(cfg, "cachet") ? img.cachet : null, signature = champActif(cfg, "signature") ? img.signature : null
  g.txt(cfg.textes?.signataire || t("Le chef d'établissement"), x + 14, y + 0.2, { taille: 3.6, couleur: GRIS, align: "center", max: 28 })
  if (!cachet && !signature) return
  if (cachet) g.image(cachet, x + 1.5, y + 1, 13, 12)
  if (signature) g.image(signature, x + 8, y + 3.5, 19, 9)
  if (carte.code) {
    try {
      doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.2 }))
      for (let k = 0; k < 3; k++) g.txt(carte.code, x + 3 + (k % 2) * 2, y + 5 + k * 3.4, { taille: 3, couleur, espace: 0.3 })
      doc.restoreGraphicsState()
    } catch { /* filigrane facultatif */ }
  }
}

function recto(doc, x0, y0, c, cfg, etab, img) {
  const g = contexte(doc, x0, y0), c1 = rgb(cfg.couleur), c2 = rgb(cfg.couleur2), modele = cfg.modele in MODELES_CARTE ? cfg.modele : "classique"
  const titre = cfg.textes?.titre || t("CARTE D'IDENTITÉ SCOLAIRE")
  const photo = champActif(cfg, "photo") ? img.photo : null, logo = champActif(cfg, "logo") ? img.logo : null
  const cadrePhoto = (x, y, l, h, bord, epaisseur) => {
    if (bord) g.rect(x - epaisseur, y - epaisseur, l + 2 * epaisseur, h + 2 * epaisseur, bord)
    g.rect(x, y, l, h, [236, 239, 243])
    if (photo) g.image(photo, x, y, l, h, { couvrir: true })
    else g.txt(t("PHOTO"), x + l / 2, y + h / 2 + 1, { taille: 4, couleur: GRIS, align: "center" })
  }
  const infos = lignesInfo(c, cfg)
  g.rect(0, 0, W, H, modele === "academique" ? [253, 251, 245] : [255, 255, 255])

  if (modele === "classique") {
    g.rect(0, 0, W, 12, c1)
    if (logo) { doc.setFillColor(255, 255, 255); doc.circle(g.X(7), g.Y(6), 5, "F"); g.image(logo, 3.2, 2.2, 7.6, 7.6) }
    const xt = logo ? 14 : 4
    g.txt(etab.nom, xt, 4.8, { taille: 6.6, gras: true, couleur: [255, 255, 255], max: W - xt - 3 })
    g.txt(etab.devise || [etab.ville, etab.telephone].filter(Boolean).join(" · "), xt, 7.6, { taille: 4.2, italique: true, couleur: [225, 231, 240], max: W - xt - 3 })
    g.txt(titre, xt, 10.6, { taille: 5, gras: true, couleur: c2, max: W - xt - 3, espace: 0.15 })
    cadrePhoto(4, 15, 18, 24, c1, 0.5)
    g.txt(c.nom, 25, 17.6, { taille: 8, gras: true, couleur: c1, max: W - 28 })
    g.txt(c.prenom, 25, 21.2, { taille: 6.8, max: W - 28 })
    infos.slice(0, 6).forEach(([lib, val], k) => {
      g.txt(`${lib} :`, 25, 25.4 + k * 3.25, { taille: 4.4, couleur: GRIS })
      g.txt(val, 39, 25.4 + k * 3.25, { taille: 5.2, gras: true, max: k >= 3 ? 15 : W - 42 })
    })
    if (champActif(cfg, "annee")) g.txt(`${t("Année scolaire")} ${c.annee}`, 4, H - 4.2, { taille: 4.8, gras: true, couleur: c1 })
    g.rect(0, H - 2.2, W, 2.2, c2)
    signer(doc, g, cfg, img, c, W - 31, H - 17.5, c1)
  } else if (modele === "minimaliste") {
    g.rect(0, 0, 1.6, H, c1)
    if (logo) g.image(logo, 4, 2.6, 6, 6)
    const xt = logo ? 11.5 : 4
    g.txt(etab.nom, xt, 5.2, { taille: 5.6, gras: true, max: W - xt - 25 })
    g.txt(titre, xt, 8.3, { taille: 3.9, couleur: GRIS, espace: 0.25, max: W - xt - 25 })
    cadrePhoto(W - 22, 4, 18, 24, null, 0)
    g.txt(c.nom, 4, 16.5, { taille: 9, gras: true, couleur: c1, max: W - 30 })
    g.txt(c.prenom, 4, 20.6, { taille: 7.4, max: W - 30 })
    g.rect(4, 22.8, 10, 0.6, c2)
    const grille = champActif(cfg, "annee") ? [[t("Année scolaire"), c.annee], ...infos] : infos
    grille.slice(0, 6).forEach(([lib, val], k) => {
      const x = 4 + (k % 2) * 25, y = 27.5 + Math.floor(k / 2) * 7
      g.txt(lib.toUpperCase(), x, y, { taille: 3.4, couleur: [150, 156, 164], espace: 0.15, max: 23 })
      g.txt(val, x, y + 2.7, { taille: 5.4, gras: true, max: 23 })
    })
    signer(doc, g, cfg, img, c, W - 31, H - 16, c1)
  } else if (modele === "premium") {
    doc.setFillColor(...c1); doc.lines([[W, 0], [0, 13], [-W, 6]], g.X(0), g.Y(0), [1, 1], "F", true)
    doc.setFillColor(...c2); doc.lines([[W, -6], [0, 1.6], [-W, 6]], g.X(0), g.Y(19), [1, 1], "F", true)
    if (logo) { doc.setFillColor(255, 255, 255); doc.circle(g.X(W - 8.5), g.Y(6.8), 5.2, "F"); g.image(logo, W - 12.4, 2.9, 7.8, 7.8) }
    g.txt(etab.nom, 27, 5.4, { taille: 6.4, gras: true, couleur: [255, 255, 255], max: W - 27 - (logo ? 16 : 4) })
    g.txt(titre, 27, 9, { taille: 4.6, gras: true, couleur: c2, max: W - 27 - (logo ? 16 : 4), espace: 0.12 })
    cadrePhoto(4.5, 5, 18.5, 24.6, [255, 255, 255], 0.9)
    if (champActif(cfg, "matricule") && c.matricule) g.txt(c.matricule, 13.75, 34, { taille: 5.4, gras: true, couleur: c1, align: "center", max: 20 })
    if (champActif(cfg, "annee")) g.txt(c.annee, 13.75, 37.6, { taille: 4.6, couleur: GRIS, align: "center" })
    g.txt(c.nom, 27, 23.4, { taille: 8.4, gras: true, max: W - 30 })
    g.txt(c.prenom, 27, 27, { taille: 6.6, couleur: [70, 70, 70], max: W - 30 })
    infos.filter(([lib]) => lib !== t("Matricule")).slice(0, 4).forEach(([lib, val], k) => {
      g.txt(`${lib} :`, 27, 31.4 + k * 3.2, { taille: 4.3, couleur: GRIS })
      g.txt(val, 40, 31.4 + k * 3.2, { taille: 5.1, gras: true, max: k >= 2 ? 14 : W - 43 })
    })
    signer(doc, g, cfg, img, c, W - 31, H - 15.5, c1)
  } else if (modele === "academique") {
    doc.setLineWidth(0.5); g.rect(1.2, 1.2, W - 2.4, H - 2.4, c1, "S"); doc.setLineWidth(0.2); g.rect(2.2, 2.2, W - 4.4, H - 4.4, c2, "S")
    if (logo) g.image(logo, W / 2 - 3.2, 3.2, 6.4, 6.4)
    g.txt(etab.nom, W / 2, logo ? 12.4 : 7, { taille: 6, gras: true, couleur: c1, align: "center", police: "times", max: W - 8 })
    if (etab.devise) g.txt(etab.devise, W / 2, logo ? 14.8 : 9.4, { taille: 4.2, italique: true, couleur: GRIS, align: "center", police: "times", max: W - 10 })
    const yt = logo ? 18 : 12.6
    doc.setDrawColor(...c2); doc.setLineWidth(0.25)
    doc.line(g.X(6), g.Y(yt - 1.1), g.X(W / 2 - 21), g.Y(yt - 1.1)); doc.line(g.X(W / 2 + 21), g.Y(yt - 1.1), g.X(W - 6), g.Y(yt - 1.1))
    g.txt(titre, W / 2, yt, { taille: 4.7, gras: true, couleur: c1, align: "center", police: "times", max: 40, espace: 0.15 })
    cadrePhoto(W - 19, 19, 13, 17.3, c2, 0.4)
    g.txt(c.nom, 5, 23, { taille: 7.2, gras: true, couleur: c1, police: "times", max: W - 28 })
    g.txt(c.prenom, 5, 26.4, { taille: 6.2, police: "times", max: W - 28 })
    const lignes = champActif(cfg, "annee") ? [...infos.slice(0, 5), [t("Année scolaire"), c.annee]] : infos.slice(0, 6)
    lignes.slice(0, 6).forEach(([lib, val], k) => {
      const y = 30 + k * 3.25
      g.txt(`${lib} :`, 5, y, { taille: 4.3, italique: true, couleur: GRIS, police: "times" })
      g.txt(val, 20, y, { taille: 5.2, gras: true, police: "times", max: k >= 3 ? 34 : W - 45 })
      doc.setDrawColor(200, 190, 170); doc.setLineDashPattern([0.3, 0.5], 0); doc.line(g.X(20), g.Y(y + 0.6), g.X(k >= 3 ? 54 : W - 24), g.Y(y + 0.6)); doc.setLineDashPattern([], 0)
    })
    signer(doc, g, cfg, img, c, W - 31, H - 15.6, c1)
  } else {   // dynamique
    g.rect(0, 0, 26, H, c1)
    cadrePhoto(4, 5, 18, 24, [255, 255, 255], 0.7)
    if (champActif(cfg, "matricule") && c.matricule) g.txt(c.matricule, 13, 34, { taille: 5.4, gras: true, couleur: [255, 255, 255], align: "center", max: 22 })
    if (champActif(cfg, "classe") && c.classe) {
      doc.setFillColor(...c2); doc.roundedRect(g.X(3), g.Y(36.6), 20, 5.2, 1.4, 1.4, "F")
      g.txt(c.classe, 13, 40.2, { taille: 5.6, gras: true, couleur: [255, 255, 255], align: "center", max: 18 })
    }
    if (champActif(cfg, "annee")) g.txt(c.annee, 13, 47.4, { taille: 4.6, couleur: [235, 245, 243], align: "center" })
    if (logo) g.image(logo, W - 10, 2.6, 7, 7)
    g.txt(etab.nom, 29, 5.6, { taille: 6, gras: true, couleur: c1, max: W - 29 - (logo ? 12 : 3) })
    g.txt(titre, 29, 8.8, { taille: 3.9, couleur: GRIS, espace: 0.2, max: W - 29 - (logo ? 12 : 3) })
    g.txt(c.nom, 29, 16.4, { taille: 10, gras: true, couleur: c1, max: W - 32 })
    g.txt(c.prenom, 29, 20.8, { taille: 7.8, max: W - 32 })
    infos.filter(([lib]) => ![t("Matricule"), t("Classe")].includes(lib)).slice(0, 3).forEach(([lib, val], k) => {
      g.txt(`${lib} :`, 29, 25.6 + k * 3.1, { taille: 4.2, couleur: GRIS })
      g.txt(val, 43, 25.6 + k * 3.1, { taille: 5, gras: true, max: W - 46 })
    })
    if (champActif(cfg, "qr") && c.code) { g.qr(urlVerificationCarte(c.code), 29.5, H - 19.5, 16.5); g.txt(c.code, 37.75, H - 1.6, { taille: 3.3, couleur: GRIS, align: "center" }) }
    signer(doc, g, cfg, img, c, W - 31, H - 16, c1)
  }
}

function verso(doc, x0, y0, c, cfg, etab) {
  const g = contexte(doc, x0, y0), c1 = rgb(cfg.couleur), c2 = rgb(cfg.couleur2), times = cfg.modele === "academique"
  const police = times ? "times" : "helvetica"
  g.rect(0, 0, W, H, times ? [253, 251, 245] : [255, 255, 255])
  g.rect(0, 0, W, 7, c1)
  g.txt(etab.nom, W / 2, 4.6, { taille: 5.6, gras: true, couleur: [255, 255, 255], align: "center", police, max: W - 6 })
  const avecQr = champActif(cfg, "qr") && c.code, largeurTexte = avecQr ? W - 31 : W - 8
  let y = 11.4
  if (champActif(cfg, "coordonnees")) {
    for (const v of [[etab.adresse, etab.ville].filter(Boolean).join(", "), etab.telephone && `${t("Tél.")} ${etab.telephone}`,
      cfg.textes?.email, (etab.site_web || "").replace(/^https?:\/\//, "")].filter(Boolean)) {
      g.txt(v, 4, y, { taille: 4.5, police, max: largeurTexte }); y += 2.9
    }
    y += 0.8
  }
  const mention = cfg.textes?.mention || t("Cette carte est strictement personnelle. Elle doit être présentée à toute demande du personnel de l'établissement. Toute falsification est interdite.")
  doc.setFont(police, "italic"); doc.setFontSize(4.2); doc.setTextColor(...GRIS)
  doc.text(doc.splitTextToSize(pdf(mention), largeurTexte).slice(0, 4), g.X(4), g.Y(y), { lineHeightFactor: 1.35 })
  if (avecQr) {
    g.qr(urlVerificationCarte(c.code), W - 24.5, 10, 20.5)
    g.txt(t("Vérifier la carte"), W - 14.25, 33.6, { taille: 3.8, couleur: GRIS, align: "center" })
    g.txt(c.code, W - 14.25, 36.3, { taille: 4.3, gras: true, couleur: c1, align: "center", espace: 0.1 })
  }
  const dates = [champActif(cfg, "emission") && c.emise_le && `${t("Émise le")} ${new Date(c.emise_le).toLocaleDateString("fr-FR")}`,
    champActif(cfg, "expiration") && c.expire_le && `${t("Valable jusqu'au")} ${new Date(c.expire_le + "T00:00:00").toLocaleDateString("fr-FR")}`].filter(Boolean)
  if (!c.code && (champActif(cfg, "emission") || champActif(cfg, "expiration"))) dates.push(t("Aperçu : dates et QR code ajoutés à l'émission"))
  g.txt(dates.join(" · "), 4, H - 8.4, { taille: 4.7, gras: true, couleur: c1, police, max: W - 8 })
  g.txt(cfg.textes?.trouvee || t("Carte trouvée ? Merci de la rapporter à l'établissement."), 4, H - 4.8, { taille: 3.9, couleur: GRIS, police, max: W - 16 })
  if (c.version > 1) g.txt(`v${c.version}`, W - 4, H - 4.8, { taille: 3.6, couleur: GRIS, align: "right" })
  g.rect(0, H - 1.6, W, 1.6, c2)
}

function repere(doc, x, y) {
  doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.1); doc.roundedRect(x, y, W, H, 3.18, 3.18, "S")
}

/**
 * cartes = [{ carte (donneesCarte + code…), photo }] ; cfg = configuration ; etab ; images = { logo, cachet, signature }.
 * format : "planche" (A4, 10 cartes, recto puis verso en miroir) | "carte" (une face par page, 85,6 × 54 mm).
 * mode : "telecharger" | "imprimer" | "url" | "octets".
 */
export async function cartesPdf(cartes, { cfg, etab, images = {}, format = "planche", mode = "telecharger", nom = "cartes-scolaires" }) {
  const { jsPDF } = await import("jspdf")
  const doc = format === "carte" ? new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape", compress: true })
    : new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: pdf(`${t("Cartes scolaires")} — ${etab.nom}`), author: pdf(etab.nom), creator: "NexIA School" })
  const img = (x) => ({ ...images, photo: x.photo })
  let premiere = true
  const page = () => { if (!premiere) doc.addPage(format === "carte" ? [W, H] : "a4", format === "carte" ? "landscape" : "portrait"); premiere = false }
  if (format === "carte") {
    for (const x of cartes) { page(); recto(doc, 0, 0, x.carte, cfg, etab, img(x)); page(); verso(doc, 0, 0, x.carte, cfg, etab) }
  } else {
    const gx = 6, gy = 2, mx = (210 - 2 * W - gx) / 2, my = (297 - 5 * H - 4 * gy) / 2
    for (let i = 0; i < cartes.length; i += 10) {
      const lot = cartes.slice(i, i + 10)
      page()
      lot.forEach((x, k) => { const col = k % 2, lig = Math.floor(k / 2), px = mx + col * (W + gx), py = my + lig * (H + gy); recto(doc, px, py, x.carte, cfg, etab, img(x)); repere(doc, px, py) })
      page()      // verso en miroir (colonnes inversées) pour l'impression recto-verso, retournement sur le bord long
      lot.forEach((x, k) => { const col = 1 - (k % 2), lig = Math.floor(k / 2), px = mx + col * (W + gx), py = my + lig * (H + gy); verso(doc, px, py, x.carte, cfg, etab); repere(doc, px, py) })
    }
  }
  if (mode === "url") return doc.output("bloburl")
  if (mode === "octets") return doc.output("arraybuffer")
  if (mode === "imprimer") { doc.autoPrint(); window.open(doc.output("bloburl"), "_blank"); return null }
  doc.save(`${nom}.pdf`); return null
}

/** Archive ZIP : un PDF recto-verso (format carte) par élève. */
export async function cartesZip(cartes, options, nomArchive, avancement = () => {}) {
  const fichiers = []
  for (const [k, x] of cartes.entries()) {
    const octets = await cartesPdf([x], { ...options, format: "carte", mode: "octets" })
    const nom = `${x.carte.classe || "classe"}/${[x.carte.matricule, x.carte.nom, x.carte.prenom].filter(Boolean).join("-")}.pdf`
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9/._-]+/g, "-")
    fichiers.push({ nom, donnees: new Uint8Array(octets) })
    avancement(k + 1, cartes.length)
  }
  const z = creerZip(fichiers)
  if (nomArchive) telechargerZip(z, nomArchive)
  return z
}
