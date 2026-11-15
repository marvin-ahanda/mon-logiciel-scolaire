// Page d'accueil publique de NexIA School : brève, épurée, sans photos. Six blocs, dans l'ordre où un chef d'établissement
// décide : accroche → avantages → démo → démarrage en 3 étapes → tarifs → confiance (témoignages, FAQ) et dernier appel.
// Style : carte blanche arrondie sur fond gris clair, voile pastel, typographie Inter serrée, boutons noirs en pilule.
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import "@fontsource-variable/inter"
import { ChoixLangue, t } from "../i18n.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { connexionGoogle } from "../supabase.js"
import "../accueil.css"

const MEDIA = `${import.meta.env.BASE_URL}media/`

/** Icônes au trait (24 × 24). */
const ICONES = {
  fleche: '<path d="M7 17 17 7M8 7h9v9"/>',
  bulletin: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  smarteval: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  parents: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  finances: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  horsligne: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 4.1"/><circle cx="12" cy="20" r="1"/>',
  temps: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  loupe: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ecole: '<path d="m3 10 9-6 9 6"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.7-1.1-2.1-2.1l.8-1-1-2z"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
}
function Icone({ nom }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: ICONES[nom] }} />
}

/** Bouton noir en pilule, avec la flèche dans un rond blanc (comme le modèle). */
function Commencer({ libelle = "Créer mon établissement", petit = false, clair = false }) {
  const [erreur, setErreur] = useState("")
  return (
    <>
      <button type="button" className={`ac-pilule${petit ? " ac-pilule-petite" : ""}${clair ? " ac-pilule-claire" : ""}`}
              onClick={() => connexionGoogle("/inscription").catch((e) => setErreur(e.message))}>
        <span>{t(libelle)}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span>
      </button>
      {erreur && <p className="ac-erreur" role="alert">{erreur}</p>}
    </>
  )
}

/** Vidéo de démonstration : rien n'est téléchargé avant le clic (seule l'image d'aperçu s'affiche). */
function Demo() {
  const ref = useRef(null)
  const [lancee, setLancee] = useState(false)
  return (
    <div className="ac-video">
      <video ref={ref} controls={lancee} preload="none" playsInline poster={`${MEDIA}nexiaschool-demo-apercu.webp`}
             aria-label={t("Vidéo de démonstration de NexIA School (2 minutes)")} onPlay={() => setLancee(true)}>
        <source src={`${MEDIA}nexiaschool-demo.mp4`} type="video/mp4" />
        {t("Votre navigateur ne peut pas lire cette vidéo.")}
      </video>
      {!lancee && (
        <button type="button" className="ac-lecture" onClick={() => { setLancee(true); ref.current?.play() }} aria-label={t("Lire la vidéo de démonstration")}>
          <span className="ac-lecture-rond" aria-hidden="true" /><span className="ac-lecture-texte">{t("Voir la démo · 2 min")}</span>
        </button>)}
    </div>
  )
}

const POINTS_FORTS = [["bulletin", "Notes et bulletins"], ["agenda", "Emplois du temps"], ["smarteval", "SmartEval"], ["parents", "Espace parents"], ["finances", "Finances"]]

const AVANTAGES = [
  ["temps", "Moins de tâches répétitives", "Moyennes, rangs, bulletins et emplois du temps se calculent tout seuls. Vos équipes passent moins de temps sur les calculs et la recopie."],
  ["loupe", "Les difficultés repérées à temps", "SmartEval corrige les évaluations en ligne et montre les notions non acquises, élève par élève, avant le devoir sur table."],
  ["ecole", "Toute l'école au même endroit", "Notes, discipline, finances, parents et courrier réunis, sur ordinateur comme sur téléphone, même quand la connexion coupe."],
]

const ETAPES = [
  ["ecole", "Créez l'espace de l'établissement", "Avec votre compte Google, en deux minutes. Sans installation."],
  ["import", "Importez vos fichiers Excel", "Élèves, classes, matières et personnel : rien à ressaisir, même si le fichier est imparfait."],
  ["equipe", "Votre équipe se connecte", "Chacun reçoit son code et retrouve ses classes : notes, appel et bulletins dès le premier jour."],
]

