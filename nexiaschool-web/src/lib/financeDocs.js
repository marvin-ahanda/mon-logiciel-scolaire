// Documents financiers officiels : reçu, facture et bulletin de paie (PDF A5 / A4), chacun avec un QR code de vérification
// (page publique /verifier/<code>, données minimales). Montant en lettres, solde restant, agent, mentions de l'établissement.
import { image } from "./bulletinPdf.js"
import { matriceQr, urlVerification } from "./bulletinVerif.js"
import { BORDURE, charger, entete, fcfa, GRIS, jour, modePaiement, NOIR, pdf, sortir } from "./financePdf.js"
import { t } from "../i18n.jsx"

// --- Montant en lettres (français) ----------------------------------------------------------------------------------
const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize",
  "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"]
const DIZAINES = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"]

function moinsDeCent(n) {
  if (n < 20) return UNITES[n]
  const d = Math.floor(n / 10), u = n % 10
  if (d <= 6) return u === 0 ? DIZAINES[d] : `${DIZAINES[d]}${u === 1 ? " et un" : `-${UNITES[u]}`}`
  if (d === 7) return u === 1 ? "soixante et onze" : `soixante-${UNITES[10 + u]}`
  if (d === 8) return u === 0 ? "quatre-vingts" : `quatre-vingt-${UNITES[u]}`
  return `quatre-vingt-${UNITES[10 + u]}`                                  // 90 à 99
}

/** 0 à 999 ; « final » : le nombre termine l'expression (accord de « cents » et « quatre-vingts »). */
function moinsDeMille(n, final) {
  const c = Math.floor(n / 100), r = n % 100
  let s = ""
  if (c === 1) s = "cent"
  else if (c > 1) s = `${UNITES[c]} cent${r === 0 && final ? "s" : ""}`
  if (r > 0) {
    let fin = moinsDeCent(r)
    if (!final && fin === "quatre-vingts") fin = "quatre-vingt"
    s = s ? `${s} ${fin}` : fin
  }
  return s
}

/** 205000 -> « deux cent cinq mille » (entier positif, jusqu'à 999 milliards). */
export function nombreEnLettres(nombre) {
  let n = Math.round(Math.abs(Number(nombre) || 0))
  if (n === 0) return UNITES[0]
  const parties = []
  for (const [valeur, sing, plur] of [[1e9, "milliard", "milliards"], [1e6, "million", "millions"]]) {
    const q = Math.floor(n / valeur)
    if (q > 0) { parties.push(`${moinsDeMille(q, true)} ${q > 1 ? plur : sing}`); n %= valeur }
  }
  const milliers = Math.floor(n / 1000), reste = n % 1000
  if (milliers === 1) parties.push("mille")
  else if (milliers > 1) parties.push(`${moinsDeMille(milliers, false)} mille`)
  if (reste > 0) parties.push(moinsDeMille(reste, true))
  return parties.join(" ")
}

