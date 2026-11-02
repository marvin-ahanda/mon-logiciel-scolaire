from django.urls import path

from . import views

urlpatterns = [
    path("appel/", views.appel, name="appel"),
    path("infractions/", views.incidents, name="incidents"),
    path("infractions/<int:pk>/supprimer/", views.incident_supprimer, name="incident_supprimer"),
    path("suivi/", views.suivi, name="suivi_discipline"),
]
