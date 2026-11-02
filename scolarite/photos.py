"""Photos des élèves : contrôle, redimensionnement et accès protégé.

Ce sont des données personnelles de mineurs : elles ne sont jamais servies comme fichiers publics,
mais par une vue qui vérifie la connexion et le rôle (voir scolarite.views.photo_eleve).
"""

import uuid
from io import BytesIO

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

TAILLE_MAX_OCTETS = 5 * 1024 * 1024
COTE_MAX = 400
FORMATS_ACCEPTES = {"JPEG", "PNG", "WEBP"}
Image.MAX_IMAGE_PIXELS = 40_000_000          # protection contre les « bombes de décompression »


def chemin_photo(instance, nom_fichier):
    """Nom aléatoire : ne révèle ni le nom de l'élève ni le fichier d'origine."""
    return f"photos/{uuid.uuid4().hex}.jpg"


def preparer_photo(fichier):
    """Vérifie l'image envoyée et renvoie un JPEG d'au plus 400 px, sans métadonnées (EXIF, GPS…)."""
    if fichier.size > TAILLE_MAX_OCTETS:
        raise ValidationError("La photo dépasse 5 Mo.")
    try:
        fichier.seek(0)
        with Image.open(fichier) as verif:
            fmt = verif.format
            verif.verify()
        if fmt not in FORMATS_ACCEPTES:
            raise ValidationError("Format non accepté : utilisez une photo JPEG, PNG ou WebP.")
        fichier.seek(0)
        with Image.open(fichier) as img:
            img = ImageOps.exif_transpose(img)          # remet la photo dans le bon sens
            img = img.convert("RGB")
            img.thumbnail((COTE_MAX, COTE_MAX))
            sortie = BytesIO()
            img.save(sortie, format="JPEG", quality=85, optimize=True)   # réencodage : métadonnées supprimées
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
        raise ValidationError("Ce fichier n'est pas une image valide.")
    return ContentFile(sortie.getvalue(), name="photo.jpg")
