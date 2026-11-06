import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { bilansPeriode, chargerDiscipline } from "../lib/donneesDiscipline.js"
import { comparerNoms, date, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"
import { t, locale } from "../i18n.jsx"
import { enAttente, envoyer } from "../lib/horsLigne.js"

const aujourdhui = () => new Date().toISOString().slice(0, 10)
/** Prévient la bulle d'alerte de discipline qu'il faut recalculer les alertes. */
export const signalerMajDiscipline = () => window.dispatchEvent(new Event("discipline:maj"))

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
      <div className="col-sm-4"><select className="form-select" value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label={t("Classe")}>
        <option value="">{t("Classe…")}</option>{ref_.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
      <div className="col-sm-4"><select className="form-select" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label={t("Séquence")}>
        <option value="">{t("Séquence…")}</option>{ref_.sequences.map((s) => <option key={s.id} value={s.id}>{t("Séquence ")}{s.numero}{s.verrouillee ? t(" (verrouillée)") : ""}</option>)}</select></div>
      {setJour && <div className="col-sm-4"><input className="form-control" type="date" value={jour} max={aujourdhui()} onChange={(e) => setJour(e.target.value)} aria-label={t("Date")} /></div>}
    </div>
  );
}

const heures = (brut) => {
  const x = String(brut ?? "").trim()
  if (x === "") return 0
  if (!/^\d{1,2}$/.test(x) || Number(x) > 24) throw new Error(t("« {v0} » : nombre d'heures entier entre 0 et 24", {
    v0: brut
  }))
  return Number(x)
}

