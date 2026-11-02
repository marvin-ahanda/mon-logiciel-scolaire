from decimal import Decimal as D
from types import SimpleNamespace

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from scolarite.models import Attribution, Classe, Cycle, Eleve, Enseignant, Exercice, Inscription, Matiere, Niveau

from .calculs import appreciation, calculer_sequence, competence, rangs
from .models import BaremeDistinction, Note


class AppreciationTests(TestCase):
    """Seuils relevés dans le logiciel d'origine (fonction 0x97aef0)."""

    def test_bornes(self):
        cas = [("0", "Nul"), ("2.99", "Nul"), ("3", "Très faible"), ("4.49", "Très faible"), ("4.5", "Faible"),
               ("7.49", "Faible"), ("7.5", "Insuffisant"), ("8.99", "Insuffisant"), ("9", "Médiocre"),
               ("9.99", "Médiocre"), ("10", "Passable"), ("11.99", "Passable"), ("12", "Assez bien"),
               ("13.99", "Assez bien"), ("14", "Bien"), ("15.99", "Bien"), ("16", "Très bien"),
               ("17.99", "Très bien"), ("18", "Excellent"), ("20", "Excellent")]
        for valeur, attendu in cas:
            with self.subTest(valeur=valeur):
                self.assertEqual(appreciation(D(valeur)), attendu)

    def test_absente(self):
        self.assertEqual(appreciation(None), "")


class CompetenceTests(TestCase):
    """Seuils de l'original (fonction 0x98e460) : [0;10] ]10;14] ]14;17] ]17;20]."""

    def test_bornes(self):
        cas = [("0", "Non acquis"), ("10", "Non acquis"), ("10.01", "En cours d'acquisition"),
               ("14", "En cours d'acquisition"), ("14.01", "Acquis"), ("17", "Acquis"),
               ("17.01", "Expert"), ("20", "Expert")]
        for valeur, attendu in cas:
            with self.subTest(valeur=valeur):
                self.assertEqual(competence(D(valeur)), attendu)


class RangTests(TestCase):
    def test_ex_aequo_et_absents(self):
        self.assertEqual(rangs([D(12), D(15), None, D(12), D(8)]),
                         [(2, True), (1, False), (None, False), (2, True), (4, False)])


def attr(id, coef, groupe=1, matiere="M"):
    return SimpleNamespace(id=id, matiere=f"{matiere}{id}", enseignant="", coefficient=coef, groupe=groupe)


class CalculSequenceTests(TestCase):
    def test_moyenne_ponderee_et_non_evalue(self):
        attributions = [attr(1, 4), attr(2, 2), attr(3, 1, groupe=2)]
        notes = {(10, 1): D("12"), (10, 2): D("15"), (10, 3): D("8"),
                 (11, 1): D("10")}                     # élève 11 non évalué en 2 et 3
        res, stats = calculer_sequence([(10, "A"), (11, "B"), (12, "C")], attributions, notes)
        a, b, c = res
        # A : (12*4 + 15*2 + 8*1) / 7 = 86/7 = 12.2857 -> 12.29
        self.assertEqual(a.moyenne, D("12.29"))
        self.assertEqual((a.total_coefficients, a.total_points), (7, D("86")))
        self.assertEqual([g.moyenne for g in a.groupes], [D("13.00"), D("8.00")])
        # B : seule la matière évaluée compte -> 10
        self.assertEqual(b.moyenne, D("10.00"))
        self.assertEqual(b.total_coefficients, 4)
        # C : aucune note -> non classé
        self.assertIsNone(c.moyenne)
        self.assertIsNone(c.rang)
        self.assertEqual((a.rang, b.rang), (1, 2))
        self.assertEqual(stats.effectif, 3)
        self.assertEqual(stats.effectif_classe, 2)
        self.assertEqual(stats.moyenne_classe, D("11.15"))     # (12.29 + 10) / 2 = 11.145 -> 11.15
        self.assertEqual(stats.taux_reussite, D("100.00"))

    def test_rang_par_matiere(self):
        res, _ = calculer_sequence([(1, "A"), (2, "B"), (3, "C")], [attr(1, 1)],
                                   {(1, 1): D("14"), (2, 1): D("14"), (3, 1): D("9")})
        self.assertEqual([(r.lignes[0].rang, r.lignes[0].ex_aequo) for r in res], [(1, True), (1, True), (3, False)])

    def test_distinctions(self):
        baremes = [BaremeDistinction(type="TH", borne_inf=D("12"), borne_sup=D("14")),
                   BaremeDistinction(type="BLA", borne_sup=D("8"))]
        res, _ = calculer_sequence([(1, "A"), (2, "B"), (3, "C")], [attr(1, 1)],
                                   {(1, 1): D("12"), (2, 1): D("14"), (3, 1): D("7.99")}, baremes)
        self.assertEqual([r.distinctions for r in res], [["Tableau d'honneur"], [], ["Blâme travail"]])


