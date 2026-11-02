from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

urlpatterns = [
    path("connexion/", auth_views.LoginView.as_view(template_name="connexion.html", redirect_authenticated_user=True), name="login"),
    path("deconnexion/", auth_views.LogoutView.as_view(), name="logout"),
    path("mot-de-passe/", auth_views.PasswordChangeView.as_view(template_name="scolarite/formulaire.html",
         success_url="/", extra_context={"titre": "Changer mon mot de passe", "url_retour": "/"}), name="password_change"),
    path("admin/", admin.site.urls),
    path("notes/", include("notes.urls")),
    path("discipline/", include("discipline.urls")),
    path("finances/", include("finances.urls")),
    path("", include("scolarite.urls")),
]
