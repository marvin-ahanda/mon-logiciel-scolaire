// Console du propriétaire de la plateforme : vue d'ensemble, établissements, utilisateurs, journal.
// Toutes les données viennent des fonctions « console_* » de la base, qui vérifient le propriétaire et journalisent.
import { useMemo, useState } from "react"
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { LIBELLES_ROLES } from "../composants/MiseEnPage.jsx"
import { BoutonGoogle } from "./Acces.jsx"
import { comparerNoms, date, dateHeure } from "../lib/format.js"
import { siteAffiche } from "../lib/logo.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase } from "../supabase.js"

const LIMITE_STOCKAGE = 1024 ** 3, LIMITE_BASE = 500 * 1024 ** 2     // plan Free de Supabase
const entier = new Intl.NumberFormat("fr-FR")
export function octets(n) {
  const v = Number(n || 0)
  if (v < 1024) return `${v} o`
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1).replace(".", ",")} Ko`
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`
  return `${(v / 1024 ** 3).toFixed(2).replace(".", ",")} Go`
}
export function depuis(d) {
  if (!d) return "jamais"
  const j = Math.floor((Date.now() - new Date(d)) / 86400000)
  return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : j < 30 ? `il y a ${j} j` : date(d)
}
const pl = (n, mot, pluriel = mot + "s") => `${entier.format(n || 0)} ${Number(n) > 1 ? pluriel : mot}`
const actifRecent = (d, jours) => d && Date.now() - new Date(d) < jours * 86400000

function Statut({ e }) {
  if (e.suspendu_le) return <span className="badge text-bg-danger">Suspendu</span>
  if (actifRecent(e.derniere_activite, 30)) return <span className="badge text-bg-success">Actif</span>
  return <span className="badge text-bg-secondary">Inactif</span>
}

function Carte({ titre, valeur, detail, children }) {
  return (
    <div className="col-6 col-md-4 col-xl-3"><div className="card h-100 shadow-sm"><div className="card-body">
      <div className="text-muted small">{titre}</div>
      <div className="fs-3 fw-semibold lh-sm">{valeur}</div>
      {detail && <div className="small text-muted mt-1">{detail}</div>}
      {children}
    </div></div></div>
  )
}

