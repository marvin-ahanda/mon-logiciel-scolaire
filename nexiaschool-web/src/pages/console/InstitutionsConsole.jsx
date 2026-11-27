// Console du propriétaire — pilotage institutionnel : référentiel territorial, demandes de comptes de délégation,
// délégations (titulaire, collaborateurs, catégories IA, activation), rattachements, campagnes et échéances,
// paramètres des formules, accès exceptionnels, journal d'audit. Réservé au propriétaire (contrôlé par le serveur).
import { useState } from "react"
import { NavLink, Route, Routes } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { date, dateHeure } from "../../lib/format.js"
import { CATEGORIES_IA, STATUTS_DEMANDE } from "../../lib/institution.js"
import { rpc, supabase, verifier } from "../../supabase.js"
import { FormulaireCampagne, TableauCampagnes, anneeCourante, controlerCampagne } from "../institution/Calendrier.jsx"

function useAction() {
  const [message, setMessage] = useState(null)
  const executer = async (fn, ok) => {
    setMessage(null)
    try { await fn(); setMessage({ type: "success", texte: ok || "Enregistré." }) } catch (x) { setMessage({ type: "danger", texte: x.message }) }
  }
  return [message && <Alerte type={message.type} onFermer={() => setMessage(null)}>{message.texte}</Alerte>, executer]
}

export default function InstitutionsConsole() {
  const onglet = ({ isActive }) => "nav-link py-1" + (isActive ? " active" : "")
  return (
    <>
      <ul className="nav nav-pills small mb-3 flex-wrap">
        {[["", "Demandes"], ["delegations", "Délégations"], ["referentiel", "Référentiel territorial"], ["rattachements", "Rattachements"],
          ["campagnes", "Campagnes et formules"], ["derogations", "Accès exceptionnels"], ["journal", "Journal d'audit"]].map(([to, l]) => (
          <li className="nav-item" key={to}><NavLink className={onglet} end={to === ""} to={`/console/institutions/${to}`}>{l}</NavLink></li>))}
      </ul>
      <div className="alert alert-light border small">NexIA School n'est pas mandatée par le MINESEC : le référentiel pré-rempli, les formules et les échéances doivent être vérifiés et validés avant tout usage institutionnel.</div>
      <Routes>
        <Route index element={<Demandes />} />
        <Route path="delegations" element={<Delegations />} />
        <Route path="referentiel" element={<Referentiel />} />
        <Route path="rattachements" element={<Rattachements />} />
        <Route path="campagnes" element={<Campagnes />} />
        <Route path="derogations" element={<Derogations />} />
        <Route path="journal" element={<JournalInstitutionnel />} />
      </Routes>
    </>
  )
}

async function ouvrirJustificatif(chemin) {
  const { signedUrl } = verifier(await supabase.storage.from("institution").createSignedUrl(chemin, 120))
  window.open(signedUrl, "_blank", "noopener")
}

