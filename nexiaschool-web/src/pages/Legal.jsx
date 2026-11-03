import { useEffect } from "react"
import { Link } from "react-router-dom"
import { EDITEUR, contactTexte } from "../lib/editeur.js"
import "../landing.css"

function PageLegale({ titre, children }) {
  useEffect(() => { document.title = `${titre} — NexIASchool`; window.scrollTo(0, 0) }, [titre])
  return (
    <div className="lp">
      <header className="lp-entete lp-entete-ombre">
        <div className="lp-conteneur lp-entete-interieur">
          <Link to="/" className="lp-logo"><span className="lp-logo-mark" aria-hidden="true">N</span><span>NexIA <strong>School</strong></span></Link>
          <Link className="lp-connexion" to="/" style={{ marginLeft: "auto" }}>Retour à l'accueil</Link>
        </div>
      </header>
      <main className="lp-conteneur lp-legal">
        <h1>{titre}</h1>
        <p className="lp-legal-maj">Dernière mise à jour : {EDITEUR.miseAJour}</p>
        {children}
      </main>
      <footer className="lp-pied">
        <div className="lp-conteneur lp-pied-interieur">
          <nav aria-label="Liens légaux" style={{ marginLeft: 0 }}>
            <Link to="/confidentialite">Politique de confidentialité</Link>
            <Link to="/conditions">Conditions d'utilisation</Link>
            <Link to="/">Accueil</Link>
          </nav>
          <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service}</p>
        </div>
      </footer>
    </div>
  )
}

