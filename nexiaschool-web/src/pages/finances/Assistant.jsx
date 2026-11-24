// Assistant IA Finance : l'IA de l'utilisateur (Claude, ChatGPT…) se connecte au serveur MCP de NexIA School et interroge
// les données financières RÉELLES, en lecture seule et dans la limite des droits de la personne. NexIA n'héberge aucun
// modèle d'IA : cette page explique la connexion, propose des questions et montre l'historique des consultations.
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { URL_MCP } from "../../lib/retour.js"
import { useSession } from "../../Session.jsx"
import { supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { EnTete, useDroits } from "./commun.jsx"

const QUESTIONS = [
  ["Encaissements", ["Combien avons-nous réellement encaissé depuis le début de l'année scolaire 2026-2027 ?", "Quelle est la répartition des paiements entre espèces, banque et Mobile Money ce mois-ci ?",
    "Quelle classe a le meilleur taux de recouvrement ?"]],
  ["Impayés", ["Combien d'élèves ne sont pas en règle et pour quel montant ?", "Quels élèves ont les créances les plus anciennes ?", "Quel est le total des impayés de la Terminale A ?"]],
  ["Dépenses", ["Combien avons-nous dépensé depuis le début du trimestre, et dans quelles catégories ?", "Quelles dépenses attendent une validation ?"]],
  ["Trésorerie", ["Quel est le solde disponible en caisse et sur l'ensemble des comptes ?", "Avons-nous des écarts de caisse non justifiés ?"]],
  ["Paie (droit « paie » requis)", ["Quelle est la masse salariale du mois ?", "Quels salaires restent à payer ?"]],
  ["Analyse", ["Quels sont nos principaux points de vigilance financière ce mois-ci ?", "Comment évolue notre solde mensuel recettes / dépenses ?"]],
]

export default function Assistant() {
  const { profil } = useSession(), droits = useDroits()
  const [journal, erreur] = useDonnees(() => supabase.from("journal_api").select("id, personnel_id, source, outil, details, cree_le").like("outil", "finance%")
    .order("cree_le", { ascending: false }).limit(40).then(verifier), [])
  return (
    <>
      <EnTete titre={t("Assistant IA Finance")} sousTitre={t("Votre IA interroge les données financières réelles de NexIA School, en lecture seule, selon vos droits.")} />
      <div className="row g-3">
        <div className="col-lg-7">
          <section className="card mb-3"><div className="card-body">
            <h2 className="h6">{t("Comment ça marche")}</h2>
            <ol className="small mb-2">
              <li>{t("Activez la connexion IA de votre compte et créez une clé (ou connectez votre application) dans la rubrique « IA et API ».")} <Link to="/developpeur">{t("Ouvrir « IA et API »")}</Link></li>
              <li>{t("Ajoutez le serveur NexIA School à votre IA (Claude, ChatGPT ou tout client compatible MCP) avec cette adresse :")} <code className="user-select-all">{URL_MCP}</code></li>
              <li>{t("Posez vos questions en langage naturel : l'IA appelle les outils finance_* et répond à partir des chiffres calculés par NexIA.")}</li>
            </ol>
            <div className="alert alert-info small mb-0">
              <strong>{t("Garanties")}</strong> — {t("lecture seule (aucun encaissement, annulation, validation, virement ou modification de paie par l'IA) ; droits vérifiés par le serveur à chaque question ; données de votre seul établissement ; paie réservée au droit « paie » ; chaque consultation est journalisée sans montant ni nom d'élève. NexIA School n'héberge aucun modèle d'IA : c'est votre propre assistant qui se connecte.")}</div>
          </div></section>
          <section className="card"><div className="card-body">
            <h2 className="h6">{t("Exemples de questions")}</h2>
            {QUESTIONS.map(([theme, qs]) => (
              <div key={theme} className="mb-2"><div className="small fw-semibold text-muted">{t(theme)}</div>
                <ul className="small mb-0">{qs.map((q) => <li key={q}>« {t(q)} »</li>)}</ul></div>))}
            {!droits.a("paie") && <p className="small text-muted mb-0">{t("Vous n'avez pas le droit « paie » : l'assistant refusera les questions sur les salaires.")}</p>}
          </div></section>
        </div>
        <div className="col-lg-5"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Historique des consultations financières")}</h2>
          <p className="small text-muted">{t("Les vôtres (et celles de tout l'établissement pour l'administration) : outil, période, statut — jamais de montant ni de nom.")}</p>
          <Alerte>{erreur}</Alerte>
          {!journal && !erreur && <Chargement />}
          {journal && <ul className="list-group list-group-flush small">{journal.map((j) => (
            <li key={j.id} className="list-group-item px-0">
              <div className="d-flex justify-content-between"><code>{j.outil}</code><span className="text-muted">{new Date(j.cree_le).toLocaleString()}</span></div>
              <div className="text-muted">{j.details?.type ? `${j.details.type} · ` : ""}{j.details?.debut && `${j.details.debut} → ${j.details.fin}`} · {j.source}
                {j.personnel_id !== profil?.id && ` · ${t("autre utilisateur")}`}</div>
              {j.details?.statut && j.details.statut !== "ok" && <span className={`badge ${j.details.statut === "refuse" ? "text-bg-danger" : "text-bg-warning"}`}>
                {j.details.statut === "refuse" ? t("refusé") : t("erreur")}</span>}{j.details?.erreur && <span className="ms-1">{j.details.erreur}</span>}
            </li>))}
            {!journal.length && <li className="list-group-item px-0 text-muted">{t("Aucune consultation pour l'instant.")}</li>}</ul>}
        </div></section></div>
      </div>
    </>
  )
}
