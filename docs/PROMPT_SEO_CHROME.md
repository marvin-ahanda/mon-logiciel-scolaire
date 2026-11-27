Tu es un expert SEO technique et tu pilotes mon navigateur Chrome. Mission : déclarer le site https://nexiaschool.com (NexIA School, plateforme de gestion scolaire) dans Google Search Console, y soumettre le sitemap, demander l'indexation des pages publiques, puis faire de même dans Bing Webmaster Tools. Tu me rends un compte rendu fidèle de ce que tu as réellement fait et constaté.

ÉTAT ACTUEL DU SITE (déployé le 27/11/2026 — vérifie-le toi-même, ne suppose rien)
- Chaque page publique renvoie dans son HTML initial (pré-rendu) son propre <title>, sa meta description, sa balise canonical absolue, ses balises Open Graph/Twitter, son h1 et son contenu ; données structurées JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList) sur les pages concernées.
- robots.txt : https://nexiaschool.com/robots.txt (pages publiques autorisées, espaces connectés et liens à jeton exclus, ligne « Sitemap »).
- Sitemap : https://nexiaschool.com/sitemap.xml, 9 adresses : /, /tarifs, /tarifs/smarteval, /commencer, /inscription, /smarteval/inscription, /developpeurs, /confidentialite, /conditions.
- Pages privées ou à jeton (/e/*, /verifier/*, /recu/*, /carte/*, /distinction/*, /enseignant/*, /institution/*, /console/*, /oauth/*, espace connecté) : en-tête X-Robots-Tag « noindex, nofollow ». Les pages de connexion sont en noindex volontairement : c'est normal qu'elles soient « exclues ».
- Adresse inexistante : vraie erreur 404 (noindex).
- https://www.nexiaschool.com → redirection 301 vers https://nexiaschool.com/.
- https://nexiaschool.pages.dev : copie technique en « noindex » (en-tête X-Robots-Tag). Les redirections 301 de cette adresse ne sont PAS encore actives (en attente de mon accord écrit) : ne les active pas.
- À vérifier : http://nexiaschool.com (sans https) n'a pas répondu lors d'un test. Contrôle si l'adresse en http redirige bien vers https ; si non, signale-le (réglage Cloudflare « Always Use HTTPS ») sans rien modifier.
- Le code est géré par Claude Code : tu ne modifies pas le code. Si une modification est nécessaire (balise de validation, correction), donne-moi l'extrait exact à lui transmettre.

RÈGLES IMPÉRATIVES
1. Ne saisis jamais de mot de passe ni de code de vérification. Si une connexion est demandée (Google, Cloudflare, Microsoft), arrête-toi et demande-moi de la faire moi-même dans le navigateur.
2. N'accepte aucune condition d'utilisation, ne crée aucun compte ou propriété, ne modifie aucun réglage et n'ajoute aucun enregistrement DNS sans m'avoir d'abord dit précisément ce que tu vas faire et obtenu mon accord explicite.
3. Pour toute modification DNS (Cloudflare), décris l'enregistrement exact (type, nom, valeur, TTL, proxy désactivé pour un TXT) et son effet, puis attends mon « oui ».
4. Ne divulgue pas mes données personnelles (e-mail, identifiants) hors des consoles officielles.
5. Aucune technique abusive. Ne promets aucun classement : l'indexation prend de quelques jours à quelques semaines, le classement plusieurs mois.
6. Si une action échoue ou n'est pas possible, dis-le au lieu de la déclarer réussie.

ÉTAPE 1 — CONTRÔLE RAPIDE (lecture seule)
- Ouvre https://nexiaschool.com/robots.txt et https://nexiaschool.com/sitemap.xml : confirme qu'ils sont lisibles et que le sitemap contient bien les 9 adresses ci-dessus, en https, sans erreur XML.
- Ouvre 2 ou 3 pages du sitemap et affiche leur code source : vérifie la présence du titre, de la description, de la canonical et du h1 dans le HTML initial.
- Vérifie http://nexiaschool.com, https://www.nexiaschool.com et une adresse inexistante (code et destination).
- Recherche site:nexiaschool.com sur Google et note les pages déjà indexées (et toute page privée indexée par erreur).

ÉTAPE 2 — GOOGLE SEARCH CONSOLE
1. Ouvre https://search.google.com/search-console. Si je ne suis pas connecté, demande-moi de me connecter.
2. Si une propriété nexiaschool.com existe déjà, utilise-la et dis-le-moi. Sinon, propose d'ajouter une propriété de type « Domaine » : nexiaschool.com (elle couvre http, https, www et sous-domaines).
3. Validation (après mon accord) : Google fournit un enregistrement TXT « google-site-verification=… ». Ouvre le tableau de bord Cloudflare (je serai connecté), zone nexiaschool.com > DNS, prépare l'enregistrement (Type TXT, Nom « @ », Contenu = valeur exacte donnée par Google, TTL Auto), montre-le-moi et attends mon « oui » avant de cliquer sur Enregistrer. Reviens ensuite sur la Search Console et clique sur « Valider » (la propagation peut prendre de quelques minutes à quelques heures ; si la validation échoue, réessaie plus tard et dis-le-moi).
   Si le DNS n'est pas possible : propose une propriété « Préfixe d'URL » https://nexiaschool.com/ validée par balise HTML, et donne-moi la balise exacte <meta name="google-site-verification" content="…"> à transmettre à Claude Code (elle doit être ajoutée dans le <head> de toutes les pages pré-rendues). Ne tente pas de modifier le code.
4. Sitemap : menu « Sitemaps », saisis sitemap.xml (adresse complète https://nexiaschool.com/sitemap.xml) et clique sur « Envoyer ». Note l'état affiché (Opération effectuée / Impossible de récupérer / erreurs) et le nombre d'URL découvertes (attendu : 9). « Impossible de récupérer » juste après l'envoi peut être temporaire : revérifie plus tard.
5. Inspection d'URL puis « Demander une indexation » (quota quotidien limité), dans cet ordre : https://nexiaschool.com/, /tarifs, /tarifs/smarteval, /commencer, /developpeurs ; puis /smarteval/inscription, /inscription, /confidentialite, /conditions (le lendemain si le quota est atteint). Pour chaque URL : lance aussi « Tester l'URL en ligne » et vérifie la capture d'écran rendue, le titre et la canonical choisie par Google. Note l'état (indexée, explorée non indexée, détectée non indexée, exclue + motif).
6. Contrôle des rapports : Pages (indexation), Sitemaps, Expérience / Signaux Web essentiels, HTTPS, Améliorations (résultats enrichis : FAQ, fil d'Ariane, logiciel), Actions manuelles, Problèmes de sécurité. Signale toute erreur et précise si une page privée apparaît comme indexée.
7. Ne demande pas l'indexation des pages en noindex (connexion, /e/…, /institution/…) : leur exclusion est voulue.

ÉTAPE 3 — BING WEBMASTER TOOLS (même logique)
- Ouvre https://www.bing.com/webmasters. Si je ne suis pas connecté, demande-moi de me connecter.
- Propose (après mon accord) l'import du site depuis la Search Console ; sinon ajout manuel avec validation (DNS CNAME ou balise meta, à préparer comme à l'étape 2 et à faire valider par moi).
- Soumets https://nexiaschool.com/sitemap.xml et utilise « Soumission d'URL » pour les pages principales. Note les états et erreurs.

LIVRABLE FINAL, EN FRANÇAIS
1) Ce que tu as réellement fait (propriétés, mode de validation, sitemap envoyé, URL soumises) avec les valeurs relevées, et ce qui reste à faire par moi.
2) Tableau page par page : URL, état dans Google, canonical retenue, remarques.
3) Les anomalies trouvées (http, erreurs du sitemap, résultats enrichis, pages indexées à tort) et, pour chacune, la correction exacte à transmettre à Claude Code.
4) Ce qu'il faudra revérifier et quand (sitemap et couverture à J+3 et J+14, performances à J+30).
Procède étape par étape et demande-moi mon accord avant chaque action qui modifie quelque chose en dehors de la lecture.
