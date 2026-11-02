import json
from datetime import date
from decimal import Decimal as D
from unittest import mock

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from discipline.models import Absence
from finances.tests import FinancesMixin
from notes.models import Note

from .models import CreditSMS, MessageSMS
from .outils import nombre_de_sms, normaliser_telephone
from .passerelles import ErreurEnvoi, PasserelleHTTP, forcer_passerelle
from .services import CreditInsuffisant, composer, envoyer


class FaussePasserelle:
    """Passerelle « réelle » de test : n'envoie rien, enregistre les appels."""
    nom, reel = "test", True

    def __init__(self, en_echec=()):
        self.envois, self.en_echec = [], set(en_echec)

    def envoyer(self, telephone, texte):
        if telephone in self.en_echec:
            raise ErreurEnvoi("refusé par le fournisseur")
        self.envois.append((telephone, texte))
        return MessageSMS.ENVOYE


class OutilsTests(TestCase):
    def test_numeros_camerounais(self):
        for brut, attendu in [("690000000", "+237690000000"), ("6 90 00 00 00", "+237690000000"), ("+237 690-00-00-00", "+237690000000"),
                              ("00237690000000", "+237690000000"), ("222 23 45 67", "+237222234567"), ("12345", None),
                              ("590000000", None), ("+33612345678", None), ("", None), (None, None), ("6900000OO", None)]:
            with self.subTest(brut=brut):
                self.assertEqual(normaliser_telephone(brut), attendu)

    def test_decompte_des_sms(self):
        self.assertEqual(nombre_de_sms("a" * 160), 1)
        self.assertEqual(nombre_de_sms("a" * 161), 2)
        self.assertEqual(nombre_de_sms("Élève très régulier à l'école"), 1)      # accents de l'alphabet GSM
        self.assertEqual(nombre_de_sms("ç" + "a" * 70), 2)                        # « ç » : Unicode, 70 caractères
        self.assertEqual(nombre_de_sms("€" * 80), 1)                              # extension GSM : compte double
        self.assertEqual(nombre_de_sms("€" * 81), 2)

    def test_translitteration(self):
        from .outils import translitterer
        texte = translitterer("Grâce, Noël, garçon : 2ème — très bien")
        self.assertEqual(texte, "Grace, Noel, garcon : 2ème - très bien")              # é, è conservés (alphabet GSM)
        self.assertEqual(nombre_de_sms(texte + "x" * 100), 1)


class SMSMixin(FinancesMixin):
    def setUp(self):
        super().setUp()
        tels = ["690000001", "6 77 00 00 02", "123"]
        for ins, t in zip(self.ins, tels):
            ins.eleve.telephone_parent = t
            ins.eleve.save()

    def tearDown(self):
        forcer_passerelle(None)
        super().tearDown()


class ComposerTests(SMSMixin, TestCase):
    def test_message_libre_et_numeros_invalides(self):
        d = composer("libre", self.ins, texte_libre="Reunion samedi")
        self.assertEqual([x.telephone for x in d], ["+237690000001", "+237677000002", None])
        self.assertIn("numéro invalide", d[2].raison)
        self.assertTrue(d[0].texte.endswith(": Reunion samedi"))

    def test_resultats(self):
        from notes.services import periode_depuis_code
        Note.objects.create(inscription=self.ins[0], attribution=self.maths, sequence=self.s1, valeur=D("14.5"))
        d = composer("resultats", self.ins, self.classe, periode_depuis_code(self.ex, f"s{self.s1.pk}"), self.ex)
        self.assertIn("moyenne 14,50/20, rang 1/1, bien", d[0].texte)
        self.assertIn("non classe(e)", d[1].texte)
        self.assertEqual(d[0].parties, 1)

    def test_ecolage_et_absences(self):
        from notes.services import periode_depuis_code
        self.payer(self.ins[0], self.inscr, 10000)
        self.payer(self.ins[0], self.t1, 50000)                                  # soldé : pas de rappel
        d = composer("ecolage", self.ins, self.classe, exercice=self.ex)
        self.assertEqual([x.eleve for x in d], [self.ins[1].eleve, self.ins[2].eleve])
        self.assertIn("reste a payer 55 000 F", d[0].texte)
        Absence.objects.create(inscription=self.ins[1], sequence=self.s1, date=date(2025, 10, 6), heures_non_justifiees=3)
        d = composer("absences", self.ins, self.classe, periode_depuis_code(self.ex, "t1"), self.ex)
        self.assertEqual(len(d), 1)
        self.assertIn("3 h d'absence non justifiee(s), 0 retard(s)", d[0].texte)


