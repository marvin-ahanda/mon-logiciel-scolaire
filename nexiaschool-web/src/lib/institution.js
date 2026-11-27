// Pilotage institutionnel : libellés, structure des fiches de synthèse et petites aides d'affichage.
// Les indicateurs officiels du document (taux pondérés, anomalies, consolidation) sont calculés par le serveur
// (fonction _inst_indicateurs) : ce fichier ne sert qu'à l'affichage et à la saisie.
import { t } from "../i18n.jsx"

export const PERIODES = { t1: "1er trimestre", t2: "2e trimestre", t3: "3e trimestre", annuel: "Bilan annuel" }
export const periode = (p) => t(PERIODES[p] || p)

export const STATUTS_FICHE = {
  non_commencee: "Non commencée", non_publiee: "Non publiée", brouillon: "Brouillon", prete: "Prête à publier", publiee: "Publiée",
  en_examen: "En cours d'examen", correction_demandee: "Correction demandée", corrigee: "Corrigée", republiee: "Republiée",
  examinee: "Reçue et examinée", archivee: "Archivée",
}
export const statutFiche = (s) => t(STATUTS_FICHE[s] || s)
export const COULEURS_STATUT = {
  non_publiee: "secondary", brouillon: "secondary", prete: "info", publiee: "primary", en_examen: "primary", correction_demandee: "warning",
  corrigee: "warning", republiee: "primary", examinee: "success", archivee: "dark",
}

export const STATUTS_DEMANDE = { brouillon: "Brouillon", soumise: "Soumise", en_verification: "En vérification", approuvee: "Approuvée", rejetee: "Rejetée", suspendue: "Suspendue" }
export const statutDemande = (s) => t(STATUTS_DEMANDE[s] || s)

export const STATUTS_COURRIER = { brouillon: "Brouillon", envoye: "Envoyé", distribue: "Distribué", lu: "Lu", repondu: "Réponse reçue", archive: "Archivé" }
export const statutCourrier = (s) => t(STATUTS_COURRIER[s] || s)

export const PERMISSIONS = { examen: "Examen des fiches et relances", courriers: "Courriers", synthese: "Synthèse" }
export const CATEGORIES_IA = { statuts: "Statuts de transmission", indicateurs: "Indicateurs consolidés", detail_lignes: "Détail des lignes des fiches", noms_enseignants: "Noms des enseignants", courriers: "Suivi des courriers" }

/** Indicateurs, dans l'ordre du document, avec leurs libellés. */
export const INDICATEURS = [
  ["couverture_theorie", "Couverture des programmes — théorie"],
  ["couverture_pratique", "Couverture des programmes — pratique"],
  ["heures_theorie", "Heures faites / dues — théorie"],
  ["heures_pratique", "Heures faites / dues — pratique"],
  ["assiduite_enseignants", "Assiduité des enseignants"],
  ["assiduite_eleves", "Assiduité des élèves"],
]

/** Colonnes numériques d'une ligne de la fiche (page 2 : leçons ; page 3 : heures). */
export const CHAMPS_LECONS = [
  ["prevues_t", "Prévues théorie"], ["prevues_p", "Prévues pratique"],
  ["faites_t", "Faites en présentiel théorie"], ["faites_p", "Faites en présentiel pratique"],
  ["digit_t", "Digitalisées faites théorie"], ["digit_p", "Digitalisées faites pratique"],
]
export const CHAMPS_HEURES = [
  ["heures_dues_t", "Heures dues théorie"], ["heures_dues_p", "Heures dues pratique"],
  ["heures_faites_t", "Heures faites théorie"], ["heures_faites_p", "Heures faites pratique"],
]
export const CHAMPS = [...CHAMPS_LECONS, ...CHAMPS_HEURES].map(([k]) => k)

/** Valeur saisie : nombre, « na » (non applicable) ou null (manquante). */
export function lireValeur(brut) {
  const s = String(brut ?? "").trim().replace(",", ".")
  if (!s) return null
  if (/^(na|n\/a|nc|-)$/i.test(s)) return "na"
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
export const afficherValeur = (v) => (v === null || v === undefined ? "" : v === "na" ? "NA" : String(v))

/** Taux d'une ligne pour l'aperçu de saisie (même règle que le serveur : null si incomplet, non applicable ou dénominateur nul). */
export function tauxLigne(ligne, numerateurs, denominateur) {
  const d = ligne?.[denominateur]
  const ns = numerateurs.map((k) => ligne?.[k])
  if (typeof d !== "number" || d <= 0 || ns.some((n) => typeof n !== "number")) return null
  return Math.round((ns.reduce((a, b) => a + b, 0) / d) * 10000) / 100
}

/** Ligne vide (saisie manuelle). */
export const ligneVide = () => ({ classe: "", discipline: "", enseignant: "", source: "manuel", ...Object.fromEntries(CHAMPS.map((k) => [k, null])) })

/** Brouillon complet à partir de ce que renvoie le serveur (champs absents → valeurs manquantes). */
export function normaliserBrouillon(b = {}) {
  return {
    lignes: (b.lignes || []).map((l) => ({ ...ligneVide(), ...l })),
    synthese: { eleves: null, enseignants: null, classes: null, disciplines: null, ...(b.synthese || {}) },
    assiduite: {
      enseignants: { heures_dues: null, heures_absence: null, ...(b.assiduite?.enseignants || {}) },
      eleves: { heures_dues: null, heures_absence: null, ...(b.assiduite?.eleves || {}) },
    },
    sources: b.sources || {},
    responsable: b.responsable || "",
    observations: b.observations || "",
    difficultes: b.difficultes || "",
    recommandations: b.recommandations || "",
    periodes_manquantes: b.periodes_manquantes || [],
  }
}

/** Source d'une valeur de la synthèse : calculée, saisie, manquante, non applicable. */
export function sourceValeur(valeur, source) {
  if (valeur === "na") return "non_applicable"
  if (valeur === null || valeur === undefined) return "manquante"
  return source === "auto" ? "calculee" : "saisie"
}
export const SOURCES = { calculee: "Calculée automatiquement", saisie: "Saisie manuellement", manquante: "Manquante", non_applicable: "Non applicable" }

/** Nombre d'anomalies par niveau. */
export function compterAnomalies(anomalies = []) {
  return anomalies.reduce((acc, a) => ({ ...acc, [a.niveau]: (acc[a.niveau] || 0) + 1 }), { bloquant: 0, alerte: 0, info: 0 })
}

export const MENTION_NON_OFFICIELLE = "Document généré avec NexIA School, service indépendant : il n'émane pas du MINESEC et ne vaut pas document officiel sans validation par l'autorité compétente."
export const MENTION_FORMULES = "Formules de calcul en attente de validation : les taux sont indicatifs."