// --- Tarifs (en FCFA) : paiement mensuel, ou annuel avec 2 mois offerts (10 mois facturés au lieu de 12) ---------------------------
const MOIS_FACTURES_PAR_AN = 10
const OFFRES = [
  { nom: "Découverte", mensuel: 0, sous: "pour tester sans engagement",
    inclus: ["1 établissement, jusqu'à 50 élèves", "Personnel : jusqu'à 10 comptes", "Import Excel des élèves, classes et matières", "Saisie des notes, moyennes et rangs", "Bulletins PDF (sans QR code anti-fraude)", "Appel du jour", "Mode hors ligne"],
    cta: "Commencer gratuitement" },
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
]

const FAQ = [
  ["Faut-il installer un logiciel ?", "Non. NexIA School fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone. Vous pouvez aussi l'ajouter à l'écran d'accueil du téléphone pour l'ouvrir comme une application."],
  ["Et si la connexion Internet est mauvaise ou coupée ?", "L'application est conçue pour les connexions lentes : les données déjà consultées s'affichent sans attendre. Hors ligne, notes, appel, élèves et infractions se saisissent normalement et sont envoyés automatiquement au retour du réseau."],
  ["Dois-je ressaisir toutes mes données ?", "Non. Importez vos listes Excel (élèves, classes, matières, personnel, coefficients, notes), séparément ou en un seul classeur. Les cases incomplètes sont signalées sans bloquer l'import."],
  ["Les données d'un établissement sont-elles visibles par un autre ?", "Non. Chaque établissement dispose de son propre espace : la base de données refuse toute lecture ou écriture en dehors de son établissement, quel que soit l'utilisateur."],
  ["Puis-je changer d'offre ?", "Oui, à tout moment. Toutes les données de l'établissement sont conservées. Dans une offre inférieure, les fonctionnalités avancées restent visibles en aperçu : vous savez exactement ce que vous gagnez en changeant d'offre."],
]

const LIENS = [["#avantages", "Avantages"], ["#demo", "Démo"], ["#etapes", "Démarrer"], ["#tarifs", "Tarifs"], ["#faq", "FAQ"]]

