"""Tests du mode SaaS (PostgreSQL obligatoire) :

    NEXIA_MULTI=1 DATABASE_URL=postgres://… python manage.py test plateforme
"""

import unittest

from django.conf import settings

if not settings.MULTI_ETABLISSEMENTS:
    raise unittest.SkipTest("tests du mode multi-établissements (NEXIA_MULTI=1 et PostgreSQL)")

from django.contrib.auth.hashers import make_password  # noqa: E402
from django.contrib.auth.models import User  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.db import connection  # noqa: E402
from django.test import TestCase, override_settings  # noqa: E402
from django_tenants.utils import schema_context  # noqa: E402

from .middleware import CLE_ETABLISSEMENT  # noqa: E402
from .models import EspaceEtablissement  # noqa: E402
from .services import creer_espace, generer_code_etablissement  # noqa: E402

MDP = make_password("Console-Proprietaire-2026!")


def supprimer(*espaces):
    connection.set_schema_to_public()
    with connection.cursor() as c:
        c.execute("SET CONSTRAINTS ALL IMMEDIATE")          # vérifie les clés étrangères avant de supprimer le schéma
    for e in espaces:
        e.delete(force_drop=True)


class SaasMixin:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.a, cls.code_a, cls.acces_a = creer_espace("Collège Saint-Joseph", "Yaoundé", "Mballa", "Paul")
        cls.b, cls.code_b, cls.acces_b = creer_espace("Lycée Bilingue de Bonabéri", "Douala", "Ngo", "Marie")
        connection.set_schema_to_public()

    @classmethod
    def tearDownClass(cls):
        supprimer(cls.a, cls.b)
        super().tearDownClass()

    def entrer(self, nom, code):
        return self.client.post("/etablissement/", {"nom": nom, "code": code})

    def connecter(self, espace, code_personnel):
        with schema_context(espace.schema_name):
            pk = User.objects.get(is_staff=True).pk
        return self.client.post("/connexion/", {"personnel": pk, "code": code_personnel})


