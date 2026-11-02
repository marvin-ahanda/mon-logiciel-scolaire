from django.contrib import messages
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render

from comptes.roles import est_administration, role_requis
from notes.services import periode_depuis_code, periodes_exercice
from scolarite.models import Classe, Exercice

from .services import SEXES, comparaison_classes, effectifs_sexe_age, statistiques_classe


def _exercice(request):
    ex = Exercice.actif_courant()
    if not ex:
        messages.error(request, "Aucun exercice actif. L'administration doit en activer un.")
    return ex


def _barres(lignes, cle, maxi=None):
    """Ajoute la largeur (en %) de chaque barre : rapportée à maxi, ou au plus grand effectif si maxi est omis."""
    if maxi is None:
        maxi = max((l[cle] or 0 for l in lignes), default=0)
    for l in lignes:
        l["largeur"] = round(100 * float(l[cle] or 0) / float(maxi), 1) if maxi else 0
    return lignes


@role_requis(est_administration)
def classe(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    c_id, code = request.GET.get("classe"), request.GET.get("periode")
    ctx = {"classes": Classe.objects.all(), "periodes": periodes_exercice(exercice), "c_id": c_id, "p_code": code,
           "sexes": SEXES, "onglet": "classe"}
    if c_id and code:
        periode = periode_depuis_code(exercice, code)
        if periode is None:
            raise Http404("Période inconnue.")
        ctx.update(classe=get_object_or_404(Classe, pk=c_id), periode=periode, exercice=exercice)
        ctx.update(statistiques_classe(ctx["classe"], exercice, periode))
        _barres(ctx["repartition"], "total")
    return render(request, "statistiques/classe.html", ctx)


@role_requis(est_administration)
def comparaison(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    periodes = periodes_exercice(exercice)
    code = request.GET.get("periode") or (periodes[0].code if periodes else None)
    periode = periode_depuis_code(exercice, code) if code else None
    ctx = {"periodes": periodes, "p_code": code, "periode": periode, "exercice": exercice, "onglet": "comparaison"}
    if periode:
        lignes, niveaux, etablissement = comparaison_classes(exercice, periode)
        ctx.update(lignes=_barres(lignes, "moyenne", 20), niveaux=niveaux, etablissement=etablissement)
    return render(request, "statistiques/comparaison.html", ctx)


@role_requis(est_administration)
def effectifs(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    ref, colonnes, lignes, totaux = effectifs_sexe_age(exercice)
    return render(request, "statistiques/effectifs.html", {
        "exercice": exercice, "ref": ref, "colonnes": colonnes, "lignes": lignes, "totaux": totaux, "onglet": "effectifs",
        "total_garcons": sum(l["garcons"] for l in lignes), "total_filles": sum(l["filles"] for l in lignes)})
