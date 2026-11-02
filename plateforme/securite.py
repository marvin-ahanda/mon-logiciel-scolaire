"""Limitation des essais et protection des tables communes."""

from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.utils import timezone


def adresse_ip(request):
    """Derrière Vercel, l'adresse réelle du visiteur est fournie (et réécrite) par la plateforme."""
    if getattr(settings, "NEXIA_DERRIERE_PROXY", False):
        for entete in ("HTTP_X_VERCEL_FORWARDED_FOR", "HTTP_X_REAL_IP", "HTTP_X_FORWARDED_FOR"):
            if request.META.get(entete):
                return request.META[entete].split(",")[0].strip()[:100]
    return request.META.get("REMOTE_ADDR", "inconnue")[:100]


class Limiteur:
    def __init__(self, prefixe, essais, duree_minutes):
        self.prefixe, self.essais, self.duree = prefixe, essais, timedelta(minutes=duree_minutes)

    def _tentative(self, request):
        from .models import TentativeAcces
        return TentativeAcces.objects.get_or_create(cle=f"{self.prefixe}:{adresse_ip(request)}")[0]

    def minutes_de_blocage(self, request):
        t = self._tentative(request)
        if t.bloque_jusqu_a and t.bloque_jusqu_a > timezone.now():
            return max(1, -(-int((t.bloque_jusqu_a - timezone.now()).total_seconds()) // 60))
        return 0

    def echec(self, request):
        t = self._tentative(request)
        t.echecs += 1
        if t.echecs >= self.essais:
            t.echecs, t.bloque_jusqu_a = 0, timezone.now() + self.duree
        t.save()

    def reussite(self, request):
        from .models import TentativeAcces
        TentativeAcces.objects.filter(cle=f"{self.prefixe}:{adresse_ip(request)}").delete()


def proteger_tables_communes(sender, using="default", **kwargs):
    """Active la sécurité par ligne (RLS) sur les tables du schéma public : l'API de données de Supabase
    (rôles anon/authenticated) n'y a alors aucun accès. Le rôle propriétaire de l'application n'est pas concerné."""
    if connection.vendor != "postgresql" or getattr(connection, "schema_name", "public") != "public":
        return
    with connection.cursor() as c:
        c.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user AND NOT rowsecurity")
        for (table,) in c.fetchall():
            c.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
