from datetime import timedelta

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_POST

from comptes.roles import est_administration, peut_encaisser, role_requis
from scolarite.models import Classe, Etablissement, Exercice, Inscription, Niveau
from scolarite.views import admin_requis

from .forms import AnnulationForm, MouvementCaisseForm, PaiementForm, PlanFinancementForm, ReductionForm, RemboursementForm
from .lettres import montant_en_lettres
from .models import (Echeance, LibelleCaisse, MouvementCaisse, Paiement, PlanFinancement, Reduction, Remboursement, Rubrique,
                     Tarif, repartir)
from .services import compte, comptes, dettes_anterieures, journal_caisse, paiements_periode, situation_classe


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
    dettes = dettes_anterieures([i.eleve_id for i in resultats], exercice) if resultats else {}
    aujourd_hui = Paiement.objects.filter(exercice=exercice, annule=False, date=timezone.localdate())
    return render(request, "finances/caisse.html", {
        "q": q, "c_id": c_id, "classes": Classe.objects.all(),
        "resultats": [(i, cs[i.id], sum(d.total_reste for d in dettes.get(i.eleve_id, []))) for i in resultats],
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
    if action in ("reduction", "remboursement", "plan", "supprimer_plan") and not admin:
        messages.error(request, "Les réductions, remboursements et plans de financement sont réservés à l'administration.")
        return redirect("compte_eleve", pk=pk)
    form_p = PaiementForm(request.POST if action == "paiement" else None, compte=c, prefix="p")
    form_r = ReductionForm(request.POST if action == "reduction" else None, compte=c, prefix="r")
    form_rb = RemboursementForm(request.POST if action == "remboursement" else None, prefix="rb")
    form_plan = PlanFinancementForm(request.POST if action == "plan" else None, prefix="pl")

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
    elif action == "plan" and form_plan.is_valid():
        with transaction.atomic():
            ins, c = _verrouiller_compte(pk)
            if PlanFinancement.objects.filter(inscription=ins).exists():
                messages.error(request, "Cet élève a déjà un plan de financement.")
            elif c.total_reste <= 0:
                messages.error(request, "Aucun reste à payer : plan inutile.")
            else:
                d = form_plan.cleaned_data
                plan = PlanFinancement.objects.create(inscription=ins, motif=d["motif"], deja_verse=c.total_verse, cree_par=request.user)
                for date_e, montant in repartir(c.total_reste, d["nombre"], d["premiere_date"]):
                    Echeance.objects.create(plan=plan, date=date_e, montant=montant)
                messages.success(request, f"Plan de financement accordé : {d['nombre']} échéances.")
                return redirect("compte_eleve", pk=pk)
    elif action == "supprimer_plan":
        PlanFinancement.objects.filter(inscription_id=pk).delete()
        messages.success(request, "Plan de financement supprimé.")
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
        "paiements": [(p, p.annulable_par(request.user)) for p in
                      Paiement.objects.filter(inscription=ins).select_related("rubrique", "saisi_par", "annule_par")],
        "reductions": Reduction.objects.filter(inscription=ins).select_related("rubrique"),
        "remboursements": Remboursement.objects.filter(inscription=ins),
        "form_annulation": AnnulationForm(), "peut_decider": admin, "form_plan": form_plan, **_contexte_plan(ins, c),
        **_contexte_dettes(ins),
    })


def _contexte_dettes(ins):
    actif = Exercice.actif_courant()
    if actif is None:
        return {}
    if ins.exercice_id != actif.pk:
        return {"arriere": True, "exercice_actif": actif}
    dettes = dettes_anterieures([ins.eleve_id], actif).get(ins.eleve_id, [])
    return {"dettes": dettes, "total_dettes": sum(d.total_reste for d in dettes)}


def _contexte_plan(ins, c):
    plan = PlanFinancement.objects.filter(inscription=ins).prefetch_related("echeances").first()
    if not plan:
        return {"plan": None}
    lignes, du_a_date, retard = plan.situation(c.total_verse)
    return {"plan": plan, "plan_lignes": lignes, "plan_du": du_a_date, "plan_retard": retard,
            "plan_total": sum(l["echeance"].montant for l in lignes)}


