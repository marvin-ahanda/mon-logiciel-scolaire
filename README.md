# NexIASchool (version web)

Nouvelle version web de NexIASchool, le logiciel de gestion des notes scolaires.
Elle remplace l'application Visual Basic 6 d'origine, dont les sources et les données sont perdues.
Les règles de calcul ont été reprises par rétro-ingénierie du binaire du logiciel d'origine (2023).

**Pile technique :** Python 3.11+, Django 5.2 LTS, Bootstrap 5.3 (intégré localement, fonctionne sans Internet),
SQLite pour le développement et PostgreSQL recommandé en production.

## Fonctionnalités du noyau

| Domaine | Ce qui est disponible |
|---|---|
| Connexion | Liste des noms du personnel (A à Z) et code d'accès personnel de 6 caractères généré automatiquement ; blocage de 15 min après 5 codes erronés |
| Exercices | Création, un seul exercice actif, 6 séquences créées automatiquement (2 par trimestre) |
| Séquences | Verrouillage et déverrouillage : une séquence fermée refuse toute saisie |
| Classes | Niveaux, cycles, section anglophone, classe d'examen, effectif maximal |
| Matières | Par classe : enseignant, coefficient, groupe (1er, 2e, 3e) |
| Élèves | Fiche avec photo, inscription dans une classe pour l'exercice actif, recherche et filtre par classe |
| Saisie des notes | Grille par classe, matière et séquence ; navigation au clavier (Entrée) ; case vide = non évalué |
| Résultats | Par séquence, trimestre ou année : moyennes pondérées, rangs (ex æquo), moyennes par groupe, statistiques de classe |
| Caisse générale | Autres entrées (reçus) et sorties (bons de caisse) avec libellés, tiers et élève facultatif ; journal de caisse avec solde |
| Plan de financement | Échéancier mensuel accordé par l'administration ; suivi des échéances payées, en retard, à venir ; liste des élèves en retard |
| Dettes antérieures | Arriérés des années précédentes sur le compte de l'élève et dans la caisse ; règlement encaissé dans l'exercice actif ; état des débiteurs, y compris les élèves partis |
| SMS aux parents | Résultats, rappels d'écolage, absences, message libre, notification au paiement ; aperçu avant envoi ; crédits SMS ; journal des envois |
| Statistiques | Réservées à l'administration : répartition des moyennes par tranche et par sexe (histogramme et tableau), statistiques par matière, comparaison des classes et des niveaux, effectifs par classe, sexe et âge |
| Cartes scolaires | Cartes au format carte bancaire (85,6 × 54 mm), 10 par page A4, avec photo, bilingues ; par classe ou pour un élève |
| Emploi du temps | Créneaux horaires (avec pauses), grille par classe (matière, enseignant, salle), emploi du temps de chaque enseignant, impression ; conflits d'enseignant et de salle refusés |
| Import / export Excel | Import des élèves et des notes (modèles fournis, aperçu ligne par ligne, enregistrement tout ou rien) ; export des élèves, des résultats, de la situation financière et du journal des encaissements |
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
- **Enseignant** : accès créé depuis la fiche de l'enseignant (case « Créer son accès au logiciel »).

Les comptes Administration, Caissier et Surveillant général se gèrent dans *Paramètres → Personnel et codes d'accès*
(création, changement de rôle, désactivation, nouveau code). Garde-fous : on ne peut ni retirer
ses propres droits, ni désactiver le dernier compte d'administration actif. Techniquement, les rôles sont
des groupes Django (« Administration », « Caisse », « Surveillance ») ; un superutilisateur a toujours tous les droits.

### Connexion par nom et code d'accès

Sur la page de connexion, chaque membre du personnel choisit son nom dans une liste déroulante (classée de A à Z,
accents ignorés ; les homonymes sont distingués par leur identifiant interne), puis saisit son **code d'accès**.

- À la création d'un membre du personnel (ou d'un enseignant avec accès), un code de **6 caractères alphanumériques**
  est généré au hasard (lettres minuscules et chiffres, au moins une lettre et un chiffre ; sans i, l ni o, trop proches de 1 et 0).
  Exemple : `6e0k39`. La saisie en majuscules est acceptée.
- Le code est affiché **une seule fois**, sur une fiche imprimable à remettre à la personne. Il est ensuite enregistré
  haché, comme un mot de passe : personne, pas même l'administration, ne peut le relire.
- Code perdu : *Personnel et codes d'accès → Code d'accès → Générer un nouveau code* ; l'ancien cesse aussitôt de fonctionner.
- Après 5 codes erronés pour un même nom, l'accès est bloqué 15 minutes (un nouveau code le débloque immédiatement).
  Avec 6 caractères, ce blocage est indispensable : il empêche de deviner un code par essais successifs.