class DonneesMixin:
    def setUp(self):
        self.ex = Exercice.objects.create(libelle="2025-2026", actif=True)
        self.s1 = self.ex.sequences.get(numero=1)
        niveau = Niveau.objects.create(libelle="6e", cycle=Cycle.objects.create(libelle="1er cycle"))
        self.classe = Classe.objects.create(libelle="6e A", niveau=niveau)
        self.autre_classe = Classe.objects.create(libelle="6e B", niveau=niveau)
        self.admin = User.objects.create_user("admin", password="Mot2Passe!x", is_staff=True)
        self.admin.groups.add(Group.objects.get(name="Administration"))
        self.u_ens = User.objects.create_user("prof", password="Mot2Passe!x")
        self.u_autre = User.objects.create_user("autre", password="Mot2Passe!x")
        self.ens = Enseignant.objects.create(matricule="E1", nom="Prof", utilisateur=self.u_ens)
        self.ens2 = Enseignant.objects.create(matricule="E2", nom="Autre", utilisateur=self.u_autre)
        self.maths = Attribution.objects.create(exercice=self.ex, classe=self.classe, enseignant=self.ens,
                                                matiere=Matiere.objects.create(code="MATH", libelle="Mathématiques"), coefficient=4)
        self.fr = Attribution.objects.create(exercice=self.ex, classe=self.classe, enseignant=self.ens2,
                                             matiere=Matiere.objects.create(code="FR", libelle="Français"), coefficient=3)
        self.ins = [Inscription.objects.create(eleve=Eleve.objects.create(matricule=f"M{i}", nom=f"Eleve{i}", sexe="F"),
                                               classe=self.classe, exercice=self.ex) for i in range(3)]

    def url_saisie(self, a=None, s=None):
        return f"{reverse('saisie')}?attribution={(a or self.maths).pk}&sequence={(s or self.s1).pk}"


class ExerciceTests(DonneesMixin, TestCase):
    def test_six_sequences_creees(self):
        self.assertEqual(list(self.ex.sequences.values_list("numero", "trimestre")),
                         [(1, 1), (2, 1), (3, 2), (4, 2), (5, 3), (6, 3)])

    def test_un_seul_exercice_actif(self):
        ex2 = Exercice.objects.create(libelle="2026-2027")
        ex2.activer()
        self.ex.refresh_from_db()
        self.assertFalse(self.ex.actif)
        self.assertEqual(Exercice.actif_courant(), ex2)


