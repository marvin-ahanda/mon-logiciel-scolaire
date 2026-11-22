// Bulletins au format PDF (A4, texte vectoriel net, sans en-tête ni pied de page ajoutés par le navigateur).
// La bibliothèque jsPDF n'est chargée qu'au moment de l'export, pour ne pas alourdir l'application.
import { appreciation, competence } from "./calculs.js"
import { matriceQr, sitePlateforme, urlVerification } from "./bulletinVerif.js"
import { date, nomComplet, note } from "./format.js"
import { siteAffiche } from "./logo.js"
import { lignesEntete } from "./enteteBulletin.js"
import { t } from "../i18n.jsx"

const MARGE = 12, LARGEUR = 210, HAUTEUR = 297, UTILE = LARGEUR - 2 * MARGE, ECHELLE_MIN = 0.55
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

/** En-tête officiel : lignes à gauche (langue principale) et à droite (traduction), logo au centre légèrement abaissé,
 *  puis nom, devise, spécialisation et coordonnées de l'établissement. Renvoie l'ordonnée sous l'en-tête. */
function entete(doc, { etablissement, logo }, y, k) {
  const { gauche, droite, centre } = lignesEntete(etablissement)
  const col = 64, cx = [MARGE + col / 2, LARGEUR - MARGE - col / 2]
  const colonne = (lignes, x) => {
    let yy = y + 3.2 * k
    for (const l of lignes) {
      doc.setFont("helvetica", l.devise ? "italic" : "bold"); doc.setFontSize((l.devise ? 7 : 7.2) * k)
      const t_ = doc.splitTextToSize(pdf(l.texte), col)
      doc.text(t_, x, yy, { align: "center" }); yy += t_.length * 3.2 * k
    }
    return yy
  }
  doc.setTextColor(...NOIR)
  const bas = Math.max(colonne(gauche, cx[0]), colonne(droite, cx[1]))
  let basLogo = y
  if (logo) {
    const max = 22 * k, f = Math.min(max / logo.largeur, max / logo.hauteur), l = logo.largeur * f, h = logo.hauteur * f
    doc.addImage(logo.donnees, logo.format, LARGEUR / 2 - l / 2, y + 2.5 * k, l, h, "logo-etablissement", "FAST")
    basLogo = y + 2.5 * k + h
  }
  let yy = Math.max(bas, basLogo) + 3.6 * k
  const ligne = (texte, style, taille, couleur = NOIR) => {
    if (!texte) return
    doc.setFont("helvetica", style); doc.setFontSize(taille * k); doc.setTextColor(...couleur)
    const t_ = doc.splitTextToSize(pdf(texte), UTILE * 0.85)
    doc.text(t_, LARGEUR / 2, yy, { align: "center" }); yy += t_.length * taille * 0.42 * k
  }
  ligne(centre.nom.toUpperCase(), "bold", 11)
  ligne(centre.devise, "italic", 8.3)
  ligne(centre.specialisation, "italic", 8.3)
  ligne([etablissement.adresse, etablissement.ville, etablissement.telephone && `${t("Tél.")} ${etablissement.telephone}`, siteAffiche(etablissement.site_web)]
    .filter(Boolean).join(" · "), "normal", 7, GRIS)
  doc.setTextColor(...NOIR)
  return yy - 1.2 * k
}

