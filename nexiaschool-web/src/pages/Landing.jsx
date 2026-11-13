// Page d'accueil publique de NexIA School, construite selon l'anatomie d'une landing page qui convertit :
// menu + CTA → proposition de valeur → démo → bénéfices → fonctionnement → tarifs → témoignages → FAQ → développeur → dernier appel → pied de page.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FondLignes, Marque } from "../composants/Site.jsx"
import { ChoixLangue, t } from "../i18n.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { connexionGoogle } from "../supabase.js"
import "../landing.css"

function Commencer({ className = "lp-bouton lp-bouton-grand", libelle = "Créer l'espace de mon établissement" }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className={className} onClick={() => connexionGoogle("/inscription").catch((e) => setErreur(e.message))}>{t(libelle)}</button>
      {erreur && <p className="lp-erreur" role="alert">{erreur}</p>}
    </>
  )
}

/** Aperçu du tableau de bord (dessiné en HTML/CSS, aucune image) : affiché en attendant la vidéo de démonstration. */
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

// --- Bénéfices : ce que NexIA School change pour l'école d'aujourd'hui -------------------------------------------------
const BENEFICES = [
  ["🔎", "Agir avant l'échec, pas après", "Aujourd'hui, les lacunes se découvrent le jour du bulletin, quand il est trop tard. Avec l'évaluation digitalisée et l'analyse par l'IA, l'enseignant voit dès la fin d'une interrogation quelles notions ne sont pas acquises, et par quels élèves : il remédie avant le devoir sur table."],
  ["⏱️", "Rendre du temps aux enseignants", "Correction automatique des évaluations, moyennes, rangs et appréciations calculés sans erreur, bulletins générés en un clic : des dizaines d'heures de calculs et de recopie rendues à la pédagogie, chaque trimestre."],
  ["🛡️", "Des bulletins impossibles à falsifier", "Chaque bulletin porte un QR code unique. Un parent, un autre établissement ou un recruteur le scanne et vérifie en quelques secondes que les notes sont bien celles émises par l'école."],
  ["🤝", "Des familles informées et impliquées", "Les parents consultent les bulletins publiés depuis leur téléphone et écrivent à l'école (demande d'absence, demande de délai de paiement) : moins de déplacements, moins de malentendus."],
  ["📊", "Piloter l'établissement avec des chiffres fiables", "Résultats par classe et par matière, enseignants en retard de saisie, alertes de discipline, élèves en retard de paiement : le chef d'établissement voit tout, au même endroit, en temps réel."],
  ["📶", "Pensé pour les réalités du terrain", "Fonctionne sur un simple téléphone, avec une connexion lente ou coupée : les saisies faites hors ligne partent toutes seules au retour du réseau. Bilingue français-anglais, sans installation."],
]

