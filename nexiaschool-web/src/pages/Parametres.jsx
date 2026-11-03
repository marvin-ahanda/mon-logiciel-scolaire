import { useState } from "react"
import { NavLink, Route, Routes } from "react-router-dom"
import { Alerte, Chargement, FicheCode, useDonnees } from "../composants/Communs.jsx"
import { exerciceParDefaut, nomComplet, comparerNoms } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"

export default function Parametres() {
  const onglet = ({ isActive }) => "nav-link" + (isActive ? " active" : "")
  return (
    <>
      <h1 className="h3 mb-3">Paramètres</h1>
      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        <li className="nav-item"><NavLink className={onglet} to="/parametres" end>Établissement</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/exercices">Exercices et séquences</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/classes">Classes</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/matieres">Matières</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/coefficients">Matières par classe</NavLink></li>
      </ul>
      <Routes>
        <Route index element={<Etablissement />} />
        <Route path="exercices" element={<Exercices />} />
        <Route path="classes" element={<Classes />} />
        <Route path="matieres" element={<Matieres />} />
        <Route path="coefficients" element={<Coefficients />} />
      </Routes>
    </>
  )
}

// --- Établissement ------------------------------------------------------------------------------------------
function Etablissement() {
  const { etablissement, recharger } = useSession()
  const [f, setF] = useState(() => ({ ville: etablissement.ville, adresse: etablissement.adresse, telephone: etablissement.telephone,
                                      devise: etablissement.devise, nom_chef: etablissement.nom_chef }))
  const [msg, setMsg] = useState({}), [code, setCode] = useState(null)
  const champ = (k, lib, max) => (
    <div className="col-md-6 mb-3"><label className="form-label" htmlFor={k}>{lib}</label>
      <input className="form-control" id={k} maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)

  async function enregistrer(e) {
    e.preventDefault()
    try {
      verifier(await supabase.from("etablissements").update(f).eq("id", etablissement.id))
      await recharger(); setMsg({ ok: "Informations enregistrées." })
    } catch (err) { setMsg({ erreur: err.message }) }
  }
  async function nouveauCode() {
    if (!confirm("Générer un nouveau code d'établissement ? L'ancien ne fonctionnera plus et tous les appareils devront saisir le nouveau.")) return
    try { setCode((await rpc("nouveau_code_etablissement")).code) } catch (err) { setMsg({ erreur: err.message }) }
  }

  return (
    <>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      {code && <FicheCode titre={`Nouveau code de l'établissement — ${etablissement.nom}`} code={code} onTerminer={() => setCode(null)}
                          consignes={["Communiquez ce code au personnel de l'établissement uniquement.", "Chacun garde son code personnel."]} />}
      <form className="card card-body mb-3" onSubmit={enregistrer} style={{ maxWidth: 820 }}>
        <h2 className="h6">{etablissement.nom}</h2>
        <div className="row">{champ("ville", "Ville", 100)}{champ("telephone", "Téléphone", 50)}{champ("adresse", "Adresse", 200)}
          {champ("nom_chef", "Chef d'établissement", 150)}{champ("devise", "Devise", 200)}</div>
        <div><button className="btn btn-primary">Enregistrer</button></div>
      </form>
      <div className="card card-body" style={{ maxWidth: 820 }}>
        <h2 className="h6">Code de l'établissement</h2>
        <p className="small text-muted mb-2">Généré le {new Date(etablissement.code_genere_le).toLocaleString("fr-FR")}. Il est enregistré chiffré et ne peut pas être relu.
          Changez-le par exemple après le départ d'un membre du personnel.</p>
        <div><button className="btn btn-warning" onClick={nouveauCode}>Générer un nouveau code d'établissement</button></div>
      </div>
    </>
  )
}