/** Dessine un bulletin à l'échelle k (1 = taille normale) ; renvoie l'ordonnée la plus basse utilisée. */
function bulletin(doc, autoTable, { etablissement, logo, filigrane, exercice, periode, classe, stats, entetes, r, photo, conduite, decision, code }, k = 1) {
  const S = { ...STYLES, fontSize: 8 * k, cellPadding: { top: 1.1 * k, bottom: 1.1 * k, left: 1.5, right: 1.5 } }
  const tab = (y, o) => tableau(doc, autoTable, y, { ...o, styles: { ...S, ...(o.styles || {}) } })
  let y = MARGE - 2 * (1 - k)
  y = entete(doc, { etablissement, logo }, y, k) + 1.2 * k
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.5); doc.line(MARGE, y, LARGEUR - MARGE, y)
  doc.setFont("helvetica", "normal"); doc.setFontSize(12 * k)
  doc.text(pdf(t(TITRES[periode.type])), LARGEUR / 2, y + 5.5 * k, { align: "center", charSpace: 0.3 })
  doc.setFontSize(8.5 * k)
  const annee = pdf(`${t("Année scolaire ")}${exercice.libelle} · ${periode.libelle}`)
  doc.text(annee, LARGEUR / 2, y + 9.6 * k, { align: "center" })
  y += 11.8 * k
  const yContenu = y

  // --- Identité de l'élève (photo à gauche) et professeur principal
  const e = r.eleve, pp = classe.professeur_principal || ""
  const corpsId = [
    [{ content: "", rowSpan: pp ? 3 : 2, photo: true, styles: { cellWidth: 20, minCellHeight: 23 * k } }, lv(t("Nom et prénom : "), nomComplet(e)), lv(t("Matricule : "), e.matricule || "—"), pdf(t("Sexe : ") + (e.sexe || "—"))],
    [pdf(t("Né(e) le : ") + (date(e.date_naissance) || "—") + (e.lieu_naissance ? t(" à {v0}", { v0: e.lieu_naissance }) : "")), lv(t("Classe : "), classe.libelle), pdf(t("Effectif : ") + stats.effectif)],
  ]
  if (pp) corpsId.push([lv(t("Professeur principal : "), pp, "", { colSpan: 3 })])
  y = tab(y, {
    body: corpsId,
    styles: { fontSize: 8.5 * k, valign: "middle" },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 74 }, 2: { cellWidth: 56 } },
    didDrawCell: (c) => {
      if (!c.cell.raw?.photo) return
      const ph = { x: c.cell.x + 1.2, y: c.cell.y + 1.2, l: c.cell.width - 2.4, h: c.cell.height - 2.4 }
      if (photo) {
        const f = Math.max(ph.l / photo.largeur, ph.h / photo.hauteur)
        doc.saveGraphicsState(); doc.rect(ph.x, ph.y, ph.l, ph.h, null); doc.clip(); doc.discardPath()
        doc.addImage(photo.donnees, photo.format, ph.x + (ph.l - photo.largeur * f) / 2, ph.y + (ph.h - photo.hauteur * f) / 2, photo.largeur * f, photo.hauteur * f, undefined, "FAST")
        doc.restoreGraphicsState()
      } else {
        doc.setFillColor(...FOND); doc.setDrawColor(...BORDURE); doc.setLineDashPattern([0.8, 0.8], 0)
        doc.rect(ph.x, ph.y, ph.l, ph.h, "FD"); doc.setLineDashPattern([], 0)
      }
    },
  })

  // --- Site de la plateforme, en petit, juste avant le tableau des notes
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5 * k); doc.setTextColor(...GRIS)
  doc.text(pdf(t("Bulletin généré par NexIA School · {v0}", { v0: sitePlateforme() })), LARGEUR - MARGE, y + 3 * k, { align: "right" })
  doc.setTextColor(...NOIR)
  y += 4.2 * k

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
  for (let j = 0; j < nd; j++) colonnes[1 + j] = { cellWidth: larg.details, halign: "right" }
  Object.assign(colonnes, { [nd + 1]: { cellWidth: larg.note, halign: "right" }, [nd + 2]: { cellWidth: larg.coef, halign: "right" }, [nd + 3]: { cellWidth: larg.points, halign: "right" },
    [nd + 4]: { cellWidth: larg.rang, halign: "right" }, [nd + 5]: { cellWidth: larg.appreciation }, [nd + 6]: { cellWidth: "auto" } })
  y = tab(y, {
    head: [[t("Matière et enseignant"), ...entetes, t(COLONNE_NOTE[periode.type]), t("Coef."), t("Note × coef."), t("Rang"), t("Appréciation"), t("Compétence")].map(pdf)],
    body: corps, columnStyles: colonnes, styles: { valign: "middle" },
    headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "middle", fontSize: 8 * k },
    didDrawCell: (c) => {
      const m = c.cell.raw?.matiere
      if (!m || c.section !== "body") return
      const x = c.cell.x + c.cell.padding("left"), largeur = c.cell.width - c.cell.padding("left") - c.cell.padding("right")
      let yy = c.cell.y + c.cell.padding("top")
      doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal"); doc.setFontSize(8 * k)
      const lm = doc.splitTextToSize(m[0], largeur); doc.text(lm, x, yy, { baseline: "top" }); yy += lm.length * 3.25 * k
      if (m[1]) { doc.setFont("helvetica", "italic"); doc.setFontSize(7 * k); doc.setTextColor(73, 80, 87); doc.text(doc.splitTextToSize(m[1], largeur), x, yy + 0.2, { baseline: "top" }) }
      doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal")
    },
  }) + 2 * k

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
    { content: pdf(t("Moyennes trimestrielles : ") + (r.moyennesTrimestres || []).map((m, j) => `T${j + 1} : ${m === null ? "—" : note(m)}`).join(" · ")), colSpan: 2 },
    lv(decision?.validee ? t("Décision : ") : t("Décision proposée : "), decision ? t(decision.libelle) : "—")])
  else if (periode.type === "trimestre" && decision) synthese.push([lv(t("Décision proposée : "), t(decision.libelle), "", { colSpan: 3 })])
  y = tab(y, { body: synthese, styles: { fontSize: 8.5 * k, valign: "middle" }, columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 62 } } }) + 2 * k

  // --- Discipline
  if (conduite) {
    y = tab(y, {
      head: [[{ content: t("Discipline"), colSpan: 4 }, { content: t("Points perdus"), colSpan: 3 }, { content: t("Note de discipline"), rowSpan: 2 }],
             [t("Abs. non justifiées"), t("Abs. justifiées"), t("Retards"), t("Autres cas"), t("Ponctualité"), t("Assiduité"), t("Autres cas")].map(pdf)],
      body: [[`${conduite.nj} h`, `${conduite.j} h`, String(conduite.retards), pdf(conduite.incidents.join(", ") || "—"),
        perdus(conduite.pointsPonctualite), perdus(conduite.pointsAssiduite), perdus(conduite.pointsAutres),
        lv("", `${note(conduite.note)} / 20`, ` · ${t(conduite.appreciation)}`)]],
      headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "middle", fontSize: 7.5 * k },
      styles: { halign: "center", valign: "middle" },
    }) + 2 * k
  }

  // --- Visas : parent, professeur principal, chef d'établissement (toujours présents)
  y = tab(y, {
    head: [[t("Visa du parent"), t("Professeur principal") + (pp ? `\n${pp}` : ""), t("Le chef d'établissement") + (etablissement.nom_chef ? `\n${etablissement.nom_chef}` : "")].map(pdf)],
    body: [["", "", ""]], styles: { minCellHeight: 17 * k },
    headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold", halign: "center", valign: "top", minCellHeight: 0, fontSize: 8 * k },
    columnStyles: { 0: { cellWidth: UTILE / 3 }, 1: { cellWidth: UTILE / 3 }, 2: { cellWidth: UTILE / 3 } },
  }) + 2 * k

  // --- Logo flouté au centre de la zone du bulletin, en filigrane très pâle (image déjà transparente)
  if (filigrane) {
    const taille = Math.min(125, y - yContenu)
    doc.addImage(filigrane, "PNG", LARGEUR / 2 - taille / 2, (yContenu + y) / 2 - taille / 2, taille, taille, "filigrane-etablissement", "FAST")
  }

  // --- Légende et QR code anti-fraude (coin inférieur droit)
  const tailleQr = 21 * k
  doc.setFont("helvetica", "normal"); doc.setFontSize(7 * k); doc.setTextColor(...GRIS)
  const legende = t("NE : non évalué · NC : non classé.") + (periode.type === "trimestre" ? t(" Note du trimestre = moyenne des notes séquentielles du trimestre.")
    : periode.type === "annee" ? t(" Note annuelle = moyenne des notes trimestrielles.") : "")
  const yQr = Math.max(y, HAUTEUR - MARGE - tailleQr)
  const lignesLegende = doc.splitTextToSize(pdf(legende), UTILE - (code ? tailleQr + 32 : 0))
  doc.text(lignesLegende, MARGE, y + 3 * k)
  let bas = y + 3 * k + lignesLegende.length * 3 * k
  if (code) {
    qr(doc, urlVerification(code), LARGEUR - MARGE - tailleQr, yQr, tailleQr)
    const xt = LARGEUR - MARGE - tailleQr - 2
    doc.text([pdf(t("Bulletin authentique ?")), pdf(t("Scannez pour vérifier."))], xt, yQr + tailleQr - 7.5 * k, { align: "right" })
    doc.setFont("courier", "normal"); doc.setTextColor(...NOIR); doc.text(code, xt, yQr + tailleQr - 0.8, { align: "right" })
    bas = Math.max(bas, yQr + tailleQr)
  }
  doc.setTextColor(...NOIR)
  return bas
}

