"""Crée un jeu de données fictif pour essayer l'application.

Usage : python manage.py donnees_demo
Connexion : choisir son nom dans la liste, puis saisir son code d'accès (codes fictifs affichés en fin d'exécution).
À ne pas utiliser en production.
"""

import random
from decimal import Decimal

from django.contrib.auth.models import Group, User

from comptes.models import AccesPersonnel
from comptes.roles import ADMINISTRATION, CAISSE, SURVEILLANCE
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from datetime import date, timedelta

from discipline.models import Absence, Incident, Infraction, ParametresDiscipline, Retard, Sanction
from finances.models import (Echeance, LibelleCaisse, MouvementCaisse, Paiement, PlanFinancement, Reduction, Rubrique, Tarif,
                             repartir)
from finances.services import compte
from emploi.models import Cours, Creneau
from sms.models import CreditSMS
from notes.models import BaremeDistinction, Note
from scolarite.models import (Attribution, Classe, Cycle, Eleve, Enseignant, Etablissement, Exercice, Inscription,
                              Matiere, Niveau)

NOMS = ["ABENA", "BELLA", "ESSOMBA", "FOUDA", "KAMGA", "MBARGA", "NANA", "NGONO", "NJOYA", "OWONA", "TCHOUA", "YOMBI"]
PRENOMS = ["Aline", "Bruno", "Carine", "Daniel", "Estelle", "Franck", "Grâce", "Hervé", "Inès", "Joël", "Laure", "Marc"]
CODES_PROFS = ["fr4p25", "an4p25", "ma4p25", "sv4p25", "hg4p25", "ep4p25", "nf4p25"]   # un code personnel par enseignant
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
                                     nom_en="Otourix Demonstration College", devise_en="Work – Discipline – Success",
                                     ville="Yaoundé", telephone="+237 600 000 000", nom_chef="M. Le Principal")
        ex = Exercice.objects.create(libelle="2025-2026", actif=True)
        sequences = list(ex.sequences.all())
        cycle = Cycle.objects.create(libelle="Premier cycle")
        niveaux = [Niveau.objects.create(libelle=l, cycle=cycle, ordre=i) for i, l in enumerate(["6e", "5e"], 1)]
        classes = [Classe.objects.create(libelle=f"{n.libelle} {s}", niveau=n, effectif_max=60,
                                         section_anglophone=(n.libelle == "5e" and s == "B")) for n in niveaux for s in "AB"]
        codes = {}

        def personnel(ident, code, **champs):
            u = (User.objects.create_superuser if champs.pop("superutilisateur", False) else User.objects.create_user)(
                ident, password=code, **champs)
            AccesPersonnel.objects.create(utilisateur=u, code_genere_le=timezone.now())
            codes[f"{champs.get('last_name', '')} {champs.get('first_name', '')}".strip()] = code
            return u

        personnel("admin", "ad2m25", first_name="Joël", last_name="OWONA", superutilisateur=True)
        profs = []
        for i, (code, lib, coef, gr) in enumerate(MATIERES):
            u = personnel(f"prof.{code.lower()}", f"{CODES_PROFS[i]}", first_name=PRENOMS[i], last_name=NOMS[i])
            profs.append(Enseignant.objects.create(matricule=f"ENS{i + 1:03}", nom=NOMS[i], prenom=PRENOMS[i], utilisateur=u))
        anglais = {"FR": "French", "ANG": "English", "MATH": "Mathematics", "SVT": "Biology", "HG": "History-Geography",
                   "EPS": "Physical education", "INFO": "Computer science"}
        matieres = [Matiere.objects.create(code=c, libelle=l, libelle_en=anglais[c]) for c, l, _, _ in MATIERES]
        n = 0
        rnd_age = random.Random(7)                      # générateur séparé : le reste des données ne change pas
        for classe in classes:
            attributions = [Attribution.objects.create(exercice=ex, classe=classe, matiere=m, enseignant=p, coefficient=coef, groupe=gr)
                            for m, p, (_, _, coef, gr) in zip(matieres, profs, MATIERES)]
            for _ in range(12):
                n += 1
                tel = rnd.choice([f"+237 6{rnd.randrange(50, 99)} {rnd.randrange(10, 99)} {rnd.randrange(10, 99)} {rnd.randrange(10, 99)}"] * 8 + ["", "12 34"])
                e = Eleve.objects.create(matricule=f"DEMO{n:04}", nom=rnd.choice(NOMS), prenom=rnd.choice(PRENOMS),
                                         sexe=rnd.choice("MF"), lieu_naissance="Yaoundé", telephone_parent=tel,
                                         date_naissance=date(2015 - classe.niveau.ordre, 9, 1) - timedelta(days=rnd_age.randrange(0, 900)))
                ins = Inscription.objects.create(eleve=e, classe=classe, exercice=ex, statut=rnd.choice("AAN"))
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
        # Photos fictives : initiales sur fond de couleur (aucun vrai visage)
        from io import BytesIO
        from django.core.files.base import ContentFile
        from PIL import Image, ImageDraw
        for e in Eleve.objects.all()[::2]:
            img = Image.new("RGB", (300, 375), tuple(rnd.randrange(60, 200) for _ in range(3)))
            d = ImageDraw.Draw(img)
            d.ellipse((90, 70, 210, 190), fill=(235, 235, 235))
            d.rectangle((60, 220, 240, 375), fill=(235, 235, 235))
            d.text((150, 130), (e.prenom[:1] + e.nom[:1]).upper(), fill=(60, 60, 60), anchor="mm", font_size=56)
            tampon = BytesIO(); img.save(tampon, format="JPEG", quality=85)
            e.photo.save("demo.jpg", ContentFile(tampon.getvalue()), save=True)
        # Emploi du temps : créneaux et grilles sans conflit (volume horaire = coefficient)
        from datetime import time
        horaires = [(7, 30, 8, 25), (8, 25, 9, 20), (9, 20, 10, 15), (10, 15, 10, 30, True), (10, 30, 11, 25),
                    (11, 25, 12, 20), (13, 30, 14, 25), (14, 25, 15, 20)]
        creneaux = [Creneau.objects.create(ordre=i, heure_debut=time(h[0], h[1]), heure_fin=time(h[2], h[3]), pause=len(h) > 4)
                    for i, h in enumerate(horaires, 1)]
        places = [(j, c) for j in range(1, 6) for c in creneaux if not c.pause]
        occupe = set()                                    # (enseignant, jour, créneau)
        for classe in classes:
            libres = places[:]
            rnd.shuffle(libres)
            for a in Attribution.objects.filter(exercice=ex, classe=classe):
                for _ in range(a.coefficient):
                    for k, (j, c) in enumerate(libres):
                        if (a.enseignant_id, j, c.id) not in occupe:
                            Cours.objects.create(exercice=ex, classe=classe, jour=j, creneau=c, attribution=a,
                                                 salle=f"Salle {classes.index(classe) + 1}")
                            occupe.add((a.enseignant_id, j, c.id))
                            libres.pop(k)
                            break
        # Écolage
        rubriques = [Rubrique.objects.create(libelle=l, ordre=i, echeance=e) for i, (l, e) in enumerate(
            [("Inscription", "à l'inscription"), ("1re tranche", "avant le 31 octobre"), ("2e tranche", "avant le 31 janvier")], 1)]
        for niv in niveaux:
            for statut, ins_prix in [("N", 15000), ("A", 10000)]:
                for r, prix in zip(rubriques, [ins_prix, 40000, 35000]):
                    Tarif.objects.create(exercice=ex, rubrique=r, niveau=niv, statut=statut, montant=prix)
        caissier = personnel("caisse", "ca5s25", first_name="Laure", last_name="TCHOUA")
        caissier.groups.add(Group.objects.get(name=CAISSE))
        directeur = personnel("dir.etudes", "de7t25", first_name="Inès", last_name="NJOYA", is_staff=True)
        directeur.groups.add(Group.objects.get(name=ADMINISTRATION))
        surveillant = personnel("surveillant", "su8g25", first_name="Marc", last_name="YOMBI")
        surveillant.groups.add(Group.objects.get(name=SURVEILLANCE))
        for ins in Inscription.objects.filter(exercice=ex).select_related("classe"):
            jour = debut
            for r in rubriques:
                du = Tarif.objects.get(exercice=ex, rubrique=r, niveau=ins.classe.niveau, statut=ins.statut).montant
                part = rnd.choice([1, 1, 1, 0.5, 0])
                if part:
                    jour += timedelta(days=rnd.randrange(1, 30))
                    mode = rnd.choice(["ESP", "ESP", "OM", "MTN", "CAM"])
                    Paiement.enregistrer(inscription=ins, rubrique=r, montant=int(du * part), date=jour, mode=mode,
                                         reference=f"TX{rnd.randrange(10**8):08}" if mode in ("OM", "MTN") else "", saisi_par=caissier)
            if rnd.random() < 0.08 and compte(ins).ligne(rubriques[2].id).reste >= 10000:
                Reduction.objects.create(inscription=ins, rubrique=rubriques[2], montant=10000, motif="Enfant du personnel", saisi_par=caissier)
        # Plans de financement pour quelques élèves ayant un reste à payer (certains déjà en retard)
        aujourd_hui = date.today()
        avec_reste = [i for i in Inscription.objects.filter(exercice=ex) if compte(i).total_reste > 0][:5]
        for k, ins in enumerate(avec_reste):
            c = compte(ins)
            plan = PlanFinancement.objects.create(inscription=ins, deja_verse=c.total_verse, motif="Difficultés passagères", cree_par=directeur)
            for d, m in repartir(c.total_reste, 3, aujourd_hui - timedelta(days=45 - 20 * k)):
                Echeance.objects.create(plan=plan, date=d, montant=m)
        # Année antérieure 2024-2025 : quelques élèves n'ont pas tout réglé, un élève est parti en devant de l'argent
        ex0 = Exercice.objects.create(libelle="2024-2025")
        for niv in niveaux:
            for statut in "AN":
                for r, prix in zip(rubriques, [10000, 40000, 35000]):
                    Tarif.objects.create(exercice=ex0, rubrique=r, niveau=niv, statut=statut, montant=prix)
        num = 0
        for ins in list(Inscription.objects.filter(exercice=ex).select_related("eleve", "classe"))[::6]:
            ancienne = Inscription.objects.create(eleve=ins.eleve, classe=ins.classe, exercice=ex0, statut="N")
            for r, verse in zip(rubriques, [10000, 40000, rnd.choice([0, 15000, 20000])]):
                if verse:
                    num += 1
                    Paiement.objects.create(exercice=ex0, inscription=ancienne, rubrique=r, montant=verse, numero_recu=num,
                                            date=date(2025, 3, 1), saisi_par=caissier)
        parti = Eleve.objects.create(matricule="DEMO-PARTI", nom="EBODE", prenom="Samuel", sexe="M", telephone_parent="+237 690 000 000")
        Inscription.objects.create(eleve=parti, classe=classes[0], exercice=ex0, statut="N")
        # Caisse générale
        entrees = [LibelleCaisse.objects.create(libelle=l, sens="E") for l in ["Vente de tenues", "Frais d'examen blanc", "Location de salle"]]
        sorties = [LibelleCaisse.objects.create(libelle=l, sens="S") for l in ["Fournitures de bureau", "Salaires vacataires", "Entretien et réparations"]]
        for k in range(12):
            jour = debut + timedelta(days=rnd.randrange(0, 60))
            MouvementCaisse.enregistrer(ex, libelle=rnd.choice(entrees), montant=rnd.choice([2500, 5000, 7500, 15000]), date=jour,
                                        tiers=f"Parent {rnd.choice(NOMS)}", saisi_par=caissier)
            if k % 2:
                MouvementCaisse.enregistrer(ex, libelle=rnd.choice(sorties), montant=rnd.choice([10000, 25000, 40000]), date=jour,
                                            tiers=rnd.choice(["Librairie du Centre", "M. Vacataire", "Quincaillerie Mvog-Ada"]), saisi_par=caissier)
        CreditSMS.objects.create(quantite=500, note="Crédit de démonstration", ajoute_par=directeur)
        self.stdout.write(self.style.SUCCESS(
            f"Données de démonstration créées : {len(classes)} classes, {n} élèves, {len(profs)} enseignants.\n"
            "Codes d'accès (fictifs) :\n" + "\n".join(f"  {nom} : {code}" for nom, code in sorted(codes.items()))))
