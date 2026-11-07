import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/**
 * Bulle d'alerte de saisie des notes (administration), en bas à droite.
 * Le badge rouge compte les séquences dont le délai de saisie est passé alors que des enseignants ne sont pas à jour.
 * Un clic marque ces alertes comme lues et ouvre la liste des enseignants en retard, classe par classe.
 * La bulle n'apparaît que s'il reste des alertes non lues par la personne connectée (lecture propre à chaque compte).
 */
export default function AlerteNotes() {
  const naviguer = useNavigate()
  const { pathname } = useLocation()
  const [a, setA] = useState(null)
  const charger = useCallback(() => rpc("notes_retards").then(setA).catch(() => {}), [])
  useEffect(() => {
    charger()
    const minuterie = setInterval(charger, 5 * 60 * 1000)
    window.addEventListener("notes:maj", charger)
    return () => { clearInterval(minuterie); window.removeEventListener("notes:maj", charger) }
  }, [charger])
  useEffect(() => { charger() }, [pathname, charger])
  if (!a || !a.non_lues || pathname === "/notes/retards") return null
  const enseignants = new Set(a.sequences.flatMap((s) => s.enseignants.map((e) => e.enseignant_id))).size
  const detail = a.sequences.map((s) => t("Séquence {v0} : {v1} enseignant(s) en retard", { v0: s.numero, v1: s.enseignants.length })).join("\n")
  return (
    <button type="button" className="bulle-alerte bulle-notes no-print" onClick={() => { setA({ ...a, non_lues: 0 }); naviguer("/notes/retards") }}
            title={t("Saisie des notes : {v0} enseignant(s) en retard\n{v1}", { v0: enseignants, v1: detail })}
            aria-label={t("{v0} nouvelle(s) alerte(s) de saisie des notes, {v1} enseignant(s) en retard : afficher la liste", { v0: a.non_lues, v1: enseignants })}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M14.06 3.94a1.5 1.5 0 0 1 2.12 0l1.88 1.88a1.5 1.5 0 0 1 0 2.12L9.5 16.5 5 18l1.5-4.5 7.56-9.56ZM4 20h16v2H4v-2Z" />
      </svg>
      {a.non_lues > 0 && <span className="bulle-alerte-compte">{a.non_lues > 99 ? "99+" : a.non_lues}</span>}
    </button>
  )
}
