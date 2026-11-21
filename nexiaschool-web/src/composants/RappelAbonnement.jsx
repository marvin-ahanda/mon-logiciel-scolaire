// Bandeau de rappel pour l'administrateur : de J-5 au dernier jour de l'abonnement (dates du Cameroun), message bref
// avec décompte des jours. Masquable pour la journée ; il revient le lendemain avec le nouveau décompte.
import { useState } from "react"
import { Link } from "react-router-dom"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

const jourCameroun = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
/** Jours calendaires restants avant l'échéance (0 = dernier jour), à l'heure du Cameroun. */
export function joursRestants(echeance, maintenant = new Date()) {
  return Math.round((Date.parse(jourCameroun(new Date(echeance))) - Date.parse(jourCameroun(maintenant))) / 864e5)
}
export function texteRappel(jours) {
  if (jours <= 0) return t("Votre abonnement se termine aujourd'hui. Pensez à le renouveler.")
  if (jours === 1) return t("Fin d'abonnement demain. Pensez à le renouveler.")
  return t("Fin d'abonnement dans {v0} jours. Pensez à le renouveler.", { v0: jours })
}

export default function RappelAbonnement() {
  const { estAdmin, etablissement } = useSession()
  const cle = `nexiaschool.rappel.${etablissement?.id}.${jourCameroun(new Date())}`
  const [masque, setMasque] = useState(() => { try { return sessionStorage.getItem(cle) === "1" } catch { return false } })
  const echeance = etablissement?.offre_expire_le
  if (!estAdmin || !echeance || !etablissement?.offre || !["essentiel", "pro", "premium"].includes(etablissement.offre) || masque) return null
  if (new Date(echeance) <= new Date()) return null
  const jours = joursRestants(echeance)
  if (jours < 0 || jours > 5) return null
  return (
    <div className={`alert ${jours <= 1 ? "alert-danger" : "alert-warning"} d-flex flex-wrap align-items-center gap-2 py-2 mb-3 no-print rappel-abonnement`} role="status">
      <strong className="me-auto">{texteRappel(jours)}</strong>
      <Link className="btn btn-sm btn-dark" to="/abonnement">{t("Renouveler")}</Link>
      <button type="button" className="btn-close" aria-label={t("Masquer pour aujourd'hui")}
              onClick={() => { try { sessionStorage.setItem(cle, "1") } catch { /* stockage indisponible */ } setMasque(true) }} />
    </div>
  )
}
