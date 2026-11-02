from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from notes.tests import DonneesMixin
from scolarite.models import Exercice, Inscription

from .lettres import en_lettres, montant_en_lettres
from .models import Paiement, Reduction, Remboursement, Rubrique, Tarif
from .services import compte


class LettresTests(TestCase):
    def test_regles_du_francais(self):
        cas = {0: "zéro", 21: "vingt et un", 71: "soixante et onze", 80: "quatre-vingts", 81: "quatre-vingt-un",
               91: "quatre-vingt-onze", 200: "deux cents", 280: "deux cent quatre-vingts", 1000: "mille",
               80000: "quatre-vingt mille", 180000: "cent quatre-vingt mille", 200000: "deux cent mille",
               75500: "soixante-quinze mille cinq cents", 1000001: "un million un",
               200000000: "deux cents millions", 2000080: "deux millions quatre-vingts"}
        for n, attendu in cas.items():
            with self.subTest(n=n):
                self.assertEqual(en_lettres(n), attendu)

    def test_montant(self):
        self.assertEqual(montant_en_lettres(125000), "Cent vingt-cinq mille francs CFA")


class FinancesMixin(DonneesMixin):
    def setUp(self):
        super().setUp()
        self.inscr = Rubrique.objects.create(libelle="Inscription", ordre=1)
        self.t1 = Rubrique.objects.create(libelle="1re tranche", ordre=2)
        niv = self.classe.niveau
        for r, nouveau, ancien in [(self.inscr, 10000, 5000), (self.t1, 50000, 50000)]:
            Tarif.objects.create(exercice=self.ex, rubrique=r, niveau=niv, statut="N", montant=nouveau)
            Tarif.objects.create(exercice=self.ex, rubrique=r, niveau=niv, statut="A", montant=ancien)
        self.ins[1].statut = Inscription.ANCIEN
        self.ins[1].save()
        self.client.force_login(self.admin)

    def payer(self, ins, rubrique, montant, mode="ESP", reference="", date=None):
        return self.client.post(reverse("compte_eleve", args=[ins.pk]), {
            "action": "paiement", "p-rubrique": rubrique.pk, "p-montant": montant, "p-mode": mode,
            "p-reference": reference, "p-date": (date or timezone.localdate()).isoformat()})


