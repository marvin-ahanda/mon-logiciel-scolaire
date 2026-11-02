from django.contrib import admin

from .models import BaremeDistinction, Note


@admin.register(BaremeDistinction)
class BaremeAdmin(admin.ModelAdmin):
    list_display = ["type", "exercice", "borne_inf", "borne_sup"]
    list_filter = ["exercice"]


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ["inscription", "attribution", "sequence", "valeur", "saisie_par", "modifie_le"]
    list_filter = ["sequence__exercice", "sequence", "attribution__classe"]
    search_fields = ["inscription__eleve__nom"]
