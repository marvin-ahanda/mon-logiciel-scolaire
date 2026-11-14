// Informations légales de l'éditeur, utilisées par la page d'accueil et les pages légales.
export const EDITEUR = {
  nom: "NexIA",
  service: "NexIA School",
  // Adresse de la plateforme (bulletins, QR codes, pages légales) : à changer ici, ou par la variable
  // VITE_SITE_PLATEFORME, le jour où NexIA School aura son propre nom de domaine.
  site: (import.meta.env.VITE_SITE_PLATEFORME || "https://nexiaschool.pages.dev").replace(/\/$/, ""),
  contact: import.meta.env.VITE_CONTACT_EMAIL || "contact@nexiaacademy.net",
  // réseaux du développeur (page d'accueil : « Me contacter » et pied de page)
  whatsapp: "https://wa.me/237653724075",
  linkedin: "https://www.linkedin.com/in/marvin-brice-ahanda?utm_source=share_via&utm_content=profile&utm_medium=member_android",
  pays: "Cameroun",
  miseAJour: "2026-11-06",
}

export const contactTexte = () => EDITEUR.contact || "l'adresse de contact indiquée par l'éditeur (en cours de publication)"
