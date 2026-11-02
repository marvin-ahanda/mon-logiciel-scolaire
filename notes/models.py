"""Notes et barèmes.

Correspondance avec la base d'origine :
- Note             <- lignes_notes (mat_ele, num_exe, cod_mat, not_seq)
- BaremeDistinction <- bareme_tableau_honneur, bareme_encouragements, bareme_felicitations,
                       bareme_avertissement_travail, bareme_blame_travail

Un élève sans note dans une matière pour une séquence est « non évalué » :
la matière est alors exclue de sa moyenne (comportement de l'original, « ELEVE NON EVALUE »).
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from scolarite.models import Attribution, Exercice, Inscription, Sequence


class Note(models.Model):
    inscription = models.ForeignKey(Inscription, on_delete=models.CASCADE, related_name="notes")
    attribution = models.ForeignKey(Attribution, on_delete=models.CASCADE, related_name="notes")
    sequence = models.ForeignKey(Sequence, on_delete=models.PROTECT, related_name="notes")
    valeur = models.DecimalField(max_digits=4, decimal_places=2,
                                 validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("20"))])
    saisie_par = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["inscription", "attribution", "sequence"], name="une_note_par_matiere_et_sequence"),
        ]

    def __str__(self):
        return f"{self.inscription.eleve} — {self.attribution.matiere} — {self.sequence.libelle} : {self.valeur}"

    def clean(self):
        if not (self.inscription_id and self.attribution_id and self.sequence_id):
            return
        if self.inscription.exercice_id != self.sequence.exercice_id or self.attribution.exercice_id != self.sequence.exercice_id:
            raise ValidationError("L'élève, la matière et la séquence doivent appartenir au même exercice.")
        if self.inscription.classe_id != self.attribution.classe_id:
            raise ValidationError("La matière n'est pas enseignée dans la classe de l'élève.")
        if self.sequence.verrouillee:
            raise ValidationError("Opération refusée. La séquence spécifiée est fermée.")


class BaremeDistinction(models.Model):
    """Condition d'attribution d'une distinction ou d'une sanction de travail, par exercice.

    Tableau d'honneur, encouragements, félicitations, avertissement :
        moyenne dans [borne_inf ; borne_sup[  (borne inférieure comprise, borne supérieure exclue)
    Blâme : moyenne strictement inférieure à borne_sup (borne_inf ignorée).

    Tableau d'honneur, encouragements, félicitations : condition supplémentaire facultative
    « et note de conduite strictement supérieure à » (comme dans l'original).
    """

    TABLEAU_HONNEUR = "TH"
    ENCOURAGEMENTS = "ENC"
    FELICITATIONS = "FEL"
    AVERTISSEMENT = "AVT"
    BLAME = "BLA"
    TYPES = [
        (TABLEAU_HONNEUR, "Tableau d'honneur"),
        (ENCOURAGEMENTS, "Encouragements"),
        (FELICITATIONS, "Félicitations"),
        (AVERTISSEMENT, "Avertissement travail"),
        (BLAME, "Blâme travail"),
    ]

    exercice = models.ForeignKey(Exercice, on_delete=models.CASCADE, related_name="baremes")
    type = models.CharField(max_length=3, choices=TYPES)
    borne_inf = models.DecimalField("borne inférieure (comprise)", max_digits=4, decimal_places=2, null=True, blank=True)
    borne_sup = models.DecimalField("borne supérieure (exclue)", max_digits=4, decimal_places=2)
    conduite_min = models.DecimalField("note de conduite strictement supérieure à", max_digits=4, decimal_places=2,
                                       null=True, blank=True,
                                       help_text="Tableau d'honneur, encouragements, félicitations uniquement. Vide = pas de condition.")

    class Meta:
        ordering = ["exercice", "type"]
        verbose_name = "barème de distinction"
        constraints = [models.UniqueConstraint(fields=["exercice", "type"], name="un_bareme_par_type")]

    def __str__(self):
        return f"{self.get_type_display()} ({self.exercice})"

    AVEC_CONDUITE = (TABLEAU_HONNEUR, ENCOURAGEMENTS, FELICITATIONS)

    def clean(self):
        if self.conduite_min is not None and self.type not in self.AVEC_CONDUITE:
            raise ValidationError("La condition de conduite ne s'applique qu'au tableau d'honneur, aux encouragements et aux félicitations.")
        if self.type != self.BLAME:
            if self.borne_inf is None:
                raise ValidationError("La borne inférieure est obligatoire pour ce type.")
            if self.borne_inf >= self.borne_sup:
                raise ValidationError("La borne inférieure doit être strictement inférieure à la borne supérieure.")

    def s_applique(self, moyenne, note_conduite=None):
        if moyenne is None:
            return False
        if self.type == self.BLAME:
            return moyenne < self.borne_sup
        if not (self.borne_inf <= moyenne < self.borne_sup):
            return False
        if self.conduite_min is not None and self.type in self.AVEC_CONDUITE:
            return note_conduite is not None and note_conduite > self.conduite_min
        return True
