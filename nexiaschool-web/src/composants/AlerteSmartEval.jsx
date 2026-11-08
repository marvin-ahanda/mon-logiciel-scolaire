import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * Bulle SmartEval (en bas à droite) : nombre de formulaires envoyés par les élèves depuis la dernière consultation.
 * Propre à l'enseignant auteur des évaluations ; une seule bulle, dont seul le chiffre change.
 * Un clic l'efface et ouvre les résultats (ou le journal si plusieurs évaluations ont reçu des réponses).
 */
export default function AlerteSmartEval() {
  const naviguer = useNavigate()
  const { pathname } = useLocation()
  const [a, setA] = useState(null)
  const charger = useCallback(() => rpc("smarteval_notifications").then(setA).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 60 * 1000)
    window.addEventListener("smarteval:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("smarteval:maj", charger) }
  }, [charger])
  useEffect(() => { charger() }, [pathname, charger])
  if (!a || !a.non_lues) return null
  const cible = a.evaluations.length === 1 ? `/smarteval/${a.evaluations[0]}` : "/smarteval/journal"
  return (
    <button type="button" className="bulle-alerte bulle-smarteval no-print"
            onClick={async () => {
              setA({ ...a, non_lues: 0 })
              await rpc("smarteval_marquer_vu").catch(() => {})
              if (pathname === cible) window.dispatchEvent(new Event("smarteval:recharger"))
              naviguer(cible)
            }}
            title={t("SmartEval : {v0} nouveau(x) formulaire(s) envoyé(s) par vos élèves", { v0: a.non_lues })}
            aria-label={t("SmartEval : {v0} nouveau(x) formulaire(s) envoyé(s) par vos élèves, afficher les résultats", { v0: a.non_lues })}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M9 2h6a2 2 0 0 1 2 2h1.5A1.5 1.5 0 0 1 20 5.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-15A1.5 1.5 0 0 1 5.5 4H7a2 2 0 0 1 2-2Zm0 2v1h6V4H9Zm1.3 12.7 6.4-6.4-1.4-1.4-5 5-2-2-1.4 1.4 3.4 3.4Z" />
      </svg>
      <span className="bulle-alerte-compte">{a.non_lues > 99 ? "99+" : a.non_lues}</span>
    </button>
  )
}
