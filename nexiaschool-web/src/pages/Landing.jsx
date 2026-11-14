// Page d'accueil publique de NexIA School, construite selon l'anatomie d'une landing page qui convertit :
// menu + CTA → proposition de valeur → démo → bénéfices → fonctionnement → tarifs → témoignages → FAQ → développeur → dernier appel → pied de page.
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Marque } from "../composants/Site.jsx"
import { ChoixLangue, t } from "../i18n.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { connexionGoogle } from "../supabase.js"
import "@fontsource/source-serif-4/latin-500.css"
import "@fontsource/source-serif-4/latin-600.css"
import "../landing.css"

function Commencer({ className = "lp-bouton lp-bouton-grand", libelle = "Créer l'espace de mon établissement", fleche = false }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className={className} onClick={() => connexionGoogle("/inscription").catch((e) => setErreur(e.message))}>
        {t(libelle)}{fleche && <span className="lp-pilule-fleche" aria-hidden="true"><Icone nom="fleche" /></span>}</button>
      {erreur && <p className="lp-erreur" role="alert">{erreur}</p>}
    </>
  )
}

const MEDIA = `${import.meta.env.BASE_URL}media/`

/** Icônes au trait (24 × 24), comme celles du modèle. */
const ICONES = {
  fleche: '<path d="M7 17 17 7M8 7h9v9"/>', haut: '<path d="m18 15-6-6-6 6"/>', bas: '<path d="m6 9 6 6 6-6"/>',
  etincelle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7z"/>',
  ecole: '<path d="m3 10 9-6 9 6"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>', equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>', bulletin: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  smarteval: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  discipline: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>', finances: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  parents: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  horsligne: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 4.1"/><circle cx="12" cy="20" r="1"/>',
  check: '<path d="m5 12 5 5 9-10"/>', qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-4M14 18v3"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.7-1.1-2.1-2.1l.8-1-1-2z"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
}
function Icone({ nom }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: ICONES[nom] }} />
}

/** Vidéo de démonstration : rien n'est téléchargé avant le clic (seule l'image d'aperçu, 50 ko, s'affiche). */
function Demo() {
  const ref = useRef(null)
  const [lancee, setLancee] = useState(false)
  return (
    <>
      <video ref={ref} className="lp-video" controls={lancee} preload="none" playsInline poster={`${MEDIA}nexiaschool-demo-apercu.webp`}
             aria-label={t("Vidéo de démonstration de NexIA School (2 minutes)")} onPlay={() => setLancee(true)}>
        <source src={`${MEDIA}nexiaschool-demo.mp4`} type="video/mp4" />
        {t("Votre navigateur ne peut pas lire cette vidéo.")}
      </video>
      {!lancee && (
        <button type="button" className="lp-lecture" onClick={() => { setLancee(true); ref.current?.play() }} aria-label={t("Lire la vidéo de démonstration")}>
          <span className="lp-lecture-icone" aria-hidden="true" /><span className="lp-lecture-texte">{t("Voir la démo · 2 min")}</span>
        </button>)}
    </>
  )
}

