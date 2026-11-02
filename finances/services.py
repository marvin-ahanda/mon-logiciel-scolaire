"""Comptes d'écolage : dû, réductions, versements et reste, par élève et par rubrique."""

from collections import defaultdict
from dataclasses import dataclass, field

from django.db.models import Sum

from .models import Paiement, Reduction, Remboursement, Rubrique, Tarif


@dataclass
class LigneCompte:
    rubrique: Rubrique
    tarif: int = 0
    reductions: int = 0
    verse: int = 0

    @property
    def du(self):
        return max(0, self.tarif - self.reductions)

    @property
    def reste(self):
        return max(0, self.du - self.verse)

    @property
    def solde(self):
        return self.reste == 0 and self.tarif > 0


@dataclass
class Compte:
    inscription: object
    lignes: list = field(default_factory=list)
    rembourse: int = 0

    def ligne(self, rubrique_id):
        return next((l for l in self.lignes if l.rubrique.id == rubrique_id), None)

    @property
    def total_tarif(self):
        return sum(l.tarif for l in self.lignes)

    @property
    def total_reductions(self):
        return sum(l.reductions for l in self.lignes)

    @property
    def total_du(self):
        return sum(l.du for l in self.lignes)

    @property
    def total_verse(self):
        return sum(l.verse for l in self.lignes)

    @property
    def total_reste(self):
        return sum(l.reste for l in self.lignes)

    @property
    def remboursable(self):
        return max(0, self.total_verse - self.rembourse)


def _par_inscription_et_rubrique(qs):
    d = defaultdict(int)
    for i, r, t in qs.order_by().values("inscription_id", "rubrique_id").annotate(t=Sum("montant")).values_list("inscription_id", "rubrique_id", "t"):
        d[(i, r)] = t or 0
    return d


def comptes(inscriptions, exercice):
    """Comptes d'écolage d'une liste d'inscriptions (même exercice), en un nombre fixe de requêtes."""
    inscriptions = list(inscriptions)
    ids = [i.id for i in inscriptions]
    rubriques = list(Rubrique.objects.all())
    tarifs = {(t.rubrique_id, t.niveau_id, t.statut): t.montant for t in Tarif.objects.filter(exercice=exercice)}
    verses = _par_inscription_et_rubrique(Paiement.objects.filter(inscription_id__in=ids, annule=False))
    reductions = _par_inscription_et_rubrique(Reduction.objects.filter(inscription_id__in=ids))
    rembourses = dict(Remboursement.objects.filter(inscription_id__in=ids).order_by().values("inscription_id")
                      .annotate(t=Sum("montant")).values_list("inscription_id", "t"))
    resultat = {}
    for ins in inscriptions:
        c = Compte(inscription=ins, rembourse=rembourses.get(ins.id, 0) or 0)
        for r in rubriques:
            tarif = tarifs.get((r.id, ins.classe.niveau_id, ins.statut), 0)
            ligne = LigneCompte(rubrique=r, tarif=tarif, reductions=reductions[(ins.id, r.id)], verse=verses[(ins.id, r.id)])
            if tarif or ligne.verse or ligne.reductions:
                c.lignes.append(ligne)
        resultat[ins.id] = c
    return resultat


def compte(inscription):
    return comptes([inscription], inscription.exercice)[inscription.id]


def total_verse_par_inscription(inscription_ids):
    return dict(Paiement.objects.filter(inscription_id__in=inscription_ids, annule=False).order_by().values("inscription_id")
                .annotate(t=Sum("montant")).values_list("inscription_id", "t"))
