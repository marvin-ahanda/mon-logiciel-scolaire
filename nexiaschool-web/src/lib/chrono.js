// SmartEval — durée individuelle de composition : outils d'affichage purs (le serveur reste seul juge de l'heure).

/** Durées proposées à l'enseignant, en secondes : 15, 30, 45 min, 1 h, 1 h 15, 1 h 30, 2 h, 2 h 30, 3 h. */
export const DUREES_PROPOSEES = [900, 1800, 2700, 3600, 4500, 5400, 7200, 9000, 10800]
export const DUREE_MIN = 60                  // 1 minute
export const DUREE_MAX = 12 * 3600           // 12 heures (même borne que le serveur)
export const SEUIL_ATTENTION = 10 * 60 * 1000
export const SEUIL_URGENT = 5 * 60 * 1000
/** Avertissements discrets, en millisecondes restantes : 10 min, 5 min, 1 min. */
export const ALERTES = [10 * 60 * 1000, 5 * 60 * 1000, 60 * 1000]

/** Durée lisible : « 45 min », « 1 h », « 1 h 15 min ». */
export function dureeTexte(secondes) {
  const s = Math.max(0, Math.round(Number(secondes) || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`
}

/** Temps restant au format HH:MM:SS (arrondi à la seconde supérieure, jamais négatif). */
export function compteARebours(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000))
  const deux = (n) => String(n).padStart(2, "0")
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`
}

/** Niveau d'affichage du chronomètre : normal, attention (< 10 min), urgent (< 5 min), fini. */
export function niveauChrono(ms) {
  if (ms <= 0) return "fini"
  if (ms < SEUIL_URGENT) return "urgent"
  if (ms < SEUIL_ATTENTION) return "attention"
  return "normal"
}

/** Avertissement franchi entre deux lectures du chronomètre (le plus petit seuil franchi), sinon null. */
export function alerteFranchie(avantMs, apresMs) {
  const franchis = ALERTES.filter((a) => avantMs > a && apresMs <= a && apresMs > 0)
  return franchis.length ? Math.min(...franchis) : null
}

/** Durée saisie (heures, minutes) -> secondes ; null si hors bornes. */
export function secondesSaisies(heures, minutes) {
  const s = (Math.trunc(Number(heures) || 0) * 3600) + (Math.trunc(Number(minutes) || 0) * 60)
  return s >= DUREE_MIN && s <= DUREE_MAX ? s : null
}

/**
 * Décalage entre l'horloge du serveur et celle de l'appareil : serveur ≈ Date.now() + decalage.
 * Mesuré à chaque réponse du serveur (« maintenant ») : l'horloge de l'appareil n'est jamais crue telle quelle.
 */
export function decalageServeur(maintenantServeur, recuLe = Date.now()) {
  const t = Date.parse(maintenantServeur)
  return Number.isFinite(t) ? t - recuLe : 0
}

/** Temps restant (ms) d'après l'échéance fixée par le serveur et le décalage mesuré. */
export function tempsRestant(expireLe, decalage, maintenantAppareil = Date.now()) {
  const fin = Date.parse(expireLe)
  return Number.isFinite(fin) ? fin - (maintenantAppareil + decalage) : 0
}