function Demandes() {
  const [liste, erreur, recharger] = useDonnees(() => rpc("console_inst_demandes"), [])
  const [delegations] = useDonnees(() => rpc("console_inst_delegations"), [])
  const [message, executer] = useAction()
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  const decider = (d, decision) => {
    const motif = ["rejetee", "suspendue"].includes(decision) ? prompt("Motif (obligatoire) :") : ""
    if (motif === null) return
    executer(() => rpc("console_inst_decider", { p_demande: d.id, p_decision: decision, p_motif: motif || "" }).then(recharger))
  }
  const changerTitulaire = (d) => {
    const del = (delegations || []).find((x) => x.id === d.delegation_id)
    if (!del) return alert("Délégation introuvable pour cette circonscription.")
    const motif = prompt(`Changer le titulaire de « ${del.nom} » au profit de ${d.prenom} ${d.nom} (${d.email}).\nL'ancien titulaire perd l'accès ; la délégation et son historique sont conservés.\nMotif (obligatoire) :`)
    if (!motif) return
    executer(() => rpc("console_inst_changer_titulaire", { p_delegation: del.id, p_demande: d.id, p_motif: motif }).then(recharger), "Titulaire changé.")
  }
  return (
    <>
      {message}
      {!liste.length && <p className="text-muted">Aucune demande.</p>}
      <div className="table-responsive"><table className="table table-sm align-middle small">
        <thead><tr><th>Demandeur</th><th>Circonscription</th><th>Fonction · téléphone</th><th>E-mail</th><th>Justificatif</th><th>Statut</th><th /></tr></thead>
        <tbody>{liste.map((d) => (
          <tr key={d.id}><td>{d.nom} {d.prenom}<div className="text-muted">{dateHeure(d.soumise_le || d.cree_le)}</div></td>
            <td>{d.niveau === "region" ? "DRES" : "DDES"} · {d.region}{d.departement ? ` › ${d.departement}` : ""}
              {d.circonscription_prise && <div className="text-warning">circonscription déjà pourvue</div>}</td>
            <td>{d.fonction}<div>{d.telephone}</div></td>
            <td>{d.email}<div className={d.email_verifie ? "text-success" : "text-danger"}>{d.email_verifie ? "vérifié" : "non vérifié"}</div></td>
            <td>{d.justificatif ? <button className="btn btn-link btn-sm p-0" onClick={() => ouvrirJustificatif(d.justificatif)}>ouvrir</button> : "—"}</td>
            <td>{STATUTS_DEMANDE[d.statut]}{d.motif_decision && <div className="text-muted">{d.motif_decision}</div>}</td>
            <td className="text-nowrap">
              {d.statut === "soumise" && <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => decider(d, "en_verification")}>En vérification</button>}
              {["soumise", "en_verification"].includes(d.statut) && !d.circonscription_prise && <button className="btn btn-sm btn-success me-1" onClick={() => decider(d, "approuvee")}>Approuver</button>}
              {d.circonscription_prise && ["brouillon", "soumise", "en_verification"].includes(d.statut) && <button className="btn btn-sm btn-warning me-1" onClick={() => changerTitulaire(d)}>Changer le titulaire</button>}
              {["brouillon", "soumise", "en_verification"].includes(d.statut) && <button className="btn btn-sm btn-outline-danger me-1" onClick={() => decider(d, "rejetee")}>Rejeter</button>}
              {d.statut === "approuvee" && <button className="btn btn-sm btn-outline-danger" onClick={() => decider(d, "suspendue")}>Suspendre</button>}
            </td></tr>))}</tbody></table></div>
    </>
  )
}

function Delegations() {
  const [liste, erreur, recharger] = useDonnees(() => rpc("console_inst_delegations"), [])
  const [message, executer] = useAction()
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  const regler = (d, p) => executer(() => rpc("console_inst_delegation", { p_delegation: d.id, p }).then(recharger))
  return (
    <>
      {message}
      {!liste.length && <p className="text-muted">Aucune délégation (elles sont créées à l'approbation de la première demande d'une circonscription).</p>}
      {liste.map((d) => (
        <div className="card mb-2" key={d.id}><div className="card-body py-2 small">
          <div className="d-flex flex-wrap justify-content-between gap-2"><strong>{d.nom}</strong>
            <div className="d-flex gap-3">
              <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id={`a-${d.id}`} checked={d.actif} onChange={(e) => regler(d, { actif: e.target.checked })} /><label className="form-check-label" htmlFor={`a-${d.id}`}>active</label></div>
              <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id={`c-${d.id}`} checked={d.collaborateurs_autorises} onChange={(e) => regler(d, { collaborateurs_autorises: e.target.checked })} /><label className="form-check-label" htmlFor={`c-${d.id}`}>collaborateurs</label></div>
            </div></div>
          <div className="mt-1">Données lisibles par l'IA :{" "}
            {Object.entries(CATEGORIES_IA).map(([k, l]) => <label className="me-3" key={k}><input type="checkbox" className="form-check-input me-1" checked={d.ia_categories.includes(k)}
              onChange={(e) => regler(d, { ia_categories: e.target.checked ? [...d.ia_categories, k] : d.ia_categories.filter((x) => x !== k) })} />{l}</label>)}</div>
          <ul className="mb-0 mt-1">{d.membres.map((m) => <li key={m.id} className={m.actif ? "" : "text-muted"}>{m.role} · {m.prenom} {m.nom} · {m.email} · depuis le {date(m.debut)}
            {!m.actif && ` · révoqué le ${date(m.revoque_le)} (${m.motif_revocation || "—"})`}</li>)}</ul>
        </div></div>))}
    </>
  )
}

