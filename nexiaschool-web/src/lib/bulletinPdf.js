// Bulletins au format PDF (A4, texte vectoriel net, sans en-tête ni pied de page ajoutés par le navigateur).
// La bibliothèque jsPDF n'est chargée qu'au moment de l'export, pour ne pas alourdir l'application.
import { appreciation, competence } from "./calculs.js"
import { matriceQr, sitePlateforme, urlVerification } from "./bulletinVerif.js"
import { date, nomComplet, note } from "./format.js"
import { siteAffiche } from "./logo.js"
import { t } from "../i18n.jsx"

const MARGE = 12, LARGEUR = 210, UTILE = LARGEUR - 2 * MARGE
const GRIS = [108, 117, 125], NOIR = [33, 37, 41], BORDURE = [173, 181, 189], FOND = [241, 243, 245]

// Les polices standard du PDF ne connaissent pas les espaces fines insécables produites par Intl (fr-FR)
const pdf = (v) => String(v ?? "").replace(/[  ]/g, " ").replace(/ /g, " ")
/** Image distante -> { donnees (data URL), format, largeur, hauteur } ; null si indisponible. */
export async function image(url) {
  if (!url) return null
  // image déjà en mémoire (data URL : copies publiées pour les parents) : lue sans requête réseau
  if (String(url).startsWith("data:")) {
    try {
      const i = await new Promise((ok, ko) => { const x = new Image(); x.onload = () => ok(x); x.onerror = ko; x.src = url })
      return { donnees: url, format: url.startsWith("data:image/png") ? "PNG" : "JPEG", largeur: i.naturalWidth, hauteur: i.naturalHeight }
    } catch { return null }
  }
  try {
    const blob = await (await fetch(url)).blob()
    const donnees = await new Promise((ok, ko) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = ko; l.readAsDataURL(blob) })
    const bmp = await createImageBitmap(blob)
    return { donnees, format: blob.type === "image/png" ? "PNG" : "JPEG", largeur: bmp.width, hauteur: bmp.height }
  } catch { return null }
}

const TITRES = { sequence: "BULLETIN DE NOTES SÉQUENTIEL", trimestre: "BULLETIN DE NOTES TRIMESTRIEL", annee: "BULLETIN DE NOTES ANNUEL" }
const COLONNE_NOTE = { sequence: "Note /20", trimestre: "Note trim.", annee: "Note ann." }
const ENTETE = [233, 236, 239]
const rangTexte = (rg, ex) => (rg ? `${rg}${ex ? t(" ex") : ""}` : "")
const ne = (v) => (v === null || v === undefined ? "NE" : pdf(note(v)))
const perdus = (v) => (v ? `-${pdf(note(v))}` : "0")
// Cellule « Libellé : valeur » (valeur en gras) : le texte est dessiné à la main après le calcul de la hauteur
const lv = (lib, val, extra = "", options = {}) => ({ content: pdf(lib + val + extra), lv: [pdf(lib), pdf(val), pdf(extra)], ...options })

function dessinerLv(doc, c) {
  const [lib, val, extra] = c.cell.raw.lv, x0 = c.cell.x + c.cell.padding("left"), y = c.cell.y + c.cell.height / 2
  doc.setTextColor(...NOIR)
  // texte trop long pour la case (ex. « À l'appréciation du conseil de classe ») : police réduite jusqu'à ce qu'il tienne
  const place = c.cell.width - c.cell.padding("left") - c.cell.padding("right")
  let taille = c.cell.styles.fontSize
  const largeur = () => { doc.setFontSize(taille); doc.setFont("helvetica", "normal"); const l1 = doc.getTextWidth(lib + extra)
    doc.setFont("helvetica", "bold"); return l1 + doc.getTextWidth(val) }
  while (taille > 6 && largeur() > place) taille -= 0.25
  doc.setFontSize(taille)
  doc.setFont("helvetica", "normal"); doc.text(lib, x0, y, { baseline: "middle" })
  let x = x0 + doc.getTextWidth(lib)
  doc.setFont("helvetica", "bold"); doc.text(val, x, y, { baseline: "middle" }); x += doc.getTextWidth(val)
  doc.setFont("helvetica", "normal"); if (extra) doc.text(extra, x, y, { baseline: "middle" })
}

