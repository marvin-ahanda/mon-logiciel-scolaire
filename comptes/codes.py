"""Codes de connexion du personnel : 6 caractères alphanumériques générés automatiquement.

Le code sert de mot de passe : il n'est enregistré que haché (comme tout mot de passe Django) et n'est montré
qu'une seule fois, à sa génération. Les lettres i, l et o, faciles à confondre avec 1 et 0, sont exclues.
"""

import secrets
import string
import unicodedata
from datetime import timedelta

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

LONGUEUR = 6
LETTRES = "".join(c for c in string.ascii_lowercase if c not in "ilo")
CHIFFRES = string.digits
ESSAIS_MAX = 5
DUREE_BLOCAGE = timedelta(minutes=15)


def generer_code():
    """Code aléatoire de 6 caractères contenant au moins une lettre et au moins un chiffre (ex. « 6e0k39 »)."""
    while True:
        code = "".join(secrets.choice(LETTRES + CHIFFRES) for _ in range(LONGUEUR))
        if any(c in LETTRES for c in code) and any(c in CHIFFRES for c in code):
            return code


def attribuer_code(user):
    """Génère un nouveau code, l'enregistre (haché) et débloque le compte. Renvoie le code en clair."""
    from .models import AccesPersonnel
    code = generer_code()
    user.set_password(code)
    user.save(update_fields=["password"])
    acces, _ = AccesPersonnel.objects.get_or_create(utilisateur=user)
    acces.code_genere_le, acces.echecs, acces.bloque_jusqu_a = timezone.now(), 0, None
    acces.save()
    return code


def identifiant_libre(prenom, nom):
    """Identifiant interne unique déduit du nom (« aline.abena », « aline.abena2 »…)."""
    base = slugify(f"{prenom} {nom}").replace("-", ".")[:140] or "personnel"
    ident, n = base, 1
    while User.objects.filter(username=ident).exists():
        n += 1
        ident = f"{base}{n}"
    return ident


def _cle_tri(texte):
    return unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode().lower()


def nom_affiche(user):
    ens = getattr(user, "enseignant", None)
    nom, prenom = (ens.nom, ens.prenom) if ens else (user.last_name, user.first_name)
    return " ".join(p for p in (nom.strip().upper(), prenom.strip()) if p) or user.username


def personnels_connectables():
    """Comptes actifs du personnel (rôle ou fiche enseignant), triés de A à Z : [(user, libellé)]."""
    from .roles import ADMINISTRATION, CAISSE, SURVEILLANCE
    qs = (User.objects.filter(is_active=True)
          .filter(Q(is_superuser=True) | Q(groups__name__in=[ADMINISTRATION, CAISSE, SURVEILLANCE]) | Q(enseignant__isnull=False))
          .select_related("enseignant").distinct())
    lignes = sorted(((u, nom_affiche(u)) for u in qs), key=lambda x: (_cle_tri(x[1]), x[0].pk))
    vus = {}
    for _, lib in lignes:
        vus[lib] = vus.get(lib, 0) + 1
    return [(u, f"{lib} ({u.username})" if vus[lib] > 1 else lib) for u, lib in lignes]   # homonymes distingués
