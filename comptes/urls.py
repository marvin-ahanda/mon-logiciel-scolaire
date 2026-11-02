from django.urls import path

from . import views

urlpatterns = [
    path("", views.utilisateurs, name="utilisateurs"),
    path("nouveau/", views.utilisateur_formulaire, name="utilisateur_creer"),
    path("<int:pk>/", views.utilisateur_formulaire, name="utilisateur_modifier"),
    path("<int:pk>/code/", views.code_acces, name="code_acces"),
    path("<int:pk>/nouveau-code/", views.regenerer_code, name="regenerer_code"),
]
