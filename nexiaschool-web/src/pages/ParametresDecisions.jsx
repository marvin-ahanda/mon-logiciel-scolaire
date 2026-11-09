// Paramètres → Décisions de fin de période : critères d'admission, de rattrapage, de redoublement et d'exclusion
// pour chaque trimestre et pour la fin d'année (administration uniquement).
import { useEffect, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { PRIORITE, libelleParDefaut, resumeCritere } from "../lib/decisions.js"
import { rpc, supabase, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const PERIODES = [["t1", "Trimestre 1"], ["t2", "Trimestre 2"], ["t3", "Trimestre 3"], ["a", "Fin d'année"]]
const TITRES = { exclu: "Critères d'exclusion", redouble: "Critères de redoublement", rattrapage: "Critères de passage au rattrapage", admis: "Critères d'admission" }
const TITRES_TRIMESTRE = { exclu: "Critères d'exclusion", redouble: "Critères d'alerte de redoublement", admis: "Critères de travail satisfaisant" }
const COULEURS = { exclu: "danger", redouble: "warning", rattrapage: "info", admis: "success" }
const CHAMPS = ["moyenne_min", "moyenne_max", "discipline_min", "discipline_max", "heures_nj_min", "heures_nj_max", "retards_min", "sanction_id", "sanctions_min", "libelle"]
const vide = (decision) => ({ cle: Math.random().toString(36).slice(2), decision, ...Object.fromEntries(CHAMPS.map((c) => [c, ""])) })
const versFormulaire = (c) => ({ cle: c.id, decision: c.decision, ...Object.fromEntries(CHAMPS.map((k) => [k, c[k] === null || c[k] === undefined ? "" : String(c[k])])) })
const versBase = (c) => ({ decision: c.decision, libelle: c.libelle.trim(), sanction_id: c.sanction_id || null,
  ...Object.fromEntries(CHAMPS.filter((k) => !["sanction_id", "libelle"].includes(k)).map((k) => [k, c[k] === "" ? null : Number(String(c[k]).replace(",", "."))])) })

function Champ({ id, libelle, valeur, onChange, pas = "0.01", max = 20 }) {
  return (
    <div className="col-6 col-md-3 col-xl"><label className="form-label small mb-0" htmlFor={id}>{libelle}</label>
      <input id={id} type="number" className="form-control form-control-sm" min={0} max={max} step={pas} value={valeur} onChange={(e) => onChange(e.target.value)} /></div>
  )
}

function Critere({ c, periode, sanctions, onChange, onRetirer }) {
  const maj = (k) => (v) => onChange({ ...c, [k]: v })
  const id = (k) => `${c.cle}-${k}`
  return (
    <div className="critere-decision border rounded p-2 mb-2">
      <div className="row g-2 align-items-end">
        <Champ id={id("mmin")} libelle={t("Moyenne ≥")} valeur={c.moyenne_min} onChange={maj("moyenne_min")} />
        <Champ id={id("mmax")} libelle={t("Moyenne <")} valeur={c.moyenne_max} onChange={maj("moyenne_max")} />
        <Champ id={id("dmin")} libelle={t("Note de discipline ≥")} valeur={c.discipline_min} onChange={maj("discipline_min")} />
        <Champ id={id("dmax")} libelle={t("Note de discipline <")} valeur={c.discipline_max} onChange={maj("discipline_max")} />
        <Champ id={id("hmin")} libelle={t("Absences non justifiées ≥ (h)")} valeur={c.heures_nj_min} onChange={maj("heures_nj_min")} pas="1" max={2000} />
        <Champ id={id("hmax")} libelle={t("Absences non justifiées < (h)")} valeur={c.heures_nj_max} onChange={maj("heures_nj_max")} pas="1" max={2000} />
      </div>
      <div className="row g-2 align-items-end mt-1">
        <Champ id={id("rmin")} libelle={t("Retards ≥")} valeur={c.retards_min} onChange={maj("retards_min")} pas="1" max={1000} />
        <div className="col-6 col-md-3"><label className="form-label small mb-0" htmlFor={id("san")}>{t("Sanction reçue")}</label>
          <select id={id("san")} className="form-select form-select-sm" value={c.sanction_id} onChange={(e) => onChange({ ...c, sanction_id: e.target.value, sanctions_min: e.target.value ? c.sanctions_min || "1" : "" })}>
            <option value="">{t("— aucune —")}</option>{sanctions.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}</select></div>
        {c.sanction_id && <Champ id={id("smin")} libelle={t("au moins (fois)")} valeur={c.sanctions_min} onChange={maj("sanctions_min")} pas="1" max={100} />}
        <div className="col-12 col-md"><label className="form-label small mb-0" htmlFor={id("lib")}>{t("Libellé sur le bulletin (facultatif)")}</label>
          <input id={id("lib")} className="form-control form-control-sm" maxLength={80} placeholder={t(libelleParDefaut(c.decision, periode))} value={c.libelle} onChange={(e) => onChange({ ...c, libelle: e.target.value })} /></div>
        <div className="col-auto"><button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetirer} title={t("Retirer ce critère")}>{t("Retirer")}</button></div>
      </div>
      <div className="small text-muted mt-1">→ {t("Si")} {resumeCritere(versBase(c), (sid) => sanctions.find((s) => s.id === sid)?.libelle || "?", t)}</div>
    </div>
  )
}

export default function ParametresDecisions() {
  const [d, erreur, recharger] = useDonnees(async () => ({
    criteres: verifier(await supabase.from("criteres_decision").select("*").order("ordre")),
    sanctions: verifier(await supabase.from("sanctions").select("id, libelle").order("points_perdus").order("libelle")),
  }), [])
  const [periode, setPeriode] = useState("a")
  const [liste, setListe] = useState(null), [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(false)
  useEffect(() => { if (d) setListe(d.criteres.filter((c) => c.periode === periode).map(versFormulaire)) }, [d, periode])
  if (!d || !liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const decisions = PRIORITE.filter((x) => periode === "a" || x !== "rattrapage")
  const titres = periode === "a" ? TITRES : TITRES_TRIMESTRE

  async function enregistrer(cible = periode, criteres = liste) {
    setMsg({}); setOccupe(true)
    try {
      await rpc("enregistrer_criteres_decision", { p_periode: cible, p_criteres: criteres.map(versBase) })
      return true
    } catch (e) { setMsg({ erreur: e.message }); return false } finally { setOccupe(false) }
  }
  async function enregistrerTout() {
    if (await enregistrer()) { setMsg({ ok: t("Critères enregistrés pour « {v0} ».", { v0: t(PERIODES.find((p) => p[0] === periode)[1]) }) }); recharger() }
  }
  async function copierTrimestres() {
    if (!confirm(t("Appliquer ces critères aux trois trimestres ? Les critères déjà fixés pour les autres trimestres seront remplacés."))) return
    for (const p of ["t1", "t2", "t3"]) if (!(await enregistrer(p, liste))) return
    setMsg({ ok: t("Critères appliqués aux trois trimestres.") }); recharger()
  }

  return (
    <div className="decisions-parametres">
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <p className="text-muted small">{t("Fixez, pour chaque trimestre et pour la fin d'année, les critères de la décision proposée sur les bulletins. Un critère réunit des conditions qui doivent toutes être remplies ; plusieurs critères pour une même décision s'additionnent (l'un ou l'autre suffit). Les décisions sont examinées dans cet ordre : exclusion, redoublement, rattrapage, admission — la première remplie est proposée. Laissez une case vide pour ne pas en tenir compte.")}</p>
      <ul className="nav nav-pills mb-3">{PERIODES.map(([p, l]) => (
        <li className="nav-item" key={p}><button type="button" className={`nav-link${p === periode ? " active" : ""}`} onClick={() => { setMsg({}); setPeriode(p) }}>
          {t(l)}{d.criteres.some((c) => c.periode === p) && <span className="badge text-bg-light ms-1">{d.criteres.filter((c) => c.periode === p).length}</span>}</button></li>))}</ul>
      {!liste.length && <div className="alert alert-info small">{periode === "a"
        ? t("Aucun critère pour la fin d'année : la règle par défaut s'applique (moyenne ≥ 10 : admis(e) en classe supérieure, sinon redouble).")
        : t("Aucun critère pour ce trimestre : aucune décision n'est proposée sur les bulletins du trimestre.")}</div>}
      {decisions.map((dec) => (
        <div className={`card mb-3 border-${COULEURS[dec]}`} key={dec} data-decision={dec}><div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h2 className="h6 mb-0"><span className={`badge text-bg-${COULEURS[dec]} me-2`}>{PRIORITE.indexOf(dec) + 1}</span>{t(titres[dec])}
              <span className="text-muted fw-normal small"> — {t("bulletin : « {v0} »", { v0: t(libelleParDefaut(dec, periode)) })}</span></h2>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setListe([...liste, vide(dec)])}>＋ {t("Ajouter un critère")}</button>
          </div>
          {liste.filter((c) => c.decision === dec).map((c, k) => (
            <div key={c.cle}>{k > 0 && <div className="text-center small fw-semibold text-muted my-1">{t("OU")}</div>}
              <Critere c={c} periode={periode} sanctions={d.sanctions} onChange={(x) => setListe(liste.map((y) => (y.cle === c.cle ? x : y)))}
                       onRetirer={() => setListe(liste.filter((y) => y.cle !== c.cle))} /></div>))}
          {!liste.some((c) => c.decision === dec) && <div className="small text-muted">{t("Aucun critère.")}</div>}
        </div></div>))}
      <div className="d-flex flex-wrap gap-2 mb-4">
        <button className="btn btn-primary" disabled={occupe} onClick={enregistrerTout}>{t("Enregistrer les critères")}</button>
        {periode !== "a" && <button className="btn btn-outline-secondary" disabled={occupe} onClick={copierTrimestres}>{t("Appliquer aux trois trimestres")}</button>}
      </div>
    </div>
  )
}
