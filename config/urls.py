from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from comptes.connexion import connexion, deconnexion

urlpatterns = [
    *([path("", include("plateforme.urls"))] if settings.MULTI_ETABLISSEMENTS else []),
    path("connexion/", connexion, name="login"),
    path("deconnexion/", deconnexion, name="logout"),
    # une seule porte d'entrée (avec blocage après 5 codes erronés), y compris pour l'administration avancée
    path("admin/login/", RedirectView.as_view(pattern_name="login", query_string=True)),
    path("admin/", admin.site.urls),
    path("notes/", include("notes.urls")),
    path("discipline/", include("discipline.urls")),
    path("finances/", include("finances.urls")),
    path("comptes/", include("comptes.urls")),
    path("excel/", include("echanges.urls")),
    path("emploi-du-temps/", include("emploi.urls")),
    path("sms/", include("sms.urls")),
    path("statistiques/", include("statistiques.urls")),
    path("", include("scolarite.urls")),
]
