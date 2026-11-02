from django.db import migrations


def creer_groupes(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("auth", "User")
    admin, _ = Group.objects.get_or_create(name="Administration")
    Group.objects.get_or_create(name="Caisse")
    # Les membres actuels de l'administration (is_staff) conservent leurs droits.
    for u in User.objects.filter(is_staff=True):
        u.groups.add(admin)


def supprimer_groupes(apps, schema_editor):
    apps.get_model("auth", "Group").objects.filter(name__in=["Administration", "Caisse"]).delete()


class Migration(migrations.Migration):
    dependencies = [("auth", "0012_alter_user_first_name_max_length")]
    operations = [migrations.RunPython(creer_groupes, supprimer_groupes)]