// --- Bénéfices : ce que NexIA School change pour l'école d'aujourd'hui -------------------------------------------------
/** Photo et mini-écran flottant de chaque bénéfice (dans l'ordre de BENEFICES). */
const VISUELS_BENEFICES = [
  { photo: "01-agir", titre: "Notions à reprendre · 6e A", lignes: [["smarteval", "Proportionnalité", "34 %", "rouge"], ["smarteval", "Pourcentages", "58 %", "orange"], ["smarteval", "Fractions", "81 %", "vert"]] },
  { photo: "02-temps", titre: "Fait automatiquement", lignes: [["check", "26 copies corrigées", "", "vert"], ["check", "Moyennes et rangs", "", "vert"], ["check", "Bulletins générés", "", "vert"]] },
  { photo: "03-bulletins", titre: "Vérification du bulletin", lignes: [["qr", "Code scanné", "", ""], ["check", "Bulletin authentique", "", "vert"], ["horloge", "Vérifié en 3 secondes", "", ""]] },
  { photo: "04-familles", titre: "Courrier des parents", lignes: [["message", "Demande de délai", "Tranche 2", ""], ["check", "Délai accordé", "", "vert"], ["parents", "Réponse reçue", "", ""]] },
  { photo: "05-pilotage", titre: "Tableau de bord", lignes: [["bulletin", "Taux de réussite", "78 %", "vert"], ["horloge", "Saisies en retard", "2", "orange"], ["finances", "Paiements en retard", "14", "rouge"]] },
  { photo: "06-terrain", titre: "Connexion coupée ?", lignes: [["horsligne", "Hors ligne", "8 notes", "orange"], ["import", "Réseau revenu", "", ""], ["check", "Tout est envoyé", "", "vert"]] },
]

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
  { image: "01-creation", type: "bureau", trait: "ecole", icone: "🏫", titre: "Créez l'espace de votre établissement en 2 minutes", resume: "Aucune installation, aucun dossier à envoyer : l'école est prête à l'emploi le jour même.",
    etapes: ["Cliquez sur « Créer l'espace de mon établissement » et connectez-vous avec votre compte Google.",
      "Saisissez le nom de l'établissement et sa ville ; ajoutez le logo si vous le souhaitez.",
      "NexIA School vous remet le code de l'établissement : votre espace est créé, vous en êtes l'administrateur.",
      "Créez l'année scolaire : les six séquences et les trois trimestres sont préparés automatiquement."] },
  { image: "02-equipe", type: "bureau", trait: "equipe", icone: "👥", titre: "Ajoutez votre équipe, chacun avec son rôle", resume: "Quatre rôles, des droits adaptés : chacun ne voit que ce qui le concerne.",
    etapes: ["Dans « Personnel », ajoutez enseignants, surveillant général, comptable/caissier ou autres administrateurs (ou importez la liste Excel).",
      "Chacun reçoit un code personnel de 6 caractères, à imprimer ou à transmettre.",
      "Pour se connecter : le nom et le code de l'établissement une seule fois sur l'appareil, puis son nom et son code personnel.",
      "Code perdu ? L'administration en génère un nouveau en un clic ; l'ancien cesse aussitôt de fonctionner."] },
  { image: "03-excel", type: "bureau", trait: "import", icone: "📥", titre: "Importez vos fichiers Excel : rien à ressaisir", resume: "Vos listes existantes deviennent votre base de données en quelques minutes.",
    etapes: ["Téléchargez le modèle Excel ou utilisez vos propres fichiers : élèves, classes, matières, personnel, matières par classe et coefficients, notes.",
      "Importez chaque liste séparément ou toute l'école en un seul classeur.",
      "La lecture est tolérante : colonnes dans le désordre, cases vides ou mal remplies sont complétées et signalées, jamais perdues.",
      "À tout moment, exportez listes, notes et résultats en Excel ou en PDF."] },
  { image: "04-bulletins", type: "bureau", trait: "bulletin", icone: "📝", titre: "Notes, moyennes et bulletins sécurisés", resume: "De la saisie au bulletin signé, sans calcul à la main.",
    etapes: ["Chaque enseignant saisit ses notes par classe et par séquence, sur ordinateur ou téléphone, ou les importe depuis Excel.",
      "Moyennes pondérées par les coefficients, rangs, moyennes trimestrielles et annuelles sont calculés automatiquement.",
      "L'administration fixe un délai de saisie et voit les enseignants en retard ; les critères de décision (admis, rattrapage, redoublement, exclusion) s'appliquent seuls.",
      "Les bulletins se génèrent en PDF : logo en filigrane, photo de l'élève, appréciations, visas et QR code anti-fraude."] },
  { image: "05-smarteval", type: "bureau", trait: "smarteval", icone: "💡", titre: "SmartEval : l'évaluation digitalisée, corrigée automatiquement", resume: "La fonctionnalité qui permet de repérer les difficultés avant le devoir sur table.",
    etapes: ["L'enseignant crée son évaluation comme un formulaire : choix unique, choix multiples, réponses courtes ou longues, avec les bonnes réponses.",
      "Il joint si besoin des documents supports (texte, carte, schéma en PDF, image ou Word) que les élèves pourront télécharger.",
      "Il publie et partage un simple lien : les élèves répondent depuis un téléphone, sans compte, pendant la durée choisie.",
      "La correction est immédiate : résultats par élève et par question, notions mal comprises mises en évidence.",
      "Avec l'IA connectée, l'enseignant obtient une analyse des erreurs et des pistes de remédiation ciblées, avant l'évaluation sur papier."] },
  { image: "06-emploi-du-temps", type: "bureau", trait: "agenda", icone: "🗓️", titre: "Emploi du temps généré automatiquement", resume: "Ce qui prenait des semaines se fait en quelques minutes, sans aucun conflit.",
    etapes: ["Indiquez les jours, les horaires, la durée des cours, les récréations et les demi-journées libres.",
      "Importez le fichier Excel des affectations : enseignant, discipline, classe, volume horaire et jours disponibles.",
      "Ajoutez vos contraintes : permanences, salles spécialisées, créneaux interdits, maximum d'heures par jour.",
      "NexIA School vérifie la faisabilité, explique ce qui bloque, puis génère l'emploi du temps : aucun enseignant ni aucune classe à deux endroits à la fois.",
      "Consultez-le par classe ou par enseignant, imprimez-le, exportez-le en PDF ou en Excel, puis publiez la version officielle au personnel."] },
  { image: "07-discipline", type: "bureau", trait: "discipline", icone: "🧭", titre: "Discipline suivie au quotidien", resume: "Le surveillant général gagne du temps, le chef d'établissement est alerté.",
    etapes: ["Faites l'appel du jour : absences justifiées ou non, retards, élève par élève.",
      "Enregistrez les infractions : la sanction prévue et la note de discipline se calculent seules.",
      "Fixez des seuils d'alerte : au-delà d'un nombre d'heures d'absence ou de sanctions, vous êtes prévenu."] },
  { image: "08-finances", type: "bureau", trait: "finances", icone: "💳", titre: "Frais de scolarité sous contrôle", resume: "Chaque franc encaissé est tracé, chaque retard est visible.",
    etapes: ["Définissez inscription, pension et tranches avec leurs délais, par section et par classe.",
      "Encaissez un paiement : le reçu numéroté se génère en PDF, prêt à imprimer.",
      "Suivez les élèves en retard de paiement et accordez des moratoires sur demande des parents."] },
  { image: "09-parents", type: "telephone", trait: "parents", icone: "👨‍👩‍👧", titre: "Un espace pour les parents", resume: "Les familles suivent la scolarité de leur enfant sans se déplacer.",
    etapes: ["L'établissement publie les bulletins de la période en un clic.",
      "Le parent se connecte avec le matricule et le nom de son enfant, et consulte les bulletins publiés.",
      "Il écrit à l'école (demande d'absence, demande de délai de paiement) ; la bonne personne lui répond depuis l'application."] },
  { image: "10-hors-ligne", type: "bureau", trait: "horsligne", icone: "📶", titre: "Hors ligne et connecté à votre IA", resume: "L'application continue de fonctionner quand le réseau lâche.",
    etapes: ["Installez NexIA School sur l'écran d'accueil du téléphone, comme une application.",
      "Sans connexion, les pages et données déjà consultées restent accessibles ; notes, appel, élèves et infractions se saisissent normalement.",
      "Au retour du réseau, tout part automatiquement ; si quelqu'un a modifié la même donnée entre-temps, vous choisissez quelle version garder.",
      "Chaque membre du personnel peut connecter son assistant IA (Claude, par exemple) pour interroger ses résultats ou saisir des notes, avec ses propres droits."] },
]

