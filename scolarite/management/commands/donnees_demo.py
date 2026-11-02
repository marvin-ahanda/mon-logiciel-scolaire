"""Crée un jeu de données fictif pour essayer l'application.

Usage : python manage.py donnees_demo
Comptes créés : admin / Demo-Admin-2025 (administration), prof.maths / Demo-Prof-2025 (enseignant).
À ne pas utiliser en production.
"""

import random
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from notes.models import BaremeDistinction, Note
from scolarite.models import (Attribution, Classe, Cycle, Eleve, Enseignant, Etablissement, Exercice, Inscription,
                              Matiere, Niveau)

NOMS = ["ABENA", "BELLA", "ESSOMBA", "FOUDA", "KAMGA", "MBARGA", "NANA", "NGONO", "NJOYA", "OWONA", "TCHOUA", "YOMBI"]
PRENOMS = ["Aline", "Bruno", "Carine", "Daniel", "Estelle", "Franck", "Grâce", "Hervé", "Inès", "Joël", "Laure", "Marc"]
MATIERES = [("FR", "Français", 4, 1), ("ANG", "Anglais", 3, 1), ("MATH", "Mathématiques", 4, 1),
            ("SVT", "Sciences de la vie et de la Terre", 2, 2), ("HG", "Histoire-Géographie", 2, 2),
            ("EPS", "Éducation physique et sportive", 1, 3), ("INFO", "Informatique", 1, 3)]


class Command(BaseCommand):
    help = "Crée des données de démonstration fictives."

    @transaction.atomic
    def handle(self, *args, **opts):
        if Exercice.objects.exists():
            raise CommandError("La base contient déjà des données : commande réservée à une base vide.")
        rnd = random.Random(2025)
        Etablissement.objects.create(nom="Collège de démonstration Otourix", devise="Travail – Discipline – Réussite",
                                     ville="Yaoundé", telephone="+237 600 000 000", nom_chef="M. Le Principal")
        ex = Exercice.objects.create(libelle="2025-2026", actif=True)
        cycle = Cycle.objects.create(libelle="Premier cycle")
        niveaux = [Niveau.objects.create(libelle=l, cycle=cycle, ordre=i) for i, l in enumerate(["6e", "5e"], 1)]
        classes = [Classe.objects.create(libelle=f"{n.libelle} {s}", niveau=n, effectif_max=60) for n in niveaux for s in "AB"]
        User.objects.create_superuser("admin", password="Demo-Admin-2025", first_name="Admin", last_name="Démo")
        profs = []
        for i, (code, lib, coef, gr) in enumerate(MATIERES):
            u = User.objects.create_user(f"prof.{code.lower()}", password="Demo-Prof-2025", last_name=f"Prof {lib}")
            profs.append(Enseignant.objects.create(matricule=f"ENS{i + 1:03}", nom=NOMS[i], prenom=PRENOMS[i], utilisateur=u))
        matieres = [Matiere.objects.create(code=c, libelle=l) for c, l, _, _ in MATIERES]
        n = 0
        for classe in classes:
            attributions = [Attribution.objects.create(exercice=ex, classe=classe, matiere=m, enseignant=p, coefficient=coef, groupe=gr)
                            for m, p, (_, _, coef, gr) in zip(matieres, profs, MATIERES)]
            for _ in range(12):
                n += 1
                e = Eleve.objects.create(matricule=f"DEMO{n:04}", nom=rnd.choice(NOMS), prenom=rnd.choice(PRENOMS),
                                         sexe=rnd.choice("MF"), lieu_naissance="Yaoundé")
                ins = Inscription.objects.create(eleve=e, classe=classe, exercice=ex)
                niveau = rnd.uniform(6, 16)
                for a in attributions:
                    if rnd.random() < 0.95:   # quelques élèves non évalués
                        v = max(0, min(20, rnd.gauss(niveau, 2.5)))
                        Note.objects.create(inscription=ins, attribution=a, sequence=ex.sequences.get(numero=1),
                                            valeur=Decimal(str(round(v * 4) / 4)))
        for t, inf, sup in [("TH", "12", "14"), ("ENC", "14", "16"), ("FEL", "16", "20.01"), ("AVT", "8", "10")]:
            BaremeDistinction.objects.create(exercice=ex, type=t, borne_inf=Decimal(inf), borne_sup=Decimal(sup))
        BaremeDistinction.objects.create(exercice=ex, type="BLA", borne_sup=Decimal("8"))
        self.stdout.write(self.style.SUCCESS(
            f"Données de démonstration créées : {len(classes)} classes, {n} élèves, {len(profs)} enseignants.\n"
            "Comptes : admin / Demo-Admin-2025 ; prof.math / Demo-Prof-2025 (et prof.fr, prof.ang…)."))
