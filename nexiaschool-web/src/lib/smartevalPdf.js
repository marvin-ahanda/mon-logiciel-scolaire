// SmartEval : copies des élèves en PDF (une copie A4 par élève) et tableau des résultats en Excel.
import { attenduTexte, reponseTexte } from "./smarteval.js"
import { telechargerClasseur } from "./excel.js"
import { nomDeFichier } from "./bulletinPdf.js"
import { dateHeure, note } from "./format.js"
import { t } from "../i18n.jsx"

const MARGE = 12, LARGEUR = 210, UTILE = LARGEUR - 2 * MARGE
const NOIR = [33, 37, 41], GRIS = [108, 117, 125], BORDURE = [173, 181, 189], ENTETE = [233, 236, 239]
const pdf = (v) => String(v ?? "").replace(/[  ]/g, " ")

function dimensions(dataUrl) {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok({ l: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok(null); i.src = dataUrl })
}

function entete(doc, ev, logo) {
  const e = ev.entete || {}
  let y = MARGE
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5)
  const nom = doc.splitTextToSize(pdf(e.nom), 76); doc.text(nom, MARGE, y + 4)
  let yg = y + 4 + nom.length * 4.4
  doc.setFontSize(8.5)
  if (e.devise) { doc.setFont("helvetica", "italic"); doc.text(doc.splitTextToSize(pdf(e.devise), 76), MARGE, yg); yg += 3.8 }
  doc.setFont("helvetica", "normal")
  const coord = doc.splitTextToSize(pdf([e.adresse, e.ville, e.telephone && `${t("Tél.")} ${e.telephone}`, e.site_web].filter(Boolean).join(" · ")), 76)
  if (coord.length) { doc.text(coord, MARGE, yg); yg += coord.length * 3.8 }
  let hl = 0
  if (logo) { const k = Math.min(18 / logo.l, 18 / logo.h); doc.addImage(e.logo, "PNG", LARGEUR / 2 - (logo.l * k) / 2, y, logo.l * k, logo.h * k, "logo-se", "FAST"); hl = logo.h * k }
  doc.setFontSize(9)
  if (e.annee) doc.text(pdf(`${t("Année scolaire ")}${e.annee}`), LARGEUR - MARGE, y + 4, { align: "right" })
  doc.text(pdf(t("Séquence {v0}", { v0: ev.sequence })), LARGEUR - MARGE, y + 8.5, { align: "right" })
  y = Math.max(yg, y + hl, y + 12) + 1.5
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.5); doc.line(MARGE, y, LARGEUR - MARGE, y)
  doc.setFontSize(12); doc.text(pdf(t("ÉVALUATION DIGITALISÉE — SMARTEVAL")), LARGEUR / 2, y + 6, { align: "center" })
  doc.setFont("helvetica", "bold"); doc.setFontSize(10)
  const titre = doc.splitTextToSize(pdf(ev.titre), UTILE); doc.text(titre, LARGEUR / 2, y + 11.5, { align: "center" })
  y += 11.5 + titre.length * 4.2
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS)
  const sous = doc.splitTextToSize(pdf(`${ev.matiere} · ${t("Compétence visée : ")}${ev.competence}`), UTILE)
  doc.text(sous, LARGEUR / 2, y, { align: "center" }); doc.setTextColor(...NOIR)
  return y + sous.length * 3.5 + 1
}

