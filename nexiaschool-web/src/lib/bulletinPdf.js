// Bulletins au format PDF (A4, texte vectoriel net, sans en-tête ni pied de page ajoutés par le navigateur).
// La bibliothèque jsPDF n'est chargée qu'au moment de l'export, pour ne pas alourdir l'application.
import { appreciation } from "./calculs.js"
import { date, nomComplet, note } from "./format.js"
import { siteAffiche } from "./logo.js"

const MARGE = 12, LARGEUR = 210, UTILE = LARGEUR - 2 * MARGE
const GRIS = [108, 117, 125], NOIR = [33, 37, 41], BORDURE = [173, 181, 189], FOND = [241, 243, 245]

// Les polices standard du PDF ne connaissent pas les espaces fines insécables produites par Intl (fr-FR)
const t = (v) => String(v ?? "").replace(/[  ]/g, " ").replace(/ /g, " ")
const rang = (r, ex, sur) => (r ? `${r}${r === 1 ? "er" : "e"}${ex ? " ex" : ""}${sur ? ` / ${sur}` : ""}` : "")

/** Image distante -> { donnees (data URL), format, largeur, hauteur } ; null si indisponible. */
async function image(url) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const donnees = await new Promise((ok, ko) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = ko; l.readAsDataURL(blob) })
    const bmp = await createImageBitmap(blob)
    return { donnees, format: blob.type === "image/png" ? "PNG" : "JPEG", largeur: bmp.width, hauteur: bmp.height }
  } catch { return null }
}

function cadre(doc, x, y, l, h) {
  doc.setDrawColor(...BORDURE); doc.setLineWidth(0.25); doc.roundedRect(x, y, l, h, 1.2, 1.2)
}