class ParcoursTests(SaasMixin, TestCase):
    def test_codes_generes(self):
        self.assertRegex(self.code_a, r"^[a-hjkmnp-z0-9]{8}$")
        self.assertRegex(self.acces_a[0][2], r"^[a-hjkmnp-z0-9]{6}$")
        self.assertEqual(self.acces_a[0][:2], ("MBALLA Paul", "Administration"))
        self.assertGreater(len({generer_code_etablissement() for _ in range(200)}), 195)

    def test_sans_etablissement_on_est_renvoye_vers_le_choix(self):
        self.assertRedirects(self.client.get("/"), "/etablissement/", fetch_redirect_response=False)
        self.assertRedirects(self.client.get("/connexion/"), "/etablissement/", fetch_redirect_response=False)
        r = self.client.get("/notes/resultats/")
        self.assertEqual(r.status_code, 302)
        self.assertTrue(r.url.startswith("/etablissement/?next="))

    def test_parcours_complet(self):
        r = self.entrer("college saint joseph", self.code_a.upper())        # casse et accents ignorés
        self.assertRedirects(r, "/connexion/", fetch_redirect_response=False)
        page = self.client.get("/connexion/")
        self.assertContains(page, "Collège Saint-Joseph")
        noms = [n for _, n in page.context["personnels"]]
        self.assertEqual(noms, ["MBALLA Paul"])                           # uniquement le personnel de cet établissement
        r = self.connecter(self.a, self.acces_a[0][2])
        self.assertEqual(r.status_code, 302)
        accueil = self.client.get("/")
        self.assertEqual(accueil.status_code, 200)
        self.assertContains(accueil, "Collège Saint-Joseph")

    def test_mauvais_code_ou_nom(self):
        self.assertContains(self.entrer("Collège Saint-Joseph", self.code_b), "établissement incorrect")
        self.assertContains(self.entrer("Collège Inconnu", self.code_a), "établissement incorrect")
        self.assertNotIn(CLE_ETABLISSEMENT, self.client.session)

    def test_blocage_apres_dix_essais(self):
        for _ in range(10):
            self.entrer("Collège Saint-Joseph", "mauvais0")
        self.assertContains(self.entrer("Collège Saint-Joseph", self.code_a), "essais erronés depuis cet appareil")

    def test_code_personnel_d_un_autre_etablissement_refuse(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        with schema_context(self.a.schema_name):
            pk = User.objects.get(is_staff=True).pk
        r = self.client.post("/connexion/", {"personnel": pk, "code": self.acces_b[0][2]})
        self.assertContains(r, "Code incorrect")

    def test_une_connexion_ne_vaut_que_dans_son_etablissement(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        self.connecter(self.a, self.acces_a[0][2])
        s = self.client.session
        s[CLE_ETABLISSEMENT] = self.b.schema_name                            # session modifiée à la main
        s.save()
        r = self.client.get("/")
        self.assertEqual(r.status_code, 302)                                # pas d'accès aux données de B
        self.assertIn("/connexion/", r.url)

    def test_changer_d_etablissement_deconnecte(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        self.connecter(self.a, self.acces_a[0][2])
        self.entrer("Lycée Bilingue de Bonabéri", self.code_b)
        self.assertEqual(self.client.get("/").status_code, 302)
        self.assertEqual([n for _, n in self.client.get("/connexion/").context["personnels"]], ["NGO Marie"])

    def test_deconnexion_garde_l_etablissement(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        self.connecter(self.a, self.acces_a[0][2])
        self.client.post("/deconnexion/")
        self.assertEqual(self.client.get("/connexion/").status_code, 200)    # pas besoin de ressaisir l'établissement

    def test_etablissement_desactive(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        EspaceEtablissement.objects.filter(pk=self.a.pk).update(actif=False)
        self.assertRedirects(self.client.get("/connexion/"), "/etablissement/", fetch_redirect_response=False)
        self.assertContains(self.entrer("Collège Saint-Joseph", self.code_a), "incorrect")
        EspaceEtablissement.objects.filter(pk=self.a.pk).update(actif=True)

    def test_l_administration_change_le_code_de_l_etablissement(self):
        self.entrer("Collège Saint-Joseph", self.code_a)
        self.connecter(self.a, self.acces_a[0][2])
        nouveau = self.client.post("/parametres/code-etablissement/").context["code"]
        self.client.post("/etablissement/changer/")
        self.assertContains(self.entrer("Collège Saint-Joseph", self.code_a), "incorrect")
        self.assertRedirects(self.entrer("Collège Saint-Joseph", nouveau), "/connexion/", fetch_redirect_response=False)
        espace = EspaceEtablissement.objects.get(pk=self.a.pk)
        espace.definir_code(self.code_a)
        espace.save()

    def test_photos_rangees_dans_le_schema_de_l_etablissement(self):
        from scolarite.models import Eleve, FichierStocke
        with schema_context(self.a.schema_name):
            e = Eleve.objects.create(matricule="P1", nom="Photo", sexe="F")
            e.photo.save("p.jpg", ContentFile(b"\xff\xd8donnees"), save=True)
            self.assertEqual(Eleve.objects.get(pk=e.pk).photo.open("rb").read(), b"\xff\xd8donnees")
        with schema_context(self.b.schema_name):
            self.assertFalse(FichierStocke.objects.exists())


@override_settings(NEXIA_PROPRIETAIRE="proprio", NEXIA_PROPRIETAIRE_MDP=MDP, NEXIA_JETON_INSTALLATION="j" * 40)
class ConsoleTests(TestCase):
    def tearDown(self):
        connection.set_schema_to_public()
        supprimer(*EspaceEtablissement.objects.all())

    def test_console_fermee_sans_configuration(self):
        with override_settings(NEXIA_PROPRIETAIRE=""):
            self.assertEqual(self.client.get("/plateforme/").status_code, 404)

    def test_connexion_et_creation(self):
        self.assertRedirects(self.client.get("/plateforme/"), "/plateforme/connexion/")
        r = self.client.post("/plateforme/connexion/", {"identifiant": "proprio", "mot_de_passe": "faux"})
        self.assertContains(r, "incorrect")
        self.client.post("/plateforme/connexion/", {"identifiant": "proprio", "mot_de_passe": "Console-Proprietaire-2026!"})
        r = self.client.post("/plateforme/etablissements/nouveau/", {"nom": "École Les Pépites", "ville": "Kribi",
                                                                  "admin_nom": "Essomba", "admin_prenom": "Rose"}, follow=True)
        codes = r.context["codes"]
        self.assertEqual(codes["espace"], "École Les Pépites")
        self.assertEqual(codes["acces"][0][0], "ESSOMBA Rose")
        self.assertIsNone(self.client.get("/plateforme/").context["codes"])          # affichés une seule fois
        r = self.client.post("/plateforme/etablissements/nouveau/", {"nom": "ecole les pepites", "admin_nom": "X"}, follow=True)
        self.assertContains(r, "existe déjà")

    def test_console_bloquee_apres_cinq_essais(self):
        for _ in range(5):
            self.client.post("/plateforme/connexion/", {"identifiant": "proprio", "mot_de_passe": "faux"})
        r = self.client.post("/plateforme/connexion/", {"identifiant": "proprio", "mot_de_passe": "Console-Proprietaire-2026!"})
        self.assertContains(r, "essais erronés")

    def test_le_personnel_n_a_pas_acces_a_la_console(self):
        self.assertRedirects(self.client.post("/plateforme/etablissements/1/activer/"), "/plateforme/connexion/",
                             fetch_redirect_response=False)

    def test_installation_protegee_par_jeton(self):
        self.assertEqual(self.client.get("/plateforme/installer/").status_code, 404)
        self.assertEqual(self.client.get("/plateforme/installer/?jeton=" + "x" * 40).status_code, 404)
        self.assertEqual(self.client.get("/plateforme/installer/?jeton=" + "j" * 40).status_code, 200)


class DemonstrationTests(TestCase):
    def test_demo_sans_sms_reel(self):
        e, _, acces = creer_espace("Collège Démo", demonstration=True)
        try:
            self.assertEqual(len(acces), 11)
            with schema_context(e.schema_name):
                from sms.passerelles import passerelle
                self.assertFalse(passerelle().reel)
        finally:
            supprimer(e)
