import { useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, date, nomComplet } from "../lib/format.js"
import { adressesPhotos, envoyerPhoto } from "../lib/photos.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"

const VIDE = { matricule: "", nom: "", prenom: "", sexe: "F", date_naissance: "", lieu_naissance: "", telephone_parent: "", classe_id: "", redoublant: false, nouveau: true }

export default function Eleves() {
  const { exercice, etablissement } = useSession()
  const [filtre, setFiltre] = useState(""), [recherche, setRecherche] = useState("")
  const [edition, setEdition] = useState(null), [photo, setPhoto] = useState(null)
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)

  const [donnees, erreurChargement, rafraichir] = useDonnees(async () => {
    const classes = verifier(await supabase.from("classes").select("id, libelle").order("ordre").order("libelle"))
    const eleves = await toutCharger(() => supabase.from("eleves").select("*").order("nom"))
    const inscriptions = exercice ? await toutCharger(() => supabase.from("inscriptions").select("*").eq("exercice_id", exercice.id)) : []
    return { classes, eleves, inscriptions, photos: await adressesPhotos(eleves.map((e) => e.photo)) }
  }, [exercice?.id])

  const lignes = useMemo(() => {
    if (!donnees) return []
    const parEleve = new Map(donnees.inscriptions.map((i) => [i.eleve_id, i]))
    const classe = new Map(donnees.classes.map((c) => [c.id, c.libelle]))
    const r = recherche.trim().toLowerCase()
    return donnees.eleves.map((e) => ({ ...e, inscription: parEleve.get(e.id), classe: classe.get(parEleve.get(e.id)?.classe_id) || "" }))
      .filter((e) => (filtre === "" || (filtre === "-" ? !e.inscription : e.inscription?.classe_id === filtre))
        && (!r || `${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(r)))
      .sort((a, b) => comparerNoms(a.classe, b.classe) || comparerNoms(nomComplet(a), nomComplet(b)))
  }, [donnees, filtre, recherche])

  function ouvrir(e) {
    setErreur(""); setPhoto(null)
    setEdition(e ? { ...VIDE, ...e, date_naissance: e.date_naissance || "", classe_id: e.inscription?.classe_id || "", redoublant: !!e.inscription?.redoublant, nouveau: e.inscription ? e.inscription.nouveau !== false : true }
                 : { ...VIDE, classe_id: filtre && filtre !== "-" ? filtre : "" })
  }
  const champ = (k) => ({ value: edition[k] ?? "", onChange: (ev) => setEdition({ ...edition, [k]: ev.target.value }) })

  async function enregistrer(ev) {
    ev.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const valeurs = { matricule: edition.matricule.trim(), nom: edition.nom.trim().toUpperCase(), prenom: edition.prenom.trim(), sexe: edition.sexe,
        date_naissance: edition.date_naissance || null, lieu_naissance: edition.lieu_naissance.trim(), telephone_parent: edition.telephone_parent.trim() }
      const eleve = edition.id
        ? verifier(await supabase.from("eleves").update(valeurs).eq("id", edition.id).select().single())
        : verifier(await supabase.from("eleves").insert(valeurs).select().single())
      if (exercice) {
        const actuelle = edition.inscription
        if (edition.classe_id && actuelle) {
          verifier(await supabase.from("inscriptions").update({ classe_id: edition.classe_id, redoublant: edition.redoublant, nouveau: edition.nouveau }).eq("id", actuelle.id))
        } else if (edition.classe_id) {
          verifier(await supabase.from("inscriptions").insert({ exercice_id: exercice.id, eleve_id: eleve.id, classe_id: edition.classe_id, redoublant: edition.redoublant, nouveau: edition.nouveau }))
        } else if (actuelle) {
          verifier(await supabase.from("inscriptions").delete().eq("id", actuelle.id))
        }
      }
      if (photo) {
        const chemin = await envoyerPhoto(etablissement.id, eleve.id, photo)
        verifier(await supabase.from("eleves").update({ photo: chemin }).eq("id", eleve.id))
      }
      setEdition(null); rafraichir()
    } catch (err) { setErreur(err.message) } finally { setEnvoi(false) }
  }

  async function supprimer(e) {
    if (!confirm(`Supprimer définitivement ${nomComplet(e)} et toutes ses notes ?`)) return
    try {
      if (e.photo) await supabase.storage.from("photos").remove([e.photo])
      verifier(await supabase.from("eleves").delete().eq("id", e.id)); rafraichir()
    } catch (err) { setErreur(err.message) }
  }

  if (!donnees) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h3 m-0">Élèves</h1>
        {!edition && <button className="btn btn-primary" onClick={() => ouvrir(null)}>+ Nouvel élève</button>}
      </div>
      <Alerte>{erreur}</Alerte>
      {!exercice && <div className="alert alert-warning">Aucun exercice actif : les élèves ne peuvent pas être inscrits dans une classe.</div>}
      {edition && (
        <form className="card card-body mb-3" onSubmit={enregistrer} style={{ maxWidth: 900 }}>
          <h2 className="h6">{edition.id ? `Modifier ${nomComplet(edition)}` : "Nouvel élève"}</h2>
          <div className="row g-2">
            <div className="col-md-3"><label className="form-label" htmlFor="em">Matricule</label><input className="form-control" id="em" required maxLength={30} {...champ("matricule")} /></div>
            <div className="col-md-5"><label className="form-label" htmlFor="en">Nom</label><input className="form-control" id="en" required maxLength={100} {...champ("nom")} /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="ep">Prénom</label><input className="form-control" id="ep" maxLength={100} {...champ("prenom")} /></div>
            <div className="col-md-2"><label className="form-label" htmlFor="es">Sexe</label>
              <select className="form-select" id="es" {...champ("sexe")}><option value="F">Fille</option><option value="M">Garçon</option></select></div>
            <div className="col-md-3"><label className="form-label" htmlFor="ed">Date de naissance</label><input className="form-control" id="ed" type="date" {...champ("date_naissance")} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="el">Lieu de naissance</label><input className="form-control" id="el" maxLength={100} {...champ("lieu_naissance")} /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="et">Téléphone du parent</label><input className="form-control" id="et" maxLength={30} {...champ("telephone_parent")} /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="ec">Classe ({exercice?.libelle || "aucun exercice"})</label>
              <select className="form-select" id="ec" disabled={!exercice} {...champ("classe_id")}><option value="">Non inscrit</option>
                {donnees.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
            <div className="col-md-3 d-flex align-items-end"><div className="form-check"><input className="form-check-input" type="checkbox" id="er"
              checked={edition.redoublant} onChange={(e) => setEdition({ ...edition, redoublant: e.target.checked })} /><label className="form-check-label" htmlFor="er">Redoublant</label></div>
              <div className="form-check ms-3"><input className="form-check-input" type="checkbox" id="enouv" checked={edition.nouveau}
                onChange={(e) => setEdition({ ...edition, nouveau: e.target.checked })} /><label className="form-check-label" htmlFor="enouv"
                title="Détermine la pension applicable (nouveaux ou anciens élèves)">Nouvel élève</label></div></div>
            <div className="col-md-5"><label className="form-label" htmlFor="eph">Photo {edition.photo && "(remplace l'actuelle)"}</label>
              <input className="form-control" id="eph" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} />
              <div className="form-text">Réduite automatiquement à 400 px. Données personnelles d'un mineur : accès réservé au personnel.</div></div>
          </div>
          <div className="d-flex gap-2 mt-3"><button className="btn btn-primary" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEdition(null)}>Annuler</button></div>
        </form>
      )}
      <div className="d-flex flex-wrap gap-2 mb-2">
        <select className="form-select" style={{ maxWidth: 260 }} value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtrer par classe">
          <option value="">Toutes les classes</option>{donnees.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          <option value="-">Non inscrits</option></select>
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Rechercher (nom, matricule)" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher" />
        <span className="align-self-center small text-muted">{lignes.length} élève(s)</span>
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-hover align-middle mb-0">
        <thead className="table-light"><tr><th /><th>Matricule</th><th>Nom</th><th>Sexe</th><th>Naissance</th><th>Classe</th><th /></tr></thead>
        <tbody>{lignes.map((e) => (
          <tr key={e.id}><td style={{ width: 48 }}>{donnees.photos[e.photo] ? <img src={donnees.photos[e.photo]} alt="" className="vignette" /> : <span className="vignette vide" />}</td>
            <td>{e.matricule}</td><td>{nomComplet(e)}</td><td>{e.sexe}</td><td>{date(e.date_naissance)}</td>
            <td>{e.classe || <span className="text-muted">—</span>}{e.inscription?.redoublant && <span className="badge text-bg-light ms-1">R</span>}</td>
            <td className="text-end text-nowrap"><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => ouvrir(e)}>Modifier</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => supprimer(e)}>Supprimer</button></td></tr>))}
          {!lignes.length && <tr><td colSpan={7} className="text-center text-muted py-4">Aucun élève.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}
