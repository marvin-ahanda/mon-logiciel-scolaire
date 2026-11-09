import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * Bulle « courrier des parents » : nombre de courriers adressés à la personne connectée (selon l'objet et son rôle)
 * qu'elle n'a pas encore lus. Un clic les marque comme lus et ouvre la rubrique Courrier.
 */
export default function AlerteCourrier() {
  const naviguer = useNavigate()
  const { pathname } = useLocation()
  const [a, setA] = useState(null)
  const charger = useCallback(() => rpc("courrier_notifications").then(setA).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 2 * 60 * 1000)
    window.addEventListener("courrier:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("courrier:maj", charger) }
  }, [charger])
  useEffect(() => { charger() }, [pathname, charger])
  if (!a || !a.non_lus) return null
  return (
    <button type="button" className="bulle-alerte bulle-courrier no-print"
            onClick={async () => { setA({ non_lus: 0 }); await rpc("courrier_marquer_lu", { p_id: null }).catch(() => {}); window.dispatchEvent(new Event("courrier:maj")); naviguer("/courrier") }}
            title={t("Courrier des parents : {v0} nouveau(x) courrier(s)", { v0: a.non_lus })}
            aria-label={t("Courrier des parents : {v0} nouveau(x) courrier(s), les lire", { v0: a.non_lus })}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4.4 7H19.6L12 12.2ZM4 8.5V17h16V8.5l-8 5.4-8-5.4Z" /></svg>
      <span className="bulle-alerte-compte">{a.non_lus > 99 ? "99+" : a.non_lus}</span>
    </button>
  )
}