// --- Tarifs (en FCFA) : paiement mensuel, ou annuel avec 2 mois offerts (10 mois facturés au lieu de 12) ---------------------------
const MOIS_FACTURES_PAR_AN = 10
const OFFRES = [
  { nom: "Découverte", mensuel: 0, sous: "pour tester sans engagement",
    inclus: ["1 établissement, jusqu'à 50 élèves", "Personnel : jusqu'à 10 comptes", "Import Excel des élèves, classes et matières", "Saisie des notes, moyennes et rangs", "Bulletins PDF (sans QR code anti-fraude)", "Appel du jour", "Mode hors ligne"],
    exclus: ["SmartEval, emploi du temps, finances, espace parents, IA"], cta: "Commencer gratuitement" },
  { nom: "Essentiel", mensuel: 30000,
    inclus: ["Jusqu'à 500 élèves, personnel illimité", "Tout Découverte", "Bulletins avec QR code anti-fraude et décisions de fin de période", "Discipline complète et alertes", "Finances : frais, reçus, retards, moratoires", "Import et export Excel complets"], cta: "Choisir Essentiel" },
  { nom: "Pro", mensuel: 55000, recommande: true,
    inclus: ["Élèves illimités", "Tout Essentiel", "SmartEval : évaluation digitalisée et correction automatique", "Génération automatique des emplois du temps", "Espace parents et courrier", "Statistiques avancées et alertes de retard de saisie"], cta: "Choisir Pro" },
  { nom: "Premium", mensuel: 80000,
    inclus: ["Tout Pro", "IA intégrée : analyse des évaluations et remédiation", "Connexion de vos assistants IA (API et MCP)", "Accompagnement au démarrage et formation de l'équipe", "Assistance prioritaire"], cta: "Choisir Premium" },
]
const fcfa = (n) => `${new Intl.NumberFormat("fr-FR").format(n).replace(/\s/g, " ")} FCFA`

