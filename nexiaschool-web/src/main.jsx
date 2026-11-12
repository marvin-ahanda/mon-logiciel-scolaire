import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "bootstrap/dist/css/bootstrap.min.css"
import "./styles.css"
import App from "./App.jsx"
import { LangueProvider, preparerLangue } from "./i18n.jsx"
import { demanderStockagePersistant } from "./lib/stockageLocal.js"

preparerLangue().then(() => createRoot(document.getElementById("racine")).render(<StrictMode><LangueProvider><App /></LangueProvider></StrictMode>))

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
