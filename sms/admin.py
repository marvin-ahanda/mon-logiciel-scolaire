from django.contrib import admin

from .models import CreditSMS, MessageSMS


@admin.register(CreditSMS)
class CreditSMSAdmin(admin.ModelAdmin):
    list_display = ["quantite", "note", "ajoute_par", "ajoute_le"]


@admin.register(MessageSMS)
class MessageSMSAdmin(admin.ModelAdmin):
    """Journal en lecture seule."""
    list_display = ["envoye_le", "objet", "eleve", "telephone", "statut", "parties"]
    list_filter = ["objet", "statut"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
