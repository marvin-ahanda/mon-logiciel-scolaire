import { useCallback, useEffect, useState } from "react"
import { abandonner, enAttente, EVENEMENT_HORS_LIGNE, synchroniser } from "../lib/horsLigne.js"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

/**
 * Bandeau d'état de la connexion : hors ligne, saisies en attente d'envoi, synchronisation, saisies refusées par le serveur.
 * Les saisies gardées sur l'appareil sont envoyées automatiquement au retour de la connexion.
 */
export default function EtatConnexion() {
  const { profil } = useSession()
  const [enLigne, setEnLigne] = useState(() => navigator.onLine !== false)
  const [liste, setListe] = useState(() => enAttente(profil?.id))
  const [envoi, setEnvoi] = useState(false), [bilan, setBilan] = useState(null)
  const relire = useCallback(() => setListe(enAttente(profil?.id)), [profil?.id])

  const envoyerTout = useCallback(async () => {
    if (navigator.onLine === false || !enAttente(profil?.id, (x) => !x.erreur).length) return
    setEnvoi(true)
    try { const r = await synchroniser(); if (r.envoyees) setBilan(r.envoyees) } finally { setEnvoi(false); relire() }
  }, [profil?.id, relire])

  useEffect(() => {
    const enLigneMaintenant = () => { setEnLigne(true); envoyerTout() }
    const horsLigne = () => setEnLigne(false)
    window.addEventListener("online", enLigneMaintenant); window.addEventListener("offline", horsLigne)
    window.addEventListener(EVENEMENT_HORS_LIGNE, relire)
    envoyerTout()
    const minuterie = setInterval(envoyerTout, 30 * 1000)          // réseau revenu sans évènement « online » (connexion instable)
    return () => {
      window.removeEventListener("online", enLigneMaintenant); window.removeEventListener("offline", horsLigne)
      window.removeEventListener(EVENEMENT_HORS_LIGNE, relire); clearInterval(minuterie)
    }
  }, [envoyerTout, relire])
  useEffect(() => { if (!bilan) return; const m = setTimeout(() => setBilan(null), 8000); return () => clearTimeout(m) }, [bilan])

  const enCours = liste.filter((x) => !x.erreur), refusees = liste.filter((x) => x.erreur)
  if (enLigne && !enCours.length && !refusees.length && !bilan) return null
  return (
    <div className="etat-connexion no-print" role="status" aria-live="polite">
      {!enLigne && (
        <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          <strong>{t("Hors ligne.")}</strong>{" "}
          {t("Vous pouvez continuer à saisir les notes et l'appel : ils sont gardés sur cet appareil et seront envoyés automatiquement au retour de la connexion.")}
          {enCours.length > 0 && <> <span className="badge text-bg-dark ms-1">{t("{v0} en attente", { v0: enCours.length })}</span></>}
        </div>)}
      {enLigne && enCours.length > 0 && (
        <div className="alert alert-info rounded-0 border-0 border-bottom mb-0 py-2 px-3 small d-flex flex-wrap align-items-center gap-2">
          <span>{envoi ? t("Envoi des saisies faites hors ligne…") : t("{v0} saisie(s) faite(s) hors ligne en attente d'envoi.", { v0: enCours.length })}</span>
          {!envoi && <button type="button" className="btn btn-sm btn-outline-dark py-0" onClick={envoyerTout}>{t("Envoyer maintenant")}</button>}
        </div>)}
      {bilan && enLigne && !enCours.length && (
        <div className="alert alert-success rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          {t("Connexion rétablie : {v0} saisie(s) faite(s) hors ligne envoyée(s).", { v0: bilan })}
        </div>)}
      {refusees.length > 0 && (
        <div className="alert alert-danger rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          <strong>{t("Saisies refusées par le serveur :")}</strong>
          <ul className="mb-0">{refusees.map((x) => (
            <li key={x.id}>{x.description} — {x.erreur}{" "}
              <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => abandonner(x.id)}>{t("Ignorer")}</button></li>))}</ul>
        </div>)}
    </div>
  )
}
