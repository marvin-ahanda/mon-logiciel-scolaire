"""Établissements abonnés au SaaS. Chaque établissement a son propre schéma PostgreSQL (django-tenants) :
ses élèves, notes, finances et comptes du personnel ne sont jamais mélangés à ceux d'un autre établissement."""

import unicodedata

from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone
from django_tenants.models import DomainMixin, TenantMixin


def normaliser_nom(nom):
    """« Collège Saint-Joseph » et « college saint joseph » désignent le même établissement."""
    t = unicodedata.normalize("NFKD", nom or "").encode("ascii", "ignore").decode().lower()
    return "".join(c for c in t if c.isalnum())


class EspaceEtablissement(TenantMixin):
    nom = models.CharField("nom de l'établissement", max_length=200)
    nom_normalise = models.CharField(max_length=200, unique=True, editable=False)
    ville = models.CharField(max_length=100, blank=True)
    code_hash = models.CharField(max_length=128, blank=True, editable=False)
    code_genere_le = models.DateTimeField(null=True, blank=True, editable=False)
    actif = models.BooleanField(default=True, help_text="Un établissement désactivé ne peut plus être ouvert.")
    demonstration = models.BooleanField(default=False, help_text="Données fictives ; aucun SMS réel n'est envoyé.")
    cree_le = models.DateTimeField(auto_now_add=True)

    auto_create_schema = True       # création du schéma et des tables à l'enregistrement
    auto_drop_schema = False        # jamais de suppression automatique des données

    class Meta:
        verbose_name = "établissement"
        ordering = ["nom"]

    def __str__(self):
        return self.nom

    def save(self, *args, **kwargs):
        self.nom_normalise = normaliser_nom(self.nom)
        super().save(*args, **kwargs)

    def definir_code(self, code):
        self.code_hash, self.code_genere_le = make_password(code), timezone.now()

    def verifier_code(self, code):
        return bool(self.code_hash) and check_password(code, self.code_hash)


class Domaine(DomainMixin):
    """Exigé par django-tenants ; inutilisé : l'établissement est choisi par son nom et son code, pas par l'adresse."""


class TentativeAcces(models.Model):
    """Compteur d'échecs par origine (adresse IP) pour freiner les essais de codes au hasard."""
    cle = models.CharField(max_length=200, unique=True)
    echecs = models.PositiveIntegerField(default=0)
    bloque_jusqu_a = models.DateTimeField(null=True, blank=True)
    maj = models.DateTimeField(auto_now=True)
