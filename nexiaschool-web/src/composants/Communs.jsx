import { Component, useEffect, useState } from "react"
import { t } from "../i18n.jsx"

export function Alerte({ type = "danger", children, onFermer }) {
  if (!children) return null
  return (
    <div className={`alert alert-${type} d-flex justify-content-between align-items-start no-print`} role={type === "danger" ? "alert" : "status"}>
      <div>{children}</div>
      {onFermer && <button type="button" className="btn-close ms-3" aria-label={t("Fermer")} onClick={onFermer} />}
    </div>
  );
}

export function Chargement({ texte = t("Chargement…") }) {
  return <div className="text-muted py-4 text-center" role="status"><span className="spinner-border spinner-border-sm me-2" />{texte}</div>
}

/** Fiche d'un code affiché une seule fois (imprimable). */
export function FicheCode({ titre, sousTitre, code, consignes, onTerminer }) {
  return (
    <div className="card border-warning fiche-code mb-3">
      <div className="card-body p-4">
        <p className="text-muted small mb-1">NexIA School</p>
        <h2 className="h5 mb-1">{titre}</h2>
        {sousTitre && <p className="mb-3 text-muted">{sousTitre}</p>}
        <p className="code-acces font-monospace" aria-label={`${t("Code")} : ${code.split("").join(" ")}`}>{code}</p>
        {consignes && <ol className="small">{consignes.map((c) => <li key={c}>{c}</li>)}</ol>}
        <div className="alert alert-warning small no-print">{t("Notez ou imprimez ce code maintenant : il ne sera plus jamais affiché.")}</div>
        <div className="d-flex gap-2 no-print">
          <button className="btn btn-primary" onClick={() => window.print()}>{t("Imprimer")}</button>
          {onTerminer && <button className="btn btn-outline-secondary" onClick={onTerminer}>{t("Terminé")}</button>}
        </div>
      </div>
    </div>
  );
}

/** Charge des données asynchrones : [donnees, erreur, recharger]. */
export function useDonnees(charger, deps) {
  const [etat, setEtat] = useState({ donnees: null, erreur: "" })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let actif = true
    setEtat((e) => ({ ...e, erreur: "" }))
    charger().then((donnees) => actif && setEtat({ donnees, erreur: "" }))
      .catch((e) => actif && setEtat({ donnees: null, erreur: e.message }))
    return () => { actif = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])
  return [etat.donnees, etat.erreur, () => setVersion((v) => v + 1)]
}

/**
 * Page impossible à charger (le plus souvent : hors ligne, page jamais ouverte sur cet appareil) : message clair,
 * nouvel essai automatique au retour de la connexion, au lieu d'un écran blanc.
 */
export class LimiteChargement extends Component {
  constructor(p) { super(p); this.state = { erreur: null }; this.reessayer = () => location.reload() }
  static getDerivedStateFromError(erreur) { return { erreur } }
  componentDidUpdate(_, avant) {
    if (this.state.erreur && !avant.erreur) window.addEventListener("online", this.reessayer, { once: true })
  }
  componentWillUnmount() { window.removeEventListener("online", this.reessayer) }
  render() {
    if (!this.state.erreur) return this.props.children
    const horsLigne = navigator.onLine === false || /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i.test(String(this.state.erreur?.message))
    return (
      <div className="container py-4" role="alert">
        <div className="alert alert-warning">
          <h2 className="h6">{horsLigne ? t("Page indisponible hors ligne") : t("Une erreur est survenue")}</h2>
          <p className="mb-2 small">{horsLigne
            ? t("Cette page n'a pas encore été ouverte sur cet appareil. Elle s'affichera dès le retour de la connexion ; les pages déjà consultées restent accessibles.")
            : String(this.state.erreur?.message || "")}</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={this.reessayer}>{t("Réessayer")}</button>
        </div>
      </div>
    )
  }
}
