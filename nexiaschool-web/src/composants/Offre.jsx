// Fonctions avancées hors de l'offre de l'établissement : montrées floutées ; un clic ouvre l'invitation à passer
// à une offre supérieure. La fenêtre est unique (MiseEnPage) et s'ouvre de n'importe où avec demanderOffre(fonction).
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { EDITEUR } from "../lib/editeur.js"
import { LIBELLES_FONCTIONS, NOMS_OFFRES, OFFRE_REQUISE, offreInclut } from "../lib/offres.js"
import { rpc } from "../supabase.js"
import { date as formatDate } from "../lib/format.js"
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
  const { offre, estAdmin } = useSession()
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
  if (offreInclut(offre, fonction)) return <FenetreDesactivee fonction={fonction} estAdmin={estAdmin} fermer={() => setFonction(null)} bouton={bouton} />
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
              {estAdmin ? t("Le changement d'offre est immédiat après paiement ; vos données sont conservées.")
                        : t("Parlez-en à l'administration de votre établissement.")}</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setFonction(null)}>{t("Fermer")}</button>
            {estAdmin && <Link ref={bouton} className="btn btn-primary" to="/abonnement" onClick={() => setFonction(null)}>{t("Passer à l'offre {v0}", { v0: t(NOMS_OFFRES[requise]) })}</Link>}
            {!estAdmin && <button ref={bouton} type="button" className="btn btn-primary" onClick={() => setFonction(null)}>{t("J'ai compris")}</button>}
          </div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

/** Fonction comprise dans l'offre mais retirée par la plateforme : pas d'invitation à changer d'offre. */
function FenetreDesactivee({ fonction, estAdmin, fermer, bouton }) {
  return (
    <>
      <div className="modal d-block fenetre-offre" tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="titre-offre" aria-describedby="texte-offre"
           onClick={(e) => e.target === e.currentTarget && fermer()}>
        <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="titre-offre"><Cadenas /> {t("Fonctionnalité momentanément désactivée")}</h2>
            <button type="button" className="btn-close" aria-label={t("Fermer")} onClick={fermer} />
          </div>
          <div className="modal-body">
            <p className="mb-2" id="texte-offre"><strong>{t(LIBELLES_FONCTIONS[fonction] || "Fonction avancée")}</strong>{" "}
              {t("est momentanément désactivée pour votre établissement.")}</p>
            <p className="text-muted small mb-0">{estAdmin ? t("Pour la réactiver, écrivez à {v0}.", { v0: EDITEUR.contact }) : t("Parlez-en à l'administration de votre établissement.")}</p>
          </div>
          <div className="modal-footer"><button ref={bouton} type="button" className="btn btn-primary" onClick={fermer}>{t("J'ai compris")}</button></div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

/** Administration : fonctionnalités offertes par la plateforme (annonce affichée une fois, jusqu'à lecture). */
export function FonctionsOffertes() {
  const { estAdmin, recharger } = useSession()
  const [notes, setNotes] = useState([])
  useEffect(() => {
    if (!estAdmin || navigator.onLine === false) return
    let actif = true
    rpc("notifications_offre_non_lues").then((l) => { if (actif && Array.isArray(l)) setNotes(l) }).catch(() => {})
    return () => { actif = false }
  }, [estAdmin])
  if (!notes.length) return null
  const fonctions = notes.flatMap((n) => n.fonctions)
  async function compris() {
    const ids = notes.map((n) => n.id); setNotes([])
    await Promise.all(ids.map((id) => rpc("notification_offre_lue", { p_id: id }).catch(() => {})))
    recharger()
  }
  return (
    <>
      <div className="modal d-block fenetre-offre fenetre-offertes" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titre-offertes">
        <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
          <div className="modal-header"><h2 className="modal-title h5" id="titre-offertes">🎁 {t("Nouvelles fonctionnalités pour votre établissement")}</h2></div>
          <div className="modal-body">
            <p>{t("NexIA vous offre l'accès aux fonctionnalités suivantes :")}</p>
            <ul className="mb-3">{fonctions.map((f, i) => (
              <li key={f.fonction + i} className="mb-1"><strong>{t(LIBELLES_FONCTIONS[f.fonction] || f.fonction)}</strong>
                <span className="text-muted"> — {f.fin ? t("jusqu'au {v0}", { v0: formatDate(f.fin) }) : t("sans limite de durée")}</span></li>))}</ul>
            <p className="small text-muted mb-0">{t("Profitez-en : à l'échéance, votre établissement retrouve simplement les fonctionnalités de son offre. Vos données sont conservées.")}</p>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn-primary" onClick={compris}>{t("Découvrir")}</button></div>
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
  const requise = OFFRE_REQUISE[fonction] || "premium", desactivee = offreInclut(offre, fonction)
  return (
    <div className={"verrou-offre" + (compact ? " compact" : "")} data-fonction={fonction}>
      <div className="verrou-contenu" aria-hidden="true" inert>{children}</div>
      <button type="button" className="verrou-voile" onClick={() => demanderOffre(fonction)}
              aria-label={t("Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure.")}>
        <span className="verrou-carte">
          <Cadenas />
          <span className="fw-semibold">{desactivee ? t("Momentanément désactivée") : t("Offre {v0}", { v0: t(NOMS_OFFRES[requise]) })}</span>
          {!compact && !desactivee && <span className="small text-muted d-block">{t("Votre offre actuelle : {v0}. Cliquez pour en savoir plus.", { v0: t(NOMS_OFFRES[offre]) })}</span>}
        </span>
      </button>
    </div>
  )
}
