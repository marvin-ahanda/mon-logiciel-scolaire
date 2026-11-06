import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Service worker (src/sw.js) : version et liste des fichiers de l'application insérées à la compilation,
// pour que toute l'application (y compris les modules chargés à la demande) soit disponible hors ligne.
function serviceWorker() {
  return {
    name: "nexiaschool-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const fichiers = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "index.html").sort()
      const publics = ["/", "/favicon-64.png", "/logo-nexia-192.png", "/logo-nexia-512.png", "/manifest.webmanifest"]
      const version = createHash("sha256").update(fichiers.join("|")).digest("hex").slice(0, 12)
      const source = readFileSync(new URL("./src/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version).replace("__FICHIERS__", JSON.stringify([...publics, ...fichiers.map((f) => "/" + f)]))
      this.emitFile({ type: "asset", fileName: "sw.js", source })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
})