class SaisieTests(DonneesMixin, TestCase):
    def test_connexion_requise(self):
        r = self.client.get(reverse("saisie"))
        self.assertEqual(r.status_code, 302)
        self.assertIn(reverse("login"), r.url)

    def test_enseignant_saisit_ses_notes(self):
        self.client.force_login(self.u_ens)
        data = {f"note_{self.ins[0].id}": "12,5", f"note_{self.ins[1].id}": "18", f"note_{self.ins[2].id}": ""}
        r = self.client.post(self.url_saisie(), data)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(sorted(Note.objects.values_list("valeur", flat=True)), [D("12.50"), D("18.00")])

    def test_modification_et_effacement(self):
        Note.objects.create(inscription=self.ins[0], attribution=self.maths, sequence=self.s1, valeur=D("10"))
        self.client.force_login(self.u_ens)
        self.client.post(self.url_saisie(), {f"note_{self.ins[0].id}": "11", f"note_{self.ins[1].id}": "",
                                             f"note_{self.ins[2].id}": ""})
        self.assertEqual(Note.objects.get().valeur, D("11.00"))
        self.client.post(self.url_saisie(), {f"note_{i.id}": "" for i in self.ins})
        self.assertFalse(Note.objects.exists())

    def test_enseignant_ne_peut_pas_saisir_une_autre_matiere(self):
        self.client.force_login(self.u_ens)
        r = self.client.post(self.url_saisie(a=self.fr), {f"note_{self.ins[0].id}": "15"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Note.objects.exists())

    def test_note_invalide_rien_enregistre(self):
        self.client.force_login(self.u_ens)
        for mauvaise in ["21", "-1", "abc", "12.555", "NaN", "Infinity"]:
            with self.subTest(valeur=mauvaise):
                r = self.client.post(self.url_saisie(), {f"note_{self.ins[0].id}": "14", f"note_{self.ins[1].id}": mauvaise})
                self.assertEqual(r.status_code, 200)
                self.assertFalse(Note.objects.exists())

    def test_sequence_verrouillee(self):
        self.s1.verrouillee = True
        self.s1.save()
        self.client.force_login(self.admin)
        self.client.post(self.url_saisie(), {f"note_{self.ins[0].id}": "14"})
        self.assertFalse(Note.objects.exists())

    def test_admin_peut_tout_saisir(self):
        self.client.force_login(self.admin)
        self.client.post(self.url_saisie(a=self.fr), {f"note_{self.ins[0].id}": "15"})
        self.assertEqual(Note.objects.count(), 1)


class ResultatsBulletinsTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        for ins, m, f in zip(self.ins, ["16", "9", None], ["14", "11", None]):
            if m:
                Note.objects.create(inscription=ins, attribution=self.maths, sequence=self.s1, valeur=D(m))
                Note.objects.create(inscription=ins, attribution=self.fr, sequence=self.s1, valeur=D(f))

    def test_resultats_classement(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("resultats"), {"classe": self.classe.pk, "sequence": self.s1.pk})
        self.assertEqual(r.status_code, 200)
        classement = r.context["classement"]
        # Eleve0 : (16*4 + 14*3)/7 = 15.14 ; Eleve1 : (9*4 + 11*3)/7 = 9.86 ; Eleve2 : non classé
        self.assertEqual([(str(c.eleve), c.moyenne, c.rang) for c in classement],
                         [("Eleve0", D("15.14"), 1), ("Eleve1", D("9.86"), 2), ("Eleve2", None, None)])

    def test_bulletin_eleve(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "sequence": self.s1.pk, "eleve": self.ins[0].id})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "BULLETIN DE NOTES SÉQUENTIEL")
        self.assertContains(r, "15,14")  # format français
        self.assertContains(r, "Bien")
        self.assertEqual(len(r.context["resultats"]), 1)

    def test_enseignant_hors_classe_refuse(self):
        u = User.objects.create_user("x", password="Mot2Passe!x")
        Enseignant.objects.create(matricule="E3", nom="X", utilisateur=u)
        self.client.force_login(u)
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "sequence": self.s1.pk})
        self.assertEqual(r.status_code, 403)


class AccesAdministrationTests(DonneesMixin, TestCase):
    def test_pages_admin_refusees_aux_enseignants(self):
        self.client.force_login(self.u_ens)
        for nom in ["exercices", "classes", "matieres", "enseignants", "eleves", "sequences"]:
            with self.subTest(page=nom):
                self.assertIn(self.client.get(reverse(nom)).status_code, (302, 403))

    def test_pages_admin_accessibles(self):
        self.client.force_login(self.admin)
        for nom in ["accueil", "exercices", "classes", "matieres", "enseignants", "eleves", "sequences"]:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 200)

    def test_changement_de_classe_bloque_si_notes(self):
        Note.objects.create(inscription=self.ins[0], attribution=self.maths, sequence=self.s1, valeur=D("10"))
        self.client.force_login(self.admin)
        e = self.ins[0].eleve
        r = self.client.post(reverse("eleve_modifier", args=[e.pk]),
                             {"matricule": e.matricule, "nom": e.nom, "sexe": "F", "classe": self.autre_classe.pk})
        self.assertEqual(r.status_code, 200)
        self.ins[0].refresh_from_db()
        self.assertEqual(self.ins[0].classe, self.classe)

    def test_creation_eleve_avec_inscription(self):
        self.client.force_login(self.admin)
        self.client.post(reverse("eleve_creer"), {"matricule": "N1", "nom": "Nouveau", "sexe": "M", "classe": self.classe.pk})
        self.assertTrue(Inscription.objects.filter(eleve__matricule="N1", classe=self.classe, exercice=self.ex).exists())

    def test_creation_enseignant_avec_compte(self):
        self.client.force_login(self.admin)
        r = self.client.post(reverse("enseignant_creer"), {"matricule": "E9", "nom": "Ngono", "prenom": "Ange", "acces": "on"}, follow=True)
        u = User.objects.get(username="ange.ngono")
        self.assertTrue(u.check_password(r.context["code"]))                          # code généré, affiché une fois
        self.assertEqual(u.enseignant.matricule, "E9")
        self.client.post(reverse("enseignant_creer"), {"matricule": "E10", "nom": "Sans", "prenom": "Acces"})
        self.assertIsNone(Enseignant.objects.get(matricule="E10").utilisateur)       # case décochée : pas d'accès


