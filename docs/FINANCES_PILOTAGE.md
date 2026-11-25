# Finances — pilotage financier (migration 0054)

État au 25/11/2026 : **déployé en production** — migration 0054 appliquée (en 5 parties : 0054_finances_pilotage_1 à _5), fonction mcp version 12, site Cloudflare et GitHub Pages (commit ed1864a).

## 1. Fonctionnalités développées

| Menu | Contenu | Logique serveur |
|---|---|---|
| Vue d'ensemble | Encaissements nets, dépenses payées, solde de période, trésorerie, reste à recouvrer, retards, taux de recouvrement, dettes antérieures, masse salariale (droit « paie »), courbe jour par jour, répartitions, points de vigilance | `finance_tableau_bord` |
| Frais et facturation | Pension (écran « Frais et délais » existant) ; catégories de frais avec montant par classe (ou toutes classes), conditions, échéances en % ; facturation par classe ou par élève sans doublon ; dettes antérieures | `finance_categorie_enregistrer`, `finance_facturer`, `finance_facture_annuler` |
| Encaissements et reçus | Recherche (nom, matricule, classe), dossier financier de l'élève, encaissement par rubrique, MTN MoMo / Orange Money / espèces / virement / chèque / carte (configurables), paiements en attente (confirmer / rejeter), annulation par contre-écriture, reçu PDF avec QR code, montant en lettres, solde restant, agent, partage WhatsApp / e-mail (lien préparé, rien n'est envoyé automatiquement), historique filtrable, export Excel / PDF | `finance_encaisser` (idempotent), `finance_annuler_paiement`, `finance_attente_traiter`, `finance_situation_eleve`, `finance_rechercher`, `finance_encaissements`, `finance_attentes` |
| Remises | Réduction, exonération, bourse, aide, décision administrative ; montant ou % ; motif, auteur, date ; annulation tracée | `finance_remise_accorder`, `finance_remise_annuler` |
| Situation par classe, Élèves non en règle, Relances et recouvrement | Écrans existants conservés (renommage « Relances et recouvrement ») ; calculs désormais nets des remises et limités aux paiements de pension | `finance_eleves`, `_tranches_situation`, `_en_regle` redéfinies |
| Dépenses et fournisseurs | Catégories, fournisseurs, pièce justificative (PDF / image, compartiment privé), circuit brouillon → en attente → approuvée / rejetée → payée, annulation tracée ; seule une dépense payée sort de la trésorerie | `finance_depense_enregistrer`, `finance_depense_action`, `finance_depenses` |
| Trésorerie et banques | Comptes (caisse, banque, MTN MoMo, Orange Money, autre), solde initial daté, soldes recalculés, journal par compte, virements internes, clôture journalière (théorique / constaté / écart justifié, définitive), rapprochement d'un relevé CSV avec suggestions et confirmation manuelle | `finance_compte_enregistrer`, `finance_virement`, `finance_cloturer`, `finance_releve_importer`, `finance_rapprochement`, `finance_rapprocher` |
| Paie du personnel | Éléments historisés (base, primes, indemnités, retenues), paramètres de cotisations saisis par l'établissement (inactifs et « non vérifiés » par défaut, source obligatoire pour « vérifié »), préparation mensuelle, statuts brouillon / en vérification / validée / payée / annulée, paiement = une dépense « Salaires » + un mouvement, bulletins PDF avec QR code, « Mes bulletins de paie » pour chaque employé | `finance_paie_*`, `mes_bulletins_paie` |
| Rapports financiers | 14 rapports (journal des encaissements, par mode, par classe, impayés, remises, annulations, factures, dépenses par catégorie / fournisseur, journal de trésorerie, clôtures, rapprochement, synthèse mensuelle, masse salariale), export Excel / PDF | `finance_rapport` |
| Assistant IA Finance | Mode d'emploi de la connexion MCP, exemples de questions, historique des consultations | `api_finance` + 5 outils MCP |
| Paramètres financiers | Modes de paiement proposés, mention des documents, droits financiers par personne | `finance_parametres_enregistrer`, `finance_droits_definir` |
| Vérification publique | `/verifier/<code>` reconnaît reçus, factures et bulletins de paie (initiales, numéro, date, statut ; jamais de montant de salaire) | `verifier_document_finance` |

## 2. Existant réutilisé

Pension (`frais_scolarite`, `echeances`, `paiements`), numérotation des reçus, écrans « Frais et délais », « Élèves non en règle », relances (0046), `_exiger_offre`, `_api_contexte` / `_api_journal`, clés API et OAuth, en-tête PDF et `listePdf`, QR code des bulletins, export Excel, `useDonnees`, `Alerte`.

## 3–4. Tables et migration

Migration unique `supabase/migrations/0054_finances_pilotage.sql` (aucune suppression de données).

- Nouvelles tables : `finance_droits`, `finance_journal`, `finance_parametres`, `frais_categories`, `frais_montants`, `frais_tranches`, `finance_remises`, `factures`, `comptes_financiers`, `paiements_attente`, `mouvements_tresorerie`, `virements_tresorerie`, `clotures_caisse`, `lignes_releve`, `depenses_categories`, `fournisseurs`, `depenses`, `paie_parametres`, `paie_elements`, `paies` ; compartiment de stockage privé `justificatifs`.
- `paiements` : colonnes `categorie_id`, `compte_id`, `payeur`, `cle_idempotence`, `annule_paiement_id`, `motif_annulation`, `attente_id`, `code_verif` (chaque reçu existant reçoit son code) ; modes MTN MoMo, Orange Money, carte ; montant négatif seulement pour une contre-écriture ; **suppression physique retirée**.
- Fonctions redéfinies : `peut_finance`, `preparer_paiement`, `finance_eleves`, `_tranches_situation`, `_en_regle`, `finance_enregistrer_frais` (droit « facturation »), `console_supprimer_etablissement` (supprime aussi la paie).

