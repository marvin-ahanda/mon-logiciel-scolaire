from django.urls import path

from . import views

urlpatterns = [
    path("saisie/", views.saisie, name="saisie"),
    path("resultats/", views.resultats, name="resultats"),
    path("bulletins/", views.bulletins, name="bulletins"),
]