/** Plus grande échelle (entre ECHELLE_MIN et 1) à laquelle le bulletin tient sur une seule page A4. */
function echelleUnePage(jsPDF, autoTable, donnees, depart = 1) {
  const tient = (k) => {
    const d = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" })
    const bas = bulletin(d, autoTable, donnees, k)
    return d.getNumberOfPages() === 1 && bas <= HAUTEUR - MARGE / 2
  }
  if (tient(1)) return 1
  if (depart < 1 && tient(depart)) {                       // même classe : l'échelle précédente convient souvent
    let haut = 1, bas = depart
    for (let i = 0; i < 4; i++) { const m = (haut + bas) / 2; if (tient(m)) bas = m; else haut = m }
    return bas
  }
  let haut = 1, bas = ECHELLE_MIN
  for (let i = 0; i < 6; i++) { const m = (haut + bas) / 2; if (tient(m)) bas = m; else haut = m }
  return bas
}

/**
 * Crée le PDF des bulletins (une page A4 par élève, au recto) et le télécharge.
 * contexte : { etablissement, logo, filigrane, exercice, periode, classe, stats, entetes, eleves: [{ r, photoUrl, conduite, code }] }, nomFichier sans extension.
 */
export async function creerBulletinsPdf(contexte, nomFichier) {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const autoTable = module.autoTable || module.default
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: nomFichier, subject: t("Bulletins {v0} — {v1}", { v0: contexte.classe.libelle, v1: contexte.periode.libelle }), author: contexte.etablissement.nom, creator: "NexIA School" })
  const photos = await Promise.all(contexte.eleves.map((x) => image(x.photoUrl)))
  let echelle = 1
  contexte.eleves.forEach((x, j) => {
    const donnees = { ...contexte, r: x.r, photo: photos[j], conduite: x.conduite, decision: x.decision, code: x.code }
    echelle = echelleUnePage(jsPDF, autoTable, donnees, echelle)
    if (j) doc.addPage()
    bulletin(doc, autoTable, donnees, echelle)
  })
  return doc
}

export async function telechargerBulletinsPdf(contexte, nomFichier) {
  (await creerBulletinsPdf(contexte, nomFichier)).save(`${nomFichier}.pdf`)
}

/** « Bulletins 6e A Séquence 1 » -> « bulletins-6e-a-sequence-1 » */
export const nomDeFichier = (...parties) => parties.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120)
