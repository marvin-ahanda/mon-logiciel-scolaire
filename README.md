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
| Élèves | Fiche avec photo, inscription dans une classe pour l'exercice actif, recherche et filtre par classe |
| Saisie des notes | Grille par classe, matière et séquence ; navigation au clavier (Entrée) ; case vide = non évalué |
| Résultats | Par séquence, trimestre ou année : moyennes pondérées, rangs (ex æquo), moyennes par groupe, statistiques de classe |
| Discipline | Appel du jour (heures d'absence non justifiées et justifiées avec motif, retards), infractions liées à des sanctions, suivi disciplinaire par période, note de discipline sur les bulletins |
| Écolage | Rubriques et tarifs par niveau et statut (ancien / nouvel élève), caisse avec reçus numérotés (montant en lettres, 2 exemplaires), espèces, Orange Money, MTN Mobile Money, Campost ; réductions, remboursements, annulation tracée ; insolvables / solvables par classe et rubrique ; journal des encaissements |
| Bulletins | Séquentiels, trimestriels et annuels, A4 imprimables (un élève ou toute la classe), **en français ou en anglais** : appréciations, compétences, distinctions ; bulletin annuel avec moyennes trimestrielles et décision de passage proposée |

## Rôles d'accès

| | Administration | Caissier | Surveillant général | Enseignant |
|---|---|---|---|---|
| Paramètres, élèves, enseignants, comptes utilisateurs | ✅ | — | — | — |
| Discipline : appel du jour, infractions, suivi | ✅ | — | ✅ | — |
| Paramétrage de la discipline (sanctions, barème) | ✅ | — | — | — |
| Encaisser, reçus, situation des classes, journal des encaissements | ✅ | ✅ | — | — |
| Annuler un paiement | ✅ tous | ✅ les siens, le jour même | — | — |
| Réductions, remboursements, tarifs | ✅ | — | — | — |
| Saisie des notes | ✅ toutes | — | — | ✅ ses matières |
| Résultats et bulletins | ✅ | — | — | ✅ ses classes |

- **Administration** : le principal et ses proches collaborateurs (directeurs des études…), tous les droits.
- **Caissier** : encaisse ; ne peut ni réduire ni rembourser. Il peut annuler ses propres paiements le jour même
  (heure réelle d'enregistrement, motif obligatoire) ; au-delà, l'annulation revient à l'administration.
- **Surveillant général** : discipline au quotidien ; le paramétrage (sanctions, barème) reste à l'administration.
- **Enseignant** : compte créé depuis la fiche de l'enseignant.

Les comptes Administration, Caissier et Surveillant général se gèrent dans *Paramètres → Comptes utilisateurs et rôles*
(création, changement de rôle, désactivation, nouveau mot de passe). Garde-fous : on ne peut ni retirer
ses propres droits, ni désactiver le dernier compte d'administration actif. Techniquement, les rôles sont
des groupes Django (« Administration », « Caisse », « Surveillance ») ; un superutilisateur a toujours tous les droits.

## Règles reprises de l'original

- **Moyenne** = Σ(note × coefficient) / Σ(coefficients des matières évaluées), arrondie à 2 décimales.
  Une matière non évaluée est exclue de la moyenne (comportement « ELEVE NON EVALUE » de l'original).
- **Classement** : un élève n'est classé que si le total des coefficients des matières où il est évalué
  atteint le seuil de sa classe (« Classer si total de coefficients est supérieur ou égal à » dans l'original).
- **Note trimestrielle d'une matière** = moyenne des notes séquentielles disponibles du trimestre ;
  **note annuelle** = moyenne des notes trimestrielles disponibles. ⚠️ Règle d'usage camerounais :
  la formule exacte de l'original n'a pas pu être confirmée dans le binaire.
- **Décision proposée** (bulletin annuel) : admis si la moyenne annuelle atteint la moyenne de passage de l'exercice (10 par défaut).
- **Écolage** : tarif selon le niveau et le statut de l'élève ; un paiement ou une réduction ne peut pas dépasser
  le reste à verser de la rubrique ; un remboursement ne peut pas dépasser le montant versé. Une erreur de
  paiement s'annule avec un motif (l'original gardait un historique des « paiements modifiés »).
  Filtre écolage des bulletins : n'imprimer que pour les élèves dont les versements dépassent un montant.
- **Bulletins bilingues** (option « Français / Anglais » de l'original) : par défaut, anglais pour une classe de la
  section anglophone, français sinon ; la langue peut être forcée au moment d'imprimer. Libellés, appréciations
  (*Very good*, *Fairly good*…), compétences (*Not acquired*, *Being acquired*, *Acquired*, *Expert*), distinctions,
  décision et format des nombres suivent la langue. Noms anglais facultatifs pour les matières et l'établissement ;
  les libellés saisis en français (types d'infractions…) restent en français.
- **Photos des élèves** (« Insérer la photo de l'élève » dans l'original) : JPEG, PNG ou WebP de 5 Mo au plus,
  redimensionnées à 400 px et réencodées en JPEG (métadonnées EXIF/GPS supprimées), sous un nom aléatoire.
  Données de mineurs : elles ne sont servies que par une vue protégée (administration, caisse, surveillance,
  enseignants de la classe), jamais comme fichiers publics. Option d'affichage sur les bulletins.
- **Appréciations** : [0;3[ Nul · [3;4,5[ Très faible · [4,5;7,5[ Faible · [7,5;9[ Insuffisant · [9;10[ Médiocre ·
  [10;12[ Passable · [12;14[ Assez bien · [14;16[ Bien · [16;18[ Très bien · [18;20] Excellent.
- **Compétences** : [0;10] Non acquis · ]10;14] En cours d'acquisition · ]14;17] Acquis · ]17;20] Expert.
- **Distinctions** (barèmes par exercice, dans l'administration avancée) : tableau d'honneur, encouragements,
  félicitations, avertissement = moyenne dans [borne inf. ; borne sup.[ ; blâme = moyenne < seuil.
  Pour le tableau d'honneur, les encouragements et les félicitations, condition facultative
  « note de conduite strictement supérieure à » (comme dans l'original).
- **Note de discipline** = 20 − (retards × points par retard + heures d'absence non justifiées × points par heure
  + points des sanctions), jamais négative ; barème réglable par exercice. Rubriques de l'original :
  ponctualité, assiduité, autres cas. ⚠️ La formule exacte de l'original n'a pas pu être confirmée dans le binaire.

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
puis connexion avec `admin` / `Demo-Admin-2025` ou `dir.etudes` / `Demo-Directeur-2025` (administration),
`caisse` / `Demo-Caisse-2025` (caissier), `surveillant` / `Demo-Surveillant-2025` (surveillant général) ou `prof.math` / `Demo-Prof-2025` (enseignant).

**Tests :** `python manage.py test`

## Premiers pas après installation

1. *Administration avancée* : renseigner l'établissement, les cycles et les niveaux.
2. *Paramètres → Exercices* : créer l'exercice (ex. 2025-2026) et l'activer.
3. *Classes*, puis pour chaque classe *Matières et coefficients*.
4. *Enseignants* (avec identifiant et mot de passe) et *Élèves* (avec leur classe).
5. *Administration avancée → Barèmes de distinction* : définir les seuils.
6. *Écolage → Rubriques* puis *Tarifs* (bouton de reconduction depuis l'exercice précédent).
7. *Discipline* : définir les sanctions (points perdus), les types d'infractions et le barème de la note de discipline.

## Mise en production

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `OTOURIX_DEBUG=0` | Obligatoire en production |
| `OTOURIX_SECRET_KEY` | Clé secrète longue et aléatoire (obligatoire) |
| `OTOURIX_ALLOWED_HOSTS` | Noms d'hôte autorisés, séparés par des virgules |
| `DATABASE_URL` | `postgres://utilisateur:motdepasse@hote:5432/base` (nécessite `pip install "psycopg[binary]"`) |
| `OTOURIX_HTTPS=0` | Uniquement pour un serveur sur le réseau local sans certificat (cookies non chiffrés en transit) |

Les photos sont stockées dans `media/` (ou `OTOURIX_MEDIA_ROOT`) : **ne publiez jamais ce dossier** sur le
serveur web, et incluez-le dans vos sauvegardes avec la base de données.

Puis `python manage.py collectstatic` et un serveur d'application (par ex. gunicorn derrière nginx,
ou waitress sous Windows). Ne réutilisez jamais un compte administrateur de base de données
pour l'application : l'original se connectait en `sa`, ce qui est à proscrire.

## Feuille de route (modules de l'original non encore repris)

Caisse générale (autres entrées et sorties), plan de financement, dettes des années antérieures, SMS aux parents, emploi du temps, cartes scolaires, statistiques avancées,
import et export Excel.