export function Confidentialite() {
  return (
    <PageLegale titre="Politique de confidentialité">
      <p>La présente politique explique quelles données personnelles sont traitées par {EDITEUR.service} ({EDITEUR.site}),
        logiciel en ligne de gestion des notes, bulletins et de la discipline scolaire édité par {EDITEUR.nom}, pourquoi elles le sont
        et quels sont vos droits.</p>

      <h2>1. Qui est responsable des données ?</h2>
      <p>Chaque établissement scolaire qui crée un espace sur {EDITEUR.service} décide des données qu'il y enregistre (élèves, notes,
        personnel) : il en est le <strong>responsable de traitement</strong>. {EDITEUR.nom} agit pour son compte en tant que
        <strong> sous-traitant</strong> : nous hébergeons et traitons ces données uniquement pour fournir le service, selon les
        instructions de l'établissement.</p>
      <p>Pour les données nécessaires au fonctionnement du service lui-même (compte du fondateur, sécurité, journaux techniques),{" "}
        {EDITEUR.nom} est responsable de traitement.</p>

      <h2>2. Données traitées</h2>
      <ul>
        <li><strong>Établissement</strong> : nom, ville, adresse, téléphone, devise, nom du chef d'établissement.</li>
        <li><strong>Fondateur connecté avec Google</strong> : identifiant de compte Google, adresse e-mail, nom et prénom transmis par Google.</li>
        <li><strong>Personnel</strong> : nom, prénom, rôle (administration, enseignant, surveillant général), matricule et téléphone facultatifs,
          date de dernière connexion. Les codes d'accès ne sont <strong>jamais conservés en clair</strong> : seule une empreinte chiffrée est enregistrée.</li>
        <li><strong>Élèves</strong> (données de mineurs) : matricule, nom, prénom, sexe, date et lieu de naissance, téléphone d'un parent,
          photo facultative, classe, notes, absences, retards, infractions et sanctions.</li>
        <li><strong>Données techniques</strong> : adresse IP (utilisée uniquement pour limiter les essais de codes erronés), journaux de sécurité
          de l'hébergeur, jeton de session.</li>
      </ul>

      <h2>3. Finalités et bases légales</h2>
      <ul>
        <li>Fournir le service de gestion scolaire à l'établissement (exécution du contrat avec l'établissement).</li>
        <li>Authentifier les utilisateurs et protéger les comptes contre les accès non autorisés (intérêt légitime de sécurité).</li>
        <li>Répondre aux demandes d'assistance et respecter nos obligations légales.</li>
      </ul>
      <p>Les données ne sont <strong>jamais utilisées à des fins publicitaires</strong>, ni vendues, ni louées, ni utilisées pour entraîner
        des modèles d'intelligence artificielle.</p>

      <h2>4. Données reçues de Google</h2>
      <p>Lorsque le fondateur d'un établissement choisit « Se connecter avec Google », {EDITEUR.service} reçoit uniquement son identifiant
        Google, son adresse e-mail, son nom et sa photo de profil (autorisations « openid », « email » et « profile »). Ces informations
        servent exclusivement à créer et sécuriser son compte d'administrateur et à pré-remplir son nom. Elles ne sont ni partagées avec des tiers,
        ni utilisées à d'autres fins. L'utilisation des informations reçues des API Google respecte les
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer"> règles d'utilisation des données
        utilisateur des services d'API Google</a>, y compris les exigences d'utilisation limitée (« Limited Use »).</p>

      <h2>5. Destinataires</h2>
      <p>Les données d'un établissement ne sont accessibles qu'au personnel de cet établissement, selon son rôle : la base de données refuse
        techniquement toute lecture ou écriture en dehors de l'établissement de l'utilisateur. Nos prestataires techniques n'y accèdent que pour
        assurer l'hébergement :</p>
      <ul>
        <li><strong>Supabase</strong> : base de données, authentification et stockage des photos, hébergés dans un centre de données situé à Paris (France).</li>
        <li><strong>Netlify</strong> : hébergement et diffusion des pages de l'application (aucune donnée d'élève n'y est stockée).</li>
        <li><strong>Google</strong> : uniquement pour la connexion des fondateurs qui choisissent cette méthode.</li>
      </ul>
      <p>Certains de ces prestataires peuvent traiter des données techniques hors du pays de l'utilisateur ; ils sont tenus contractuellement
        à des garanties de confidentialité et de sécurité.</p>

      <h2>6. Durée de conservation</h2>
      <ul>
        <li>Données scolaires : tant que l'espace de l'établissement est actif ; l'établissement peut supprimer à tout moment élèves, notes ou membres du personnel.</li>
        <li>À la fermeture d'un espace : suppression dans un délai de 90 jours, sauf obligation légale contraire. L'établissement peut auparavant exporter ses données au format Excel.</li>
        <li>Compteurs d'essais de codes : supprimés après une connexion réussie ; jetons d'appareil : 30 jours.</li>
      </ul>

      <h2>7. Sécurité</h2>
      <p>Connexions chiffrées (HTTPS) ; isolation de chaque établissement par des règles de sécurité appliquées par la base de données ;
        codes d'accès chiffrés et blocage temporaire après plusieurs essais erronés ; photos stockées dans un espace privé, accessibles seulement par
        des liens temporaires ; aucune clé secrète dans le code envoyé au navigateur.</p>

      <h2>8. Données des élèves mineurs</h2>
      <p>Les données des élèves sont saisies par l'établissement, sous sa responsabilité. Il lui appartient d'informer les élèves et leurs parents
        ou représentants légaux de l'utilisation de {EDITEUR.service} et de recueillir, lorsque la loi l'exige, leur accord (notamment pour les photos).
        Les élèves et les parents n'ont pas de compte sur le service.</p>

      <h2>9. Cookies et stockage local</h2>
      <p>{EDITEUR.service} n'utilise <strong>aucun cookie publicitaire ni outil de mesure d'audience</strong>. Le navigateur conserve seulement
        la session de connexion et l'établissement choisi sur l'appareil (stockage local), indispensables au fonctionnement du service.</p>

      <h2>10. Vos droits</h2>
      <p>Conformément à la législation applicable en matière de protection des données personnelles (notamment au {EDITEUR.pays} et, lorsqu'il s'applique,
        le Règlement général sur la protection des données de l'Union européenne), vous disposez d'un droit d'accès, de rectification, d'effacement,
        de limitation et d'opposition. Pour les données scolaires, adressez-vous d'abord à l'administration de votre établissement, qui peut les consulter,
        les corriger ou les supprimer directement. Pour toute autre demande, contactez {EDITEUR.nom} : {contactTexte()}. Vous pouvez également saisir
        l'autorité de protection des données compétente.</p>

      <h2>11. Modifications</h2>
      <p>Cette politique peut évoluer. La date de mise à jour figure en haut de la page ; en cas de changement important, les administrateurs
        des établissements en seront informés.</p>
    </PageLegale>
  )
}

