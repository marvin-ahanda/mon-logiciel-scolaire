import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { date } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const signaler = () => window.dispatchEvent(new Event("discipline:maj"))

/** Réglage des seuils d'alerte (surveillant général et administration). */
function Seuils({ sanctions, reglage, onEnregistre }) {
  const [heures, setHeures] = useState(reglage.heures ?? "")
  const [parSanction, setParSanction] = useState(() => Object.fromEntries(sanctions.map((s) => [s.id, reglage.sanctions.get(s.id) ?? ""])))
  const [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)
  async function enregistrer(e) {
    e.preventDefault(); setMsg({}); setEnvoi(true)
    try {
      const h = String(heures).trim()
      if (h && !/^\d+$/.test(h)) throw new Error(t("Seuil d'heures : nombre entier attendu."))
      for (const v of Object.values(parSanction)) if (String(v).trim() && !/^\d+$/.test(String(v).trim())) throw new Error(t("Seuil de sanctions : nombre entier attendu."))
      await rpc("discipline_enregistrer_seuils", { p_heures: h ? Number(h) : null,
        p_sanctions: Object.entries(parSanction).filter(([, v]) => String(v).trim()).map(([id, v]) => ({ sanction_id: id, seuil: Number(v) })) })
      setMsg({ ok: t("Seuils enregistrés : les alertes sont recalculées automatiquement.") }); signaler(); onEnregistre()
    } catch (x) { setMsg({ erreur: x.message }) } finally { setEnvoi(false) }
  }
  return (
    <form className="card mb-3 no-print" onSubmit={enregistrer}>
      <div className="card-header fw-semibold">{t("Seuils d'alerte")}</div>
      <div className="card-body">
        <p className="small text-muted">{t("Dès qu'un élève atteint l'un de ces seuils sur l'année scolaire en cours, une alerte est envoyée à toute l'administration et à tous les surveillants. Laissez une case vide pour ne pas surveiller ce critère.")}</p>
        <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
        <div className="row g-3 align-items-start">
          <div className="col-md-4">
            <label className="form-label" htmlFor="seuil-heures">{t("Heures d'absence non justifiées (cumul)")}</label>
            <div className="input-group">
              <input id="seuil-heures" className="form-control" type="number" min={1} max={1000} step={1} value={heures} onChange={(e) => setHeures(e.target.value)} placeholder={t("ex. 10")} />
              <span className="input-group-text">{t("h")}</span>
            </div>
          </div>
          <div className="col-md-8">
            <span className="form-label d-block">{t("Nombre de sanctions (blâmes, avertissements…)")}</span>
            {!sanctions.length ? <p className="small text-muted mb-0">{t("Aucune sanction définie : l'administration les crée dans Paramètres → Discipline.")}</p> : (
              <div className="row g-2">{sanctions.map((s) => (
                <div key={s.id} className="col-sm-6 col-lg-4">
                  <label className="form-label small mb-1" htmlFor={`seuil-${s.id}`}>{s.libelle}</label>
                  <input id={`seuil-${s.id}`} className="form-control form-control-sm" type="number" min={1} max={100} step={1} value={parSanction[s.id] ?? ""}
                         onChange={(e) => setParSanction({ ...parSanction, [s.id]: e.target.value })} placeholder={t("aucune alerte")} aria-label={t("Seuil : {v0}", { v0: s.libelle })} />
                </div>))}</div>)}
          </div>
        </div>
        <button className="btn btn-primary mt-3" disabled={envoi}>{envoi ? t("Enregistrement…") : t("Enregistrer les seuils")}</button>
      </div>
    </form>
  )
}

function libelleMotif(m) {
  return m.motif === "heures"
    ? t("{v0} h d'absence non justifiée (seuil : {v1} h)", { v0: m.valeur, v1: m.seuil })
    : t("{v0} × {v1} (seuil : {v2})", { v0: m.valeur, v1: m.libelle, v2: m.seuil })
}

