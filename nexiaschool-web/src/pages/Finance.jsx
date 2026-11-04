// Finances : frais de scolarité et délais, parcours section → cycle → classe, situation de chaque élève, encaissements
// et reçus, élèves non en règle. Calculs faits par la base (fonction finance_eleves) : une seule règle partout.
import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { comparerNoms, nomComplet } from "../lib/format.js"
import { fcfa, fichier, jour, listePdf, MODES, recuPdf } from "../lib/financePdf.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, verifier } from "../supabase.js"

const CYCLES = { 1: "Premier cycle", 2: "Second cycle" }
const LIGNES = ["Inscription", "Tranche 1", "Tranche 2", "Tranche 3", "Tranche 4"]
const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const signalerMajFinance = () => window.dispatchEvent(new Event("finance:maj"))

export function Etat({ e }) {
  if (e.statut === "solde") return <span className="badge text-bg-success">Soldé</span>
  if (e.statut === "a_jour") return <span className="badge text-bg-primary">En règle</span>
  return <span className="badge text-bg-danger">Non en règle</span>
}

const chargerSituation = () => rpc("finance_eleves", { p_classe: null })

// --- Frais de scolarité et délais --------------------------------------------------------------------------------
export function Frais() {
  const { exercice } = useSession()
  const naviguer = useNavigate()
  const [f, setF] = useState(null), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  const [ref, erreurRef] = useDonnees(async () => {
    if (!exercice) return {}
    const [frais, echeances] = await Promise.all([
      supabase.from("frais_scolarite").select("pension_nouveaux, pension_anciens").eq("exercice_id", exercice.id).maybeSingle().then(verifier),
      supabase.from("echeances").select("rang, montant, date_limite").eq("exercice_id", exercice.id).order("rang").then(verifier),
    ])
    return { frais, echeances }
  }, [exercice?.id])
  useEffect(() => {
    if (!ref || f) return
    const parRang = new Map((ref.echeances || []).map((e) => [e.rang, e]))
    setF({ nouveaux: ref.frais?.pension_nouveaux ?? "", anciens: ref.frais?.pension_anciens ?? "",
           lignes: LIGNES.map((_, k) => ({ montant: parRang.get(k)?.montant ?? "", date_limite: parRang.get(k)?.date_limite ?? "" })) })
  }, [ref, f])

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif : l'administration doit d'abord créer l'année scolaire (Paramètres → Exercices).</div>
  if (!f) return <><Alerte>{erreurRef}</Alerte><Chargement /></>
  const n = (v) => (v === "" || v === null ? null : Number(v))
  const tranches = f.lignes.slice(1).reduce((s, l) => s + (n(l.montant) || 0), 0)
  const total = tranches + (n(f.lignes[0].montant) || 0)
  const inscription = (pension) => (n(pension) === null ? null : n(f.lignes[0].montant) + (n(pension) - total))
  const champ = (k, v) => setF({ ...f, [k]: v })
  const ligne = (k, cle, v) => setF({ ...f, lignes: f.lignes.map((l, i) => (i === k ? { ...l, [cle]: v } : l)) })

  async function enregistrer(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      await rpc("finance_enregistrer_frais", { p_pension_nouveaux: n(f.nouveaux), p_pension_anciens: n(f.anciens),
        p_echeances: f.lignes.map((l) => ({ montant: n(l.montant), date_limite: l.date_limite || null })) })
      signalerMajFinance()
      naviguer("/finance", { state: { message: "Frais de scolarité et délais enregistrés." } })
    } catch (x) { setErreur(x.message); setEnvoi(false) }
  }
  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 900 }}>
      <h1 className="h3 mb-1">Frais de scolarité — {exercice.libelle}</h1>
      <p className="text-muted">Renseignez la pension, l'inscription et les quatre tranches avec leurs délais de paiement, puis enregistrez.</p>
      <Alerte>{erreur}</Alerte>
      <div className="card card-body mb-3"><div className="row g-3">
        <div className="col-md-6"><label className="form-label" htmlFor="pn">Pension des nouveaux élèves (FCFA)</label>
          <input id="pn" className="form-control" type="number" min={0} step={1} required value={f.nouveaux} onChange={(e) => champ("nouveaux", e.target.value)} placeholder="ex. 205000" /></div>
        <div className="col-md-6"><label className="form-label" htmlFor="pa">Pension des anciens élèves (FCFA)</label>
          <input id="pa" className="form-control" type="number" min={0} step={1} required value={f.anciens} onChange={(e) => champ("anciens", e.target.value)} placeholder="ex. 200000" /></div>
      </div></div>
      <div className="card mb-3"><div className="table-responsive"><table className="table align-middle mb-0">
        <thead className="table-light"><tr><th>Échéance</th><th style={{ width: 200 }}>Montant (FCFA)</th><th style={{ width: 200 }}>Délai de paiement</th>
          <th className="text-end">Nouveaux</th><th className="text-end">Anciens</th></tr></thead>
        <tbody>{f.lignes.map((l, k) => (
          <tr key={k}><th scope="row">{k === 0 ? "Inscription" : `${k}${k === 1 ? "re" : "e"} tranche`}</th>
            <td><input className="form-control" type="number" min={0} step={1} required aria-label={`Montant ${LIGNES[k]}`} value={l.montant} onChange={(e) => ligne(k, "montant", e.target.value)} /></td>
            <td><input className="form-control" type="date" required aria-label={`Délai ${LIGNES[k]}`} value={l.date_limite} onChange={(e) => ligne(k, "date_limite", e.target.value)} /></td>
            <td className="text-end small">{k === 0 ? (inscription(f.nouveaux) === null ? "—" : fcfa(inscription(f.nouveaux))) : l.montant === "" ? "—" : fcfa(l.montant)}</td>
            <td className="text-end small">{k === 0 ? (inscription(f.anciens) === null ? "—" : fcfa(inscription(f.anciens))) : l.montant === "" ? "—" : fcfa(l.montant)}</td></tr>))}</tbody>
        <tfoot><tr className="fw-semibold"><td>Total saisi</td><td>{fcfa(total)}</td><td /><td className="text-end">{f.nouveaux === "" ? "—" : fcfa(f.nouveaux)}</td>
          <td className="text-end">{f.anciens === "" ? "—" : fcfa(f.anciens)}</td></tr></tfoot>
      </table></div></div>
      <p className="small text-muted">Chaque élève doit la pension de sa catégorie. Si la pension diffère du total saisi, l'écart est porté sur l'inscription
        (colonnes « Nouveaux » et « Anciens »). Un élève est « non en règle » dès qu'une échéance dont le délai est passé n'est pas entièrement payée.</p>
      {(inscription(f.nouveaux) < 0 || inscription(f.anciens) < 0) && <div className="alert alert-warning">Les tranches dépassent la pension : l'inscription deviendrait négative.</div>}
      <button className="btn btn-primary" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
  )
}

