// Espace de l'enseignant indépendant : menu limité à SmartEval, IA & API, Mon abonnement, Mon compte (+ tableau de bord,
// et la gestion du groupe pour l'administrateur d'un groupe de département). Aucune rubrique d'établissement n'y figure.
import { lazy, Suspense, useState } from "react"
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom"
import { Alerte, Chargement } from "../../composants/Communs.jsx"
import { date } from "../../lib/format.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase } from "../../supabase.js"
import { ChoixLangue, t } from "../../i18n.jsx"

const ListeEvaluations = lazy(() => import("./SmartEvalEnseignant.jsx"))
const EditeurIndependant = lazy(() => import("./SmartEvalEnseignant.jsx").then((m) => ({ default: m.EditeurIndependant })))
const Resultats = lazy(() => import("../SmartEval.jsx").then((m) => ({ default: () => <m.ResultatsEvaluation independant base="/enseignant/smarteval" /> })))
const IaEnseignant = lazy(() => import("./IaEnseignant.jsx"))
const AbonnementEnseignant = lazy(() => import("./AbonnementEnseignant.jsx"))
const GroupeEnseignant = lazy(() => import("./GroupeEnseignant.jsx"))

export const NOMS_OFFRES_SE = { decouverte: "Découverte", enseignant: "SmartEval Enseignant", groupe: "SmartEval Groupe", aucune: "Aucune offre en cours" }

function Menu() {
  const { enseignant } = useSession()
  const [ouvert, setOuvert] = useState(false)
  const admin = enseignant.compte.role_groupe === "admin"
  const lien = (to, libelle, fin = false) => (
    <li className="nav-item"><NavLink end={fin} className="nav-link" to={to} onClick={() => setOuvert(false)}>{libelle}</NavLink></li>)
  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary no-print" aria-label={t("Menu SmartEval")}>
      <div className="container-fluid">
        <Link className="navbar-brand d-flex align-items-center gap-2" to="/enseignant">
          <img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="28" height="28" className="rounded-2" />SmartEval</Link>
        <button className="navbar-toggler" type="button" aria-controls="menu-enseignant" aria-expanded={ouvert} aria-label={t("Menu")} onClick={() => setOuvert(!ouvert)}>
          <span className="navbar-toggler-icon" /></button>
        <div className={`collapse navbar-collapse${ouvert ? " show" : ""}`} id="menu-enseignant">
          <ul className="navbar-nav me-auto">
            {lien("/enseignant", t("Tableau de bord"), true)}
            {lien("/enseignant/smarteval", t("SmartEval"))}
            {lien("/enseignant/ia", t("IA & API"))}
            {lien("/enseignant/abonnement", t("Mon abonnement"))}
            {admin && lien("/enseignant/groupe", t("Mon groupe"))}
            {lien("/enseignant/compte", t("Mon compte"))}
          </ul>
          <div className="d-flex align-items-center gap-2"><ChoixLangue />
            <button type="button" className="btn btn-sm btn-outline-light" onClick={() => supabase.auth.signOut()}>{t("Se déconnecter")}</button></div>
        </div>
      </div>
    </nav>
  )
}

/** Bandeau d'offre : crédits restants, échéance, invitation à souscrire. */
export function BandeauOffre() {
  const { enseignant } = useSession()
  const o = enseignant.offre
  const fin = o.fin ? date(o.fin) : null
  if (o.offre === "aucune") return (
    <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2">
      <span className="me-auto">{t("Aucune offre en cours : vos évaluations restent consultables, mais vous ne pouvez plus en publier de nouvelles.")}</span>
      <Link className="btn btn-sm btn-primary" to="/enseignant/abonnement">{t("Souscrire")}</Link>
    </div>)
  return (
    <div className="alert alert-light border d-flex flex-wrap align-items-center gap-2 bandeau-offre-se" data-offre={o.offre}>
      <span className="badge text-bg-primary">{t(NOMS_OFFRES_SE[o.offre])}</span>
      <span>{t("Crédits restants : {v0} sur {v1}", { v0: o.credits_restants, v1: o.credits_total })}</span>
      {fin && <span className="text-muted small">· {t("jusqu'au {v0}", { v0: fin })}</span>}
      {o.credits_restants === 0 && <Link className="btn btn-sm btn-primary ms-auto" to="/enseignant/abonnement">{o.offre === "decouverte" ? t("Passer à SmartEval Enseignant") : t("Obtenir des crédits")}</Link>}
    </div>
  )
}

