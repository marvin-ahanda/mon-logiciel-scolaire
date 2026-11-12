// Vues d'un emploi du temps (par classe, par enseignant) et exports (PDF, Excel).
// L'écran, l'impression, le PDF et l'Excel utilisent les mêmes vues : ce qui est affiché est exactement ce qui est exporté,
// et les vues par classe et par enseignant sont tirées de la même grille (toujours synchronisées).
import { t, locale } from "../../i18n.jsx"
import { classesDe, fermeture, lignesGrille, nomEnseignant, NOM_JOUR, PERMANENCE } from "./modele.js"
import { telechargerClasseur } from "../excel.js"

export const PERIODES_EDT = [["annee", "Année entière"], ["t1", "Trimestre 1"], ["t2", "Trimestre 2"], ["t3", "Trimestre 3"]]
export const libellePeriode = (p) => t(Object.fromEntries(PERIODES_EDT)[p] || p)
export const nomJour = (j) => t(NOM_JOUR[j])

/** Couleur sobre et stable d'une discipline (fond pastel, texte foncé). */
export function couleur(discipline) {
  if (!discipline || discipline === PERMANENCE) return { fond: "#f1f3f5", bord: "#ced4da", rgb: [241, 243, 245] }
  let h = 0
  for (const c of discipline) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const teinte = h % 360
  const rgb = hslRgb(teinte, 0.55, 0.92)
  return { fond: `hsl(${teinte} 55% 92%)`, bord: `hsl(${teinte} 40% 70%)`, rgb }
}
function hslRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255))
}

/** Index de la grille : cours par (classe, jour, période) et par (enseignant, jour, période). */
export function indexer(cfg, grille) {
  const affs = new Map(cfg.affectations.map((a) => [a.id, a]))
  const ens = new Map(cfg.enseignants.map((e) => [e.cle, e]))
  const salles = new Map(cfg.salles.map((s) => [s.id, s]))
  const parClasse = new Map(), parEns = new Map()
  for (const g of grille) {
    const a = g.a ? affs.get(g.a) : null
    const cours = { ...g, discipline: a ? a.discipline : PERMANENCE, permanence: !a, classe: a?.classe || cfg.classes?.[g.c]?.libelle || "",
      enseignant: a ? a.enseignant : null, nomEnseignant: a ? nomEnseignant(ens.get(a.enseignant)) : "", salle: g.s ? salles.get(g.s)?.nom || "" : "" }
    parClasse.set(`${g.c}|${g.j}|${g.p}`, cours)
    if (a) parEns.set(`${a.enseignant}|${g.j}|${g.p}`, cours)
  }
  const libelles = new Map(classesDe(cfg).map((c) => [c.id, c.libelle]))
  for (const c of parClasse.values()) if (!c.classe) c.classe = libelles.get(c.c) || ""
  return { parClasse, parEns }
}

/**
 * Tableau d'une semaine : { jours, lignes: [{ type: "periode"|"pause", libelle, cases: [{ type: "cours"|"perm"|"vide"|"ferme"|"pause", ... }] }] }
 * cible : { classe: id } ou { enseignant: cle }
 */
export function tableauSemaine(cfg, index, cible) {
  const jours = [...cfg.horaires.jours].sort((a, b) => a - b)
  const lignes = lignesGrille(cfg.horaires).map((l) => {
    if (l.type === "pause") return { ...l, cases: jours.map(() => ({ type: "pause", libelle: l.nom })) }
    const cases = jours.map((j) => {
      const f = fermeture(cfg.horaires, j, l.p)
      if (f) return { type: f.type === "interruption" ? "ferme" : "pause", libelle: f.libelle || "" }
      const c = cible.classe ? index.parClasse.get(`${cible.classe}|${j}|${l.p}`) : index.parEns.get(`${cible.enseignant}|${j}|${l.p}`)
      if (!c) return { type: "vide" }
      return { type: c.permanence ? "perm" : "cours", ...c }
    })
    return { ...l, cases }
  })
  return { jours, lignes }
}

