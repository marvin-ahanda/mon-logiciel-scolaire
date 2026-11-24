// Encaissements et reçus : recherche d'élève (nom, matricule, classe), dossier et encaissement, paiements en attente,
// historique filtrable avec export Excel / PDF.
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour, MODES, modePaiement } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, BoutonsExport, demanderMotif, EnTete, exporterTableau, Periode, useDroits } from "./commun.jsx"
import DossierEleve from "./DossierEleve.jsx"

const COLONNES_HISTO = [
  { cle: "date", libelle: "Date", type: "date" }, { cle: "numero", libelle: "Reçu", type: "texte" }, { cle: "eleve", libelle: "Élève", type: "texte" },
  { cle: "classe", libelle: "Classe", type: "texte" }, { cle: "rubrique", libelle: "Rubrique", type: "texte" }, { cle: "mode", libelle: "Mode", type: "mode" },
  { cle: "reference", libelle: "Référence", type: "texte" }, { cle: "agent", libelle: "Agent", type: "texte" }, { cle: "montant", libelle: "Montant", type: "montant" }]

function Recherche({ onOuvrir }) {
  const [q, setQ] = useState(""), [classe, setClasse] = useState(""), [res, setRes] = useState(null), [erreur, setErreur] = useState("")
  const [classes] = useDonnees(() => supabase.from("classes").select("id, libelle, ordre").order("ordre").order("libelle").then(verifier), [])
  async function chercher(ev) {
    ev?.preventDefault(); setErreur("")
    try { setRes(await rpc("finance_rechercher", { p_q: q, p_classe: classe || null })) } catch (e) { setErreur(e.message) }
  }
  return (
    <section className="card mb-3"><div className="card-body">
      <form className="row g-2 align-items-end" onSubmit={chercher}>
        <div className="col-md-6"><label className="form-label small" htmlFor="rech-q">{t("Rechercher un élève (nom, prénom ou matricule)")}</label>
          <input id="rech-q" className="form-control" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ex. MBALLA ou PF1")} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="rech-cl">{t("ou une classe")}</label>
          <select id="rech-cl" className="form-select" value={classe} onChange={(e) => setClasse(e.target.value)}>
            <option value="">{t("Toutes les classes")}</option>{(classes || []).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-md-2"><button className="btn btn-primary w-100">{t("Rechercher")}</button></div>
      </form>
      <Alerte>{erreur}</Alerte>
      {res && (res.length ? (
        <div className="table-responsive mt-3"><table className="table table-sm table-hover align-middle mb-0">
          <thead><tr><th>{t("Élève")}</th><th>{t("Matricule")}</th><th>{t("Classe")}</th><th className="text-end">{t("Reste pension")}</th><th className="text-end">{t("Reste autres frais")}</th><th /></tr></thead>
          <tbody>{res.map((e) => (
            <tr key={e.inscription_id} role="button" onClick={() => onOuvrir(e.inscription_id)}>
              <td className="fw-semibold">{e.nom} {e.prenom}</td><td>{e.matricule || "—"}</td><td>{e.classe}</td>
              <td className="text-end">{fcfa(e.reste_pension)}</td><td className="text-end">{fcfa(e.reste_autres)}</td>
              <td className="text-end"><button className="btn btn-sm btn-success">{t("Ouvrir")}</button></td></tr>))}</tbody>
        </table></div>) : <p className="text-muted mt-3 mb-0">{t("Aucun élève trouvé.")}</p>)}
    </div></section>
  )
}

function Attentes({ onOuvrir }) {
  const [d, erreur, rafraichir] = useDonnees(() => rpc("finance_attentes"), [])
  const droits = useDroits(), [msg, setMsg] = useState({})
  async function traiter(a, confirmer) {
    const motif = confirmer ? "" : demanderMotif(t("Motif du rejet (transaction introuvable, chèque impayé…) ?"))
    if (!confirmer && !motif) return
    if (confirmer && !confirm(t("Confirmer la réception de {v0} ({v1}) ? Le reçu sera émis et le montant compté.", { v0: fcfa(a.montant), v1: modePaiement(a.mode) }))) return
    try {
      const r = await rpc("finance_attente_traiter", { p_id: a.id, p_confirmer: confirmer, p_motif: motif, p_date: null })
      setMsg({ ok: confirmer ? t("Paiement confirmé : reçu n° {v0}.", { v0: r.numero }) : t("Paiement rejeté : il n'est pas compté.") }); rafraichir()
    } catch (e) { setMsg({ erreur: e.message }) }
  }
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <section className="card mb-3"><div className="card-body">
      <h2 className="h6">{t("Paiements en attente de confirmation")}</h2>
      <p className="small text-muted">{t("Un paiement en attente n'est compté ni dans les encaissements, ni dans le solde de l'élève, ni en trésorerie avant sa confirmation.")}</p>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead><tr><th>{t("Saisi le")}</th><th>{t("Élève")}</th><th>{t("Rubrique")}</th><th className="text-end">{t("Montant")}</th><th>{t("Mode")}</th><th>{t("Référence")}</th><th>{t("Statut")}</th><th /></tr></thead>
        <tbody>{d.map((a) => (
          <tr key={a.id} className={a.statut !== "en_attente" ? "text-muted" : undefined}>
            <td className="small">{jour(a.cree_le)}</td><td><button className="btn btn-link btn-sm p-0" onClick={() => onOuvrir(a.inscription_id)}>{a.eleve}</button> <span className="small text-muted">{a.classe}</span></td>
            <td className="small">{t(a.rubrique)}</td><td className="text-end">{fcfa(a.montant)}</td><td className="small">{modePaiement(a.mode)}</td><td className="small">{a.reference || "—"}</td>
            <td>{a.statut === "en_attente" ? <span className="badge text-bg-warning">{t("En attente")}</span> : a.statut === "confirme" ? <span className="badge text-bg-success">{t("Confirmé")}</span>
              : <span className="badge text-bg-danger" title={a.motif}>{t("Rejeté")}</span>}</td>
            <td className="text-end text-nowrap">{a.statut === "en_attente" && droits.a("caisse") && <>
              <button className="btn btn-sm btn-success me-1" onClick={() => traiter(a, true)}>{t("Confirmer")}</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => traiter(a, false)}>{t("Rejeter")}</button></>}</td></tr>))}
          {!d.length && <tr><td colSpan={8} className="text-muted">{t("Aucun paiement en attente.")}</td></tr>}</tbody>
      </table></div>
    </div></section>
  )
}

