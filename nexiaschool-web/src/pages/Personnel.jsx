import { useState } from "react"
import { Alerte, Chargement, FicheCode, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, dateHeure, nomComplet } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { COLONNES_PERSONNEL } from "../lib/colonnes.js"
import { rpc, supabase, verifier } from "../supabase.js"

const VIDE = { nom: "", prenom: "", role: "enseignant", matricule: "", telephone: "", actif: true }
const ROLES = { admin: "Administration", enseignant: "Enseignant", surveillant: "Surveillant général", comptable: "Comptable / caissier" }

export default function Personnel() {
  const { profil, etablissement, recharger } = useSession()
  const [edition, setEdition] = useState(null), [erreur, setErreur] = useState(""), [fiche, setFiche] = useState(null)
  const [liste, erreurChargement, rafraichir] = useDonnees(async () =>
    verifier(await supabase.from("personnels").select(COLONNES_PERSONNEL)).sort((a, b) => b.actif - a.actif || comparerNoms(nomComplet(a), nomComplet(b))), [])
  const champ = (k) => ({ value: edition[k], onChange: (e) => setEdition({ ...edition, [k]: e.target.value }) })

  async function enregistrer(e) {
    e.preventDefault(); setErreur("")
    try {
      if (edition.id) {
        await rpc("modifier_personnel", { p_id: edition.id, p_nom: edition.nom, p_prenom: edition.prenom, p_role: edition.role,
                                          p_actif: edition.actif, p_matricule: edition.matricule, p_telephone: edition.telephone })
        if (edition.id === profil.id) await recharger()
      } else {
        const r = await rpc("creer_personnel", { p_nom: edition.nom, p_prenom: edition.prenom, p_role: edition.role,
                                                 p_matricule: edition.matricule, p_telephone: edition.telephone })
        setFiche({ nom: r.nom, role: ROLES[edition.role], code: r.code })
      }
      setEdition(null); rafraichir()
    } catch (err) { setErreur(err.message) }
  }
  async function nouveauCode(p) {
    if (!confirm(`Générer un nouveau code pour ${nomComplet(p)} ? L'ancien ne fonctionnera plus.`)) return
    try { const r = await rpc("nouveau_code_personnel", { p_id: p.id }); setFiche({ nom: nomComplet(p), role: ROLES[p.role], code: r.code }) }
    catch (err) { setErreur(err.message) }
  }

  if (!liste) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2 no-print">
        <h1 className="h3 m-0">Personnel et codes d'accès</h1>
        {!edition && <button className="btn btn-primary" onClick={() => setEdition({ ...VIDE })}>+ Nouveau membre du personnel</button>}
      </div>
      <p className="text-muted small no-print">Chacun se connecte en choisissant son nom dans la liste, puis en saisissant son code personnel
        (6 caractères, généré automatiquement). Les codes sont enregistrés chiffrés : en cas de perte, générez-en un nouveau.</p>
      <Alerte>{erreur}</Alerte>
      {fiche && <FicheCode titre={fiche.nom} sousTitre={`${fiche.role} — ${etablissement.nom}`} code={fiche.code} onTerminer={() => setFiche(null)}
                           consignes={["Sur la page de connexion, choisissez votre nom dans la liste.", "Saisissez ce code dans le champ « Code d'accès »."]} />}
      {edition && (
        <form className="card card-body mb-3 no-print" onSubmit={enregistrer} style={{ maxWidth: 820 }}>
          <h2 className="h6">{edition.id ? `Modifier ${nomComplet(edition)}` : "Nouveau membre du personnel"}</h2>
          <div className="row g-2">
            <div className="col-md-6"><label className="form-label" htmlFor="pn">Nom</label><input className="form-control" id="pn" required maxLength={150} {...champ("nom")} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="pp">Prénom</label><input className="form-control" id="pp" maxLength={150} {...champ("prenom")} /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="pr">Rôle</label>
              <select className="form-select" id="pr" {...champ("role")}><option value="enseignant">Enseignant (ses notes)</option><option value="surveillant">Surveillant général (discipline)</option><option value="comptable">Comptable / caissier (finances)</option>
                <option value="admin">Administration (tous les droits)</option></select></div>
            <div className="col-md-4"><label className="form-label" htmlFor="pm">Matricule</label><input className="form-control" id="pm" maxLength={30} {...champ("matricule")} /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="pt">Téléphone</label><input className="form-control" id="pt" maxLength={30} {...champ("telephone")} /></div>
            {edition.id && <div className="col-12 form-check ms-2"><input className="form-check-input" type="checkbox" id="pa" checked={edition.actif}
              onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} /><label className="form-check-label" htmlFor="pa">Compte actif (un compte inactif ne peut plus se connecter)</label></div>}
          </div>
          {!edition.id && <p className="small text-muted mt-2 mb-0">Le code d'accès est généré automatiquement et s'affiche une seule fois.</p>}
          <div className="d-flex gap-2 mt-3"><button className="btn btn-primary">Enregistrer</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEdition(null)}>Annuler</button></div>
        </form>
      )}
      <div className="card no-print"><div className="table-responsive"><table className="table table-hover align-middle mb-0">
        <thead className="table-light"><tr><th>Nom</th><th>Rôle</th><th>État</th><th>Code généré le</th><th>Dernière connexion</th><th /></tr></thead>
        <tbody>{liste.map((p) => (
          <tr key={p.id} className={p.actif ? "" : "text-muted"}><td>{nomComplet(p)}{p.matricule && <div className="small text-muted">{p.matricule}</div>}</td>
            <td><span className={`badge ${p.role === "admin" ? "text-bg-primary" : p.role === "surveillant" ? "text-bg-warning" : p.role === "comptable" ? "text-bg-success" : "text-bg-info"}`}>{ROLES[p.role]}</span>
              {p.compte_google && <span className="badge text-bg-light border ms-1" title="Se connecte avec son compte Google, sans code">Google</span>}</td>
            <td>{p.actif ? "actif" : "désactivé"}</td><td>{p.compte_google ? "—" : dateHeure(p.code_genere_le)}</td><td>{dateHeure(p.derniere_connexion)}</td>
            <td className="text-end text-nowrap">{p.actif && !p.compte_google && <button className="btn btn-sm btn-outline-warning me-1" onClick={() => nouveauCode(p)}>Nouveau code</button>}
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setEdition({ ...p })}>Modifier</button></td></tr>))}</tbody>
      </table></div></div>
    </>
  )
}
