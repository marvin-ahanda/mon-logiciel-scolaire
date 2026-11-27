// Service worker de NexIA School — application « offline-first », pensée pour les connexions mobiles lentes ou instables.
//
//  * Interface (page, scripts, styles, polices, icônes) : « cache d'abord ». L'essentiel est gardé dès l'installation ;
//    le reste (pages secondaires, PDF, Excel…) est préchargé ensuite, en arrière-plan, seulement si la connexion le permet,
//    et sinon gardé au fil des pages ouvertes.
//  * Pages : la coquille de l'application s'affiche tout de suite depuis l'appareil ; à défaut, page « hors ligne ».
//  * Données (API Supabase, lectures) : « réseau d'abord, avec repli sur le cache ». Si le réseau tarde (connexion lente),
//    la dernière copie connue s'affiche après quelques secondes et la mise à jour continue en arrière-plan.
//  * Photos et logos (stockage Supabase) : copie locale d'abord, rafraîchie en arrière-plan.
//  * Les écritures ne passent jamais par le cache : les saisies faites hors ligne sont gardées par l'application
//    (IndexedDB, src/lib/horsLigne.js) et envoyées au retour du réseau.
// Ce fichier est un modèle : la version et les listes de fichiers sont insérées à la compilation (vite.config.js).
const VERSION = "30f4a6fc15ac"
const APP = `nexiaschool-app-${VERSION}`
const DONNEES = "nexiaschool-donnees"
const IMAGES = "nexiaschool-images"
const ESSENTIELS = ["/mon-logiciel-scolaire/","/mon-logiciel-scolaire/app-shell","/mon-logiciel-scolaire/hors-ligne/","/mon-logiciel-scolaire/hors-ligne/offline.js","/mon-logiciel-scolaire/favicon-64.png","/mon-logiciel-scolaire/logo-nexia-192.png","/mon-logiciel-scolaire/logo-nexia-512.png","/mon-logiciel-scolaire/manifest.webmanifest","/mon-logiciel-scolaire/assets/index-BrNdkkJA.js","/mon-logiciel-scolaire/assets/index-CjLxe7wU.css","/mon-logiciel-scolaire/assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2","/mon-logiciel-scolaire/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2","/mon-logiciel-scolaire/assets/inter-greek-ext-wght-normal-DlzME5K_.woff2","/mon-logiciel-scolaire/assets/inter-greek-wght-normal-CkhJZR-_.woff2","/mon-logiciel-scolaire/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","/mon-logiciel-scolaire/assets/inter-latin-wght-normal-Dx4kXJAl.woff2","/mon-logiciel-scolaire/assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2","/mon-logiciel-scolaire/assets/poppins-latin-300-normal-Dku2WoCh.woff2","/mon-logiciel-scolaire/assets/poppins-latin-400-normal-cpxAROuN.woff2","/mon-logiciel-scolaire/assets/poppins-latin-500-normal-C8OXljZJ.woff2","/mon-logiciel-scolaire/assets/poppins-latin-600-normal-zEkxB9Mr.woff2"]
const SECONDAIRES = ["/mon-logiciel-scolaire/assets/Abonnement-Clyp-E5p.js","/mon-logiciel-scolaire/assets/AbonnementEnseignant-gmsWed1f.js","/mon-logiciel-scolaire/assets/Acces-Cg6E9CaR.js","/mon-logiciel-scolaire/assets/AccesEnseignant-B5hvtmgf.js","/mon-logiciel-scolaire/assets/AlertesDiscipline-DwP3d8rE.js","/mon-logiciel-scolaire/assets/Automatisations-BHK3JIvL.js","/mon-logiciel-scolaire/assets/Bulletins-Br6iZaVl.js","/mon-logiciel-scolaire/assets/Calendrier-C5HzsUUd.js","/mon-logiciel-scolaire/assets/Capacite-BpVjPzW9.js","/mon-logiciel-scolaire/assets/ChoixClassePeriode-BfwDZno5.js","/mon-logiciel-scolaire/assets/Console-q8Lk7bn7.js","/mon-logiciel-scolaire/assets/Consultation-DjjlZKFZ.js","/mon-logiciel-scolaire/assets/Courrier-Drfoz5KT.js","/mon-logiciel-scolaire/assets/Developpeur-BvB7MIj4.js","/mon-logiciel-scolaire/assets/Developpeurs-B4DZw6ga.js","/mon-logiciel-scolaire/assets/Discipline-DW1ukR56.js","/mon-logiciel-scolaire/assets/Eleves-B1-WzSb8.js","/mon-logiciel-scolaire/assets/EmploiDuTemps-enHnRpdG.js","/mon-logiciel-scolaire/assets/Espace-rTzTFqtK.js","/mon-logiciel-scolaire/assets/EspaceEnseignant-ubLKzs_-.js","/mon-logiciel-scolaire/assets/Etablissement-D4B3ClJo.js","/mon-logiciel-scolaire/assets/EvaluationEleve-DDn5WeSN.js","/mon-logiciel-scolaire/assets/Excel-D24Cm0IW.js","/mon-logiciel-scolaire/assets/Finance-BS5tGnes.js","/mon-logiciel-scolaire/assets/FormulaireEvaluation-CAaYpxxB.js","/mon-logiciel-scolaire/assets/GroupeEnseignant-_g-xwKF7.js","/mon-logiciel-scolaire/assets/IaEnseignant-Cx1E6fOD.js","/mon-logiciel-scolaire/assets/InstitutionsConsole-DD2Ic0ze.js","/mon-logiciel-scolaire/assets/Legal-CtXz9P54.js","/mon-logiciel-scolaire/assets/MesBulletinsPaie-BV_jSyP8.js","/mon-logiciel-scolaire/assets/OAuthAutoriser-DkajdCs8.js","/mon-logiciel-scolaire/assets/Parametres-CecK5CY7.js","/mon-logiciel-scolaire/assets/ParametresCartes-BnioCIwz.js","/mon-logiciel-scolaire/assets/ParametresDistinctions-q5pskowc.js","/mon-logiciel-scolaire/assets/ParametresParcours-3pKNttuD.js","/mon-logiciel-scolaire/assets/ParametresTransition-DYW7XORY.js","/mon-logiciel-scolaire/assets/Parent-D6fimuH0.js","/mon-logiciel-scolaire/assets/Personnel-T5yj9IeV.js","/mon-logiciel-scolaire/assets/Pv-Xztq-Q6w.js","/mon-logiciel-scolaire/assets/PvIndividuelVue-DnaDwkYz.js","/mon-logiciel-scolaire/assets/Resultats-BgcRDGcG.js","/mon-logiciel-scolaire/assets/RetardsNotes-B0iHSBJ7.js","/mon-logiciel-scolaire/assets/Saisie-CkG-ekED.js","/mon-logiciel-scolaire/assets/Site-DU0gYRXU.css","/mon-logiciel-scolaire/assets/Site-DmyCVbdX.js","/mon-logiciel-scolaire/assets/SmartEval-mMPoNNbg.js","/mon-logiciel-scolaire/assets/SmartEvalEnseignant-BbhVZSDj.js","/mon-logiciel-scolaire/assets/Statistiques-B6xbWdkz.js","/mon-logiciel-scolaire/assets/Tarifs-rg0Aqizi.js","/mon-logiciel-scolaire/assets/Verifier-op8eOMQh.js","/mon-logiciel-scolaire/assets/VerifierCarte-Bz02sz-e.js","/mon-logiciel-scolaire/assets/VerifierDistinction-DuRXFjpg.js","/mon-logiciel-scolaire/assets/VerifierRecu-ByhEmZwZ.js","/mon-logiciel-scolaire/assets/browser-CuoXkm-K.js","/mon-logiciel-scolaire/assets/bulletinPdf-DKZ4ew37.js","/mon-logiciel-scolaire/assets/calculs-BvnG-vUq.js","/mon-logiciel-scolaire/assets/certificatPdf-B262ebaj.js","/mon-logiciel-scolaire/assets/decisions-BG_ELjkF.js","/mon-logiciel-scolaire/assets/distinctions-yoqNjSMn.js","/mon-logiciel-scolaire/assets/donnees-DC7GLcCD.js","/mon-logiciel-scolaire/assets/donneesClasse-CqnTwrFO.js","/mon-logiciel-scolaire/assets/donneesDiscipline-CZcWDRsd.js","/mon-logiciel-scolaire/assets/donneesParcours-BqJwBEwM.js","/mon-logiciel-scolaire/assets/edt-BN6GUDL9.css","/mon-logiciel-scolaire/assets/edt-CF3GLCrr.js","/mon-logiciel-scolaire/assets/excel-BdGKCfHV.js","/mon-logiciel-scolaire/assets/financeDocs-Cq0xRG91.js","/mon-logiciel-scolaire/assets/financePdf-RExfwRcS.js","/mon-logiciel-scolaire/assets/html2canvas.esm-DXEQVQnt.js","/mon-logiciel-scolaire/assets/i18n-en-D8hjBVbP.js","/mon-logiciel-scolaire/assets/index-CCuMBCja.js","/mon-logiciel-scolaire/assets/index-nAsOKeUK.js","/mon-logiciel-scolaire/assets/index.es-DPaO6iPh.js","/mon-logiciel-scolaire/assets/jspdf.es.min-7fALGN6f.js","/mon-logiciel-scolaire/assets/jspdf.plugin.autotable-B0IxatYY.js","/mon-logiciel-scolaire/assets/parent-B6dnWXwe.js","/mon-logiciel-scolaire/assets/periodes-C5iohxpM.js","/mon-logiciel-scolaire/assets/photos-D8RzkVT5.js","/mon-logiciel-scolaire/assets/publication-DIApiie3.js","/mon-logiciel-scolaire/assets/purify.es-18JuyMri.js","/mon-logiciel-scolaire/assets/recuPdf-B3MGq-h-.js","/mon-logiciel-scolaire/assets/relances-DRVcsllY.js","/mon-logiciel-scolaire/assets/signatures-CLmt5aBk.js","/mon-logiciel-scolaire/assets/smartevalPdf-CYlmy_rG.js","/mon-logiciel-scolaire/assets/statistiques-ChhV9Cka.js","/mon-logiciel-scolaire/assets/worker-DEaeOJUM.js"]
const BASE = "/mon-logiciel-scolaire/"
const COQUILLE = `${BASE}app-shell`            // coquille neutre de l'application monopage (app-shell.html, sans contenu pré-rendu)
// Pages publiques pré-rendues (même liste que src/lib/seo-pages.js) : servies par le réseau d'abord, copie locale hors ligne
const PUBLIQUES = new Set(["", "tarifs", "tarifs/smarteval", "commencer", "inscription", "smarteval/inscription", "developpeurs", "confidentialite", "conditions"])
const PAGE_HORS_LIGNE = `${BASE}hors-ligne/`             // adresse sans « .html » : servie sans redirection partout
const DELAI_DONNEES = 4000                     // au-delà, la copie locale s'affiche (si elle existe)
const MAX_DONNEES = 600, MAX_IMAGES = 400

