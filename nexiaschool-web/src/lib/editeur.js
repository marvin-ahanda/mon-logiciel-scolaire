// Informations légales de l'éditeur, utilisées par la page d'accueil et les pages légales.
export const EDITEUR = {
  nom: "NexIA",
  service: "NexIA School",
  // Adresse de la plateforme (bulletins, QR codes, pages légales) : à changer ici, ou par la variable
  // VITE_SITE_PLATEFORME, le jour où NexIA School aura son propre nom de domaine.
  site: (import.meta.env.VITE_SITE_PLATEFORME || "https://nexiaschool.netlify.app").replace(/\/$/, ""),
  contact: import.meta.env.VITE_CONTACT_EMAIL || "contact@nexiaacademy.net",
  pays: "Cameroun",
  miseAJour: "2026-11-06",
}

export const contactTexte = () => EDITEUR.contact || "l'adresse de contact indiquée par l'éditeur (en cours de publication)"
