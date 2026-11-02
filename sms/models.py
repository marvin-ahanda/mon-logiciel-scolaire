"""SMS aux parents : crédits et journal des messages (mes_* de l'original)."""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Sum


class CreditSMS(models.Model):
    """Rechargement du compte SMS (mes_credits_sms)."""

    quantite = models.PositiveIntegerField("nombre de SMS", validators=[MinValueValidator(1)])
    note = models.CharField(max_length=200, blank=True)
    ajoute_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    ajoute_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-ajoute_le"]
        verbose_name = "crédit SMS"

    @staticmethod
    def solde():
        credits = CreditSMS.objects.aggregate(t=Sum("quantite"))["t"] or 0
        consommes = MessageSMS.objects.filter(statut=MessageSMS.ENVOYE).aggregate(t=Sum("parties"))["t"] or 0
        return credits - consommes


class MessageSMS(models.Model):
    SIMULE, ENVOYE, ECHEC = "simulé", "envoyé", "échec"
    STATUTS = [(SIMULE, "Simulé (non envoyé)"), (ENVOYE, "Envoyé"), (ECHEC, "Échec")]
    OBJETS = [("resultats", "Résultats"), ("ecolage", "Rappel d'écolage"), ("absences", "Absences et retards"),
              ("paiement", "Notification de paiement"), ("libre", "Message libre")]

    objet = models.CharField(max_length=20, choices=OBJETS)
    eleve = models.ForeignKey("scolarite.Eleve", on_delete=models.SET_NULL, null=True, blank=True, related_name="sms")
    telephone = models.CharField(max_length=20)
    texte = models.TextField()
    parties = models.PositiveSmallIntegerField(default=1)
    statut = models.CharField(max_length=10, choices=STATUTS)
    erreur = models.CharField(max_length=200, blank=True)
    envoye_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    envoye_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-envoye_le"]
        verbose_name = "SMS"

    def __str__(self):
        return f"{self.telephone} — {self.texte[:40]}"
