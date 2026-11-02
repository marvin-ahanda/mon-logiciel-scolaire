from django.urls import path

from . import views

urlpatterns = [
    path("", views.envoi, name="sms_envoi"),
    path("journal/", views.journal, name="sms_journal"),
]
