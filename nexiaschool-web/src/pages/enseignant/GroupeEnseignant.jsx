// Administrateur d'un groupe de département : code du groupe (à partager), comptes des collègues et leurs codes personnels.
// Les codes ne sont affichés qu'une fois (ils sont conservés hachés côté serveur).
import { useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { dateHeure } from "../../lib/format.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { Copier } from "../SmartEval.jsx"

export default function GroupeEnseignant() {
  const { enseignant, recharger: rechargerSession } = useSession()
  const g = enseignant.groupe
  const [membres, erreur, recharger] = useDonnees(() => rpc("groupe_membres"), [])
  const [f, setF] = useState({ nom: "", prenom: "" }), [msg, setMsg] = useState({}), [codeGroupe, setCodeGroupe] = useState(""), [codes, setCodes] = useState([])
  if (!membres) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const action = async (fn) => { setMsg({}); try { await fn(); recharger(); rechargerSession() } catch (x) { setMsg({ erreur: x.message }) } }
  const actifs = membres.filter((m) => m.actif).length

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 className="h3 mb-1">{t("Mon groupe")}</h1>
      <p className="text-muted">{t("{v0} — matière : {v1} — {v2} membre(s) actif(s) sur {v3}.", { v0: g.nom, v1: g.matiere, v2: actifs, v3: g.membres_max })}</p>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte>
      {!g.periode && <div className="alert alert-warning">{t("L'abonnement du groupe n'est pas actif.")} <Link to="/enseignant/abonnement">{t("Mon abonnement")}</Link></div>}

      <div className="card mb-3"><div className="card-body">
        <h2 className="h5">{t("Code du groupe")}</h2>
        <p className="small text-muted">{t("Vos collègues saisissent ce code sur la page « Membre d'un groupe de département », choisissent leur nom puis saisissent leur code personnel. Générer un nouveau code invalide l'ancien.")}</p>
        {codeGroupe && <div className="input-group mb-2" style={{ maxWidth: 420 }}><input className="form-control font-monospace fw-bold" readOnly value={codeGroupe} aria-label={t("Code du groupe")} />
          <Copier texte={codeGroupe} libelle={t("Copier")} /></div>}
        <button className="btn btn-outline-primary" onClick={() => (!g.code_defini || confirm(t("Générer un nouveau code ? L'ancien ne fonctionnera plus.")))
          && action(async () => setCodeGroupe((await rpc("groupe_generer_code")).code))}>{g.code_defini ? t("Générer un nouveau code") : t("Générer le code du groupe")}</button>
      </div></div>

      <div className="card mb-3"><div className="card-body">
        <h2 className="h5">{t("Ajouter un collègue")}</h2>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); action(async () => { const r = await rpc("groupe_creer_membre", { p_nom: f.nom, p_prenom: f.prenom }); setCodes((c) => [r, ...c]); setF({ nom: "", prenom: "" }) }) }}>
          <div className="col-sm-5"><input className="form-control" required maxLength={100} placeholder={t("Nom")} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} aria-label={t("Nom")} /></div>
          <div className="col-sm-4"><input className="form-control" maxLength={100} placeholder={t("Prénom")} value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} aria-label={t("Prénom")} /></div>
          <div className="col-sm-3 d-grid"><button className="btn btn-primary" disabled={actifs >= g.membres_max}>{t("Créer le compte")}</button></div>
        </form>
        {codes.length > 0 && <div className="alert alert-warning mt-3 mb-0">
          <p className="small fw-semibold mb-1">{t("Codes personnels à transmettre (ils ne seront plus affichés) :")}</p>
          <ul className="mb-0">{codes.map((c) => <li key={c.id}>{c.nom} : <span className="font-monospace fw-bold">{c.code}</span></li>)}</ul>
        </div>}
      </div></div>

      <h2 className="h5">{t("Membres")}</h2>
      <div className="table-responsive"><table className="table table-sm align-middle">
        <thead><tr><th>{t("Nom")}</th><th>{t("Rôle")}</th><th className="text-end">{t("Évaluations publiées")}</th><th>{t("Dernière connexion")}</th><th /></tr></thead>
        <tbody>{membres.map((m) => <tr key={m.id} className={m.actif ? "" : "text-muted"}><td>{m.nom} {m.prenom}</td>
          <td>{m.role === "admin" ? t("Administrateur") : t("Membre")}{!m.actif && ` (${t("désactivé")})`}</td><td className="text-end">{m.publiees}</td>
          <td>{m.derniere_connexion ? dateHeure(m.derniere_connexion) : "—"}</td>
          <td className="text-end text-nowrap">{m.role === "membre" && <>
            <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => action(async () => { const r = await rpc("groupe_nouveau_code_membre", { p_id: m.id }); setCodes((c) => [{ id: m.id + Date.now(), nom: `${m.nom} ${m.prenom}`, code: r.code }, ...c]) })}>{t("Nouveau code")}</button>
            <button className="btn btn-sm btn-outline-danger" onClick={() => action(() => rpc("groupe_activer_membre", { p_id: m.id, p_actif: !m.actif }))}>{m.actif ? t("Désactiver") : t("Réactiver")}</button>
          </>}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}