- Dépannage (administrateur ayant perdu son code) : `python manage.py code_acces <identifiant interne>`.
- L'administration avancée (`/admin/`) passe par la même page de connexion.

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
- **Caisse générale** : numérotation séparée des reçus d'entrée et des bons de sortie par exercice ; même règle
  d'annulation que pour les paiements (le caissier annule ses propres opérations du jour). Journal de caisse :
  écolage + autres entrées − sorties, opérations annulées exclues.
- **Dettes antérieures** : calculées avec les tarifs de chaque année ; un exercice est antérieur si sa désignation
  (au format « AAAA-AAAA ») précède celle de l'exercice actif. Tout paiement est encaissé dans l'exercice actif.
- **SMS** : numéros camerounais normalisés (+237, 9 chiffres commençant par 6 ou 2) ; décompte exact des SMS
  (160 caractères en alphabet GSM, 70 en Unicode) ; caractères hors alphabet GSM remplacés automatiquement
  (« Grâce » → « Grace ») pour éviter le surcoût Unicode. Crédits SMS comme dans l'original : envoi refusé
  d'avance si le crédit ne couvre pas tous les messages ; seuls les SMS réellement envoyés sont décomptés.
  La notification de paiement part après l'enregistrement du paiement ; un échec d'envoi ne l'annule jamais.
