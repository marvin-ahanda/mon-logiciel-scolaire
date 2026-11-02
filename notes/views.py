from decimal import Decimal, InvalidOperation

from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render

from comptes.roles import est_enseignant, role_requis
from scolarite.models import Attribution, Classe, Etablissement, Exercice, Sequence

from .models import Note
from .services import (attributions_saisissables, enseignant_de, est_administration, inscriptions_classe,
                       periode_depuis_code, periodes_exercice, peut_saisir, resultats_periode)


def _exercice_ou_redirection(request):
    ex = Exercice.actif_courant()
    if not ex:
        messages.error(request, "Aucun exercice actif. L'administration doit en activer un.")
    return ex


def _lire_note(brut):
    """'12,5' -> Decimal('12.50') ; '' -> None ; valeur invalide -> ValueError."""
    brut = (brut or "").strip().replace(",", ".")
    if brut == "":
        return None
    try:
        v = Decimal(brut)
    except InvalidOperation:
        raise ValueError(f"« {brut} » n'est pas un nombre")
    if not v.is_finite():
        raise ValueError(f"« {brut} » n'est pas un nombre")
    if not (Decimal("0") <= v <= Decimal("20")):
        raise ValueError(f"{brut} n'est pas compris entre 0 et 20")
    if v != v.quantize(Decimal("0.01")):
        raise ValueError(f"{brut} : deux décimales au maximum")
    return v.quantize(Decimal("0.01"))


@role_requis(est_administration, est_enseignant)
def saisie(request):
    exercice = _exercice_ou_redirection(request)
    if not exercice:
        return redirect("accueil")
    attributions = attributions_saisissables(request.user, exercice).order_by("classe__libelle", "matiere__libelle")
    sequences = exercice.sequences.all()
    a_id, s_id = request.GET.get("attribution"), request.GET.get("sequence")
    ctx = {"attributions": attributions, "sequences": sequences, "a_id": a_id, "s_id": s_id}
    if not (a_id and s_id):
        return render(request, "notes/saisie.html", ctx)

    attribution = get_object_or_404(Attribution, pk=a_id, exercice=exercice)
    sequence = get_object_or_404(Sequence, pk=s_id, exercice=exercice)
    if not peut_saisir(request.user, attribution):
        raise PermissionDenied("Vous n'enseignez pas cette matière dans cette classe.")
    inscriptions = list(inscriptions_classe(attribution.classe, exercice))
    existantes = {n.inscription_id: n for n in Note.objects.filter(attribution=attribution, sequence=sequence)}
    erreurs = {}

    if request.method == "POST":
        if sequence.verrouillee:
            messages.error(request, "Opération refusée. La séquence spécifiée est fermée.")
            return redirect(f"{request.path}?attribution={a_id}&sequence={s_id}")
        valeurs = {}
        for ins in inscriptions:
            try:
                valeurs[ins.id] = _lire_note(request.POST.get(f"note_{ins.id}"))
            except ValueError as e:
                erreurs[ins.id] = str(e)
        if not erreurs:
            crees = modifiees = supprimees = 0
            with transaction.atomic():
                for ins in inscriptions:
                    v, n = valeurs[ins.id], existantes.get(ins.id)
                    if v is None and n:
                        n.delete(); supprimees += 1
                    elif v is not None and n is None:
                        Note.objects.create(inscription=ins, attribution=attribution, sequence=sequence,
                                            valeur=v, saisie_par=request.user); crees += 1
                    elif v is not None and n.valeur != v:
                        n.valeur, n.saisie_par = v, request.user
                        n.save(update_fields=["valeur", "saisie_par", "modifie_le"]); modifiees += 1
            messages.success(request, f"Notes enregistrées : {crees} ajoutée(s), {modifiees} modifiée(s), {supprimees} effacée(s).")
            return redirect(f"{request.path}?attribution={a_id}&sequence={s_id}")
        messages.error(request, "Certaines notes sont invalides : rien n'a été enregistré.")

    lignes = [{
        "inscription": ins,
        "valeur": request.POST.get(f"note_{ins.id}") if request.method == "POST"
        else (str(existantes[ins.id].valeur).replace(".", ",") if ins.id in existantes else ""),
        "erreur": erreurs.get(ins.id),
    } for ins in inscriptions]
    ctx.update(attribution=attribution, sequence=sequence, lignes=lignes,
               nb_notes=sum(1 for l in lignes if l["valeur"]))
    return render(request, "notes/saisie.html", ctx)


def _peut_consulter_classe(user, classe, exercice):
    if est_administration(user):
        return True
    ens = enseignant_de(user)
    return ens is not None and Attribution.objects.filter(classe=classe, exercice=exercice, enseignant=ens).exists()


def _classes_consultables(user, exercice):
    if est_administration(user):
        return Classe.objects.all()
    ens = enseignant_de(user)
    return Classe.objects.filter(attributions__exercice=exercice, attributions__enseignant=ens).distinct() if ens else Classe.objects.none()


def _choix_classe_periode(request, gabarit):
    exercice = _exercice_ou_redirection(request)
    if not exercice:
        return None, redirect("accueil")
    c_id, code = request.GET.get("classe"), request.GET.get("periode")
    if not code and request.GET.get("sequence"):          # anciens liens ?sequence=<id>
        code = f"s{request.GET['sequence']}"
    ctx = {"classes": _classes_consultables(request.user, exercice), "periodes": periodes_exercice(exercice),
           "c_id": c_id, "p_code": code}
    if not (c_id and code):
        return None, render(request, gabarit, ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    periode = periode_depuis_code(exercice, code)
    if periode is None:
        raise Http404("Période inconnue.")
    if not _peut_consulter_classe(request.user, classe, exercice):
        raise PermissionDenied("Vous n'intervenez pas dans cette classe.")
    resultats, stats, attributions, entetes_details = resultats_periode(classe, exercice, periode)
    ctx.update(classe=classe, periode=periode, sequence=periode.sequence, resultats=resultats, stats=stats,
               attributions=attributions, entetes_details=entetes_details,
               etablissement=Etablissement.courant(), exercice=exercice)
    return ctx, None


@role_requis(est_administration, est_enseignant)
def resultats(request):
    ctx, reponse = _choix_classe_periode(request, "notes/resultats.html")
    if reponse:
        return reponse
    ctx["classement"] = sorted(ctx["resultats"], key=lambda r: (r.rang is None, r.rang or 0, str(r.eleve)))
    return render(request, "notes/resultats.html", ctx)


@role_requis(est_administration, est_enseignant)
def bulletins(request):
    ctx, reponse = _choix_classe_periode(request, "notes/bulletins_choix.html")
    if reponse:
        return reponse
    ins = request.GET.get("eleve")
    if ins:
        ctx["resultats"] = [r for r in ctx["resultats"] if str(r.inscription_id) == ins]
    seuil = (request.GET.get("ecolage_min") or "").strip()
    if seuil.isdigit() and est_administration(request.user):
        from finances.services import total_verse_par_inscription
        verses = total_verse_par_inscription([r.inscription_id for r in ctx["resultats"]])
        exclus = [r for r in ctx["resultats"] if verses.get(r.inscription_id, 0) <= int(seuil)]
        ctx["resultats"] = [r for r in ctx["resultats"] if verses.get(r.inscription_id, 0) > int(seuil)]
        ctx.update(ecolage_min=int(seuil), exclus_ecolage=exclus)
    return render(request, "notes/bulletins.html", ctx)
