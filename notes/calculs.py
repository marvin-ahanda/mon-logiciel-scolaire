"""Calculs de moyennes, rangs, appréciations et distinctions.

Les seuils d'appréciation et de compétence sont ceux du logiciel d'origine,
relevés dans le binaire (fonctions 0x97aef0 et 0x98e460).
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

DEUX_DECIMALES = Decimal("0.01")
MOYENNE_REUSSITE = Decimal("10")

# (borne inférieure comprise, borne supérieure exclue, libellé) ; la dernière tranche inclut 20.
APPRECIATIONS = [
    (Decimal("0"), Decimal("3"), "Nul"),
    (Decimal("3"), Decimal("4.5"), "Très faible"),
    (Decimal("4.5"), Decimal("7.5"), "Faible"),
    (Decimal("7.5"), Decimal("9"), "Insuffisant"),
    (Decimal("9"), Decimal("10"), "Médiocre"),
    (Decimal("10"), Decimal("12"), "Passable"),
    (Decimal("12"), Decimal("14"), "Assez bien"),
    (Decimal("14"), Decimal("16"), "Bien"),
    (Decimal("16"), Decimal("18"), "Très bien"),
    (Decimal("18"), Decimal("20"), "Excellent"),
]

# (borne inférieure exclue, borne supérieure comprise, libellé) ; la première tranche inclut 0.
COMPETENCES = [
    (Decimal("0"), Decimal("10"), "Non acquis"),
    (Decimal("10"), Decimal("14"), "En cours d'acquisition"),
    (Decimal("14"), Decimal("17"), "Acquis"),
    (Decimal("17"), Decimal("20"), "Expert"),
]


def arrondi(valeur):
    return None if valeur is None else Decimal(valeur).quantize(DEUX_DECIMALES, rounding=ROUND_HALF_UP)


def appreciation(moyenne):
    """Appréciation de l'original : [0;3[ Nul … [18;20] Excellent."""
    if moyenne is None:
        return ""
    m = Decimal(moyenne)
    for bas, haut, libelle in APPRECIATIONS:
        if bas <= m < haut:
            return libelle
    return "Excellent" if m == Decimal("20") else ""


def competence(moyenne):
    """Niveau de compétence de l'original : [0;10] Non acquis, ]10;14], ]14;17], ]17;20] Expert."""
    if moyenne is None:
        return ""
    m = Decimal(moyenne)
    for bas, haut, libelle in COMPETENCES:
        if (bas < m or (bas == 0 and m == 0)) and m <= haut:
            return libelle
    return ""


def rangs(valeurs):
    """Rang olympique (1, 2, 2, 4) ; None pour les valeurs absentes.

    Renvoie une liste de (rang, ex_aequo) alignée sur `valeurs`.
    """
    presentes = sorted((v for v in valeurs if v is not None), reverse=True)
    premier_rang = {}
    for i, v in enumerate(presentes, start=1):
        premier_rang.setdefault(v, i)
    compte = {}
    for v in presentes:
        compte[v] = compte.get(v, 0) + 1
    return [(None, False) if v is None else (premier_rang[v], compte[v] > 1) for v in valeurs]


@dataclass
class LigneMatiere:
    attribution_id: int
    matiere: str
    enseignant: str
    groupe: int
    coefficient: int
    note: Decimal | None
    rang: int | None = None
    ex_aequo: bool = False
    details: list = field(default_factory=list)
    matiere_en: str = ""          # désignation anglaise (bulletins en anglais), vide = française

    @property
    def points(self):
        return None if self.note is None else self.note * self.coefficient

    @property
    def appreciation(self):
        return appreciation(self.note)

    @property
    def competence(self):
        return competence(self.note)


@dataclass
class ResultatGroupe:
    groupe: int
    lignes: list
    total_coefficients: int = 0
    total_points: Decimal = Decimal("0")
    moyenne: Decimal | None = None


@dataclass
class ResultatEleve:
    inscription_id: int
    eleve: object
    lignes: list = field(default_factory=list)
    groupes: list = field(default_factory=list)
    total_coefficients: int = 0
    total_points: Decimal = Decimal("0")
    moyenne: Decimal | None = None
    rang: int | None = None
    ex_aequo: bool = False
    distinctions: list = field(default_factory=list)
    moyenne_non_classee: Decimal | None = None   # moyenne calculée mais coefficients insuffisants
    moyennes_trimestres: list = field(default_factory=list)
    decision: str = ""                           # décision de passage proposée (bulletin annuel)
    discipline: object = None                    # BilanDiscipline de la période

    @property
    def appreciation(self):
        return appreciation(self.moyenne)

    @property
    def competence(self):
        return competence(self.moyenne)

    @property
    def classe(self):
        return self.moyenne is not None


