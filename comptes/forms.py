from django import forms
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.db.models import Q

from scolarite.forms import BootstrapMixin

from .roles import ADMINISTRATION, CAISSE, ROLES, SURVEILLANCE, est_administration


def administrateurs_actifs():
    return User.objects.filter(Q(groups__name=ADMINISTRATION) | Q(is_superuser=True), is_active=True).distinct()


class UtilisateurForm(BootstrapMixin, forms.ModelForm):
    role = forms.ChoiceField(label="Rôle", choices=[("", "Aucun (compte enseignant)")] + ROLES, required=False)
    mot_de_passe = forms.CharField(label="Mot de passe", required=False, widget=forms.PasswordInput(render_value=False),
                                   help_text="Obligatoire à la création ; laisser vide pour ne pas le changer.")

    class Meta:
        model = User
        fields = ["username", "first_name", "last_name", "email", "is_active"]
        labels = {"username": "Identifiant", "first_name": "Prénom", "last_name": "Nom", "is_active": "Compte actif"}
        help_texts = {"username": "", "is_active": "Un compte inactif ne peut plus se connecter."}

    def __init__(self, *args, demandeur=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.demandeur = demandeur
        u = self.instance
        if u.pk:
            noms = set(u.groups.values_list("name", flat=True))
            self.fields["role"].initial = ADMINISTRATION if est_administration(u) else (
                CAISSE if CAISSE in noms else SURVEILLANCE if SURVEILLANCE in noms else "")
            if u.is_superuser:
                self.fields["role"].disabled = True
                self.fields["role"].help_text = "Superutilisateur : toujours administration."

    def clean(self):
        data = super().clean()
        u, role, actif = self.instance, data.get("role"), data.get("is_active")
        if not u.pk and not data.get("mot_de_passe"):
            self.add_error("mot_de_passe", "Un mot de passe est requis pour créer le compte.")
        if data.get("mot_de_passe"):
            try:
                validate_password(data["mot_de_passe"], u if u.pk else None)
            except forms.ValidationError as e:
                self.add_error("mot_de_passe", e)
        if u.pk and u == self.demandeur:
            if not actif:
                self.add_error("is_active", "Vous ne pouvez pas désactiver votre propre compte.")
            if role != ADMINISTRATION and not u.is_superuser:
                self.add_error("role", "Vous ne pouvez pas retirer vos propres droits d'administration.")
        if u.pk and est_administration(u) and (role != ADMINISTRATION or not actif) and not u.is_superuser:
            if administrateurs_actifs().exclude(pk=u.pk).count() == 0:
                raise forms.ValidationError("Il doit rester au moins un compte d'administration actif.")
        if not role and not u.pk:
            self.add_error("role", "Choisissez un rôle. Les comptes enseignants se créent depuis la fiche de l'enseignant.")
        return data

    def save(self, commit=True):
        u = super().save(commit=False)
        role = self.cleaned_data.get("role")
        if self.cleaned_data.get("mot_de_passe"):
            u.set_password(self.cleaned_data["mot_de_passe"])
        if not u.is_superuser:
            u.is_staff = role == ADMINISTRATION        # accès à l'administration avancée
        u.save()
        if not u.is_superuser:
            u.groups.remove(*Group.objects.filter(name__in=[ADMINISTRATION, CAISSE, SURVEILLANCE]))
            if role:
                u.groups.add(Group.objects.get(name=role))
        return u
