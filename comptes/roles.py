"""Rôles d'accès d'OtourixSchool.

- Administration : le principal et ses proches collaborateurs (directeurs des études…). Tous les droits.
- Caissier : encaissement de l'écolage, reçus, situation des classes, journal. Les réductions, remboursements,
  tarifs restent des décisions de l'administration ; le caissier peut annuler ses propres paiements du jour.
- Surveillant général : discipline (appel du jour, infractions, suivi disciplinaire).
- Enseignant : saisie des notes de ses matières, résultats et bulletins de ses classes
  (compte lié à une fiche enseignant).

Les rôles sont des groupes Django ; un superutilisateur est toujours considéré comme administration.
"""

from functools import wraps

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect

ADMINISTRATION = "Administration"
CAISSE = "Caisse"
SURVEILLANCE = "Surveillance"
ROLES = [(ADMINISTRATION, "Administration (tous les droits)"), (CAISSE, "Caissier"), (SURVEILLANCE, "Surveillant général")]


def _groupes(user):
    if not hasattr(user, "_groupes_otourix"):
        user._groupes_otourix = set(user.groups.values_list("name", flat=True)) if user.is_authenticated else set()
    return user._groupes_otourix


def est_administration(user):
    return user.is_authenticated and user.is_active and (user.is_superuser or ADMINISTRATION in _groupes(user))


def est_caissier(user):
    return user.is_authenticated and user.is_active and CAISSE in _groupes(user)


def est_surveillant(user):
    return user.is_authenticated and user.is_active and SURVEILLANCE in _groupes(user)


def peut_gerer_discipline(user):
    return est_administration(user) or est_surveillant(user)


def est_enseignant(user):
    return user.is_authenticated and getattr(user, "enseignant", None) is not None


def peut_encaisser(user):
    return est_administration(user) or est_caissier(user)


def libelle_role(user):
    if est_administration(user):
        return "Administration"
    if est_caissier(user):
        return "Caissier"
    if est_surveillant(user):
        return "Surveillant général"
    if est_enseignant(user):
        return "Enseignant"
    return "Aucun rôle"


def role_requis(*tests):
    """Décorateur : l'utilisateur doit satisfaire au moins un des tests (ex. peut_encaisser)."""
    def deco(vue):
        @wraps(vue)
        def wrapper(request, *args, **kwargs):
            if not any(t(request.user) for t in tests):
                messages.error(request, "Vous n'avez pas les droits nécessaires pour cette page.")
                return redirect("accueil")
            return vue(request, *args, **kwargs)
        return login_required(wrapper)
    return deco
