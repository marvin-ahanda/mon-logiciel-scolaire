from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from finances.models import Paiement, Reduction, Remboursement
from finances.tests import FinancesMixin

from discipline.models import Absence, Incident, Infraction, Sanction

from .roles import ADMINISTRATION, CAISSE, SURVEILLANCE, est_administration, est_caissier, est_surveillant, libelle_role


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
        self.client.post(self.url_compte(), {"action": "reduction", "r-rubrique": self.t1.pk, "r-montant": 1000, "r-motif": "x"})
        self.client.post(self.url_compte(), {"action": "remboursement", "rb-montant": 1000, "rb-motif": "x"})
        self.assertFalse(Reduction.objects.exists() or Remboursement.objects.exists())
        self.assertNotContains(self.client.get(self.url_compte()), "Réduction des frais")

    def test_annule_son_propre_paiement_du_jour(self):
        self.payer(self.ins[0], self.t1, 20000)
        p = Paiement.objects.get()
        self.assertContains(self.client.get(self.url_compte()), "Confirmer l'annulation")
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "Erreur de montant"})
        p.refresh_from_db()
        self.assertTrue(p.annule)
        self.assertEqual(p.annule_par, self.caissier)

    def test_ne_peut_pas_annuler_le_paiement_d_un_autre(self):
        p = Paiement.enregistrer(inscription=self.ins[0], rubrique=self.t1, montant=5000, saisi_par=self.admin)
        self.assertNotContains(self.client.get(self.url_compte()), "Confirmer l'annulation")
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "x"})
        p.refresh_from_db()
        self.assertFalse(p.annule)

    def test_ne_peut_pas_annuler_un_paiement_d_un_jour_precedent(self):
        from datetime import timedelta
        from django.utils import timezone
        self.payer(self.ins[0], self.t1, 20000)
        p = Paiement.objects.get()
        Paiement.objects.filter(pk=p.pk).update(saisi_le=timezone.now() - timedelta(days=1))
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "x"})
        p.refresh_from_db()
        self.assertFalse(p.annule)

    def test_date_du_recu_antidatee_ne_change_rien(self):
        """La règle se fonde sur l'heure d'enregistrement : un reçu daté d'hier mais saisi aujourd'hui reste annulable."""
        from datetime import timedelta
        from django.utils import timezone
        self.payer(self.ins[0], self.t1, 20000, date=timezone.localdate() - timedelta(days=3))
        p = Paiement.objects.get()
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "Mauvais élève"})
        p.refresh_from_db()
        self.assertTrue(p.annule)

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
        base = {"username": "nouveau", "first_name": "N", "last_name": "Ouveau", "email": "", "is_active": "on", "role": CAISSE}
        base.update(data)
        return self.client.post(reverse("utilisateur_creer"), base, follow=True)

    def test_creer_un_caissier(self):
        r = self.creer()
        u = User.objects.get(username="nouveau")
        self.assertTrue(est_caissier(u) and not est_administration(u) and not u.is_staff)
        self.assertRedirects(r, reverse("code_acces", args=[u.pk]))
        code = r.context["code"]                                                        # code généré et affiché
        self.assertRegex(code, r"^[a-z0-9]{6}$")
        self.assertTrue(u.check_password(code))
        self.assertIsNone(self.client.get(reverse("code_acces", args=[u.pk])).context["code"])   # affiché une seule fois

    def test_identifiant_deduit_du_nom(self):
        self.creer(username="", first_name="Élodie", last_name="Mbia")
        self.assertTrue(User.objects.filter(username="elodie.mbia").exists())
        self.creer(username="", first_name="Élodie", last_name="Mbia")
        self.assertTrue(User.objects.filter(username="elodie.mbia2").exists())

    def test_creer_un_directeur_des_etudes(self):
        self.creer(username="dir", role=ADMINISTRATION)
        u = User.objects.get(username="dir")
        self.assertTrue(est_administration(u) and u.is_staff)

    def test_nom_obligatoire(self):
        self.creer(last_name="")
        self.assertFalse(User.objects.filter(username="nouveau").exists())

    def test_changer_de_role(self):
        url = reverse("utilisateur_modifier", args=[self.caissier.pk])
        self.client.post(url, {"username": "caisse", "last_name": "Caisse", "is_active": "on", "role": ADMINISTRATION})
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
        self.client.post(reverse("utilisateur_modifier", args=[self.admin.pk]), {"username": "admin", "last_name": "A", "role": ADMINISTRATION})
        self.assertFalse(User.objects.get(pk=self.admin.pk).is_active)                  # possible : il en reste un
        r = self.client.post(reverse("utilisateur_modifier", args=[autre.pk]), {"username": "autre.admin", "last_name": "B", "is_active": "on", "role": CAISSE})
        self.assertEqual(r.status_code, 200)                                            # refusé : il serait le dernier
        self.assertTrue(est_administration(User.objects.get(pk=autre.pk)))

    def test_compte_desactive_ne_peut_plus_se_connecter(self):
        self.client.post(reverse("utilisateur_modifier", args=[self.caissier.pk]), {"username": "caisse", "last_name": "C", "role": CAISSE})
        self.client.logout()
        r = self.client.post(reverse("login"), {"personnel": self.caissier.pk, "code": "Mot2Passe!x"})
        self.assertEqual(r.status_code, 200)                                            # reste sur la page de connexion
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_liste_des_comptes(self):
        r = self.client.get(reverse("utilisateurs"))
        self.assertContains(r, "Caissier")
        self.assertContains(r, "Enseignant")


