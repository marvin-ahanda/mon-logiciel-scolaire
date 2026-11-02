from django import forms
from django.contrib.auth.models import Group, User
from django.db.models import Q

from scolarite.forms import BootstrapMixin

from .codes import attribuer_code, identifiant_libre
from .roles import ADMINISTRATION, CAISSE, ROLES, SURVEILLANCE, est_administration


def administrateurs_actifs():
    return User.objects.filter(Q(groups__name=ADMINISTRATION) | Q(is_superuser=True), is_active=True).distinct()


class UtilisateurForm(BootstrapMixin, forms.ModelForm):
    role = forms.ChoiceField(label="Rôle", choices=[("", "Aucun (compte enseignant)")] + ROLES, required=False)
    nouveau_code = forms.BooleanField(label="Générer un nouveau code d'accès", required=False,
                                      help_text="L'ancien code ne fonctionnera plus. Le nouveau code s'affiche une seule fois.")

    class Meta:
        model = User
        fields = ["username", "first_name", "last_name", "email", "is_active"]
        labels = {"username": "Identifiant interne", "first_name": "Prénom", "last_name": "Nom", "is_active": "Compte actif"}
        help_texts = {"username": "Facultatif : déduit du nom s'il est laissé vide. Il n'est pas demandé à la connexion.",
                      "is_active": "Un compte inactif ne peut plus se connecter."}

    def __init__(self, *args, demandeur=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.demandeur = demandeur
        self.code = None
        u = self.instance
        self.fields["username"].required = False
        self.fields["last_name"].required = True       # le nom apparaît dans la liste de connexion
        if not u.pk:
            del self.fields["nouveau_code"]            # à la création, le code est toujours généré
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
        creation = u.pk is None
        if not u.username:
            u.username = identifiant_libre(u.first_name, u.last_name)
        if creation:
            u.set_unusable_password()
        if not u.is_superuser:
            u.is_staff = role == ADMINISTRATION        # accès à l'administration avancée
        u.save()
        if not u.is_superuser:
            u.groups.remove(*Group.objects.filter(name__in=[ADMINISTRATION, CAISSE, SURVEILLANCE]))
            if role:
                u.groups.add(Group.objects.get(name=role))
        if creation or self.cleaned_data.get("nouveau_code"):
            self.code = attribuer_code(u)
        return u
