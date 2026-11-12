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
const VERSION = "__VERSION__"
const APP = `nexiaschool-app-${VERSION}`
const DONNEES = "nexiaschool-donnees"
const IMAGES = "nexiaschool-images"
const ESSENTIELS = __ESSENTIELS__
const SECONDAIRES = __SECONDAIRES__
const BASE = "__BASE__"
const COQUILLE = BASE                         // index.html de l'application monopage
const PAGE_HORS_LIGNE = `${BASE}hors-ligne/`             // adresse sans « .html » : servie sans redirection partout
const DELAI_DONNEES = 4000                     // au-delà, la copie locale s'affiche (si elle existe)
const MAX_DONNEES = 600, MAX_IMAGES = 400

// Lectures par fonctions (POST) sans aucun effet sur les données : elles peuvent être gardées pour l'usage hors ligne
const RPC_LECTURE = new Set(["edt_lire", "edt_versions", "edt_brouillon_lire", "smarteval_detail", "smarteval_contexte", "smarteval_liste",
  "smarteval_journal", "smarteval_notifications", "notes_retards", "discipline_alertes", "moratoires_actifs", "mon_compte", "finance_eleves",
  "finance_alertes", "courrier_liste", "courrier_notifications"])

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
    // serveur MCP, OAuth et services Cloudflare : jamais mis en cache
    if (/^\/(mcp|\.well-known|oauth\/(register|token)|cdn-cgi|\.netlify)/.test(url.pathname.slice(BASE.length - 1))) return
    if (r.mode === "navigate") { e.respondWith(page(e)); return }
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
