// Référencement : source unique des pages publiques indexables (titres, descriptions, h1, fil d'Ariane, données structurées,
// robots.txt). Module sans dépendance (ni React, ni import.meta.env) : lu par l'application (src/lib/seo.js), par le
// pré-rendu (scripts/prerender.mjs), par le relais Cloudflare (functions/_middleware.js : liste des pages publiques) et par les tests.
// Les prix viennent de offres-reference.json (copie des offres du serveur), jamais écrits à la main ici.
import OFFRES from "./offres-reference.json" with { type: "json" }

export const SITE = "https://nexiaschool.com"
export const NOM = "NexIA School"
export const IMAGE = `${SITE}/og/nexia-school-1200x630.png`
export const LOGO = `${SITE}/logo-nexia-512.png`
export { OFFRES }

/** Questions fréquentes de l'accueil (affichées par Landing.jsx et reprises dans les données structurées FAQPage). */
export const FAQ_ACCUEIL = [
  ["Faut-il installer un logiciel ?", "Non. NexIA School fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Vous pouvez aussi l'ajouter à l'écran d'accueil du téléphone pour l'ouvrir comme une application."],
  ["Et si la connexion Internet est mauvaise ou coupée ?", "L'application est conçue pour les connexions lentes : les données déjà consultées s'affichent sans attendre. Hors ligne, notes, appel, élèves et infractions se saisissent normalement et sont envoyés automatiquement au retour du réseau."],
  ["Dois-je ressaisir toutes mes données ?", "Non. Importez vos listes Excel (élèves, classes, matières, personnel, coefficients, notes), séparément ou en un seul classeur. Les cases incomplètes sont signalées sans bloquer l'import."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Puis-je augmenter le nombre d'élèves en cours d'année ?", "Oui, à tout moment : vous ne payez que la différence et la date d'échéance est conservée. La capacité peut aussi être réduite au renouvellement. Toutes les données de l'établissement sont conservées."],
]

const fcfa = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`
const E = OFFRES.etablissement, S = OFFRES.smarteval

/**
 * Pages publiques indexables. chemin → { titre (≤ 60 car.), description (≤ 155), h1 (doit être celui affiché par la page),
 * ariane (libellé du fil d'Ariane), maj (AAAA-MM-JJ : date du dernier vrai changement de contenu) }.
 */
export const PAGES = {
  "/": {
    titre: "Logiciel de gestion scolaire au Cameroun | NexIA School",
    description: `Notes, bulletins A4 avec QR code, discipline, frais de scolarité et espace parents. Offre gratuite jusqu'à ${E.decouverte.max_eleves} élèves pour essayer en ligne.`,
    h1: "Logiciel de gestion scolaire : moins de gestion, plus de réussite",
    ariane: "Accueil", maj: "2026-11-27",
  },
  "/tarifs": {
    titre: `Tarifs logiciel de gestion scolaire : ${E.prix_eleve} FCFA par élève`,
    description: `Premium à ${fcfa(E.prix_eleve)} par élève et par an, minimum ${fcfa(E.minimum_annuel)}. Découverte gratuite pendant ${E.decouverte.duree_jours} jours, jusqu'à ${E.decouverte.max_eleves} élèves. Voyez les offres.`,
    h1: "Tarifs du logiciel de gestion scolaire",
    ariane: "Tarifs", maj: "2026-11-27",
  },
  "/tarifs/smarteval": {
    titre: "Évaluations en ligne pour enseignants | SmartEval",
    description: `Créez une évaluation, partagez un lien, obtenez la correction automatique. Essai gratuit de ${S.decouverte.duree_jours} jours, puis ${fcfa(S.prix_annuel)} par an.`,
    h1: "SmartEval : évaluations en ligne pour les enseignants",
    ariane: "SmartEval", parent: "/tarifs", maj: "2026-11-27",
  },
  "/commencer": {
    titre: "Créer un compte NexIA School : école, enseignant, délégation",
    description: "Choisissez votre profil : établissement scolaire, enseignant SmartEval ou délégation DDES / DRES. Créez votre compte en ligne gratuitement.",
    h1: "Créer mon compte NexIA School",
    ariane: "Commencer", maj: "2026-11-27",
  },
  "/inscription": {
    titre: "Inscrire mon école en ligne gratuitement | NexIA School",
    description: "Ouvrez l'espace de votre école avec un compte Google : sans installation, import Excel des élèves et des classes, données isolées.",
    h1: "Créer l'espace de mon établissement",
    ariane: "Inscription de l'établissement", maj: "2026-11-27",
  },
  "/smarteval/inscription": {
    titre: `Compte enseignant SmartEval : essai gratuit ${S.decouverte.duree_jours} jours`,
    description: `Créez votre compte enseignant SmartEval et publiez une première évaluation en ligne avec l'offre Découverte gratuite de ${S.decouverte.duree_jours} jours.`,
    h1: "Créer mon compte enseignant SmartEval",
    ariane: "Inscription enseignant", maj: "2026-11-27",
  },
  "/developpeurs": {
    titre: "API et assistant IA (MCP) scolaire | NexIA School",
    description: "Connectez Claude, ChatGPT ou votre agent IA à NexIA School via MCP : résultats, bulletins et finances, droits vérifiés côté serveur.",
    h1: "Pilotez votre établissement depuis votre assistant IA",
    ariane: "Développeurs", maj: "2026-11-27",
  },
  "/confidentialite": {
    titre: "Politique de confidentialité | NexIA School",
    description: "Comment NexIA School protège les données des établissements, des élèves, des parents et du personnel : usage, conservation et droits.",
    h1: "Politique de confidentialité",
    ariane: "Confidentialité", maj: "2026-11-25",
  },
  "/conditions": {
    titre: "Conditions d'utilisation | NexIA School",
    description: "Conditions d'utilisation de NexIA School, la plateforme en ligne de gestion scolaire et d'évaluation. À lire avant de créer un compte.",
    h1: "Conditions d'utilisation",
    ariane: "Conditions", maj: "2026-11-25",
  },
}

