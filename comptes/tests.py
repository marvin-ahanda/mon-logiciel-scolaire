from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from finances.models import Paiement, Reduction, Remboursement
from finances.tests import FinancesMixin

from .roles import ADMINISTRATION, CAISSE, est_administration, est_caissier, libelle_role


class RolesMixin(FinancesMixin):
    def setUp(self):
        super().setUp()
        self.caissier = User.objects.create_user("caisse", password="Mot2Passe!x")
        self.caissier.groups.add(Group.objects.get(name=CAISSE))
        self.client.logout()

    def url_compte(self, i=0):
        return reverse("compte_eleve", args=[self.ins[i].pk])


class GroupesTests(TestCase):
    def test_groupes_crees_par_la_migration(self):
        self.assertTrue(Group.objects.filter(name=ADMINISTRATION).exists())
        self.assertTrue(Group.objects.filter(name=CAISSE).exists())

    def test_is_staff_seul_ne_suffit_pas(self):
        u = User.objects.create_user("x", password="p", is_staff=True)
        self.assertFalse(est_administration(u))
        self.assertTrue(est_administration(User.objects.create_superuser("su", password="p")))

    def test_compte_desactive_sans_droits(self):
        u = User.objects.create_user("y", password="p", is_active=False)
        u.groups.add(Group.objects.get(name=ADMINISTRATION))
        self.assertFalse(est_administration(u))


class CaissierTests(RolesMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.caissier)

    def test_pages_de_caisse_autorisees(self):
        self.assertEqual(libelle_role(self.caissier), "Caissier")
        for url in [reverse("caisse"), self.url_compte(), reverse("journal_encaissements"),
                    reverse("situation_financiere") + f"?classe={self.classe.pk}"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_peut_encaisser(self):
        self.payer(self.ins[0], self.inscr, 10000)
        p = Paiement.objects.get()
        self.assertEqual(p.saisi_par, self.caissier)
        self.assertEqual(self.client.get(reverse("recu", args=[p.pk])).status_code, 200)

    def test_decisions_financieres_refusees_cote_serveur(self):
        self.payer(self.ins[0], self.t1, 20000)
        p = Paiement.objects.get()
        self.client.post(self.url_compte(), {"action": "reduction", "r-rubrique": self.t1.pk, "r-montant": 1000, "r-motif": "x"})
        self.client.post(self.url_compte(), {"action": "remboursement", "rb-montant": 1000, "rb-motif": "x"})
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "erreur"})
        p.refresh_from_db()
        self.assertFalse(Reduction.objects.exists() or Remboursement.objects.exists() or p.annule)
        self.assertNotContains(self.client.get(self.url_compte()), "Réduction des frais")

    def test_autres_modules_refuses(self):
        for nom in ["tarifs", "saisie", "resultats", "bulletins", "eleves", "classes", "appel", "utilisateurs"]:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 302)
        self.assertEqual(self.client.get(reverse("admin:index")).status_code, 302)   # pas d'administration avancée

    def test_accueil_redirige_vers_la_caisse(self):
        self.assertRedirects(self.client.get(reverse("accueil")), reverse("caisse"))

    def test_menu_limite(self):
        r = self.client.get(reverse("caisse"))
        self.assertContains(r, "Journal des encaissements")
        self.assertNotContains(r, "Saisie des notes")
        self.assertNotContains(r, "Tarifs</a>")


class EnseignantTests(RolesMixin, TestCase):
    def test_acces_aux_notes_seulement(self):
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.get(reverse("saisie")).status_code, 200)
        for nom in ["caisse", "journal_encaissements", "utilisateurs", "tarifs"]:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 302)
        self.assertNotContains(self.client.get(reverse("saisie")), "Écolage</a>")


class GestionComptesTests(RolesMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.admin)

    def creer(self, **data):
        base = {"username": "nouveau", "first_name": "N", "last_name": "Ouveau", "email": "", "is_active": "on",
                "role": CAISSE, "mot_de_passe": "Tres-Long-2025!"}
        base.update(data)
        return self.client.post(reverse("utilisateur_creer"), base)

    def test_creer_un_caissier(self):
        self.creer()
        u = User.objects.get(username="nouveau")
        self.assertTrue(est_caissier(u) and not est_administration(u) and not u.is_staff)
        self.assertTrue(u.check_password("Tres-Long-2025!"))

    def test_creer_un_directeur_des_etudes(self):
        self.creer(username="dir", role=ADMINISTRATION)
        u = User.objects.get(username="dir")
        self.assertTrue(est_administration(u) and u.is_staff)

    def test_mot_de_passe_faible_refuse(self):
        self.creer(mot_de_passe="123")
        self.assertFalse(User.objects.filter(username="nouveau").exists())

    def test_changer_de_role(self):
        url = reverse("utilisateur_modifier", args=[self.caissier.pk])
        self.client.post(url, {"username": "caisse", "is_active": "on", "role": ADMINISTRATION})
        self.caissier.refresh_from_db()
        self.assertTrue(est_administration(User.objects.get(pk=self.caissier.pk)))
        self.assertFalse(self.caissier.groups.filter(name=CAISSE).exists())

    def test_ne_peut_pas_se_retirer_ses_droits(self):
        url = reverse("utilisateur_modifier", args=[self.admin.pk])
        self.client.post(url, {"username": "admin", "is_active": "on", "role": CAISSE})
        self.client.post(url, {"username": "admin", "role": ADMINISTRATION})          # désactivation
        u = User.objects.get(pk=self.admin.pk)
        self.assertTrue(est_administration(u) and u.is_active)

    def test_dernier_administrateur_protege(self):
        autre = User.objects.create_user("autre.admin", password="p")
        autre.groups.add(Group.objects.get(name=ADMINISTRATION))
        self.client.force_login(autre)
        self.client.post(reverse("utilisateur_modifier", args=[self.admin.pk]), {"username": "admin", "role": ADMINISTRATION})
        self.assertFalse(User.objects.get(pk=self.admin.pk).is_active)                  # possible : il en reste un
        r = self.client.post(reverse("utilisateur_modifier", args=[autre.pk]), {"username": "autre.admin", "is_active": "on", "role": CAISSE})
        self.assertEqual(r.status_code, 200)                                            # refusé : il serait le dernier
        self.assertTrue(est_administration(User.objects.get(pk=autre.pk)))

    def test_compte_desactive_ne_peut_plus_se_connecter(self):
        self.client.post(reverse("utilisateur_modifier", args=[self.caissier.pk]), {"username": "caisse", "role": CAISSE})
        self.client.logout()
        r = self.client.post(reverse("login"), {"username": "caisse", "password": "Mot2Passe!x"})
        self.assertEqual(r.status_code, 200)                                            # reste sur la page de connexion
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_liste_des_comptes(self):
        r = self.client.get(reverse("utilisateurs"))
        self.assertContains(r, "Caissier")
        self.assertContains(r, "Enseignant")
