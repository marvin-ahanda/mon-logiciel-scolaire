from django.conf import settings
from django.db import models
from django.utils import timezone


class AccesPersonnel(models.Model):
    """Suivi du code de connexion d'un membre du personnel et protection contre les essais répétés."""
    utilisateur = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="acces")
    code_genere_le = models.DateTimeField("code généré le", null=True, blank=True)
    echecs = models.PositiveSmallIntegerField(default=0)
    bloque_jusqu_a = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "accès du personnel"
        verbose_name_plural = "accès du personnel"

    @property
    def bloque(self):
        return self.bloque_jusqu_a is not None and self.bloque_jusqu_a > timezone.now()
