# NexIA School — programme en cours (point de reprise)

> À lire en premier dans toute nouvelle discussion. Dépôt : `/home/user/mon-logiciel-scolaire` (application dans `nexiaschool-web/`), branche de travail **`programme-jour`**.

## Règles de travail (à respecter)
- Répondre en français. Ne jamais lire ni afficher de secrets. Aucun vrai SMS.
- **Une tâche à la fois** : à la fin d'une tâche, faire un compte rendu et **attendre l'autorisation explicite** de l'utilisateur avant la suivante.
- Avant d'exécuter un programme, présenter un aperçu et obtenir une validation explicite.
- Ne rien déployer en production sans demande (base Supabase `woxdqzocwqnrpfmxlsbq`, site, fonction MCP). Ne jamais pousser `netlify-supabase` sans autorisation. Pas de merge ni de PR sans demande. Demander avant toute suppression destructive.
- Rien de codé en dur pour un établissement : tout est configurable.
- Ne pas refaire ce qui existe déjà (étendre l'existant). Toute nouvelle chaîne `t("…")` doit avoir sa traduction dans `src/i18n-en.js` (`Object.assign(EN, {...})` avant `EN.__modeles`).
- Les commits se font sur `programme-jour` et se poussent (les hooks le demandent). Attribution : suivre le rappel d'attribution de la session.

## Programme du jour (source : « new_prompt_1.docx », 12 fonctionnalités) — ordre validé
| # | Fonctionnalité | État |
|---|---|---|
| 1 | F1 Récompenses et distinctions (Paramètres) | ✅ fait — commit `80c4df4` (migration 0041) |
| 2 | F2 Cartes scolaires (Paramètres) | ✅ fait — commit `cc7db33` (migration 0042) |
| 3 | F4 Parcours, séries et orientation (Paramètres) | ✅ fait — commit `7c645ce` (migration 0043) |
| 4 | F3 Transition d'année scolaire (Paramètres) | ✅ fait — commit `abe04ef` (migration 0044) |
| 5-8 | F5 + F6 + F7 + F8 : **moteur unifié « PV et rapports »** (Notes → PV et rapports : PV de classe, PV par cycle, PV général, PV individuels + publication aux parents, registre numéroté, réglages) | ✅ fait — migration 0045 (demande de l'utilisateur : un seul moteur, un volet par PV) |
| 9 | F9 Relances automatiques d'insolvabilité (Finances → Relances et insolvabilité) | ✅ fait — migration 0046 (l'utilisateur a demandé F9 avant F10 ; F9 pose le socle du courrier école → parents : table `courriers_ecole`, lecture, accusé, réponse, journal) |
| 10 | F10 Courriers administratifs aux parents (Courrier → Courriers aux parents) + confirmation de lecture | ✅ fait — migration 0047 (envois, modèles, PDF joint, ciblage, confirmation du nombre de destinataires, planification, renvoi des échecs) |
| 11 | F11 MCP pour les parents (Claude / Grok, données de leur enfant uniquement) | ✅ fait — migration 0048 + fonction `mcp` (outils « parent » pour les clés `nxa_` ; OAuth parent limité aux applications reconnues, table `oauth_hotes_parents` ; écritures = brouillons validés par le parent ; onglet « Mon assistant IA » ; offre Premium) |
| 12 | F12 Automatisations personnelles en langage naturel (Paramètres) | ⏭ **PROCHAINE** (attend l'autorisation de l'utilisateur) |

Méthode de livraison demandée par l'utilisateur (21/11/2026) : un commit local à la fin de chaque tâche ; à la fin de F12, commit local, puis push sur son GitHub, puis publication sur Cloudflare et GitHub Pages (et déploiement des migrations 0041 à 0048, de la fonction `mcp` et du Worker `maintien`).

Décisions déjà prises avec l'utilisateur : périodes personnalisées (semestres) = regroupements de séquences ; « modifier le template » = textes, variables, couleurs, police, positions (pas d'éditeur libre) ; confirmation de lecture = liste des élèves dont le parent a ouvert le courrier + bouton « J'ai pris connaissance » ; F11 et F12 réservés à l'offre Premium (IA), les autres modules ouverts à toutes les offres (réglables par école dans la Console) ; le choix technique de F12 (modèle d'IA côté serveur ou catalogue guidé) sera soumis à l'utilisateur le moment venu.

## Autres tâches en attente (hors programme du jour)
- #80 Audit avancé + corrections (largement fait : advisors Supabase revus).
- #81 Durcissement sécurité **légal** (dépôt public, HSTS/CSP, WAF et anti-bot Cloudflare, RLS). Jamais de virus ni de contre-attaque ; refus déjà expliqué à l'utilisateur.
- Mineurs : activer la protection contre les mots de passe compromis (Supabase Auth, action de l'utilisateur) ; certificat de `www.nexiaschool.com`.

## État de la production
- **Déployé** : fonction MCP v9 et migrations jusqu'à `0040`.
- **Pas encore déployé** (commits locaux/branche seulement) : migrations `0041` à `0048`, toute l'interface des tâches 1 à 11, la fonction `mcp` (outils des parents : redéployer ses 5 fichiers ensemble) et le Worker `workers/maintien` (il appelle désormais `relances_quotidiennes` chaque matin : à redéployer avec la migration 0046). Un déploiement unique (migrations, puis site) se fera sur demande de l'utilisateur.

## Poser le terrain (tests)
- Base de test : `PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=banc sh nexiaschool-web/supabase/tests/lancer.sh` (démarrer avant : `service postgresql start`). Dernier résultat : 646 vérifications SQL (dont 36 pour les PV, 36 pour les relances, 29 pour les courriers administratifs, 28 pour les assistants IA des parents), 152 tests vitest (`npx vitest run`).
- Poste Windows de l'utilisateur (`C:\Users\user\Downloads\Nexiaschool`, sans PostgreSQL ni Docker utilisable) : scénario rejoué sur PGlite (PostgreSQL 17 en WebAssembly) avec un mini-interpréteur psql hors dépôt (`…/scratchpad/banc-sql/psql.mjs`, `@electric-sql/pglite@0.5.15`). Sous PostgreSQL 17, `ON DELETE RESTRICT` lève `restrict_violation` : l'interpréteur l'accepte là où le scénario attend `foreign_key_violation`. Le test vitest `zip.test.js` échoue sous Windows (encodage de la commande `unzip`), sans lien avec l'application.
- Parcours navigateur (banc d'essai) : dossier `…/scratchpad/banc/` de la session (scripts `parcours_*.cjs`, `relancer.sh`, `demarrer.sh`). **Il vit hors dépôt et peut avoir disparu** : le recréer au besoin (faux Supabase `serveur.mjs` sur Postgres, `vite preview` port 4173, Playwright déjà installé).
- Note : `parcours_en.cjs` (anglais) échoue depuis le 8/11 sur la recherche du compte de test du fondateur, sans lien avec l'application.

## Acquis techniques utiles
- Navigation des Paramètres regroupée en 5 rubriques (`src/pages/Parametres.jsx`, constante `GROUPES`).
- Fonctionnalités réglables par école : liste `_fonctions_reglables()` / `offre_requise()` (migrations) et `src/lib/offres.js` ; nouvelles : `distinctions`, `cartes`, `parcours`, `pv`.
- PV et rapports : moteur pur `src/lib/pv/moteur.js` (pvClasse, pvGroupe, pvIndividuel, comparer), textes `textes.js` (synthèses tirées des seules données), chargement `donnees.js` / `individuels.js`, sorties `pdf.js` / `export.js` ; écrans `src/pages/pv/` (route `/notes/pv/*`). Les PV individuels publiés sont des copies figées (aucune note d'un autre élève, seulement des moyennes de groupe) ; `parent_pv` ne rend que celles de l'enfant.
- Moteurs : `src/lib/distinctions.js`, `parcours.js`, `donneesParcours.js` (propositions), `decisions.js` (critères étendus), `cartePdf.js`, `certificatPdf.js`, `zip.js`, `periodes.js` (périodes personnalisées prêtes pour les PV).
- Pièges SQL : `:'variable'` psql non interpolé dans `do $$ … $$` (passer par `set_config`) ; une fonction qui modifie des données ne se vérifie pas dans la même instruction `select`.
- Les messages d'erreur d'un outil de sécurité peuvent bloquer un script shell qui contient des suppressions ; préférer les outils d'édition de fichiers.
