from datetime import date as Date

from django import forms
from django.contrib import messages
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.dateparse import parse_date
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from notes.services import inscriptions_classe, periode_depuis_code, periodes_exercice
from scolarite.forms import BootstrapMixin
from scolarite.models import Classe, Exercice, Sequence
from comptes.roles import peut_gerer_discipline, role_requis

from .models import Absence, Incident, Infraction, ParametresDiscipline, Retard
from .services import bilans_discipline


def _exercice(request):
    ex = Exercice.actif_courant()
    if not ex:
        messages.error(request, "Aucun exercice actif.")
    return ex


def _entier_heures(brut):
    brut = (brut or "").strip()
    if brut == "":
        return 0
    if not brut.isdigit() or int(brut) > 24:
        raise ValueError(f"« {brut} » : nombre d'heures entier entre 0 et 24 attendu")
    return int(brut)


@role_requis(peut_gerer_discipline)
def appel(request):
    """Saisie journalière : absences (heures non justifiées / justifiées) et retards d'une classe."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    c_id, s_id = request.GET.get("classe"), request.GET.get("sequence")
    jour = parse_date(request.GET.get("date") or "") or Date.today()
    ctx = {"classes": Classe.objects.all(), "sequences": exercice.sequences.all(), "c_id": c_id, "s_id": s_id, "jour": jour}
    if not (c_id and s_id):
        return render(request, "discipline/appel.html", ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    sequence = get_object_or_404(Sequence, pk=s_id, exercice=exercice)
    inscriptions = list(inscriptions_classe(classe, exercice))
    absences = {a.inscription_id: a for a in Absence.objects.filter(inscription__in=inscriptions, date=jour)}
    retards = {r.inscription_id: r for r in Retard.objects.filter(inscription__in=inscriptions, date=jour)}
    autre_sequence = {a.inscription_id for a in absences.values() if a.sequence_id != sequence.id} | \
                     {r.inscription_id for r in retards.values() if r.sequence_id != sequence.id}
    erreurs = {}

    if request.method == "POST":
        if sequence.verrouillee:
            messages.error(request, "Opération refusée. La séquence spécifiée est fermée.")
            return redirect(request.get_full_path())
        if autre_sequence:
            messages.error(request, "Des saisies de ce jour sont rattachées à une autre séquence : corrigez la séquence choisie.")
            return redirect(request.get_full_path())
        valeurs = {}
        for ins in inscriptions:
            try:
                valeurs[ins.id] = (_entier_heures(request.POST.get(f"nj_{ins.id}")), _entier_heures(request.POST.get(f"j_{ins.id}")),
                                   (request.POST.get(f"motif_{ins.id}") or "").strip()[:200], bool(request.POST.get(f"retard_{ins.id}")))
            except ValueError as e:
                erreurs[ins.id] = str(e)
        if not erreurs:
            with transaction.atomic():
                for ins in inscriptions:
                    nj, j, motif, en_retard = valeurs[ins.id]
                    a = absences.get(ins.id)
                    if nj == 0 and j == 0:
                        if a:
                            a.delete()
                    else:
                        a = a or Absence(inscription=ins, sequence=sequence, date=jour)
                        a.heures_non_justifiees, a.heures_justifiees, a.motif, a.saisi_par = nj, j, motif, request.user
                        a.save()
                    r = retards.get(ins.id)
                    if en_retard and not r:
                        Retard.objects.create(inscription=ins, sequence=sequence, date=jour, saisi_par=request.user)
                    elif not en_retard and r:
                        r.delete()
            messages.success(request, f"Appel du {jour:%d/%m/%Y} enregistré pour {classe}.")
            return redirect(request.get_full_path())
        messages.error(request, "Certaines valeurs sont invalides : rien n'a été enregistré.")

    lignes = []
    for ins in inscriptions:
        a, r = absences.get(ins.id), retards.get(ins.id)
        if request.method == "POST":
            nj, j, motif, en_retard = (request.POST.get(f"nj_{ins.id}", ""), request.POST.get(f"j_{ins.id}", ""),
                                       request.POST.get(f"motif_{ins.id}", ""), bool(request.POST.get(f"retard_{ins.id}")))
        else:
            nj = a.heures_non_justifiees if a and a.heures_non_justifiees else ""
            j = a.heures_justifiees if a and a.heures_justifiees else ""
            motif, en_retard = (a.motif if a else ""), bool(r)
        lignes.append({"inscription": ins, "nj": nj, "j": j, "motif": motif, "retard": en_retard, "erreur": erreurs.get(ins.id)})
    ctx.update(classe=classe, sequence=sequence, lignes=lignes)
    return render(request, "discipline/appel.html", ctx)


class IncidentForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Incident
        fields = ["inscription", "date", "infraction", "observation"]
        labels = {"inscription": "Élève"}
        widgets = {"date": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d")}

    def __init__(self, *args, inscriptions=(), **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["inscription"].queryset = inscriptions
        self.fields["inscription"].label_from_instance = lambda i: str(i.eleve)
        self.fields["infraction"].queryset = Infraction.objects.select_related("sanction")
        self.fields["infraction"].label_from_instance = lambda i: f"{i.libelle} → {i.sanction}"


@role_requis(peut_gerer_discipline)
def incidents(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    c_id, s_id = request.GET.get("classe"), request.GET.get("sequence")
    ctx = {"classes": Classe.objects.all(), "sequences": exercice.sequences.all(), "c_id": c_id, "s_id": s_id,
           "aucune_infraction": not Infraction.objects.exists()}
    if not (c_id and s_id):
        return render(request, "discipline/incidents.html", ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    sequence = get_object_or_404(Sequence, pk=s_id, exercice=exercice)
    inscriptions = inscriptions_classe(classe, exercice)
    form = IncidentForm(request.POST or None, inscriptions=inscriptions, initial={"date": Date.today()})
    if request.method == "POST":
        if sequence.verrouillee:
            messages.error(request, "Opération refusée. La séquence spécifiée est fermée.")
        elif form.is_valid():
            inc = form.save(commit=False)
            inc.sequence, inc.saisi_par = sequence, request.user
            inc.save()
            messages.success(request, f"Infraction enregistrée pour {inc.inscription.eleve}.")
            return redirect(request.get_full_path())
    liste = (Incident.objects.filter(inscription__in=inscriptions, sequence=sequence)
             .select_related("inscription__eleve", "infraction__sanction"))
    ctx.update(classe=classe, sequence=sequence, form=form, liste=liste)
    return render(request, "discipline/incidents.html", ctx)


@require_POST
@role_requis(peut_gerer_discipline)
def incident_supprimer(request, pk):
    inc = get_object_or_404(Incident, pk=pk)
    if inc.sequence.verrouillee:
        messages.error(request, "Opération refusée. La séquence spécifiée est fermée.")
    else:
        inc.delete()
        messages.success(request, "Infraction supprimée.")
    retour = request.POST.get("retour")
    if retour and url_has_allowed_host_and_scheme(retour, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return redirect(retour)
    return redirect("incidents")


@role_requis(peut_gerer_discipline)
def suivi(request):
    """Suivi disciplinaire d'une classe sur une période (séquence, trimestre ou année)."""
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    c_id, code = request.GET.get("classe"), request.GET.get("periode")
    ctx = {"classes": Classe.objects.all(), "periodes": periodes_exercice(exercice), "c_id": c_id, "p_code": code,
           "parametres": ParametresDiscipline.pour(exercice)}
    if not (c_id and code):
        return render(request, "discipline/suivi.html", ctx)
    classe = get_object_or_404(Classe, pk=c_id)
    periode = periode_depuis_code(exercice, code)
    if periode is None:
        raise Http404("Période inconnue.")
    sequences = list(exercice.sequences.all())
    seqs = ([periode.sequence] if periode.type == "sequence" else
            [s for s in sequences if s.trimestre == periode.trimestre] if periode.type == "trimestre" else sequences)
    inscriptions = list(inscriptions_classe(classe, exercice))
    bilans = bilans_discipline(inscriptions, seqs, exercice)
    ctx.update(classe=classe, periode=periode, lignes=[(i, bilans[i.id]) for i in inscriptions])
    return render(request, "discipline/suivi.html", ctx)