export function Conditions() {
  return (
    <PageLegale titre="Conditions d'utilisation">
      <p>Les présentes conditions encadrent l'utilisation de {EDITEUR.service} ({EDITEUR.site}), service en ligne de gestion des notes, bulletins,
        de la discipline et des statistiques scolaires, édité par {EDITEUR.nom}. En créant l'espace d'un établissement ou en utilisant le service,
        vous acceptez ces conditions.</p>

      <h2>1. Le service</h2>
      <p>{EDITEUR.service} permet à un établissement scolaire de gérer ses exercices, classes, matières, élèves, notes, résultats, bulletins,
        discipline et statistiques, et d'importer ou d'exporter ces données au format Excel. Le service est accessible depuis un navigateur ;
        il est actuellement proposé <strong>gratuitement</strong>. Toute évolution tarifaire serait annoncée à l'avance et ne s'appliquerait
        qu'avec l'accord de l'établissement.</p>

      <h2>2. Création de l'espace et comptes</h2>
      <ul>
        <li>L'espace d'un établissement est créé par une personne habilitée à le représenter (chef d'établissement ou personne mandatée),
          qui se connecte avec son compte Google et devient l'administrateur fondateur.</li>
        <li>L'administration crée les comptes du personnel ; chaque membre reçoit un <strong>code personnel</strong>. Le code de l'établissement
          et les codes personnels sont confidentiels : ne les communiquez qu'aux personnes concernées et changez-les en cas de doute.</li>
        <li>Chaque utilisateur est responsable des actions réalisées avec son code. Signalez sans délai toute utilisation suspecte à l'administration
          de votre établissement.</li>
      </ul>

      <h2>3. Engagements de l'établissement</h2>
      <ul>
        <li>Saisir des données exactes et licites, et seulement celles nécessaires à la gestion scolaire.</li>
        <li>Informer les élèves, les parents et le personnel de l'utilisation du service et recueillir les accords requis par la loi (notamment pour les photos).</li>
        <li>Attribuer à chaque membre du personnel le rôle adapté à ses fonctions et désactiver les comptes des personnes qui quittent l'établissement.</li>
        <li>Conserver ses propres exports des données importantes (bulletins, résultats) selon ses obligations administratives.</li>
      </ul>

      <h2>4. Utilisations interdites</h2>
      <p>Il est interdit de tenter d'accéder aux données d'un autre établissement, de contourner les mesures de sécurité, de deviner ou partager des
        codes d'autrui, de perturber le fonctionnement du service (envois automatisés massifs, attaques), d'y déposer des contenus illicites ou d'utiliser
        le service pour une autre finalité que la gestion scolaire.</p>

      <h2>5. Données et propriété</h2>
      <p>L'établissement reste propriétaire de ses données. {EDITEUR.nom} les traite uniquement pour fournir le service, comme décrit dans la
        <Link to="/confidentialite"> politique de confidentialité</Link>. Le logiciel, son interface et sa marque restent la propriété de {EDITEUR.nom}.</p>

      <h2>6. Disponibilité</h2>
      <p>Nous faisons nos meilleurs efforts pour que le service soit disponible et sécurisé, sans pouvoir garantir une disponibilité permanente :
        des interruptions peuvent survenir pour maintenance, mise à jour ou en raison de nos prestataires d'hébergement. Le service est fourni « en l'état ».</p>

      <h2>7. Responsabilité</h2>
      <p>Les calculs (moyennes, rangs, notes de discipline) reposent sur les données et paramètres saisis par l'établissement, qui reste seul responsable
        des décisions prises à partir de ces résultats et de la vérification des bulletins avant leur diffusion. Dans les limites permises par la loi,
        la responsabilité de {EDITEUR.nom} ne saurait être engagée pour un dommage indirect ou résultant d'une mauvaise utilisation du service.</p>

      <h2>8. Suspension et fermeture</h2>
      <p>L'établissement peut cesser d'utiliser le service à tout moment et demander la suppression de son espace. {EDITEUR.nom} peut suspendre un espace
        en cas de violation grave des présentes conditions ou de risque pour la sécurité, après avoir, sauf urgence, prévenu l'administration de l'établissement.
        Avant toute fermeture à notre initiative, l'établissement disposera d'un délai raisonnable pour exporter ses données.</p>

      <h2>9. Modifications des conditions</h2>
      <p>Ces conditions peuvent évoluer ; la date de mise à jour figure en haut de la page. En cas de changement important, les administrateurs des
        établissements en seront informés avant son entrée en vigueur.</p>

      <h2>10. Droit applicable et contact</h2>
      <p>Les présentes conditions sont régies par le droit applicable au {EDITEUR.pays}. En cas de difficulté, nous privilégions une solution amiable :
        contactez {EDITEUR.nom} à {contactTexte()}.</p>
    </PageLegale>
  )
}