// Lectures par fonctions (POST) sans aucun effet sur les données : elles peuvent être gardées pour l'usage hors ligne
const RPC_LECTURE = new Set(["edt_lire", "edt_versions", "edt_brouillon_lire", "smarteval_detail", "smarteval_contexte", "smarteval_liste",
  "smarteval_journal", "smarteval_notifications", "notes_retards", "discipline_alertes", "moratoires_actifs", "mon_compte", "finance_eleves",
  "finance_alertes", "courrier_liste", "courrier_notifications", "mes_fonctions"])

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(ESSENTIELS)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const cles = await caches.keys()
    await Promise.all(cles.filter((c) => c.startsWith("nexiaschool-app-") && c !== APP).map((c) => caches.delete(c)))
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {})
    await self.clients.claim()
  })())
})

/** Connexion suffisante pour précharger le reste de l'application (pas en 2G ni en « économie de données »). */
function bonneConnexion() {
  const c = self.navigator.connection
  return !c || (!c.saveData && !/2g/.test(c.effectiveType || ""))
}

async function prechauffer() {
  if (!bonneConnexion()) return
  const cache = await caches.open(APP)
  for (const f of SECONDAIRES) {                      // un fichier à la fois : la bande passante reste à l'utilisateur
    if (await cache.match(f)) continue
    try { const r = await fetch(f, { cache: "no-cache" }); if (r.ok) await cache.put(f, r) } catch { return }
    if (!bonneConnexion()) return
  }
}