export default function Landing() {
  const [menu, setMenu] = useState(false)
  const [annuel, setAnnuel] = useState(false)
  const [actif, setActif] = useState("#avantages")
  useEffect(() => { document.title = t("NexIA School — Libérez votre établissement des tâches chronophages") }, [])
  useEffect(() => {                       // menu : la section visible est mise en avant (comme l'onglet blanc du modèle)
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActif("#" + e.target.id)), { rootMargin: "-45% 0px -50% 0px" })
    LIENS.forEach(([h]) => { const s = document.querySelector(h); if (s) obs.observe(s) })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="ac">
      {/* 1. Accroche */}
      <div className="ac-page-haut">
        <section className="ac-carte ac-hero" aria-labelledby="ac-titre">
          <div className="ac-voile" aria-hidden="true" />
          <header className="ac-nav">
            <Link to="/" className="ac-marque" aria-label={t("NexIA School, accueil")}>
              <img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="34" height="34" /><span>NexIA School<i>.</i></span>
            </Link>
            <nav className={`ac-onglets${menu ? " ouvert" : ""}`} aria-label={t("Navigation principale")}>
              {LIENS.map(([h, l]) => <a key={h} href={h} className={actif === h ? "actif" : ""} onClick={() => setMenu(false)}>{t(l)}</a>)}
            </nav>
            <div className="ac-nav-droite">
              <ChoixLangue />
              <Link className="ac-lien" to="/etablissement">{t("Se connecter")}</Link>
              <span className="ac-nav-cta"><Commencer libelle="Essai gratuit" petit /></span>
              <button type="button" className="ac-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /></button>
            </div>
          </header>

          <div className="ac-hero-centre">
            <h1 id="ac-titre">{t("Libérez votre établissement des tâches chronophages.")}</h1>
            <p className="ac-hero-texte">{t("Automatisez les tâches scolaires, simplifiez le travail de vos équipes et pilotez votre établissement depuis une seule plateforme intelligente.")}</p>
            <div className="ac-hero-actions">
              <Commencer />
              <div className="ac-preuve">
                <div className="ac-ronds" aria-hidden="true">
                  {["bulletin", "agenda", "smarteval", "horsligne"].map((n) => <span key={n}><Icone nom={n} /></span>)}
                </div>
                <p><b>{t("Gratuit jusqu'à 50 élèves")}</b><span>{t("Prêt en 2 minutes · sans installation")}</span></p>
              </div>
            </div>
          </div>

          <div className="ac-hero-bas">
            <p className="ac-filet"><span>{t("Tout ce dont votre établissement a besoin, au même endroit")}</span></p>
            <ul className="ac-points-forts">
              {POINTS_FORTS.map(([ic, lib]) => <li key={lib}><span className="ac-pf-icone"><Icone nom={ic} /></span>{t(lib)}</li>)}
            </ul>
          </div>
        </section>
      </div>

      <main>
        {/* 2. Avantages */}
        <section id="avantages" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Avantages")}</p>
            <h2>{t("Moins d'administratif, plus de pédagogie")}</h2>
            <div className="ac-grille-3">
              {AVANTAGES.map(([ic, titre, texte]) => (
                <article key={titre} className="ac-bloc">
                  <span className="ac-bloc-icone"><Icone nom={ic} /></span>
                  <h3>{t(titre)}</h3><p>{t(texte)}</p>
                </article>))}
            </div>
          </div>
        </section>

        {/* 3. Démo */}
        <section id="demo" className="ac-section ac-section-serree">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Démo")}</p>
            <h2>{t("Voyez NexIA School en deux minutes")}</h2>
            <div className="ac-carte ac-carte-video"><Demo /></div>
          </div>
        </section>

        {/* 4. Démarrer en 3 étapes */}
        <section id="etapes" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Démarrer")}</p>
            <h2>{t("Opérationnel le jour même, en trois étapes")}</h2>
            <ol className="ac-grille-3 ac-etapes">
              {ETAPES.map(([ic, titre, texte], i) => (
                <li key={titre} className="ac-bloc">
                  <div className="ac-etape-tete"><span className="ac-etape-num">{i + 1}</span><span className="ac-bloc-icone"><Icone nom={ic} /></span></div>
                  <h3>{t(titre)}</h3><p>{t(texte)}</p>
                </li>))}
            </ol>
          </div>
        </section>

        {/* 5. Tarifs */}
        <section id="tarifs" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Tarifs")}</p>
            <h2>{t("Une offre pour chaque établissement")}</h2>
            <div className="ac-bascule" role="group" aria-label={t("Période de paiement")}>
              <button type="button" className={annuel ? "" : "actif"} aria-pressed={!annuel} onClick={() => setAnnuel(false)}>{t("Mensuel")}</button>
              <button type="button" className={annuel ? "actif" : ""} aria-pressed={annuel} onClick={() => setAnnuel(true)}>{t("Annuel")} <em>{t("2 mois offerts")}</em></button>
            </div>
            <div className="ac-offres">
              {OFFRES.map((o) => {
                const gratuit = !o.mensuel
                const prix = gratuit ? t("Gratuit") : fcfa(annuel ? o.mensuel * MOIS_FACTURES_PAR_AN : o.mensuel)
                const sous = gratuit ? t(o.sous) : annuel ? t("par an, soit {v0} d'économie", { v0: fcfa(o.mensuel * (12 - MOIS_FACTURES_PAR_AN)) }) : t("par mois")
                return (
                  <article key={o.nom} className={`ac-offre${o.recommande ? " ac-offre-phare" : ""}`}>
                    <div className="ac-offre-tete"><h3>{t(o.nom)}</h3>{o.recommande && <span className="ac-badge">{t("Recommandée")}</span>}</div>
                    <p className="ac-prix">{prix}</p>
                    <p className="ac-prix-sous">{sous}</p>
                    <ul>{o.inclus.map((x) => <li key={x}><Icone nom="check" />{t(x)}</li>)}</ul>
                    {gratuit ? <Commencer libelle={o.cta} petit clair={!o.recommande} />
                      : <a className={`ac-pilule ac-pilule-petite${o.recommande ? "" : " ac-pilule-claire"}`}
                           href={`mailto:${EDITEUR.contact}?subject=${encodeURIComponent(`NexIA School — ${o.nom} (${annuel ? "annuel" : "mensuel"})`)}`}>
                          <span>{t(o.cta)}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></a>}
                  </article>)
              })}
            </div>
            <p className="ac-note">{t("Prix en francs CFA. Changez d'offre à tout moment ; les données de l'établissement sont conservées.")}</p>
          </div>
        </section>

        {/* 6. Confiance : témoignages, questions fréquentes, dernier appel */}
        <section id="faq" className="ac-section">
          <div className="ac-conteneur">
            <div className="ac-temoignages">
              {TEMOIGNAGES.map(([texte, nom, role, ville]) => (
                <figure key={nom} className="ac-bloc ac-temoignage">
                  <blockquote><p>« {t(texte)} »</p></blockquote>
                  <figcaption><span className="ac-initiales" aria-hidden="true">{nom.split(" ").map((m) => m[0]).slice(0, 2).join("")}</span>
                    <span><b>{nom}</b><i>{t(role)} · {ville}</i></span></figcaption>
                </figure>))}
            </div>
            <div className="ac-faq">
              <div>
                <p className="ac-etiquette">{t("Questions fréquentes")}</p>
                <h2>{t("Vous vous demandez peut-être…")}</h2>
                <p className="ac-faq-contact">{t("Une autre question ?")} <a href={EDITEUR.whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a></p>
              </div>
              <div className="ac-faq-liste">
                {FAQ.map(([q, r]) => <details key={q}><summary>{t(q)}<span className="ac-plus"><Icone nom="plus" /></span></summary><p>{t(r)}</p></details>)}
              </div>
            </div>
          </div>
        </section>

        <div className="ac-page-bas">
          <section className="ac-carte ac-appel" aria-labelledby="ac-appel-titre">
            <div className="ac-voile" aria-hidden="true" />
            <h2 id="ac-appel-titre">{t("Prêt à libérer votre établissement ?")}</h2>
            <p>{t("Créez gratuitement l'espace de votre établissement : il est prêt en deux minutes, et vos listes Excel suffisent pour démarrer.")}</p>
            <Commencer />
          </section>
        </div>
      </main>

      <footer className="ac-pied">
        <div className="ac-conteneur ac-pied-ligne">
          <span className="ac-marque ac-marque-petite"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="26" height="26" /><span>NexIA School<i>.</i></span></span>
          <nav aria-label={t("Liens légaux")}>
            <Link to="/confidentialite">{t("Politique de confidentialité")}</Link>
            <Link to="/conditions">{t("Conditions d'utilisation")}</Link>
            <Link to="/developpeurs">{t("Développeurs (API et MCP)")}</Link>
          </nav>
          <nav aria-label={t("Réseaux")} className="ac-reseaux">
            <a href={EDITEUR.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><Icone nom="whatsapp" /></a>
            <a href={EDITEUR.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><Icone nom="linkedin" /></a>
          </nav>
        </div>
        <p className="ac-conteneur ac-signature">© {new Date().getFullYear()} {EDITEUR.nom} — {EDITEUR.service} · {t("Conçu par")} <a href="https://marvinahanda.netlify.app" target="_blank" rel="noopener noreferrer">Marvin AHANDA</a> · {t("Fait au Cameroun")}</p>
      </footer>
    </div>
  )
}
