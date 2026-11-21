// Accès des enseignants indépendants (SmartEval sans établissement) : choix du type de compte, inscription par e-mail
// (tout fournisseur, adresse vérifiée par lien), connexion, mot de passe oublié, création du compte SmartEval,
// et connexion des membres d'un groupe de département (code du groupe + code personnel).
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Alerte, Chargement } from "../../composants/Communs.jsx"
import { consommerRetour } from "../../lib/retour.js"
import { rpc, supabase, messageErreur } from "../../supabase.js"
import { useSession } from "../../Session.jsx"
import { t, traduireErreur } from "../../i18n.jsx"
import { BoutonGoogle, Carte } from "../Acces.jsx"

const adresse = (chemin) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${chemin}`
const MOT_DE_PASSE_MIN = 8

/** « Créer un compte » : établissement (fondateur, Google) ou enseignant indépendant (SmartEval). */
export function ChoixInscription() {
  return (
    <div className="container py-4 py-md-5" style={{ maxWidth: 920 }}>
      <h1 className="h3 text-center mb-1">{t("Créer mon compte NexIA School")}</h1>
      <p className="text-center text-muted mb-4">{t("Choisissez le compte qui vous correspond.")}</p>
      <div className="row g-4">
        <div className="col-md-6"><div className="card h-100 shadow-sm choix-compte" data-choix="etablissement"><div className="card-body p-4 d-flex flex-column">
          <div className="fs-2" aria-hidden="true">🏫</div>
          <h2 className="h5">{t("Je gère un établissement scolaire")}</h2>
          <p className="text-muted small flex-grow-1">{t("Notes, bulletins, discipline, finances, parents, SmartEval pour tout le personnel… Commencez gratuitement avec l'offre Découverte, puis passez à Premium au tarif de votre effectif.")}</p>
          <Link className="btn btn-primary" to="/inscription">{t("Créer l'espace de mon établissement")}</Link>
          <Link className="small mt-2 text-center" to="/tarifs">{t("Voir les tarifs des établissements")}</Link>
        </div></div></div>
        <div className="col-md-6"><div className="card h-100 shadow-sm choix-compte" data-choix="enseignant"><div className="card-body p-4 d-flex flex-column">
          <div className="fs-2" aria-hidden="true">🧑‍🏫</div>
          <h2 className="h5">{t("Je suis enseignant (sans établissement abonné)")}</h2>
          <p className="text-muted small flex-grow-1">{t("SmartEval : créez vos évaluations digitalisées, partagez un lien à vos élèves, obtenez la correction automatique et l'analyse par votre propre IA. Inscription avec n'importe quelle adresse e-mail.")}</p>
          <Link className="btn btn-primary" to="/smarteval/inscription">{t("Créer mon compte SmartEval")}</Link>
          <Link className="small mt-2 text-center" to="/tarifs/smarteval">{t("Voir les offres SmartEval")}</Link>
        </div></div></div>
      </div>
      <p className="text-center small text-muted mt-4">{t("Déjà inscrit ?")} <Link to="/etablissement">{t("Espace d'un établissement")}</Link> · <Link to="/smarteval/connexion">{t("Espace SmartEval")}</Link></p>
    </div>
  )
}

function champMotDePasse(id, valeur, setValeur, libelle, autoComplete) {
  return (
    <div className="mb-3"><label className="form-label" htmlFor={id}>{libelle}</label>
      <input className="form-control" id={id} type="password" value={valeur} onChange={(e) => setValeur(e.target.value)} required minLength={MOT_DE_PASSE_MIN}
             maxLength={72} autoComplete={autoComplete} /></div>
  )
}

/** Inscription par e-mail et mot de passe : un lien de vérification est envoyé ; le compte SmartEval est créé ensuite. */
export function InscriptionEnseignant() {
  const { session } = useSession()
  const naviguer = useNavigate()
  const [email, setEmail] = useState(""), [mdp, setMdp] = useState(""), [mdp2, setMdp2] = useState("")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [envoye, setEnvoye] = useState(false), [accepte, setAccepte] = useState(false)
  useEffect(() => { if (session) naviguer("/bienvenue", { replace: true }) }, [session, naviguer])

  async function valider(e) {
    e.preventDefault()
    if (mdp !== mdp2) return setErreur(t("Les deux mots de passe ne correspondent pas."))
    if (!accepte) return setErreur(t("Acceptez les conditions d'utilisation pour continuer."))
    setErreur(""); setEnvoi(true)
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password: mdp, options: { emailRedirectTo: adresse("/bienvenue") } })
      if (error) throw error
      setEnvoye(true)
    } catch (x) { setErreur(messageErreur(x)) } finally { setEnvoi(false) }
  }

  if (envoye) return (
    <Carte titre={t("Vérifiez votre adresse e-mail")}>
      <div className="alert alert-success">{t("Un lien de confirmation vient d'être envoyé à {v0}. Ouvrez-le pour activer votre compte SmartEval.", { v0: email })}</div>
      <p className="small text-muted mb-0">{t("Rien reçu après quelques minutes ? Vérifiez le dossier « Courrier indésirable », puis réessayez.")}</p>
    </Carte>
  )
  return (
    <Carte titre={t("Créer mon compte SmartEval (enseignant)")}>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="se-email">{t("Adresse e-mail")}</label>
          <input className="form-control" id="se-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" autoFocus />
          <div className="form-text">{t("N'importe quel fournisseur (Gmail, Yahoo, Outlook…). Elle sera vérifiée par un lien.")}</div></div>
        {champMotDePasse("se-mdp", mdp, setMdp, t("Mot de passe (8 caractères au moins)"), "new-password")}
        {champMotDePasse("se-mdp2", mdp2, setMdp2, t("Confirmez le mot de passe"), "new-password")}
        <div className="form-check mb-3"><input className="form-check-input" type="checkbox" id="se-cgu" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />
          <label className="form-check-label small" htmlFor="se-cgu">{t("J'accepte les")} <Link to="/conditions" target="_blank">{t("conditions d'utilisation")}</Link> {t("et la")} <Link to="/confidentialite" target="_blank">{t("politique de confidentialité")}</Link>.</label></div>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Création…") : t("Créer mon compte")}</button>
      </form>
      <div className="text-center small text-muted my-3">{t("ou")}</div>
      <BoutonGoogle chemin="/bienvenue" />
      <p className="small mt-3 mb-0">{t("Déjà un compte ?")} <Link to="/smarteval/connexion">{t("Se connecter")}</Link> · <Link to="/smarteval/groupe">{t("Membre d'un groupe de département")}</Link></p>
    </Carte>
  )
}

/** Connexion par e-mail et mot de passe, ou Google ; mot de passe oublié. */
export function ConnexionEnseignant() {
  const { session, enseignant, sansCompte } = useSession()
  const naviguer = useNavigate()
  const [email, setEmail] = useState(""), [mdp, setMdp] = useState(""), [erreur, setErreur] = useState(""), [info, setInfo] = useState("")
  const [envoi, setEnvoi] = useState(false)
  useEffect(() => {
    if (session && enseignant?.compte) naviguer(consommerRetour() || "/enseignant", { replace: true })
    else if (session && sansCompte) naviguer("/bienvenue", { replace: true })
  }, [session, enseignant, sansCompte, naviguer])

  async function valider(e) {
    e.preventDefault(); setErreur(""); setInfo(""); setEnvoi(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: mdp })
      if (error) throw new Error(/confirm/i.test(error.message) ? t("Confirmez d'abord votre adresse e-mail (lien reçu par e-mail).") : t("Adresse e-mail ou mot de passe incorrect."))
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  async function oublie() {
    setErreur(""); setInfo("")
    if (!email.trim()) return setErreur(t("Saisissez d'abord votre adresse e-mail."))
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: adresse("/smarteval/mot-de-passe") })
    if (error) setErreur(messageErreur(error))
    else setInfo(t("Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé."))
  }
  return (
    <Carte titre={t("Connexion à mon espace SmartEval")}>
      <Alerte>{erreur}</Alerte><Alerte type="info">{info}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="sc-email">{t("Adresse e-mail")}</label>
          <input className="form-control" id="sc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus /></div>
        <div className="mb-2"><label className="form-label" htmlFor="sc-mdp">{t("Mot de passe")}</label>
          <input className="form-control" id="sc-mdp" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} required autoComplete="current-password" /></div>
        <button type="button" className="btn btn-link btn-sm p-0 mb-3" onClick={oublie}>{t("Mot de passe oublié ?")}</button>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Connexion…") : t("Se connecter")}</button>
      </form>
      <div className="text-center small text-muted my-3">{t("ou")}</div>
      <BoutonGoogle chemin="/bienvenue" />
      <p className="small mt-3 mb-0">{t("Pas encore de compte ?")} <Link to="/smarteval/inscription">{t("Créer mon compte SmartEval")}</Link> · <Link to="/smarteval/groupe">{t("Membre d'un groupe de département")}</Link></p>
    </Carte>
  )
}

/** Nouveau mot de passe (lien de réinitialisation reçu par e-mail). */
export function NouveauMotDePasse() {
  const { session } = useSession()
  const naviguer = useNavigate()
  const [mdp, setMdp] = useState(""), [mdp2, setMdp2] = useState(""), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  async function valider(e) {
    e.preventDefault()
    if (mdp !== mdp2) return setErreur(t("Les deux mots de passe ne correspondent pas."))
    setErreur(""); setEnvoi(true)
    const { error } = await supabase.auth.updateUser({ password: mdp })
    setEnvoi(false)
    if (error) return setErreur(messageErreur(error))
    naviguer("/enseignant", { replace: true })
  }
  if (!session) return <Carte titre={t("Nouveau mot de passe")}><p className="small text-muted mb-0">{t("Ouvrez le lien reçu par e-mail sur cet appareil pour choisir un nouveau mot de passe.")}</p></Carte>
  return (
    <Carte titre={t("Nouveau mot de passe")}>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        {champMotDePasse("np-mdp", mdp, setMdp, t("Nouveau mot de passe (8 caractères au moins)"), "new-password")}
        {champMotDePasse("np-mdp2", mdp2, setMdp2, t("Confirmez le mot de passe"), "new-password")}
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Enregistrement…") : t("Enregistrer")}</button>
      </form>
    </Carte>
  )
}

/** Adresse vérifiée, sans espace : création du compte SmartEval (ou de l'espace d'un établissement avec Google). */
export function Bienvenue() {
  const { pret, session, profil, enseignant, sansCompte, sansEtablissement, recharger } = useSession()
  const naviguer = useNavigate()
  const meta = session?.user?.user_metadata || {}
  const [f, setF] = useState({ nom: meta.family_name || "", prenom: meta.given_name || "" })
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [refus, setRefus] = useState(false)
  useEffect(() => {
    if (!pret) return
    if (profil) naviguer("/", { replace: true })
    else if (enseignant?.compte && !refus) naviguer(consommerRetour() || "/enseignant", { replace: true })
  }, [pret, profil, enseignant, refus, naviguer])

  async function creer(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("enseignant_inscription", { p_nom: f.nom, p_prenom: f.prenom })
      if (r.offre_gratuite_refusee) setRefus(true)
      await recharger()
    } catch (x) { setErreur(traduireErreur(x.message)) } finally { setEnvoi(false) }
  }

  if (!pret) return <Chargement />
  if (refus) return (
    <Carte titre={t("Compte SmartEval créé")}>
      <div className="alert alert-warning">{t("Cette adresse e-mail a déjà bénéficié d'une offre gratuite NexIA School ou SmartEval : l'offre Découverte n'est accordée qu'une seule fois. Votre compte est créé ; souscrivez à SmartEval Enseignant pour publier vos évaluations.")}</div>
      <div className="d-flex gap-2"><Link className="btn btn-primary" to="/enseignant/abonnement">{t("Voir les offres")}</Link>
        <Link className="btn btn-outline-secondary" to="/enseignant">{t("Accéder à mon espace")}</Link></div>
    </Carte>
  )
  if (!session || !sansCompte) return (
    <Carte titre={t("Bienvenue sur NexIA School")}>
      <p className="small text-muted">{t("Connectez-vous pour continuer.")}</p>
      <Link className="btn btn-primary w-100" to="/smarteval/connexion">{t("Se connecter")}</Link>
    </Carte>
  )
  return (
    <Carte titre={t("Créer mon espace SmartEval")}>
      <p className="small text-muted">{t("Adresse vérifiée : ")}<strong>{session.user.email}</strong>.{" "}
        <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => supabase.auth.signOut()}>{t("Changer de compte")}</button></p>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={creer}>
        <div className="row g-2 mb-3">
          <div className="col-sm-6"><label className="form-label" htmlFor="b-nom">{t("Nom")}</label>
            <input className="form-control" id="b-nom" required maxLength={100} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} autoComplete="family-name" /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="b-prenom">{t("Prénom")}</label>
            <input className="form-control" id="b-prenom" maxLength={100} value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} autoComplete="given-name" /></div>
        </div>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Création…") : t("Créer mon espace SmartEval")}</button>
      </form>
      {sansEtablissement && <>
        <hr />
        <p className="small text-muted mb-2">{t("Vous êtes fondateur d'un établissement ?")}</p>
        <Link className="btn btn-outline-primary w-100" to="/inscription">{t("Créer plutôt l'espace de mon établissement")}</Link>
      </>}
    </Carte>
  )
}

/** Membre d'un groupe de département : code du groupe, choix de son nom, code personnel. */
export function ConnexionGroupe() {
  const naviguer = useNavigate()
  const { session, enseignant } = useSession()
  const [code, setCode] = useState(""), [groupe, setGroupe] = useState(null), [membre, setMembre] = useState(""), [perso, setPerso] = useState("")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  useEffect(() => { if (session && enseignant?.compte) naviguer(consommerRetour() || "/enseignant", { replace: true }) }, [session, enseignant, naviguer])

  async function ouvrir(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("groupe_ouvrir", { p_code: code })
      if (r.erreur) setErreur(traduireErreur(r.erreur)); else setGroupe(r)
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  async function connecter(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("groupe_connexion", { p_code_groupe: code, p_membre: membre, p_code: perso })
      if (r.erreur) { setPerso(""); setErreur(traduireErreur(r.erreur)); return }
      const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: r.secret })
      if (error) setErreur(t("Connexion impossible pour le moment. Réessayez."))
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <Carte titre={t("Connexion d'un membre d'un groupe de département (SmartEval)")}>
      <Alerte>{erreur}</Alerte>
      {!groupe ? (
        <form onSubmit={ouvrir}>
          <div className="mb-3"><label className="form-label" htmlFor="g-code">{t("Code du groupe")}</label>
            <input className="form-control font-monospace text-uppercase" id="g-code" value={code} onChange={(e) => setCode(e.target.value)} required
                   autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="ABC123-xxxxxxxx" autoFocus />
            <div className="form-text">{t("Remis par l'administrateur de votre groupe.")}</div></div>
          <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Vérification…") : t("Continuer")}</button>
        </form>
      ) : (
        <form onSubmit={connecter}>
          <p className="fw-semibold mb-0">{groupe.groupe}</p>
          <p className="small text-muted">{t("Matière : {v0}", { v0: groupe.matiere })}</p>
          <div className="mb-3"><label className="form-label" htmlFor="g-membre">{t("Votre nom")}</label>
            <select className="form-select" id="g-membre" value={membre} onChange={(e) => setMembre(e.target.value)} required>
              <option value="">{t("Choisissez votre nom…")}</option>{groupe.membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}</select></div>
          <div className="mb-3"><label className="form-label" htmlFor="g-perso">{t("Code personnel")}</label>
            <input className="form-control font-monospace" id="g-perso" type="password" value={perso} onChange={(e) => setPerso(e.target.value)} required autoComplete="current-password" /></div>
          <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Connexion…") : t("Se connecter")}</button>
          <button type="button" className="btn btn-link btn-sm mt-2 p-0" onClick={() => { setGroupe(null); setMembre(""); setPerso("") }}>{t("Changer de groupe")}</button>
        </form>
      )}
      <p className="small text-muted mt-3 mb-0">{t("Administrateur du groupe ?")} <Link to="/smarteval/connexion">{t("Connectez-vous avec votre adresse e-mail")}</Link></p>
    </Carte>
  )
}
