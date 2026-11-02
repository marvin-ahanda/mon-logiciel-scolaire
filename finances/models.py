"""Finances et écolage.

Correspondance avec la base d'origine :
- Rubrique   <- tranches (cod_tra, des_tra) — écran « Rubriques »
- Tarif      <- prix_tranches (cod_tra, cod_niv, num_exe, sta_ele_eta, pri_tra)
- Paiement   <- payements (mat_ele, num_exe, cod_tra, mon_pay, dat_pay, heu_pay, num_rec, opr_mob)
                + payements_modifies : ici, une erreur s'annule avec un motif au lieu d'être modifiée
- Reduction  <- reductions (mat_ele, cod_tra, mon_red, cod_lib, dat_red)
- Remboursement <- remboursements (mat_ele, mon_rem)

Montants en francs CFA, entiers.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from scolarite.models import Exercice, Inscription, Niveau


class Rubrique(models.Model):
    libelle = models.CharField("désignation", max_length=100, unique=True, help_text="Ex. : Inscription, 1re tranche…")
    ordre = models.PositiveSmallIntegerField(default=0)
    echeance = models.CharField("échéance", max_length=100, blank=True, help_text="Texte libre, ex. : avant le 30 octobre")

    class Meta:
        ordering = ["ordre", "libelle"]

    def __str__(self):
        return self.libelle


class Tarif(models.Model):
    exercice = models.ForeignKey(Exercice, on_delete=models.CASCADE, related_name="tarifs")
    rubrique = models.ForeignKey(Rubrique, on_delete=models.PROTECT, related_name="tarifs")
    niveau = models.ForeignKey(Niveau, on_delete=models.CASCADE, related_name="tarifs")
    statut = models.CharField("statut de l'élève", max_length=1, choices=Inscription.STATUTS)
    montant = models.PositiveIntegerField("montant (F CFA)")

    class Meta:
        ordering = ["exercice", "niveau", "statut", "rubrique__ordre"]
        constraints = [models.UniqueConstraint(fields=["exercice", "rubrique", "niveau", "statut"], name="tarif_unique")]

    def __str__(self):
        return f"{self.rubrique} — {self.niveau} — {self.get_statut_display()} : {self.montant} F"


class OperationEleve(models.Model):
    inscription = models.ForeignKey(Inscription, on_delete=models.PROTECT)
    montant = models.PositiveIntegerField("montant (F CFA)", validators=[MinValueValidator(1)])
    date = models.DateField(default=timezone.localdate)
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    saisi_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class Annulable(models.Model):
    """Annulation tracée (motif obligatoire). Une opération n'est jamais supprimée ni modifiée."""

    annule = models.BooleanField("annulé", default=False)
    motif_annulation = models.CharField("motif d'annulation", max_length=200, blank=True)
    annule_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    annule_le = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    def annulable_par(self, utilisateur):
        """Administration : toute opération. Caissier : ses propres opérations, enregistrées le jour même
        (heure réelle d'enregistrement, et non la date portée sur le reçu, qui peut être antérieure)."""
        from comptes.roles import est_administration, est_caissier
        if self.annule:
            return False
        if est_administration(utilisateur):
            return True
        return (est_caissier(utilisateur) and self.saisi_par_id == utilisateur.id
                and timezone.localdate(self.saisi_le) == timezone.localdate())

    def annuler(self, utilisateur, motif):
        if self.annule:
            raise ValidationError("Cette opération est déjà annulée.")
        if not motif.strip():
            raise ValidationError("Le motif d'annulation est obligatoire.")
        self.annule, self.motif_annulation, self.annule_par, self.annule_le = True, motif.strip()[:200], utilisateur, timezone.now()
        self.save(update_fields=["annule", "motif_annulation", "annule_par", "annule_le"])