function Referentiel() {
  const [regions, erreur, recharger] = useDonnees(() => rpc("console_inst_referentiel"), [])
  const [message, executer] = useAction()
  const [ouverte, setOuverte] = useState(null), [nouveau, setNouveau] = useState("")
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!regions) return <Chargement />
  const enregistrer = (objet, x, modifs) => executer(() => rpc("console_inst_circonscription", { p: { objet, id: x?.id, nom: x?.nom, code: x?.code, region_id: x?.region_id, actif: x?.actif, verifie: x?.verifie, ...modifs } }).then(recharger))
  const renommer = (objet, x, region_id) => { const nom = prompt("Nom officiel :", x.nom); if (nom === null) return; const code = prompt("Code (facultatif) :", x.code || ""); enregistrer(objet, { ...x, region_id }, { nom, code: code || "" }) }
  return (
    <>
      {message}
      <p className="small text-muted">Pré-rempli avec les 10 régions et 58 départements du Cameroun, marqués « à vérifier ». Chaque modification est historisée.</p>
      {regions.map((r) => (
        <div className="card mb-2" key={r.id}><div className="card-body py-2 small">
          <div className="d-flex flex-wrap justify-content-between gap-2">
            <button className="btn btn-link p-0 fw-semibold" onClick={() => setOuverte(ouverte === r.id ? null : r.id)}>{r.nom}</button>
            <span>{r.code || "sans code"} · {r.verifie ? <span className="text-success">vérifiée</span> : <span className="text-warning">à vérifier</span>} · {r.actif ? "active" : "inactive"}
              {r.delegation && ` · ${r.delegation.nom}`}
              <button className="btn btn-sm btn-link" onClick={() => renommer("region", r)}>modifier</button>
              <button className="btn btn-sm btn-link" onClick={() => enregistrer("region", r, { verifie: !r.verifie })}>{r.verifie ? "remettre à vérifier" : "valider"}</button>
              <button className="btn btn-sm btn-link" onClick={() => enregistrer("region", r, { actif: !r.actif })}>{r.actif ? "désactiver" : "activer"}</button></span></div>
          {ouverte === r.id && <>
            <table className="table table-sm mt-2 mb-1"><tbody>{r.departements.map((d) => (
              <tr key={d.id}><td>{d.nom}</td><td>{d.code || "—"}</td><td>{d.etablissements} établissement(s)</td><td>{d.delegation ? d.delegation.nom : "—"}</td>
                <td>{d.verifie ? <span className="text-success">vérifié</span> : <span className="text-warning">à vérifier</span>}{d.actif ? "" : " · inactif"}</td>
                <td className="text-end text-nowrap"><button className="btn btn-sm btn-link" onClick={() => renommer("departement", d, r.id)}>modifier</button>
                  <button className="btn btn-sm btn-link" onClick={() => enregistrer("departement", { ...d, region_id: r.id }, { verifie: !d.verifie })}>{d.verifie ? "à vérifier" : "valider"}</button>
                  <button className="btn btn-sm btn-link" onClick={() => enregistrer("departement", { ...d, region_id: r.id }, { actif: !d.actif })}>{d.actif ? "désactiver" : "activer"}</button></td></tr>))}</tbody></table>
            <div className="d-flex gap-2"><input className="form-control form-control-sm w-auto" placeholder="Nouveau département" value={nouveau} onChange={(e) => setNouveau(e.target.value)} />
              <button className="btn btn-sm btn-outline-primary" disabled={!nouveau.trim()} onClick={() => { enregistrer("departement", { region_id: r.id }, { nom: nouveau }); setNouveau("") }}>Ajouter</button></div>
          </>}
        </div></div>))}
    </>
  )
}