class CompteTests(FinancesMixin, TestCase):
    def test_tarif_selon_statut(self):
        self.assertEqual(compte(self.ins[0]).total_du, 60000)     # nouvel élève
        self.assertEqual(compte(self.ins[1]).total_du, 55000)     # ancien élève

    def test_paiement_et_numerotation(self):
        r = self.payer(self.ins[0], self.inscr, 10000)
        p1 = Paiement.objects.get()
        self.assertRedirects(r, reverse("recu", args=[p1.pk]), fetch_redirect_response=False)
        self.payer(self.ins[1], self.t1, 20000)
        self.assertEqual(sorted(Paiement.objects.values_list("numero_recu", flat=True)), [1, 2])
        c = compte(self.ins[0])
        self.assertEqual((c.total_verse, c.total_reste, c.ligne(self.inscr.id).solde), (10000, 50000, True))

    def test_paiement_superieur_au_reste_refuse(self):
        r = self.payer(self.ins[0], self.inscr, 10001)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Paiement.objects.exists())

    def test_paiement_mobile_exige_une_reference(self):
        self.payer(self.ins[0], self.t1, 5000, mode="OM")
        self.assertFalse(Paiement.objects.exists())
        self.payer(self.ins[0], self.t1, 5000, mode="OM", reference="MP250101.1234")
        self.assertEqual(Paiement.objects.get().reference, "MP250101.1234")

    def test_date_future_refusee(self):
        self.payer(self.ins[0], self.t1, 5000, date=timezone.localdate() + timedelta(days=1))
        self.assertFalse(Paiement.objects.exists())

    def test_annulation(self):
        self.payer(self.ins[0], self.inscr, 10000)
        p = Paiement.objects.get()
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": ""})
        p.refresh_from_db()
        self.assertFalse(p.annule)                                  # motif obligatoire
        self.client.post(reverse("annuler_paiement", args=[p.pk]), {"motif": "Erreur de rubrique"})
        p.refresh_from_db()
        self.assertTrue(p.annule)
        self.assertEqual((p.annule_par, p.motif_annulation), (self.admin, "Erreur de rubrique"))
        self.assertEqual(compte(self.ins[0]).ligne(self.inscr.id).reste, 10000)   # le reste est libéré
        self.payer(self.ins[0], self.inscr, 10000)
        self.assertEqual(Paiement.objects.filter(annule=False).get().numero_recu, 2)  # pas de réutilisation du n° 1

    def test_reduction_plafonnee(self):
        url = reverse("compte_eleve", args=[self.ins[0].pk])
        self.client.post(url, {"action": "reduction", "r-rubrique": self.t1.pk, "r-montant": 50001, "r-motif": "Bourse"})
        self.assertFalse(Reduction.objects.exists())
        self.client.post(url, {"action": "reduction", "r-rubrique": self.t1.pk, "r-montant": 15000, "r-motif": "Enfant du personnel"})
        self.assertEqual(compte(self.ins[0]).ligne(self.t1.id).reste, 35000)

    def test_remboursement_plafonne(self):
        self.payer(self.ins[0], self.t1, 20000)
        url = reverse("compte_eleve", args=[self.ins[0].pk])
        self.client.post(url, {"action": "remboursement", "rb-montant": 20001, "rb-motif": "Exclusion"})
        self.assertFalse(Remboursement.objects.exists())
        self.client.post(url, {"action": "remboursement", "rb-montant": 20000, "rb-motif": "Exclusion"})
        self.assertEqual(compte(self.ins[0]).remboursable, 0)

    def test_recu_en_lettres(self):
        self.payer(self.ins[0], self.t1, 25000)
        r = self.client.get(reverse("recu", args=[Paiement.objects.get().pk]))
        self.assertContains(r, "Vingt-cinq mille francs CFA")
        self.assertContains(r, "REÇU N° 1")


