from datetime import date
from decimal import Decimal as D

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from notes.models import Note
from notes.services import periode_depuis_code
from notes.tests import DonneesMixin
from scolarite.models import Eleve, Inscription

from .services import age, comparaison_classes, effectifs_sexe_age, repartition, resume, statistiques_classe


class CalculsTests(TestCase):
    def test_resume(self):
        r = resume([D("8"), D("12"), D("15.5"), None])
        self.assertEqual((r["n"], r["moyenne"], r["min"], r["max"], r["reussite"], r["taux"]),
                         (3, D("11.83"), D("8"), D("15.5"), 2, D("66.67")))
        self.assertEqual(resume([])["n"], 0)

    def test_repartition_bornes(self):
        lignes = repartition({"M": [D("4.99"), D("5"), D("10")], "F": [D("20"), D("16")]})
        totaux = {l["libelle"]: (l["par_sexe"]["M"], l["par_sexe"]["F"], l["total"]) for l in lignes}
        self.assertEqual(totaux["[0 ; 5["], (1, 0, 1))
        self.assertEqual(totaux["[5 ; 8["], (1, 0, 1))
        self.assertEqual(totaux["[10 ; 12["], (1, 0, 1))
        self.assertEqual(totaux["[16 ; 20]"], (0, 2, 2))                          # 20/20 inclus
        self.assertEqual(sum(l["total"] for l in lignes), 5)

    def test_age_avant_et_apres_anniversaire(self):
        ref = date(2026, 1, 1)
        self.assertEqual(age(date(2014, 1, 1), ref), 12)
        self.assertEqual(age(date(2014, 1, 2), ref), 11)


class StatistiquesMixin(DonneesMixin):
    def setUp(self):
        super().setUp()
        self.ins[0].eleve.sexe = "M"
        self.ins[0].eleve.save()
        for ins, m, f in [(self.ins[0], "14", "12"), (self.ins[1], "6", "8"), (self.ins[2], "11", None)]:
            Note.objects.create(inscription=ins, attribution=self.maths, sequence=self.s1, valeur=D(m))
            if f:
                Note.objects.create(inscription=ins, attribution=self.fr, sequence=self.s1, valeur=D(f))
        self.periode = periode_depuis_code(self.ex, f"s{self.s1.pk}")


class ServicesTests(StatistiquesMixin, TestCase):
    def test_statistiques_classe(self):
        s = statistiques_classe(self.classe, self.ex, self.periode)
        # moyennes : (14*4+12*3)/7 = 13,14 ; (6*4+8*3)/7 = 6,86 ; 11
        self.assertEqual(s["global"]["n"], 3)
        self.assertEqual(s["global"]["reussite"], 2)
        self.assertEqual(s["par_sexe"]["M"]["moyenne"], D("13.14"))
        self.assertEqual(s["par_sexe"]["F"]["n"], 2)
        maths, fr = sorted(s["matieres"], key=lambda m: m["attribution"].matiere.code)[::-1]
        self.assertEqual((maths["tous"]["n"], maths["tous"]["moyenne"], maths["tous"]["taux"]), (3, D("10.33"), D("66.67")))
        self.assertEqual((fr["tous"]["n"], fr["par_sexe"]["F"]["moyenne"]), (2, D("8")))
        self.assertEqual({l["libelle"]: l["total"] for l in s["repartition"]}["[5 ; 8["], 1)

    def test_comparaison(self):
        Inscription.objects.create(eleve=Eleve.objects.create(matricule="B1", nom="B", sexe="M"), classe=self.autre_classe, exercice=self.ex)
        lignes, niveaux, etab = comparaison_classes(self.ex, self.periode)
        self.assertEqual([(l["classe"].libelle, l["effectif"], l["n"]) for l in lignes], [("6e A", 3, 3), ("6e B", 1, 0)])
        self.assertEqual((len(niveaux), niveaux[0]["n"], etab["n"]), (1, 3, 3))

    def test_effectifs_sexe_age(self):
        for ins, naissance in zip(self.ins, [date(2014, 3, 1), date(2014, 6, 1), None]):
            ins.eleve.date_naissance = naissance
            ins.eleve.save()
        ref, colonnes, lignes, totaux = effectifs_sexe_age(self.ex)
        self.assertEqual(ref, date(2026, 1, 1))
        self.assertEqual(colonnes, [11, "inconnu"])
        self.assertEqual(lignes[0]["cellules"], [(1, 1), (0, 1)])
        self.assertEqual((lignes[0]["garcons"], lignes[0]["filles"]), (1, 2))
        self.assertEqual(totaux, [(1, 1), (0, 1)])
        self.ins[2].eleve.date_naissance = date(2015, 2, 1)
        self.ins[2].eleve.save()
        self.assertEqual(effectifs_sexe_age(self.ex)[1], [10, 11])                 # plus de colonne « inconnu »


class VuesStatistiquesTests(StatistiquesMixin, TestCase):
    def test_pages_administration(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("stats_classe"), {"classe": self.classe.pk, "periode": self.periode.code})
        self.assertContains(r, "Répartition des moyennes")
        self.assertContains(r, "Mathématiques")
        r = self.client.get(reverse("stats_comparaison"), {"periode": self.periode.code})
        self.assertContains(r, "6e A")
        self.assertEqual(r.context["lignes"][0]["largeur"], 51.6)                   # moyenne 10,33 sur une échelle de 0 à 20
        self.assertContains(self.client.get(reverse("stats_effectifs")), "Âge inconnu")

    def test_periode_inconnue(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(reverse("stats_classe"), {"classe": self.classe.pk, "periode": "zz"}).status_code, 404)

    def test_reserve_a_l_administration(self):
        caissier = User.objects.create_user("c", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        for u in (caissier, self.u_ens):
            self.client.force_login(u)
            for nom in ("stats_classe", "stats_comparaison", "stats_effectifs"):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 302)