/** Heures par classe et par enseignant (récapitulatif). */
export function totaux(cfg, grille) {
  const index = indexer(cfg, grille)
  const classes = classesDe(cfg).map((c) => {
    const cours = [...index.parClasse.values()].filter((x) => x.c === c.id)
    return { ...c, cours: cours.filter((x) => !x.permanence).length, permanences: cours.filter((x) => x.permanence).length }
  })
  const enseignants = cfg.enseignants.map((e) => ({ cle: e.cle, nom: nomEnseignant(e), heures: [...index.parEns.keys()].filter((k) => k.startsWith(e.cle + "|")).length }))
    .filter((e) => e.heures).sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
  return { classes, enseignants }
}

/** Texte d'une case (exports). */
function texteCase(x, cible) {
  if (x.type === "cours") return [x.discipline, cible.classe ? x.nomEnseignant : x.classe, x.salle].filter(Boolean).join("\n")
  if (x.type === "perm") return t("Permanence")
  if (x.type === "ferme") return x.libelle || t("Pas de cours")
  if (x.type === "pause") return x.libelle || ""
  return ""
}

/**
 * PDF (paysage) : une page par classe ou par enseignant, en-tête (établissement, année, période, classe), pied de page (date).
 * cibles : [{ classe: id, titre } | { enseignant: cle, titre }] ; format : "a4" | "a3".
 */
export async function pdfEmploiDuTemps({ cfg, grille, entete, cibles, format = "a4", nomFichier }) {
  const { jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format })
  const L = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 10
  const index = indexer(cfg, grille)
  const pdf = (v) => String(v ?? "").replace(/[  ]/g, " ")
  const genere = new Date().toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })
  const grand = format === "a3"
  cibles.forEach((cible, k) => {
    if (k) doc.addPage()
    const tab = tableauSemaine(cfg, index, cible)
    doc.setFont("helvetica", "bold"); doc.setFontSize(grand ? 15 : 12); doc.setTextColor(33, 37, 41)
    doc.text(pdf(entete.etablissement), M, M + 4)
    doc.setFont("helvetica", "normal"); doc.setFontSize(grand ? 11 : 9); doc.setTextColor(73, 80, 87)
    doc.text(pdf(`${t("Année scolaire")} ${entete.annee} · ${libellePeriode(entete.periode)}${entete.version ? " · " + entete.version : ""}`), M, M + 10)
    doc.setFont("helvetica", "bold"); doc.setFontSize(grand ? 20 : 15); doc.setTextColor(33, 37, 41)
    doc.text(pdf(cible.titre), L - M, M + 6, { align: "right" })
    doc.setFont("helvetica", "normal"); doc.setFontSize(grand ? 10 : 8); doc.setTextColor(108, 117, 125)
    doc.text(pdf(cible.classe ? t("Emploi du temps de la classe") : t("Emploi du temps de l'enseignant")), L - M, M + 11, { align: "right" })
    const largeurHeure = grand ? 30 : 22
    autoTable(doc, {
      startY: M + 15, margin: { left: M, right: M, bottom: M + 6 }, theme: "grid",
      head: [[t("Horaire"), ...tab.jours.map((j) => nomJour(j))]],
      body: tab.lignes.map((l) => [pdf(l.libelle), ...l.cases.map((x) => pdf(texteCase(x, cible)))]),
      styles: { font: "helvetica", fontSize: grand ? 9 : 7.4, cellPadding: grand ? 1.8 : 1.2, valign: "middle", halign: "center", lineColor: [173, 181, 189], lineWidth: 0.2, textColor: [33, 37, 41], overflow: "linebreak" },
      headStyles: { fillColor: [233, 236, 239], textColor: [33, 37, 41], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: largeurHeure, fontStyle: "bold", fillColor: [248, 249, 250] } },
      didParseCell: (c) => {
        if (c.section !== "body" || c.column.index === 0) return
        const l = tab.lignes[c.row.index], x = l.cases[c.column.index - 1]
        if (l.type === "pause" || x.type === "pause") { c.cell.styles.fillColor = [233, 236, 239]; c.cell.styles.textColor = [108, 117, 125]; c.cell.styles.fontStyle = "italic"; c.cell.styles.minCellHeight = 4 }
        else if (x.type === "ferme") { c.cell.styles.fillColor = [222, 226, 230]; c.cell.styles.textColor = [108, 117, 125]; c.cell.styles.fontStyle = "italic" }
        else if (x.type === "perm") { c.cell.styles.fillColor = [241, 243, 245]; c.cell.styles.fontStyle = "italic" }
        else if (x.type === "cours") { c.cell.styles.fillColor = couleur(x.discipline).rgb }
        if (l.type === "periode") c.cell.styles.minCellHeight = grand ? 16 : 11
      },
      didDrawPage: () => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(108, 117, 125)
        doc.text(pdf(t("Généré le {v0} avec NexIA School", { v0: genere })), M, H - 5)
        doc.text(pdf(`${doc.internal.getCurrentPageInfo().pageNumber}`), L - M, H - 5, { align: "right" })
      },
    })
  })
  if (nomFichier) doc.save(nomFichier)
  return doc
}

