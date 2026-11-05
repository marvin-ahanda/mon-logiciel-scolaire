// Informations légales de l'éditeur, utilisées par la page d'accueil et les pages légales.
export const EDITEUR = {
  nom: "NexIA",
  service: "NexIA School",
  site: "https://nexiaschool.netlify.app",
  contact: import.meta.env.VITE_CONTACT_EMAIL || "contact@nexiaacademy.net",
  pays: "Cameroun",
  miseAJour: "2026-11-05",
}

export const contactTexte = () => EDITEUR.contact || "l'adresse de contact indiquée par l'éditeur (en cours de publication)"
