"""Création et gestion des espaces d'établissement."""

import io
import secrets

from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.db import connection, transaction
from django.utils.text import slugify
from django_tenants.utils import schema_context

from comptes.codes import CHIFFRES, LETTRES, attribuer_code, identifiant_libre, nom_affiche

from .models import EspaceEtablissement, normaliser_nom

LONGUEUR_CODE_ETABLISSEMENT = 8


def generer_code_etablissement():
    """Code d'établissement : 8 caractères (lettres minuscules sans i/l/o, et chiffres), au moins un de chaque."""
    while True:
        code = "".join(secrets.choice(LETTRES + CHIFFRES) for _ in range(LONGUEUR_CODE_ETABLISSEMENT))
        if any(c in LETTRES for c in code) and any(c in CHIFFRES for c in code):
            return code


def nouveau_schema(nom):
    base = slugify(nom).replace("-", "_")[:40].strip("_") or "etab"
    while True:
        schema = f"etab_{base}_{secrets.token_hex(2)}"
        if not EspaceEtablissement.objects.filter(schema_name=schema).exists():
            return schema


def trouver_espace(nom, code):
    """Espace actif correspondant au nom (casse et accents ignorés) et au code, sinon None."""
    espace = EspaceEtablissement.objects.filter(nom_normalise=normaliser_nom(nom), actif=True).first()
    if espace is None:
        EspaceEtablissement().verifier_code(code)       # même durée de réponse, que le nom existe ou non
        return None
    return espace if espace.verifier_code((code or "").strip().lower()) else None


def nom_disponible(nom):
    return bool(normaliser_nom(nom)) and not EspaceEtablissement.objects.filter(nom_normalise=normaliser_nom(nom)).exists()


def creer_espace(nom, ville="", admin_nom="", admin_prenom="", demonstration=False):
    """Crée l'établissement, son schéma et ses tables, puis son premier administrateur (ou des données fictives).

    Renvoie (espace, code de l'établissement, [(nom, rôle, code personnel)]) ; les codes ne sont lisibles qu'ici.
    """
    code = generer_code_etablissement()
    espace = EspaceEtablissement(nom=nom.strip(), ville=ville.strip(), schema_name=nouveau_schema(nom),
                                 demonstration=demonstration)
    espace.definir_code(code)
    espace.save()                                   # crée le schéma et applique toutes les migrations
    acces = []
    with schema_context(espace.schema_name):
        from comptes.roles import ADMINISTRATION, libelle_role
        from scolarite.models import Etablissement
        if demonstration:
            from scolarite.management.commands.donnees_demo import Command as Demo
            demo = Demo(stdout=io.StringIO())
            demo.codes_aleatoires = True
            demo.handle()
            Etablissement.objects.update(nom=espace.nom)
            acces = sorted((nom_affiche(u), libelle_role(u), c) for u, c in demo.acces)
        else:
            with transaction.atomic():
                Etablissement.objects.create(nom=espace.nom, ville=espace.ville)
                admin = User.objects.create_user(identifiant_libre(admin_prenom, admin_nom), first_name=admin_prenom.strip(),
                                                 last_name=admin_nom.strip().upper(), is_staff=True)
                admin.set_unusable_password()
                admin.save()
                admin.groups.add(Group.objects.get(name=ADMINISTRATION))
                acces = [(nom_affiche(admin), libelle_role(admin), attribuer_code(admin))]
    return espace, code, acces


def nouveau_code(espace):
    code = generer_code_etablissement()
    espace.definir_code(code)
    espace.save(update_fields=["code_hash", "code_genere_le"])
    return code


def mettre_a_jour_les_schemas(communs_seulement=False):
    """Applique les migrations au schéma commun puis à chaque établissement ; renvoie le journal."""
    sortie = io.StringIO()
    connection.set_schema_to_public()
    call_command("migrate_schemas", shared=communs_seulement, interactive=False, verbosity=1, stdout=sortie, stderr=sortie)
    return sortie.getvalue()