/** Feuilles Excel : une par classe (périodes en lignes, jours en colonnes) puis un récapitulatif. */
export function feuillesExcel({ cfg, grille, entete }) {
  const index = indexer(cfg, grille)
  const feuilles = []
  const titres = new Set()
  for (const c of classesDe(cfg)) {
    const tab = tableauSemaine(cfg, index, { classe: c.id })
    let titre = c.libelle.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Classe", n = 2
    while (titres.has(titre)) titre = `${titre.slice(0, 26)} ${n++}`
    titres.add(titre)
    feuilles.push({
      titre, intitule: `${entete.etablissement} — ${c.libelle} — ${entete.annee} · ${libellePeriode(entete.periode)}`,
      entetes: [t("Horaire"), ...tab.jours.map((j) => nomJour(j))],
      lignes: tab.lignes.map((l) => [l.libelle, ...l.cases.map((x) => texteCase(x, { classe: c.id }).replace(/\n/g, " — "))]),
      largeurs: [16, ...tab.jours.map(() => 30)],
    })
  }
  const tot = totaux(cfg, grille)
  feuilles.push({
    titre: t("Récapitulatif"), intitule: `${entete.etablissement} — ${t("Récapitulatif")} — ${entete.annee} · ${libellePeriode(entete.periode)}`,
    entetes: [t("Classe ou enseignant"), t("Heures de cours"), t("Heures de permanence")],
    lignes: [...tot.classes.map((c) => [c.libelle, c.cours, c.permanences]), [], ...tot.enseignants.map((e) => [e.nom, e.heures, ""])],
    largeurs: [36, 16, 20],
  })
  return feuilles
}

export async function excelEmploiDuTemps({ cfg, grille, entete, nom }) {
  await telechargerClasseur(feuillesExcel({ cfg, grille, entete }), nom)
}

/** Différences entre deux grilles : cases modifiées, par classe. */
export function comparer(cfgA, grilleA, cfgB, grilleB) {
  const a = indexer(cfgA, grilleA).parClasse, b = indexer(cfgB, grilleB).parClasse
  const cles = new Set([...a.keys(), ...b.keys()])
  const res = new Map()
  for (const k of cles) {
    const x = a.get(k), y = b.get(k)
    const dx = x ? `${x.discipline}|${x.nomEnseignant}|${x.salle}` : "", dy = y ? `${y.discipline}|${y.nomEnseignant}|${y.salle}` : ""
    if (dx === dy) continue
    const [c] = k.split("|")
    const r = res.get(c) || { classe: (x || y).classe, cases: new Set() }
    r.cases.add(k); res.set(c, r)
  }
  return { classes: [...res.entries()].map(([id, r]) => ({ id, classe: r.classe, n: r.cases.size })).sort((p, q) => q.n - p.n), cases: new Set([...res.values()].flatMap((r) => [...r.cases])) }
}
