// Notes → PV et rapports : un seul moteur, quatre documents rangés chacun dans son volet, plus le registre des documents
// générés (numéros uniques, commentaires) et les réglages de l'établissement (seuils, signataires, confidentialité).
import { useState } from "react"
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { chargerReferencePv } from "../../lib/pv/donnees.js"
import { TYPES_PV } from "../../lib/pv/textes.js"
import { dateHeure } from "../../lib/format.js"
import { rpc, supabase, verifier } from "../../supabase.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"
import { ContextePv, useReferencePv } from "./Outils.jsx"
import PvClasse from "./PvClasse.jsx"
import PvGroupe from "./PvGroupe.jsx"
import PvIndividuels from "./PvIndividuels.jsx"

const VOLETS = [
  { chemin: "classe", titre: "PV de classe", icone: "📋", texte: "Notes brutes de chaque élève, matière par matière, pour une ou plusieurs périodes. Sans calcul de moyennes (en option)." },
  { chemin: "cycle", titre: "PV par cycle", icone: "📊", texte: "Performances d'un cycle : classes, matières, enseignants, pourcentages, graphiques et comparaisons." },
  { chemin: "etablissement", titre: "PV général de l'établissement", icone: "🏫", texte: "Vision globale de la direction : effectifs, présence, réussite, pensions, évolution et analyse des points faibles." },
  { chemin: "individuels", titre: "PV de performances individuelles", icone: "👤", texte: "Un PV par élève, avec courbe d'évolution et recommandations, publiable dans l'espace des parents." },
]

export default function Pv() {
  const { exercice, estAdmin } = useSession()
  const [ref, erreur, recharger] = useDonnees(() => chargerReferencePv(exercice), [exercice?.id])
  if (!exercice) return <div className="alert alert-warning">{t("Aucun exercice actif.")}</div>
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const lien = ({ isActive }) => `nav-link${isActive ? " active" : ""}`
  return (
    <ContextePv.Provider value={{ ...ref, recharger }}>
      <div className="pv-module">
        <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2 no-print">
          <h1 className="h3 mb-0"><Link to="/notes/pv" className="text-reset text-decoration-none">{t("PV et rapports")}</Link></h1>
          <span className="small text-muted">{t("Exercice {v0}", { v0: exercice.libelle })}</span>
        </div>
        {estAdmin && (
          <ul className="nav nav-pills mb-3 gap-1 no-print pv-onglets">
            <li className="nav-item"><NavLink end className={lien} to="/notes/pv">{t("Accueil")}</NavLink></li>
            {VOLETS.map((v) => <li className="nav-item" key={v.chemin}><NavLink className={lien} to={`/notes/pv/${v.chemin}`}>{t(v.titre)}</NavLink></li>)}
            <li className="nav-item"><NavLink className={lien} to="/notes/pv/registre">{t("Registre")}</NavLink></li>
            <li className="nav-item"><NavLink className={lien} to="/notes/pv/reglages">{t("Réglages")}</NavLink></li>
          </ul>)}
        <Routes>
          {estAdmin ? (
            <>
              <Route index element={<Accueil />} />
              <Route path="classe" element={<PvClasse />} />
              <Route path="cycle" element={<PvGroupe mode="cycle" key="cycle" />} />
              <Route path="etablissement" element={<PvGroupe mode="etablissement" key="etablissement" />} />
              <Route path="individuels" element={<PvIndividuels />} />
              <Route path="registre" element={<Registre />} />
              <Route path="reglages" element={<Reglages />} />
            </>
          ) : <Route path="individuels" element={<PvIndividuels />} />}
          <Route path="*" element={<Navigate to={estAdmin ? "/notes/pv" : "/notes/pv/individuels"} replace />} />
        </Routes>
      </div>
    </ContextePv.Provider>
  )
}

function Accueil() {
  const [derniers] = useDonnees(async () => verifier(await supabase.from("pv_documents").select("id, type, reference, titre, genere_le, format, partiel")
    .order("genere_le", { ascending: false }).limit(5)), [])
  return (
    <>
      <p className="text-muted">{t("Choisissez le document à produire. Chaque PV est calculé à partir des notes, absences et données de l'établissement, puis reçoit un numéro unique inscrit au registre.")}</p>
      <div className="row g-3 mb-4">
        {VOLETS.map((v) => (
          <div className="col-md-6 col-xl-3" key={v.chemin}>
            <Link to={`/notes/pv/${v.chemin}`} className="card h-100 text-decoration-none text-reset pv-carte">
              <div className="card-body">
                <div className="fs-2 mb-2" aria-hidden="true">{v.icone}</div>
                <h2 className="h6">{t(v.titre)}</h2>
                <p className="small text-muted mb-0">{t(v.texte)}</p>
              </div>
              <div className="card-footer bg-transparent border-0 pt-0"><span className="btn btn-sm btn-outline-primary">{t("Ouvrir")}</span></div>
            </Link>
          </div>))}
      </div>
      {derniers?.length > 0 && (
        <>
          <h2 className="h6">{t("Derniers documents générés")}</h2>
          <ul className="list-group list-group-flush small mb-2">{derniers.map((d) => (
            <li className="list-group-item px-0 d-flex justify-content-between gap-2" key={d.id}><span><code>{d.reference}</code> · {d.titre}</span>
              <span className="text-muted text-nowrap">{dateHeure(d.genere_le)}</span></li>))}</ul>
          <Link to="/notes/pv/registre" className="small">{t("Voir tout le registre")}</Link>
        </>)}
    </>
  )
}