@role_requis(peut_encaisser)
def plans_financement(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    en_retard = request.GET.get("retard") == "1"
    plans = list(PlanFinancement.objects.filter(inscription__exercice=exercice)
                 .select_related("inscription__eleve", "inscription__classe__niveau").prefetch_related("echeances"))
    cs = comptes([p.inscription for p in plans], exercice)
    lignes = []
    for p in plans:
        c = cs[p.inscription_id]
        details, du_a_date, retard = p.situation(c.total_verse)
        prochaine = next((d["echeance"] for d in details if d["etat"] != "payée" and d["echeance"].date >= timezone.localdate()), None)
        if en_retard and not retard:
            continue
        lignes.append({"plan": p, "ins": p.inscription, "total": sum(d["echeance"].montant for d in details),
                       "verse": max(0, c.total_verse - p.deja_verse), "retard": retard, "prochaine": prochaine, "reste": c.total_reste})
    lignes.sort(key=lambda l: (-l["retard"], str(l["ins"].eleve)))
    return render(request, "finances/plans.html", {"lignes": lignes, "en_retard": en_retard,
                                                    "total_retard": sum(l["retard"] for l in lignes)})


@require_POST
@role_requis(peut_encaisser)
def annuler_paiement(request, pk):
    p = get_object_or_404(Paiement, pk=pk)
    form = AnnulationForm(request.POST)
    try:
        if not p.annulable_par(request.user):
            raise ValidationError("Vous ne pouvez annuler que vos propres paiements enregistrés aujourd'hui.")
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
    lignes, totaux = situation_classe(classe, exercice, rubrique, filtre)
    ctx.update(classe=classe, rubrique=rubrique, lignes=lignes, totaux=totaux)
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
    qs, total, par_mode = paiements_periode(exercice, debut, fin, mode)
    return render(request, "finances/journal.html", {
        "debut": debut, "fin": fin, "mode": mode, "modes": Paiement.MODES, "paiements": qs,
        "total": total, "par_mode": par_mode,
    })


# --- Caisse générale ---------------------------------------------------------------------------------

@role_requis(peut_encaisser)
def caisse_generale(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    sens = request.GET.get("sens", LibelleCaisse.ENTREE)
    if sens not in (LibelleCaisse.ENTREE, LibelleCaisse.SORTIE):
        sens = LibelleCaisse.ENTREE
    form = MouvementCaisseForm(request.POST or None, sens=sens, exercice=exercice)
    if request.method == "POST" and form.is_valid():
        d = dict(form.cleaned_data)
        d["inscription"] = d.pop("matricule", None)
        m = MouvementCaisse.enregistrer(exercice, saisi_par=request.user, **d)
        messages.success(request, f"{'Reçu' if m.est_entree else 'Bon de caisse'} n° {m.numero} enregistré.")
        return redirect("mouvement_caisse", pk=m.pk)
    recents = (MouvementCaisse.objects.filter(exercice=exercice).select_related("libelle", "saisi_par", "inscription__eleve")[:30])
    return render(request, "finances/caisse_generale.html", {
        "form": form, "sens": sens, "recents": [(m, m.annulable_par(request.user)) for m in recents],
        "sans_libelle": not LibelleCaisse.objects.filter(sens=sens, actif=True).exists(), "form_annulation": AnnulationForm(),
    })


@role_requis(peut_encaisser)
def mouvement_caisse(request, pk):
    m = get_object_or_404(MouvementCaisse.objects.select_related("libelle", "exercice", "saisi_par", "inscription__eleve"), pk=pk)
    return render(request, "finances/mouvement.html", {
        "m": m, "en_lettres": montant_en_lettres(m.montant), "etablissement": Etablissement.courant(),
        "copies": ["Exemplaire du tiers", "Exemplaire de l'établissement"],
    })


@require_POST
@role_requis(peut_encaisser)
def annuler_mouvement(request, pk):
    m = get_object_or_404(MouvementCaisse, pk=pk)
    form = AnnulationForm(request.POST)
    try:
        if not m.annulable_par(request.user):
            raise ValidationError("Vous ne pouvez annuler que vos propres opérations enregistrées aujourd'hui.")
        if not form.is_valid():
            raise ValidationError("Le motif d'annulation est obligatoire.")
        m.annuler(request.user, form.cleaned_data["motif"])
        messages.success(request, f"{'Reçu' if m.est_entree else 'Bon'} n° {m.numero} annulé.")
    except ValidationError as e:
        messages.error(request, " ".join(e.messages))
    return redirect(f"{reverse('caisse_generale')}?sens={m.sens}")


@role_requis(peut_encaisser)
def journal_de_caisse(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    aujourd_hui = timezone.localdate()
    debut = parse_date(request.GET.get("debut") or "") or aujourd_hui.replace(day=1)
    fin = parse_date(request.GET.get("fin") or "") or aujourd_hui
    lignes, totaux, par_mode = journal_caisse(exercice, debut, fin)
    solde = 0
    for l in lignes:
        solde += l["entree"] - l["sortie"]
        l["solde"] = solde
    return render(request, "finances/journal_caisse.html", {"debut": debut, "fin": fin, "lignes": lignes, "totaux": totaux, "par_mode": par_mode})



@role_requis(peut_encaisser)
def debiteurs_anterieurs(request):
    """Élèves qui doivent encore de l'écolage d'années antérieures (« Doit à l'établissement » de l'original)."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    inscrits = request.GET.get("filtre", "inscrits") != "tous"
    eleves = Inscription.objects.exclude(exercice=exercice).values_list("eleve_id", flat=True).distinct()
    dettes = dettes_anterieures(list(eleves), exercice)
    actuelles = {i.eleve_id: i for i in Inscription.objects.filter(exercice=exercice, eleve_id__in=dettes).select_related("classe")}
    lignes = []
    for eleve_id, liste in dettes.items():
        actuelle = actuelles.get(eleve_id)
        if inscrits and not actuelle:
            continue
        lignes.append({"eleve": liste[0].inscription.eleve, "actuelle": actuelle, "dettes": liste,
                       "total": sum(c.total_reste for c in liste)})
    lignes.sort(key=lambda l: (-l["total"], str(l["eleve"])))
    return render(request, "finances/debiteurs.html", {"lignes": lignes, "inscrits": inscrits, "total": sum(l["total"] for l in lignes)})