// --- Fonctionnement : un cadre par fonctionnalité, étapes concrètes ----------------------------------------------------------
const FONCTIONNEMENT = [
  { icone: "🏫", titre: "Créez l'espace de votre établissement en 2 minutes", resume: "Aucune installation, aucun dossier à envoyer : l'école est prête à l'emploi le jour même.",
    etapes: ["Cliquez sur « Créer l'espace de mon établissement » et connectez-vous avec votre compte Google.",
      "Saisissez le nom de l'établissement et sa ville ; ajoutez le logo si vous le souhaitez.",
      "NexIA School vous remet le code de l'établissement : votre espace est créé, vous en êtes l'administrateur.",
      "Créez l'année scolaire : les six séquences et les trois trimestres sont préparés automatiquement."] },
  { icone: "👥", titre: "Ajoutez votre équipe, chacun avec son rôle", resume: "Quatre rôles, des droits adaptés : chacun ne voit que ce qui le concerne.",
    etapes: ["Dans « Personnel », ajoutez enseignants, surveillant général, comptable/caissier ou autres administrateurs (ou importez la liste Excel).",
      "Chacun reçoit un code personnel de 6 caractères, à imprimer ou à transmettre.",
      "Pour se connecter : le nom et le code de l'établissement une seule fois sur l'appareil, puis son nom et son code personnel.",
      "Code perdu ? L'administration en génère un nouveau en un clic ; l'ancien cesse aussitôt de fonctionner."] },
  { icone: "📥", titre: "Importez vos fichiers Excel : rien à ressaisir", resume: "Vos listes existantes deviennent votre base de données en quelques minutes.",
    etapes: ["Téléchargez le modèle Excel ou utilisez vos propres fichiers : élèves, classes, matières, personnel, matières par classe et coefficients, notes.",
      "Importez chaque liste séparément ou toute l'école en un seul classeur.",
      "La lecture est tolérante : colonnes dans le désordre, cases vides ou mal remplies sont complétées et signalées, jamais perdues.",
      "À tout moment, exportez listes, notes et résultats en Excel ou en PDF."] },
  { icone: "📝", titre: "Notes, moyennes et bulletins sécurisés", resume: "De la saisie au bulletin signé, sans calcul à la main.",
    etapes: ["Chaque enseignant saisit ses notes par classe et par séquence, sur ordinateur ou téléphone, ou les importe depuis Excel.",
      "Moyennes pondérées par les coefficients, rangs, moyennes trimestrielles et annuelles sont calculés automatiquement.",
      "L'administration fixe un délai de saisie et voit les enseignants en retard ; les critères de décision (admis, rattrapage, redoublement, exclusion) s'appliquent seuls.",
      "Les bulletins se génèrent en PDF : logo en filigrane, photo de l'élève, appréciations, visas et QR code anti-fraude."] },
  { icone: "💡", titre: "SmartEval : l'évaluation digitalisée, corrigée automatiquement", resume: "La fonctionnalité qui permet de repérer les difficultés avant le devoir sur table.",
    etapes: ["L'enseignant crée son évaluation comme un formulaire : choix unique, choix multiples, réponses courtes ou longues, avec les bonnes réponses.",
      "Il joint si besoin des documents supports (texte, carte, schéma en PDF, image ou Word) que les élèves pourront télécharger.",
      "Il publie et partage un simple lien : les élèves répondent depuis un téléphone, sans compte, pendant la durée choisie.",
      "La correction est immédiate : résultats par élève et par question, notions mal comprises mises en évidence.",
      "Avec l'IA connectée, l'enseignant obtient une analyse des erreurs et des pistes de remédiation ciblées, avant l'évaluation sur papier."] },
  { icone: "🗓️", titre: "Emploi du temps généré automatiquement", resume: "Ce qui prenait des semaines se fait en quelques minutes, sans aucun conflit.",
    etapes: ["Indiquez les jours, les horaires, la durée des cours, les récréations et les demi-journées libres.",
      "Importez le fichier Excel des affectations : enseignant, discipline, classe, volume horaire et jours disponibles.",
      "Ajoutez vos contraintes : permanences, salles spécialisées, créneaux interdits, maximum d'heures par jour.",
      "NexIA School vérifie la faisabilité, explique ce qui bloque, puis génère l'emploi du temps : aucun enseignant ni aucune classe à deux endroits à la fois.",
      "Consultez-le par classe ou par enseignant, imprimez-le, exportez-le en PDF ou en Excel, puis publiez la version officielle au personnel."] },
  { icone: "🧭", titre: "Discipline suivie au quotidien", resume: "Le surveillant général gagne du temps, le chef d'établissement est alerté.",
    etapes: ["Faites l'appel du jour : absences justifiées ou non, retards, élève par élève.",
      "Enregistrez les infractions : la sanction prévue et la note de discipline se calculent seules.",
      "Fixez des seuils d'alerte : au-delà d'un nombre d'heures d'absence ou de sanctions, vous êtes prévenu."] },
  { icone: "💳", titre: "Frais de scolarité sous contrôle", resume: "Chaque franc encaissé est tracé, chaque retard est visible.",
    etapes: ["Définissez inscription, pension et tranches avec leurs délais, par section et par classe.",
      "Encaissez un paiement : le reçu numéroté se génère en PDF, prêt à imprimer.",
      "Suivez les élèves en retard de paiement et accordez des moratoires sur demande des parents."] },
  { icone: "👨‍👩‍👧", titre: "Un espace pour les parents", resume: "Les familles suivent la scolarité de leur enfant sans se déplacer.",
    etapes: ["L'établissement publie les bulletins de la période en un clic.",
      "Le parent se connecte avec le matricule et le nom de son enfant, et consulte les bulletins publiés.",
      "Il écrit à l'école (demande d'absence, demande de délai de paiement) ; la bonne personne lui répond depuis l'application."] },
  { icone: "📶", titre: "Hors ligne et connecté à votre IA", resume: "L'application continue de fonctionner quand le réseau lâche.",
    etapes: ["Installez NexIA School sur l'écran d'accueil du téléphone, comme une application.",
      "Sans connexion, les pages et données déjà consultées restent accessibles ; notes, appel, élèves et infractions se saisissent normalement.",
      "Au retour du réseau, tout part automatiquement ; si quelqu'un a modifié la même donnée entre-temps, vous choisissez quelle version garder.",
      "Chaque membre du personnel peut connecter son assistant IA (Claude, par exemple) pour interroger ses résultats ou saisir des notes, avec ses propres droits."] },
]

