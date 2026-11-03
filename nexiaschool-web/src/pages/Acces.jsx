import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Alerte, Chargement, FicheCode } from "../composants/Communs.jsx"
import { enregistrerAppareil, lireAppareil, oublierAppareil } from "../lib/appareil.js"
import { comparerNoms } from "../lib/format.js"
import { rpc, supabase } from "../supabase.js"
import { useSession } from "../Session.jsx"

function Carte({ titre, children }) {
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0">
      <div className="col-sm-10 col-md-7 col-lg-5 col-xl-4">
        <div className="card shadow-sm">
          <div className="card-body p-4">
            <h1 className="h4 mb-1 text-primary">NexIASchool</h1>
            <p className="text-muted mb-4">{titre}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Étape 1 : nom et code de l'établissement ---------------------------------------------------------------
export function Etablissement() {
  const naviguer = useNavigate()
  const appareil = lireAppareil()
  const [nom, setNom] = useState(""), [code, setCode] = useState("")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)

  async function valider(e) {
    e.preventDefault()
    setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("ouvrir_etablissement", { p_nom: nom, p_code: code })
      if (r.erreur) return setErreur(r.erreur)
      enregistrerAppareil(r.etablissement, r.jeton)
      naviguer("/connexion")
    } catch (err) { setErreur(err.message) } finally { setEnvoi(false) }
  }

  return (
    <Carte titre="Accédez à l'espace de votre établissement">
      <Alerte>{erreur}</Alerte>
      {appareil && !erreur && (
        <div className="alert alert-light border small">Établissement choisi sur cet appareil : <strong>{appareil.etablissement}</strong>.{" "}
          <Link to="/connexion">Continuer vers la connexion</Link></div>
      )}
      <form onSubmit={valider}>
        <div className="mb-3">
          <label className="form-label" htmlFor="nom">Nom de mon établissement</label>
          <input className="form-control" id="nom" value={nom} onChange={(e) => setNom(e.target.value)} required maxLength={200}
                 autoComplete="organization" placeholder="ex. Collège Saint-Joseph" autoFocus />
        </div>
        <div className="mb-4">
          <label className="form-label" htmlFor="code">Code de mon établissement</label>
          <input className="form-control font-monospace" id="code" type="password" value={code} onChange={(e) => setCode(e.target.value)}
                 required autoComplete="off" autoCapitalize="off" spellCheck="false" placeholder="Code remis par l'administration" />
        </div>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? "Vérification…" : "Entrer dans l'espace de l'établissement"}</button>
      </form>
      <p className="small text-muted mt-3">Étape suivante : choisissez votre nom dans la liste du personnel, puis saisissez votre code personnel.</p>
      <hr />
      <p className="small mb-0">Nouvel établissement ? <Link to="/inscription">Inscrire mon établissement</Link></p>
    </Carte>
  )
}