class EnvoiTests(SMSMixin, TestCase):
    def test_mode_journal_n_envoie_rien(self):
        ok, echecs = envoyer(composer("libre", self.ins, texte_libre="Test"), "libre", self.admin)
        self.assertEqual((ok, echecs), (2, 0))
        self.assertEqual(set(MessageSMS.objects.values_list("statut", flat=True)), {MessageSMS.SIMULE})
        self.assertEqual(CreditSMS.solde(), 0)                                  # aucun crédit consommé

    def test_credit_insuffisant_bloque_tout(self):
        forcer_passerelle(gw := FaussePasserelle())
        CreditSMS.objects.create(quantite=1)
        with self.assertRaises(CreditInsuffisant):
            envoyer(composer("libre", self.ins, texte_libre="Test"), "libre", self.admin)
        self.assertEqual((gw.envois, MessageSMS.objects.count()), ([], 0))

    def test_envoi_consomme_le_credit_et_trace_les_echecs(self):
        forcer_passerelle(gw := FaussePasserelle(en_echec={"+237677000002"}))
        CreditSMS.objects.create(quantite=10)
        ok, echecs = envoyer(composer("libre", self.ins, texte_libre="Test"), "libre", self.admin)
        self.assertEqual((ok, echecs, len(gw.envois)), (1, 1, 1))
        self.assertEqual(CreditSMS.solde(), 9)                                  # l'échec n'est pas décompté
        self.assertEqual(MessageSMS.objects.get(statut=MessageSMS.ECHEC).erreur, "refusé par le fournisseur")

    @mock.patch.dict("os.environ", {"NEXIA_SMS_URL": "https://sms.exemple.test/api", "NEXIA_SMS_TOKEN": "jeton-test",
                                     "NEXIA_SMS_EXPEDITEUR": "COLLEGE"})
    def test_requete_http(self):
        reponse = mock.MagicMock(status=200)
        reponse.__enter__.return_value = reponse
        with mock.patch("urllib.request.urlopen", return_value=reponse) as urlopen:
            self.assertEqual(PasserelleHTTP().envoyer("+237690000001", "Bonjour"), "envoyé")
        requete = urlopen.call_args[0][0]
        self.assertEqual(requete.full_url, "https://sms.exemple.test/api")
        self.assertEqual(requete.headers["Authorization"], "Bearer jeton-test")
        self.assertEqual(json.loads(requete.data), {"to": "+237690000001", "from": "COLLEGE", "text": "Bonjour"})

    @mock.patch.dict("os.environ", {"NEXIA_SMS_URL": "http://non-chiffre.test"})
    def test_http_non_chiffre_refuse(self):
        with self.assertRaises(ErreurEnvoi):
            PasserelleHTTP()


class VuesSMSTests(SMSMixin, TestCase):
    def test_apercu_puis_envoi(self):
        params = {"objet": "libre", "classe": self.classe.pk, "texte": "Reunion des parents samedi"}
        r = self.client.get(reverse("sms_envoi"), {**params, "action": "apercu"})
        self.assertEqual((r.context["nb_valides"], r.context["nb_sms"]), (2, 2))
        self.assertFalse(MessageSMS.objects.exists())                            # rien avant confirmation
        r = self.client.post(reverse("sms_envoi"), {**params, "action": "envoyer"})
        self.assertRedirects(r, reverse("sms_journal"))
        self.assertEqual(MessageSMS.objects.count(), 2)

    def test_notification_de_paiement(self):
        # Le SMS part après la validation de la transaction du paiement (jamais pour un paiement annulé en cours).
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("compte_eleve", args=[self.ins[0].pk]), {
                "action": "paiement", "p-rubrique": self.inscr.pk, "p-montant": 10000, "p-mode": "ESP", "p-reference": "",
                "p-date": date.today().isoformat(), "notifier": "1"})
        m = MessageSMS.objects.get()
        self.assertEqual((m.objet, m.telephone), ("paiement", "+237690000001"))
        self.assertIn("10 000 F verses pour Eleve0 (Inscription). Reste ecolage : 50 000 F.", m.texte)

    def test_droits(self):
        caissier = User.objects.create_user("c4", password="p")
        caissier.groups.add(Group.objects.get(name="Caisse"))
        for u in (caissier, self.u_ens):
            self.client.force_login(u)
            self.assertEqual(self.client.get(reverse("sms_envoi")).status_code, 302)
            self.assertEqual(self.client.get(reverse("sms_journal")).status_code, 302)
