import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { EDITEUR } from "../lib/editeur.js"
import { connexionGoogle } from "../supabase.js"
import "../landing.css"

function Logo({ clair = false }) {
  return (
    <span className={`lp-logo ${clair ? "lp-logo-clair" : ""}`}>
      <span className="lp-logo-mark" aria-hidden="true">N</span><span>NexIA <strong>School</strong></span>
    </span>
  )
}

function BoutonPrincipal({ grand = false }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className={`lp-cta ${grand ? "lp-cta-grand" : ""}`}
              onClick={() => connexionGoogle("/inscription").catch((e) => setErreur(e.message))}>
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" opacity=".95"/><path fill="#fff" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" opacity=".8"/><path fill="#fff" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" opacity=".65"/><path fill="#fff" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" opacity=".9"/></svg>
        Créer l'espace de mon établissement
      </button>
      {erreur && <p className="lp-erreur" role="alert">{erreur}</p>}
    </>
  )
}

/** Écran de l'ordinateur : aperçu du tableau de bord de NexIASchool (dessiné en HTML/CSS, aucune image). */
function EcranApplication() {
  const barres = [62, 74, 55, 81, 68, 88]
  return (
    <div className="lp-app" aria-hidden="true">
      <div className="lp-app-nav">
        <span className="lp-app-marque">NexIASchool</span>
        <span>Accueil</span><span>Élèves</span><span>Notes</span><span>Discipline</span><span>Statistiques</span>
        <span className="lp-app-profil">MBALLA Paul · Administration</span>
      </div>
      <div className="lp-app-corps">
        <div className="lp-app-titre">Collège Saint-Joseph de Yaoundé <em>Exercice 2026-2027</em></div>
        <div className="lp-app-tuiles">
          {[["Élèves inscrits", "642"], ["Classes", "18"], ["Personnel actif", "47"], ["Taux de réussite", "71 %"]].map(([l, v]) => (
            <div className="lp-app-tuile" key={l}><span>{l}</span><b>{v}</b></div>))}
        </div>
        <div className="lp-app-grille">
          <div className="lp-app-carte">
            <div className="lp-app-carte-titre">Moyenne générale par classe</div>
            <div className="lp-app-barres">
              {barres.map((h, k) => <div key={k} className="lp-app-barre"><i style={{ height: `${h}%` }} /><span>{["6e", "5e", "4e", "3e", "2nde", "1re"][k]}</span></div>)}
            </div>
          </div>
          <div className="lp-app-carte">
            <div className="lp-app-carte-titre">Résultats — 6e A · Trimestre 1</div>
            {[["1", "ABENA Lucie", "16,42", "Très bien"], ["2", "ESSOMBA Carine", "15,10", "Bien"], ["3", "FOUDA Daniel", "14,85", "Bien"],
              ["4", "NGO Marie", "13,07", "Assez bien"], ["5", "BELLA Bruno", "12,66", "Assez bien"], ["6", "KAMGA Estelle", "11,93", "Passable"],
              ["7", "OWONA Joël", "11,40", "Passable"], ["8", "NJOYA Inès", "10,25", "Passable"]].map((l) => (
              <div className="lp-app-ligne" key={l[0]}><span>{l[0]}</span><span>{l[1]}</span><b>{l[2]}</b><em>{l[3]}</em></div>))}
            <div className="lp-app-pied"><span>Moyenne de la classe : 12,34</span><span>Réussite : <b>71 %</b></span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Ordinateur() {
  return (
    <div className="lp-scene">
      <div className="lp-ordinateur">
        <div className="lp-ecran"><div className="lp-ecran-camera" /><div className="lp-ecran-dalle"><EcranApplication /></div></div>
        <div className="lp-socle"><div className="lp-socle-encoche" /></div>
      </div>
      <div className="lp-ombre" aria-hidden="true" />
    </div>
  )
}

const BENEFICES = [
  ["📝", "Saisie des notes en quelques clics", "Chaque enseignant saisit ses notes par classe et par séquence, depuis un ordinateur ou un téléphone."],
  ["📊", "Moyennes et rangs automatiques", "Moyennes pondérées, rangs ex æquo, moyennes trimestrielles et annuelles calculés sans erreur."],
  ["🖨️", "Bulletins prêts à imprimer", "Bulletins avec photo, appréciations, rang, statistiques de la classe et note de conduite."],
  ["🧭", "Discipline au quotidien", "Appel du jour, retards, infractions et sanctions : la note de discipline se calcule seule."],
  ["📥", "Import et export Excel", "Importez vos listes d'élèves et vos notes depuis Excel, exportez résultats et listes en un clic."],
  ["📈", "Statistiques de pilotage", "Répartition des moyennes, comparaison des classes, effectifs par sexe et par âge."],
]
const ETAPES = [
  ["Créez l'espace", "Le chef d'établissement se connecte avec Google et renseigne le nom et les informations de l'école."],
  ["Ajoutez l'équipe", "Chaque enseignant et le surveillant général reçoivent un code personnel de 6 caractères."],
  ["Travaillez ensemble", "Chacun entre avec le nom de l'établissement, son nom et son code : notes, appel, bulletins."],
]
const ROLES = [
  ["Administration", "Paramètres, classes, matières et coefficients, élèves, personnel, bulletins, statistiques : tous les droits."],
  ["Enseignant", "Saisie et import des notes de ses matières, résultats et bulletins de ses classes."],
  ["Surveillant général", "Appel du jour, retards, infractions et sanctions, suivi disciplinaire de toutes les classes."],
]
const FAQ = [
  ["Combien coûte NexIASchool ?", "La création de l'espace et son utilisation sont actuellement gratuites. Si une offre payante est proposée un jour, vous en serez informé à l'avance et rien ne vous sera facturé sans votre accord."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Que se passe-t-il si un enseignant perd son code ?", "L'administration génère un nouveau code en un clic ; l'ancien cesse aussitôt de fonctionner. Les codes sont enregistrés chiffrés et ne peuvent pas être relus."],
  ["Faut-il installer un logiciel ?", "Non. NexIASchool fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Il suffit d'une connexion à Internet."],
  ["Puis-je récupérer mes données ?", "Oui. Listes d'élèves, notes et résultats s'exportent à tout moment au format Excel."],
]

export default function Landing() {
  const [defile, setDefile] = useState(false)
  useEffect(() => {
    const surveiller = () => setDefile(window.scrollY > 10)
    surveiller()
    window.addEventListener("scroll", surveiller, { passive: true })
    return () => window.removeEventListener("scroll", surveiller)
  }, [])
  useEffect(() => { document.title = "NexIASchool — Gestion des notes scolaires en ligne" }, [])

  return (
    <div className="lp">
      <header className={`lp-entete ${defile ? "lp-entete-ombre" : ""}`}>
        <div className="lp-conteneur lp-entete-interieur">
          <Link to="/" aria-label="NexIASchool, accueil"><Logo /></Link>
          <nav className="lp-nav" aria-label="Navigation principale">
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#fonctionnement">Comment ça marche</a>
            <a href="#securite">Sécurité</a>
            <a href="#faq">Questions</a>
          </nav>
          <Link className="lp-connexion" to="/etablissement">Se connecter</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-fond" aria-hidden="true"><span /><span /><span /></div>
          <div className="lp-conteneur lp-hero-grille">
            <div className="lp-hero-texte">
              <h1>Les notes de votre établissement, <span>calculées, classées et prêtes à imprimer.</span></h1>
              <BoutonPrincipal grand />
            </div>
            <Ordinateur />
          </div>
        </section>

        <section id="fonctionnalites" className="lp-section">
          <div className="lp-conteneur">
            <p className="lp-surtitre">Fonctionnalités</p>
            <h2>Tout le suivi scolaire, au même endroit</h2>
            <div className="lp-cartes">
              {BENEFICES.map(([icone, titre, texte]) => (
                <article className="lp-carte" key={titre}><span className="lp-icone" aria-hidden="true">{icone}</span><h3>{titre}</h3><p>{texte}</p></article>))}
            </div>
          </div>
        </section>

        <section id="fonctionnement" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <p className="lp-surtitre">Comment ça marche</p>
            <h2>Opérationnel en trois étapes</h2>
            <ol className="lp-etapes">
              {ETAPES.map(([titre, texte], k) => <li key={titre}><span className="lp-etape-numero">{k + 1}</span><h3>{titre}</h3><p>{texte}</p></li>)}
            </ol>
            <div className="lp-roles">
              {ROLES.map(([titre, texte]) => <div className="lp-role" key={titre}><h3>{titre}</h3><p>{texte}</p></div>)}
            </div>
          </div>
        </section>

        <section id="securite" className="lp-section">
          <div className="lp-conteneur lp-securite">
            <div>
              <p className="lp-surtitre">Sécurité et confidentialité</p>
              <h2>Les données des élèves sont protégées</h2>
              <p className="lp-intro">NexIASchool traite des données de mineurs : la sécurité est intégrée dès la conception.</p>
            </div>
            <ul className="lp-liste">
              <li><b>Un espace isolé par établissement</b>, contrôlé ligne par ligne par la base de données.</li>
              <li><b>Codes d'accès chiffrés</b>, jamais lisibles, avec blocage après plusieurs essais erronés.</li>
              <li><b>Photos privées</b>, visibles uniquement par le personnel de l'établissement.</li>
              <li><b>Connexions chiffrées (HTTPS)</b> et hébergement de la base en Europe (Paris).</li>
              <li><b>Aucune publicité, aucune revente</b> : vos données servent uniquement au service.</li>
            </ul>
          </div>
        </section>

        <section id="faq" className="lp-section lp-section-teinte">
          <div className="lp-conteneur lp-faq">
            <p className="lp-surtitre">Questions fréquentes</p>
            <h2>Vous vous demandez peut-être…</h2>
            {FAQ.map(([q, r]) => <details key={q}><summary>{q}</summary><p>{r}</p></details>)}
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-conteneur lp-appel">
            <h2>Prêt à simplifier la gestion des notes ?</h2>
            <p>Créez l'espace de votre établissement en moins de deux minutes.</p>
            <BoutonPrincipal />
          </div>
        </section>
      </main>

      <footer className="lp-pied">
        <div className="lp-conteneur lp-pied-interieur">
          <Logo clair />
          <nav aria-label="Liens légaux">
            <Link to="/confidentialite">Politique de confidentialité</Link>
            <Link to="/conditions">Conditions d'utilisation</Link>
            <Link to="/etablissement">Se connecter</Link>
          </nav>
          <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service}</p>
        </div>
      </footer>
    </div>
  )
}
