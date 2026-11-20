// Courrier → Courriers aux parents (administration) : rédaction (modèles, variables, pièce jointe PDF), ciblage (élèves choisis
// ou groupe : classes, niveaux, cycles, sections, paiement, critères), aperçu et confirmation du nombre de destinataires,
// envoi immédiat ou programmé, historique filtrable, confirmation de lecture, renvoi des échecs, modèles.
import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, dateHeure, nomComplet } from "../lib/format.js"
import { cyclesDe, structurer } from "../lib/pv/donnees.js"
import { remplir, STATUTS, statutAffiche } from "../lib/relances.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

export const SUJETS = { reunion: "Réunion", fermeture: "Fermeture", evenement: "Évènement", discipline: "Mesure disciplinaire", convocation: "Convocation",
  pedagogie: "Information pédagogique", rappel: "Rappel", decision: "Décision", general: "Communication générale" }
const VARIABLES = ["eleve", "nom", "prenom", "matricule", "classe", "niveau", "parent", "etablissement", "date", "annee", "montant_du", "reste_total", "echeance"]
const PAIEMENTS = { "": "Tous", en_regle: "En règle", non_en_regle: "Non en règle (échéance échue impayée)", solde: "Pension soldée" }
const TAILLE_MAX = 2 * 1024 * 1024

export default function CourriersParents() {
  const [vue, setVue] = useState("nouveau")
  const [message, setMessage] = useState({ ok: "", erreur: "" })
  useEffect(() => { rpc("courriers_admin_liberer").catch(() => {}) }, [])          // distribue les envois programmés dont l'heure est venue
  return (
    <>
      <p className="text-muted small">{t("Informez les parents de tout sujet : réunions, fermetures, évènements, mesures disciplinaires, convocations, informations pédagogiques, rappels, décisions. Chaque parent ne reçoit que le courrier de son enfant, dans l'espace parents.")}</p>
      <ul className="nav nav-pills mb-3 gap-1">
        {[["nouveau", "Nouveau courrier"], ["historique", "Historique"], ["modeles", "Modèles"]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => { setVue(k); setMessage({ ok: "", erreur: "" }) }}>{t(l)}</button></li>))}
      </ul>
      {message.ok && <div className="alert alert-success small py-2">{message.ok}</div>}
      <Alerte>{message.erreur}</Alerte>
      {vue === "nouveau" && <Nouveau onEnvoye={(m) => { setMessage({ ok: m, erreur: "" }); setVue("historique") }} onErreur={(e) => setMessage({ ok: "", erreur: e })} />}
      {vue === "historique" && <Historique onMessage={setMessage} />}
      {vue === "modeles" && <Modeles onMessage={setMessage} />}
    </>
  )
}

// --- Nouveau courrier -------------------------------------------------------------------------------------------------------
const CIBLAGE_VIDE = { mode: "groupe", classes: [], niveaux: [], cycles: [], sections: [], paiement: "", sexe: "", anciennete: "", redoublant: "", inscriptions: [] }