class Paiement(OperationEleve, Annulable):
    ESPECES, ORANGE, MTN, CAMPOST, AUTRE = "ESP", "OM", "MTN", "CAM", "AUT"
    MODES = [(ESPECES, "Espèces"), (ORANGE, "Orange Money"), (MTN, "MTN Mobile Money"), (CAMPOST, "Campost"), (AUTRE, "Autre")]

    exercice = models.ForeignKey(Exercice, on_delete=models.PROTECT, related_name="paiements")
    rubrique = models.ForeignKey(Rubrique, on_delete=models.PROTECT, related_name="paiements")
    numero_recu = models.PositiveIntegerField("numéro de reçu")
    mode = models.CharField("mode de paiement", max_length=3, choices=MODES, default=ESPECES)
    reference = models.CharField("référence de transaction", max_length=100, blank=True)

    class Meta:
        ordering = ["-date", "-numero_recu"]
        constraints = [models.UniqueConstraint(fields=["exercice", "numero_recu"], name="recu_unique_par_exercice")]

    def __str__(self):
        return f"Reçu n° {self.numero_recu} — {self.inscription.eleve} — {self.montant} F"

    @property
    def est_arriere(self):
        """Règlement d'une dette d'une année antérieure (encaissé dans un autre exercice que celui de l'inscription)."""
        return self.inscription.exercice_id != self.exercice_id

    @classmethod
    @transaction.atomic
    def enregistrer(cls, **champs):
        """Crée le paiement avec le numéro de reçu suivant (sans doublon en cas de saisies simultanées).

        Le paiement est encaissé dans l'exercice actif (journal et numérotation du jour), même lorsqu'il règle
        une dette d'une année antérieure ; l'inscription concernée indique l'année réglée.
        """
        actif = Exercice.actif_courant()
        exercice = Exercice.objects.select_for_update().get(pk=actif.pk if actif else champs["inscription"].exercice_id)
        dernier = cls.objects.filter(exercice=exercice).aggregate(m=Max("numero_recu"))["m"] or 0
        return cls.objects.create(exercice=exercice, numero_recu=dernier + 1, **champs)


class Reduction(OperationEleve):
    rubrique = models.ForeignKey(Rubrique, on_delete=models.PROTECT, related_name="reductions")
    motif = models.CharField("libellé justificatif", max_length=200)

    class Meta:
        ordering = ["-date"]
        verbose_name = "réduction"

    def __str__(self):
        return f"Réduction {self.montant} F — {self.inscription.eleve} — {self.rubrique}"


class Remboursement(OperationEleve):
    motif = models.CharField("libellé justificatif", max_length=200)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"Remboursement {self.montant} F — {self.inscription.eleve}"


def total(qs):
    return qs.aggregate(t=Sum("montant"))["t"] or 0


# --- Caisse générale (autres entrées et sorties) -----------------------------------------------------
# Correspondance avec l'original : libelles_entrees_caisse, autres_entrees, autres_sorties,
# numero_recu_entrees / numero_recu_sorties, comptes (tiers).

class LibelleCaisse(models.Model):
    ENTREE, SORTIE = "E", "S"
    SENS = [(ENTREE, "Entrée"), (SORTIE, "Sortie")]

    libelle = models.CharField("désignation", max_length=150)
    sens = models.CharField(max_length=1, choices=SENS)
    actif = models.BooleanField(default=True)

    class Meta:
        ordering = ["sens", "libelle"]
        verbose_name = "libellé de caisse"
        constraints = [models.UniqueConstraint(fields=["libelle", "sens"], name="libelle_caisse_unique")]

    def __str__(self):
        return self.libelle


