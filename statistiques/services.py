"""Statistiques avancées : répartition des moyennes, statistiques par matière, comparaison des classes,
effectifs par sexe et âge (écrans « Statistiques » et « Effectifs sexe/âge » de l'original)."""

from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal

from notes.calculs import MOYENNE_REUSSITE, arrondi
from notes.services import resultats_periode
from scolarite.models import Classe, Inscription

INTERVALLES = [(Decimal(0), Decimal(5), "[0 ; 5["), (Decimal(5), Decimal(8), "[5 ; 8["), (Decimal(8), Decimal(10), "[8 ; 10["),
               (Decimal(10), Decimal(12), "[10 ; 12["), (Decimal(12), Decimal(14), "[12 ; 14["), (Decimal(14), Decimal(16), "[14 ; 16["),
               (Decimal(16), Decimal(21), "[16 ; 20]")]
SEXES = [("M", "Garçons"), ("F", "Filles")]


def resume(valeurs):
    """Effectif, moyenne, min, max, nombre >= 10 et taux de réussite d'une liste de notes ou moyennes."""
    v = [x for x in valeurs if x is not None]
    if not v:
        return {"n": 0, "moyenne": None, "min": None, "max": None, "reussite": 0, "taux": None}
    reussite = sum(1 for x in v if x >= MOYENNE_REUSSITE)
    return {"n": len(v), "moyenne": arrondi(sum(v) / len(v)), "min": min(v), "max": max(v), "reussite": reussite,
            "taux": arrondi(Decimal(100) * reussite / len(v))}


def repartition(valeurs_par_sexe):
    """{sexe: [moyennes]} -> lignes par intervalle avec effectifs par sexe, total et pourcentage."""
    toutes = [m for liste in valeurs_par_sexe.values() for m in liste]
    lignes = []
    for bas, haut, libelle in INTERVALLES:
        par_sexe = {s: sum(1 for m in valeurs_par_sexe.get(s, []) if bas <= m < haut) for s, _ in SEXES}
        total = sum(1 for m in toutes if bas <= m < haut)
        lignes.append({"libelle": libelle, "par_sexe": par_sexe, "total": total,
                       "pourcentage": arrondi(Decimal(100) * total / len(toutes)) if toutes else None})
    return lignes


def statistiques_classe(classe, exercice, periode):
    resultats, stats, attributions, _ = resultats_periode(classe, exercice, periode)
    moyennes = defaultdict(list)
    for r in resultats:
        if r.moyenne is not None:
            moyennes[r.eleve.sexe].append(r.moyenne)
    par_sexe = {s: resume(moyennes.get(s, [])) for s, _ in SEXES}
    matieres = []
    for a in attributions:
        notes = defaultdict(list)
        for r in resultats:
            n = next((l.note for l in r.lignes if l.attribution_id == a.id), None)
            if n is not None:
                notes[r.eleve.sexe].append(n)
        matieres.append({"attribution": a, "tous": resume([n for l in notes.values() for n in l]),
                         "par_sexe": {s: resume(notes.get(s, [])) for s, _ in SEXES}})
    return {"stats": stats, "global": resume([m for l in moyennes.values() for m in l]), "par_sexe": par_sexe,
            "repartition": repartition(moyennes), "matieres": matieres}


def comparaison_classes(exercice, periode):
    lignes, par_niveau = [], defaultdict(list)
    for classe in Classe.objects.select_related("niveau"):
        resultats, *_ = resultats_periode(classe, exercice, periode)
        moyennes = [r.moyenne for r in resultats if r.moyenne is not None]
        if not resultats:
            continue
        r = resume(moyennes)
        lignes.append({"classe": classe, "effectif": len(resultats), **r})
        par_niveau[classe.niveau].extend(moyennes)
    niveaux = [{"niveau": n, **resume(m)} for n, m in par_niveau.items()]
    etablissement = resume([m for l in par_niveau.values() for m in l])
    return lignes, niveaux, etablissement


def date_de_reference(exercice):
    """1er janvier de la seconde année de l'exercice (« 2025-2026 » -> 1/1/2026) ; à défaut, aujourd'hui."""
    try:
        return date(int(exercice.libelle.split("-")[1]), 1, 1)
    except (IndexError, ValueError):
        return date.today()


def age(naissance, ref):
    return ref.year - naissance.year - ((ref.month, ref.day) < (naissance.month, naissance.day))


def effectifs_sexe_age(exercice):
    """Effectifs par classe, sexe et âge à la date de référence."""
    ref = date_de_reference(exercice)
    inscriptions = Inscription.objects.filter(exercice=exercice).select_related("eleve", "classe__niveau")
    compte, ages, inconnus = defaultdict(Counter), set(), False
    for i in inscriptions:
        a = age(i.eleve.date_naissance, ref) if i.eleve.date_naissance else None
        cle = "inconnu" if a is None else (a if 9 <= a <= 21 else ("≤ 9" if a < 9 else "≥ 21"))
        if a is None:
            inconnus = True
        else:
            ages.add(cle)
        compte[i.classe][(cle, i.eleve.sexe)] += 1
    colonnes = sorted([c for c in ages if isinstance(c, int)])
    colonnes = (["≤ 9"] if "≤ 9" in ages else []) + colonnes + (["≥ 21"] if "≥ 21" in ages else []) + (["inconnu"] if inconnus else [])
    lignes = []
    for classe in sorted(compte, key=lambda c: (c.niveau.ordre, c.libelle)):
        c = compte[classe]
        lignes.append({"classe": classe, "cellules": [(c[(a, "M")], c[(a, "F")]) for a in colonnes],
                       "garcons": sum(v for (a, s), v in c.items() if s == "M"), "filles": sum(v for (a, s), v in c.items() if s == "F")})
    totaux = [(sum(l["cellules"][k][0] for l in lignes), sum(l["cellules"][k][1] for l in lignes)) for k in range(len(colonnes))]
    return ref, colonnes, lignes, totaux