// --- Exercices et séquences ---------------------------------------------------------------------------------
function Exercices() {
  const { recharger } = useSession()
  const [libelle, setLibelle] = useState(exerciceParDefaut()), [erreur, setErreur] = useState("")
  const [donnees, erreurChargement, rafraichir] = useDonnees(async () => ({
    exercices: verifier(await supabase.from("exercices").select("*").order("libelle", { ascending: false })),
    sequences: verifier(await supabase.from("sequences").select("*").order("numero")),
  }), [])

  async function action(f) {
    setErreur("")
    try { await f(); rafraichir(); await recharger() } catch (err) { setErreur(err.message) }
  }
  const creer = (e) => { e.preventDefault(); action(async () => verifier(await supabase.from("exercices").insert({ libelle, actif: true }))) }
  const activer = (ex) => action(async () => verifier(await supabase.from("exercices").update({ actif: true }).eq("id", ex.id)))
  const verrou = (s) => action(async () => verifier(await supabase.from("sequences").update({ verrouillee: !s.verrouillee }).eq("id", s.id)))

  if (!donnees) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <Alerte>{erreur}</Alerte>
      <form className="d-flex flex-wrap gap-2 mb-3" onSubmit={creer}>
        <input className="form-control" style={{ maxWidth: 200 }} value={libelle} onChange={(e) => setLibelle(e.target.value)}
               pattern="[0-9]{4}-[0-9]{4}" title="Format : 2026-2027" required aria-label="Nouvel exercice" />
        <button className="btn btn-primary">Créer et activer l'exercice</button>
      </form>
      {donnees.exercices.map((ex) => (
        <div className="card mb-3" key={ex.id}><div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h2 className="h6 m-0">Exercice {ex.libelle} {ex.actif && <span className="badge text-bg-success">actif</span>}</h2>
            {!ex.actif && <button className="btn btn-sm btn-outline-primary" onClick={() => activer(ex)}>Activer</button>}
          </div>
          <div className="d-flex flex-wrap gap-2">
            {donnees.sequences.filter((s) => s.exercice_id === ex.id).map((s) => (
              <button key={s.id} className={`btn btn-sm ${s.verrouillee ? "btn-secondary" : "btn-outline-secondary"}`} onClick={() => verrou(s)}
                      title={s.verrouillee ? "Séquence verrouillée : cliquer pour rouvrir la saisie" : "Cliquer pour verrouiller la saisie"}>
                Séquence {s.numero} (T{s.trimestre}) {s.verrouillee ? "🔒" : ""}
              </button>
            ))}
          </div>
        </div></div>
      ))}
      <p className="small text-muted">Chaque exercice compte six séquences (deux par trimestre). Une séquence verrouillée n'accepte plus de saisie ni de correction.</p>
    </>
  )
}

