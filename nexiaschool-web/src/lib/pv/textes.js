// Textes des PV : synthèses rédigées uniquement à partir des données calculées par le moteur (aucune donnée inventée),
// libellés des avertissements et des recommandations. Traduits dans la langue de l'utilisateur au moment de l'affichage.
import { t } from "../../i18n.jsx"
import { note, pourcentage } from "../format.js"

const present = (v) => v !== null && v !== undefined
const nom = (e) => [e?.nom?.toUpperCase(), e?.prenom].filter(Boolean).join(" ")

/** Types de documents (titres des volets et du registre). */
export const TYPES_PV = {
  classe: "PV de classe",
  cycle: "PV par cycle",
  etablissement: "PV général de l'établissement",
  individuel: "PV de performances individuelles",
  publication: "Publication des PV individuels aux parents",
}

/** Message d'un contrôle de complétude. */
export function texteControle(a) {
  switch (a.code) {
    case "eleves": return t("Aucun élève dans la sélection.")
    case "matieres": return t("Aucune matière dans la sélection.")
    case "notes": return t("Aucune note n'est saisie pour cette sélection : le PV serait vide.")
    case "manquantes": return t("{v0} note(s) manquante(s) chez {v1} élève(s).", { v0: a.n, v1: a.eleves })
    case "sans_note": return t("{v0} élève(s) sans aucune note.", { v0: a.n })
    case "matieres_vides": return t("{v0} matière(s) sans aucune note.", { v0: a.n })
    case "exclus": return t("{v0} élève(s) aux notes incomplètes écarté(s) à votre demande.", { v0: a.n })
    default: return a.code
  }
}

/** Synthèse du PV de classe. */
export function syntheseClasse(pv) {
  const g = pv.global, s = []
  s.push(t("{v0} élève(s), {v1} note(s) attendue(s), {v2} saisie(s) ({v3} manquante(s)).",
    { v0: g.effectif, v1: g.notesAttendues, v2: g.notesPresentes, v3: pourcentage(g.tauxManquantes) }))
  if (present(g.tauxReussite)) s.push(t("Notes égales ou supérieures à {v0}/20 : {v1} ; notes inférieures : {v2}.",
    { v0: note(pv.seuil), v1: pourcentage(g.tauxReussite), v2: pourcentage(g.tauxEchec) }))
  if (pv.matieresFaibles.length) s.push(t("Matière(s) la(les) plus faible(s) : {v0}.",
    { v0: pv.matieresFaibles.map((m) => `${m.matiere} (${pourcentage(m.tauxReussite)})`).join(", ") }))
  if (pv.meilleures[0]) s.push(t("Meilleure note : {v0}/20 en {v1} ({v2}).", { v0: note(pv.meilleures[0].note), v1: pv.meilleures[0].matiere, v2: nom(pv.meilleures[0].eleve) }))
  s.push(pv.enDifficulte.length ? t("{v0} élève(s) en difficulté.", { v0: pv.enDifficulte.length }) : t("Aucun élève en difficulté selon les seuils de l'établissement."))
  if (g.heuresNJ + g.heuresJ > 0) s.push(t("Absences : {v0} h non justifiée(s), {v1} h justifiée(s) ; {v2} des élèves ont au moins une absence.",
    { v0: g.heuresNJ, v1: g.heuresJ, v2: pourcentage(g.tauxAbsents) }))
  return s
}

