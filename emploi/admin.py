from django.contrib import admin

from .models import Cours, Creneau


@admin.register(Creneau)
class CreneauAdmin(admin.ModelAdmin):
    list_display = ["ordre", "heure_debut", "heure_fin", "pause"]
    list_editable = ["heure_debut", "heure_fin", "pause"]


@admin.register(Cours)
class CoursAdmin(admin.ModelAdmin):
    list_display = ["classe", "jour", "creneau", "attribution", "salle", "exercice"]
    list_filter = ["exercice", "classe", "jour"]