class MouvementCaisse(Annulable):
    """Entrée (reçu) ou sortie (bon de caisse) hors écolage."""

    exercice = models.ForeignKey(Exercice, on_delete=models.PROTECT, related_name="mouvements_caisse")
    sens = models.CharField(max_length=1, choices=LibelleCaisse.SENS)
    numero = models.PositiveIntegerField("numéro")
    libelle = models.ForeignKey(LibelleCaisse, on_delete=models.PROTECT, related_name="mouvements")
    montant = models.PositiveIntegerField("montant (F CFA)", validators=[MinValueValidator(1)])
    date = models.DateField(default=timezone.localdate)
    tiers = models.CharField("versé par / payé à", max_length=150)
    inscription = models.ForeignKey(Inscription, on_delete=models.PROTECT, null=True, blank=True, related_name="mouvements_caisse",
                                    help_text="Facultatif : élève concerné (vente de tenue, frais d'examen…).")
    mode = models.CharField("mode", max_length=3, choices=Paiement.MODES, default=Paiement.ESPECES)
    reference = models.CharField("référence", max_length=100, blank=True)
    observation = models.CharField(max_length=200, blank=True)
    saisi_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    saisi_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-numero"]
        verbose_name = "mouvement de caisse"
        constraints = [models.UniqueConstraint(fields=["exercice", "sens", "numero"], name="numero_caisse_unique")]

    def __str__(self):
        return f"{'Reçu' if self.sens == LibelleCaisse.ENTREE else 'Bon'} n° {self.numero} — {self.libelle} — {self.montant} F"

    @property
    def est_entree(self):
        return self.sens == LibelleCaisse.ENTREE

    @classmethod
    @transaction.atomic
    def enregistrer(cls, exercice, **champs):
        """Numérotation séparée des entrées et des sorties, sans doublon en cas de saisies simultanées."""
        exercice = Exercice.objects.select_for_update().get(pk=exercice.pk)
        champs["sens"] = champs["libelle"].sens
        dernier = cls.objects.filter(exercice=exercice, sens=champs["sens"]).aggregate(m=Max("numero"))["m"] or 0
        return cls.objects.create(exercice=exercice, numero=dernier + 1, **champs)


# --- Plan de financement (échéancier personnalisé) ---------------------------------------------------

class PlanFinancement(models.Model):
    """Échéancier accordé à un élève pour régler le reste de son écolage (plan_financement de l'original)."""

    inscription = models.OneToOneField(Inscription, on_delete=models.CASCADE, related_name="plan_financement")
    motif = models.CharField(max_length=200, blank=True)
    deja_verse = models.PositiveIntegerField("déjà versé à la création", default=0)
    cree_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "plan de financement"
        verbose_name_plural = "plans de financement"

    def __str__(self):
        return f"Plan de financement — {self.inscription.eleve}"

    def situation(self, total_verse, aujourd_hui=None):
        """Échéances avec état, montant dû à ce jour et retard.

        Les versements postérieurs à la création couvrent les échéances dans l'ordre chronologique.
        """
        aujourd_hui = aujourd_hui or timezone.localdate()
        verse_depuis = max(0, total_verse - self.deja_verse)
        disponible, lignes, du_a_date, echu = verse_depuis, [], 0, 0
        for e in self.echeances.all():
            couvert = min(e.montant, disponible)
            disponible -= couvert
            if e.date <= aujourd_hui:
                du_a_date += e.montant
            if e.date < aujourd_hui:            # une échéance du jour n'est pas encore en retard
                echu += e.montant
            etat = "payée" if couvert == e.montant else ("en retard" if e.date < aujourd_hui else "à venir")
            lignes.append({"echeance": e, "couvert": couvert, "etat": etat})
        return lignes, du_a_date, max(0, echu - verse_depuis)


class Echeance(models.Model):
    plan = models.ForeignKey(PlanFinancement, on_delete=models.CASCADE, related_name="echeances")
    date = models.DateField()
    montant = models.PositiveIntegerField("montant (F CFA)", validators=[MinValueValidator(1)])

    class Meta:
        ordering = ["date"]
        verbose_name = "échéance"

    def __str__(self):
        return f"{self.date:%d/%m/%Y} : {self.montant} F"


def repartir(reste, nombre, premiere_date):
    """Répartit `reste` en `nombre` échéances mensuelles (montants arrondis à 500 F, la dernière absorbe l'écart)."""
    from calendar import monthrange
    if nombre < 1 or reste < 1:
        return []
    base = (reste // nombre) // 500 * 500 or reste // nombre
    dates, annee, mois, jour = [], premiere_date.year, premiere_date.month, premiere_date.day
    for i in range(nombre):
        m = mois + i
        a, m = annee + (m - 1) // 12, (m - 1) % 12 + 1
        dates.append(premiere_date.replace(year=a, month=m, day=min(jour, monthrange(a, m)[1])))
    montants = [base] * (nombre - 1) + [reste - base * (nombre - 1)]
    return list(zip(dates, montants))
