"""Discipline : absences, retards, infractions et sanctions.

Correspondance avec la base d'origine :
- Sanction               <- sanctions + parametrage_sanctions (per_pts : points perdus)
- Infraction             <- infractions (num_inf, des_inf, num_san)
- ParametresDiscipline   <- parametrage_retards_absences (bar_ret, bar_abs)
- Absence                <- lignes_absences (heures non justifiées) + lignes_absencesj (heures justifiées)
- Retard                 <- lignes_retards
- Incident               <- lignes_autres_cas_infractions
"""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from scolarite.models import Exercice, Inscription, Sequence


class Sanction(models.Model):
    libelle = models.CharField("désignation", max_length=150, unique=True)
    points_perdus = models.DecimalField("points perdus sur la note de discipline", max_digits=4, decimal_places=2,
                                        default=0, validators=[MinValueValidator(0), MaxValueValidator(20)])

    class Meta:
        ordering = ["libelle"]

    def __str__(self):
        return f"{self.libelle} (−{self.points_perdus} pt)"


class Infraction(models.Model):
    libelle = models.CharField("désignation", max_length=200, unique=True)
    sanction = models.ForeignKey(Sanction, on_delete=models.PROTECT, related_name="infractions")

    class Meta:
        ordering = ["libelle"]

    def __str__(self):
        return self.libelle


class ParametresDiscipline(models.Model):
    """Barème de la note de discipline pour un exercice."""

    exercice = models.OneToOneField(Exercice, on_delete=models.CASCADE, related_name="parametres_discipline")
    note_max = models.DecimalField("note de discipline maximale", max_digits=4, decimal_places=2, default=20,
                                   validators=[MinValueValidator(1), MaxValueValidator(20)])
    points_par_retard = models.DecimalField("points perdus par retard", max_digits=4, decimal_places=2, default=Decimal("0.25"),
                                            validators=[MinValueValidator(0), MaxValueValidator(20)])
    points_par_heure_absence = models.DecimalField("points perdus par heure d'absence non justifiée", max_digits=4,
                                                   decimal_places=2, default=Decimal("0.25"),
                                                   validators=[MinValueValidator(0), MaxValueValidator(20)])

    class Meta:
        verbose_name = "paramètres de discipline"
        verbose_name_plural = "paramètres de discipline"

    def __str__(self):
        return f"Barème de discipline {self.exercice}"

    @classmethod
    def pour(cls, exercice):
        return cls.objects.get_or_create(exercice=exercice)[0]


class EvenementDiscipline(models.Model):
    inscription = models.ForeignKey(Inscription, on_delete=models.CASCADE)
    sequence = models.ForeignKey(Sequence, on_delete=models.PROTECT)
    date = models.DateField()
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    saisi_le = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    def clean(self):
        if self.inscription_id and self.sequence_id and self.inscription.exercice_id != self.sequence.exercice_id:
            raise ValidationError("L'élève et la séquence doivent appartenir au même exercice.")
        if self.sequence_id and self.sequence.verrouillee:
            raise ValidationError("Opération refusée. La séquence spécifiée est fermée.")


class Absence(EvenementDiscipline):
    heures_non_justifiees = models.PositiveSmallIntegerField("heures non justifiées", default=0,
                                                             validators=[MaxValueValidator(24)])
    heures_justifiees = models.PositiveSmallIntegerField("heures justifiées", default=0, validators=[MaxValueValidator(24)])
    motif = models.CharField("motif de justification", max_length=200, blank=True)

    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["inscription", "date"], name="une_absence_par_jour")]

    def __str__(self):
        return f"{self.inscription.eleve} — {self.date} : {self.heures_non_justifiees} h NJ, {self.heures_justifiees} h J"


class Retard(EvenementDiscipline):
    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["inscription", "date"], name="un_retard_par_jour")]

    def __str__(self):
        return f"{self.inscription.eleve} — retard le {self.date}"


class Incident(EvenementDiscipline):
    """Autre cas d'infraction à la discipline."""

    infraction = models.ForeignKey(Infraction, on_delete=models.PROTECT, related_name="incidents")
    observation = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.inscription.eleve} — {self.infraction} ({self.date})"
