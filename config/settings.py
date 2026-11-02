"""Configuration Django d'OtourixSchool.

Les reglages sensibles se font par variables d'environnement :
- OTOURIX_SECRET_KEY : cle secrete (obligatoire en production)
- OTOURIX_DEBUG : "1" pour le mode developpement
- OTOURIX_ALLOWED_HOSTS : noms d'hote separes par des virgules
- DATABASE_URL : postgres://utilisateur:motdepasse@hote:5432/base (SQLite par defaut)
"""

import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("OTOURIX_DEBUG", "1") == "1"

SECRET_KEY = os.environ.get("OTOURIX_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("OTOURIX_SECRET_KEY doit etre defini en production.")
    SECRET_KEY = "dev-uniquement-ne-pas-utiliser-en-production"

ALLOWED_HOSTS = [h.strip() for h in os.environ.get("OTOURIX_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "comptes",
    "scolarite",
    "notes",
    "discipline",
    "finances",
    "echanges",
    "emploi",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "scolarite.context_processors.contexte_ecole",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


def _database_from_url(url):
    p = urlparse(url)
    if p.scheme in ("postgres", "postgresql"):
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": p.path.lstrip("/"),
            "USER": p.username or "",
            "PASSWORD": p.password or "",
            "HOST": p.hostname or "",
            "PORT": str(p.port or ""),
        }
    raise RuntimeError(f"DATABASE_URL non pris en charge : {p.scheme}")


DATABASES = {
    "default": _database_from_url(os.environ["DATABASE_URL"])
    if os.environ.get("DATABASE_URL")
    else {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr"
TIME_ZONE = "Africa/Douala"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

# Fichiers envoyés (photos des élèves). Ne JAMAIS publier ce dossier tel quel sur le serveur web :
# les photos sont servies par une vue protégée (scolarite.views.photo_eleve).
MEDIA_ROOT = Path(os.environ.get("OTOURIX_MEDIA_ROOT", BASE_DIR / "media"))
MEDIA_URL = "/fichiers-proteges/"   # non servi directement
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "accueil"
LOGOUT_REDIRECT_URL = "login"

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# HTTPS : actif par défaut en production. Pour un serveur accessible uniquement sur le réseau local
# de l'établissement, sans certificat, définir OTOURIX_HTTPS=0 (les cookies ne seront alors pas chiffrés en transit).
HTTPS = (not DEBUG) and os.environ.get("OTOURIX_HTTPS", "1") == "1"
if HTTPS:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = os.environ.get("OTOURIX_SSL_REDIRECT", "1") == "1"
    SECURE_HSTS_SECONDS = int(os.environ.get("OTOURIX_HSTS_SECONDS", "3600"))
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
