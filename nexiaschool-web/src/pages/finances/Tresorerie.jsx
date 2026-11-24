// Trésorerie et banques : comptes (caisse, banque, MTN MoMo, Orange Money…), soldes recalculés à partir des mouvements,
// journal par compte, virements internes, clôture journalière avec écart justifié, rapprochement d'un relevé importé.
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour, MODES, modePaiement } from "../../lib/financePdf.js"
import { lireReleve } from "../../lib/releve.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, BoutonsExport, EnTete, exporterTableau, Modale, Periode, useDroits } from "./commun.jsx"

const TYPES = { caisse: "Caisse", banque: "Banque", mtn_momo: "MTN Mobile Money", orange_money: "Orange Money", autre: "Autre" }
const NATURES = { encaissement: "Encaissement", annulation_encaissement: "Annulation d'encaissement", depense: "Dépense", annulation_depense: "Annulation de dépense",
  virement_sortant: "Virement sortant", virement_entrant: "Virement entrant" }

function FormCompte({ compte, onFermer, onFait }) {
  const [c, setC] = useState(compte || { libelle: "", type: "caisse", numero: "", modes: ["especes"], solde_initial: 0, date_solde_initial: aujourdhui(), par_defaut: false, actif: true })
  const [erreur, setErreur] = useState("")
  async function enregistrer(ev) {
    ev.preventDefault()
    try { await rpc("finance_compte_enregistrer", { p: { ...c, solde_initial: Math.round(Number(c.solde_initial || 0)) } }); onFait(t("Compte enregistré.")) } catch (e) { setErreur(e.message) }
  }
  const basculer = (m) => setC({ ...c, modes: c.modes.includes(m) ? c.modes.filter((x) => x !== m) : [...c.modes, m] })
  return (
    <Modale titre={compte ? t("Modifier « {v0} »", { v0: compte.libelle }) : t("Nouveau compte de trésorerie")} onFermer={onFermer}>
      <form onSubmit={enregistrer} className="row g-2">
        <Alerte>{erreur}</Alerte>
        <div className="col-md-6"><label className="form-label small" htmlFor="cpt-lib">{t("Libellé")}</label>
          <input id="cpt-lib" className="form-control" required maxLength={80} placeholder={t("ex. Caisse principale, Banque Atlantique")} value={c.libelle} onChange={(e) => setC({ ...c, libelle: e.target.value })} /></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="cpt-type">{t("Type")}</label>
          <select id="cpt-type" className="form-select" value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="cpt-num">{t("N° de compte ou de téléphone (facultatif)")}</label>
          <input id="cpt-num" className="form-control" maxLength={60} value={c.numero} onChange={(e) => setC({ ...c, numero: e.target.value })} /></div>
        <div className="col-md-3"><label className="form-label small" htmlFor="cpt-si">{t("Solde initial")}</label>
          <input id="cpt-si" className="form-control" type="number" value={c.solde_initial} onChange={(e) => setC({ ...c, solde_initial: e.target.value })} /></div>
        <div className="col-md-3"><label className="form-label small" htmlFor="cpt-dsi">{t("au")}</label>
          <input id="cpt-dsi" className="form-control" type="date" max={aujourdhui()} value={c.date_solde_initial} onChange={(e) => setC({ ...c, date_solde_initial: e.target.value })} /></div>
        <fieldset className="col-12"><legend className="form-label small mb-1">{t("Modes de paiement encaissés par défaut sur ce compte")}</legend>
          <div className="d-flex flex-wrap gap-3">{Object.keys(MODES).map((m) => (
            <div className="form-check" key={m}><input className="form-check-input" type="checkbox" id={`cpt-m-${m}`} checked={c.modes.includes(m)} onChange={() => basculer(m)} />
              <label className="form-check-label small" htmlFor={`cpt-m-${m}`}>{modePaiement(m)}</label></div>))}</div></fieldset>
        <div className="col-12 form-check ms-2"><input id="cpt-def" type="checkbox" className="form-check-input" checked={c.par_defaut} onChange={(e) => setC({ ...c, par_defaut: e.target.checked })} />
          <label className="form-check-label small" htmlFor="cpt-def">{t("Compte prioritaire quand plusieurs comptes acceptent le même mode")}</label></div>
        {compte && <div className="col-12 form-check ms-2"><input id="cpt-act" type="checkbox" className="form-check-input" checked={c.actif} onChange={(e) => setC({ ...c, actif: e.target.checked })} />
          <label className="form-check-label small" htmlFor="cpt-act">{t("Actif")}</label></div>}
        <div className="col-12"><button className="btn btn-primary">{t("Enregistrer")}</button></div>
      </form>
    </Modale>
  )
}

