import { useEffect, useRef, useState } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useSession } from "../Session.jsx"
import { supabase } from "../supabase.js"
import { nomComplet } from "../lib/format.js"
import { BulleLogo } from "./Logo.jsx"

export const LIBELLES_ROLES = { admin: "Administration", enseignant: "Enseignant", surveillant: "Surveillant général" }

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

export default function MiseEnPage() {
  const { profil, etablissement, exercice, logoUrl, estAdmin, peutNoter, peutDiscipline, proprietaire } = useSession()
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
          <Link className="navbar-brand fw-semibold" to="/">NexIASchool</Link>
          <button className="navbar-toggler" type="button" aria-label="Menu" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            <span className="navbar-toggler-icon" />
          </button>
          <div className={"collapse navbar-collapse" + (ouvert ? " show" : "")}>
            <ul className="navbar-nav me-auto">
              <li className="nav-item"><NavLink className={lien} to="/" end>Accueil</NavLink></li>
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/eleves">Élèves</NavLink></li>}
              {peutNoter && <Menu titre="Notes" liens={[["/notes/saisie", "Saisie des notes"], ["/notes/resultats", "Résultats et classements"], ["/notes/bulletins", "Bulletins"]]} />}
              {peutDiscipline && <Menu titre="Discipline" liens={[["/discipline/appel", "Appel du jour (absences, retards)"], ["/discipline/infractions", "Infractions"], ["/discipline/suivi", "Suivi disciplinaire"]]} />}
              {peutNoter && <li className="nav-item"><NavLink className={lien} to="/excel">Excel</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/statistiques">Statistiques</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/parametres">Paramètres</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/personnel">Personnel</NavLink></li>}
              {(estAdmin || etablissement?.api_active) && <li className="nav-item"><NavLink className={lien} to="/developpeur">IA et API</NavLink></li>}
            </ul>
            <div className="navbar-text identite-etab text-white small me-3 py-2 py-xl-0">
              <BulleLogo url={logoUrl} nom={etablissement?.nom} taille={34} />
              <span className="texte"><span className="fw-semibold">{etablissement?.nom}</span> · Exercice {exercice?.libelle || "non défini"}</span>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="text-white small">{nomComplet(profil)}
                <span className="badge text-bg-light text-primary ms-1">{LIBELLES_ROLES[profil?.role]}</span></span>
              {proprietaire && <Link className="btn btn-sm btn-warning text-dark" to="/console" title="Console du propriétaire de la plateforme">Console</Link>}
              <button className="btn btn-sm btn-outline-light" onClick={deconnecter}>Se déconnecter</button>
            </div>
          </div>
        </div>
      </nav>
      <main className="container-fluid py-3 px-3 px-lg-4">
        <Outlet />
      </main>
    </>
  )
}
