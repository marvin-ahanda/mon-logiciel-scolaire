import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { useSession } from "../Session.jsx"
import { supabase } from "../supabase.js"
import { t } from "../i18n.jsx"
import { Cadenas, demanderOffre } from "../composants/Offre.jsx"
import { fonctionDuChemin } from "../lib/offres.js"

async function compter(table, filtre) {
  let q = supabase.from(table).select("id", { count: "exact", head: true })
  if (filtre) q = filtre(q)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count
}

export default function Accueil() {
  const { etablissement, exercice, estAdmin, profil, peutNoter, peutExcel, peutBulletins, peutDiscipline, peutFinance, aOffre } = useSession()
  // raccourci vers une rubrique : hors offre, il reste visible (flouté, cadenas) et ouvre l'invitation à changer d'offre
  const raccourci = (to, libelle) => {
    const f = fonctionDuChemin(to)
    if (f && !aOffre(f)) return <button type="button" key={to} className="list-group-item list-group-item-action hors-offre" onClick={() => demanderOffre(f)}>
      <span className="flou-offre">{libelle}</span> <Cadenas /></button>
    return <Link key={to} className="list-group-item list-group-item-action" to={to}>{libelle}</Link>
  }
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
        <div className="alert alert-warning">{t("Aucun exercice (année scolaire) actif.")}{" "}
          {estAdmin ? <Link to="/parametres/exercices">{t("Créez et activez l'exercice en cours")}</Link> : t("L'administration doit en activer un.")}</div>
      )}
      {!chiffres ? <Chargement /> : (
        <div className="row g-3 mb-4">
          {[[t("Élèves inscrits"), chiffres.eleves], [t("Classes"), chiffres.classes], [t("Personnel actif"), chiffres.personnel],
            ...(peutNoter ? [[t("Mes matières"), chiffres.mesMatieres]] : [])].map(([lib, v]) => (
            <div className="col-6 col-md-3" key={lib}><div className="card"><div className="card-body">
              <div className="small text-muted">{lib}</div><div className="fs-4 fw-semibold">{v}</div></div></div></div>
          ))}
        </div>
      )}
      <div className="list-group" style={{ maxWidth: 640 }}>
        {peutNoter && raccourci("/notes/saisie", t("Saisir des notes"))}
        {peutNoter && raccourci("/notes/resultats", t("Consulter les résultats et classements"))}
        {peutBulletins && raccourci("/notes/bulletins", t("Imprimer les bulletins"))}
        {peutFinance && raccourci("/finance", t("Finances : encaissements et situation des élèves"))}
        {peutFinance && raccourci("/finance/insolvables", t("Élèves non en règle (frais de scolarité)"))}
        {peutFinance && raccourci("/finance/frais", t("Frais de scolarité et délais de paiement"))}
        {peutDiscipline && raccourci("/discipline/appel", t("Faire l'appel du jour (absences, retards)"))}
        {peutDiscipline && raccourci("/discipline/suivi", t("Suivi disciplinaire"))}
        {peutExcel && raccourci("/excel", t("Import et export Excel"))}
        {estAdmin && raccourci("/statistiques", t("Statistiques avancées"))}
        {estAdmin && raccourci("/eleves", t("Gérer les élèves"))}
        {estAdmin && raccourci("/parametres", t("Paramètres : exercices, classes, matières, coefficients"))}
        {estAdmin && raccourci("/personnel", t("Personnel et codes d'accès"))}
      </div>
      {estAdmin && (
        <div className="card mt-4" style={{ maxWidth: 640 }}><div className="card-body small">
          <strong>{t("Mise en route :")}</strong>{t(
          " 1. Paramètres → Exercice (créer et activer l'année scolaire) · 2. Classes · 3. Matières · 4. Personnel (enseignants, surveillant général, comptable) · 5. Matières par classe (coefficients, enseignant) · 6. Élèves (ou import Excel) · 7. Paramètres → Discipline (sanctions, infractions, barème) · 8. Saisie des notes et appel du jour."
        )}</div></div>
      )}
    </>
  );
}
