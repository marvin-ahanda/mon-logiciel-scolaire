from .models import Etablissement, Exercice


def contexte_ecole(request):
    if not request.user.is_authenticated:
        return {}
    return {
        "etablissement": Etablissement.courant(),
        "exercice_actif": Exercice.actif_courant(),
        "est_admin": request.user.is_staff or request.user.is_superuser,
    }
