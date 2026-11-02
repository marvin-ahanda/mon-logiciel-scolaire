from django.contrib import admin

from .models import Attribution, Classe, Cycle, Eleve, Enseignant, Etablissement, Exercice, Inscription, Matiere, Niveau, Sequence

admin.site.site_header = "NexIASchool — administration"
admin.site.site_title = "NexIASchool"


@admin.register(Etablissement)
class EtablissementAdmin(admin.ModelAdmin):
    list_display = ["nom", "ville", "telephone"]


@admin.register(Exercice)
class ExerciceAdmin(admin.ModelAdmin):
    list_display = ["libelle", "actif"]


@admin.register(Sequence)
class SequenceAdmin(admin.ModelAdmin):
    list_display = ["libelle", "exercice", "numero", "trimestre", "verrouillee"]
    list_filter = ["exercice", "trimestre", "verrouillee"]


@admin.register(Cycle)
class CycleAdmin(admin.ModelAdmin):
    list_display = ["libelle"]


@admin.register(Niveau)
class NiveauAdmin(admin.ModelAdmin):
    list_display = ["libelle", "cycle", "ordre"]
    list_editable = ["ordre"]


@admin.register(Classe)
class ClasseAdmin(admin.ModelAdmin):
    list_display = ["libelle", "niveau", "section_anglophone", "classe_examen", "effectif_max"]
    list_filter = ["niveau", "section_anglophone"]


@admin.register(Matiere)
class MatiereAdmin(admin.ModelAdmin):
    list_display = ["code", "libelle", "libelle_en"]
    search_fields = ["code", "libelle", "libelle_en"]


@admin.register(Enseignant)
class EnseignantAdmin(admin.ModelAdmin):
    list_display = ["matricule", "nom", "prenom", "utilisateur"]
    search_fields = ["matricule", "nom", "prenom"]


@admin.register(Eleve)
class EleveAdmin(admin.ModelAdmin):
    list_display = ["matricule", "nom", "prenom", "sexe", "date_naissance"]
    search_fields = ["matricule", "nom", "prenom"]


@admin.register(Inscription)
class InscriptionAdmin(admin.ModelAdmin):
    list_display = ["eleve", "classe", "exercice", "redoublant"]
    list_filter = ["exercice", "classe"]
    search_fields = ["eleve__nom", "eleve__matricule"]


@admin.register(Attribution)
class AttributionAdmin(admin.ModelAdmin):
    list_display = ["classe", "matiere", "enseignant", "coefficient", "groupe", "exercice"]
    list_filter = ["exercice", "classe", "groupe"]
