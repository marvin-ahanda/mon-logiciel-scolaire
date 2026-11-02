from django.urls import path

from . import views

urlpatterns = [
    path("classe/", views.emploi_classe, name="emploi_classe"),
    path("enseignant/", views.emploi_enseignant, name="emploi_enseignant"),
]