// --- Tarifs : PROPOSITION À VALIDER (répartition des fonctionnalités et prix à confirmer par l'éditeur) -------------------------
const OFFRES = [
  { nom: "Découverte", prix: "Gratuit", sous: "pour tester sans engagement",
    inclus: ["1 établissement, jusqu'à 150 élèves", "Personnel : jusqu'à 10 comptes", "Import Excel des élèves, classes et matières", "Saisie des notes, moyennes et rangs", "Bulletins PDF (sans QR code anti-fraude)", "Appel du jour"],
    exclus: ["SmartEval, emploi du temps, finances, espace parents, IA"], cta: "Commencer gratuitement" },
  { nom: "Essentiel", prix: "Tarif à venir", sous: "par an",
    inclus: ["Jusqu'à 500 élèves, personnel illimité", "Tout Découverte", "Bulletins avec QR code anti-fraude et décisions de fin de période", "Discipline complète et alertes", "Finances : frais, reçus, retards, moratoires", "Import et export Excel complets", "Mode hors ligne"], cta: "Choisir Essentiel" },
  { nom: "Pro", prix: "Tarif à venir", sous: "par an", recommande: true,
    inclus: ["Élèves illimités", "Tout Essentiel", "SmartEval : évaluation digitalisée et correction automatique", "Génération automatique des emplois du temps", "Espace parents et courrier", "Statistiques avancées et alertes de retard de saisie"], cta: "Choisir Pro" },
  { nom: "Premium", prix: "Tarif à venir", sous: "par an",
    inclus: ["Tout Pro", "IA intégrée : analyse des évaluations et remédiation", "Connexion de vos assistants IA (API et MCP)", "Accompagnement au démarrage et formation de l'équipe", "Assistance prioritaire"], cta: "Choisir Premium" },
]

// --- Témoignages : EXEMPLES ILLUSTRATIFS, à remplacer par de vrais témoignages (avec l'accord des personnes) ------------------
const TEMOIGNAGES = [
  ["Les bulletins sortent désormais la semaine même du conseil de classe, et le QR code a mis fin aux bulletins retouchés que l'on nous présentait. Je vois en un coup d'œil les classes en difficulté et les enseignants en retard de saisie.",
    "Jean-Pierre MBARGA", "Proviseur", "Yaoundé"],
  ["Avec SmartEval, je fais une évaluation de dix minutes en fin de leçon : la correction est immédiate et je sais exactement quelle notion reprendre avant le devoir. Je ne passe plus mes week-ends à calculer des moyennes.",
    "Carine NGO BASSONG", "Professeure de mathématiques", "Douala"],
  ["Je fais l'appel sur mon téléphone, même quand le réseau coupe : tout part dès qu'il revient. Les sanctions et la note de discipline se calculent seules, et je suis alerté quand un élève dépasse le seuil d'absences.",
    "Aboubakar HAMADOU", "Surveillant général", "Garoua"],
  ["Chaque paiement donne un reçu numéroté et je sais à tout moment qui est en retard sur quelle tranche. Les parents demandent un délai depuis l'application : fini les cahiers de caisse qui ne concordent pas.",
    "Solange TCHOUMI", "Comptable-caissière", "Bafoussam"],
]

