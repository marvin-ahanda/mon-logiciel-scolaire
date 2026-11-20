// Certificats de distinction (A4 paysage, un élève par page) et tableaux d'honneur (A4 portrait), avec QR code de
// vérification comme sur les bulletins. Quatre modèles personnalisables (textes, couleurs, police, logo, moyenne).
// jsPDF est chargé à la demande.
import { EDITEUR } from "./editeur.js"
import { matriceQr } from "./bulletinVerif.js"
import { remplirTexte } from "./distinctions.js"
import { note } from "./format.js"
import { t } from "../i18n.jsx"

/** Adresse ouverte par le QR code d'une distinction. */
export const urlVerificationDistinction = (code) => `${EDITEUR.site}/distinction/${code}`

/** Réglages par défaut de chaque modèle (l'administration les remplace un par un). */
export const DEFAUTS_MODELES = {
  classique: { couleur: "#1F3A68", couleur2: "#B8860B", police: "serif", bordure: "double" },
  moderne: { couleur: "#0B46E5", couleur2: "#F2B705", police: "sans", bordure: "bandeau" },
  prestige: { couleur: "#5B1A2E", couleur2: "#C9A227", police: "serif", bordure: "ornee" },
  epure: { couleur: "#111827", couleur2: "#10B981", police: "sans", bordure: "simple" },
}

/** Texte par défaut du certificat. */
export function texteParDefaut(afficherMoyenne = true) {
  return afficherMoyenne
    ? t("pour la qualité de son travail au cours de la période « {periode} » de l'année scolaire {annee}, en classe de {classe}, avec une moyenne de {moyenne}/20.")
    : t("pour la qualité de son travail au cours de la période « {periode} » de l'année scolaire {annee}, en classe de {classe}.")
}

/** Réglages effectifs d'une distinction : défauts du modèle complétés par la personnalisation. */
export function reglages(distinction, etablissement) {
  const p = distinction.personnalisation || {}, d = DEFAUTS_MODELES[distinction.modele] || DEFAUTS_MODELES.classique
  const afficherMoyenne = p.afficher_moyenne !== false
  return {
    modele: DEFAUTS_MODELES[distinction.modele] ? distinction.modele : "classique",
    titre: p.titre || distinction.nom, sousTitre: p.sous_titre || t("est décerné(e) à"),
    texte: p.texte || texteParDefaut(afficherMoyenne),
    couleur: p.couleur || d.couleur, couleur2: p.couleur2 || d.couleur2, police: p.police || d.police,
    signataire: p.signataire || t("Le chef d'établissement"), nomSignataire: p.nom_signataire ?? etablissement?.nom_chef ?? "",
    afficherLogo: p.afficher_logo !== false, afficherMoyenne, lieu: p.lieu || etablissement?.ville || "",
  }
}

const rgb = (hex) => { const h = String(hex || "#000000").replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) }
const pdf = (v) => String(v ?? "").replace(/[   ]/g, " ").replace(/[’]/g, "'")
const dateLongue = (d) => new Date(d || Date.now()).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

function qr(doc, texte, x, y, taille) {
  const m = matriceQr(texte), n = m.length, k = taille / n
  doc.setFillColor(255, 255, 255); doc.rect(x - 1, y - 1, taille + 2, taille + 2, "F")
  doc.setFillColor(0, 0, 0)
  m.forEach((ligne, l) => ligne.forEach((noir, c) => { if (noir) doc.rect(x + c * k, y + l * k, k + 0.02, k + 0.02, "F") }))
}

function logoDans(doc, logo, cx, y, hauteurMax, largeurMax) {
  if (!logo) return 0
  const k = Math.min(hauteurMax / logo.hauteur, largeurMax / logo.largeur), l = logo.largeur * k, h = logo.hauteur * k
  try { doc.addImage(logo.donnees, logo.format, cx - l / 2, y, l, h, undefined, "FAST") } catch { return 0 }
  return h
}