/** Toutes les copies (une page A4 ou plus par élève), téléchargées en un seul PDF. */
export async function telechargerCopiesPdf(ev) {
  const [{ jsPDF }, module] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const autoTable = module.autoTable || module.default
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  doc.setProperties({ title: ev.titre, author: ev.entete?.nom || "", creator: "NexIA School — SmartEval" })
  const logo = ev.entete?.logo ? await dimensions(ev.entete.logo) : null
  const styles = { font: "helvetica", fontSize: 8, cellPadding: 1.3, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2, valign: "middle" }
  ev.soumissions.forEach((s, k) => {
    if (k) doc.addPage()
    let y = entete(doc, ev, logo)
    autoTable(doc, { startY: y, margin: { left: MARGE, right: MARGE }, theme: "grid", styles: { ...styles, fontSize: 8.5 },
      body: [[pdf(`${t("Nom et prénom : ")}${s.nom} ${s.prenom}`), pdf(`${t("Classe : ")}${s.classe}`), pdf(`${t("Matricule : ")}${s.matricule || "—"}`)],
             [pdf(`${t("Envoyé le : ")}${dateHeure(s.soumis_le)}`), pdf(t("Copie n° {v0}", { v0: s.numero })),
              { content: pdf(`${t("Note : ")}${s.note20 === null ? "—" : `${note(s.note20)} / 20`}`), styles: { fontStyle: "bold" } }]] })
    y = doc.lastAutoTable.finalY + 2
    autoTable(doc, { startY: y, margin: { left: MARGE, right: MARGE, bottom: 14 }, theme: "grid", styles,
      headStyles: { fillColor: ENTETE, textColor: NOIR, fontStyle: "bold" },
      head: [["N°", t("Question"), t("Réponse de l'élève"), t("Réponse attendue"), t("Résultat")].map(pdf)],
      body: ev.questions.map((q, i) => {
        const d = (s.details || []).find((x) => x.id === q.id) || {}
        const r = reponseTexte(q, s.reponses?.[q.id])
        return [String(i + 1), pdf(q.intitule + (q.notion ? `\n(${q.notion})` : "")), pdf(r || t("Sans réponse")), pdf(attenduTexte(q)),
          { content: pdf(d.correct === true ? `${t("Juste")} ${note(d.obtenu)}/${note(d.max)}` : d.correct === false ? `${t("Faux")} 0/${note(d.max)}` : d.a_corriger ? t("À apprécier") : "—"),
            styles: { textColor: d.correct === true ? [25, 135, 84] : d.correct === false ? [220, 53, 69] : NOIR, fontStyle: "bold", halign: "center" } }]
      }),
      columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 58 }, 2: { cellWidth: 52 }, 3: { cellWidth: 42 }, 4: { cellWidth: "auto" } } })
    doc.setFontSize(7); doc.setTextColor(...GRIS)
    doc.text(pdf(t("SmartEval · NexIA School")), LARGEUR - MARGE, 297 - 7, { align: "right" }); doc.setTextColor(...NOIR)
  })
  doc.save(`${nomDeFichier(t("copies"), ev.titre)}.pdf`)
}

/** Tableau des résultats : une ligne par élève (note et réponses), puis les questions et les notions. */
export async function telechargerResultatsExcel(ev, analyse) {
  const qs = ev.questions
  await telechargerClasseur([
    { titre: t("Résultats"), intitule: `${ev.titre} — ${ev.matiere}`,
      entetes: [t("N°"), t("Élève"), t("Classe"), t("Matricule"), t("Note /20"), t("Envoyé le"), ...qs.map((q, i) => `Q${i + 1}`)],
      lignes: ev.soumissions.map((s) => [s.numero, `${s.nom} ${s.prenom}`, s.classe, s.matricule || "", s.note20 === null ? "" : Number(s.note20), dateHeure(s.soumis_le),
        ...qs.map((q) => reponseTexte(q, s.reponses?.[q.id]))]) },
    { titre: t("Questions"), entetes: [t("N°"), t("Question"), t("Notion"), t("Réponse attendue"), t("Réussite (%)")],
      lignes: analyse.par_question.map((q) => [q.numero, q.intitule, q.notion, q.attendu, q.taux_reussite ?? ""]) },
    { titre: t("Notions"), entetes: [t("Notion"), t("Réussite (%)"), t("Élèves en difficulté"), t("Élèves à l'aise")],
      lignes: analyse.par_notion.map((n) => [t(n.notion), n.taux_reussite ?? "", n.eleves_en_difficulte.join(", "), n.eleves_a_l_aise.join(", ")]) },
  ], nomDeFichier("smarteval", ev.titre))
}
