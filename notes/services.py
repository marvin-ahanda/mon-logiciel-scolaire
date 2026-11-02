"""Chargement des données depuis la base pour les calculs et la saisie."""

from scolarite.models import Attribution, Inscription

from .calculs import calculer_sequence
from .models import BaremeDistinction, Note


def est_administration(user):
    return user.is_authenticated and (user.is_staff or user.is_superuser)


def enseignant_de(user):
    return getattr(user, "enseignant", None) if user.is_authenticated else None


def peut_saisir(user, attribution):
    if est_administration(user):
        return True
    ens = enseignant_de(user)
    return ens is not None and attribution.enseignant_id == ens.id


def attributions_saisissables(user, exercice):
    qs = Attribution.objects.filter(exercice=exercice).select_related("classe", "matiere", "enseignant")
    if est_administration(user):
        return qs
    ens = enseignant_de(user)
    return qs.filter(enseignant=ens) if ens else qs.none()


def inscriptions_classe(classe, exercice):
    return (Inscription.objects.filter(classe=classe, exercice=exercice)
            .select_related("eleve").order_by("eleve__nom", "eleve__prenom"))


def resultats_sequence(classe, sequence):
    exercice = sequence.exercice
    inscriptions = list(inscriptions_classe(classe, exercice))
    attributions = list(Attribution.objects.filter(classe=classe, exercice=exercice)
                        .select_related("matiere", "enseignant").order_by("groupe", "matiere__libelle"))
    notes = {
        (n.inscription_id, n.attribution_id): n.valeur
        for n in Note.objects.filter(sequence=sequence, inscription__in=inscriptions, attribution__in=attributions)
    }
    baremes = list(BaremeDistinction.objects.filter(exercice=exercice))
    resultats, stats = calculer_sequence([(i.id, i.eleve) for i in inscriptions], attributions, notes, baremes)
    return resultats, stats, attributions