function Rattachements() {
  const [liste, erreur, recharger] = useDonnees(() => rpc("console_inst_rattachements"), [])
  const [message, executer] = useAction()
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  const verifierRattachement = (e, ok) => {
    const motif = ok ? "" : prompt("Motif du refus :")
    if (!ok && !motif) return
    executer(() => rpc("inst_verifier_rattachement", { p_etablissement: e.id, p_confirmer: ok, p_motif: motif }).then(recharger))
  }
  return (
    <>
      {message}
      <p className="small text-muted">Établissements sans rattachement vérifié. Les rattachements ne sont jamais modifiés silencieusement : l'établissement déclare, la délégation ou le propriétaire vérifie.</p>
      <table className="table table-sm small align-middle"><thead><tr><th>Établissement</th><th>Ville</th><th>Déclaré</th><th>Statut</th><th /></tr></thead>
        <tbody>{liste.map((e) => <tr key={e.id}><td>{e.nom}</td><td>{e.ville}</td><td>{e.region ? `${e.region} › ${e.departement}` : "—"}</td><td>{e.statut}</td>
          <td>{e.statut === "declare" && <><button className="btn btn-sm btn-success me-1" onClick={() => verifierRattachement(e, true)}>Vérifier</button>
            <button className="btn btn-sm btn-outline-danger" onClick={() => verifierRattachement(e, false)}>Refuser</button></>}</td></tr>)}</tbody></table>
    </>
  )
}

function Campagnes() {
  const [d, erreur, recharger] = useDonnees(() => rpc("console_inst_parametres", { p: null }), [])
  const [message, executer] = useAction()
  const vide = { niveau: "etablissement", exercice: anneeCourante(), periode: "t1", ouverture: "", echeance: "", prolongation: "", ouvert: true, alertes: "7, 3, 1, 0, -1" }
  const [f, setF] = useState(vide), [erreurSaisie, setErreurSaisie] = useState("")
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!d) return <Chargement />
  const p = d.parametres
  const enregistrer = () => {
    const e = controlerCampagne(f)
    setErreurSaisie(e)
    if (e) return
    executer(() => rpc("console_inst_campagne", { p: { ...f, exercice: f.exercice.trim(), alertes_jours: f.alertes.split(",").map((x) => x.trim()).filter(Boolean) } })
      .then(() => { setF(vide); recharger() }), "Campagne enregistrée ; les destinataires sont prévenus si elle est nouvelle ou si ses dates ont changé.")
  }
  const niveaux = { etablissement: "Fiches des établissements", departement: "Synthèses départementales", region: "Synthèses régionales" }
  return (
    <>
      {message}
      <div className="alert alert-info small">Les délégations fixent désormais elles-mêmes leur calendrier (menu « Campagnes et formules » de leur espace) :
        la DDES pour les fiches de ses établissements, la DRES pour les synthèses de ses délégations départementales. Une campagne créée ici est
        nationale : elle s'applique là où la délégation n'a pas fixé sa propre campagne pour la même année et la même période.</div>
      <div className="card mb-3"><div className="card-body small">
        <h2 className="h6">Formules (centralisées, documentées dans docs/PILOTAGE_INSTITUTIONNEL.md)</h2>
        <p className="mb-1">Couverture = (leçons faites en présentiel{p.inclure_digitalise ? " + leçons digitalisées faites" : ""}) / leçons prévues ; heures = heures faites / heures dues ; assiduité = (heures dues − absences) / heures dues. Agrégation : somme des numérateurs / somme des dénominateurs.</p>
        <label className="me-3"><input type="checkbox" className="form-check-input me-1" checked={p.inclure_digitalise} onChange={(e) => executer(() => rpc("console_inst_parametres", { p: { inclure_digitalise: e.target.checked } }).then(recharger))} />compter les leçons digitalisées dans la couverture (à valider)</label>
        <label><input type="checkbox" className="form-check-input me-1" checked={p.formules_validees} onChange={(e) => executer(() => rpc("console_inst_parametres", { p: { formules_validees: e.target.checked } }).then(recharger))} />formules validées par l'autorité compétente (retire la mention « à valider »)</label>
      </div></div>
      <div className="card mb-3"><div className="card-body small">
        <h2 className="h6">{f.id ? "Modifier la campagne" : "Nouvelle campagne nationale"}</h2>
        {erreurSaisie && <div className="alert alert-danger py-2">{erreurSaisie}</div>}
        <FormulaireCampagne valeur={f} setValeur={(x) => { setErreurSaisie(""); setF(x) }} onEnregistrer={enregistrer} onAnnuler={() => { setErreurSaisie(""); setF(vide) }}
          niveauChoix={<div className="col-sm-4 col-lg-3"><label className="form-label small" htmlFor="camp-niveau">Niveau</label>
            <select id="camp-niveau" className="form-select form-select-sm" disabled={!!f.id} value={f.niveau} onChange={(e) => setF({ ...f, niveau: e.target.value })}>
              {Object.entries(niveaux).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>} />
      </div></div>
      {Object.entries(niveaux).map(([k, l]) => (
        <div key={k}><h2 className="h6">{l}</h2>
          <TableauCampagnes avecPortee campagnes={d.campagnes.filter((c) => c.niveau === k)}
            onModifier={(c) => { setErreurSaisie(""); setF({ id: c.id, niveau: c.niveau, exercice: c.exercice, periode: c.periode, ouverture: c.ouverture, echeance: c.echeance,
              prolongation: c.prolongation || "", ouvert: c.ouvert, alertes: c.alertes_jours.join(", ") }); window.scrollTo({ top: 0, behavior: "smooth" }) }} /></div>))}
    </>
  )
}