// --- Fiche financière d'un élève (fenêtre) -------------------------------------------------------------------------
function FicheEleve({ e, onFermer, onMaj }) {
  const { etablissement, logoUrl, estAdmin, profil } = useSession()
  const [p, setP] = useState({ montant: "", date: aujourdhui(), mode: "especes", reference: "", observation: "" })
  const [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)
  const enRetard = e.retard, prochaine = e.prochaine?.reste || 0
  async function recu(paiement, imprimer) {
    const fenetre = imprimer ? window.open("", "_blank") : null
    try {
      await recuPdf({ etablissement, logoUrl, eleve: e, paiement, situation: e, caissier: paiement.saisi_par || nomComplet(profil) }, { imprimer, fenetre })
    } catch (x) { fenetre?.close(); setMsg({ erreur: `Reçu impossible : ${x.message}` }) }
  }
  async function encaisser(ev) {
    ev.preventDefault(); setMsg({})
    const montant = Math.round(Number(p.montant))
    if (!(montant > 0)) return setMsg({ erreur: "Indiquez un montant supérieur à 0." })
    if (montant > e.reste && !confirm(`Ce montant dépasse le reste à payer (${fcfa(e.reste)}). Enregistrer quand même ?`)) return
    setEnvoi(true)
    try {
      verifier(await supabase.from("paiements").insert({ inscription_id: e.inscription_id, montant, date_paiement: p.date, mode: p.mode,
        reference: p.reference.trim(), observation: p.observation.trim() }))
      setP({ ...p, montant: "", reference: "", observation: "" })
      await onMaj(`Paiement de ${fcfa(montant)} enregistré.`)
      signalerMajFinance()
    } catch (x) { setMsg({ erreur: x.message }) } finally { setEnvoi(false) }
  }
  async function annuler(paiement) {
    if (!confirm(`Annuler le reçu n° ${paiement.numero} (${fcfa(paiement.montant)}) ? Cette opération est définitive.`)) return
    try {
      const { data, error } = await supabase.from("paiements").delete().eq("id", paiement.id).select("id")
      if (error) throw new Error(error.message)
      if (!data?.length) throw new Error("Annulation refusée : seule l'administration peut annuler ce reçu.")
      await onMaj(`Reçu n° ${paiement.numero} annulé.`); signalerMajFinance()
    } catch (x) { setMsg({ erreur: x.message }) }
  }
  async function changerCategorie() {
    try { verifier(await supabase.from("inscriptions").update({ nouveau: !e.nouveau }).eq("id", e.inscription_id)); await onMaj("Catégorie modifiée."); signalerMajFinance() }
    catch (x) { setMsg({ erreur: x.message }) }
  }
  useEffect(() => {
    const echap = (x) => x.key === "Escape" && onFermer()
    document.addEventListener("keydown", echap); return () => document.removeEventListener("keydown", echap)
  }, [onFermer])
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titre-fiche" onClick={(x) => x.target === x.currentTarget && onFermer()}>
        <div className="modal-dialog modal-xl modal-dialog-scrollable"><div className="modal-content">
          <div className="modal-header">
            <div><h2 className="modal-title h5" id="titre-fiche">{nomComplet(e)} <Etat e={e} /></h2>
              <div className="small text-muted">Matricule {e.matricule} · {e.classe}{e.section ? ` · ${e.section}` : ""} · {e.nouveau ? "Nouvel élève" : "Ancien élève"}
                {estAdmin && <button className="btn btn-link btn-sm p-0 ms-2 align-baseline" onClick={changerCategorie}>passer en {e.nouveau ? "ancien" : "nouvel"} élève</button>}</div></div>
            <button type="button" className="btn-close" aria-label="Fermer" onClick={onFermer} />
          </div>
          <div className="modal-body">
            <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
            <div className="row g-2 mb-3">
              {[["Total dû", fcfa(e.total_du)], ["Déjà payé", fcfa(e.paye)], ["Reste à payer", fcfa(e.reste)],
                ["En retard", e.retard ? `${fcfa(e.retard)} (${e.jours_retard} j)` : "—"]].map(([l, v], k) => (
                <div className="col-6 col-md-3" key={l}><div className={`border rounded p-2 ${k === 3 && e.retard ? "border-danger text-danger" : ""}`}>
                  <div className="small text-muted">{l}</div><div className="fw-semibold">{v}</div></div></div>))}
            </div>
            <h3 className="h6">Échéancier</h3>
            <div className="table-responsive mb-3"><table className="table table-sm align-middle">
              <thead><tr><th>Échéance</th><th className="text-end">Montant</th><th>Délai</th><th className="text-end">Payé</th><th className="text-end">Reste</th><th>État</th></tr></thead>
              <tbody>{e.lignes.map((l) => (
                <tr key={l.rang} className={l.en_retard ? "table-danger" : undefined}><td>{l.libelle}</td><td className="text-end">{fcfa(l.montant)}</td><td>{jour(l.date_limite)}</td>
                  <td className="text-end">{fcfa(l.paye)}</td><td className="text-end">{fcfa(l.reste)}</td>
                  <td>{l.reste === 0 ? <span className="badge text-bg-success">Payée</span> : l.en_retard ? <span className="badge text-bg-danger">Délai dépassé</span>
                    : l.paye > 0 ? <span className="badge text-bg-warning">Avance</span> : <span className="badge text-bg-light border">À venir</span>}</td></tr>))}</tbody>
            </table></div>
            <h3 className="h6">Paiements</h3>
            <div className="table-responsive mb-3"><table className="table table-sm align-middle">
              <thead><tr><th>Reçu</th><th>Date</th><th className="text-end">Montant</th><th>Mode</th><th>Référence</th><th>Encaissé par</th><th /></tr></thead>
              <tbody>{e.paiements.map((x) => (
                <tr key={x.id}><td>n° {String(x.numero).padStart(5, "0")}</td><td>{jour(x.date)}</td><td className="text-end">{fcfa(x.montant)}</td><td>{MODES[x.mode]}</td>
                  <td className="small">{x.reference || "—"}</td><td className="small">{x.saisi_par || "—"}</td>
                  <td className="text-end text-nowrap"><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => recu(x, false)}>Reçu PDF</button>
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => recu(x, true)}>Imprimer</button>
                    {x.annulable && <button className="btn btn-sm btn-outline-danger" onClick={() => annuler(x)}>Annuler</button>}</td></tr>))}
                {!e.paiements.length && <tr><td colSpan={7} className="text-muted">Aucun paiement enregistré.</td></tr>}</tbody>
            </table></div>
            {e.reste > 0 && (
              <form className="card card-body bg-light" onSubmit={encaisser}>
                <h3 className="h6">Encaisser un paiement</h3>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {enRetard > 0 && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setP({ ...p, montant: enRetard })}>Montant en retard : {fcfa(enRetard)}</button>}
                  {!enRetard && prochaine > 0 && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setP({ ...p, montant: prochaine })}>{e.prochaine.libelle} : {fcfa(prochaine)}</button>}
                  <button type="button" className="btn btn-sm btn-outline-success" onClick={() => setP({ ...p, montant: e.reste })}>Tout payer : {fcfa(e.reste)}</button>
                </div>
                <div className="row g-2">
                  <div className="col-md-3"><label className="form-label small" htmlFor="pm">Montant (FCFA)</label>
                    <input id="pm" className="form-control" type="number" min={1} step={1} required value={p.montant} onChange={(x) => setP({ ...p, montant: x.target.value })} /></div>
                  <div className="col-md-3"><label className="form-label small" htmlFor="pd">Date du paiement</label>
                    <input id="pd" className="form-control" type="date" required max={aujourdhui()} value={p.date} onChange={(x) => setP({ ...p, date: x.target.value })} /></div>
                  <div className="col-md-3"><label className="form-label small" htmlFor="pmo">Mode</label>
                    <select id="pmo" className="form-select" value={p.mode} onChange={(x) => setP({ ...p, mode: x.target.value })}>
                      {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="col-md-3"><label className="form-label small" htmlFor="pr">Référence</label>
                    <input id="pr" className="form-control" maxLength={80} placeholder="n° de transaction…" value={p.reference} onChange={(x) => setP({ ...p, reference: x.target.value })} /></div>
                  <div className="col-12"><label className="form-label small" htmlFor="po">Observation</label>
                    <input id="po" className="form-control" maxLength={200} value={p.observation} onChange={(x) => setP({ ...p, observation: x.target.value })} /></div>
                </div>
                <div className="mt-2"><button className="btn btn-success" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer le paiement"}</button></div>
              </form>)}
            {e.reste === 0 && <div className="alert alert-success mb-0">Scolarité entièrement payée{e.trop_percu ? ` (trop-perçu : ${fcfa(e.trop_percu)})` : ""}.</div>}
          </div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