function Jauge({ valeur, max, libelle }) {
  const pct = Math.min(100, (100 * valeur) / max)
  return (
    <div className="mt-2" title={libelle}>
      <div className="progress" style={{ height: 6 }} role="progressbar" aria-label={libelle} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-bar ${pct > 85 ? "bg-danger" : pct > 60 ? "bg-warning" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="small text-muted mt-1">{pct.toFixed(1).replace(".", ",")} % de {octets(max)}</div>
    </div>
  )
}

// --- Vue d'ensemble -------------------------------------------------------------------------------------------
function VueEnsemble() {
  const [r, erreur] = useDonnees(() => rpc("console_resume"), [])
  if (!r) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const maxi = Math.max(1, ...r.inscriptions_par_mois.map((m) => m.n))
  const mois = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
  return (
    <>
      <div className="row g-3 mb-4">
        <Carte titre="Établissements" valeur={entier.format(r.etablissements)} detail={`+${r.nouveaux_7j} cette semaine · +${r.nouveaux_30j} sur 30 jours`} />
        <Carte titre="Établissements actifs" valeur={`${r.actifs_7j} / ${r.actifs_30j}`} detail="sur 7 jours / sur 30 jours" />
        <Carte titre="Utilisateurs (personnel)" valeur={entier.format(r.personnels)}
               detail={`${pl(r.par_role?.admin, "admin", "admin")} · ${pl(r.par_role?.enseignant, "enseignant")} · ${pl(r.par_role?.surveillant, "surveillant")}`} />
        <Carte titre="Élèves" valeur={entier.format(r.eleves)} detail={pl(r.classes, "classe")} />
        <Carte titre="Notes saisies" valeur={entier.format(r.notes)} detail={`${entier.format(r.notes_7j)} sur 7 jours`} />
        <Carte titre="Suspendus" valeur={r.suspendus} detail="établissements sans accès" />
        <Carte titre="Agents IA (API)" valeur={r.api_actives} detail={`établissement(s) avec accès · ${pl(r.appels_api_30j, "action")} sur 30 j`} />
        <Carte titre="Stockage (photos, logos)" valeur={octets(r.stockage_octets)}><Jauge valeur={r.stockage_octets} max={LIMITE_STOCKAGE} libelle="Stockage utilisé" /></Carte>
        <Carte titre="Base de données" valeur={octets(r.base_octets)}><Jauge valeur={r.base_octets} max={LIMITE_BASE} libelle="Base de données utilisée" /></Carte>
      </div>
      <div className="row g-3">
        <div className="col-lg-8"><div className="card shadow-sm"><div className="card-body">
          <h2 className="h6">Nouveaux établissements par mois</h2>
          <div className="histogramme" role="img" aria-label="Nouveaux établissements par mois sur douze mois (détail au survol)">
            {r.inscriptions_par_mois.map((m) => (
              <div className="histo-col" key={m.mois} title={`${mois(m.mois)} : ${m.n} établissement(s)`}>
                <span className="histo-valeur">{m.n || ""}</span>
                <div className="histo-barre" style={{ height: `${(100 * m.n) / maxi}%` }} />
                <span className="histo-libelle">{mois(m.mois)}</span>
              </div>))}
          </div>
        </div></div></div>
        <div className="col-lg-4"><div className="card shadow-sm h-100"><div className="card-body">
          <h2 className="h6">Derniers établissements créés</h2>
          <ul className="list-unstyled mb-0">{r.derniers.map((e) => (
            <li key={e.id} className="py-1 border-bottom"><Link to={`/console/etablissements/${e.id}`}>{e.nom}</Link>
              <div className="small text-muted">{e.ville || "—"} · {date(e.cree_le)}</div></li>))}
            {!r.derniers.length && <li className="text-muted">Aucun établissement.</li>}</ul>
        </div></div></div>
      </div>
    </>
  )
}

// --- Liste des établissements ------------------------------------------------------------------------------------
async function exporter(feuille, nom) {
  const { telechargerClasseur } = await import("../lib/excel.js")
  await telechargerClasseur([feuille], nom)
}

function Etablissements() {
  const [liste, erreur] = useDonnees(() => rpc("console_etablissements"), [])
  const [q, setQ] = useState(""), [filtre, setFiltre] = useState("tous"), [tri, setTri] = useState({ cle: "cree_le", sens: -1 })
  const lignes = useMemo(() => {
    if (!liste) return []
    const t = q.trim().toLowerCase()
    return liste.filter((e) => (!t || [e.nom, e.ville, e.fondateur?.nom, e.fondateur?.email].some((x) => String(x || "").toLowerCase().includes(t)))
        && (filtre === "tous" || (filtre === "suspendus" ? e.suspendu_le : filtre === "actifs" ? !e.suspendu_le && actifRecent(e.derniere_activite, 30)
            : !e.suspendu_le && !actifRecent(e.derniere_activite, 30))))
      .sort((a, b) => {
        const va = a[tri.cle], vb = b[tri.cle]
        const c = typeof va === "number" ? va - vb : tri.cle === "nom" ? comparerNoms(va, vb) : String(va || "").localeCompare(String(vb || ""))
        return c * tri.sens
      })
  }, [liste, q, filtre, tri])
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const entete = (cle, lib, droite) => (
    <th className={droite ? "text-end" : undefined} role="button" onClick={() => setTri({ cle, sens: tri.cle === cle ? -tri.sens : -1 })}
        aria-sort={tri.cle === cle ? (tri.sens > 0 ? "ascending" : "descending") : "none"}>{lib}{tri.cle === cle ? (tri.sens > 0 ? " ▲" : " ▼") : ""}</th>)
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input className="form-control" style={{ maxWidth: 320 }} placeholder="Rechercher (nom, ville, fondateur, e-mail)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="form-select" style={{ maxWidth: 220 }} value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Statut">
          <option value="tous">Tous les statuts</option><option value="actifs">Actifs (30 j)</option><option value="inactifs">Inactifs</option><option value="suspendus">Suspendus</option></select>
        <span className="text-muted small">{lignes.length} / {liste.length}</span>
        <button className="btn btn-outline-secondary btn-sm ms-auto" onClick={() => exporter({ titre: "Établissements",
          entetes: ["Établissement", "Ville", "Téléphone", "Site web", "Fondateur", "E-mail du fondateur", "Créé le", "Dernière activité", "Personnel", "Élèves", "Classes", "Notes", "Stockage (octets)", "Statut"],
          lignes: lignes.map((e) => [e.nom, e.ville, e.telephone, siteAffiche(e.site_web), e.fondateur?.nom, e.fondateur?.email, new Date(e.cree_le),
            e.derniere_activite ? new Date(e.derniere_activite) : "", e.personnels, e.eleves, e.classes, e.notes, Number(e.stockage_octets),
            e.suspendu_le ? "Suspendu" : actifRecent(e.derniere_activite, 30) ? "Actif" : "Inactif"]) }, "etablissements-nexiaschool")}>Exporter (Excel)</button>
      </div>
      <div className="card shadow-sm"><div className="table-responsive"><table className="table table-hover align-middle mb-0 tableau-console">
        <thead className="table-light"><tr>{entete("nom", "Établissement")}<th>Fondateur</th>{entete("cree_le", "Créé le")}{entete("derniere_activite", "Dernière activité")}
          {entete("personnels", "Personnel", true)}{entete("eleves", "Élèves", true)}{entete("notes", "Notes", true)}{entete("stockage_octets", "Stockage", true)}<th>Statut</th></tr></thead>
        <tbody>{lignes.map((e) => (
          <tr key={e.id}>
            <td><Link to={`/console/etablissements/${e.id}`} className="fw-semibold">{e.nom}</Link>
              {e.contient_proprietaire && <span className="badge text-bg-light border ms-1">vous</span>}<div className="small text-muted">{e.ville || "—"}</div></td>
            <td className="small">{e.fondateur?.nom || "—"}<div className="text-muted">{e.fondateur?.email}</div></td>
            <td className="small text-nowrap">{date(e.cree_le)}</td><td className="small text-nowrap">{depuis(e.derniere_activite)}</td>
            <td className="text-end">{e.personnels}</td><td className="text-end">{entier.format(e.eleves)}</td><td className="text-end">{entier.format(e.notes)}</td>
            <td className="text-end small text-nowrap">{octets(e.stockage_octets)}</td><td><Statut e={e} /></td></tr>))}
          {!lignes.length && <tr><td colSpan={9} className="text-center text-muted py-4">Aucun établissement.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

// --- Actions sur un utilisateur (fiche établissement et liste des utilisateurs) ----------------------------------
function ActionsUtilisateur({ p, onFait, onErreur }) {
  const [envoi, setEnvoi] = useState(false)
  if (p.proprietaire) return <span className="small text-muted">propriétaire</span>
  async function faire(f, question) {
    if (question && !confirm(question)) return
    setEnvoi(true)
    try { await f(); onFait() } catch (e) { onErreur(e.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="d-flex gap-1 justify-content-end">
      <button className="btn btn-sm btn-outline-secondary" disabled={envoi}
              onClick={() => faire(() => rpc("console_activer_utilisateur", { p_id: p.id, p_actif: !p.actif }),
                p.actif ? `Désactiver le compte de ${p.nom} ? Il ne pourra plus se connecter (ses clés API sont révoquées).` : null)}>
        {p.actif ? "Désactiver" : "Réactiver"}</button>
      <button className="btn btn-sm btn-outline-danger" disabled={envoi}
              onClick={() => faire(() => rpc("console_supprimer_utilisateur", { p_id: p.id }),
                `Supprimer définitivement le compte de ${p.nom} ? Cette action est irréversible (les notes déjà saisies sont conservées).`)}>Supprimer</button>
    </div>
  )
}

// --- Fiche d'un établissement -----------------------------------------------------------------------------------
function FicheEtablissement() {
  const { id } = useParams()
  const naviguer = useNavigate()
  const [e, erreur, rafraichir] = useDonnees(() => rpc("console_etablissement", { p_id: id }), [id])
  const [msg, setMsg] = useState({}), [eleves, setEleves] = useState(null), [motif, setMotif] = useState(""), [confirmation, setConfirmation] = useState("")
  const [envoi, setEnvoi] = useState(false)
  if (!e) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}<Link to="/console/etablissements">← Établissements</Link></>

  async function action(f, ok) {
    setMsg({}); setEnvoi(true)
    try { await f(); if (ok) setMsg({ ok }); rafraichir() } catch (x) { setMsg({ erreur: x.message }) } finally { setEnvoi(false) }
  }
  async function supprimer(ev) {
    ev.preventDefault(); setMsg({}); setEnvoi(true)
    try {
      await rpc("console_supprimer_etablissement", { p_id: e.id, p_confirmation: confirmation })
      const { data, error } = await supabase.functions.invoke("console-fichiers", { body: { etablissement_id: e.id } })
      const fichiers = error ? " Les fichiers (photos, logo) n'ont pas pu être effacés : relancez plus tard." :
        ` ${Object.values(data?.fichiers_supprimes || {}).reduce((s, n) => s + n, 0)} fichier(s) effacé(s).`
      naviguer("/console/etablissements", { state: { message: `« ${e.nom} » a été supprimé définitivement.${fichiers}` } })
    } catch (x) { setMsg({ erreur: x.message }); setEnvoi(false) }
  }
  const voirEleves = () => action(async () => setEleves(await rpc("console_eleves", { p_id: e.id })))
  return (
    <>
      <Link to="/console/etablissements" className="small">← Établissements</Link>
      <div className="d-flex flex-wrap align-items-center gap-2 mt-1 mb-3">
        <h2 className="h4 m-0">{e.nom}</h2><Statut e={e} />{e.contient_proprietaire && <span className="badge text-bg-light border">votre établissement</span>}
      </div>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      {e.suspendu_le && <div className="alert alert-danger">Suspendu le {dateHeure(e.suspendu_le)} — motif : {e.motif_suspension}</div>}
      <div className="row g-3 mb-3">
        <div className="col-lg-5"><div className="card shadow-sm h-100"><div className="card-body small">
          <h3 className="h6">Informations</h3>
          <dl className="row mb-0">
            <dt className="col-5">Ville</dt><dd className="col-7">{e.ville || "—"}</dd>
            <dt className="col-5">Adresse</dt><dd className="col-7">{e.adresse || "—"}</dd>
            <dt className="col-5">Téléphone</dt><dd className="col-7">{e.telephone || "—"}</dd>
            <dt className="col-5">Site web</dt><dd className="col-7">{e.site_web ? <a href={e.site_web} target="_blank" rel="noreferrer noopener">{siteAffiche(e.site_web)}</a> : "—"}</dd>
            <dt className="col-5">Chef d'établissement</dt><dd className="col-7">{e.nom_chef || "—"}</dd>
            <dt className="col-5">Créé le</dt><dd className="col-7">{dateHeure(e.cree_le)}</dd>
            <dt className="col-5">Dernière activité</dt><dd className="col-7">{depuis(e.derniere_activite)}</dd>
            <dt className="col-5">Exercices</dt><dd className="col-7">{e.exercices.map((x) => `${x.libelle}${x.actif ? " (actif)" : ""}`).join(", ") || "—"}</dd>
            <dt className="col-5">Logo</dt><dd className="col-7">{e.logo ? "oui" : "non"}</dd>
            <dt className="col-5">Agents IA (API)</dt><dd className="col-7">{e.api_active ? `activé · ${e.compteurs.cles_api} clé(s) · ${e.compteurs.appels_api_30j} action(s) sur 30 j` : "désactivé"}</dd>
            <dt className="col-5">Stockage</dt><dd className="col-7">{octets(e.stockage_octets)}</dd>
          </dl>
        </div></div></div>
        <div className="col-lg-7"><div className="row g-3">
          {[["Élèves", e.compteurs.eleves], ["Classes", e.compteurs.classes], ["Matières", e.compteurs.matieres], ["Notes", e.compteurs.notes],
            ["Absences", e.compteurs.absences], ["Personnel", e.personnels.length]].map(([l, v]) => (
            <div className="col-4" key={l}><div className="card shadow-sm"><div className="card-body py-2">
              <div className="small text-muted">{l}</div><div className="fs-4 fw-semibold">{entier.format(v)}</div></div></div></div>))}
          <div className="col-12"><div className="card shadow-sm"><div className="card-body small">
            <h3 className="h6">Classes (effectif de l'exercice actif)</h3>
            {e.classes.length ? e.classes.map((c) => <span key={c.libelle} className="badge text-bg-light border me-1 mb-1">{c.libelle} · {c.effectif}</span>) : <span className="text-muted">Aucune classe.</span>}
          </div></div></div>
        </div></div>
      </div>

      <div className="card shadow-sm mb-3"><div className="card-body">
        <h3 className="h6">Personnel</h3>
        <div className="table-responsive"><table className="table table-sm align-middle mb-0">
          <thead><tr><th>Nom</th><th>Rôle</th><th>Connexion</th><th>Dernière connexion</th><th>Statut</th><th /></tr></thead>
          <tbody>{e.personnels.map((p) => (
            <tr key={p.id}><td>{p.nom}{p.proprietaire && <span className="badge text-bg-light border ms-1">vous</span>}</td><td>{LIBELLES_ROLES[p.role]}</td>
              <td className="small">{p.compte_google ? `Google · ${p.email || ""}` : "Code personnel"}</td><td className="small">{depuis(p.derniere_connexion)}</td>
              <td>{p.actif ? <span className="badge text-bg-success">actif</span> : <span className="badge text-bg-secondary">désactivé</span>}</td>
              <td className="text-end"><ActionsUtilisateur p={p} onFait={() => { setMsg({ ok: "Modification enregistrée." }); rafraichir() }} onErreur={(m) => setMsg({ erreur: m })} /></td></tr>))}</tbody>
        </table></div>
      </div></div>

      <div className="card shadow-sm mb-3"><div className="card-body">
        <h3 className="h6">Élèves</h3>
        {eleves ? (
          <div className="table-responsive" style={{ maxHeight: 360 }}><table className="table table-sm mb-0">
            <thead><tr><th>Matricule</th><th>Élève</th><th>Sexe</th><th>Classe</th></tr></thead>
            <tbody>{eleves.map((x) => <tr key={x.matricule}><td className="small">{x.matricule}</td><td>{x.nom}</td><td>{x.sexe}</td><td>{x.classe || "—"}</td></tr>)}
              {!eleves.length && <tr><td colSpan={4} className="text-muted">Aucun élève.</td></tr>}</tbody></table></div>
        ) : (
          <><p className="small text-muted">Les élèves sont des mineurs : leur liste ne s'affiche qu'à votre demande et chaque consultation est inscrite au journal.</p>
            <button className="btn btn-sm btn-outline-primary" onClick={voirEleves} disabled={envoi}>Afficher la liste des élèves</button></>
        )}
      </div></div>

      <div className="card border-danger mb-3"><div className="card-body">
        <h3 className="h6 text-danger">Zone sensible</h3>
        {e.contient_proprietaire ? <p className="small text-muted mb-0">C'est votre propre établissement : il ne peut être ni suspendu ni supprimé depuis la console.</p> : (
          <div className="row g-4">
            <div className="col-lg-6">
              {e.suspendu_le ? (
                <><p className="small mb-2">L'accès est coupé pour tout le personnel. Les données sont conservées.</p>
                  <button className="btn btn-success btn-sm" disabled={envoi} onClick={() => action(() => rpc("console_reactiver", { p_id: e.id }), "Établissement réactivé : le personnel peut de nouveau se connecter.")}>Réactiver l'établissement</button></>
              ) : (
                <form onSubmit={(ev) => { ev.preventDefault(); if (confirm(`Suspendre « ${e.nom} » ? Tout le personnel perd l'accès immédiatement.`)) action(() => rpc("console_suspendre", { p_id: e.id, p_motif: motif }), "Établissement suspendu.") }}>
                  <label className="form-label small" htmlFor="motif">Suspendre l'accès (données conservées)</label>
                  <input id="motif" className="form-control form-control-sm mb-2" required minLength={3} maxLength={300} placeholder="Motif (ex. impayé, demande de l'établissement)" value={motif} onChange={(x) => setMotif(x.target.value)} />
                  <button className="btn btn-warning btn-sm" disabled={envoi}>Suspendre l'établissement</button>
                </form>)}
            </div>
            <div className="col-lg-6">
              <form onSubmit={supprimer}>
                <label className="form-label small" htmlFor="confirmation">Supprimer définitivement l'établissement, son personnel, ses élèves, ses notes et ses fichiers. Saisissez <strong>{e.nom}</strong> pour confirmer :</label>
                <input id="confirmation" className="form-control form-control-sm mb-2" autoComplete="off" value={confirmation} onChange={(x) => setConfirmation(x.target.value)} />
                <button className="btn btn-danger btn-sm" disabled={envoi || confirmation.trim().toLowerCase() !== e.nom.trim().toLowerCase()}>
                  {envoi ? "Suppression…" : "Supprimer définitivement"}</button>
              </form>
            </div>
          </div>)}
      </div></div>
    </>
  )
}

// --- Utilisateurs --------------------------------------------------------------------------------------------------
function Utilisateurs() {
  const [liste, erreur, rafraichir] = useDonnees(() => rpc("console_utilisateurs"), [])
  const [q, setQ] = useState(""), [role, setRole] = useState(""), [msg, setMsg] = useState({})
  const lignes = useMemo(() => (liste || []).filter((p) => (!role || p.role === role)
    && (!q.trim() || [p.nom, p.email, p.etablissement].some((x) => String(x || "").toLowerCase().includes(q.trim().toLowerCase())))), [liste, q, role])
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input className="form-control" style={{ maxWidth: 320 }} placeholder="Rechercher (nom, e-mail, établissement)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="form-select" style={{ maxWidth: 220 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rôle">
          <option value="">Tous les rôles</option>{Object.entries(LIBELLES_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span className="text-muted small">{lignes.length} / {liste.length}</span>
        <button className="btn btn-outline-secondary btn-sm ms-auto" onClick={() => exporter({ titre: "Utilisateurs",
          entetes: ["Nom", "Rôle", "Établissement", "Connexion", "E-mail", "Créé le", "Dernière connexion", "Statut"],
          lignes: lignes.map((p) => [p.nom, LIBELLES_ROLES[p.role], p.etablissement, p.compte_google ? "Google" : "Code personnel", p.email, new Date(p.cree_le),
            p.derniere_connexion ? new Date(p.derniere_connexion) : "", p.actif ? "Actif" : "Désactivé"]) }, "utilisateurs-nexiaschool")}>Exporter (Excel)</button>
      </div>
      <div className="card shadow-sm"><div className="table-responsive"><table className="table table-hover align-middle mb-0">
        <thead className="table-light"><tr><th>Nom</th><th>Rôle</th><th>Établissement</th><th>Connexion</th><th>Dernière connexion</th><th>Statut</th><th /></tr></thead>
        <tbody>{lignes.map((p) => (
          <tr key={p.id}><td>{p.nom}{p.proprietaire && <span className="badge text-bg-light border ms-1">vous</span>}</td><td className="small">{LIBELLES_ROLES[p.role]}</td>
            <td><Link to={`/console/etablissements/${p.etablissement_id}`}>{p.etablissement}</Link>{p.etablissement_suspendu && <span className="badge text-bg-danger ms-1">suspendu</span>}</td>
            <td className="small">{p.compte_google ? <>Google<div className="text-muted">{p.email}</div></> : "Code personnel"}</td>
            <td className="small text-nowrap">{depuis(p.derniere_connexion)}</td>
            <td>{p.actif ? <span className="badge text-bg-success">actif</span> : <span className="badge text-bg-secondary">désactivé</span>}</td>
            <td className="text-end"><ActionsUtilisateur p={p} onFait={() => { setMsg({ ok: "Modification enregistrée." }); rafraichir() }} onErreur={(m) => setMsg({ erreur: m })} /></td></tr>))}
          {!lignes.length && <tr><td colSpan={7} className="text-center text-muted py-4">Aucun utilisateur.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

// --- Journal d'administration ------------------------------------------------------------------------------------
function Journal() {
  const [liste, erreur] = useDonnees(() => rpc("console_journal", { p_limite: 300 }), [])
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <>
      <p className="small text-muted">Toutes les actions effectuées depuis la console (suspensions, suppressions, consultations des élèves), conservées pour la traçabilité.</p>
      <div className="card shadow-sm"><div className="table-responsive"><table className="table table-sm align-middle mb-0">
        <thead className="table-light"><tr><th>Date</th><th>Action</th><th>Cible</th><th>Détails</th><th>Par</th></tr></thead>
        <tbody>{liste.map((j, k) => (
          <tr key={k}><td className="small text-nowrap">{dateHeure(j.cree_le)}</td><td>{j.action}</td><td>{j.cible}</td>
            <td className="small text-muted">{Object.entries(j.details || {}).filter(([c]) => !c.endsWith("_id")).map(([c, v]) => `${c} : ${v}`).join(" · ")}</td>
            <td className="small">{j.auteur}</td></tr>))}
          {!liste.length && <tr><td colSpan={5} className="text-center text-muted py-4">Aucune action pour le moment.</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

function MessageRetour() {
  const msg = window.history.state?.usr?.message
  return msg ? <div className="alert alert-success">{msg}</div> : null
}

// --- Mise en page de la console -----------------------------------------------------------------------------------
export default function Console() {
  const { pret, session, proprietaire, profil, erreur } = useSession()
  const naviguer = useNavigate()
  if (!pret) return <Chargement />
  if (erreur) return <div className="container py-5"><div className="alert alert-danger">Connexion au serveur impossible. Rechargez la page.</div></div>
  if (!session) return (
    <div className="row justify-content-center mt-5 mx-0"><div className="col-sm-8 col-md-6 col-lg-4"><div className="card shadow-sm"><div className="card-body p-4">
      <h1 className="h5 mb-1">Console de la plateforme</h1>
      <p className="text-muted small mb-3">Réservée au propriétaire de NexIA School. Connectez-vous avec votre compte Google.</p>
      <BoutonGoogle chemin="/console" texte="Se connecter avec Google" />
    </div></div></div></div>)
  if (!proprietaire) return <Navigate to="/" replace />
  const onglet = ({ isActive }) => "nav-link" + (isActive ? " active fw-semibold" : "")
  return (
    <>
      <nav className="navbar navbar-dark bg-dark no-print">
        <div className="container-fluid gap-2">
          <span className="navbar-brand fw-semibold">NexIA School <span className="badge text-bg-warning text-dark ms-1 align-middle">Console</span></span>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <span className="text-white-50 small d-none d-md-inline">{session.user.email}</span>
            {profil && <Link className="btn btn-sm btn-outline-light" to="/">Mon établissement</Link>}
            <button className="btn btn-sm btn-light" onClick={async () => { await supabase.auth.signOut(); naviguer("/") }}>Se déconnecter</button>
          </div>
        </div>
      </nav>
      <main className="container-fluid py-3 px-3 px-lg-4">
        <h1 className="h3 mb-3">Console de la plateforme</h1>
        <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
          <li className="nav-item"><NavLink className={onglet} to="/console" end>Vue d'ensemble</NavLink></li>
          <li className="nav-item"><NavLink className={onglet} to="/console/etablissements">Établissements</NavLink></li>
          <li className="nav-item"><NavLink className={onglet} to="/console/utilisateurs">Utilisateurs</NavLink></li>
          <li className="nav-item"><NavLink className={onglet} to="/console/journal">Journal</NavLink></li>
        </ul>
        <Routes>
          <Route index element={<VueEnsemble />} />
          <Route path="etablissements" element={<><MessageRetour /><Etablissements /></>} />
          <Route path="etablissements/:id" element={<FicheEtablissement />} />
          <Route path="utilisateurs" element={<Utilisateurs />} />
          <Route path="journal" element={<Journal />} />
          <Route path="*" element={<Navigate to="/console" replace />} />
        </Routes>
      </main>
    </>
  )
}
