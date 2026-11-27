import { lazy, Suspense } from "react"
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom"
import { Chargement, LimiteChargement } from "./composants/Communs.jsx"
import MiseEnPage from "./composants/MiseEnPage.jsx"
import { lireAppareil } from "./lib/appareil.js"
import { Connexion, Etablissement, Inscription } from "./pages/Acces.jsx"
import Accueil from "./pages/Accueil.jsx"
import Landing from "./pages/Landing.jsx"
import { SessionProvider, useSession } from "./Session.jsx"
import { supabase } from "./supabase.js"
import { ChoixLangue, t } from "./i18n.jsx"

// Pages chargées à la demande : le démarrage ne télécharge que l'essentiel (connexions lentes) ;
// le service worker précharge ensuite les autres pages en arrière-plan quand la connexion le permet.
/** Adresse inconnue : page 404 explicite (au lieu d'une redirection silencieuse vers l'accueil). */
function PageIntrouvable() {
  return (
    <main className="container py-5 text-center page-introuvable" style={{ maxWidth: 560 }}>
      <div className="display-4 fw-bold text-muted">404</div>
      <h1 className="h4 mt-2">{t("Page introuvable")}</h1>
      <p className="text-muted">{t("L'adresse demandée n'existe pas ou n'est plus disponible. Vérifiez le lien, ou revenez à l'accueil.")}</p>
      <Link className="btn btn-primary" to="/">{t("Retour à l'accueil")}</Link>
    </main>
  )
}