function Nouveau({ onEnvoye, onErreur }) {
  const { exercice } = useSession()
  const [ref, erreur] = useDonnees(async () => {
    const [classes, niveaux, cycles, sections, modeles] = await Promise.all([
      supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier),
      supabase.from("niveaux").select("id, libelle, cycle_id, ordre").order("ordre").then(verifier).catch(() => []),
      supabase.from("cycles").select("id, libelle, ordre").order("ordre").then(verifier).catch(() => []),
      supabase.from("sections").select("id, libelle, ordre").order("ordre").then(verifier).catch(() => []),
      supabase.from("courriers_modeles").select("*").order("nom").then(verifier)])
    const eleves = exercice ? await toutCharger(() => supabase.from("inscriptions").select("id, classe_id, eleves(nom, prenom, matricule)").eq("exercice_id", exercice.id)) : []
    const structurees = structurer(classes, { niveaux, cycles, sections })
    return { classes: structurees, cycles: cyclesDe(structurees), sections, modeles, eleves }
  }, [exercice?.id])
  const [f, setF] = useState({ sujet: "general", objet: "", corps: "", confirmation_lecture: false, programme_le: "", description_cible: "" })
  const [ciblage, setCiblage] = useState(CIBLAGE_VIDE)
  const [piece, setPiece] = useState(null)                  // { id, nom }
  const [apercu, setApercu] = useState(null), [nombreConfirme, setNombreConfirme] = useState(""), [enCours, setEnCours] = useState(false)
  useEffect(() => { setApercu(null); setNombreConfirme("") }, [ciblage])
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const niveauxListe = [...new Set(ref.classes.map((c) => c.niveauLibelle || c.niveau).filter(Boolean))]

  async function voirApercu() {
    setEnCours(true)
    try { setApercu(await rpc("courrier_admin_apercu", { p_ciblage: ciblage })) } catch (e) { onErreur(e.message) } finally { setEnCours(false) }
  }
  async function joindre(fichier) {
    if (!fichier) return
    if (fichier.type !== "application/pdf" && !/\.pdf$/i.test(fichier.name)) return onErreur(t("La pièce jointe doit être un fichier PDF."))
    if (fichier.size > TAILLE_MAX) return onErreur(t("Pièce jointe trop volumineuse (2 Mo au plus)."))
    setEnCours(true)
    try {
      const base64 = await new Promise((ok, ko) => { const l = new FileReader(); l.onload = () => ok(String(l.result).split(",")[1] || ""); l.onerror = ko; l.readAsDataURL(fichier) })
      setPiece({ id: await rpc("courrier_piece_ajouter", { p_nom: fichier.name, p_base64: base64 }), nom: fichier.name })
    } catch (e) { onErreur(e.message) } finally { setEnCours(false) }
  }
  async function envoyer(e) {
    e.preventDefault()
    setEnCours(true)
    try {
      // l'heure saisie est celle de l'établissement (Douala, UTC+1), quel que soit le fuseau de l'ordinateur
      const r = await rpc("courrier_admin_envoyer", { p: { ...f, programme_le: f.programme_le ? `${f.programme_le}:00+01:00` : null, ciblage, piece_id: piece?.id || null,
        description_cible: f.description_cible || descriptionCiblage(ciblage, ref), confirmation: { nombre: nombreConfirme.trim(), empreinte: apercu.empreinte } } })
      onEnvoye(r.statut === "programme" ? t("{v0} courrier(s) programmé(s) pour le {v1}.", { v0: r.destinataires, v1: dateHeure(r.programme_le) })
        : t("{v0} courrier(s) envoyé(s) aux parents.", { v0: r.destinataires }))
    } catch (err) { onErreur(err.message); setApercu(null) } finally { setEnCours(false) }
  }
  const exemple = apercu?.exemples?.[0]
  const choisir = (k, v) => setCiblage({ ...ciblage, [k]: v })
  return (
    <form onSubmit={envoyer} style={{ maxWidth: 1100 }}>
      <div className="row g-3">
        <div className="col-lg-7">
          <h2 className="h6">{t("1. Le courrier")}</h2>
          <div className="row g-2 mb-2">
            <div className="col-sm-6"><label className="form-label small mb-1">{t("Sujet")}</label>
              <select className="form-select form-select-sm" value={f.sujet} onChange={(e) => setF({ ...f, sujet: e.target.value })}>
                {Object.entries(SUJETS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
            <div className="col-sm-6"><label className="form-label small mb-1">{t("Partir d'un modèle")}</label>
              <select className="form-select form-select-sm" value="" onChange={(e) => { const m = ref.modeles.find((x) => x.id === e.target.value); if (m) setF({ ...f, sujet: m.sujet, objet: m.objet, corps: m.corps }) }}>
                <option value="">{ref.modeles.length ? t("Choisir un modèle…") : t("Aucun modèle")}</option>{ref.modeles.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}</select></div>
          </div>
          <input className="form-control mb-2" required minLength={3} maxLength={200} placeholder={t("Objet")} aria-label={t("Objet")} value={f.objet} onChange={(e) => setF({ ...f, objet: e.target.value })} />
          <textarea className="form-control mb-1" required minLength={10} maxLength={8000} rows={9} placeholder={t("Texte du courrier")} aria-label={t("Texte du courrier")} value={f.corps} onChange={(e) => setF({ ...f, corps: e.target.value })} />
          <p className="small text-muted mb-2">{t("Variables : {v0}", { v0: VARIABLES.map((v) => `{${v}}`).join(" ") })}</p>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <label className="btn btn-sm btn-outline-secondary mb-0">{t("Joindre un PDF (2 Mo au plus)")}<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => joindre(e.target.files[0])} /></label>
            {piece && <span className="small">📎 {piece.nom} <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setPiece(null)}>{t("Retirer")}</button></span>}
          </div>
          <div className="form-check mb-2"><input className="form-check-input" type="checkbox" id="ca-conf" checked={f.confirmation_lecture} onChange={(e) => setF({ ...f, confirmation_lecture: e.target.checked })} />
            <label className="form-check-label small" htmlFor="ca-conf">{t("Demander une confirmation de lecture (le parent clique « J'ai pris connaissance » ; vous voyez qui a ouvert le courrier)")}</label></div>
          <div className="mb-2" style={{ maxWidth: 320 }}><label className="form-label small mb-1" htmlFor="ca-quand">{t("Programmer l'envoi (facultatif)")}</label>
            <input id="ca-quand" type="datetime-local" className="form-control form-control-sm" value={f.programme_le} onChange={(e) => setF({ ...f, programme_le: e.target.value })} />
            <div className="form-text">{t("Heure de l'établissement (Douala, UTC+1).")}</div></div>
        </div>
        <div className="col-lg-5">
          <h2 className="h6">{t("2. Les destinataires")}</h2>
          <div className="btn-group btn-group-sm mb-2" role="group">
            <button type="button" className={`btn ${ciblage.mode === "groupe" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setCiblage({ ...CIBLAGE_VIDE, mode: "groupe" })}>{t("Un groupe")}</button>
            <button type="button" className={`btn ${ciblage.mode === "eleves" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setCiblage({ ...CIBLAGE_VIDE, mode: "eleves" })}>{t("Des élèves choisis")}</button>
          </div>
          {ciblage.mode === "groupe" ? (
            <>
              <ListeChoix titre={t("Classes")} elements={ref.classes.map((c) => ({ id: c.id, libelle: c.libelle }))} choisis={ciblage.classes} onChange={(v) => choisir("classes", v)} />
              {niveauxListe.length > 0 && <ListeChoix titre={t("Niveaux")} elements={niveauxListe.map((n) => ({ id: n, libelle: n }))} choisis={ciblage.niveaux} onChange={(v) => choisir("niveaux", v)} />}
              {ref.cycles.length > 0 && <ListeChoix titre={t("Cycles")} elements={ref.cycles} choisis={ciblage.cycles} onChange={(v) => choisir("cycles", v)} />}
              {ref.sections.length > 0 && <ListeChoix titre={t("Sections")} elements={ref.sections} choisis={ciblage.sections} onChange={(v) => choisir("sections", v)} />}
              <div className="row g-2 mb-2">
                <div className="col-6"><label className="form-label small mb-1">{t("Statut de paiement")}</label>
                  <select className="form-select form-select-sm" value={ciblage.paiement} onChange={(e) => choisir("paiement", e.target.value)}>
                    {Object.entries(PAIEMENTS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
                <div className="col-6"><label className="form-label small mb-1">{t("Sexe")}</label>
                  <select className="form-select form-select-sm" value={ciblage.sexe} onChange={(e) => choisir("sexe", e.target.value)}>
                    <option value="">{t("Tous")}</option><option value="F">{t("Filles")}</option><option value="M">{t("Garçons")}</option></select></div>
                <div className="col-6"><label className="form-label small mb-1">{t("Ancienneté")}</label>
                  <select className="form-select form-select-sm" value={ciblage.anciennete} onChange={(e) => choisir("anciennete", e.target.value)}>
                    <option value="">{t("Tous")}</option><option value="nouveau">{t("Nouveaux")}</option><option value="ancien">{t("Anciens")}</option></select></div>
                <div className="col-6"><label className="form-label small mb-1">{t("Redoublants")}</label>
                  <select className="form-select form-select-sm" value={ciblage.redoublant} onChange={(e) => choisir("redoublant", e.target.value)}>
                    <option value="">{t("Tous")}</option><option value="true">{t("Redoublants seulement")}</option><option value="false">{t("Non redoublants")}</option></select></div>
              </div>
              <p className="small text-muted">{t("Sans aucun filtre, le courrier va à tous les parents de l'établissement.")}</p>
            </>
          ) : <ChoixEleves eleves={ref.eleves} classes={ref.classes} choisis={ciblage.inscriptions} onChange={(v) => choisir("inscriptions", v)} />}
          <button type="button" className="btn btn-outline-primary btn-sm mb-2" disabled={enCours} onClick={voirApercu}>{t("Voir les destinataires")}</button>
          {apercu && (
            <div className={`border rounded p-2 small mb-2 ${apercu.nombre ? "" : "border-danger"}`}>
              <strong>{t("{v0} destinataire(s)", { v0: apercu.nombre })}</strong>
              <div className="text-muted">{apercu.classes.map((c) => `${c.classe} (${c.nombre})`).join(" · ")}</div>
              {apercu.exemples.length > 0 && <div className="mt-1">{t("Par exemple : {v0}", { v0: apercu.exemples.slice(0, 6).map((x) => x.eleve).join(", ") })}{apercu.nombre > 6 ? "…" : ""}</div>}
            </div>)}
        </div>
      </div>
      {apercu?.nombre > 0 && (
        <div className="card border-warning mt-2"><div className="card-body">
          <h2 className="h6">{t("3. Vérifier et envoyer")}</h2>
          {exemple && <div className="border rounded p-2 small mb-2 bg-body-tertiary" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{t("Aperçu pour {v0} :", { v0: exemple.eleve })}</strong>{"\n"}<strong>{remplir(f.objet, { eleve: exemple.eleve, classe: exemple.classe, parent: t("Parents de {v0}", { v0: exemple.eleve }) })}</strong>{"\n"}
            {remplir(f.corps, { eleve: exemple.eleve, classe: exemple.classe, parent: t("Parents de {v0}", { v0: exemple.eleve }) })}</div>}
          <label className="form-label small fw-semibold" htmlFor="ca-nombre">{t("Pour éviter un envoi au mauvais groupe, saisissez le nombre de destinataires ({v0}) :", { v0: apercu.nombre })}</label>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <input id="ca-nombre" className="form-control form-control-sm" style={{ maxWidth: 120 }} inputMode="numeric" value={nombreConfirme} onChange={(e) => setNombreConfirme(e.target.value)} />
            <button type="submit" className="btn btn-success" disabled={enCours || nombreConfirme.trim() !== String(apercu.nombre) || !f.objet.trim() || f.corps.trim().length < 10}>
              {f.programme_le ? t("Programmer l'envoi") : t("Envoyer maintenant")}</button>
          </div>
        </div></div>)}
    </form>
  )
}

function descriptionCiblage(c, ref) {
  if (c.mode === "eleves") return t("{v0} élève(s) choisi(s)", { v0: c.inscriptions.length })
  const parties = [
    c.classes.length && c.classes.map((id) => ref.classes.find((x) => x.id === id)?.libelle).join(", "),
    c.niveaux.length && c.niveaux.join(", "), c.cycles.length && c.cycles.map((id) => ref.cycles.find((x) => x.id === id)?.libelle).join(", "),
    c.sections.length && c.sections.map((id) => ref.sections.find((x) => x.id === id)?.libelle).join(", "),
    c.paiement && t(PAIEMENTS[c.paiement]), c.sexe && (c.sexe === "F" ? t("Filles") : t("Garçons")),
    c.anciennete && (c.anciennete === "nouveau" ? t("Nouveaux") : t("Anciens")), c.redoublant && (c.redoublant === "true" ? t("Redoublants seulement") : t("Non redoublants")),
  ].filter(Boolean)
  return (parties.join(" · ") || t("Tout l'établissement")).slice(0, 400)
}

function ListeChoix({ titre, elements, choisis, onChange }) {
  const basculer = (id) => onChange(choisis.includes(id) ? choisis.filter((x) => x !== id) : [...choisis, id])
  return (
    <fieldset className="mb-2"><legend className="small fw-semibold mb-1">{titre} {choisis.length > 0 && <span className="text-muted fw-normal">({choisis.length})</span>}</legend>
      <div className="d-flex flex-wrap gap-1">{elements.map((e) => (
        <button key={e.id} type="button" className={`btn btn-sm ${choisis.includes(e.id) ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={choisis.includes(e.id)} onClick={() => basculer(e.id)}>{e.libelle}</button>))}
      </div></fieldset>
  )
}

function ChoixEleves({ eleves, classes, choisis, onChange }) {
  const [q, setQ] = useState("")
  const nomClasse = useMemo(() => new Map(classes.map((c) => [c.id, c.libelle])), [classes])
  const liste = useMemo(() => {
    const s = q.trim().toLowerCase()
    return eleves.filter((i) => !s || `${nomComplet(i.eleves)} ${i.eleves.matricule} ${nomClasse.get(i.classe_id)}`.toLowerCase().includes(s))
      .sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves))).slice(0, 60)
  }, [eleves, q, nomClasse])
  const basculer = (id) => onChange(choisis.includes(id) ? choisis.filter((x) => x !== id) : [...choisis, id])
  return (
    <div className="mb-2">
      <input type="search" className="form-control form-control-sm mb-1" placeholder={t("Rechercher un élève (nom, matricule, classe)…")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="border rounded p-2 overflow-auto" style={{ maxHeight: 220 }}>
        {liste.map((i) => (
          <div className="form-check small" key={i.id}><input className="form-check-input" type="checkbox" id={`ce-${i.id}`} checked={choisis.includes(i.id)} onChange={() => basculer(i.id)} />
            <label className="form-check-label" htmlFor={`ce-${i.id}`}>{nomComplet(i.eleves)} · {nomClasse.get(i.classe_id)} · {i.eleves.matricule}</label></div>))}
        {!liste.length && <span className="small text-muted">{t("Aucun élève.")}</span>}
      </div>
      <div className="small text-muted mt-1">{t("{v0} élève(s) choisi(s)", { v0: choisis.length })}</div>
    </div>
  )
}

// --- Historique ------------------------------------------------------------------------------------------------------------
function Historique({ onMessage }) {
  const [filtre, setFiltre] = useState({ sujet: "", statut: "", texte: "" })
  const [envois, erreur, recharger] = useDonnees(async () => verifier(await supabase.from("courriers_envois").select("*").order("cree_le", { ascending: false }).limit(500)), [])
  const [ouvert, setOuvert] = useState(null)
  const visibles = useMemo(() => {
    const q = filtre.texte.trim().toLowerCase()
    return (envois || []).filter((e) => (!filtre.sujet || e.sujet === filtre.sujet) && (!filtre.statut || e.statut === filtre.statut)
      && (!q || `${e.objet} ${e.description_cible} ${e.cree_par_nom} ${e.corps}`.toLowerCase().includes(q)))
  }, [envois, filtre])
  if (!envois) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  async function faire(nom, params, ok) {
    try { await rpc(nom, params); onMessage({ ok, erreur: "" }); recharger() } catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-sm-4 col-lg-3"><select className="form-select form-select-sm" value={filtre.sujet} onChange={(e) => setFiltre({ ...filtre, sujet: e.target.value })} aria-label={t("Sujet")}>
          <option value="">{t("Tous les sujets")}</option>{Object.entries(SUJETS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        <div className="col-sm-4 col-lg-2"><select className="form-select form-select-sm" value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} aria-label={t("Statut")}>
          <option value="">{t("Tous")}</option><option value="programme">{t("Programmé")}</option><option value="envoye">{t("Envoyé")}</option><option value="annule">{t("Annulé")}</option></select></div>
        <div className="col-sm-4 col-lg-4"><input type="search" className="form-control form-control-sm" placeholder={t("Rechercher dans les courriers…")} value={filtre.texte} onChange={(e) => setFiltre({ ...filtre, texte: e.target.value })} /></div>
      </div>
      <div className="table-responsive"><table className="table table-sm table-hover small align-middle">
        <thead className="table-light"><tr><th>{t("Date")}</th><th>{t("Sujet")}</th><th>{t("Objet")}</th><th>{t("Destinataires")}</th><th>{t("Statut")}</th><th></th></tr></thead>
        <tbody>{visibles.map((e) => (
          <tr key={e.id}>
            <td className="text-nowrap">{dateHeure(e.statut === "programme" ? e.programme_le : e.envoye_le || e.cree_le)}</td><td>{t(SUJETS[e.sujet])}</td>
            <td>{e.objet}{e.piece_id && " 📎"}<div className="text-muted">{e.cree_par_nom}</div></td>
            <td>{e.destinataires}<div className="text-muted text-truncate" style={{ maxWidth: 220 }}>{e.description_cible}</div></td>
            <td><span className={`badge text-bg-${e.statut === "envoye" ? "primary" : e.statut === "programme" ? "secondary" : "dark"}`}>{t({ envoye: "Envoyé", programme: "Programmé", annule: "Annulé" }[e.statut])}</span>
              {e.confirmation_lecture && <div><span className="badge text-bg-info">{t("Confirmation de lecture")}</span></div>}</td>
            <td className="text-nowrap">
              <button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => setOuvert(ouvert === e.id ? null : e.id)}>{ouvert === e.id ? t("Fermer") : t("Détail")}</button>
              {e.statut === "programme" && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => { const m = prompt(t("Motif de l'annulation :")); if (m) faire("courrier_admin_annuler", { p_envoi: e.id, p_motif: m }, t("Envoi annulé.")) }}>{t("Annuler")}</button>}
            </td>
          </tr>))}
          {!visibles.length && <tr><td colSpan={6} className="text-muted">{t("Aucun courrier.")}</td></tr>}
        </tbody></table></div>
      {ouvert && <DetailEnvoi e={envois.find((x) => x.id === ouvert)} faire={faire} />}
    </>
  )
}

function DetailEnvoi({ e, faire }) {
  const [courriers, , recharger] = useDonnees(async () => verifier(await supabase.from("courriers_ecole").select("id, eleve, classe, statut, lu_le, accuse_le, erreur, objet, corps").eq("envoi_id", e.id).order("classe").order("eleve")), [e.id])
  const [lectures, setLectures] = useState(null)
  useEffect(() => { if (e.confirmation_lecture) rpc("courrier_admin_lectures", { p_envoi: e.id }).then(setLectures).catch(() => setLectures(null)); else setLectures(null) }, [e.id, e.confirmation_lecture])
  const ouverts = (courriers || []).filter((c) => c.lu_le).length
  return (
    <div className="card mb-3"><div className="card-body">
      <h3 className="h6">{e.objet}</h3>
      <div className="border rounded p-2 small mb-2" style={{ whiteSpace: "pre-wrap" }}>{e.corps}</div>
      <div className="form-check form-switch mb-2">
        <input className="form-check-input" type="checkbox" role="switch" id={`conf-${e.id}`} checked={e.confirmation_lecture}
          onChange={(x) => faire("courrier_admin_confirmation", { p_envoi: e.id, p_actif: x.target.checked }, x.target.checked ? t("Confirmation de lecture activée.") : t("Confirmation de lecture désactivée."))} />
        <label className="form-check-label small" htmlFor={`conf-${e.id}`}>{t("Confirmation de lecture : voir quels élèves (leurs parents) ont ouvert ce courrier")}</label>
      </div>
      {lectures && (
        <>
          <p className="small mb-1"><strong>{t("{v0} ouvert(s) sur {v1}", { v0: lectures.filter((x) => x.lu_le).length, v1: lectures.length })}</strong> · {t("{v0} accusé(s) de réception", { v0: lectures.filter((x) => x.accuse_le).length })}</p>
          <div className="table-responsive mb-2" style={{ maxHeight: 320 }}><table className="table table-sm small">
            <thead><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Ouvert le")}</th><th>{t("Pris connaissance le")}</th><th>{t("Réponses")}</th></tr></thead>
            <tbody>{lectures.map((x) => <tr key={x.id} className={x.lu_le ? "" : "text-muted"}><td>{x.eleve}</td><td>{x.classe}</td><td>{x.lu_le ? dateHeure(x.lu_le) : t("non ouvert")}</td>
              <td>{x.accuse_le ? dateHeure(x.accuse_le) : "—"}</td><td>{x.reponses || ""}</td></tr>)}</tbody></table></div>
        </>)}
      {!lectures && courriers && <p className="small text-muted">{t("{v0} courrier(s) ; activez la confirmation de lecture pour voir le détail des ouvertures ({v1} ouvert(s)).", { v0: courriers.length, v1: ouverts })}</p>}
      {(courriers || []).filter((c) => c.statut === "echoue").map((c) => (
        <div key={c.id} className="alert alert-danger small py-1 d-flex justify-content-between align-items-center gap-2">
          <span>{c.eleve} · {c.classe} — {c.erreur}</span>
          <button type="button" className="btn btn-sm btn-light" onClick={async () => { await faire("courrier_ecole_renvoyer", { p_id: c.id }, t("Courrier renvoyé.")); recharger() }}>{t("Renvoyer")}</button>
        </div>))}
      {courriers && <details className="small"><summary>{t("Courriers individuels ({v0})", { v0: courriers.length })}</summary>
        <ul className="mb-0">{courriers.map((c) => <li key={c.id}>{c.eleve} · {c.classe} · <span className={`badge text-bg-${(STATUTS[statutAffiche(c)] || [])[1] || "secondary"}`}>{t((STATUTS[statutAffiche(c)] || [c.statut])[0])}</span></li>)}</ul></details>}
    </div></div>
  )
}

// --- Modèles ---------------------------------------------------------------------------------------------------------------
function Modeles({ onMessage }) {
  const [liste, erreur, recharger] = useDonnees(async () => verifier(await supabase.from("courriers_modeles").select("*").order("nom")), [])
  const [edition, setEdition] = useState(null)
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  async function enregistrer(e) {
    e.preventDefault()
    try { await rpc("courrier_modele_enregistrer", { p: edition }); onMessage({ ok: t("Modèle enregistré."), erreur: "" }); setEdition(null); recharger() }
    catch (x) { onMessage({ ok: "", erreur: x.message }) }
  }
  async function supprimer(m) {
    if (!confirm(t("Supprimer le modèle « {v0} » ? Les courriers déjà envoyés ne changent pas.", { v0: m.nom }))) return
    try { await rpc("courrier_modele_supprimer", { p_id: m.id }); onMessage({ ok: t("Modèle supprimé."), erreur: "" }); recharger() } catch (x) { onMessage({ ok: "", erreur: x.message }) }
  }
  return (
    <div style={{ maxWidth: 980 }}>
      <button type="button" className="btn btn-sm btn-primary mb-2" onClick={() => setEdition({ nom: "", sujet: "general", objet: "", corps: "" })}>{t("Nouveau modèle")}</button>
      {edition && (
        <form className="card mb-3" onSubmit={enregistrer}><div className="card-body">
          <div className="row g-2 mb-2">
            <div className="col-sm-6"><input className="form-control form-control-sm" required minLength={2} maxLength={80} placeholder={t("Nom du modèle")} aria-label={t("Nom du modèle")} value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} /></div>
            <div className="col-sm-6"><select className="form-select form-select-sm" value={edition.sujet} onChange={(e) => setEdition({ ...edition, sujet: e.target.value })} aria-label={t("Sujet")}>
              {Object.entries(SUJETS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          </div>
          <input className="form-control form-control-sm mb-2" required minLength={3} maxLength={200} placeholder={t("Objet")} aria-label={t("Objet")} value={edition.objet} onChange={(e) => setEdition({ ...edition, objet: e.target.value })} />
          <textarea className="form-control form-control-sm mb-1" required minLength={10} maxLength={8000} rows={7} placeholder={t("Texte du courrier")} aria-label={t("Texte du courrier")} value={edition.corps} onChange={(e) => setEdition({ ...edition, corps: e.target.value })} />
          <p className="small text-muted">{t("Variables : {v0}", { v0: VARIABLES.map((v) => `{${v}}`).join(" ") })}</p>
          <button type="submit" className="btn btn-sm btn-primary me-2">{t("Enregistrer")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEdition(null)}>{t("Annuler")}</button>
        </div></form>)}
      <div className="list-group">{liste.map((m) => (
        <div className="list-group-item" key={m.id}>
          <div className="d-flex flex-wrap justify-content-between gap-2"><strong>{m.nom}</strong><span className="badge text-bg-light">{t(SUJETS[m.sujet] || m.sujet)}</span></div>
          <div className="small">{m.objet}</div>
          <div className="mt-1"><button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => setEdition({ id: m.id, nom: m.nom, sujet: m.sujet, objet: m.objet, corps: m.corps })}>{t("Modifier")}</button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => supprimer(m)}>{t("Supprimer")}</button></div>
        </div>))}
        {!liste.length && <div className="list-group-item small text-muted">{t("Aucun modèle. Créez vos courriers types : réunion, fermeture, convocation…")}</div>}
      </div>
    </div>
  )
}