function Historique({ onOuvrir }) {
  const session = useSession()
  const [periode, setPeriode] = useState({ debut: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), fin: aujourdhui() })
  const [mode, setMode] = useState("")
  const [d, erreur] = useDonnees(() => rpc("finance_encaissements", { p: { debut: periode.debut, fin: periode.fin, mode } }), [periode.debut, periode.fin, mode])
  const lignes = (d || []).map((x) => ({ ...x, numero: `${String(x.numero).padStart(5, "0")}${x.contre_ecriture ? ` (${t("annulation")})` : x.annule ? ` (${t("annulé")})` : ""}`, rubrique: t(x.rubrique) }))
  const total = lignes.reduce((s, x) => s + Number(x.montant), 0)
  const colonnes = COLONNES_HISTO.map((c) => ({ ...c, libelle: t(c.libelle) }))
  return (
    <section className="card mb-3"><div className="card-body">
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-2">
        <div className="d-flex flex-wrap gap-2 align-items-end"><Periode valeur={periode} onChange={setPeriode} />
          <select className="form-select form-select-sm" style={{ width: "auto" }} aria-label={t("Mode")} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">{t("Tous les modes")}</option>{Object.keys(MODES).map((k) => <option key={k} value={k}>{modePaiement(k)}</option>)}</select></div>
        <BoutonsExport onExporter={(format) => exporterTableau({ format, titre: t("Journal des encaissements"), sousTitre: `${jour(periode.debut)} → ${jour(periode.fin)}`,
          colonnes, lignes, totaux: { montant: total }, etablissement: session.etablissement, logoUrl: session.logoUrl })} />
      </div>
      <Alerte>{erreur}</Alerte>
      {!d && !erreur && <Chargement />}
      {d && <div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead><tr>{colonnes.map((c) => <th key={c.cle} className={c.type === "montant" ? "text-end" : undefined}>{c.libelle}</th>)}</tr></thead>
        <tbody>{lignes.map((x) => (
          <tr key={x.id} className={x.contre_ecriture || x.annule ? "text-muted" : undefined}>
            <td>{jour(x.date)}</td><td className="text-nowrap">{x.numero}</td>
            <td><button className="btn btn-link btn-sm p-0" onClick={() => onOuvrir(x.inscription_id)}>{x.eleve}</button></td><td>{x.classe}</td>
            <td className="small">{x.rubrique}</td><td className="small">{modePaiement(x.mode)}</td><td className="small">{x.reference || "—"}</td><td className="small">{x.agent || "—"}</td>
            <td className="text-end">{fcfa(x.montant)}</td></tr>))}
          {!lignes.length && <tr><td colSpan={9} className="text-muted">{t("Aucun encaissement sur la période.")}</td></tr>}</tbody>
        <tfoot><tr><th colSpan={8}>{t("Total net de la période")}</th><th className="text-end">{fcfa(total)}</th></tr></tfoot>
      </table></div>}
    </div></section>
  )
}

export default function Encaissements() {
  const [params, setParams] = useSearchParams()
  const vue = params.get("vue") || "caisse"
  const [ouvert, setOuvert] = useState(null), [version, setVersion] = useState(0)
  const VUES = [["caisse", "Caisse"], ["attentes", "Paiements en attente"], ["historique", "Historique"]]
  return (
    <>
      <EnTete titre={t("Encaissements et reçus")} sousTitre={t("Chaque reçu porte un numéro unique et un QR code de vérification ; une erreur s'annule par contre-écriture, jamais par suppression.")} />
      <ul className="nav nav-pills mb-3 no-print">{VUES.map(([k, lib]) => (
        <li className="nav-item" key={k}><button className={`nav-link${vue === k ? " active" : ""}`} onClick={() => setParams(k === "caisse" ? {} : { vue: k })}>{t(lib)}</button></li>))}</ul>
      {vue === "caisse" && <Recherche onOuvrir={setOuvert} />}
      {vue === "attentes" && <Attentes key={version} onOuvrir={setOuvert} />}
      {vue === "historique" && <Historique key={version} onOuvrir={setOuvert} />}
      {ouvert && <DossierEleve inscriptionId={ouvert} onFermer={() => setOuvert(null)} onMaj={() => setVersion((v) => v + 1)} />}
    </>
  )
}
