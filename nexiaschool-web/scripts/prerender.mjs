// Pré-rendu après « vite build » et « vite build --ssr » : chaque page publique reçoit son HTML React complet
// (même rendu que dans le navigateur, en français), ses balises <head>, ses données structurées ; plus
// app-shell.html (coquille neutre, noindex, pour l'espace connecté et les adresses inconnues), sitemap.xml et robots.txt.
// Copie GitHub Pages (BASE_PATH ≠ « / ») : tout est « noindex », robots.txt interdit l'exploration, 404.html = coquille.
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { PAGES, robots, sitemap, tete } from "../src/lib/seo-pages.js"

const BASE = (process.env.BASE_PATH || "/").replace(/\/?$/, "/")
const principal = BASE === "/"
const dist = path.resolve("dist")
const { rendre } = await import(pathToFileURL(path.resolve("dist-ssr/entry-server.js")).href)
const modele = await fs.readFile(path.join(dist, "index.html"), "utf8")
for (const repere of ["<!--tete-->", "<!--corps-->"]) if (!modele.includes(repere)) throw new Error(`Repère absent de index.html : ${repere}`)

const remplir = (h, c) => modele.replace("<!--tete-->", () => h).replace("<!--corps-->", () => c)
const nbH1 = (html) => (html.match(/<h1[\s>]/g) || []).length
const texteH1 = (html) => (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, "").replace(/<!--.*?-->/g, "").replace(/\s+/g, " ").trim()
const decoder = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

const coquille = remplir(`<title>NexIA School</title>\n    <meta name="robots" content="noindex, nofollow" />`, "")
await fs.writeFile(path.join(dist, "app-shell.html"), coquille)

for (const chemin of Object.keys(PAGES)) {
  const corps = await rendre(BASE.replace(/\/$/, "") + chemin)
  if (nbH1(corps) !== 1) throw new Error(`${chemin} : ${nbH1(corps)} h1 au lieu d'un seul`)
  const h1 = decoder(texteH1(corps) || "")
  if (h1 !== PAGES[chemin].h1) throw new Error(`${chemin} : h1 affiché « ${h1} » ≠ « ${PAGES[chemin].h1} » (src/lib/seo-pages.js)`)
  const html = remplir(tete(chemin, { indexer: principal }), corps).replace('<div id="racine">', `<div id="racine" data-chemin="${chemin}">`)
  const fichier = path.join(dist, chemin === "/" ? "index.html" : `${chemin.slice(1)}.html`)   // « /tarifs » → tarifs.html (pas de barre finale)
  await fs.mkdir(path.dirname(fichier), { recursive: true })
  await fs.writeFile(fichier, html)
  console.log(`pré-rendu ${chemin} (${Math.round(html.length / 1024)} Ko)`)
}
await fs.writeFile(path.join(dist, "sitemap.xml"), sitemap())
await fs.writeFile(path.join(dist, "robots.txt"), principal ? robots() : "User-agent: *\nDisallow: /\n")
// GitHub Pages ne sait pas renvoyer toutes les adresses vers l'application : sa page 404 est la coquille de l'application
if (!principal) await fs.copyFile(path.join(dist, "app-shell.html"), path.join(dist, "404.html"))
await fs.rm(path.resolve("dist-ssr"), { recursive: true, force: true })
