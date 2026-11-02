"""Bilan disciplinaire d'un élève sur une période.

Rubriques reprises de l'original (écran « Suivi disciplinaire ») :
ponctualité (retards), assiduité (absences non justifiées), autres cas (infractions sanctionnées).

Formule retenue (non vérifiée dans le binaire d'origine, réglable par exercice) :
    note de discipline = note maximale − (retards × points par retard
                                          + heures non justifiées × points par heure
                                          + somme des points des sanctions), sans descendre sous 0.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from notes.calculs import appreciation, arrondi


@dataclass
class BilanDiscipline:
    heures_non_justifiees: int = 0
    heures_justifiees: int = 0
    retards: int = 0
    incidents: list = field(default_factory=list)       # libellés « infraction (date) »
    points_ponctualite: Decimal = Decimal("0")
    points_assiduite: Decimal = Decimal("0")
    points_autres_cas: Decimal = Decimal("0")
    note: Decimal | None = None

    @property
    def points_perdus(self):
        return self.points_ponctualite + self.points_assiduite + self.points_autres_cas

    @property
    def appreciation(self):
        return appreciation(self.note)


def calculer_bilans(inscription_ids, absences, retards, incidents, note_max, points_par_retard, points_par_heure):
    """absences  : itérable de (inscription_id, heures_nj, heures_j)
    retards   : itérable d'inscription_id (un par retard)
    incidents : itérable de (inscription_id, libellé, points_perdus)
    Renvoie {inscription_id: BilanDiscipline}.
    """
    bilans = defaultdict(BilanDiscipline)
    for i in inscription_ids:
        bilans[i]
    for i, nj, j in absences:
        bilans[i].heures_non_justifiees += nj
        bilans[i].heures_justifiees += j
    for i in retards:
        bilans[i].retards += 1
    for i, libelle, points in incidents:
        bilans[i].incidents.append(libelle)
        bilans[i].points_autres_cas += Decimal(points)
    for b in bilans.values():
        b.points_ponctualite = arrondi(b.retards * Decimal(points_par_retard))
        b.points_assiduite = arrondi(b.heures_non_justifiees * Decimal(points_par_heure))
        b.points_autres_cas = arrondi(b.points_autres_cas)
        b.note = arrondi(max(Decimal("0"), Decimal(note_max) - b.points_perdus))
    return dict(bilans)
