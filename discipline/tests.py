from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from django.urls import reverse

from notes.models import BaremeDistinction, Note
from notes.services import periode_depuis_code, resultats_periode
from notes.tests import DonneesMixin

from .calculs import calculer_bilans
from .models import Absence, Incident, Infraction, ParametresDiscipline, Retard, Sanction


class CalculBilanTests(TestCase):
    def test_formule(self):
        bilans = calculer_bilans(
            [1, 2, 3],
            absences=[(1, 4, 2), (1, 2, 0)],                 # élève 1 : 6 h NJ, 2 h J
            retards=[1, 1, 1, 2],                            # élève 1 : 3 retards, élève 2 : 1
            incidents=[(1, "Bavardage (03/10)", D("2")), (2, "Fraude (05/10)", D("25"))],
            note_max=D("20"), points_par_retard=D("0.5"), points_par_heure=D("0.25"))
        b1, b2, b3 = bilans[1], bilans[2], bilans[3]
        self.assertEqual((b1.heures_non_justifiees, b1.heures_justifiees, b1.retards), (6, 2, 3))
        # 20 − (3 × 0,5 + 6 × 0,25 + 2) = 20 − 5 = 15
        self.assertEqual((b1.points_ponctualite, b1.points_assiduite, b1.points_autres_cas), (D("1.50"), D("1.50"), D("2.00")))
        self.assertEqual(b1.note, D("15.00"))
        self.assertEqual(b1.appreciation, "Bien")
        self.assertEqual(b2.note, D("0.00"))                 # jamais négative
        self.assertEqual(b3.note, D("20.00"))                # élève sans incident


class AppelTests(DonneesMixin, TestCase):
    def url(self, jour=date(2025, 10, 6), seq=None):
        return f"{reverse('appel')}?classe={self.classe.pk}&sequence={(seq or self.s1).pk}&date={jour:%Y-%m-%d}"

    def test_reserve_a_l_administration(self):
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.get(self.url()).status_code, 302)

    def test_saisie_puis_effacement(self):
        self.client.force_login(self.admin)
        e0, e1 = self.ins[0].id, self.ins[1].id
        self.client.post(self.url(), {f"nj_{e0}": "2", f"j_{e0}": "1", f"motif_{e0}": "Malade", f"retard_{e1}": "on"})
        a = Absence.objects.get()
        self.assertEqual((a.inscription_id, a.heures_non_justifiees, a.heures_justifiees, a.motif), (e0, 2, 1, "Malade"))
        self.assertEqual(list(Retard.objects.values_list("inscription_id", flat=True)), [e1])
        self.client.post(self.url(), {})                     # tout le monde présent et à l'heure
        self.assertFalse(Absence.objects.exists() or Retard.objects.exists())

    def test_valeur_invalide(self):
        self.client.force_login(self.admin)
        for mauvaise in ["-1", "25", "1.5", "abc"]:
            with self.subTest(valeur=mauvaise):
                r = self.client.post(self.url(), {f"nj_{self.ins[0].id}": mauvaise, f"retard_{self.ins[1].id}": "on"})
                self.assertEqual(r.status_code, 200)
                self.assertFalse(Absence.objects.exists() or Retard.objects.exists())

    def test_sequence_verrouillee(self):
        self.s1.verrouillee = True
        self.s1.save()
        self.client.force_login(self.admin)
        self.client.post(self.url(), {f"nj_{self.ins[0].id}": "3"})
        self.assertFalse(Absence.objects.exists())


class IncidentTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.inf = Infraction.objects.create(libelle="Bavardage", sanction=Sanction.objects.create(libelle="Avertissement oral", points_perdus=D("1")))
        self.url = f"{reverse('incidents')}?classe={self.classe.pk}&sequence={self.s1.pk}"

    def test_ajout_et_suppression(self):
        self.client.force_login(self.admin)
        self.client.post(self.url, {"inscription": self.ins[0].id, "date": "2025-10-07", "infraction": self.inf.id})
        inc = Incident.objects.get()
        self.assertEqual((inc.sequence, inc.saisi_par), (self.s1, self.admin))
        r = self.client.post(reverse("incident_supprimer", args=[inc.pk]), {"retour": self.url})
        self.assertRedirects(r, self.url, fetch_redirect_response=False)
        self.assertFalse(Incident.objects.exists())

    def test_eleve_d_une_autre_classe_refuse(self):
        from scolarite.models import Eleve, Inscription
        autre = Inscription.objects.create(eleve=Eleve.objects.create(matricule="X1", nom="Ailleurs", sexe="M"),
                                           classe=self.autre_classe, exercice=self.ex)
        self.client.force_login(self.admin)
        self.client.post(self.url, {"inscription": autre.id, "date": "2025-10-07", "infraction": self.inf.id})
        self.assertFalse(Incident.objects.exists())

    def test_pas_de_redirection_externe(self):
        inc = Incident.objects.create(inscription=self.ins[0], sequence=self.s1, date=date(2025, 10, 7), infraction=self.inf)
        self.client.force_login(self.admin)
        r = self.client.post(reverse("incident_supprimer", args=[inc.pk]), {"retour": "https://exemple-malveillant.test/"})
        self.assertEqual(r.url, reverse("incidents"))


class DisciplineEtDistinctionsTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        ParametresDiscipline.objects.create(exercice=self.ex, points_par_retard=D("1"), points_par_heure_absence=D("0.5"))
        for ins in self.ins[:2]:
            Note.objects.create(inscription=ins, attribution=self.maths, sequence=self.s1, valeur=D("13"))
        # Élève 1 : 6 h non justifiées -> conduite 20 − 3 = 17 ; élève 0 : conduite 20
        Absence.objects.create(inscription=self.ins[1], sequence=self.s1, date=date(2025, 10, 6), heures_non_justifiees=6)
        BaremeDistinction.objects.create(exercice=self.ex, type="TH", borne_inf=D("12"), borne_sup=D("14"), conduite_min=D("18"))

    def test_condition_de_conduite(self):
        res, *_ = resultats_periode(self.classe, self.ex, periode_depuis_code(self.ex, f"s{self.s1.pk}"))
        par_eleve = {r.inscription_id: r for r in res}
        self.assertEqual(par_eleve[self.ins[0].id].distinctions, ["Tableau d'honneur"])   # conduite 20 > 18
        self.assertEqual(par_eleve[self.ins[1].id].distinctions, [])                      # conduite 17, pas > 18
        self.assertEqual(par_eleve[self.ins[1].id].discipline.note, D("17.00"))

    def test_trimestre_cumule_les_sequences(self):
        s2 = self.ex.sequences.get(numero=2)
        Retard.objects.create(inscription=self.ins[1], sequence=s2, date=date(2025, 11, 3))
        res, *_ = resultats_periode(self.classe, self.ex, periode_depuis_code(self.ex, "t1"))
        b = next(r for r in res if r.inscription_id == self.ins[1].id).discipline
        self.assertEqual((b.heures_non_justifiees, b.retards, b.note), (6, 1, D("16.00")))

    def test_bulletin_affiche_la_discipline(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": f"s{self.s1.pk}", "eleve": self.ins[1].id})
        self.assertContains(r, "Note de discipline")
        self.assertContains(r, "17,00 / 20")

    def test_suivi(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("suivi_discipline"), {"classe": self.classe.pk, "periode": "a"})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "17,00")

    def test_bareme_conduite_refuse_pour_le_blame(self):
        from django.core.exceptions import ValidationError
        b = BaremeDistinction(exercice=self.ex, type="BLA", borne_sup=D("8"), conduite_min=D("10"))
        with self.assertRaises(ValidationError):
            b.clean()