class SurveillantTests(RolesMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.surveillant = User.objects.create_user("sg", password="Mot2Passe!x")
        self.surveillant.groups.add(Group.objects.get(name=SURVEILLANCE))
        self.client.force_login(self.surveillant)

    def test_role(self):
        self.assertTrue(est_surveillant(self.surveillant))
        self.assertEqual(libelle_role(self.surveillant), "Surveillant général")
        self.assertRedirects(self.client.get(reverse("accueil")), reverse("appel"))

    def test_gere_la_discipline(self):
        from datetime import date
        url = f"{reverse('appel')}?classe={self.classe.pk}&sequence={self.s1.pk}&date=2025-10-06"
        self.client.post(url, {f"nj_{self.ins[0].id}": "2", f"retard_{self.ins[1].id}": "on"})
        self.assertEqual(Absence.objects.get().saisi_par, self.surveillant)
        inf = Infraction.objects.create(libelle="Retard répété", sanction=Sanction.objects.create(libelle="Avertissement", points_perdus=1))
        self.client.post(f"{reverse('incidents')}?classe={self.classe.pk}&sequence={self.s1.pk}",
                         {"inscription": self.ins[0].id, "date": "2025-10-07", "infraction": inf.id})
        self.assertTrue(Incident.objects.exists())
        self.assertEqual(self.client.get(reverse("suivi_discipline"), {"classe": self.classe.pk, "periode": "a"}).status_code, 200)

    def test_pas_d_acces_au_reste(self):
        for nom in ["caisse", "saisie", "bulletins", "eleves", "tarifs", "utilisateurs", "exercices"]:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 302)
        self.assertEqual(self.client.get(reverse("admin:index")).status_code, 302)

    def test_menu(self):
        r = self.client.get(reverse("appel"))
        self.assertContains(r, "Suivi disciplinaire")
        self.assertNotContains(r, "Barème de la note de discipline")   # paramétrage : administration
        self.assertNotContains(r, "Saisie des notes")

    def test_creation_par_l_administration(self):
        self.client.force_login(self.admin)
        self.client.post(reverse("utilisateur_creer"), {"username": "sg2", "last_name": "Sg", "is_active": "on", "role": SURVEILLANCE})
        u = User.objects.get(username="sg2")
        self.assertTrue(est_surveillant(u) and not u.is_staff)


class CodeAccesTests(TestCase):
    def test_format_du_code(self):
        from .codes import generer_code
        codes = {generer_code() for _ in range(300)}
        self.assertGreater(len(codes), 295)                                              # aléatoires
        for c in codes:
            self.assertRegex(c, r"^[a-hjkmnp-z0-9]{6}$")                                 # ni i, ni l, ni o
            self.assertTrue(any(x.isdigit() for x in c) and any(x.isalpha() for x in c))


