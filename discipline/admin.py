from django.contrib import admin

from .models import Absence, Incident, Infraction, ParametresDiscipline, Retard, Sanction


@admin.register(Sanction)
class SanctionAdmin(admin.ModelAdmin):
    list_display = ["libelle", "points_perdus"]
    list_editable = ["points_perdus"]


@admin.register(Infraction)
class InfractionAdmin(admin.ModelAdmin):
    list_display = ["libelle", "sanction"]
    list_filter = ["sanction"]
    search_fields = ["libelle"]


@admin.register(ParametresDiscipline)
class ParametresDisciplineAdmin(admin.ModelAdmin):
    list_display = ["exercice", "note_max", "points_par_retard", "points_par_heure_absence"]


@admin.register(Absence)
class AbsenceAdmin(admin.ModelAdmin):
    list_display = ["inscription", "date", "sequence", "heures_non_justifiees", "heures_justifiees", "motif"]
    list_filter = ["sequence__exercice", "sequence", "inscription__classe"]
    date_hierarchy = "date"


@admin.register(Retard)
class RetardAdmin(admin.ModelAdmin):
    list_display = ["inscription", "date", "sequence"]
    list_filter = ["sequence__exercice", "sequence", "inscription__classe"]
    date_hierarchy = "date"


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ["inscription", "date", "infraction", "sequence"]
    list_filter = ["sequence__exercice", "sequence", "infraction"]
    date_hierarchy = "date"
