// Pages publiques de tarification : établissements (calculateur selon l'effectif) et SmartEval (enseignants).
// Les montants sont lus sur le serveur (offres_publiques) : aucune valeur commerciale n'est écrite en dur ici.
import { useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { LIBELLES_FONCTIONS, montantEtablissement } from "../lib/offres.js"
import { rpc } from "../supabase.js"
import { OFFRES } from "../lib/seo-pages.js"
import { ChoixLangue, locale, t } from "../i18n.jsx"

const fcfa = (n) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(n || 0)).replace(/[  ]/g, " ")} FCFA`

function Cadre({ children }) {
  return (
    <div className="page-tarifs">
      <header className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
        <Link to="/" className="fw-bold text-decoration-none d-flex align-items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="28" height="28" className="rounded-2" />NexIA School</Link>
        <nav className="d-flex align-items-center gap-3 small" aria-label={t("Tarifs")}>
          <Link to="/tarifs">{t("Établissements")}</Link><Link to="/tarifs/smarteval">{t("SmartEval enseignants")}</Link><ChoixLangue /></nav>
      </header>
      <main className="container py-4 py-md-5" style={{ maxWidth: 1100 }}>{children}</main>
    </div>
  )
}

// Copie de référence des offres (pré-rendu, premier affichage), remplacée par les valeurs du serveur dès leur arrivée
const useOffres = () => { const [o, erreur] = useDonnees(() => rpc("offres_publiques"), []); return [o || OFFRES, erreur] }

export function TarifsEtablissements() {
  const [o, erreur] = useOffres()
  const [effectif, setEffectif] = useState(300)
  if (!o) return <Cadre><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</Cadre>
  const e = o.etablissement
  const n = Math.max(0, Math.floor(Number(effectif) || 0))
  const montant = montantEtablissement(n, o)
  const gratuites = e.decouverte.fonctions.map((f) => t(LIBELLES_FONCTIONS[f] || f))
  return (
    <Cadre>
      <h1 className="display-6 fw-bold text-center mb-2">{t("Tarifs du logiciel de gestion scolaire")}</h1>
      <p className="lead text-center text-muted mb-5">{t("{v0} par élève et par an, toutes les fonctionnalités incluses. Minimum {v1} par an.", { v0: fcfa(e.prix_eleve), v1: fcfa(e.minimum_annuel) })}</p>
      <div className="row g-4 mb-5">
        <div className="col-lg-5"><div className="card h-100"><div className="card-body p-4">
          <h2 className="h4">{t("Découverte")}</h2>
          <div className="fs-3 fw-bold mb-2">{t("Gratuit")}</div>
          <p className="text-muted small">{t("Pour essayer NexIA School pendant {v0} jours, jusqu'à {v1} élèves et {v2} comptes du personnel.", { v0: e.decouverte.duree_jours, v1: e.decouverte.max_eleves, v2: e.decouverte.max_personnel })}</p>
          <ul className="small ps-3">{gratuites.map((g) => <li key={g}>{g}</li>)}</ul>
          <Link className="btn btn-outline-primary w-100" to="/inscription">{t("Commencer gratuitement")}</Link>
          <p className="form-text mb-0">{t("Une offre gratuite par adresse e-mail.")}</p>
        </div></div></div>
        <div className="col-lg-7"><div className="card h-100 border-primary shadow"><div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-start"><h2 className="h4">{t("Premium")}</h2><span className="badge text-bg-primary">{t("Toutes les fonctionnalités")}</span></div>
          <p className="small text-muted">{t("Absolument toutes les fonctionnalités de l'application, présentes et futures, valables 12 mois à compter de la souscription.")}</p>
          <label className="form-label fw-semibold" htmlFor="t-effectif">{t("Nombre d'élèves de votre établissement")}</label>
          <input id="t-effectif" type="range" className="form-range" min={0} max={3000} step={10} value={Math.min(n, 3000)} onChange={(x) => setEffectif(x.target.value)} />
          <div className="d-flex align-items-center gap-2 mb-3">
            <input type="number" className="form-control" style={{ maxWidth: 140 }} min={1} max={e.capacite_max} value={effectif} onChange={(x) => setEffectif(x.target.value)} aria-label={t("Nombre d'élèves")} />
            <span>{t("élèves")}</span>
          </div>
          <div className="bg-body-tertiary rounded p-3 mb-3">
            <div className="small text-muted">{t("Montant annuel")}</div>
            <div className="display-6 fw-bold">{fcfa(montant)}</div>
            <div className="small text-muted">{n <= e.capacite_minimum
              ? t("Minimum annuel : couvre jusqu'à {v0} élèves.", { v0: e.capacite_minimum })
              : t("{v0} élèves × {v1}", { v0: n, v1: fcfa(e.prix_eleve) })}</div>
          </div>
          <ul className="small ps-3">
            <li>{t("Capacité ajustable en cours d'année : vous ne payez que la différence, l'échéance est conservée.")}</li>
            <li>{t("Renouvellement avec la capacité de votre choix, sans perdre de jours.")}</li>
            <li>{t("Paiement mobile money ou carte, reçu par e-mail.")}</li>
          </ul>
          <Link className="btn btn-primary w-100" to="/inscription">{t("Créer l'espace de mon établissement")}</Link>
        </div></div></div>
      </div>
      <p className="text-center"><Link to="/tarifs/smarteval">{t("Vous êtes enseignant sans établissement abonné ? Découvrez SmartEval pour les enseignants →")}</Link></p>
    </Cadre>
  )
}

export function TarifsSmartEval() {
  const [o, erreur] = useOffres()
  if (!o) return <Cadre><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</Cadre>
  const s = o.smarteval
  const carte = (titre, prix, points, lien, libelle, mise = false) => (
    <div className="col-md-6 col-lg-3"><div className={`card h-100 ${mise ? "border-primary shadow" : ""}`}><div className="card-body d-flex flex-column">
      <h2 className="h5">{titre}</h2><div className="fs-4 fw-bold mb-2">{prix}</div>
      <ul className="small ps-3 flex-grow-1">{points.map((p) => <li key={p}>{p}</li>)}</ul>
      <Link className={`btn ${mise ? "btn-primary" : "btn-outline-primary"}`} to={lien}>{libelle}</Link>
    </div></div></div>)
  return (
    <Cadre>
      <h1 className="display-6 fw-bold text-center mb-2">{t("SmartEval : évaluations en ligne pour les enseignants")}</h1>
      <p className="lead text-center text-muted mb-5">{t("Créez vos évaluations digitalisées, partagez un lien, obtenez la correction automatique et l'analyse par votre propre IA — sans établissement abonné.")}</p>
      <div className="row g-4 mb-4">
        {carte(t("Découverte"), t("Gratuit"), [t("{v0} évaluation publiée", { v0: s.decouverte.evaluations }), t("{v0} réponses d'élèves", { v0: s.decouverte.soumissions }),
          t("Valable {v0} jours", { v0: s.decouverte.duree_jours }), t("Une seule fois par adresse e-mail")], "/smarteval/inscription", t("Essayer gratuitement"))}
        {carte(t("SmartEval Enseignant"), `${fcfa(s.prix_annuel)} / ${t("an")}`, [t("{v0} évaluations publiées", { v0: s.credits }),
          t("{v0} réponses par évaluation", { v0: s.soumissions_max }), t("Connexion à votre IA (MCP), anonymisation"), t("Valable 12 mois à compter de la souscription")],
          "/smarteval/inscription", t("Souscrire"), true)}
        {s.pack && carte(t("Pack de crédits"), fcfa(s.pack.prix), [t("{v0} évaluations supplémentaires", { v0: s.pack.credits }), t("Pour les abonnés SmartEval Enseignant")],
          "/smarteval/connexion", t("Acheter un pack"))}
        {s.groupe && carte(t("SmartEval Groupe"), `${fcfa(s.groupe.prix_annuel)} / ${t("an")}`, [t("Jusqu'à {v0} enseignants d'un même département", { v0: s.groupe.membres_max }),
          t("{v0} évaluations publiées par enseignant", { v0: s.groupe.credits_membre }), t("Une matière ou discipline, choisie à la souscription"), t("Code de groupe et codes personnels")],
          "/smarteval/inscription", t("Souscrire pour mon département"))}
      </div>
      <div className="card mb-4"><div className="card-body small">
        <h2 className="h6">{t("Comment fonctionnent les crédits ?")}</h2>
        <ul className="mb-0 ps-3">
          <li>{t("1 crédit = 1 évaluation publiée (lien généré). Brouillons et modifications sont gratuits.")}</li>
          <li>{t("Supprimer une évaluation publiée ne restitue pas son crédit ; publier une copie utilise un crédit.")}</li>
          <li>{t("Les crédits non utilisés ne sont pas reportés sur la période suivante.")}</li>
          <li>{t("L'analyse par IA se fait avec votre propre assistant (Claude, ChatGPT, Grok…) : NexIA ne vous facture aucun coût d'IA.")}</li>
        </ul>
      </div></div>
      <p className="text-center"><Link to="/tarifs">{t("Votre établissement souhaite s'abonner ? Voir les tarifs des établissements →")}</Link></p>
    </Cadre>
  )
}
