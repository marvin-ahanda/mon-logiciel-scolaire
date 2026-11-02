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
    path("caisse-generale/", views.caisse_generale, name="caisse_generale"),
    path("caisse-generale/<int:pk>/", views.mouvement_caisse, name="mouvement_caisse"),
    path("caisse-generale/<int:pk>/annuler/", views.annuler_mouvement, name="annuler_mouvement"),
    path("journal-de-caisse/", views.journal_de_caisse, name="journal_caisse"),
    path("plans-de-financement/", views.plans_financement, name="plans_financement"),
    path("dettes-anterieures/", views.debiteurs_anterieurs, name="debiteurs_anterieurs"),
]