/** Variables disponibles dans les textes. */
export function variables(laureat, distinction, etablissement) {
  const v = laureat.valeurs || {}
  return {
    eleve: laureat.eleve, classe: laureat.classe || v.classe || "", periode: laureat.periode || "", annee: laureat.annee || "",
    moyenne: v.moyenne === null || v.moyenne === undefined ? "—" : note(Number(v.moyenne)), rang: v.rang ?? "",
    progression: v.progression === null || v.progression === undefined ? "" : `+${note(Number(v.progression))}`,
    distinction: distinction.nom, etablissement: etablissement.nom, ville: etablissement.ville || "",
    date: dateLongue(laureat.emis_le), matricule: laureat.matricule || "",
  }
}

/** Dessine un certificat sur la page courante (A4 paysage 297 × 210 mm). */
function certificat(doc, laureat, distinction, etablissement, logo) {
  const r = reglages(distinction, etablissement), W = 297, H = 210
  const c1 = rgb(r.couleur), c2 = rgb(r.couleur2), police = r.police === "serif" ? "times" : "helvetica"
  const vars = variables(laureat, distinction, etablissement)
  doc.setTextColor(33, 37, 41)
  let gauche = 0, centre = W / 2, largeurTexte = 210

  // --- Cadre selon le modèle
  if (r.modele === "classique") {
    doc.setDrawColor(...c1); doc.setLineWidth(2.2); doc.rect(9, 9, W - 18, H - 18)
    doc.setDrawColor(...c2); doc.setLineWidth(0.6); doc.rect(14, 14, W - 28, H - 28)
  } else if (r.modele === "moderne") {
    doc.setFillColor(...c1); doc.rect(0, 0, 78, H, "F")
    doc.setFillColor(...c2); doc.rect(78, 0, 3, H, "F")
    gauche = 81; centre = gauche + (W - gauche) / 2; largeurTexte = W - gauche - 34
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12)
    if (r.afficherLogo && logo) {
      doc.setFillColor(255, 255, 255); doc.circle(39, 46, 24, "F")
      logoDans(doc, logo, 39, 30, 32, 32)
    }
    doc.text(doc.splitTextToSize(pdf(etablissement.nom), 62), 39, 86, { align: "center" })
    doc.setFont("helvetica", "normal"); doc.setFontSize(9)
    if (etablissement.devise) doc.text(doc.splitTextToSize(pdf(etablissement.devise), 62), 39, 110, { align: "center" })
    doc.setFontSize(10); doc.text(pdf(`${t("Année scolaire")}`), 39, 170, { align: "center" })
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(pdf(vars.annee), 39, 177, { align: "center" })
    doc.setTextColor(33, 37, 41)
  } else if (r.modele === "prestige") {
    doc.setFillColor(...c1); doc.rect(0, 0, W, H, "F")
    doc.setFillColor(253, 251, 245); doc.rect(10, 10, W - 20, H - 20, "F")
    doc.setDrawColor(...c2); doc.setLineWidth(1.4); doc.rect(15, 15, W - 30, H - 30)
    doc.setLineWidth(0.3); doc.rect(18, 18, W - 36, H - 36)
    doc.setFillColor(...c2)
    for (const [x, y] of [[15, 15], [W - 15, 15], [15, H - 15], [W - 15, H - 15]]) {
      doc.lines([[5, 5], [-5, 5], [-5, -5], [5, -5]], x, y - 5, [1, 1], "F", true)
    }
  } else {   // épuré
    doc.setDrawColor(...c1); doc.setLineWidth(0.3); doc.rect(16, 16, W - 32, H - 32)
    doc.setFillColor(...c2); doc.rect(W / 2 - 15, 16, 30, 1.6, "F")
  }

  // --- En-tête (sauf modèle à bandeau, qui l'affiche à gauche)
  let y = r.modele === "prestige" ? 26 : 22
  if (r.modele !== "moderne") {
    if (r.afficherLogo && logo) y += logoDans(doc, logo, centre, y, 22, 40) + 3
    doc.setFont(police, "bold"); doc.setFontSize(13); doc.setTextColor(...c1)
    doc.text(pdf(etablissement.nom), centre, y + 4, { align: "center" }); y += 6
    doc.setFont(police, "italic"); doc.setFontSize(9); doc.setTextColor(90, 90, 90)
    if (etablissement.devise) { doc.text(pdf(etablissement.devise), centre, y + 4, { align: "center" }); y += 5 }
    doc.setFont(police, "normal"); doc.text(pdf(`${t("Année scolaire")} ${vars.annee}`), centre, y + 4, { align: "center" }); y += 8
  } else y = 40

  // --- Titre
  if (r.modele === "prestige") {   // médaille
    doc.setFillColor(...c2); doc.circle(W - 52, 50, 13, "F"); doc.setFillColor(...c1); doc.circle(W - 52, 50, 9.5, "F")
    doc.setFillColor(...c2); doc.triangle(W - 60, 60, W - 55, 60, W - 61, 76, "F"); doc.triangle(W - 49, 60, W - 44, 60, W - 43, 76, "F")
    doc.setFillColor(...c2); doc.circle(W - 52, 50, 4, "F")
  }
  doc.setTextColor(...c1); doc.setFont(police, "bold"); doc.setFontSize(r.modele === "epure" ? 30 : 34)
  const titre = pdf(r.titre).toUpperCase()
  doc.text(doc.splitTextToSize(titre, largeurTexte), centre, y + 14, { align: "center" }); y += 14 + (doc.splitTextToSize(titre, largeurTexte).length - 1) * 13
  if (r.modele !== "prestige") { doc.setFillColor(...c2); doc.rect(centre - 25, y + 4, 50, 1.2, "F") }
  y += 14

  // --- Lauréat
  doc.setTextColor(80, 80, 80); doc.setFont(police, "italic"); doc.setFontSize(13)
  doc.text(pdf(remplirTexte(r.sousTitre, vars)), centre, y, { align: "center" }); y += 13
  doc.setTextColor(...c1); doc.setFont(police, "bold"); doc.setFontSize(26)
  doc.text(pdf(laureat.eleve), centre, y, { align: "center" }); y += 5
  doc.setFont(police, "normal"); doc.setFontSize(10); doc.setTextColor(110, 110, 110)
  if (laureat.matricule) { doc.text(pdf(`${t("Matricule")} ${laureat.matricule}`), centre, y + 3, { align: "center" }) }
  y += 12
  doc.setTextColor(40, 40, 40); doc.setFontSize(13)
  const lignes = doc.splitTextToSize(pdf(remplirTexte(r.texte, vars)), largeurTexte)
  doc.text(lignes, centre, y, { align: "center", lineHeightFactor: 1.4 })

  // --- Pied : lieu et date, signature, QR code
  const yb = H - 48
  doc.setFont(police, "normal"); doc.setFontSize(11); doc.setTextColor(40, 40, 40)
  const xs = r.modele === "moderne" ? W - 70 : W - 82
  doc.text(pdf(`${t("Fait à")} ${r.lieu || "……………"}, ${t("le")} ${vars.date}`), xs, yb, { align: "center" })
  doc.setFont(police, "bold"); doc.text(pdf(r.signataire), xs, yb + 7, { align: "center" })
  doc.setFont(police, "normal"); if (r.nomSignataire) doc.text(pdf(r.nomSignataire), xs, yb + 23, { align: "center" })
  if (laureat.code) {
    const xq = r.modele === "moderne" ? gauche + 14 : 26, taille = 24
    qr(doc, urlVerificationDistinction(laureat.code), xq, yb - 8, taille)
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(90, 90, 90)
    doc.text(pdf(t("Authentique ? Scannez pour vérifier.")), xq + taille + 3, yb + 2)
    doc.text(pdf(`${t("Code")} ${laureat.code}`), xq + taille + 3, yb + 6)
    doc.text(pdf(urlVerificationDistinction(laureat.code).replace(/^https?:\/\//, "").replace(/\/[^/]+$/, "")), xq + taille + 3, yb + 10)
  } else {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(150, 150, 150)
    doc.text(pdf(t("Aperçu : le QR code de vérification est ajouté à la validation.")), r.modele === "moderne" ? gauche + 14 : 26, yb + 6)
  }
}

/** Sortie d'un document : téléchargement, impression ou adresse (aperçu). */
function sortie(doc, nom, mode) {
  if (mode === "url") return doc.output("bloburl")
  if (mode === "octets") return doc.output("arraybuffer")          // tests, archives ZIP
  if (mode === "imprimer") { doc.autoPrint(); window.open(doc.output("bloburl"), "_blank"); return null }
  doc.save(`${nom}.pdf`); return null
}

/**
 * Certificats individuels. laureats = [{ eleve, matricule, classe, periode, annee, valeurs, code, emis_le }].
 * mode : "telecharger" | "imprimer" | "url" (aperçu : renvoie l'adresse du PDF) | "octets" (contenu du PDF).
 */
export async function certificatsPdf(laureats, { distinction, etablissement, logo, nom = "certificats", mode = "telecharger" }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true })
  doc.setProperties({ title: pdf(`${distinction.nom} — ${etablissement.nom}`), author: pdf(etablissement.nom), creator: "NexIA School" })
  laureats.forEach((l, k) => { if (k) doc.addPage("a4", "landscape"); certificat(doc, l, distinction, etablissement, logo) })
  return sortie(doc, nom, mode)
}

