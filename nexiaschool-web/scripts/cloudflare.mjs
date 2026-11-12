// Après « vite build » : ajoute au dossier dist/ les fichiers propres à Cloudflare Pages (_headers, _routes.json).
// Ils restent hors de public/ pour ne pas modifier le comportement de Netlify et de GitHub Pages.
import { copyFileSync, existsSync } from "node:fs"

for (const f of ["_headers", "_routes.json"]) copyFileSync(new URL(`../cloudflare/${f}`, import.meta.url), new URL(`../dist/${f}`, import.meta.url))
// Cloudflare Pages sert index.html pour toute adresse inconnue tant qu'il n'y a pas de 404.html (application monopage)
if (existsSync(new URL("../dist/404.html", import.meta.url))) throw new Error("dist/404.html présent : le mode application monopage de Cloudflare Pages serait désactivé.")
console.log("Cloudflare Pages : _headers et _routes.json ajoutés à dist/")