// --- Liste éditable générique (classes, matières) -----------------------------------------------------------
function ListeEditable({ table, colonnes, vide, ordre }) {
  const [edition, setEdition] = useState(null), [erreur, setErreur] = useState("")
  const [lignes, erreurChargement, rafraichir] = useDonnees(async () => verifier(await supabase.from(table).select("*").order(ordre[0]).order(ordre[1])), [])

  async function enregistrer(e) {
    e.preventDefault(); setErreur("")
    const valeurs = Object.fromEntries(colonnes.map((c) => [c.cle, c.nombre ? Number(edition[c.cle] || 0) : String(edition[c.cle] ?? "").trim()]))
    try {
      verifier(edition.id ? await supabase.from(table).update(valeurs).eq("id", edition.id) : await supabase.from(table).insert(valeurs))
      setEdition(null); rafraichir()
    } catch (err) { setErreur(err.message) }
  }
  async function supprimer(l) {
    if (!confirm("Supprimer cet élément ?")) return
    try { verifier(await supabase.from(table).delete().eq("id", l.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }

  if (!lignes) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <Alerte>{erreur}</Alerte>
      {edition ? (
        <form className="card card-body mb-3" onSubmit={enregistrer} style={{ maxWidth: 820 }}>
          <div className="row g-2">
            {colonnes.map((c) => (
              <div className="col-md" key={c.cle}><label className="form-label" htmlFor={c.cle}>{c.libelle}</label>
                <input className="form-control" id={c.cle} type={c.nombre ? "number" : "text"} min={c.nombre ? 0 : undefined}
                       required={c.requis} maxLength={c.max} value={edition[c.cle] ?? ""} onChange={(e) => setEdition({ ...edition, [c.cle]: e.target.value })} />
                {c.aide && <div className="form-text">{c.aide}</div>}</div>))}
          </div>
          <div className="d-flex gap-2 mt-3"><button className="btn btn-primary">Enregistrer</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEdition(null)}>Annuler</button></div>
        </form>
      ) : <button className="btn btn-primary mb-3" onClick={() => setEdition({ ...vide })}>+ Ajouter</button>}
      <div className="card" style={{ maxWidth: 820 }}><div className="table-responsive"><table className="table table-hover align-middle mb-0">
        <thead className="table-light"><tr>{colonnes.map((c) => <th key={c.cle}>{c.libelle}</th>)}<th /></tr></thead>
        <tbody>{lignes.map((l) => (
          <tr key={l.id}>{colonnes.map((c) => <td key={c.cle}>{l[c.cle]}</td>)}
            <td className="text-end text-nowrap"><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEdition(l)}>Modifier</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => supprimer(l)}>Supprimer</button></td></tr>))}
          {!lignes.length && <tr><td colSpan={colonnes.length + 1} className="text-center text-muted py-3">Aucun élément.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

const Classes = () => <ListeEditable table="classes" ordre={["ordre", "libelle"]} vide={{ libelle: "", niveau: "", ordre: 0, coef_min: 0 }}
  colonnes={[{ cle: "libelle", libelle: "Classe", requis: true, max: 50 }, { cle: "niveau", libelle: "Niveau", max: 50 },
             { cle: "ordre", libelle: "Ordre d'affichage", nombre: true },
             { cle: "coef_min", libelle: "Coef. minimum pour être classé", nombre: true, aide: "0 = toujours classé" }]} />

const Matieres = () => <ListeEditable table="matieres" ordre={["libelle", "code"]} vide={{ code: "", libelle: "" }}
  colonnes={[{ cle: "code", libelle: "Code", requis: true, max: 15 }, { cle: "libelle", libelle: "Matière", requis: true, max: 100 }]} />

// --- Matières par classe (attributions) ---------------------------------------------------------------------
function Coefficients() {
  const { exercice } = useSession()
  const [classeId, setClasseId] = useState(""), [erreur, setErreur] = useState(""), [ajout, setAjout] = useState(null)
  const [ref] = useDonnees(async () => ({
    classes: verifier(await supabase.from("classes").select("id, libelle").order("ordre").order("libelle")),
    matieres: verifier(await supabase.from("matieres").select("id, code, libelle").order("libelle")),
    enseignants: verifier(await supabase.from("personnels").select("id, nom, prenom").eq("actif", true)).sort((a, b) => comparerNoms(nomComplet(a), nomComplet(b))),
  }), [])
  const [attributions, , rafraichir] = useDonnees(async () => !classeId || !exercice ? [] :
    await toutCharger(() => supabase.from("attributions").select("*, matieres(code, libelle)").eq("classe_id", classeId).eq("exercice_id", exercice.id)), [classeId, exercice?.id])

  async function maj(a, champs) {
    setErreur("")
    try { verifier(await supabase.from("attributions").update(champs).eq("id", a.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }
  async function ajouter(e) {
    e.preventDefault(); setErreur("")
    try {
      verifier(await supabase.from("attributions").insert({ exercice_id: exercice.id, classe_id: classeId, matiere_id: ajout.matiere_id,
        enseignant_id: ajout.enseignant_id || null, coefficient: Number(ajout.coefficient), groupe: Number(ajout.groupe) }))
      setAjout(null); rafraichir()
    } catch (err) { setErreur(err.message) }
  }
  async function retirer(a) {
    if (!confirm(`Retirer ${a.matieres.libelle} de cette classe ? Les notes de cette matière seront supprimées.`)) return
    try { verifier(await supabase.from("attributions").delete().eq("id", a.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }

  if (!exercice) return <div className="alert alert-warning">Activez d'abord un exercice.</div>
  if (!ref) return <Chargement />
  const dejaPrises = new Set((attributions || []).map((a) => a.matiere_id))
  return (
    <>
      <Alerte>{erreur}</Alerte>
      <select className="form-select mb-3" style={{ maxWidth: 320 }} value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label="Classe">
        <option value="">Choisissez une classe…</option>{ref.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </select>
      {classeId && attributions && (
        <>
          <div className="card mb-3"><div className="table-responsive"><table className="table align-middle mb-0">
            <thead className="table-light"><tr><th>Matière</th><th>Enseignant</th><th>Coefficient</th><th>Groupe</th><th /></tr></thead>
            <tbody>{[...attributions].sort((a, b) => a.groupe - b.groupe || comparerNoms(a.matieres.libelle, b.matieres.libelle)).map((a) => (
              <tr key={a.id}><td>{a.matieres.libelle}</td>
                <td><select className="form-select form-select-sm" value={a.enseignant_id || ""} onChange={(e) => maj(a, { enseignant_id: e.target.value || null })} aria-label="Enseignant">
                  <option value="">—</option>{ref.enseignants.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}</option>)}</select></td>
                <td><input className="form-control form-control-sm" type="number" min={1} max={20} defaultValue={a.coefficient} style={{ width: 80 }}
                           onBlur={(e) => Number(e.target.value) !== a.coefficient && maj(a, { coefficient: Number(e.target.value) })} aria-label="Coefficient" /></td>
                <td><select className="form-select form-select-sm" value={a.groupe} onChange={(e) => maj(a, { groupe: Number(e.target.value) })} aria-label="Groupe">
                  {[1, 2, 3].map((g) => <option key={g} value={g}>Groupe {g}</option>)}</select></td>
                <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => retirer(a)}>Retirer</button></td></tr>))}
              {!attributions.length && <tr><td colSpan={5} className="text-center text-muted py-3">Aucune matière pour cette classe.</td></tr>}</tbody>
          </table></div></div>
          {ajout ? (
            <form className="card card-body" onSubmit={ajouter} style={{ maxWidth: 820 }}><div className="row g-2 align-items-end">
              <div className="col-md-4"><label className="form-label" htmlFor="am">Matière</label>
                <select className="form-select" id="am" required value={ajout.matiere_id} onChange={(e) => setAjout({ ...ajout, matiere_id: e.target.value })}>
                  <option value="">…</option>{ref.matieres.filter((m) => !dejaPrises.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</select></div>
              <div className="col-md-4"><label className="form-label" htmlFor="ae">Enseignant</label>
                <select className="form-select" id="ae" value={ajout.enseignant_id} onChange={(e) => setAjout({ ...ajout, enseignant_id: e.target.value })}>
                  <option value="">—</option>{ref.enseignants.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}</option>)}</select></div>
              <div className="col-md-2"><label className="form-label" htmlFor="ac">Coef.</label>
                <input className="form-control" id="ac" type="number" min={1} max={20} required value={ajout.coefficient} onChange={(e) => setAjout({ ...ajout, coefficient: e.target.value })} /></div>
              <div className="col-md-2"><label className="form-label" htmlFor="ag">Groupe</label>
                <select className="form-select" id="ag" value={ajout.groupe} onChange={(e) => setAjout({ ...ajout, groupe: e.target.value })}>{[1, 2, 3].map((g) => <option key={g}>{g}</option>)}</select></div>
            </div><div className="d-flex gap-2 mt-3"><button className="btn btn-primary">Ajouter</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setAjout(null)}>Annuler</button></div></form>
          ) : <button className="btn btn-primary" onClick={() => setAjout({ matiere_id: "", enseignant_id: "", coefficient: 2, groupe: 1 })}>+ Ajouter une matière à la classe</button>}
        </>
      )}
    </>
  )
}
