import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FondLignes, Marque } from "../composants/Site.jsx"
import { ChoixLangue, t } from "../i18n.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { connexionGoogle } from "../supabase.js"
import "../landing.css"

function Commencer({ className = "lp-bouton lp-bouton-grand", libelle = "Commencer gratuitement" }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className={className} onClick={() => connexionGoogle("/inscription").catch((e) => setErreur(e.message))}>{t(libelle)}</button>
      {erreur && <p className="lp-erreur" role="alert">{erreur}</p>}
    </>
  )
}

/** Aperçu du tableau de bord (dessiné en HTML/CSS, aucune image). */
function EcranApplication() {
  const barres = [62, 74, 55, 81, 68, 88]
  return (
    <div className="lp-app" aria-hidden="true">
      <div className="lp-app-nav">
        <span className="lp-app-marque">NexIA School</span>
        <span>{t("Accueil")}</span><span>{t("Élèves")}</span><span>{t("Notes")}</span><span>{t("Discipline")}</span><span>{t("Finances")}</span>
        <span className="lp-app-profil">MBALLA Paul · {t("Administration")}</span>
      </div>
      <div className="lp-app-corps">
        <div className="lp-app-titre">Collège Saint-Joseph de Yaoundé <em>{t("Exercice")} 2026-2027</em></div>
        <div className="lp-app-tuiles">
          {[["Élèves inscrits", "642"], ["Classes", "18"], ["Personnel actif", "47"], ["Taux de réussite", "71 %"]].map(([l, v]) => (
            <div className="lp-app-tuile" key={l}><span>{t(l)}</span><b>{v}</b></div>))}
        </div>
        <div className="lp-app-grille">
          <div className="lp-app-carte">
            <div className="lp-app-carte-titre">{t("Moyenne générale par classe")}</div>
            <div className="lp-app-barres">
              {barres.map((h, k) => <div key={k} className="lp-app-barre"><i style={{ height: `${h}%` }} /><span>{["6e", "5e", "4e", "3e", "2nde", "1re"][k]}</span></div>)}
            </div>
          </div>
          <div className="lp-app-carte">
            <div className="lp-app-carte-titre">{t("Résultats — 6e A · Trimestre 1")}</div>
            {[["1", "ABENA Lucie", "16,42", "Très bien"], ["2", "ESSOMBA Carine", "15,10", "Bien"], ["3", "FOUDA Daniel", "14,85", "Bien"],
              ["4", "NGO Marie", "13,07", "Assez bien"], ["5", "BELLA Bruno", "12,66", "Assez bien"], ["6", "KAMGA Estelle", "11,93", "Passable"],
              ["7", "OWONA Joël", "11,40", "Passable"], ["8", "NJOYA Inès", "10,25", "Passable"]].map((l) => (
              <div className="lp-app-ligne" key={l[0]}><span>{l[0]}</span><span>{l[1]}</span><b>{l[2]}</b><em>{t(l[3])}</em></div>))}
            <div className="lp-app-pied"><span>{t("Moyenne de la classe : 12,34")}</span><span>{t("Réussite :")} <b>71 %</b></span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BENEFICES = [
  ["📝", "Saisie des notes en quelques clics", "Chaque enseignant saisit ses notes par classe et par séquence, depuis un ordinateur ou un téléphone."],
  ["📊", "Moyennes et rangs automatiques", "Moyennes pondérées, rangs ex æquo, moyennes trimestrielles et annuelles calculés sans erreur."],
  ["🖨️", "Bulletins prêts à imprimer", "Bulletins avec logo, photo, appréciations, rang et statistiques de la classe, en PDF ou sur papier."],
  ["🧭", "Discipline au quotidien", "Appel du jour, retards, infractions et sanctions : la note de discipline se calcule seule."],
  ["💳", "Frais de scolarité suivis", "Pension, tranches et délais, reçus numérotés et alertes automatiques des élèves non en règle."],
  ["📥", "Import et export Excel", "Importez vos listes d'élèves et vos notes depuis Excel, exportez résultats et listes en un clic."],
  ["📈", "Statistiques de pilotage", "Répartition des moyennes, comparaison des classes, effectifs par sexe et par âge."],
  ["🌍", "Français et anglais", "Toute l'application en français ou en anglais, au choix de chaque utilisateur."],
  ["🤖", "Connecté à votre IA", "Interrogez vos résultats ou saisissez des notes depuis Claude ou votre agent IA, avec vos droits (protocole MCP)."],
]
const ETAPES = [
  ["Créez l'espace", "Le chef d'établissement se connecte avec Google et renseigne le nom, le logo et les informations de l'école."],
  ["Ajoutez l'équipe", "Enseignants, surveillant général et comptable reçoivent chacun un code personnel de 6 caractères."],
  ["Travaillez ensemble", "Chacun entre avec le nom de l'établissement, son nom et son code : notes, appel, bulletins, finances."],
]
const ROLES = [
  ["Administration", "Paramètres, classes, matières et coefficients, élèves, personnel, bulletins, statistiques et finances : tous les droits."],
  ["Enseignant", "Saisie et import des notes de ses matières, résultats et bulletins de ses classes."],
  ["Surveillant général", "Appel du jour, retards, infractions et sanctions, suivi disciplinaire de toutes les classes."],
  ["Comptable / caissier", "Frais de scolarité et délais, encaissements et reçus, suivi des élèves en règle ou non."],
]
const SECURITE = [
  ["Un espace isolé par établissement", "contrôlé ligne par ligne par la base de données."],
  ["Codes d'accès chiffrés", "jamais lisibles, avec blocage après plusieurs essais erronés."],
  ["Photos et logos privés", "visibles uniquement par le personnel de l'établissement."],
  ["Connexions chiffrées (HTTPS)", "et hébergement de la base en Europe (Paris)."],
  ["Aucune publicité, aucune revente", "vos données servent uniquement au service."],
]
const FAQ = [
  ["Combien coûte NexIA School ?", "La création de l'espace et son utilisation sont actuellement gratuites. Si une offre payante est proposée un jour, vous en serez informé à l'avance et rien ne vous sera facturé sans votre accord."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Que se passe-t-il si un enseignant perd son code ?", "L'administration génère un nouveau code en un clic ; l'ancien cesse aussitôt de fonctionner. Les codes sont enregistrés chiffrés et ne peuvent pas être relus."],
  ["Faut-il installer un logiciel ?", "Non. NexIA School fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Il suffit d'une connexion à Internet."],
  ["L'application existe-t-elle en anglais ?", "Oui. Choisissez « EN » en haut de la page : votre choix est conservé, jusque dans votre espace, quel que soit votre rôle."],
  ["Puis-je récupérer mes données ?", "Oui. Listes d'élèves, notes et résultats s'exportent à tout moment au format Excel ou PDF."],
]

export default function Landing() {
  const [menu, setMenu] = useState(false)
  useEffect(() => { document.title = t("NexIA School — La gestion scolaire, enfin simple et intelligente") }, [])
  const liens = [["#fonctionnalites", "Fonctionnalités"], ["#fonctionnement", "Comment ça marche"], ["#securite", "Sécurité"], ["#apropos", "À propos"]]

  return (
    <div className="lp">
      <div className="lp-cadre">
        <section className="lp-hero" aria-labelledby="lp-titre">
          <FondLignes />
          <header className="lp-nav-hero">
            <Link to="/" aria-label={t("NexIA School, accueil")}><Marque /></Link>
            <nav className={`lp-liens ${menu ? "ouvert" : ""}`} aria-label={t("Navigation principale")}>
              {liens.map(([h, l]) => <a key={h} href={h} onClick={() => setMenu(false)}>{t(l)}</a>)}
            </nav>
            <div className="lp-nav-droite">
              <ChoixLangue />
              <Link className="lp-bouton lp-bouton-nav" to="/etablissement">{t("Se connecter")}</Link>
              <button type="button" className="lp-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /><span /></button>
            </div>
          </header>
          <div className="lp-hero-contenu">
            <h1 id="lp-titre">{t("La gestion scolaire,")}<br />{t("enfin")} <span>{t("simple et intelligente")}</span></h1>
            <p className="lp-hero-texte">{t("Notes, bulletins, discipline et finances en un seul espace — et une évaluation intelligente pour mieux préparer vos élèves aux épreuves sur papier.")}</p>
            <div className="lp-hero-actions">
              <Commencer />
              <a className="lp-bouton lp-bouton-grand lp-bouton-blanc" href="#fonctionnement">{t("Voir comment ça marche")}</a>
            </div>
          </div>
        </section>
      </div>

      <main>
        <section className="lp-section lp-apercu" aria-label={t("Aperçu de l'application")}>
          <div className="lp-conteneur">
            <div className="lp-navigateur">
              <div className="lp-navigateur-barre" aria-hidden="true"><i /><i /><i /><span>nexiaschool.netlify.app</span></div>
              <div className="lp-ecran-dalle"><EcranApplication /></div>
            </div>
          </div>
        </section>

        <section id="fonctionnalites" className="lp-section">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Fonctionnalités")}</p>
            <h2>{t("Tout le suivi scolaire, au même endroit")}</h2>
            <div className="lp-cartes">
              {BENEFICES.map(([icone, titre, texte]) => (
                <article className="lp-carte" key={titre}><span className="lp-icone" aria-hidden="true">{icone}</span><h3>{t(titre)}</h3><p>{t(texte)}</p></article>))}
            </div>
          </div>
        </section>

        <section id="fonctionnement" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Comment ça marche")}</p>
            <h2>{t("Opérationnel en trois étapes")}</h2>
            <ol className="lp-etapes">
              {ETAPES.map(([titre, texte], k) => <li key={titre}><span className="lp-etape-numero">{k + 1}</span><h3>{t(titre)}</h3><p>{t(texte)}</p></li>)}
            </ol>
            <div className="lp-roles">
              {ROLES.map(([titre, texte]) => <div className="lp-role" key={titre}><h3>{t(titre)}</h3><p>{t(texte)}</p></div>)}
            </div>
          </div>
        </section>

        <section id="securite" className="lp-section">
          <div className="lp-conteneur lp-securite">
            <div>
              <p className="lp-surtitre">{t("Sécurité et confidentialité")}</p>
              <h2>{t("Les données des élèves sont protégées")}</h2>
              <p className="lp-intro">{t("NexIA School traite des données de mineurs : la sécurité est intégrée dès la conception.")}</p>
            </div>
            <ul className="lp-liste">{SECURITE.map(([b, x]) => <li key={b}><b>{t(b)}</b>, {t(x)}</li>)}</ul>
          </div>
        </section>

        <section id="apropos" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <div className="lp-developpeur">
              <div className="lp-avatar" aria-hidden="true">MA</div>
              <div>
                <p className="lp-surtitre">{t("À propos du développeur")}</p>
                <h2>Marvin Ahanda</h2>
                <p className="lp-developpeur-role">{t("Développeur et fondateur de NexIA School")}</p>
                <p>{t("Passionné d'éducation et de numérique, j'ai d'abord créé Otourix, un logiciel de gestion des notes pour les établissements scolaires, avant de le réinventer en NexIA School : une plateforme en ligne, sécurisée et bilingue, pensée pour les écoles d'Afrique. Mon objectif : libérer les équipes des tâches répétitives pour qu'elles se consacrent à la réussite des élèves.")}</p>
                <div className="lp-developpeur-liens">
                  <a className="lp-bouton" href="https://marvinahanda.netlify.app" target="_blank" rel="noopener noreferrer">{t("Voir mon portfolio")}</a>
                  <a className="lp-bouton lp-bouton-blanc" href={`mailto:${EDITEUR.contact}`}>{t("Me contacter")}</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-conteneur lp-faq">
            <p className="lp-surtitre">{t("Questions fréquentes")}</p>
            <h2>{t("Vous vous demandez peut-être…")}</h2>
            {FAQ.map(([q, r]) => <details key={q}><summary>{t(q)}</summary><p>{t(r)}</p></details>)}
          </div>
        </section>

        <section className="lp-section lp-section-fin">
          <div className="lp-conteneur lp-appel">
            <h2>{t("Prêt à simplifier la gestion de votre établissement ?")}</h2>
            <p>{t("Créez l'espace de votre établissement en moins de deux minutes.")}</p>
            <Commencer className="lp-bouton lp-bouton-grand lp-bouton-blanc" libelle="Créer l'espace de mon établissement" />
          </div>
        </section>
      </main>

      <footer className="lp-pied">
        <div className="lp-conteneur lp-pied-interieur">
          <Marque clair />
          <nav aria-label={t("Liens légaux")}>
            <Link to="/confidentialite">{t("Politique de confidentialité")}</Link>
            <Link to="/conditions">{t("Conditions d'utilisation")}</Link>
            <Link to="/developpeurs">{t("Développeurs (API et MCP)")}</Link>
            <Link to="/etablissement">{t("Se connecter")}</Link>
          </nav>
          <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service}</p>
        </div>
      </footer>
    </div>
  )
}
