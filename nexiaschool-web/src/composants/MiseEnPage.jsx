import { useEffect, useRef, useState } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useSession } from "../Session.jsx"
import { supabase } from "../supabase.js"
import { nomComplet } from "../lib/format.js"
import { BulleLogo } from "./Logo.jsx"
import AlerteFinance from "./AlerteFinance.jsx"
import AlerteDiscipline from "./AlerteDiscipline.jsx"
import { ChoixLangue, t } from "../i18n.jsx"

export const LIBELLES_ROLES = { admin: "Administration", enseignant: "Enseignant", surveillant: "Surveillant général", comptable: "Comptable / caissier" }

function Menu({ titre, liens }) {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => setOuvert(false), [pathname])
  useEffect(() => {
    const fermer = (e) => ref.current && !ref.current.contains(e.target) && setOuvert(false)
    document.addEventListener("click", fermer)
    return () => document.removeEventListener("click", fermer)
  }, [])
  const actif = liens.some(([chemin]) => pathname.startsWith(chemin))
  return (
    <li className="nav-item dropdown" ref={ref}>
      <button className={"nav-link dropdown-toggle btn btn-link" + (actif ? " active fw-semibold" : "")} aria-expanded={ouvert}
              onClick={() => setOuvert(!ouvert)}>{titre}</button>
      <ul className={"dropdown-menu" + (ouvert ? " show" : "")}>
        {liens.map(([chemin, libelle]) => <li key={chemin}><Link className="dropdown-item" to={chemin}>{libelle}</Link></li>)}
      </ul>
    </li>
  )
}

/** Menu du compte : nom, rôle et déconnexion regroupés pour garder la barre sur une ligne. */
function Compte({ nom, role, onDeconnecter }) {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const fermer = (e) => ref.current && !ref.current.contains(e.target) && setOuvert(false)
    const echap = (e) => e.key === "Escape" && setOuvert(false)
    document.addEventListener("click", fermer); document.addEventListener("keydown", echap)
    return () => { document.removeEventListener("click", fermer); document.removeEventListener("keydown", echap) }
  }, [])
  const initiales = nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase()
  return (
    <div className="dropdown compte" ref={ref}>
      <button type="button" className="btn btn-sm btn-outline-light d-flex align-items-center gap-2 dropdown-toggle" aria-expanded={ouvert}
              aria-label={t("Mon compte : {v0}", { v0: nom })} onClick={() => setOuvert(!ouvert)}>
        <span className="compte-initiales" aria-hidden="true">{initiales || "?"}</span><span className="compte-nom">{nom}</span>
      </button>
      <div className={"dropdown-menu dropdown-menu-end shadow" + (ouvert ? " show" : "")} style={{ minWidth: 220 }}>
        <div className="px-3 py-2"><div className="fw-semibold">{nom}</div><span className="badge text-bg-primary">{role}</span></div>
        <div className="dropdown-divider" />
        <button type="button" className="dropdown-item" onClick={onDeconnecter}>{t("Se déconnecter")}</button>
      </div>
    </div>
  )
}

export default function MiseEnPage() {
  const { profil, etablissement, exercice, logoUrl, estAdmin, peutNoter, peutDiscipline, peutFinance, proprietaire } = useSession()
  const [ouvert, setOuvert] = useState(false)
  const { pathname } = useLocation()
  const naviguer = useNavigate()
  useEffect(() => setOuvert(false), [pathname])
  const lien = ({ isActive }) => "nav-link" + (isActive ? " active fw-semibold" : "")

  async function deconnecter() {
    await supabase.auth.signOut()
    naviguer(profil?.compte_google ? "/" : "/connexion")
  }

  return (
    <>
      <nav className="navbar navbar-expand-xl navbar-dark bg-primary no-print">
        <div className="container-fluid">
          <Link className="navbar-brand fw-semibold d-flex align-items-center gap-2" to="/"><img src="/logo-nexia-192.png" alt="" width="30" height="30" className="rounded-2 bg-white" /><span className="marque-texte">NexIA School</span></Link>
          <button className="navbar-toggler" type="button" aria-label={t("Menu")} aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            <span className="navbar-toggler-icon" />
          </button>
          <div className={"collapse navbar-collapse" + (ouvert ? " show" : "")}>
            <ul className="navbar-nav me-auto">
              <li className="nav-item"><NavLink className={lien} to="/" end>{t("Accueil")}</NavLink></li>
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/eleves">{t("Élèves")}</NavLink></li>}
              {peutNoter && <Menu titre={t("Notes")} liens={[["/notes/saisie", t("Saisie des notes")], ["/notes/resultats", t("Résultats et classements")], ["/notes/bulletins", t("Bulletins")]]} />}
              {peutDiscipline && <Menu titre={t("Discipline")} liens={[["/discipline/appel", t("Appel du jour (absences, retards)")], ["/discipline/infractions", t("Infractions")], ["/discipline/suivi", t("Suivi disciplinaire")], ["/discipline/alertes", t("Alertes et seuils")]]} />}
              {peutFinance && <li className="nav-item"><NavLink className={lien} to="/finance">{t("Finances")}</NavLink></li>}
              {peutNoter && <li className="nav-item"><NavLink className={lien} to="/excel">{t("Excel")}</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/statistiques">{t("Statistiques")}</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/parametres">{t("Paramètres")}</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/personnel">{t("Personnel")}</NavLink></li>}
              {(estAdmin || etablissement?.api_active) && <li className="nav-item"><NavLink className={lien} to="/developpeur">{t("IA et API")}</NavLink></li>}
            </ul>
            <div className="navbar-text identite-etab text-white small me-3 py-2 py-xl-0" title={`${etablissement?.nom || ""} · ${exercice?.libelle || ""}`}>
              <BulleLogo url={logoUrl} nom={etablissement?.nom} taille={34} />
              <span className="texte"><span className="fw-semibold">{etablissement?.nom}</span>{t(" · Exercice ")}{exercice?.libelle || t("non défini")}</span>
            </div>
            <div className="d-flex align-items-center gap-2">
              {proprietaire && <Link className="btn btn-sm btn-warning text-dark" to="/console" title={t("Console du propriétaire de la plateforme")}>{t("Console")}</Link>}
              <ChoixLangue variante="sombre" />
              <Compte nom={nomComplet(profil)} role={t(LIBELLES_ROLES[profil?.role])} onDeconnecter={deconnecter} />
            </div>
          </div>
        </div>
      </nav>
      <main className="container-fluid py-3 px-3 px-lg-4">
        <Outlet />
      </main>
      {exercice && (peutFinance || peutDiscipline) && (
        <div className="bulles-alertes no-print">
          {peutDiscipline && <AlerteDiscipline />}
          {peutFinance && <AlerteFinance />}
        </div>)}
    </>
  );
}
