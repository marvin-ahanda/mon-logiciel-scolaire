// Finances → Relances et insolvabilité (administration, comptabilité / caisse) : élèves concernés à une date, exclusions,
// envois planifiés et leur statut, courrier final validé avant envoi, réglages des paliers, journal de chaque action.
import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { date, dateHeure } from "../lib/format.js"
import { fcfa, jour } from "../lib/financePdf.js"
import { ACTIONS_JOURNAL, problemesPaliers, remplir, STATUTS, statutAffiche, trierPaliers, TYPES_EXCLUSION, VARIABLES_FINAL, VARIABLES_RELANCE } from "../lib/relances.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const VUES = [["eleves", "Élèves concernés"], ["envois", "Envois et statuts"], ["final", "Courrier final"], ["reglages", "Réglages"], ["journal", "Journal"]]

export function Statut({ c }) {
  const [libelle, couleur] = STATUTS[statutAffiche(c)] || [c.statut, "secondary"]
  return <span className={`badge text-bg-${couleur}`}>{t(libelle)}</span>
}

export default function Relances() {
  const [params, setParams] = useSearchParams()
  const vue = VUES.some(([k]) => k === params.get("vue")) ? params.get("vue") : "eleves"
  // chargé : { config } (config vaut null tant que le module n'est pas configuré)
  const [charge, erreur, recharger] = useDonnees(async () => ({ config: verifier(await supabase.from("relances_config").select("*").maybeSingle()) }), [])
  const config = charge?.config
  const [message, setMessage] = useState({ ok: "", erreur: "" })
  async function activerModule() {
    try { await rpc("relances_configurer", { p: {} }); recharger() } catch (e) { setMessage({ ok: "", erreur: e.message }) }
  }
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h1 className="h3 m-0">{t("Relances et insolvabilité")}</h1>
        <Link className="btn btn-sm btn-outline-secondary" to="/finance">{t("← Finances")}</Link>
      </div>
      <p className="text-muted small">{t("Les relances rappellent l'échéance et annoncent un contrôle : elles n'annoncent jamais de renvoi. Seul le parent de l'élève concerné reçoit le courrier, dans l'espace de son enfant.")}</p>
      <Alerte>{erreur || message.erreur}</Alerte>
      {message.ok && <div className="alert alert-success small py-2">{message.ok}</div>}
      {!charge && !erreur && <Chargement />}
      {charge && !config && (
        <div className="card mb-3" style={{ maxWidth: 720 }}><div className="card-body">
          <h2 className="h6">{t("Module de relances non configuré")}</h2>
          <p className="small text-muted">{t("Activez-le pour obtenir les 8 paliers par défaut (J-10 à jour J), modifiables ensuite. L'envoi automatique reste désactivé tant que vous ne l'activez pas.")}</p>
          <button type="button" className="btn btn-primary" onClick={activerModule}>{t("Configurer les relances")}</button>
        </div></div>)}
      {config && (
        <>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <span className={`badge ${config.actif ? "text-bg-success" : "text-bg-secondary"}`}>{config.actif ? t("Envoi automatique actif") : t("Envoi automatique désactivé")}</span>
            {config.derniere_execution && <span className="small text-muted">{t("Dernière exécution automatique : {v0}", { v0: jour(config.derniere_execution) })}</span>}
          </div>
          <ul className="nav nav-tabs mb-3">
            {VUES.map(([k, l]) => <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => setParams({ vue: k })}>{t(l)}</button></li>)}
          </ul>
          {vue === "eleves" && <Eleves config={config} onMessage={setMessage} />}
          {vue === "envois" && <Envois onMessage={setMessage} />}
          {vue === "final" && <CourrierFinal config={config} onMessage={setMessage} />}
          {vue === "reglages" && <Reglages config={config} recharger={recharger} onMessage={setMessage} />}
          {vue === "journal" && <Journal />}
        </>)}
    </>
  )
}

