import hmac
from urllib.parse import urlencode

from django.conf import settings
from django.contrib import auth, messages
from django.contrib.auth.hashers import check_password
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_POST

from comptes.roles import est_administration, role_requis

from .middleware import CLE_ETABLISSEMENT, oublier_connexion
from .models import EspaceEtablissement
from .securite import Limiteur
from .services import creer_espace, mettre_a_jour_les_schemas, nom_disponible, nouveau_code, trouver_espace

LIMITE_ETABLISSEMENT = Limiteur("etablissement", essais=10, duree_minutes=15)
LIMITE_CONSOLE = Limiteur("console", essais=5, duree_minutes=30)
CLE_PROPRIETAIRE = "nexia_proprietaire"
CLE_CODES = "nexia_codes_a_afficher"


# --- Étape 1 : entrer dans l'espace de son établissement ----------------------------------------------

@sensitive_post_parameters("code")
@never_cache
def choix_etablissement(request):
    suite = request.POST.get("next") or request.GET.get("next") or ""
    if not url_has_allowed_host_and_scheme(suite, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        suite = ""
    erreur, nom = None, (request.POST.get("nom") or "").strip()
    if request.method == "POST":
        minutes = LIMITE_ETABLISSEMENT.minutes_de_blocage(request)
        if minutes:
            erreur = f"Trop d'essais erronés depuis cet appareil. Réessayez dans {minutes} min."
        else:
            espace = trouver_espace(nom, request.POST.get("code"))
            if espace is None:
                LIMITE_ETABLISSEMENT.echec(request)
                erreur = "Nom ou code de l'établissement incorrect."
            else:
                LIMITE_ETABLISSEMENT.reussite(request)
                if request.session.get(CLE_ETABLISSEMENT) != espace.schema_name:
                    oublier_connexion(request.session)
                request.session.cycle_key()
                request.session[CLE_ETABLISSEMENT] = espace.schema_name
                return redirect("/connexion/" + (f"?{urlencode({'next': suite})}" if suite else ""))
    actuel = EspaceEtablissement.objects.filter(schema_name=request.session.get(CLE_ETABLISSEMENT), actif=True).first()
    return render(request, "plateforme/etablissement.html", {"erreur": erreur, "nom": nom, "next": suite, "actuel": actuel})


@require_POST
def changer_etablissement(request):
    oublier_connexion(request.session)
    request.session.pop(CLE_ETABLISSEMENT, None)
    request.session.cycle_key()
    return redirect("choix_etablissement")


# --- Code de l'établissement, géré par l'administration de l'établissement ------------------------------

@never_cache
@role_requis(est_administration)
def code_etablissement(request):
    espace = request.espace
    code = None
    if request.method == "POST":
        code = nouveau_code(espace)
    return render(request, "plateforme/code_etablissement.html", {"espace": espace, "code": code})


# --- Console du propriétaire du SaaS -------------------------------------------------------------------

def _console_active():
    if not (settings.NEXIA_PROPRIETAIRE and settings.NEXIA_PROPRIETAIRE_MDP):
        raise Http404()


def _proprietaire_requis(vue):
    def enveloppe(request, *args, **kwargs):
        _console_active()
        if not request.session.get(CLE_PROPRIETAIRE):
            return redirect("console_connexion")
        return vue(request, *args, **kwargs)
    return enveloppe


@sensitive_post_parameters("mot_de_passe")
@sensitive_variables("mdp")
@never_cache
def console_connexion(request):
    _console_active()
    erreur = None
    if request.method == "POST":
        minutes = LIMITE_CONSOLE.minutes_de_blocage(request)
        ident, mdp = request.POST.get("identifiant", ""), request.POST.get("mot_de_passe", "")
        ok_ident = hmac.compare_digest(ident.encode(), settings.NEXIA_PROPRIETAIRE.encode())
        ok_mdp = check_password(mdp, settings.NEXIA_PROPRIETAIRE_MDP)
        if minutes:
            erreur = f"Trop d'essais erronés. Réessayez dans {minutes} min."
        elif ok_ident and ok_mdp:
            LIMITE_CONSOLE.reussite(request)
            request.session.cycle_key()
            request.session[CLE_PROPRIETAIRE] = True
            return redirect("console")
        else:
            LIMITE_CONSOLE.echec(request)
            erreur = "Identifiant ou mot de passe incorrect."
    return render(request, "plateforme/console_connexion.html", {"erreur": erreur})


@require_POST
def console_deconnexion(request):
    request.session.pop(CLE_PROPRIETAIRE, None)
    request.session.cycle_key()
    return redirect("console_connexion")


@never_cache
@_proprietaire_requis
def console(request):
    codes = request.session.pop(CLE_CODES, None)
    return render(request, "plateforme/console.html", {"espaces": EspaceEtablissement.objects.all(), "codes": codes})


@require_POST
@_proprietaire_requis
def console_creer(request):
    nom, ville = (request.POST.get("nom") or "").strip(), (request.POST.get("ville") or "").strip()
    admin_nom, admin_prenom = (request.POST.get("admin_nom") or "").strip(), (request.POST.get("admin_prenom") or "").strip()
    demo = request.POST.get("demonstration") == "1"
    if len(nom) < 3:
        messages.error(request, "Indiquez le nom complet de l'établissement.")
    elif not nom_disponible(nom):
        messages.error(request, f"Un établissement nommé « {nom} » existe déjà (les accents et la casse sont ignorés).")
    elif not demo and not admin_nom:
        messages.error(request, "Indiquez au moins le nom du premier administrateur de l'établissement.")
    else:
        espace, code, acces = creer_espace(nom, ville, admin_nom, admin_prenom, demonstration=demo)
        request.session[CLE_CODES] = {"espace": espace.nom, "code": code, "acces": acces}
    return redirect("console")


@require_POST
@_proprietaire_requis
def console_nouveau_code(request, pk):
    espace = get_object_or_404(EspaceEtablissement, pk=pk)
    request.session[CLE_CODES] = {"espace": espace.nom, "code": nouveau_code(espace), "acces": []}
    return redirect("console")


@require_POST
@_proprietaire_requis
def console_activer(request, pk):
    espace = get_object_or_404(EspaceEtablissement, pk=pk)
    espace.actif = not espace.actif
    espace.save(update_fields=["actif"])
    messages.success(request, f"{espace.nom} : {'réactivé' if espace.actif else 'désactivé (plus aucun accès)'}.")
    return redirect("console")


@require_POST
@_proprietaire_requis
def console_migrer(request):
    journal = mettre_a_jour_les_schemas()
    messages.success(request, "Base de données mise à jour pour tous les établissements.")
    return render(request, "plateforme/console_journal.html", {"journal": journal})


@sensitive_variables("jeton")
@never_cache
def installer(request):
    """Premier déploiement : crée les tables communes. Protégé par un jeton (variable NEXIA_JETON_INSTALLATION),
    à supprimer de la configuration une fois l'installation faite."""
    jeton = settings.NEXIA_JETON_INSTALLATION
    if len(jeton) < 32 or not hmac.compare_digest(request.GET.get("jeton", "").encode(), jeton.encode()):
        raise Http404()
    return HttpResponse(mettre_a_jour_les_schemas(communs_seulement=True) or "Installation terminée.",
                        content_type="text/plain; charset=utf-8")