/**
 * Tableau d'honneur (A4 portrait) : groupes = [{ titre, lignes: [{ eleve, matricule, classe, moyenne, progression, code }] }].
 * Chaque lauréat porte son QR code de vérification.
 */
export async function tableauHonneurPdf({ titre, sousTitre, groupes, etablissement, logo, couleur = "#1F3A68", afficherMoyenne = true,
                                           afficherProgression = false, nom = "tableau-honneur", mode = "telecharger" }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: pdf(`${titre} — ${etablissement.nom}`), author: pdf(etablissement.nom), creator: "NexIA School" })
  const W = 210, M = 14, c1 = rgb(couleur)
  const entete = () => {
    doc.setFillColor(...c1); doc.rect(0, 0, W, 4, "F")
    let y = 12
    const h = logo ? logoDans(doc, logo, M + 10, y - 2, 18, 20) : 0
    doc.setTextColor(...c1); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(pdf(etablissement.nom), M + (h ? 24 : 0), y + 2)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90)
    doc.text(pdf([etablissement.adresse, etablissement.ville, etablissement.telephone].filter(Boolean).join(" · ")), M + (h ? 24 : 0), y + 7)
    doc.setTextColor(...c1); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(pdf(titre).toUpperCase(), W / 2, y + 22, { align: "center" })
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 60); doc.text(pdf(sousTitre), W / 2, y + 28, { align: "center" })
    return y + 34
  }
  let y = entete(), premier = true
  const colonnes = [t("N°"), t("Élève"), t("Matricule"), t("Classe"), ...(afficherMoyenne ? [t("Moyenne")] : []), ...(afficherProgression ? [t("Progression")] : []), t("QR code")]
  for (const g of groupes) {
    if (!premier && y > 250) { doc.addPage(); y = entete() }
    premier = false
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...c1); doc.text(pdf(g.titre), M, y + 2); y += 4
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, top: 50 }, theme: "grid",
      head: [colonnes.map(pdf)],
      body: g.lignes.map((l, k) => [k + 1, pdf(l.eleve), pdf(l.matricule || ""), pdf(l.classe || ""),
        ...(afficherMoyenne ? [l.moyenne === null || l.moyenne === undefined ? "—" : note(Number(l.moyenne))] : []),
        ...(afficherProgression ? [l.progression === null || l.progression === undefined ? "—" : `+${note(Number(l.progression))}`] : []), ""]),
      styles: { fontSize: 9, cellPadding: 1.6, minCellHeight: 15, valign: "middle" },
      headStyles: { fillColor: c1, textColor: 255, minCellHeight: 7 },
      columnStyles: { 0: { cellWidth: 9, halign: "center" }, [colonnes.length - 1]: { cellWidth: 19 } },
      didDrawCell: (d) => {
        const l = g.lignes[d.row.index]
        if (d.section === "body" && d.column.index === colonnes.length - 1 && l?.code) qr(doc, urlVerificationDistinction(l.code), d.cell.x + 2, d.cell.y + 1.5, 12)
      },
      didDrawPage: () => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
        doc.text(pdf(t("Chaque QR code permet de vérifier la distinction sur {v0}", { v0: EDITEUR.site.replace(/^https?:\/\//, "") })), W / 2, 290, { align: "center" })
      },
    })
    y = doc.lastAutoTable.finalY + 9
  }
  return sortie(doc, nom, mode)
}
