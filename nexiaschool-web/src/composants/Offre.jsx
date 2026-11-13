// Fonctions avancées hors de l'offre de l'établissement : montrées floutées ; un clic ouvre l'invitation à passer
// à une offre supérieure. La fenêtre est unique (MiseEnPage) et s'ouvre de n'importe où avec demanderOffre(fonction).
import { useEffect, useRef, useState } from "react"
import { EDITEUR } from "../lib/editeur.js"
import { LIBELLES_FONCTIONS, NOMS_OFFRES, OFFRE_REQUISE } from "../lib/offres.js"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

const EVENEMENT = "nexiaschool-offre"

export function demanderOffre(fonction) {
  window.dispatchEvent(new CustomEvent(EVENEMENT, { detail: fonction }))
}

/** Petit cadenas des rubriques réservées. */
export function Cadenas() {
  return <span className="cadenas-offre" aria-hidden="true">🔒</span>
}

/** Fenêtre « Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure ». */
export function FenetreOffre() {
  const { offre, estAdmin, etablissement } = useSession()
  const [fonction, setFonction] = useState(null)
  const bouton = useRef(null)
  useEffect(() => {
    const ouvrir = (e) => setFonction(e.detail || "ia")
    window.addEventListener(EVENEMENT, ouvrir)
    return () => window.removeEventListener(EVENEMENT, ouvrir)
  }, [])
  useEffect(() => {
    if (!fonction) return
    bouton.current?.focus()
    const echap = (e) => e.key === "Escape" && setFonction(null)
    document.addEventListener("keydown", echap)
    return () => document.removeEventListener("keydown", echap)
  }, [fonction])
  if (!fonction) return null
  const requise = OFFRE_REQUISE[fonction] || "premium"
  const sujet = t("Passer à l'offre {v0} — {v1}", { v0: t(NOMS_OFFRES[requise]), v1: etablissement?.nom || "" })
  const mail = `mailto:${EDITEUR.contact}?subject=${encodeURIComponent(sujet)}`
  return (
    <>
      <div className="modal d-block fenetre-offre" tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="titre-offre" aria-describedby="texte-offre"
           onClick={(e) => e.target === e.currentTarget && setFonction(null)}>
        <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="titre-offre"><Cadenas /> {t("Fonctionnalité non comprise dans votre offre")}</h2>
            <button type="button" className="btn-close" aria-label={t("Fermer")} onClick={() => setFonction(null)} />
          </div>
          <div className="modal-body">
            <p className="fw-semibold" id="texte-offre">{t("Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure.")}</p>
            <p className="mb-2"><strong>{t(LIBELLES_FONCTIONS[fonction] || "Fonction avancée")}</strong>{" "}
              {t("est disponible à partir de l'offre {v0}.", { v0: t(NOMS_OFFRES[requise]) })}</p>
            <p className="text-muted small mb-0">{t("Offre actuelle de votre établissement : {v0}.", { v0: t(NOMS_OFFRES[offre]) })}{" "}
              {estAdmin ? t("Écrivez-nous pour changer d'offre : le changement est immédiat, vos données sont conservées.")
                        : t("Parlez-en à l'administration de votre établissement.")}</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setFonction(null)}>{t("Fermer")}</button>
            {estAdmin && <a ref={bouton} className="btn btn-primary" href={mail}>{t("Demander l'offre {v0}", { v0: t(NOMS_OFFRES[requise]) })}</a>}
            {!estAdmin && <button ref={bouton} type="button" className="btn btn-primary" onClick={() => setFonction(null)}>{t("J'ai compris")}</button>}
          </div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

/** Contenu réservé : affiché flouté, inutilisable ; un clic ouvre l'invitation à changer d'offre. */
export function Verrou({ fonction, children, compact = false }) {
  const { aOffre, offre } = useSession()
  if (aOffre(fonction)) return children
  const requise = OFFRE_REQUISE[fonction] || "premium"
  return (
    <div className={"verrou-offre" + (compact ? " compact" : "")} data-fonction={fonction}>
      <div className="verrou-contenu" aria-hidden="true" inert>{children}</div>
      <button type="button" className="verrou-voile" onClick={() => demanderOffre(fonction)}
              aria-label={t("Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure.")}>
        <span className="verrou-carte">
          <Cadenas />
          <span className="fw-semibold">{t("Offre {v0}", { v0: t(NOMS_OFFRES[requise]) })}</span>
          {!compact && <span className="small text-muted d-block">{t("Votre offre actuelle : {v0}. Cliquez pour en savoir plus.", { v0: t(NOMS_OFFRES[offre]) })}</span>}
        </span>
      </button>
    </div>
  )
}