// --- Tableau d'élèves (classe ou école) avec filtre, export PDF et impression ------------------------------------------
function colonnesEleves(insolvables) {
  return insolvables
    ? [{ titre: "N°", largeur: 9 }, { titre: "Élève" }, { titre: "Matricule", largeur: 22 }, { titre: "Classe", largeur: 20 }, { titre: "Déjà payé", droite: true, largeur: 26 },
       { titre: "Paiements (montant et date)" }, { titre: "Tranche(s) due(s)" }, { titre: "Montant en retard", droite: true, largeur: 28 }, { titre: "Délai dépassé", largeur: 30 }]
    : [{ titre: "N°", largeur: 9 }, { titre: "Élève" }, { titre: "Matricule", largeur: 24 }, { titre: "Catégorie", largeur: 20 }, { titre: "Total dû", droite: true, largeur: 26 },
       { titre: "Payé", droite: true, largeur: 26 }, { titre: "Reste", droite: true, largeur: 26 }, { titre: "Situation" }, { titre: "Prochaine échéance" }]
}
const listePaiements = (e) => e.paiements.map((p) => `${fcfa(p.montant)} le ${jour(p.date)}`).join(" ; ") || "aucun"
const situation = (e) => (e.statut === "solde" ? "Soldé" : e.statut === "a_jour" ? "En règle" : `Non en règle : ${fcfa(e.retard)} (${e.tranches_en_retard})`)
function ligneEleve(e, k, insolvables) {
  return insolvables
    ? [k + 1, nomComplet(e), e.matricule, e.classe, fcfa(e.paye), listePaiements(e), e.tranches_en_retard, fcfa(e.retard), `${jour(e.premier_retard)} (${e.jours_retard} j)`]
    : [k + 1, nomComplet(e), e.matricule, e.nouveau ? "Nouveau" : "Ancien", fcfa(e.total_du), fcfa(e.paye), fcfa(e.reste), situation(e),
       e.prochaine ? `${e.prochaine.libelle} : ${fcfa(e.prochaine.reste)} avant le ${jour(e.prochaine.date_limite)}` : "—"]
}

