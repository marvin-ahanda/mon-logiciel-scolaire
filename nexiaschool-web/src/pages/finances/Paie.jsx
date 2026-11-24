// Paie du personnel (suivi des salaires et bulletins ; pas un logiciel de paie certifié) : éléments de rémunération
// historisés, paramètres de cotisations saisis par l'établissement (non vérifiés par défaut), préparation mensuelle,
// vérification, validation, paiement (une seule dépense « Salaires » et un seul mouvement de trésorerie), bulletins PDF.
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { bulletinPaiePdf } from "../../lib/financeDocs.js"
import { fcfa, jour, MODES, modePaiement } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, demanderMotif, EnTete, Modale, Statut, STATUTS_PAIE, useDroits } from "./commun.jsx"

const TYPES_ELEMENT = { base: "Salaire de base", prime: "Prime", indemnite: "Indemnité", retenue: "Retenue" }
const TYPES_PARAM = { cotisation_salariale: "Cotisation salariale", cotisation_patronale: "Cotisation patronale", impot: "Impôt", retenue: "Retenue" }
const moisCourant = () => `${aujourdhui().slice(0, 7)}-01`
const libMois = (p) => new Date(`${String(p).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })

export async function telechargerBulletin({ session, paie, employe }) {
  await bulletinPaiePdf({ etablissement: session.etablissement, logoUrl: session.logoUrl, employe, paie })
}

function Elements({ personne, onFermer, onFait }) {
  const [e, setE] = useState({ type: "base", libelle: "", montant: "", date_effet: moisCourant() }), [erreur, setErreur] = useState("")
  async function ajouter(ev) {
    ev.preventDefault()
    try { await rpc("finance_paie_element_ajouter", { p: { ...e, personnel_id: personne.id, montant: Math.round(Number(e.montant)) } }); onFait(t("Élément ajouté.")) }
    catch (x) { setErreur(x.message) }
  }
  async function clore(el) {
    const fin = window.prompt(t("Dernier jour d'application (AAAA-MM-JJ) ?"), aujourdhui()); if (!fin) return
    try { await rpc("finance_paie_element_clore", { p_id: el.id, p_date_fin: fin }); onFait(t("Élément clos.")) } catch (x) { setErreur(x.message) }
  }
  return (
    <Modale titre={t("Rémunération : {v0}", { v0: personne.nom })} onFermer={onFermer}>
      <Alerte>{erreur}</Alerte>
      <p className="small text-muted">{t("Historique conservé : une nouvelle base met fin à la précédente la veille de sa date d'effet ; rien n'est effacé.")}</p>
      <table className="table table-sm small"><thead><tr><th>{t("Type")}</th><th>{t("Libellé")}</th><th className="text-end">{t("Montant")}</th><th>{t("Du")}</th><th>{t("Au")}</th><th /></tr></thead>
        <tbody>{personne.elements.map((el) => (
          <tr key={el.id} className={el.date_fin && el.date_fin < aujourdhui() ? "text-muted" : undefined}><td>{t(TYPES_ELEMENT[el.type])}</td><td>{el.libelle}</td><td className="text-end">{fcfa(el.montant)}</td>
            <td>{jour(el.date_effet)}</td><td>{el.date_fin ? jour(el.date_fin) : "—"}</td>
            <td>{!el.date_fin && el.type !== "base" && <button className="btn btn-link btn-sm p-0" onClick={() => clore(el)}>{t("clore")}</button>}</td></tr>))}
          {!personne.elements.length && <tr><td colSpan={6} className="text-muted">{t("Aucun élément : ajoutez d'abord le salaire de base.")}</td></tr>}</tbody></table>
      <form onSubmit={ajouter} className="row g-2 border-top pt-2">
        <div className="col-md-3"><select className="form-select form-select-sm" aria-label={t("Type")} value={e.type} onChange={(x) => setE({ ...e, type: x.target.value })}>
          {Object.entries(TYPES_ELEMENT).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
        <div className="col-md-4"><input className="form-control form-control-sm" maxLength={120} aria-label={t("Libellé")} placeholder={e.type === "base" ? t("Salaire de base") : t("ex. Prime de responsabilité")}
          value={e.libelle} onChange={(x) => setE({ ...e, libelle: x.target.value })} /></div>
        <div className="col-md-2"><input className="form-control form-control-sm" type="number" min={0} required aria-label={t("Montant (FCFA)")} value={e.montant} onChange={(x) => setE({ ...e, montant: x.target.value })} /></div>
        <div className="col-md-3"><input className="form-control form-control-sm" type="date" required aria-label={t("Date d'effet")} value={e.date_effet} onChange={(x) => setE({ ...e, date_effet: x.target.value })} /></div>
        <div className="col-12"><button className="btn btn-sm btn-primary">{t("Ajouter")}</button></div>
      </form>
    </Modale>
  )
}

function Parametres({ parametres, onFait }) {
  const [p, setP] = useState(null), [erreur, setErreur] = useState("")
  async function enregistrer(ev) {
    ev.preventDefault()
    try { await rpc("finance_paie_parametre_enregistrer", { p: { ...p, valeur: Number(p.valeur), plafond: p.plafond || null } }); setP(null); onFait(t("Paramètre enregistré.")) } catch (x) { setErreur(x.message) }
  }
  return (
    <section className="card"><div className="card-body">
      <div className="d-flex justify-content-between align-items-center"><h2 className="h6 mb-0">{t("Cotisations, impôts et retenues")}</h2>
        {!p && <button className="btn btn-sm btn-outline-primary" onClick={() => setP({ libelle: "", type: "cotisation_salariale", mode: "taux", valeur: "", plafond: "", actif: false, verifie: false, source: "", date_effet: moisCourant() })}>{t("+ Paramètre")}</button>}</div>
      <div className="alert alert-warning small my-2">{t("NexIA School ne fournit aucun taux réglementaire. Saisissez vous-même les taux et barèmes en vigueur, indiquez leur source officielle, et ne les marquez « vérifiés » qu'après contrôle (CNPS, administration fiscale, convention collective…). Un bulletin calculé avec un paramètre non vérifié le signale.")}</div>
      <Alerte>{erreur}</Alerte>
      {p && <form onSubmit={enregistrer} className="row g-2 border rounded p-2 mb-2 small">
        <div className="col-md-5"><input className="form-control form-control-sm" required maxLength={120} placeholder={t("Libellé")} aria-label={t("Libellé")} value={p.libelle} onChange={(x) => setP({ ...p, libelle: x.target.value })} /></div>
        <div className="col-md-4"><select className="form-select form-select-sm" aria-label={t("Type")} value={p.type} onChange={(x) => setP({ ...p, type: x.target.value })}>
          {Object.entries(TYPES_PARAM).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
        <div className="col-md-3"><select className="form-select form-select-sm" aria-label={t("Calcul")} value={p.mode} onChange={(x) => setP({ ...p, mode: x.target.value })}>
          <option value="taux">{t("Taux (% du brut)")}</option><option value="montant">{t("Montant fixe")}</option></select></div>
        <div className="col-md-3"><input className="form-control form-control-sm" type="number" step="0.0001" min={0} required placeholder={p.mode === "taux" ? "%" : "FCFA"} aria-label={t("Valeur")} value={p.valeur} onChange={(x) => setP({ ...p, valeur: x.target.value })} /></div>
        {p.mode === "taux" && <div className="col-md-3"><input className="form-control form-control-sm" type="number" min={1} placeholder={t("Plafond (facultatif)")} aria-label={t("Plafond")} value={p.plafond || ""} onChange={(x) => setP({ ...p, plafond: x.target.value })} /></div>}
        <div className="col-md-3"><input className="form-control form-control-sm" type="date" aria-label={t("Date d'effet")} value={p.date_effet} onChange={(x) => setP({ ...p, date_effet: x.target.value })} /></div>
        <div className="col-12"><input className="form-control form-control-sm" maxLength={300} placeholder={t("Source officielle (texte, barème, date de publication)")} aria-label={t("Source")} value={p.source} onChange={(x) => setP({ ...p, source: x.target.value })} /></div>
        <div className="col-12 d-flex gap-3">
          <div className="form-check"><input id="par-act" type="checkbox" className="form-check-input" checked={p.actif} onChange={(x) => setP({ ...p, actif: x.target.checked })} /><label htmlFor="par-act" className="form-check-label">{t("Appliquer aux prochaines paies")}</label></div>
          <div className="form-check"><input id="par-ver" type="checkbox" className="form-check-input" checked={p.verifie} onChange={(x) => setP({ ...p, verifie: x.target.checked })} /><label htmlFor="par-ver" className="form-check-label">{t("Vérifié par rapport à la source")}</label></div></div>
        <div className="col-12 d-flex gap-2"><button className="btn btn-sm btn-primary">{t("Enregistrer")}</button><button type="button" className="btn btn-sm btn-link" onClick={() => setP(null)}>{t("Annuler")}</button></div>
      </form>}
      <table className="table table-sm small mb-0"><tbody>{parametres.map((x) => (
        <tr key={x.id} className={x.actif ? undefined : "text-muted"}><td>{x.libelle}<div className="text-muted">{t(TYPES_PARAM[x.type])} · {x.source || t("source non renseignée")}</div></td>
          <td className="text-end">{x.mode === "taux" ? `${String(x.valeur).replace(".", ",")} %` : fcfa(x.valeur)}</td>
          <td>{x.actif ? <span className="badge text-bg-primary">{t("actif")}</span> : <span className="badge text-bg-light border">{t("inactif")}</span>}{" "}
            {x.verifie ? <span className="badge text-bg-success">{t("vérifié")}</span> : <span className="badge text-bg-warning">{t("non vérifié")}</span>}</td>
          <td className="text-end"><button className="btn btn-link btn-sm p-0" onClick={() => setP({ ...x, plafond: x.plafond || "" })}>{t("Modifier")}</button></td></tr>))}
        {!parametres.length && <tr><td className="text-muted">{t("Aucun paramètre : les bulletins ne comportent que les éléments saisis (base, primes, retenues).")}</td></tr>}</tbody></table>
    </div></section>
  )
}

export default function Paie() {
  const session = useSession(), droits = useDroits()
  const [periode, setPeriode] = useState(moisCourant())
  const [d, erreur, rafraichir] = useDonnees(async () => {
    const [p, comptes] = await Promise.all([rpc("finance_paies", { p_periode: periode }),
      supabase.from("comptes_financiers").select("id, libelle").eq("actif", true).order("libelle").then(verifier).catch(() => [])])
    return { ...p, comptes }
  }, [periode])
  const [msg, setMsg] = useState({}), [elements, setElements] = useState(null), [paiement, setPaiement] = useState(null)
  const fait = (ok) => { setMsg({ ok }); setElements(null); setPaiement(null); rafraichir() }
  async function preparer() {
    try { const r = await rpc("finance_paie_preparer", { p_periode: periode, p_personnels: null }); fait(t("{v0} paie(s) préparée(s) ; {v1} ignorée(s) (déjà préparées ou sans salaire de base).", { v0: r.creees, v1: r.ignorees })) }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  async function action(x, a, p = {}) {
    if (a === "annuler") { const motif = demanderMotif(t("Motif de l'annulation de cette paie ?")); if (!motif) return; p = { motif } }
    try { await rpc("finance_paie_action", { p_id: x.id, p_action: a, p }); fait(t("Paie de {v0} : {v1}.", { v0: x.nom, v1: t(a === "recalculer" ? "recalculée" : a === "soumettre" ? "en vérification" : a === "valider" ? "validée" : a === "payer" ? "payée" : a === "renvoyer" ? "renvoyée en brouillon" : "annulée") })) }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  if (!d) return <><EnTete titre={t("Paie du personnel")} /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const actives = d.paies.filter((x) => x.statut !== "annulee")
  return (
    <>
      <EnTete titre={t("Paie du personnel")} sousTitre={t("Suivi des salaires et bulletins de paie · outil de gestion, non certifié comme logiciel de paie")}>
        <input type="month" className="form-control form-control-sm" style={{ width: "auto" }} aria-label={t("Période")} value={periode.slice(0, 7)} onChange={(e) => e.target.value && setPeriode(`${e.target.value}-01`)} />
        <button className="btn btn-sm btn-primary" onClick={preparer}>{t("Préparer la paie de {v0}", { v0: libMois(periode) })}</button>
      </EnTete>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="grille-indicateurs petits mb-3">
        <div className="indicateur-finance"><div className="libelle">{t("Bulletins")}</div><div className="valeur">{actives.length}</div></div>
        <div className="indicateur-finance"><div className="libelle">{t("Masse brute")}</div><div className="valeur">{fcfa(actives.reduce((s, x) => s + Number(x.brut), 0))}</div></div>
        <div className="indicateur-finance"><div className="libelle">{t("Net à payer")}</div><div className="valeur">{fcfa(actives.reduce((s, x) => s + Number(x.net), 0))}</div></div>
        <div className="indicateur-finance ton-alerte"><div className="libelle">{t("Restant à payer")}</div><div className="valeur">{fcfa(actives.filter((x) => x.statut !== "payee").reduce((s, x) => s + Number(x.net), 0))}</div></div>
      </div>
      <section className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Paies de {v0}", { v0: libMois(periode) })}</h2>
        <div className="table-responsive"><table className="table table-sm align-middle mb-0">
          <thead><tr><th>{t("Employé")}</th><th className="text-end">{t("Brut")}</th><th className="text-end">{t("Retenues")}</th><th className="text-end">{t("Net")}</th><th>{t("Statut")}</th><th /></tr></thead>
          <tbody>{d.paies.map((x) => (
            <tr key={x.id} className={x.statut === "annulee" ? "text-muted" : undefined}>
              <td>{x.nom}<div className="small text-muted">{x.poste || x.role}{x.parametres_non_verifies && <span className="badge text-bg-warning ms-1">{t("paramètre non vérifié")}</span>}</div></td>
              <td className="text-end">{fcfa(x.brut)}</td><td className="text-end">{fcfa(x.retenues)}</td><td className="text-end fw-semibold">{fcfa(x.net)}</td>
              <td><Statut table={STATUTS_PAIE} valeur={x.statut} />{x.date_paiement && <div className="small text-muted">{jour(x.date_paiement)} · {x.compte}</div>}</td>
              <td className="text-end text-nowrap">
                <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => telechargerBulletin({ session, paie: x, employe: { nom: x.nom, matricule: x.matricule, poste: x.poste } }).catch((e) => setMsg({ erreur: e.message }))}>{t("Bulletin PDF")}</button>
                {x.statut === "brouillon" && <><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => action(x, "recalculer")}>{t("Recalculer")}</button>
                  <button className="btn btn-sm btn-outline-primary me-1" onClick={() => action(x, "soumettre")}>{t("Vérification")}</button></>}
                {x.statut === "en_verification" && <><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => action(x, "renvoyer")}>{t("Renvoyer")}</button>
                  {droits.a("validation") && <button className="btn btn-sm btn-success me-1" onClick={() => action(x, "valider")}>{t("Valider")}</button>}</>}
                {x.statut === "validee" && droits.a("tresorerie") && <button className="btn btn-sm btn-success me-1" onClick={() => setPaiement(x)}>{t("Payer")}</button>}
                {x.statut !== "annulee" && <button className="btn btn-sm btn-outline-danger" onClick={() => action(x, "annuler")}>{t("Annuler")}</button>}</td></tr>))}
            {!d.paies.length && <tr><td colSpan={6} className="text-muted">{t("Aucune paie pour ce mois. Renseignez les salaires de base puis cliquez sur « Préparer la paie ».")}</td></tr>}</tbody>
        </table></div>
      </div></section>
      <div className="row g-3">
        <div className="col-lg-6"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Personnel et rémunérations")}</h2>
          <table className="table table-sm small mb-0"><tbody>{d.personnel.map((p) => {
            const base = p.elements.find((e) => e.type === "base" && (!e.date_fin || e.date_fin >= aujourdhui()))
            return <tr key={p.id}><td>{p.nom}<div className="text-muted">{p.poste || p.role}</div></td><td className="text-end">{base ? fcfa(base.montant) : <span className="text-muted">{t("pas de salaire de base")}</span>}</td>
              <td className="text-end"><button className="btn btn-sm btn-outline-secondary" onClick={() => setElements(p)}>{t("Rémunération")}</button></td></tr>
          })}</tbody></table>
        </div></section></div>
        <div className="col-lg-6"><Parametres parametres={d.parametres} onFait={fait} /></div>
      </div>
      {elements && <Elements personne={d.personnel.find((p) => p.id === elements.id) || elements} onFermer={() => setElements(null)} onFait={fait} />}
      {paiement && <Modale titre={t("Payer le salaire de {v0} ({v1})", { v0: paiement.nom, v1: fcfa(paiement.net) })} onFermer={() => setPaiement(null)}>
        <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target); action(paiement, "payer", { compte_id: f.get("compte"), mode: f.get("mode"), date: f.get("date"), reference: f.get("reference") }) }} className="row g-2">
          <p className="small text-muted">{t("Le paiement crée une dépense « Salaires » payée et un mouvement sur le compte choisi (aucun double comptage).")}</p>
          <div className="col-md-6"><label className="form-label small" htmlFor="pp-cpt">{t("Compte débité")}</label>
            <select id="pp-cpt" name="compte" className="form-select" required>{d.comptes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label small" htmlFor="pp-mode">{t("Mode")}</label>
            <select id="pp-mode" name="mode" className="form-select" defaultValue="virement">{Object.keys(MODES).map((k) => <option key={k} value={k}>{modePaiement(k)}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label small" htmlFor="pp-date">{t("Date")}</label><input id="pp-date" name="date" type="date" className="form-control" max={aujourdhui()} defaultValue={aujourdhui()} /></div>
          <div className="col-md-6"><label className="form-label small" htmlFor="pp-ref">{t("Référence")}</label><input id="pp-ref" name="reference" className="form-control" maxLength={80} /></div>
          <div className="col-12"><button className="btn btn-success" disabled={!d.comptes.length}>{t("Confirmer le paiement")}</button></div>
        </form></Modale>}
    </>
  )
}
