from django import template

register = template.Library()


@register.filter
def fcfa(valeur):
    """125000 -> « 125 000 F » (espaces fines insécables)."""
    try:
        return f"{int(valeur):,}".replace(",", " ") + " F"
    except (TypeError, ValueError):
        return ""