// --- Témoignages : EXEMPLES ILLUSTRATIFS, à remplacer par de vrais témoignages (avec l'accord des personnes) ------------------
const TEMOIGNAGES = [
  ["Les bulletins sortent désormais la semaine même du conseil de classe, et le QR code a mis fin aux bulletins retouchés que l'on nous présentait. Je vois en un coup d'œil les classes en difficulté et les enseignants en retard de saisie.",
    "Jean-Pierre MBARGA", "Proviseur", "Yaoundé"],
  ["Avec SmartEval, zéro copie corrigée. J'évalue de manière intelligente mes élèves avant la réelle évaluation sur papier. Cela me permet d'identifier les lacunes de chaque élève, et d'adapter la séance d'intégration puis le sujet d'évaluation en fonction des problèmes réels des élèves.",
    "Carine NGO BASSONG", "Professeure de mathématiques", "Douala"],
  ["Je fais l'appel sur mon téléphone, même quand le réseau coupe : tout part dès qu'il revient. Les sanctions et la note de discipline se calculent seules, et je suis alerté quand un élève dépasse le seuil d'absences.",
    "Aboubakar HAMADOU", "Surveillant général", "Garoua"],
  ["Chaque paiement donne un reçu numéroté et je sais à tout moment qui est en retard sur quelle tranche. Les parents demandent un délai depuis l'application : fini les cahiers de caisse qui ne concordent pas.",
    "Solange TCHOUMI", "Comptable-caissière", "Bafoussam"],
]

const FAQ = [
  ["Combien coûte NexIA School ?", "L'offre Découverte est gratuite (jusqu'à 50 élèves). Essentiel coûte 30 000 FCFA par mois, Pro 55 000 FCFA et Premium 80 000 FCFA. En payant à l'année, deux mois sont offerts. Rien ne vous est facturé sans votre accord."],
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
  ["Puis-je changer d'offre ?", "Oui, à tout moment. Toutes les données de l'établissement sont conservées. Dans une offre inférieure, les fonctionnalités avancées restent visibles en aperçu : vous savez exactement ce que vous gagnez en changeant d'offre."],
  ["Puis-je récupérer mes données ?", "Oui. Listes d'élèves, notes, résultats et emplois du temps s'exportent à tout moment au format Excel ou PDF."],
]

