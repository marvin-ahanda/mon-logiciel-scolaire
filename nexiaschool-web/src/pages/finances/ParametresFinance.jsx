// Paramètres financiers (administration) : modes de paiement proposés, mention des documents, droits financiers de chaque
// membre du personnel (le comptable a par défaut tous les droits du caissier ; la validation et la paie sont à accorder).
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { MODES, modePaiement } from "../../lib/financePdf.js"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { EnTete } from "./commun.jsx"

export const DROITS = [
  ["caisse", "Caisse", "encaisser, reçus, paiements en attente"], ["facturation", "Facturation", "frais, factures, remises, dettes antérieures"],
  ["depenses", "Dépenses", "saisir les dépenses et fournisseurs"], ["validation", "Validation", "approuver / rejeter, annulations au-delà de 24 h, valider la paie"],
  ["tresorerie", "Trésorerie", "comptes, virements, clôtures, rapprochement, payer"], ["paie", "Paie", "salaires et bulletins de paie (données sensibles)"],
  ["rapports", "Rapports", "tableau de bord et rapports"], ["assistant", "Assistant IA", "consulter les finances via MCP (lecture seule)"],
]

export default function ParametresFinance() {
  const [d, erreur, rafraichir] = useDonnees(async () => {
    const [parametres, personnel] = await Promise.all([
      supabase.from("finance_parametres").select("*").maybeSingle().then(verifier), rpc("finance_droits_lister")])
    return { parametres: parametres || { modes_actifs: ["especes", "mtn_momo", "orange_money", "virement", "cheque"], devise: "XAF", mention_documents: "" }, personnel }
  }, [])
  const [p, setP] = useState(null), [msg, setMsg] = useState({})
  const params = p || d?.parametres
  async function enregistrer(ev) {
    ev.preventDefault()
    try { await rpc("finance_parametres_enregistrer", { p: params }); setP(null); setMsg({ ok: t("Paramètres enregistrés.") }); rafraichir() } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function droit(personne, code) {
    const nouveaux = personne.droits.includes(code) ? personne.droits.filter((x) => x !== code) : [...personne.droits, code]
    try { await rpc("finance_droits_definir", { p_personnel: personne.personnel_id, p_droits: nouveaux }); rafraichir() } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function defaut(personne) {
    try { await rpc("finance_droits_definir", { p_personnel: personne.personnel_id, p_droits: null }); rafraichir() } catch (e) { setMsg({ erreur: e.message }) }
  }
  if (!d) return <><EnTete titre={t("Paramètres financiers")} /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <>
      <EnTete titre={t("Paramètres financiers")} />
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="row g-3">
        <div className="col-lg-4"><form className="card h-100" onSubmit={enregistrer}><div className="card-body">
          <h2 className="h6">{t("Modes de paiement proposés à la caisse")}</h2>
          {Object.keys(MODES).filter((m) => m !== "mobile_money").map((m) => (
            <div className="form-check" key={m}><input id={`mode-${m}`} type="checkbox" className="form-check-input" checked={params.modes_actifs.includes(m)}
              onChange={() => setP({ ...params, modes_actifs: params.modes_actifs.includes(m) ? params.modes_actifs.filter((x) => x !== m) : [...params.modes_actifs, m] })} />
              <label className="form-check-label" htmlFor={`mode-${m}`}>{modePaiement(m)}</label></div>))}
          <p className="small text-muted mt-2">{t("Aucun prélèvement n'est fait par NexIA : la caisse enregistre les paiements reçus par ces moyens (référence de transaction à l'appui).")}</p>
          <label className="form-label small mt-2" htmlFor="par-mention">{t("Mention en pied des reçus, factures et bulletins de paie")}</label>
          <textarea id="par-mention" className="form-control" rows={2} maxLength={300} placeholder={t("ex. N° contribuable, RCCM, conditions de remboursement…")}
            value={params.mention_documents} onChange={(e) => setP({ ...params, mention_documents: e.target.value })} />
          <button className="btn btn-primary mt-2" disabled={!p}>{t("Enregistrer")}</button>
        </div></form></div>
        <div className="col-lg-8"><section className="card"><div className="card-body">
          <h2 className="h6">{t("Droits financiers du personnel")}</h2>
          <p className="small text-muted">{t("Vérifiés par le serveur à chaque action, dans l'application comme via l'assistant IA. Pour un caissier : ne cocher que « Caisse ».")}</p>
          <div className="table-responsive"><table className="table table-sm align-middle small mb-0">
            <thead><tr><th>{t("Personne")}</th>{DROITS.map(([k, lib, aide]) => <th key={k} className="text-center" title={t(aide)}>{t(lib)}</th>)}<th /></tr></thead>
            <tbody>{d.personnel.map((x) => (
              <tr key={x.personnel_id}><td>{x.nom}<div className="text-muted">{t(x.role)}{x.personnalise ? ` · ${t("personnalisé")}` : ""}</div></td>
                {DROITS.map(([k, lib]) => <td key={k} className="text-center"><input type="checkbox" className="form-check-input" aria-label={`${x.nom} : ${t(lib)}`}
                  checked={x.droits.includes(k)} disabled={x.role === "admin"} onChange={() => droit(x, k)} /></td>)}
                <td>{x.personnalise && <button className="btn btn-link btn-sm p-0" onClick={() => defaut(x)}>{t("par défaut")}</button>}</td></tr>))}</tbody>
          </table></div>
        </div></section></div>
      </div>
    </>
  )
}