function bulletin(doc, autoTable, { etablissement, logo, exercice, periode, classe, stats, r, photo, conduite }) {
  let y = MARGE
  // --- En-tête : coordonnées à gauche, logo au centre, période à droite
  const colonne = 74
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  const nom = doc.splitTextToSize(t(etablissement.nom), colonne)
  doc.text(nom, MARGE, y + 4)
  let yg = y + 4 + nom.length * 4.6
  doc.setFont("helvetica", "normal"); doc.setFontSize(8)
  const coord = doc.splitTextToSize(t([etablissement.adresse, etablissement.ville, etablissement.telephone, siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")), colonne)
  if (coord.length) { doc.text(coord, MARGE, yg); yg += coord.length * 3.6 }
  if (etablissement.devise) { doc.setFont("helvetica", "italic"); doc.text(doc.splitTextToSize(t(etablissement.devise), colonne), MARGE, yg); yg += 3.6 }
  let hauteurLogo = 0
  if (logo) {
    const max = 24, k = Math.min(max / logo.largeur, max / logo.hauteur)
    const l = logo.largeur * k, h = logo.hauteur * k
    doc.addImage(logo.donnees, logo.format, LARGEUR / 2 - l / 2, y, l, h, undefined, "FAST")
    hauteurLogo = h
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  doc.text(t(`Année scolaire ${exercice.libelle}`), LARGEUR - MARGE, y + 8, { align: "right" })
  doc.setFont("helvetica", "bold"); doc.setFontSize(10)
  doc.text(t(`Bulletin — ${periode.libelle}`), LARGEUR - MARGE, y + 13, { align: "right" })
  y = Math.max(yg, y + hauteurLogo, y + 16) + 2
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.6); doc.line(MARGE, y, LARGEUR - MARGE, y)
  y += 4

  // --- Identité de l'élève
  const e = r.eleve, hId = 26
  cadre(doc, MARGE, y, UTILE, hId)
  const ph = { x: MARGE + 2.5, y: y + 2, l: 17.6, h: 22 }
  if (photo) {
    const k = Math.max(ph.l / photo.largeur, ph.h / photo.hauteur)        // recadrage « cover » comme à l'écran
    doc.saveGraphicsState()
    doc.rect(ph.x, ph.y, ph.l, ph.h, null); doc.clip(); doc.discardPath()
    doc.addImage(photo.donnees, photo.format, ph.x + (ph.l - photo.largeur * k) / 2, ph.y + (ph.h - photo.hauteur * k) / 2, photo.largeur * k, photo.hauteur * k, undefined, "FAST")
    doc.restoreGraphicsState()
  } else {
    doc.setFillColor(...FOND); doc.setDrawColor(...BORDURE); doc.setLineDashPattern([0.8, 0.8], 0)
    doc.rect(ph.x, ph.y, ph.l, ph.h, "FD"); doc.setLineDashPattern([], 0)
  }
  const xg = MARGE + 26, xd = MARGE + 26 + (UTILE - 26) / 2
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(10)
  doc.text(t(nomComplet(e)), xg, y + 9)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  doc.text(t(`Né(e) le ${date(e.date_naissance)}${e.lieu_naissance ? ` à ${e.lieu_naissance}` : ""}`), xg, y + 15)
  doc.text(t(`Matricule : ${e.matricule}`), xd, y + 9)
  doc.text(t(`Classe : ${classe.libelle} · Effectif : ${stats.effectif}`), xd, y + 15)
  y += hId + 3

  // --- Tableau des matières (sous-totaux par groupe s'il y en a plusieurs)
  const corps = []
  for (const g of r.groupes) {
    for (const l of g.lignes) corps.push([t(l.matiere), t(l.enseignant), t(note(l.note)), String(l.coefficient), t(note(l.points)), rang(l.rang, l.exAequo), t(appreciation(l.note))])
    if (r.groupes.length > 1) corps.push([{ content: `Groupe ${g.groupe}`, colSpan: 3, styles: { fontStyle: "bold" } }, String(g.totalCoef), t(note(g.totalPoints)),
      { content: t(`Moyenne : ${note(g.moyenne) || "—"}`), colSpan: 2 }].map((c) => (typeof c === "string" ? { content: c, styles: { fillColor: FOND } } : { ...c, styles: { ...c.styles, fillColor: FOND } })))
  }
  autoTable(doc, {
    startY: y, margin: { left: MARGE, right: MARGE }, theme: "grid",
    head: [["Matière", "Enseignant", "Note", "Coef.", "Points", "Rang", "Appréciation"]],
    body: corps,
    foot: [[{ content: "Total", colSpan: 3 }, String(r.totalCoef), t(note(r.totalPoints)), { content: "", colSpan: 2 }]],
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 1.3, bottom: 1.3, left: 1.8, right: 1.8 }, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold" },
    footStyles: { fillColor: [255, 255, 255], textColor: NOIR, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 40, fontSize: 7.5 }, 2: { halign: "right", cellWidth: 15 }, 3: { halign: "right", cellWidth: 13 },
                    4: { halign: "right", cellWidth: 17 }, 5: { halign: "right", cellWidth: 16 }, 6: { cellWidth: "auto" } },
    didParseCell: (c) => { if (c.section !== "body" && c.column.index >= 2 && c.column.index <= 5) c.cell.styles.halign = "right" },
  })
  y = doc.lastAutoTable.finalY + 3

  // --- Conduite
  if (conduite) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
    const texte = t(`Conduite : absences non justifiées ${conduite.nj} h, justifiées ${conduite.j} h · retards ${conduite.retards}` +
      `${conduite.incidents.length ? ` · sanctions : ${conduite.incidents.join(", ")}` : ""} · note de discipline ${note(conduite.note)} (${conduite.appreciation})`)
    const lignes = doc.splitTextToSize(texte, UTILE - 5)
    const h = lignes.length * 3.8 + 3.5
    cadre(doc, MARGE, y, UTILE, h); doc.text(lignes, MARGE + 2.5, y + 4.6)
    y += h + 3
  }

  // --- Synthèse : résultats de l'élève, de la classe, visa du chef d'établissement
  const l3 = (UTILE - 4) / 3, h3 = 24
  const moy = r.moyenne !== null ? note(r.moyenne) : r.moyenneNonClassee !== null ? `${note(r.moyenneNonClassee)} (NC)` : "NC"
  ;[0, 1, 2].forEach((k) => cadre(doc, MARGE + k * (l3 + 2), y, l3, h3))
  const x1 = MARGE + 2.5, x2 = MARGE + l3 + 4.5, x3 = MARGE + 2 * (l3 + 2) + 2.5
  const libelle = (lib, valeur, yy, taille = 8.5) => {          // « Libellé : » puis la valeur en gras, juste après
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.text(lib, x1, yy)
    const x = x1 + doc.getTextWidth(lib) + 1.2
    doc.setFont("helvetica", "bold"); doc.setFontSize(taille); doc.text(valeur, x, yy)
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal")
  }
  libelle("Moyenne :", t(moy), y + 5.5, 11)
  libelle("Rang :", r.rang ? t(rang(r.rang, r.exAequo, stats.classes)) : "non classé", y + 11)
  libelle("Appréciation :", t(r.appreciation || "—"), y + 16.5)
  doc.text(t(`Moyenne de la classe : ${note(stats.moyenneClasse) || "—"}`), x2, y + 5.5)
  doc.text(doc.splitTextToSize(t(`Plus forte : ${note(stats.max) || "—"} · Plus faible : ${note(stats.min) || "—"}`), l3 - 5), x2, y + 11)
  doc.text(t(`Taux de réussite : ${stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`}`), x2, y + 18.5)
  doc.text("Le chef d'établissement", x3, y + 5.5)
  doc.setTextColor(...GRIS); doc.text(t(etablissement.nom_chef || ""), x3, y + 10.5); doc.setTextColor(...NOIR)
}

/**
 * Crée le PDF des bulletins et le télécharge.
 * contexte : { etablissement, logoUrl, exercice, periode, classe, stats, eleves: [{ r, photoUrl, conduite }] }, nomFichier sans extension.
 */
export async function telechargerBulletinsPdf(contexte, nomFichier) {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const autoTable = module.autoTable || module.default
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: nomFichier, subject: `Bulletins ${contexte.classe.libelle} — ${contexte.periode.libelle}`, author: contexte.etablissement.nom, creator: "NexIA School" })
  const [logo, ...photos] = await Promise.all([image(contexte.logoUrl), ...contexte.eleves.map((x) => image(x.photoUrl))])
  contexte.eleves.forEach((x, k) => {
    if (k) doc.addPage()
    bulletin(doc, autoTable, { ...contexte, logo, r: x.r, photo: photos[k], conduite: x.conduite })
  })
  doc.save(`${nomFichier}.pdf`)
}

/** « Bulletins 6e A Séquence 1 » -> « bulletins-6e-a-sequence-1 » */
export const nomDeFichier = (...parties) => parties.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120)
