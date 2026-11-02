from django.contrib import messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render

from comptes.roles import est_administration, est_enseignant, est_surveillant, role_requis
from scolarite.models import Attribution, Classe, Enseignant, Exercice

from .models import JOURS, Cours, Creneau


def peut_consulter(user):
    return est_administration(user) or est_enseignant(user) or est_surveillant(user)


def _grille(cours):
    """{(jour, creneau_id): cours} pour l'affichage."""
    return {(c.jour, c.creneau_id): c for c in cours}


@role_requis(peut_consulter)
def emploi_classe(request):
    exercice = Exercice.actif_courant()
    if not exercice:
        messages.error(request, "Aucun exercice actif.")
        return redirect("accueil")
    creneaux = list(Creneau.objects.all())
    c_id = request.GET.get("classe")
    ctx = {"classes": Classe.objects.all(), "c_id": c_id, "creneaux": creneaux, "jours": JOURS,
           "modifiable": est_administration(request.user)}
    if not c_id:
        return render(request, "emploi/classe.html", ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    attributions = list(Attribution.objects.filter(classe=classe, exercice=exercice).select_related("matiere", "enseignant"))
    existants = _grille(Cours.objects.filter(exercice=exercice, classe=classe).select_related("attribution__matiere", "attribution__enseignant"))
    erreurs, saisies = {}, {}

    if request.method == "POST":
        if not est_administration(request.user):
            messages.error(request, "Seule l'administration peut modifier l'emploi du temps.")
            return redirect(request.get_full_path())
        par_id = {a.id: a for a in attributions}
        nouveaux = []
        for j, _ in JOURS:
            for cr in creneaux:
                a_id = request.POST.get(f"c_{j}_{cr.id}", "")
                salle = (request.POST.get(f"s_{j}_{cr.id}", "") or "").strip()[:50]
                saisies[(j, cr.id)] = (a_id, salle)
                if not a_id:
                    continue
                a = par_id.get(int(a_id)) if a_id.isdigit() else None
                if a is None:
                    erreurs[(j, cr.id)] = "matière inconnue pour cette classe"
                    continue
                nouveaux.append(Cours(exercice=exercice, classe=classe, jour=j, creneau=cr, attribution=a, salle=salle))
        if not erreurs:
            try:
                with transaction.atomic():
                    Cours.objects.filter(exercice=exercice, classe=classe).delete()
                    for c in nouveaux:
                        try:
                            c.full_clean(exclude=["exercice", "classe"])
                            c.save()
                        except ValidationError as e:
                            erreurs[(c.jour, c.creneau_id)] = " ; ".join(e.messages)
                    if erreurs:
                        raise ValidationError("conflits")
            except ValidationError:
                pass
        if not erreurs:
            messages.success(request, f"Emploi du temps de la {classe} enregistré ({len(nouveaux)} cours).")
            return redirect(request.get_full_path())
        messages.error(request, "Des conflits empêchent l'enregistrement : rien n'a été modifié.")

    lignes = []
    for cr in creneaux:
        cellules = []
        for j, _ in JOURS:
            c = existants.get((j, cr.id))
            a_id, salle = saisies.get((j, cr.id), (str(c.attribution_id) if c else "", c.salle if c else ""))
            cellules.append({"jour": j, "cours": c, "a_id": a_id, "salle": salle, "erreur": erreurs.get((j, cr.id))})
        lignes.append({"creneau": cr, "cellules": cellules})
    total = {}
    for c in existants.values():
        total[c.attribution_id] = total.get(c.attribution_id, 0) + 1
    ctx.update(classe=classe, attributions=attributions, lignes=lignes,
               volume=[(a, total.get(a.id, 0)) for a in attributions])
    return render(request, "emploi/classe.html", ctx)


@role_requis(peut_consulter)
def emploi_enseignant(request):
    exercice = Exercice.actif_courant()
    if not exercice:
        messages.error(request, "Aucun exercice actif.")
        return redirect("accueil")
    admin = est_administration(request.user) or est_surveillant(request.user)
    if admin and request.GET.get("enseignant"):
        enseignant = get_object_or_404(Enseignant, pk=request.GET["enseignant"])
    else:
        enseignant = getattr(request.user, "enseignant")
    creneaux = list(Creneau.objects.all())
    ctx = {"enseignants": Enseignant.objects.all() if admin else [], "enseignant": enseignant, "creneaux": creneaux, "jours": JOURS}
    if enseignant:
        cours = _grille(Cours.objects.filter(exercice=exercice, attribution__enseignant=enseignant)
                        .select_related("classe", "attribution__matiere"))
        ctx["lignes"] = [{"creneau": cr, "cellules": [cours.get((j, cr.id)) for j, _ in JOURS]} for cr in creneaux]
        ctx["nb_heures"] = len(cours)
    return render(request, "emploi/enseignant.html", ctx)