self.addEventListener("message", (e) => {
  if (e.data === "vider-donnees") e.waitUntil(Promise.all([caches.delete(DONNEES), caches.delete(IMAGES)]))   // à la déconnexion
  else if (e.data === "prechauffer") e.waitUntil(prechauffer())
  else if (e.data === "version") e.source?.postMessage({ type: "version", version: VERSION })
})

// Synchronisation en arrière-plan (navigateurs qui la prennent en charge) : l'application envoie sa file d'attente
self.addEventListener("sync", (e) => {
  if (e.tag === "nexiaschool-envois") e.waitUntil(self.clients.matchAll({ type: "window" }).then((l) => l.forEach((c) => c.postMessage({ type: "synchroniser" }))))
})

async function limiter(nom, max) {
  const c = await caches.open(nom), cles = await c.keys()
  for (let i = 0; i < cles.length - max; i++) await c.delete(cles[i])
}

async function signalerLenteur(lent) {
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "reseau-lent", lent })
}

/** Réseau d'abord ; repli sur la copie locale si le réseau échoue, ou s'il dépasse le délai alors qu'une copie existe. */
async function reseauDabord(e, cle, nomCache) {
  const cache = await caches.open(nomCache)
  const copie = await cache.match(cle, { ignoreVary: true })
  // la réponse part tout de suite ; la copie locale s'écrit en arrière-plan
  const reseau = fetch(e.request).then((r) => {
    if (r.ok) e.waitUntil(cache.put(cle, r.clone()).then(() => limiter(nomCache, MAX_DONNEES)).catch(() => {}))
    return r
  })
  if (!copie) return reseau
  let minuteur
  const delai = new Promise((ok) => { minuteur = setTimeout(() => ok("delai"), DELAI_DONNEES) })
  try {
    const gagnant = await Promise.race([reseau, delai])
    clearTimeout(minuteur)
    if (gagnant === "delai") { e.waitUntil(reseau.catch(() => {})); signalerLenteur(true); return copie }
    return gagnant
  } catch {
    clearTimeout(minuteur)
    return copie
  }
}

