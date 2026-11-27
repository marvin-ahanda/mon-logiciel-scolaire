// PDF du pilotage institutionnel : fiche de synthèse statistique (A4 portrait, plusieurs pages, en-têtes de tableau
// répétés), synthèse départementale ou régionale, courrier. Sobres, sans couleur décorative. jsPDF est chargé à la demande.
import { charger, pdf, sortir, fichier, NOIR, GRIS, BORDURE } from "./financePdf.js"
import { INDICATEURS, CHAMPS_LECONS, CHAMPS_HEURES, MENTION_NON_OFFICIELLE, MENTION_FORMULES, periode, tauxLigne } from "./institution.js"
import { locale, t } from "../i18n.jsx"

const M = 14
const nombre = (v) => (v === null || v === undefined ? "—" : v === "na" ? "NA" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v))
const taux = (v) => (v === null || v === undefined ? "—" : `${nombre(v)} %`)
const dateLongue = (d) => (d ? new Date(d).toLocaleDateString(locale(), { day: "2-digit", month: "long", year: "numeric" }) : "—")

/** Bandeau d'identification administrative (sans armoiries ni sceau : aucune présentation comme document officiel). */
function bandeau(doc, lignes, titre) {
  const L = doc.internal.pageSize.getWidth()
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
  let y = M + 2
  for (const l of lignes.filter(Boolean)) { doc.text(pdf(l), M, y); y += 4.2 }
  doc.setFont("helvetica", "bold"); doc.setFontSize(12.5)
  const tt = doc.splitTextToSize(pdf(titre), L - 2 * M)
  doc.text(tt, L / 2, y + 4, { align: "center" })
  y += 4 + tt.length * 5.5
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.4); doc.line(M, y, L - M, y)
  return y + 5
}

function pieds(doc, formulesValidees) {
  const n = doc.getNumberOfPages(), L = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(...GRIS)
    const note = [t(MENTION_NON_OFFICIELLE), formulesValidees ? "" : t(MENTION_FORMULES)].filter(Boolean).join(" ")
    doc.text(doc.splitTextToSize(pdf(note), L - 2 * M - 22), M, H - 9)
    doc.text(`${i} / ${n}`, L - M, H - 9, { align: "right" })
  }
  doc.setTextColor(...NOIR)
}

const STYLE = {
  theme: "grid", margin: { left: M, right: M, top: 16, bottom: 18 }, showHead: "everyPage",
  styles: { font: "helvetica", fontSize: 7.4, cellPadding: 1.2, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2, valign: "middle" },
  headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold", halign: "center" },
  footStyles: { fillColor: [248, 249, 250], textColor: NOIR, fontStyle: "bold" },
}

function sousTitre(doc, texte, y) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...NOIR)
  doc.text(pdf(texte), M, y)
  return y + 3
}

function tableIndicateurs(doc, autoTable, y, indicateurs, avecFiches) {
  autoTable(doc, { ...STYLE, startY: y,
    head: [[t("Indicateur"), t("Réalisé"), t("Prévu / dû"), t("Taux"), avecFiches ? t("Fiches comptées") : t("Lignes comptées"), t("Manquantes")]],
    body: INDICATEURS.map(([k, l]) => {
      const x = indicateurs?.[k] || {}
      return [t(l), nombre(x.num), nombre(x.den), taux(x.taux), nombre(avecFiches ? x.fiches : x.lignes), nombre(avecFiches ? x.fiches_sans_donnee : x.manquantes)]
    }),
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  })
  return doc.lastAutoTable.finalY + 6
}

/**
 * Fiche de synthèse statistique d'un établissement.
 * f : { etablissement, departement, region, exercice, periode, version, publie_le, publie_par } ; d : données ; ind : indicateurs serveur.
 */
