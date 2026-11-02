from django.urls import path

from . import views

urlpatterns = [
    path("", views.accueil, name="echanges"),
    path("export/eleves/", views.export_eleves, name="export_eleves"),
    path("export/resultats/", views.export_resultats, name="export_resultats"),
    path("export/situation/", views.export_situation, name="export_situation"),
    path("export/journal/", views.export_journal, name="export_journal"),
    path("import/eleves/", views.import_eleves, name="import_eleves"),
    path("import/eleves/modele/", views.modele_eleves, name="modele_eleves"),
    path("import/notes/", views.import_notes, name="import_notes"),
    path("import/notes/modele/", views.modele_notes, name="modele_notes"),
]
