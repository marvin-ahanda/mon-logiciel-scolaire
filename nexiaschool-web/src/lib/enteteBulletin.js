// En-tête officiel du bulletin (écran, impression, PDF) : lignes de gauche (langue principale) et de droite (traduction),
// puis, sous le logo, nom, devise et spécialisation de l'établissement. Aucune valeur n'est écrite en dur : tout vient de
// la fiche de l'établissement ; les lignes vides sont omises.

const GAUCHE = ["entete_pays", "entete_devise_pays", "entete_ministere", "entete_delegation"]
const DROITE = ["entete_pays_en", "entete_devise_pays_en", "entete_ministere_en", "entete_delegation_en"]
/** Champs de l'en-tête officiel (fiche de l'établissement). */
export const CHAMPS_ENTETE = [...GAUCHE.flatMap((k, i) => [k, DROITE[i]]), "specialisation"]
const propre = (v) => String(v ?? "").trim()

/**
 * Lignes de l'en-tête : { gauche: [{ texte, devise }], droite: [...], centre: { nom, devise, specialisation } }.
 * « devise » (deuxième ligne) est affichée en italique, comme la devise nationale sur les bulletins officiels.
 */
export function lignesEntete(etablissement = {}) {
  const colonne = (cles) => cles.map((k, i) => ({ texte: propre(etablissement[k]), devise: i === 1 })).filter((l) => l.texte)
  return {
    gauche: colonne(GAUCHE),
    droite: colonne(DROITE),
    centre: { nom: propre(etablissement.nom), devise: propre(etablissement.devise), specialisation: propre(etablissement.specialisation) },
  }
}

/** Nom affiché du professeur principal (« M. NOM Prénom » n'est pas imposé : nom puis prénom, comme ailleurs). */
export const nomProfesseurPrincipal = (p) => (p ? [p.nom, p.prenom].map(propre).filter(Boolean).join(" ") : "")
