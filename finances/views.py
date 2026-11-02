from datetime import timedelta

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_POST

from notes.services import inscriptions_classe
from scolarite.models import Classe, Etablissement, Exercice, Inscription, Niveau
from comptes.roles import est_administration, peut_encaisser, role_requis
from scolarite.views import admin_requis

from .forms import AnnulationForm, PaiementForm, ReductionForm, RemboursementForm
from .lettres import montant_en_lettres
from .models import Paiement, Reduction, Remboursement, Rubrique, Tarif
from .services import compte, comptes


def _exercice(request):
    ex = Exercice.actif_courant()
    if not ex:
        messages.error(request, "Aucun exercice actif.")
    return ex


@role_requis(peut_encaisser)
def caisse(request):
    """Recherche d'un élève de l'exercice actif pour ouvrir son compte."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    q, c_id = request.GET.get("q", "").strip(), request.GET.get("classe", "")
    resultats = []
    if q or c_id:
        qs = Inscription.objects.filter(exercice=exercice).select_related("eleve", "classe__niveau")
        if q:
            qs = qs.filter(Q(eleve__nom__icontains=q) | Q(eleve__prenom__icontains=q) | Q(eleve__matricule__icontains=q))
        if c_id:
            qs = qs.filter(classe_id=c_id)
        resultats = list(qs.order_by("eleve__nom", "eleve__prenom")[:100])
    cs = comptes(resultats, exercice) if resultats else {}
    aujourd_hui = Paiement.objects.filter(exercice=exercice, annule=False, date=timezone.localdate())
    return render(request, "finances/caisse.html", {
        "q": q, "c_id": c_id, "classes": Classe.objects.all(), "resultats": [(i, cs[i.id]) for i in resultats],
        "encaisse_jour": aujourd_hui.aggregate(t=Sum("montant"))["t"] or 0, "nb_jour": aujourd_hui.count(),
        "sans_tarif": not Tarif.objects.filter(exercice=exercice).exists(),
    })


def _verrouiller_compte(inscription_id):
    """Verrouille l'inscription le temps de l'opération, puis recalcule son compte."""
    ins = Inscription.objects.select_for_update().select_related("eleve", "classe__niveau", "exercice").get(pk=inscription_id)
    return ins, compte(ins)


@role_requis(peut_encaisser)
def compte_eleve(request, pk):
    ins = get_object_or_404(Inscription.objects.select_related("eleve", "classe__niveau", "exercice"), pk=pk)
    c = compte(ins)
    action = request.POST.get("action") if request.method == "POST" else None
    admin = est_administration(request.user)
    if action in ("reduction", "remboursement") and not admin:
        messages.error(request, "Les réductions et les remboursements sont réservés à l'administration.")
        return redirect("compte_eleve", pk=pk)
    form_p = PaiementForm(request.POST if action == "paiement" else None, compte=c, prefix="p")
    form_r = ReductionForm(request.POST if action == "reduction" else None, compte=c, prefix="r")
    form_rb = RemboursementForm(request.POST if action == "remboursement" else None, prefix="rb")

    if action == "paiement" and form_p.is_valid():
        with transaction.atomic():
            ins, c = _verrouiller_compte(pk)
            ligne = c.ligne(form_p.cleaned_data["rubrique"].id)
            montant = form_p.cleaned_data["montant"]
            if ligne is None or montant > ligne.reste:
                form_p.add_error("montant", f"Le montant dépasse le reste à verser pour la rubrique ({ligne.reste if ligne else 0} F).")
            else:
                p = Paiement.enregistrer(inscription=ins, saisi_par=request.user, **form_p.cleaned_data)
                messages.success(request, f"Paiement enregistré : reçu n° {p.numero_recu}.")
                return redirect("recu", pk=p.pk)
    elif action == "reduction" and form_r.is_valid():
        with transaction.atomic():
            ins, c = _verrouiller_compte(pk)
            ligne = c.ligne(form_r.cleaned_data["rubrique"].id)
            if ligne is None or form_r.cleaned_data["montant"] > ligne.reste:
                form_r.add_error("montant", f"Réduction possible sur la rubrique : {ligne.reste if ligne else 0} F au maximum.")
            else:
                Reduction.objects.create(inscription=ins, saisi_par=request.user, **form_r.cleaned_data)
                messages.success(request, "Réduction enregistrée.")
                return redirect("compte_eleve", pk=pk)
    elif action == "remboursement" and form_rb.is_valid():
        with transaction.atomic():
            ins, c = _verrouiller_compte(pk)
            if form_rb.cleaned_data["montant"] > c.remboursable:
                form_rb.add_error("montant", f"Remboursement possible : {c.remboursable} F au maximum.")
            else:
                Remboursement.objects.create(inscription=ins, saisi_par=request.user, **form_rb.cleaned_data)
                messages.success(request, "Remboursement enregistré.")
                return redirect("compte_eleve", pk=pk)

    return render(request, "finances/compte.html", {
        "ins": ins, "compte": c, "form_p": form_p, "form_r": form_r, "form_rb": form_rb, "action": action,
        "paiements": Paiement.objects.filter(inscription=ins).select_related("rubrique", "saisi_par", "annule_par"),
        "reductions": Reduction.objects.filter(inscription=ins).select_related("rubrique"),
        "remboursements": Remboursement.objects.filter(inscription=ins),
        "form_annulation": AnnulationForm(), "peut_decider": admin,
    })


@require_POST
@admin_requis
def annuler_paiement(request, pk):
    p = get_object_or_404(Paiement, pk=pk)
    form = AnnulationForm(request.POST)
    try:
        if not form.is_valid():
            raise ValidationError("Le motif d'annulation est obligatoire.")
        p.annuler(request.user, form.cleaned_data["motif"])
        messages.success(request, f"Reçu n° {p.numero_recu} annulé.")
    except ValidationError as e:
        messages.error(request, " ".join(e.messages))
    return redirect("compte_eleve", pk=p.inscription_id)


@role_requis(peut_encaisser)
def recu(request, pk):
    p = get_object_or_404(Paiement.objects.select_related("inscription__eleve", "inscription__classe", "rubrique", "exercice", "saisi_par"), pk=pk)
    c = compte(p.inscription)
    return render(request, "finances/recu.html", {
        "p": p, "compte": c, "ligne": c.ligne(p.rubrique_id), "en_lettres": montant_en_lettres(p.montant),
        "etablissement": Etablissement.courant(), "copies": ["Exemplaire élève", "Exemplaire établissement"],
    })


@admin_requis
def tarifs(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    rubriques, niveaux = list(Rubrique.objects.all()), list(Niveau.objects.all())
    existants = {(t.rubrique_id, t.niveau_id, t.statut): t for t in Tarif.objects.filter(exercice=exercice)}
    erreurs = []
    if request.method == "POST" and request.POST.get("action") == "reconduire":
        precedent = Exercice.objects.exclude(pk=exercice.pk).filter(tarifs__isnull=False).order_by("-libelle").first()
        if not precedent:
            messages.error(request, "Aucun exercice précédent avec des tarifs.")
        else:
            n = 0
            for t in Tarif.objects.filter(exercice=precedent):
                _, cree = Tarif.objects.get_or_create(exercice=exercice, rubrique_id=t.rubrique_id, niveau_id=t.niveau_id,
                                                      statut=t.statut, defaults={"montant": t.montant})
                n += cree
            messages.success(request, f"{n} tarif(s) reconduit(s) depuis {precedent}.")
        return redirect("tarifs")
    if request.method == "POST":
        valeurs = {}
        for r in rubriques:
            for n in niveaux:
                for statut, _ in Inscription.STATUTS:
                    brut = request.POST.get(f"t_{r.id}_{n.id}_{statut}", "").replace(" ", "").strip()
                    if brut and not brut.isdigit():
                        erreurs.append(f"{r} / {n} : « {brut} » n'est pas un montant entier.")
                    valeurs[(r.id, n.id, statut)] = int(brut) if brut.isdigit() else None
        if not erreurs:
            with transaction.atomic():
                for (r_id, n_id, statut), v in valeurs.items():
                    t = existants.get((r_id, n_id, statut))
                    if v is None and t:
                        if t.rubrique.paiements.filter(exercice=exercice, inscription__classe__niveau_id=n_id, inscription__statut=statut).exists():
                            erreurs.append(f"{t.rubrique} / {t.niveau} : des paiements existent, le tarif ne peut pas être retiré.")
                            continue
                        t.delete()
                    elif v is not None:
                        Tarif.objects.update_or_create(exercice=exercice, rubrique_id=r_id, niveau_id=n_id, statut=statut,
                                                       defaults={"montant": v})
            if not erreurs:
                messages.success(request, "Tarifs enregistrés.")
                return redirect("tarifs")
        for e in erreurs:
            messages.error(request, e)
    lignes = [{"niveau": n, "statuts": [{"code": s, "libelle": lib, "cellules": [
        {"rubrique": r, "nom": f"t_{r.id}_{n.id}_{s}",
         "valeur": request.POST.get(f"t_{r.id}_{n.id}_{s}") if request.method == "POST"
         else (existants[(r.id, n.id, s)].montant if (r.id, n.id, s) in existants else "")}
        for r in rubriques]} for s, lib in Inscription.STATUTS]} for n in niveaux]
    return render(request, "finances/tarifs.html", {"exercice": exercice, "rubriques": rubriques, "lignes": lignes})


@role_requis(peut_encaisser)
def situation(request):
    """Situation financière d'une classe : solvables / insolvables, globalement ou pour une rubrique."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    c_id, r_id, filtre = request.GET.get("classe"), request.GET.get("rubrique", ""), request.GET.get("filtre", "tous")
    ctx = {"classes": Classe.objects.all(), "rubriques": Rubrique.objects.all(), "c_id": c_id, "r_id": r_id, "filtre": filtre}
    if not c_id:
        return render(request, "finances/situation.html", ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    rubrique = get_object_or_404(Rubrique, pk=r_id) if r_id else None
    inscriptions = list(inscriptions_classe(classe, exercice).select_related("classe__niveau"))
    cs = comptes(inscriptions, exercice)
    lignes = []
    for ins in inscriptions:
        c = cs[ins.id]
        if rubrique:
            l = c.ligne(rubrique.id)
            du, verse, reste = (l.du, l.verse, l.reste) if l else (0, 0, 0)
        else:
            du, verse, reste = c.total_du, c.total_verse, c.total_reste
        if filtre == "insolvables" and reste == 0:
            continue
        if filtre == "solvables" and (reste > 0 or du == 0):
            continue
        lignes.append({"ins": ins, "du": du, "verse": verse, "reste": reste})
    ctx.update(classe=classe, rubrique=rubrique, lignes=lignes,
               totaux={k: sum(l[k] for l in lignes) for k in ("du", "verse", "reste")})
    return render(request, "finances/situation.html", ctx)


@role_requis(peut_encaisser)
def journal(request):
    """Journal des encaissements sur une période, par mode de paiement."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    aujourd_hui = timezone.localdate()
    debut = parse_date(request.GET.get("debut") or "") or aujourd_hui - timedelta(days=6)
    fin = parse_date(request.GET.get("fin") or "") or aujourd_hui
    mode = request.GET.get("mode", "")
    qs = (Paiement.objects.filter(exercice=exercice, date__range=(debut, fin))
          .select_related("inscription__eleve", "inscription__classe", "rubrique", "saisi_par").order_by("date", "numero_recu"))
    if mode:
        qs = qs.filter(mode=mode)
    valides = qs.filter(annule=False)
    par_mode = [(dict(Paiement.MODES)[m], n, t) for m, n, t in
                valides.order_by("mode").values("mode").annotate(n=Count("id"), t=Sum("montant")).values_list("mode", "n", "t")]
    return render(request, "finances/journal.html", {
        "debut": debut, "fin": fin, "mode": mode, "modes": Paiement.MODES, "paiements": qs,
        "total": valides.aggregate(t=Sum("montant"))["t"] or 0, "par_mode": par_mode,
    })
