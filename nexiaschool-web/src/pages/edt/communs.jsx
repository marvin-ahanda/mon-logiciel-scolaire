// Éléments communs du module Emploi du temps.
import { useState } from "react"
import { t } from "../../i18n.jsx"
import { JOURS } from "../../lib/edt/modele.js"

/** Traduit un message du moteur ({ k, v }) ou un texte. */
export const tr = (m) => (!m ? "" : typeof m === "string" ? t(m) : t(m.k, m.v))

/** Cases à cocher des jours (parmi les jours proposés). */
export function ChoixJours({ jours = JOURS.map(([j]) => j), valeur, onChange, id, desactive }) {
  const v = new Set(valeur || [])
  return (
    <div className="edt-jours" role="group" id={id}>
      {jours.map((j) => (
        <label key={j} className={`edt-jour${v.has(j) ? " actif" : ""}`}>
          <input type="checkbox" className="visually-hidden" checked={v.has(j)} disabled={desactive}
                 onChange={(e) => { const n = new Set(v); e.target.checked ? n.add(j) : n.delete(j); onChange([...n].sort()) }} />
          {t(JOURS.find(([x]) => x === j)[1]).slice(0, 3)}
        </label>))}
    </div>
  )
}

/** Champ numérique facultatif (vide = valeur générale, rappelée en indication). */
export function Nombre({ valeur, onChange, min = 1, max = 16, placeholder, id, label, className = "" }) {
  return (
    <input type="number" inputMode="numeric" className={`form-control form-control-sm ${className}`} id={id} aria-label={label} min={min} max={max}
           placeholder={placeholder === undefined || placeholder === null ? "" : String(placeholder)} value={valeur ?? ""}
           onChange={(e) => onChange(e.target.value === "" ? null : Math.max(min, Math.min(max, Number(e.target.value))))} />
  )
}

/**
 * Question posée à l'utilisateur quand une contrainte bloque : champ de réponse, puis application explicite.
 * Aucune contrainte obligatoire n'est assouplie sans cette réponse.
 */
export function Question({ q, joursOuvres, onRepondre, onEtape }) {
  const [v, setV] = useState(q.valeur)
  return (
    <div className="edt-question">
      <label className="form-label small fw-semibold mb-1" htmlFor={`q-${q.id}`}>{tr(q.libelle)}</label>
      {q.type === "info" ? (onEtape && <div><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onEtape(3)}>{t("Aller à l'étape 3")}</button></div>)
        : <div className="d-flex flex-wrap gap-2 align-items-center">
            {q.type === "jours"
              ? <ChoixJours id={`q-${q.id}`} jours={joursOuvres} valeur={v} onChange={setV} />
              : <input type="number" id={`q-${q.id}`} className="form-control form-control-sm" style={{ width: 110 }} min={q.min} max={q.max} value={v ?? ""}
                       onChange={(e) => setV(e.target.value === "" ? "" : Number(e.target.value))} />}
            <button type="button" className="btn btn-sm btn-primary" disabled={v === "" || v === null || (q.type === "jours" && !v.length)}
                    onClick={() => onRepondre(q, v)}>{t("Appliquer cette réponse")}</button>
          </div>}
    </div>
  )
}

/** Barre d'occupation (charge / capacité). */
export function Occupation({ taux }) {
  const n = Math.min(100, taux || 0)
  const classe = n > 95 ? "bg-danger" : n > 85 ? "bg-warning" : "bg-success"
  return (
    <div className="d-flex align-items-center gap-2">
      <div className="progress flex-grow-1" style={{ height: 6, minWidth: 60 }} role="progressbar" aria-valuenow={n} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-bar ${classe}`} style={{ width: `${n}%` }} /></div>
      <span className="small text-muted" style={{ width: 38 }}>{taux}%</span>
    </div>
  )
}
