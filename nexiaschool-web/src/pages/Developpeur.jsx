import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { dateHeure, nomComplet } from "../lib/format.js"
import { URL_MCP } from "../lib/retour.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, verifier } from "../supabase.js"

function Copier({ texte, libelle = "Copier" }) {
  const [fait, setFait] = useState(false)
  return <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => navigator.clipboard?.writeText(texte).then(() => { setFait(true); setTimeout(() => setFait(false), 1500) })}>
    {fait ? "Copié ✓" : libelle}</button>
}

function Bloc({ texte }) {
  return <div className="position-relative"><pre className="bg-dark text-light rounded p-3 small mb-2" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{texte}</pre>
    <div className="position-absolute top-0 end-0 m-2"><Copier texte={texte} /></div></div>
}

const configurations = (cle) => ({
  claudeCode: `claude mcp add --transport http nexiaschool ${URL_MCP} --header "Authorization: Bearer ${cle}"`,
  json: JSON.stringify({ mcpServers: { nexiaschool: { type: "http", url: URL_MCP, headers: { Authorization: `Bearer ${cle}` } } } }, null, 2),
})

export default function Developpeur() {
  const { etablissement, estAdmin, profil, recharger } = useSession()
  const [msg, setMsg] = useState({}), [nouvelle, setNouvelle] = useState(null)
  const [f, setF] = useState({ nom: "", ecriture: false, jours: 90 })
  const [d, erreur, rafraichir] = useDonnees(async () => ({
    cles: verifier(await supabase.from("cles_api").select("*").order("cree_le", { ascending: false })),
    applis: verifier(await supabase.from("jetons_oauth").select("id, personnel_id, ecriture, cree_le, derniere_utilisation, revoque_le, rafraichissement_expire_le, oauth_clients(nom)")
      .is("revoque_le", null).gt("rafraichissement_expire_le", new Date().toISOString()).order("cree_le", { ascending: false })),
    journal: verifier(await supabase.from("journal_api").select("*").order("cree_le", { ascending: false }).limit(30)),
    noms: new Map(verifier(await supabase.from("personnels").select("id, nom, prenom")).map((p) => [p.id, nomComplet(p)])),
  }), [etablissement?.api_active])

  async function action(f, ok) {
    setMsg({})
    try { await f(); rafraichir(); if (ok) setMsg({ ok }) } catch (e) { setMsg({ erreur: e.message }) }
  }
  const activer = (v) => {
    if (!v && !confirm("Désactiver l'accès des agents IA ? Toutes les clés et applications autorisées seront révoquées.")) return
    action(async () => { await rpc("definir_api_active", { p_active: v }); await recharger() }, v ? "Accès des agents IA activé." : "Accès désactivé : clés et applications révoquées.")
  }
  const creer = (e) => { e.preventDefault(); action(async () => { setNouvelle({ ...(await rpc("creer_cle_api", { p_nom: f.nom, p_ecriture: f.ecriture, p_jours: Number(f.jours) })), nom: f.nom }); setF({ ...f, nom: "" }) }) }
  const revoquerCle = (k) => confirm(`Révoquer la clé « ${k.nom} » ? Les agents qui l'utilisent perdront l'accès.`) && action(() => rpc("revoquer_cle_api", { p_id: k.id }), "Clé révoquée.")
  const revoquerAppli = (j) => confirm("Retirer l'accès de cette application ?") && action(() => rpc("revoquer_jeton_oauth", { p_id: j.id }), "Accès retiré.")

  if (!d) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const actif = etablissement.api_active
  return (
    <>
      <h1 className="h3 mb-1">Espace développeur</h1>
      <p className="text-muted mb-3">Connectez NexIA School à Claude ou à un autre agent IA (protocole MCP) pour consulter les résultats, préparer des analyses,
        saisir des notes ou faire l'appel en langage naturel.</p>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>

      {estAdmin && (
        <div className={`card mb-3 ${actif ? "border-success" : "border-warning"}`}><div className="card-body">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div><h2 className="h6 mb-1">Accès des agents IA : {actif ? <span className="text-success">activé</span> : <span className="text-warning">désactivé</span>}</h2>
              <p className="small text-muted mb-0">Les données consultées par un agent IA (notes, noms d'élèves mineurs) sont transmises au fournisseur d'IA choisi par l'utilisateur.
                Activez cet accès seulement si votre établissement l'accepte. Chaque action d'écriture est inscrite au journal.</p></div>
            <button className={`btn ${actif ? "btn-outline-danger" : "btn-success"}`} onClick={() => activer(!actif)}>{actif ? "Désactiver" : "Activer l'accès"}</button>
          </div>
        </div></div>
      )}
      {!actif && !estAdmin && <div className="alert alert-warning">L'administration de l'établissement n'a pas activé l'accès des agents IA.</div>}

      {actif && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-lg-6"><div className="card h-100"><div className="card-body">
              <h2 className="h6">Connecter Claude.ai (sans clé)</h2>
              <ol className="small mb-2">
                <li>Dans Claude : <strong>Paramètres → Connecteurs → Ajouter un connecteur personnalisé</strong>.</li>
                <li>Nom : <code>NexIA School</code> ; adresse : <code>{URL_MCP}</code> <Copier texte={URL_MCP} /></li>
                <li>Cliquez sur <strong>Se connecter</strong> : NexIA School vous demande votre accord (lecture seule ou lecture et écriture).</li>
              </ol>
              <p className="small text-muted mb-0">Vos droits sont ceux de votre compte : un enseignant ne voit et ne note que ses classes et ses matières.</p>
            </div></div></div>
            <div className="col-lg-6"><div className="card h-100"><div className="card-body">
              <h2 className="h6">Créer une clé API (Claude Code, autres agents)</h2>
              <form className="row g-2 align-items-end" onSubmit={creer}>
                <div className="col-12"><label className="form-label small" htmlFor="kn">Nom de la clé</label>
                  <input className="form-control" id="kn" required maxLength={80} placeholder="ex. Claude Code — ordinateur du bureau" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></div>
                <div className="col-sm-6"><label className="form-label small" htmlFor="kd">Droits</label>
                  <select className="form-select" id="kd" value={f.ecriture ? "1" : "0"} onChange={(e) => setF({ ...f, ecriture: e.target.value === "1" })}>
                    <option value="0">Lecture seule</option><option value="1">Lecture et écriture</option></select></div>
                <div className="col-sm-6"><label className="form-label small" htmlFor="kj">Expiration</label>
                  <select className="form-select" id="kj" value={f.jours} onChange={(e) => setF({ ...f, jours: e.target.value })}>
                    <option value={30}>30 jours</option><option value={90}>90 jours</option><option value={365}>1 an</option><option value={0}>Jamais</option></select></div>
                <div className="col-12"><button className="btn btn-primary">Créer la clé</button></div>
              </form>
            </div></div></div>
          </div>

          {nouvelle && (
            <div className="card border-warning mb-3"><div className="card-body">
              <h2 className="h6">Clé « {nouvelle.nom} » créée</h2>
              <div className="alert alert-warning small py-2">Copiez-la maintenant : elle ne sera plus jamais affichée. Ne la partagez pas et ne la publiez nulle part.</div>
              <Bloc texte={nouvelle.cle} />
              <p className="small fw-semibold mb-1 mt-3">Claude Code :</p><Bloc texte={configurations(nouvelle.cle).claudeCode} />
              <p className="small fw-semibold mb-1">Autres agents (configuration MCP) :</p><Bloc texte={configurations(nouvelle.cle).json} />
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setNouvelle(null)}>Terminé</button>
            </div></div>
          )}

          <div className="card mb-3"><div className="card-header fw-semibold">{estAdmin ? "Clés API de l'établissement" : "Mes clés API"}</div>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0">
              <thead className="table-light"><tr><th>Nom</th><th>Clé</th>{estAdmin && <th>Propriétaire</th>}<th>Droits</th><th>Expire</th><th>Dernière utilisation</th><th>État</th><th /></tr></thead>
              <tbody>{d.cles.map((k) => { const expiree = k.expire_le && new Date(k.expire_le) < new Date(); return (
                <tr key={k.id} className={k.revoquee_le || expiree ? "text-muted" : ""}><td>{k.nom}</td><td className="font-monospace small">{k.prefixe}…</td>
                  {estAdmin && <td className="small">{d.noms.get(k.personnel_id)}</td>}
                  <td>{k.ecriture ? <span className="badge text-bg-warning">Lecture et écriture</span> : <span className="badge text-bg-light border">Lecture</span>}</td>
                  <td className="small">{k.expire_le ? dateHeure(k.expire_le) : "jamais"}</td><td className="small">{dateHeure(k.derniere_utilisation)}</td>
                  <td className="small">{k.revoquee_le ? "révoquée" : expiree ? "expirée" : "active"}</td>
                  <td className="text-end">{!k.revoquee_le && !expiree && (estAdmin || k.personnel_id === profil.id) && <button className="btn btn-sm btn-outline-danger" onClick={() => revoquerCle(k)}>Révoquer</button>}</td></tr>) })}
                {!d.cles.length && <tr><td colSpan={8} className="text-center text-muted py-3">Aucune clé.</td></tr>}</tbody>
            </table></div></div>

          <div className="card mb-3"><div className="card-header fw-semibold">Applications autorisées (Claude.ai…)</div>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0">
              <thead className="table-light"><tr><th>Application</th>{estAdmin && <th>Autorisée par</th>}<th>Droits</th><th>Autorisée le</th><th>Dernière utilisation</th><th /></tr></thead>
              <tbody>{d.applis.map((j) => (
                <tr key={j.id}><td>{j.oauth_clients?.nom || "Application"}</td>{estAdmin && <td className="small">{d.noms.get(j.personnel_id)}</td>}
                  <td>{j.ecriture ? "Lecture et écriture" : "Lecture"}</td><td className="small">{dateHeure(j.cree_le)}</td><td className="small">{dateHeure(j.derniere_utilisation)}</td>
                  <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => revoquerAppli(j)}>Retirer l'accès</button></td></tr>))}
                {!d.applis.length && <tr><td colSpan={6} className="text-center text-muted py-3">Aucune application autorisée.</td></tr>}</tbody>
            </table></div></div>
        </>
      )}

      <div className="card"><div className="card-header fw-semibold">Journal des actions effectuées par des agents IA</div>
        <div className="table-responsive"><table className="table table-sm mb-0">
          <thead className="table-light"><tr><th>Date</th><th>Personne</th><th>Origine</th><th>Action</th><th>Détails</th></tr></thead>
          <tbody>{d.journal.map((l) => <tr key={l.id}><td className="small">{dateHeure(l.cree_le)}</td><td className="small">{d.noms.get(l.personnel_id)}</td><td className="small">{l.source}</td>
            <td>{l.outil}</td><td className="small text-muted">{Object.entries(l.details).map(([k, v]) => `${k} : ${v}`).join(" · ")}</td></tr>)}
            {!d.journal.length && <tr><td colSpan={5} className="text-center text-muted py-3">Aucune action pour l'instant.</td></tr>}</tbody>
        </table></div></div>
    </>
  )
}