/** Adresse absolue canonique d'un chemin (« / » garde son slash, les autres n'en ont pas). */
export const urlCanonique = (chemin) => SITE + (chemin === "/" ? "/" : chemin)

/** Chemin normalisé (sans slash final, « / » pour la racine). */
export const normaliser = (chemin) => (String(chemin || "/").split(/[?#]/)[0].replace(/\/+$/, "") || "/")

export const estPagePublique = (chemin) => Object.prototype.hasOwnProperty.call(PAGES, normaliser(chemin))

const ORG = { "@id": `${SITE}/#organisation` }
const offre = (name, price, description, url) => ({ "@type": "Offer", name, price: String(price), priceCurrency: OFFRES.devise, description, url })

function filAriane(chemin) {
  if (chemin === "/") return null
  const p = PAGES[chemin]
  const el = [{ name: "Accueil", item: `${SITE}/` }]
  if (p.parent) el.push({ name: PAGES[p.parent].ariane, item: urlCanonique(p.parent) })
  el.push({ name: p.ariane, item: urlCanonique(chemin) })
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: el.map((e, i) => ({ "@type": "ListItem", position: i + 1, ...e })) }
}

/** Données structurées (JSON-LD) d'une page : uniquement ce qui est visible sur la page. */
export function donneesStructurees(chemin) {
  if (!PAGES[chemin]) return []
  const blocs = [filAriane(chemin)]
  if (chemin === "/") blocs.push(
    { "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organisation`, name: NOM, legalName: "NexIA",
      url: `${SITE}/`, logo: LOGO, email: "contact@nexiaschool.com", areaServed: "Afrique francophone",
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "contact@nexiaschool.com", availableLanguage: ["fr", "en"] },
      sameAs: ["https://www.linkedin.com/company/nexiaschool/"] },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE}/#site`, url: `${SITE}/`, name: NOM, inLanguage: "fr", publisher: ORG },
    { "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: FAQ_ACCUEIL.map(([q, r]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: r } })) })
  if (chemin === "/tarifs") blocs.push(
    { "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": `${SITE}/#logiciel`, name: NOM, url: `${SITE}/`,
      applicationCategory: ["EducationalApplication", "BusinessApplication"], operatingSystem: "Web", image: LOGO,
      description: "Logiciel de gestion scolaire en ligne : notes, bulletins, discipline, frais de scolarité et espace parents.", publisher: ORG,
      offers: [
        offre("Découverte", 0, `Gratuit pendant ${E.decouverte.duree_jours} jours, jusqu'à ${E.decouverte.max_eleves} élèves et ${E.decouverte.max_personnel} comptes du personnel.`, `${SITE}/tarifs`),
        offre("Premium", E.minimum_annuel, `${fcfa(E.prix_eleve)} par élève et par an, minimum ${fcfa(E.minimum_annuel)} par an.`, `${SITE}/tarifs`)] })
  if (chemin === "/tarifs/smarteval") blocs.push(
    { "@context": "https://schema.org", "@type": "Product", name: "SmartEval", image: LOGO, url: `${SITE}/tarifs/smarteval`,
      description: "Évaluations en ligne pour enseignants avec correction automatique et analyse par l'IA de l'enseignant.",
      brand: { "@type": "Brand", name: NOM },
      offers: [
        offre("Découverte", 0, `${S.decouverte.evaluations} évaluation publiée, ${S.decouverte.soumissions} réponses d'élèves, valable ${S.decouverte.duree_jours} jours.`, `${SITE}/tarifs/smarteval`),
        offre("Enseignant", S.prix_annuel, `Par an : ${S.credits} évaluations publiées, ${S.soumissions_max} réponses par évaluation.`, `${SITE}/tarifs/smarteval`),
        offre("Pack", S.pack.prix, `${S.pack.credits} évaluations.`, `${SITE}/tarifs/smarteval`),
        offre("Groupe", S.groupe.prix_annuel, `Par an : jusqu'à ${S.groupe.membres_max} enseignants d'une même matière, ${S.groupe.credits_membre} évaluations chacun.`, `${SITE}/tarifs/smarteval`)] })
  return blocs.filter(Boolean)
}

/**
 * robots.txt : espaces connectés et liens à jeton jamais explorés. « $ » ancre la règle (sinon « /notes » bloquerait aussi
 * « /notesXYZ ») ; les pages de connexion et /abonnement restent explorables pour que leur « noindex » soit lu.
 */
export const REGLES_ROBOTS = ["/verifier/", "/recu/", "/carte/", "/distinction/", "/e/", "/enseignant/", "/institution/", "/console$", "/console/", "/oauth/",
  "/parent$", "/bienvenue", "/notes$", "/notes/", "/finance$", "/finance/", "/eleves$", "/eleves/", "/parametres", "/personnel$", "/personnel/",
  "/discipline$", "/discipline/", "/courrier$", "/courrier/", "/courriers-institutionnels", "/excel$", "/excel/", "/statistiques", "/fiches-statistiques",
  "/developpeur$", "/developpeur/", "/emploi-du-temps$", "/emploi-du-temps/", "/automatisations", "/mes-bulletins-paie", "/mcp"]

export function robots() {
  return "# NexIA School : pages publiques explorables ; espaces connectés et liens à jeton exclus.\n"
    + "# /abonnement et les pages de connexion restent explorables pour que leur consigne noindex soit lue.\n"
    + `User-agent: *\nAllow: /\n${REGLES_ROBOTS.map((r) => `Disallow: ${r}`).join("\n")}\n\nSitemap: ${SITE}/sitemap.xml\n`
}

export function sitemap() {
  const lignes = Object.entries(PAGES).map(([c, p]) => `  <url><loc>${urlCanonique(c)}</loc><lastmod>${p.maj}</lastmod></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lignes.join("\n")}\n</urlset>\n`
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Balises <head> d'une page publique (indexer = false hors nexiaschool.com, copie GitHub Pages). */
export function tete(chemin, { indexer = true } = {}) {
  const p = PAGES[chemin], url = urlCanonique(chemin)
  return [
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
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="NexIA School, logiciel de gestion scolaire" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(p.titre)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<meta name="twitter:image" content="${IMAGE}" />`,
    ...donneesStructurees(chemin).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`),
  ].join("\n    ")
}