// --- Inscription d'un nouvel établissement ------------------------------------------------------------------
export function Inscription() {
  const naviguer = useNavigate()
  const [f, setF] = useState({ nom: "", ville: "", admin_nom: "", admin_prenom: "" })
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [resultat, setResultat] = useState(null)
  const champ = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) })

  async function valider(e) {
    e.preventDefault()
    setErreur(""); setEnvoi(true)
    try {
      setResultat(await rpc("inscrire_etablissement", { p_nom: f.nom, p_ville: f.ville, p_admin_nom: f.admin_nom, p_admin_prenom: f.admin_prenom }))
    } catch (err) { setErreur(err.message) } finally { setEnvoi(false) }
  }

  async function continuer() {
    const r = await rpc("ouvrir_etablissement", { p_nom: resultat.etablissement, p_code: resultat.code_etablissement })
    if (r.jeton) enregistrerAppareil(r.etablissement, r.jeton)
    naviguer("/connexion")
  }

  if (resultat) return (
    <div className="container py-4" style={{ maxWidth: 720 }}>
      <h1 className="h4 mb-3">Établissement inscrit : {resultat.etablissement}</h1>
      <FicheCode titre="Code de l'établissement" sousTitre="À communiquer à tout le personnel de l'établissement"
                 code={resultat.code_etablissement}
                 consignes={["Sur NexIASchool, saisissez le nom de l'établissement et ce code.", "Choisissez ensuite votre nom et saisissez votre code personnel."]} />
      <FicheCode titre={`Code personnel de ${resultat.administrateur}`} sousTitre="Administration — strictement personnel"
                 code={resultat.code_personnel} />
      <button className="btn btn-success no-print" onClick={continuer}>J'ai noté les deux codes : continuer vers la connexion</button>
    </div>
  )

  return (
    <Carte titre="Inscrire un nouvel établissement">
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="n">Nom de l'établissement</label>
          <input className="form-control" id="n" required minLength={3} maxLength={200} {...champ("nom")} autoFocus /></div>
        <div className="mb-3"><label className="form-label" htmlFor="v">Ville</label>
          <input className="form-control" id="v" maxLength={100} {...champ("ville")} /></div>
        <div className="row g-2 mb-4">
          <div className="col"><label className="form-label" htmlFor="an">Nom de l'administrateur</label>
            <input className="form-control" id="an" required maxLength={150} {...champ("admin_nom")} /></div>
          <div className="col"><label className="form-label" htmlFor="ap">Prénom</label>
            <input className="form-control" id="ap" maxLength={150} {...champ("admin_prenom")} /></div>
        </div>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? "Inscription…" : "Inscrire l'établissement"}</button>
      </form>
      <p className="small text-muted mt-3 mb-0">Deux codes s'afficheront une seule fois : celui de l'établissement et votre code personnel.
        <br /><Link to="/etablissement">Retour</Link></p>
    </Carte>
  )
}

// --- Étape 2 : nom du personnel et code personnel ----------------------------------------------------------
export function Connexion() {
  const naviguer = useNavigate()
  const { session, profil } = useSession()
  const appareil = lireAppareil()
  const [liste, setListe] = useState(null)
  const [choisi, setChoisi] = useState(""), [code, setCode] = useState("")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    if (session && profil) { naviguer("/"); return }
    if (!appareil) { naviguer("/etablissement"); return }
    rpc("personnels_etablissement", { p_jeton: appareil.jeton }).then((r) => {
      if (r.erreur) { oublierAppareil(); naviguer("/etablissement"); return }
      setListe([...r.personnels].sort((a, b) => comparerNoms(a.nom, b.nom)))
    }).catch((e) => setErreur(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profil])

  async function valider(e) {
    e.preventDefault()
    if (!choisi) return setErreur("Choisissez votre nom dans la liste.")
    setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("connexion_personnel", { p_jeton: appareil.jeton, p_personnel: choisi, p_code: code })
      if (r.erreur === "jeton") { oublierAppareil(); return naviguer("/etablissement") }
      if (r.erreur) { setCode(""); return setErreur(r.erreur) }
      const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: r.secret })
      if (error) return setErreur("Connexion impossible pour le moment. Réessayez.")
      naviguer("/")
    } catch (err) { setErreur(err.message) } finally { setEnvoi(false) }
  }

  function changer() { oublierAppareil(); naviguer("/etablissement") }

  if (!appareil) return null
  return (
    <Carte titre="Connexion du personnel">
      <p className="fw-semibold mb-0">{appareil.etablissement}</p>
      <button className="btn btn-link btn-sm p-0 mb-3" onClick={changer}>Changer d'établissement</button>
      <Alerte>{erreur}</Alerte>
      {liste === null ? <Chargement /> : (
        <form onSubmit={valider}>
          <div className="mb-3">
            <label className="form-label" htmlFor="personnel">Nom du personnel</label>
            <select className="form-select" id="personnel" value={choisi} onChange={(e) => setChoisi(e.target.value)} required autoFocus>
              <option value="">Choisissez votre nom…</option>
              {liste.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </div>
          <div className="mb-4">
            <label className="form-label" htmlFor="code">Code d'accès</label>
            <input className="form-control font-monospace" id="code" type="password" value={code} onChange={(e) => setCode(e.target.value)}
                   required autoComplete="current-password" autoCapitalize="off" spellCheck="false" placeholder="6 caractères, ex. 6e0k39" />
          </div>
          <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? "Connexion…" : "Se connecter"}</button>
        </form>
      )}
      <p className="small text-muted mt-3 mb-0">Code oublié ou perdu ? Demandez-en un nouveau à l'administration.</p>
    </Carte>
  )
}
