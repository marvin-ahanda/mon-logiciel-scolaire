// Frais et facturation : pension (« Frais et délais », inchangé), catégories de frais avec montants par classe et échéances,
// émission des factures sans doublon, dettes antérieures. Les remises se gèrent dans le dossier de l'élève.
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { EnTete, Modale } from "./commun.jsx"
import DossierEleve from "./DossierEleve.jsx"

const VIDE = { libelle: "", description: "", conditions: "", nature: "frais", obligatoire: true, actif: true, montants: [{ classe_id: "", montant: "" }], tranches: [] }

function EditeurCategorie({ categorie, classes, onFermer, onEnregistre }) {
  const [c, setC] = useState(() => categorie ? { ...categorie, montants: categorie.montants.length ? categorie.montants.map((m) => ({ classe_id: m.classe_id || "", montant: m.montant })) : VIDE.montants,
    tranches: categorie.tranches.map((x) => ({ libelle: x.libelle, pourcentage: x.pourcentage, date_limite: x.date_limite })) } : VIDE)
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  const somme = c.tranches.reduce((s, x) => s + Number(x.pourcentage || 0), 0)
  const majLigne = (cle, k, champ, v) => setC({ ...c, [cle]: c[cle].map((x, i) => (i === k ? { ...x, [champ]: v } : x)) })
  async function enregistrer(ev) {
    ev.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      await rpc("finance_categorie_enregistrer", { p: { id: categorie?.id || null, libelle: c.libelle, description: c.description, conditions: c.conditions, nature: c.nature,
        obligatoire: c.obligatoire, actif: c.actif,
        montants: c.nature === "dette_anterieure" ? [] : c.montants.filter((m) => m.montant !== "").map((m) => ({ classe_id: m.classe_id || null, montant: Math.round(Number(m.montant)) })),
        tranches: c.tranches.map((x) => ({ libelle: x.libelle, pourcentage: Number(x.pourcentage), date_limite: x.date_limite })) } })
      onEnregistre()
    } catch (e) { setErreur(e.message) } finally { setEnvoi(false) }
  }
  return (
    <Modale titre={categorie ? t("Modifier « {v0} »", { v0: categorie.libelle }) : t("Nouvelle catégorie de frais")} onFermer={onFermer}>
      <form onSubmit={enregistrer}>
        <Alerte>{erreur}</Alerte>
        <div className="row g-2">
          <div className="col-md-6"><label className="form-label small" htmlFor="cat-lib">{t("Libellé")}</label>
            <input id="cat-lib" className="form-control" required maxLength={80} placeholder={t("ex. Frais d'examen, APEE, Tenue…")} value={c.libelle} onChange={(e) => setC({ ...c, libelle: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label small" htmlFor="cat-nat">{t("Nature")}</label>
            <select id="cat-nat" className="form-select" value={c.nature} disabled={!!categorie} onChange={(e) => setC({ ...c, nature: e.target.value, obligatoire: e.target.value === "frais" })}>
              <option value="frais">{t("Frais de l'année")}</option><option value="dette_anterieure">{t("Dette antérieure (créance d'une année précédente)")}</option></select></div>
          <div className="col-12"><label className="form-label small" htmlFor="cat-desc">{t("Description")}</label>
            <input id="cat-desc" className="form-control" maxLength={300} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></div>
          <div className="col-12"><label className="form-label small" htmlFor="cat-cond">{t("Conditions d'application")}</label>
            <input id="cat-cond" className="form-control" maxLength={300} placeholder={t("ex. élèves des classes d'examen")} value={c.conditions} onChange={(e) => setC({ ...c, conditions: e.target.value })} /></div>
          {c.nature === "frais" && <div className="col-12 form-check ms-2">
            <input id="cat-obl" type="checkbox" className="form-check-input" checked={c.obligatoire} onChange={(e) => setC({ ...c, obligatoire: e.target.checked })} />
            <label className="form-check-label small" htmlFor="cat-obl">{t("Obligatoire : facturable à toute une classe (sinon, élève par élève)")}</label></div>}
          {categorie && <div className="col-12 form-check ms-2">
            <input id="cat-act" type="checkbox" className="form-check-input" checked={c.actif} onChange={(e) => setC({ ...c, actif: e.target.checked })} />
            <label className="form-check-label small" htmlFor="cat-act">{t("Active")}</label></div>}
        </div>
        {c.nature === "frais" && <>
          <h3 className="h6 mt-3">{t("Montant par classe")}</h3>
          {c.montants.map((m, k) => (
            <div className="row g-2 mb-1" key={k}>
              <div className="col-7"><select className="form-select form-select-sm" aria-label={t("Classe")} value={m.classe_id} onChange={(e) => majLigne("montants", k, "classe_id", e.target.value)}>
                <option value="">{t("Toutes les autres classes")}</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</select></div>
              <div className="col-4"><input className="form-control form-control-sm" type="number" min={0} aria-label={t("Montant (FCFA)")} value={m.montant} onChange={(e) => majLigne("montants", k, "montant", e.target.value)} /></div>
              <div className="col-1"><button type="button" className="btn btn-sm btn-link text-danger" aria-label={t("Retirer")} onClick={() => setC({ ...c, montants: c.montants.filter((_, i) => i !== k) })}>×</button></div>
            </div>))}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setC({ ...c, montants: [...c.montants, { classe_id: "", montant: "" }] })}>{t("+ Montant pour une classe")}</button>
        </>}
        <h3 className="h6 mt-3">{t("Échéances (facultatif)")} {c.tranches.length > 0 && <span className={`badge ${somme === 100 ? "text-bg-success" : "text-bg-danger"}`}>{somme} %</span>}</h3>
        {c.tranches.map((x, k) => (
          <div className="row g-2 mb-1" key={k}>
            <div className="col-5"><input className="form-control form-control-sm" aria-label={t("Libellé")} placeholder={t("Tranche {v0}", { v0: k + 1 })} value={x.libelle} onChange={(e) => majLigne("tranches", k, "libelle", e.target.value)} /></div>
            <div className="col-3"><input className="form-control form-control-sm" type="number" min={1} max={100} step="0.01" required aria-label={t("Pourcentage")} value={x.pourcentage} onChange={(e) => majLigne("tranches", k, "pourcentage", e.target.value)} /></div>
            <div className="col-3"><input className="form-control form-control-sm" type="date" required aria-label={t("Date limite")} value={x.date_limite} onChange={(e) => majLigne("tranches", k, "date_limite", e.target.value)} /></div>
            <div className="col-1"><button type="button" className="btn btn-sm btn-link text-danger" aria-label={t("Retirer")} onClick={() => setC({ ...c, tranches: c.tranches.filter((_, i) => i !== k) })}>×</button></div>
          </div>))}
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setC({ ...c, tranches: [...c.tranches, { libelle: "", pourcentage: "", date_limite: "" }] })}>{t("+ Échéance")}</button>
        <div className="mt-3 d-flex gap-2"><button className="btn btn-primary" disabled={envoi}>{envoi ? t("Enregistrement…") : t("Enregistrer")}</button>
          <button type="button" className="btn btn-link" onClick={onFermer}>{t("Annuler")}</button></div>
      </form>
    </Modale>
  )
}

