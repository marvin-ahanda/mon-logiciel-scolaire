from django.db import migrations


def creer(apps, schema_editor):
    apps.get_model("auth", "Group").objects.get_or_create(name="Surveillance")


def supprimer(apps, schema_editor):
    apps.get_model("auth", "Group").objects.filter(name="Surveillance").delete()


class Migration(migrations.Migration):
    dependencies = [("comptes", "0001_groupes_roles")]
    operations = [migrations.RunPython(creer, supprimer)]
