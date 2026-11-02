from comptes.roles import est_administration, est_caissier, est_enseignant, est_surveillant, libelle_role

from .models import Etablissement, Exercice


def contexte_ecole(request):
    if not request.user.is_authenticated:
        return {}
    return {
        "etablissement": Etablissement.courant(),
        "exercice_actif": Exercice.actif_courant(),
        "est_admin": est_administration(request.user),
        "est_caissier": est_caissier(request.user),
        "est_enseignant": est_enseignant(request.user),
        "est_surveillant": est_surveillant(request.user),
        "role": libelle_role(request.user),
    }
