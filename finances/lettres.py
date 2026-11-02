"""Écriture des montants en toutes lettres (français, règles traditionnelles), pour les reçus."""

UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
          "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"]
DIZAINES = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}


def _moins_de_cent(n):
    if n < 20:
        return UNITES[n]
    d, u = divmod(n, 10)
    if d in (7, 9):                       # soixante-dix…, quatre-vingt-dix…
        base = "soixante" if d == 7 else "quatre-vingt"
        reste = 10 + u
        if d == 7 and u == 1:
            return "soixante et onze"
        return f"{base}-{UNITES[reste]}"
    if d == 8:
        return "quatre-vingts" if u == 0 else f"quatre-vingt-{UNITES[u]}"
    if u == 0:
        return DIZAINES[d]
    if u == 1:
        return f"{DIZAINES[d]} et un"
    return f"{DIZAINES[d]}-{UNITES[u]}"


def _moins_de_mille(n, final=True):
    """`final` : le nombre termine l'expression (accord de « cent » et « quatre-vingts »)."""
    c, r = divmod(n, 100)
    if c == 0:
        texte = _moins_de_cent(r)
        return texte if final or not texte.endswith("quatre-vingts") else texte[:-1]
    tete = "cent" if c == 1 else f"{UNITES[c]} cent"
    if r == 0:
        return tete + ("s" if c > 1 and final else "")
    suite = _moins_de_cent(r)
    if not final and suite.endswith("quatre-vingts"):
        suite = suite[:-1]
    return f"{tete} {suite}"


def en_lettres(n):
    """Entier positif ou nul -> texte. Ex. : 80 000 -> « quatre-vingt mille »."""
    n = int(n)
    if n < 0:
        raise ValueError("Montant négatif")
    if n == 0:
        return "zéro"
    morceaux = []
    for valeur, sing, plur in [(10**9, "milliard", "milliards"), (10**6, "million", "millions")]:
        q, n = divmod(n, valeur)
        if q:
            morceaux.append(f"{_moins_de_mille(q)} {sing if q == 1 else plur}")
    q, n = divmod(n, 1000)
    if q:
        morceaux.append("mille" if q == 1 else f"{_moins_de_mille(q, final=False)} mille")
    if n:
        morceaux.append(_moins_de_mille(n))
    return " ".join(morceaux)


def montant_en_lettres(n):
    texte = en_lettres(n)
    return f"{texte[0].upper()}{texte[1:]} francs CFA"
