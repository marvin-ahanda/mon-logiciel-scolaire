from django import forms
from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render

from comptes.roles import est_administration, role_requis
from notes.services import inscriptions_classe, periode_depuis_code, periodes_exercice
from scolarite.models import Classe, Exercice, Inscription

from .models import CreditSMS, MessageSMS
from .passerelles import passerelle
from .services import CreditInsuffisant, composer, envoyer

AVEC_PERIODE = ("resultats", "absences")


class CreditForm(forms.ModelForm):
    class Meta:
        model = CreditSMS
        fields = ["quantite", "note"]
        widgets = {"quantite": forms.NumberInput(attrs={"class": "form-control", "min": 1}),
                   "note": forms.TextInput(attrs={"class": "form-control", "placeholder": "Ex. : recharge BulkSms du 02/11"})}


@role_requis(est_administration)
def envoi(request):
    exercice = Exercice.actif_courant()
    if not exercice:
        messages.error(request, "Aucun exercice actif.")
        return redirect("accueil")
    d = request.POST if request.method == "POST" else request.GET
    objet, c_id, code, texte = d.get("objet", "resultats"), d.get("classe", ""), d.get("periode", ""), d.get("texte", "")
    ctx = {"objets": [o for o in MessageSMS.OBJETS if o[0] != "paiement"], "classes": Classe.objects.all(),
           "periodes": periodes_exercice(exercice), "objet": objet, "c_id": c_id, "p_code": code, "texte": texte,
           "solde": CreditSMS.solde(), "passerelle": passerelle().nom, "avec_periode": AVEC_PERIODE}
    if not (d.get("action") and c_id):
        return render(request, "sms/envoi.html", ctx)
    erreurs = []
    if c_id == "toutes":
        classe, inscriptions = None, Inscription.objects.filter(exercice=exercice).select_related("eleve", "classe")
        if objet in AVEC_PERIODE:
            erreurs.append("Choisissez une classe pour ce type de message.")
    else:
        classe = get_object_or_404(Classe, pk=c_id)
        inscriptions = inscriptions_classe(classe, exercice).select_related("classe")
    periode = periode_depuis_code(exercice, code) if objet in AVEC_PERIODE else None
    if objet in AVEC_PERIODE and periode is None:
        erreurs.append("Choisissez une période.")
    if objet == "libre" and not texte.strip():
        erreurs.append("Saisissez le texte du message.")
    if erreurs:
        for e in erreurs:
            messages.error(request, e)
        return render(request, "sms/envoi.html", ctx)
    destinataires = composer(objet, inscriptions, classe, periode, exercice, texte_libre=texte)
    valides = [x for x in destinataires if x.valide]
    ctx.update(destinataires=destinataires, nb_valides=len(valides), nb_sms=sum(x.parties for x in valides))
    if request.method == "POST" and d.get("action") == "envoyer":
        try:
            ok, echecs = envoyer(destinataires, objet, request.user)
        except CreditInsuffisant as e:
            messages.error(request, str(e))
            return render(request, "sms/envoi.html", ctx)
        if passerelle().reel:
            messages.success(request, f"{ok} SMS envoyé(s){f', {echecs} échec(s)' if echecs else ''}.")
        else:
            messages.warning(request, f"Mode journal : {ok} message(s) enregistré(s) mais AUCUN SMS n'a été réellement envoyé "
                                      "(passerelle non configurée).")
        return redirect("sms_journal")
    return render(request, "sms/envoi.html", ctx)


@role_requis(est_administration)
def journal(request):
    form = CreditForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        c = form.save(commit=False)
        c.ajoute_par = request.user
        c.save()
        messages.success(request, f"Compte SMS rechargé de {c.quantite} SMS.")
        return redirect("sms_journal")
    statut = request.GET.get("statut", "")
    qs = MessageSMS.objects.select_related("eleve", "envoye_par")
    if statut:
        qs = qs.filter(statut=statut)
    return render(request, "sms/journal.html", {
        "messages_sms": qs[:300], "statut": statut, "statuts": MessageSMS.STATUTS, "form": form, "solde": CreditSMS.solde(),
        "credits": CreditSMS.objects.select_related("ajoute_par")[:10], "passerelle": passerelle().nom,
    })
