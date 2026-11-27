// SmartEval — côté enseignant : réglage de la durée individuelle de composition et suivi des tentatives.
import { useEffect, useState } from "react"
import { DUREES_PROPOSEES, DUREE_MAX, DUREE_MIN, compteARebours, dureeTexte, secondesSaisies } from "../lib/chrono.js"
import { dateHeure } from "../lib/format.js"
import { rpc } from "../supabase.js"
import { t, traduireErreur } from "../i18n.jsx"

/** Valeur du réglage : { secondes: number|null (null = chronomètre désactivé), auto: boolean }. */
export const CHRONO_DEFAUT = { secondes: null, auto: true }

/** Contrôle avant enregistrement : message d'erreur, ou "" si le réglage est valable. */
export function controlerChrono(c) {
  if (c?.secondes === null || c?.secondes === undefined) return ""
  return c.secondes >= DUREE_MIN && c.secondes <= DUREE_MAX ? "" : t("Durée de composition invalide : entre 1 minute et 12 heures.")
}

/** Enregistre le réglage sur le serveur (évaluation non publiée, établissement ou indépendante). */
export function enregistrerChrono(id, c) {
  return rpc("smarteval_chrono_definir", { p_id: id, p_secondes: c?.secondes ?? null, p_auto: c?.auto !== false })
}

export function ReglageChrono({ valeur = CHRONO_DEFAUT, onChange, idBase = "chrono" }) {
  const actif = valeur.secondes !== null
  const prop = DUREES_PROPOSEES.includes(valeur.secondes)
  const [perso, setPerso] = useState(() => actif && !prop)
  const [saisie, setSaisie] = useState(() => ({ h: actif ? Math.floor(valeur.secondes / 3600) : 1, m: actif ? Math.floor((valeur.secondes % 3600) / 60) : 0 }))
  const majSaisie = (s) => { setSaisie(s); onChange({ ...valeur, secondes: secondesSaisies(s.h, s.m) ?? -1 }) }
  const choix = !actif ? "" : perso ? "perso" : String(valeur.secondes)
  return (
    <div className="se-carte se-chrono-reglage">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <h2 className="h6 mb-0">⏱ {t("Durée individuelle de composition")}</h2>
        <div className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" role="switch" id={`${idBase}-actif`} checked={actif}
                 onChange={(e) => { setPerso(false); onChange({ ...valeur, secondes: e.target.checked ? 3600 : null }) }} />
          <label className="form-check-label small" htmlFor={`${idBase}-actif`}>{t("Activer le chronomètre")}</label>
        </div>
      </div>
      <p className="small text-muted mt-1 mb-2">{t("Chaque élève dispose du temps défini à partir du moment où il commence l'évaluation.")}</p>
      {actif && <>
        <div className="row g-2 align-items-end">
          <div className="col-sm-5"><label className="form-label small" htmlFor={`${idBase}-duree`}>{t("Durée")}</label>
            <select id={`${idBase}-duree`} className="form-select" value={choix}
                    onChange={(e) => { if (e.target.value === "perso") { setPerso(true); majSaisie(saisie) } else { setPerso(false); onChange({ ...valeur, secondes: Number(e.target.value) }) } }}>
              {DUREES_PROPOSEES.map((s) => <option key={s} value={s}>{dureeTexte(s)}</option>)}
              <option value="perso">{t("Durée personnalisée")}</option>
            </select></div>
          {perso && <>
            <div className="col-4 col-sm-3"><label className="form-label small" htmlFor={`${idBase}-h`}>{t("Heures")}</label>
              <input id={`${idBase}-h`} type="number" min={0} max={12} className="form-control" value={saisie.h} onChange={(e) => majSaisie({ ...saisie, h: e.target.value })} /></div>
            <div className="col-4 col-sm-3"><label className="form-label small" htmlFor={`${idBase}-m`}>{t("Minutes")}</label>
              <input id={`${idBase}-m`} type="number" min={0} max={59} className="form-control" value={saisie.m} onChange={(e) => majSaisie({ ...saisie, m: e.target.value })} /></div>
          </>}
        </div>
        {valeur.secondes > 0
          ? <div className="small mt-2">{t("Chaque élève aura ")}<strong>{dureeTexte(valeur.secondes)}</strong>{t(", dans la limite de l'échéance générale du lien.")}</div>
          : <div className="small text-danger mt-2">{t("Durée de composition invalide : entre 1 minute et 12 heures.")}</div>}
        <div className="form-check mt-2">
          <input className="form-check-input" type="checkbox" id={`${idBase}-auto`} checked={valeur.auto !== false} onChange={(e) => onChange({ ...valeur, auto: e.target.checked })} />
          <label className="form-check-label small" htmlFor={`${idBase}-auto`}>{t("Soumettre automatiquement les réponses à l'expiration du temps")}</label>
        </div>
      </>}
    </div>
  )
}

