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
      // essentiels (gardés dès l'installation) : point d'entrée, ses imports statiques et leurs styles, polices latines woff2,
      // fichiers publics ; secondaires (préchargés ensuite si la connexion le permet) : pages chargées à la demande, PDF, Excel…
      const fichiers = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "index.html" && !/\.woff$/.test(f)).sort()
      const essentiels = new Set()
      const ajouter = (nom) => {
        const c = bundle[nom]
        if (!c || essentiels.has(nom)) return
        essentiels.add(nom)
        for (const css of c.viteMetadata?.importedCss || []) essentiels.add(css)
        for (const i of c.imports || []) ajouter(i)
      }
      for (const [nom, c] of Object.entries(bundle)) if (c.type === "chunk" && c.isEntry) ajouter(nom)
      for (const f of fichiers) if (/\.woff2$/.test(f)) essentiels.add(f)
      const publics = ["", "hors-ligne/", "hors-ligne/offline.js", "favicon-64.png", "logo-nexia-192.png", "logo-nexia-512.png", "manifest.webmanifest"]
      const secondaires = fichiers.filter((f) => !essentiels.has(f))
      const version = createHash("sha256").update(fichiers.join("|")).digest("hex").slice(0, 12)
      const source = readFileSync(new URL("./src/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__ESSENTIELS__", JSON.stringify([...publics, ...[...essentiels].sort()].map((f) => BASE + f)))
        .replace("__SECONDAIRES__", JSON.stringify(secondaires.map((f) => BASE + f)))
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