function TableauDeBord() {
  const { enseignant } = useSession()
  const { compte, stats, ia, groupe } = enseignant
  const tuile = (lib, v) => <div className="col-6 col-md-3"><div className="card h-100"><div className="card-body py-3"><div className="small text-muted">{lib}</div><div className="fs-3 fw-semibold">{v}</div></div></div></div>
  return (
    <>
      <h1 className="h3 mb-1">{t("Bonjour {v0}", { v0: compte.prenom || compte.nom })}</h1>
      <p className="text-muted">{t("Votre espace SmartEval : évaluations digitalisées, correction automatique, analyse par votre IA.")}</p>
      <BandeauOffre />
      {groupe && <p className="small">{t("Groupe : ")}<strong>{groupe.nom}</strong> · {t("Matière : ")}<strong>{groupe.matiere}</strong></p>}
      <div className="row g-3 mb-4">
        {tuile(t("Évaluations créées"), stats.creees)}
        {tuile(t("Évaluations publiées"), stats.publiees)}
        {tuile(t("Réponses reçues"), stats.soumissions)}
        {tuile(t("Crédits restants"), enseignant.offre.credits_restants)}
      </div>
      <div className="row g-3">
        <div className="col-md-6"><div className="card h-100"><div className="card-body">
          <h2 className="h5">{t("Créer une évaluation")}</h2>
          <p className="small text-muted">{t("Le brouillon et les modifications sont gratuits ; un crédit est utilisé à la publication du lien.")}</p>
          <Link className="btn btn-primary" to="/enseignant/smarteval/nouvelle">＋ {t("Nouvelle évaluation")}</Link>
        </div></div></div>
        <div className="col-md-6"><div className="card h-100"><div className="card-body">
          <h2 className="h5">{t("Connexion IA")}</h2>
          <p className="small text-muted mb-2">{ia.acces_actifs ? t("{v0} accès actif(s) à votre assistant IA.", { v0: ia.acces_actifs }) : t("Aucun assistant IA connecté pour le moment.")}</p>
          <Link className="btn btn-outline-primary" to="/enseignant/ia">{t("Gérer la connexion IA")}</Link>
        </div></div></div>
      </div>
    </>
  )
}

function MonCompte() {
  const { enseignant, session, recharger } = useSession()
  const c = enseignant.compte
  const [f, setF] = useState({ nom: c.nom, prenom: c.prenom || "" }), [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)
  async function enregistrer(e) {
    e.preventDefault(); setMsg({}); setEnvoi(true)
    try { await rpc("enseignant_modifier_profil", { p_nom: f.nom, p_prenom: f.prenom }); await recharger(); setMsg({ ok: t("Profil enregistré.") }) }
    catch (x) { setMsg({ erreur: x.message }) } finally { setEnvoi(false) }
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="h3 mb-3">{t("Mon compte")}</h1>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="card mb-3"><div className="card-body">
        <dl className="row small mb-0">
          <dt className="col-sm-4">{t("Type de compte")}</dt><dd className="col-sm-8">{c.type === "groupe" ? t("Membre d'un groupe de département") : t("Enseignant indépendant")}</dd>
          {c.type !== "groupe" && <><dt className="col-sm-4">{t("Adresse e-mail")}</dt><dd className="col-sm-8">{c.email || session.user.email}</dd></>}
          <dt className="col-sm-4">{t("Inscrit le")}</dt><dd className="col-sm-8">{date(c.cree_le)}</dd>
        </dl>
      </div></div>
      <form className="card" onSubmit={enregistrer}><div className="card-body">
        <div className="row g-2 mb-3">
          <div className="col-sm-6"><label className="form-label" htmlFor="mc-nom">{t("Nom")}</label>
            <input className="form-control" id="mc-nom" required maxLength={100} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="mc-prenom">{t("Prénom")}</label>
            <input className="form-control" id="mc-prenom" maxLength={100} value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary" disabled={envoi}>{t("Enregistrer")}</button>
        {c.type !== "groupe" && <Link className="btn btn-link" to="/smarteval/mot-de-passe">{t("Changer de mot de passe")}</Link>}
      </div></form>
    </div>
  )
}

export default function EspaceEnseignant() {
  const { pret, session, enseignant, sansCompte } = useSession()
  if (!pret) return <Chargement />
  if (!session) return <Navigate to="/smarteval/connexion" replace />
  if (!enseignant?.compte) return <Navigate to={sansCompte ? "/bienvenue" : "/"} replace />
  const admin = enseignant.compte.role_groupe === "admin"
  return (
    <>
      <Menu />
      <main className="container-fluid py-3 px-3 px-lg-4" style={{ maxWidth: 1200 }}>
        <Suspense fallback={<Chargement />}>
          <Routes>
            <Route index element={<TableauDeBord />} />
            <Route path="smarteval" element={<ListeEvaluations />} />
            <Route path="smarteval/nouvelle" element={<EditeurIndependant />} />
            <Route path="smarteval/:id/modifier" element={<EditeurIndependant />} />
            <Route path="smarteval/:id" element={<Resultats />} />
            <Route path="ia" element={<IaEnseignant />} />
            <Route path="abonnement" element={<AbonnementEnseignant />} />
            {admin && <Route path="groupe" element={<GroupeEnseignant />} />}
            <Route path="compte" element={<MonCompte />} />
            <Route path="*" element={<Navigate to="/enseignant" replace />} />
          </Routes>
        </Suspense>
      </main>
    </>
  )
}