/** Adresse pour rouvrir un document du registre avec la même sélection (recalculé sur les données actuelles). */
function adresseReouverture(d) {
  const p = d.perimetre || {}
  if (d.type === "classe" && p.classe_id) return `/notes/pv/classe?classe=${encodeURIComponent(p.classe_id)}&periodes=${encodeURIComponent((p.periodes || []).join(","))}`
  if (d.type === "cycle") return `/notes/pv/cycle?${new URLSearchParams({ ...(p.cycle ? { cycle: p.cycle } : {}), ...(p.periode ? { periode: p.periode } : {}) })}`
  if (d.type === "etablissement") return `/notes/pv/etablissement?${new URLSearchParams(p.periode ? { periode: p.periode } : {})}`
  return "/notes/pv/individuels"
}

function Registre() {
  const naviguer = useNavigate()
  const [filtre, setFiltre] = useState({ type: "", texte: "" })
  const [liste, erreur, recharger] = useDonnees(async () => verifier(await supabase.from("pv_documents").select("*").order("genere_le", { ascending: false }).limit(500)), [])
  const [edition, setEdition] = useState(null), [message, setMessage] = useState({ ok: "", erreur: "" })
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const q = filtre.texte.trim().toLowerCase()
  const visibles = liste.filter((d) => (!filtre.type || d.type === filtre.type) && (!q || `${d.reference} ${d.titre} ${d.genere_par_nom}`.toLowerCase().includes(q)))
  async function enregistrer() {
    try { await rpc("pv_commenter", { p_id: edition.id, p_commentaire: edition.commentaire }); setEdition(null); setMessage({ ok: t("Commentaire enregistré."), erreur: "" }); recharger() }
    catch (e) { setMessage({ ok: "", erreur: e.message }) }
  }
  return (
    <section aria-labelledby="pv-registre-titre">
      <h2 className="h5" id="pv-registre-titre">{t("Registre des PV")}</h2>
      <p className="text-muted small">{t("Chaque document généré est inscrit ici avec son numéro unique, sa sélection, l'auteur et la date. Rouvrir un PV le recalcule sur les données actuelles avec la même sélection.")}</p>
      <div className="row g-2 mb-2">
        <div className="col-sm-4 col-lg-3"><select className="form-select form-select-sm" value={filtre.type} onChange={(e) => setFiltre({ ...filtre, type: e.target.value })} aria-label={t("Type")}>
          <option value="">{t("Tous les types")}</option>{Object.entries(TYPES_PV).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        <div className="col-sm-8 col-lg-4"><input type="search" className="form-control form-control-sm" placeholder={t("Numéro, titre ou auteur…")} value={filtre.texte}
          onChange={(e) => setFiltre({ ...filtre, texte: e.target.value })} /></div>
      </div>
      {message.ok && <div className="alert alert-success small py-2">{message.ok}</div>}
      <Alerte>{message.erreur}</Alerte>
      <div className="table-responsive"><table className="table table-sm small align-middle">
        <thead className="table-light"><tr><th>{t("Numéro")}</th><th>{t("Type")}</th><th>{t("Titre")}</th><th>{t("Format")}</th><th>{t("Généré le")}</th><th>{t("Par")}</th><th></th></tr></thead>
        <tbody>{visibles.map((d) => (
          <tr key={d.id}>
            <td className="text-nowrap"><code>{d.reference}</code>{d.partiel && <span className="badge text-bg-warning ms-1">{t("partiel")}</span>}</td>
            <td>{t(TYPES_PV[d.type] || d.type)}</td><td>{d.titre}{d.commentaire && <div className="text-muted text-truncate" style={{ maxWidth: 360 }}>{d.commentaire}</div>}</td>
            <td className="text-uppercase">{d.format}</td><td className="text-nowrap">{dateHeure(d.genere_le)}</td><td>{d.genere_par_nom}</td>
            <td className="text-nowrap">
              <button type="button" className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEdition({ id: d.id, commentaire: d.commentaire })}>{t("Commenter")}</button>
              {d.type !== "publication" && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => naviguer(adresseReouverture(d))}>{t("Rouvrir")}</button>}
            </td>
          </tr>))}
          {!visibles.length && <tr><td colSpan={7} className="text-muted">{t("Aucun document.")}</td></tr>}
        </tbody></table></div>
      {edition && (
        <div className="card mt-2" style={{ maxWidth: 720 }}><div className="card-body">
          <label className="form-label small fw-semibold" htmlFor="pv-registre-com">{t("Commentaire de la direction")}</label>
          <textarea id="pv-registre-com" className="form-control mb-2" rows={4} maxLength={8000} value={edition.commentaire} onChange={(e) => setEdition({ ...edition, commentaire: e.target.value })} />
          <button type="button" className="btn btn-sm btn-primary me-2" onClick={enregistrer}>{t("Enregistrer")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEdition(null)}>{t("Annuler")}</button>
        </div></div>)}
    </section>
  )
}

