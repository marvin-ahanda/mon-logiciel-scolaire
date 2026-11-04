import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"

/**
 * Bulle d'alerte des retards de paiement (administration et comptabilité), en bas à droite.
 * Le badge rouge compte les alertes non lues : une par échéance dont le délai est dépassé et qui laisse des élèves
 * non en règle. Un clic marque les alertes comme lues et ouvre la liste des élèves non en règle.
 */
export default function AlerteFinance() {
  const naviguer = useNavigate()
  const [a, setA] = useState(null)
  const charger = useCallback(() => rpc("finance_alertes").then(setA).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 5 * 60 * 1000)
    window.addEventListener("finance:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("finance:maj", charger) }
  }, [charger])
  if (!a || (!a.insolvables && !a.non_lues)) return null
  const detail = a.alertes.map((x) => `${x.libelle} (délai du ${new Date(`${x.date_limite}T00:00:00`).toLocaleDateString("fr-FR")}) : ${x.eleves} élève(s)`).join("\n")
  async function ouvrir() {
    await rpc("finance_marquer_alertes_lues").catch(() => {})
    setA({ ...a, non_lues: 0 })
    naviguer("/finance/insolvables")
  }
  return (
    <button type="button" className="bulle-alerte no-print" onClick={ouvrir}
            title={`${a.insolvables} élève(s) non en règle avec les frais de scolarité\n${detail}`}
            aria-label={`${a.non_lues} nouvelle(s) alerte(s) de paiement, ${a.insolvables} élève(s) non en règle : afficher la liste`}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.71V3.5a2 2 0 0 0-4 0v.79A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
      </svg>
      {a.non_lues > 0 && <span className="bulle-alerte-compte">{a.non_lues > 99 ? "99+" : a.non_lues}</span>}
    </button>
  )
}