/** Comment ça marche : un grand cadre par fonctionnalité (écran réel de l'application, encart vitré), navigation haut / bas. */
function Fonctionnement() {
  const [k, setK] = useState(0), [sens, setSens] = useState(1)
  const n = FONCTIONNEMENT.length, f = FONCTIONNEMENT[k]
  const aller = (j, d) => { setSens(d ?? (j > k ? 1 : -1)); setK((j + n) % n) }
  const toucher = useRef(null)
  useEffect(() => {                                   // préchargement du cadre suivant et du précédent
    for (const j of [k + 1, k - 1]) { const g = FONCTIONNEMENT[(j + n) % n]; const im = new Image(); im.src = `${MEDIA}fonctionnement/${g.image}.webp` }
  }, [k, n])
  const clavier = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); aller(k + 1, 1) }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); aller(k - 1, -1) }
  }
  return (
    <div className="lp-fct" role="region" aria-roledescription={t("carrousel")} aria-label={t("Comment ça marche")} tabIndex={0} onKeyDown={clavier}
         onTouchStart={(e) => { toucher.current = [e.touches[0].clientX, e.touches[0].clientY] }}
         onTouchEnd={(e) => {
           if (!toucher.current) return
           const dx = e.changedTouches[0].clientX - toucher.current[0], dy = e.changedTouches[0].clientY - toucher.current[1]; toucher.current = null
           if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) aller(k + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1)
         }}>
      <img key={"fond" + k} className="lp-fct-fond" src={`${MEDIA}fonctionnement/${f.image}-fond.webp`} alt="" aria-hidden="true" />
      <div className="lp-fct-entete">
        <p className="lp-surtitre lp-surtitre-clair">{t("Comment ça marche")}</p>
        <h2 className="lp-serif">{t("De la création de l'école au bulletin, pas à pas")}</h2>
        <p className="lp-fct-intro">{t("Chaque cadre décrit une fonctionnalité telle que vous l'utiliserez. Commencez par la première : votre établissement est opérationnel le jour même.")}</p>
      </div>
      <div key={k} className={`lp-fct-diapo ${sens > 0 ? "vers-haut" : "vers-bas"}`} aria-live="polite">
        <figure className={`lp-fct-ecran lp-fct-${f.type}`}>
          {f.type === "bureau" && <div className="lp-fct-barre" aria-hidden="true"><i /><i /><i /><span>nexiaschool.pages.dev</span></div>}
          <img src={`${MEDIA}fonctionnement/${f.image}.webp`} alt={t("Écran de NexIA School : {v0}", { v0: t(f.titre) })} width={f.type === "bureau" ? 1440 : 585} height={f.type === "bureau" ? 900 : 996} decoding="async" />
        </figure>
        <article className="lp-fct-verre">
          <div className="lp-fct-verre-tete">
            <span className="lp-fct-icone"><Icone nom={f.trait} /></span>
            <span className="lp-fct-numero">{String(k + 1).padStart(2, "0")} <i>/ {n}</i></span>
          </div>
          <h3>{t(f.titre)}</h3>
          <p className="lp-fct-resume">{t(f.resume)}</p>
          <ol className="lp-fct-etapes">{f.etapes.map((e) => <li key={e}>{t(e)}</li>)}</ol>
        </article>
      </div>
      <nav className="lp-fct-nav" aria-label={t("Choisir une fonctionnalité")}>
        <button type="button" className="lp-fct-fleche" onClick={() => aller(k - 1, -1)} aria-label={t("Fonctionnalité précédente")}><Icone nom="haut" /></button>
        <ol className="lp-fct-points">{FONCTIONNEMENT.map((g, j) => (
          <li key={g.image}><button type="button" className={j === k ? "actif" : ""} aria-current={j === k ? "step" : undefined} onClick={() => aller(j)}
                                   aria-label={t("Fonctionnalité {v0} : {v1}", { v0: j + 1, v1: t(g.titre) })} /></li>))}</ol>
        <button type="button" className="lp-fct-fleche" onClick={() => aller(k + 1, 1)} aria-label={t("Fonctionnalité suivante")}><Icone nom="bas" /></button>
      </nav>
    </div>
  )
}

/** Bénéfices : cartes-images (photo, mini-écran flottant) et texte dessous. */
function Benefices() {
  return (
    <div className="lp-bnf-grille">
      {BENEFICES.map(([, titre, texte], i) => {
        const v = VISUELS_BENEFICES[i]
        return (
          <article className="lp-bnf" key={titre}>
            <div className="lp-bnf-visuel">
              <img src={`${MEDIA}benefices/${v.photo}.webp`} alt="" loading="lazy" decoding="async" width="720" height="880" />
              <div className="lp-bnf-widget" aria-hidden="true">
                <p className="lp-bnf-widget-titre">{t(v.titre)}</p>
                {v.lignes.map(([ic, lib, val, ton]) => (
                  <div className="lp-bnf-ligne" key={lib}>
                    <span className={`lp-bnf-pastille ${ton}`}><Icone nom={ic} /></span>
                    <span className="lp-bnf-lib">{t(lib)}</span>{val && <b className={ton}>{t(val)}</b>}
                  </div>))}
              </div>
            </div>
            <h3>{t(titre)}</h3>
            <p>{t(texte)}</p>
          </article>)
      })}
    </div>
  )
}