function TableauEleves({ eleves, titre, sousTitre, nomFichier, insolvables = false, onOuvrir, filtreInitial = "tous" }) {
  const { etablissement, logoUrl } = useSession()
  const [filtre, setFiltre] = useState(filtreInitial), [q, setQ] = useState(""), [erreur, setErreur] = useState(""), [pdf, setPdf] = useState("")
  const lignes = useMemo(() => eleves.filter((e) => (filtre === "tous" || (filtre === "en_regle" ? e.en_regle : !e.en_regle))
    && (!q.trim() || `${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(q.trim().toLowerCase()))), [eleves, filtre, q])
  const totaux = lignes.reduce((s, e) => ({ du: s.du + e.total_du, paye: s.paye + e.paye, reste: s.reste + e.reste, retard: s.retard + e.retard }), { du: 0, paye: 0, reste: 0, retard: 0 })
  async function exporter(imprimer) {
    setErreur(""); setPdf(imprimer ? "imp" : "pdf")
    const fenetre = imprimer ? window.open("", "_blank") : null
    try {
      const libFiltre = { tous: "", en_regle: " — élèves en règle", non: " — élèves non en règle" }[filtre]
      await listePdf({ etablissement, logoUrl, titre: `${titre}${insolvables ? "" : libFiltre}`, sousTitre: `${sousTitre} · ${lignes.length} élève(s) · édité le ${new Date().toLocaleDateString("fr-FR")}`,
        colonnes: colonnesEleves(insolvables), lignes: lignes.map((e, k) => ligneEleve(e, k, insolvables)),
        pied: insolvables ? ["", "Total", "", "", fcfa(lignes.reduce((s, e) => s + e.paye, 0)), "", "", fcfa(totaux.retard), ""]
                          : ["", "Total", "", "", fcfa(totaux.du), fcfa(totaux.paye), fcfa(totaux.reste), "", ""] },
        `${nomFichier}${filtre !== "tous" && !insolvables ? `-${filtre === "en_regle" ? "en-regle" : "non-en-regle"}` : ""}`, { imprimer, fenetre })
    } catch (x) { fenetre?.close(); setErreur(`PDF impossible : ${x.message}`) } finally { setPdf("") }
  }
  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {!insolvables && <div className="btn-group" role="group" aria-label="Filtre">
          {[["tous", "Tous"], ["en_regle", "En règle"], ["non", "Non en règle"]].map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${filtre === k ? "btn-dark" : "btn-outline-dark"}`} aria-pressed={filtre === k} onClick={() => setFiltre(k)}>{l}</button>))}
        </div>}
        <input className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="Rechercher (nom, matricule)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <span className="small text-muted">{lignes.length} élève(s)</span>
        <div className="ms-auto d-flex gap-2">
          <button className="btn btn-sm btn-primary" disabled={!lignes.length || !!pdf} onClick={() => exporter(false)}>{pdf === "pdf" ? "Préparation…" : "Exporter en PDF"}</button>
          <button className="btn btn-sm btn-outline-primary" disabled={!lignes.length || !!pdf} onClick={() => exporter(true)}>{pdf === "imp" ? "Préparation…" : "Imprimer"}</button>
        </div>
      </div>
      <Alerte>{erreur}</Alerte>
      <div className="card shadow-sm"><div className="table-responsive"><table className="table table-hover align-middle mb-0 tableau-finance">
        <thead className="table-light"><tr>{colonnesEleves(insolvables).map((c) => <th key={c.titre} className={c.droite ? "text-end" : undefined}>{c.titre}</th>)}</tr></thead>
        <tbody>{lignes.map((e, k) => (
          <tr key={e.inscription_id} role="button" onClick={() => onOuvrir(e)} title="Voir le détail et encaisser">
            {insolvables ? <>
              <td>{k + 1}</td><td className="fw-semibold">{nomComplet(e)}</td><td className="small">{e.matricule}</td><td>{e.classe}</td><td className="text-end">{fcfa(e.paye)}</td>
              <td className="small">{listePaiements(e)}</td><td>{e.tranches_en_retard}</td><td className="text-end text-danger fw-semibold">{fcfa(e.retard)}</td>
              <td className="small text-nowrap">{jour(e.premier_retard)}<div className="text-danger">dépassé de {e.jours_retard} j</div></td></>
            : <>
              <td>{k + 1}</td><td className="fw-semibold">{nomComplet(e)}</td><td className="small">{e.matricule}</td><td className="small">{e.nouveau ? "Nouveau" : "Ancien"}</td>
              <td className="text-end">{fcfa(e.total_du)}</td><td className="text-end">{fcfa(e.paye)}</td><td className="text-end">{fcfa(e.reste)}</td>
              <td><Etat e={e} />{e.retard > 0 && <div className="small text-danger">{fcfa(e.retard)} · {e.tranches_en_retard} · {e.jours_retard} j</div>}</td>
              <td className="small">{e.prochaine ? <>{e.prochaine.libelle} : {fcfa(e.prochaine.reste)}<div className="text-muted">avant le {jour(e.prochaine.date_limite)}</div></> : "—"}</td></>}
          </tr>))}
          {!lignes.length && <tr><td colSpan={9} className="text-center text-muted py-4">{insolvables ? "Aucun élève non en règle : tous les délais sont respectés." : "Aucun élève."}</td></tr>}</tbody>
        {lignes.length > 0 && <tfoot className="table-light fw-semibold"><tr>{insolvables
          ? <><td colSpan={4}>Total</td><td className="text-end">{fcfa(totaux.paye)}</td><td colSpan={2} /><td className="text-end text-danger">{fcfa(totaux.retard)}</td><td /></>
          : <><td colSpan={4}>Total</td><td className="text-end">{fcfa(totaux.du)}</td><td className="text-end">{fcfa(totaux.paye)}</td><td className="text-end">{fcfa(totaux.reste)}</td><td colSpan={2} /></>}</tr></tfoot>}
      </table></div></div>
    </>
  )
}

