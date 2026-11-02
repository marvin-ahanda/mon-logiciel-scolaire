from django.contrib import admin

from .models import LibelleCaisse, MouvementCaisse, Paiement, Reduction, Remboursement, Rubrique, Tarif


@admin.register(Rubrique)
class RubriqueAdmin(admin.ModelAdmin):
    list_display = ["libelle", "ordre", "echeance"]
    list_editable = ["ordre"]


@admin.register(Tarif)
class TarifAdmin(admin.ModelAdmin):
    list_display = ["exercice", "niveau", "statut", "rubrique", "montant"]
    list_filter = ["exercice", "niveau", "statut"]


@admin.register(Paiement)
class PaiementAdmin(admin.ModelAdmin):
    """Consultation seulement : les paiements se saisissent et s'annulent depuis la caisse (traçabilité)."""
    list_display = ["numero_recu", "exercice", "inscription", "rubrique", "montant", "mode", "date", "annule"]
    list_filter = ["exercice", "mode", "annule", "rubrique"]
    search_fields = ["inscription__eleve__nom", "inscription__eleve__matricule", "reference"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Reduction)
class ReductionAdmin(admin.ModelAdmin):
    list_display = ["inscription", "rubrique", "montant", "motif", "date"]
    list_filter = ["rubrique"]


@admin.register(Remboursement)
class RemboursementAdmin(admin.ModelAdmin):
    list_display = ["inscription", "montant", "motif", "date"]


@admin.register(LibelleCaisse)
class LibelleCaisseAdmin(admin.ModelAdmin):
    list_display = ["libelle", "sens", "actif"]
    list_filter = ["sens", "actif"]
    list_editable = ["actif"]


@admin.register(MouvementCaisse)
class MouvementCaisseAdmin(admin.ModelAdmin):
    """Consultation seulement : saisie et annulation depuis la caisse générale (traçabilité)."""
    list_display = ["numero", "sens", "exercice", "date", "libelle", "tiers", "montant", "mode", "annule"]
    list_filter = ["exercice", "sens", "annule", "libelle"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
