// Mes automatisations (tout le personnel, pour son seul compte) : la demande écrite en langage naturel est traduite en règle
// (catalogue guidé, src/lib/automatisations.js), vérifiée par la personne, puis exécutée côté serveur ; rapports reçus.
// Administration : Paramètres → Mes automatisations ; autres rôles : rubrique « Automatisations ».
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { ACTIONS, DESTINATAIRES, interpreter, JOURS, PERIODES, resumer } from "../lib/automatisations.js"
import { date, dateHeure } from "../lib/format.js"
import { fcfa } from "../lib/financePdf.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const EXEMPLES = {
  surveillant: "Chaque vendredi à 16 h, prépare un rapport des absences de la semaine et envoie-le au directeur.",
  enseignant: "Chaque lundi à 7 h, envoie-moi la liste des notes que je n'ai pas encore saisies.",
  comptable: "Le 5 de chaque mois à 8 h, envoie à la direction la liste des élèves non en règle.",
  admin: "Du lundi au vendredi à 17 h, envoie-moi le rapport des paiements du jour.",
}
const tr = (x, v) => t(x, v)

export default function Automatisations({ rubrique = false }) {
  const [vue, setVue] = useState("liste")
  const [message, setMessage] = useState({ ok: "", erreur: "" })
  const [regles, erreur, recharger] = useDonnees(async () => verifier(await supabase.from("automatisations").select("*").order("cree_le")), [])
  const [rapports, , rechargerRapports] = useDonnees(async () => verifier(await supabase.from("automatisations_rapports").select("*").order("cree_le", { ascending: false }).limit(200)), [])
  const nonLus = (rapports || []).filter((r) => !r.lu_le).length
  return (
    <section aria-labelledby="auto-titre">
      {rubrique ? <h1 className="h3" id="auto-titre">{t("Mes automatisations")}</h1> : <h2 className="h5" id="auto-titre">{t("Mes automatisations")}</h2>}
      <p className="text-muted small">{t("Décrivez en quelques mots ce que vous voulez recevoir automatiquement. NexIA School le traduit en règle, que vous vérifiez avant de l'enregistrer. Vos automatisations ne concernent que votre compte et les données que votre rôle vous permet de voir.")}</p>
      <ul className="nav nav-pills mb-3 gap-1">
        {[["liste", t("Mes automatisations")], ["nouvelle", t("Nouvelle automatisation")], ["rapports", t("Rapports reçus")]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => { setVue(k); setMessage({ ok: "", erreur: "" }) }}>
            {l}{k === "rapports" && nonLus > 0 && <span className="badge text-bg-danger ms-1">{nonLus}</span>}</button></li>))}
      </ul>
      {message.ok && <div className="alert alert-success small py-2">{message.ok}</div>}
      <Alerte>{message.erreur || erreur}</Alerte>
      {vue === "liste" && <Liste regles={regles} recharger={() => { recharger(); rechargerRapports() }} onMessage={setMessage} onNouvelle={() => setVue("nouvelle")} />}
      {vue === "nouvelle" && <Nouvelle onEnregistre={(m) => { setMessage({ ok: m, erreur: "" }); recharger(); setVue("liste") }} onErreur={(e) => setMessage({ ok: "", erreur: e })} />}
      {vue === "rapports" && <Rapports rapports={rapports} recharger={rechargerRapports} />}
    </section>
  )
}