class ConnexionTests(RolesMixin, TestCase):
    def setUp(self):
        super().setUp()
        from .codes import attribuer_code
        self.caissier.last_name, self.caissier.first_name = "Zang", "Paul"
        self.caissier.save()
        self.code = attribuer_code(self.caissier)

    def connecter(self, code, user=None, **extra):
        return self.client.post(reverse("login"), {"personnel": (user or self.caissier).pk, "code": code, **extra})

    def test_liste_alphabetique_du_personnel(self):
        ens = self.ens                                                                  # « Prof » : nom pris sur la fiche enseignant
        User.objects.create_user("e1", password="p", last_name="Élan", first_name="Rose").groups.add(Group.objects.get(name=SURVEILLANCE))
        User.objects.create_user("sans.role", password="p", last_name="Aaa")              # sans rôle : absent
        inactif = User.objects.create_user("inactif", password="p", last_name="Abc", is_active=False)
        inactif.groups.add(Group.objects.get(name=CAISSE))
        noms = [n for _, n in self.client.get(reverse("login")).context["personnels"]]
        self.assertEqual(noms, sorted(noms, key=lambda n: n.replace("É", "E").lower()))
        self.assertIn("ÉLAN Rose", noms)
        self.assertIn("ZANG Paul", noms)
        self.assertIn(f"{ens.nom.upper()} {ens.prenom}".strip(), noms)
        self.assertNotIn("AAA", noms)
        self.assertNotIn("ABC", noms)
        self.assertLess(noms.index("ÉLAN Rose"), noms.index("ZANG Paul"))

    def test_homonymes_distingues(self):
        for ident in ("h1", "h2"):
            User.objects.create_user(ident, password="p", last_name="Atangana", first_name="Luc").groups.add(Group.objects.get(name=CAISSE))
        noms = [n for _, n in self.client.get(reverse("login")).context["personnels"]]
        self.assertIn("ATANGANA Luc (h1)", noms)
        self.assertIn("ATANGANA Luc (h2)", noms)

    def test_connexion_par_nom_et_code(self):
        r = self.connecter(self.code.upper(), next="/finances/")                         # majuscules acceptées
        self.assertRedirects(r, "/finances/", fetch_redirect_response=False)
        self.assertEqual(int(self.client.session["_auth_user_id"]), self.caissier.pk)

    def test_redirection_externe_refusee(self):
        r = self.connecter(self.code, next="https://exemple.com/")
        self.assertEqual(r.url, "/")

    def test_code_d_un_autre_refuse(self):
        from .codes import attribuer_code
        autre = attribuer_code(self.admin)
        r = self.connecter(autre)                                                       # bon code, mauvais nom
        self.assertContains(r, "Code incorrect")
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_blocage_apres_cinq_essais(self):
        from datetime import timedelta
        from django.utils import timezone
        for i in range(4):
            self.assertContains(self.connecter("zzzzz9"), f"Encore {4 - i} essai")
        self.assertContains(self.connecter("zzzzz9"), "bloqué")
        r = self.connecter(self.code)                                                   # même le bon code est refusé
        self.assertContains(r, "accès bloqué pendant encore")
        self.assertNotIn("_auth_user_id", self.client.session)
        acces = self.caissier.acces
        acces.bloque_jusqu_a = timezone.now() - timedelta(seconds=1)                     # le délai est écoulé
        acces.save()
        self.assertEqual(self.connecter(self.code).status_code, 302)

    def test_nouveau_code_debloque_et_remplace_l_ancien(self):
        for _ in range(5):
            self.connecter("zzzzz9")
        self.client.force_login(self.admin)
        r = self.client.post(reverse("regenerer_code", args=[self.caissier.pk]), follow=True)
        nouveau = r.context["code"]
        self.client.logout()
        self.assertContains(self.connecter(self.code), "Code incorrect")                 # l'ancien ne marche plus
        self.assertEqual(self.connecter(nouveau).status_code, 302)

    def test_administrateur_change_son_propre_code_sans_etre_deconnecte(self):
        self.client.force_login(self.admin)
        r = self.client.post(reverse("regenerer_code", args=[self.admin.pk]), follow=True)
        self.assertTrue(r.context["code"])
        self.assertEqual(self.client.get(reverse("utilisateurs")).status_code, 200)

    def test_codes_reserves_a_l_administration(self):
        self.client.force_login(self.caissier)
        self.assertEqual(self.client.post(reverse("regenerer_code", args=[self.admin.pk])).status_code, 302)
        self.assertEqual(self.client.get(reverse("code_acces", args=[self.admin.pk])).status_code, 302)
        from .models import AccesPersonnel
        self.assertFalse(AccesPersonnel.objects.filter(utilisateur=self.admin).exists())   # aucun code généré

    def test_porte_unique_pour_l_administration_avancee(self):
        r = self.client.get("/admin/login/?next=/admin/")
        self.assertRedirects(r, reverse("login") + "?next=/admin/", fetch_redirect_response=False)

    def test_commande_de_depannage(self):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command("code_acces", "caisse", stdout=out)
        code = out.getvalue().strip().split()[-1]
        self.caissier.refresh_from_db()
        self.assertTrue(self.caissier.check_password(code))
