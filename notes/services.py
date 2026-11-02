"""Chargement des données depuis la base pour les calculs et la saisie."""

from collections import defaultdict
from dataclasses import dataclass

from scolarite.models import Attribution, Inscription

from .calculs import calculer_resultats, notes_composees
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


# --- Périodes ----------------------------------------------------------------------------------

@dataclass
class Periode:
    """Séquence, trimestre ou année. Code URL : « s<id> », « t1 » à « t3 », « a »."""

    type: str               # "sequence", "trimestre" ou "annee"
    code: str
    libelle: str
    sequence: object = None
    trimestre: int = None

    @property
    def titre_bulletin(self):
        return {"sequence": "BULLETIN DE NOTES SÉQUENTIEL", "trimestre": "BULLETIN DE NOTES TRIMESTRIEL",
                "annee": "BULLETIN DE NOTES ANNUEL"}[self.type]


def periodes_exercice(exercice):
    p = [Periode("sequence", f"s{s.pk}", s.libelle, sequence=s) for s in exercice.sequences.all()]
    p += [Periode("trimestre", f"t{t}", f"Trimestre {t}", trimestre=t) for t in (1, 2, 3)]
    p.append(Periode("annee", "a", "Année"))
    return p


def periode_depuis_code(exercice, code):
    return next((p for p in periodes_exercice(exercice) if p.code == code), None)


def _notes_brutes(inscriptions, attributions, sequences):
    """{(inscription_id, attribution_id, sequence_id): valeur}"""
    return {
        (n.inscription_id, n.attribution_id, n.sequence_id): n.valeur
        for n in Note.objects.filter(sequence__in=sequences, inscription__in=inscriptions, attribution__in=attributions)
    }


def _notes_trimestre(brutes, cles, sequences_du_trimestre):
    composantes = {k: [brutes.get((*k, s.pk)) for s in sequences_du_trimestre] for k in cles}
    return notes_composees(composantes), composantes


def resultats_periode(classe, exercice, periode):
    """Renvoie (resultats, stats, attributions, entetes_details)."""
    inscriptions = list(inscriptions_classe(classe, exercice))
    attributions = list(Attribution.objects.filter(classe=classe, exercice=exercice)
                        .select_related("matiere", "enseignant").order_by("groupe", "matiere__libelle"))
    baremes = list(BaremeDistinction.objects.filter(exercice=exercice))
    eleves = [(i.id, i.eleve) for i in inscriptions]
    cles = [(i.id, a.id) for i in inscriptions for a in attributions]
    sequences = list(exercice.sequences.all())
    coef_min = classe.coef_min_classement

    if periode.type == "sequence":
        brutes = _notes_brutes(inscriptions, attributions, [periode.sequence])
        notes = {(i, a): v for (i, a, _), v in brutes.items()}
        resultats, stats = calculer_resultats(eleves, attributions, notes, baremes, coef_min)
        return resultats, stats, attributions, []

    brutes = _notes_brutes(inscriptions, attributions, sequences)
    par_trimestre = {t: [s for s in sequences if s.trimestre == t] for t in (1, 2, 3)}

    if periode.type == "trimestre":
        seqs = par_trimestre[periode.trimestre]
        notes, composantes = _notes_trimestre(brutes, cles, seqs)
        resultats, stats = calculer_resultats(eleves, attributions, notes, baremes, coef_min, details=composantes)
        return resultats, stats, attributions, [s.libelle for s in seqs]

    # Année : note annuelle d'une matière = moyenne des notes trimestrielles disponibles.
    notes_t = {t: _notes_trimestre(brutes, cles, par_trimestre[t])[0] for t in (1, 2, 3)}
    composantes = {k: [notes_t[t].get(k) for t in (1, 2, 3)] for k in cles}
    notes_annuelles = notes_composees(composantes)
    resultats, stats = calculer_resultats(eleves, attributions, notes_annuelles, baremes, coef_min, details=composantes)
    # Moyennes générales de chaque trimestre, affichées sur le bulletin annuel
    moy_t = defaultdict(dict)
    for t in (1, 2, 3):
        res_t, _ = calculer_resultats(eleves, attributions, notes_t[t], (), coef_min)
        for r in res_t:
            moy_t[r.inscription_id][t] = r.moyenne
    for r in resultats:
        r.moyennes_trimestres = [moy_t[r.inscription_id].get(t) for t in (1, 2, 3)]
        r.decision = ("" if r.moyenne is None else
                      "Admis(e) en classe supérieure" if r.moyenne >= exercice.moyenne_passage else "Redouble")
    return resultats, stats, attributions, ["Trim. 1", "Trim. 2", "Trim. 3"]


def resultats_sequence(classe, sequence):
    """Compatibilité : résultats d'une séquence."""
    p = Periode("sequence", f"s{sequence.pk}", sequence.libelle, sequence=sequence)
    resultats, stats, attributions, _ = resultats_periode(classe, sequence.exercice, p)
    return resultats, stats, attributions

