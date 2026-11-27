// Référencement : pages publiques cohérentes, sitemap et robots corrects, pages pré-rendues complètes, données structurées valides.
import { describe, expect, it } from "vitest"
import { FAQ_ACCUEIL, PAGES, SITE, donneesStructurees, normaliser, urlCanonique } from "./seo-pages.js"
import { CHEMINS_PRIVES, contenu, enTete, pagePubliee, robots, sitemap } from "../../scripts/seo-plugin.mjs"
import { appliquerSeo, metaPour } from "./seo.js"
import { readFileSync } from "node:fs"

const gabarit = readFileSync(new URL("../../index.html", import.meta.url), "utf8")

describe("pages publiques", () => {
  it("titres uniques de 60 caractères au plus, descriptions de 155 caractères au plus", () => {
    const titres = Object.values(PAGES).map((p) => p.titre)
    expect(new Set(titres).size).toBe(titres.length)
    for (const [c, p] of Object.entries(PAGES)) {
      expect(p.titre.length, `titre ${c}`).toBeLessThanOrEqual(60)
      expect(p.description.length, `description ${c}`).toBeGreaterThanOrEqual(70)
      expect(p.description.length, `description ${c}`).toBeLessThanOrEqual(155)
      expect(p.h1.length).toBeGreaterThan(5)
    }
  })
  it("aucune page privée n'est listée comme publique", () => {
    for (const c of Object.keys(PAGES)) for (const prive of CHEMINS_PRIVES) expect(c.startsWith(prive.replace(/\/$/, "") + "/") || c === prive).toBe(false)
  })
  it("urls canoniques sans slash final, sauf l'accueil", () => {
    expect(urlCanonique("/")).toBe(`${SITE}/`)
    expect(urlCanonique("/tarifs")).toBe(`${SITE}/tarifs`)
    expect(normaliser("/tarifs/?a=1#b")).toBe("/tarifs")
  })
})

describe("sitemap et robots", () => {
  it("le sitemap liste exactement les pages publiques, avec lastmod", () => {
    const x = sitemap()
    for (const c of Object.keys(PAGES)) expect(x).toContain(`<loc>${urlCanonique(c)}</loc>`)
    expect((x.match(/<url>/g) || []).length).toBe(Object.keys(PAGES).length)
    expect((x.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length).toBe(Object.keys(PAGES).length)
  })
  it("robots.txt : sitemap déclaré, espaces internes interdits, pages publiques autorisées", () => {
    const r = robots()
    expect(r).toContain(`Sitemap: ${SITE}/sitemap.xml`)
    expect(r).toContain("Disallow: /finance")
    expect(r).toContain("Disallow: /verifier/")
    expect(r).not.toMatch(/Disallow: \/(tarifs|commencer|inscription|developpeurs|confidentialite|conditions)?$/m)
    // aucune règle (préfixe) ne bloque une page publique
    const regles = [...r.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1])
    for (const page of Object.keys(PAGES)) {
      const bloquee = regles.some((g) => (g.endsWith("$") ? page === g.slice(0, -1) : page.startsWith(g)))
      expect(bloquee, `page publique bloquée : ${page}`).toBe(false)
    }
    expect(r).not.toContain("Disallow: /connexion")
  })
})

describe("pages pré-rendues", () => {
  it("chaque page publique a son titre, sa description, son canonical, son h1 et du contenu dans le HTML initial", () => {
    for (const [c, p] of Object.entries(PAGES)) {
      const h = pagePubliee(gabarit, c)
      expect(h).toContain(`<title>${p.titre.replace(/&/g, "&amp;")}</title>`)
      expect(h).toContain(`<link rel="canonical" href="${urlCanonique(c)}" />`)
      expect(h).toContain("index, follow")
      expect(h).toMatch(/<h1>[^<]+<\/h1>/)
      expect(h).not.toContain("Chargement de NexIA School")
      expect(h.match(/<h1>/g).length).toBe(1)
      expect((h.match(/<title>/g) || []).length).toBe(1)
    }
  })
  it("la copie hors nexiaschool.com est en noindex", () => {
    expect(enTete("/", { indexer: false })).toContain("noindex, nofollow")
  })
  it("les données structurées sont du JSON valide, sans balise qui ferme le script", () => {
    for (const c of Object.keys(PAGES)) {
      const blocs = [...enTete(c).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1])
      expect(blocs.length).toBeGreaterThan(0)
      for (const b of blocs) { expect(() => JSON.parse(b)).not.toThrow(); expect(b).not.toContain("</") }
    }
  })
  it("l'accueil déclare Organization, WebSite, SoftwareApplication et la FAQ affichée (mêmes textes)", () => {
    const types = donneesStructurees("/").map((o) => o["@type"])
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage"])
    const faq = donneesStructurees("/").find((o) => o["@type"] === "FAQPage").mainEntity
    expect(faq.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(FAQ_ACCUEIL)
    expect(contenu("/")).toContain("Questions fréquentes")
  })
  it("aucune valeur commerciale écrite en dur (prix, effectifs)", () => {
    const tout = JSON.stringify(PAGES) + JSON.stringify(donneesStructurees("/"))
    expect(tout).not.toMatch(/\d[\d\s]*\s?(FCFA|XAF)/i)
    expect(tout).not.toMatch(/"price":"[1-9]/)
  })
})

describe("consignes d'indexation dans l'application", () => {
  // mini-document : seules les opérations utilisées par appliquerSeo (aucun environnement DOM installé dans le projet)
  const doc = () => {
    const elements = []
    const fabrique = (nom) => { const e = { nom, attrs: {}, setAttribute(k, v) { this.attrs[k] = v }, getAttribute(k) { return this.attrs[k] }, get content() { return this.attrs.content }, get href() { return this.attrs.href } }; return e }
    const lecture = (sel) => { const m = sel.match(/^(\w+)\[(\w+)="([^"]+)"\]$/); return elements.find((e) => e.nom === m[1] && e.attrs[m[2]] === m[3]) }
    return { title: "", createElement: fabrique, head: { querySelector: lecture, appendChild: (e) => elements.push(e) } }
  }
  it("page publique : indexable avec son titre et son canonical", () => {
    const d = doc(); appliquerSeo("/tarifs", d)
    expect(d.title).toBe(PAGES["/tarifs"].titre)
    expect(d.head.querySelector('meta[name="robots"]').content).toContain("index, follow")
    expect(d.head.querySelector('link[rel="canonical"]').href).toBe(`${SITE}/tarifs`)
  })
  it.each(["/finance/encaissements", "/verifier/ABC", "/e/jeton", "/connexion", "/console", "/inconnue"])("%s : noindex", (c) => {
    const d = doc(); appliquerSeo(c, d)
    expect(d.head.querySelector('meta[name="robots"]').content).toBe("noindex, nofollow")
  })
  it("copie hors nexiaschool.com : même une page publique reste en noindex", () => {
    expect(metaPour("/tarifs", { principal: false }).indexer).toBe(false)
  })
})
