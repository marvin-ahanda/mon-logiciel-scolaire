import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Chargement } from "./composants/Communs.jsx"
import MiseEnPage from "./composants/MiseEnPage.jsx"
import { lireAppareil } from "./lib/appareil.js"
import { Connexion, Etablissement, Inscription } from "./pages/Acces.jsx"
import Accueil from "./pages/Accueil.jsx"
import PageBulletins from "./pages/Bulletins.jsx"
import { Appel, Infractions, Suivi } from "./pages/Discipline.jsx"
import Eleves from "./pages/Eleves.jsx"
import Excel from "./pages/Excel.jsx"
import Statistiques from "./pages/Statistiques.jsx"
import Parametres from "./pages/Parametres.jsx"
import Personnel from "./pages/Personnel.jsx"
import Resultats from "./pages/Resultats.jsx"
import Saisie from "./pages/Saisie.jsx"
import { SessionProvider, useSession } from "./Session.jsx"

function Protege({ admin = false, droit }) {
  const session_ = useSession()
  const { pret, session, profil, estAdmin, erreur, sansEtablissement } = session_
  if (!pret) return <Chargement />
  if (sansEtablissement) return <Navigate to="/inscription" replace />
  if (erreur) return <div className="container py-5"><div className="alert alert-danger">Connexion au serveur impossible. Vérifiez votre accès à Internet puis rechargez la page.</div></div>
  if (!session || !profil) return <Navigate to={lireAppareil() ? "/connexion" : "/etablissement"} replace />
  if ((admin && !estAdmin) || (droit && !session_[droit])) return <Navigate to="/" replace />
  return <MiseEnPage />
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/etablissement" element={<Etablissement />} />
          <Route path="/inscription" element={<Inscription />} />
          <Route path="/connexion" element={<Connexion />} />
          <Route element={<Protege />}>
            <Route path="/" element={<Accueil />} />
          </Route>
          <Route element={<Protege droit="peutNoter" />}>
            <Route path="/notes/saisie" element={<Saisie />} />
            <Route path="/notes/resultats" element={<Resultats />} />
            <Route path="/notes/bulletins" element={<PageBulletins />} />
            <Route path="/excel" element={<Excel />} />
          </Route>
          <Route element={<Protege droit="peutDiscipline" />}>
            <Route path="/discipline/appel" element={<Appel />} />
            <Route path="/discipline/infractions" element={<Infractions />} />
            <Route path="/discipline/suivi" element={<Suivi />} />
          </Route>
          <Route element={<Protege admin />}>
            <Route path="/eleves" element={<Eleves />} />
            <Route path="/parametres/*" element={<Parametres />} />
            <Route path="/personnel" element={<Personnel />} />
            <Route path="/statistiques/*" element={<Statistiques />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
