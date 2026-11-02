"""Chargement des données disciplinaires depuis la base."""

from .calculs import calculer_bilans
from .models import Absence, Incident, ParametresDiscipline, Retard


def bilans_discipline(inscriptions, sequences, exercice):
    """Bilan disciplinaire de chaque inscription sur l'ensemble des séquences données."""
    ids = [i.id for i in inscriptions]
    p = ParametresDiscipline.pour(exercice)
    absences = Absence.objects.filter(inscription_id__in=ids, sequence__in=sequences).values_list(
        "inscription_id", "heures_non_justifiees", "heures_justifiees")
    retards = Retard.objects.filter(inscription_id__in=ids, sequence__in=sequences).values_list("inscription_id", flat=True)
    incidents = [
        (inc.inscription_id, f"{inc.infraction.libelle} ({inc.date:%d/%m})", inc.infraction.sanction.points_perdus)
        for inc in Incident.objects.filter(inscription_id__in=ids, sequence__in=sequences)
        .select_related("infraction__sanction").order_by("date")
    ]
    return calculer_bilans(ids, absences, retards, incidents, p.note_max, p.points_par_retard, p.points_par_heure_absence)