/** Carte flottante du hero (comme la carte « Cashflow » du modèle). */
function CarteHero() {
  const colonnes = [[22, 34, 10], [30, 40, 10], [12, 26, 8], [24, 52, 22]]
  return (
    <aside className="lp-hero-carte" aria-hidden="true">
      <p className="lp-hero-carte-titre">{t("Moyenne de classe")} <span>+1,8</span></p>
      <p className="lp-hero-carte-sous">{t("6e A · séquences 1 à 4")}</p>
      <div className="lp-hero-barres">{colonnes.map((c, i) => (
        <div key={i} className="lp-hero-colonne">{c.map((h, j) => <i key={j} className={`b${j}`} style={{ height: h + "%" }} />)}</div>))}</div>
    </aside>
  )
}

export default function Landing() {
  const [menu, setMenu] = useState(false)
  const [annuel, setAnnuel] = useState(false)
  useEffect(() => { document.title = t("NexIA School — Libérez votre établissement des tâches chronophages") }, [])
  const liens = [["#benefices", "Bénéfices"], ["#fonctionnement", "Comment ça marche"], ["#tarifs", "Tarifs"], ["#temoignages", "Témoignages"], ["#faq", "FAQ"]]

  return (
    <div className="lp">
      {/* 1. Logo + menu + CTA, 2. Proposition de valeur */}
      <div className="lp-cadre">
        <section className="lp-hero lp-hero-photo" aria-labelledby="lp-titre">
          <img className="lp-hero-fond" src={`${MEDIA}hero-classe.webp`} alt="" width="1920" height="1200" fetchpriority="high" decoding="async" />
          <div className="lp-hero-voile" aria-hidden="true" />
          <header className="lp-nav-hero">
            <Link to="/" aria-label={t("NexIA School, accueil")}><Marque clair /></Link>
            <nav className={`lp-liens ${menu ? "ouvert" : ""}`} aria-label={t("Navigation principale")}>
              {liens.map(([h, l]) => <a key={h} href={h} onClick={() => setMenu(false)}>{t(l)}</a>)}
            </nav>
            <div className="lp-nav-droite">
              <ChoixLangue variante="sombre" />
              <Link className="lp-lien-nav" to="/etablissement">{t("Se connecter")}</Link>
              <Commencer className="lp-pilule lp-pilule-nav lp-cta-nav" libelle="Essai gratuit" />
              <button type="button" className="lp-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /><span /></button>
            </div>
          </header>
          <div className="lp-hero-bas">
            <div className="lp-hero-contenu">
              <p className="lp-hero-ia"><Icone nom="etincelle" /><span>{t("Une plateforme intelligente qui suit le pouls de votre établissement, en temps réel.")}</span></p>
              <h1 id="lp-titre" className="lp-serif">{t("Libérez votre établissement des tâches chronophages.")}</h1>
              <p className="lp-hero-texte">{t("Automatisez les tâches scolaires, simplifiez le travail de vos équipes et pilotez votre établissement depuis une seule plateforme intelligente.")}</p>
              <div className="lp-hero-actions">
                <Commencer className="lp-pilule" libelle="Créer l'espace de mon établissement" fleche />
                <a className="lp-lien-demo" href="#demo">{t("Voir la démo")}</a>
              </div>
              <ul className="lp-hero-confiance">
                <li>{t("Gratuit pour commencer")}</li><li>{t("Prêt en 2 minutes")}</li><li>{t("Fonctionne hors ligne")}</li>
              </ul>
            </div>
            <CarteHero />
          </div>
        </section>
      </div>

      <main>
        {/* 3. Démo du produit */}
        <section id="demo" className="lp-section lp-apercu" aria-label={t("Démonstration de l'application")}>
          <div className="lp-conteneur">
            <div className="lp-navigateur">
              <div className="lp-navigateur-barre" aria-hidden="true"><i /><i /><i /><span>nexiaschool.pages.dev</span></div>
              <div className="lp-ecran-dalle lp-demo"><Demo /></div>
            </div>
          </div>
        </section>

        {/* 4. Bénéfices */}
        <section id="benefices" className="lp-section lp-section-bnf">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Bénéfices")}</p>
            <h2 className="lp-serif lp-titre-bnf">{t("Ce que NexIA School change pour l'école d'aujourd'hui")}</h2>
            <Benefices />
          </div>
        </section>

        {/* 5. Comment ça marche */}
        <section id="fonctionnement" className="lp-section lp-section-fct">
          <div className="lp-conteneur"><Fonctionnement /></div>
        </section>

        {/* 6. Tarifs */}
        <section id="tarifs" className="lp-section">
          <div className="lp-conteneur">
            <p className="lp-surtitre">{t("Tarifs")}</p>
            <h2>{t("Une offre pour chaque établissement")}</h2>
            <div className="lp-periodicite" role="group" aria-label={t("Période de paiement")}>
              <button type="button" className={annuel ? "" : "actif"} aria-pressed={!annuel} onClick={() => setAnnuel(false)}>{t("Mensuel")}</button>
              <button type="button" className={annuel ? "actif" : ""} aria-pressed={annuel} onClick={() => setAnnuel(true)}>{t("Annuel")} <span className="lp-economie">{t("2 mois offerts")}</span></button>
            </div>
            <div className="lp-offres">
              {OFFRES.map((o) => {
                const gratuit = !o.mensuel
                const prix = gratuit ? t("Gratuit") : fcfa(annuel ? o.mensuel * MOIS_FACTURES_PAR_AN : o.mensuel)
                const sous = gratuit ? t(o.sous) : annuel ? t("par an, soit {v0} d'économie", { v0: fcfa(o.mensuel * (12 - MOIS_FACTURES_PAR_AN)) }) : t("par mois")
                return (
                  <article key={o.nom} className={`lp-offre${o.recommande ? " lp-offre-recommandee" : ""}`}>
                    {o.recommande && <span className="lp-offre-badge">{t("Recommandée")}</span>}
                    <h3>{t(o.nom)}</h3>
                    <p className="lp-offre-prix">{prix}</p>
                    <p className="lp-offre-sous">{sous}</p>
                    <ul className="lp-offre-liste">{o.inclus.map((x) => <li key={x}>{t(x)}</li>)}</ul>
                    {o.exclus && <ul className="lp-offre-liste lp-offre-exclus">{o.exclus.map((x) => <li key={x}>{t(x)}</li>)}</ul>}
                    {gratuit ? <Commencer className="lp-bouton lp-offre-bouton" libelle={o.cta} />
                      : <a className={`lp-bouton lp-offre-bouton${o.recommande ? "" : " lp-bouton-blanc lp-bouton-contour"}`}
                           href={`mailto:${EDITEUR.contact}?subject=${encodeURIComponent(`NexIA School — ${o.nom} (${annuel ? "annuel" : "mensuel"})`)}`}>{t(o.cta)}</a>}
                  </article>)
              })}
            </div>
            <p className="lp-offres-note">{t("Prix en francs CFA. Changez d'offre à tout moment ; les données de l'établissement sont conservées.")}</p>
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
              <img className="lp-avatar lp-avatar-photo" src={`${MEDIA}marvin-ahanda.webp`} alt="Marvin AHANDA" width="160" height="160" loading="lazy" decoding="async" />
              <div>
                <p className="lp-surtitre">{t("À propos du développeur")}</p>
                <h2>Marvin AHANDA</h2>
                <p className="lp-developpeur-role">{t("Ingénieur en systèmes multi-agents et automatisation IA · Fondateur de NexIA School")}</p>
                <p>{t("Je suis Marvin Ahanda, ingénieur spécialisé dans la conception et le déploiement de systèmes multi-agents et d'automatisation IA. Fondateur de NexIA Automatisation et de NexIA Academy, j'accompagne les entreprises dans l'automatisation durable de leurs processus critiques. Également directeur technique de l'IA Challenge Inter-School 2026, j'œuvre activement pour faire évoluer l'écosystème éducatif et technologique africain de la simple consommation à la conception d'outils intelligents.")}</p>
                <div className="lp-developpeur-liens">
                  <a className="lp-bouton" href="https://marvinahanda.netlify.app" target="_blank" rel="noopener noreferrer">{t("Voir mon portfolio")}</a>
                  <a className="lp-bouton lp-bouton-blanc" href={EDITEUR.whatsapp} target="_blank" rel="noopener noreferrer"><span className="lp-icone-lien"><Icone nom="whatsapp" /></span>{t("Me contacter")}</a>
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
          <nav aria-label={t("Réseaux")} className="lp-pied-reseaux">
            <a href={EDITEUR.whatsapp} target="_blank" rel="noopener noreferrer"><Icone nom="whatsapp" />WhatsApp</a>
            <a href={EDITEUR.linkedin} target="_blank" rel="noopener noreferrer"><Icone nom="linkedin" />LinkedIn</a>
          </nav>
          <p>© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service} · {t("Fait au Cameroun")}</p>
        </div>
      </footer>
    </div>
  )
}
