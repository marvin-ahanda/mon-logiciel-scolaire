// PDF des PV (jsPDF chargé à la demande) : en-tête de l'établissement, numéro unique, date de génération, tableaux,
// graphiques (barres, courbes), synthèse, commentaire, emplacements de signature et cachet, pied de page numéroté.
import { siteAffiche } from "../logo.js"
import { note, pourcentage, date as dateCourte, dateHeure } from "../format.js"
import { t } from "../../i18n.jsx"
import { syntheseClasse, syntheseGroupe, syntheseIndividuelle, texteRecommandation } from "./textes.js"

const NOIR = [33, 37, 41], GRIS = [108, 117, 125], BORDURE = [206, 212, 218], BLEU = [31, 58, 104], VERT = [25, 135, 84], ROUGE = [192, 57, 43], OR = [184, 134, 11]
const M = 12
const pdf = (v) => String(v ?? "").replace(/[   ]/g, " ")
const nom = (e) => [e?.nom?.toUpperCase(), e?.prenom].filter(Boolean).join(" ")
const n2 = (v) => (v === null || v === undefined ? "—" : note(v))
const pc = (v) => pdf(pourcentage(v))

async function charger() {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  return { jsPDF, autoTable: module.autoTable || module.default }
}

function nouveau(jsPDF, { orientation = "portrait", titre, etablissement }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true })
  doc.setProperties({ title: pdf(titre), author: pdf(etablissement?.nom), creator: "NexIA School" })
  return doc
}