// --- Parcours : section → cycle → classe → élèves --------------------------------------------------------------------
function Carte({ titre, eleves, onClick }) {
  const non = eleves.filter((e) => !e.en_regle).length
  const pct = eleves.length ? Math.round((100 * eleves.reduce((s, e) => s + e.paye, 0)) / Math.max(1, eleves.reduce((s, e) => s + e.total_du, 0))) : 0
  return (
    <div className="col-sm-6 col-lg-4 col-xl-3">
      <button type="button" className="card h-100 w-100 text-start shadow-sm carte-choix" onClick={onClick}>
        <div className="card-body">
          <div className="fw-semibold fs-5">{titre}</div>
          <div className="small text-muted">{eleves.length} élève(s) · {pct} % encaissé</div>
          <div className="mt-2">{non ? <span className="badge text-bg-danger">{non} non en règle</span> : <span className="badge text-bg-success">Tous en règle</span>}</div>
        </div>
      </button>
    </div>
  )
}

function Parcours() {
  const [params, setParams] = useSearchParams()
  const [msg, setMsg] = useState(window.history.state?.usr?.message || "")
  const [d, erreur, rafraichir] = useDonnees(async () => {
    const [s, classes, sections] = await Promise.all([chargerSituation(),
      supabase.from("classes").select("id, libelle, ordre, section_id, cycle").order("ordre").order("libelle").then(verifier),
      supabase.from("sections").select("id, libelle, ordre").order("ordre").order("libelle").then(verifier)])
    return { s, classes, sections }
  }, [])
  const [ouvert, setOuvert] = useState(null)
  useEffect(() => { const maj = () => rafraichir(); window.addEventListener("finance:maj-donnees", maj); return () => window.removeEventListener("finance:maj-donnees", maj) }, [rafraichir])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  if (!d.s.configure) return <Navigate to="/finance/frais" replace />

  const section = params.get("section"), cycle = params.get("cycle"), classeId = params.get("classe")
  const aller = (p) => setParams(p)
  const elevesDe = (f) => d.s.eleves.filter(f)
  const sectionsUtiles = [...d.sections.map((x) => ({ id: x.id, libelle: x.libelle })), ...(d.classes.some((c) => !c.section_id) ? [{ id: "aucune", libelle: "Sans section" }] : [])]
  const passerSection = d.sections.length === 0
  const dansSection = (c) => passerSection || (section === "aucune" ? !c.section_id : c.section_id === section)
  const classesSection = d.classes.filter(dansSection)
  const cyclesUtiles = [1, 2].filter((k) => classesSection.some((c) => c.cycle === k)).map((k) => ({ id: String(k), libelle: CYCLES[k] }))
  if (classesSection.some((c) => !c.cycle)) cyclesUtiles.push({ id: "0", libelle: "Cycle non précisé" })
  const passerCycle = cyclesUtiles.length <= 1
  const dansCycle = (c) => passerCycle || (cycle === "0" ? !c.cycle : String(c.cycle) === cycle)
  const classesCycle = classesSection.filter(dansCycle)
  const classe = d.classes.find((c) => c.id === classeId)
  const etape = classe ? "eleves" : (!passerSection && !section) ? "section" : (!passerCycle && !cycle) ? "cycle" : "classe"
  const libSection = passerSection ? null : sectionsUtiles.find((x) => x.id === section)?.libelle
  const libCycle = passerCycle ? null : cyclesUtiles.find((x) => x.id === cycle)?.libelle
  const fil = [["Finances", {}], ...(libSection ? [[libSection, { section }]] : []), ...(libCycle ? [[libCycle, { ...(section ? { section } : {}), cycle }]] : []), ...(classe ? [[classe.libelle, null]] : [])]
  const maj = async (texte) => { setMsg(texte); await rafraichir() }
  const eleveOuvert = ouvert && d.s.eleves.find((e) => e.inscription_id === ouvert)

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h1 className="h3 m-0">Finances</h1>
        <div className="d-flex flex-wrap gap-2">
          <Link className="btn btn-sm btn-danger" to="/finance/insolvables">Élèves non en règle ({d.s.eleves.filter((e) => !e.en_regle).length})</Link>
          <Link className="btn btn-sm btn-outline-secondary" to="/finance/frais">Frais et délais</Link>
        </div>
      </div>
      <nav aria-label="Fil d'Ariane"><ol className="breadcrumb small mb-3">
        {fil.map(([lib, p], k) => <li key={k} className={`breadcrumb-item ${k === fil.length - 1 ? "active" : ""}`}>
          {k < fil.length - 1 ? <a href="#" onClick={(e) => { e.preventDefault(); aller(p) }}>{lib}</a> : lib}</li>)}</ol></nav>
      <Alerte type="success" onFermer={() => setMsg("")}>{msg}</Alerte>
      {etape === "section" && (<>
        <p className="text-muted">Choisissez la section.</p>
        <div className="row g-3">{sectionsUtiles.map((x) => <Carte key={x.id} titre={x.libelle}
          eleves={elevesDe((e) => (x.id === "aucune" ? !e.section_id : e.section_id === x.id))} onClick={() => aller({ section: x.id })} />)}</div></>)}
      {etape === "cycle" && (<>
        <p className="text-muted">Choisissez le cycle.</p>
        <div className="row g-3">{cyclesUtiles.map((x) => <Carte key={x.id} titre={x.libelle}
          eleves={elevesDe((e) => classesSection.some((c) => c.id === e.classe_id) && (x.id === "0" ? !e.cycle : String(e.cycle) === x.id))}
          onClick={() => aller({ ...(section ? { section } : {}), cycle: x.id })} />)}</div></>)}
      {etape === "classe" && (<>
        <p className="text-muted">Choisissez la classe.</p>
        <div className="row g-3">{classesCycle.map((c) => <Carte key={c.id} titre={c.libelle} eleves={elevesDe((e) => e.classe_id === c.id)}
          onClick={() => aller({ ...(section ? { section } : {}), ...(cycle ? { cycle } : {}), classe: c.id })} />)}
          {!classesCycle.length && <p className="text-muted">Aucune classe.</p>}</div></>)}
      {etape === "eleves" && (
        <TableauEleves key={classe.id} eleves={elevesDe((e) => e.classe_id === classe.id).sort((a, b) => comparerNoms(nomComplet(a), nomComplet(b)))}
          titre={`Situation financière — ${classe.libelle}`} sousTitre={[libSection, libCycle].filter(Boolean).join(" · ") || "Scolarité"}
          nomFichier={fichier("situation", classe.libelle)} onOuvrir={(e) => setOuvert(e.inscription_id)} />)}
      {eleveOuvert && <FicheEleve e={eleveOuvert} onFermer={() => setOuvert(null)} onMaj={maj} />}
    </>
  )
}

