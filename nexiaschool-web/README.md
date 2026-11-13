# NexIASchool — version web (Netlify + Supabase, plans Free)

Gestion des notes scolaires multi-établissements : React (Vite) hébergé sur **Netlify**,
base de données, authentification et stockage sur **Supabase**.

## Fonctionnalités

| Module | Contenu |
|---|---|
| Accès | Création de l'espace d'un établissement par **connexion Google** (fondateur) ; le personnel entre avec **nom + code de l'établissement** (8 caractères), puis choisit son nom dans la liste (A à Z) et saisit son **code personnel** (6 caractères). Blocages : 10 essais/15 min (établissement), 5 essais/15 min (personnel). |
| Rôles | Administration (tout), Enseignant (ses notes, résultats, bulletins de ses classes), Surveillant général (discipline). |
| Paramètres | Établissement, exercices et séquences verrouillables, classes, matières, matières par classe (coefficients, groupes, enseignant), discipline (sanctions, infractions, barème). |
| Personnel | Comptes et codes d'accès (affichés une seule fois, chiffrés en base), nouveau code, désactivation. |
| Élèves | Fiches, inscription dans une classe, photo (privée, réduite à 400 px). |
| Notes | Saisie, résultats (séquence, trimestre, année ; rangs ex æquo, coefficient minimum), bulletins imprimables avec conduite. |
| Discipline | Appel du jour (absences justifiées/non justifiées, retards), infractions et sanctions, suivi et note de discipline. |
| Excel | Modèle, import (aperçu, tout ou rien) et export des élèves ; liste et import des notes ; export des résultats. |
| Statistiques | Par classe (répartition par tranche et par sexe, par matière), comparaison des classes et niveaux, effectifs par sexe et âge. |

## Structure

```
nexiaschool-web/
├── index.html, vite.config.js, package.json, netlify.toml
├── netlify/functions/maintien.mjs     fonction planifiée : évite la pause du projet Supabase gratuit
├── src/
│   ├── main.jsx, App.jsx, Session.jsx, supabase.js, styles.css
│   ├── composants/                    mise en page, communs, choix classe/période
│   ├── lib/                           calculs (moyennes, rangs), discipline, statistiques, excel, photos…
│   └── pages/                         Acces, Accueil, Parametres, Personnel, Eleves, Saisie, Resultats,
│                                      Bulletins, Discipline, Excel, Statistiques
└── supabase/
    ├── migrations/0001…0006.sql       schéma, RLS, fonctions sécurisées, stockage, discipline, import
    └── tests/                         scénario SQL de bout en bout (47 vérifications) sur PostgreSQL local
```

## Installation locale

```bash
cd nexiaschool-web
npm install
cp .env.example .env.local      # renseigner l'URL et la clé publique (publishable) Supabase
npm run dev                     # http://localhost:5173
npm test                        # tests des calculs (Vitest)
```

Tests SQL (PostgreSQL 15+ local) : `PGHOST=… PGPORT=… PGUSER=postgres sh supabase/tests/lancer.sh`

## Configuration Supabase (une seule fois)

1. **Schéma** : exécuter les migrations `supabase/migrations/0001` à `0006` dans l'ordre
   (SQL Editor → New query → coller → Run).
2. **Google** :
   - Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (type « Web application »).
     *Authorized redirect URI* : `https://<ref-projet>.supabase.co/auth/v1/callback`.
   - Supabase → Authentication → Sign In / Providers → **Google** : activer, coller *Client ID* et *Client Secret*.
3. **Adresses** : Supabase → Authentication → URL Configuration
   - *Site URL* : `https://nexiaschool.pages.dev`
   - *Redirect URLs* : `https://nexiaschool.pages.dev/**` (et `http://localhost:5173/**` pour le développement).
4. **Email** : laisser le fournisseur *Email* activé (le personnel s'y connecte par code, sans e-mail réel)
   et laisser « Allow new users to sign up » activé (indispensable à la connexion Google).

Aucune clé secrète n'est utilisée par l'application : les opérations sensibles sont des fonctions SQL
`SECURITY DEFINER`, et chaque table est protégée par RLS.

## Netlify

| Variable | Valeur | Remarque |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref-projet>.supabase.co` | publique |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | publique (faite pour le navigateur) |

Déploiement : Netlify → projet → *Project configuration* → *Build & deploy* → *Link repository* →
dépôt GitHub, branche voulue, **Base directory `nexiaschool-web`**. Le reste vient de `netlify.toml`
(`npm run build`, publication de `dist`, redirection SPA, en-têtes de sécurité, fonction planifiée).

## Limites Free respectées

- Netlify : site statique (~180 Ko compressés + modules Excel chargés à la demande), une seule fonction
  planifiée par jour ; aucune fonction appelée par les utilisateurs.
- Supabase : 500 Mo de base, 1 Go de stockage (photos ~40 Ko), 50 000 utilisateurs actifs par mois ;
  pagination par 1000 lignes ; au plus 100 créations d'établissement par jour ; requête quotidienne pour éviter
  la mise en pause après 7 jours d'inactivité.
