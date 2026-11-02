from django import template

register = template.Library()

ESPACE_FINE = " "
ESPACE_INSECABLE = " "
MOINS = "−"


@register.filter
def fcfa(valeur):
    """125000 -> « 125 000 F » (espaces fines insécables) ; -5000 -> « −5 000 F »."""
    try:
        v = int(valeur)
    except (TypeError, ValueError):
        return ""
    return (MOINS if v < 0 else "") + f"{abs(v):,}".replace(",", ESPACE_FINE) + ESPACE_INSECABLE + "F"
