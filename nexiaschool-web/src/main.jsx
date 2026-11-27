import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import "bootstrap/dist/css/bootstrap.min.css"
import "./styles.css"
import App from "./App.jsx"
import { LangueProvider, langueCourante, preparerLangue } from "./i18n.jsx"
import { normaliser } from "./lib/seo-pages.js"
import { demanderStockagePersistant } from "./lib/stockageLocal.js"
import { sessionLocale } from "./supabase.js"

// Page publique pré-rendue (data-chemin) : React reprend le HTML déjà affiché (hydratation) si l'adresse est la même et que le
// visiteur n'a pas de session (rendu identique à celui du build). Sinon (utilisateur connecté, autre adresse), rendu normal.
const racine = document.getElementById("racine")
const base = import.meta.env.BASE_URL.replace(/\/$/, "")
const chemin = normaliser(location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname)
const arbre = <StrictMode><LangueProvider><App /></LangueProvider></StrictMode>
preparerLangue().then(() => {
  if (racine.dataset.chemin === chemin && langueCourante() === "fr" && !sessionLocale() && !/[?&#](code|error|access_token)=/.test(location.search + location.hash)) {
    hydrateRoot(racine, arbre)
  } else {
    createRoot(racine).render(arbre)
  }
})

// Hors ligne : l'application et les dernières données consultées restent disponibles sans connexion
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      demanderStockagePersistant()
      // une fois l'application affichée, le reste (pages secondaires, PDF, Excel) est préchargé en arrière-plan
      const prechauffer = () => (reg.active || navigator.serviceWorker.controller)?.postMessage("prechauffer")
      if ("requestIdleCallback" in window) requestIdleCallback(prechauffer, { timeout: 8000 }); else setTimeout(prechauffer, 4000)
    } catch { /* service worker indisponible : l'application fonctionne en ligne */ }
  })
}
