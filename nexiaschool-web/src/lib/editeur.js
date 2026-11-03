// Informations légales de l'éditeur, utilisées par la page d'accueil et les pages légales.
export const EDITEUR = {
  nom: "NexIA",
  service: "NexIASchool",
  site: "https://nexiaschool.netlify.app",
  contact: import.meta.env.VITE_CONTACT_EMAIL || "contact@nexiaacademy.net",
  pays: "Cameroun",
  miseAJour: "3 novembre 2026",
}

export const contactTexte = () => EDITEUR.contact || "l'adresse de contact indiquée par l'éditeur (en cours de publication)"
