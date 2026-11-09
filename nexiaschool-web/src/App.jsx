import { lazy, Suspense } from "react"
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom"
import { Chargement } from "./composants/Communs.jsx"
import MiseEnPage from "./composants/MiseEnPage.jsx"
import { lireAppareil } from "./lib/appareil.js"
import { Connexion, Etablissement, Inscription } from "./pages/Acces.jsx"
import Accueil from "./pages/Accueil.jsx"
import Landing from "./pages/Landing.jsx"
import { Conditions, Confidentialite } from "./pages/Legal.jsx"
import Developpeur from "./pages/Developpeur.jsx"
import Developpeurs from "./pages/Developpeurs.jsx"
import OAuthAutoriser from "./pages/OAuthAutoriser.jsx"
import Verifier from "./pages/Verifier.jsx"
import EvaluationEleve from "./pages/EvaluationEleve.jsx"
import PortailParent, { ChoixProfil, ConnexionParent } from "./pages/Parent.jsx"
import Courrier from "./pages/Courrier.jsx"
import SmartEval, { EditeurEvaluation, JournalSmartEval, ResultatsEvaluation } from "./pages/SmartEval.jsx"
import PageBulletins from "./pages/Bulletins.jsx"
import { Appel, Infractions, Suivi } from "./pages/Discipline.jsx"
import Eleves from "./pages/Eleves.jsx"
import Excel from "./pages/Excel.jsx"
import Finance from "./pages/Finance.jsx"
import Statistiques from "./pages/Statistiques.jsx"
import Parametres from "./pages/Parametres.jsx"
import Personnel from "./pages/Personnel.jsx"
import Resultats from "./pages/Resultats.jsx"
import Saisie from "./pages/Saisie.jsx"
import { SessionProvider, useSession } from "./Session.jsx"
import { supabase } from "./supabase.js"
import { ChoixLangue, t } from "./i18n.jsx"
import AlertesDiscipline from "./pages/AlertesDiscipline.jsx"
import RetardsNotes from "./pages/RetardsNotes.jsx"

const Console = lazy(() => import("./pages/Console.jsx"))      // chargée seulement par le propriétaire

/** Établissement suspendu par la plateforme : aucun accès aux données, message et contact. */
function Suspendu() {
  const { suspendu, proprietaire } = useSession()
  return (
    <div className="row justify-content-center mt-5 mx-0"><div className="col-md-8 col-lg-6"><div className="card shadow-sm border-danger"><div className="card-body p-4">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-3"><h1 className="h4 text-danger mb-0">{t("Espace suspendu")}</h1><ChoixLangue /></div>
        <p>{t("L'accès à l'espace de ")}<strong>{suspendu.etablissement}</strong>{t(" sur NexIA School est temporairement suspendu.")}</p>
        {suspendu.motif && <p className="text-muted">{t("Motif : ")}{suspendu.motif}</p>}
        <p>{t(
          "Vos données sont conservées. Pour toute question ou pour rétablir l'accès, écrivez à"
        )}{" "}
          <a href="mailto:contact@nexiaacademy.net">{t("contact@nexiaacademy.net")}</a>.</p>
        <div className="d-flex gap-2">
          {proprietaire && <Link className="btn btn-dark" to="/console">{t("Console de la plateforme")}</Link>}
          <button className="btn btn-outline-secondary" onClick={() => supabase.auth.signOut()}>{t("Se déconnecter")}</button>
        </div>
      </div></div></div></div>
  );
}

function Protege({ admin = false, droit }) {
  const session_ = useSession()
  const { pret, session, profil, estAdmin, erreur, sansEtablissement, suspendu } = session_
  if (!pret) return <Chargement />
  if (suspendu) return <Suspendu />
  if (sansEtablissement) return <Navigate to="/inscription" replace />
  if (erreur) return (
    <div className="container py-5"><div className="alert alert-danger">{t(
      "Connexion au serveur impossible. Vérifiez votre accès à Internet puis rechargez la page."
    )}</div></div>
  );
  if (!session || !profil) return <Navigate to={lireAppareil() ? "/connexion" : "/etablissement"} replace />
  if ((admin && !estAdmin) || (droit && !session_[droit])) return <Navigate to="/" replace />
  return <MiseEnPage />
}

/** « / » : page d'accueil publique pour les visiteurs, tableau de bord pour le personnel connecté. */
function Racine() {
  const { pret, session, profil, sansEtablissement, suspendu } = useSession()
  if (!pret) return <Chargement />
  if (suspendu) return <Suspendu />
  if (sansEtablissement) return <Navigate to="/inscription" replace />
  if (session && profil) return <MiseEnPage />
  return <Landing />
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
        <Routes>
          <Route path="/etablissement" element={<Etablissement />} />
          <Route path="/inscription" element={<Inscription />} />
          <Route path="/connexion" element={<Connexion />} />
          <Route path="/confidentialite" element={<Confidentialite />} />
          <Route path="/conditions" element={<Conditions />} />
          <Route path="/developpeurs" element={<Developpeurs />} />
          <Route path="/oauth/autoriser" element={<OAuthAutoriser />} />
          <Route path="/verifier/:code" element={<Verifier />} />
          <Route path="/e/:jeton" element={<EvaluationEleve />} />
          <Route path="/acces" element={<ChoixProfil />} />
          <Route path="/parent/connexion" element={<ConnexionParent />} />
          <Route path="/parent" element={<PortailParent />} />
          <Route path="/console/*" element={<Suspense fallback={<Chargement />}><Console /></Suspense>} />
          <Route path="/" element={<Racine />}>
            <Route index element={<Accueil />} />
          </Route>
          <Route element={<Protege />}>
            <Route path="/developpeur" element={<Developpeur />} />
            <Route path="/smarteval" element={<SmartEval />} />
            <Route path="/smarteval/nouvelle" element={<EditeurEvaluation />} />
            <Route path="/smarteval/journal" element={<JournalSmartEval />} />
            <Route path="/smarteval/:id/modifier" element={<EditeurEvaluation />} />
            <Route path="/smarteval/:id" element={<ResultatsEvaluation />} />
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
            <Route path="/discipline/alertes" element={<AlertesDiscipline />} />
          </Route>
          <Route element={<Protege droit="peutCourrier" />}>
            <Route path="/courrier" element={<Courrier />} />
          </Route>
          <Route element={<Protege droit="peutFinance" />}>
            <Route path="/finance/*" element={<Finance />} />
          </Route>
          <Route element={<Protege admin />}>
            <Route path="/eleves" element={<Eleves />} />
            <Route path="/notes/retards" element={<RetardsNotes />} />
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
