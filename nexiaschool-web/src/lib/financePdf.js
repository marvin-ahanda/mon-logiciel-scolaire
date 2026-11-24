// PDF des finances : listes (classe, élèves non en règle) et reçus de paiement. jsPDF est chargé à la demande.
import { image } from "./bulletinPdf.js"
import { siteAffiche } from "./logo.js"
import { locale, t } from "../i18n.jsx"

const entiers = {}
const entier = () => (entiers[locale()] ||= new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }))
/** 205000 -> « 205 000 FCFA » (espaces ordinaires : lisibles à l'écran comme dans le PDF) */
export const fcfa = (n) => `${entier().format(Math.round(Number(n || 0))).replace(/[  ]/g, " ")} FCFA`
export const jour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(locale()) : "—")
/** Modes de paiement (libellé français, traduit à l'affichage par modePaiement) */
export const MODES = { especes: "Espèces", mtn_momo: "MTN Mobile Money", orange_money: "Orange Money", mobile_money: "Mobile money", virement: "Virement", cheque: "Chèque", carte: "Carte bancaire", autre: "Autre" }
export const modePaiement = (m) => t(MODES[m] || m)
export const pdf = (v) => String(v ?? "").replace(/[   ]/g, " ")
export const NOIR = [33, 37, 41], GRIS = [108, 117, 125], BORDURE = [173, 181, 189]

export async function charger() {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  return { jsPDF, autoTable: module.autoTable || module.default }
}

/** En-tête commun : établissement à gauche, logo au centre, titre à droite. Renvoie l'ordonnée suivante. */
export function entete(doc, { etablissement, logo, titre, sousTitre }) {
  const L = doc.internal.pageSize.getWidth(), M = 12, largeur = L / 2 - 30
  const HT = 4.6, HP = 3.4                                   // hauteur d'une ligne en 11 pt et en 8 pt (mm)
  // un nom ou un titre long passe sur plusieurs lignes : les lignes suivantes se décalent d'autant (pas de chevauchement)
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  const nom = doc.splitTextToSize(pdf(etablissement.nom), largeur)
  doc.text(nom, M, M + 4)
  doc.setFont("helvetica", "normal"); doc.setFontSize(8)
  const coord = doc.splitTextToSize(pdf([etablissement.adresse, etablissement.ville, etablissement.telephone, siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")), largeur)
  const yCoord = M + 4 + nom.length * HT + 0.4
  doc.text(coord, M, yCoord)
  if (logo) {
    const k = Math.min(18 / logo.largeur, 18 / logo.hauteur)
    doc.addImage(logo.donnees, logo.format, L / 2 - (logo.largeur * k) / 2, M - 1, logo.largeur * k, logo.hauteur * k, undefined, "FAST")
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  const lignesTitre = doc.splitTextToSize(pdf(titre), largeur)
  doc.text(lignesTitre, L - M, M + 4, { align: "right" })
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS)
  const ySous = M + 4 + lignesTitre.length * HT + 0.9
  const sous = sousTitre ? doc.splitTextToSize(pdf(sousTitre), largeur) : []
  if (sous.length) doc.text(sous, L - M, ySous, { align: "right" })
  doc.setTextColor(...NOIR)
  const y = Math.max(M + 21, yCoord + coord.length * HP + 2, ySous + sous.length * HP + 2)
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.5); doc.line(M, y, L - M, y)
  return y + 4
}

/** Ouvre le PDF pour l'imprimer (le lecteur PDF n'ajoute ni adresse ni pagination) ou le télécharge. */
export function sortir(doc, nom, imprimer, fenetre) {
  if (imprimer) {
    doc.autoPrint()
    const url = doc.output("bloburl")
    if (fenetre && !fenetre.closed) fenetre.location.href = url
    else window.open(url, "_blank")
  } else doc.save(`${nom}.pdf`)
}

/**
 * Liste en PDF (paysage). contenu : { etablissement, logoUrl, titre, sousTitre, colonnes: [{ titre, largeur?, droite? }], lignes: [[...]], pied?: [...], note? }
 * options : { imprimer: bool, fenetre: Window ouverte au clic (évite le blocage des fenêtres) }
 */
export async function listePdf(contenu, nom, { imprimer = false, fenetre = null } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true })
  doc.setProperties({ title: nom, author: contenu.etablissement.nom, creator: "NexIA School" })
  const logo = await image(contenu.logoUrl)
  const y = entete(doc, { etablissement: contenu.etablissement, logo, titre: contenu.titre, sousTitre: contenu.sousTitre })
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12, top: 12, bottom: 12 }, theme: "grid",
    head: [contenu.colonnes.map((c) => c.titre)],
    body: contenu.lignes.map((l) => l.map((v) => pdf(v))),
    foot: contenu.pied ? [contenu.pied.map((v) => pdf(v))] : undefined, showFoot: "lastPage",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.4, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2, valign: "middle" },
    headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold" },
    footStyles: { fillColor: [248, 249, 250], textColor: NOIR, fontStyle: "bold" },
    columnStyles: Object.fromEntries(contenu.colonnes.map((c, k) => [k, { halign: c.droite ? "right" : "left", ...(c.largeur ? { cellWidth: c.largeur } : {}) }])),
  })
  if (contenu.note) {
    doc.setFontSize(7.5); doc.setTextColor(...GRIS)
    doc.text(doc.splitTextToSize(pdf(contenu.note), doc.internal.pageSize.getWidth() - 24), 12, doc.lastAutoTable.finalY + 5)
  }
  sortir(doc, nom, imprimer, fenetre)
}

