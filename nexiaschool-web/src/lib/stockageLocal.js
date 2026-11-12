// Stockage local durable (IndexedDB) : file d'attente des saisies faites hors ligne et petites données de l'application.
// Repli automatique sur localStorage si IndexedDB est indisponible (navigation privée de certains navigateurs).
// Les réponses du serveur déjà consultées sont, elles, gardées par le service worker (Cache Storage).

const BASE = "nexiaschool", VERSION = 1, MAGASIN = "cles"

let ouverture = null
function ouvrir() {
  if (ouverture) return ouverture
  ouverture = new Promise((ok, ko) => {
    if (typeof indexedDB === "undefined") return ko(new Error("IndexedDB indisponible"))
    const r = indexedDB.open(BASE, VERSION)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(MAGASIN)) r.result.createObjectStore(MAGASIN) }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => ko(r.error)
    r.onblocked = () => ko(new Error("IndexedDB bloquée"))
  }).catch((e) => { ouverture = null; throw e })
  return ouverture
}

function transaction(mode, f) {
  return ouvrir().then((db) => new Promise((ok, ko) => {
    const t = db.transaction(MAGASIN, mode), m = t.objectStore(MAGASIN)
    const r = f(m)
    t.oncomplete = () => ok(r?.result)
    t.onerror = () => ko(t.error)
    t.onabort = () => ko(t.error)
  }))
}

const cleLS = (k) => `nexiaschool.idb.${k}`

/** Lit une valeur (null si absente). */
export async function lireLocal(cle) {
  try { const v = await transaction("readonly", (m) => m.get(cle)); return v === undefined ? null : v }
  catch { try { return JSON.parse(localStorage.getItem(cleLS(cle)) || "null") } catch { return null } }
}

/** Écrit une valeur (structurée : objets, tableaux, dates). */
export async function ecrireLocal(cle, valeur) {
  try { await transaction("readwrite", (m) => m.put(valeur, cle)) }
  catch { try { localStorage.setItem(cleLS(cle), JSON.stringify(valeur)) } catch { /* stockage plein ou indisponible */ } }
}

export async function effacerLocal(cle) {
  try { await transaction("readwrite", (m) => m.delete(cle)) } catch { /* indisponible */ }
  try { localStorage.removeItem(cleLS(cle)) } catch { /* indisponible */ }
}

/** Demande au navigateur de ne pas effacer ces données en cas de manque de place (si possible). */
export function demanderStockagePersistant() {
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* non pris en charge */ }
}