const LIBELLES_STATUT = { en_cours: "En cours", soumise: "Soumis", expiree: "Temps écoulé" }
const CLASSES_STATUT = { en_cours: "text-bg-primary", soumise: "text-bg-success", expiree: "text-bg-warning" }

/** Suivi des compositions chronométrées : qui a commencé, quand, temps utilisé, statut (pas de participant fictif). */
export function SuiviTentatives({ ev, independant = false, rafraichir = 0 }) {
  const [liste, setListe] = useState(null), [erreur, setErreur] = useState("")
  useEffect(() => {
    if (!ev?.chrono_secondes) return
    let actif = true
    rpc("smarteval_tentatives", { p_id: ev.id }).then((l) => { if (actif) { setListe(l || []); setErreur("") } })
      .catch((e) => { if (actif) setErreur(traduireErreur(e.message)) })
    return () => { actif = false }
  }, [ev?.id, ev?.chrono_secondes, independant, rafraichir])
  if (!ev?.chrono_secondes) return null
  const compte = (s) => (liste || []).filter((x) => x.statut === s).length
  return (
    <div className="card mb-3 se-suivi-tentatives">
      <div className="card-header fw-semibold d-flex flex-wrap justify-content-between gap-2">
        <span>⏱ {t("Compositions chronométrées ({v0} par élève)", { v0: dureeTexte(ev.chrono_secondes) })}</span>
        {liste && <span className="small fw-normal text-muted">{t("{v0} en cours · {v1} soumise(s) · {v2} temps écoulé", { v0: compte("en_cours"), v1: compte("soumise"), v2: compte("expiree") })}</span>}
      </div>
      {erreur && <div className="alert alert-danger m-2">{erreur}</div>}
      {liste && !liste.length && <div className="card-body small text-muted">{t("Aucun élève n'a encore commencé : les élèves qui n'ont pas commencé n'apparaissent pas ici (statut « Non commencé »).")}</div>}
      {liste?.length > 0 && <div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Début")}</th><th>{t("Durée")}</th><th>{t("Fin prévue")}</th>
          <th>{t("Soumission")}</th><th>{t("Temps utilisé")}</th><th>{t("Statut")}</th></tr></thead>
        <tbody>{liste.map((x) => <tr key={x.id}>
          <td>{x.nom} {x.prenom}{x.matricule && <span className="small text-muted"> · {x.matricule}</span>}</td><td>{x.classe}</td>
          <td className="small">{dateHeure(x.debut)}</td><td className="small">{dureeTexte(x.duree_secondes)}</td><td className="small">{dateHeure(x.expire_le)}</td>
          <td className="small">{x.soumis_le ? dateHeure(x.soumis_le) : "—"}</td>
          <td className="small">{x.temps_utilise === null || x.temps_utilise === undefined ? "—" : compteARebours(x.temps_utilise * 1000)}</td>
          <td><span className={`badge ${CLASSES_STATUT[x.statut] || "text-bg-light"}`}>{t(LIBELLES_STATUT[x.statut] || x.statut)}</span>
            {x.statut === "expiree" && !x.copie && <div className="small text-muted">{t("sans copie (soumission automatique désactivée)")}</div>}
            {!x.copie && <button type="button" className="btn btn-link btn-sm p-0 d-block" onClick={async () => {
              if (!window.confirm(t("Réinitialiser cette composition ? L'élève pourra recommencer avec la durée complète."))) return
              try { await rpc("smarteval_tentative_reinitialiser", { p_tentative: x.id }); setListe((l) => l.filter((y) => y.id !== x.id)) }
              catch (e) { setErreur(traduireErreur(e.message)) }
            }}>{t("Réinitialiser")}</button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  )
}
