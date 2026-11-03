// Établissement choisi sur cet appareil (jeton remis après le nom + code de l'établissement, valable 30 jours).
const CLE = "nexiaschool.etablissement"

export function lireAppareil() {
  try { return JSON.parse(localStorage.getItem(CLE)) || null } catch { return null }
}
export function enregistrerAppareil(etablissement, jeton) {
  try { localStorage.setItem(CLE, JSON.stringify({ etablissement, jeton })) } catch { /* stockage indisponible */ }
}
export function oublierAppareil() {
  try { localStorage.removeItem(CLE) } catch { /* stockage indisponible */ }
}