/** Reçu de paiement (A5). p : paiement ; s : situation de l'élève après paiement. */
export async function recuPdf({ etablissement, logoUrl, eleve, paiement, situation, caissier }, { imprimer = false, fenetre = null } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: true })
  const nom = `recu-${String(paiement.numero).padStart(5, "0")}`
  doc.setProperties({ title: t("Reçu n° {v0}", { v0: paiement.numero }), author: etablissement.nom, creator: "NexIA School" })
  const logo = await image(logoUrl)
  let y = entete(doc, { etablissement, logo, titre: t("Reçu n° {v0}", { v0: String(paiement.numero).padStart(5, "0") }), sousTitre: t("Paiement du {v0}", { v0: jour(paiement.date) }) })
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12 }, theme: "plain",
    body: [["Élève", `${eleve.nom} ${eleve.prenom || ""}`.trim()], ["Matricule", eleve.matricule], ["Classe", eleve.classe],
           ["Montant reçu", fcfa(paiement.montant)], ["Mode de paiement", modePaiement(paiement.mode)],
           ...(paiement.reference ? [["Référence", paiement.reference]] : []), ...(paiement.observation ? [["Observation", paiement.observation]] : [])].map(([a, b]) => [pdf(t(a)), pdf(b)]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.3, textColor: NOIR },
    columnStyles: { 0: { cellWidth: 38, textColor: GRIS }, 1: { fontStyle: "bold" } },
  })
  y = doc.lastAutoTable.finalY + 3
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12 }, theme: "grid",
    head: [[t("Situation après ce paiement"), ""]],
    body: [["Total dû pour l'année", fcfa(situation.total_du)], ["Total payé", fcfa(situation.paye)], ["Reste à payer", fcfa(situation.reste)],
           ...(situation.prochaine ? [["Prochaine échéance", t("{v0} : {v1} avant le {v2}", { v0: t(situation.prochaine.libelle), v1: fcfa(situation.prochaine.reste), v2: jour(situation.prochaine.date_limite) })]] : [])].map(([a, b]) => [pdf(t(a)), pdf(b)]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.3, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 52 }, 1: { halign: "right" } },
  })
  y = doc.lastAutoTable.finalY + 10
  doc.setFontSize(8.5); doc.setTextColor(...NOIR)
  doc.text(pdf(t("Encaissé par : {v0}", { v0: caissier || "—" })), 12, y)
  doc.text(t("Signature et cachet"), doc.internal.pageSize.getWidth() - 12, y, { align: "right" })
  sortir(doc, nom, imprimer, fenetre)
}

/** « Situation 6e A » -> « situation-6e-a » */
export const fichier = (...parties) => parties.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120)
