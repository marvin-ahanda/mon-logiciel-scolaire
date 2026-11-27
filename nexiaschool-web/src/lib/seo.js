// Référencement côté navigateur : à chaque changement d'adresse, titre, description, canonical et consignes d'indexation
// sont ajustés. Page publique listée dans seo-pages.js : indexable avec ses propres balises ; toute autre adresse
// (espace connecté, liens à jeton, connexion…) : « noindex, nofollow ». Hors nexiaschool.com (copie GitHub Pages) : jamais indexé.
import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { IMAGE, NOM, PAGES, SITE, normaliser, urlCanonique } from "./seo-pages.js"

function balise(doc, selecteur, creer) {
  let e = doc.head.querySelector(selecteur)
  if (!e) { e = creer(doc); doc.head.appendChild(e) }
  return e
}
const meta = (doc, attribut, nom, contenu) => {
  const e = balise(doc, `meta[${attribut}="${nom}"]`, (d) => { const m = d.createElement("meta"); m.setAttribute(attribut, nom); return m })
  e.setAttribute("content", contenu)
}

/** Consignes de la page pour un chemin donné : { indexer, titre?, description?, url? }. */
export function metaPour(chemin, { principal = true } = {}) {
  const c = normaliser(chemin)
  const p = PAGES[c]
  if (!p || !principal) return { indexer: false, ...(p ? { titre: p.titre, description: p.description, url: urlCanonique(c) } : {}) }
  return { indexer: true, titre: p.titre, description: p.description, url: urlCanonique(c) }
}

export function appliquerSeo(chemin, doc = document, options = {}) {
  const m = metaPour(chemin, options)
  meta(doc, "name", "robots", m.indexer ? "index, follow, max-image-preview:large, max-snippet:-1" : "noindex, nofollow")
  if (m.titre) {
    doc.title = m.titre
    meta(doc, "name", "description", m.description)
    balise(doc, 'link[rel="canonical"]', (d) => { const l = d.createElement("link"); l.setAttribute("rel", "canonical"); return l }).setAttribute("href", m.url)
    meta(doc, "property", "og:title", m.titre)
    meta(doc, "property", "og:description", m.description)
    meta(doc, "property", "og:url", m.url)
    meta(doc, "property", "og:image", IMAGE)
    meta(doc, "property", "og:site_name", NOM)
    meta(doc, "name", "twitter:title", m.titre)
    meta(doc, "name", "twitter:description", m.description)
  }
  return m
}

/** À placer une fois dans le routeur. */
export function useSeo() {
  const { pathname } = useLocation()
  useEffect(() => { appliquerSeo(pathname, document, { principal: import.meta.env.BASE_URL === "/" }) }, [pathname])
}

export { SITE }
