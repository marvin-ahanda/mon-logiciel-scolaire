import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { useSession } from "../Session.jsx"
import { supabase } from "../supabase.js"

async function compter(table, filtre) {
  let q = supabase.from(table).select("id", { count: "exact", head: true })
  if (filtre) q = filtre(q)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count
}

export default function Accueil() {
  const { etablissement, exercice, estAdmin, profil, peutNoter, peutDiscipline, peutFinance } = useSession()
  const [chiffres, erreur] = useDonnees(async () => ({
    eleves: exercice ? await compter("inscriptions", (q) => q.eq("exercice_id", exercice.id)) : 0,
    classes: await compter("classes"),
    personnel: await compter("personnels", (q) => q.eq("actif", true)),
    mesMatieres: exercice ? await compter("attributions", (q) => q.eq("exercice_id", exercice.id).eq("enseignant_id", profil.id)) : 0,
  }), [exercice?.id])

  return (
    <>
      <h1 className="h3 mb-3">{etablissement?.nom}</h1>
      <Alerte>{erreur}</Alerte>
      {!exercice && (
        <div className="alert alert-warning">Aucun exercice (année scolaire) actif.{" "}
          {estAdmin ? <Link to="/parametres/exercices">Créez et activez l'exercice en cours</Link> : "L'administration doit en activer un."}</div>
      )}
      {!chiffres ? <Chargement /> : (
        <div className="row g-3 mb-4">
          {[["Élèves inscrits", chiffres.eleves], ["Classes", chiffres.classes], ["Personnel actif", chiffres.personnel],
            ...(peutNoter ? [["Mes matières", chiffres.mesMatieres]] : [])].map(([lib, v]) => (
            <div className="col-6 col-md-3" key={lib}><div className="card"><div className="card-body">
              <div className="small text-muted">{lib}</div><div className="fs-4 fw-semibold">{v}</div></div></div></div>
          ))}
        </div>
      )}
      <div className="list-group" style={{ maxWidth: 640 }}>
        {peutNoter && <Link className="list-group-item list-group-item-action" to="/notes/saisie">Saisir des notes</Link>}
        {peutNoter && <Link className="list-group-item list-group-item-action" to="/notes/resultats">Consulter les résultats et classements</Link>}
        {peutNoter && <Link className="list-group-item list-group-item-action" to="/notes/bulletins">Imprimer les bulletins</Link>}
        {peutFinance && <Link className="list-group-item list-group-item-action" to="/finance">Finances : encaissements et situation des élèves</Link>}
        {peutFinance && <Link className="list-group-item list-group-item-action" to="/finance/insolvables">Élèves non en règle (frais de scolarité)</Link>}
        {peutFinance && <Link className="list-group-item list-group-item-action" to="/finance/frais">Frais de scolarité et délais de paiement</Link>}
        {peutDiscipline && <Link className="list-group-item list-group-item-action" to="/discipline/appel">Faire l'appel du jour (absences, retards)</Link>}
        {peutDiscipline && <Link className="list-group-item list-group-item-action" to="/discipline/suivi">Suivi disciplinaire</Link>}
        {peutNoter && <Link className="list-group-item list-group-item-action" to="/excel">Import et export Excel</Link>}
        {estAdmin && <Link className="list-group-item list-group-item-action" to="/statistiques">Statistiques avancées</Link>}
        {estAdmin && <Link className="list-group-item list-group-item-action" to="/eleves">Gérer les élèves</Link>}
        {estAdmin && <Link className="list-group-item list-group-item-action" to="/parametres">Paramètres : exercices, classes, matières, coefficients</Link>}
        {estAdmin && <Link className="list-group-item list-group-item-action" to="/personnel">Personnel et codes d'accès</Link>}
      </div>
      {estAdmin && (
        <div className="card mt-4" style={{ maxWidth: 640 }}><div className="card-body small">
          <strong>Mise en route :</strong> 1. Paramètres → Exercice (créer et activer l'année scolaire) · 2. Classes · 3. Matières ·
          4. Personnel (enseignants, surveillant général, comptable) · 5. Matières par classe (coefficients, enseignant) · 6. Élèves (ou import Excel) ·
          7. Paramètres → Discipline (sanctions, infractions, barème) · 8. Saisie des notes et appel du jour.
        </div></div>
      )}
    </>
  )
}
