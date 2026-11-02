from django.contrib import messages
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404, redirect, render

from .forms import UtilisateurForm
from .roles import est_administration, libelle_role, role_requis


@role_requis(est_administration)
def utilisateurs(request):
    liste = User.objects.prefetch_related("groups").select_related("enseignant").order_by("-is_active", "username")
    return render(request, "comptes/utilisateurs.html", {"lignes": [(u, libelle_role(u)) for u in liste]})


@role_requis(est_administration)
def utilisateur_formulaire(request, pk=None):
    u = get_object_or_404(User, pk=pk) if pk else User()
    form = UtilisateurForm(request.POST or None, instance=u, demandeur=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, f"Compte « {form.instance.username} » enregistré.")
        return redirect("utilisateurs")
    return render(request, "scolarite/formulaire.html", {
        "form": form, "titre": f"Compte « {u.username} »" if pk else "Nouveau compte", "url_retour": "/comptes/",
    })
