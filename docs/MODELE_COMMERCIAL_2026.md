# Double modèle de distribution — établissements et enseignants SmartEval (novembre 2026)

État : **développé et testé en local, non déployé.** Les migrations 0051 et 0052 ne sont pas appliquées en production, et les fonctions `paiement` et `mcp` ne sont pas redéployées. Le code n'est ni poussé ni publié.

## 1. Établissements

| Offre | Contenu | Prix |
|---|---|---|
| **Découverte** | Fonctions de base : notes, appel, bulletins, import Excel de base, distinctions, cartes, parcours, PV. Jusqu'à 50 élèves et 10 comptes du personnel, pendant 120 jours. | Gratuit, une seule fois par adresse e-mail |
| **Premium** | **Toutes** les fonctionnalités, présentes et futures : toute fonction qui ne figure pas dans la liste gratuite est Premium par défaut. | 500 FCFA par élève et par an, minimum 50 000 FCFA (ce minimum couvre 100 élèves). Valable 12 mois à compter du paiement. |

- **Capacité** : on compte les élèves **inscrits dans l'année scolaire concernée** (table `inscriptions`).
  - Un déclencheur verrouillé (`capacite_inscriptions`) contrôle chaque inscription, quelle que soit la route : ajout, import, API, MCP, mode hors ligne ou transition d'année.
  - Au-delà de la capacité, le serveur renvoie le message exact demandé. L'application affiche alors le bouton « Augmenter mon abonnement ».
- **Import Excel** : l'aperçu indique les nouvelles inscriptions et les places restantes.
  - En cas de dépassement, l'import est bloqué tant que l'import partiel n'est pas coché.
  - L'import partiel inscrit les N premiers élèves du fichier.
- **Augmentation en cours d'année** : on paie la différence entre le nouveau montant et le montant déjà payé, et l'échéance est conservée.
  - Si le minimum déjà payé couvre la nouvelle capacité, l'augmentation est appliquée sans paiement.
- **Renouvellement** : il s'ouvre 60 jours avant l'échéance. La capacité peut être conservée, augmentée ou diminuée.
  - Une diminution n'est possible qu'au renouvellement.
  - Un renouvellement anticipé commence à l'échéance en cours, donc aucun jour n'est perdu.
- **Délai de grâce** : 7 jours d'accès complet après l'échéance.
  - Passé ce délai, l'abonnement est « expiré » : les données restent consultables, mais les modifications et les nouvelles inscriptions sont fermées.
- **Anciens abonnements** (Essentiel, Pro, Premium) : ils sont conservés jusqu'à leur échéance, ramenés à Premium, sans limite d'effectif.
  - Aucune donnée supprimée, aucun paiement déclenché, transition tracée dans l'historique.
- **Page « Mon abonnement »** :
  - offre, capacité, élèves inscrits, places restantes et jauge ;
  - augmentation et renouvellement ;
  - historique des opérations ;
  - paiements et reçus PDF.

## 2. Enseignants indépendants (SmartEval)

| Offre | Contenu | Prix |
|---|---|---|
| Découverte | 1 évaluation publiée, 2 réponses, 120 jours, une seule fois par adresse e-mail | Gratuit |
| SmartEval Enseignant | 10 évaluations publiées (crédits), 150 réponses par évaluation | 5 000 FCFA/an, 12 mois |
| Pack de crédits | 5 évaluations supplémentaires (abonnés en cours) | 2 000 FCFA |
| SmartEval Groupe | Département d'une même matière : jusqu'à 20 enseignants, 10 évaluations chacun ; la matière est demandée avant le paiement | 15 000 FCFA/an, 12 mois |

- **Inscription** : avec n'importe quelle adresse e-mail (mot de passe, lien de vérification) ou avec Google. Aucun établissement n'est nécessaire.
- **Menu** : Tableau de bord, SmartEval, IA & API, Mon abonnement, Mon compte, plus « Mon groupe » pour l'administrateur d'un groupe.
- **Crédits** : 1 crédit = 1 évaluation publiée.
  - Brouillons et modifications sont gratuits.
  - Une suppression ne restitue pas le crédit.
  - Une copie publiée consomme un crédit.
  - Les crédits ne sont pas reportés d'une période à l'autre.
  - Tout est contrôlé par le serveur, avec un verrou sur le compte.
- **Évaluation** :
  - classe en texte libre, groupes facultatifs, aucune liste d'élèves ;
  - lien public sécurisé ;
  - limite de réponses contrôlée par le serveur.
- **Groupe de département** :
  - l'administrateur génère le code du groupe, crée le compte de chaque collègue et lui remet un code personnel ;
  - les codes sont conservés hachés et bloqués 15 minutes après 5 essais erronés ;
  - une évaluation dans une autre matière est refusée par le serveur.
- **Anonymisation** (enseignants indépendants et établissements) : l'IA ne voit que les matricules ou les numéros de copie. Le formulaire de l'élève demande alors son matricule.
- **IA & API** : clé personnelle `nxe_` ou OAuth (`nxe_`/`nxf_`), limitée à 300 appels par heure.
  - Accès en lecture seule aux seules évaluations de l'enseignant (outils MCP : `contexte`, `smarteval_lister`, `smarteval_resultats`).
  - Journal des appels et révocation.