// --- 1. Élèves concernés à une date, exclusions -----------------------------------------------------------------------
function Eleves({ onMessage }) {
  const [laDate, setLaDate] = useState(aujourdhui())
  const [liste, erreur, recharger] = useDonnees(() => rpc("relances_insolvables", { p_date: laDate }), [laDate])
  const [exclusions, , rechargerExclusions] = useDonnees(async () => verifier(await supabase.from("finance_exclusions").select("*").order("cree_le", { ascending: false })), [])
  const [exclure, setExclure] = useState(null), [enCours, setEnCours] = useState(false)
  const actives = (exclusions || []).filter((x) => !x.jusqu_au || x.jusqu_au >= aujourdhui())
  async function action(nom, params, ok) {
    setEnCours(true)
    try { const r = await rpc(nom, params); onMessage({ ok: ok(r), erreur: "" }); recharger(); rechargerExclusions() }
    catch (e) { onMessage({ ok: "", erreur: e.message }) } finally { setEnCours(false) }
  }
  return (
    <>
      <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
        <div><label className="form-label small mb-1" htmlFor="rel-date">{t("Situation à la date du")}</label>
          <input id="rel-date" type="date" className="form-control form-control-sm" value={laDate} onChange={(e) => setLaDate(e.target.value || aujourdhui())} /></div>
        <button type="button" className="btn btn-sm btn-primary" disabled={enCours}
          onClick={() => action("relances_planifier", { p_date: laDate }, (n) => t("{v0} relance(s) programmée(s) pour les 14 jours suivants.", { v0: n }))}>{t("Planifier les relances")}</button>
        <button type="button" className="btn btn-sm btn-outline-primary" disabled={enCours}
          onClick={() => confirm(t("Envoyer maintenant aux parents les relances dues aujourd'hui ?")) && action("relances_executer", {}, (r) => t("Envoyées : {v0} · annulées (réglées, exclues ou remplacées) : {v1} · échecs : {v2}.", { v0: r.envoyes, v1: r.annules, v2: r.echecs }))}>{t("Envoyer les relances dues aujourd'hui")}</button>
      </div>
      <Alerte>{erreur}</Alerte>
      {!liste && !erreur && <Chargement />}
      {liste && (
        <div className="table-responsive mb-4"><table className="table table-sm table-hover small align-middle">
          <caption className="caption-top">{t("{v0} élève(s) avec des échéances non réglées, échues ou à venir dans l'horizon des relances.", { v0: liste.length })}</caption>
          <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Échéances non réglées")}</th><th className="text-end">{t("Échu")}</th><th className="text-end">{t("Reste")}</th><th>{t("Relances")}</th><th></th></tr></thead>
          <tbody>{liste.map((e) => (
            <tr key={e.inscription_id} className={e.exclusion ? "text-muted" : ""}>
              <td className="fw-semibold">{e.eleve}<div className="small fw-normal text-muted">{e.matricule}</div></td><td>{e.classe}</td>
              <td>{e.tranches.map((x) => <div key={x.echeance_id}>{t(x.libelle)} · {jour(x.date_limite)} · {fcfa(x.reste)} {x.echue && <span className="badge text-bg-danger">{t("échue")}</span>}</div>)}</td>
              <td className="text-end">{fcfa(e.echu || 0)}</td><td className="text-end">{fcfa(e.reste)}</td>
              <td>{e.exclusion ? <span className="badge text-bg-info">{t("Exclu : {v0}", { v0: t(TYPES_EXCLUSION[e.exclusion] || e.exclusion) })}</span> : <span className="badge text-bg-warning">{t("Concerné")}</span>}</td>
              <td>{!e.exclusion && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setExclure(e)}>{t("Exclure")}</button>}</td>
            </tr>))}
          </tbody></table></div>)}
      {exclure && <FormulaireExclusion eleve={exclure} onAnnuler={() => setExclure(null)}
        onValider={(f) => { setExclure(null); action("relances_exclure", { p_inscription: exclure.inscription_id, p_type: f.type, p_motif: f.motif, p_du: f.du, p_jusqu_au: f.jusqu_au || null }, () => t("Élève exclu des relances.")) }} />}
      <h2 className="h6">{t("Exclusions en cours")}</h2>
      {!actives.length ? <p className="small text-muted">{t("Aucune exclusion. Les moratoires accordés par courrier sont pris en compte automatiquement.")}</p> : (
        <table className="table table-sm small" style={{ maxWidth: 900 }}><thead><tr><th>{t("Élève")}</th><th>{t("Type")}</th><th>{t("Motif")}</th><th>{t("Du")}</th><th>{t("Au")}</th><th></th></tr></thead>
          <tbody>{actives.map((x) => (
            <tr key={x.id}><td>{liste?.find((e) => e.inscription_id === x.inscription_id)?.eleve || "—"}</td><td>{t(TYPES_EXCLUSION[x.type])}</td><td>{x.motif}</td><td>{jour(x.du)}</td><td>{x.jusqu_au ? jour(x.jusqu_au) : t("sans fin")}</td>
              <td><button type="button" className="btn btn-sm btn-outline-danger" disabled={enCours} onClick={() => action("relances_fin_exclusion", { p_id: x.id }, () => t("Exclusion terminée."))}>{t("Mettre fin")}</button></td></tr>))}
          </tbody></table>)}
    </>
  )
}

