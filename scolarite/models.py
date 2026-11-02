"""Modele scolaire d'OtourixSchool.

Correspondance avec la base d'origine (Nouvelle_Vision) :
- Etablissement            <- etablissement_republique
- Exercice                 <- exercices (num_exe, des_exe, eta_exe='Active')
- Sequence                 <- sequences (cod_seq, des_seq, des_tri, eta_seq) + verrouillage par exercice
- Cycle / Niveau / Classe  <- cycles / niveaux / classes (sec_ang, cla_exa)
- Matiere                  <- matieres
- Enseignant               <- enseignants + comptes_enseignants
- Eleve                    <- eleves
- Inscription              <- lignes_classes (mat_ele, cod_cla, num_exe)
- Attribution              <- attribution_matieres + attribution_coefficients_groupes
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction


class Etablissement(models.Model):
    nom = models.CharField(max_length=200)
    devise = models.CharField(max_length=200, blank=True)
    nom_en = models.CharField("nom en anglais", max_length=200, blank=True, help_text="Pour les bulletins en anglais.")
    devise_en = models.CharField("devise en anglais", max_length=200, blank=True)
    adresse = models.CharField(max_length=200, blank=True)
    telephone = models.CharField(max_length=50, blank=True)
    ville = models.CharField(max_length=100, blank=True)
    nom_chef = models.CharField("nom du chef d'établissement", max_length=150, blank=True)

    class Meta:
        verbose_name = "établissement"

    def __str__(self):
        return self.nom

    @classmethod
    def courant(cls):
        return cls.objects.first()


class Exercice(models.Model):
    libelle = models.CharField("désignation", max_length=50, unique=True, help_text="Ex. : 2025-2026")
    actif = models.BooleanField(default=False)
    moyenne_passage = models.DecimalField("moyenne de passage", max_digits=4, decimal_places=2, default=10,
                                          validators=[MinValueValidator(0), MaxValueValidator(20)],
                                          help_text="Moyenne annuelle à partir de laquelle le passage est proposé sur le bulletin annuel.")
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-libelle"]
        constraints = [
            models.UniqueConstraint(fields=["actif"], condition=models.Q(actif=True), name="un_seul_exercice_actif"),
        ]

    def __str__(self):
        return self.libelle

    @classmethod
    def actif_courant(cls):
        return cls.objects.filter(actif=True).first()

    @transaction.atomic
    def activer(self):
        Exercice.objects.exclude(pk=self.pk).filter(actif=True).update(actif=False)
        self.actif = True
        self.save(update_fields=["actif"])

    def save(self, *args, **kwargs):
        nouveau = self.pk is None
        super().save(*args, **kwargs)
        if nouveau:
            Sequence.creer_sequences_standard(self)


class Sequence(models.Model):
    """Évaluation séquentielle : 6 par exercice, 2 par trimestre."""

    exercice = models.ForeignKey(Exercice, on_delete=models.CASCADE, related_name="sequences")
    numero = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(6)])
    trimestre = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(3)])
    libelle = models.CharField("désignation", max_length=50)
    verrouillee = models.BooleanField("verrouillée", default=False,
                                      help_text="Une séquence verrouillée n'accepte plus de saisie ni de modification de notes.")

    class Meta:
        ordering = ["exercice", "numero"]
        constraints = [models.UniqueConstraint(fields=["exercice", "numero"], name="sequence_unique_par_exercice")]

    def __str__(self):
        return f"{self.libelle} ({self.exercice})"

    @classmethod
    def creer_sequences_standard(cls, exercice):
        for n in range(1, 7):
            cls.objects.get_or_create(
                exercice=exercice, numero=n,
                defaults={"trimestre": (n + 1) // 2, "libelle": f"Séquence {n}"},
            )


class Cycle(models.Model):
    libelle = models.CharField("désignation", max_length=100, unique=True)

    class Meta:
        ordering = ["libelle"]

    def __str__(self):
        return self.libelle


class Niveau(models.Model):
    libelle = models.CharField("désignation", max_length=100, unique=True)
    cycle = models.ForeignKey(Cycle, on_delete=models.PROTECT, related_name="niveaux")
    ordre = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["ordre", "libelle"]

    def __str__(self):
        return self.libelle


class Classe(models.Model):
    libelle = models.CharField("désignation", max_length=100, unique=True)
    niveau = models.ForeignKey(Niveau, on_delete=models.PROTECT, related_name="classes")
    section_anglophone = models.BooleanField("section anglophone", default=False)
    classe_examen = models.BooleanField("classe d'examen", default=False)
    effectif_max = models.PositiveSmallIntegerField("effectif maximal", null=True, blank=True)
    coef_min_classement = models.PositiveSmallIntegerField(
        "coefficients minimum pour être classé", default=0,
        help_text="Un élève n'est classé que si le total des coefficients des matières où il est évalué "
                  "atteint ce seuil (0 = toujours classé s'il a au moins une note).")

    class Meta:
        ordering = ["niveau__ordre", "libelle"]

    def __str__(self):
        return self.libelle


class Matiere(models.Model):
    code = models.CharField(max_length=20, unique=True)
    libelle = models.CharField("désignation", max_length=100)
    libelle_en = models.CharField("désignation en anglais", max_length=100, blank=True,
                                  help_text="Pour les bulletins en anglais (ex. : Mathematics). Vide = désignation française.")

    class Meta:
        ordering = ["libelle"]
        verbose_name = "matière"

    def __str__(self):
        return self.libelle


class Enseignant(models.Model):
    matricule = models.CharField(max_length=30, unique=True)
    nom = models.CharField(max_length=100)
    prenom = models.CharField("prénom", max_length=100, blank=True)
    sexe = models.CharField(max_length=1, choices=[("M", "Masculin"), ("F", "Féminin")], blank=True)
    telephone = models.CharField("téléphone", max_length=50, blank=True)
    email = models.EmailField(blank=True)
    utilisateur = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name="enseignant", help_text="Compte de connexion de l'enseignant.")

    class Meta:
        ordering = ["nom", "prenom"]

    def __str__(self):
        return f"{self.nom} {self.prenom}".strip()


class Eleve(models.Model):
    matricule = models.CharField(max_length=30, unique=True)
    nom = models.CharField(max_length=100)
    prenom = models.CharField("prénom", max_length=100, blank=True)
    sexe = models.CharField(max_length=1, choices=[("M", "Masculin"), ("F", "Féminin")])
    date_naissance = models.DateField("date de naissance", null=True, blank=True)
    lieu_naissance = models.CharField("lieu de naissance", max_length=100, blank=True)
    nom_pere = models.CharField("nom du père", max_length=150, blank=True)
    nom_mere = models.CharField("nom de la mère", max_length=150, blank=True)
    telephone_parent = models.CharField("téléphone du parent", max_length=50, blank=True)

    class Meta:
        ordering = ["nom", "prenom"]
        verbose_name = "élève"

    def __str__(self):
        return f"{self.nom} {self.prenom}".strip()


class Inscription(models.Model):
    """Appartenance d'un élève à une classe pour un exercice."""

    ANCIEN, NOUVEAU = "A", "N"
    STATUTS = [(ANCIEN, "Ancien élève"), (NOUVEAU, "Nouvel élève")]

    eleve = models.ForeignKey(Eleve, on_delete=models.CASCADE, related_name="inscriptions")
    classe = models.ForeignKey(Classe, on_delete=models.PROTECT, related_name="inscriptions")
    exercice = models.ForeignKey(Exercice, on_delete=models.PROTECT, related_name="inscriptions")
    redoublant = models.BooleanField(default=False)
    statut = models.CharField("statut dans l'établissement", max_length=1, choices=STATUTS, default=NOUVEAU,
                              help_text="Détermine les tarifs d'écolage applicables.")
    date_inscription = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["eleve__nom", "eleve__prenom"]
        constraints = [models.UniqueConstraint(fields=["eleve", "exercice"], name="une_inscription_par_exercice")]

    def __str__(self):
        return f"{self.eleve} — {self.classe} ({self.exercice})"

    def clean(self):
        if self.classe_id and self.classe.effectif_max and self.exercice_id:
            effectif = Inscription.objects.filter(classe=self.classe, exercice=self.exercice).exclude(pk=self.pk).count()
            if effectif >= self.classe.effectif_max:
                raise ValidationError(f"La classe {self.classe} a atteint son effectif maximal ({self.classe.effectif_max}).")


class Attribution(models.Model):
    """Matière enseignée dans une classe pour un exercice : enseignant, coefficient et groupe."""

    GROUPES = [(1, "1er groupe"), (2, "2e groupe"), (3, "3e groupe")]

    exercice = models.ForeignKey(Exercice, on_delete=models.CASCADE, related_name="attributions")
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="attributions")
    matiere = models.ForeignKey(Matiere, on_delete=models.PROTECT, related_name="attributions")
    enseignant = models.ForeignKey(Enseignant, on_delete=models.SET_NULL, null=True, blank=True, related_name="attributions")
    coefficient = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(20)])
    groupe = models.PositiveSmallIntegerField(choices=GROUPES, default=1)

    class Meta:
        ordering = ["groupe", "matiere__libelle"]
        constraints = [models.UniqueConstraint(fields=["exercice", "classe", "matiere"], name="attribution_unique")]

    def __str__(self):
        return f"{self.matiere} — {self.classe} (coef. {self.coefficient})"