class EtatsTests(FinancesMixin, TestCase):
    def test_insolvables_et_solvables(self):
        self.payer(self.ins[0], self.inscr, 10000)
        url = reverse("situation_financiere")
        r = self.client.get(url, {"classe": self.classe.pk, "rubrique": self.inscr.pk, "filtre": "insolvables"})
        self.assertEqual([l["ins"] for l in r.context["lignes"]], [self.ins[1], self.ins[2]])
        r = self.client.get(url, {"classe": self.classe.pk, "rubrique": self.inscr.pk, "filtre": "solvables"})
        self.assertEqual([l["ins"] for l in r.context["lignes"]], [self.ins[0]])

    def test_journal_exclut_les_annules(self):
        self.payer(self.ins[0], self.inscr, 10000)
        self.payer(self.ins[1], self.t1, 7000, mode="MTN", reference="X1")
        self.payer(self.ins[2], self.t1, 3000, mode="MTN", reference="X2")
        self.payer(self.ins[2], self.inscr, 4000)
        self.payer(self.ins[1], self.inscr, 1000)
        Paiement.objects.get(montant=10000).annuler(self.admin, "Erreur")
        r = self.client.get(reverse("journal_encaissements"))
        self.assertEqual(r.context["total"], 15000)
        # un total par mode, pas une ligne par paiement
        self.assertEqual(sorted(r.context["par_mode"]), [("Espèces", 2, 5000), ("MTN Mobile Money", 2, 10000)])

    def test_grille_et_reconduction_des_tarifs(self):
        niv = self.classe.niveau
        r = self.client.post(reverse("tarifs"), {f"t_{self.inscr.id}_{niv.id}_N": "12 000", f"t_{self.inscr.id}_{niv.id}_A": "",
                                                 f"t_{self.t1.id}_{niv.id}_N": "50000", f"t_{self.t1.id}_{niv.id}_A": "50000"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(Tarif.objects.get(rubrique=self.inscr, statut="N").montant, 12000)
        self.assertFalse(Tarif.objects.filter(rubrique=self.inscr, statut="A").exists())
        ex2 = Exercice.objects.create(libelle="2026-2027")
        ex2.activer()
        self.client.post(reverse("tarifs"), {"action": "reconduire"})
        self.assertEqual(Tarif.objects.filter(exercice=ex2).count(), 3)

    def test_reserve_a_l_administration(self):
        self.client.force_login(self.u_ens)
        for nom in ["caisse", "tarifs", "situation_financiere", "journal_encaissements"]:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 302)

    def test_filtre_ecolage_des_bulletins(self):
        self.payer(self.ins[0], self.t1, 30000)
        self.payer(self.ins[1], self.t1, 10000)
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": f"s{self.s1.pk}", "ecolage_min": "10000"})
        self.assertEqual([x.inscription_id for x in r.context["resultats"]], [self.ins[0].id])
        self.assertEqual(len(r.context["exclus_ecolage"]), 2)


class CaisseGeneraleTests(FinancesMixin, TestCase):
    def setUp(self):
        super().setUp()
        from .models import LibelleCaisse
        self.vente = LibelleCaisse.objects.create(libelle="Vente de tenues", sens="E")
        self.salaire = LibelleCaisse.objects.create(libelle="Salaires vacataires", sens="S")

    def mouvement(self, sens, libelle, montant, **extra):
        data = {"libelle": libelle.pk, "montant": montant, "tiers": "M. Tiers", "mode": "ESP", "reference": "",
                "date": timezone.localdate().isoformat(), "observation": "", **extra}
        return self.client.post(f"{reverse('caisse_generale')}?sens={sens}", data)

    def test_numerotation_separee_et_piece(self):
        from .models import MouvementCaisse
        self.mouvement("E", self.vente, 5000, matricule="M0")
        self.mouvement("E", self.vente, 3000)
        r = self.mouvement("S", self.salaire, 20000)
        self.assertEqual(sorted(MouvementCaisse.objects.values_list("sens", "numero")), [("E", 1), ("E", 2), ("S", 1)])
        self.assertEqual(MouvementCaisse.objects.get(montant=5000).inscription, self.ins[0])
        r = self.client.get(r.url)
        self.assertContains(r, "BON DE CAISSE (SORTIE) N° 1")
        self.assertContains(r, "Vingt mille francs CFA")

    def test_controles(self):
        from .models import MouvementCaisse
        self.assertEqual(self.mouvement("S", self.vente, 1000).status_code, 200)            # libellé d'entrée refusé en sortie
        self.assertEqual(self.mouvement("E", self.vente, 1000, matricule="INCONNU").status_code, 200)
        self.assertEqual(self.mouvement("E", self.vente, 1000, mode="OM").status_code, 200)  # référence obligatoire
        self.assertEqual(self.mouvement("E", self.vente, 0).status_code, 200)
        self.assertFalse(MouvementCaisse.objects.exists())

    def test_journal_de_caisse(self):
        from .models import MouvementCaisse
        self.payer(self.ins[0], self.inscr, 10000)
        self.mouvement("E", self.vente, 5000)
        self.mouvement("S", self.salaire, 3000)
        self.mouvement("E", self.vente, 999)
        MouvementCaisse.objects.get(montant=999).annuler(self.admin, "Erreur")
        r = self.client.get(reverse("journal_caisse"))
        self.assertEqual(r.context["totaux"], {"ecolage": 10000, "autres_entrees": 5000, "entrees": 15000, "sorties": 3000, "solde": 12000})
        self.assertEqual(r.context["lignes"][-1]["solde"], 12000)
        self.assertEqual(len(r.context["lignes"]), 3)

    def test_droits(self):
        from django.contrib.auth.models import Group, User
        from .models import MouvementCaisse
        caissier = User.objects.create_user("caisse2", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        self.client.force_login(caissier)
        self.mouvement("S", self.salaire, 2000)
        m = MouvementCaisse.objects.get()
        self.assertEqual(m.saisi_par, caissier)
        self.client.post(reverse("annuler_mouvement", args=[m.pk]), {"motif": "Erreur de montant"})
        m.refresh_from_db()
        self.assertTrue(m.annule)                                                            # sa propre opération du jour
        autre = MouvementCaisse.enregistrer(self.ex, libelle=self.vente, montant=100, tiers="X", saisi_par=self.admin)
        self.client.post(reverse("annuler_mouvement", args=[autre.pk]), {"motif": "x"})
        autre.refresh_from_db()
        self.assertFalse(autre.annule)
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.get(reverse("caisse_generale")).status_code, 302)
        self.assertEqual(self.client.get(reverse("journal_caisse")).status_code, 302)


class PlanFinancementTests(FinancesMixin, TestCase):
    def creer_plan(self, nombre=3, premiere=None, i=0):
        return self.client.post(reverse("compte_eleve", args=[self.ins[i].pk]), {
            "action": "plan", "pl-nombre": nombre, "pl-premiere_date": (premiere or timezone.localdate()).isoformat(), "pl-motif": "Difficultés"})

    def test_creation_repartit_le_reste(self):
        from .models import PlanFinancement
        self.payer(self.ins[0], self.inscr, 10000)                       # reste : 50 000
        self.creer_plan(3)
        plan = PlanFinancement.objects.get()
        self.assertEqual((plan.deja_verse, plan.motif), (10000, "Difficultés"))
        self.assertEqual([e.montant for e in plan.echeances.all()], [16500, 16500, 17000])
        self.assertEqual(sum(e.montant for e in plan.echeances.all()), 50000)
        self.creer_plan(2)                                                # pas de second plan
        self.assertEqual(PlanFinancement.objects.count(), 1)

    def test_situation_a_une_date(self):
        from datetime import date
        from .models import Echeance, PlanFinancement
        plan = PlanFinancement.objects.create(inscription=self.ins[0], deja_verse=10000)
        for d, m in [(date(2026, 1, 10), 20000), (date(2026, 2, 10), 20000), (date(2026, 3, 10), 10000)]:
            Echeance.objects.create(plan=plan, date=d, montant=m)
        # 25 000 versés au total (dont 15 000 depuis la création), au 15 février : 40 000 échus
        lignes, du, retard = plan.situation(25000, aujourd_hui=date(2026, 2, 15))
        self.assertEqual([l["etat"] for l in lignes], ["en retard", "en retard", "à venir"])
        self.assertEqual([l["couvert"] for l in lignes], [15000, 0, 0])
        self.assertEqual((du, retard), (40000, 25000))
        lignes, du, retard = plan.situation(25000, aujourd_hui=date(2026, 2, 10))   # échéance du jour : pas encore en retard
        self.assertEqual(retard, 5000)
        lignes, du, retard = plan.situation(60000, aujourd_hui=date(2026, 3, 20))
        self.assertEqual(([l["etat"] for l in lignes], retard), (["payée", "payée", "payée"], 0))

    def test_droits_et_liste(self):
        from datetime import timedelta
        from django.contrib.auth.models import Group, User
        from .models import PlanFinancement
        self.creer_plan(2, premiere=timezone.localdate() - timedelta(days=40))   # première échéance déjà passée
        self.creer_plan(2, premiere=timezone.localdate() + timedelta(days=10), i=1)
        r = self.client.get(reverse("plans_financement"), {"retard": "1"})
        self.assertEqual([l["ins"] for l in r.context["lignes"]], [self.ins[0]])
        caissier = User.objects.create_user("c3", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        self.client.force_login(caissier)
        self.assertEqual(self.client.get(reverse("plans_financement")).status_code, 200)
        PlanFinancement.objects.filter(inscription=self.ins[0]).delete()
        self.creer_plan(2)
        self.assertFalse(PlanFinancement.objects.filter(inscription=self.ins[0]).exists())   # réservé à l'administration