function FormulaireExclusion({ eleve, onAnnuler, onValider }) {
  const [f, setF] = useState({ type: "bourse", motif: "", du: aujourdhui(), jusqu_au: "" })
  return (
    <form className="card mb-3" style={{ maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); onValider(f) }}><div className="card-body">
      <h3 className="h6">{t("Exclure {v0} des relances", { v0: eleve.eleve })}</h3>
      <div className="row g-2">
        <div className="col-sm-6"><label className="form-label small mb-1">{t("Type")}</label>
          <select className="form-select form-select-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {["bourse", "exoneration", "accord", "paiement_attente"].map((k) => <option key={k} value={k}>{t(TYPES_EXCLUSION[k])}</option>)}</select></div>
        <div className="col-sm-3"><label className="form-label small mb-1">{t("Du")}</label><input type="date" className="form-control form-control-sm" value={f.du} required onChange={(e) => setF({ ...f, du: e.target.value })} /></div>
        <div className="col-sm-3"><label className="form-label small mb-1">{t("Au (facultatif)")}</label><input type="date" className="form-control form-control-sm" value={f.jusqu_au} min={f.du} onChange={(e) => setF({ ...f, jusqu_au: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small mb-1">{t("Motif")}</label><input className="form-control form-control-sm" maxLength={300} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></div>
      </div>
      <div className="mt-2 d-flex gap-2"><button type="submit" className="btn btn-sm btn-primary">{t("Exclure")}</button><button type="button" className="btn btn-sm btn-outline-secondary" onClick={onAnnuler}>{t("Annuler")}</button></div>
    </div></form>
  )
}

// --- 2. Envois, statuts, réponses ------------------------------------------------------------------------------------------
function Envois({ onMessage }) {
  const [filtre, setFiltre] = useState({ statut: "", categorie: "", texte: "" })
  const [d, erreur, recharger] = useDonnees(async () => {
    const [courriers, reponses] = await Promise.all([
      // seulement les relances et courriers finaux : les courriers administratifs (rubrique Courrier) n'ont pas de palier
      toutCharger(() => supabase.from("courriers_ecole").select("*").in("categorie", ["relance", "final"]).order("cree_le", { ascending: false })),
      toutCharger(() => supabase.from("courriers_ecole_reponses").select("*").order("envoye_le"))])
    return { courriers, reponses }
  }, [])
  const [ouvert, setOuvert] = useState(null)
  const visibles = useMemo(() => {
    if (!d) return []
    const q = filtre.texte.trim().toLowerCase()
    return d.courriers.filter((c) => (!filtre.statut || statutAffiche(c) === filtre.statut) && (!filtre.categorie || c.categorie === filtre.categorie)
      && (!q || `${c.reference} ${c.eleve} ${c.classe} ${c.objet || ""}`.toLowerCase().includes(q)))
  }, [d, filtre])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const compte = (s) => d.courriers.filter((c) => statutAffiche(c) === s).length
  async function annuler(c) {
    const motif = prompt(t("Motif de l'annulation :"))
    if (!motif) return
    try { await rpc("courrier_ecole_annuler", { p_id: c.id, p_motif: motif }); onMessage({ ok: t("Envoi annulé."), erreur: "" }); recharger() }
    catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-2">{Object.entries(STATUTS).map(([k, [l, c]]) => (
        <button key={k} type="button" className={`btn btn-sm ${filtre.statut === k ? `btn-${c}` : `btn-outline-${c}`}`} onClick={() => setFiltre({ ...filtre, statut: filtre.statut === k ? "" : k })}>
          {t(l)} <span className="badge text-bg-light">{compte(k)}</span></button>))}</div>
      <div className="row g-2 mb-2">
        <div className="col-sm-4 col-lg-3"><select className="form-select form-select-sm" value={filtre.categorie} onChange={(e) => setFiltre({ ...filtre, categorie: e.target.value })} aria-label={t("Catégorie")}>
          <option value="">{t("Relances et courriers finaux")}</option><option value="relance">{t("Relances")}</option><option value="final">{t("Courriers finaux")}</option></select></div>
        <div className="col-sm-8 col-lg-4"><input type="search" className="form-control form-control-sm" placeholder={t("Référence, élève, classe, objet…")} value={filtre.texte} onChange={(e) => setFiltre({ ...filtre, texte: e.target.value })} /></div>
      </div>
      <div className="table-responsive"><table className="table table-sm table-hover small align-middle">
        <thead className="table-light"><tr><th>{t("Référence")}</th><th>{t("Élève")}</th><th>{t("Courrier")}</th><th>{t("Prévu le")}</th><th>{t("Statut")}</th><th>{t("Réponses")}</th><th></th></tr></thead>
        <tbody>{visibles.map((c) => {
          const rep = d.reponses.filter((r) => r.courrier_id === c.id)
          return (
            <tr key={c.id}>
              <td className="text-nowrap"><code>{c.reference}</code></td><td>{c.eleve}<div className="text-muted">{c.classe}</div></td>
              <td>{c.categorie === "final" ? t("Courrier final") : (c.palier === null || c.palier === undefined ? t("Relance") : t("Relance J-{v0}", { v0: c.palier }))}{c.objet && <div className="text-muted text-truncate" style={{ maxWidth: 280 }}>{c.objet}</div>}</td>
              <td className="text-nowrap">{c.programme_pour ? jour(c.programme_pour) : "—"}{c.envoye_le && <div className="text-muted">{t("envoyé {v0}", { v0: dateHeure(c.envoye_le) })}</div>}</td>
              <td><Statut c={c} />{c.motif && <div className="text-muted">{c.motif}</div>}{c.erreur && <div className="text-danger">{c.erreur}</div>}</td>
              <td>{rep.length ? <span className="badge text-bg-info">{rep.length}</span> : ""}</td>
              <td className="text-nowrap">
                <button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => setOuvert(ouvert === c.id ? null : c.id)}>{ouvert === c.id ? t("Fermer") : t("Voir")}</button>
                {["programme", "a_valider"].includes(c.statut) && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => annuler(c)}>{t("Annuler")}</button>}
              </td>
            </tr>)
        })}
          {!visibles.length && <tr><td colSpan={7} className="text-muted">{t("Aucun courrier.")}</td></tr>}
        </tbody></table></div>
      {ouvert && <DetailCourrier c={d.courriers.find((x) => x.id === ouvert)} reponses={d.reponses.filter((r) => r.courrier_id === ouvert)} recharger={recharger} onMessage={onMessage} />}
    </>
  )
}

