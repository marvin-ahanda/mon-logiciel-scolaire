import shutil
import tempfile
from io import BytesIO

from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from notes.tests import DonneesMixin

from .models import Eleve

MEDIA_TEMP = tempfile.mkdtemp(prefix="otourix-tests-")


def image(fmt="PNG", taille=(1200, 900), exif=False):
    tampon = BytesIO()
    img = Image.new("RGB", taille, (120, 80, 200))
    if exif:
        e = Image.Exif()
        e[0x010F] = "Fabricant-Test"              # Make
        img.save(tampon, format=fmt, exif=e)
    else:
        img.save(tampon, format=fmt)
    ext = {"PNG": "png", "JPEG": "jpg", "GIF": "gif", "WEBP": "webp"}[fmt]
    return SimpleUploadedFile(f"photo.{ext}", tampon.getvalue(), content_type=f"image/{ext}")


@override_settings(MEDIA_ROOT=MEDIA_TEMP)
class PhotosTests(DonneesMixin, TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TEMP, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.eleve = self.ins[0].eleve
        self.client.force_login(self.admin)

    def envoyer(self, fichier=None, **extra):
        data = {"matricule": self.eleve.matricule, "nom": self.eleve.nom, "sexe": "F", "classe": self.classe.pk, **extra}
        if fichier is not None:
            data["photo"] = fichier
        return self.client.post(reverse("eleve_modifier", args=[self.eleve.pk]), data)

    def test_photo_redimensionnee_et_renommee(self):
        r = self.envoyer(image("PNG", (1600, 1200)))
        self.assertEqual(r.status_code, 302)
        self.eleve.refresh_from_db()
        self.assertRegex(self.eleve.photo.name, r"^photos/[0-9a-f]{32}\.jpg$")   # nom aléatoire
        with Image.open(self.eleve.photo.path) as img:
            self.assertEqual(img.format, "JPEG")
            self.assertLessEqual(max(img.size), 400)

    def test_metadonnees_supprimees(self):
        self.envoyer(image("JPEG", exif=True))
        self.eleve.refresh_from_db()
        with Image.open(self.eleve.photo.path) as img:
            self.assertEqual(len(img.getexif()), 0)

    def test_faux_fichier_image_refuse(self):
        faux = SimpleUploadedFile("photo.jpg", b"ceci n'est pas une image", content_type="image/jpeg")
        self.assertEqual(self.envoyer(faux).status_code, 200)
        self.eleve.refresh_from_db()
        self.assertFalse(self.eleve.photo)

    def test_format_non_accepte(self):
        self.assertEqual(self.envoyer(image("GIF")).status_code, 200)
        self.eleve.refresh_from_db()
        self.assertFalse(self.eleve.photo)

    def test_remplacement_et_suppression_effacent_l_ancien_fichier(self):
        import os
        self.envoyer(image())
        self.eleve.refresh_from_db()
        premier = self.eleve.photo.path
        self.envoyer(image("JPEG"))
        self.eleve.refresh_from_db()
        self.assertFalse(os.path.exists(premier))
        second = self.eleve.photo.path
        self.envoyer(supprimer_photo="on")
        self.eleve.refresh_from_db()
        self.assertFalse(self.eleve.photo)
        self.assertFalse(os.path.exists(second))

    def test_acces_protege(self):
        self.envoyer(image())
        url = reverse("photo_eleve", args=[self.eleve.pk])
        self.assertEqual(self.client.get(url).status_code, 200)                 # administration
        self.assertEqual(self.client.get(url)["Content-Type"], "image/jpeg")
        self.client.force_login(self.u_ens)                                     # enseignant de la classe
        self.assertEqual(self.client.get(url).status_code, 200)
        etranger = User.objects.create_user("etranger", password="p")
        from .models import Enseignant
        Enseignant.objects.create(matricule="E99", nom="Etranger", utilisateur=etranger)
        self.client.force_login(etranger)                                       # n'enseigne pas dans la classe
        self.assertEqual(self.client.get(url).status_code, 404)
        caissier = User.objects.create_user("c", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        self.client.force_login(caissier)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(url).status_code, 302)                 # connexion requise

    def test_photo_sur_le_bulletin(self):
        self.envoyer(image())
        url = reverse("bulletins")
        params = {"classe": self.classe.pk, "periode": f"s{self.s1.pk}", "eleve": self.ins[0].id}
        img = reverse("photo_eleve", args=[self.eleve.pk])
        self.assertContains(self.client.get(url, params), img)
        self.assertNotContains(self.client.get(url, {**params, "photo": "0"}), img)