function FicheEleve({ e, details, nouvelle }) {
  const incidents = details.incidents.filter((x) => x.inscription_id === e.inscription_id)
  const absences = details.absences.filter((x) => x.inscription_id === e.inscription_id && (x.heures_non_justifiees || x.heures_justifiees))
  const retards = details.retards.filter((x) => x.inscription_id === e.inscription_id)
  return (
    <div className={`card mb-3 fiche-alerte ${nouvelle ? "border-danger" : ""}`}>
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <strong>{e.nom} {e.prenom}</strong><span className="text-muted small">{e.classe} · {e.matricule}</span>
        {nouvelle && <span className="badge text-bg-danger ms-auto">{t("Nouvelle alerte")}</span>}
      </div>
      <div className="card-body">
        <ul className="list-unstyled mb-3">{e.motifs.map((m) => (
          <li key={m.motif} className="text-danger fw-semibold">⚠ {libelleMotif(m)}</li>))}</ul>
        <div className="row g-2 mb-3 small">
          <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-muted">{t("Heures non justifiées")}</div><strong className="fs-5">{e.heures_nj}</strong></div></div>
          <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-muted">{t("Heures justifiées")}</div><strong className="fs-5">{e.heures_j}</strong></div></div>
          <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-muted">{t("Retards")}</div><strong className="fs-5">{e.retards}</strong></div></div>
          <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-muted">{t("Sanctions")}</div>
            <strong>{e.sanctions.length ? e.sanctions.map((s) => `${s.nombre} × ${s.libelle}`).join(", ") : "—"}</strong></div></div>
        </div>
        <div className="row g-3">
          <div className="col-lg-7">
            <h3 className="h6">{t("Infractions et sanctions")}</h3>
            {incidents.length ? (
              <table className="table table-sm small mb-0"><thead><tr><th>{t("Date")}</th><th>{t("Infraction")}</th><th>{t("Sanction")}</th><th>{t("Observation")}</th></tr></thead>
                <tbody>{incidents.map((x) => <tr key={x.id}><td className="text-nowrap">{date(x.date)}</td><td>{x.infractions?.libelle}</td>
                  <td>{x.infractions?.sanctions?.libelle}</td><td>{x.observation}</td></tr>)}</tbody></table>
            ) : <p className="small text-muted">{t("Aucune infraction.")}</p>}
          </div>
          <div className="col-lg-5">
            <h3 className="h6">{t("Absences")}</h3>
            {absences.length ? (
              <table className="table table-sm small mb-2"><thead><tr><th>{t("Date")}</th><th className="text-end">{t("Non justifiées")}</th><th className="text-end">{t("Justifiées")}</th><th>{t("Motif")}</th></tr></thead>
                <tbody>{absences.map((x) => <tr key={x.id}><td className="text-nowrap">{date(x.date)}</td><td className="text-end">{x.heures_non_justifiees} h</td>
                  <td className="text-end">{x.heures_justifiees} h</td><td>{x.motif}</td></tr>)}</tbody></table>
            ) : <p className="small text-muted">{t("Aucune absence.")}</p>}
            {retards.length > 0 && <p className="small mb-0"><strong>{t("Retards : ")}</strong>{retards.map((x) => date(x.date)).join(", ")}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Alertes de discipline : synthèse des élèves qui ont atteint un seuil, et réglage des seuils. */
export default function AlertesDiscipline() {
  const { exercice } = useSession()
  const { state } = useLocation()
  const nouvellesRef = useRef(null)            // alertes nouvelles à l'ouverture de la page (avant de les marquer lues)
  const [seulementNouvelles, setSeulementNouvelles] = useState(!!state?.nouvelles?.length)
  const [d, erreur, rafraichir] = useDonnees(async () => {
    if (!exercice) return null
    const [alertes, sanctions, seuilH, seuilsS] = await Promise.all([
      rpc("discipline_alertes"), verifier(await supabase.from("sanctions").select("id, libelle").order("libelle")),
      supabase.from("seuils_discipline").select("heures_non_justifiees").maybeSingle().then(verifier),
      supabase.from("seuils_sanctions").select("sanction_id, seuil").then(verifier)])
    const ids = alertes.eleves.map((e) => e.inscription_id)
    const charger = (table, colonnes) => ids.length ? toutCharger(() => supabase.from(table).select(colonnes).in("inscription_id", ids).order("date", { ascending: false })) : []
    const [absences, retards, incidents] = await Promise.all([charger("absences", "id, inscription_id, date, heures_non_justifiees, heures_justifiees, motif"),
      charger("retards", "id, inscription_id, date"), charger("incidents", "id, inscription_id, date, observation, infractions(libelle, sanctions(libelle))")])
    return { alertes, sanctions, reglage: { heures: seuilH?.heures_non_justifiees ?? null, sanctions: new Map(seuilsS.map((s) => [s.sanction_id, s.seuil])) },
             details: { absences, retards, incidents } }
  }, [exercice?.id])

  useEffect(() => {
    if (!d) return
    if (nouvellesRef.current === null) {
      nouvellesRef.current = new Set(state?.nouvelles?.length ? state.nouvelles : d.alertes.eleves.filter((e) => e.nouvelle).map((e) => e.inscription_id))
    }
    if (d.alertes.non_lues > 0) rpc("discipline_marquer_alertes_lues").then(signaler).catch(() => {})
  }, [d, state])

  const eleves = useMemo(() => {
    if (!d) return []
    const nouv = nouvellesRef.current || new Set(d.alertes.eleves.filter((e) => e.nouvelle).map((e) => e.inscription_id))
    return d.alertes.eleves.map((e) => ({ e, nouvelle: nouv.has(e.inscription_id) || e.nouvelle }))
      .sort((a, b) => Number(b.nouvelle) - Number(a.nouvelle))
  }, [d])

  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}</div>
  if (!d) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const nbNouvelles = eleves.filter((x) => x.nouvelle).length
  const affiches = seulementNouvelles && nbNouvelles ? eleves.filter((x) => x.nouvelle) : eleves
  const configure = d.reglage.heures !== null || d.reglage.sanctions.size > 0
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="h3 mb-0 me-auto">{t("Alertes de discipline")}</h1>
        {eleves.length > 0 && <button type="button" className="btn btn-outline-secondary no-print" onClick={() => window.print()}>{t("Imprimer")}</button>}
      </div>
      <Seuils sanctions={d.sanctions} reglage={d.reglage} onEnregistre={rafraichir} />
      {!configure ? <div className="alert alert-info">{t("Aucun seuil défini : fixez au moins un seuil ci-dessus pour recevoir les alertes.")}</div> : (
        <>
          <div className="d-flex flex-wrap align-items-center gap-3 mb-2">
            <h2 className="h5 mb-0">{t("{v0} élève(s) au-delà des seuils", { v0: eleves.length })}</h2>
            {nbNouvelles > 0 && nbNouvelles < eleves.length && (
              <div className="btn-group btn-group-sm no-print" role="group" aria-label={t("Filtre")}>
                <button type="button" className={`btn ${seulementNouvelles ? "btn-dark" : "btn-outline-dark"}`} aria-pressed={seulementNouvelles} onClick={() => setSeulementNouvelles(true)}>
                  {t("Nouvelles alertes ({v0})", { v0: nbNouvelles })}</button>
                <button type="button" className={`btn ${!seulementNouvelles ? "btn-dark" : "btn-outline-dark"}`} aria-pressed={!seulementNouvelles} onClick={() => setSeulementNouvelles(false)}>
                  {t("Tous ({v0})", { v0: eleves.length })}</button>
              </div>)}
          </div>
          {!eleves.length && <p className="text-muted">{t("Aucun élève n'atteint les seuils pour le moment.")}</p>}
          {affiches.map(({ e, nouvelle }) => <FicheEleve key={e.inscription_id} e={e} details={d.details} nouvelle={nouvelle} />)}
          <p className="small text-muted no-print">{t("Saisie des absences et des infractions : ")}<Link to="/discipline/appel">{t("Appel du jour")}</Link> · <Link to="/discipline/infractions">{t("Infractions")}</Link></p>
        </>
      )}
    </>
  )
}