@dataclass
class StatistiquesClasse:
    effectif: int
    effectif_classe: int
    moyenne_classe: Decimal | None
    moyenne_max: Decimal | None
    moyenne_min: Decimal | None
    nombre_moyennes: int
    taux_reussite: Decimal | None


def moyenne_simple(valeurs):
    """Moyenne des valeurs présentes, arrondie à 2 décimales ; None si aucune."""
    presentes = [Decimal(v) for v in valeurs if v is not None]
    return arrondi(sum(presentes) / len(presentes)) if presentes else None


def notes_composees(composantes):
    """Note d'une matière sur une période à partir de ses composantes.

    composantes : dict {(inscription_id, attribution_id): [note ou None, ...]}
    Renvoie {(inscription_id, attribution_id): moyenne des composantes présentes}.

    Règle retenue (non vérifiée dans le binaire d'origine, usage camerounais) :
    note trimestrielle = moyenne des notes séquentielles du trimestre ;
    note annuelle = moyenne des notes trimestrielles.
    """
    return {k: m for k, v in composantes.items() if (m := moyenne_simple(v)) is not None}


def moyenne_ponderee(lignes):
    evaluees = [l for l in lignes if l.note is not None]
    total_coef = sum(l.coefficient for l in evaluees)
    total_points = sum((l.points for l in evaluees), Decimal("0"))
    moyenne = arrondi(total_points / total_coef) if total_coef else None
    return total_coef, total_points, moyenne


def calculer_resultats(eleves, attributions, notes, baremes=(), coef_min=0, details=None, conduite=None):
    """Calcule les résultats d'une classe pour une période (séquence, trimestre ou année).

    eleves       : liste de (inscription_id, eleve)
    attributions : liste d'objets avec id, matiere, enseignant, groupe, coefficient
    notes        : dict {(inscription_id, attribution_id): Decimal}
    baremes      : objets avec type, get_type_display() et s_applique(moyenne)
    coef_min     : un élève n'est classé que si le total des coefficients des matières où il est
                   évalué est supérieur ou égal à ce seuil (« Classer si total de coefficients
                   est supérieur ou égal à » dans l'original)
    details      : dict {(inscription_id, attribution_id): [notes composantes]} pour l'affichage
    conduite     : dict {inscription_id: note de discipline} pour la condition de conduite des distinctions
    """
    details = details or {}
    conduite = conduite or {}
    resultats = []
    for inscription_id, eleve in eleves:
        r = ResultatEleve(inscription_id=inscription_id, eleve=eleve)
        for a in attributions:
            r.lignes.append(LigneMatiere(
                attribution_id=a.id, matiere=str(a.matiere), enseignant=str(a.enseignant or ""),
                groupe=a.groupe, coefficient=a.coefficient, note=notes.get((inscription_id, a.id)),
                details=details.get((inscription_id, a.id), []),
                matiere_en=getattr(a.matiere, "libelle_en", "") or "",
            ))
        for g in sorted({l.groupe for l in r.lignes}):
            lignes_g = [l for l in r.lignes if l.groupe == g]
            tc, tp, moy = moyenne_ponderee(lignes_g)
            r.groupes.append(ResultatGroupe(groupe=g, lignes=lignes_g, total_coefficients=tc, total_points=tp, moyenne=moy))
        r.total_coefficients, r.total_points, r.moyenne = moyenne_ponderee(r.lignes)
        if r.moyenne is not None and r.total_coefficients < coef_min:
            r.moyenne_non_classee, r.moyenne = r.moyenne, None
        r.distinctions = [b.get_type_display() for b in baremes if b.s_applique(r.moyenne, conduite.get(inscription_id))]
        resultats.append(r)

    for (rang, ex), r in zip(rangs([r.moyenne for r in resultats]), resultats):
        r.rang, r.ex_aequo = rang, ex

    for a in attributions:
        lignes = [next(l for l in r.lignes if l.attribution_id == a.id) for r in resultats]
        for (rang, ex), l in zip(rangs([l.note for l in lignes]), lignes):
            l.rang, l.ex_aequo = rang, ex

    moyennes = [r.moyenne for r in resultats if r.moyenne is not None]
    stats = StatistiquesClasse(
        effectif=len(resultats),
        effectif_classe=len(moyennes),
        moyenne_classe=arrondi(sum(moyennes) / len(moyennes)) if moyennes else None,
        moyenne_max=max(moyennes) if moyennes else None,
        moyenne_min=min(moyennes) if moyennes else None,
        nombre_moyennes=sum(1 for m in moyennes if m >= MOYENNE_REUSSITE),
        taux_reussite=arrondi(Decimal(100) * sum(1 for m in moyennes if m >= MOYENNE_REUSSITE) / len(moyennes)) if moyennes else None,
    )
    return resultats, stats


# Ancien nom conservé pour compatibilité
calculer_sequence = calculer_resultats
