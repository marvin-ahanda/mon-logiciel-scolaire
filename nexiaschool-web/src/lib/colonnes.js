// Colonnes lisibles par le personnel (les empreintes des codes et les compteurs d'essais sont interdits de lecture :
// une requête « select * » sur ces tables est refusée par la base).
export const COLONNES_PERSONNEL = "id, etablissement_id, nom, prenom, role, matricule, telephone, actif, compte_google, code_genere_le, derniere_connexion, cree_le"
export const COLONNES_ETABLISSEMENT = "id, nom, ville, adresse, telephone, devise, nom_chef, code_genere_le, cree_le, api_active, site_web, logo, notes_surveillants, notes_comptables"
