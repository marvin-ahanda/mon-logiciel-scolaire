// Courrier des parents (personnel) : courriers à traiter, archives, lecture, réponse, décision de moratoire.
// Accès : administration = tous les courriers ; surveillant général = demandes d'absence ; service financier = moratoires.
import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import Lettre from "../composants/Lettre.jsx"
import { Reponse } from "./Parent.jsx"
import { OBJETS, libelleObjet } from "../lib/courrier.js"
import { dateHeure } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

export const signalerCourrier = () => window.dispatchEvent(new Event("courrier:maj"))

function Detail({ c, etablissement, onRepondu }) {
  const { profil } = useSession()
  const [message, setMessage] = useState(""), [decision, setDecision] = useState(""), [jusqu, setJusqu] = useState(c.details?.jusqu_au || "")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  const peutDecider = c.objet === "moratoire" && ["admin", "comptable"].includes(profil?.role)
  async function repondre(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      await rpc("courrier_repondre", { p_id: c.id, p_message: message, p_moratoire_accorde: peutDecider && decision ? decision === "oui" : null,
        p_jusqu_au: peutDecider && decision === "oui" ? jusqu || null : null })
      setMessage(""); setDecision(""); onRepondu()
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  function imprimer() {
    document.body.classList.add("impression-ciblee")
    const fin = () => { document.body.classList.remove("impression-ciblee"); window.removeEventListener("afterprint", fin) }
    window.addEventListener("afterprint", fin); window.print()
  }
  return (
    <div className="detail-courrier">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2 no-print">
        <div><span className="badge text-bg-primary me-1">{libelleObjet(c.objet)}</span><span className="small text-muted">{t("Réf. {v0} · reçu le {v1}", { v0: c.reference, v1: dateHeure(c.envoye_le) })}</span></div>
        <button className="btn btn-sm btn-outline-secondary" onClick={imprimer}>{t("Imprimer la lettre")}</button>
      </div>
      <div className="zone-impression"><Lettre courrier={c} etablissement={etablissement} /></div>
      <h3 className="h6 mt-3 no-print">{t("Réponses ({v0})", { v0: c.reponses.length })}</h3>
      {c.reponses.map((r) => <Reponse key={r.id} r={r} />)}
      <form className="card mt-3 no-print repondre-courrier" onSubmit={repondre}><div className="card-body">
        <h3 className="h6">{t("Répondre")}</h3>
        <Alerte>{erreur}</Alerte>
        {peutDecider && <div className="mb-2">
          <div className="small fw-semibold mb-1">{t("Décision sur le moratoire")}</div>
          <div className="d-flex flex-wrap align-items-center gap-3">
            {[["oui", t("Accorder")], ["non", t("Refuser")], ["", t("Pas encore de décision")]].map(([v, l]) => (
              <div className="form-check form-check-inline" key={v || "aucune"}>
                <input className="form-check-input" type="radio" name={`dec-${c.id}`} id={`dec-${c.id}-${v || "aucune"}`} checked={decision === v} onChange={() => setDecision(v)} />
                <label className="form-check-label small" htmlFor={`dec-${c.id}-${v || "aucune"}`}>{l}</label></div>))}
            {decision === "oui" && <span className="d-flex align-items-center gap-1 small"><label htmlFor={`jq-${c.id}`}>{t("jusqu'au")}</label>
              <input id={`jq-${c.id}`} type="date" className="form-control form-control-sm" style={{ width: 170 }} value={jusqu} onChange={(e) => setJusqu(e.target.value)} required /></span>}
          </div></div>}
        <textarea className="form-control mb-2" rows={4} maxLength={8000} required aria-label={t("Votre réponse")} placeholder={t("Votre réponse au parent…")} value={message} onChange={(e) => setMessage(e.target.value)} />
        <button className="btn btn-primary" disabled={envoi}>{envoi ? t("Envoi…") : t("Envoyer la réponse")}</button>
        <span className="small text-muted ms-2">{t("Le parent est prévenu dans son espace.")}</span>
      </div></form>
    </div>
  )
}

export default function Courrier() {
  const { etablissement } = useSession()
  const [liste, erreur, recharger] = useDonnees(() => rpc("courrier_liste"), [])
  const [vue, setVue] = useState("a_traiter"), [ouvert, setOuvert] = useState(null)
  const [objet, setObjet] = useState(""), [q, setQ] = useState(""), [statut, setStatut] = useState("")
  useEffect(() => { const f = () => recharger(); window.addEventListener("courrier:maj", f); return () => window.removeEventListener("courrier:maj", f) }, [recharger])
  const lignes = useMemo(() => (liste || []).filter((c) => (vue === "archives" || (c.destinataire && !c.reponses.length))
    && (!objet || c.objet === objet) && (!statut || (statut === "repondu" ? c.reponses.length > 0 : !c.reponses.length))
    && (!q.trim() || `${c.reference} ${c.eleve} ${c.classe} ${c.parent_nom} ${c.precision_objet}`.toLowerCase().includes(q.trim().toLowerCase()))), [liste, vue, objet, statut, q])
  if (!liste) return <><h1 className="h3 mb-3">{t("Courrier")}</h1><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const c = liste.find((x) => x.id === ouvert)
  async function ouvrir(x) {
    setOuvert(x.id)
    if (!x.lu) { await rpc("courrier_marquer_lu", { p_id: x.id }).catch(() => {}); recharger(); signalerCourrier() }
  }
  const aTraiter = liste.filter((x) => x.destinataire && !x.reponses.length).length
  return (
    <>
      <h1 className="h3 mb-1 no-print">{t("Courrier")}</h1>
      <p className="text-muted small no-print">{t("Courriers adressés par les parents à l'établissement, archivés et numérotés. Chacun est transmis au service concerné : réclamations, audiences et suggestions à l'administration ; moratoires à l'administration et au service financier ; demandes d'absence aux surveillants généraux.")}</p>
      <ul className="nav nav-tabs mb-3 no-print">
        <li className="nav-item"><button className={`nav-link${vue === "a_traiter" ? " active" : ""}`} onClick={() => setVue("a_traiter")}>{t("À traiter")}
          {aTraiter > 0 && <span className="badge text-bg-danger ms-1">{aTraiter}</span>}</button></li>
        <li className="nav-item"><button className={`nav-link${vue === "archives" ? " active" : ""}`} onClick={() => setVue("archives")}>{t("Tous les courriers (archives)")}</button></li>
      </ul>
      {vue === "archives" && <div className="d-flex flex-wrap gap-2 mb-3 no-print">
        <select className="form-select form-select-sm" style={{ maxWidth: 280 }} aria-label={t("Objet")} value={objet} onChange={(e) => setObjet(e.target.value)}>
          <option value="">{t("Tous les objets")}</option>{OBJETS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
        <select className="form-select form-select-sm" style={{ maxWidth: 200 }} aria-label={t("Statut")} value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">{t("Tous")}</option><option value="attente">{t("En attente de réponse")}</option><option value="repondu">{t("Répondus")}</option></select>
        <input className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder={t("Rechercher (élève, parent, référence)")} aria-label={t("Rechercher")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>}
      <div className="row g-3">
        <div className={`col-lg-5 no-print ${c ? "d-none d-lg-block" : ""}`}>
          <div className="list-group liste-courriers">{lignes.map((x) => (
            <button key={x.id} type="button" className={`list-group-item list-group-item-action${ouvert === x.id ? " active" : ""}`} onClick={() => ouvrir(x)} data-reference={x.reference}>
              <div className="d-flex justify-content-between gap-2"><span className={x.lu ? "" : "fw-bold"}>{libelleObjet(x.objet)}</span>
                <span className="small text-nowrap">{dateHeure(x.envoye_le)}</span></div>
              <div className="small">{x.eleve} · {x.classe} — {x.parent_nom}</div>
              <div className="small">{x.reference} · {x.reponses.length ? <span className="badge text-bg-success">{t("Répondu")}</span> : <span className="badge text-bg-warning">{t("En attente de réponse")}</span>}
                {!x.lu && <span className="badge text-bg-danger ms-1">{t("Nouveau")}</span>}</div>
            </button>))}
            {!lignes.length && <div className="text-muted small p-3">{vue === "a_traiter" ? t("Aucun courrier à traiter.") : t("Aucun courrier.")}</div>}</div>
        </div>
        <div className="col-lg-7">
          {c ? <><button className="btn btn-link btn-sm px-0 d-lg-none no-print" onClick={() => setOuvert(null)}>{t("← Retour à la liste")}</button>
                 <Detail key={c.id} c={c} etablissement={etablissement} onRepondu={() => { recharger(); signalerCourrier() }} /></>
             : <div className="text-muted small p-4 border rounded no-print">{t("Choisissez un courrier pour le lire et y répondre.")}</div>}
        </div>
      </div>
    </>
  )
}
