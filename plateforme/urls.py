from django.urls import path

from . import views

urlpatterns = [
    path("etablissement/", views.choix_etablissement, name="choix_etablissement"),
    path("etablissement/changer/", views.changer_etablissement, name="changer_etablissement"),
    path("parametres/code-etablissement/", views.code_etablissement, name="code_etablissement"),
    path("plateforme/", views.console, name="console"),
    path("plateforme/connexion/", views.console_connexion, name="console_connexion"),
    path("plateforme/deconnexion/", views.console_deconnexion, name="console_deconnexion"),
    path("plateforme/etablissements/nouveau/", views.console_creer, name="console_creer"),
    path("plateforme/etablissements/<int:pk>/nouveau-code/", views.console_nouveau_code, name="console_nouveau_code"),
    path("plateforme/etablissements/<int:pk>/activer/", views.console_activer, name="console_activer"),
    path("plateforme/mise-a-jour/", views.console_migrer, name="console_migrer"),
    path("plateforme/installer/", views.installer, name="installer"),
]
