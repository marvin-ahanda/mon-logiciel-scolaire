"""Bulletins bilingues (français / anglais).

L'original proposait « Options de langue : Français / Anglais » sur les écrans de bulletins.
Les libellés anglais repris de l'original : « Not acquired », « Acquired », « Expert », « Excellent ».
« En cours d'acquisition » est rendu par « Being acquired » (l'original écrivait « In acquisition course »).
"""

import re

LANGUES = [("auto", "Selon la classe (section anglophone → anglais)"), ("fr", "Français"), ("en", "Anglais")]

# Libellés fixes du bulletin : clé -> (français, anglais)
LIBELLES = {
    "dp": ("\u00a0:", ":"),          # deux-points : espace insécable avant en français, aucune en anglais
    "etablissement": ("Établissement", "School"),
    "annee_scolaire": ("Année scolaire", "School year"),
    "trimestre": ("trimestre", "term"),
    "tel": ("Tél.", "Tel."),
    "nom_prenom": ("Nom et prénom", "Name"),
    "matricule": ("Matricule", "Registration no."),
    "sexe": ("Sexe", "Sex"),
    "ne_le": ("Né(e) le", "Date of birth"),
    "a": ("à", "at"),
    "classe": ("Classe", "Class"),
    "effectif": ("Effectif", "Class size"),
    "matiere": ("Matière", "Subject"),
    "enseignant": ("Enseignant", "Teacher"),
    "note_sequence": ("Note/20", "Mark/20"),
    "note_trimestre": ("Note trim.", "Term mark"),
    "note_annee": ("Note ann.", "Annual mark"),
    "coef": ("Coef.", "Coef."),
    "points": ("Note × coef.", "Mark × coef."),
    "rang": ("Rang", "Rank"),
    "appreciation": ("Appréciation", "Remark"),
    "competence": ("Compétence", "Competence"),
    "groupe": ("Groupe", "Group"),
    "moyenne_groupe": ("Moyenne du groupe", "Group average"),
    "total": ("TOTAL", "TOTAL"),
    "moyenne": ("Moyenne", "Average"),
    "non_classe": ("non classé", "not ranked"),
    "moyenne_classe": ("Moyenne de la classe", "Class average"),
    "plus_forte": ("Plus forte", "Highest"),
    "plus_faible": ("plus faible", "lowest"),
    "distinction": ("Distinction", "Distinction"),
    "moyennes_trimestrielles": ("Moyennes trimestrielles", "Term averages"),
    "decision": ("Décision proposée", "Proposed decision"),
    "discipline": ("Discipline", "Discipline"),
    "points_perdus": ("Points perdus", "Points lost"),
    "note_discipline": ("Note de discipline", "Conduct mark"),
    "abs_nj": ("Abs. non justifiées", "Unexcused absences"),
    "abs_j": ("Abs. justifiées", "Excused absences"),
    "retards": ("Retards", "Lateness"),
    "autres_cas": ("Autres cas", "Other cases"),
    "ponctualite": ("Ponctualité", "Punctuality"),
    "assiduite": ("Assiduité", "Attendance"),
    "visa_parent": ("Visa du parent", "Parent's signature"),
    "professeur_principal": ("Professeur principal", "Class master"),
    "chef_etablissement": ("Le chef d'établissement", "The Principal"),
    "legende": ("NE\u00a0: non évalué · NC\u00a0: non classé.", "NE: not evaluated · NC: not ranked."),
    "legende_trimestre": ("Note de la période = moyenne des notes séquentielles du trimestre disponibles.",
                          "Term mark = average of the available sequence marks of the term."),
    "legende_annee": ("Note de la période = moyenne des notes trimestrielles disponibles.",
                      "Annual mark = average of the available term marks."),
    "titre_sequence": ("BULLETIN DE NOTES SÉQUENTIEL", "SEQUENCE REPORT CARD"),
    "titre_trimestre": ("BULLETIN DE NOTES TRIMESTRIEL", "TERM REPORT CARD"),
    "titre_annee": ("BULLETIN DE NOTES ANNUEL", "ANNUAL REPORT CARD"),
}

# Valeurs calculées (appréciations, compétences, distinctions, décisions) : français -> anglais
VALEURS_EN = {
    "Nul": "Nil", "Très faible": "Very weak", "Faible": "Weak", "Insuffisant": "Insufficient",
    "Médiocre": "Below average", "Passable": "Average", "Assez bien": "Fairly good", "Bien": "Good",
    "Très bien": "Very good", "Excellent": "Excellent",
    "Non acquis": "Not acquired", "En cours d'acquisition": "Being acquired", "Acquis": "Acquired", "Expert": "Expert",
    "Tableau d'honneur": "Roll of honour", "Encouragements": "Encouragement", "Félicitations": "Congratulations",
    "Avertissement travail": "Warning (work)", "Blâme travail": "Blame (work)",
    "Admis(e) en classe supérieure": "Promoted to the next class", "Redouble": "Repeats the class",
    "Année": "Year",
}

_MOTIFS_EN = [
    (re.compile(r"^Séquence (\d+)$"), r"Sequence \1"),
    (re.compile(r"^Trimestre (\d)$"), r"Term \1"),
    (re.compile(r"^Trim\. (\d)$"), r"Term \1"),
]


def langue_du_bulletin(demandee, classe):
    """« fr » ou « en » ; « auto » (défaut) : anglais pour une classe de la section anglophone."""
    if demandee in ("fr", "en"):
        return demandee
    return "en" if classe is not None and classe.section_anglophone else "fr"


def libelles(langue):
    i = 1 if langue == "en" else 0
    return {cle: valeurs[i] for cle, valeurs in LIBELLES.items()}


def traduire(valeur, langue):
    """Traduit une valeur calculée ou un libellé de période ; inchangé en français ou si inconnu."""
    if langue != "en" or valeur in (None, ""):
        return valeur
    texte = str(valeur)
    if texte in VALEURS_EN:
        return VALEURS_EN[texte]
    for motif, remplacement in _MOTIFS_EN:
        if motif.match(texte):
            return motif.sub(remplacement, texte)
    return texte
