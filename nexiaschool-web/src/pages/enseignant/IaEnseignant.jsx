// IA & API de l'enseignant indépendant : connexion de SON assistant IA (Claude, ChatGPT, Grok…) au serveur MCP de NexIA School,
// par OAuth ou par clé personnelle « nxe_ ». L'accès est limité, en lecture seule, à ses propres évaluations. Aucune IA n'est
// payée par NexIA : l'analyse se fait avec le compte IA de l'enseignant.
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { dateHeure, date } from "../../lib/format.js"
import { URL_MCP } from "../../lib/retour.js"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { Copier } from "../SmartEval.jsx"

export default function IaEnseignant() {
  const [d, erreur, recharger] = useDonnees(() => rpc("enseignant_ia"), [])
  const [libelle, setLibelle] = useState(""), [cle, setCle] = useState(null), [msg, setMsg] = useState({})
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  async function creer(e) {
    e.preventDefault(); setMsg({})
    try { setCle(await rpc("enseignant_ia_creer_cle", { p_libelle: libelle })); setLibelle(""); recharger() } catch (x) { setMsg({ erreur: x.message }) }
  }
  async function revoquer(id) {
    if (!confirm(t("Révoquer cet accès ? L'assistant concerné ne pourra plus lire vos évaluations."))) return
    setMsg({})
    try { await rpc("enseignant_ia_revoquer", { p_id: id }); setMsg({ ok: t("Accès révoqué.") }); recharger() } catch (x) { setMsg({ erreur: x.message }) }
  }
  return (
    <div style={{ maxWidth: 900 }}>
      <h1 className="h3 mb-1">{t("IA & API")}</h1>
      <p className="text-muted">{t("Connectez votre propre assistant IA à vos évaluations SmartEval. Il pourra lister vos évaluations et lire les réponses de vos élèves (anonymisées si vous l'avez demandé), en lecture seule, et rien d'autre.")}</p>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="alert alert-light border small">{t("Coûts : NexIA School n'appelle aucune IA payante pour vous. L'analyse est faite par l'assistant de votre choix, avec votre propre compte (gratuit ou payant selon votre fournisseur).")}</div>

      <div className="card mb-3"><div className="card-body">
        <h2 className="h5">{t("1. Connexion recommandée (Claude, ChatGPT…)")}</h2>
        <p className="small mb-2">{t("Dans votre assistant, ajoutez un connecteur personnalisé avec cette adresse, puis connectez-vous avec votre compte SmartEval lorsque la page d'autorisation s'ouvre :")}</p>
        <div className="input-group mb-2"><input className="form-control font-monospace" readOnly value={URL_MCP} aria-label={t("Adresse du connecteur")} onFocus={(e) => e.target.select()} />
          <Copier texte={URL_MCP} libelle={t("Copier")} /></div>
      </div></div>

      <div className="card mb-3"><div className="card-body">
        <h2 className="h5">{t("2. Clé personnelle (autres assistants)")}</h2>
        <form className="d-flex flex-wrap gap-2 mb-2" onSubmit={creer}>
          <input className="form-control" style={{ maxWidth: 320 }} maxLength={60} placeholder={t("Nom de l'accès (ex. Grok)")} value={libelle} onChange={(e) => setLibelle(e.target.value)} aria-label={t("Nom de l'accès")} />
          <button className="btn btn-primary">{t("Créer une clé")}</button>
        </form>
        {cle && <div className="alert alert-warning">
          <p className="small fw-semibold mb-1">{t("Copiez cette clé maintenant : elle ne sera plus jamais affichée. Valable jusqu'au {v0}.", { v0: date(cle.expire_le) })}</p>
          <div className="input-group"><input className="form-control font-monospace" readOnly value={cle.cle} aria-label={t("Clé")} onFocus={(e) => e.target.select()} />
            <Copier texte={cle.cle} libelle={t("Copier")} /></div>
          <p className="small mb-0 mt-2">{t("À utiliser comme jeton « Bearer » avec l'adresse du connecteur ci-dessus.")}</p>
        </div>}
      </div></div>

      <h2 className="h5">{t("Accès actifs")}</h2>
      {!d.acces.length ? <p className="text-muted">{t("Aucun accès actif.")}</p> : (
        <div className="table-responsive mb-4"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Accès")}</th><th>{t("Type")}</th><th>{t("Créé le")}</th><th>{t("Expire le")}</th><th>{t("Dernière utilisation")}</th><th /></tr></thead>
          <tbody>{d.acces.map((a) => <tr key={a.id}><td>{a.libelle || "—"}</td><td>{a.type === "cle" ? t("Clé") : "OAuth"}</td><td>{date(a.cree_le)}</td>
            <td>{date(a.expire_le)}</td><td>{a.derniere_utilisation ? dateHeure(a.derniere_utilisation) : "—"}</td>
            <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => revoquer(a.id)}>{t("Révoquer")}</button></td></tr>)}</tbody>
        </table></div>)}

      <h2 className="h5">{t("Journal des appels")}</h2>
      {!d.journal.length ? <p className="text-muted">{t("Aucun appel pour le moment.")}</p> : (
        <ul className="list-unstyled small">{d.journal.map((j, k) => <li key={k}>{dateHeure(j.le)} · <code>{j.outil}</code>{j.erreur && <span className="text-danger"> · {j.erreur}</span>}</li>)}</ul>)}
    </div>
  )
}
