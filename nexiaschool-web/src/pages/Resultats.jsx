import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"

const rang = (r, ex) => (r ? `${r}${ex ? " ex" : ""}` : "—")

function Tableau({ classe, periode }) {
  const { exercice } = useSession()
  const [donnees, erreur] = useDonnees(() => chargerClasse(classe, exercice), [classe.id])
  if (!donnees) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const { resultats, stats } = resultatsPeriode(donnees, periode)
  const classement = [...resultats].sort((a, b) => (a.rang ?? 1e9) - (b.rang ?? 1e9))
  const tuile = (lib, v) => <div className="col-6 col-md-2"><div className="card"><div className="card-body py-2"><div className="small text-muted">{lib}</div><strong>{v}</strong></div></div></div>
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">{classe.libelle} — {periode.libelle} ({exercice.libelle})</h2>
        <button className="btn btn-outline-secondary btn-sm no-print" onClick={() => window.print()}>Imprimer</button>
      </div>
      <div className="row g-2 mb-3">
        {tuile("Effectif", `${stats.effectif} (${stats.classes} classés)`)}{tuile("Moyenne de classe", note(stats.moyenneClasse) || "—")}
        {tuile("Plus forte", note(stats.max) || "—")}{tuile("Plus faible", note(stats.min) || "—")}
        {tuile("Moyennes ≥ 10", stats.reussis)}{tuile("Taux de réussite", stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`)}
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-sm table-hover align-middle mb-0">
        <thead className="table-light"><tr><th>Rang</th><th>Élève</th>
          {donnees.attributions.map((a) => <th key={a.id} className="text-end small" title={`${a.matiere} (coef. ${a.coefficient})`}>{a.code}</th>)}
          <th className="text-end">Moyenne</th><th>Appréciation</th></tr></thead>
        <tbody>{classement.map((r) => (
          <tr key={r.inscriptionId}><td>{rang(r.rang, r.exAequo)}</td><td>{nomComplet(r.eleve)}</td>
            {r.lignes.map((l) => <td key={l.attributionId} className={`text-end ${l.note !== null && l.note < 10 ? "note-faible" : ""}`}>{note(l.note)}</td>)}
            <td className={`text-end fw-semibold ${r.moyenne !== null && r.moyenne < 10 ? "note-faible" : ""}`}>
              {r.moyenne !== null ? note(r.moyenne) : r.moyenneNonClassee !== null ? <span className="text-muted fw-normal" title="Total des coefficients évalués inférieur au seuil de la classe">{note(r.moyenneNonClassee)} NC</span> : "NC"}</td>
            <td>{r.appreciation}</td></tr>))}
          {!classement.length && <tr><td colSpan={99} className="text-center text-muted py-4">Aucun élève inscrit.</td></tr>}</tbody>
      </table></div></div>
      <p className="small text-muted mt-2">NC : non classé. Cases vides : matière non évaluée, exclue de la moyenne.
        {periode.type === "trimestre" && " Note du trimestre = moyenne des notes séquentielles du trimestre."}
        {periode.type === "annee" && " Note annuelle = moyenne des notes trimestrielles."}</p>
    </>
  )
}

export default function Resultats() {
  return (<><h1 className="h3 mb-3 no-print">Résultats</h1>
    <ChoixClassePeriode>{(classe, periode) => <Tableau key={classe.id + periode.code} classe={classe} periode={periode} />}</ChoixClassePeriode></>)
}
