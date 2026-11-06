import { useEffect } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { date } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/** Enseignants qui n'ont pas terminé la saisie des notes alors que le délai de la séquence est passé (administration). */
export default function RetardsNotes() {
  const { exercice } = useSession()
  const [d, erreur] = useDonnees(async () => (exercice ? rpc("notes_retards") : null), [exercice?.id])

  useEffect(() => {
    if (d?.non_lues > 0) rpc("notes_marquer_alertes_lues").then(() => window.dispatchEvent(new Event("notes:maj"))).catch(() => {})
  }, [d])

  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}</div>
  if (!d) return <><Alerte>{erreur}</Alerte><Chargement /></>
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="h3 mb-0 me-auto">{t("Retards de saisie des notes")}</h1>
        {d.sequences.length > 0 && <button type="button" className="btn btn-outline-secondary no-print" onClick={() => window.print()}>{t("Imprimer")}</button>}
      </div>
      <p className="text-muted small no-print">{t("Les délais de saisie se règlent séquence par séquence dans ")}
        <Link to="/parametres/exercices">{t("Paramètres → Exercices")}</Link>.</p>
      {!d.sequences.length && <div className="alert alert-success">{t("Aucun retard : tous les enseignants sont à jour pour les séquences dont le délai est passé.")}</div>}
      {d.sequences.map((s) => (
        <div key={s.sequence_id} className={`card mb-3 fiche-retard ${!s.lue ? "border-warning" : ""}`}>
          <div className="card-header d-flex flex-wrap align-items-center gap-2">
            <strong>{t("Séquence {v0}", { v0: s.numero })}</strong>
            <span className="text-danger small">{t("délai du {v0} dépassé de {v1} jour(s)", { v0: date(s.date_limite), v1: s.jours_retard })}</span>
            {!s.lue && <span className="badge text-bg-warning ms-auto">{t("Nouvelle alerte")}</span>}
          </div>
          <div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>{t("Enseignant")}</th><th>{t("Téléphone")}</th><th>{t("Classes où des notes manquent")}</th>
              <th className="text-end">{t("Notes manquantes")}</th></tr></thead>
            <tbody>{s.enseignants.map((e) => (
              <tr key={e.enseignant_id}>
                <td className="fw-semibold">{e.nom} {e.prenom}{e.role === "admin" && <span className="badge text-bg-light border ms-1">{t("Administration")}</span>}</td>
                <td className="text-nowrap">{e.telephone || "—"}</td>
                <td><ul className="list-unstyled mb-0">{e.classes.map((c) => (
                  <li key={c.classe + c.code}><strong>{c.classe}</strong> — {c.matiere}{" "}
                    <span className="text-muted small">{t("({v0} note(s) saisie(s) sur {v1})", { v0: c.saisies, v1: c.effectif })}</span></li>))}</ul></td>
                <td className="text-end fw-semibold">{e.manquantes}</td>
              </tr>))}</tbody>
          </table></div>
          {s.sans_enseignant.length > 0 && (
            <div className="card-footer small">
              <strong>{t("Matières sans enseignant attribué")}</strong>{" : "}
              {s.sans_enseignant.map((c) => t("{v0} — {v1} ({v2}/{v3})", { v0: c.classe, v1: c.matiere, v2: c.saisies, v3: c.effectif })).join(" · ")}
            </div>)}
        </div>
      ))}
    </>
  )
}
