"""Numéros de téléphone camerounais et découpage des SMS."""

import re

# Alphabet GSM 03.38 de base (un caractère = 7 bits) : 160 caractères par SMS, 153 par partie en multi-SMS.
GSM_BASE = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
GSM_EXTENSION = set("^{}\\[~]|€")          # comptent double


def normaliser_telephone(brut):
    """« 6 90 00 00 00 », « +237690000000 », « 00237 690… » -> « +237690000000 » ; None si invalide.

    Numéros camerounais à 9 chiffres commençant par 6 (mobiles) ou 2 (fixes).
    """
    if not brut:
        return None
    chiffres = re.sub(r"[\s.\-/()]", "", str(brut))
    if chiffres.startswith("+"):
        chiffres = chiffres[1:]
    elif chiffres.startswith("00"):
        chiffres = chiffres[2:]
    if not chiffres.isdigit():
        return None
    if len(chiffres) == 12 and chiffres.startswith("237"):
        chiffres = chiffres[3:]
    if len(chiffres) == 9 and chiffres[0] in "62":
        return "+237" + chiffres
    return None


def nombre_de_sms(texte):
    """Nombre de SMS facturés pour un texte (GSM 7 bits : 160/153 ; sinon Unicode : 70/67)."""
    if all(c in GSM_BASE or c in GSM_EXTENSION for c in texte):
        longueur = sum(2 if c in GSM_EXTENSION else 1 for c in texte)
        return 1 if longueur <= 160 else -(-longueur // 153)
    return 1 if len(texte) <= 70 else -(-len(texte) // 67)


# Équivalents GSM des caractères courants hors alphabet (évite le passage en Unicode, qui triple le coût).
_TRANSLITTERATION = str.maketrans({
    "â": "a", "ê": "e", "î": "i", "ô": "o", "û": "u", "ë": "e", "ï": "i", "ç": "c", "œ": "oe", "æ": "ae",
    "Â": "A", "Ê": "E", "Î": "I", "Ô": "O", "Û": "U", "Ë": "E", "Ï": "I", "À": "A", "È": "E", "Ù": "U",
    "Œ": "OE", "°": "o", "’": "'", "‘": "'", "“": '"', "”": '"', "«": '"', "»": '"', "–": "-", "—": "-",
    "…": "...", "\u00a0": " ", "\u202f": " ",
})


def translitterer(texte):
    """Remplace les caractères hors alphabet GSM par leur équivalent le plus proche (« Grâce » -> « Grace »).

    Les accents de l'alphabet GSM (é, è, à, ù, ì, ò, É, Ç) sont conservés.
    """
    return texte.translate(_TRANSLITTERATION)
