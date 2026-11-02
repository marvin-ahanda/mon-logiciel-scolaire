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


def situation_classe(classe, exercice, rubrique=None, filtre="tous"):
    """Situation financière d'une classe : lignes {ins, du, verse, reste} et totaux.

    filtre : « tous », « insolvables » (reste > 0) ou « solvables » (dû entièrement réglé).
    """
    from notes.services import inscriptions_classe
    inscriptions = list(inscriptions_classe(classe, exercice).select_related("classe__niveau"))
    cs = comptes(inscriptions, exercice)
    lignes = []
    for ins in inscriptions:
        c = cs[ins.id]
        if rubrique:
            l = c.ligne(rubrique.id)
            du, verse, reste = (l.du, l.verse, l.reste) if l else (0, 0, 0)
        else:
            du, verse, reste = c.total_du, c.total_verse, c.total_reste
        if filtre == "insolvables" and reste == 0:
            continue
        if filtre == "solvables" and (reste > 0 or du == 0):
            continue
        lignes.append({"ins": ins, "du": du, "verse": verse, "reste": reste})
    return lignes, {k: sum(l[k] for l in lignes) for k in ("du", "verse", "reste")}


def paiements_periode(exercice, debut, fin, mode=""):
    """Paiements d'une période (annulés compris), les valides et les totaux par mode."""
    from django.db.models import Count
    qs = (Paiement.objects.filter(exercice=exercice, date__range=(debut, fin))
          .select_related("inscription__eleve", "inscription__classe", "rubrique", "saisi_par").order_by("date", "numero_recu"))
    if mode:
        qs = qs.filter(mode=mode)
    valides = qs.filter(annule=False)
    par_mode = [(dict(Paiement.MODES)[m], n, t) for m, n, t in
                valides.order_by("mode").values("mode").annotate(n=Count("id"), t=Sum("montant")).values_list("mode", "n", "t")]
    return qs, valides.aggregate(t=Sum("montant"))["t"] or 0, par_mode


def journal_caisse(exercice, debut, fin):
    """Journal de caisse d'une période : écolage, autres entrées et sorties (opérations non annulées).

    Renvoie (lignes chronologiques, totaux, totaux par mode) ; solde = écolage + autres entrées − sorties.
    """
    from .models import LibelleCaisse, MouvementCaisse
    lignes = []
    for p in Paiement.objects.filter(exercice=exercice, annule=False, date__range=(debut, fin)).select_related("inscription__eleve", "rubrique"):
        lignes.append({"date": p.date, "piece": f"Reçu écolage n° {p.numero_recu}", "libelle": f"Écolage — {p.rubrique}",
                       "tiers": str(p.inscription.eleve), "mode": p.get_mode_display(), "entree": p.montant, "sortie": 0, "cle": (p.date, 0, p.numero_recu)})
    for m in MouvementCaisse.objects.filter(exercice=exercice, annule=False, date__range=(debut, fin)).select_related("libelle"):
        e = m.sens == LibelleCaisse.ENTREE
        lignes.append({"date": m.date, "piece": f"{'Reçu' if e else 'Bon'} n° {m.numero}", "libelle": str(m.libelle),
                       "tiers": m.tiers, "mode": m.get_mode_display(), "entree": m.montant if e else 0, "sortie": 0 if e else m.montant,
                       "cle": (m.date, 1 if e else 2, m.numero)})
    lignes.sort(key=lambda l: l["cle"])
    ecolage = sum(l["entree"] for l in lignes if l["piece"].startswith("Reçu écolage"))
    autres = sum(l["entree"] for l in lignes) - ecolage
    sorties = sum(l["sortie"] for l in lignes)
    par_mode = defaultdict(lambda: [0, 0])
    for l in lignes:
        par_mode[l["mode"]][0] += l["entree"]
        par_mode[l["mode"]][1] += l["sortie"]
    totaux = {"ecolage": ecolage, "autres_entrees": autres, "entrees": ecolage + autres, "sorties": sorties,
              "solde": ecolage + autres - sorties}
    return lignes, totaux, sorted((mode, e, s, e - s) for mode, (e, s) in par_mode.items())
