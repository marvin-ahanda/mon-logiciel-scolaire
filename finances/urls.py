from django.urls import path

from . import views

urlpatterns = [
    path("", views.caisse, name="caisse"),
    path("eleve/<int:pk>/", views.compte_eleve, name="compte_eleve"),
    path("paiement/<int:pk>/recu/", views.recu, name="recu"),
    path("paiement/<int:pk>/annuler/", views.annuler_paiement, name="annuler_paiement"),
    path("tarifs/", views.tarifs, name="tarifs"),
    path("situation/", views.situation, name="situation_financiere"),
    path("journal/", views.journal, name="journal_encaissements"),
]