- **Coûts d'IA** : aucun appel à un fournisseur d'IA payant n'existe dans le code. L'analyse se fait avec l'assistant et le compte de l'enseignant.
- **Demande pour l'IA** : texte à copier, construit à partir de l'évaluation (titre, classe, matière, compétence, anonymisation).

## 3. Règles communes

- **Une offre gratuite par adresse e-mail**, tous produits confondus.
  - La comparaison se fait sur l'empreinte de l'adresse normalisée : minuscules, sans `+étiquette`, sans les points Gmail.
  - Seule cette empreinte est conservée, pas l'adresse elle-même.
  - Le compte reste créé, mais sans offre gratuite.
- **Paiements** : SasPay, montant **calculé en base** (jamais repris du navigateur).
  - Vérification par le serveur du statut, du montant et de la devise XAF.
  - Webhook signé (HMAC) ; activation idempotente ; reçu par e-mail et page de vérification.
- **Configuration commerciale centralisée** : table `config_commerciale`, modifiable dans la console (onglet « Tarifs et offres »). Aucune valeur n'est écrite en dur dans les pages.
- **Pages publiques** :
  - `/tarifs` : calculateur pour les établissements ;
  - `/tarifs/smarteval` ;
  - `/commencer` : choix du type de compte ;
  - section tarifs de la page d'accueil.

## 4. Fichiers

- **Migrations** :
  - `0051_modele_etablissements.sql` : configuration, essais gratuits, périodes, capacité, paiements par produit, historique ;
  - `0052_smarteval_independant.sql` : comptes, groupes, évaluations, crédits, réponses, anonymisation, MCP, OAuth.
- **Fonctions serveur** : `paiement` (produits) et `mcp` (branche enseignant `nxe_`).
- **Pages** :
  - `pages/enseignant/` : accès, espace, SmartEval, abonnement, IA, groupe ;
  - `pages/Tarifs.jsx`, `pages/Abonnement.jsx` (réécrite), `composants/Capacite.jsx`, `lib/paiement.js` ;
  - console : onglet « Tarifs et offres ».

## 5. Tests

- **Banc SQL (PGlite)** : 763 vérifications réussies. Nouveau scénario `scenario_enseignants.sql`, et `scenario_offres.sql` réécrit.
- **Vitest** : 171 tests réussis, dont les nouveaux `mcpEnseignants.test.js` et `capacite.test.js`. Le seul échec est le test ZIP, qui échoue toujours sous Windows (outil `unzip`).
- **Build de production** : réussi.
- **Non vérifié** : l'interface n'a pas été parcourue dans un navigateur, faute de base à jour (les migrations ne sont pas déployées).

## 6. Revue de code

Aucun point critique. Les 4 points importants sont corrigés et testés :

1. **Code du groupe à la connexion** : blocage de 15 minutes après 5 essais erronés. La réponse est identique pour un code faux et pour un membre inconnu.
2. **Crédits du groupe** : une enveloppe commune s'applique à la période (nombre maximal de membres × crédits par membre). Remplacer des membres ne crée plus de crédits.
3. **Membre désactivé** : il n'a plus accès à ses évaluations ni aux copies des élèves.
4. **Paiement devenu incompatible** entre la préparation et le paiement : il n'est jamais activé en silence. Il est signalé « à traiter » dans l'historique, pour remboursement ou report.

Points moyens restants, non corrigés :
- Aucune limite de débit sur les réponses anonymes à un lien public : un tiers peut remplir les places de réponse.
- Un paiement confirmé par SasPay après son annulation n'est pas activé. Ce défaut existait déjà avant ces changements.
- Deux augmentations de capacité en attente peuvent être payées toutes les deux. Le client paie alors trop, sans perte pour la plateforme.

## 7. Paramètres à confirmer

Tous sont modifiables dans la console, sans déploiement.

- Durée des offres gratuites : **120 jours** (établissements et SmartEval).
- Délai de grâce : **7 jours**.
- Ouverture du renouvellement : **60 jours** (établissements) et **30 jours** (SmartEval) avant l'échéance.
- Groupe : **20 membres** au plus, administrateur compris ; **10 évaluations** par membre.
- Minimum annuel : 50 000 FCFA, ce qui couvre **100 élèves**. Un établissement de moins de 100 élèves paie ce minimum et dispose de 100 places.
- Règle de l'e-mail : l'adresse déjà utilisée **peut** créer un compte, mais **sans** offre gratuite.

## 8. Actions manuelles avant la mise en production

1. **Supabase Auth** :
   - activer la confirmation des adresses e-mail et un SMTP d'envoi ;
   - ajouter aux URL de redirection `…/bienvenue` et `…/smarteval/mot-de-passe`, pour chaque site : nexiaschool.com, Cloudflare et GitHub Pages.
2. **Base de données** : appliquer les migrations `0051` puis `0052`.
3. **Fonctions serveur** : déployer `paiement` et `mcp`.
4. **Contrôle en production** : vérifier les 3 établissements existants.
   - Le Premium offert sans échéance reste Premium sans limite.
   - Le Premium payé est conservé jusqu'à son échéance.
   - L'établissement en Découverte obtient une fin de découverte de 120 jours à compter de la migration.
