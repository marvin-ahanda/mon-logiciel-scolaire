// Relances de paiement et courriers de l'école aux parents : statuts affichés, libellés, aperçu des modèles.
// La planification, l'exécution et l'anti-doublon sont faits par la base (migration 0046_relances_insolvabilite.sql).

/** Statut affiché d'un courrier : l'accusé de réception l'emporte sur la lecture, qui l'emporte sur l'envoi. */
export function statutAffiche(c) {
  if (c.statut === "envoye") return c.accuse_le ? "accuse" : c.lu_le ? "lu" : "envoye"
  return c.statut
}

/** Libellé (français, traduit à l'affichage) et couleur Bootstrap de chaque statut. */
export const STATUTS = {
  programme: ["Programmé", "secondary"],
  a_valider: ["À valider", "warning"],
  envoye: ["Envoyé", "primary"],
  lu: ["Lu", "info"],
  accuse: ["Accusé de réception", "success"],
  echoue: ["Échoué", "danger"],
  annule: ["Annulé", "dark"],
  refuse: ["Refusé", "danger"],
}

export const TYPES_EXCLUSION = { bourse: "Bourse", exoneration: "Exonération", accord: "Accord de paiement", paiement_attente: "Paiement en attente", moratoire: "Moratoire accordé" }

export const ACTIONS_JOURNAL = {
  configuration: "Configuration", exclusion: "Exclusion", creation: "Création", modification: "Modification", programmation: "Programmation",
  envoi: "Envoi", echec: "Échec", annulation: "Annulation", lecture: "Lecture", accuse: "Accusé de réception", reponse: "Réponse",
  validation: "Validation", refus: "Refus",
}

/** Variables disponibles dans les modèles de relance et dans le courrier final. */
export const VARIABLES_RELANCE = ["eleve", "classe", "matricule", "tranche", "montant", "date_limite", "jours", "etablissement"]
export const VARIABLES_FINAL = ["eleve", "classe", "matricule", "montant", "etablissement"]

/** Remplace {variable} (même règle que la base) ; une variable inconnue reste visible. */
export function remplir(modele, valeurs) {
  return String(modele ?? "").replace(/\{(\w+)\}/g, (m, k) => (valeurs[k] === undefined || valeurs[k] === null ? m : String(valeurs[k])))
}

/** Contrôle d'un palier avant enregistrement (mêmes règles que la base). Renvoie la liste des problèmes. */
export function problemesPaliers(paliers) {
  const p = []
  if (paliers.length > 10) p.push("trop")
  const jours = paliers.map((x) => Number(x.jours))
  if (new Set(jours).size !== jours.length) p.push("doublon")
  for (const x of paliers) {
    if (!Number.isInteger(Number(x.jours)) || Number(x.jours) < 0 || Number(x.jours) > 60 || String(x.jours).trim() === "") p.push("jours")
    if (!String(x.titre || "").trim() || !String(x.objet || "").trim() || String(x.texte || "").trim().length < 10) p.push("texte")
  }
  return [...new Set(p)]
}

/** Paliers triés du plus lointain (J-10) au jour J. */
export const trierPaliers = (paliers) => [...paliers].sort((a, b) => Number(b.jours) - Number(a.jours))
