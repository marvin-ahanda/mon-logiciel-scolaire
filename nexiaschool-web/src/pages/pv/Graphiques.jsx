// Graphiques des PV à l'écran (SVG, sans bibliothèque) : barres horizontales et courbes d'évolution.
import { note, pourcentage } from "../../lib/format.js"
import { t } from "../../i18n.jsx"

const COULEURS = ["var(--bs-primary)", "#b8860b", "var(--bs-success)", "var(--bs-danger)"]

/** Barres horizontales : elements = [{ libelle, valeur }] ; seuil : valeur sous laquelle la barre est rouge. */
export function Barres({ titre, elements, max = 100, seuil = null, format = pourcentage }) {
  if (!elements.length) return null
  return (
    <figure className="pv-graphique mb-3">
      {titre && <figcaption className="small fw-semibold mb-2">{titre}</figcaption>}
      <div role="list">
        {elements.map((e, k) => {
          const v = e.valeur ?? 0, part = Math.max(0, Math.min(100, (v / max) * 100))
          const faible = seuil !== null && e.valeur !== null && e.valeur !== undefined && v < seuil
          return (
            <div key={`${e.libelle}-${k}`} className="d-flex align-items-center gap-2 small mb-1" role="listitem">
              <span className="pv-barre-libelle text-truncate" title={e.libelle}>{e.libelle}</span>
              <span className="pv-barre-piste flex-grow-1" aria-hidden="true">
                <span className={`pv-barre ${faible ? "bg-danger" : "bg-success"}`} style={{ width: `${part}%` }} />
              </span>
              <span className="pv-barre-valeur text-end">{e.valeur === null || e.valeur === undefined ? "—" : format(e.valeur)}</span>
            </div>)
        })}
      </div>
    </figure>
  )
}

/** Courbes : libelles (abscisses), series = [{ nom, valeurs }], sur une échelle 0 → max. */
export function Courbes({ titre, libelles, series, max = 20 }) {
  if (libelles.length < 2) return null
  const L = 560, H = 200, g = 34, d = 12, h = 14, b = 26
  const x = (k) => g + (k * (L - g - d)) / (libelles.length - 1)
  const y = (v) => h + (1 - Math.min(max, Math.max(0, v)) / max) * (H - h - b)
  return (
    <figure className="pv-graphique mb-3">
      {titre && <figcaption className="small fw-semibold mb-1">{titre}</figcaption>}
      <svg viewBox={`0 0 ${L} ${H}`} className="w-100" role="img" aria-label={titre}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}><line x1={g} x2={L - d} y1={y(max * p)} y2={y(max * p)} stroke="currentColor" strokeOpacity="0.12" />
            <text x={g - 4} y={y(max * p) + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity="0.6">{note(max * p)}</text></g>))}
        {libelles.map((l, k) => <text key={l + k} x={x(k)} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.7">{l}</text>)}
        {series.map((s, i) => {
          const points = s.valeurs.map((v, k) => (v === null || v === undefined ? null : [x(k), y(v)]))
          const segments = []
          let courant = []
          for (const p of points) { if (p) courant.push(p); else if (courant.length) { segments.push(courant); courant = [] } }
          if (courant.length) segments.push(courant)
          return (
            <g key={s.nom} stroke={COULEURS[i % COULEURS.length]} fill={COULEURS[i % COULEURS.length]}>
              {segments.map((seg, k) => <polyline key={k} points={seg.map((p) => p.join(",")).join(" ")} fill="none" strokeWidth="2" />)}
              {points.map((p, k) => p && <circle key={k} cx={p[0]} cy={p[1]} r="3"><title>{`${s.nom} · ${libelles[k]} : ${note(s.valeurs[k])}`}</title></circle>)}
            </g>)
        })}
      </svg>
      <div className="d-flex flex-wrap gap-3 small">{series.map((s, i) => (
        <span key={s.nom}><span className="pv-legende" style={{ background: COULEURS[i % COULEURS.length] }} aria-hidden="true" /> {s.nom}</span>))}
      </div>
    </figure>
  )
}

/** Tuiles d'indicateurs. */
export function Tuiles({ elements }) {
  return (
    <div className="row g-2 mb-3">{elements.filter(Boolean).map((e) => (
      <div className="col-6 col-md-4 col-xl-2" key={e.libelle}>
        <div className={`pv-tuile h-100 ${e.ton ? `pv-tuile-${e.ton}` : ""}`}>
          <div className="pv-tuile-valeur">{e.valeur}</div>
          <div className="pv-tuile-libelle">{e.libelle}</div>
          {e.aide && <div className="pv-tuile-aide">{e.aide}</div>}
        </div>
      </div>))}
    </div>
  )
}

export const libelleSeuil = (seuil) => t("Seuil de réussite : {v0}/20", { v0: note(seuil) })
