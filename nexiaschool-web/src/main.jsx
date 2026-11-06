import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "bootstrap/dist/css/bootstrap.min.css"
import "./styles.css"
import App from "./App.jsx"
import { LangueProvider } from "./i18n.jsx"

createRoot(document.getElementById("racine")).render(<StrictMode><LangueProvider><App /></LangueProvider></StrictMode>)

// Hors ligne : l'application et les dernières données consultées restent disponibles sans connexion
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}))
}
