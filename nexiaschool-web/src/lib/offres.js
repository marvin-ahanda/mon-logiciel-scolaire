// Offres d'abonnement et fonctions avancées qu'elles ouvrent (même table que la base : supabase/migrations/0028_offres.sql).
// Chaque rôle voit toutes ses rubriques ; celles que l'offre ne comprend pas sont montrées floutées, avec l'invitation
// à passer à une offre supérieure. La base refuse de toute façon les écritures hors offre.

export const ORDRE_OFFRES = ["decouverte", "essentiel", "pro", "premium"]
export const NOMS_OFFRES = { decouverte: "Découverte", essentiel: "Essentiel", pro: "Pro", premium: "Premium" }

/** Offre minimale de chaque fonction avancée. */
export const OFFRE_REQUISE = {
  discipline: "essentiel", finances: "essentiel", decisions: "essentiel", qr: "essentiel", excel: "essentiel",
  smarteval: "pro", edt: "pro", parents: "pro", statistiques: "pro",
  ia: "premium",
}

/** Libellé de chaque fonction (fenêtre « passer à une offre supérieure »). */
export const LIBELLES_FONCTIONS = {
  discipline: "Discipline complète (infractions, suivi, seuils et alertes)",
  finances: "Finances (frais, paiements, reçus, retards, moratoires)",
  decisions: "Décisions de fin de période",
  qr: "Bulletins authentifiés par QR code anti-fraude",
  excel: "Import et export Excel complets",
  smarteval: "SmartEval (évaluations digitalisées)",
  edt: "Génération automatique des emplois du temps",
  parents: "Espace parents et courrier",
  statistiques: "Statistiques avancées et alertes de retard de saisie",
  ia: "IA intégrée, clés API et connexion des assistants IA (MCP)",
}

/** Rubriques de l'application réservées à une fonction (le chemin le plus précis l'emporte). */
const RUBRIQUES = [
  ["/discipline/infractions", "discipline"], ["/discipline/suivi", "discipline"], ["/discipline/alertes", "discipline"],
  ["/finance", "finances"], ["/courrier", "parents"], ["/smarteval", "smarteval"], ["/emploi-du-temps", "edt"],
  ["/statistiques", "statistiques"], ["/notes/retards", "statistiques"], ["/developpeur", "ia"],
]
// (Paramètres → Décisions et Emploi du temps : onglets verrouillés dans la page elle-même, pour garder les autres onglets utilisables)

/** Offre en vigueur : une offre payante échue retombe sur Découverte. */
export function offreEffective(etablissement, maintenant = Date.now()) {
  const o = etablissement?.offre
  if (!ORDRE_OFFRES.includes(o)) return "decouverte"
  if (etablissement.offre_expire_le && new Date(etablissement.offre_expire_le).getTime() < maintenant) return "decouverte"
  return o
}

export function offreInclut(offre, fonction) {
  const requise = OFFRE_REQUISE[fonction]
  return !requise || ORDRE_OFFRES.indexOf(offre) >= ORDRE_OFFRES.indexOf(requise)
}

/** Fonction avancée d'une adresse de l'application (ou null). */
export function fonctionDuChemin(chemin) {
  const p = (chemin || "").replace(/\/+$/, "") || "/"
  for (const [debut, fonction] of RUBRIQUES) if (p === debut || p.startsWith(debut + "/")) return fonction
  return null
}

/** Plafonds d'effectifs (null = illimité). */
export const PLAFONDS = { decouverte: { eleves: 50, personnels: 10 }, essentiel: { eleves: 500, personnels: null } }