- **Emploi du temps** : un enseignant ou une salle ne peut pas être à deux endroits sur le même créneau ;
  la grille d'une classe est enregistrée d'un bloc (rien n'est modifié en cas de conflit). Modifiable par
  l'administration ; consultable par les enseignants (chacun voit le sien) et la surveillance. Les créneaux
  horaires se définissent dans l'administration avancée.
- **Import Excel** : fichiers `.xlsx` uniquement (2 Mo, 3 000 lignes au plus), formules lues comme valeurs, en-têtes
  reconnus sans tenir compte des majuscules ni des accents. Élèves : création ou mise à jour selon le matricule,
  avec contrôle des classes, de l'effectif maximal et des changements de classe. Notes : une case vide laisse la
  note inchangée ; séquence verrouillée et droits de l'enseignant respectés. Rien n'est enregistré tant qu'une
  ligne est en erreur. **Export** : les textes commençant par `=`, `+`, `-` ou `@` sont neutralisés (pas d'injection
  de formules à l'ouverture dans Excel).
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

`createsuperuser` demande un identifiant et un mot de passe : ce mot de passe sert de code à la première connexion.
Générez ensuite un vrai code avec `python manage.py code_acces <identifiant>` et renseignez vos nom et prénom
dans *Personnel et codes d'accès* pour apparaître correctement dans la liste.

**Données de démonstration** (base vide uniquement, données fictives) : `python manage.py donnees_demo`,
puis connexion en choisissant le nom et en saisissant le code (fictif) :

| Nom | Rôle | Code |
|---|---|---|
| OWONA Joël | Administration (principal) | `ad2m25` |
| NJOYA Inès | Administration (directrice des études) | `de7t25` |
| TCHOUA Laure | Caissier | `ca5s25` |
| YOMBI Marc | Surveillant général | `su8g25` |
| ESSOMBA Carine | Enseignante (mathématiques) | `ma4p25` |
| ABENA Aline, BELLA Bruno, FOUDA Daniel… | Enseignants | `fr4p25`, `an4p25`, `sv4p25`… (affichés par la commande) |

**Tests :** `python manage.py test`

## Premiers pas après installation

1. *Administration avancée* : renseigner l'établissement, les cycles et les niveaux.
2. *Paramètres → Exercices* : créer l'exercice (ex. 2025-2026) et l'activer.
3. *Classes*, puis pour chaque classe *Matières et coefficients*.
4. *Personnel et codes d'accès* (administration, caisse, surveillance), *Enseignants* (avec accès) — imprimer et remettre
   chaque fiche de code — puis *Élèves* (avec leur classe).
5. *Administration avancée → Barèmes de distinction* : définir les seuils.
6. *Écolage → Rubriques* puis *Tarifs* (bouton de reconduction depuis l'exercice précédent).
7. *Discipline* : définir les sanctions (points perdus), les types d'infractions et le barème de la note de discipline.

## Mise en production

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `NEXIA_DEBUG=0` | Obligatoire en production |
| `NEXIA_SECRET_KEY` | Clé secrète longue et aléatoire (obligatoire) |
| `NEXIA_ALLOWED_HOSTS` | Noms d'hôte autorisés, séparés par des virgules |
| `DATABASE_URL` | `postgres://utilisateur:motdepasse@hote:5432/base` (nécessite `pip install "psycopg[binary]"`) |
| `NEXIA_HTTPS=0` | Uniquement pour un serveur sur le réseau local sans certificat (cookies non chiffrés en transit) |

Les photos sont stockées dans `media/` (ou `NEXIA_MEDIA_ROOT`) : **ne publiez jamais ce dossier** sur le
serveur web, et incluez-le dans vos sauvegardes avec la base de données.

**SMS** : par défaut (`NEXIA_SMS_BACKEND=journal`), **aucun SMS n'est envoyé**, les messages sont seulement
enregistrés. Pour envoyer réellement : `NEXIA_SMS_BACKEND=http`, `NEXIA_SMS_URL=https://…` (adresse de l'API
du fournisseur), `NEXIA_SMS_TOKEN` (jeton, à garder secret) et `NEXIA_SMS_EXPEDITEUR` (11 caractères au plus).
La passerelle HTTP envoie `{"to", "from", "text"}` en JSON avec `Authorization: Bearer` : adaptez
`sms/passerelles.py` au format exact de votre fournisseur (BulkSms, IyamSms, Orange, MTN…) et testez d'abord
avec un seul numéro.

Puis `python manage.py collectstatic` et un serveur d'application (par ex. gunicorn derrière nginx,
ou waitress sous Windows). Ne réutilisez jamais un compte administrateur de base de données
pour l'application : l'original se connectait en `sa`, ce qui est à proscrire.

## Mode SaaS (plusieurs établissements, en ligne)

Avec `NEXIA_MULTI=1` et une base PostgreSQL, NexIASchool devient un service en ligne partagé par plusieurs établissements.

**Connexion en deux étapes**

1. *Nom de mon établissement* et *code de mon établissement* (8 caractères, ex. `k7m2x9qa`) : on entre dans
   l'espace de son établissement. Le nom est reconnu sans tenir compte des accents ni des majuscules.
2. Liste déroulante du personnel **de cet établissement uniquement** (A à Z) et code personnel (6 caractères).

L'établissement reste mémorisé sur l'appareil après la déconnexion (lien « Changer d'établissement »).
Après 10 codes d'établissement erronés depuis un même appareil, les essais sont bloqués 15 minutes.

**Isolation des données.** Chaque établissement a son propre schéma PostgreSQL (bibliothèque django-tenants) :
élèves, notes, finances, comptes du personnel et photos y sont rangés séparément. Une connexion ouverte dans un
établissement ne vaut jamais dans un autre. Les tables communes (liste des établissements, sessions) sont protégées
par la sécurité par ligne (RLS) : l'API de données de Supabase n'y a pas accès.

**Console du propriétaire** (`/plateforme/`) : création d'un établissement (son schéma, ses tables et son premier
administrateur, ou des données de démonstration), nouveau code d'établissement, désactivation, mise à jour de la base
après une nouvelle version. Les codes s'affichent une seule fois. L'administration de chaque établissement peut aussi
changer le code de son établissement (*Paramètres → Code de l'établissement*).

**Variables d'environnement**

| Variable | Rôle |
|---|---|
| `NEXIA_MULTI=1` | active le mode SaaS |
| `DATABASE_URL` | `postgresql://role.ref-projet:mot-de-passe@aws-…pooler.supabase.com:5432/postgres?sslmode=require` (pooler Supabase en mode session) |
| `NEXIA_SECRET_KEY`, `NEXIA_DEBUG=0`, `NEXIA_ALLOWED_HOSTS` | réglages Django habituels (`.vercel.app` accepte tous les sous-domaines) |
| `NEXIA_PROPRIETAIRE`, `NEXIA_PROPRIETAIRE_MDP` | identifiant de la console et empreinte du mot de passe (`python -c "from django.contrib.auth.hashers import make_password; print(make_password('…'))"` dans le projet) |
| `NEXIA_JETON_INSTALLATION` | jeton (32 caractères ou plus) pour `/plateforme/installer/?jeton=…`, qui crée les tables communes au premier déploiement ; à retirer ensuite |
| `NEXIA_DERRIERE_PROXY=1` | lit l'adresse IP réelle dans les en-têtes de Vercel |

**Hébergement Vercel.** `vercel.json` route toutes les requêtes vers `api/index.py` (fonction Python WSGI, région
Paris `cdg1`) ; les fichiers statiques sont servis par WhiteNoise, les photos sont rangées dans la base.

**Tests du mode SaaS** (PostgreSQL local) : `NEXIA_MULTI=1 DATABASE_URL=postgres://… python manage.py test plateforme`.
Les autres tests se lancent sans `NEXIA_MULTI` (SQLite).

## Feuille de route

Tous les modules identifiés dans l'original sont repris. Pistes possibles : export PDF des bulletins,
application mobile pour les parents, sauvegardes automatiques.
