import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * Bulle « délégation » (administrateurs de l'établissement) : notifications non lues de la délégation départementale
 * (nouvelle campagne de fiches statistiques, calendrier modifié, relances, corrections demandées…). Un clic ouvre la liste.
 */
export default function AlerteInstitution() {
  const naviguer = useNavigate()
  const { pathname } = useLocation()
  const [n, setN] = useState(0)
  const charger = useCallback(() => rpc("inst_notifications_non_lues").then((x) => setN(Number(x) || 0)).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 5 * 60 * 1000)
    window.addEventListener("institution:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("institution:maj", charger) }
  }, [charger])
  useEffect(() => { charger() }, [pathname, charger])
  if (!n) return null
  return (
    <button type="button" className="bulle-alerte bulle-institution no-print" onClick={() => naviguer("/fiches-statistiques/notifications")}
            title={t("Délégation : {v0} nouvelle(s) notification(s)", { v0: n })}
            aria-label={t("Délégation : {v0} nouvelle(s) notification(s), les lire", { v0: n })}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2 2 7v2h20V7L12 2Zm-7 9v7h2v-7H5Zm4 0v7h2v-7H9Zm4 0v7h2v-7h-2Zm4 0v7h2v-7h-2ZM3 20v2h18v-2H3Z" /></svg>
      <span className="bulle-alerte-compte">{n > 99 ? "99+" : n}</span>
    </button>
  )
}
