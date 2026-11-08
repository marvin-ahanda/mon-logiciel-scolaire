// Service worker de NexIA School : l'application s'ouvre même sans connexion.
//  * fichiers de l'application (page, scripts, styles, polices, images) : gardés sur l'appareil à l'installation ;
//  * données lues sur le serveur (requêtes GET de l'API) : réseau d'abord, dernière copie connue si la connexion manque ;
//  * les saisies faites hors ligne sont gardées par l'application elle-même (src/lib/horsLigne.js) et envoyées au retour du réseau.
// Ce fichier est un modèle : la version et la liste des fichiers sont insérées à la compilation (vite.config.js).
const VERSION = "__VERSION__"
const APP = `nexiaschool-app-${VERSION}`
const DONNEES = "nexiaschool-donnees"
const FICHIERS = __FICHIERS__
const BASE = "__BASE__"

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c.startsWith("nexiaschool-app-") && c !== APP).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()))
})

// À la déconnexion : les données d'élèves gardées sur l'appareil sont effacées
self.addEventListener("message", (e) => {
  if (e.data === "vider-donnees") e.waitUntil(caches.delete(DONNEES))
})

async function reseauDabord(requete, cache) {
  try {
    const reponse = await fetch(requete)
    if (reponse.ok) (await caches.open(cache)).put(requete, reponse.clone())
    return reponse
  } catch (erreur) {
    const copie = await caches.match(requete, { cacheName: cache, ignoreVary: true })
    if (copie) return copie
    throw erreur
  }
}

async function cacheDabord(requete) {
  const copie = await caches.match(requete, { ignoreVary: true })
  if (copie) return copie
  const reponse = await fetch(requete)
  if (reponse.ok && new URL(requete.url).origin === self.location.origin) (await caches.open(APP)).put(requete, reponse.clone())
  return reponse
}

self.addEventListener("fetch", (e) => {
  const r = e.request
  if (r.method !== "GET") return
  const url = new URL(r.url)
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/.well-known") || url.pathname.startsWith("/.netlify")) return
    if (r.mode === "navigate") {
      e.respondWith(fetch(r).catch(() => caches.match(BASE, { cacheName: APP })))
      return
    }
    e.respondWith(cacheDabord(r))
    return
  }
  // API de données (Supabase) : lectures seulement ; jamais l'authentification ni les fichiers signés
  if (url.pathname.startsWith("/rest/v1/")) e.respondWith(reseauDabord(r, DONNEES))
})
