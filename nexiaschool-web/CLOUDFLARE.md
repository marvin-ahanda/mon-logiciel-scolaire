# NexIA School sur Cloudflare (plan Free) + Supabase (plan Free)

## Ce qui est en place dans le dépôt

| Élément | Fichier | Rôle |
|---|---|---|
| Configuration Pages (« Cloudflare.toml ») | `wrangler.toml` | projet `nexiaschool`, dossier publié `dist/`, variables des Functions |
| En-têtes HTTP | `cloudflare/_headers` | sécurité (CSP, HSTS…), cache d'un an pour `/assets/*`, `sw.js` toujours revérifié |
| Routes des Functions | `cloudflare/_routes.json` | seules `/mcp`, `/.well-known/*`, `/oauth/register`, `/oauth/token` invoquent une Function |
| Relais MCP / OAuth | `functions/_middleware.js` | transmet ces adresses à la fonction Supabase `mcp` (équivalent des redirections Netlify) |
| Worker planifié | `workers/maintien/` | ping quotidien de Supabase (05:17 UTC) pour éviter la mise en pause du projet gratuit |
| Déploiement automatique | `.github/workflows/cloudflare.yml` | tests, construction, publication Pages + Worker à chaque envoi sur `netlify-supabase` |
| Service worker | `src/sw.js` (modèle complété à la construction par `vite.config.js`) | hors ligne, cache d'abord / réseau d'abord |
| Manifeste | `public/manifest.webmanifest` | application installable (icônes, raccourcis) |
| Page hors ligne | `public/hors-ligne/` | affichée si une page n'est pas disponible sans connexion |
| Stockage local + synchronisation | `src/lib/stockageLocal.js`, `src/lib/horsLigne.js` | file d'attente IndexedDB, envoi au retour du réseau, conflits |

Commandes : `npm run build:cloudflare` (construction), `npm run dev:cloudflare` (essai local sur http://localhost:8788),
`npm run deploy:cloudflare` (publication), `npm run deploy:maintien` (Worker planifié).

## Réglages à faire une fois (tableaux de bord)

1. **Jeton d'API Cloudflare** — dash.cloudflare.com → *Profil* → *Jetons d'API* → modifier le jeton (ou en créer un) avec :
   *Compte → Cloudflare Pages → Modifier* et *Compte → Workers Scripts → Modifier*.
2. **GitHub** — *Settings → Secrets and variables → Actions* : secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.
3. **Supabase** — *Authentication → URL Configuration → Redirect URLs* : ajouter `https://nexiaschool.pages.dev/**`
   (et le futur domaine propre). Sans cela, la connexion Google depuis Cloudflare revient sur le site Netlify.
4. **Domaine propre (facultatif mais conseillé)** — *Pages → nexiaschool → Custom domains*. Puis, pour compresser les photos :
   *Images → Transformations* → activer sur la zone, autoriser l'origine `woxdqzocwqnrpfmxlsbq.supabase.co`,
   et définir la variable GitHub `VITE_IMAGES_CLOUDFLARE=1` (5 000 transformations gratuites par mois).

## À garder en tête

- **Adresse principale : `https://nexiaschool.pages.dev`** (site, QR codes des nouveaux bulletins, serveur MCP
  `nexiaschool.pages.dev/mcp`, identité OAuth de la fonction Supabase `mcp`). L'ancien site Netlify reste en ligne pour les
  QR codes des bulletins déjà imprimés. Le jour où un domaine propre devient l'adresse officielle : changer l'adresse par défaut
  dans `src/lib/editeur.js` (ou `VITE_SITE_PLATEFORME`), `URL_MCP` (src/lib/retour.js), `ISSUER` (src/pages/OAuthAutoriser.jsx)
  et `BASE` / `NEXIA_BASE_URL` de la fonction Supabase `mcp`, en gardant l'ancienne adresse active.
- Plan Free Cloudflare : 500 constructions/mois (non utilisées : la construction se fait dans GitHub), Functions 100 000 requêtes/jour
  (seulement MCP/OAuth), bande passante du site illimitée.