/** Copie locale d'abord (fichiers immuables : leur nom change à chaque version). */
async function cacheDabord(requete) {
  const copie = await caches.match(requete, { ignoreVary: true })
  if (copie) return copie
  const r = await fetch(requete)
  if (r.ok && new URL(requete.url).origin === self.location.origin) (await caches.open(APP)).put(requete, r.clone())
  return r
}

/** Copie locale tout de suite, mise à jour en arrière-plan (images du stockage). */
async function copiePuisMaj(e, cle) {
  const cache = await caches.open(IMAGES)
  const copie = await cache.match(cle)
  const reseau = fetch(e.request).then((r) => { if (r.ok) e.waitUntil(cache.put(cle, r.clone()).then(() => limiter(IMAGES, MAX_IMAGES)).catch(() => {})); return r })
  if (copie) { e.waitUntil(reseau.catch(() => {})); return copie }
  return reseau
}

/** Pages : coquille de l'application depuis l'appareil ; sinon réseau ; sinon page « hors ligne ». */
async function pagePublique(e) {
  try {
    const r = await fetch(e.request)
    if (r.ok) { const c = r.clone(); e.waitUntil(caches.open(APP).then((cache) => cache.put(e.request, c)).catch(() => {})) }
    return r
  } catch {
    return (await caches.match(e.request, { cacheName: APP })) || (await caches.match(COQUILLE, { cacheName: APP }))
      || (await caches.match(PAGE_HORS_LIGNE, { cacheName: APP })) || new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
}

async function page(e) {
  const coquille = await caches.match(COQUILLE, { cacheName: APP })
  if (coquille) {
    e.waitUntil((async () => { try { await e.preloadResponse } catch { /* préchargement indisponible */ } })())
    return coquille
  }
  try {
    const pre = await e.preloadResponse
    if (pre) return pre
    return await fetch(e.request)
  } catch {
    return (await caches.match(PAGE_HORS_LIGNE, { cacheName: APP })) || new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
}

/** Clé de cache d'une lecture par fonction (POST) : adresse + corps de la requête. */
async function cleRpc(requete) {
  const corps = await requete.clone().text()
  const empreinte = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(corps))
  const hex = [...new Uint8Array(empreinte)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
  return new Request(`${requete.url}?__corps=${hex}`)
}

self.addEventListener("fetch", (e) => {
  const r = e.request
  const url = new URL(r.url)
  if (url.origin === self.location.origin) {
    if (r.method !== "GET") return
    // vidéos (lecture par morceaux) : laissées au navigateur, jamais mises en cache par le service worker
    if (r.headers.has("range") || r.destination === "video" || /\.(mp4|webm)$/.test(url.pathname)) return
    // serveur MCP, OAuth et services Cloudflare : jamais mis en cache
    if (/^\/(mcp|\.well-known|oauth\/(register|token)|cdn-cgi|\.netlify)/.test(url.pathname.slice(BASE.length - 1))) return
    if (r.mode === "navigate") {
      const chemin = url.pathname.slice(BASE.length).replace(/\/+$/, "")
      if (/\.[a-z0-9]+$/i.test(chemin)) return                               // fichier (robots.txt, sitemap.xml…) : jamais la coquille
      e.respondWith(PUBLIQUES.has(chemin) ? pagePublique(e) : page(e))
      return
    }
    e.respondWith(cacheDabord(r))
    return
  }
  // API Supabase : lectures de tables (GET) et fonctions de lecture (POST) ; jamais l'authentification
  if (url.pathname.startsWith("/rest/v1/rpc/") && r.method === "POST") {
    if (!RPC_LECTURE.has(url.pathname.slice("/rest/v1/rpc/".length))) return
    e.respondWith(cleRpc(r).then((cle) => reseauDabord(e, cle, DONNEES)))
    return
  }
  if (r.method !== "GET") return
  if (url.pathname.startsWith("/rest/v1/")) { e.respondWith(reseauDabord(e, r, DONNEES)); return }
  // photos et logos : la clé ignore le jeton de signature (qui change à chaque lecture)
  if (/^\/storage\/v1\/(object|render\/image)\/(sign|public|authenticated)\/(photos|logos)\//.test(url.pathname)) {
    e.respondWith(copiePuisMaj(e, new Request(url.origin + url.pathname)))
  }
})