function Facturer({ categories, classes, onFait }) {
  const [f, setF] = useState({ rubrique: "pension", classe: "", recherche: "", eleves: [], montant: "", libelle: "" })
  const [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false), [trouves, setTrouves] = useState([])
  const cat = categories.find((c) => c.id === f.rubrique)
  const parEleve = cat && (cat.nature === "dette_anterieure" || !cat.obligatoire)
  async function chercher() { try { setTrouves(await rpc("finance_rechercher", { p_q: f.recherche, p_classe: null })) } catch (e) { setMsg({ erreur: e.message }) } }
  async function emettre(ev) {
    ev.preventDefault(); setMsg({}); setEnvoi(true)
    try {
      const r = await rpc("finance_facturer", { p: { categorie_id: f.rubrique === "pension" ? null : f.rubrique, classe_id: parEleve ? null : f.classe || null,
        inscriptions: parEleve || f.eleves.length ? f.eleves.map((e) => e.inscription_id) : null, montant: f.montant ? Math.round(Number(f.montant)) : null, libelle: f.libelle || null } })
      setMsg({ ok: t("{v0} facture(s) émise(s) ; {v1} élève(s) ignoré(s) (déjà facturés ou sans montant pour leur classe).", { v0: r.crees, v1: r.ignores }) })
      setF({ ...f, eleves: [] }); onFait()
    } catch (e) { setMsg({ erreur: e.message }) } finally { setEnvoi(false) }
  }
  return (
    <section className="card h-100"><div className="card-body">
      <h2 className="h6">{t("Émettre des factures")}</h2>
      <p className="small text-muted">{t("Un élève ne reçoit jamais deux factures actives pour la même rubrique : relancer l'émission ne crée aucun doublon.")}</p>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <form onSubmit={emettre} className="row g-2">
        <div className="col-12"><label className="form-label small" htmlFor="fac-rub">{t("Rubrique")}</label>
          <select id="fac-rub" className="form-select" value={f.rubrique} onChange={(e) => setF({ ...f, rubrique: e.target.value, eleves: [] })}>
            <option value="pension">{t("Pension / scolarité")}</option>{categories.filter((c) => c.actif).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        {!parEleve && <div className="col-12"><label className="form-label small" htmlFor="fac-cl">{t("Classe")}</label>
          <select id="fac-cl" className="form-select" value={f.classe} onChange={(e) => setF({ ...f, classe: e.target.value })} required={!f.eleves.length}>
            <option value="">{t("Choisir une classe")}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>}
        {parEleve && <>
          <div className="col-12"><label className="form-label small" htmlFor="fac-q">{t("Élève(s) concerné(s)")}</label>
            <div className="input-group"><input id="fac-q" className="form-control" value={f.recherche} onChange={(e) => setF({ ...f, recherche: e.target.value })} placeholder={t("nom ou matricule")} />
              <button type="button" className="btn btn-outline-secondary" onClick={chercher}>{t("Chercher")}</button></div>
            <div className="d-flex flex-wrap gap-1 mt-1">{trouves.filter((e) => !f.eleves.some((x) => x.inscription_id === e.inscription_id)).slice(0, 8).map((e) => (
              <button type="button" key={e.inscription_id} className="btn btn-sm btn-light border" onClick={() => setF({ ...f, eleves: [...f.eleves, e] })}>+ {e.nom} {e.prenom} ({e.classe})</button>))}</div>
            <div className="d-flex flex-wrap gap-1 mt-1">{f.eleves.map((e) => (
              <span key={e.inscription_id} className="badge text-bg-primary">{e.nom} {e.prenom} <button type="button" className="btn-close btn-close-white ms-1" style={{ fontSize: ".6em" }}
                aria-label={t("Retirer")} onClick={() => setF({ ...f, eleves: f.eleves.filter((x) => x !== e) })} /></span>))}</div></div>
          {cat?.nature === "dette_anterieure" && <>
            <div className="col-6"><label className="form-label small" htmlFor="fac-mt">{t("Montant de la dette (FCFA)")}</label>
              <input id="fac-mt" type="number" min={1} required className="form-control" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></div>
            <div className="col-6"><label className="form-label small" htmlFor="fac-lib">{t("Libellé sur la facture")}</label>
              <input id="fac-lib" className="form-control" maxLength={200} placeholder={cat.libelle} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></div></>}
        </>}
        <div className="col-12"><button className="btn btn-primary" disabled={envoi || (parEleve && !f.eleves.length)}>{envoi ? t("Émission…") : t("Émettre les factures")}</button></div>
      </form>
    </div></section>
  )
}

export default function Facturation() {
  const { exercice } = useSession()
  const [d, erreur, rafraichir] = useDonnees(async () => {
    if (!exercice) return null
    const [categories, montants, tranches, classes, factures] = await Promise.all([
      supabase.from("frais_categories").select("*").eq("exercice_id", exercice.id).order("ordre").order("libelle").then(verifier),
      supabase.from("frais_montants").select("*").then(verifier),
      supabase.from("frais_tranches").select("*").order("rang").then(verifier),
      supabase.from("classes").select("id, libelle, ordre").order("ordre").order("libelle").then(verifier),
      supabase.from("factures").select("categorie_id, montant_brut, annulee_le").eq("exercice_id", exercice.id).then(verifier)])
    return { categories: categories.map((c) => ({ ...c, montants: montants.filter((m) => m.categorie_id === c.id), tranches: tranches.filter((x) => x.categorie_id === c.id) })),
             classes, factures }
  }, [exercice?.id])
  const [edition, setEdition] = useState(null), [ouvert, setOuvert] = useState(null)
  const stats = useMemo(() => {
    const m = new Map()
    for (const f of d?.factures || []) if (!f.annulee_le) { const k = f.categorie_id || "pension"; const s = m.get(k) || { n: 0, total: 0 }; m.set(k, { n: s.n + 1, total: s.total + Number(f.montant_brut) }) }
    return m
  }, [d])
  if (!exercice) return <Alerte type="warning">{t("Aucune année scolaire active.")}</Alerte>
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const lib = (id) => d.classes.find((c) => c.id === id)?.libelle
  return (
    <>
      <EnTete titre={t("Frais et facturation")} sousTitre={t("Année scolaire {v0}", { v0: exercice.libelle })}>
        <Link className="btn btn-sm btn-outline-secondary" to="/finance/frais">{t("Pension : frais et délais")}</Link>
        <button className="btn btn-sm btn-primary" onClick={() => setEdition({})}>{t("+ Catégorie de frais")}</button>
      </EnTete>
      <div className="row g-3">
        <div className="col-lg-7">
          <section className="card"><div className="card-body">
            <h2 className="h6">{t("Rubriques de l'année")}</h2>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0">
              <thead><tr><th>{t("Rubrique")}</th><th>{t("Montants")}</th><th>{t("Échéances")}</th><th className="text-end">{t("Facturé")}</th><th /></tr></thead>
              <tbody>
                <tr><td className="fw-semibold">{t("Pension / scolarité")}</td><td className="small">{t("selon « Frais et délais » (nouveaux / anciens)")}</td><td className="small">{t("inscription + 4 tranches")}</td>
                  <td className="text-end small">{stats.get("pension") ? `${stats.get("pension").n} · ${fcfa(stats.get("pension").total)}` : "—"}</td>
                  <td className="text-end"><Link className="btn btn-sm btn-outline-secondary" to="/finance/frais">{t("Configurer")}</Link></td></tr>
                {d.categories.map((c) => (
                  <tr key={c.id} className={c.actif ? undefined : "text-muted"}>
                    <td><span className="fw-semibold">{c.libelle}</span>{c.nature === "dette_anterieure" && <span className="badge text-bg-warning ms-1">{t("Dette antérieure")}</span>}
                      {!c.obligatoire && c.nature === "frais" && <span className="badge text-bg-light border ms-1">{t("facultatif")}</span>}{!c.actif && <span className="badge text-bg-secondary ms-1">{t("inactive")}</span>}
                      {c.conditions && <div className="small text-muted">{c.conditions}</div>}</td>
                    <td className="small">{c.nature === "dette_anterieure" ? t("montant propre à chaque élève") : c.montants.map((m) => `${m.classe_id ? lib(m.classe_id) : t("autres classes")} : ${fcfa(m.montant)}`).join(" · ") || "—"}</td>
                    <td className="small">{c.tranches.length ? c.tranches.map((x) => `${x.libelle} ${x.pourcentage} % (${jour(x.date_limite)})`).join(" · ") : t("en une fois")}</td>
                    <td className="text-end small">{stats.get(c.id) ? `${stats.get(c.id).n} · ${fcfa(stats.get(c.id).total)}` : "—"}</td>
                    <td className="text-end"><button className="btn btn-sm btn-outline-secondary" onClick={() => setEdition(c)}>{t("Modifier")}</button></td></tr>))}
              </tbody></table></div>
          </div></section>
          <p className="small text-muted mt-2">{t("Réductions, exonérations, bourses et aides : ouvrez le dossier de l'élève (Encaissements et reçus) ; chaque remise est tracée avec son motif, son auteur et sa date.")}</p>
        </div>
        <div className="col-lg-5"><Facturer categories={d.categories} classes={d.classes} onFait={rafraichir} /></div>
      </div>
      {edition && <EditeurCategorie categorie={edition.id ? edition : null} classes={d.classes} onFermer={() => setEdition(null)} onEnregistre={() => { setEdition(null); rafraichir() }} />}
      {ouvert && <DossierEleve inscriptionId={ouvert} onFermer={() => setOuvert(null)} />}
    </>
  )
}