export async function fichePdf({ fiche, donnees, indicateurs, version, publieLe, publiePar, typeEtablissement }, { imprimer = false, fenetre = null } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const nomEtab = fiche.etablissement?.nom || ""
  doc.setProperties({ title: `${t("Fiche de synthèse statistique")} ${nomEtab}`, creator: "NexIA School" })
  let y = bandeau(doc, [
    t("Ministère des Enseignements Secondaires (tutelle administrative)"),
    `${t("Délégation régionale : ")}${fiche.region || "—"}`,
    `${t("Délégation départementale : ")}${fiche.departement || "—"}`,
  ], `${t("FICHE DE SYNTHÈSE STATISTIQUE")} — ${periode(fiche.periode).toUpperCase()} ${fiche.exercice}`)

  // Page 1 : identité et synthèse générale
  autoTable(doc, { ...STYLE, startY: y, theme: "plain", showHead: false,
    body: [
      [t("Établissement"), nomEtab], [t("Type"), typeEtablissement || "—"], [t("Année scolaire"), fiche.exercice], [t("Période"), periode(fiche.periode)],
      [t("Version"), version ? String(version) : t("Brouillon (non publié)")], [t("Date de publication"), dateLongue(publieLe)],
      [t("Date de génération"), dateLongue(new Date())], [t("Responsable de la publication"), publiePar || donnees.responsable || "—"],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 } }, styles: { ...STYLE.styles, fontSize: 8.5 } })
  y = sousTitre(doc, t("Synthèse générale"), doc.lastAutoTable.finalY + 6)
  const s = indicateurs?.synthese || {}
  autoTable(doc, { ...STYLE, startY: y + 1,
    head: [[t("Élèves"), t("Enseignants"), t("Classes"), t("Disciplines")]],
    body: [[nombre(s.eleves), nombre(s.enseignants), nombre(s.classes), nombre(s.disciplines)]],
    columnStyles: { 0: { halign: "center" }, 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "center" } } })
  y = sousTitre(doc, t("Taux globaux (pondérés)"), doc.lastAutoTable.finalY + 6)
  y = tableIndicateurs(doc, autoTable, y + 1, indicateurs?.indicateurs, false)
  if ((donnees.periodes_manquantes || []).length) {
    doc.setFontSize(8); doc.setFont("helvetica", "italic")
    doc.text(pdf(t("Bilan annuel : trimestres non publiés, non cumulés : {v0}", { v0: donnees.periodes_manquantes.map(periode).join(", ") })), M, y); y += 5
  }

  // Page 2 : couverture des programmes
  doc.addPage()
  y = sousTitre(doc, t("Couverture des programmes par classe, discipline et enseignant"), M + 4)
  const dig = indicateurs?.inclure_digitalise !== false
  const numT = dig ? ["faites_t", "digit_t"] : ["faites_t"], numP = dig ? ["faites_p", "digit_p"] : ["faites_p"]
  autoTable(doc, { ...STYLE, startY: y + 1,
    head: [[t("Classe"), t("Discipline"), t("Enseignant"), ...CHAMPS_LECONS.map(([, l]) => t(l)), t("% théorie"), t("% pratique")]],
    body: (donnees.lignes || []).map((l) => [l.classe, l.discipline, l.enseignant, ...CHAMPS_LECONS.map(([k]) => nombre(l[k])),
      taux(tauxLigne(l, numT, "prevues_t")), taux(tauxLigne(l, numP, "prevues_p"))].map(pdf)),
    styles: { ...STYLE.styles, fontSize: 6.6 }, columnStyles: Object.fromEntries([...Array(11).keys()].slice(3).map((k) => [k, { halign: "right" }])) })

  // Page 3 : heures, assiduité, observations
  doc.addPage()
  y = sousTitre(doc, t("Heures dues et faites"), M + 4)
  autoTable(doc, { ...STYLE, startY: y + 1,
    head: [[t("Classe"), t("Discipline"), t("Enseignant"), ...CHAMPS_HEURES.map(([, l]) => t(l)), t("% théorie"), t("% pratique")]],
    body: (donnees.lignes || []).map((l) => [l.classe, l.discipline, l.enseignant, ...CHAMPS_HEURES.map(([k]) => nombre(l[k])),
      taux(tauxLigne(l, ["heures_faites_t"], "heures_dues_t")), taux(tauxLigne(l, ["heures_faites_p"], "heures_dues_p"))].map(pdf)),
    styles: { ...STYLE.styles, fontSize: 6.8 }, columnStyles: Object.fromEntries([...Array(9).keys()].slice(3).map((k) => [k, { halign: "right" }])) })
  y = sousTitre(doc, t("Assiduité"), doc.lastAutoTable.finalY + 6)
  const a = donnees.assiduite || {}, ia = indicateurs?.indicateurs || {}
  autoTable(doc, { ...STYLE, startY: y + 1,
    head: [["", t("Heures dues"), t("Heures d'absence"), t("Taux d'assiduité")]],
    body: [[t("Enseignants"), nombre(a.enseignants?.heures_dues), nombre(a.enseignants?.heures_absence), taux(ia.assiduite_enseignants?.taux)],
           [t("Élèves"), nombre(a.eleves?.heures_dues), nombre(a.eleves?.heures_absence), taux(ia.assiduite_eleves?.taux)]],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } } })
  y = sousTitre(doc, t("Observations de la direction"), doc.lastAutoTable.finalY + 6)
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
  doc.text(doc.splitTextToSize(pdf(donnees.observations || "—"), doc.internal.pageSize.getWidth() - 2 * M), M, y + 3)
  pieds(doc, indicateurs?.formules_validees)
  sortir(doc, fichier("fiche statistique", nomEtab, fiche.periode, fiche.exercice), imprimer, fenetre)
}