/** Synthèse d'un PV par cycle ou du PV général. comparaison : résultat de comparer() et son libellé. */
export function syntheseGroupe(pv, { comparaison = null, libelleComparaison = "" } = {}) {
  const g = pv.global, s = []
  s.push(t("{v0} élève(s) dans {v1} classe(s) ; {v2} évalué(s).", { v0: g.effectif, v1: pv.parClasse.length, v2: g.evalues }))
  if (present(g.tauxReussite)) s.push(t("Taux de réussite : {v0} (moyenne générale {v1}/20) ; taux d'échec : {v2}.",
    { v0: pourcentage(g.tauxReussite), v1: note(g.moyenne), v2: pourcentage(g.tauxEchec) }))
  const classees = pv.parClasse.filter((c) => present(c.tauxReussite))
  if (classees.length > 1) {
    const tri = [...classees].sort((a, b) => b.tauxReussite - a.tauxReussite)
    s.push(t("Classe la plus performante : {v0} ({v1}) ; la plus faible : {v2} ({v3}).",
      { v0: tri[0].classe.libelle, v1: pourcentage(tri[0].tauxReussite), v2: tri.at(-1).classe.libelle, v3: pourcentage(tri.at(-1).tauxReussite) }))
  }
  if (pv.matieresFaibles.length) s.push(t("Matière(s) la(les) plus faible(s) : {v0}.",
    { v0: pv.matieresFaibles.map((m) => `${m.matiere} (${pourcentage(m.tauxReussite)})`).join(", ") }))
  if (g.evalues) s.push(t("{v0} élève(s) en difficulté ({v1}).", { v0: g.enDifficulte, v1: pourcentage(g.tauxDifficulte) }))
  if (g.comparables) s.push(t("Par rapport à la période précédente : {v0} des élèves progressent, {v1} régressent.",
    { v0: pourcentage(g.tauxProgression), v1: pourcentage(g.tauxRegression) }))
  if (g.effectif) s.push(t("Taux de présence : {v0} ({v1} h d'absence non justifiée).", { v0: pourcentage(g.tauxPresence), v1: g.heuresNJ }))
  if (g.financeConnue) s.push(t("Pension : {v0} des élèves à jour, {v1} non à jour.", { v0: pourcentage(g.tauxAJour), v1: pourcentage(g.tauxInsolvables) }))
  if (pv.aSuivre.matieres.length) s.push(t("Matière(s) nécessitant un suivi (réussite sous {v0}) : {v1}.",
    { v0: pourcentage(pv.aSuivre.seuil), v1: pv.aSuivre.matieres.map((m) => m.matiere).join(", ") }))
  if (comparaison) {
    const r = comparaison.global.find((x) => x.cle === "tauxReussite")
    if (r && present(r.ecart)) s.push(t("Comparaison avec {v0} : taux de réussite {v1} ({v2} point(s)).",
      { v0: libelleComparaison, v1: pourcentage(r.reference), v2: `${r.ecart > 0 ? "+" : ""}${note(r.ecart)}` }))
  }
  return s
}

/** Texte d'une recommandation. */
export function texteRecommandation(r) {
  switch (r.code) {
    case "renforcer": return t("Renforcer le travail en {v0}.", { v0: r.matiere })
    case "surveiller": return t("Surveiller la baisse des résultats en {v0}.", { v0: r.matiere })
    case "assiduite": return t("Veiller à l'assiduité : {v0} h d'absence non justifiée.", { v0: r.heures })
    case "ponctualite": return t("Veiller à la ponctualité : {v0} retard(s).", { v0: r.retards })
    case "encourager": return t("Très bons résultats : encourager l'élève à maintenir ses efforts.")
    default: return ""
  }
}

/** Synthèse lisible par les parents (PV individuel). */
export function syntheseIndividuelle(c) {
  const s = []
  if (present(c.moyenne)) {
    s.push(present(c.moyenneClasse)
      ? t("Moyenne de la période : {v0}/20 (moyenne de la classe : {v1}/20).", { v0: note(c.moyenne), v1: note(c.moyenneClasse) })
      : t("Moyenne de la période : {v0}/20.", { v0: note(c.moyenne) }))
  } else s.push(t("Pas encore de moyenne pour cette période."))
  if (present(c.variationGenerale)) s.push(c.variationGenerale > 0
    ? t("Progression de {v0} point(s) par rapport à la période précédente.", { v0: note(c.variationGenerale) })
    : c.variationGenerale < 0 ? t("Baisse de {v0} point(s) par rapport à la période précédente.", { v0: note(-c.variationGenerale) })
      : t("Résultats stables par rapport à la période précédente."))
  if (c.fortes.length) s.push(t("Points forts : {v0}.", { v0: c.fortes.join(", ") }))
  if (c.faibles.length) s.push(t("Points à améliorer : {v0}.", { v0: c.faibles.join(", ") }))
  if (c.absences.nj + c.absences.j > 0 || c.absences.retards > 0) s.push(t("Absences : {v0} h non justifiée(s), {v1} h justifiée(s) ; retards : {v2}.",
    { v0: c.absences.nj, v1: c.absences.j, v2: c.absences.retards }))
  if (c.distinctions.length) s.push(t("Distinction(s) : {v0}.", { v0: c.distinctions.join(", ") }))
  return s
}
