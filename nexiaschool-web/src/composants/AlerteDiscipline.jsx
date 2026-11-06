import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * Bulle d'alerte de discipline (administration et surveillants), en bas à droite.
 * Le badge rouge compte les élèves qui viennent d'atteindre un seuil (heures d'absence non justifiées, blâmes,
 * avertissements…). Un clic marque les alertes comme lues et ouvre la synthèse disciplinaire de ces élèves.
 */
export default function AlerteDiscipline() {
  const naviguer = useNavigate()
  const { pathname } = useLocation()
  const [a, setA] = useState(null)
  const charger = useCallback(() => rpc("discipline_alertes").then(setA).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 2 * 60 * 1000)
    window.addEventListener("discipline:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("discipline:maj", charger) }
  }, [charger])
  useEffect(() => { if (pathname === "/discipline/alertes") charger() }, [pathname, charger])
  if (!a || !a.eleves.length || pathname === "/discipline/alertes") return null
  const nouveaux = a.eleves.filter((e) => e.nouvelle)
  const detail = (nouveaux.length ? nouveaux : a.eleves).slice(0, 8).map((e) => `${e.nom} ${e.prenom} (${e.classe})`).join("\n")
  function ouvrir() {
    naviguer("/discipline/alertes", { state: { nouvelles: nouveaux.map((e) => e.inscription_id) } })
  }
  return (
    <button type="button" className="bulle-alerte bulle-discipline no-print" onClick={ouvrir}
            title={t("Discipline : {v0} élève(s) au-delà des seuils d'alerte\n{v1}", { v0: a.eleves.length, v1: detail })}
            aria-label={t("{v0} nouvelle(s) alerte(s) de discipline, {v1} élève(s) au-delà des seuils : afficher la synthèse",
              { v0: a.non_lues, v1: a.eleves.length })}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M12 2 4 5v6c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V5l-8-3Zm-1 5h2v7h-2V7Zm0 9h2v2h-2v-2Z" />
      </svg>
      {a.non_lues > 0 && <span className="bulle-alerte-compte">{a.non_lues > 99 ? "99+" : a.non_lues}</span>}
    </button>
  )
}