const STYLES = { font: "helvetica", fontSize: 8, cellPadding: { top: 1.1, bottom: 1.1, left: 1.5, right: 1.5 }, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2, fillColor: false }
const tableau = (doc, autoTable, y, options) => {
  autoTable(doc, {
    startY: y, margin: { left: MARGE, right: MARGE }, theme: "grid", styles: STYLES,
    headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "middle" },
    ...options,
    willDrawCell: (c) => { if (c.cell.raw?.lv || c.cell.raw?.matiere) c.cell.text = [] ; options.willDrawCell?.(c) },
    didDrawCell: (c) => { if (c.cell.raw?.lv) dessinerLv(doc, c); options.didDrawCell?.(c) },
  })
  return doc.lastAutoTable.finalY
}

function qr(doc, texte, x, y, taille) {
  const m = matriceQr(texte), n = m.length, k = taille / n
  doc.setFillColor(255, 255, 255); doc.rect(x - 1, y - 1, taille + 2, taille + 2, "F")
  doc.setFillColor(0, 0, 0)
  m.forEach((ligne, l) => ligne.forEach((noir, c) => { if (noir) doc.rect(x + c * k, y + l * k, k + 0.02, k + 0.02, "F") }))
}

function bulletin(doc, autoTable, { etablissement, logo, filigrane, exercice, periode, classe, stats, entetes, r, photo, conduite, decision, code }) {
  let y = MARGE
  // --- En-tête : établissement à gauche, logo au centre, année et période à droite
  const colonne = 76
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5)
  const nom = doc.splitTextToSize(pdf(etablissement.nom), colonne)
  doc.text(nom, MARGE, y + 4)
  let yg = y + 4 + nom.length * 4.4
  doc.setFontSize(8.5)
  if (etablissement.devise) { doc.setFont("helvetica", "italic"); const d = doc.splitTextToSize(pdf(etablissement.devise), colonne); doc.text(d, MARGE, yg); yg += d.length * 3.8 }
  doc.setFont("helvetica", "normal")
  const coord = doc.splitTextToSize(pdf([etablissement.adresse, etablissement.ville, etablissement.telephone && `${t("Tél.")} ${etablissement.telephone}`,
    siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")), colonne)
  if (coord.length) { doc.text(coord, MARGE, yg); yg += coord.length * 3.8 }
  let hauteurLogo = 0
  if (logo) {
    const max = 20, k = Math.min(max / logo.largeur, max / logo.hauteur)
    const l = logo.largeur * k, h = logo.hauteur * k
    doc.addImage(logo.donnees, logo.format, LARGEUR / 2 - l / 2, y, l, h, "logo-etablissement", "FAST")
    hauteurLogo = h
  }
  doc.setFontSize(9); doc.setFont("helvetica", "normal")
  const annee = pdf(t("Année scolaire ")), xa = LARGEUR - MARGE - doc.getTextWidth(pdf(exercice.libelle)) - 0.3
  doc.setFont("helvetica", "bold"); doc.text(pdf(exercice.libelle), LARGEUR - MARGE, y + 4, { align: "right" })
  doc.setFont("helvetica", "normal"); doc.text(annee, xa, y + 4, { align: "right" })
  doc.text(pdf(periode.libelle), LARGEUR - MARGE, y + 8.5, { align: "right" })
  y = Math.max(yg, y + hauteurLogo, y + 12) + 1.5
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.5); doc.line(MARGE, y, LARGEUR - MARGE, y)
  doc.setFont("helvetica", "normal"); doc.setFontSize(12)
  doc.text(pdf(t(TITRES[periode.type])), LARGEUR / 2, y + 6, { align: "center", charSpace: 0.3 })
  y += 9
  const yContenu = y

  // --- Identité de l'élève (photo à gauche)
  const e = r.eleve
  y = tableau(doc, autoTable, y, {
    body: [
      [{ content: "", rowSpan: 2, photo: true, styles: { cellWidth: 20, minCellHeight: 23 } }, lv(t("Nom et prénom : "), nomComplet(e)), lv(t("Matricule : "), e.matricule || "—"), pdf(t("Sexe : ") + (e.sexe || "—"))],
      [pdf(t("Né(e) le : ") + (date(e.date_naissance) || "—") + (e.lieu_naissance ? t(" à {v0}", { v0: e.lieu_naissance }) : "")), lv(t("Classe : "), classe.libelle), pdf(t("Effectif : ") + stats.effectif)],
    ],
    styles: { ...STYLES, fontSize: 8.5, valign: "middle" },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 74 }, 2: { cellWidth: 56 } },
    didDrawCell: (c) => {
      if (!c.cell.raw?.photo) return
      const ph = { x: c.cell.x + 1.2, y: c.cell.y + 1.2, l: c.cell.width - 2.4, h: c.cell.height - 2.4 }
      if (photo) {
        const k = Math.max(ph.l / photo.largeur, ph.h / photo.hauteur)
        doc.saveGraphicsState(); doc.rect(ph.x, ph.y, ph.l, ph.h, null); doc.clip(); doc.discardPath()
        doc.addImage(photo.donnees, photo.format, ph.x + (ph.l - photo.largeur * k) / 2, ph.y + (ph.h - photo.hauteur * k) / 2, photo.largeur * k, photo.hauteur * k, undefined, "FAST")
        doc.restoreGraphicsState()
      } else {
        doc.setFillColor(...FOND); doc.setDrawColor(...BORDURE); doc.setLineDashPattern([0.8, 0.8], 0)
        doc.rect(ph.x, ph.y, ph.l, ph.h, "FD"); doc.setLineDashPattern([], 0)
      }
    },
  })

  // --- Site de la plateforme, en petit, juste avant le tableau des notes
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...GRIS)
  doc.text(pdf(t("Bulletin généré par NexIA School · {v0}", { v0: sitePlateforme() })), LARGEUR - MARGE, y + 3, { align: "right" })
  doc.setTextColor(...NOIR)
  y += 4.2

  // --- Matières et notes
  const nd = entetes.length
  const corps = []
  const gris = (c) => ({ ...(typeof c === "object" ? c : { content: c }), styles: { fillColor: FOND, ...(c.styles || {}) } })
  for (const g of r.groupes) {
    for (const l of g.lignes) corps.push([
      { content: pdf(l.matiere + (l.enseignant ? `\n${l.enseignant}` : "")), matiere: [pdf(l.matiere), pdf(l.enseignant)] },
      ...l.details.map((d) => (d === null ? "—" : pdf(note(d)))), { content: ne(l.note), styles: { fontStyle: "bold" } }, String(l.coefficient), pdf(note(l.points)),
      rangTexte(l.rang, l.exAequo), pdf(t(appreciation(l.note))), pdf(t(competence(l.note)))])
    if (r.groupes.length > 1) corps.push([gris({ content: pdf(t("Groupe {v0}", { v0: g.groupe })), colSpan: nd + 2, styles: { fontStyle: "bold" } }),
      gris({ content: String(g.totalCoef), styles: { halign: "right" } }), gris({ content: pdf(note(g.totalPoints)), styles: { halign: "right" } }),
      gris(lv(t("Moyenne du groupe : "), note(g.moyenne) || "—", "", { colSpan: 3 }))])
  }
  corps.push([gris({ content: t("TOTAL"), colSpan: nd + 2, styles: { fontStyle: "bold" } }), gris({ content: String(r.totalCoef), styles: { halign: "right", fontStyle: "bold" } }),
    gris({ content: pdf(note(r.totalPoints)), styles: { halign: "right", fontStyle: "bold" } }), gris({ content: "", colSpan: 3 })])
  const larg = { details: 11.5, note: 12.5, coef: 11, points: 14, rang: 10, appreciation: 21 }
  const colonnes = { 0: { cellWidth: nd ? 38 : 50 } }
  for (let k = 0; k < nd; k++) colonnes[1 + k] = { cellWidth: larg.details, halign: "right" }
  Object.assign(colonnes, { [nd + 1]: { cellWidth: larg.note, halign: "right" }, [nd + 2]: { cellWidth: larg.coef, halign: "right" }, [nd + 3]: { cellWidth: larg.points, halign: "right" },
    [nd + 4]: { cellWidth: larg.rang, halign: "right" }, [nd + 5]: { cellWidth: larg.appreciation }, [nd + 6]: { cellWidth: "auto" } })
  y = tableau(doc, autoTable, y, {
    head: [[t("Matière et enseignant"), ...entetes, t(COLONNE_NOTE[periode.type]), t("Coef."), t("Note × coef."), t("Rang"), t("Appréciation"), t("Compétence")].map(pdf)],
    body: corps, columnStyles: colonnes, styles: { ...STYLES, valign: "middle" },
    didDrawCell: (c) => {
      const m = c.cell.raw?.matiere
      if (!m || c.section !== "body") return
      const x = c.cell.x + c.cell.padding("left"), largeur = c.cell.width - c.cell.padding("left") - c.cell.padding("right")
      let yy = c.cell.y + c.cell.padding("top")
      doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal"); doc.setFontSize(8)
      const lm = doc.splitTextToSize(m[0], largeur); doc.text(lm, x, yy, { baseline: "top" }); yy += lm.length * 3.25
      if (m[1]) { doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(73, 80, 87); doc.text(doc.splitTextToSize(m[1], largeur), x, yy + 0.2, { baseline: "top" }) }
      doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal")
    },
  }) + 2

  // --- Synthèse
  const moy = r.moyenne !== null ? note(r.moyenne) : r.moyenneNonClassee !== null ? note(r.moyenneNonClassee) : null
  const synthese = [
    [lv(t("Moyenne : "), moy === null ? "NC" : `${moy} / 20`, r.moyenne === null && moy !== null ? " (NC)" : ""),
     r.rang ? lv(t("Rang : "), rangTexte(r.rang, r.exAequo), ` / ${stats.classes}`) : lv(t("Rang : "), t("non classé")),
     lv(t("Appréciation : "), t(r.appreciation || "—"))],
    [pdf(t("Moyenne de la classe : ") + (note(stats.moyenneClasse) || "—")),
     pdf(t("Plus forte : ") + (note(stats.max) || "—") + t(" · plus faible : ") + (note(stats.min) || "—")),
     pdf(t("Taux de réussite : ") + (stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`))],
  ]
  if (periode.type === "annee") synthese.push([
    { content: pdf(t("Moyennes trimestrielles : ") + (r.moyennesTrimestres || []).map((m, k) => `T${k + 1} : ${m === null ? "—" : note(m)}`).join(" · ")), colSpan: 2 },
    lv(t("Décision proposée : "), decision ? t(decision.libelle) : "—")])
  else if (periode.type === "trimestre" && decision) synthese.push([lv(t("Décision proposée : "), t(decision.libelle), "", { colSpan: 3 })])
  y = tableau(doc, autoTable, y, { body: synthese, styles: { ...STYLES, fontSize: 8.5, valign: "middle" }, columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 62 } } }) + 2

  // --- Discipline
  if (conduite) {
    y = tableau(doc, autoTable, y, {
      head: [[{ content: t("Discipline"), colSpan: 4 }, { content: t("Points perdus"), colSpan: 3 }, { content: t("Note de discipline"), rowSpan: 2 }],
             [t("Abs. non justifiées"), t("Abs. justifiées"), t("Retards"), t("Autres cas"), t("Ponctualité"), t("Assiduité"), t("Autres cas")].map(pdf)],
      body: [[`${conduite.nj} h`, `${conduite.j} h`, String(conduite.retards), pdf(conduite.incidents.join(", ") || "—"),
        perdus(conduite.pointsPonctualite), perdus(conduite.pointsAssiduite), perdus(conduite.pointsAutres),
        lv("", `${note(conduite.note)} / 20`, ` · ${t(conduite.appreciation)}`)]],
      headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "middle", fontSize: 7.5 },
      styles: { ...STYLES, halign: "center", valign: "middle" },
    }) + 2
  }

  // --- Visas : parent, professeur principal, chef d'établissement (toujours présents)
  y = tableau(doc, autoTable, y, {
    head: [[t("Visa du parent"), t("Professeur principal"), t("Le chef d'établissement") + (etablissement.nom_chef ? `\n${etablissement.nom_chef}` : "")].map(pdf)],
    body: [["", "", ""]], styles: { ...STYLES, minCellHeight: 19 },
    headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "top", minCellHeight: 0 },
    columnStyles: { 0: { cellWidth: UTILE / 3 }, 1: { cellWidth: UTILE / 3 }, 2: { cellWidth: UTILE / 3 } },
  }) + 2

  // --- Logo flouté au centre de la zone du bulletin, en filigrane très pâle (image déjà transparente)
  if (filigrane) {
    const taille = Math.min(125, y - yContenu)
    doc.addImage(filigrane, "PNG", LARGEUR / 2 - taille / 2, (yContenu + y) / 2 - taille / 2, taille, taille, "filigrane-etablissement", "FAST")
  }

  // --- Légende et QR code anti-fraude (coin inférieur droit)
  const tailleQr = 21
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRIS)
  const legende = t("NE : non évalué · NC : non classé.") + (periode.type === "trimestre" ? t(" Note du trimestre = moyenne des notes séquentielles du trimestre.")
    : periode.type === "annee" ? t(" Note annuelle = moyenne des notes trimestrielles.") : "")
  const yQr = Math.max(y, 297 - MARGE - tailleQr)
  doc.text(doc.splitTextToSize(pdf(legende), UTILE - (code ? tailleQr + 32 : 0)), MARGE, y + 3)
  if (code) {
    qr(doc, urlVerification(code), LARGEUR - MARGE - tailleQr, yQr, tailleQr)
    const xt = LARGEUR - MARGE - tailleQr - 2
    doc.text([pdf(t("Bulletin authentique ?")), pdf(t("Scannez pour vérifier."))], xt, yQr + tailleQr - 7.5, { align: "right" })
    doc.setFont("courier", "normal"); doc.setTextColor(...NOIR); doc.text(code, xt, yQr + tailleQr - 0.8, { align: "right" })
  }
  doc.setTextColor(...NOIR)

}

/**
 * Crée le PDF des bulletins et le télécharge.
 * contexte : { etablissement, logo, filigrane, exercice, periode, classe, stats, entetes, eleves: [{ r, photoUrl, conduite, code }] }, nomFichier sans extension.
 */
export async function telechargerBulletinsPdf(contexte, nomFichier) {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const autoTable = module.autoTable || module.default
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: nomFichier, subject: t("Bulletins {v0} — {v1}", { v0: contexte.classe.libelle, v1: contexte.periode.libelle }), author: contexte.etablissement.nom, creator: "NexIA School" })
  const photos = await Promise.all(contexte.eleves.map((x) => image(x.photoUrl)))
  contexte.eleves.forEach((x, k) => {
    if (k) doc.addPage()
    bulletin(doc, autoTable, { ...contexte, r: x.r, photo: photos[k], conduite: x.conduite, decision: x.decision, code: x.code })
  })
  doc.save(`${nomFichier}.pdf`)
}

/** « Bulletins 6e A Séquence 1 » -> « bulletins-6e-a-sequence-1 » */
export const nomDeFichier = (...parties) => parties.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120)
