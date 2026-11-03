import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Alerte, Chargement, FicheCode } from "../composants/Communs.jsx"
import { enregistrerAppareil, lireAppareil, oublierAppareil } from "../lib/appareil.js"
import { comparerNoms } from "../lib/format.js"
import { connexionGoogle, rpc, supabase } from "../supabase.js"
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
        <p className="small text-center text-muted mt-3"><Link to="/">Accueil</Link> · <Link to="/confidentialite">Confidentialité</Link> · <Link to="/conditions">Conditions d'utilisation</Link></p>
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
      <p className="small text-muted mb-2">Fondateur de l'établissement ?</p>
      <BoutonGoogle chemin="/" texte="Se connecter avec Google" />
      <p className="small mt-3 mb-0">Nouvel établissement ? <Link to="/inscription">Créer l'espace de mon établissement</Link></p>
    </Carte>
  )
}

// --- Bouton « Continuer avec Google » ------------------------------------------------------------------------
export function BoutonGoogle({ chemin, texte = "Continuer avec Google" }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className="btn btn-outline-dark w-100 d-flex align-items-center justify-content-center gap-2"
              onClick={() => connexionGoogle(chemin).catch((e) => setErreur(e.message))}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        {texte}
      </button>
      <Alerte>{erreur}</Alerte>
    </>
  )
}

// --- Création de l'espace d'un établissement (fondateur connecté avec Google) --------------------------------
export function Inscription() {
  const naviguer = useNavigate()
  const { pret, session, profil, sansEtablissement, recharger } = useSession()
  const meta = session?.user?.user_metadata || {}
  const [f, setF] = useState({ nom: "", ville: "", adresse: "", telephone: "", devise: "", nom_chef: "",
                               admin_nom: meta.family_name || "", admin_prenom: meta.given_name || "" })
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [resultat, setResultat] = useState(null)
  const champ = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) })

  useEffect(() => {
    if (meta.family_name || meta.given_name) setF((x) => ({ ...x, admin_nom: x.admin_nom || meta.family_name || "", admin_prenom: x.admin_prenom || meta.given_name || "" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  async function valider(e) {
    e.preventDefault()
    setErreur(""); setEnvoi(true)
    try {
      setResultat(await rpc("creer_etablissement_google", { p_nom: f.nom, p_ville: f.ville, p_adresse: f.adresse, p_telephone: f.telephone,
        p_devise: f.devise, p_nom_chef: f.nom_chef, p_admin_nom: f.admin_nom, p_admin_prenom: f.admin_prenom }))
    } catch (err) { setErreur(err.message) } finally { setEnvoi(false) }
  }

  async function terminer() {
    await recharger()
    naviguer("/")
  }

  if (!pret) return <Chargement />
  if (profil && !resultat) { naviguer("/"); return null }

  if (resultat) return (
    <div className="container py-4" style={{ maxWidth: 720 }}>
      <h1 className="h4 mb-3">Espace créé : {resultat.etablissement}</h1>
      <FicheCode titre="Code de l'établissement" sousTitre="À communiquer à tout le personnel de l'établissement" code={resultat.code_etablissement}
                 consignes={["Le personnel saisit le nom de l'établissement et ce code sur NexIASchool,", "puis choisit son nom dans la liste et saisit son code personnel.",
                             "Vous, fondateur, vous connectez simplement avec Google."]} />
      <button className="btn btn-success no-print" onClick={terminer}>Accéder à mon espace</button>
    </div>
  )

  if (!session || !sansEtablissement) return (
    <Carte titre="Créer l'espace de mon établissement">
      <ol className="small text-muted ps-3">
        <li>Connectez-vous avec votre compte Google (aucun code à recevoir par e-mail).</li>
        <li>Renseignez le nom et les informations de votre établissement.</li>
        <li>Notez le code de l'établissement, à remettre au personnel.</li>
      </ol>
      <BoutonGoogle chemin="/inscription" />
      <p className="small text-muted mt-3 mb-0"><Link to="/etablissement">Retour</Link></p>
    </Carte>
  )

  return (
    <div className="row justify-content-center mt-4 mx-0"><div className="col-lg-8 col-xl-6"><div className="card shadow-sm"><div className="card-body p-4">
      <h1 className="h4 text-primary mb-1">Créer l'espace de mon établissement</h1>
      <p className="text-muted small mb-3">Connecté avec Google : {session.user.email}.{" "}
        <button className="btn btn-link btn-sm p-0 align-baseline" onClick={() => supabase.auth.signOut()}>Changer de compte</button></p>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        <h2 className="h6 mt-2">Établissement</h2>
        <div className="row g-2">
          <div className="col-12"><label className="form-label" htmlFor="n">Nom de l'établissement</label>
            <input className="form-control" id="n" required minLength={3} maxLength={200} {...champ("nom")} placeholder="ex. Collège Saint-Joseph de Yaoundé" autoFocus />
            <div className="form-text">C'est ce nom que le personnel saisira pour entrer dans l'espace (accents et majuscules ignorés).</div></div>
          <div className="col-md-6"><label className="form-label" htmlFor="v">Ville</label><input className="form-control" id="v" maxLength={100} {...champ("ville")} /></div>
          <div className="col-md-6"><label className="form-label" htmlFor="t">Téléphone</label><input className="form-control" id="t" maxLength={50} {...champ("telephone")} /></div>
          <div className="col-md-6"><label className="form-label" htmlFor="a">Adresse / boîte postale</label><input className="form-control" id="a" maxLength={200} {...champ("adresse")} /></div>
          <div className="col-md-6"><label className="form-label" htmlFor="c">Chef d'établissement</label><input className="form-control" id="c" maxLength={150} {...champ("nom_chef")} /></div>
          <div className="col-12"><label className="form-label" htmlFor="d">Devise (bulletins)</label><input className="form-control" id="d" maxLength={200} {...champ("devise")} placeholder="ex. Travail – Discipline – Réussite" /></div>
        </div>
        <h2 className="h6 mt-3">Vous (administrateur fondateur)</h2>
        <div className="row g-2">
          <div className="col-md-6"><label className="form-label" htmlFor="an">Nom</label><input className="form-control" id="an" required maxLength={150} {...champ("admin_nom")} /></div>
          <div className="col-md-6"><label className="form-label" htmlFor="ap">Prénom</label><input className="form-control" id="ap" maxLength={150} {...champ("admin_prenom")} /></div>
        </div>
        <p className="small text-muted mt-3 mb-0">En créant l'espace, vous confirmez être habilité à représenter l'établissement et acceptez les{" "}
          <Link to="/conditions" target="_blank">conditions d'utilisation</Link> et la <Link to="/confidentialite" target="_blank">politique de confidentialité</Link>.</p>
        <button className="btn btn-primary w-100 mt-3" disabled={envoi}>{envoi ? "Création…" : "Créer l'espace de l'établissement"}</button>
      </form>
    </div></div></div></div>
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
      <p className="small text-muted mt-3">Code oublié ou perdu ? Demandez-en un nouveau à l'administration.</p>
      <hr />
      <BoutonGoogle chemin="/" texte="Fondateur : se connecter avec Google" />
    </Carte>
  )
}