class PeriodesCalculTests(TestCase):
    def test_moyenne_simple_et_notes_composees(self):
        from .calculs import moyenne_simple, notes_composees
        self.assertEqual(moyenne_simple([D("12"), None, D("15")]), D("13.50"))
        self.assertIsNone(moyenne_simple([None, None]))
        self.assertEqual(notes_composees({(1, 1): [D("10"), D("11")], (1, 2): [None, None]}), {(1, 1): D("10.50")})

    def test_seuil_de_classement(self):
        attributions = [attr(1, 4), attr(2, 2)]
        notes = {(1, 1): D("12"), (1, 2): D("14"), (2, 2): D("18")}   # élève 2 : seulement 2 coefficients évalués
        res, stats = calculer_sequence([(1, "A"), (2, "B")], attributions, notes, coef_min=4)
        a, b = res
        self.assertEqual((a.moyenne, a.rang), (D("12.67"), 1))
        self.assertIsNone(b.moyenne)
        self.assertEqual(b.moyenne_non_classee, D("18.00"))
        self.assertIsNone(b.rang)
        self.assertEqual(stats.effectif_classe, 1)


class TrimestreAnneeTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        seq = {s.numero: s for s in self.ex.sequences.all()}
        e0 = self.ins[0]
        # Maths : T1 = (10+12)/2 = 11 ; T2 = 14 (seule S3) ; T3 = (16+18)/2 = 17 -> annuel (11+14+17)/3 = 14
        for n, v in [(1, "10"), (2, "12"), (3, "14"), (5, "16"), (6, "18")]:
            Note.objects.create(inscription=e0, attribution=self.maths, sequence=seq[n], valeur=D(v))
        # Français : T1 = 8 (seule S1), rien ensuite -> annuel 8
        Note.objects.create(inscription=e0, attribution=self.fr, sequence=seq[1], valeur=D("8"))
        # Élève 1 : maths 9 aux six séquences
        for n in range(1, 7):
            Note.objects.create(inscription=self.ins[1], attribution=self.maths, sequence=seq[n], valeur=D("9"))

    def resultats(self, code):
        from .services import periode_depuis_code, resultats_periode
        return resultats_periode(self.classe, self.ex, periode_depuis_code(self.ex, code))

    def test_trimestre_1(self):
        res, stats, _, entetes = self.resultats("t1")
        self.assertEqual(entetes, ["Séquence 1", "Séquence 2"])
        r0 = res[0]
        maths = next(l for l in r0.lignes if l.attribution_id == self.maths.id)
        self.assertEqual((maths.details, maths.note), ([D("10"), D("12")], D("11.00")))
        # (11*4 + 8*3) / 7 = 68/7 = 9.714 -> 9.71
        self.assertEqual(r0.moyenne, D("9.71"))

    def test_annee(self):
        res, stats, _, entetes = self.resultats("a")
        self.assertEqual(entetes, ["Trim. 1", "Trim. 2", "Trim. 3"])
        r0, r1 = res[0], res[1]
        maths = next(l for l in r0.lignes if l.attribution_id == self.maths.id)
        self.assertEqual(maths.details, [D("11.00"), D("14.00"), D("17.00")])
        self.assertEqual(maths.note, D("14.00"))
        # Annuel élève 0 : (14*4 + 8*3) / 7 = 80/7 = 11.43
        self.assertEqual(r0.moyenne, D("11.43"))
        self.assertEqual(r0.moyennes_trimestres, [D("9.71"), D("14.00"), D("17.00")])
        self.assertEqual(r0.decision, "Admis(e) en classe supérieure")
        self.assertEqual((r1.moyenne, r1.decision), (D("9.00"), "Redouble"))
        self.assertEqual(res[2].decision, "")      # élève sans note

    def test_bulletins_trimestriel_et_annuel(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": "t1", "eleve": self.ins[0].id})
        self.assertContains(r, "BULLETIN DE NOTES TRIMESTRIEL")
        self.assertContains(r, "9,71")
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": "a", "eleve": self.ins[0].id})
        self.assertContains(r, "BULLETIN DE NOTES ANNUEL")
        self.assertContains(r, "Admis(e) en classe supérieure")
        self.assertContains(r, "11,43")

    def test_periode_inconnue(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("resultats"), {"classe": self.classe.pk, "periode": "t9"})
        self.assertEqual(r.status_code, 404)

    def test_resultats_annuels_page(self):
        self.client.force_login(self.admin)
        r = self.client.get(reverse("resultats"), {"classe": self.classe.pk, "periode": "a"})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "Décision proposée")