function Virement({ comptes, onFermer, onFait }) {
  const actifs = comptes.filter((c) => c.actif)
  const [v, setV] = useState({ compte_source: actifs[0]?.id || "", compte_destination: actifs[1]?.id || "", montant: "", date: aujourdhui(), motif: "", reference: "" }), [erreur, setErreur] = useState("")
  async function envoyer(ev) {
    ev.preventDefault()
    try { await rpc("finance_virement", { p: { ...v, montant: Math.round(Number(v.montant)) } }); onFait(t("Virement enregistré (ni recette ni dépense).")) } catch (e) { setErreur(e.message) }
  }
  return (
    <Modale titre={t("Virement entre comptes")} onFermer={onFermer}>
      <form onSubmit={envoyer} className="row g-2">
        <Alerte>{erreur}</Alerte>
        <p className="small text-muted mb-1">{t("Un virement interne déplace de l'argent d'un compte à l'autre : il n'est compté ni comme recette, ni comme dépense.")}</p>
        {[["compte_source", "Depuis"], ["compte_destination", "Vers"]].map(([k, lib]) => (
          <div className="col-md-6" key={k}><label className="form-label small" htmlFor={`vir-${k}`}>{t(lib)}</label>
            <select id={`vir-${k}`} className="form-select" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })}>
              {actifs.map((c) => <option key={c.id} value={c.id}>{c.libelle} ({fcfa(c.solde)})</option>)}</select></div>))}
        <div className="col-md-4"><label className="form-label small" htmlFor="vir-mt">{t("Montant (FCFA)")}</label>
          <input id="vir-mt" className="form-control" type="number" min={1} required value={v.montant} onChange={(e) => setV({ ...v, montant: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="vir-date">{t("Date")}</label>
          <input id="vir-date" className="form-control" type="date" max={aujourdhui()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="vir-ref">{t("Référence")}</label>
          <input id="vir-ref" className="form-control" maxLength={80} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small" htmlFor="vir-motif">{t("Motif")}</label>
          <input id="vir-motif" className="form-control" maxLength={200} placeholder={t("ex. versement de la recette en banque")} value={v.motif} onChange={(e) => setV({ ...v, motif: e.target.value })} /></div>
        <div className="col-12"><button className="btn btn-primary" disabled={actifs.length < 2}>{t("Enregistrer le virement")}</button></div>
      </form>
    </Modale>
  )
}

function Cloture({ compte, onFermer, onFait }) {
  const [date, setDate] = useState(aujourdhui()), [constate, setConstate] = useState(""), [justification, setJustification] = useState(""), [erreur, setErreur] = useState("")
  const [theo] = useDonnees(() => rpc("finance_mouvements", { p_compte: compte.id, p_debut: date, p_fin: date }).then((r) => r.solde_fin), [date])
  const ecart = constate === "" || theo == null ? null : Math.round(Number(constate)) - theo
  async function cloturer(ev) {
    ev.preventDefault()
    if (!confirm(t("La clôture est définitive : plus aucune opération ne pourra être datée de ce jour ou d'avant sur ce compte. Continuer ?"))) return
    try {
      const r = await rpc("finance_cloturer", { p: { compte_id: compte.id, date, solde_constate: Math.round(Number(constate)), justification } })
      onFait(r.ecart ? t("Journée clôturée avec un écart de {v0}.", { v0: fcfa(r.ecart) }) : t("Journée clôturée sans écart."))
    } catch (e) { setErreur(e.message) }
  }
  return (
    <Modale titre={t("Clôture journalière : {v0}", { v0: compte.libelle })} onFermer={onFermer}>
      <form onSubmit={cloturer} className="row g-2">
        <Alerte>{erreur}</Alerte>
        <div className="col-md-4"><label className="form-label small" htmlFor="clo-date">{t("Journée")}</label>
          <input id="clo-date" type="date" className="form-control" max={aujourdhui()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="col-md-4"><div className="form-label small">{t("Solde théorique")}</div><div className="fs-5 fw-semibold">{theo == null ? "…" : fcfa(theo)}</div></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="clo-cst">{t("Solde constaté (comptage)")}</label>
          <input id="clo-cst" type="number" required className="form-control" value={constate} onChange={(e) => setConstate(e.target.value)} /></div>
        {ecart !== null && <div className={`col-12 alert py-2 mb-0 ${ecart === 0 ? "alert-success" : "alert-warning"}`}>{ecart === 0 ? t("Aucun écart.") : t("Écart : {v0}", { v0: fcfa(ecart) })}</div>}
        <div className="col-12"><label className="form-label small" htmlFor="clo-just">{t("Justification de l'écart")}{ecart ? " *" : ""}</label>
          <textarea id="clo-just" className="form-control" rows={2} maxLength={500} required={!!ecart} value={justification} onChange={(e) => setJustification(e.target.value)} /></div>
        <div className="col-12"><button className="btn btn-primary">{t("Clôturer la journée")}</button></div>
      </form>
    </Modale>
  )
}

function Rapprochement({ compte, onFermer }) {
  const [d, erreur, rafraichir] = useDonnees(() => rpc("finance_rapprochement", { p_compte: compte.id }), [compte.id])
  const [msg, setMsg] = useState({})
  async function importer(ev) {
    const f = ev.target.files?.[0]; ev.target.value = ""
    if (!f) return
    try {
      if (f.size > 2 * 1024 * 1024) throw new Error(t("Fichier trop lourd (2 Mo au plus)."))
      const { lignes, erreurs } = lireReleve(await f.text())
      const r = await rpc("finance_releve_importer", { p_compte: compte.id, p_lignes: lignes })
      setMsg({ ok: t("{v0} ligne(s) importée(s), {v1} déjà présente(s), {v2} illisible(s).", { v0: r.importees, v1: r.doublons, v2: r.erreurs + erreurs.length }) }); rafraichir()
    } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function rapprocher(ligne, mouvement) {
    try { await rpc("finance_rapprocher", { p_ligne: ligne.id, p_mouvement: mouvement }); setMsg({ ok: mouvement ? t("Rapprochement confirmé.") : t("Rapprochement annulé.") }); rafraichir() }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  return (
    <Modale titre={t("Rapprochement : {v0}", { v0: compte.libelle })} onFermer={onFermer} large>
      <p className="small text-muted">{t("Importez le relevé (CSV exporté depuis la banque ou l'opérateur mobile : colonnes Date, Libellé, Montant ou Débit / Crédit). NexIA propose les mouvements de même montant à ± 7 jours ; rien n'est rapproché sans votre confirmation.")}</p>
      <input type="file" accept=".csv,text/csv" className="form-control mb-2" aria-label={t("Relevé CSV")} onChange={importer} />
      <Alerte>{erreur}</Alerte><Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      {!d && !erreur && <Chargement />}
      {d && <>
        <p className="small">{t("{v0} mouvement(s) NexIA non rapproché(s) sur ce compte.", { v0: d.mouvements_non_rapproches })}</p>
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Date")}</th><th>{t("Libellé du relevé")}</th><th className="text-end">{t("Montant")}</th><th>{t("Correspondance")}</th></tr></thead>
          <tbody>{d.lignes.map((l) => (
            <tr key={l.id} className={l.mouvement_id ? "table-success" : undefined}>
              <td className="small">{jour(l.date)}</td><td className="small">{l.libelle}{l.reference && <span className="text-muted"> · {l.reference}</span>}</td>
              <td className={`text-end${l.montant < 0 ? " text-danger" : ""}`}>{fcfa(l.montant)}</td>
              <td>{l.mouvement_id ? <>{t("Rapprochée")} <button className="btn btn-link btn-sm p-0 ms-1" onClick={() => rapprocher(l, null)}>{t("défaire")}</button></>
                : l.suggestions?.length ? l.suggestions.slice(0, 3).map((s) => (
                  <button key={s.id} className="btn btn-sm btn-outline-success me-1 mb-1" onClick={() => rapprocher(l, s.id)}>{t("Confirmer : {v0} ({v1})", { v0: s.libelle, v1: jour(s.date) })}</button>))
                : <span className="small text-muted">{t("Aucun mouvement correspondant : opération à enregistrer (frais bancaires, dépôt…) ou à vérifier.")}</span>}</td></tr>))}
            {!d.lignes.length && <tr><td colSpan={4} className="text-muted">{t("Aucun relevé importé.")}</td></tr>}</tbody>
        </table></div></>}
    </Modale>
  )
}

function Journal({ comptes }) {
  const session = useSession()
  const [compte, setCompte] = useState(comptes[0]?.id || ""), [periode, setPeriode] = useState({ debut: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), fin: aujourdhui() })
  const [d, erreur] = useDonnees(() => (compte ? rpc("finance_mouvements", { p_compte: compte, p_debut: periode.debut, p_fin: periode.fin }) : Promise.resolve(null)), [compte, periode.debut, periode.fin])
  const lib = comptes.find((c) => c.id === compte)?.libelle || ""
  const lignes = (d?.mouvements || []).map((m) => ({ ...m, nature_lib: t(NATURES[m.nature]), entree: m.montant > 0 ? m.montant : null, sortie: m.montant < 0 ? -m.montant : null }))
  const colonnes = [{ cle: "date", libelle: t("Date"), type: "date" }, { cle: "nature_lib", libelle: t("Nature"), type: "texte" }, { cle: "libelle", libelle: t("Opération"), type: "texte" },
    { cle: "entree", libelle: t("Entrée"), type: "montant" }, { cle: "sortie", libelle: t("Sortie"), type: "montant" }]
  return (
    <section className="card"><div className="card-body">
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-2">
        <div className="d-flex flex-wrap gap-2 align-items-end">
          <div><label className="form-label small mb-0" htmlFor="jr-cpt">{t("Compte")}</label>
            <select id="jr-cpt" className="form-select form-select-sm" value={compte} onChange={(e) => setCompte(e.target.value)}>{comptes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
          <Periode valeur={periode} onChange={setPeriode} /></div>
        {d && <BoutonsExport onExporter={(format) => exporterTableau({ format, titre: t("Mouvements : {v0}", { v0: lib }), sousTitre: `${jour(periode.debut)} → ${jour(periode.fin)}`,
          colonnes, lignes, totaux: { entree: lignes.reduce((s, x) => s + (x.entree || 0), 0), sortie: lignes.reduce((s, x) => s + (x.sortie || 0), 0) },
          etablissement: session.etablissement, logoUrl: session.logoUrl })} />}
      </div>
      <Alerte>{erreur}</Alerte>
      {d && <div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead><tr><th>{t("Date")}</th><th>{t("Nature")}</th><th>{t("Opération")}</th><th className="text-end">{t("Entrée")}</th><th className="text-end">{t("Sortie")}</th><th /></tr></thead>
        <tbody>
          <tr className="table-light"><td colSpan={3}>{t("Solde au début de la période")}</td><td colSpan={3} className="text-end fw-semibold">{fcfa(d.solde_debut)}</td></tr>
          {lignes.map((m) => (
            <tr key={m.id}><td className="small">{jour(m.date)}</td><td className="small">{m.nature_lib}</td><td className="small">{m.libelle}</td>
              <td className="text-end text-success">{m.entree ? fcfa(m.entree) : ""}</td><td className="text-end text-danger">{m.sortie ? fcfa(m.sortie) : ""}</td>
              <td>{m.rapproche && <span className="badge text-bg-success" title={t("Rapproché avec le relevé")}>✓</span>}</td></tr>))}
          <tr className="table-light"><td colSpan={3}>{t("Solde à la fin de la période")}</td><td colSpan={3} className="text-end fw-semibold">{fcfa(d.solde_fin)}</td></tr>
        </tbody></table></div>}
    </div></section>
  )
}

export default function Tresorerie() {
  const droits = useDroits()
  const [d, erreur, rafraichir] = useDonnees(async () => {
    const [tr, clotures] = await Promise.all([rpc("finance_tresorerie"),
      supabase.from("clotures_caisse").select("id, compte_id, date_cloture, solde_theorique, solde_constate, ecart, justification").order("date_cloture", { ascending: false }).limit(30).then(verifier).catch(() => [])])
    return { ...tr, clotures }
  }, [])
  const [modal, setModal] = useState(null), [msg, setMsg] = useState("")
  const fait = (texte) => { setModal(null); setMsg(texte); rafraichir() }
  if (!d) return <><EnTete titre={t("Trésorerie et banques")} /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const total = d.comptes.filter((c) => c.actif).reduce((s, c) => s + Number(c.solde || 0), 0)
  const gerer = droits.a("tresorerie")
  return (
    <>
      <EnTete titre={t("Trésorerie et banques")} sousTitre={t("Soldes recalculés à partir des mouvements : encaissements, dépenses payées et virements internes.")}>
        {gerer && <><button className="btn btn-sm btn-outline-primary" disabled={d.comptes.filter((c) => c.actif).length < 2} onClick={() => setModal({ type: "virement" })}>{t("Virement entre comptes")}</button>
          <button className="btn btn-sm btn-primary" onClick={() => setModal({ type: "compte" })}>{t("+ Compte")}</button></>}
      </EnTete>
      <Alerte type="success" onFermer={() => setMsg("")}>{msg}</Alerte>
      {!d.comptes.length && <div className="alert alert-info">{t("Aucun compte. Créez au moins la caisse principale : les encaissements en espèces y seront affectés automatiquement.")}</div>}
      <div className="grille-comptes mb-3">
        {d.comptes.map((c) => (
          <article key={c.id} className={`carte-compte type-${c.type}${c.actif ? "" : " inactif"}`}>
            <div className="d-flex justify-content-between"><span className="small text-muted">{t(TYPES[c.type])}{c.par_defaut && ` · ${t("prioritaire")}`}</span>
              {!c.actif && <span className="badge text-bg-secondary">{t("inactif")}</span>}</div>
            <h2 className="h6 mb-1">{c.libelle}</h2>
            <div className={`solde${c.solde < 0 ? " text-danger" : ""}`}>{c.solde == null ? "—" : fcfa(c.solde)}</div>
            <div className="small text-muted">{c.modes.map(modePaiement).join(", ") || t("aucun mode par défaut")}{c.derniere_cloture && ` · ${t("clôturé au {v0}", { v0: jour(c.derniere_cloture) })}`}</div>
            {gerer && <div className="d-flex flex-wrap gap-1 mt-2">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setModal({ type: "compte", compte: c })}>{t("Modifier")}</button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setModal({ type: "cloture", compte: c })}>{t("Clôturer")}</button>
              {c.type !== "caisse" && <button className="btn btn-sm btn-outline-secondary" onClick={() => setModal({ type: "rapprochement", compte: c })}>{t("Rapprocher")}</button>}</div>}
          </article>))}
        {d.comptes.length > 0 && <article className="carte-compte total"><span className="small text-muted">{t("Total des comptes actifs")}</span><div className="solde">{fcfa(total)}</div></article>}
      </div>
      {d.comptes.length > 0 && <Journal comptes={d.comptes} />}
      {d.clotures.length > 0 && <section className="card mt-3"><div className="card-body">
        <h2 className="h6">{t("Dernières clôtures")}</h2>
        <table className="table table-sm small mb-0"><thead><tr><th>{t("Date")}</th><th>{t("Compte")}</th><th className="text-end">{t("Théorique")}</th><th className="text-end">{t("Constaté")}</th><th className="text-end">{t("Écart")}</th><th>{t("Justification")}</th></tr></thead>
          <tbody>{d.clotures.map((k) => (
            <tr key={k.id} className={k.ecart ? "table-warning" : undefined}><td>{jour(k.date_cloture)}</td><td>{d.comptes.find((c) => c.id === k.compte_id)?.libelle}</td>
              <td className="text-end">{fcfa(k.solde_theorique)}</td><td className="text-end">{fcfa(k.solde_constate)}</td><td className="text-end fw-semibold">{fcfa(k.ecart)}</td><td>{k.justification || "—"}</td></tr>))}</tbody></table>
      </div></section>}
      {modal?.type === "compte" && <FormCompte compte={modal.compte} onFermer={() => setModal(null)} onFait={fait} />}
      {modal?.type === "virement" && <Virement comptes={d.comptes} onFermer={() => setModal(null)} onFait={fait} />}
      {modal?.type === "cloture" && <Cloture compte={modal.compte} onFermer={() => setModal(null)} onFait={fait} />}
      {modal?.type === "rapprochement" && <Rapprochement compte={modal.compte} onFermer={() => { setModal(null); rafraichir() }} />}
    </>
  )
}