const FAQ = [
  ["Combien coûte NexIA School ?", "Une offre Découverte gratuite permet de créer l'espace de l'établissement et de gérer l'essentiel (élèves, notes, bulletins). Les offres payantes débloquent les fonctionnalités avancées. Rien ne vous est facturé sans votre accord."],
  ["Faut-il installer un logiciel ?", "Non. NexIA School fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Vous pouvez aussi l'ajouter à l'écran d'accueil du téléphone pour l'ouvrir comme une application."],
  ["Et si la connexion Internet est mauvaise ou coupée ?", "L'application est conçue pour les connexions lentes : les données déjà consultées s'affichent sans attendre. Hors ligne, notes, appel, élèves et infractions se saisissent normalement et sont envoyés automatiquement au retour du réseau."],
  ["Dois-je ressaisir toutes mes données ?", "Non. Importez vos listes Excel (élèves, classes, matières, personnel, coefficients, notes), séparément ou en un seul classeur. Les cases incomplètes sont signalées sans bloquer l'import."],
  ["Les élèves ont-ils besoin d'un compte pour SmartEval ?", "Non. L'enseignant partage un lien ; l'élève répond depuis n'importe quel téléphone pendant la durée de l'évaluation. La correction est automatique et les résultats arrivent aussitôt chez l'enseignant."],
  ["Comment fonctionne le QR code des bulletins ?", "Chaque bulletin émis porte un code unique. En le scannant, n'importe qui ouvre une page de vérification qui affiche les informations authentiques du bulletin : toute modification devient visible."],
  ["L'emploi du temps généré respecte-t-il vraiment toutes les contraintes ?", "Oui. Aucun enseignant, aucune classe ni aucune salle n'est placé deux fois au même moment, et les disponibilités sont respectées. Si c'est impossible, NexIA School explique ce qui bloque au lieu d'assouplir vos règles. Chaque version est revérifiée par le serveur avant d'être enregistrée."],
  ["Les parents peuvent-ils voir les bulletins ?", "Oui, dès que l'établissement les publie. Le parent se connecte avec le matricule et le nom de son enfant ; il peut aussi écrire à l'école (absence, délai de paiement)."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Que fait l'IA avec nos données ?", "L'IA n'est utilisée que si un membre du personnel la connecte lui-même à son compte, avec ses propres droits. Elle aide à analyser les résultats des évaluations ; les données des élèves ne sont jamais revendues."],
  ["Que se passe-t-il si un membre du personnel perd son code ?", "L'administration génère un nouveau code en un clic ; l'ancien cesse aussitôt de fonctionner. Les codes sont enregistrés chiffrés et ne peuvent pas être relus."],
  ["L'application existe-t-elle en anglais ?", "Oui. Choisissez « EN » en haut de la page : votre choix est conservé jusque dans votre espace, quel que soit votre rôle."],
  ["Puis-je récupérer mes données ?", "Oui. Listes d'élèves, notes, résultats et emplois du temps s'exportent à tout moment au format Excel ou PDF."],
]

export default function Landing() {
  const [menu, setMenu] = useState(false)
  useEffect(() => { document.title = t("NexIA School — Repérez les difficultés avant qu'elles ne deviennent des échecs") }, [])
  const liens = [["#benefices", "Bénéfices"], ["#fonctionnement", "Comment ça marche"], ["#tarifs", "Tarifs"], ["#temoignages", "Témoignages"], ["#faq", "FAQ"]]

  return (
    <div className="lp">
      {/* 1. Logo + menu + CTA, 2. Proposition de valeur */}
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
              <Link className="lp-bouton lp-bouton-nav lp-bouton-blanc lp-bouton-contour" to="/etablissement">{t("Se connecter")}</Link>
              <Commencer className="lp-bouton lp-bouton-nav lp-cta-nav" libelle="Essai gratuit" />
              <button type="button" className="lp-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /><span /></button>
            </div>
          </header>
          <div className="lp-hero-contenu">
            <p className="lp-badge">{t("Gestion scolaire · Évaluation digitalisée · IA")}</p>
            <h1 id="lp-titre"><strong>{t("Repérez les difficultés")}</strong><br /><strong>{t("avant qu'elles ne deviennent")} <span>{t("des échecs")}</span></strong></h1>
            <p className="lp-hero-texte">{t("NexIA School réunit en une seule application l'évaluation digitalisée corrigée automatiquement, une IA intégrée qui aide à remédier, des bulletins protégés par QR code, la génération automatique des emplois du temps et un mode hors ligne pensé pour les connexions difficiles — avec les notes, la discipline, les finances et l'espace parents.")}</p>
            <div className="lp-hero-actions">
              <Commencer libelle="Créer l'espace de mon établissement" />
              <a className="lp-bouton lp-bouton-grand lp-bouton-blanc" href="#demo">{t("Voir la démo")}</a>
            </div>
            <p className="lp-hero-note">{t("Gratuit pour commencer · Prêt en 2 minutes · Sans installation")}</p>
          </div>
        </section>
      </div>

      <main>
        {/* 3. Démo du produit */}
        <section id="demo" className="lp-section lp-apercu" aria-label={t("Démonstration de l'application")}>
          <div className="lp-conteneur">
            <div className="lp-navigateur">
              <div className="lp-navigateur-barre" aria-hidden="true"><i /><i /><i /><span>nexiaschool.netlify.app</span></div>
              <div className="lp-ecran-dalle lp-demo"><EcranApplication /><span className="lp-demo-bientot">{t("Vidéo de démonstration bientôt disponible")}</span></div>
            </div>
          </div>
        </section>

        {/* 4. Bénéfices */}
        <section id="benefices" className="lp-section">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Bénéfices")}</p>
            <h2>{t("Ce que NexIA School change pour l'école d'aujourd'hui")}</h2>
            <div className="lp-cartes">
              {BENEFICES.map(([icone, titre, texte]) => (
                <article className="lp-carte" key={titre}><span className="lp-icone" aria-hidden="true">{icone}</span><h3>{t(titre)}</h3><p>{t(texte)}</p></article>))}
            </div>
          </div>
        </section>

        {/* 5. Comment ça marche */}
        <section id="fonctionnement" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Comment ça marche")}</p>
            <h2>{t("De la création de l'école au bulletin, pas à pas")}</h2>
            <p className="lp-intro lp-intro-centre">{t("Chaque cadre décrit une fonctionnalité telle que vous l'utiliserez. Commencez par la première : votre établissement est opérationnel le jour même.")}</p>
            <ol className="lp-fonctionnement">
              {FONCTIONNEMENT.map((f, k) => (
                <li key={f.titre} className="lp-fonction">
                  <div className="lp-fonction-tete">
                    <span className="lp-fonction-numero" aria-hidden="true">{k + 1}</span>
                    <span className="lp-icone" aria-hidden="true">{f.icone}</span>
                    <div><h3>{t(f.titre)}</h3><p className="lp-fonction-resume">{t(f.resume)}</p></div>
                  </div>
                  <ol className="lp-fonction-etapes">{f.etapes.map((e) => <li key={e}>{t(e)}</li>)}</ol>
                </li>))}
            </ol>
          </div>
        </section>

        {/* 6. Tarifs */}
        <section id="tarifs" className="lp-section">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Tarifs")}</p>
            <h2>{t("Une offre pour chaque établissement")}</h2>
            <div className="lp-offres">
              {OFFRES.map((o) => (
                <article key={o.nom} className={`lp-offre${o.recommande ? " lp-offre-recommandee" : ""}`}>
                  {o.recommande && <span className="lp-offre-badge">{t("Recommandée")}</span>}
                  <h3>{t(o.nom)}</h3>
                  <p className="lp-offre-prix">{t(o.prix)}</p>
                  <p className="lp-offre-sous">{t(o.sous)}</p>
                  <ul className="lp-offre-liste">{o.inclus.map((x) => <li key={x}>{t(x)}</li>)}</ul>
                  {o.exclus && <ul className="lp-offre-liste lp-offre-exclus">{o.exclus.map((x) => <li key={x}>{t(x)}</li>)}</ul>}
                  {o.prix === "Gratuit" ? <Commencer className="lp-bouton lp-offre-bouton" libelle={o.cta} />
                    : <a className={`lp-bouton lp-offre-bouton${o.recommande ? "" : " lp-bouton-blanc lp-bouton-contour"}`} href={`mailto:${EDITEUR.contact}?subject=${encodeURIComponent(`NexIA School — ${o.nom}`)}`}>{t(o.cta)}</a>}
                </article>))}
            </div>
          </div>
        </section>

        {/* 7. Témoignages */}
        <section id="temoignages" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Témoignages")}</p>
            <h2>{t("Chacun y gagne, à son poste")}</h2>
            <div className="lp-temoignages">
              {TEMOIGNAGES.map(([texte, nom, role, ville]) => (
                <figure key={nom} className="lp-temoignage">
                  <div className="lp-etoiles" aria-label={t("5 étoiles sur 5")}>★★★★★</div>
                  <blockquote><p>« {t(texte)} »</p></blockquote>
                  <figcaption><b>{nom}</b><span>{t(role)} · {ville}</span></figcaption>
                </figure>))}
            </div>
          </div>
        </section>

        {/* 8. FAQ */}
        <section id="faq" className="lp-section">
          <div className="lp-conteneur lp-faq">
            <p className="lp-surtitre">{t("Questions fréquentes")}</p>
            <h2>{t("Vous vous demandez peut-être…")}</h2>
            {FAQ.map(([q, r]) => <details key={q}><summary>{t(q)}</summary><p>{t(r)}</p></details>)}
          </div>
        </section>

        {/* 9. Le développeur */}
        <section id="apropos" className="lp-section lp-section-teinte">
          <div className="lp-conteneur">
            <div className="lp-developpeur">
              <div className="lp-avatar" aria-hidden="true">MA</div>
              <div>
                <p className="lp-surtitre">{t("À propos du développeur")}</p>
                <h2>Marvin AHANDA</h2>
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

        {/* 10. Rappel du passage à l'action */}
        <section className="lp-section lp-section-fin">
          <div className="lp-conteneur lp-appel">
            <h2>{t("N'attendez plus le bulletin pour découvrir les difficultés de vos élèves")}</h2>
            <p>{t("Créez gratuitement l'espace de votre établissement : il est prêt en deux minutes, et vos listes Excel suffisent pour démarrer.")}</p>
            <Commencer className="lp-bouton lp-bouton-grand lp-bouton-blanc" libelle="Créer l'espace de mon établissement" />
          </div>
        </section>
      </main>

      {/* 11. Logo + menu + mentions légales */}
      <footer className="lp-pied">
        <div className="lp-conteneur lp-pied-interieur">
          <Marque clair />
          <nav aria-label={t("Plan du site")}>
            {liens.map(([h, l]) => <a key={h} href={h}>{t(l)}</a>)}
            <Link to="/etablissement">{t("Se connecter")}</Link>
          </nav>
          <nav aria-label={t("Liens légaux")} className="lp-pied-legal">
            <Link to="/confidentialite">{t("Politique de confidentialité")}</Link>
            <Link to="/conditions">{t("Conditions d'utilisation")}</Link>
            <Link to="/developpeurs">{t("Développeurs (API et MCP)")}</Link>
            <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>
          </nav>
          <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service} · {t("Fait au Cameroun")}</p>
        </div>
      </footer>
    </div>
  )
}
