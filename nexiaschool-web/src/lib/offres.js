// Offres d'abonnement et fonctions avancées qu'elles ouvrent (même table que la base : supabase/migrations/0028_offres.sql).
// Chaque rôle voit toutes ses rubriques ; celles que l'offre ne comprend pas sont montrées floutées, avec l'invitation
// à passer à une offre supérieure. La base refuse de toute façon les écritures hors offre.

export const ORDRE_OFFRES = ["decouverte", "essentiel", "pro", "premium"]
export const NOMS_OFFRES = { decouverte: "Découverte", essentiel: "Essentiel", pro: "Pro", premium: "Premium" }

/** Offre minimale de chaque fonction (les fonctions de base sont comprises dans toutes les offres). Même table que la base
 *  (offre_requise, migrations 0028 et 0029). Le propriétaire de la plateforme peut, établissement par établissement, activer
 *  ou désactiver chacune pour une durée choisie (console) : l'application lit alors les droits effectifs (mes_fonctions). */
export const OFFRE_REQUISE = {
  notes: "decouverte", appel: "decouverte", bulletins: "decouverte", excel_base: "decouverte", plafonds: "pro",
  discipline: "essentiel", finances: "essentiel", decisions: "essentiel", qr: "essentiel", excel: "essentiel",
  smarteval: "pro", edt: "pro", parents: "pro", statistiques: "pro",
  ia: "premium", distinctions: "decouverte", cartes: "decouverte", parcours: "decouverte",
}

/** Libellé de chaque fonction (fenêtre « passer à une offre supérieure »). */
export const LIBELLES_FONCTIONS = {
  notes: "Saisie des notes",
  appel: "Appel du jour (absences, retards)",
  bulletins: "Bulletins (édition et impression)",
  excel_base: "Import et export Excel des élèves, classes et matières",
  plafonds: "Effectifs illimités (élèves et personnel)",
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
  distinctions: "Récompenses et distinctions (tableaux d'honneur, certificats)",
  cartes: "Cartes scolaires (modèles, cachet et signature, QR code)",
  parcours: "Parcours, séries, orientation et décisions de passage",
}

/** Rubriques de l'application réservées à une fonction (le chemin le plus précis l'emporte). */
const RUBRIQUES = [
  ["/notes/saisie", "notes"], ["/notes/bulletins", "bulletins"], ["/discipline/appel", "appel"],
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

/** Toutes les fonctionnalités réglables, dans l'ordre d'affichage de la console. */
export const FONCTIONS = ["notes", "appel", "bulletins", "excel_base", "plafonds", "discipline", "finances", "decisions", "qr", "excel",
  "smarteval", "edt", "parents", "statistiques", "ia", "distinctions", "cartes", "parcours"]

/** Droit effectif : celui lu sur le serveur (dérogations comprises) s'il est connu, sinon celui de l'offre. */
export function droitEffectif(fonctions, offre, fonction) {
  const v = fonctions?.[fonction]
  return typeof v === "boolean" ? v : offreInclut(offre, fonction)
}
