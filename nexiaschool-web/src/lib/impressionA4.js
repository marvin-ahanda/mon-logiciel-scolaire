// Impression des bulletins : une page A4 par bulletin, au recto uniquement, quel que soit le nombre de matières.
// Avant l'impression, chaque bulletin est mesuré à la largeur utile d'une page A4 (190 mm) puis réduit au besoin
// (CSS zoom, qui réduit aussi la mise en page) pour tenir dans la hauteur utile (277 mm). Marges de page nulles :
// le navigateur n'ajoute ni adresse, ni date, ni numéro de page ; les marges sont portées par chaque bulletin.
import { useEffect } from "react"

const HAUTEUR_UTILE_MM = 276
const ZOOM_MIN = 0.45

function mmEnPx(mm) {
  const sonde = document.createElement("div")
  sonde.style.cssText = `position:absolute;visibility:hidden;height:${mm}mm;width:1px;top:0;left:0`
  document.body.appendChild(sonde)
  const px = sonde.getBoundingClientRect().height
  sonde.remove()
  return px
}

/** Calcule et applique la réduction de chaque bulletin (variable CSS --zoom-a4). */
export function ajusterBulletinsA4(racine = document) {
  const feuilles = [...racine.querySelectorAll(".bulletin .feuille-bulletin")]
  if (!feuilles.length) return
  document.body.classList.add("mesure-a4")
  const dispo = mmEnPx(HAUTEUR_UTILE_MM)
  for (const f of feuilles) {
    const tient = (z) => { f.style.setProperty("--zoom-a4", String(z)); return f.getBoundingClientRect().height <= dispo }
    if (tient(1)) continue
    // la largeur s'élargit quand on réduit (moins de retours à la ligne) : recherche par dichotomie de la plus grande
    // réduction qui tient dans la page, pour ne pas rapetisser le bulletin plus que nécessaire
    let haut = 1, bas = ZOOM_MIN
    if (!tient(bas)) continue                       // bulletin hors normes : taille minimale (déjà appliquée)
    for (let passe = 0; passe < 8; passe++) {
      const milieu = (haut + bas) / 2
      if (tient(milieu)) bas = milieu; else haut = milieu
    }
    f.style.setProperty("--zoom-a4", String(bas))
  }
  document.body.classList.remove("mesure-a4")
}

export function reinitialiserBulletinsA4(racine = document) {
  for (const f of racine.querySelectorAll(".bulletin .feuille-bulletin")) f.style.removeProperty("--zoom-a4")
}

/** Page affichant des bulletins : marges d'impression nulles, ajustement A4 avant chaque impression. */
export function useImpressionA4() {
  useEffect(() => {
    const style = document.createElement("style")
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }"
    document.head.appendChild(style)
    document.body.classList.add("impression-bulletins")
    const avant = () => ajusterBulletinsA4()
    const apres = () => reinitialiserBulletinsA4()
    window.addEventListener("beforeprint", avant)
    window.addEventListener("afterprint", apres)
    return () => {
      style.remove(); document.body.classList.remove("impression-bulletins")
      window.removeEventListener("beforeprint", avant); window.removeEventListener("afterprint", apres)
    }
  }, [])
}
