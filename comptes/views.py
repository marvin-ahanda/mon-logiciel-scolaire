from django.contrib import messages
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST

from scolarite.models import Etablissement

from .codes import attribuer_code, nom_affiche
from .forms import UtilisateurForm
from .roles import est_administration, libelle_role, role_requis

CLE_SESSION = "code_a_afficher"


def montrer_code(request, user, code):
    """Garde le code en session (côté serveur) le temps de l'afficher une seule fois, puis redirige vers sa fiche."""
    if user == request.user:
        update_session_auth_hash(request, user)       # ne pas déconnecter l'administrateur qui change son propre code
    request.session[CLE_SESSION] = {"pk": user.pk, "code": code}
    return redirect("code_acces", user.pk)


@role_requis(est_administration)
def utilisateurs(request):
    liste = User.objects.prefetch_related("groups").select_related("enseignant", "acces").order_by("-is_active", "last_name", "first_name")
    return render(request, "comptes/utilisateurs.html", {"lignes": [(u, nom_affiche(u), libelle_role(u)) for u in liste]})


@role_requis(est_administration)
def utilisateur_formulaire(request, pk=None):
    u = get_object_or_404(User, pk=pk) if pk else User()
    form = UtilisateurForm(request.POST or None, instance=u, demandeur=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        if form.code:
            return montrer_code(request, form.instance, form.code)
        messages.success(request, f"Compte de {nom_affiche(form.instance)} enregistré.")
        return redirect("utilisateurs")
    return render(request, "scolarite/formulaire.html", {
        "form": form, "titre": f"Compte de {nom_affiche(u)}" if pk else "Nouveau membre du personnel", "url_retour": "/comptes/",
    })


@never_cache
@role_requis(est_administration)
def code_acces(request, pk):
    """Fiche du code d'accès : le code n'est lisible qu'une fois, juste après sa génération (il est ensuite haché)."""
    u = get_object_or_404(User, pk=pk)
    donnees = request.session.pop(CLE_SESSION, None)
    code = donnees["code"] if donnees and donnees.get("pk") == u.pk else None
    return render(request, "comptes/code_acces.html", {"personne": u, "nom": nom_affiche(u), "role": libelle_role(u), "code": code,
                                                       "etablissement": Etablissement.courant()})


@require_POST
@role_requis(est_administration)
def regenerer_code(request, pk):
    u = get_object_or_404(User, pk=pk, is_active=True)
    return montrer_code(request, u, attribuer_code(u))