## 7. Encaissements

Un encaissement passe par `finance_encaisser` (ou l'insertion directe, contrôlée par le même déclencheur) : droit « caisse », mode proposé par l'établissement, rubrique de l'année de l'élève, pas de trop-perçu sur une rubrique facturée, clé d'idempotence (un double envoi renvoie le reçu existant), numéro unique sous verrou, compte de trésorerie choisi ou déduit du mode, mouvement de trésorerie créé par déclencheur. Un paiement « en attente » est stocké à part et ne compte nulle part avant confirmation. Une annulation crée une contre-écriture négative datée du jour (l'auteur dans les 24 h, ou le droit « validation ») ; le reçu d'origine reste consultable et sa vérification publique indique « annulé ».

## 8. Dépenses et trésorerie

Le solde d'un compte = solde initial + somme des mouvements depuis la date du solde initial. Les mouvements ne s'écrivent que par déclencheurs ou fonctions serveur (aucun droit d'écriture direct) et une seule fois par source (contrainte unique). Un virement crée deux mouvements opposés et n'apparaît ni en recettes ni en dépenses. Une clôture bloque toute opération datée de ce jour ou avant sur le compte.

## 9. Paie

Calcul : salaire de base en vigueur + primes + indemnités = brut ; retenues = retenues saisies + paramètres actifs (taux sur le brut, plafonné si indiqué, ou montant fixe) ; net = brut − retenues ; charges patronales affichées à titre d'information. Le détail est figé dans la paie à la préparation (recalcul possible tant qu'elle est en brouillon). Valider exige le droit « validation » et interdit de valider sa propre paie. Payer crée une dépense « Salaires » payée (libellé sans nom) liée à la paie : un seul mouvement de trésorerie.

## 10. Outils MCP financiers (lecture seule)

`finance_tableau_bord`, `finance_rapport`, `finance_tresorerie`, `finance_situation_eleve`, `finance_depenses` → une seule fonction serveur `api_finance` : clé lecture suffisante, droit « assistant » exigé, paie seulement avec « paie », période `debut`/`fin` ou `annee_scolaire`, champ `manquants`, journal (outil, période, statut, erreur ; jamais de montant, nom ni matricule).

## 11. Droits et protections

| Droit | Admin | Comptable (défaut) | Exemple caissier |
|---|---|---|---|
| caisse, facturation, depenses, tresorerie, rapports, assistant | ✓ | ✓ | caisse seulement |
| validation, paie | ✓ | à accorder | — |

Tables en lecture seule pour les navigateurs (RLS par établissement), écritures uniquement par fonctions `security definer` qui vérifient le droit et l'offre ; dépenses de salaires invisibles sans « paie » ; justificatifs limités au dossier de l'établissement.

## 12. Tests exécutés

- Banc SQL (PGlite, toutes les migrations) : **855 vérifications réussies**, dont `supabase/tests/scenario_pilotage_finance.sql` (scénarios A à F) et l'ensemble des scénarios existants (non-régression G). L'ancien test d'annulation par suppression a été adapté à la contre-écriture.
- Vitest : documents financiers (montant en lettres, reçu, facture, bulletin de paie), lecture des relevés CSV, outils MCP financiers, traductions ; le test `zip.test.js` échoue sur Windows comme avant (sans lien).
- Build Vite : réussi.
- Non testé : affichage réel des pages dans un navigateur connecté (la migration n'est pas déployée et la connexion demande un compte) ; téléchargement réel d'un justificatif dans le stockage Supabase.

## Relecture de code

Une relecture indépendante a relevé 2 points élevés et 6 moyens, tous corrigés et couverts par des tests : salaires lisibles par la trésorerie via les mouvements (désormais marqués « paie », agrégés par jour sans nom pour qui n'a pas ce droit, exclus de la synthèse mensuelle et des suggestions de rapprochement) ; contre-écriture d'un paiement sans compte qui créait un mouvement fantôme ; annulation impossible sur un compte désactivé ; contrôles métier (mode proposé, facture existante, reste dû) déplacés dans le déclencheur pour couvrir l'insertion directe ; verrou par élève et rubrique contre les trop-perçus concurrents ; solde initial des comptes réservé à la trésorerie ; net de paie nul ou négatif refusé ; filtre de classe de l'historique appliqué avant la limite ; verrous de compte pour les clôtures et les soldes de caisse ; double envoi simultané d'une même clé géré proprement.

## 13–15. Restes, configuration manuelle, décisions à valider

- Non corrigé (faible) : l'espace parents (0048, inchangé) liste aussi les paiements d'autres frais et les contre-écritures à côté de l'échéancier de pension ; le rang d'occurrence d'une ligne de relevé est fourni par le navigateur (une même ligne pourrait être réimportée en le modifiant).

- À faire par chaque établissement : créer les comptes de trésorerie, choisir les modes de paiement, attribuer les droits (caissiers, validation, paie).
- Aucune intégration bancaire ou mobile money n'est simulée : les paiements sont saisis avec leur référence ; le rapprochement part d'un relevé CSV exporté manuellement.
- Paie : les taux de cotisation (CNPS…) et le barème de l'impôt ne sont pas fournis ; l'établissement doit les saisir, citer la source et les faire vérifier. Les bulletins indiquent qu'ils ne proviennent pas d'un logiciel de paie certifié.
- Rapports : outils de gestion, pas des états comptables (pas de plan comptable OHADA ni de grand livre).
- Remise de pension : elle réduit les échéances en partant de la dernière (choix à confirmer).
- Le montant en lettres est rédigé en français (documents officiels).
