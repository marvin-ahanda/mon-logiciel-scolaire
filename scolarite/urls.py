from django.urls import path

from . import views

urlpatterns = [
    path("", views.accueil, name="accueil"),
    path("exercices/", views.ExerciceListe.as_view(), name="exercices"),
    path("exercices/nouveau/", views.ExerciceCreer.as_view(), name="exercice_creer"),
    path("exercices/<int:pk>/", views.ExerciceModifier.as_view(), name="exercice_modifier"),
    path("exercices/<int:pk>/activer/", views.exercice_activer, name="exercice_activer"),
    path("sequences/", views.sequences, name="sequences"),
    path("sequences/<int:pk>/verrou/", views.sequence_verrou, name="sequence_verrou"),
    path("classes/", views.ClasseListe.as_view(), name="classes"),
    path("classes/nouvelle/", views.ClasseCreer.as_view(), name="classe_creer"),
    path("classes/<int:pk>/", views.ClasseModifier.as_view(), name="classe_modifier"),
    path("classes/<int:classe_id>/matieres/", views.attributions, name="attributions"),
    path("attributions/<int:pk>/", views.attribution_modifier, name="attribution_modifier"),
    path("matieres/", views.MatiereListe.as_view(), name="matieres"),
    path("matieres/nouvelle/", views.MatiereCreer.as_view(), name="matiere_creer"),
    path("matieres/<int:pk>/", views.MatiereModifier.as_view(), name="matiere_modifier"),
    path("enseignants/", views.EnseignantListe.as_view(), name="enseignants"),
    path("enseignants/nouveau/", views.EnseignantCreer.as_view(), name="enseignant_creer"),
    path("enseignants/<int:pk>/", views.EnseignantModifier.as_view(), name="enseignant_modifier"),
    path("eleves/", views.EleveListe.as_view(), name="eleves"),
    path("eleves/nouveau/", views.EleveCreer.as_view(), name="eleve_creer"),
    path("eleves/<int:pk>/", views.EleveModifier.as_view(), name="eleve_modifier"),
]
