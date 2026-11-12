// Images optimisées : sur Cloudflare (domaine propre avec « Image Transformations » activé), les photos et logos passent par
// /cdn-cgi/image/ : redimensionnés à la taille affichée, compressés et convertis en WebP/AVIF selon le navigateur.
// Activé par la variable de compilation VITE_IMAGES_CLOUDFLARE=1 ; sinon l'adresse d'origine est utilisée telle quelle.
const ACTIF = import.meta.env.VITE_IMAGES_CLOUDFLARE === "1"
const BASE = import.meta.env.BASE_URL || "/"

/** Adresse optimisée d'une image distante pour une largeur d'affichage donnée (en pixels CSS ; doublée pour les écrans denses). */
export function imageOptimisee(url, largeur, qualite = 72) {
  if (!ACTIF || !url || !/^https:\/\//.test(url)) return url
  const l = Math.min(1600, Math.round(largeur * 2))
  return `${BASE}cdn-cgi/image/width=${l},quality=${qualite},format=auto,fit=scale-down,metadata=none/${url}`
}

/** Attributs communs des images non essentielles au premier affichage : chargement différé, décodage asynchrone. */
export const differee = { loading: "lazy", decoding: "async" }
