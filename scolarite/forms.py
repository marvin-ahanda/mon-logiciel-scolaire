from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password

from .models import Attribution, Classe, Eleve, Enseignant, Exercice, Inscription, Matiere


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
    identifiant = forms.CharField(required=False, help_text="Identifiant de connexion (facultatif).")
    mot_de_passe = forms.CharField(required=False, widget=forms.PasswordInput(render_value=False),
                                   help_text="Laisser vide pour ne pas changer le mot de passe.")

    class Meta:
        model = Enseignant
        fields = ["matricule", "nom", "prenom", "sexe", "telephone", "email"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk and self.instance.utilisateur:
            self.fields["identifiant"].initial = self.instance.utilisateur.username

    def clean(self):
        data = super().clean()
        ident, mdp = data.get("identifiant"), data.get("mot_de_passe")
        user = self.instance.utilisateur if self.instance.pk else None
        if ident:
            autre = User.objects.filter(username=ident).exclude(pk=getattr(user, "pk", None))
            if autre.exists():
                self.add_error("identifiant", "Cet identifiant est déjà utilisé.")
            if user is None and not mdp:
                self.add_error("mot_de_passe", "Un mot de passe est requis pour créer le compte.")
        if mdp:
            if not ident:
                self.add_error("identifiant", "Indiquez un identifiant pour ce mot de passe.")
            else:
                try:
                    validate_password(mdp, user)
                except forms.ValidationError as e:
                    self.add_error("mot_de_passe", e)
        return data

    def save(self, commit=True):
        ens = super().save(commit=commit)
        ident, mdp = self.cleaned_data.get("identifiant"), self.cleaned_data.get("mot_de_passe")
        if ident:
            user = ens.utilisateur or User(username=ident)
            user.username = ident
            user.first_name, user.last_name, user.email = ens.prenom, ens.nom, ens.email
            if mdp:
                user.set_password(mdp)
            user.save()
            if ens.utilisateur_id != user.id:
                ens.utilisateur = user
                ens.save(update_fields=["utilisateur"])
        return ens


class EleveForm(BootstrapMixin, forms.ModelForm):
    classe = forms.ModelChoiceField(queryset=Classe.objects.all(), required=False,
                                    help_text="Classe pour l'exercice actif.")
    redoublant = forms.BooleanField(required=False)
    statut = forms.ChoiceField(choices=Inscription.STATUTS, initial=Inscription.NOUVEAU, required=False,
                               label="Statut dans l'établissement", help_text="Détermine les tarifs d'écolage (nouvel élève par défaut).")

    class Meta:
        model = Eleve
        fields = ["matricule", "nom", "prenom", "sexe", "date_naissance", "lieu_naissance",
                  "nom_pere", "nom_mere", "telephone_parent"]
        widgets = {"date_naissance": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d")}

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
        eleve = super().save(commit=commit)
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
