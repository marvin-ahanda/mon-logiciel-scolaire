// Capacité d'élèves de l'abonnement : message du serveur quand la limite est atteinte, avec le bouton
// « Augmenter mon abonnement » (administrateur) ; le contrôle lui-même est fait en base, sur chaque inscription.
import { Link } from "react-router-dom"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

export { estErreurCapacite } from "../lib/offres.js"

export function ErreurCapacite({ message, onFermer }) {
  const { estAdmin } = useSession()
  return (
    <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 erreur-capacite" role="alert">
      <span className="me-auto">{message}</span>
      {estAdmin ? <Link className="btn btn-sm btn-primary" to="/abonnement">{t("Augmenter mon abonnement")}</Link>
                : <span className="small text-muted">{t("Parlez-en à l'administration de votre établissement.")}</span>}
      {onFermer && <button type="button" className="btn-close" aria-label={t("Fermer")} onClick={onFermer} />}
    </div>
  )
}
