// Comptes des délégations (départementales et régionales des enseignements secondaires) : inscription par e-mail
// (tout fournisseur, adresse vérifiée par lien), connexion, demande de compte avec justificatif, suivi de la demande.
// Le compte n'ouvre l'espace qu'après validation par l'administrateur de NexIA School.
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Alerte } from "../../composants/Communs.jsx"
import { dateHeure } from "../../lib/format.js"
import { statutDemande } from "../../lib/institution.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, messageErreur } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { Carte } from "../Acces.jsx"
import { ChoixLocalisation, deposerPiece } from "./Composants.jsx"

const adresse = (chemin) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${chemin}`

const AVERTISSEMENT = "NexIA School est un service indépendant : il n'est ni mandaté ni agréé par le MINESEC. Les comptes de délégation sont gratuits et ouverts après vérification de la désignation."

export function InscriptionDelegue() {
  const { session } = useSession()
  const naviguer = useNavigate()
  const [email, setEmail] = useState(""), [mdp, setMdp] = useState(""), [mdp2, setMdp2] = useState("")
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [envoye, setEnvoye] = useState(false), [accepte, setAccepte] = useState(false)
  useEffect(() => { if (session) naviguer("/institution", { replace: true }) }, [session, naviguer])
  async function valider(e) {
    e.preventDefault()
    if (mdp !== mdp2) return setErreur(t("Les deux mots de passe ne correspondent pas."))
    if (!accepte) return setErreur(t("Acceptez les conditions d'utilisation pour continuer."))
    setErreur(""); setEnvoi(true)
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password: mdp, options: { emailRedirectTo: adresse("/institution") } })
      if (error) throw error
      setEnvoye(true)
    } catch (x) { setErreur(messageErreur(x)) } finally { setEnvoi(false) }
  }
  if (envoye) return (
    <Carte titre={t("Vérifiez votre adresse e-mail")}>
      <div className="alert alert-success">{t("Un lien de confirmation vient d'être envoyé à {v0}. Ouvrez-le, puis complétez votre demande de compte de délégation.", { v0: email })}</div>
    </Carte>
  )
  return (
    <Carte titre={t("Compte de délégation (DDES / DRES)")}>
      <p className="small text-muted">{t(AVERTISSEMENT)}</p>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="dl-email">{t("Adresse e-mail professionnelle")}</label>
          <input className="form-control" id="dl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" autoFocus />
          <div className="form-text">{t("N'importe quel fournisseur (Gmail, Yahoo, Outlook…). Elle sera vérifiée par un lien.")}</div></div>
        <div className="mb-3"><label className="form-label" htmlFor="dl-mdp">{t("Mot de passe (8 caractères au moins)")}</label>
          <input className="form-control" id="dl-mdp" type="password" minLength={8} maxLength={72} required value={mdp} onChange={(e) => setMdp(e.target.value)} autoComplete="new-password" /></div>
        <div className="mb-3"><label className="form-label" htmlFor="dl-mdp2">{t("Confirmez le mot de passe")}</label>
          <input className="form-control" id="dl-mdp2" type="password" minLength={8} maxLength={72} required value={mdp2} onChange={(e) => setMdp2(e.target.value)} autoComplete="new-password" /></div>
        <div className="form-check mb-3"><input className="form-check-input" type="checkbox" id="dl-cgu" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />
          <label className="form-check-label small" htmlFor="dl-cgu">{t("J'accepte les")} <Link to="/conditions" target="_blank">{t("conditions d'utilisation")}</Link> {t("et la")} <Link to="/confidentialite" target="_blank">{t("politique de confidentialité")}</Link>.</label></div>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Création…") : t("Créer mon compte")}</button>
      </form>
      <p className="small mt-3 mb-0">{t("Déjà un compte ?")} <Link to="/institution/connexion">{t("Se connecter")}</Link></p>
    </Carte>
  )
}

export function ConnexionDelegue() {
  const { session, institution } = useSession()
  const naviguer = useNavigate()
  const [email, setEmail] = useState(""), [mdp, setMdp] = useState(""), [erreur, setErreur] = useState(""), [info, setInfo] = useState(""), [envoi, setEnvoi] = useState(false)
  useEffect(() => { if (session && institution !== undefined) naviguer("/institution", { replace: true }) }, [session, institution, naviguer])
  async function valider(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: mdp })
      if (error) throw new Error(/confirm/i.test(error.message) ? t("Confirmez d'abord votre adresse e-mail (lien reçu par e-mail).") : t("Adresse e-mail ou mot de passe incorrect."))
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  async function oublie() {
    setErreur(""); setInfo("")
    if (!email.trim()) return setErreur(t("Saisissez d'abord votre adresse e-mail."))
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: adresse("/smarteval/mot-de-passe") })
    if (error) setErreur(messageErreur(error)); else setInfo(t("Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé."))
  }
  return (
    <Carte titre={t("Connexion — espace des délégations")}>
      <Alerte>{erreur}</Alerte><Alerte type="info">{info}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="dc-email">{t("Adresse e-mail")}</label>
          <input className="form-control" id="dc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus /></div>
        <div className="mb-2"><label className="form-label" htmlFor="dc-mdp">{t("Mot de passe")}</label>
          <input className="form-control" id="dc-mdp" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} required autoComplete="current-password" /></div>
        <button type="button" className="btn btn-link btn-sm p-0 mb-3" onClick={oublie}>{t("Mot de passe oublié ?")}</button>
        <button className="btn btn-primary w-100" disabled={envoi}>{envoi ? t("Connexion…") : t("Se connecter")}</button>
      </form>
      <p className="small mt-3 mb-0">{t("Pas encore de compte ?")} <Link to="/institution/inscription">{t("Demander un compte de délégation")}</Link></p>
    </Carte>
  )
}

/** Demande de compte (brouillon → soumise) et suivi de son statut. */
export function DemandeDelegue() {
  const { session, institution, recharger } = useSession()
  const d = institution?.demande
  const [f, setF] = useState(() => ({ niveau: d?.niveau || "departement", region_id: d?.region_id || "", departement_id: d?.departement_id || "",
    nom: d?.nom || "", prenom: d?.prenom || "", telephone: d?.telephone || "", fonction: d?.fonction || "" }))
  const [fichier, setFichier] = useState(null), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  const modifiable = !d || d.statut === "brouillon"

  async function enregistrer(soumettre) {
    setErreur(""); setEnvoi(true)
    try {
      const justificatif = await deposerPiece(`demandes/${session.user.id}`, fichier)
      await rpc("inst_demande_enregistrer", { p: { ...f, departement_id: f.niveau === "departement" ? f.departement_id : null, justificatif } })
      if (soumettre) await rpc("inst_demande_soumettre")
      setFichier(null); await recharger()
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="container py-4" style={{ maxWidth: 760 }}>
      <div className="d-flex justify-content-between align-items-center mb-2"><h1 className="h4 mb-0">{t("Demande de compte de délégation")}</h1>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => supabase.auth.signOut()}>{t("Se déconnecter")}</button></div>
      <p className="small text-muted">{t(AVERTISSEMENT)}</p>
      {d && <div className={`alert ${d.statut === "rejetee" || d.statut === "suspendue" ? "alert-danger" : d.statut === "brouillon" ? "alert-light border" : "alert-info"}`}>
        {t("Statut de votre demande : ")}<strong>{statutDemande(d.statut)}</strong>{d.soumise_le ? ` · ${t("soumise le ")}${dateHeure(d.soumise_le)}` : ""}
        {d.motif_decision && <div className="small mt-1">{t("Motif : ")}{d.motif_decision}</div>}
        {["soumise", "en_verification"].includes(d.statut) && <div className="small mt-1">{t("L'administrateur de NexIA School vérifie votre désignation. Votre espace s'ouvrira après validation.")}</div>}
      </div>}
      {modifiable && <div className="card"><div className="card-body">
        <Alerte>{erreur}</Alerte>
        <div className="mb-3"><span className="form-label d-block">{t("Type de délégation")}</span>
          {[["departement", "Délégation départementale (DDES)"], ["region", "Délégation régionale (DRES)"]].map(([v, l]) => (
            <div className="form-check form-check-inline" key={v}><input className="form-check-input" type="radio" id={`niv-${v}`} checked={f.niveau === v} onChange={() => setF({ ...f, niveau: v })} />
              <label className="form-check-label" htmlFor={`niv-${v}`}>{t(l)}</label></div>))}</div>
        <ChoixLocalisation valeur={f} onChange={(v) => setF({ ...f, ...v })} departementRequis={f.niveau === "departement"} idPrefixe="dem" />
        <div className="row g-2 mt-1">
          <div className="col-sm-6"><label className="form-label" htmlFor="dem-nom">{t("Nom")}</label><input className="form-control" id="dem-nom" maxLength={100} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="dem-prenom">{t("Prénom")}</label><input className="form-control" id="dem-prenom" maxLength={100} value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="dem-tel">{t("Téléphone professionnel")}</label><input className="form-control" id="dem-tel" maxLength={40} value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="dem-fonction">{t("Fonction")}</label><input className="form-control" id="dem-fonction" maxLength={150} value={f.fonction} onChange={(e) => setF({ ...f, fonction: e.target.value })} /></div>
        </div>
        <div className="mt-3"><label className="form-label" htmlFor="dem-just">{t("Justificatif de désignation (acte, note de service ; PDF ou image, 5 Mo)")}</label>
          <input className="form-control" id="dem-just" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
          {d?.justificatif && <div className="form-text">{t("Un justificatif est déjà joint ; vous pouvez le remplacer.")}</div>}</div>
        <p className="small text-muted mt-3">{t("Adresse vérifiée : ")}{session?.user?.email}. {t("Le compte reste inactif tant que l'administrateur de NexIA School ne l'a pas validé.")}</p>
        <div className="d-flex gap-2"><button className="btn btn-outline-primary" disabled={envoi} onClick={() => enregistrer(false)}>{t("Enregistrer le brouillon")}</button>
          <button className="btn btn-primary" disabled={envoi} onClick={() => enregistrer(true)}>{t("Soumettre ma demande")}</button></div>
      </div></div>}
    </div>
  )
}
