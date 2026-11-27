// Référencement : pages publiques cohérentes, langue, sitemap et robots, balises, données structurées, middleware, service worker.
// Le contenu pré-rendu lui-même (un seul h1, égal à celui de seo-pages.js) est vérifié à chaque build par scripts/prerender.mjs.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { FAQ_ACCUEIL, OFFRES, PAGES, REGLES_ROBOTS, SITE, donneesStructurees, estPagePublique, normaliser, robots, sitemap, tete, urlCanonique } from "./seo-pages.js"
import { appliquerSeo, metaPour } from "./seo.js"
import { langueDeLaPage } from "../i18n.jsx"
import { APPLICATION } from "../../functions/_middleware.js"

describe("pages publiques", () => {
  it("titres uniques de 60 caractères au plus, descriptions de 155 au plus", () => {
    const titres = Object.values(PAGES).map((p) => p.titre)
    expect(new Set(titres).size).toBe(titres.length)
    expect(new Set(Object.values(PAGES).map((p) => p.description)).size).toBe(titres.length)
    for (const [c, p] of Object.entries(PAGES)) {
      expect(p.titre.length, `titre ${c}`).toBeLessThanOrEqual(60)
      expect(p.description.length, `description ${c}`).toBeGreaterThanOrEqual(70)
      expect(p.description.length, `description ${c}`).toBeLessThanOrEqual(155)
      expect(p.h1.length).toBeGreaterThan(5)
      expect(p.maj).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it("urls canoniques sans slash final, sauf l'accueil", () => {
    expect(urlCanonique("/")).toBe(`${SITE}/`)
    expect(urlCanonique("/tarifs")).toBe(`${SITE}/tarifs`)
    expect(normaliser("/tarifs/?a=1#b")).toBe("/tarifs")
    expect(estPagePublique("/tarifs/")).toBe(true)
    expect(estPagePublique("/notes")).toBe(false)
  })
})

describe("langue", () => {
  it("page publique : toujours le français, quels que soient le navigateur et le choix mémorisé", () => {
    for (const c of Object.keys(PAGES)) expect(langueDeLaPage(c, true, "en")).toBe("fr")
  })
  it("espace connecté : choix mémorisé, sinon français ; /en/ réservé à l'anglais", () => {
    expect(langueDeLaPage("/notes/saisie", false, "en")).toBe("en")
    expect(langueDeLaPage("/notes/saisie", false, null)).toBe("fr")
    expect(langueDeLaPage("/notes/saisie", false, "de")).toBe("fr")
    expect(langueDeLaPage("/en/pricing", false, "fr")).toBe("en")
  })
  it("la langue du navigateur n'est plus jamais lue", () => {
    expect(readFileSync(new URL("../i18n.jsx", import.meta.url), "utf8")).not.toMatch(/navigator\.language/)
  })
})

describe("sitemap et robots", () => {
  it("le sitemap liste exactement les pages publiques, avec lastmod, sans changefreq ni priority", () => {
    const x = sitemap()
    for (const c of Object.keys(PAGES)) expect(x).toContain(`<loc>${urlCanonique(c)}</loc>`)
    expect((x.match(/<url>/g) || []).length).toBe(Object.keys(PAGES).length)
    expect((x.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length).toBe(Object.keys(PAGES).length)
    expect(x).not.toMatch(/changefreq|priority/)
  })
  it("robots.txt : aucune règle ne bloque une page publique ; /abonnement et les connexions restent explorables", () => {
    const r = robots()
    expect(r).toContain(`Sitemap: ${SITE}/sitemap.xml`)
    const bloque = (page) => REGLES_ROBOTS.some((g) => (g.endsWith("$") ? page === g.slice(0, -1) : page.startsWith(g)))
    for (const page of Object.keys(PAGES)) expect(bloque(page), `page publique bloquée : ${page}`).toBe(false)
    for (const c of ["/abonnement", "/connexion", "/etablissement", "/smarteval/connexion"]) expect(bloque(c), c).toBe(false)
    for (const c of ["/notes", "/notes/saisie", "/finance", "/console", "/verifier/X", "/e/jeton", "/developpeur", "/mcp"]) expect(bloque(c), c).toBe(true)
  })
})

describe("balises et données structurées", () => {
  it("chaque page : titre, description, robots, canonical, Open Graph 1200×630, Twitter grand format", () => {
    for (const [c, p] of Object.entries(PAGES)) {
      const h = tete(c)
      expect((h.match(/<title>/g) || []).length).toBe(1)
      expect(h).toContain(`<link rel="canonical" href="${urlCanonique(c)}" />`)
      expect(h).toContain("index, follow")
      expect(h).toContain('content="summary_large_image"')
      expect(h).toContain("/og/nexia-school-1200x630.png")
      expect(h).toContain(p.titre.replace(/&/g, "&amp;").replace(/"/g, "&quot;"))
    }
    expect(tete("/", { indexer: false })).toContain("noindex, nofollow")
  })
  it("JSON-LD valide, sans balise fermante, fil d'Ariane hors accueil", () => {
    for (const c of Object.keys(PAGES)) {
      const blocs = [...tete(c).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1])
      expect(blocs.length).toBeGreaterThan(0)
      for (const b of blocs) { expect(() => JSON.parse(b)).not.toThrow(); expect(b).not.toContain("</") }
      expect(donneesStructurees(c).some((o) => o["@type"] === "BreadcrumbList")).toBe(c !== "/")
    }
  })
  it("accueil : Organization, WebSite et la FAQ affichée (mêmes textes)", () => {
    expect(donneesStructurees("/").map((o) => o["@type"])).toEqual(["Organization", "WebSite", "FAQPage"])
    const faq = donneesStructurees("/").find((o) => o["@type"] === "FAQPage").mainEntity
    expect(faq.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(FAQ_ACCUEIL)
  })
  it("prix des balises et du JSON-LD = copie de référence des offres du serveur ; aucune note ni aucun avis", () => {
    const e = OFFRES.etablissement, s = OFFRES.smarteval
    const premium = donneesStructurees("/tarifs")[1].offers.find((o) => o.name === "Premium")
    expect(premium.price).toBe(String(e.minimum_annuel))
    expect(PAGES["/tarifs"].titre).toContain(`${e.prix_eleve} FCFA`)
    const se = Object.fromEntries(donneesStructurees("/tarifs/smarteval")[1].offers.map((o) => [o.name, Number(o.price)]))
    expect(se).toEqual({ "Découverte": 0, Enseignant: s.prix_annuel, Pack: s.pack.prix, Groupe: s.groupe.prix_annuel })
    const tout = JSON.stringify(Object.keys(PAGES).flatMap(donneesStructurees))
    expect(tout).not.toMatch(/aggregateRating|"review"/)
  })
})

describe("middleware et service worker", () => {
  it("toutes les routes de l'application sont connues du middleware (sinon elles répondraient 404)", () => {
    const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8")
    const routes = [...app.matchAll(/<Route path="(\/[^"*]*)/g)].map((m) => m[1].replace(/\/$/, "").split("/:")[0]).filter((r) => r && r !== "/")
    expect(routes.length).toBeGreaterThan(30)
    for (const r of routes) expect(estPagePublique(r) || APPLICATION.test(r), r).toBe(true)
    for (const r of ["/inconnue", "/tarifsx", "/wp-admin"]) expect(APPLICATION.test(r), r).toBe(false)
    expect(APPLICATION.test("/app-shell")).toBe(true)                      // coquille précachée par le service worker
  })
  it("le service worker connaît les mêmes pages publiques", () => {
    const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8")
    const liste = JSON.parse(sw.match(/const PUBLIQUES = new Set\((\[[^\]]*\])\)/)[1])
    expect(liste.map((c) => `/${c}`.replace(/^\/$/, "/")).sort()).toEqual(Object.keys(PAGES).map((c) => (c === "/" ? "/" : c)).sort())
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
