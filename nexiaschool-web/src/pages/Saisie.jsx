import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, lireNote, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"

export default function Saisie() {
  const { exercice, estAdmin, profil } = useSession()
  const [attributionId, setAttributionId] = useState(""), [sequenceId, setSequenceId] = useState("")
  const [valeurs, setValeurs] = useState({}), [erreurs, setErreurs] = useState({})
  const [message, setMessage] = useState({}), [envoi, setEnvoi] = useState(false)

  const [ref, erreurRef] = useDonnees(async () => {
    if (!exercice) return null
    let q = supabase.from("attributions").select("id, coefficient, classe_id, enseignant_id, classes(libelle, ordre), matieres(libelle)").eq("exercice_id", exercice.id)
    if (!estAdmin) q = q.eq("enseignant_id", profil.id)
    const attributions = verifier(await q).sort((a, b) => a.classes.ordre - b.classes.ordre || comparerNoms(a.classes.libelle, b.classes.libelle) || comparerNoms(a.matieres.libelle, b.matieres.libelle))
    const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero"))
    return { attributions, sequences }
  }, [exercice?.id])

  const attribution = ref?.attributions.find((a) => a.id === attributionId)
  const sequence = ref?.sequences.find((s) => s.id === sequenceId)

  const [grille, erreurGrille, rafraichir] = useDonnees(async () => {
    if (!attribution || !sequence) return null
    const inscriptions = await toutCharger(() => supabase.from("inscriptions").select("id, eleves(nom, prenom, matricule)").eq("classe_id", attribution.classe_id).eq("exercice_id", exercice.id))
    const notes = await toutCharger(() => supabase.from("notes").select("id, inscription_id, valeur").eq("attribution_id", attribution.id).eq("sequence_id", sequence.id))
    return { eleves: inscriptions.sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves))), notes: new Map(notes.map((n) => [n.inscription_id, n])) }
  }, [attributionId, sequenceId])

  useEffect(() => {
    if (!grille) return
    setValeurs(Object.fromEntries(grille.eleves.map((i) => [i.id, grille.notes.has(i.id) ? note(Number(grille.notes.get(i.id).valeur)) : ""])))
    setErreurs({})
  }, [grille])

  const stats = useMemo(() => {
    const v = Object.values(valeurs).map((x) => { try { return lireNote(x) } catch { return null } }).filter((x) => x !== null)
    return { n: v.length, moyenne: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
  }, [valeurs])

  async function enregistrer(e) {
    e.preventDefault(); setMessage({})
    const lus = {}, err = {}
    for (const i of grille.eleves) { try { lus[i.id] = lireNote(valeurs[i.id]) } catch (x) { err[i.id] = x.message } }
    setErreurs(err)
    if (Object.keys(err).length) return setMessage({ erreur: "Corrigez les notes signalées : rien n'a été enregistré." })
    const aEcrire = [], aSupprimer = []
    for (const i of grille.eleves) {
      const avant = grille.notes.get(i.id), v = lus[i.id]
      if (v === null && avant) aSupprimer.push(avant.id)
      else if (v !== null && (!avant || Number(avant.valeur) !== v))
        aEcrire.push({ inscription_id: i.id, attribution_id: attribution.id, sequence_id: sequence.id, valeur: v })
    }
    setEnvoi(true)
    try {
      if (aEcrire.length) verifier(await supabase.from("notes").upsert(aEcrire, { onConflict: "inscription_id,attribution_id,sequence_id" }))
      if (aSupprimer.length) verifier(await supabase.from("notes").delete().in("id", aSupprimer))
      setMessage({ ok: `Notes enregistrées : ${aEcrire.length} ajoutée(s) ou modifiée(s), ${aSupprimer.length} supprimée(s).` })
      rafraichir()
    } catch (x) { setMessage({ erreur: x.message }) } finally { setEnvoi(false) }
  }

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!ref) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  return (
    <>
      <h1 className="h3 mb-3">Saisie des notes</h1>
      <div className="row g-2 mb-3" style={{ maxWidth: 800 }}>
        <div className="col-sm-8"><select className="form-select" value={attributionId} onChange={(e) => setAttributionId(e.target.value)} aria-label="Classe et matière">
          <option value="">Classe et matière…</option>
          {ref.attributions.map((a) => <option key={a.id} value={a.id}>{a.classes.libelle} — {a.matieres.libelle} (coef. {a.coefficient})</option>)}</select></div>
        <div className="col-sm-4"><select className="form-select" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label="Séquence">
          <option value="">Séquence…</option>{ref.sequences.map((s) => <option key={s.id} value={s.id}>Séquence {s.numero}{s.verrouillee ? " (verrouillée)" : ""}</option>)}</select></div>
      </div>
      {!ref.attributions.length && <p className="text-muted">{estAdmin ? "Aucune matière attribuée : voir Paramètres → Matières par classe." : "Aucune matière ne vous est attribuée pour cet exercice."}</p>}
      <Alerte>{message.erreur || erreurGrille}</Alerte><Alerte type="success">{message.ok}</Alerte>
      {attribution && sequence && !grille && <Chargement />}
      {grille && (
        <form onSubmit={enregistrer} style={{ maxWidth: 800 }}>
          {sequence.verrouillee && <div className="alert alert-secondary">Séquence verrouillée : consultation seulement.</div>}
          <div className="card mb-3"><div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>#</th><th>Élève</th><th>Matricule</th><th style={{ width: 140 }}>Note /20</th></tr></thead>
            <tbody>{grille.eleves.map((i, k) => (
              <tr key={i.id}><td>{k + 1}</td><td>{nomComplet(i.eleves)}</td><td className="small text-muted">{i.eleves.matricule}</td>
                <td><input className={`form-control form-control-sm text-end ${erreurs[i.id] ? "is-invalid" : ""}`} inputMode="decimal" disabled={sequence.verrouillee}
                           value={valeurs[i.id] ?? ""} onChange={(e) => setValeurs({ ...valeurs, [i.id]: e.target.value })} aria-label={`Note de ${nomComplet(i.eleves)}`} />
                  {erreurs[i.id] && <div className="invalid-feedback">{erreurs[i.id]}</div>}</td></tr>))}
              {!grille.eleves.length && <tr><td colSpan={4} className="text-center text-muted py-3">Aucun élève inscrit dans cette classe.</td></tr>}</tbody>
          </table></div></div>
          <div className="d-flex flex-wrap align-items-center gap-3">
            {!sequence.verrouillee && <button className="btn btn-primary" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer les notes"}</button>}
            <span className="small text-muted">{stats.n} note(s) · moyenne {stats.moyenne === null ? "—" : note(stats.moyenne)} · virgule ou point acceptés ; case vide = pas de note</span>
          </div>
        </form>
      )}
    </>
  )
}
