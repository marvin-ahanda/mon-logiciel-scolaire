"""Connexion du personnel : choix de son nom dans la liste, puis saisie de son code d'accès."""

from django.conf import settings
from django.contrib import auth
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters

from .codes import DUREE_BLOCAGE, ESSAIS_MAX, personnels_connectables
from .models import AccesPersonnel


def _suite(request):
    suite = request.POST.get("next") or request.GET.get("next") or ""
    if url_has_allowed_host_and_scheme(suite, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return suite
    return settings.LOGIN_REDIRECT_URL


def _minutes_restantes(acces):
    return max(1, -(-int((acces.bloque_jusqu_a - timezone.now()).total_seconds()) // 60))


@sensitive_post_parameters("code")
@csrf_protect
@never_cache
def connexion(request):
    if request.user.is_authenticated:
        return redirect(_suite(request))
    personnels = personnels_connectables()
    choisi, erreur = request.POST.get("personnel", ""), None
    if request.method == "POST":
        user = next((u for u, _ in personnels if str(u.pk) == choisi), None)
        code = (request.POST.get("code") or "").strip()
        if user is None:
            erreur = "Choisissez votre nom dans la liste."
        elif not code:
            erreur = "Saisissez votre code d'accès."
        else:
            acces, _ = AccesPersonnel.objects.get_or_create(utilisateur=user)
            if acces.bloque:
                erreur = (f"Trop de codes erronés : accès bloqué pendant encore {_minutes_restantes(acces)} min. "
                          "L'administration peut vous remettre un nouveau code.")
            else:
                ok = auth.authenticate(request, username=user.username, password=code)
                if ok is None and code != code.lower():          # codes générés en minuscules : « 6E0K39 » accepté
                    ok = auth.authenticate(request, username=user.username, password=code.lower())
                if ok is not None:
                    acces.echecs, acces.bloque_jusqu_a = 0, None
                    acces.save(update_fields=["echecs", "bloque_jusqu_a"])
                    auth.login(request, ok)
                    return redirect(_suite(request))
                acces.echecs += 1
                if acces.echecs >= ESSAIS_MAX:
                    acces.echecs, acces.bloque_jusqu_a = 0, timezone.now() + DUREE_BLOCAGE
                    erreur = (f"Code incorrect. Après {ESSAIS_MAX} essais erronés, l'accès est bloqué "
                              f"pendant {int(DUREE_BLOCAGE.total_seconds() // 60)} min.")
                else:
                    reste = ESSAIS_MAX - acces.echecs
                    erreur = f"Code incorrect. Encore {reste} essai{'s' if reste > 1 else ''} avant blocage temporaire."
                acces.save(update_fields=["echecs", "bloque_jusqu_a"])
    return render(request, "connexion.html", {"personnels": personnels, "choisi": choisi, "erreur": erreur,
                                              "next": request.POST.get("next") or request.GET.get("next", "")})
