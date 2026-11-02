"""Emploi du temps.

Correspondance avec la base d'origine : heures (cod_int_tem, des_int_tem) -> Creneau ; emploi_du_temps -> Cours.
"""

from django.core.exceptions import ValidationError
from django.db import models

from scolarite.models import Attribution, Classe, Exercice

JOURS = [(1, "Lundi"), (2, "Mardi"), (3, "Mercredi"), (4, "Jeudi"), (5, "Vendredi"), (6, "Samedi")]


class Creneau(models.Model):
    ordre = models.PositiveSmallIntegerField(default=0)
    heure_debut = models.TimeField("début")
    heure_fin = models.TimeField("fin")
    pause = models.BooleanField(default=False, help_text="Récréation ou pause : aucun cours possible.")

    class Meta:
        ordering = ["ordre", "heure_debut"]
        verbose_name = "créneau horaire"

    def __str__(self):
        return f"{self.heure_debut:%Hh%M} – {self.heure_fin:%Hh%M}"

    def clean(self):
        if self.heure_debut and self.heure_fin and self.heure_debut >= self.heure_fin:
            raise ValidationError("L'heure de début doit précéder l'heure de fin.")


class Cours(models.Model):
    exercice = models.ForeignKey(Exercice, on_delete=models.CASCADE, related_name="cours")
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="cours")
    jour = models.PositiveSmallIntegerField(choices=JOURS)
    creneau = models.ForeignKey(Creneau, on_delete=models.CASCADE, related_name="cours")
    attribution = models.ForeignKey(Attribution, on_delete=models.CASCADE, related_name="cours")
    salle = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["jour", "creneau__ordre"]
        verbose_name_plural = "cours"
        constraints = [models.UniqueConstraint(fields=["exercice", "classe", "jour", "creneau"], name="un_cours_par_classe_et_creneau")]

    def __str__(self):
        return f"{self.classe} — {self.get_jour_display()} {self.creneau} — {self.attribution.matiere}"

    def conflits(self):
        """Messages d'erreur si l'enseignant ou la salle est déjà occupé sur ce créneau."""
        erreurs = []
        meme_creneau = Cours.objects.filter(exercice_id=self.exercice_id, jour=self.jour, creneau_id=self.creneau_id).exclude(classe_id=self.classe_id)
        ens = self.attribution.enseignant
        if ens:
            autre = meme_creneau.filter(attribution__enseignant=ens).select_related("classe").first()
            if autre:
                erreurs.append(f"{ens} a déjà cours en {autre.classe} à ce moment")
        if self.salle:
            autre = meme_creneau.filter(salle__iexact=self.salle).select_related("classe").first()
            if autre:
                erreurs.append(f"la salle {self.salle} est déjà occupée par la {autre.classe}")
        return erreurs

    def clean(self):
        if self.attribution_id and (self.attribution.classe_id != self.classe_id or self.attribution.exercice_id != self.exercice_id):
            raise ValidationError("Cette matière n'est pas enseignée dans cette classe pour cet exercice.")
        if self.creneau_id and self.creneau.pause:
            raise ValidationError("Aucun cours possible pendant une pause.")
        erreurs = self.conflits()
        if erreurs:
            raise ValidationError(" ; ".join(erreurs))
