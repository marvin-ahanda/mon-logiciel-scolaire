"""Génère un nouveau code d'accès pour un compte (dépannage : administrateur ayant perdu son code).

Usage : python manage.py code_acces <identifiant interne>
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from comptes.codes import attribuer_code, nom_affiche


class Command(BaseCommand):
    help = "Génère un nouveau code d'accès de 6 caractères pour un membre du personnel."

    def add_arguments(self, parser):
        parser.add_argument("identifiant", help="identifiant interne du compte (visible dans « Personnel et codes d'accès »)")

    def handle(self, identifiant, **options):
        try:
            user = User.objects.get(username=identifiant)
        except User.DoesNotExist:
            raise CommandError(f"Aucun compte « {identifiant} ». Comptes : " + ", ".join(User.objects.values_list("username", flat=True)))
        code = attribuer_code(user)
        self.stdout.write(self.style.SUCCESS(f"Nouveau code d'accès de {nom_affiche(user)} : {code}"))