// --- Appel du jour ------------------------------------------------------------------------------------------
export function Appel() {
  const { exercice, profil } = useSession()
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
    const abs = new Map(absences.map((a) => [a.inscription_id, a])), ret = new Map(retards.map((r) => [r.inscription_id, r])), attente = new Set()
    // appel saisi hors ligne, pas encore envoyé : il prime sur la dernière copie du serveur
    for (const op of enAttente(profil.id, (x) => x.type === "appel" && !x.erreur && x.donnees.date === jour)) {
      const d = op.donnees
      for (const a of d.absences) if (ids.includes(a.inscription_id)) { abs.set(a.inscription_id, { ...a, sequence_id: d.sequence_id }); attente.add(a.inscription_id) }
      for (const id of d.effacerAbsences) if (ids.includes(id)) { abs.delete(id); attente.add(id) }
      for (const id of d.retards) if (ids.includes(id)) { ret.set(id, { inscription_id: id, sequence_id: d.sequence_id }); attente.add(id) }
      for (const id of d.effacerRetards) if (ids.includes(id)) { ret.delete(id); attente.add(id) }
    }
    return { eleves, absences: abs, retards: ret, attente,
             autreSequence: [...abs.values(), ...ret.values()].some((x) => x.sequence_id !== sequenceId) }
  }, [classeId, sequenceId, jour])
  useEffect(() => {
    window.addEventListener("horsligne:synchro", rafraichir); return () => window.removeEventListener("horsligne:synchro", rafraichir)
  }, [rafraichir])

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
    if (grille.autreSequence) return setMessage({ erreur: t(
      "Des saisies de ce jour sont rattachées à une autre séquence : choisissez la bonne séquence."
    ) });
    const err = {}, lus = {}
    for (const i of grille.eleves) {
      try { lus[i.id] = { ...lignes[i.id], nj: heures(lignes[i.id].nj), j: heures(lignes[i.id].j) } } catch (x) { err[i.id] = x.message }
    }
    setErreurs(err)
    if (Object.keys(err).length) return setMessage({ erreur: t("Certaines valeurs sont invalides : rien n'a été enregistré.") });
    const ecrireAbs = [], supprAbs = [], ajoutRet = [], supprRet = []
    for (const i of grille.eleves) {
      const l = lus[i.id], a = grille.absences.get(i.id), r = grille.retards.get(i.id)
      if (l.nj === 0 && l.j === 0) { if (a) supprAbs.push(i.id) }
      else if (!a || a.heures_non_justifiees !== l.nj || a.heures_justifiees !== l.j || a.motif !== l.motif.trim())
        ecrireAbs.push({ inscription_id: i.id, heures_non_justifiees: l.nj, heures_justifiees: l.j, motif: l.motif.trim().slice(0, 200) })
      if (l.retard && !r) ajoutRet.push(i.id)
      if (!l.retard && r) supprRet.push(i.id)
    }
    if (!ecrireAbs.length && !supprAbs.length && !ajoutRet.length && !supprRet.length) return setMessage({ info: t("Aucune modification à enregistrer.") })
    setEnvoi(true)
    try {
      const classe = ref_.classes.find((c) => c.id === classeId)?.libelle || ""
      const r = await envoyer("appel", { sequence_id: sequenceId, date: jour, absences: ecrireAbs, effacerAbsences: supprAbs, retards: ajoutRet, effacerRetards: supprRet },
        t("Appel du {v0} — {v1}", { v0: date(jour), v1: classe }))
      if (r.enAttente) setMessage({ info: t("Pas de connexion : l'appel du {v0} est gardé sur cet appareil. Il sera envoyé automatiquement dès le retour de la connexion.", { v0: date(jour) }) })
      else setMessage({ ok: t("Appel du {v0} enregistré.", {
        v0: date(jour)
      }) })
      rafraichir(); signalerMajDiscipline()
    } catch (x) { setMessage({ erreur: x.message }) } finally { setEnvoi(false) }
  }

  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}</div>;
  if (!ref_) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  return (
    <>
      <h1 className="h3 mb-3">{t("Appel du jour : absences et retards")}</h1>
      <Selecteurs ref_={ref_} {...{ classeId, setClasseId, sequenceId, setSequenceId, jour, setJour }} />
      <Alerte>{message.erreur || erreurGrille}</Alerte><Alerte type="success">{message.ok}</Alerte><Alerte type="info">{message.info}</Alerte>
      {classeId && sequenceId && !grille && <Chargement />}
      {grille && (
        <form onSubmit={enregistrer} className="card">
          <div className="card-header"><strong>{ref_.classes.find((c) => c.id === classeId)?.libelle}</strong> — {new Date(jour + "T12:00").toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          {sequence?.verrouillee && <div className="alert alert-secondary m-3 mb-0">{t("Séquence verrouillée : consultation uniquement.")}</div>}
          <div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Abs. non justifiées (h)")}</th><th>{t("Abs. justifiées (h)")}</th><th>{t("Motif")}</th><th className="text-center">{t("Retard")}</th></tr></thead>
            <tbody>{grille.eleves.map((i) => { const l = lignes[i.id] || {}; return (
              <tr key={i.id} className={erreurs[i.id] ? "table-danger" : ""}>
                <td>{nomComplet(i.eleves)}{erreurs[i.id] && <div className="small text-danger">{erreurs[i.id]}</div>}
                  {grille.attente.has(i.id) && <div className="small text-warning-emphasis">{t("⏳ en attente d'envoi")}</div>}</td>
                <td><input className="form-control form-control-sm" style={{ maxWidth: 90 }} inputMode="numeric" disabled={sequence?.verrouillee} value={l.nj ?? ""} onChange={(e) => maj(i.id, "nj", e.target.value)} aria-label={t("Heures non justifiées de {v0}", {
                  v0: nomComplet(i.eleves)
                })} /></td>
                <td><input className="form-control form-control-sm" style={{ maxWidth: 90 }} inputMode="numeric" disabled={sequence?.verrouillee} value={l.j ?? ""} onChange={(e) => maj(i.id, "j", e.target.value)} aria-label={t("Heures justifiées de {v0}", {
                  v0: nomComplet(i.eleves)
                })} /></td>
                <td><input className="form-control form-control-sm" maxLength={200} disabled={sequence?.verrouillee} value={l.motif ?? ""} onChange={(e) => maj(i.id, "motif", e.target.value)} aria-label={t("Motif pour {v0}", {
                  v0: nomComplet(i.eleves)
                })} /></td>
                <td className="text-center"><input className="form-check-input" type="checkbox" disabled={sequence?.verrouillee} checked={!!l.retard} onChange={(e) => maj(i.id, "retard", e.target.checked)} aria-label={t("Retard de {v0}", {
                  v0: nomComplet(i.eleves)
                })} /></td>
              </tr>
            ); })}
              {!grille.eleves.length && <tr><td colSpan={5} className="text-center text-muted py-4">{t("Aucun élève inscrit.")}</td></tr>}</tbody>
          </table></div>
          {!sequence?.verrouillee && grille.eleves.length > 0 && <div className="card-footer d-flex flex-wrap gap-2 align-items-center">
            <button className="btn btn-primary" disabled={envoi}>{envoi ? t("Enregistrement…") : t("Enregistrer l'appel")}</button>
            <span className="small text-muted">{t("Laissez vide pour un élève présent et à l'heure.")}</span></div>}
        </form>
      )}
    </>
  );
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
      setMessage({ ok: t("Infraction enregistrée pour {v0}.", {
        v0: donnees.noms.get(f.inscription_id)
      }) })
      setF({ ...f, inscription_id: "", observation: "" }); rafraichir(); signalerMajDiscipline()
    } catch (x) { setMessage({ erreur: x.message }) }
  }
  async function supprimer(x) {
    if (!confirm(t("Supprimer cette infraction ?"))) return
    try { verifier(await supabase.from("incidents").delete().eq("id", x.id)); rafraichir(); signalerMajDiscipline() } catch (err) { setMessage({ erreur: err.message }) }
  }

  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}</div>;
  if (!ref_ || !infractions) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  return (
    <>
      <h1 className="h3 mb-3">{t("Infractions et sanctions")}</h1>
      {!infractions.length && <div className="alert alert-warning">{t(
        "Aucun type d'infraction défini : l'administration les crée dans Paramètres → Discipline."
      )}</div>}
      <Selecteurs ref_={ref_} {...{ classeId, setClasseId, sequenceId, setSequenceId }} />
      <Alerte>{message.erreur || erreurDonnees}</Alerte><Alerte type="success">{message.ok}</Alerte>
      {classeId && sequenceId && !donnees && <Chargement />}
      {donnees && (
        <>
          {!sequence?.verrouillee && infractions.length > 0 && (
            <form className="card card-body mb-3" onSubmit={ajouter} style={{ maxWidth: 900 }}><div className="row g-2 align-items-end">
              <div className="col-md-4"><label className="form-label" htmlFor="ie">{t("Élève")}</label>
                <select className="form-select" id="ie" required value={f.inscription_id} onChange={(e) => setF({ ...f, inscription_id: e.target.value })}>
                  <option value="">…</option>{donnees.eleves.map((i) => <option key={i.id} value={i.id}>{nomComplet(i.eleves)}</option>)}</select></div>
              <div className="col-md-3"><label className="form-label" htmlFor="id">{t("Date")}</label>
                <input className="form-control" id="id" type="date" required max={aujourdhui()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="col-md-5"><label className="form-label" htmlFor="ii">{t("Infraction")}</label>
                <select className="form-select" id="ii" required value={f.infraction_id} onChange={(e) => setF({ ...f, infraction_id: e.target.value })}>
                  <option value="">…</option>{infractions.map((x) => <option key={x.id} value={x.id}>{x.libelle} → {x.sanctions.libelle} (−{note(Number(x.sanctions.points_perdus))}{t(" pt)")}</option>)}</select></div>
              <div className="col-md-9"><label className="form-label" htmlFor="io">{t("Observation")}</label>
                <input className="form-control" id="io" maxLength={300} value={f.observation} onChange={(e) => setF({ ...f, observation: e.target.value })} /></div>
              <div className="col-md-3"><button className="btn btn-primary w-100">{t("Enregistrer")}</button></div>
            </div></form>
          )}
          <div className="card"><div className="table-responsive"><table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>{t("Date")}</th><th>{t("Élève")}</th><th>{t("Infraction")}</th><th>{t("Sanction")}</th><th>{t("Observation")}</th><th /></tr></thead>
            <tbody>{donnees.liste.map((x) => (
              <tr key={x.id}><td>{date(x.date)}</td><td>{donnees.noms.get(x.inscription_id)}</td><td>{x.infractions.libelle}</td>
                <td>{x.infractions.sanctions.libelle} (−{note(Number(x.infractions.sanctions.points_perdus))})</td><td className="small">{x.observation}</td>
                <td className="text-end">{!sequence?.verrouillee && <button className="btn btn-sm btn-outline-danger" onClick={() => supprimer(x)}>{t("Supprimer")}</button>}</td></tr>))}
              {!donnees.liste.length && <tr><td colSpan={6} className="text-center text-muted py-3">{t("Aucune infraction pour cette séquence.")}</td></tr>}</tbody>
          </table></div></div>
        </>
      )}
    </>
  );
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
      <p className="text-muted small">{t("Note de discipline = ")}{note(Number(b.note_max))}{t(" − (retards × ")}{note(Number(b.points_par_retard))}{t(" + heures non justifiées × ")}{note(Number(b.points_par_heure))}{t(" + points des sanctions).")}</p>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">{classe.libelle} — {periode.libelle}</h2>
        <button className="btn btn-outline-secondary btn-sm no-print" onClick={() => window.print()}>{t("Imprimer")}</button>
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-sm table-hover align-middle mb-0">
        <thead className="table-light"><tr><th>{t("Élève")}</th><th className="text-end">{t("Abs. NJ (h)")}</th><th className="text-end">{t("Abs. J (h)")}</th><th className="text-end">{t("Retards")}</th>
          <th>{t("Autres cas")}</th><th className="text-end">{t("Ponctualité")}</th><th className="text-end">{t("Assiduité")}</th><th className="text-end">{t("Autres cas")}</th>
          <th className="text-end">{t("Note de discipline")}</th><th>{t("Appréciation")}</th></tr></thead>
        <tbody>{donnees.eleves.map((i) => { const x = bilans.get(i.id); return (
          <tr key={i.id}><td>{nomComplet(i.eleves)}</td><td className="text-end">{x.nj}</td><td className="text-end">{x.j}</td><td className="text-end">{x.retards}</td>
            <td className="small">{x.incidents.join(", ") || "—"}</td><td className="text-end">{moins(x.pointsPonctualite)}</td><td className="text-end">{moins(x.pointsAssiduite)}</td>
            <td className="text-end">{moins(x.pointsAutres)}</td><td className={`text-end fw-semibold ${x.note < 10 ? "note-faible" : ""}`}>{note(x.note)}</td><td>{t(x.appreciation)}</td></tr>) })}
          {!donnees.eleves.length && <tr><td colSpan={10} className="text-center text-muted py-4">{t("Aucun élève inscrit.")}</td></tr>}</tbody>
      </table></div></div>
    </>
  );
}

export function Suivi() {
  return (
    <><h1 className="h3 mb-3 no-print">{t("Suivi disciplinaire")}</h1>
      <ChoixClassePeriode>{(classe, periode) => <TableauSuivi key={classe.id + periode.code} classe={classe} periode={periode} />}</ChoixClassePeriode></>
  );
}
