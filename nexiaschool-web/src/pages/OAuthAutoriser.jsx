import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Alerte, Chargement } from "../composants/Communs.jsx"
import { LIBELLES_ROLES } from "../composants/MiseEnPage.jsx"
import { lireAppareil } from "../lib/appareil.js"
import { nomComplet } from "../lib/format.js"
import { memoriserRetour } from "../lib/retour.js"
import { lireSessionParent, oublierSessionParent, rpcParent } from "../lib/parent.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase } from "../supabase.js"
import { BoutonGoogle } from "./Acces.jsx"
import { ChoixLangue, t } from "../i18n.jsx"

const ISSUER = "https://nexiaschool.com"

function Cadre({ children }) {
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0"><div className="col-sm-10 col-md-7 col-lg-5">
        <div className="card shadow-sm"><div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
            <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="32" height="32" className="rounded-2" />NexIA School</h1>
            <ChoixLangue />
          </div>{children}
        </div></div>
        <p className="small text-center text-muted mt-3"><Link to="/confidentialite">{t("Confidentialité")}</Link> · <Link to="/conditions">{t("Conditions d'utilisation")}</Link></p>
      </div></div>
  );
}

/** Page d'autorisation OAuth : une application (Claude.ai…) demande l'accès à l'espace de la personne connectée. */
export default function OAuthAutoriser() {
  const { search, pathname } = useLocation()
  const naviguer = useNavigate()
  const { pret, session, profil, etablissement, sansEtablissement } = useSession()
  const q = useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search])
  const [client, setClient] = useState(null), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  const [ecriture, setEcriture] = useState(() => /ecriture/.test(q.scope || ""))

  const invalide = q.response_type !== "code" ? t("Requête invalide (response_type=code attendu).") :
    !q.client_id || !q.redirect_uri ? t("Requête invalide : client_id et redirect_uri sont obligatoires.") :
    !q.code_challenge || q.code_challenge_method !== "S256" ? t("Requête invalide : PKCE (S256) obligatoire.") : ""

  useEffect(() => {
    if (invalide) return
    rpc("oauth_info_client", { p_client_id: q.client_id, p_redirect_uri: q.redirect_uri })
      .then((r) => (r.erreur ? setErreur(r.erreur) : setClient(r))).catch((e) => setErreur(e.message))
  }, [invalide, q.client_id, q.redirect_uri])

  function retour(params) {
    const u = new URL(q.redirect_uri)
    for (const [k, v] of Object.entries({ ...params, state: q.state, iss: ISSUER })) if (v !== undefined) u.searchParams.set(k, v)
    window.location.assign(u.toString())
  }
  async function autoriser() {
    setEnvoi(true); setErreur("")
    try {
      const r = await rpc("oauth_autoriser", { p_client_id: q.client_id, p_redirect_uri: q.redirect_uri, p_code_challenge: q.code_challenge,
                                                 p_methode: q.code_challenge_method, p_ecriture: ecriture })
      retour({ code: r.code })
    } catch (e) { setErreur(e.message); setEnvoi(false) }
  }
  function seConnecterParCode() {
    memoriserRetour(pathname + search)
    naviguer(lireAppareil() ? "/connexion" : "/etablissement")
  }
  // Parent : l'assistant IA n'aura accès qu'aux données de son enfant (session de l'espace parents de cet appareil)
  const sessionParent = lireSessionParent()
  // hôte de retour : affiché au parent, et refusé s'il ne s'agit pas d'une application d'IA reconnue
  const [hote, setHote] = useState(null)
  useEffect(() => {
    if (invalide) return
    rpc("oauth_info_client_parent", { p_client_id: q.client_id, p_redirect_uri: q.redirect_uri }).then(setHote).catch(() => setHote(null))
  }, [invalide, q.client_id, q.redirect_uri])
  async function autoriserParent() {
    setEnvoi(true); setErreur("")
    try {
      const r = await rpcParent("oauth_autoriser_parent", { p_client_id: q.client_id, p_redirect_uri: q.redirect_uri, p_code_challenge: q.code_challenge,
                                                             p_methode: q.code_challenge_method })
      retour({ code: r.code })
    } catch (e) { if (e.expiree) oublierSessionParent(); setErreur(e.message); setEnvoi(false) }
  }
  function seConnecterParent() {
    memoriserRetour(pathname + search)
    naviguer(lireAppareil() ? "/parent/connexion" : "/etablissement")
  }
  const blocParent = (
    <div className="border rounded p-3 mb-3 bg-body-tertiary">
      <h2 className="h6">{t("Vous êtes parent d'élève ?")}</h2>
      {hote && <p className="small mb-2">{t("Retour vers : {v0}", { v0: hote.hote })}{" "}
        {hote.reconnu ? <span className="badge text-bg-success">{t("application reconnue")}</span> : <span className="badge text-bg-danger">{t("application non reconnue")}</span>}</p>}
      {hote && !hote.reconnu ? (
        <div className="alert alert-danger small mb-0">{t("Par sécurité, cette application ne peut pas accéder à l'espace de votre enfant. Pour un autre assistant, créez une clé personnelle dans l'espace parents (onglet « Mon assistant IA »).")}</div>
      ) : sessionParent ? (
        <>
          <p className="small mb-2">{t("{v0} n'aura accès qu'aux informations de votre enfant {v1} et à celles de l'école que vous voyez dans votre espace.", { v0: client?.nom || "", v1: sessionParent.eleve })}</p>
          <button className="btn btn-success w-100" disabled={envoi} onClick={autoriserParent}>{envoi ? t("Autorisation…") : t("Autoriser pour mon enfant {v0}", { v0: sessionParent.eleve })}</button>
        </>
      ) : <button className="btn btn-outline-success w-100" onClick={seConnecterParent}>{t("Me connecter à l'espace parents")}</button>}
    </div>
  )

  if (invalide || (erreur && !client)) return (
    <Cadre><Alerte>{invalide || erreur}</Alerte><p className="small text-muted mb-0">{t(
      "Retournez dans l'application qui vous a envoyé ici et recommencez la connexion."
    )}</p></Cadre>
  );
  if (!pret || !client) return <Cadre><Chargement /></Cadre>

  if (!session || (!profil && !sansEtablissement)) return (
    <Cadre>
      <p><strong>{client.nom}</strong>{t(" souhaite accéder à votre espace NexIA School. Connectez-vous d'abord.")}</p>
      <Alerte>{erreur}</Alerte>
      {blocParent}
      <h2 className="h6">{t("Personnel de l'établissement")}</h2>
      <button className="btn btn-primary w-100 mb-2" onClick={seConnecterParCode}>{t("Se connecter avec le code de mon établissement")}</button>
      <BoutonGoogle chemin={pathname + search} texte={t("Fondateur : se connecter avec Google")} />
    </Cadre>
  );
  if (sansEtablissement) return (
    <Cadre><Alerte>{t("Ce compte Google n'est rattaché à aucun établissement.")}</Alerte>
      <button className="btn btn-outline-secondary" onClick={() => supabase.auth.signOut()}>{t("Changer de compte")}</button></Cadre>
  );

  return (
    <Cadre>
      <h2 className="h5">{client.nom}{t(" demande l'accès à votre espace")}</h2>
      <p className="small text-muted">{t("Connecté en tant que ")}<strong>{nomComplet(profil)}</strong> ({t(LIBELLES_ROLES[profil.role])}) — {etablissement.nom}.{" "}
        <button className="btn btn-link btn-sm p-0 align-baseline" onClick={async () => { await supabase.auth.signOut() }}>{t("Changer de compte")}</button></p>
      <Alerte>{erreur}</Alerte>
      {!profil.ia_active ? (
        <div className="alert alert-warning">{t("La connexion IA de votre compte n'est pas activée.")}{t(" Activez-la dans la rubrique ")}<Link to="/developpeur">{t("« IA et API »")}</Link>{t(", puis revenez sur cette page.")}</div>
      ) : (
        <>
          <p className="mb-1">{t("Cette application pourra, avec ")}<strong>{t("vos droits")}</strong> :</p>
          <ul className="small">
            <li>{t(
              "consulter les classes, élèves, résultats, bulletins, statistiques et la discipline que votre rôle vous permet de voir ;"
            )}</li>
            {ecriture && <li>{t(
              "saisir des notes, faire l'appel et ajouter des élèves (selon votre rôle), toujours après un récapitulatif à confirmer."
            )}</li>}
          </ul>
          <div className="form-check mb-3"><input className="form-check-input" type="checkbox" id="ecr" checked={ecriture} onChange={(e) => setEcriture(e.target.checked)} />
            <label className="form-check-label" htmlFor="ecr">{t("Autoriser aussi l'écriture (notes, appel, élèves)")}</label></div>
          <p className="small text-muted">{t("Les données consultées seront transmises à ")}{client.nom}{t(
            ". Vous pourrez retirer cet accès à tout moment dans l'Espace développeur."
          )}</p>
          <div className="d-flex gap-2">
            <button className="btn btn-primary flex-grow-1" disabled={envoi} onClick={autoriser}>{envoi ? "Autorisation…" : "Autoriser"}</button>
            <button className="btn btn-outline-secondary" disabled={envoi} onClick={() => retour({ error: "access_denied", error_description: t("Accès refusé par l'utilisateur") })}>{t("Refuser")}</button>
          </div>
        </>
      )}
    </Cadre>
  );
}
