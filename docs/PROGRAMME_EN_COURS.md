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
| 5 | F5 PV de classe sans moyennes (rubrique **Notes**) | ⏭ **PROCHAINE** (attend l'autorisation de l'utilisateur) |
| 6 | F6 PV par cycle avec pourcentages (Notes) | à faire |
| 7 | F7 PV général de l'établissement (Notes) | à faire |
| 8 | F8 PV de performances individuelles + publication aux parents (Notes) | à faire |
| 9 | F10 Courriers administratifs aux parents (Courrier) + confirmation de lecture | à faire (avant F9) |
| 10 | F9 Relances automatiques d'insolvabilité (Finances) | à faire |
| 11 | F11 MCP pour les parents (Claude / Grok, données de leur enfant uniquement) | à faire |
| 12 | F12 Automatisations personnelles en langage naturel (Paramètres) | à faire |

Décisions déjà prises avec l'utilisateur : périodes personnalisées (semestres) = regroupements de séquences ; « modifier le template » = textes, variables, couleurs, police, positions (pas d'éditeur libre) ; confirmation de lecture = liste des élèves dont le parent a ouvert le courrier + bouton « J'ai pris connaissance » ; F11 et F12 réservés à l'offre Premium (IA), les autres modules ouverts à toutes les offres (réglables par école dans la Console) ; le choix technique de F12 (modèle d'IA côté serveur ou catalogue guidé) sera soumis à l'utilisateur le moment venu.

## Autres tâches en attente (hors programme du jour)
- #80 Audit avancé + corrections (largement fait : advisors Supabase revus).
- #81 Durcissement sécurité **légal** (dépôt public, HSTS/CSP, WAF et anti-bot Cloudflare, RLS). Jamais de virus ni de contre-attaque ; refus déjà expliqué à l'utilisateur.
- Mineurs : activer la protection contre les mots de passe compromis (Supabase Auth, action de l'utilisateur) ; certificat de `www.nexiaschool.com`.

## État de la production
- **Déployé** : fonction MCP v9 et migrations jusqu'à `0040`.
- **Pas encore déployé** (commits locaux/branche seulement) : migrations `0041` à `0044` et toute l'interface des tâches 1 à 4. Un déploiement unique (migrations, puis site) se fera sur demande de l'utilisateur.

## Poser le terrain (tests)
- Base de test : `PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=banc sh nexiaschool-web/supabase/tests/lancer.sh` (démarrer avant : `service postgresql start`). Dernier résultat : 517 vérifications SQL, 121 tests vitest (`npx vitest run`).
- Parcours navigateur (banc d'essai) : dossier `…/scratchpad/banc/` de la session (scripts `parcours_*.cjs`, `relancer.sh`, `demarrer.sh`). **Il vit hors dépôt et peut avoir disparu** : le recréer au besoin (faux Supabase `serveur.mjs` sur Postgres, `vite preview` port 4173, Playwright déjà installé).
- Note : `parcours_en.cjs` (anglais) échoue depuis le 8/11 sur la recherche du compte de test du fondateur, sans lien avec l'application.

## Acquis techniques utiles
- Navigation des Paramètres regroupée en 5 rubriques (`src/pages/Parametres.jsx`, constante `GROUPES`).
- Fonctionnalités réglables par école : liste `_fonctions_reglables()` / `offre_requise()` (migrations) et `src/lib/offres.js` ; nouvelles : `distinctions`, `cartes`, `parcours`.
- Moteurs : `src/lib/distinctions.js`, `parcours.js`, `donneesParcours.js` (propositions), `decisions.js` (critères étendus), `cartePdf.js`, `certificatPdf.js`, `zip.js`, `periodes.js` (périodes personnalisées prêtes pour les PV).
- Pièges SQL : `:'variable'` psql non interpolé dans `do $$ … $$` (passer par `set_config`) ; une fonction qui modifie des données ne se vérifie pas dans la même instruction `select`.
- Les messages d'erreur d'un outil de sécurité peuvent bloquer un script shell qui contient des suppressions ; préférer les outils d'édition de fichiers.
