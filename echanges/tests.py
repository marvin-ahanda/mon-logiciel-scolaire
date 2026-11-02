from decimal import Decimal as D
from io import BytesIO

from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from openpyxl import Workbook, load_workbook

from notes.models import Note
from notes.tests import DonneesMixin
from scolarite.models import Eleve, Enseignant, Inscription

from .excel import sur

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def xlsx(lignes, nom="import.xlsx"):
    wb = Workbook()
    for l in lignes:
        wb.active.append(l)
    t = BytesIO()
    wb.save(t)
    return SimpleUploadedFile(nom, t.getvalue(), content_type=XLSX)


def lire_reponse(r):
    return [list(l) for l in load_workbook(BytesIO(r.content)).worksheets[0].iter_rows(values_only=True)]


ENTETES = ["Matricule", "Nom", "Prénom", "Sexe", "Date de naissance", "Classe", "Statut"]


class ExportTests(DonneesMixin, TestCase):
    def test_formules_neutralisees(self):
        self.assertEqual(sur("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")")
        self.assertEqual(sur("+237 600"), "'+237 600")
        self.assertEqual(sur("NGONO"), "NGONO")
        e = self.ins[0].eleve
        e.nom = "=1+1"
        e.save()
        self.client.force_login(self.admin)
        lignes = lire_reponse(self.client.get(reverse("export_eleves")))
        self.assertIn("'=1+1", [l[1] for l in lignes])           # texte, pas formule

    def test_export_eleves(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("export_eleves"), {"classe": self.classe.pk})
        self.assertEqual(r["Content-Type"], XLSX)
        self.assertIn("attachment", r["Content-Disposition"])
        lignes = lire_reponse(r)
        self.assertEqual(lignes[0][:3], ["Matricule", "Nom", "Prénom"])
        self.assertEqual(len(lignes), 1 + 3)

    def test_export_resultats_droits(self):
        Note.objects.create(inscription=self.ins[0], attribution=self.maths, sequence=self.s1, valeur=D("15"))
        params = {"classe": self.classe.pk, "periode": f"s{self.s1.pk}"}
        self.client.force_login(self.u_ens)                       # enseignant de la classe
        lignes = lire_reponse(self.client.get(reverse("export_resultats"), params))
        self.assertEqual(lignes[1][:3], [1, "M0", "Eleve0"])
        u = User.objects.create_user("x", password="p")
        Enseignant.objects.create(matricule="EX", nom="X", utilisateur=u)
        self.client.force_login(u)
        self.assertEqual(self.client.get(reverse("export_resultats"), params).status_code, 403)

    def test_exports_finances_reserves(self):
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.get(reverse("export_journal")).status_code, 302)
        caissier = User.objects.create_user("c", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        self.client.force_login(caissier)
        self.assertEqual(self.client.get(reverse("export_journal"))["Content-Type"], XLSX)
        self.assertEqual(self.client.get(reverse("export_situation"), {"classe": self.classe.pk})["Content-Type"], XLSX)
        self.assertEqual(self.client.get(reverse("export_eleves")).status_code, 302)


class ImportElevesTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.admin)

    def envoyer(self, lignes):
        return self.client.post(reverse("import_eleves"), {"fichier": xlsx(lignes)})

    def test_modele_puis_import_complet(self):
        modele = lire_reponse(self.client.get(reverse("modele_eleves")))
        self.assertEqual(modele[0][0], "Matricule")
        r = self.envoyer([ENTETES, ["N001", "NGONO", "Marie", "F", "14/02/2013", "6e A", "Nouveau"],
                          [1002, "ESSOMBA", "Paul", "masculin", None, "6E b", "ancien"]])   # matricule numérique, casse libre
        self.assertEqual(r.context["erreurs"], 0)
        self.assertFalse(Eleve.objects.filter(matricule="N001").exists())                   # rien avant confirmation
        self.client.post(reverse("import_eleves"), {"action": "confirmer"})
        marie = Eleve.objects.get(matricule="N001")
        self.assertEqual((marie.sexe, str(marie.date_naissance)), ("F", "2013-02-14"))
        paul = Inscription.objects.get(eleve__matricule="1002", exercice=self.ex)
        self.assertEqual((paul.classe, paul.statut), (self.autre_classe, "A"))

    def test_mise_a_jour_d_un_eleve_existant(self):
        self.envoyer([ENTETES, ["M0", "NOUVEAU-NOM", "", "F", "", "6e A", ""]])
        self.client.post(reverse("import_eleves"), {"action": "confirmer"})
        self.assertEqual(Eleve.objects.get(matricule="M0").nom, "NOUVEAU-NOM")
        self.assertEqual(Eleve.objects.filter(matricule="M0").count(), 1)

    def test_erreurs_bloquent_tout(self):
        r = self.envoyer([ENTETES, ["OK1", "BON", "", "F", "", "6e A", ""],
                          ["X1", "", "", "Z", "31/31/2013", "Terminale Z", "bizarre"], ["OK1", "DOUBLON", "", "M", "", "6e A", ""]])
        self.assertEqual(r.context["erreurs"], 2)
        erreurs = " ".join(" ".join(l["erreurs"]) for l in r.context["apercu"])
        for attendu in ["nom manquant", "sexe attendu", "date", "classe « Terminale Z » inconnue", "statut", "en double"]:
            self.assertIn(attendu, erreurs)
        self.client.post(reverse("import_eleves"), {"action": "confirmer"})
        self.assertFalse(Eleve.objects.filter(matricule="OK1").exists())

    def test_changement_de_classe_refuse_si_notes(self):
        Note.objects.create(inscription=self.ins[0], attribution=self.maths, sequence=self.s1, valeur=D("12"))
        r = self.envoyer([ENTETES, ["M0", "Eleve0", "", "F", "", "6e B", ""]])
        self.assertEqual(r.context["erreurs"], 1)

    def test_effectif_maximal(self):
        self.autre_classe.effectif_max = 1
        self.autre_classe.save()
        r = self.envoyer([ENTETES, ["A1", "UN", "", "F", "", "6e B", ""], ["A2", "DEUX", "", "F", "", "6e B", ""]])
        self.assertEqual(r.context["erreurs"], 1)

    def test_faux_fichier_et_colonnes_manquantes(self):
        faux = SimpleUploadedFile("eleves.xlsx", b"matricule;nom\nA;B", content_type=XLSX)
        r = self.client.post(reverse("import_eleves"), {"fichier": faux}, follow=True)
        self.assertContains(r, "n&#x27;est pas un classeur Excel")
        r = self.envoyer([["Matricule", "Nom"], ["A", "B"]])
        self.assertContains(r, "Colonnes obligatoires absentes")

    def test_reserve_a_l_administration(self):
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.get(reverse("import_eleves")).status_code, 302)


