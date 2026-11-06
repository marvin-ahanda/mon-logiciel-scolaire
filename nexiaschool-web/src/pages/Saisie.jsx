import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, date, lireNote, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

/** Message court (une ligne) pour une note invalide, ou "" si la valeur est correcte. */
function erreurCourte(v) {
  try { lireNote(v); return "" } catch {
    const x = String(v).trim().replace(",", ".")
    return /^\d+(\.\d+)?$/.test(x) ? (Number(x) > 20 ? t("Note entre 0 et 20") : t("Deux décimales au plus")) : t("Note invalide (ex. 12,5)");
  }
}

// --- Grille d'une matière pour une séquence (remontée à chaque changement de choix : jamais de grille périmée) ---
function Grille({ attribution, sequence, exercice, onModifie }) {
  const [grille, erreurGrille, rafraichir] = useDonnees(async () => {
    const [inscriptions, notes] = await Promise.all([
      toutCharger(() => supabase.from("inscriptions").select("id, eleves(nom, prenom, matricule)").eq("classe_id", attribution.classe_id).eq("exercice_id", exercice.id)),
      toutCharger(() => supabase.from("notes").select("id, inscription_id, valeur").eq("attribution_id", attribution.id).eq("sequence_id", sequence.id)),
    ])
    return { eleves: inscriptions.sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves))), notes: new Map(notes.map((n) => [n.inscription_id, n])) }
  }, [])
  const [valeurs, setValeurs] = useState(null), [erreurs, setErreurs] = useState({})
  const [message, setMessage] = useState({}), [envoi, setEnvoi] = useState(false)
  const champs = useRef([])

  const initiales = useMemo(() => grille && Object.fromEntries(grille.eleves.map((i) => [i.id, grille.notes.has(i.id) ? note(Number(grille.notes.get(i.id).valeur)) : ""])), [grille])
  useEffect(() => { if (initiales) { setValeurs(initiales); setErreurs({}) } }, [initiales])

  const modifiees = useMemo(() => {
    if (!valeurs || !initiales) return new Set()
    return new Set(Object.keys(valeurs).filter((k) => String(valeurs[k]).trim() !== String(initiales[k]).trim()))
  }, [valeurs, initiales])
  useEffect(() => { onModifie(modifiees.size > 0) }, [modifiees.size, onModifie])
  useEffect(() => {
    if (!modifiees.size) return
    const avertir = (e) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", avertir)
    return () => window.removeEventListener("beforeunload", avertir)
  }, [modifiees.size])

  const stats = useMemo(() => {
    const v = Object.values(valeurs || {}).map((x) => { try { return lireNote(x) } catch { return null } }).filter((x) => x !== null)
    return { n: v.length, moyenne: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null,
             min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null }
  }, [valeurs])

  // contrôle immédiat pendant la frappe ; le message reste sur la même ligne (aucun décalage de la page au clic)
  function saisir(id, v) {
    setValeurs((x) => ({ ...x, [id]: v }))
    setErreurs((e) => { const x = { ...e }; const m = erreurCourte(v); if (m) x[id] = m; else delete x[id]; return x })
  }
  function suivant(e, k) {                       // Entrée ou flèche bas : élève suivant ; flèche haut : précédent
    if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const cible = champs.current[k + (e.key === "ArrowUp" ? -1 : 1)]
      if (cible) { cible.focus(); cible.select() }
    }
  }

  async function enregistrer(e) {
    e.preventDefault(); setMessage({})
    const lus = {}, err = {}
    for (const i of grille.eleves) { try { lus[i.id] = lireNote(valeurs[i.id]) } catch { err[i.id] = erreurCourte(valeurs[i.id]) } }
    setErreurs(err)
    if (Object.keys(err).length) {
      champs.current[grille.eleves.findIndex((i) => err[i.id])]?.focus()
      return setMessage({ erreur: t(
        "{v0} note(s) invalide(s), signalée(s) en rouge : rien n'a été enregistré.",
        {
          v0: Object.keys(err).length
        }
      ) });
    }
    const aEcrire = [], aSupprimer = []
    for (const i of grille.eleves) {
      const avant = grille.notes.get(i.id), v = lus[i.id]
      if (v === null && avant) aSupprimer.push(avant.id)
      else if (v !== null && (!avant || Number(avant.valeur) !== v))
        aEcrire.push({ inscription_id: i.id, attribution_id: attribution.id, sequence_id: sequence.id, valeur: v })
    }
    if (!aEcrire.length && !aSupprimer.length) return setMessage({ info: t("Aucune modification à enregistrer.") });
    setEnvoi(true)
    try {
      if (aEcrire.length) verifier(await supabase.from("notes").upsert(aEcrire, { onConflict: "inscription_id,attribution_id,sequence_id" }))
      if (aSupprimer.length) verifier(await supabase.from("notes").delete().in("id", aSupprimer))
      setMessage({ ok: t("Notes enregistrées : {v0} ajoutée(s) ou modifiée(s){v1}.", {
        v0: aEcrire.length,
        v1: aSupprimer.length ? `, ${aSupprimer.length} effacée(s)` : ""
      }) })
      rafraichir()
    } catch (x) { setMessage({ erreur: t("Enregistrement impossible : {v0}", {
      v0: x.message
    }) }) } finally { setEnvoi(false) }
  }

  if (!grille || !valeurs) return <><Alerte>{erreurGrille}</Alerte>{!erreurGrille && <Chargement texte={t("Chargement des élèves…")} />}</>;
  if (!grille.eleves.length) return (<div className="alert alert-light border">{t("Aucun élève n'est inscrit en ")}<strong>{attribution.classes.libelle}</strong>{t(" pour cet exercice.")}{" "}{t("Inscrivez les élèves dans ")}<Link to="/eleves">{t("Élèves")}</Link>{t(" ou importez-les depuis ")}<Link to="/excel">{t("Excel")}</Link>.</div>);
  const verrou = sequence.verrouillee
  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 860 }} noValidate>
      <Alerte>{message.erreur}</Alerte><Alerte type="success">{message.ok}</Alerte><Alerte type="info">{message.info}</Alerte>
      {verrou && <div className="alert alert-secondary">{t("Séquence ")}{sequence.numero}{t(
        " verrouillée : consultation seulement (déverrouillage dans Paramètres → Exercices)."
      )}</div>}
      <div className="card mb-3"><div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead className="table-light"><tr><th style={{ width: 48 }}>#</th><th>{t("Élève")}</th><th>{t("Matricule")}</th><th style={{ width: 130 }}>{t("Note /20")}</th><th style={{ width: 190 }} /></tr></thead>
        <tbody>{grille.eleves.map((i, k) => (
          <tr key={i.id} className={modifiees.has(i.id) ? "table-warning" : undefined}>
            <td className="text-muted">{k + 1}</td><td>{nomComplet(i.eleves)}</td><td className="small text-muted">{i.eleves.matricule}</td>
            <td><input ref={(el) => (champs.current[k] = el)} className={`form-control form-control-sm text-end ${erreurs[i.id] ? "is-invalid" : ""}`}
                       inputMode="decimal" autoComplete="off" disabled={verrou} placeholder="—" value={valeurs[i.id] ?? ""}
                       onChange={(e) => saisir(i.id, e.target.value)} onKeyDown={(e) => suivant(e, k)} onFocus={(e) => e.target.select()}
                       aria-label={t("Note de {v0}", {
                         v0: nomComplet(i.eleves)
                       })} aria-invalid={!!erreurs[i.id]} aria-describedby={erreurs[i.id] ? `err-${i.id}` : undefined} /></td>
            <td className="small text-nowrap">{erreurs[i.id] ? <span id={`err-${i.id}`} className="text-danger" role="alert">{erreurs[i.id]}</span>
              : modifiees.has(i.id) ? <span className="text-muted">{t("non enregistrée")}</span> : null}</td></tr>))}</tbody>
      </table></div></div>
      <div className="d-flex flex-wrap align-items-center gap-3 position-sticky bottom-0 barre-saisie py-2">
        {!verrou && <button className="btn btn-primary" disabled={envoi || !modifiees.size}>
          {envoi ? t("Enregistrement…") : modifiees.size ? `Enregistrer ${modifiees.size} modification(s)` : t("Notes à jour")}</button>}
        {!verrou && modifiees.size > 0 && !envoi &&
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setValeurs(initiales); setErreurs({}); setMessage({}) }}>{t("Annuler les modifications")}</button>}
        <span className="small text-muted">{stats.n}/{grille.eleves.length}{t(" note(s) · moyenne ")}{stats.moyenne === null ? "—" : note(stats.moyenne)}
          {stats.n > 0 && ` · min ${note(stats.min)} · max ${note(stats.max)}`}</span>
      </div>
      {!verrou && <p className="small text-muted mt-1 mb-0">{t(
        "Virgule ou point acceptés (ex. 12,5). Case vide = pas de note. Touche Entrée : élève suivant."
      )}</p>}
    </form>
  );
}

