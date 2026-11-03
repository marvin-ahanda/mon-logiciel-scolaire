import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { appreciation } from "../lib/calculs.js"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { date, nomComplet, note } from "../lib/format.js"
import { adressesPhotos } from "../lib/photos.js"
import { useSession } from "../Session.jsx"

function Bulletin({ r, donnees, periode, stats, etablissement, exercice, photo }) {
  const e = r.eleve
  return (
    <section className="bulletin card mb-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
          <div><div className="fw-bold">{etablissement.nom}</div>
            <div className="small">{[etablissement.adresse, etablissement.ville, etablissement.telephone].filter(Boolean).join(" · ")}</div>
            {etablissement.devise && <div className="small fst-italic">{etablissement.devise}</div>}</div>
          <div className="text-end small">Année scolaire {exercice.libelle}<br /><strong>Bulletin — {periode.libelle}</strong></div>
        </div>
        <div className="d-flex gap-3 align-items-center border rounded p-2 mb-2">
          {photo ? <img src={photo} alt="" className="photo-bulletin" /> : <div className="photo-bulletin vide" />}
          <div className="small flex-grow-1 row g-1">
            <div className="col-sm-6"><strong>{nomComplet(e)}</strong></div><div className="col-sm-6">Matricule : {e.matricule}</div>
            <div className="col-sm-6">Né(e) le {date(e.date_naissance)}{e.lieu_naissance && ` à ${e.lieu_naissance}`}</div>
            <div className="col-sm-6">Classe : {donnees.classe.libelle} · Effectif : {stats.effectif}</div>
          </div>
        </div>
        <table className="table table-sm table-bordered mb-2 tableau-bulletin">
          <thead><tr><th>Matière</th><th>Enseignant</th><th className="text-end">Note</th><th className="text-end">Coef.</th>
            <th className="text-end">Points</th><th className="text-end">Rang</th><th>Appréciation</th></tr></thead>
          <tbody>{r.groupes.map((g) => [
            ...g.lignes.map((l) => (
              <tr key={l.attributionId}><td>{l.matiere}</td><td className="small">{l.enseignant}</td>
                <td className="text-end">{note(l.note)}</td><td className="text-end">{l.coefficient}</td><td className="text-end">{note(l.points)}</td>
                <td className="text-end">{l.rang ? `${l.rang}${l.exAequo ? " ex" : ""}` : ""}</td><td>{appreciation(l.note)}</td></tr>)),
            r.groupes.length > 1 && <tr key={`g${g.groupe}`} className="table-light small"><td colSpan={3}>Groupe {g.groupe}</td><td className="text-end">{g.totalCoef}</td>
              <td className="text-end">{note(g.totalPoints)}</td><td colSpan={2}>Moyenne : {note(g.moyenne) || "—"}</td></tr>,
          ])}</tbody>
          <tfoot><tr className="fw-semibold"><td colSpan={3}>Total</td><td className="text-end">{r.totalCoef}</td><td className="text-end">{note(r.totalPoints)}</td><td colSpan={2} /></tr></tfoot>
        </table>
        <div className="row g-2 small">
          <div className="col-sm-4 border rounded p-2"><div>Moyenne : <strong className="fs-6">{r.moyenne !== null ? note(r.moyenne) : r.moyenneNonClassee !== null ? `${note(r.moyenneNonClassee)} (NC)` : "NC"}</strong></div>
            <div>Rang : <strong>{r.rang ? `${r.rang}${r.exAequo ? " ex" : ""} / ${stats.classes}` : "non classé"}</strong></div>
            <div>Appréciation : <strong>{r.appreciation || "—"}</strong></div></div>
          <div className="col-sm-4 border rounded p-2"><div>Moyenne de la classe : {note(stats.moyenneClasse) || "—"}</div>
            <div>Plus forte : {note(stats.max) || "—"} · Plus faible : {note(stats.min) || "—"}</div>
            <div>Taux de réussite : {stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`}</div></div>
          <div className="col-sm-4 border rounded p-2 signature">Le chef d'établissement<br /><span className="text-muted">{etablissement.nom_chef}</span></div>
        </div>
      </div>
    </section>
  )
}

function Bulletins({ classe, periode }) {
  const { exercice, etablissement } = useSession()
  const [donnees, erreur] = useDonnees(async () => {
    const d = await chargerClasse(classe, exercice)
    return { ...d, photos: await adressesPhotos(d.eleves.map((x) => x.eleve.photo)) }
  }, [classe.id])
  if (!donnees) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const { resultats, stats } = resultatsPeriode(donnees, periode)
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 no-print">
        <span>{resultats.length} bulletin(s) — {classe.libelle}, {periode.libelle}</span>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Imprimer les bulletins</button>
      </div>
      {resultats.map((r) => <Bulletin key={r.inscriptionId} r={r} donnees={donnees} periode={periode} stats={stats}
                                      etablissement={etablissement} exercice={exercice} photo={donnees.photos[r.eleve.photo]} />)}
      {!resultats.length && <p className="text-muted">Aucun élève inscrit.</p>}
    </>
  )
}

export default function PageBulletins() {
  return (<><h1 className="h3 mb-3 no-print">Bulletins</h1>
    <ChoixClassePeriode>{(classe, periode) => <Bulletins key={classe.id + periode.code} classe={classe} periode={periode} />}</ChoixClassePeriode></>)
}
