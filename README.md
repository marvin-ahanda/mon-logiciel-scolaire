# OtourixSchool (version web)

Nouvelle version web d'OtourixSchool, le logiciel de gestion des notes scolaires.
Elle remplace l'application Visual Basic 6 d'origine, dont les sources et les données sont perdues.
Les règles de calcul ont été reprises par rétro-ingénierie du binaire d'origine (`OtourixSchool.exe`, 2023).

**Pile technique :** Python 3.11+, Django 5.2 LTS, Bootstrap 5.3 (intégré localement, fonctionne sans Internet),
SQLite pour le développement et PostgreSQL recommandé en production.

## Fonctionnalités du noyau

| Domaine | Ce qui est disponible |
|---|---|
| Connexion | Comptes administration et enseignants, changement de mot de passe |
| Exercices | Création, un seul exercice actif, 6 séquences créées automatiquement (2 par trimestre) |
| Séquences | Verrouillage et déverrouillage : une séquence fermée refuse toute saisie |
| Classes | Niveaux, cycles, section anglophone, classe d'examen, effectif maximal |
| Matières | Par classe : enseignant, coefficient, groupe (1er, 2e, 3e) |
| Élèves | Fiche, inscription dans une classe pour l'exercice actif, recherche et filtre par classe |
| Saisie des notes | Grille par classe, matière et séquence ; navigation au clavier (Entrée) ; case vide = non évalué |
| Résultats | Par séquence, trimestre ou année : moyennes pondérées, rangs (ex æquo), moyennes par groupe, statistiques de classe |
| Bulletins | Séquentiels, trimestriels et annuels, A4 imprimables (un élève ou toute la classe) : appréciations, compétences, distinctions ; bulletin annuel avec moyennes trimestrielles et décision de passage proposée |

Droits d'accès : l'administration (`is_staff`) gère tout. Un enseignant saisit uniquement les notes
de ses matières, et consulte résultats et bulletins des classes où il enseigne.

## Règles reprises de l'original

- **Moyenne** = Σ(note × coefficient) / Σ(coefficients des matières évaluées), arrondie à 2 décimales.
  Une matière non évaluée est exclue de la moyenne (comportement « ELEVE NON EVALUE » de l'original).
- **Classement** : un élève n'est classé que si le total des coefficients des matières où il est évalué
  atteint le seuil de sa classe (« Classer si total de coefficients est supérieur ou égal à » dans l'original).
- **Note trimestrielle d'une matière** = moyenne des notes séquentielles disponibles du trimestre ;
  **note annuelle** = moyenne des notes trimestrielles disponibles. ⚠️ Règle d'usage camerounais :
  la formule exacte de l'original n'a pas pu être confirmée dans le binaire.
- **Décision proposée** (bulletin annuel) : admis si la moyenne annuelle atteint la moyenne de passage de l'exercice (10 par défaut).
- **Appréciations** : [0;3[ Nul · [3;4,5[ Très faible · [4,5;7,5[ Faible · [7,5;9[ Insuffisant · [9;10[ Médiocre ·
  [10;12[ Passable · [12;14[ Assez bien · [14;16[ Bien · [16;18[ Très bien · [18;20] Excellent.
- **Compétences** : [0;10] Non acquis · ]10;14] En cours d'acquisition · ]14;17] Acquis · ]17;20] Expert.
- **Distinctions** (barèmes par exercice, dans l'administration avancée) : tableau d'honneur, encouragements,
  félicitations, avertissement = moyenne dans [borne inf. ; borne sup.[ ; blâme = moyenne < seuil.
  La condition sur la note de conduite viendra avec le module discipline.

## Installation (développement)

Sous Windows (PowerShell) :

```powershell
py -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py createsuperuser
.venv\Scripts\python manage.py runserver
```

Sous Linux ou macOS :

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver
```

Ouvrez ensuite http://127.0.0.1:8000.

**Données de démonstration** (base vide uniquement, données fictives) : `python manage.py donnees_demo`,
puis connexion avec `admin` / `Demo-Admin-2025` ou `prof.math` / `Demo-Prof-2025`.

**Tests :** `python manage.py test`

## Premiers pas après installation

1. *Administration avancée* : renseigner l'établissement, les cycles et les niveaux.
2. *Paramètres → Exercices* : créer l'exercice (ex. 2025-2026) et l'activer.
3. *Classes*, puis pour chaque classe *Matières et coefficients*.
4. *Enseignants* (avec identifiant et mot de passe) et *Élèves* (avec leur classe).
5. *Administration avancée → Barèmes de distinction* : définir les seuils.

## Mise en production

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `OTOURIX_DEBUG=0` | Obligatoire en production |
| `OTOURIX_SECRET_KEY` | Clé secrète longue et aléatoire (obligatoire) |
| `OTOURIX_ALLOWED_HOSTS` | Noms d'hôte autorisés, séparés par des virgules |
| `DATABASE_URL` | `postgres://utilisateur:motdepasse@hote:5432/base` (nécessite `pip install "psycopg[binary]"`) |
| `OTOURIX_HTTPS=0` | Uniquement pour un serveur sur le réseau local sans certificat (cookies non chiffrés en transit) |

Puis `python manage.py collectstatic` et un serveur d'application (par ex. gunicorn derrière nginx,
ou waitress sous Windows). Ne réutilisez jamais un compte administrateur de base de données
pour l'application : l'original se connectait en `sa`, ce qui est à proscrire.

## Feuille de route (modules de l'original non encore repris)

Discipline (absences, retards, sanctions, note de conduite),
finances et écolage, SMS aux parents, emploi du temps, cartes scolaires, statistiques avancées,
bulletins bilingues (français / anglais), photos des élèves, import et export Excel.