function DetailCourrier({ c, reponses, recharger, onMessage }) {
  const [edition, setEdition] = useState(null), [reponse, setReponse] = useState("")
  const [journal] = useDonnees(async () => verifier(await supabase.from("courriers_ecole_journal").select("*").eq("courrier_id", c.id).order("le")), [c.id])
  async function faire(nom, params, ok) {
    try { await rpc(nom, params); onMessage({ ok, erreur: "" }); setEdition(null); setReponse(""); recharger() } catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  return (
    <div className="card mb-3"><div className="card-body">
      <div className="d-flex flex-wrap justify-content-between gap-2"><h3 className="h6 mb-1">{c.objet || t("Texte généré au moment de l'envoi, d'après le palier J-{v0}.", { v0: c.palier })}</h3><Statut c={c} /></div>
      <div className="small text-muted mb-2">{c.reference} · {c.eleve} · {c.classe}{c.lu_le && ` · ${t("lu le {v0}", { v0: dateHeure(c.lu_le) })}`}{c.accuse_le && ` · ${t("accusé de réception le {v0}", { v0: dateHeure(c.accuse_le) })}`}</div>
      {c.corps && !edition && <div className="border rounded p-2 small mb-2" style={{ whiteSpace: "pre-wrap" }}>{c.corps}</div>}
      {c.statut === "programme" && !edition && (
        <button type="button" className="btn btn-sm btn-outline-secondary mb-2" onClick={() => setEdition({ objet: c.objet || "", corps: c.corps || "" })}>{t("Modifier le texte")}</button>)}
      {edition && (
        <div className="mb-2">
          <input className="form-control form-control-sm mb-1" maxLength={200} value={edition.objet} onChange={(e) => setEdition({ ...edition, objet: e.target.value })} aria-label={t("Objet")} />
          <textarea className="form-control form-control-sm mb-1" rows={6} maxLength={8000} value={edition.corps} onChange={(e) => setEdition({ ...edition, corps: e.target.value })} aria-label={t("Texte")} />
          <button type="button" className="btn btn-sm btn-primary me-2" onClick={() => faire("courrier_ecole_modifier", { p_id: c.id, p_objet: edition.objet, p_corps: edition.corps }, t("Texte modifié."))}>{t("Enregistrer")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEdition(null)}>{t("Annuler")}</button>
        </div>)}
      {reponses.length > 0 && <h4 className="h6 mt-2">{t("Échanges")}</h4>}
      {reponses.map((r) => (
        <div key={r.id} className={`small p-2 mb-1 rounded ${r.auteur === "parent" ? "bg-body-tertiary" : "border"}`}>
          <strong>{r.auteur === "parent" ? t("Parent") : r.auteur_nom}</strong> · {dateHeure(r.envoye_le)}<div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div></div>))}
      {c.statut === "envoye" && (
        <div className="mt-2"><textarea className="form-control form-control-sm mb-1" rows={2} maxLength={4000} placeholder={t("Répondre au parent…")} value={reponse} onChange={(e) => setReponse(e.target.value)} />
          <button type="button" className="btn btn-sm btn-primary" disabled={reponse.trim().length < 2} onClick={() => faire("courrier_ecole_repondre", { p_id: c.id, p_message: reponse }, t("Réponse envoyée."))}>{t("Envoyer la réponse")}</button></div>)}
      {journal?.length > 0 && (
        <details className="mt-2 small"><summary>{t("Journal de ce courrier")}</summary>
          <ul className="mb-0">{journal.map((j) => <li key={j.id}>{dateHeure(j.le)} — {t(ACTIONS_JOURNAL[j.action] || j.action)} · {j.acteur}</li>)}</ul></details>)}
    </div></div>
  )
}

// --- 3. Courrier final : rédaction, validation ----------------------------------------------------------------------------
function CourrierFinal({ config, onMessage }) {
  const { estAdmin, profil } = useSession()
  const [liste] = useDonnees(() => rpc("relances_insolvables", { p_date: aujourdhui() }), [])
  const [attente, , rechargerAttente] = useDonnees(async () => verifier(await supabase.from("courriers_ecole").select("*").eq("statut", "a_valider").eq("categorie", "final").order("cree_le")), [])
  const [choisis, setChoisis] = useState(new Set()), [f, setF] = useState({ objet: "", corps: "" }), [enCours, setEnCours] = useState(false)
  const peutValider = estAdmin || config.validateurs === "admin_comptable"
  const echus = (liste || []).filter((e) => Number(e.echu) > 0 && !e.exclusion)   // la base refuse les élèves à jour ou exclus
  async function creer(e) {
    e.preventDefault()
    if (!confirm(t("Créer ce courrier final pour {v0} élève(s) ? {v1}", { v0: choisis.size, v1: config.validation_requise ? t("Il sera envoyé après validation.") : t("Il sera envoyé immédiatement.") }))) return
    setEnCours(true)
    try {
      const r = await rpc("courrier_final_creer", { p: { inscriptions: [...choisis], objet: f.objet, corps: f.corps } })
      onMessage({ ok: r.statut === "a_valider" ? t("{v0} courrier(s) final(aux) en attente de validation.", { v0: r.crees }) : t("{v0} courrier(s) final(aux) envoyé(s).", { v0: r.crees }), erreur: "" })
      setChoisis(new Set()); setF({ objet: "", corps: "" }); rechargerAttente()
    } catch (err) { onMessage({ ok: "", erreur: err.message }) } finally { setEnCours(false) }
  }
  async function decider(ids, accepter) {
    const motif = accepter ? "" : prompt(t("Motif du refus :"))
    if (!accepter && !motif) return
    try { const n = await rpc("courrier_final_valider", { p_ids: ids, p_accepter: accepter, p_motif: motif }); onMessage({ ok: accepter ? t("{v0} courrier(s) validé(s) et envoyé(s).", { v0: n }) : t("{v0} courrier(s) refusé(s).", { v0: n }), erreur: "" }); rechargerAttente() }
    catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  const exemple = echus[0]
  return (
    <>
      <p className="small text-muted">{t("Le jour où une mesure est effectivement prise, rédigez le courrier final. {v0}", { v0: config.validation_requise
        ? t("Il doit être validé avant envoi ({v0}).", { v0: config.validateurs === "admin" ? t("par l'administration") : t("par l'administration ou un autre comptable") })
        : t("L'établissement a choisi de l'envoyer sans validation.") })}</p>
      {attente?.length > 0 && (
        <div className="card border-warning mb-3"><div className="card-body">
          <h2 className="h6">{t("En attente de validation ({v0})", { v0: attente.length })}</h2>
          {attente.map((c) => (
            <div key={c.id} className="border-bottom py-2 small">
              <div className="d-flex flex-wrap justify-content-between gap-2"><strong>{c.objet}</strong><span className="text-muted">{c.reference} · {c.eleve} · {date(c.cree_le)}</span></div>
              <div style={{ whiteSpace: "pre-wrap" }} className="my-1">{c.corps}</div>
              {peutValider && (estAdmin || c.cree_par !== profil?.id) && (
                <div className="d-flex gap-2"><button type="button" className="btn btn-sm btn-success" onClick={() => decider([c.id], true)}>{t("Valider et envoyer")}</button>
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => decider([c.id], false)}>{t("Refuser")}</button></div>)}
            </div>))}
        </div></div>)}
      <form onSubmit={creer} style={{ maxWidth: 980 }}>
        <h2 className="h6">{t("Rédiger un courrier final")}</h2>
        <fieldset className="mb-2"><legend className="small fw-semibold">{t("Élèves (échéances échues non réglées) : {v0} choisi(s)", { v0: choisis.size })}</legend>
          <div className="border rounded p-2 overflow-auto" style={{ maxHeight: 200 }}>
            {echus.map((e) => (
              <div className="form-check small" key={e.inscription_id}>
                <input className="form-check-input" type="checkbox" id={`fin-${e.inscription_id}`} checked={choisis.has(e.inscription_id)}
                  onChange={() => { const s = new Set(choisis); if (s.has(e.inscription_id)) s.delete(e.inscription_id); else s.add(e.inscription_id); setChoisis(s) }} />
                <label className="form-check-label" htmlFor={`fin-${e.inscription_id}`}>{e.eleve} · {e.classe} · {fcfa(e.echu)}</label>
              </div>))}
            {!echus.length && <span className="text-muted small">{t("Aucun élève avec une échéance échue non réglée.")}</span>}
          </div></fieldset>
        <input className="form-control mb-2" required minLength={3} maxLength={200} placeholder={t("Objet")} value={f.objet} onChange={(e) => setF({ ...f, objet: e.target.value })} />
        <textarea className="form-control mb-1" required minLength={20} maxLength={8000} rows={7} placeholder={t("Texte du courrier")} value={f.corps} onChange={(e) => setF({ ...f, corps: e.target.value })} />
        <p className="small text-muted">{t("Variables : {v0}", { v0: VARIABLES_FINAL.map((v) => `{${v}}`).join(" ") })}</p>
        {exemple && f.corps && <div className="border rounded p-2 small mb-2 bg-body-tertiary" style={{ whiteSpace: "pre-wrap" }}><strong>{t("Aperçu pour {v0} :", { v0: exemple.eleve })}</strong>{"\n"}
          {remplir(f.corps, { eleve: exemple.eleve, classe: exemple.classe, matricule: exemple.matricule, montant: Math.round(exemple.echu).toLocaleString("fr-FR").replace(/ /g, " ") })}</div>}
        <button type="submit" className="btn btn-danger" disabled={!choisis.size || enCours}>{config.validation_requise ? t("Soumettre à validation") : t("Envoyer le courrier final")}</button>
      </form>
    </>
  )
}

// --- 4. Réglages ----------------------------------------------------------------------------------------------------------
function Reglages({ config, recharger, onMessage }) {
  const { estAdmin } = useSession()
  const [actif, setActif] = useState(config.actif)
  const [paliers, setPaliers] = useState(() => trierPaliers(config.paliers))
  const [validation, setValidation] = useState({ validation_requise: config.validation_requise, validateurs: config.validateurs })
  const problemes = problemesPaliers(paliers)
  async function enregistrer(p, ok) {
    try { await rpc("relances_configurer", { p }); onMessage({ ok, erreur: "" }); recharger() } catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  const champ = (k, cle, v) => setPaliers(paliers.map((x, j) => (j === k ? { ...x, [cle]: v } : x)))
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="form-check form-switch mb-3">
        <input className="form-check-input" type="checkbox" role="switch" id="rel-actif" checked={actif}
          onChange={(e) => { setActif(e.target.checked); enregistrer({ actif: e.target.checked }, e.target.checked ? t("Envoi automatique activé : les relances partent chaque matin.") : t("Envoi automatique désactivé.")) }} />
        <label className="form-check-label" htmlFor="rel-actif">{t("Envoi automatique quotidien des relances (chaque matin)")}</label>
      </div>
      <h2 className="h6">{t("Paliers de relance")}</h2>
      <p className="small text-muted">{t("Variables : {v0}. Les messages doivent annoncer un contrôle et une mesure possible selon les règles de l'établissement, jamais un renvoi.", { v0: VARIABLES_RELANCE.map((v) => `{${v}}`).join(" ") })}</p>
      {paliers.map((x, k) => (
        <div className="card mb-2" key={k}><div className="card-body py-2">
          <div className="row g-2 align-items-end">
            <div className="col-3 col-md-2"><label className="form-label small mb-1">{t("Jours avant")}</label>
              <input type="number" min={0} max={60} className="form-control form-control-sm" value={x.jours} onChange={(e) => champ(k, "jours", e.target.value)} /></div>
            <div className="col-9 col-md-4"><label className="form-label small mb-1">{t("Nom du palier")}</label>
              <input className="form-control form-control-sm" maxLength={80} value={x.titre} onChange={(e) => champ(k, "titre", e.target.value)} /></div>
            <div className="col-md-5"><label className="form-label small mb-1">{t("Objet")}</label>
              <input className="form-control form-control-sm" maxLength={200} value={x.objet} onChange={(e) => champ(k, "objet", e.target.value)} /></div>
            <div className="col-md-1 text-end"><button type="button" className="btn btn-sm btn-outline-danger" aria-label={t("Retirer le palier")} onClick={() => setPaliers(paliers.filter((_, j) => j !== k))}>✕</button></div>
            <div className="col-12"><textarea className="form-control form-control-sm" rows={4} maxLength={4000} value={x.texte} onChange={(e) => champ(k, "texte", e.target.value)} aria-label={t("Texte")} /></div>
          </div>
        </div></div>))}
      {problemes.length > 0 && <div className="alert alert-warning small py-2">{problemes.map((p) => ({
        trop: t("10 paliers au plus."), doublon: t("Deux paliers ont le même nombre de jours."), jours: t("Jours : un nombre de 0 à 60."),
        texte: t("Chaque palier a un nom, un objet et un texte d'au moins 10 caractères."),
      }[p])).join(" ")}</div>}
      <div className="d-flex flex-wrap gap-2 mb-4">
        {paliers.length < 10 && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setPaliers([...paliers, { jours: "", titre: "", objet: "", texte: "" }])}>{t("Ajouter un palier")}</button>}
        <button type="button" className="btn btn-sm btn-primary" disabled={problemes.length > 0}
          onClick={() => enregistrer({ paliers: paliers.map((x) => ({ ...x, jours: Number(x.jours) })) }, t("Paliers enregistrés."))}>{t("Enregistrer les paliers")}</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { if (confirm(t("Rétablir les 8 paliers par défaut ? Vos textes seront remplacés."))) enregistrer({ paliers: "defaut" }, t("Paliers par défaut rétablis.")) }}>
          {t("Rétablir les paliers par défaut")}</button>
      </div>
      <h2 className="h6">{t("Validation du courrier final")}</h2>
      {!estAdmin && <p className="small text-muted">{t("Réglage réservé à l'administration.")}</p>}
      <div className="form-check"><input className="form-check-input" type="checkbox" id="rel-val" disabled={!estAdmin} checked={validation.validation_requise}
        onChange={(e) => setValidation({ ...validation, validation_requise: e.target.checked })} />
        <label className="form-check-label small" htmlFor="rel-val">{t("Le courrier final doit être validé avant envoi")}</label></div>
      <select className="form-select form-select-sm my-2" style={{ maxWidth: 420 }} disabled={!estAdmin || !validation.validation_requise} value={validation.validateurs}
        onChange={(e) => setValidation({ ...validation, validateurs: e.target.value })} aria-label={t("Qui valide")}>
        <option value="admin">{t("Validé par l'administration")}</option><option value="admin_comptable">{t("Validé par l'administration ou un autre comptable que l'auteur")}</option></select>
      {estAdmin && <button type="button" className="btn btn-sm btn-primary" onClick={() => enregistrer(validation, t("Règle de validation enregistrée."))}>{t("Enregistrer la règle de validation")}</button>}
    </div>
  )
}

// --- 5. Journal -----------------------------------------------------------------------------------------------------------
function Journal() {
  const [liste, erreur] = useDonnees(async () => verifier(await supabase.from("courriers_ecole_journal").select("*, courriers_ecole(reference, eleve)").order("le", { ascending: false }).limit(500)), [])
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <div className="table-responsive"><table className="table table-sm small">
      <thead className="table-light"><tr><th>{t("Date")}</th><th>{t("Action")}</th><th>{t("Courrier")}</th><th>{t("Par")}</th></tr></thead>
      <tbody>{liste.map((j) => (
        <tr key={j.id}><td className="text-nowrap">{dateHeure(j.le)}</td><td>{t(ACTIONS_JOURNAL[j.action] || j.action)}</td>
          <td>{j.courriers_ecole ? `${j.courriers_ecole.reference} · ${j.courriers_ecole.eleve}` : j.details?.nombre ? t("{v0} courrier(s)", { v0: j.details.nombre }) : "—"}</td><td>{j.acteur}</td></tr>))}
        {!liste.length && <tr><td colSpan={4} className="text-muted">{t("Aucune action enregistrée.")}</td></tr>}
      </tbody></table></div>
  )
}
