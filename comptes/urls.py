from django.urls import path

from . import views

urlpatterns = [
    path("", views.utilisateurs, name="utilisateurs"),
    path("nouveau/", views.utilisateur_formulaire, name="utilisateur_creer"),
    path("<int:pk>/", views.utilisateur_formulaire, name="utilisateur_modifier"),
]
