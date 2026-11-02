from django import forms
from django.utils import timezone

from scolarite.forms import BootstrapMixin

from scolarite.models import Inscription

from .models import LibelleCaisse, MouvementCaisse, Paiement, Reduction, Remboursement, Rubrique


class PaiementForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Paiement
        fields = ["rubrique", "montant", "mode", "reference", "date"]
        widgets = {"date": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
                   "montant": forms.NumberInput(attrs={"min": 1, "step": 1})}
        help_texts = {"reference": "Pour un paiement mobile : identifiant de la transaction."}

    def __init__(self, *args, compte=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.compte = compte
        self.fields["rubrique"].queryset = Rubrique.objects.filter(id__in=[l.rubrique.id for l in compte.lignes if l.reste > 0]) \
            if compte else Rubrique.objects.none()
        self.fields["date"].initial = timezone.localdate()

    def clean_date(self):
        d = self.cleaned_data["date"]
        if d > timezone.localdate():
            raise forms.ValidationError("La date ne peut pas être dans le futur.")
        return d

    def clean(self):
        data = super().clean()
        if data.get("mode") in (Paiement.ORANGE, Paiement.MTN) and not data.get("reference"):
            self.add_error("reference", "La référence de transaction est obligatoire pour un paiement mobile.")
        return data


class ReductionForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Reduction
        fields = ["rubrique", "montant", "motif"]
        widgets = {"montant": forms.NumberInput(attrs={"min": 1, "step": 1})}

    def __init__(self, *args, compte=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["rubrique"].queryset = Rubrique.objects.filter(id__in=[l.rubrique.id for l in compte.lignes if l.reste > 0]) \
            if compte else Rubrique.objects.none()


class RemboursementForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Remboursement
        fields = ["montant", "motif"]
        widgets = {"montant": forms.NumberInput(attrs={"min": 1, "step": 1})}


class AnnulationForm(forms.Form):
    motif = forms.CharField(max_length=200, widget=forms.TextInput(attrs={"class": "form-control"}))


class MouvementCaisseForm(BootstrapMixin, forms.ModelForm):
    matricule = forms.CharField(label="Matricule de l'élève (facultatif)", required=False, max_length=30)

    class Meta:
        model = MouvementCaisse
        fields = ["libelle", "montant", "tiers", "matricule", "mode", "reference", "date", "observation"]
        widgets = {"date": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
                   "montant": forms.NumberInput(attrs={"min": 1, "step": 1})}

    def __init__(self, *args, sens=LibelleCaisse.ENTREE, exercice=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.sens, self.exercice = sens, exercice
        self.fields["libelle"].queryset = LibelleCaisse.objects.filter(sens=sens, actif=True)
        self.fields["date"].initial = timezone.localdate()
        if sens == LibelleCaisse.SORTIE:
            del self.fields["matricule"]
            self.fields["tiers"].label = "Payé à"
        else:
            self.fields["tiers"].label = "Versé par"

    def clean_date(self):
        d = self.cleaned_data["date"]
        if d > timezone.localdate():
            raise forms.ValidationError("La date ne peut pas être dans le futur.")
        return d

    def clean_matricule(self):
        m = (self.cleaned_data.get("matricule") or "").strip()
        if not m:
            return None
        ins = Inscription.objects.filter(eleve__matricule=m, exercice=self.exercice).select_related("eleve").first()
        if not ins:
            raise forms.ValidationError("Aucun élève inscrit cette année avec ce matricule.")
        return ins

    def clean(self):
        data = super().clean()
        if data.get("mode") in (Paiement.ORANGE, Paiement.MTN) and not data.get("reference"):
            self.add_error("reference", "La référence de transaction est obligatoire pour un paiement mobile.")
        return data