// --- Élèves non en règle de toute l'école -----------------------------------------------------------------------------
function Insolvables() {
  const [d, erreur, rafraichir] = useDonnees(chargerSituation, [])
  const [ouvert, setOuvert] = useState(null), [msg, setMsg] = useState(""), [classe, setClasse] = useState("")
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  if (!d.configure) return <Navigate to="/finance/frais" replace />
  const tous = d.eleves.filter((e) => !e.en_regle)
  const classes = [...new Map(tous.map((e) => [e.classe_id, e.classe])).entries()]
  const liste = tous.filter((e) => !classe || e.classe_id === classe)
  const eleveOuvert = ouvert && d.eleves.find((e) => e.inscription_id === ouvert)
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h1 className="h3 m-0">Élèves non en règle</h1>
        <Link className="btn btn-sm btn-outline-secondary" to="/finance">← Finances</Link>
      </div>
      <p className="text-muted small">Élèves de tout l'établissement ayant au moins une échéance dont le délai de paiement est dépassé, au {jour(d.aujourdhui)}.</p>
      <Alerte type="success" onFermer={() => setMsg("")}>{msg}</Alerte>
      {classes.length > 1 && <select className="form-select form-select-sm mb-3" style={{ maxWidth: 260 }} value={classe} onChange={(e) => setClasse(e.target.value)} aria-label="Classe">
        <option value="">Toutes les classes</option>{classes.map(([id, lib]) => <option key={id} value={id}>{lib}</option>)}</select>}
      <TableauEleves key={classe} eleves={liste} insolvables titre="Élèves non en règle (frais de scolarité)"
        sousTitre={classe ? classes.find(([id]) => id === classe)?.[1] : "Tout l'établissement"} nomFichier={fichier("eleves-non-en-regle", classe ? classes.find(([id]) => id === classe)?.[1] : "")}
        onOuvrir={(e) => setOuvert(e.inscription_id)} />
      {eleveOuvert && <FicheEleve e={eleveOuvert} onFermer={() => setOuvert(null)} onMaj={async (t) => { setMsg(t); await rafraichir() }} />}
    </>
  )
}

export default function Finance() {
  return (
    <Routes>
      <Route index element={<Parcours />} />
      <Route path="frais" element={<Frais />} />
      <Route path="insolvables" element={<Insolvables />} />
      <Route path="*" element={<Navigate to="/finance" replace />} />
    </Routes>
  )
}
