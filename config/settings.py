"""Configuration Django de NexIASchool.

Les reglages sensibles se font par variables d'environnement :
- NEXIA_SECRET_KEY : cle secrete (obligatoire en production)
- NEXIA_DEBUG : "1" pour le mode developpement
- NEXIA_ALLOWED_HOSTS : noms d'hote separes par des virgules
- DATABASE_URL : postgres://utilisateur:motdepasse@hote:5432/base?sslmode=require (SQLite par defaut)
- NEXIA_MULTI : "1" pour le mode SaaS multi-etablissements (PostgreSQL obligatoire) : chaque etablissement
  a son propre schema PostgreSQL ; on y entre par le nom et le code de l'etablissement.
- NEXIA_CSRF_TRUSTED_ORIGINS : origines HTTPS de confiance separees par des virgules (ex. https://nexiaschool.vercel.app)
"""

import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("NEXIA_DEBUG", "1") == "1"

SECRET_KEY = os.environ.get("NEXIA_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("NEXIA_SECRET_KEY doit etre defini en production.")
    SECRET_KEY = "dev-uniquement-ne-pas-utiliser-en-production"

ALLOWED_HOSTS = [h.strip() for h in os.environ.get("NEXIA_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [h.strip() for h in os.environ.get("NEXIA_CSRF_TRUSTED_ORIGINS", "").split(",") if h.strip()]

MULTI_ETABLISSEMENTS = os.environ.get("NEXIA_MULTI") == "1"

# Applications propres à chaque établissement (en mode SaaS : une copie par schéma PostgreSQL)
APPS_ETABLISSEMENT = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.admin",
    "django.contrib.messages",
    "django.contrib.humanize",
    "comptes",
    "scolarite",
    "notes",
    "discipline",
    "finances",
    "echanges",
    "emploi",
    "sms",
    "statistiques",
]

if MULTI_ETABLISSEMENTS:
    # Applications communes, dans le schéma « public » : la liste des établissements et les sessions
    SHARED_APPS = ["django_tenants", "plateforme", "django.contrib.contenttypes", "django.contrib.sessions",
                   "django.contrib.messages", "django.contrib.staticfiles", "django.contrib.humanize"]
    TENANT_APPS = APPS_ETABLISSEMENT
    INSTALLED_APPS = SHARED_APPS + [a for a in TENANT_APPS if a not in SHARED_APPS]
    TENANT_MODEL = "plateforme.EspaceEtablissement"
    TENANT_DOMAIN_MODEL = "plateforme.Domaine"
    DATABASE_ROUTERS = ["django_tenants.routers.TenantSyncRouter"]
else:
    INSTALLED_APPS = APPS_ETABLISSEMENT + ["django.contrib.sessions", "django.contrib.staticfiles"]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    *(["plateforme.middleware.EtablissementMiddleware"] if MULTI_ETABLISSEMENTS else []),
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
        options = {k: v[-1] for k, v in parse_qs(p.query).items() if k in ("sslmode", "connect_timeout")}
        return {
            "ENGINE": "django_tenants.postgresql_backend" if MULTI_ETABLISSEMENTS else "django.db.backends.postgresql",
            "NAME": p.path.lstrip("/"),
            "USER": unquote(p.username or ""),
            "PASSWORD": unquote(p.password or ""),
            "HOST": p.hostname or "",
            "PORT": str(p.port or ""),
            "OPTIONS": options,
            "CONN_MAX_AGE": 0,      # hébergement sans serveur : pas de connexion conservée entre deux requêtes
        }
    raise RuntimeError(f"DATABASE_URL non pris en charge : {p.scheme}")


DATABASES = {
    "default": _database_from_url(os.environ["DATABASE_URL"])
    if os.environ.get("DATABASE_URL")
    else {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
}
if MULTI_ETABLISSEMENTS and "postgresql" not in DATABASES["default"]["ENGINE"]:
    raise RuntimeError("Le mode multi-établissements (NEXIA_MULTI=1) exige une base PostgreSQL (DATABASE_URL).")

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
WHITENOISE_USE_FINDERS = True        # fichiers statiques servis par l'application, sans « collectstatic »

# Fichiers envoyés (photos des élèves). Ne JAMAIS publier ce dossier tel quel sur le serveur web :
# les photos sont servies par une vue protégée (scolarite.views.photo_eleve).
MEDIA_ROOT = Path(os.environ.get("NEXIA_MEDIA_ROOT", BASE_DIR / "media"))
MEDIA_URL = "/fichiers-proteges/"   # non servi directement
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
if MULTI_ETABLISSEMENTS:
    # Pas de disque persistant sur un hébergement sans serveur : les photos sont rangées dans la base,
    # dans le schéma de l'établissement (donc isolées comme le reste de ses données).
    STORAGES = {"default": {"BACKEND": "scolarite.stockage.StockageEnBase"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}

# Hébergement derrière un proxy de confiance (Vercel) : adresse IP réelle lue dans ses en-têtes
NEXIA_DERRIERE_PROXY = os.environ.get("NEXIA_DERRIERE_PROXY") == "1"

# Erreurs écrites dans la sortie standard (journaux de l'hébergeur)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"django": {"handlers": ["console"], "level": "WARNING"}},
}

# Jeton à usage unique pour créer les tables communes au premier déploiement (voir plateforme.views.installer)
NEXIA_JETON_INSTALLATION = os.environ.get("NEXIA_JETON_INSTALLATION", "")
# Console du propriétaire du SaaS : identifiant et empreinte du mot de passe (make_password)
NEXIA_PROPRIETAIRE = os.environ.get("NEXIA_PROPRIETAIRE", "")
NEXIA_PROPRIETAIRE_MDP = os.environ.get("NEXIA_PROPRIETAIRE_MDP", "")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "accueil"
LOGOUT_REDIRECT_URL = "login"

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# HTTPS : actif par défaut en production. Pour un serveur accessible uniquement sur le réseau local
# de l'établissement, sans certificat, définir NEXIA_HTTPS=0 (les cookies ne seront alors pas chiffrés en transit).
HTTPS = (not DEBUG) and os.environ.get("NEXIA_HTTPS", "1") == "1"
if HTTPS:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = os.environ.get("NEXIA_SSL_REDIRECT", "1") == "1"
    SECURE_HSTS_SECONDS = int(os.environ.get("NEXIA_HSTS_SECONDS", "3600"))
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