/** « Deux cent cinq mille francs CFA » */
export const montantEnLettres = (n) => {
  const s = nombreEnLettres(n)
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} francs CFA`
}

// --- Éléments communs ------------------------------------------------------------------------------------------------
/** Dessine le QR code de vérification (côté c mm) et sa légende ; renvoie la hauteur occupée. */
function qr(doc, code, x, y, c = 24) {
  if (!code) return 0
  const m = matriceQr(urlVerification(code)), n = m.length, k = c / n
  doc.setFillColor(255, 255, 255); doc.rect(x - 1, y - 1, c + 2, c + 2, "F")
  doc.setFillColor(...NOIR)
  m.forEach((ligne, l) => ligne.forEach((noir, col) => { if (noir) doc.rect(x + col * k, y + l * k, k + 0.01, k + 0.01, "F") }))
  doc.setFontSize(6); doc.setTextColor(...GRIS)
  doc.text(pdf(t("Vérifier : {v0}", { v0: urlVerification(code).replace(/^https?:\/\//, "") })), x + c / 2, y + c + 3, { align: "center", maxWidth: c + 30 })
  doc.setTextColor(...NOIR)
  return c + 4
}

function tableauCles(doc, autoTable, y, lignes, largeurCle = 40) {
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12 }, theme: "plain",
    body: lignes.filter(Boolean).map(([a, b]) => [pdf(t(a)), pdf(b)]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.2, textColor: NOIR },
    columnStyles: { 0: { cellWidth: largeurCle, textColor: GRIS }, 1: { fontStyle: "bold" } },
  })
  return doc.lastAutoTable.finalY
}

function piedOfficiel(doc, { gauche, droite, mention }) {
  const L = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  doc.setFontSize(8.5); doc.setTextColor(...NOIR)
  if (gauche) doc.text(pdf(gauche), 12, H - 30)
  doc.text(t("Signature et cachet"), L - 12, H - 30, { align: "right" })
  doc.setDrawColor(...BORDURE); doc.setLineWidth(0.2); doc.line(12, H - 12, L - 12, H - 12)
  doc.setFontSize(6.5); doc.setTextColor(...GRIS)
  doc.text(pdf([mention, droite].filter(Boolean).join(" · ")), L / 2, H - 8, { align: "center", maxWidth: L - 24 })
  doc.setTextColor(...NOIR)
}

const numero = (n, prefixe = "") => `${prefixe}${String(n).padStart(prefixe ? 6 : 5, "0")}`

/**
 * Reçu d'encaissement (A5) : numéro unique, élève, rubrique, montant (chiffres et lettres), mode, référence,
 * solde restant après le paiement, agent, QR code. Une contre-écriture est imprimée comme « Annulation ».
 */
export async function recuFinancePdf({ etablissement, logoUrl, eleve, paiement, reste, caissier, mention }, { imprimer = false, fenetre = null, generer = false } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: true })
  const annulation = Number(paiement.montant) < 0
  const titre = annulation ? t("Annulation n° {v0}", { v0: numero(paiement.numero) }) : t("Reçu n° {v0}", { v0: numero(paiement.numero) })
  doc.setProperties({ title: titre, author: etablissement.nom, creator: "NexIA School" })
  const logo = await image(logoUrl)
  let y = entete(doc, { etablissement, logo, titre, sousTitre: t("Paiement du {v0}", { v0: jour(paiement.date) }) })
  y = tableauCles(doc, autoTable, y, [
    ["Élève", `${eleve.nom} ${eleve.prenom || ""}`.trim()], ["Matricule", eleve.matricule || "—"], ["Classe", eleve.classe],
    ["Rubrique", paiement.rubrique || t("Pension / scolarité")],
    paiement.payeur ? ["Payé par", paiement.payeur] : null,
    ["Montant", fcfa(paiement.montant)], ["En lettres", montantEnLettres(paiement.montant) + (annulation ? ` (${t("annulation")})` : "")],
    ["Mode de paiement", modePaiement(paiement.mode)], paiement.reference ? ["Référence", paiement.reference] : null,
    paiement.observation ? ["Observation", paiement.observation] : null,
    annulation && paiement.motif_annulation ? ["Motif de l'annulation", paiement.motif_annulation] : null,
    reste != null ? ["Reste à payer (rubrique)", fcfa(reste)] : null,
  ])
  y += 4
  qr(doc, paiement.code_verif, doc.internal.pageSize.getWidth() / 2 - 12, y)
  piedOfficiel(doc, { gauche: t("Encaissé par : {v0}", { v0: caissier || "—" }), droite: t("Document émis par NexIA School"), mention })
  if (generer) return doc
  sortir(doc, `recu-${numero(paiement.numero)}`, imprimer, fenetre)
}

/** Facture (A4) : numéro unique, rubrique, montant brut, remises, payé, reste, échéancier éventuel, QR code. */
export async function facturePdf({ etablissement, logoUrl, eleve, facture, situation, mention }, { imprimer = false, fenetre = null, generer = false } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const num = numero(facture.numero, "FAC-")
  doc.setProperties({ title: t("Facture {v0}", { v0: num }), author: etablissement.nom, creator: "NexIA School" })
  const logo = await image(logoUrl)
  let y = entete(doc, { etablissement, logo, titre: t("Facture {v0}", { v0: num }), sousTitre: t("Émise le {v0}", { v0: jour(facture.emise_le) }) })
  y = tableauCles(doc, autoTable, y, [
    ["Élève", `${eleve.nom} ${eleve.prenom || ""}`.trim()], ["Matricule", eleve.matricule || "—"], ["Classe", eleve.classe],
    eleve.annee ? ["Année scolaire", eleve.annee] : null, facture.annulee_le ? ["Statut", t("Facture annulée le {v0}", { v0: jour(facture.annulee_le) })] : null,
  ]) + 3
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12 }, theme: "grid",
    head: [[t("Désignation"), t("Montant")]],
    body: [[facture.libelle, fcfa(facture.montant_brut)],
           ...(situation?.remise ? [[t("Remises, bourses et exonérations"), `- ${fcfa(situation.remise)}`]] : []),
           [t("Net à payer"), fcfa(situation ? situation.du : facture.montant_brut)],
           ...(situation ? [[t("Déjà payé"), fcfa(situation.paye)], [t("Reste à payer"), fcfa(situation.reste)]] : [])].map((l) => l.map(pdf)),
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 45 } },
    didParseCell: (c) => { if (c.section === "body" && /Net|Reste/.test(c.row.raw[0])) c.cell.styles.fontStyle = "bold" },
  })
  y = doc.lastAutoTable.finalY + 4
  doc.setFontSize(9); doc.text(pdf(t("Arrêtée à la somme de : {v0}", { v0: montantEnLettres(situation ? situation.du : facture.montant_brut) })), 12, y, { maxWidth: 186 })
  y += 8
  if (situation?.lignes?.length) {
    autoTable(doc, {
      startY: y, margin: { left: 12, right: 12 }, theme: "grid",
      head: [[t("Échéance"), t("Date limite"), t("Montant"), t("Payé"), t("Reste")]],
      body: situation.lignes.map((l) => [t(l.libelle), jour(l.date_limite), fcfa(l.montant), fcfa(l.paye), fcfa(l.reste)].map(pdf)),
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.4, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2 },
      headStyles: { fillColor: [248, 249, 250], textColor: NOIR, fontStyle: "bold" },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    })
    y = doc.lastAutoTable.finalY + 6
  }
  qr(doc, facture.code_verif, 12, y)
  piedOfficiel(doc, { gauche: "", droite: t("Document émis par NexIA School"), mention })
  if (generer) return doc
  sortir(doc, `facture-${num}`, imprimer, fenetre)
}

const LIB_TYPES = { base: "Salaire de base", prime: "Prime", indemnite: "Indemnité", retenue: "Retenue", cotisation_salariale: "Cotisation salariale",
  cotisation_patronale: "Cotisation patronale (à la charge de l'employeur)", impot: "Impôt", }

/** Bulletin de paie (A4) : lignes calculées et figées à la préparation, brut, retenues, net, QR code. */
export async function bulletinPaiePdf({ etablissement, logoUrl, employe, paie, mention }, { imprimer = false, fenetre = null, generer = false } = {}) {
  const { jsPDF, autoTable } = await charger()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const periode = new Date(`${String(paie.periode).slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
  const num = `BP-${String(paie.periode).slice(0, 7).replace("-", "")}-${String(paie.numero).padStart(5, "0")}`
  doc.setProperties({ title: t("Bulletin de paie {v0}", { v0: num }), author: etablissement.nom, creator: "NexIA School" })
  const logo = await image(logoUrl)
  let y = entete(doc, { etablissement, logo, titre: t("Bulletin de paie"), sousTitre: `${periode} · ${num}` })
  y = tableauCles(doc, autoTable, y, [
    ["Employé", employe.nom], employe.matricule ? ["Matricule", employe.matricule] : null, employe.poste ? ["Poste", employe.poste] : null,
    ["Période", periode], paie.date_paiement ? ["Payé le", jour(paie.date_paiement)] : null,
  ]) + 3
  const lignes = paie.details?.lignes || []
  const gains = lignes.filter((l) => ["base", "prime", "indemnite"].includes(l.type))
  const retenues = lignes.filter((l) => ["retenue", "cotisation_salariale", "impot"].includes(l.type))
  const patronales = lignes.filter((l) => l.type === "cotisation_patronale")
  const taux = (l) => (l.mode === "taux" ? ` (${String(l.valeur).replace(".", ",")} %)` : "")
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12 }, theme: "grid",
    head: [[t("Rubrique"), t("Gains"), t("Retenues")]],
    body: [...gains.map((l) => [l.type === "base" ? t("Salaire de base") : `${t(LIB_TYPES[l.type])} : ${l.libelle}`, fcfa(l.montant), ""]),
           ...retenues.map((l) => [`${l.libelle}${taux(l)}${l.verifie === false ? " *" : ""}`, "", fcfa(l.montant)])].map((l) => l.map(pdf)),
    foot: [[t("Totaux"), fcfa(paie.brut), fcfa(paie.retenues)].map(pdf)],
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.8, textColor: NOIR, lineColor: BORDURE, lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 239], textColor: NOIR, fontStyle: "bold" },
    footStyles: { fillColor: [248, 249, 250], textColor: NOIR, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 38 }, 2: { halign: "right", cellWidth: 38 } },
  })
  y = doc.lastAutoTable.finalY + 4
  doc.setFont("helvetica", "bold"); doc.setFontSize(11)
  doc.text(pdf(t("Net à payer : {v0}", { v0: fcfa(paie.net) })), 12, y + 2)
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
  doc.text(pdf(montantEnLettres(paie.net)), 12, y + 7)
  y += 12
  if (patronales.length) {
    doc.setFontSize(8); doc.setTextColor(...GRIS)
    doc.text(pdf(t("Charges patronales (information) : {v0}", { v0: patronales.map((l) => `${l.libelle} ${fcfa(l.montant)}`).join(" · ") })), 12, y, { maxWidth: 186 })
    doc.setTextColor(...NOIR); y += 6
  }
  if (paie.parametres_non_verifies) {
    doc.setFontSize(7.5); doc.setTextColor(176, 42, 55)
    doc.text(pdf(t("* Paramètre saisi par l'établissement et non encore vérifié par rapport à la réglementation en vigueur.")), 12, y, { maxWidth: 186 })
    doc.setTextColor(...NOIR); y += 6
  }
  qr(doc, paie.code_verif, 12, y + 2)
  piedOfficiel(doc, { gauche: t("L'employeur"), droite: t("Bulletin établi avec NexIA School — outil de suivi des salaires, non certifié comme logiciel de paie."), mention })
  if (generer) return doc
  sortir(doc, `bulletin-paie-${num}`, imprimer, fenetre)
}
