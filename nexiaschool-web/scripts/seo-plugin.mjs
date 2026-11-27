// Référencement au build : à partir de dist/index.html, produit
//  * une page HTML par page publique (dist/tarifs.html, dist/tarifs/smarteval.html…) avec son propre titre, sa description,
//    sa balise canonical, ses balises de partage (Open Graph, Twitter), ses données structurées et un contenu texte visible
//    dès le premier chargement (les moteurs n'ont plus à exécuter le JavaScript pour comprendre la page) ;
//  * sitemap.xml (pages publiques seulement) et robots.txt ;
//  * « noindex » sur toutes les pages si le site est publié ailleurs que sur nexiaschool.com (copie GitHub Pages).
// L'application React remplace ce contenu au démarrage. Les pages privées gardent le HTML générique et sont « noindex ».
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { IMAGE, NOM, PAGES, SITE, donneesStructurees, urlCanonique } from "../src/lib/seo-pages.js"

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
/** Dans un bloc <script type="application/ld+json">, « < » est échappé pour empêcher toute fermeture prématurée. */
const jsonSur = (o) => JSON.stringify(o).replace(/</g, "\\u003c")

/** Bloc <head> propre à une page (entre les marqueurs seo:debut / seo:fin de index.html). */
export function enTete(chemin, { indexer = true } = {}) {
  const p = PAGES[chemin]
  const url = urlCanonique(chemin)
  const lignes = [
    `<title>${esc(p.titre)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta name="robots" content="${indexer ? "index, follow, max-image-preview:large, max-snippet:-1" : "noindex, nofollow"}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${NOM}" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:title" content="${esc(p.titre)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${IMAGE}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(p.titre)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<meta name="twitter:image" content="${IMAGE}" />`,
    ...donneesStructurees(chemin).map((o) => `<script type="application/ld+json">${jsonSur(o)}</script>`),
  ]
  return lignes.join("\n    ")
}

/** Contenu texte pré-rendu de la page (remplacé par l'application au démarrage). */
export function contenu(chemin) {
  const p = PAGES[chemin]
  const points = p.points.length ? `<h2>${chemin === "/" ? "Ce que NexIA School permet de faire" : "À retenir"}</h2><ul>${p.points.map(([t, x]) => `<li><strong>${esc(t)}</strong> — ${esc(x)}</li>`).join("")}</ul>` : ""
  const faq = p.faq ? `<h2>Questions fréquentes</h2>${p.faq.map(([q, r]) => `<h3>${esc(q)}</h3><p>${esc(r)}</p>`).join("")}` : ""
  const liens = `<nav aria-label="Pages principales"><ul>${p.liens.map(([c, l]) => `<li><a href="${c}">${esc(l)}</a></li>`).join("")}</ul></nav>`
  return `<main class="seo-statique" data-chemin="${chemin}" style="max-width:860px;margin:0 auto;padding:24px 16px;font:16px/1.6 system-ui,sans-serif;color:#212529">`
    + `<p><a href="/">${NOM}</a></p><h1>${esc(p.h1)}</h1><p>${esc(p.intro)}</p>${points}${faq}${liens}</main>`
}

/** HTML complet d'une page publique à partir du index.html compilé. */
export function pagePubliee(html, chemin, options = {}) {
  const remplace = (src, debut, fin, valeur) => {
    const i = src.indexOf(debut), j = src.indexOf(fin)
    if (i < 0 || j < 0 || j < i) throw new Error(`Marqueurs ${debut} / ${fin} absents de index.html`)
    return src.slice(0, i) + valeur + src.slice(j + fin.length)
  }
  let sortie = remplace(html, "<!--seo:debut-->", "<!--seo:fin-->", enTete(chemin, options))
  sortie = remplace(sortie, "<!--racine:debut-->", "<!--racine:fin-->", contenu(chemin))
  return sortie
}

export function sitemap() {
  const urls = Object.entries(PAGES).map(([c, p]) => `  <url>\n    <loc>${urlCanonique(c)}</loc>\n    <lastmod>${p.maj}</lastmod>\n    <changefreq>${p.frequence}</changefreq>\n    <priority>${p.priorite}</priority>\n  </url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
}

/** Espaces internes et liens à jeton : jamais explorés (les pages de connexion sont « noindex » par en-tête HTTP et dans l'application). */
export const CHEMINS_PRIVES = ["/verifier/", "/recu/", "/carte/", "/distinction/", "/e/", "/enseignant/", "/console/", "/oauth/", "/notes/", "/finance", "/eleves", "/parametres",
  "/personnel", "/discipline/", "/courrier", "/excel", "/statistiques", "/abonnement", "/developpeur", "/emploi-du-temps", "/automatisations", "/mes-bulletins-paie", "/mcp",
  "/fiches-statistiques", "/courriers-institutionnels"]
// Les pages de connexion (/connexion, /etablissement, /acces, /parent…) ne sont PAS bloquées ici : liées depuis le site, elles doivent rester
// explorables pour que leur consigne « noindex » (balise et en-tête HTTP) soit lue.

// Les règles robots.txt s'appliquent par préfixe : un chemin privé qui est le début d'une page publique (/developpeur → /developpeurs)
// est ancré par « $ » (compris par Google et Bing) pour ne pas bloquer la page publique.
const disallow = (c) => (Object.keys(PAGES).some((p) => p !== c && p.startsWith(c)) ? `${c}$` : c)

export function robots() {
  return `# NexIA School : les pages publiques sont à explorer ; les espaces connectés, les liens à jeton et les vérifications de documents ne le sont pas.\n`
    + `User-agent: *\nAllow: /\n${CHEMINS_PRIVES.map((c) => `Disallow: ${disallow(c)}`).join("\n")}\n\nSitemap: ${SITE}/sitemap.xml\n`
}

export function seo(base) {
  return {
    name: "nexiaschool-seo",
    apply: "build",
    writeBundle({ dir }) {
      const html = readFileSync(join(dir, "index.html"), "utf8")
      const principal = base === "/"                                           // nexiaschool.com (Cloudflare) ; la copie GitHub Pages n'est pas indexée
      for (const chemin of Object.keys(PAGES)) {
        const page = pagePubliee(html, chemin, { indexer: principal })
        const fichier = chemin === "/" ? "index.html" : `${chemin.slice(1)}.html`   // « /tarifs » est servi par tarifs.html (adresses sans extension)
        const cible = join(dir, fichier)
        mkdirSync(dirname(cible), { recursive: true })
        writeFileSync(cible, page)
      }
      writeFileSync(join(dir, "sitemap.xml"), sitemap())
      writeFileSync(join(dir, "robots.txt"), principal ? robots() : "User-agent: *\nDisallow: /\n")
    },
  }
}
