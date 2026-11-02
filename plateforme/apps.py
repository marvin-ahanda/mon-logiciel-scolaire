from django.apps import AppConfig


class PlateformeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "plateforme"
    verbose_name = "Plateforme NexIASchool (établissements abonnés)"

    def ready(self):
        from django.db.models.signals import post_migrate

        from .securite import proteger_tables_communes
        post_migrate.connect(proteger_tables_communes, sender=self)
