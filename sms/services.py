"""Composition et envoi des SMS aux parents.

Les textes évitent les caractères hors de l'alphabet GSM (ç, °, ê…) : un seul de ces caractères fait passer
tout le message en Unicode (70 caractères par SMS au lieu de 160).
"""

from dataclasses import dataclass

from django.db import transaction

from scolarite.models import Etablissement

from .models import CreditSMS, MessageSMS
from .outils import nombre_de_sms, normaliser_telephone, translitterer
from .passerelles import ErreurEnvoi, passerelle


class CreditInsuffisant(Exception):
    pass


@dataclass
class Destinataire:
    eleve: object
    telephone: str | None
    texte: str
    raison: str = ""

    @property
    def parties(self):
        return nombre_de_sms(self.texte)

    @property
    def valide(self):
        return self.telephone is not None and not self.raison


def _signature():
    e = Etablissement.courant()
    return (e.nom if e else "Ecole")[:40]


def _montant(v):
    return f"{int(v):,}".replace(",", " ")


def _dest(eleve, texte):
    tel = normaliser_telephone(eleve.telephone_parent)
    raison = "" if tel else ("aucun numéro" if not eleve.telephone_parent else f"numéro invalide ({eleve.telephone_parent})")
    return Destinataire(eleve=eleve, telephone=tel, texte=translitterer(f"{_signature()}: {texte}"), raison=raison)


def composer(objet, inscriptions, classe=None, periode=None, exercice=None, texte_libre=""):
    """Liste de Destinataire pour un envoi groupé (aperçu ou envoi)."""
    inscriptions = list(inscriptions)
    if objet == "libre":
        return [_dest(i.eleve, texte_libre.strip()) for i in inscriptions]
    if objet == "resultats":
        from notes.services import resultats_periode
        from notes.traductions import traduire
        resultats, stats, _, _ = resultats_periode(classe, exercice, periode)
        sortie = []
        for r in resultats:
            if r.moyenne is None:
                fin = "non classe(e)"
            else:
                fin = f"moyenne {str(r.moyenne).replace('.', ',')}/20, rang {r.rang}{' ex' if r.ex_aequo else ''}/{stats.effectif_classe}"
                fin += f", {r.appreciation.lower()}"
            sortie.append(_dest(r.eleve, f"{r.eleve} ({classe}) - {traduire(periode.libelle, 'fr')} : {fin}."))
        return sortie
    if objet == "ecolage":
        from finances.services import comptes
        cs = comptes(inscriptions, exercice)
        return [_dest(i.eleve, f"ecolage de {i.eleve} ({i.classe}) : reste a payer {_montant(cs[i.id].total_reste)} F. "
                                f"Merci de regulariser.") for i in inscriptions if cs[i.id].total_reste > 0]
    if objet == "absences":
        from discipline.services import bilans_discipline
        sequences = list(exercice.sequences.all())
        seqs = ([periode.sequence] if periode.type == "sequence" else
                [s for s in sequences if s.trimestre == periode.trimestre] if periode.type == "trimestre" else sequences)
        bilans = bilans_discipline(inscriptions, seqs, exercice)
        sortie = []
        for i in inscriptions:
            b = bilans[i.id]
            if b.heures_non_justifiees or b.retards:
                sortie.append(_dest(i.eleve, f"{i.eleve} ({i.classe}) - {periode.libelle} : {b.heures_non_justifiees} h d'absence "
                                             f"non justifiee(s), {b.retards} retard(s)."))
        return sortie
    raise ValueError(f"objet inconnu : {objet}")


def message_paiement(paiement, reste):
    return _dest(paiement.inscription.eleve,
                 f"recu No {paiement.numero_recu} : {_montant(paiement.montant)} F verses pour {paiement.inscription.eleve} "
                 f"({paiement.rubrique}). Reste ecolage : {_montant(reste)} F.")


def envoyer(destinataires, objet, utilisateur):
    """Envoie les messages valides ; renvoie (nombre envoyés ou simulés, nombre d'échecs).

    Avec une passerelle réelle, l'envoi est refusé d'avance si le crédit SMS ne couvre pas tous les messages.
    """
    gw = passerelle()
    valides = [d for d in destinataires if d.valide]
    besoin = sum(d.parties for d in valides)
    if gw.reel:
        with transaction.atomic():
            solde = CreditSMS.solde()
            if besoin > solde:
                raise CreditInsuffisant(f"Crédit SMS insuffisant : {besoin} SMS nécessaires, {solde} disponibles. "
                                        "Rechargez le compte SMS.")
    ok = echecs = 0
    for d in valides:
        try:
            statut, erreur = gw.envoyer(d.telephone, d.texte), ""
            ok += 1
        except ErreurEnvoi as e:
            statut, erreur = MessageSMS.ECHEC, str(e)[:200]
            echecs += 1
        MessageSMS.objects.create(objet=objet, eleve=d.eleve, telephone=d.telephone, texte=d.texte, parties=d.parties,
                                  statut=statut, erreur=erreur, envoye_par=utilisateur)
    return ok, echecs
