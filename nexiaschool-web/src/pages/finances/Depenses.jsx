// Dépenses et fournisseurs : saisie avec pièce justificative, circuit de validation (brouillon → en attente → approuvée /
// rejetée → payée), paiement depuis un compte de trésorerie, annulation tracée. Seule une dépense payée sort de la trésorerie.
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour, MODES, modePaiement } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, BoutonsExport, demanderMotif, EnTete, exporterTableau, Modale, nouvelleCle, Statut, STATUTS_DEPENSE, useDroits } from "./commun.jsx"

const TYPES_OK = ["application/pdf", "image/jpeg", "image/png", "image/webp"]

function FormDepense({ depense, categories, fournisseurs, onFermer, onFait }) {
  const { etablissement } = useSession()
  const [f, setF] = useState(() => depense ? { ...depense, fournisseur_id: depense.fournisseur_id || "" }
    : { categorie_id: categories[0]?.id || "", fournisseur_id: "", libelle: "", montant: "", date_depense: aujourdhui(), observation: "", justificatif: null })
  const [fichierJ, setFichierJ] = useState(null), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  async function enregistrer(soumettre) {
    setErreur(""); setEnvoi(true)
    try {
      let chemin = f.justificatif
      if (fichierJ) {
        if (!TYPES_OK.includes(fichierJ.type)) throw new Error(t("Pièce justificative : PDF ou image (JPEG, PNG, WebP) uniquement."))
        if (fichierJ.size > 5 * 1024 * 1024) throw new Error(t("Pièce justificative trop lourde (5 Mo au plus)."))
        const ext = fichierJ.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf"
        chemin = `${etablissement.id}/depenses/${nouvelleCle()}.${ext}`
        const { error } = await supabase.storage.from("justificatifs").upload(chemin, fichierJ, { contentType: fichierJ.type, upsert: false })
        if (error) throw new Error(error.message)
      }
      await rpc("finance_depense_enregistrer", { p: { id: depense?.id || null, categorie_id: f.categorie_id, fournisseur_id: f.fournisseur_id || null, libelle: f.libelle,
        montant: Math.round(Number(f.montant)), date_depense: f.date_depense, observation: f.observation, justificatif: chemin, soumettre } })
      onFait(soumettre ? t("Dépense soumise à validation.") : t("Dépense enregistrée en brouillon."))
    } catch (e) { setErreur(e.message) } finally { setEnvoi(false) }
  }
  return (
    <Modale titre={depense ? t("Dépense n° {v0}", { v0: depense.numero }) : t("Nouvelle dépense")} onFermer={onFermer}
      pied={<><button className="btn btn-outline-primary" disabled={envoi} onClick={() => enregistrer(false)}>{t("Enregistrer en brouillon")}</button>
        <button className="btn btn-primary" disabled={envoi} onClick={() => enregistrer(true)}>{envoi ? t("Envoi…") : t("Soumettre à validation")}</button></>}>
      <Alerte>{erreur}</Alerte>
      {depense?.motif_rejet && <div className="alert alert-danger py-2 small">{t("Rejetée : {v0}", { v0: depense.motif_rejet })}</div>}
      <div className="row g-2">
        <div className="col-md-8"><label className="form-label small" htmlFor="dep-lib">{t("Objet de la dépense")}</label>
          <input id="dep-lib" className="form-control" required maxLength={200} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="dep-mt">{t("Montant (FCFA)")}</label>
          <input id="dep-mt" className="form-control" type="number" min={1} required value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="dep-cat">{t("Catégorie")}</label>
          <select id="dep-cat" className="form-select" value={f.categorie_id} onChange={(e) => setF({ ...f, categorie_id: e.target.value })}>
            {categories.filter((c) => c.actif && !c.systeme).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="dep-four">{t("Fournisseur")}</label>
          <select id="dep-four" className="form-select" value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })}>
            <option value="">{t("— aucun —")}</option>{fournisseurs.filter((x) => x.actif).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="dep-date">{t("Date de la dépense")}</label>
          <input id="dep-date" className="form-control" type="date" value={f.date_depense} onChange={(e) => setF({ ...f, date_depense: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small" htmlFor="dep-obs">{t("Observation")}</label>
          <input id="dep-obs" className="form-control" maxLength={300} value={f.observation} onChange={(e) => setF({ ...f, observation: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small" htmlFor="dep-just">{t("Pièce justificative (facture, devis, reçu : PDF ou image, 5 Mo au plus)")}</label>
          <input id="dep-just" className="form-control" type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFichierJ(e.target.files?.[0] || null)} />
          {f.justificatif && !fichierJ && <div className="small text-success mt-1">{t("Une pièce est déjà jointe.")}</div>}</div>
      </div>
    </Modale>
  )
}

async function ouvrirJustificatif(chemin) {
  const { data, error } = await supabase.storage.from("justificatifs").createSignedUrl(chemin, 120)
  if (error) return alert(error.message)
  window.open(data.signedUrl, "_blank", "noopener")
}

function Payer({ depense, comptes, onFermer, onFait }) {
  const [p, setP] = useState({ compte_id: comptes[0]?.id || "", mode: "especes", date: aujourdhui(), reference: "" }), [erreur, setErreur] = useState("")
  async function payer(ev) {
    ev.preventDefault()
    try { await rpc("finance_depense_action", { p_id: depense.id, p_action: "payer", p }); onFait(t("Dépense n° {v0} payée : la trésorerie est mise à jour.", { v0: depense.numero })) }
    catch (e) { setErreur(e.message) }
  }
  return (
    <Modale titre={t("Payer la dépense n° {v0} ({v1})", { v0: depense.numero, v1: fcfa(depense.montant) })} onFermer={onFermer}>
      <form onSubmit={payer} className="row g-2">
        <Alerte>{erreur}</Alerte>
        <div className="col-md-6"><label className="form-label small" htmlFor="pay-cpt">{t("Compte débité")}</label>
          <select id="pay-cpt" className="form-select" required value={p.compte_id} onChange={(e) => setP({ ...p, compte_id: e.target.value })}>
            {comptes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="pay-mode">{t("Mode")}</label>
          <select id="pay-mode" className="form-select" value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value })}>
            {Object.keys(MODES).map((k) => <option key={k} value={k}>{modePaiement(k)}</option>)}</select></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="pay-date">{t("Date du paiement")}</label>
          <input id="pay-date" type="date" className="form-control" max={aujourdhui()} value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="pay-ref">{t("Référence")}</label>
          <input id="pay-ref" className="form-control" maxLength={80} value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></div>
        <div className="col-12"><button className="btn btn-success" disabled={!comptes.length}>{t("Confirmer le paiement")}</button>
          {!comptes.length && <span className="small text-danger ms-2">{t("Créez d'abord un compte de trésorerie.")}</span>}</div>
      </form>
    </Modale>
  )
}

function Referentiels({ categories, fournisseurs, onFait }) {
  const [cat, setCat] = useState(""), [four, setFour] = useState({ nom: "", telephone: "", email: "", identifiant_fiscal: "" }), [msg, setMsg] = useState({})
  const agir = async (f, ok) => { try { await f(); setMsg({ ok }); onFait() } catch (e) { setMsg({ erreur: e.message }) } }
  return (
    <div className="row g-3">
      <div className="col-12"><Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte></div>
      <div className="col-md-5"><section className="card"><div className="card-body">
        <h2 className="h6">{t("Catégories de dépenses")}</h2>
        <form className="input-group input-group-sm mb-2" onSubmit={(e) => { e.preventDefault(); agir(() => rpc("finance_depense_categorie_enregistrer", { p: { libelle: cat } }), t("Catégorie ajoutée.")).then(() => setCat("")) }}>
          <input className="form-control" required maxLength={80} placeholder={t("ex. Fournitures scolaires")} aria-label={t("Nouvelle catégorie")} value={cat} onChange={(e) => setCat(e.target.value)} />
          <button className="btn btn-primary">{t("Ajouter")}</button></form>
        <ul className="list-group list-group-flush small">{categories.map((c) => (
          <li key={c.id} className="list-group-item px-0 d-flex justify-content-between">{c.libelle}{c.systeme && <span className="badge text-bg-light border">{t("paie")}</span>}
            {!c.systeme && <button className="btn btn-link btn-sm p-0" onClick={() => agir(() => rpc("finance_depense_categorie_enregistrer", { p: { id: c.id, libelle: c.libelle, actif: !c.actif } }), t("Catégorie modifiée."))}>
              {c.actif ? t("désactiver") : t("réactiver")}</button>}</li>))}</ul>
      </div></section></div>
      <div className="col-md-7"><section className="card"><div className="card-body">
        <h2 className="h6">{t("Fournisseurs")}</h2>
        <form className="row g-2 mb-2" onSubmit={(e) => { e.preventDefault(); agir(() => rpc("finance_fournisseur_enregistrer", { p: four }), t("Fournisseur ajouté.")).then(() => setFour({ nom: "", telephone: "", email: "", identifiant_fiscal: "" })) }}>
          <div className="col-md-6"><input className="form-control form-control-sm" required maxLength={120} placeholder={t("Nom")} aria-label={t("Nom")} value={four.nom} onChange={(e) => setFour({ ...four, nom: e.target.value })} /></div>
          <div className="col-md-6"><input className="form-control form-control-sm" maxLength={40} placeholder={t("Téléphone")} aria-label={t("Téléphone")} value={four.telephone} onChange={(e) => setFour({ ...four, telephone: e.target.value })} /></div>
          <div className="col-md-6"><input className="form-control form-control-sm" type="email" maxLength={120} placeholder={t("E-mail")} aria-label={t("E-mail")} value={four.email} onChange={(e) => setFour({ ...four, email: e.target.value })} /></div>
          <div className="col-md-4"><input className="form-control form-control-sm" maxLength={60} placeholder={t("N° contribuable")} aria-label={t("N° contribuable")} value={four.identifiant_fiscal} onChange={(e) => setFour({ ...four, identifiant_fiscal: e.target.value })} /></div>
          <div className="col-md-2"><button className="btn btn-sm btn-primary w-100">{t("Ajouter")}</button></div></form>
        <table className="table table-sm small mb-0"><tbody>{fournisseurs.map((x) => (
          <tr key={x.id} className={x.actif ? undefined : "text-muted"}><td className="fw-semibold">{x.nom}</td><td>{x.telephone}</td><td>{x.email}</td><td>{x.identifiant_fiscal}</td>
            <td className="text-end"><button className="btn btn-link btn-sm p-0" onClick={() => agir(() => rpc("finance_fournisseur_enregistrer", { p: { ...x, actif: !x.actif } }), t("Fournisseur modifié."))}>
              {x.actif ? t("désactiver") : t("réactiver")}</button></td></tr>))}</tbody></table>
      </div></section></div>
    </div>
  )
}

export default function Depenses() {
  const session = useSession(), droits = useDroits()
  const [params, setParams] = useSearchParams()
  const statut = params.get("statut") || "", vue = params.get("vue") || "liste"
  const [d, erreur, rafraichir] = useDonnees(async () => {
    const [depenses, categories, fournisseurs, comptes] = await Promise.all([
      rpc("finance_depenses", { p: { statut } }),
      supabase.from("depenses_categories").select("*").order("libelle").then(verifier),
      supabase.from("fournisseurs").select("*").order("nom").then(verifier),
      supabase.from("comptes_financiers").select("id, libelle, type").eq("actif", true).order("libelle").then(verifier)])
    return { depenses, categories, fournisseurs, comptes }
  }, [statut])
  const [form, setForm] = useState(null), [paiement, setPaiement] = useState(null), [msg, setMsg] = useState({})
  const fait = (texte) => { setForm(null); setPaiement(null); setMsg({ ok: texte }); rafraichir() }
  async function action(x, a) {
    let p = {}
    if (a === "rejeter" || a === "annuler") {
      const motif = demanderMotif(a === "rejeter" ? t("Motif du rejet ?") : t("Motif de l'annulation ?")); if (!motif) return
      p = { motif }
    }
    try { const r = await rpc("finance_depense_action", { p_id: x.id, p_action: a, p }); fait(t("Dépense n° {v0} : {v1}.", { v0: x.numero, v1: t(STATUTS_DEPENSE[r.statut]?.[0] || r.statut) })) }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  const colonnes = [{ cle: "numero", libelle: t("N°"), type: "nombre" }, { cle: "date_depense", libelle: t("Date"), type: "date" }, { cle: "libelle", libelle: t("Objet"), type: "texte" },
    { cle: "categorie", libelle: t("Catégorie"), type: "texte" }, { cle: "fournisseur", libelle: t("Fournisseur"), type: "texte" }, { cle: "statut_lib", libelle: t("Statut"), type: "texte" },
    { cle: "montant", libelle: t("Montant"), type: "montant" }]
  if (!d) return <><EnTete titre={t("Dépenses et fournisseurs")} /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const lignes = d.depenses.map((x) => ({ ...x, statut_lib: t(STATUTS_DEPENSE[x.statut]?.[0]) }))
  return (
    <>
      <EnTete titre={t("Dépenses et fournisseurs")} sousTitre={t("Engagée (en attente, approuvée) ≠ payée : seule une dépense payée réduit la trésorerie.")}>
        {droits.a("depenses") && <button className="btn btn-sm btn-primary" disabled={!d.categories.some((c) => c.actif && !c.systeme)} onClick={() => setForm({})}>{t("+ Nouvelle dépense")}</button>}
      </EnTete>
      <ul className="nav nav-pills mb-3 no-print">
        <li className="nav-item"><button className={`nav-link${vue === "liste" ? " active" : ""}`} onClick={() => setParams(statut ? { statut } : {})}>{t("Dépenses")}</button></li>
        {droits.a("depenses") && <li className="nav-item"><button className={`nav-link${vue === "referentiels" ? " active" : ""}`} onClick={() => setParams({ vue: "referentiels" })}>{t("Catégories et fournisseurs")}</button></li>}
      </ul>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      {vue === "referentiels" ? <Referentiels categories={d.categories} fournisseurs={d.fournisseurs} onFait={rafraichir} /> : <>
        {!d.categories.some((c) => c.actif && !c.systeme) && droits.a("depenses") && <div className="alert alert-info small">{t("Créez d'abord vos catégories de dépenses (onglet « Catégories et fournisseurs »).")}</div>}
        <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
          <div className="btn-group btn-group-sm flex-wrap">{[["", "Toutes"], ...Object.entries(STATUTS_DEPENSE).map(([k, [l]]) => [k, l])].map(([k, l]) => (
            <button key={k} className={`btn btn-outline-secondary${statut === k ? " active" : ""}`} onClick={() => setParams(k ? { statut: k } : {})}>{t(l)}</button>))}</div>
          <BoutonsExport onExporter={(format) => exporterTableau({ format, titre: t("Dépenses"), sousTitre: statut ? t(STATUTS_DEPENSE[statut][0]) : t("Toutes"), colonnes, lignes,
            totaux: { montant: lignes.reduce((s, x) => s + Number(x.montant), 0) }, etablissement: session.etablissement, logoUrl: session.logoUrl })} />
        </div>
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr><th>{t("N°")}</th><th>{t("Date")}</th><th>{t("Objet")}</th><th>{t("Catégorie")}</th><th>{t("Fournisseur")}</th><th className="text-end">{t("Montant")}</th><th>{t("Statut")}</th><th /></tr></thead>
          <tbody>{lignes.map((x) => (
            <tr key={x.id}>
              <td>{x.numero}</td><td className="small">{jour(x.date_depense)}</td>
              <td>{x.libelle}<div className="small text-muted">{t("par {v0}", { v0: x.cree_par || "—" })}{x.valide_par && ` · ${t("validée par {v0}", { v0: x.valide_par })}`}
                {x.date_paiement && ` · ${t("payée le {v0} ({v1})", { v0: jour(x.date_paiement), v1: x.compte })}`}{x.motif_rejet && ` · ${t("rejet : {v0}", { v0: x.motif_rejet })}`}
                {x.motif_annulation && ` · ${t("annulation : {v0}", { v0: x.motif_annulation })}`}</div></td>
              <td className="small">{x.categorie}</td><td className="small">{x.fournisseur || "—"}</td><td className="text-end">{fcfa(x.montant)}</td>
              <td><Statut table={STATUTS_DEPENSE} valeur={x.statut} /></td>
              <td className="text-end text-nowrap">
                {x.justificatif && <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => ouvrirJustificatif(x.justificatif)}>{t("Pièce")}</button>}
                {["brouillon", "rejetee"].includes(x.statut) && x.mien && droits.a("depenses") && !x.paie && <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setForm(x)}>{t("Modifier")}</button>}
                {x.statut === "brouillon" && droits.a("depenses") && <button className="btn btn-sm btn-outline-primary me-1" onClick={() => action(x, "soumettre")}>{t("Soumettre")}</button>}
                {x.statut === "en_attente" && droits.a("validation") && <>
                  <button className="btn btn-sm btn-success me-1" onClick={() => action(x, "approuver")}>{t("Approuver")}</button>
                  <button className="btn btn-sm btn-outline-danger me-1" onClick={() => action(x, "rejeter")}>{t("Rejeter")}</button></>}
                {x.statut === "approuvee" && droits.a("tresorerie") && <button className="btn btn-sm btn-success me-1" onClick={() => setPaiement(x)}>{t("Payer")}</button>}
                {!["annulee", "rejetee"].includes(x.statut) && !x.paie && (droits.a("validation") || (x.mien && x.statut !== "payee")) &&
                  <button className="btn btn-sm btn-outline-danger" onClick={() => action(x, "annuler")}>{t("Annuler")}</button>}</td></tr>))}
            {!lignes.length && <tr><td colSpan={8} className="text-muted">{t("Aucune dépense.")}</td></tr>}</tbody>
        </table></div>
      </>}
      {form && <FormDepense depense={form.id ? form : null} categories={d.categories} fournisseurs={d.fournisseurs} onFermer={() => setForm(null)} onFait={fait} />}
      {paiement && <Payer depense={paiement} comptes={d.comptes} onFermer={() => setPaiement(null)} onFait={fait} />}
    </>
  )
}
