// Référencement : source unique des pages publiques indexables (titres, descriptions, contenu de pré-rendu, FAQ).
// Module sans dépendance (ni React, ni import.meta.env) : lu à la fois par l'application (src/lib/seo.js), par le build
// (scripts/seo-plugin.mjs : pages pré-rendues, sitemap.xml, robots.txt) et par les tests.
// Aucune valeur commerciale (prix, effectifs) n'est écrite ici : elles viennent du serveur et changent.

export const SITE = "https://nexiaschool.com"
export const NOM = "NexIA School"
export const IMAGE = `${SITE}/logo-nexia-512.png`

/** Questions fréquentes de l'accueil (affichées par Landing.jsx et reprises dans les données structurées FAQPage). */
export const FAQ_ACCUEIL = [
  ["Faut-il installer un logiciel ?", "Non. NexIA School fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Vous pouvez aussi l'ajouter à l'écran d'accueil du téléphone pour l'ouvrir comme une application."],
  ["Et si la connexion Internet est mauvaise ou coupée ?", "L'application est conçue pour les connexions lentes : les données déjà consultées s'affichent sans attendre. Hors ligne, notes, appel, élèves et infractions se saisissent normalement et sont envoyés automatiquement au retour du réseau."],
  ["Dois-je ressaisir toutes mes données ?", "Non. Importez vos listes Excel (élèves, classes, matières, personnel, coefficients, notes), séparément ou en un seul classeur. Les cases incomplètes sont signalées sans bloquer l'import."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Puis-je augmenter le nombre d'élèves en cours d'année ?", "Oui, à tout moment : vous ne payez que la différence et la date d'échéance est conservée. La capacité peut aussi être réduite au renouvellement. Toutes les données de l'établissement sont conservées."],
]

const FONCTIONNALITES = [
  ["Notes, moyennes et classements", "Saisie des notes par séquence, moyennes, rangs, appréciations et statistiques par classe, avec import Excel."],
  ["Bulletins scolaires", "Bulletins sur une seule page A4 avec en-tête officiel, professeur principal et QR code de vérification, en PDF ou à l'impression."],
  ["Discipline et assiduité", "Appel du jour, absences, retards, infractions, sanctions et alertes selon des seuils que vous définissez."],
  ["Frais de scolarité et finances", "Frais et échéances, facturation, encaissements (espèces, MTN Mobile Money, Orange Money, virement), reçus PDF avec QR code, relances, dépenses, trésorerie et rapports."],
  ["Espace parents", "Les parents consultent les bulletins publiés, les absences, l'échéancier de frais et les courriers de l'école, et écrivent à l'administration."],
  ["Emploi du temps, PV et cartes scolaires", "Emploi du temps de l'établissement, procès-verbaux de performances, cartes scolaires avec QR code, parcours et orientation."],
  ["SmartEval pour les enseignants", "Évaluations digitalisées avec correction automatique, analyse par notion et profils d'élèves, y compris pour un enseignant sans établissement abonné."],
  ["Hors ligne et sécurité", "Saisie possible sans connexion, données isolées par établissement et connexion à votre assistant IA en lecture seule pour les finances."],
]

/**
 * Pages publiques indexables. chemin → { titre (≤ 60 car. conseillé), description (≤ 155), h1, intro, points: [[titre, texte]], liens: [[chemin, libellé]],
 * priorite, frequence, maj (AAAA-MM-JJ : date de la dernière modification réelle du contenu) }.
 * Les pages de connexion, d'accès, de vérification de documents et tout l'espace connecté sont volontairement absents :
 * elles sont « noindex » (voir src/lib/seo.js et cloudflare/_headers).
 */
export const PAGES = {
  "/": {
    titre: "Logiciel de gestion scolaire en ligne | NexIA School",
    description: "Notes, bulletins, discipline, frais de scolarité et espace parents : NexIA School simplifie la gestion de votre école. Essai gratuit, prêt en 2 minutes.",
    h1: "Moins de gestion. Plus de réussite scolaire.",
    intro: "NexIA School est un logiciel de gestion scolaire en ligne pour les établissements du Cameroun et d'Afrique francophone : notes et bulletins, discipline, frais de scolarité, espace parents, emploi du temps et évaluations numériques, depuis une seule plateforme, sans installation.",
    points: FONCTIONNALITES,
    faq: FAQ_ACCUEIL,
    liens: [["/tarifs", "Tarifs pour les établissements"], ["/tarifs/smarteval", "SmartEval pour les enseignants"], ["/commencer", "Commencer gratuitement"], ["/developpeurs", "API et assistant IA"]],
    priorite: "1.0", frequence: "weekly", maj: "2026-11-25",
  },
  "/tarifs": {
    titre: "Tarifs du logiciel de gestion scolaire | NexIA School",
    description: "Une seule offre complète, au tarif de votre effectif : toutes les fonctionnalités incluses, avec une offre Découverte gratuite pour essayer NexIA School.",
    h1: "Une seule offre complète, au tarif de votre effectif",
    intro: "Toutes les fonctionnalités de NexIA School sont incluses dans l'offre Premium, facturée par élève et par an en francs CFA. Une offre Découverte gratuite permet d'essayer la plateforme avant de s'abonner. Le montant exact pour votre effectif se calcule sur la page.",
    points: [["Découverte gratuite", "Pour essayer NexIA School avec un nombre limité d'élèves et de comptes du personnel."], ["Premium", "Toutes les fonctionnalités, présentes et futures, valables 12 mois."]],
    liens: [["/", "Présentation de NexIA School"], ["/tarifs/smarteval", "Tarifs SmartEval pour les enseignants"], ["/inscription", "Commencer gratuitement"]],
    priorite: "0.9", frequence: "monthly", maj: "2026-11-25",
  },
  "/tarifs/smarteval": {
    titre: "SmartEval : évaluations en ligne pour enseignants | NexIA",
    description: "Créez des évaluations numériques, partagez un lien, obtenez la correction automatique et l'analyse par votre IA. Offre gratuite pour essayer SmartEval.",
    h1: "SmartEval pour les enseignants",
    intro: "SmartEval permet à un enseignant, même sans établissement abonné, de créer des évaluations digitalisées, de partager un lien aux élèves, d'obtenir la correction automatique et d'analyser les résultats avec son propre assistant IA.",
    points: [["Découverte gratuite", "Une première évaluation à essayer, une seule fois par adresse e-mail."], ["SmartEval Enseignant", "Des évaluations publiées par an, avec connexion à votre IA et anonymisation des élèves."], ["SmartEval Groupe", "Pour un département d'enseignants d'une même matière."]],
    liens: [["/smarteval/inscription", "Créer mon compte enseignant"], ["/tarifs", "Tarifs pour les établissements"], ["/", "Présentation de NexIA School"]],
    priorite: "0.8", frequence: "monthly", maj: "2026-11-25",
  },
  "/commencer": {
    titre: "Créer l'espace de mon établissement | NexIA School",
    description: "Créez gratuitement l'espace numérique de votre établissement scolaire en deux minutes, ou inscrivez-vous comme enseignant pour utiliser SmartEval.",
    h1: "Commencer avec NexIA School",
    intro: "Choisissez votre profil : établissement scolaire (créer l'espace de l'école, importer vos listes Excel et inviter le personnel) ou enseignant indépendant (utiliser SmartEval sans établissement).",
    points: [], liens: [["/inscription", "Inscrire mon établissement"], ["/smarteval/inscription", "Je suis enseignant"], ["/tarifs", "Voir les tarifs"]],
    priorite: "0.8", frequence: "monthly", maj: "2026-11-25",
  },
  "/inscription": {
    titre: "Inscrire mon établissement gratuitement | NexIA School",
    description: "Ouvrez l'espace de votre école sur NexIA School avec votre compte Google : gratuit pour essayer, sans installation, données isolées par établissement.",
    h1: "Créer l'espace de mon établissement",
    intro: "L'inscription crée l'espace de votre établissement : vous y importez vos classes, élèves et matières depuis Excel, puis vous invitez le personnel avec des codes d'accès personnels.",
    points: [], liens: [["/tarifs", "Voir les tarifs"], ["/commencer", "Autres profils"], ["/", "Présentation de NexIA School"]],
    priorite: "0.7", frequence: "monthly", maj: "2026-11-25",
  },
  "/smarteval/inscription": {
    titre: "Créer mon compte enseignant SmartEval | NexIA School",
    description: "Enseignant ? Créez votre compte SmartEval pour digitaliser vos évaluations, corriger automatiquement et analyser les résultats de vos élèves.",
    h1: "Créer mon compte enseignant",
    intro: "Le compte enseignant SmartEval est indépendant de tout établissement : vous créez vos évaluations, partagez un lien aux élèves et analysez leurs réponses.",
    points: [], liens: [["/tarifs/smarteval", "Tarifs SmartEval"], ["/", "Présentation de NexIA School"]],
    priorite: "0.7", frequence: "monthly", maj: "2026-11-25",
  },
  "/developpeurs": {
    titre: "API et assistant IA (MCP) pour la gestion scolaire | NexIA",
    description: "Connectez votre assistant IA (Claude, ChatGPT…) à NexIA School via MCP : résultats, bulletins et finances en lecture seule, droits vérifiés côté serveur.",
    h1: "Développeurs et assistants IA",
    intro: "NexIA School expose un serveur MCP pour connecter votre assistant IA à vos données scolaires, avec des clés d'accès personnelles, des droits vérifiés côté serveur et un journal des appels.",
    points: [], liens: [["/", "Présentation de NexIA School"], ["/tarifs", "Tarifs"]],
    priorite: "0.6", frequence: "monthly", maj: "2026-11-25",
  },
  "/confidentialite": {
    titre: "Politique de confidentialité | NexIA School",
    description: "Comment NexIA School protège les données des établissements, des élèves, des parents et du personnel : collecte, usage, conservation et droits.",
    h1: "Politique de confidentialité",
    intro: "Cette page explique quelles données NexIA School traite, pourquoi, combien de temps elles sont conservées et comment exercer vos droits.",
    points: [], liens: [["/conditions", "Conditions d'utilisation"], ["/", "Accueil"]],
    priorite: "0.3", frequence: "yearly", maj: "2026-11-25",
  },
  "/conditions": {
    titre: "Conditions d'utilisation | NexIA School",
    description: "Conditions générales d'utilisation de la plateforme NexIA School : accès, abonnements, responsabilités et règles d'usage.",
    h1: "Conditions d'utilisation",
    intro: "Ces conditions encadrent l'utilisation de NexIA School par les établissements, les enseignants, les parents et le personnel.",
    points: [], liens: [["/confidentialite", "Politique de confidentialité"], ["/", "Accueil"]],
    priorite: "0.3", frequence: "yearly", maj: "2026-11-25",
  },
}

/** Adresse absolue canonique d'un chemin (« / » garde son slash, les autres n'en ont pas). */
export const urlCanonique = (chemin) => SITE + (chemin === "/" ? "/" : chemin)

/** Chemin normalisé (sans slash final, « / » pour la racine). */
export const normaliser = (chemin) => (String(chemin || "/").split(/[?#]/)[0].replace(/\/+$/, "") || "/")

/** Données structurées (JSON-LD) d'une page : uniquement ce qui est visible sur la page. */
export function donneesStructurees(chemin) {
  const p = PAGES[chemin]
  if (!p) return []
  const bloc = []
  if (chemin === "/") {
    bloc.push(
      { "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organisation`, name: NOM, legalName: "NexIA", url: `${SITE}/`, logo: IMAGE,
        email: "contact@nexiaschool.com", areaServed: "Afrique francophone", sameAs: ["https://www.linkedin.com/company/nexiaschool/"] },
      { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE}/#site`, url: `${SITE}/`, name: NOM, inLanguage: ["fr", "en"], publisher: { "@id": `${SITE}/#organisation` } },
      { "@context": "https://schema.org", "@type": "SoftwareApplication", name: NOM, url: `${SITE}/`, applicationCategory: "EducationalApplication",
        operatingSystem: "Web (navigateur, ordinateur, tablette et téléphone)", description: p.description, inLanguage: ["fr", "en"], image: IMAGE,
        offers: { "@type": "Offer", name: "Découverte gratuite", price: "0", priceCurrency: "XAF", url: `${SITE}/tarifs` },
        publisher: { "@id": `${SITE}/#organisation` } },
      { "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: p.faq.map(([q, r]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: r } })) },
    )
  } else {
    bloc.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: p.h1, item: urlCanonique(chemin) }] })
  }
  return bloc
}
