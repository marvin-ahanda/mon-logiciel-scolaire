import { useEffect, useState } from "react"

export function Alerte({ type = "danger", children, onFermer }) {
  if (!children) return null
  return (
    <div className={`alert alert-${type} d-flex justify-content-between align-items-start no-print`} role={type === "danger" ? "alert" : "status"}>
      <div>{children}</div>
      {onFermer && <button type="button" className="btn-close ms-3" aria-label="Fermer" onClick={onFermer} />}
    </div>
  )
}

export function Chargement({ texte = "Chargement…" }) {
  return <div className="text-muted py-4 text-center" role="status"><span className="spinner-border spinner-border-sm me-2" />{texte}</div>
}

/** Fiche d'un code affiché une seule fois (imprimable). */
export function FicheCode({ titre, sousTitre, code, consignes, onTerminer }) {
  return (
    <div className="card border-warning fiche-code mb-3">
      <div className="card-body p-4">
        <p className="text-muted small mb-1">NexIASchool</p>
        <h2 className="h5 mb-1">{titre}</h2>
        {sousTitre && <p className="mb-3 text-muted">{sousTitre}</p>}
        <p className="code-acces font-monospace" aria-label={`Code : ${code.split("").join(" ")}`}>{code}</p>
        {consignes && <ol className="small">{consignes.map((c) => <li key={c}>{c}</li>)}</ol>}
        <div className="alert alert-warning small no-print">Notez ou imprimez ce code maintenant : il ne sera plus jamais affiché.</div>
        <div className="d-flex gap-2 no-print">
          <button className="btn btn-primary" onClick={() => window.print()}>Imprimer</button>
          {onTerminer && <button className="btn btn-outline-secondary" onClick={onTerminer}>Terminé</button>}
        </div>
      </div>
    </div>
  )
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