function Derogations() {
  const [d, erreur, recharger] = useDonnees(() => rpc("console_inst_parametres", { p: null }), [])
  const [delegations] = useDonnees(() => rpc("console_inst_delegations"), [])
  const [referentiel] = useDonnees(() => rpc("console_inst_referentiel"), [])
  const [message, executer] = useAction()
  const [f, setF] = useState({ delegation: "", departement: "", jours: 7, motif: "" })
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!d) return <Chargement />
  const regionales = (delegations || []).filter((x) => x.niveau === "region")
  const deps = (referentiel || []).flatMap((r) => r.departements.map((x) => ({ ...x, region: r.nom })))
  return (
    <>
      {message}
      <p className="small text-muted">Par défaut, une délégation régionale ne voit pas les fiches brutes des établissements. Un accès exceptionnel est explicite, limité (90 jours au plus) et chaque consultation est journalisée.</p>
      <div className="row g-2 small mb-3">
        <div className="col-md-3"><select className="form-select form-select-sm" value={f.delegation} onChange={(e) => setF({ ...f, delegation: e.target.value })}><option value="">Délégation régionale…</option>{regionales.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></div>
        <div className="col-md-3"><select className="form-select form-select-sm" value={f.departement} onChange={(e) => setF({ ...f, departement: e.target.value })}><option value="">Département…</option>{deps.map((x) => <option key={x.id} value={x.id}>{x.region} › {x.nom}</option>)}</select></div>
        <div className="col-md-1"><input type="number" min={1} max={90} className="form-control form-control-sm" value={f.jours} onChange={(e) => setF({ ...f, jours: Number(e.target.value) })} /></div>
        <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Motif" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></div>
        <div className="col-md-2"><button className="btn btn-sm btn-primary" onClick={() => executer(() => rpc("console_inst_derogation", { p_delegation: f.delegation, p_departement: f.departement, p_etablissement: null, p_jours: f.jours, p_motif: f.motif }).then(recharger))}>Accorder</button></div>
      </div>
      <table className="table table-sm small"><thead><tr><th>Délégation</th><th>Périmètre</th><th>Motif</th><th>Du</th><th>Au</th><th /></tr></thead>
        <tbody>{d.derogations.map((g) => <tr key={g.id}><td>{g.delegation}</td><td>{g.etablissement || g.departement}</td><td>{g.motif}</td><td>{dateHeure(g.debut)}</td><td>{dateHeure(g.fin)}</td>
          <td>{g.revoquee_le ? `révoquée le ${dateHeure(g.revoquee_le)}` : <button className="btn btn-sm btn-outline-danger" onClick={() => executer(() => rpc("console_inst_derogation_revoquer", { p_id: g.id }).then(recharger))}>Révoquer</button>}</td></tr>)}</tbody></table>
    </>
  )
}

function JournalInstitutionnel() {
  const [liste, erreur] = useDonnees(() => rpc("console_inst_journal", { p_limite: 500 }), [])
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <p className="small text-muted">Journal en ajout seul : aucune ligne ne peut être modifiée ni supprimée (contrôle en base).</p>
      <table className="table table-sm small"><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Objet</th><th>Résultat</th><th>Détails</th></tr></thead>
        <tbody>{liste.map((j, i) => <tr key={i}><td className="text-nowrap">{dateHeure(j.le)}</td><td>{j.auteur}</td><td>{j.action}</td><td>{j.objet}</td><td>{j.resultat}</td>
          <td className="text-muted text-break" style={{ maxWidth: 360 }}>{JSON.stringify(j.details)}</td></tr>)}</tbody></table>
    </>
  )
}
