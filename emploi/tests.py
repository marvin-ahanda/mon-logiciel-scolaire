from datetime import time

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from notes.tests import DonneesMixin
from scolarite.models import Attribution, Matiere

from .models import Cours, Creneau


class EmploiMixin(DonneesMixin):
    def setUp(self):
        super().setUp()
        self.c1 = Creneau.objects.create(ordre=1, heure_debut=time(7, 30), heure_fin=time(8, 25))
        self.c2 = Creneau.objects.create(ordre=2, heure_debut=time(8, 25), heure_fin=time(9, 20))
        self.pause = Creneau.objects.create(ordre=3, heure_debut=time(9, 20), heure_fin=time(9, 35), pause=True)
        # même professeur de maths dans l'autre classe
        self.maths_b = Attribution.objects.create(exercice=self.ex, classe=self.autre_classe, matiere=self.maths.matiere,
                                                  enseignant=self.ens, coefficient=4)
        self.svt_b = Attribution.objects.create(exercice=self.ex, classe=self.autre_classe, enseignant=self.ens2,
                                                matiere=Matiere.objects.create(code="SVT", libelle="SVT"), coefficient=2)

    def url(self, classe=None):
        return f"{reverse('emploi_classe')}?classe={(classe or self.classe).pk}"


class GrilleTests(EmploiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.admin)

    def test_enregistrement(self):
        r = self.client.post(self.url(), {f"c_1_{self.c1.id}": self.maths.id, f"s_1_{self.c1.id}": "Salle 3",
                                          f"c_1_{self.c2.id}": self.fr.id})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(Cours.objects.count(), 2)
        self.assertEqual(Cours.objects.get(creneau=self.c1).salle, "Salle 3")
        self.client.post(self.url(), {f"c_1_{self.c1.id}": self.maths.id})          # remplacement de la grille
        self.assertEqual(Cours.objects.count(), 1)

    def test_conflit_enseignant(self):
        Cours.objects.create(exercice=self.ex, classe=self.autre_classe, jour=2, creneau=self.c1, attribution=self.maths_b)
        r = self.client.post(self.url(), {f"c_2_{self.c1.id}": self.maths.id, f"c_1_{self.c1.id}": self.fr.id})
        self.assertEqual(r.status_code, 200)
        self.assertIn("a déjà cours en 6e B", str(r.content.decode()))
        self.assertEqual(Cours.objects.filter(classe=self.classe).count(), 0)       # tout ou rien

    def test_conflit_de_salle(self):
        Cours.objects.create(exercice=self.ex, classe=self.autre_classe, jour=1, creneau=self.c1, attribution=self.svt_b, salle="Labo")
        r = self.client.post(self.url(), {f"c_1_{self.c1.id}": self.fr.id, f"s_1_{self.c1.id}": "labo"})
        self.assertContains(r, "salle labo est déjà occupée")
        self.assertFalse(Cours.objects.filter(classe=self.classe).exists())

    def test_pause_et_matiere_d_une_autre_classe(self):
        self.client.post(self.url(), {f"c_1_{self.pause.id}": self.maths.id})
        self.assertFalse(Cours.objects.exists())
        r = self.client.post(self.url(), {f"c_1_{self.c1.id}": self.svt_b.id})      # matière de la 6e B
        self.assertContains(r, "matière inconnue pour cette classe")
        self.assertFalse(Cours.objects.exists())


class AccesEmploiTests(EmploiMixin, TestCase):
    def test_enseignant_voit_son_emploi_du_temps_sans_pouvoir_modifier(self):
        Cours.objects.create(exercice=self.ex, classe=self.classe, jour=1, creneau=self.c1, attribution=self.maths)
        Cours.objects.create(exercice=self.ex, classe=self.autre_classe, jour=2, creneau=self.c2, attribution=self.maths_b)
        self.client.force_login(self.u_ens)
        r = self.client.get(reverse("emploi_enseignant"))
        self.assertEqual(r.context["nb_heures"], 2)
        self.assertContains(r, "6e B")
        self.client.post(self.url(), {f"c_3_{self.c1.id}": self.maths.id})
        self.assertEqual(Cours.objects.count(), 2)
        self.assertEqual(self.client.get(self.url()).status_code, 200)               # consultation possible

    def test_caissier_sans_acces(self):
        c = User.objects.create_user("c", password="p")
        c.groups.add(Group.objects.get(name="Caisse"))
        self.client.force_login(c)
        self.assertEqual(self.client.get(reverse("emploi_classe")).status_code, 302)
