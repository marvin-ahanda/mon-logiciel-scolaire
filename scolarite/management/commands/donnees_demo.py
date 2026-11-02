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

from datetime import date, timedelta

from discipline.models import Absence, Incident, Infraction, ParametresDiscipline, Retard, Sanction
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
        sequences = list(ex.sequences.all())
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
                progression = rnd.uniform(-0.4, 0.6)       # évolution au fil de l'année
                for seq in sequences:
                    for a in attributions:
                        if rnd.random() < 0.95:   # quelques élèves non évalués
                            v = max(0, min(20, rnd.gauss(niveau + progression * (seq.numero - 1), 2.5)))
                            Note.objects.create(inscription=ins, attribution=a, sequence=seq,
                                                valeur=Decimal(str(round(v * 4) / 4)))
        for t, inf, sup in [("TH", "12", "14"), ("ENC", "14", "16"), ("FEL", "16", "20.01"), ("AVT", "8", "10")]:
            BaremeDistinction.objects.create(exercice=ex, type=t, borne_inf=Decimal(inf), borne_sup=Decimal(sup),
                                             conduite_min=Decimal("14") if t in ("TH", "ENC", "FEL") else None)
        # Discipline
        ParametresDiscipline.objects.create(exercice=ex, points_par_retard=Decimal("0.5"), points_par_heure_absence=Decimal("0.25"))
        sanctions = {lib: Sanction.objects.create(libelle=lib, points_perdus=Decimal(pts)) for lib, pts in
                     [("Avertissement de conduite", "1"), ("Blâme de conduite", "3"), ("Exclusion temporaire", "6")]}
        infractions = [Infraction.objects.create(libelle=lib, sanction=sanctions[san]) for lib, san in
                       [("Bavardage répété", "Avertissement de conduite"), ("Tenue non conforme", "Avertissement de conduite"),
                        ("Insolence", "Blâme de conduite"), ("Bagarre", "Exclusion temporaire")]]
        debut = date(2025, 9, 8)
        for ins in Inscription.objects.filter(exercice=ex):
            for seq in sequences:
                for _ in range(rnd.choice([0, 0, 1, 2, 3])):
                    jour = debut + timedelta(days=(seq.numero - 1) * 42 + rnd.randrange(0, 40))
                    if rnd.random() < 0.6:
                        Absence.objects.update_or_create(inscription=ins, date=jour, defaults={
                            "sequence": seq, "heures_non_justifiees": rnd.choice([0, 2, 2, 4]),
                            "heures_justifiees": rnd.choice([0, 0, 2]), "motif": "Certificat médical"})
                    else:
                        Retard.objects.get_or_create(inscription=ins, date=jour, defaults={"sequence": seq})
                if rnd.random() < 0.12:
                    Incident.objects.create(inscription=ins, sequence=seq, infraction=rnd.choice(infractions),
                                            date=debut + timedelta(days=(seq.numero - 1) * 42 + rnd.randrange(0, 40)))
        BaremeDistinction.objects.create(exercice=ex, type="BLA", borne_sup=Decimal("8"))
        self.stdout.write(self.style.SUCCESS(
            f"Données de démonstration créées : {len(classes)} classes, {n} élèves, {len(profs)} enseignants.\n"
            "Comptes : admin / Demo-Admin-2025 ; prof.math / Demo-Prof-2025 (et prof.fr, prof.ang…)."))
