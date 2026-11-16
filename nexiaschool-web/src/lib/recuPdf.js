// Reçu de paiement d'abonnement NexIA School (PDF A4). jsPDF est chargé à la demande.
import { EDITEUR } from "./editeur.js"
import { NOMS_OFFRES } from "./offres.js"
import { fcfa, jour } from "./financePdf.js"
import { t } from "../i18n.jsx"

const pdf = (v) => String(v ?? "").replace(/[   ]/g, " ")
const NOIR = [33, 37, 41], GRIS = [108, 117, 125], BLEU = [11, 70, 229], VERT = [25, 135, 84]

/**
 * recu : résultat de recu_paiement() { numero, date, offre, periode, montant, debut, fin, transaction, etablissement: { nom, ville, adresse, telephone } }
 */
export async function recuPdf(recu, { imprimer = false } = {}) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  doc.setProperties({ title: `${t("Reçu")} ${recu.numero}`, author: EDITEUR.service, creator: "NexIA School" })
  const L = doc.internal.pageSize.getWidth(), M = 18
  let y = 22

  doc.setTextColor(...BLEU); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("NexIA School", M, y)
  doc.setTextColor(...NOIR); doc.setFontSize(9); doc.setFont("helvetica", "normal")
  doc.text(pdf([EDITEUR.nom, EDITEUR.pays].filter(Boolean).join(" · ")), M, y + 6)
  doc.text(pdf(`${EDITEUR.site.replace(/^https?:\/\//, "")} · ${EDITEUR.contact}`), M, y + 11)

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(pdf(t("REÇU DE PAIEMENT")), L - M, y, { align: "right" })
  doc.setFont("helvetica", "normal"); doc.setFontSize(10)
  doc.text(pdf(`${t("N°")} ${recu.numero}`), L - M, y + 7, { align: "right" })
  doc.text(pdf(`${t("Date")} : ${jour(recu.date)}`), L - M, y + 12, { align: "right" })
  y += 20
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.5); doc.line(M, y, L - M, y); y += 9

  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...GRIS); doc.text(pdf(t("REÇU DE")).toUpperCase(), M, y)
  doc.setTextColor(...NOIR); doc.setFontSize(12); y += 6
  doc.text(doc.splitTextToSize(pdf(recu.etablissement.nom), L - 2 * M), M, y); y += 6
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5)
  const adresse = [recu.etablissement.adresse, recu.etablissement.ville, recu.etablissement.telephone].filter(Boolean).join(" · ")
  if (adresse) { doc.text(doc.splitTextToSize(pdf(adresse), L - 2 * M), M, y); y += 6 }
  y += 6

  // détail
  const nomOffre = t(NOMS_OFFRES[recu.offre] || recu.offre)
  const duree = recu.periode === "annuel" ? t("1 an") : t("1 mois")
  doc.setFillColor(241, 243, 245); doc.rect(M, y, L - 2 * M, 8, "F")
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5)
  doc.text(pdf(t("Désignation")), M + 3, y + 5.5); doc.text(pdf(t("Montant")), L - M - 3, y + 5.5, { align: "right" })
  y += 8
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); y += 7
  doc.text(pdf(`${t("Abonnement NexIA School")} — ${t("offre")} ${nomOffre} (${duree})`), M + 3, y)
  doc.text(pdf(fcfa(recu.montant)), L - M - 3, y, { align: "right" })
  doc.setFontSize(9); doc.setTextColor(...GRIS); y += 5.5
  doc.text(pdf(`${t("Période couverte")} : ${t("du")} ${jour(recu.debut)} ${t("au")} ${jour(recu.fin)}`), M + 3, y)
  doc.setTextColor(...NOIR); y += 5
  doc.setDrawColor(...GRIS); doc.setLineWidth(0.2); doc.line(M, y, L - M, y); y += 9

  doc.setFont("helvetica", "bold"); doc.setFontSize(12)
  doc.text(pdf(t("Total payé")), L - M - 62, y); doc.text(pdf(fcfa(recu.montant)), L - M - 3, y, { align: "right" }); y += 5
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRIS)
  doc.text(pdf(t("Aucune TVA facturée sur cet abonnement.")), L - M - 3, y + 1, { align: "right" })
  doc.setTextColor(...NOIR); y += 12

  doc.setFontSize(9.5)
  const lignes = [[t("Mode de paiement"), t("SasPay (mobile money ou carte)")], [t("Référence de transaction"), recu.transaction || "—"]]
  for (const [k, v] of lignes) {
    doc.setFont("helvetica", "bold"); doc.text(pdf(`${k} :`), M, y)
    doc.setFont("helvetica", "normal"); doc.text(doc.splitTextToSize(pdf(v), L - 2 * M - 52), M + 52, y); y += 6
  }

  // tampon « PAYÉ »
  doc.setTextColor(...VERT); doc.setDrawColor(...VERT); doc.setLineWidth(0.8); doc.setFont("helvetica", "bold"); doc.setFontSize(22)
  doc.roundedRect(L - M - 42, y + 4, 42, 14, 2, 2); doc.text(pdf(t("PAYÉ")), L - M - 21, y + 14, { align: "center" })
  doc.setTextColor(...GRIS); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
  doc.text(doc.splitTextToSize(pdf(t("Ce reçu est généré automatiquement par NexIA School ; il vaut preuve de paiement. Conservez-le avec vos documents comptables.")), L - 2 * M - 50), M, y + 9)

  const nom = `recu-${recu.numero}`
  if (imprimer) { doc.autoPrint(); window.open(doc.output("bloburl"), "_blank") } else doc.save(`${nom}.pdf`)
}
