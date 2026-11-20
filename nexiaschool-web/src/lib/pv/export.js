// Exports Excel (.xlsx) et CSV des PV, pour une analyse approfondie (mêmes chiffres que le PDF).
import { telechargerClasseur } from "../excel.js"
import { t } from "../../i18n.jsx"

const nom = (e) => [e?.nom?.toUpperCase(), e?.prenom].filter(Boolean).join(" ")
const v = (x) => (x === null || x === undefined ? "" : x)

/** Feuilles du PV de classe. */
export function feuillesPvClasse(pv, { titre, moyennes = false, observationDe = null }) {
  const plusieurs = new Set(pv.colonnes.map((c) => c.periode)).size > 1
  return [
    { titre: t("Notes"), intitule: titre,
      entetes: ["#", t("Élève"), t("Matricule"), ...pv.colonnes.map((c) => (plusieurs ? `${c.matiere} (${c.periodeLibelle})` : c.matiere)),
        ...(moyennes ? (pv.lignes[0]?.moyennes || []).map((_, k) => t("Moy. {v0}", { v0: k + 1 })) : []), t("Notes sous le seuil"), t("Notes manquantes"),
        t("Heures NJ"), t("Heures J"), t("Retards"), ...(observationDe ? [t("Observation")] : [])],
      lignes: pv.lignes.map((l, k) => [k + 1, nom(l.eleve), l.eleve.matricule, ...l.notes.map(v), ...(moyennes ? (l.moyennes || []).map(v) : []),
        l.echecs, l.manquantes, l.absences.nj, l.absences.j, l.absences.retards, ...(observationDe ? [observationDe(l)] : [])]) },
    { titre: t("Matières"), intitule: titre,
      entetes: [t("Matière"), t("Période"), t("Enseignant"), t("Notes"), t("Manquantes"), t("Réussite (%)"), t("Échec (%)"), t("Note max."), t("Note min.")],
      lignes: pv.matieres.map((m) => [m.matiere, m.periodeLibelle, m.enseignant, m.n, m.manquantes, v(m.tauxReussite), v(m.tauxEchec), v(m.max), v(m.min)]) },
  ]
}

/** Feuilles d'un PV par cycle ou du PV général. */
export function feuillesPvGroupe(pv, { titre, evolution = [], comparaison = null, libelleComparaison = "" }) {
  const g = pv.global
  const feuilles = [
    { titre: t("Synthèse"), intitule: titre, entetes: [t("Indicateur"), t("Valeur")], lignes: [
      [t("Effectif"), g.effectif], [t("Évalués"), g.evalues], [t("Moyenne"), v(g.moyenne)], [t("Réussite (%)"), v(g.tauxReussite)], [t("Échec (%)"), v(g.tauxEchec)],
      [t("En difficulté (%)"), v(g.tauxDifficulte)], [t("Progression (%)"), v(g.tauxProgression)], [t("Régression (%)"), v(g.tauxRegression)],
      [t("Présence (%)"), v(g.tauxPresence)], [t("Heures NJ"), g.heuresNJ], [t("Garçons"), g.garcons], [t("Filles"), g.filles],
      ...(g.financeConnue ? [[t("À jour de pension (%)"), v(g.tauxAJour)], [t("Non à jour (%)"), v(g.tauxInsolvables)]] : [])] },
    { titre: t("Classes"), intitule: titre,
      entetes: [t("Classe"), t("Cycle"), t("Niveau"), t("Section"), t("Effectif"), t("Garçons"), t("Filles"), t("Moyenne"), t("Réussite (%)"), t("Échec (%)"),
        t("En difficulté"), t("Élèves absents au moins une fois (%)"), t("À jour (%)")],
      lignes: pv.parClasse.map((c) => [c.classe.libelle, c.classe.cycleLibelle, c.classe.niveauLibelle, c.classe.sectionLibelle, c.effectif, c.garcons, c.filles,
        v(c.moyenne), v(c.tauxReussite), v(c.tauxEchec), c.enDifficulte, v(c.tauxAbsenteisme), v(c.tauxAJour)]) },
    { titre: t("Matières"), intitule: titre, entetes: [t("Matière"), t("Notes"), t("Moyenne"), t("Réussite (%)"), t("Échec (%)")],
      lignes: pv.parMatiere.map((m) => [m.matiere, m.n, v(m.moyenne), v(m.tauxReussite), v(m.tauxEchec)]) },
    { titre: t("Élèves en difficulté"), intitule: titre, entetes: [t("Élève"), t("Matricule"), t("Classe"), t("Moyenne")],
      lignes: pv.enDifficulte.map((x) => [nom(x.eleve), x.eleve.matricule, x.classe.libelle, x.moyenne]) },
  ]
  if (pv.parEnseignant) feuilles.push({ titre: t("Enseignants"), intitule: titre, entetes: [t("Enseignant"), t("Matières"), t("Classes"), t("Notes"), t("Moyenne"), t("Réussite (%)")],
    lignes: pv.parEnseignant.map((e) => [e.enseignant, e.matieres.join(", "), e.classes.join(", "), e.n, v(e.moyenne), v(e.tauxReussite)]) })
  if (evolution.length) feuilles.push({ titre: t("Évolution"), intitule: titre, entetes: [t("Période"), t("Moyenne"), t("Réussite (%)")],
    lignes: evolution.map((p) => [p.libelle, v(p.moyenne), v(p.tauxReussite)]) })
  if (comparaison) feuilles.push({ titre: t("Comparaison"), intitule: `${titre} — ${libelleComparaison}`,
    entetes: [t("Classe"), t("Réussite (%)"), `${libelleComparaison} (%)`, t("Écart (points)")],
    lignes: comparaison.classes.map((c) => [c.classe.libelle, v(c.courant), v(c.reference), v(c.ecart)]) })
  return feuilles
}

/** Feuille des PV individuels (une ligne par élève et par matière). */
export function feuillesPvIndividuels(contenus, { titre }) {
  return [{ titre: t("PV individuels"), intitule: titre,
    entetes: [t("Élève"), t("Matricule"), t("Classe"), t("Matière"), t("Note"), t("Moy. classe"), t("Écart"), t("Évolution"), t("Moyenne"), t("Heures NJ"), t("Retards")],
    lignes: contenus.flatMap((c) => c.matieres.map((m) => [nom(c.eleve), c.eleve.matricule, c.classe, m.matiere, v(m.note), v(m.moyenneClasse), v(m.ecartClasse),
      v(m.variation), v(c.moyenne), c.absences.nj, c.absences.retards])) }]
}

export const telechargerExcel = (feuilles, nomFichier) => telechargerClasseur(feuilles, nomFichier)

/** Cellule CSV sûre : séparateur « ; » (Excel francophone), guillemets doublés, formules neutralisées. */
export function celluleCsv(x) {
  let s = String(x ?? "")
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Texte CSV de plusieurs feuilles, séparées par une ligne vide. */
export function texteCsv(feuilles) {
  return feuilles.map((f) => [...(f.intitule ? [[f.intitule], []] : []), f.entetes, ...f.lignes]
    .map((l) => l.map(celluleCsv).join(";")).join("\r\n")).join("\r\n\r\n")
}

export function telechargerCsv(feuilles, nomFichier) {
  const blob = new Blob(["﻿" + texteCsv(feuilles)], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob); a.download = `${nomFichier}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