/** Synthèse départementale ou régionale : consolidation figée, observations, difficultés, recommandations. */
export async function synthesePdf({ fiche, donnees, indicateurs, version, publieLe, publiePar }, { imprimer = false, fenetre = null } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const regional = fiche.niveau === "region"
  let y = bandeau(doc, [t("Ministère des Enseignements Secondaires (tutelle administrative)"), fiche.delegation?.nom],
    `${regional ? t("SYNTHÈSE RÉGIONALE") : t("SYNTHÈSE DÉPARTEMENTALE")} — ${periode(fiche.periode).toUpperCase()} ${fiche.exercice}`)
  autoTable(doc, { ...STYLE, startY: y, theme: "plain", showHead: false,
    body: [[t("Version"), version ? String(version) : t("Brouillon (non publié)")], [t("Date de publication"), dateLongue(publieLe)],
           [t("Date de génération"), dateLongue(new Date())], [t("Responsable de la publication"), publiePar || donnees.responsable || "—"],
           [regional ? t("Synthèses départementales comptées") : t("Fiches d'établissements comptées"), `${nombre(indicateurs?.nb_fiches)} / ${nombre(indicateurs?.attendus)}`],
           [t("Observations comptées"), nombre(indicateurs?.nb_observations)]],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 70 } }, styles: { ...STYLE.styles, fontSize: 8.5 } })
  y = sousTitre(doc, t("Indicateurs consolidés (pondérés)"), doc.lastAutoTable.finalY + 6)
  y = tableIndicateurs(doc, autoTable, y + 1, indicateurs?.indicateurs, true)
  for (const [k, titre] of [["observations", t("Observations")], ["difficultes", t("Difficultés")], ["recommandations", t("Recommandations")]]) {
    y = sousTitre(doc, titre, y + 2)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
    const lignes = doc.splitTextToSize(pdf(donnees[k] || "—"), doc.internal.pageSize.getWidth() - 2 * M)
    if (y + lignes.length * 4 > doc.internal.pageSize.getHeight() - 22) { doc.addPage(); y = M + 4 }
    doc.text(lignes, M, y + 3); y += 5 + lignes.length * 4
  }
  pieds(doc, indicateurs?.formules_validees)
  sortir(doc, fichier(regional ? "synthese regionale" : "synthese departementale", fiche.delegation?.nom || "", fiche.periode, fiche.exercice), imprimer, fenetre)
}

/** Courrier institutionnel (A4) : référence, objet, destinataires, date, corps, date limite, pièces jointes, signataire. */
export async function courrierPdf(c, destinataires = [], { imprimer = false, fenetre = null } = {}) {
  const { jsPDF } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const L = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  let y = bandeau(doc, [t("Ministère des Enseignements Secondaires (tutelle administrative)"), c.expediteur?.nom], c.type_libelle ? t(c.type_libelle).toUpperCase() : t("COURRIER"))
  doc.setFontSize(9); doc.setFont("helvetica", "normal")
  const ligne = (l, v) => { doc.setFont("helvetica", "bold"); doc.text(pdf(l), M, y); doc.setFont("helvetica", "normal"); const x = doc.splitTextToSize(pdf(v), L - 2 * M - 38); doc.text(x, M + 38, y); y += 4.6 * x.length }
  ligne(t("Référence :"), c.reference || t("(attribuée à l'envoi)"))
  ligne(t("Date :"), dateLongue(c.envoye_le || new Date()))
  ligne(t("Objet :"), c.objet)
  if (destinataires.length) ligne(t("Destinataires :"), destinataires.join(", "))
  if (c.date_limite) ligne(t("Réponse attendue avant le :"), dateLongue(c.date_limite))
  y += 4
  doc.setFontSize(10)
  for (const par of String(c.corps || "").split("\n")) {
    const x = doc.splitTextToSize(pdf(par), L - 2 * M)
    if (y + x.length * 4.8 > H - 30) { doc.addPage(); y = M + 4 }
    doc.text(x, M, y); y += x.length * 4.8 + 1.5
  }
  y += 8
  doc.setFont("helvetica", "bold"); doc.text(pdf(c.auteur || ""), L - M, y, { align: "right" })
  doc.setFont("helvetica", "normal"); if (c.fonction) doc.text(pdf(c.fonction), L - M, y + 5, { align: "right" })
  if ((c.pieces || []).length) {
    y += 14; doc.setFontSize(8.5)
    doc.text(pdf(`${t("Pièces jointes : ")}${c.pieces.map((p) => p.split("/").pop()).join(", ")}`), M, y)
  }
  pieds(doc, true)
  sortir(doc, fichier("courrier", c.reference || c.objet), imprimer, fenetre)
}
