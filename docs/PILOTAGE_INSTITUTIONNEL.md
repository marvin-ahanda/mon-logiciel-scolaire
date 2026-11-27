# Pilotage institutionnel — remontée des fiches de synthèse statistiques (migration 0055)

État au 27/11/2026 : **développé et testé en local, non déployé** (migration 0055 non appliquée en production, fonction `mcp` non redéployée, site non publié).

NexIA School n'est présentée nulle part comme mandatée ou agréée par le MINESEC : mention sur les pages d'inscription, dans l'espace des délégations, dans les instructions MCP et en pied de chaque PDF.

## 1. Architecture

Trois niveaux dans la même application et la même base : **établissement → délégation départementale (DDES) → délégation régionale (DRES)**. Une seule migration (`supabase/migrations/0055_pilotage_institutionnel.sql`), aucune donnée existante supprimée ni modifiée (les établissements reçoivent seulement des colonnes nouvelles, rattachement « absent » par défaut).

- Base : tables `inst_*` sans aucun droit direct pour les navigateurs ; toute lecture et toute écriture passent par des fonctions `security definer` qui vérifient l'établissement propriétaire, la délégation et la circonscription.
- Interfaces : rubrique « Délégation » de l'espace établissement (`/fiches-statistiques`, `/courriers-institutionnels`), espace séparé des délégations (`/institution/*`, sans abonnement), onglet « Institutions » de la console du propriétaire (`/console/institutions`).
- IA : clés `nxd_…` servies par la fonction `mcp` existante (nouvel ensemble d'outils en lecture seule, `api_institution`).
- Alertes : le travailleur quotidien existant (`workers/maintien`) appelle `inst_alertes_quotidiennes` (idempotent).

## 2. Comptes institutionnels

`inst_delegations` (entité, une par circonscription), `inst_membres` (titulaire ou collaborateur, permissions `examen` / `courriers` / `synthese`), `inst_demandes`. Gratuits, indépendants des offres des établissements. Un compte d'établissement ou d'enseignant SmartEval ne peut pas devenir délégué (adresse distincte exigée).

## 3. Inscription

`/institution/inscription` : e-mail (tout fournisseur) + mot de passe, vérification par lien. Puis demande : type (DDES / DRES), région, département (DDES), nom, prénom, téléphone professionnel, fonction, justificatif (PDF ou image, 5 Mo, compartiment privé `institution/demandes/<compte>/…`). Statuts : brouillon, soumise, en vérification, approuvée, rejetée, suspendue. Soumission refusée sans e-mail vérifié, sans justificatif ou si la circonscription a déjà un titulaire. MFA : non activée (dépend de la configuration Supabase Auth, voir § 19).

## 4. Référentiel territorial

`inst_regions`, `inst_departements` (nom officiel, code, actif, vérifié) et `inst_referentiel_historique` (avant / après, auteur, date). Pré-rempli avec les 10 régions et 58 départements du Cameroun, **tous marqués « à vérifier »**. Administré depuis la console (création, renommage, code, activation, validation) ; aucune liste dans le code des interfaces (lecture du référentiel actif par le serveur).

## 5. Unicité des délégations

Index uniques partiels : un `departement_id` par délégation départementale, un `region_id` par délégation régionale ; un seul titulaire actif par délégation ; un seul rattachement actif par compte. Message exact renvoyé à la soumission. Changement de titulaire (console) : même délégation, ancien membre révoqué (conservé dans l'historique avec motif), ses clés IA révoquées, journalisé. Les collaborateurs (si le propriétaire les active) sont rattachés à la délégation existante et ne peuvent pas créer de délégation.

## 6. Validation

Console « Institutions → Demandes » : justificatif (lien signé), e-mail vérifié ou non, circonscription déjà pourvue ; décisions en vérification / approuver / rejeter / suspendre (motif obligatoire pour rejet et suspension), changement de titulaire. Chaque décision est enregistrée (auteur, date, motif) dans `inst_demandes`, `inst_journal` et le journal de la plateforme.

## 7. Tables et migration

`inst_journal` (ajout seul, déclencheur bloquant modification et suppression), `inst_regions`, `inst_departements`, `inst_referentiel_historique`, `inst_delegations`, `inst_membres`, `inst_demandes`, `inst_notifications`, `inst_parametres`, `inst_campagnes`, `inst_appreciations`, `inst_fiches`, `inst_fiche_versions` (immuables), `inst_fiche_statuts`, `inst_commentaires` (immuables), `inst_derogations`, `inst_courrier_types`, `inst_courriers` (figés après envoi), `inst_courrier_destinataires`, `inst_courrier_reponses` (immuables), `inst_acces_ia` ; compartiment privé `institution`. Colonnes ajoutées à `etablissements` : `departement_id`, `rattachement_statut` (absent / déclaré / vérifié), `rattachement_verifie_par`, `rattachement_verifie_le`.

## 8. API (fonctions serveur)

- Établissement : `etablissement_localisation`, `etablissement_localisation_lire`, `inst_mes_fiches`, `inst_fiche_preparer`, `inst_fiche_lire`, `inst_fiche_enregistrer`, `inst_fiche_publier`, `inst_fiche_commenter`, `inst_courriers_recus`, `inst_courrier_lu`, `inst_courrier_repondre`, `inst_courrier_archiver`, `inst_notifications_lire`, `inst_notification_lue`, `inst_apercu`.
- Délégations : `inst_mon_espace`, `inst_tableau_departement`, `inst_tableau_region`, `inst_consolidation`, `inst_perimetre`, `inst_verifier_rattachement`, `inst_fiche_demander_correction`, `inst_fiche_examinee`, `inst_relancer`, `inst_synthese_preparer`, `inst_syntheses`, `inst_courrier_enregistrer`, `inst_courrier_envoyer`, `inst_courriers_envoyes`, `inst_fiches_derogation`, `inst_ia_creer_cle`, `inst_ia_cles`, `inst_ia_revoquer`, `inst_collaborateur_ajouter`, `inst_collaborateur_retirer`, `inst_journal_delegation`.
- Comptes : `inst_demande_enregistrer`, `inst_demande_soumettre`, `inst_ma_demande`.
- Console : `console_inst_referentiel`, `console_inst_circonscription`, `console_inst_demandes`, `console_inst_decider`, `console_inst_changer_titulaire`, `console_inst_delegation`, `console_inst_delegations`, `console_inst_rattachements`, `console_inst_campagne`, `console_inst_parametres`, `console_inst_derogation`, `console_inst_derogation_revoquer`, `console_inst_journal`.
- Publiques (anonymes) : `api_institution` (clé `nxd_` obligatoire), `inst_alertes_quotidiennes` (idempotente, ne renvoie qu'un compteur).

## 9. Interfaces

- Établissement (menu « Délégation ») : Mes fiches statistiques (localisation administrative, campagnes, nouvelle fiche), éditeur de fiche, Historique des publications, Courriers institutionnels (reçus ; envoyés et réponses), Notifications. Formulaire de création d'établissement : section « Localisation administrative » (région puis département filtré).
- DDES : Tableau de bord départemental, Établissements de mon département (vérification des rattachements), Fiches statistiques reçues, Établissements en retard (relance), Analyse et consolidation, Ma synthèse départementale, Courriers, IA & API, Notifications, Paramètres de mon espace (collaborateurs, journal).
- DRES : Tableau de bord régional, Délégations départementales, Synthèses départementales reçues, Départements en retard, Analyse et consolidation régionale, Ma synthèse régionale, Courriers, Accès exceptionnels, IA & API, Notifications, Paramètres.
- Console : Demandes, Délégations, Référentiel territorial, Rattachements, Campagnes et formules, Accès exceptionnels, Journal d'audit.

## 10. Structure des fiches

Fiche = établissement, région, département, année scolaire, période (T1, T2, T3, annuel), version, dates, statut. Statuts : brouillon, prête à publier, publiée, en cours d'examen, correction demandée, corrigée, republiée, reçue et examinée, archivée (« non commencée » = aucune fiche ; « non publiée » côté délégation). Chaque changement est historisé (`inst_fiche_statuts` : de, à, auteur, date, motif).

PDF A4 portrait sur trois pages au moins, en-têtes de tableau répétés : page 1 identité (tutelle, DR, DD, établissement, type, année, période, version, dates, responsable) et synthèse générale (élèves, enseignants, classes, disciplines, taux globaux) ; page 2 couverture des programmes par classe, discipline et enseignant (prévues, faites en présentiel, digitalisées, pourcentages théorie et pratique) ; page 3 heures dues et faites, assiduité des enseignants et des élèves, observations de la direction.

Pré-remplissage (source « calculée automatiquement ») : lignes classe × discipline × enseignant depuis les attributions de l'année, effectifs depuis les inscriptions, heures d'absence des élèves depuis l'appel. Aucune valeur de leçon ou d'heure n'est inventée : ces cases restent « manquantes ». Une case peut être un nombre, « NA » (non applicable) ou vide (manquante). Enregistrement automatique 2,5 s après la dernière saisie, enregistrement manuel, aperçu des indicateurs calculés par le serveur, aperçu PDF, publication explicite avec résumé des anomalies.

## 11. Formules

Source unique : la fonction serveur `_inst_indicateurs` (aperçu, publication, consolidation, PDF et IA lisent son résultat).

| Indicateur | Numérateur | Dénominateur |
|---|---|---|
| Couverture théorie / pratique | leçons faites en présentiel (+ leçons digitalisées faites, **réglage à valider**) | leçons prévues |
| Heures théorie / pratique | heures faites | heures dues |
| Assiduité enseignants / élèves | heures dues − heures d'absence | heures dues |

- Agrégation : somme des numérateurs / somme des dénominateurs (jamais une moyenne de pourcentages), par fiche, par discipline, par département, par région.
- Exclusions : ligne incomplète (« manquante », signalée), « non applicable » (exclue sans signalement), dénominateur nul.
- Protections : valeur négative et absences supérieures aux heures dues = **bloquant** ; dépassement de 100 % et réalisé sans prévu = **à vérifier** (confirmation exigée, publication possible) ; données manquantes = information.
- Annuel : pré-rempli par cumul des derniers trimestres publiés ; les trimestres non publiés sont listés (`periodes_manquantes`) et affichés. Les valeurs trimestrielles restent dans leurs propres fiches.
- Tant que `formules_validees` est faux (console), écrans et PDF portent la mention « Formules de calcul en attente de validation : les taux sont indicatifs ».

## 12. Routage

Publication d'une fiche d'établissement : rattachement renseigné et vérifié → délégation départementale du département existante, active et pourvue d'un titulaire (sinon refus, la fiche reste enregistrée) → version immuable créée avec son destinataire → statut publiée / republiée (retard signalé) → notification de la seule délégation destinataire. Synthèse départementale : consolidation figée au moment de la publication, transmise à la seule délégation régionale de la région. Une délégation régionale ne voit les fiches brutes que par un accès exceptionnel accordé par le propriétaire (90 jours au plus, révocable, chaque consultation journalisée).

## 13. Tableaux de bord

DDES : établissements, fiches attendues, publiées, non publiées, en retard, en correction, examinées, taux de transmission, rattachements à vérifier ; tableau (nom, référence, statut, échéance, publication, retard, dernière action, consultée) ; filtre par période et statut ; vue des retards avec relance (sélection ou tous). DRES : départements, délégations actives, synthèses reçues, en retard, en correction, examinées. Consolidation : attendues, reçues, manquantes, en attente de correction, nombre de fiches et d'observations comptées, taux pondérés, couverture par discipline, détail des documents comptés. Examen : lecture, PDF, versions, comparaison avec la version précédente, commentaires horodatés, demande de correction avec éléments concernés, appréciations configurables (non réglementaires), « reçue et examinée ».

## 14. Courriers

Types configurables (rappel, correction, informations, convocation, note, demande de rapport, libre). DDES → un, plusieurs ou tous les établissements vérifiés de son département ; DRES → une, plusieurs ou toutes les délégations départementales de sa région (périmètre vérifié par le serveur). Référence attribuée à l'envoi (`DDES/2026/0001`), objet, corps, date limite, pièces jointes (5), auteur, fonction. Statuts : brouillon, envoyé, distribué, lu, réponse reçue, archivé. Aucune modification après envoi (déclencheur). Réponses avec pièce jointe, immuables. PDF sobre. Notifications à l'envoi et à la réponse.

## 15. MCP et IA

Clé `nxd_` (5 actives au plus, 365 jours, révocable), créée dans « IA & API ». Outils : `contexte`, `tableau_de_bord`, `consolidation`, `detail_fiche`, `courriers` — tous en lecture seule (aucun outil de publication, modification, validation ou envoi). Chaque réponse cite `periode`, `perimetre`, `nb_fiches_utilisees`. Catégories réglées par le propriétaire pour chaque délégation : statuts, indicateurs (par défaut), détail des lignes, noms des enseignants, courriers. Aucun nom d'élève n'est présent dans les fiches. 300 appels par heure, journal des appels. Le coût et le traitement des requêtes relèvent du fournisseur d'IA choisi par la délégation (rien n'est affirmé sur la facturation).

## 16. Protections

Isolation stricte à trois niveaux par le serveur (les menus ne font que refléter les droits) ; journal d'audit en ajout seul (comptes, décisions, titulaires, rattachements, publications, consultations, consultations par dérogation, corrections, examens, courriers, réponses, relances, clés et appels MCP) ; versions, commentaires, réponses et courriers envoyés immuables ; pièces dans un compartiment privé avec contrôle par chemin et par destinataire ; aucune fonction interne exposée.

## 17. Tests exécutés

- Banc SQL (PGlite, toutes les migrations) : **944 vérifications réussies** (855 existantes + 89 nouvelles dans `supabase/tests/scenario_pilotage_institutionnel.sql`) :
  - A référentiel : pré-remplissage, lecture publique filtrée, écriture refusée, historique, désactivation, aucun établissement rattaché d'office.
  - B comptes : e-mail vérifié, justificatif, dossier du demandeur, filtrage par région, validation, message exact d'unicité, index uniques, changement de titulaire, collaborateurs.
  - C fiches : campagnes, pré-remplissage, unicité, pondération (57,5 % et non 65 %), manquant / NA / division par zéro / plus de 100 %, blocages, isolation entre établissements.
  - D routage départemental : refus sans rattachement, sans vérification, sans délégation ; confirmation des anomalies ; destinataire unique ; isolation DDES et DRES ; dérogation et journalisation ; correction, republication, immutabilité ; tableau de bord ; relances.
  - E consolidation : partielle puis complète, pondérée, manquants exclus.
  - F routage régional : synthèse vers la seule DRES, tableau régional, isolation, retard.
  - G courriers : périmètre, référence, immutabilité, lecture, réponse, pièces, courrier régional.
  - H MCP : périmètre et période cités, catégories, aucun outil d'écriture, clés invalides ou révoquées, minimisation, journal.
  - I protections : appels anonymes refusés, journal infalsifiable, tables fermées, alertes idempotentes, bilan annuel.
- Vitest : `src/lib/mcpInstitution.test.js` (outils MCP en lecture seule, routage de la clé, saisie et taux de ligne) et contrôle des traductions anglaises ; toute la suite passe sauf `zip.test.js`, qui échouait déjà sur Windows (sans lien).
- Build Vite : réussi.
- Navigateur : pages publiques `/institution/inscription` et `/institution/connexion` affichées sans erreur.
- **Non testé** : les espaces connectés (établissement, délégations, console) dans un navigateur, car la migration n'est pas appliquée en production ; dépôt réel de pièces dans le stockage Supabase ; envoi réel du lien de vérification d'e-mail ; appel réel de la fonction `mcp` déployée.

### Relecture de sécurité

Une relecture indépendante (lecture seule) n'a relevé aucun point critique ni élevé. Corrigé :
- alertes quotidiennes limitées à un passage par jour (appelables avec la clé publique) ;
- « rejet » d'une demande déjà approuvée refusé (seule la suspension, qui retire l'accès, est possible) ;
- totaux de la synthèse générale perdus dans la consolidation régionale ;
- `detail_fiche` soumis aussi à la catégorie « indicateurs » ;
- notification impossible sur une synthèse régionale ;
- permission « synthèse » exigée pour répondre ;
- versions et commentaires filtrés pour une délégation qui n'est plus destinataire ;
- double création simultanée d'une fiche ;
- aperçu réservé aux établissements et délégations ;
- suppression d'un compte possédant des clés IA ;
- archivage des courriers soumis à la permission « courriers » ;
- relances limitées à 500 destinataires.

Restent, faibles :
- un appel MCP refusé n'est ni journalisé ni compté dans la limite horaire (l'erreur annule l'écriture) ;
- l'ajout d'un collaborateur distingue « compte inexistant » de « compte déjà utilisé » ;
- aucun quota de fichiers par demandeur dans `demandes/<compte>/` ;
- un collaborateur sans permission peut créer des clés IA (lecture seule, comme ses écrans).

## 18. Problèmes rencontrés

- Le calcul des indicateurs utilisait une table temporaire, interdite dans une fonction de lecture : remplacé par une requête unique.
- Un nouveau responsable bloqué par l'unicité ne pouvait pas soumettre sa demande, donc le changement de titulaire était impossible : sa demande complète (justificatif joint) reste visible et utilisable par le propriétaire.
- Les données existantes ne contiennent ni leçons prévues ou faites, ni heures dues ou faites, ni assiduité des enseignants : ces valeurs sont saisies par l'établissement (jamais estimées).

## 19. Configuration manuelle

1. Appliquer la migration 0055 en production, redéployer la fonction `mcp`, redéployer le travailleur `maintien` et publier le site.
2. Console → Institutions → Référentiel : vérifier noms et codes des régions et départements, puis les valider.
3. Console → Campagnes et formules : créer les campagnes (année, période, ouverture, échéance, alertes) pour les établissements, puis pour les synthèses départementales et régionales ; décider du réglage « leçons digitalisées » ; cocher « formules validées » seulement après validation officielle.
4. Valider les demandes de comptes des délégations (vérification du justificatif).
5. MFA : à activer dans Supabase Auth si souhaité (non imposée par ce module).
6. Les établissements existants doivent déclarer leur localisation (bandeau dans « Mes fiches statistiques ») ; la délégation ou le propriétaire la vérifie.

## 20. Validations juridiques et administratives

- Accord formel avec le MINESEC avant toute présentation du service comme canal officiel ; validation du modèle de fiche, des libellés, des formules et du calendrier par l'autorité compétente.
- Vérification par un professionnel de la conformité à la loi camerounaise n° 2024/017 du 23 décembre 2024 sur la protection des données à caractère personnel (finalités, base légale, durées de conservation, information des personnes, notice pour les délégués et les établissements, transferts hors du Cameroun liés aux assistants d'IA).
- Les statistiques agrégées ne sont pas automatiquement anonymes (petits effectifs, noms d'enseignants) : minimisation appliquée par défaut, à confirmer par l'analyse juridique.
- Vérification du découpage administratif pré-rempli.
