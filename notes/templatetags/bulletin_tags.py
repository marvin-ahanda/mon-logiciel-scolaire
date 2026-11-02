from django import template

from notes.traductions import traduire

register = template.Library()


@register.filter
def tr(valeur, langue):
    """{{ r.appreciation|tr:langue }} — traduit une valeur calculée du bulletin."""
    return traduire(valeur, langue)


@register.filter
def tr_liste(valeurs, langue):
    """Traduit chaque élément d'une liste (distinctions…) et les joint par des virgules."""
    return ", ".join(str(traduire(v, langue)) for v in valeurs)