class ImportNotesTests(DonneesMixin, TestCase):
    def url(self, a=None):
        return f"{reverse('import_notes')}?attribution={(a or self.maths).pk}&sequence={self.s1.pk}"

    def test_parcours_enseignant(self):
        Note.objects.create(inscription=self.ins[2], attribution=self.maths, sequence=self.s1, valeur=D("7"))
        self.client.force_login(self.u_ens)
        liste = lire_reponse(self.client.get(f"{reverse('modele_notes')}?attribution={self.maths.pk}&sequence={self.s1.pk}"))
        self.assertEqual([l[0] for l in liste[1:]], ["M0", "M1", "M2"])
        r = self.client.post(self.url(), {"fichier": xlsx([["Matricule", "Élève", "Note"], ["M0", "", "12,5"], ["M1", "", 17], ["M2", "", None]])})
        self.assertEqual((r.context["erreurs"], r.context["changements"]), (0, 2))
        self.client.post(self.url(), {"action": "confirmer"})
        notes = {n.inscription_id: n.valeur for n in Note.objects.filter(attribution=self.maths, sequence=self.s1)}
        self.assertEqual(notes, {self.ins[0].id: D("12.50"), self.ins[1].id: D("17.00"), self.ins[2].id: D("7.00")})   # vide = inchangée

    def test_erreurs(self):
        self.client.force_login(self.u_ens)
        r = self.client.post(self.url(), {"fichier": xlsx([["Matricule", "Note"], ["M0", 21], ["INCONNU", 10], ["M1", "abc"]])})
        self.assertEqual(r.context["erreurs"], 3)
        self.client.post(self.url(), {"action": "confirmer"})
        self.assertFalse(Note.objects.exists())

    def test_autre_matiere_et_sequence_verrouillee(self):
        self.client.force_login(self.u_ens)
        self.assertEqual(self.client.post(self.url(self.fr), {"fichier": xlsx([["Matricule", "Note"], ["M0", 10]])}).status_code, 403)
        self.s1.verrouillee = True
        self.s1.save()
        self.client.post(self.url(), {"fichier": xlsx([["Matricule", "Note"], ["M0", 10]])})
        self.client.post(self.url(), {"action": "confirmer"})
        self.assertFalse(Note.objects.exists())
