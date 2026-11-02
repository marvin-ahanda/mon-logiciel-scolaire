"""Lecture et écriture de classeurs Excel (.xlsx) pour l'import et l'export."""

import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

TAILLE_MAX = 2 * 1024 * 1024
LIGNES_MAX = 3000
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ErreurFichier(Exception):
    """Fichier illisible ou non conforme (message destiné à l'utilisateur)."""


# --- Export -----------------------------------------------------------------------------------------

def sur(valeur):
    """Neutralise l'injection de formules : un texte commençant par = + - @ ne doit pas être exécuté par Excel."""
    if isinstance(valeur, str) and valeur[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + valeur
    if isinstance(valeur, Decimal):
        return float(valeur)
    return valeur


def classeur(feuilles):
    """feuilles : liste de (titre, entetes, lignes[, notes]) -> octets .xlsx."""
    wb = Workbook()
    wb.remove(wb.active)
    gras, fond = Font(bold=True), PatternFill("solid", fgColor="DDE6F5")
    for feuille in feuilles:
        titre, entetes, lignes = feuille[:3]
        ws = wb.create_sheet(title=titre[:31])
        ws.append([sur(e) for e in entetes])
        for c in ws[1]:
            c.font, c.fill, c.alignment = gras, fond, Alignment(wrap_text=True, vertical="center")
        for ligne in lignes:
            ws.append([sur(v) for v in ligne])
        for i, entete in enumerate(entetes, start=1):
            largeur = max([len(str(entete))] + [len(str(l[i - 1])) for l in lignes[:500] if i - 1 < len(l) and l[i - 1] is not None])
            ws.column_dimensions[get_column_letter(i)].width = min(max(10, largeur + 2), 45)
        ws.freeze_panes = "A2"
        if lignes:
            ws.auto_filter.ref = ws.dimensions
        if len(feuille) > 3:
            notes = wb.create_sheet(title="Mode d'emploi")
            for n in feuille[3]:
                notes.append([n])
            notes.column_dimensions["A"].width = 110
    tampon = BytesIO()
    wb.save(tampon)
    return tampon.getvalue()


def reponse_xlsx(contenu, nom):
    r = HttpResponse(contenu, content_type=MIME_XLSX)
    r["Content-Disposition"] = f'attachment; filename="{nom}-{timezone.localdate():%Y%m%d}.xlsx"'
    return r


# --- Import -----------------------------------------------------------------------------------------

def normaliser(texte):
    """« Date de naissance » -> « datedenaissance » (casse, accents, espaces et ponctuation ignorés)."""
    t = unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in t if ch.isalnum())


def lire(fichier, colonnes):
    """Lit la première feuille. colonnes : {cle: [en-têtes acceptés]}.

    Renvoie une liste de (numéro de ligne, {cle: valeur}) en ignorant les lignes vides.
    """
    if fichier.size > TAILLE_MAX:
        raise ErreurFichier("Le fichier dépasse 2 Mo.")
    entete_zip = fichier.read(4)
    fichier.seek(0)
    if entete_zip != b"PK\x03\x04":
        raise ErreurFichier("Ce n'est pas un classeur Excel .xlsx (les anciens fichiers .xls ou .csv ne sont pas acceptés : "
                            "enregistrez-le au format « Classeur Excel (.xlsx) »).")
    try:
        wb = load_workbook(fichier, read_only=True, data_only=True)   # formules lues comme valeurs, rien n'est exécuté
    except Exception:
        raise ErreurFichier("Classeur Excel illisible ou endommagé.")
    try:
        ws = wb.worksheets[0]
        lignes = ws.iter_rows(values_only=True)
        entetes = next(lignes, None)
        if not entetes:
            raise ErreurFichier("La première feuille est vide.")
        index = {normaliser(e): i for i, e in enumerate(entetes) if e is not None}
        positions = {}
        for cle, noms in colonnes.items():
            for nom in noms:
                if normaliser(nom) in index:
                    positions[cle] = index[normaliser(nom)]
                    break
        resultat = []
        for n, ligne in enumerate(lignes, start=2):
            if n - 1 > LIGNES_MAX:
                raise ErreurFichier(f"Le fichier dépasse {LIGNES_MAX} lignes.")
            if ligne is None or all(v is None or str(v).strip() == "" for v in ligne):
                continue
            resultat.append((n, {cle: (ligne[i] if i < len(ligne) else None) for cle, i in positions.items()}))
        return resultat, set(positions)
    finally:
        wb.close()


def texte(v, longueur=None):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)                                # un matricule numérique saisi dans Excel
    t = str(v).strip()
    return t[:longueur] if longueur else t


def en_date(v):
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    t = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"date « {t} » non reconnue (format attendu : jj/mm/aaaa)")


def en_note(v):
    if v in (None, ""):
        return None
    try:
        d = Decimal(str(v).strip().replace(",", "."))
    except InvalidOperation:
        raise ValueError(f"« {v} » n'est pas une note")
    if not d.is_finite() or not (0 <= d <= 20):
        raise ValueError(f"{v} n'est pas compris entre 0 et 20")
    return d.quantize(Decimal("0.01"))
