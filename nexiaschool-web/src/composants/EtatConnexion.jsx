import { useCallback, useEffect, useState } from "react"
import { abandonner, enAttente, EVENEMENT_HORS_LIGNE, resoudreConflit, synchroniser } from "../lib/horsLigne.js"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

/** Connexion lente : 2G, « économie de données », ou temps de réponse mesuré par le service worker. */
function connexionLente() {
  const c = typeof navigator !== "undefined" ? navigator.connection : null
  return !!c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "") || c.effectiveType === "slow-2g")
}

/**
 * État de la connexion et des saisies faites hors ligne, partagé par la pastille (barre de menu) et le bandeau.
 * etat : "en-ligne" | "lente" | "hors-ligne" | "synchro" | "attente" | "conflit" | "echec"
 */
export function useEtatConnexion() {
  const { profil } = useSession()
  const [enLigne, setEnLigne] = useState(() => navigator.onLine !== false)
  const [lente, setLente] = useState(connexionLente)
  const [liste, setListe] = useState(() => enAttente(profil?.id))
  const [synchro, setSynchro] = useState(false), [bilan, setBilan] = useState(null)
  const relire = useCallback(() => setListe(enAttente(profil?.id)), [profil?.id])

  const envoyerTout = useCallback(async () => {
    if (navigator.onLine === false || !enAttente(profil?.id, (x) => !x.erreur && !x.conflits).length) return
    try { const r = await synchroniser(); if (r.envoyees) setBilan(r.envoyees) } finally { relire() }
  }, [profil?.id, relire])

  useEffect(() => {
    const enLigneMaintenant = () => { setEnLigne(true); envoyerTout() }
    const horsLigne = () => setEnLigne(false)
    const surEtat = (e) => setSynchro(!!e.detail?.synchro)
    const surReseau = () => setLente(connexionLente())
    const surMessage = (e) => { if (e.data?.type === "reseau-lent") setLente(!!e.data.lent); if (e.data?.type === "synchroniser") envoyerTout() }
    window.addEventListener("online", enLigneMaintenant); window.addEventListener("offline", horsLigne)
    window.addEventListener(EVENEMENT_HORS_LIGNE, relire); window.addEventListener("horsligne:etat", surEtat)
    navigator.connection?.addEventListener?.("change", surReseau)
    navigator.serviceWorker?.addEventListener?.("message", surMessage)
    envoyerTout()
    const minuterie = setInterval(envoyerTout, 30 * 1000)          // réseau revenu sans évènement « online » (connexion instable)
    return () => {
      window.removeEventListener("online", enLigneMaintenant); window.removeEventListener("offline", horsLigne)
      window.removeEventListener(EVENEMENT_HORS_LIGNE, relire); window.removeEventListener("horsligne:etat", surEtat)
      navigator.connection?.removeEventListener?.("change", surReseau)
      navigator.serviceWorker?.removeEventListener?.("message", surMessage)
      clearInterval(minuterie)
    }
  }, [envoyerTout, relire])
  useEffect(() => { if (!bilan) return; const m = setTimeout(() => setBilan(null), 8000); return () => clearTimeout(m) }, [bilan])

  const enCours = liste.filter((x) => !x.erreur && !x.conflits), refusees = liste.filter((x) => x.erreur), conflits = liste.filter((x) => x.conflits)
  const etat = !enLigne ? "hors-ligne" : synchro ? "synchro" : conflits.length ? "conflit" : refusees.length ? "echec" : enCours.length ? "attente" : lente ? "lente" : "en-ligne"
  return { etat, enLigne, lente, synchro, enCours, refusees, conflits, bilan, envoyerTout }
}

const PASTILLES = {
  "en-ligne": ["En ligne", "ok"], lente: ["Connexion lente", "lente"], "hors-ligne": ["Hors ligne", "hors"], synchro: ["Synchronisation…", "synchro"],
  attente: ["{v0} en attente", "attente"], conflit: ["Conflit à résoudre", "echec"], echec: ["Échec d'envoi", "echec"],
}

/** Pastille d'état, toujours visible dans la barre de menu. */
export function PastilleConnexion({ etatConnexion }) {
  const { etat, enCours } = etatConnexion
  const [lib, classe] = PASTILLES[etat]
  return (
    <span className={`pastille-connexion ${classe}`} role="status" aria-live="polite" title={t(lib, { v0: enCours.length })}>
      <span className="point" aria-hidden="true" /><span className="texte">{t(lib, { v0: enCours.length })}</span>
    </span>
  )
}

const valeurLisible = (v) => (v === null || v === undefined || v === "" ? t("(vide)") : String(v))

/**
 * Bandeau d'état : hors ligne, connexion lente, saisies en attente d'envoi, synchronisation, conflits, saisies refusées.
 * Les saisies gardées sur l'appareil sont envoyées automatiquement au retour de la connexion.
 */
export default function EtatConnexion({ etatConnexion }) {
  const { enLigne, lente, synchro, enCours, refusees, conflits, bilan, envoyerTout } = etatConnexion
  if (enLigne && !lente && !enCours.length && !refusees.length && !conflits.length && !bilan) return null
  return (
    <div className="etat-connexion no-print" role="status" aria-live="polite">
      {!enLigne && (
        <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          <strong>{t("Hors ligne.")}</strong>{" "}
          {t("Les pages et données déjà consultées restent disponibles. Notes, appel, élèves et infractions saisis maintenant sont gardés sur cet appareil et seront envoyés automatiquement au retour de la connexion.")}
          {enCours.length > 0 && <> <span className="badge text-bg-dark ms-1">{t("{v0} en attente", { v0: enCours.length })}</span></>}
        </div>)}
      {enLigne && lente && !enCours.length && (
        <div className="alert alert-light rounded-0 border-0 border-bottom mb-0 py-1 px-3 small">
          {t("Connexion lente : les dernières données connues s'affichent d'abord, puis se mettent à jour dès que possible.")}
        </div>)}
      {enLigne && enCours.length > 0 && (
        <div className="alert alert-info rounded-0 border-0 border-bottom mb-0 py-2 px-3 small d-flex flex-wrap align-items-center gap-2">
          <span>{synchro ? t("Synchronisation des saisies faites hors ligne…") : t("{v0} saisie(s) faite(s) hors ligne en attente d'envoi.", { v0: enCours.length })}</span>
          {!synchro && <button type="button" className="btn btn-sm btn-outline-dark py-0" onClick={envoyerTout}>{t("Envoyer maintenant")}</button>}
        </div>)}
      {bilan && enLigne && !enCours.length && (
        <div className="alert alert-success rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          {t("Connexion rétablie : {v0} saisie(s) faite(s) hors ligne envoyée(s).", { v0: bilan })}
        </div>)}
      {conflits.length > 0 && (
        <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 py-2 px-3 small">
          <strong>{t("Conflits : ces données ont été modifiées par quelqu'un d'autre pendant que vous étiez hors ligne.")}</strong>
          {conflits.map((x) => (
            <div key={x.id} className="mt-2">
              <div className="fw-semibold">{x.description}</div>
              <ul className="mb-1">{x.conflits.map((c) => <li key={c.cle}>{c.libelle} : {t("votre valeur {v0}, sur le serveur {v1}", { v0: valeurLisible(c.mien), v1: valeurLisible(c.serveur) })}</li>)}</ul>
              <button type="button" className="btn btn-sm btn-primary py-0 me-2" disabled={!enLigne} onClick={() => resoudreConflit(x.id, true)}>{t("Garder ma version")}</button>
              <button type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => resoudreConflit(x.id, false)}>{t("Garder celle du serveur")}</button>
            </div>))}
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
