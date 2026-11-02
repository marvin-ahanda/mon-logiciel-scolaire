"""Stockage des fichiers envoyés dans la base de données (schéma de l'établissement courant)."""

from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class StockageEnBase(Storage):
    def _modele(self):
        from .models import FichierStocke
        return FichierStocke

    def _open(self, name, mode="rb"):
        f = self._modele().objects.get(nom=name)
        return ContentFile(bytes(f.contenu), name=name)

    def _save(self, name, content):
        content.seek(0)
        donnees = content.read()
        self._modele().objects.update_or_create(nom=name, defaults={"contenu": donnees, "taille": len(donnees)})
        return name

    def exists(self, name):
        return self._modele().objects.filter(nom=name).exists()

    def delete(self, name):
        self._modele().objects.filter(nom=name).delete()

    def size(self, name):
        return self._modele().objects.values_list("taille", flat=True).get(nom=name)

    def url(self, name):
        raise NotImplementedError("Les fichiers sont servis par des vues protégées, jamais par une adresse publique.")