// --- Nouvelle automatisation : langage naturel → règle vérifiée --------------------------------------------------------
function Nouvelle({ onEnregistre, onErreur }) {
  const { profil } = useSession()
  const role = profil?.role || "admin"
  const [texte, setTexte] = useState("")
  const [regle, setRegle] = useState(null), [enCours, setEnCours] = useState(false)
  const actionsPermises = Object.entries(ACTIONS).filter(([, a]) => a.roles.includes(role))
  function interpreterTexte(e) {
    e.preventDefault()
    const r = interpreter(texte, role)
    setRegle({ ...r, action: r.manquants.includes("droit") ? "" : r.action || "", libelle: "" })
  }
  const maj = (k, v) => setRegle({ ...regle, [k]: v })
  const majF = (k, v) => setRegle({ ...regle, frequence: { ...regle.frequence, [k]: v } })
  const majP = (k, v) => setRegle({ ...regle, parametres: { ...regle.parametres, [k]: v } })
  const valide = regle && regle.action && (regle.frequence.type !== "hebdo" || regle.frequence.jours.length > 0)
    && (regle.action !== "rappel" || (regle.parametres.texte || "").trim().length >= 2)
  async function enregistrer() {
    setEnCours(true)
    try {
      await rpc("automatisation_enregistrer", { p: { libelle: regle.libelle, texte_source: texte, action: regle.action, parametres: regle.parametres,
        frequence: regle.frequence, destinataire: regle.action === "rappel" ? "moi" : regle.destinataire } })
      onEnregistre(t("Automatisation enregistrée : {v0}", { v0: resumer({ ...regle, destinataire: regle.action === "rappel" ? "moi" : regle.destinataire }, tr) }))
    } catch (err) { onErreur(err.message) } finally { setEnCours(false) }
  }
  return (
    <div style={{ maxWidth: 900 }}>
      <form onSubmit={interpreterTexte} className="mb-3">
        <label className="form-label fw-semibold" htmlFor="auto-texte">{t("Que voulez-vous automatiser ?")}</label>
        <textarea id="auto-texte" className="form-control mb-2" rows={3} maxLength={1000} placeholder={t(EXEMPLES[role] || EXEMPLES.admin)} value={texte} onChange={(e) => setTexte(e.target.value)} />
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button className="btn btn-primary" disabled={texte.trim().length < 5}>{t("Traduire en règle")}</button>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setTexte(t(EXEMPLES[role] || EXEMPLES.admin))}>{t("Utiliser l'exemple")}</button>
        </div>
        <p className="small text-muted mt-2 mb-0">{t("Possible pour votre rôle : {v0}.", { v0: actionsPermises.map(([, a]) => t(a.libelle).toLowerCase()).join(", ") })}</p>
      </form>
      {regle && (
        <div className="card border-primary"><div className="card-body">
          <h3 className="h6">{t("Règle proposée — vérifiez et corrigez si besoin")}</h3>
          {regle.manquants.includes("action") && <div className="alert alert-warning small py-2">{t("Je n'ai pas reconnu ce qu'il faut préparer : choisissez-le ci-dessous.")}</div>}
          {regle.manquants.includes("droit") && <div className="alert alert-warning small py-2">{t("Cette demande n'est pas permise pour votre rôle : choisissez une action autorisée.")}</div>}
          {regle.remarques.includes("heure_defaut") && <div className="alert alert-info small py-2">{t("Aucune heure indiquée : 07:00 par défaut.")}</div>}
          <div className="row g-2 mb-2">
            <div className="col-md-6"><label className="form-label small mb-1">{t("Action")}</label>
              <select className="form-select form-select-sm" value={regle.action} onChange={(e) => setRegle({ ...regle, action: e.target.value,
                parametres: e.target.value === "rappel" ? { texte: regle.parametres.texte || "" } : { periode: regle.parametres.periode || "semaine" } })}>
                <option value="">{t("Choisir…")}</option>{actionsPermises.map(([k, a]) => <option key={k} value={k}>{t(a.libelle)}</option>)}</select></div>
            {regle.action === "rappel"
              ? <div className="col-md-6"><label className="form-label small mb-1">{t("Texte du rappel")}</label>
                  <input className="form-control form-control-sm" maxLength={300} value={regle.parametres.texte || ""} onChange={(e) => majP("texte", e.target.value)} /></div>
              : <div className="col-md-3"><label className="form-label small mb-1">{t("Période couverte")}</label>
                  <select className="form-select form-select-sm" value={regle.parametres.periode || "jour"} onChange={(e) => majP("periode", e.target.value)}>
                    {Object.entries(PERIODES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>}
            {regle.action === "rapport_absences" && (
              <div className="col-md-3"><label className="form-label small mb-1" htmlFor="auto-seuil">{t("Seulement les élèves ayant au moins (h non justifiées)")}</label>
                <input id="auto-seuil" type="number" min={1} max={500} className="form-control form-control-sm" placeholder={t("tous")} value={regle.parametres.seuil_heures ?? ""}
                  onChange={(e) => majP("seuil_heures", e.target.value === "" ? undefined : Math.max(1, Math.min(500, Math.round(Number(e.target.value)))))} /></div>)}
            {regle.action !== "rappel" && (
              <div className="col-md-3"><label className="form-label small mb-1">{t("Envoyer à")}</label>
                <select className="form-select form-select-sm" value={regle.destinataire} onChange={(e) => maj("destinataire", e.target.value)}>
                  {Object.entries(DESTINATAIRES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>)}
            <div className="col-md-3"><label className="form-label small mb-1">{t("Fréquence")}</label>
              <select className="form-select form-select-sm" value={regle.frequence.type} onChange={(e) => setRegle({ ...regle, frequence: { ...regle.frequence, type: e.target.value,
                jours: e.target.value === "quotidien" ? [1, 2, 3, 4, 5, 6, 7] : e.target.value === "hebdo" ? (regle.frequence.jours.length === 7 ? [1] : regle.frequence.jours) : [],
                jour_mois: e.target.value === "mensuel" ? regle.frequence.jour_mois || 1 : null } })}>
                <option value="quotidien">{t("Chaque jour")}</option><option value="hebdo">{t("Certains jours de la semaine")}</option><option value="mensuel">{t("Chaque mois")}</option></select></div>
            <div className="col-md-2"><label className="form-label small mb-1">{t("Heure")}</label>
              <input type="time" className="form-control form-control-sm" value={regle.frequence.heure} onChange={(e) => majF("heure", e.target.value || "07:00")} /></div>
            {regle.frequence.type === "mensuel" && (
              <div className="col-md-2"><label className="form-label small mb-1">{t("Jour du mois")}</label>
                <input type="number" min={1} max={31} className="form-control form-control-sm" value={regle.frequence.jour_mois || 1}
                  onChange={(e) => majF("jour_mois", Math.min(31, Math.max(1, Number(e.target.value) || 1)))} /></div>)}
            {regle.frequence.type === "hebdo" && (
              <div className="col-12 d-flex flex-wrap gap-1">{JOURS.map((j, k) => (
                <button key={j} type="button" className={`btn btn-sm ${regle.frequence.jours.includes(k + 1) ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={regle.frequence.jours.includes(k + 1)}
                  onClick={() => majF("jours", regle.frequence.jours.includes(k + 1) ? regle.frequence.jours.filter((x) => x !== k + 1) : [...regle.frequence.jours, k + 1].sort())}>{t(j)}</button>))}
              </div>)}
            <div className="col-md-6"><label className="form-label small mb-1">{t("Nom (facultatif)")}</label>
              <input className="form-control form-control-sm" maxLength={120} value={regle.libelle} onChange={(e) => maj("libelle", e.target.value)} /></div>
          </div>
          {valide && <p className="small mb-2"><strong>{t("En clair :")}</strong> {resumer({ ...regle, destinataire: regle.action === "rappel" ? "moi" : regle.destinataire }, tr)}</p>}
          <button type="button" className="btn btn-success" disabled={!valide || enCours} onClick={enregistrer}>{enCours ? t("Enregistrement…") : t("Enregistrer l'automatisation")}</button>
        </div></div>)}
    </div>
  )
}

// --- Liste des règles -----------------------------------------------------------------------------------------------------
function Liste({ regles, recharger, onMessage, onNouvelle }) {
  if (!regles) return <Chargement />
  async function faire(nom, params, ok) {
    try { const r = await rpc(nom, params); onMessage({ ok: typeof ok === "function" ? ok(r) : ok, erreur: "" }); recharger() } catch (e) { onMessage({ ok: "", erreur: e.message }) }
  }
  if (!regles.length) return (
    <div className="text-center p-4 border rounded"><p className="mb-2">{t("Aucune automatisation pour le moment.")}</p>
      <button type="button" className="btn btn-primary" onClick={onNouvelle}>{t("Créer ma première automatisation")}</button></div>)
  return (
    <div className="list-group" style={{ maxWidth: 980 }}>{regles.map((a) => (
      <div className="list-group-item" key={a.id}>
        <div className="d-flex flex-wrap justify-content-between gap-2">
          <div><strong>{a.libelle || t(ACTIONS[a.action]?.libelle || a.action)}</strong>
            <div className="small">{resumer({ action: a.action, parametres: a.parametres, frequence: a.frequence, destinataire: a.destinataire }, tr)}</div>
            {a.texte_source && <div className="small text-muted fst-italic">« {a.texte_source} »</div>}
            <div className="small text-muted">{a.active && a.prochaine_execution ? t("Prochaine exécution : {v0}", { v0: dateHeure(a.prochaine_execution) }) : t("En pause")}
              {a.derniere_execution && ` · ${t("dernière : {v0}", { v0: dateHeure(a.derniere_execution) })}`}</div>
            {a.derniere_erreur && <div className="small text-danger">{a.derniere_erreur}</div>}
          </div>
          <div className="d-flex flex-wrap gap-1 align-items-start">
            <div className="form-check form-switch mt-1 me-2"><input className="form-check-input" type="checkbox" role="switch" checked={a.active} aria-label={t("Active")}
              onChange={(e) => faire("automatisation_activer", { p_id: a.id, p_active: e.target.checked }, e.target.checked ? t("Automatisation activée.") : t("Automatisation mise en pause."))} /></div>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => faire("automatisation_executer_maintenant", { p_id: a.id }, (n) => t("Exécutée : {v0} rapport(s) envoyé(s).", { v0: n }))}>{t("Exécuter maintenant")}</button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => confirm(t("Supprimer cette automatisation ?")) && faire("automatisation_supprimer", { p_id: a.id }, t("Automatisation supprimée."))}>{t("Supprimer")}</button>
          </div>
        </div>
      </div>))}
    </div>
  )
}

// --- Rapports reçus -------------------------------------------------------------------------------------------------------
function Rapports({ rapports, recharger }) {
  const [ouvert, setOuvert] = useState(null)
  if (!rapports) return <Chargement />
  if (!rapports.length) return <p className="text-muted">{t("Aucun rapport reçu pour le moment.")}</p>
  async function ouvrir(r) {
    setOuvert(ouvert === r.id ? null : r.id)
    if (!r.lu_le) { await rpc("rapport_marquer_lu", { p_id: r.id }).catch(() => {}); recharger() }
  }
  return (
    <div className="list-group" style={{ maxWidth: 980 }}>{rapports.map((r) => (
      <div className="list-group-item" key={r.id}>
        <button type="button" className="btn btn-link text-start text-decoration-none p-0 w-100 d-flex justify-content-between gap-2" onClick={() => ouvrir(r)} aria-expanded={ouvert === r.id}>
          <span className={r.lu_le ? "" : "fw-bold"}>{t(r.titre)}</span>
          <span className="small text-muted text-nowrap">{dateHeure(r.cree_le)} {!r.lu_le && <span className="badge text-bg-danger">{t("nouveau")}</span>}</span>
        </button>
        <div className="small text-muted">{t("De : {v0}", { v0: r.auteur })}</div>
        {ouvert === r.id && <div className="mt-2"><ContenuRapport r={r} /></div>}
      </div>))}
    </div>
  )
}

function Tableau({ entetes, lignes }) {
  if (!lignes.length) return <p className="small text-muted mb-0">{t("Rien à signaler.")}</p>
  return (
    <div className="table-responsive"><table className="table table-sm small mb-0">
      <thead><tr>{entetes.map((e) => <th key={e}>{e}</th>)}</tr></thead>
      <tbody>{lignes.map((l, k) => <tr key={k}>{l.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
  )
}

export function ContenuRapport({ r }) {
  const c = r.contenu || {}
  const periode = c.du ? <p className="small mb-1">{t("Du {v0} au {v1}", { v0: date(c.du), v1: date(c.au) })}</p> : null
  switch (r.action) {
    case "rappel": return <div className="alert alert-info mb-0">{c.texte}</div>
    case "rapport_absences": return <>{periode}
      <p className="small">{t("{v0} h non justifiée(s), {v1} h justifiée(s), {v2} élève(s) absent(s), {v3} retard(s).", { v0: c.heures_non_justifiees, v1: c.heures_justifiees, v2: c.eleves_absents, v3: c.retards })}</p>
      <Tableau entetes={[t("Classe"), t("Heures NJ"), t("Heures J"), t("Élèves")]} lignes={(c.par_classe || []).map((x) => [x.classe, x.heures_nj, x.heures_j, x.eleves])} />
      {c.seuil_heures > 0 && <p className="small mb-1">{t("Élèves ayant au moins {v0} h non justifiée(s) sur la période : {v1}.", { v0: c.seuil_heures, v1: (c.eleves || []).length })}</p>}
      {(c.eleves || []).length > 0 && <><h4 className="h6 mt-2">{c.seuil_heures > 0 ? t("Élèves au-dessus du seuil") : t("Élèves les plus absents")}</h4>
        <Tableau entetes={[t("Élève"), t("Classe"), t("Heures NJ"), t("Heures J")]} lignes={c.eleves.map((x) => [x.eleve, x.classe, x.heures_nj, x.heures_j])} /></>}</>
    case "rapport_saisie": return <>
      <p className="small">{c.sequence ? t("Séquence {v0} : {v1} note(s) manquante(s).", { v0: c.sequence, v1: c.total_manquantes }) : t("Aucune séquence ouverte.")}</p>
      <Tableau entetes={[t("Classe"), t("Matière"), t("Enseignant"), t("Notes manquantes")]} lignes={(c.lignes || []).map((x) => [x.classe, x.matiere, x.enseignant || "—", x.notes_manquantes])} /></>
    case "rapport_discipline": return <>{periode}
      <Tableau entetes={[t("Date"), t("Élève"), t("Classe"), t("Infraction")]} lignes={(c.incidents || []).map((x) => [date(x.date), x.eleve, x.classe, x.infraction])} /></>
    case "rapport_paiements": return <>{periode}
      <p className="small">{t("{v0} paiement(s), total {v1}.", { v0: c.nombre, v1: fcfa(c.total) })}</p>
      <Tableau entetes={[t("Mode"), t("Montant")]} lignes={Object.entries(c.par_mode || {}).map(([m, v]) => [m, fcfa(v)])} /></>
    case "rapport_impayes": return <>
      <p className="small">{t("{v0} élève(s) non en règle au {v1} ; montant en retard : {v2}.", { v0: c.eleves_non_en_regle, v1: date(c.au), v2: fcfa(c.montant_en_retard) })}</p>
      <Tableau entetes={[t("Élève"), t("Classe"), t("En retard")]} lignes={(c.eleves || []).map((x) => [x.eleve, x.classe, fcfa(x.en_retard)])} /></>
    default: return <pre className="small">{JSON.stringify(c, null, 2)}</pre>
  }
}