class BilinguismeTests(DonneesMixin, TestCase):
    def setUp(self):
        super().setUp()
        for ins, m, f in zip(self.ins, ["16", "9"], ["14", "11"]):
            Note.objects.create(inscription=ins, attribution=self.maths, sequence=self.s1, valeur=D(m))
            Note.objects.create(inscription=ins, attribution=self.fr, sequence=self.s1, valeur=D(f))
        self.maths.matiere.libelle_en = "Mathematics"
        self.maths.matiere.save()
        self.client.force_login(self.admin)

    def bulletin(self, **params):
        return self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": f"s{self.s1.pk}",
                                                       "eleve": self.ins[0].id, **params})

    def test_toutes_les_valeurs_calculees_sont_traduites(self):
        from .calculs import APPRECIATIONS, COMPETENCES
        from .traductions import VALEURS_EN, traduire
        valeurs = [lib for _, _, lib in APPRECIATIONS] + [lib for _, _, lib in COMPETENCES]
        valeurs += [lib for _, lib in BaremeDistinction.TYPES] + ["Admis(e) en classe supérieure", "Redouble"]
        for v in valeurs:
            with self.subTest(valeur=v):
                self.assertIn(v, VALEURS_EN)
        self.assertEqual(traduire("Séquence 3", "en"), "Sequence 3")
        self.assertEqual(traduire("Trim. 2", "en"), "Term 2")
        self.assertEqual(traduire("Bien", "fr"), "Bien")

    def test_francais_par_defaut(self):
        r = self.bulletin()
        self.assertEqual(r.context["langue"], "fr")
        self.assertContains(r, "BULLETIN DE NOTES SÉQUENTIEL")
        self.assertContains(r, "15,14")
        self.assertContains(r, "Mathématiques")

    def test_anglais_force(self):
        r = self.bulletin(langue="en")
        self.assertContains(r, "SEQUENCE REPORT CARD")
        self.assertContains(r, "Mathematics")          # désignation anglaise renseignée
        self.assertContains(r, "Français")             # pas de désignation anglaise : français repris
        self.assertContains(r, "Very good")            # 16 en mathématiques
        self.assertContains(r, "Acquired")
        self.assertContains(r, "15.14")                # format anglais des nombres
        self.assertNotContains(r, "15,14")
        self.assertNotContains(r, "Appréciation :")

    def test_section_anglophone_automatique(self):
        self.classe.section_anglophone = True
        self.classe.save()
        r = self.bulletin()
        self.assertEqual(r.context["langue"], "en")
        self.assertContains(r, "Class average")
        r = self.bulletin(langue="fr")                 # forcer le français reste possible
        self.assertContains(r, "Moyenne de la classe")

    def test_bulletin_annuel_en_anglais(self):
        r = self.client.get(reverse("bulletins"), {"classe": self.classe.pk, "periode": "a", "eleve": self.ins[0].id, "langue": "en"})
        self.assertContains(r, "ANNUAL REPORT CARD")
        self.assertContains(r, "Term 1")
        self.assertContains(r, "Promoted to the next class")
