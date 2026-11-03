import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { bilansPeriode, chargerDiscipline } from "../lib/donneesDiscipline.js"
import { comparerNoms, date, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"

const aujourdhui = () => new Date().toISOString().slice(0, 10)

/** Classes et séquences de l'exercice actif. */
function useReference() {
  const { exercice } = useSession()
  return useDonnees(async () => !exercice ? null : ({
    classes: verifier(await supabase.from("classes").select("*").order("ordre").order("libelle")),
    sequences: verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero")),
  }), [exercice?.id])
}

async function elevesClasse(classeId, exerciceId) {
  const i = await toutCharger(() => supabase.from("inscriptions").select("id, eleves(nom, prenom, matricule)").eq("classe_id", classeId).eq("exercice_id", exerciceId))
  return i.sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves)))
}

function Selecteurs({ ref_, classeId, setClasseId, sequenceId, setSequenceId, jour, setJour }) {
  return (
    <div className="row g-2 mb-3" style={{ maxWidth: 860 }}>
      <div className="col-sm-4"><select className="form-select" value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label="Classe">
        <option value="">Classe…</option>{ref_.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
      <div className="col-sm-4"><select className="form-select" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label="Séquence">
        <option value="">Séquence…</option>{ref_.sequences.map((s) => <option key={s.id} value={s.id}>Séquence {s.numero}{s.verrouillee ? " (verrouillée)" : ""}</option>)}</select></div>
      {setJour && <div className="col-sm-4"><input className="form-control" type="date" value={jour} max={aujourdhui()} onChange={(e) => setJour(e.target.value)} aria-label="Date" /></div>}
    </div>
  )
}

const heures = (brut) => {
  const t = String(brut ?? "").trim()
  if (t === "") return 0
  if (!/^\d{1,2}$/.test(t) || Number(t) > 24) throw new Error(`« ${brut} » : nombre d'heures entier entre 0 et 24`)
  return Number(t)
}

// --- Appel du jour ------------------------------------------------------------------------------------------
export function Appel() {
  const { exercice } = useSession()
  const [ref_, erreurRef] = useReference()
  const [classeId, setClasseId] = useState(""), [sequenceId, setSequenceId] = useState(""), [jour, setJour] = useState(aujourdhui())
  const [lignes, setLignes] = useState({}), [erreurs, setErreurs] = useState({}), [message, setMessage] = useState({}), [envoi, setEnvoi] = useState(false)
  const sequence = ref_?.sequences.find((s) => s.id === sequenceId)

  const [grille, erreurGrille, rafraichir] = useDonnees(async () => {
    if (!classeId || !sequenceId || !jour) return null
    const eleves = await elevesClasse(classeId, exercice.id)
    const ids = eleves.map((e) => e.id)
    const [absences, retards] = ids.length ? await Promise.all([
      toutCharger(() => supabase.from("absences").select("*").eq("date", jour).in("inscription_id", ids)),
      toutCharger(() => supabase.from("retards").select("*").eq("date", jour).in("inscription_id", ids))]) : [[], []]
    return { eleves, absences: new Map(absences.map((a) => [a.inscription_id, a])), retards: new Map(retards.map((r) => [r.inscription_id, r])),
             autreSequence: [...absences, ...retards].some((x) => x.sequence_id !== sequenceId) }
  }, [classeId, sequenceId, jour])

  useEffect(() => {
    if (!grille) return
    setLignes(Object.fromEntries(grille.eleves.map((i) => {
      const a = grille.absences.get(i.id)
      return [i.id, { nj: a?.heures_non_justifiees || "", j: a?.heures_justifiees || "", motif: a?.motif || "", retard: grille.retards.has(i.id) }]
    })))
    setErreurs({})
  }, [grille])

  const maj = (id, k, v) => setLignes({ ...lignes, [id]: { ...lignes[id], [k]: v } })

  async function enregistrer(e) {
    e.preventDefault(); setMessage({})
    if (grille.autreSequence) return setMessage({ erreur: "Des saisies de ce jour sont rattachées à une autre séquence : choisissez la bonne séquence." })
    const err = {}, lus = {}
    for (const i of grille.eleves) {
      try { lus[i.id] = { ...lignes[i.id], nj: heures(lignes[i.id].nj), j: heures(lignes[i.id].j) } } catch (x) { err[i.id] = x.message }
    }
    setErreurs(err)
    if (Object.keys(err).length) return setMessage({ erreur: "Certaines valeurs sont invalides : rien n'a été enregistré." })
    const ecrireAbs = [], supprAbs = [], ajoutRet = [], supprRet = []
    for (const i of grille.eleves) {
      const l = lus[i.id], a = grille.absences.get(i.id), r = grille.retards.get(i.id)
      if (l.nj === 0 && l.j === 0) { if (a) supprAbs.push(a.id) }
      else if (!a || a.heures_non_justifiees !== l.nj || a.heures_justifiees !== l.j || a.motif !== l.motif.trim())
        ecrireAbs.push({ inscription_id: i.id, sequence_id: sequenceId, date: jour, heures_non_justifiees: l.nj, heures_justifiees: l.j, motif: l.motif.trim().slice(0, 200) })
      if (l.retard && !r) ajoutRet.push({ inscription_id: i.id, sequence_id: sequenceId, date: jour })
      if (!l.retard && r) supprRet.push(r.id)
    }
    setEnvoi(true)
    try {
      if (ecrireAbs.length) verifier(await supabase.from("absences").upsert(ecrireAbs, { onConflict: "inscription_id,date" }))
      if (supprAbs.length) verifier(await supabase.from("absences").delete().in("id", supprAbs))
      if (ajoutRet.length) verifier(await supabase.from("retards").insert(ajoutRet))
      if (supprRet.length) verifier(await supabase.from("retards").delete().in("id", supprRet))
      setMessage({ ok: `Appel du ${date(jour)} enregistré.` }); rafraichir()
    } catch (x) { setMessage({ erreur: x.message }) } finally { setEnvoi(false) }
  }

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!ref_) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  return (
    <>
      <h1 className="h3 mb-3">Appel du jour : absences et retards</h1>
      <Selecteurs ref_={ref_} {...{ classeId, setClasseId, sequenceId, setSequenceId, jour, setJour }} />
      <Alerte>{message.erreur || erreurGrille}</Alerte><Alerte type="success">{message.ok}</Alerte>
      {classeId && sequenceId && !grille && <Chargement />}
      {grille && (
        <form onSubmit={enregistrer} className="card">
          <div className="card-header"><strong>{ref_.classes.find((c) => c.id === classeId)?.libelle}</strong> — {new Date(jour + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          {sequence?.verrouillee && <div className="alert alert-secondary m-3 mb-0">Séquence verrouillée : consultation uniquement.</div>}
          <div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>Élève</th><th>Abs. non justifiées (h)</th><th>Abs. justifiées (h)</th><th>Motif</th><th className="text-center">Retard</th></tr></thead>
            <tbody>{grille.eleves.map((i) => { const l = lignes[i.id] || {}; return (
              <tr key={i.id} className={erreurs[i.id] ? "table-danger" : ""}>
                <td>{nomComplet(i.eleves)}{erreurs[i.id] && <div className="small text-danger">{erreurs[i.id]}</div>}</td>
                <td><input className="form-control form-control-sm" style={{ maxWidth: 90 }} inputMode="numeric" disabled={sequence?.verrouillee} value={l.nj ?? ""} onChange={(e) => maj(i.id, "nj", e.target.value)} aria-label={`Heures non justifiées de ${nomComplet(i.eleves)}`} /></td>
                <td><input className="form-control form-control-sm" style={{ maxWidth: 90 }} inputMode="numeric" disabled={sequence?.verrouillee} value={l.j ?? ""} onChange={(e) => maj(i.id, "j", e.target.value)} aria-label={`Heures justifiées de ${nomComplet(i.eleves)}`} /></td>
                <td><input className="form-control form-control-sm" maxLength={200} disabled={sequence?.verrouillee} value={l.motif ?? ""} onChange={(e) => maj(i.id, "motif", e.target.value)} aria-label={`Motif pour ${nomComplet(i.eleves)}`} /></td>
                <td className="text-center"><input className="form-check-input" type="checkbox" disabled={sequence?.verrouillee} checked={!!l.retard} onChange={(e) => maj(i.id, "retard", e.target.checked)} aria-label={`Retard de ${nomComplet(i.eleves)}`} /></td>
              </tr>) })}
              {!grille.eleves.length && <tr><td colSpan={5} className="text-center text-muted py-4">Aucun élève inscrit.</td></tr>}</tbody>
          </table></div>
          {!sequence?.verrouillee && grille.eleves.length > 0 && <div className="card-footer d-flex flex-wrap gap-2 align-items-center">
            <button className="btn btn-primary" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer l'appel"}</button>
            <span className="small text-muted">Laissez vide pour un élève présent et à l'heure.</span></div>}
        </form>
      )}
    </>
  )
}

// --- Infractions --------------------------------------------------------------------------------------------
export function Infractions() {
  const { exercice } = useSession()
  const [ref_, erreurRef] = useReference()
  const [classeId, setClasseId] = useState(""), [sequenceId, setSequenceId] = useState("")
  const [f, setF] = useState({ inscription_id: "", date: aujourdhui(), infraction_id: "", observation: "" })
  const [message, setMessage] = useState({})
  const sequence = ref_?.sequences.find((s) => s.id === sequenceId)
  const [infractions] = useDonnees(async () => verifier(await supabase.from("infractions").select("id, libelle, sanctions(libelle, points_perdus)").order("libelle")), [])
  const [donnees, erreurDonnees, rafraichir] = useDonnees(async () => {
    if (!classeId || !sequenceId) return null
    const eleves = await elevesClasse(classeId, exercice.id)
    const ids = eleves.map((e) => e.id)
    const liste = ids.length ? await toutCharger(() => supabase.from("incidents").select("*, infractions(libelle, sanctions(libelle, points_perdus))")
      .eq("sequence_id", sequenceId).in("inscription_id", ids).order("date", { ascending: false })) : []
    return { eleves, liste, noms: new Map(eleves.map((e) => [e.id, nomComplet(e.eleves)])) }
  }, [classeId, sequenceId])

  async function ajouter(e) {
    e.preventDefault(); setMessage({})
    try {
      verifier(await supabase.from("incidents").insert({ ...f, sequence_id: sequenceId, observation: f.observation.trim().slice(0, 300) }))
      setMessage({ ok: `Infraction enregistrée pour ${donnees.noms.get(f.inscription_id)}.` })
      setF({ ...f, inscription_id: "", observation: "" }); rafraichir()
    } catch (x) { setMessage({ erreur: x.message }) }
  }
  async function supprimer(x) {
    if (!confirm("Supprimer cette infraction ?")) return
    try { verifier(await supabase.from("incidents").delete().eq("id", x.id)); rafraichir() } catch (err) { setMessage({ erreur: err.message }) }
  }

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!ref_ || !infractions) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  return (
    <>
      <h1 className="h3 mb-3">Infractions et sanctions</h1>
      {!infractions.length && <div className="alert alert-warning">Aucun type d'infraction défini : l'administration les crée dans Paramètres → Discipline.</div>}
      <Selecteurs ref_={ref_} {...{ classeId, setClasseId, sequenceId, setSequenceId }} />
      <Alerte>{message.erreur || erreurDonnees}</Alerte><Alerte type="success">{message.ok}</Alerte>
      {classeId && sequenceId && !donnees && <Chargement />}
      {donnees && (
        <>
          {!sequence?.verrouillee && infractions.length > 0 && (
            <form className="card card-body mb-3" onSubmit={ajouter} style={{ maxWidth: 900 }}><div className="row g-2 align-items-end">
              <div className="col-md-4"><label className="form-label" htmlFor="ie">Élève</label>
                <select className="form-select" id="ie" required value={f.inscription_id} onChange={(e) => setF({ ...f, inscription_id: e.target.value })}>
                  <option value="">…</option>{donnees.eleves.map((i) => <option key={i.id} value={i.id}>{nomComplet(i.eleves)}</option>)}</select></div>
              <div className="col-md-3"><label className="form-label" htmlFor="id">Date</label>
                <input className="form-control" id="id" type="date" required max={aujourdhui()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="col-md-5"><label className="form-label" htmlFor="ii">Infraction</label>
                <select className="form-select" id="ii" required value={f.infraction_id} onChange={(e) => setF({ ...f, infraction_id: e.target.value })}>
                  <option value="">…</option>{infractions.map((x) => <option key={x.id} value={x.id}>{x.libelle} → {x.sanctions.libelle} (−{note(Number(x.sanctions.points_perdus))} pt)</option>)}</select></div>
              <div className="col-md-9"><label className="form-label" htmlFor="io">Observation</label>
                <input className="form-control" id="io" maxLength={300} value={f.observation} onChange={(e) => setF({ ...f, observation: e.target.value })} /></div>
              <div className="col-md-3"><button className="btn btn-primary w-100">Enregistrer</button></div>
            </div></form>
          )}
          <div className="card"><div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>Date</th><th>Élève</th><th>Infraction</th><th>Sanction</th><th>Observation</th><th /></tr></thead>
            <tbody>{donnees.liste.map((x) => (
              <tr key={x.id}><td>{date(x.date)}</td><td>{donnees.noms.get(x.inscription_id)}</td><td>{x.infractions.libelle}</td>
                <td>{x.infractions.sanctions.libelle} (−{note(Number(x.infractions.sanctions.points_perdus))})</td><td className="small">{x.observation}</td>
                <td className="text-end">{!sequence?.verrouillee && <button className="btn btn-sm btn-outline-danger" onClick={() => supprimer(x)}>Supprimer</button>}</td></tr>))}
              {!donnees.liste.length && <tr><td colSpan={6} className="text-center text-muted py-3">Aucune infraction pour cette séquence.</td></tr>}</tbody>
          </table></div></div>
        </>
      )}
    </>
  )
}

// --- Suivi disciplinaire ------------------------------------------------------------------------------------
function TableauSuivi({ classe, periode }) {
  const { exercice } = useSession()
  const [donnees, erreur] = useDonnees(async () => {
    const eleves = await elevesClasse(classe.id, exercice.id)
    const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id))
    return { eleves, sequences, discipline: await chargerDiscipline(eleves.map((e) => e.id), exercice) }
  }, [classe.id])
  const bilans = useMemo(() => donnees && bilansPeriode(donnees.discipline, donnees.eleves.map((e) => e.id), periode, donnees.sequences), [donnees, periode])
  if (!donnees) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const b = donnees.discipline.bareme
  const moins = (v) => (v ? `−${note(v)}` : "0")
  return (
    <>
      <p className="text-muted small">Note de discipline = {note(Number(b.note_max))} − (retards × {note(Number(b.points_par_retard))} + heures non justifiées × {note(Number(b.points_par_heure))} + points des sanctions).</p>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">{classe.libelle} — {periode.libelle}</h2>
        <button className="btn btn-outline-secondary btn-sm no-print" onClick={() => window.print()}>Imprimer</button>
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-sm table-hover align-middle mb-0">
        <thead className="table-light"><tr><th>Élève</th><th className="text-end">Abs. NJ (h)</th><th className="text-end">Abs. J (h)</th><th className="text-end">Retards</th>
          <th>Autres cas</th><th className="text-end">Ponctualité</th><th className="text-end">Assiduité</th><th className="text-end">Autres cas</th>
          <th className="text-end">Note de discipline</th><th>Appréciation</th></tr></thead>
        <tbody>{donnees.eleves.map((i) => { const x = bilans.get(i.id); return (
          <tr key={i.id}><td>{nomComplet(i.eleves)}</td><td className="text-end">{x.nj}</td><td className="text-end">{x.j}</td><td className="text-end">{x.retards}</td>
            <td className="small">{x.incidents.join(", ") || "—"}</td><td className="text-end">{moins(x.pointsPonctualite)}</td><td className="text-end">{moins(x.pointsAssiduite)}</td>
            <td className="text-end">{moins(x.pointsAutres)}</td><td className={`text-end fw-semibold ${x.note < 10 ? "note-faible" : ""}`}>{note(x.note)}</td><td>{x.appreciation}</td></tr>) })}
          {!donnees.eleves.length && <tr><td colSpan={10} className="text-center text-muted py-4">Aucun élève inscrit.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

export function Suivi() {
  return (<><h1 className="h3 mb-3 no-print">Suivi disciplinaire</h1>
    <ChoixClassePeriode>{(classe, periode) => <TableauSuivi key={classe.id + periode.code} classe={classe} periode={periode} />}</ChoixClassePeriode></>)
}
