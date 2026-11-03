import { useEffect } from "react"
import { Link } from "react-router-dom"
import { EDITEUR } from "../lib/editeur.js"
import { URL_MCP } from "../lib/retour.js"
import "../landing.css"

const OUTILS = [
  ["contexte_etablissement", "Établissement, année scolaire, séquences, votre rôle et vos droits."],
  ["lister_classes / lister_eleves", "Classes, effectifs et élèves inscrits."],
  ["resultats_classe", "Classement, moyennes, appréciations et statistiques d'une classe."],
  ["bulletin_eleve", "Bulletin complet d'un élève : notes, rangs, conduite."],
  ["eleves_en_difficulte", "Élèves sous un seuil de moyenne et leurs matières faibles."],
  ["statistiques_classe", "Répartition des moyennes, résultats par sexe et par matière."],
  ["discipline_classe", "Absences, retards, sanctions et note de discipline."],
  ["saisir_notes ✎", "Enregistre des notes (aperçu puis confirmation)."],
  ["enregistrer_appel ✎", "Absences et retards du jour (aperçu puis confirmation)."],
  ["ajouter_eleve ✎", "Crée et inscrit un élève (administration)."],
]

export default function Developpeurs() {
  useEffect(() => { document.title = "Développeurs — NexIA School"; window.scrollTo(0, 0) }, [])
  return (
    <div className="lp">
      <header className="lp-entete lp-entete-ombre">
        <div className="lp-conteneur lp-entete-interieur">
          <Link to="/" className="lp-logo"><span className="lp-logo-mark" aria-hidden="true">N</span><span>NexIA <strong>School</strong></span></Link>
          <Link className="lp-connexion" to="/etablissement" style={{ marginLeft: "auto" }}>Se connecter</Link>
        </div>
      </header>
      <main>
        <section className="lp-section lp-section-teinte">
          <div className="lp-conteneur" style={{ maxWidth: 900 }}>
            <p className="lp-surtitre">Développeurs et agents IA</p>
            <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1, margin: "0 0 16px" }}>
              Pilotez votre établissement depuis Claude ou votre agent IA</h1>
            <p className="lp-intro">NexIA School expose un serveur <strong>MCP</strong> (Model Context Protocol). Demandez par exemple :
              « Quels élèves de 6e A sont en difficulté ce trimestre ? », « Prépare le commentaire du conseil de classe », ou « Enregistre ces notes de la séquence 2 ».</p>
            <p className="mt-3 mb-1 fw-semibold">Adresse du serveur MCP</p>
            <pre className="lp-code">{URL_MCP}</pre>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-conteneur" style={{ maxWidth: 900 }}>
            <h2>Se connecter</h2>
            <div className="lp-cartes" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <article className="lp-carte"><h3>Claude.ai (connecteur personnalisé)</h3>
                <p>Paramètres → Connecteurs → <em>Ajouter un connecteur personnalisé</em>, collez l'adresse ci-dessus, puis <em>Se connecter</em> :
                  NexIA School vous demande votre accord. Aucune clé à copier.</p></article>
              <article className="lp-carte"><h3>Claude Code et autres agents</h3>
                <p>Créez une clé API dans l'<strong>Espace développeur</strong> de l'application, puis :</p>
                <pre className="lp-code small">{`claude mcp add --transport http nexiaschool ${URL_MCP} \\\n  --header "Authorization: Bearer nxs_…"`}</pre></article>
            </div>
            <p className="mt-3 text-muted">L'accès est désactivé par défaut : l'administration de l'établissement l'active dans <em>Espace développeur</em>.</p>
          </div>
        </section>
        <section className="lp-section lp-section-teinte">
          <div className="lp-conteneur" style={{ maxWidth: 900 }}>
            <h2>Outils disponibles</h2>
            <div className="lp-liste" style={{ listStyle: "none" }}>
              {OUTILS.map(([nom, texte]) => <div key={nom} className="lp-role"><h3 className="font-monospace" style={{ fontSize: "1rem" }}>{nom}</h3><p>{texte}</p></div>)}
            </div>
            <p className="mt-3 text-muted">✎ : écriture, avec une clé « lecture et écriture » ou une autorisation qui l'inclut. L'agent présente toujours un récapitulatif avant d'enregistrer.</p>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-conteneur lp-securite">
            <div><p className="lp-surtitre">Sécurité</p><h2>Vos droits, rien de plus</h2></div>
            <ul className="lp-liste">
              <li><b>Mêmes droits que votre compte</b> : un enseignant ne voit et ne note que ses classes et matières.</li>
              <li><b>Lecture seule par défaut</b> ; écriture accordée explicitement, avec aperçu à confirmer.</li>
              <li><b>Clés chiffrées et révocables</b>, expiration au choix, 60 appels par minute au plus.</li>
              <li><b>Journal</b> de toutes les actions d'écriture, consultable par l'administration.</li>
              <li><b>Un interrupteur général</b> : désactiver l'accès révoque toutes les clés et applications.</li>
            </ul>
          </div>
        </section>
      </main>
      <footer className="lp-pied"><div className="lp-conteneur lp-pied-interieur">
        <nav aria-label="Liens" style={{ marginLeft: 0 }}><Link to="/">Accueil</Link><Link to="/confidentialite">Confidentialité</Link><Link to="/conditions">Conditions d'utilisation</Link></nav>
        <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service}</p>
      </div></footer>
    </div>
  )
}