export default function Saisie() {
  const { exercice, estAdmin, profil } = useSession()
  const [classeId, setClasseId] = useState(""), [attributionId, setAttributionId] = useState(""), [sequenceId, setSequenceId] = useState("")
  const [modifie, setModifie] = useState(false)

  const [ref, erreurRef] = useDonnees(async () => {
    if (!exercice) return null
    let q = supabase.from("attributions").select("id, coefficient, classe_id, enseignant_id, classes(libelle, ordre), matieres(code, libelle)").eq("exercice_id", exercice.id)
    if (!estAdmin) q = q.eq("enseignant_id", profil.id)
    const [attributions, sequences, classes, personnels] = await Promise.all([
      q.then(verifier),
      supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero").then(verifier),
      estAdmin ? supabase.from("classes").select("id, libelle, ordre").then(verifier) : Promise.resolve(null),
      estAdmin ? supabase.from("personnels").select("id, nom, prenom, role").then(verifier) : Promise.resolve([]),
    ])
    const parClasse = new Map()
    for (const a of attributions) parClasse.set(a.classe_id, { id: a.classe_id, ...a.classes })
    for (const c of classes || []) if (!parClasse.has(c.id)) parClasse.set(c.id, c)
    const toutes = [...parClasse.values()].sort((a, b) => a.ordre - b.ordre || comparerNoms(a.libelle, b.libelle))
    return { attributions, sequences, classes: toutes, personnels: new Map(personnels.map((p) => [p.id, p])) }
  }, [exercice?.id])

  const matieres = useMemo(() => (ref?.attributions || []).filter((a) => a.classe_id === classeId)
    .sort((a, b) => comparerNoms(a.matieres.libelle, b.matieres.libelle)), [ref, classeId])
  const attribution = matieres.find((a) => a.id === attributionId)
  const sequence = ref?.sequences.find((s) => s.id === sequenceId)

  // Choix par défaut : la seule classe, la seule matière, la première séquence non verrouillée
  useEffect(() => {
    if (!ref) return
    if (!classeId && ref.classes.length === 1) setClasseId(ref.classes[0].id)
    if (!sequenceId && ref.sequences.length) setSequenceId((ref.sequences.find((s) => !s.verrouillee) || ref.sequences[0]).id)
  }, [ref, classeId, sequenceId])
  useEffect(() => { if (matieres.length === 1 && !attributionId) setAttributionId(matieres[0].id) }, [matieres, attributionId])

  const changer = (f) => (e) => {
    if (modifie && !confirm(t("Des notes saisies n'ont pas été enregistrées. Les abandonner ?"))) return
    setModifie(false); f(e.target.value)
  }

  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}{estAdmin && <>{t(" Créez-le dans ")}<Link to="/parametres/exercices">{t("Paramètres → Exercices")}</Link>.</>}</div>;
  if (!ref) return <><Alerte>{erreurRef}</Alerte>{!erreurRef && <Chargement />}</>
  const prof = attribution?.enseignant_id && ref.personnels.get(attribution.enseignant_id)
  return (
    <>
      <h1 className="h3 mb-3">{t("Saisie des notes")}</h1>
      {!ref.attributions.length ? (
        <div className="alert alert-light border" style={{ maxWidth: 860 }}>
          {estAdmin ? <>{t("Aucune matière n'est encore attribuée aux classes pour l'exercice ")}{exercice.libelle}{t(". Ajoutez les matières de chaque classe dans ")}<Link to="/parametres/coefficients">{t("Paramètres → Matières par classe")}</Link>.</>
            : <>{t("Aucune matière ne vous est attribuée pour l'exercice ")}{exercice.libelle}{t(
            ". Demandez à l'administration de vous confier vos matières (Paramètres → Matières par classe)."
          )}</>}
        </div>
      ) : (
        <>
          <div className="row g-2 mb-3" style={{ maxWidth: 860 }}>
            <div className="col-sm-4"><label className="form-label small mb-1" htmlFor="s-classe">{t("Classe")}</label>
              <select id="s-classe" className="form-select" value={classeId} onChange={changer((v) => { setClasseId(v); setAttributionId("") })}>
                <option value="">{t("Choisissez la classe…")}</option>{ref.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
            <div className="col-sm-5"><label className="form-label small mb-1" htmlFor="s-matiere">{t("Matière")}</label>
              <select id="s-matiere" className="form-select" value={attributionId} onChange={changer(setAttributionId)} disabled={!classeId || !matieres.length}>
                <option value="">{classeId && !matieres.length ? t("Aucune matière dans cette classe") : t("Choisissez la matière…")}</option>
                {matieres.map((a) => <option key={a.id} value={a.id}>{a.matieres.libelle}{t(" (coef. ")}{a.coefficient})</option>)}</select></div>
            <div className="col-sm-3"><label className="form-label small mb-1" htmlFor="s-sequence">{t("Séquence")}</label>
              <select id="s-sequence" className="form-select" value={sequenceId} onChange={changer(setSequenceId)}>
                {ref.sequences.map((s) => <option key={s.id} value={s.id}>{t("Séquence ")}{s.numero}{t(" (trim. ")}{s.trimestre}){s.verrouillee ? t(" — verrouillée") : ""}</option>)}</select></div>
          </div>
          {sequence && !sequence.verrouillee && sequence.date_limite_notes && (
            <div style={{ maxWidth: 860 }} className={`alert py-2 ${sequence.date_limite_notes < new Date().toISOString().slice(0, 10) ? "alert-warning" : "alert-light border"}`}>
              {sequence.date_limite_notes < new Date().toISOString().slice(0, 10)
                ? t("Délai de saisie dépassé (le {v0}) : terminez la saisie au plus vite.", { v0: date(sequence.date_limite_notes) })
                : t("Délai de saisie des notes : {v0}.", { v0: date(sequence.date_limite_notes) })}
            </div>)}
          {classeId && !matieres.length && (
            <div className="alert alert-light border" style={{ maxWidth: 860 }}>{t("Aucune matière n'est attribuée à cette classe.")}{estAdmin && <>{t(" Ajoutez-les dans ")}<Link to="/parametres/coefficients">{t("Paramètres → Matières par classe")}</Link>.</>}</div>)}
          {attribution && estAdmin && (
            <p className="small text-muted mb-2">{t("Enseignant : ")}{prof ? nomComplet(prof) : t("aucun (seule l'administration peut saisir)")}
              {prof && prof.role === "surveillant" && <span className="text-danger">{t(
                " — le surveillant général ne peut pas saisir de notes : confiez cette matière à un enseignant."
              )}</span>}</p>)}
          {attribution && sequence
            ? <Grille key={`${attribution.id}|${sequence.id}`} attribution={attribution} sequence={sequence} exercice={exercice} onModifie={setModifie} />
            : classeId && matieres.length > 0 && <p className="text-muted">{t("Choisissez la matière pour afficher la liste des élèves.")}</p>}
        </>
      )}
    </>
  );
}
