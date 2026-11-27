// Page d'accueil publique de NexIA School : brève, épurée, sans photos ni illustrations génériques. Blocs, dans l'ordre où un
// visiteur décide : accroche → fonctionnalités → démonstration → démarrage en 3 étapes → SmartEval enseignants → tarifs → FAQ.
// Style : cartes blanches sur fond gris clair, typographie Inter serrée, boutons noirs en pilule, apparitions discrètes au défilement.
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import "@fontsource-variable/inter"
import { ChoixLangue, t } from "../i18n.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { FAQ_ACCUEIL, OFFRES } from "../lib/seo-pages.js"
import { connexionGoogle, rpc } from "../supabase.js"
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
  lien: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  liste: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  ia: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M10.5 12h3"/>',
  courbe: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
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

// --- Tarifs (en FCFA) : lus en base (offres_publiques, configuration commerciale) ; rien n'est écrit en dur ici --------------
const fcfa = (n) => `${new Intl.NumberFormat("fr-FR").format(n).replace(/\s/g, " ")} FCFA`

// --- Témoignages : EXEMPLES ILLUSTRATIFS, à remplacer par de vrais témoignages (avec l'accord des personnes) ------------------
const TEMOIGNAGES = [
  ["Les bulletins sortent désormais la semaine même du conseil de classe, et le QR code a mis fin aux bulletins retouchés que l'on nous présentait. Je vois en un coup d'œil les classes en difficulté et les enseignants en retard de saisie.",
    "Jean-Pierre MBARGA", "Proviseur", "Yaoundé"],
  ["Avec SmartEval, zéro copie corrigée. J'évalue de manière intelligente mes élèves avant la réelle évaluation sur papier. Cela me permet d'identifier les lacunes de chaque élève, et d'adapter la séance d'intégration puis le sujet d'évaluation en fonction des problèmes réels des élèves.",
    "Carine NGO BASSONG", "Professeure de mathématiques", "Douala"],
]

const FAQ = FAQ_ACCUEIL                    // source unique (reprise dans les données structurées du référencement)

const LIENS = [["#fonctionnalites", "Fonctionnalités"], ["#demo", "Démonstration"], ["#etapes", "Démarrer"], ["#smarteval", "SmartEval enseignants"],
  ["#tarifs", "Tarifs"], ["#faq", "FAQ"]]

const SMARTEVAL = [
  ["smarteval", "Évaluations digitalisées", "QCM, cases à cocher, réponses courtes ou rédigées : corrigées automatiquement dès l'envoi."],
  ["liste", "Aucune liste d'élèves à créer", "Indiquez simplement la classe : chaque élève saisit son nom en répondant."],
  ["lien", "Partage par lien", "Un lien à envoyer sur WhatsApp ou par SMS, ouvert sur n'importe quel téléphone."],
  ["courbe", "Analyse pédagogique", "Réussite par question et par notion, profil de chaque élève, notions à reprendre."],
  ["ia", "Connexion IA via MCP", "Votre assistant (Claude, ChatGPT…) lit les résultats et propose la remédiation, avec votre propre compte."],
]

/** Apparition discrète des blocs au défilement (désactivée si l'utilisateur limite les animations). */
function useApparition(racine) {
  useEffect(() => {
    const el = racine.current
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    el.classList.add("ac-anim")
    const obs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("vu"); obs.unobserve(e.target) } }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 })
    el.querySelectorAll(".ac-apparait").forEach((x) => obs.observe(x))
    return () => obs.disconnect()
  }, [racine])
}

/** Maquette réaliste de SmartEval (HTML/CSS, aucune image) : résultats d'une évaluation partagée par lien. */
function MaquetteSmartEval() {
  const notions = [["Simplifier une fraction", 86], ["Comparer des fractions", 64], ["Additionner des fractions", 38]]
  return (
    <div className="ac-maquette" aria-hidden="true">
      <div className="ac-maquette-barre"><span /><span /><span /><em>nexiaschool.com/e/7Kq2…</em></div>
      <div className="ac-maquette-corps">
        <div className="ac-maquette-tete">
          <div><b>Les fractions</b><i>6e · Mathématiques</i></div>
          <span className="ac-maquette-statut">Ouverte</span>
        </div>
        <div className="ac-maquette-chiffres">
          <div><b>32</b><i>réponses</i></div><div><b>12,4</b><i>moyenne /20</i></div><div><b>69 %</b><i>réussite</i></div>
        </div>
        <p className="ac-maquette-titre">Réussite par notion</p>
        <ul className="ac-maquette-notions">
          {notions.map(([n, v]) => <li key={n}><span>{n}</span><span className="ac-maquette-jauge"><span style={{ width: `${v}%` }} className={v < 50 ? "faible" : ""} /></span><b>{v} %</b></li>)}
        </ul>
        <div className="ac-maquette-ia"><span className="ac-maquette-puce" />Analyse IA : 9 élèves à revoir sur l'addition — 3 trinômes proposés</div>
      </div>
    </div>
  )
}

