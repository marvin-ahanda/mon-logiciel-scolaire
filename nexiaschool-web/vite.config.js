import { createHash } from "node:crypto"
import { copyFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Service worker (src/sw.js) : version et liste des fichiers de l'application insérées à la compilation,
// pour que toute l'application (y compris les modules chargés à la demande) soit disponible hors ligne.
// BASE_PATH : « / » sur Netlify, « /mon-logiciel-scolaire/ » sur GitHub Pages.
const BASE = (process.env.BASE_PATH || "/").replace(/\/?$/, "/")

function serviceWorker() {
  return {
    name: "nexiaschool-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const fichiers = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "index.html").sort()
      const publics = ["", "favicon-64.png", "logo-nexia-192.png", "logo-nexia-512.png", "manifest.webmanifest"]
      const version = createHash("sha256").update(fichiers.join("|")).digest("hex").slice(0, 12)
      const source = readFileSync(new URL("./src/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version).replace("__FICHIERS__", JSON.stringify([...publics, ...fichiers].map((f) => BASE + f)))
        .replace("__BASE__", BASE)
      this.emitFile({ type: "asset", fileName: "sw.js", source })
    },
    // GitHub Pages ne sait pas renvoyer toutes les adresses vers l'application : sa page 404 est l'application elle-même
    writeBundle({ dir }) {
      if (BASE !== "/") copyFileSync(join(dir, "index.html"), join(dir, "404.html"))
    },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [react(), serviceWorker()],
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
})