/** En-tête : établissement, logo, titre, période, numéro du document et date. Renvoie l'ordonnée suivante. */
function entete(doc, { etablissement = {}, logo, titre, sousTitre, reference, genereLe }) {
  const L = doc.internal.pageSize.getWidth()
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  doc.text(doc.splitTextToSize(pdf(etablissement.nom), L / 2 - 28), M, M + 4)
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5)
  doc.text(doc.splitTextToSize(pdf([etablissement.adresse, etablissement.ville, etablissement.telephone, siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")), L / 2 - 28), M, M + 9)
  if (logo) {
    const k = Math.min(18 / logo.largeur, 18 / logo.hauteur)
    doc.addImage(logo.donnees, logo.format, L / 2 - (logo.largeur * k) / 2, M - 2, logo.largeur * k, logo.hauteur * k, undefined, "FAST")
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BLEU)
  doc.text(doc.splitTextToSize(pdf(titre), L / 2 - 26), L - M, M + 4, { align: "right" })
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS)
  const lignes = [sousTitre, reference && t("N° {v0}", { v0: reference }), genereLe && t("Généré le {v0}", { v0: dateHeure(genereLe) })].filter(Boolean)
  doc.text(lignes.map(pdf), L - M, M + 9.5, { align: "right" })
  doc.setTextColor(...NOIR)
  const y = M + 22
  doc.setDrawColor(...BLEU); doc.setLineWidth(0.6); doc.line(M, y, L - M, y)
  return y + 4
}

/** Pied de page sur toutes les pages : numéro du document et pagination. */
function pieds(doc, reference) {
  const n = doc.getNumberOfPages(), L = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  for (let k = 1; k <= n; k++) {
    doc.setPage(k); doc.setFontSize(7); doc.setTextColor(...GRIS)
    if (reference) doc.text(pdf(t("Document n° {v0} · NexIA School", { v0: reference })), M, H - 6)
    doc.text(pdf(t("Page {v0} / {v1}", { v0: k, v1: n })), L - M, H - 6, { align: "right" })
  }
  doc.setTextColor(...NOIR)
}

/** Passe à une nouvelle page si la hauteur demandée ne tient pas. */
function place(doc, y, hauteur) {
  if (y + hauteur > doc.internal.pageSize.getHeight() - 14) { doc.addPage(); return M + 4 }
  return y
}

function titreSection(doc, y, texte) {
  y = place(doc, y, 12)
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...BLEU)
  doc.text(pdf(texte), M, y + 4); doc.setTextColor(...NOIR); doc.setFont("helvetica", "normal")
  return y + 7
}

function paragraphes(doc, y, lignes, { taille = 8.5, puce = "• " } = {}) {
  const L = doc.internal.pageSize.getWidth()
  doc.setFontSize(taille)
  for (const l of lignes) {
    const morceaux = doc.splitTextToSize(pdf(`${puce}${l}`), L - 2 * M)
    y = place(doc, y, morceaux.length * 4)
    doc.text(morceaux, M, y + 3); y += morceaux.length * 4
  }
  return y + 2
}

function tableau(doc, autoTable, y, { entetes, lignes, taille = 7.5, colonnes = {}, couleurs = null }) {
  autoTable(doc, {
    startY: y, head: [entetes.map(pdf)], body: lignes.map((l) => l.map((v) => pdf(v))), theme: "grid", margin: { left: M, right: M, bottom: 14 },
    styles: { fontSize: taille, cellPadding: 1.2, lineColor: BORDURE, lineWidth: 0.1, textColor: NOIR, overflow: "linebreak" },
    headStyles: { fillColor: BLEU, textColor: 255, fontStyle: "bold", halign: "center" }, columnStyles: colonnes,
    didParseCell: couleurs ? (d) => { if (d.section === "body") { const c = couleurs(d.row.index, d.column.index); if (c) d.cell.styles.textColor = c } } : undefined,
  })
  return doc.lastAutoTable.finalY + 4
}

/** Barres horizontales (pourcentages 0-100 ou valeurs sur `max`). */
function barres(doc, y, elements, { max = 100, titre, format = pc, seuil = null } = {}) {
  const L = doc.internal.pageSize.getWidth(), largeur = L - 2 * M, etiquette = 42, h = 4.2
  const hauteur = (titre ? 6 : 0) + elements.length * (h + 1.6) + 4
  y = place(doc, y, hauteur)
  if (titre) { doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.text(pdf(titre), M, y + 3); doc.setFont("helvetica", "normal"); y += 6 }
  const zone = largeur - etiquette - 18
  for (const e of elements) {
    doc.setFontSize(7); doc.setTextColor(...NOIR)
    doc.text(doc.splitTextToSize(pdf(e.libelle), etiquette - 2)[0], M, y + h - 1)
    doc.setFillColor(233, 236, 239); doc.rect(M + etiquette, y, zone, h, "F")
    const v = e.valeur ?? 0, w = Math.max(0, Math.min(1, v / max)) * zone
    doc.setFillColor(...(seuil !== null && v < seuil ? ROUGE : VERT)); if (w > 0) doc.rect(M + etiquette, y, w, h, "F")
    doc.text(pdf(e.valeur === null || e.valeur === undefined ? "—" : format(e.valeur)), M + etiquette + zone + 2, y + h - 1)
    y += h + 1.6
  }
  return y + 2
}

/** Courbes (une ou plusieurs séries) sur une échelle 0 → max. */
function courbes(doc, y, libelles, series, { max = 20, titre, hauteur = 48 } = {}) {
  const L = doc.internal.pageSize.getWidth(), x0 = M + 10, largeur = L - 2 * M - 14
  y = place(doc, y, hauteur + 16)
  if (titre) { doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.text(pdf(titre), M, y + 3); doc.setFont("helvetica", "normal"); y += 6 }
  const haut = y + 2, bas = y + 2 + hauteur
  doc.setDrawColor(...BORDURE); doc.setLineWidth(0.1); doc.setFontSize(6.5); doc.setTextColor(...GRIS)
  for (let k = 0; k <= 4; k++) {
    const yy = bas - (k / 4) * hauteur
    doc.line(x0, yy, x0 + largeur, yy); doc.text(pdf(note((max * k) / 4)), x0 - 2, yy + 1, { align: "right" })
  }
  const pas = libelles.length > 1 ? largeur / (libelles.length - 1) : 0
  libelles.forEach((l, k) => doc.text(pdf(l), x0 + k * pas, bas + 4, { align: libelles.length > 1 ? "center" : "left" }))
  const palette = [BLEU, OR, VERT, ROUGE]
  series.forEach((s, i) => {
    const c = s.couleur || palette[i % palette.length]
    doc.setDrawColor(...c); doc.setFillColor(...c); doc.setLineWidth(0.6)
    let avant = null
    s.valeurs.forEach((v, k) => {
      if (v === null || v === undefined) { avant = null; return }
      const p = [x0 + k * pas, bas - (Math.min(max, Math.max(0, v)) / max) * hauteur]
      if (avant) doc.line(avant[0], avant[1], p[0], p[1])
      doc.circle(p[0], p[1], 0.8, "F"); avant = p
    })
  })
  let lx = x0
  series.forEach((s, i) => {
    const c = s.couleur || palette[i % palette.length]
    doc.setFillColor(...c); doc.rect(lx, bas + 7, 3, 2, "F"); doc.setTextColor(...NOIR)
    doc.text(pdf(s.nom), lx + 4, bas + 8.8); lx += doc.getTextWidth(pdf(s.nom)) + 10
  })
  doc.setTextColor(...NOIR)
  return bas + 13
}

/** Commentaire, emplacements de signature et cachet. */
function signatures(doc, y, { commentaire, signataires = [], cachet = null, lieu = "" }) {
  const L = doc.internal.pageSize.getWidth()
  if (commentaire) {
    y = titreSection(doc, y, t("Commentaire de la direction"))
    y = paragraphes(doc, y, commentaire.split(/\n+/).filter(Boolean), { puce: "" })
  }
  const liste = signataires.length ? signataires : [t("Le chef d'établissement")]
  y = place(doc, y, 36)
  doc.setFontSize(8); doc.setTextColor(...GRIS)
  doc.text(pdf(t("Fait à {v0}, le {v1}", { v0: lieu || "…………", v1: dateCourte(new Date()) })), L - M, y + 3, { align: "right" })
  y += 7; doc.setTextColor(...NOIR)
  const largeur = (L - 2 * M) / liste.length
  liste.forEach((s, k) => {
    const x = M + k * largeur
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text(pdf(s), x + largeur / 2, y + 3, { align: "center" })
    doc.setFont("helvetica", "normal"); doc.setDrawColor(...BORDURE); doc.line(x + 6, y + 24, x + largeur - 6, y + 24)
  })
  if (cachet) {
    const k = Math.min(26 / cachet.largeur, 26 / cachet.hauteur)
    const x = M + (liste.length - 1) * largeur + largeur / 2 - (cachet.largeur * k) / 2
    doc.addImage(cachet.donnees, cachet.format, x, y + 4, cachet.largeur * k, cachet.hauteur * k, undefined, "FAST")
  }
  return y + 28
}

function sortir(doc, nomFichier, { mode = "telecharger" } = {}) {
  if (mode === "octets") return new Uint8Array(doc.output("arraybuffer"))
  doc.save(`${nomFichier}.pdf`)
  return null
}

// =============================================================================================================
// PV de classe
// =============================================================================================================

/** ctx = { etablissement, logo, cachet, signataires, reference, genereLe, titre, sousTitre, commentaire, observations, moyennes } */
export async function pvClassePdf(pv, ctx, nomFichier) {
  const { jsPDF, autoTable } = await charger()
  const paysage = pv.colonnes.length > 7
  const doc = nouveau(jsPDF, { orientation: paysage ? "landscape" : "portrait", titre: ctx.titre, etablissement: ctx.etablissement })
  let y = entete(doc, ctx)
  const g = pv.global
  y = tableau(doc, autoTable, y, {
    entetes: [t("Effectif"), t("Notes saisies"), t("Notes manquantes"), t("Réussite"), t("Échec"), t("Élèves absents"), t("Retards")],
    lignes: [[g.effectif, `${g.notesPresentes} / ${g.notesAttendues}`, pc(g.tauxManquantes), pc(g.tauxReussite), pc(g.tauxEchec), pc(g.tauxAbsents), g.retards]],
  })
  const plusieurs = new Set(pv.colonnes.map((c) => c.periode)).size > 1
  const entetes = ["#", t("Élève"), t("Matricule"), ...pv.colonnes.map((c) => (plusieurs ? `${c.matiere}\n${c.periodeLibelle}` : c.matiere)),
    ...(ctx.moyennes ? pv.lignes[0]?.moyennes?.map((_, k) => t("Moy. {v0}", { v0: k + 1 })) || [] : []), t("Échecs"),
    ...(ctx.observations ? [t("Observation")] : [])]
  const lignes = pv.lignes.map((l, k) => [k + 1, nom(l.eleve), l.eleve.matricule, ...l.notes.map(n2),
    ...(ctx.moyennes ? (l.moyennes || []).map(n2) : []), `${l.echecs}/${l.presentes}`,
    ...(ctx.observations ? [ctx.observationDe ? ctx.observationDe(l) : ""] : [])])
  const debutNotes = 3, finNotes = 3 + pv.colonnes.length
  y = titreSection(doc, y, t("Notes obtenues"))
  y = tableau(doc, autoTable, y, {
    entetes, lignes, taille: pv.colonnes.length > 12 ? 6 : 7,
    colonnes: { 0: { halign: "center", cellWidth: 7 }, 1: { cellWidth: paysage ? 42 : 36 } },
    couleurs: (r, c) => (c >= debutNotes && c < finNotes && pv.lignes[r].notes[c - debutNotes] !== null && pv.lignes[r].notes[c - debutNotes] < pv.seuil ? ROUGE : null),
  })
  y = titreSection(doc, y, t("Statistiques par matière"))
  y = tableau(doc, autoTable, y, {
    entetes: [t("Matière"), ...(plusieurs ? [t("Période")] : []), t("Enseignant"), t("Notes"), t("Réussite"), t("Échec"), t("Note max."), t("Note min."), t("Meilleure note")],
    lignes: pv.matieres.map((m) => [m.matiere, ...(plusieurs ? [m.periodeLibelle] : []), m.enseignant, m.n, pc(m.tauxReussite), pc(m.tauxEchec), n2(m.max), n2(m.min),
      m.meilleure ? `${nom(m.meilleure.eleve)} (${note(m.meilleure.note)})` : "—"]),
  })
  y = barres(doc, y, pv.matieres.map((m) => ({ libelle: plusieurs ? `${m.matiere} · ${m.periodeLibelle}` : m.matiere, valeur: m.tauxReussite })),
    { titre: t("Taux de réussite par matière"), seuil: 50 })
  if (pv.meilleures.length) {
    y = titreSection(doc, y, t("Meilleures performances"))
    y = tableau(doc, autoTable, y, { entetes: [t("Élève"), t("Matière"), t("Période"), t("Note")],
      lignes: pv.meilleures.map((x) => [nom(x.eleve), x.matiere, x.periode, note(x.note)]) })
  }
  y = titreSection(doc, y, t("Élèves en difficulté"))
  y = pv.enDifficulte.length
    ? tableau(doc, autoTable, y, { entetes: [t("Élève"), t("Notes sous le seuil"), t("Part")], lignes: pv.enDifficulte.map((l) => [nom(l.eleve), `${l.echecs}/${l.presentes}`, pc(l.partEchecs)]) })
    : paragraphes(doc, y, [t("Aucun élève en difficulté selon les seuils de l'établissement.")], { puce: "" })
  y = titreSection(doc, y, t("Synthèse"))
  y = paragraphes(doc, y, syntheseClasse(pv))
  if (ctx.avertissements?.length) { y = titreSection(doc, y, t("Avertissements")); y = paragraphes(doc, y, ctx.avertissements) }
  signatures(doc, y, ctx)
  pieds(doc, ctx.reference)
  return sortir(doc, nomFichier, ctx)
}

// =============================================================================================================
// PV par cycle et PV général
// =============================================================================================================

/** ctx = { ..., type: "cycle" | "etablissement", evolution: [{ libelle, moyenne, tauxReussite }], comparaison, libelleComparaison,
 *          sexe (répartition filles/garçons), parEnseignant } */
export async function pvGroupePdf(pv, ctx, nomFichier) {
  const { jsPDF, autoTable } = await charger()
  const doc = nouveau(jsPDF, { orientation: "portrait", titre: ctx.titre, etablissement: ctx.etablissement })
  let y = entete(doc, ctx)
  const g = pv.global
  y = tableau(doc, autoTable, y, {
    entetes: [t("Effectif"), t("Évalués"), t("Moyenne"), t("Réussite"), t("Échec"), t("En difficulté"), t("Présence"), ...(g.financeConnue ? [t("À jour (pension)")] : [])],
    lignes: [[g.effectif, g.evalues, n2(g.moyenne), pc(g.tauxReussite), pc(g.tauxEchec), pc(g.tauxDifficulte), pc(g.tauxPresence), ...(g.financeConnue ? [pc(g.tauxAJour)] : [])]],
  })
  if (ctx.type === "etablissement" && pv.parCycle.length > 1) {
    y = titreSection(doc, y, t("Par cycle"))
    y = tableau(doc, autoTable, y, { entetes: [t("Cycle"), t("Effectif"), t("Moyenne"), t("Réussite"), t("En difficulté")],
      lignes: pv.parCycle.map((c) => [c.libelle || t("Sans cycle"), c.effectif, n2(c.moyenne), pc(c.tauxReussite), pc(c.tauxDifficulte)]) })
  }
  if (ctx.type === "etablissement") {
    if (pv.parNiveau.length > 1) {
      y = titreSection(doc, y, t("Par niveau"))
      y = tableau(doc, autoTable, y, { entetes: [t("Niveau"), t("Effectif"), t("Moyenne"), t("Réussite")],
        lignes: pv.parNiveau.map((c) => [c.libelle || "—", c.effectif, n2(c.moyenne), pc(c.tauxReussite)]) })
    }
    if (pv.parSection.length > 1) {
      y = titreSection(doc, y, t("Par section"))
      y = tableau(doc, autoTable, y, { entetes: [t("Section"), t("Effectif"), t("Moyenne"), t("Réussite")],
        lignes: pv.parSection.map((c) => [c.libelle || "—", c.effectif, n2(c.moyenne), pc(c.tauxReussite)]) })
    }
  }
  y = titreSection(doc, y, t("Par classe"))
  y = tableau(doc, autoTable, y, {
    entetes: [t("Classe"), t("Effectif"), ...(ctx.sexe ? [t("G"), t("F")] : []), t("Moyenne"), t("Réussite"), t("Échec"), ...(ctx.sexe ? [t("Réussite G"), t("Réussite F")] : []),
      t("Élèves absents (%)"), ...(g.financeConnue ? [t("À jour")] : [])],
    lignes: pv.parClasse.map((c) => [c.classe.libelle, c.effectif, ...(ctx.sexe ? [c.garcons, c.filles] : []), n2(c.moyenne), pc(c.tauxReussite), pc(c.tauxEchec),
      ...(ctx.sexe ? [pc(c.reussiteGarcons), pc(c.reussiteFilles)] : []), pc(c.tauxAbsenteisme), ...(g.financeConnue ? [pc(c.tauxAJour)] : [])]),
    taille: 7,
  })
  y = barres(doc, y, pv.parClasse.map((c) => ({ libelle: c.classe.libelle, valeur: c.tauxReussite })), { titre: t("Taux de réussite par classe"), seuil: 50 })
  y = titreSection(doc, y, t("Par matière"))
  y = tableau(doc, autoTable, y, { entetes: [t("Matière"), t("Notes"), t("Moyenne"), t("Réussite"), t("Échec")],
    lignes: pv.parMatiere.map((m) => [m.matiere, m.n, n2(m.moyenne), pc(m.tauxReussite), pc(m.tauxEchec)]), taille: 7 })
  if (pv.parEnseignant) {
    y = titreSection(doc, y, t("Par enseignant"))
    y = tableau(doc, autoTable, y, { entetes: [t("Enseignant"), t("Matières"), t("Classes"), t("Moyenne"), t("Réussite")],
      lignes: pv.parEnseignant.map((e) => [e.enseignant, e.matieres.join(", "), e.classes.join(", "), n2(e.moyenne), pc(e.tauxReussite)]), taille: 7 })
  }
  y = barres(doc, y, pv.repartition.map((r) => ({ libelle: r.libelle, valeur: r.pourcentage })), { titre: t("Répartition des moyennes") })
  if (ctx.evolution?.length > 1) {
    y = courbes(doc, y, ctx.evolution.map((p) => p.libelle), [{ nom: t("Moyenne générale"), valeurs: ctx.evolution.map((p) => p.moyenne) }],
      { titre: t("Évolution de la moyenne générale"), max: 20 })
    y = courbes(doc, y, ctx.evolution.map((p) => p.libelle), [{ nom: t("Taux de réussite (%)"), valeurs: ctx.evolution.map((p) => p.tauxReussite), couleur: VERT }],
      { titre: t("Évolution du taux de réussite"), max: 100 })
  }
  if (ctx.comparaison) {
    y = titreSection(doc, y, t("Comparaison avec {v0}", { v0: ctx.libelleComparaison }))
    y = tableau(doc, autoTable, y, { entetes: [t("Classe"), t("Réussite"), ctx.libelleComparaison, t("Écart (points)")],
      lignes: ctx.comparaison.classes.map((c) => [c.classe.libelle, pc(c.courant), pc(c.reference), c.ecart === null ? "—" : `${c.ecart > 0 ? "+" : ""}${note(c.ecart)}`]) })
  }
  y = titreSection(doc, y, t("Meilleures performances"))
  y = tableau(doc, autoTable, y, { entetes: [t("Élève"), t("Classe"), t("Moyenne")], lignes: pv.meilleures.map((x) => [nom(x.eleve), x.classe.libelle, note(x.moyenne)]) })
  y = titreSection(doc, y, t("Élèves en difficulté ({v0})", { v0: pv.enDifficulte.length }))
  y = pv.enDifficulte.length
    ? tableau(doc, autoTable, y, { entetes: [t("Élève"), t("Classe"), t("Moyenne")], lignes: pv.enDifficulte.slice(0, 60).map((x) => [nom(x.eleve), x.classe.libelle, note(x.moyenne)]) })
    : paragraphes(doc, y, [t("Aucun élève en difficulté selon les seuils de l'établissement.")], { puce: "" })
  y = titreSection(doc, y, t("Synthèse"))
  y = paragraphes(doc, y, syntheseGroupe(pv, { comparaison: ctx.comparaison, libelleComparaison: ctx.libelleComparaison }))
  signatures(doc, y, ctx)
  pieds(doc, ctx.reference)
  return sortir(doc, nomFichier, ctx)
}

// =============================================================================================================
// PV individuels (un élève par page ou plus)
// =============================================================================================================

function pageIndividuelle(doc, autoTable, c, ctx) {
  let y = entete(doc, { ...ctx, sousTitre: `${ctx.sousTitre || ""}` })
  doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  doc.text(pdf(`${nom(c.eleve)}  ·  ${c.eleve.matricule || ""}`), M, y + 4)
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS)
  doc.text(pdf(`${c.classe || ""} · ${c.periode?.libelle || ""} · ${c.annee || ""}`), M, y + 9)
  doc.setTextColor(...NOIR); y += 13
  y = tableau(doc, autoTable, y, {
    entetes: [t("Moyenne"), t("Moyenne de la classe"), ...(c.moyenneCycle !== null && c.moyenneCycle !== undefined ? [t("Moyenne du cycle")] : []), t("Période précédente"), t("Absences (NJ / J)"), t("Retards")],
    lignes: [[n2(c.moyenne), n2(c.moyenneClasse), ...(c.moyenneCycle !== null && c.moyenneCycle !== undefined ? [n2(c.moyenneCycle)] : []), n2(c.moyennePrecedente),
      `${c.absences.nj} h / ${c.absences.j} h`, c.absences.retards]],
  })
  const avecCycle = c.matieres.some((m) => m.moyenneCycle !== null && m.moyenneCycle !== undefined)
  y = tableau(doc, autoTable, y, {
    entetes: [t("Matière"), ...(c.entetes || []), t("Note"), t("Moy. classe"), ...(avecCycle ? [t("Moy. cycle")] : []), t("Écart"), t("Évolution")],
    lignes: c.matieres.map((m) => [m.matiere, ...(m.details || []).map(n2), n2(m.note), n2(m.moyenneClasse), ...(avecCycle ? [n2(m.moyenneCycle)] : []),
      m.ecartClasse === null ? "—" : `${m.ecartClasse > 0 ? "+" : ""}${note(m.ecartClasse)}`,
      m.variation === null ? "—" : `${m.variation > 0 ? "+" : ""}${note(m.variation)}`]),
    taille: 7.5,
    couleurs: (r, col) => { const m = c.matieres[r]; const k = 1 + (c.entetes || []).length; return col === k && m.note !== null && m.note < c.seuil ? ROUGE : null },
  })
  if (c.evolution?.length > 1) {
    y = courbes(doc, y, c.evolution.map((p) => p.libelle), [
      { nom: t("Élève"), valeurs: c.evolution.map((p) => p.eleve) },
      { nom: t("Moyenne de la classe"), valeurs: c.evolution.map((p) => p.classe) },
      ...(c.evolution.some((p) => p.cycle !== null && p.cycle !== undefined) ? [{ nom: t("Moyenne du cycle"), valeurs: c.evolution.map((p) => p.cycle ?? null) }] : []),
    ], { titre: t("Évolution des performances"), hauteur: 40 })
  }
  y = titreSection(doc, y, t("Synthèse"))
  y = paragraphes(doc, y, syntheseIndividuelle(c))
  const alertes = [...(c.alerteGenerale ? [t("Baisse de la moyenne générale : {v0} point(s).", { v0: note(c.variationGenerale) })] : []),
    ...c.alertes.map((a) => t("Baisse en {v0} : {v1} point(s).", { v0: a.matiere, v1: note(a.variation) }))]
  if (alertes.length) { y = titreSection(doc, y, t("Alertes")); y = paragraphes(doc, y, alertes) }
  if (c.recommandations.length) { y = titreSection(doc, y, t("Recommandations et actions de suivi")); y = paragraphes(doc, y, c.recommandations.map(texteRecommandation)) }
  if (c.decision) { y = titreSection(doc, y, t("Décision")); y = paragraphes(doc, y, [c.decision], { puce: "" }) }
  if (c.paiement) { y = paragraphes(doc, y, [c.paiement.en_regle ? t("Situation financière : à jour.") : t("Situation financière : non à jour.")], { puce: "" }) }
  if (c.commentaires?.length) {
    y = titreSection(doc, y, t("Commentaires"))
    for (const x of c.commentaires) y = paragraphes(doc, y, [x.texte, x.auteur ? `— ${x.auteur}${x.fonction ? `, ${t(x.fonction)}` : ""}` : ""].filter(Boolean), { puce: "" })
  }
  signatures(doc, y, { ...ctx, commentaire: "" })
}

/** contenus : [contenu du PV individuel] ; ctx = { etablissement, logo, cachet, signataires, reference, titre, sousTitre, lieu, mode } */
export async function pvIndividuelsPdf(contenus, ctx, nomFichier) {
  const { jsPDF, autoTable } = await charger()
  const doc = nouveau(jsPDF, { titre: ctx.titre, etablissement: ctx.etablissement })
  contenus.forEach((c, k) => { if (k) doc.addPage(); pageIndividuelle(doc, autoTable, c, ctx) })
  pieds(doc, ctx.reference)
  return sortir(doc, nomFichier, ctx)
}
