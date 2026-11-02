"""Place chaque requête dans le schéma de l'établissement choisi (gardé dans la session)."""

from urllib.parse import urlencode

from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
from django.contrib.auth.models import AnonymousUser
from django.db import connection
from django.shortcuts import redirect

from .models import EspaceEtablissement

CLE_ETABLISSEMENT = "nexia_etablissement"     # schéma de l'établissement choisi
CLE_ETAB_AUTH = "nexia_etab_auth"             # schéma dans lequel le membre du personnel s'est connecté

# Pages accessibles sans établissement choisi (elles s'exécutent dans le schéma commun, sans utilisateur)
CHEMINS_COMMUNS = ("/etablissement/", "/plateforme/", "/static/")


def oublier_connexion(session):
    for cle in (SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY, CLE_ETAB_AUTH):
        session.pop(cle, None)


class EtablissementMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        connection.set_schema_to_public()
        request.espace = None
        try:
            if request.path.startswith(CHEMINS_COMMUNS):
                request.user = AnonymousUser()
                return self.get_response(request)
            schema = request.session.get(CLE_ETABLISSEMENT)
            espace = EspaceEtablissement.objects.filter(schema_name=schema, actif=True).first() if schema else None
            if espace is None:
                if schema:                                   # établissement désactivé ou supprimé
                    request.session.pop(CLE_ETABLISSEMENT, None)
                    oublier_connexion(request.session)
                request.user = AnonymousUser()
                suite = request.get_full_path()
                return redirect("/etablissement/" + (f"?{urlencode({'next': suite})}" if suite not in ("/", "/connexion/") else ""))
            connection.set_tenant(espace)
            request.espace = espace
            if request.session.get(SESSION_KEY) and request.session.get(CLE_ETAB_AUTH) != espace.schema_name:
                # une connexion ouverte dans un autre établissement ne vaut jamais ici
                oublier_connexion(request.session)
                request.user = AnonymousUser()
            return self.get_response(request)
        finally:
            connection.set_schema_to_public()
