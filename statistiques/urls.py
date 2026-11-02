from django.urls import path

from . import views

urlpatterns = [
    path("", views.classe, name="stats_classe"),
    path("comparaison/", views.comparaison, name="stats_comparaison"),
    path("effectifs/", views.effectifs, name="stats_effectifs"),
]