export default function Landing() {
  const [menu, setMenu] = useState(false)
  const [actif, setActif] = useState("#fonctionnalites")
  const racine = useRef(null)
  useApparition(racine)
  // configuration commerciale publique : copie de référence au pré-rendu, puis valeurs du serveur
  const [offres, setOffres] = useState(OFFRES)
  useEffect(() => { rpc("offres_publiques").then(setOffres).catch(() => {}) }, [])
  useEffect(() => {                       // menu : la section visible est mise en avant (comme l'onglet blanc du modèle)
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActif("#" + e.target.id)), { rootMargin: "-45% 0px -50% 0px" })
    LIENS.forEach(([h]) => { const s = document.querySelector(h); if (s) obs.observe(s) })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="ac" ref={racine}>
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
            <h1 id="ac-titre"><span>{t("Logiciel de gestion scolaire :")}</span> <span>{t("moins de gestion, plus de réussite")}</span></h1>
            <p className="ac-hero-texte">{t("Centralisez la gestion de votre établissement, digitalisez les évaluations et exploitez l'intelligence artificielle pour mieux comprendre les performances de vos élèves. Tout cela depuis une seule plateforme.")}</p>
            <div className="ac-hero-actions">
              <Commencer />
              <Link className="ac-pilule ac-pilule-claire" to="/etablissement"><span>{t("Se connecter")}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></Link>
            </div>
            <p className="ac-preuve"><b>{t("Gratuit jusqu'à 50 élèves")}</b><span>{t("Prêt en 2 minutes · sans installation")}</span></p>
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
        <section id="fonctionnalites" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Fonctionnalités")}</p>
            <h2>{t("Moins d'administratif, plus de pédagogie")}</h2>
            <div className="ac-grille-3">
              {AVANTAGES.map(([ic, titre, texte]) => (
                <article key={titre} className="ac-bloc ac-apparait">
                  <span className="ac-bloc-icone"><Icone nom={ic} /></span>
                  <h3>{t(titre)}</h3><p>{t(texte)}</p>
                </article>))}
            </div>
          </div>
        </section>

        {/* 3. Démo */}
        <section id="demo" className="ac-section ac-section-serree">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Démonstration")}</p>
            <h2>{t("Voyez NexIA School en deux minutes")}</h2>
            <div className="ac-carte ac-carte-video ac-apparait"><Demo /></div>
          </div>
        </section>

        {/* 4. Démarrer en 3 étapes */}
        <section id="etapes" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Démarrer")}</p>
            <h2>{t("Opérationnel le jour même, en trois étapes")}</h2>
            <ol className="ac-grille-3 ac-etapes">
              {ETAPES.map(([ic, titre, texte], i) => (
                <li key={titre} className="ac-bloc ac-apparait">
                  <div className="ac-etape-tete"><span className="ac-etape-num">{i + 1}</span><span className="ac-bloc-icone"><Icone nom={ic} /></span></div>
                  <h3>{t(titre)}</h3><p>{t(texte)}</p>
                </li>))}
            </ol>
          </div>
        </section>

        {/* 5. SmartEval pour les enseignants, sans établissement */}
        <section id="smarteval" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("SmartEval enseignants")}</p>
            <h2>{t("Enseignant ? Utilisez SmartEval sans établissement")}</h2>
            <p className="ac-intro">{t("Pas besoin que votre école soit abonnée : créez votre compte avec votre adresse e-mail, préparez vos évaluations et partagez-les à vos élèves en quelques minutes.")}</p>
            <div className="ac-se">
              <ul className="ac-se-liste">
                {SMARTEVAL.map(([ic, titre, texte]) => (
                  <li key={titre} className="ac-apparait"><span className="ac-se-icone"><Icone nom={ic} /></span>
                    <span><b>{t(titre)}</b><span>{t(texte)}</span></span></li>))}
              </ul>
              <div className="ac-se-visuel ac-apparait"><MaquetteSmartEval /></div>
            </div>
            <div className="ac-se-actions">
              <Link className="ac-pilule" to="/smarteval/inscription"><span>{t("Créer mon compte SmartEval")}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></Link>
              <Link className="ac-lien-souligne" to="/tarifs/smarteval">{t("Voir les offres SmartEval")}</Link>
            </div>
            <p className="ac-note">{offres ? t("Gratuit pour commencer : {v0} évaluation et {v1} réponses pendant {v2} jours. Puis {v3} par an.",
              { v0: offres.smarteval.decouverte.evaluations, v1: offres.smarteval.decouverte.soumissions, v2: offres.smarteval.decouverte.duree_jours, v3: fcfa(offres.smarteval.prix_annuel) }) : ""}</p>
          </div>
        </section>

        {/* 6. Tarifs */}
        <section id="tarifs" className="ac-section">
          <div className="ac-conteneur">
            <p className="ac-etiquette">{t("Tarifs")}</p>
            <h2>{t("Une offre complète, au tarif de votre effectif")}</h2>
            <div className="ac-offres">
              <article className="ac-offre ac-apparait">
                <div className="ac-offre-tete"><h3>{t("Découverte")}</h3></div>
                <p className="ac-prix">{t("Gratuit")}</p>
                <p className="ac-prix-sous">{offres ? t("{v0} jours, jusqu'à {v1} élèves", { v0: offres.etablissement.decouverte.duree_jours, v1: offres.etablissement.decouverte.max_eleves }) : "…"}</p>
                <ul>{["Saisie des notes, moyennes et rangs", "Bulletins PDF", "Appel du jour", "Import Excel des élèves, classes et matières", "Mode hors ligne"].map((x) => <li key={x}><Icone nom="check" />{t(x)}</li>)}</ul>
                <Commencer libelle="Commencer gratuitement" petit clair />
              </article>
              <article className="ac-offre ac-offre-phare ac-apparait">
                <div className="ac-offre-tete"><h3>{t("Premium")}</h3><span className="ac-badge">{t("Toutes les fonctionnalités")}</span></div>
                <p className="ac-prix">{offres ? fcfa(offres.etablissement.prix_eleve) : "…"}</p>
                <p className="ac-prix-sous">{offres ? t("par élève et par an · minimum {v0}", { v0: fcfa(offres.etablissement.minimum_annuel) }) : ""}</p>
                <ul>{["Absolument toutes les fonctionnalités de l'application", "Discipline, finances, parents, SmartEval, emplois du temps", "Statistiques, IA intégrée, API et MCP", "Capacité ajustable : vous ne payez que la différence", "Valable 12 mois à compter de la souscription"].map((x) => <li key={x}><Icone nom="check" />{t(x)}</li>)}</ul>
                <Link className="ac-pilule ac-pilule-petite" to="/tarifs"><span>{t("Calculer mon tarif")}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></Link>
              </article>
              <article className="ac-offre ac-apparait">
                <div className="ac-offre-tete"><h3>{t("SmartEval enseignants")}</h3></div>
                <p className="ac-prix">{offres ? fcfa(offres.smarteval.prix_annuel) : "…"}</p>
                <p className="ac-prix-sous">{offres ? t("par an · {v0} évaluations publiées", { v0: offres.smarteval.credits }) : ""}</p>
                <ul>{["Pour les enseignants sans établissement abonné", "Évaluations digitalisées et correction automatique", "Analyse par votre propre IA", "Offre de groupe pour un département"].map((x) => <li key={x}><Icone nom="check" />{t(x)}</li>)}</ul>
                <Link className="ac-pilule ac-pilule-petite ac-pilule-claire" to="/smarteval/inscription"><span>{t("Créer mon compte SmartEval")}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></Link>
              </article>
            </div>
            <p className="ac-note">{t("Prix en francs CFA, paiement par mobile money ou carte. Sans renouvellement, l'abonnement s'arrête à l'échéance ; les données sont conservées et restent consultables.")}</p>
          </div>
        </section>

        {/* 7. Confiance : témoignages, questions fréquentes, dernier appel */}
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
            <h2 id="ac-appel-titre">{t("Moins de gestion, plus de réussite : commencez aujourd'hui.")}</h2>
            <p>{t("Créez gratuitement l'espace de votre établissement : il est prêt en deux minutes, et vos listes Excel suffisent pour démarrer.")}</p>
            <div className="ac-hero-actions"><Commencer />
              <Link className="ac-pilule ac-pilule-claire" to="/smarteval/inscription"><span>{t("Je suis enseignant")}</span><span className="ac-pilule-rond"><Icone nom="fleche" /></span></Link></div>
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
            <Link to="/tarifs">{t("Tarifs")}</Link>
            <Link to="/tarifs/smarteval">{t("SmartEval pour les enseignants")}</Link>
            <Link to="/smarteval/connexion">{t("Espace SmartEval")}</Link>
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