function Reglages() {
  const ref = useReferencePv()
  const [f, setF] = useState(() => ({ ...ref.reglages, signataires: [...ref.reglages.signataires] }))
  const [etat, setEtat] = useState({ ok: false, erreur: "", enCours: false })
  const champ = (k, v) => setF({ ...f, [k]: v })
  async function enregistrer(e) {
    e.preventDefault()
    setEtat({ ok: false, erreur: "", enCours: true })
    try {
      await rpc("pv_enregistrer_reglages", { p: { ...f, signataires: f.signataires.map((s) => s.trim()).filter(Boolean) } })
      setEtat({ ok: true, erreur: "", enCours: false }); ref.recharger()
    } catch (err) { setEtat({ ok: false, erreur: err.message, enCours: false }) }
  }
  const nombre = (k, libelle, aide, { min = 0, max = 20, pas = 0.25 } = {}) => (
    <div className="col-sm-6 col-lg-3"><label className="form-label small fw-semibold" htmlFor={`pvr-${k}`}>{libelle}</label>
      <input id={`pvr-${k}`} type="number" className="form-control form-control-sm" min={min} max={max} step={pas} value={f[k]} onChange={(e) => champ(k, e.target.value)} required />
      <div className="form-text">{aide}</div></div>)
  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 980 }}>
      <h2 className="h5">{t("Réglages des PV")}</h2>
      <p className="text-muted small">{t("Ces règles sont propres à votre établissement et s'appliquent à tous les PV.")}</p>
      <div className="row g-3 mb-3">
        {nombre("seuil_reussite", t("Seuil de réussite (/20)"), t("Note ou moyenne à partir de laquelle on compte une réussite."))}
        {nombre("seuil_difficulte", t("Seuil de difficulté (/20)"), t("Moyenne sous laquelle un élève est signalé en difficulté."))}
        {nombre("part_echecs", t("Part de matières en échec (%)"), t("PV sans moyennes : élève en difficulté au-delà de cette part ; matière à suivre au-dessus de ce taux d'échec."), { min: 1, max: 100, pas: 1 })}
        {nombre("baisse_alerte", t("Baisse qui déclenche une alerte (points)"), t("PV individuels : baisse d'une période à l'autre signalée aux parents."))}
      </div>
      <fieldset className="mb-3"><legend className="h6">{t("Emplacements de signature")}</legend>
        <p className="small text-muted">{t("Jusqu'à 6 intitulés (ex. : Le professeur principal, Le censeur, Le chef d'établissement). Vide : « Le chef d'établissement ».")}</p>
        {f.signataires.map((s, k) => (
          <div className="input-group input-group-sm mb-1" key={k} style={{ maxWidth: 480 }}>
            <input className="form-control" maxLength={60} value={s} aria-label={t("Signataire {v0}", { v0: k + 1 })}
              onChange={(e) => champ("signataires", f.signataires.map((x, j) => (j === k ? e.target.value : x)))} />
            <button type="button" className="btn btn-outline-danger" onClick={() => champ("signataires", f.signataires.filter((_, j) => j !== k))}>{t("Retirer")}</button>
          </div>))}
        {f.signataires.length < 6 && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => champ("signataires", [...f.signataires, ""])}>{t("Ajouter un signataire")}</button>}
      </fieldset>
      <fieldset className="mb-3"><legend className="h6">{t("Affichage et confidentialité")}</legend>
        {[["afficher_cachet", t("Apposer le cachet de l'établissement (importé dans Paramètres → Cartes scolaires)")],
          ["repartition_sexe", t("Proposer la répartition filles / garçons dans les PV par cycle et général")],
          ["comparer_cycle", t("PV individuels : afficher aussi la moyenne du cycle (jamais les notes d'autres élèves)")]].map(([k, l]) => (
          <div className="form-check" key={k}><input className="form-check-input" type="checkbox" id={`pvr-${k}`} checked={!!f[k]} onChange={(e) => champ(k, e.target.checked)} />
            <label className="form-check-label small" htmlFor={`pvr-${k}`}>{l}</label></div>))}
      </fieldset>
      <button type="submit" className="btn btn-primary" disabled={etat.enCours}>{etat.enCours ? t("Enregistrement…") : t("Enregistrer les réglages")}</button>
      {etat.ok && <span className="small text-success ms-2">{t("Réglages enregistrés.")}</span>}
      <Alerte>{etat.erreur}</Alerte>
    </form>
  )
}
