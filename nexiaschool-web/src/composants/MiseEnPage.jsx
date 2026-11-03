import { useState } from "react"
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom"
import { useSession } from "../Session.jsx"
import { supabase } from "../supabase.js"
import { nomComplet } from "../lib/format.js"

export default function MiseEnPage() {
  const { profil, etablissement, exercice, estAdmin } = useSession()
  const [ouvert, setOuvert] = useState(false)
  const naviguer = useNavigate()
  const lien = ({ isActive }) => "nav-link" + (isActive ? " active fw-semibold" : "")
  const fermer = () => setOuvert(false)

  async function deconnecter() {
    await supabase.auth.signOut()
    naviguer("/connexion")
  }

  return (
    <>
      <nav className="navbar navbar-expand-lg navbar-dark bg-primary no-print">
        <div className="container-fluid">
          <Link className="navbar-brand fw-semibold" to="/" onClick={fermer}>NexIASchool</Link>
          <button className="navbar-toggler" type="button" aria-label="Menu" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            <span className="navbar-toggler-icon" />
          </button>
          <div className={"collapse navbar-collapse" + (ouvert ? " show" : "")}>
            <ul className="navbar-nav me-auto" onClick={fermer}>
              <li className="nav-item"><NavLink className={lien} to="/" end>Accueil</NavLink></li>
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/eleves">Élèves</NavLink></li>}
              <li className="nav-item"><NavLink className={lien} to="/notes/saisie">Saisie des notes</NavLink></li>
              <li className="nav-item"><NavLink className={lien} to="/notes/resultats">Résultats</NavLink></li>
              <li className="nav-item"><NavLink className={lien} to="/notes/bulletins">Bulletins</NavLink></li>
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/parametres">Paramètres</NavLink></li>}
              {estAdmin && <li className="nav-item"><NavLink className={lien} to="/personnel">Personnel</NavLink></li>}
            </ul>
            <div className="navbar-text text-white small me-3">
              {etablissement?.nom} · Exercice {exercice?.libelle || "non défini"}
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="text-white small">{nomComplet(profil)}
                <span className="badge text-bg-light text-primary ms-1">{estAdmin ? "Administration" : "Enseignant"}</span></span>
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
