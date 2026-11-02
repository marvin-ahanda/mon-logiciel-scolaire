from django import forms
from django.contrib.auth.models import User
from django.core.files.uploadedfile import UploadedFile

from .models import Attribution, Classe, Eleve, Enseignant, Exercice, Inscription, Matiere
from .photos import preparer_photo


class BootstrapMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for f in self.fields.values():
            css = "form-check-input" if isinstance(f.widget, forms.CheckboxInput) else (
                "form-select" if isinstance(f.widget, forms.Select) else "form-control")
            f.widget.attrs.setdefault("class", css)


class ExerciceForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Exercice
        fields = ["libelle", "moyenne_passage"]


class ClasseForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Classe
        fields = ["libelle", "niveau", "section_anglophone", "classe_examen", "effectif_max", "coef_min_classement"]


class MatiereForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Matiere
        fields = ["code", "libelle", "libelle_en"]


class EnseignantForm(BootstrapMixin, forms.ModelForm):
    acces = forms.BooleanField(required=False, initial=True, label="Créer son accès au logiciel",
                               help_text="Un code de connexion de 6 caractères est généré automatiquement et affiché une seule fois.")

    class Meta:
        model = Enseignant
        fields = ["matricule", "nom", "prenom", "sexe", "telephone", "email"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.code = None
        if self.instance.pk and self.instance.utilisateur_id:
            self.fields["acces"].initial = False
            self.fields["acces"].label = "Générer un nouveau code d'accès"
            self.fields["acces"].help_text = "L'ancien code ne fonctionnera plus. Le nouveau code s'affiche une seule fois."

    def save(self, commit=True):
        from comptes.codes import attribuer_code, identifiant_libre
        ens = super().save(commit=commit)
        user = ens.utilisateur
        if user is None and not self.cleaned_data.get("acces"):
            return ens
        if user is None:
            user = User(username=identifiant_libre(ens.prenom, ens.nom))
            user.set_unusable_password()
        user.first_name, user.last_name, user.email = ens.prenom[:150], ens.nom[:150], ens.email   # nom tenu à jour pour la connexion
        user.save()
        if ens.utilisateur_id != user.id:
            ens.utilisateur = user
            ens.save(update_fields=["utilisateur"])
        if self.cleaned_data.get("acces"):
            self.code = attribuer_code(user)
        return ens


class EleveForm(BootstrapMixin, forms.ModelForm):
    supprimer_photo = forms.BooleanField(required=False, label="Supprimer la photo actuelle")
    classe = forms.ModelChoiceField(queryset=Classe.objects.all(), required=False,
                                    help_text="Classe pour l'exercice actif.")
    redoublant = forms.BooleanField(required=False)
    statut = forms.ChoiceField(choices=Inscription.STATUTS, initial=Inscription.NOUVEAU, required=False,
                               label="Statut dans l'établissement", help_text="Détermine les tarifs d'écolage (nouvel élève par défaut).")

    class Meta:
        model = Eleve
        fields = ["matricule", "nom", "prenom", "sexe", "date_naissance", "lieu_naissance",
                  "nom_pere", "nom_mere", "telephone_parent", "photo"]
        widgets = {"date_naissance": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
                   "photo": forms.FileInput(attrs={"accept": "image/jpeg,image/png,image/webp"})}

    def clean_photo(self):
        photo = self.cleaned_data.get("photo")
        if isinstance(photo, UploadedFile):
            return preparer_photo(photo)
        return photo

    def __init__(self, *args, exercice=None, **kwargs):
        self.exercice = exercice
        super().__init__(*args, **kwargs)
        if self.instance.pk and exercice:
            ins = Inscription.objects.filter(eleve=self.instance, exercice=exercice).first()
            if ins:
                self.fields["classe"].initial = ins.classe_id
                self.fields["redoublant"].initial = ins.redoublant
                self.fields["statut"].initial = ins.statut

    def clean(self):
        data = super().clean()
        classe = data.get("classe")
        if classe and self.exercice:
            ins = Inscription.objects.filter(eleve=self.instance, exercice=self.exercice).first() if self.instance.pk else None
            if ins and ins.classe_id != classe.id and ins.notes.exists():
                self.add_error("classe", "Cet élève a déjà des notes dans sa classe actuelle : changement de classe impossible.")
                return data
            cible = ins or Inscription(exercice=self.exercice)
            cible.classe = classe
            try:
                cible.clean()
            except forms.ValidationError as e:
                self.add_error("classe", e)
        return data

    def save(self, commit=True):
        ancienne = Eleve.objects.get(pk=self.instance.pk).photo.name if self.instance.pk else ""
        if self.cleaned_data.get("supprimer_photo") and not isinstance(self.files.get("photo"), UploadedFile):
            self.instance.photo = None
        eleve = super().save(commit=commit)
        if ancienne and ancienne != (eleve.photo.name or ""):
            eleve.photo.storage.delete(ancienne)            # pas de fichier orphelin
        classe = self.cleaned_data.get("classe")
        if self.exercice:
            ins = Inscription.objects.filter(eleve=eleve, exercice=self.exercice).first()
            if classe:
                statut = self.cleaned_data.get("statut") or Inscription.NOUVEAU
                if ins:
                    ins.classe, ins.redoublant, ins.statut = classe, self.cleaned_data.get("redoublant", False), statut
                    ins.save()
                else:
                    Inscription.objects.create(eleve=eleve, exercice=self.exercice, classe=classe, statut=statut,
                                               redoublant=self.cleaned_data.get("redoublant", False))
            elif ins and not (ins.notes.exists() or ins.paiement_set.exists() or ins.reduction_set.exists()
                              or ins.remboursement_set.exists()):
                ins.delete()
        return eleve


class AttributionForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Attribution
        fields = ["matiere", "enseignant", "coefficient", "groupe"]