const page = (charger, nom = "default") => lazy(() => charger().then((m) => ({ default: m[nom] })))
const Developpeur = page(() => import("./pages/Developpeur.jsx"))
const Developpeurs = page(() => import("./pages/Developpeurs.jsx"))
const OAuthAutoriser = page(() => import("./pages/OAuthAutoriser.jsx"))
const Verifier = page(() => import("./pages/Verifier.jsx"))
const VerifierRecu = page(() => import("./pages/VerifierRecu.jsx"))
const VerifierDistinction = page(() => import("./pages/VerifierDistinction.jsx"))
const VerifierCarte = page(() => import("./pages/VerifierCarte.jsx"))
const EvaluationEleve = page(() => import("./pages/EvaluationEleve.jsx"))
const Courrier = page(() => import("./pages/Courrier.jsx"))
const PageBulletins = page(() => import("./pages/Bulletins.jsx"))
const Eleves = page(() => import("./pages/Eleves.jsx"))
const Excel = page(() => import("./pages/Excel.jsx"))
const Finance = page(() => import("./pages/Finance.jsx"))
const MesBulletinsPaie = page(() => import("./pages/finances/MesBulletinsPaie.jsx"))
const Statistiques = page(() => import("./pages/Statistiques.jsx"))
const Parametres = page(() => import("./pages/Parametres.jsx"))
const Personnel = page(() => import("./pages/Personnel.jsx"))
const Abonnement = page(() => import("./pages/Abonnement.jsx"))
const Resultats = page(() => import("./pages/Resultats.jsx"))
const Saisie = page(() => import("./pages/Saisie.jsx"))
const AlertesDiscipline = page(() => import("./pages/AlertesDiscipline.jsx"))
const RetardsNotes = page(() => import("./pages/RetardsNotes.jsx"))
const Pv = page(() => import("./pages/pv/Pv.jsx"))
const MesAutomatisations = lazy(() => import("./pages/Automatisations.jsx").then((m) => ({ default: () => <m.default rubrique /> })))
const Conditions = page(() => import("./pages/Legal.jsx"), "Conditions")
const Confidentialite = page(() => import("./pages/Legal.jsx"), "Confidentialite")
const PortailParent = page(() => import("./pages/Parent.jsx"))
const ChoixProfil = page(() => import("./pages/Parent.jsx"), "ChoixProfil")
const ConnexionParent = page(() => import("./pages/Parent.jsx"), "ConnexionParent")
const SmartEval = page(() => import("./pages/SmartEval.jsx"))
const EditeurEvaluation = page(() => import("./pages/SmartEval.jsx"), "EditeurEvaluation")
const JournalSmartEval = page(() => import("./pages/SmartEval.jsx"), "JournalSmartEval")
const ResultatsEvaluation = page(() => import("./pages/SmartEval.jsx"), "ResultatsEvaluation")
const Appel = page(() => import("./pages/Discipline.jsx"), "Appel")
const Infractions = page(() => import("./pages/Discipline.jsx"), "Infractions")
const Suivi = page(() => import("./pages/Discipline.jsx"), "Suivi")
const TarifsEtablissements = page(() => import("./pages/Tarifs.jsx"), "TarifsEtablissements")
const TarifsSmartEval = page(() => import("./pages/Tarifs.jsx"), "TarifsSmartEval")
const ChoixInscription = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "ChoixInscription")
const InscriptionEnseignant = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "InscriptionEnseignant")
const ConnexionEnseignant = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "ConnexionEnseignant")
const NouveauMotDePasse = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "NouveauMotDePasse")
const Bienvenue = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "Bienvenue")
const ConnexionGroupe = page(() => import("./pages/enseignant/AccesEnseignant.jsx"), "ConnexionGroupe")
const EspaceEnseignant = page(() => import("./pages/enseignant/EspaceEnseignant.jsx"))
const EspaceInstitution = page(() => import("./pages/institution/Espace.jsx"))
const InscriptionDelegue = page(() => import("./pages/institution/Acces.jsx"), "InscriptionDelegue")
const ConnexionDelegue = page(() => import("./pages/institution/Acces.jsx"), "ConnexionDelegue")
const FichesStatistiques = page(() => import("./pages/institution/Etablissement.jsx"))
const CourriersInstitutionnels = page(() => import("./pages/institution/Etablissement.jsx"), "CourriersInstitutionnels")
const Console = lazy(() => import("./pages/Console.jsx"))      // chargée seulement par le propriétaire
const ConsultationEdt = lazy(() => import("./pages/edt/Consultation.jsx"))   // emplois du temps publiés

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
  const { pret, session, profil, estAdmin, erreur, sansCompte, suspendu, enseignant, institution } = session_
  if (!pret) return <Chargement />
  if (suspendu) return <Suspendu />
  if (enseignant?.compte) return <Navigate to="/enseignant" replace />
  if (institution) return <Navigate to="/institution" replace />
  if (sansCompte) return <Navigate to="/bienvenue" replace />
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
  const { pret, session, profil, sansCompte, suspendu, enseignant, institution } = useSession()
  if (!pret) return <Chargement />
  if (suspendu) return <Suspendu />
  if (enseignant?.compte) return <Navigate to="/enseignant" replace />
  if (institution) return <Navigate to="/institution" replace />
  if (sansCompte) return <Navigate to="/bienvenue" replace />
  if (session && profil) return <MiseEnPage />
  return <Landing />
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
        <LimiteChargement><Suspense fallback={<Chargement />}>
        <Routes>
          <Route path="/etablissement" element={<Etablissement />} />
          <Route path="/inscription" element={<Inscription />} />
          <Route path="/connexion" element={<Connexion />} />
          <Route path="/confidentialite" element={<Confidentialite />} />
          <Route path="/conditions" element={<Conditions />} />
          <Route path="/developpeurs" element={<Developpeurs />} />
          <Route path="/oauth/autoriser" element={<OAuthAutoriser />} />
          <Route path="/verifier/:code" element={<Verifier />} />
          <Route path="/recu/:code" element={<VerifierRecu />} />
          <Route path="/distinction/:code" element={<VerifierDistinction />} />
          <Route path="/carte/:code" element={<VerifierCarte />} />
          <Route path="/e/:jeton" element={<EvaluationEleve />} />
          <Route path="/acces" element={<ChoixProfil />} />
          <Route path="/parent/connexion" element={<ConnexionParent />} />
          <Route path="/parent" element={<PortailParent />} />
          <Route path="/tarifs" element={<TarifsEtablissements />} />
          <Route path="/tarifs/smarteval" element={<TarifsSmartEval />} />
          <Route path="/commencer" element={<ChoixInscription />} />
          <Route path="/bienvenue" element={<Bienvenue />} />
          <Route path="/smarteval/inscription" element={<InscriptionEnseignant />} />
          <Route path="/smarteval/connexion" element={<ConnexionEnseignant />} />
          <Route path="/smarteval/mot-de-passe" element={<NouveauMotDePasse />} />
          <Route path="/smarteval/groupe" element={<ConnexionGroupe />} />
          <Route path="/enseignant/*" element={<EspaceEnseignant />} />
          <Route path="/institution/inscription" element={<InscriptionDelegue />} />
          <Route path="/institution/connexion" element={<ConnexionDelegue />} />
          <Route path="/institution/*" element={<EspaceInstitution />} />
          <Route path="/console/*" element={<Suspense fallback={<Chargement />}><Console /></Suspense>} />
          <Route path="/" element={<Racine />}>
            <Route index element={<Accueil />} />
          </Route>
          <Route element={<Protege />}>
            <Route path="/developpeur" element={<Developpeur />} />
            <Route path="/mes-bulletins-paie" element={<MesBulletinsPaie />} />
            <Route path="/smarteval" element={<SmartEval />} />
            <Route path="/smarteval/nouvelle" element={<EditeurEvaluation />} />
            <Route path="/smarteval/journal" element={<JournalSmartEval />} />
            <Route path="/smarteval/:id/modifier" element={<EditeurEvaluation />} />
            <Route path="/smarteval/:id" element={<ResultatsEvaluation />} />
            <Route path="/emploi-du-temps" element={<Suspense fallback={<Chargement />}><ConsultationEdt /></Suspense>} />
            <Route path="/automatisations" element={<MesAutomatisations />} />
          </Route>
          <Route element={<Protege droit="peutNoter" />}>
            <Route path="/notes/saisie" element={<Saisie />} />
            <Route path="/notes/resultats" element={<Resultats />} />
            <Route path="/notes/pv/*" element={<Pv />} />
          </Route>
          <Route element={<Protege droit="peutExcel" />}>
            <Route path="/excel" element={<Excel />} />
          </Route>
          <Route element={<Protege droit="peutBulletins" />}>
            <Route path="/notes/bulletins" element={<PageBulletins />} />
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
            <Route path="/abonnement" element={<Abonnement />} />
            <Route path="/statistiques/*" element={<Statistiques />} />
            <Route path="/fiches-statistiques/*" element={<FichesStatistiques />} />
            <Route path="/courriers-institutionnels" element={<CourriersInstitutionnels />} />
          </Route>
          <Route path="*" element={<PageIntrouvable />} />
        </Routes>
        </Suspense></LimiteChargement>
      </BrowserRouter>
    </SessionProvider>
  )
}
