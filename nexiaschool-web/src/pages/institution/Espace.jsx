// Espace des délégations (départementale ou régionale) : tableau de bord, circonscription, fiches reçues, retards,
// consolidation, synthèse, courriers, IA & API, notifications, paramètres. Toutes les autorisations sont vérifiées
// par le serveur ; les menus ne font que refléter le niveau et les permissions du compte.
import { useEffect, useState } from "react"
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { date, dateHeure } from "../../lib/format.js"
import { CATEGORIES_IA, PERMISSIONS, normaliserBrouillon, periode, statutCourrier } from "../../lib/institution.js"
import { courrierPdf, fichePdf, synthesePdf } from "../../lib/institutionPdf.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase } from "../../supabase.js"
import { ChoixLangue, t } from "../../i18n.jsx"
import { DemandeDelegue } from "./Acces.jsx"
import { BadgeStatut, HistoriqueFiche, ListeAnomalies, Notifications, Piece, SelecteurCampagne, TableIndicateurs, VueFiche, deposerPiece, nombre, taux, useCampagnes } from "./Composants.jsx"
import { LectureCourrier } from "./Etablissement.jsx"

const peut = (membre, p) => membre?.permissions?.includes(p)

export default function EspaceInstitution() {
  const { pret, session, profil, institution, recharger } = useSession()
  if (!pret) return <Chargement />
  if (!session) return <Navigate to="/institution/connexion" replace />
  if (profil) return <div className="container py-5"><div className="alert alert-warning">{t("Ce compte appartient à un établissement : utilisez une autre adresse e-mail pour l'espace d'une délégation.")}</div></div>
  if (!institution?.membre) return <DemandeDelegue />
  return <Cadre espace={institution} recharger={recharger} />
}

function Cadre({ espace, recharger }) {
  const { membre, delegation } = espace
  const regional = delegation.niveau === "region"
  const naviguer = useNavigate()
  const [menu, setMenu] = useState(false)
  const lien = ({ isActive }) => "nav-link px-2 py-1" + (isActive ? " active fw-semibold" : "")
  const liens = regional ? [
    ["", "Tableau de bord régional"], ["delegations", "Délégations départementales"], ["fiches", "Synthèses départementales reçues"],
    ["retards", "Départements en retard"], ["consolidation", "Analyse et consolidation régionale"], ["synthese", "Ma synthèse régionale"],
    ["courriers", "Courriers"], ["fiches-brutes", "Accès exceptionnels"], ["ia", "IA & API"], ["notifications", "Notifications"], ["parametres", "Paramètres de mon espace"],
  ] : [
    ["", "Tableau de bord départemental"], ["etablissements", "Établissements de mon département"], ["fiches", "Fiches statistiques reçues"],
    ["retards", "Établissements en retard"], ["consolidation", "Analyse et consolidation"], ["synthese", "Ma synthèse départementale"],
    ["courriers", "Courriers"], ["ia", "IA & API"], ["notifications", "Notifications"], ["parametres", "Paramètres de mon espace"],
  ]
  return (
    <>
      <nav className="navbar navbar-dark bg-dark no-print">
        <div className="container-fluid">
          <span className="navbar-brand small text-wrap" style={{ maxWidth: "70vw" }}>NexIA School · {delegation.nom}</span>
          <div className="d-flex align-items-center gap-2">
            <ChoixLangue variante="sombre" />
            <button className="btn btn-sm btn-outline-light d-lg-none" aria-expanded={menu} onClick={() => setMenu(!menu)}>{t("Menu")}</button>
            <button className="btn btn-sm btn-outline-light" onClick={async () => { await supabase.auth.signOut(); naviguer("/institution/connexion") }}>{t("Se déconnecter")}</button>
          </div>
        </div>
      </nav>
      <div className="container-fluid"><div className="row">
        <aside className={`col-lg-3 col-xl-2 border-end py-3 no-print ${menu ? "" : "d-none d-lg-block"}`}>
          <div className="small text-muted mb-2">{membre.prenom} {membre.nom} · {membre.role === "titulaire" ? t("Titulaire") : t("Collaborateur")}</div>
          <ul className="nav flex-column">{liens.map(([to, l]) => (
            <li className="nav-item" key={to}><NavLink className={lien} end={to === ""} to={`/institution/${to}`} onClick={() => setMenu(false)}>
              {t(l)}{to === "notifications" && espace.non_lues > 0 && <span className="badge text-bg-danger ms-1">{espace.non_lues}</span>}</NavLink></li>))}</ul>
          <p className="small text-muted mt-4">{t("NexIA School est un service indépendant, non mandaté par le MINESEC.")}</p>
        </aside>
        <main className="col py-3">
          <Routes>
            <Route index element={regional ? <TableauRegion /> : <TableauDepartement />} />
            <Route path="etablissements" element={<Etablissements membre={membre} />} />
            <Route path="delegations" element={<TableauRegion liste />} />
            <Route path="fiches" element={regional ? <TableauRegion recues /> : <TableauDepartement recues />} />
            <Route path="fiches/:id" element={<ExamenFiche membre={membre} />} />
            <Route path="retards" element={regional ? <TableauRegion retards membre={membre} /> : <TableauDepartement retards membre={membre} />} />
            <Route path="consolidation" element={<Consolidation niveau={regional ? "departement" : "etablissement"} />} />
            <Route path="synthese" element={<Syntheses membre={membre} />} />
            <Route path="synthese/:id" element={<EditeurSynthese membre={membre} />} />
            <Route path="courriers" element={<Courriers membre={membre} delegation={delegation} />} />
            <Route path="fiches-brutes" element={<FichesBrutes />} />
            <Route path="ia" element={<IaApi />} />
            <Route path="notifications" element={<Notifications onLu={recharger} />} />
            <Route path="parametres" element={<ParametresEspace espace={espace} recharger={recharger} />} />
            <Route path="*" element={<Navigate to="/institution" replace />} />
          </Routes>
        </main>
      </div></div>
    </>
  )
}

function Compteurs({ items }) {
  return <div className="row g-2 mb-3">{items.map(([l, v, c]) => (
    <div className="col-6 col-md-4 col-xl-2" key={l}><div className={`border rounded p-2 h-100 ${c ? `border-${c}` : ""}`}>
      <div className="h4 mb-0">{v}</div><div className="small text-muted">{t(l)}</div></div></div>))}</div>
}

/** Tableau de bord départemental (filtres : période, statut) ; vues « fiches reçues » et « en retard » (avec relance). */
function TableauDepartement({ recues = false, retards = false, membre }) {
  const camp = useCampagnes("etablissement")
  const [d, erreur] = useDonnees(() => (camp.id ? rpc("inst_tableau_departement", { p_campagne: camp.id }) : Promise.resolve(null)), [camp.id])
  const [filtre, setFiltre] = useState(""), [choix, setChoix] = useState([]), [info, setInfo] = useState(""), [err, setErr] = useState("")
  if (camp.erreur || erreur) return <Alerte>{camp.erreur || erreur}</Alerte>
  const c = d?.compteurs
  let lignes = (d?.etablissements || []).filter((e) => e.rattachement === "verifie")
  if (recues) lignes = lignes.filter((e) => e.statut !== "non_publiee")
  if (retards) lignes = lignes.filter((e) => e.statut === "non_publiee" && e.en_retard)
  if (filtre) lignes = lignes.filter((e) => e.statut === filtre)
  async function relancer(ids) {
    setErr(""); setInfo("")
    try { setInfo(t("{v0} relance(s) envoyée(s) (notification dans l'espace de l'établissement).", { v0: await rpc("inst_relancer", { p_campagne: camp.id, p_cibles: ids }) })); setChoix([]) } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1 className="h4">{retards ? t("Établissements en retard") : recues ? t("Fiches statistiques reçues") : t("Tableau de bord départemental")}</h1>
      <SelecteurCampagne {...camp} />
      {!d ? (camp.id ? <Chargement /> : null) : <>
        {!recues && !retards && <Compteurs items={[["Établissements", c.etablissements], ["Fiches attendues", c.attendues], ["Publiées", c.publiees, "primary"], ["Non publiées", c.non_publiees],
          ["En retard", c.en_retard, c.en_retard ? "danger" : ""], ["En correction", c.correction, c.correction ? "warning" : ""], ["Examinées", c.examinees, "success"],
          ["Taux de transmission", c.attendues ? `${Math.round((c.publiees / c.attendues) * 1000) / 10} %` : "—"], ["Rattachements à vérifier", c.a_verifier, c.a_verifier ? "warning" : ""]]} />}
        <Alerte>{err}</Alerte><Alerte type="success">{info}</Alerte>
        <div className="d-flex flex-wrap gap-2 mb-2">
          {!retards && <select className="form-select form-select-sm w-auto" aria-label={t("Statut")} value={filtre} onChange={(e) => setFiltre(e.target.value)}>
            <option value="">{t("Tous les statuts")}</option>
            {["non_publiee", "publiee", "en_examen", "correction_demandee", "corrigee", "republiee", "examinee"].map((s) => <option key={s} value={s}>{t({ non_publiee: "Non publiée", publiee: "Publiée", en_examen: "En cours d'examen", correction_demandee: "Correction demandée", corrigee: "Corrigée", republiee: "Republiée", examinee: "Reçue et examinée" }[s])}</option>)}
          </select>}
          {retards && peut(membre, "examen") && lignes.length > 0 && <>
            <button className="btn btn-sm btn-warning" disabled={!choix.length} onClick={() => relancer(choix)}>{t("Relancer la sélection")}</button>
            <button className="btn btn-sm btn-outline-warning" onClick={() => relancer(lignes.map((e) => e.id))}>{t("Relancer tous les établissements en retard")}</button></>}
        </div>
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr>{retards && <th />}<th>{t("Établissement")}</th><th>{t("Réf. NexIA")}</th><th>{t("Statut")}</th><th>{t("Échéance")}</th><th>{t("Publication")}</th>
            <th>{t("Retard")}</th><th>{t("Dernière action")}</th><th>{t("Consultée")}</th><th /></tr></thead>
          <tbody>{lignes.map((e) => (
            <tr key={e.id}>
              {retards && <td><input type="checkbox" className="form-check-input" aria-label={e.nom} checked={choix.includes(e.id)} onChange={(x) => setChoix(x.target.checked ? [...choix, e.id] : choix.filter((i) => i !== e.id))} /></td>}
              <td>{e.nom}<div className="small text-muted">{e.ville}</div></td><td className="small font-monospace">{e.code}</td>
              <td><BadgeStatut statut={e.statut} /></td><td>{date(d.campagne?.echeance_effective)}</td>
              <td>{e.derniere_publication ? dateHeure(e.derniere_publication) : "—"}{e.version > 1 ? ` (v${e.version})` : ""}</td>
              <td>{e.jours_retard ? t("{v0} j", { v0: e.jours_retard }) : e.en_retard ? t("publiée en retard") : "—"}</td>
              <td>{e.derniere_action ? dateHeure(e.derniere_action) : "—"}</td><td>{e.consultee ? t("oui") : t("non")}</td>
              <td>{e.fiche_id && e.statut !== "non_publiee" && <Link className="btn btn-sm btn-outline-primary" to={`/institution/fiches/${e.fiche_id}`}>{t("Examiner")}</Link>}</td>
            </tr>))}</tbody></table></div>
        {!lignes.length && <p className="text-muted small">{t("Aucun établissement dans cette vue.")}</p>}
      </>}
    </>
  )
}

/** Établissements du département : rattachements déclarés à vérifier. */
function Etablissements({ membre }) {
  const [liste, erreur, recharger] = useDonnees(() => rpc("inst_perimetre"), [])
  const [err, setErr] = useState("")
  async function verifier(id, ok) {
    setErr("")
    const motif = ok ? "" : prompt(t("Motif du refus de rattachement :"))
    if (!ok && !motif) return
    try { await rpc("inst_verifier_rattachement", { p_etablissement: id, p_confirmer: ok, p_motif: motif || "" }); recharger() } catch (x) { setErr(x.message) }
  }
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <h1 className="h4">{t("Établissements de mon département")}</h1>
      <p className="small text-muted">{t("Un établissement n'apparaît ici qu'après avoir déclaré son rattachement ; vérifiez-le pour qu'il puisse vous transmettre ses fiches.")}</p>
      <Alerte>{err}</Alerte>
      <table className="table table-sm align-middle"><thead><tr><th>{t("Établissement")}</th><th>{t("Ville")}</th><th>{t("Rattachement")}</th><th /></tr></thead>
        <tbody>{liste.map((e) => (
          <tr key={e.id}><td>{e.nom}</td><td>{e.ville}</td><td>{e.rattachement === "verifie" ? <span className="text-success">{t("vérifié")}</span> : <span className="text-warning">{t("à vérifier")}</span>}</td>
            <td className="text-end">{e.rattachement === "declare" && peut(membre, "examen") && <>
              <button className="btn btn-sm btn-success me-1" onClick={() => verifier(e.id, true)}>{t("Confirmer")}</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => verifier(e.id, false)}>{t("Refuser")}</button></>}</td></tr>))}</tbody></table>
      {!liste.length && <p className="text-muted">{t("Aucun établissement rattaché pour le moment.")}</p>}
    </>
  )
}

/** Examen d'une fiche reçue (établissement → délégation départementale, ou synthèse départementale → régionale). */
function ExamenFiche({ membre }) {
  const { id } = useParams()
  const [version, setVersion] = useState(null)
  const [f, erreur, recharger] = useDonnees(() => rpc("inst_fiche_lire", { p_fiche: id, p_version: version }), [id, version])
  const [appreciations] = useDonnees(() => rpc("inst_appreciations_lire"), [])
  const [texte, setTexte] = useState(""), [elements, setElements] = useState(""), [appr, setAppr] = useState(""), [err, setErr] = useState(""), [comparer, setComparer] = useState(null)
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!f) return <Chargement />
  const pub = f.publiee
  const action = async (nom, params) => { setErr(""); try { await rpc(nom, { p_fiche: id, ...params }); setTexte(""); setElements(""); recharger() } catch (x) { setErr(x.message) } }
  const titre = f.etablissement?.nom || f.delegation?.nom
  const ouvrirPdf = () => (f.niveau === "etablissement" ? fichePdf : synthesePdf)({ fiche: f, donnees: normaliserBrouillon(pub.donnees), indicateurs: pub.indicateurs, version: pub.version, publieLe: pub.publie_le, publiePar: pub.publie_par })
  return (
    <>
      <Link className="small" to="/institution/fiches">← {t("Fiches reçues")}</Link>
      <div className="d-flex flex-wrap justify-content-between gap-2 mt-1 mb-2">
        <div><h1 className="h4 mb-1">{titre} — {periode(f.periode)} {f.exercice}</h1>
          <div className="small text-muted"><BadgeStatut statut={f.statut} /> · {t("Version {v0} publiée le {v1}", { v0: pub?.version, v1: dateHeure(pub?.publie_le) })}{pub?.en_retard ? ` · ${t("après l'échéance")}` : ""}
            {f.acces === "derogation" && ` · ${t("consultation par accès exceptionnel (journalisée)")}`}</div></div>
        <div className="d-flex gap-2">
          {f.versions.length > 1 && <select className="form-select form-select-sm w-auto" aria-label={t("Version")} value={version ?? ""} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t("Dernière version")}</option>{f.versions.map((v) => <option key={v.version} value={v.version}>{t("Version {v0}", { v0: v.version })}</option>)}</select>}
          {f.versions.length > 1 && pub?.version > 1 && <button className="btn btn-sm btn-outline-secondary" onClick={async () => setComparer((await rpc("inst_fiche_lire", { p_fiche: id, p_version: pub.version - 1 })).publiee)}>{t("Comparer avec la version précédente")}</button>}
          {pub && <button className="btn btn-sm btn-outline-secondary" onClick={ouvrirPdf}>{t("PDF")}</button>}
        </div>
      </div>
      <Alerte>{err}</Alerte>
      {comparer && <ComparaisonVersions avant={comparer} apres={pub} onFermer={() => setComparer(null)} />}
      <div className="card mb-3"><div className="card-body">
        {f.niveau === "etablissement" ? <VueFiche donnees={pub?.donnees} indicateurs={pub?.indicateurs} /> : <VueSynthese pub={pub} />}
        {(pub?.anomalies || []).length > 0 && <><h3 className="h6 mt-3">{t("Anomalies signalées à la publication")}</h3><ListeAnomalies anomalies={pub.anomalies} /></>}
      </div></div>
      {f.acces === "destinataire" && peut(membre, "examen") && <div className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Examen")}</h2>
        <textarea className="form-control mb-2" rows={3} maxLength={3000} aria-label={t("Commentaire")} placeholder={t("Commentaire ou correction demandée…")} value={texte} onChange={(e) => setTexte(e.target.value)} />
        <input className="form-control form-control-sm mb-2" maxLength={300} aria-label={t("Éléments concernés")} placeholder={t("Éléments concernés (ex. : ligne 2, assiduité), séparés par des virgules")} value={elements} onChange={(e) => setElements(e.target.value)} />
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button className="btn btn-sm btn-outline-primary" disabled={!texte.trim()} onClick={() => action("inst_fiche_commenter", { p_texte: texte })}>{t("Commenter")}</button>
          <button className="btn btn-sm btn-warning" disabled={!texte.trim() || !["publiee", "republiee", "en_examen", "examinee"].includes(f.statut)}
                  onClick={() => action("inst_fiche_demander_correction", { p_texte: texte, p_elements: elements.split(",").map((x) => x.trim()).filter(Boolean) })}>{t("Demander une correction")}</button>
          <select className="form-select form-select-sm w-auto" aria-label={t("Appréciation")} value={appr} onChange={(e) => setAppr(e.target.value)}>
            <option value="">{t("Appréciation (facultative)")}</option>{(appreciations || []).map((a) => <option key={a.code} value={a.code}>{a.libelle}</option>)}</select>
          <button className="btn btn-sm btn-success" disabled={!["publiee", "republiee", "en_examen"].includes(f.statut)} onClick={() => action("inst_fiche_examinee", { p_appreciation: appr || null })}>{t("Marquer reçue et examinée")}</button>
        </div>
        <p className="small text-muted mt-2 mb-0">{t("Les appréciations sont des repères internes configurables : elles ne constituent pas une notation réglementaire.")}</p>
      </div></div>}
      <div className="card"><div className="card-body"><HistoriqueFiche fiche={f} /></div></div>
    </>
  )
}

function ComparaisonVersions({ avant, apres, onFermer }) {
  const ia = avant.indicateurs?.indicateurs || {}, ib = apres.indicateurs?.indicateurs || {}
  return (
    <div className="card border-info mb-3"><div className="card-body">
      <div className="d-flex justify-content-between"><h2 className="h6">{t("Comparaison : version {v0} → version {v1}", { v0: avant.version, v1: apres.version })}</h2>
        <button className="btn-close" aria-label={t("Fermer")} onClick={onFermer} /></div>
      <table className="table table-sm mb-0"><thead><tr><th>{t("Indicateur")}</th><th className="text-end">{t("Avant")}</th><th className="text-end">{t("Après")}</th></tr></thead>
        <tbody>{Object.keys({ ...ia, ...ib }).map((k) => <tr key={k} className={ia[k]?.taux !== ib[k]?.taux ? "table-warning" : ""}><td>{k}</td>
          <td className="text-end">{taux(ia[k]?.taux)}</td><td className="text-end">{taux(ib[k]?.taux)}</td></tr>)}</tbody></table>
    </div></div>
  )
}

function VueSynthese({ pub }) {
  if (!pub) return null
  const i = pub.indicateurs || {}
  return (
    <>
      <p className="small">{t("Documents comptés : {v0} sur {v1} attendus · observations : {v2}", { v0: nombre(i.nb_fiches), v1: nombre(i.attendus), v2: nombre(i.nb_observations) })}</p>
      <TableIndicateurs indicateurs={i.indicateurs} consolide />
      <VueFiche donnees={{ ...pub.donnees, lignes: [] }} indicateurs={{ synthese: {} }} />
    </>
  )
}

/** Consolidation (départementale ou régionale) : reçues, manquantes, en correction ; calcul pondéré, jamais zéro pour un manquant. */
function Consolidation({ niveau }) {
  const camp = useCampagnes(niveau)
  const [c, erreur] = useDonnees(() => (camp.id ? rpc("inst_consolidation", { p_campagne: camp.id }) : Promise.resolve(null)), [camp.id])
  if (camp.erreur || erreur) return <Alerte>{camp.erreur || erreur}</Alerte>
  return (
    <>
      <h1 className="h4">{niveau === "departement" ? t("Analyse et consolidation régionale") : t("Analyse et consolidation")}</h1>
      <SelecteurCampagne {...camp} />
      {!c ? (camp.id ? <Chargement /> : null) : <>
        <Compteurs items={[["Attendues", c.attendus], ["Reçues", c.recus, "primary"], ["Manquantes", c.manquants, c.manquants ? "danger" : ""],
          ["En attente de correction", c.en_correction, c.en_correction ? "warning" : ""], ["Fiches consolidées", c.nb_fiches], ["Observations", c.nb_observations]]} />
        {c.manquants > 0 && <div className="alert alert-warning small">{t("Consolidation partielle : {v0} document(s) attendu(s) non reçu(s). Les données manquantes ne sont jamais comptées comme des zéros.", { v0: c.manquants })}</div>}
        <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("Indicateurs consolidés (pondérés)")} — {c.perimetre}</h2>
          <TableIndicateurs indicateurs={c.indicateurs} consolide /></div></div>
        {Object.keys(c.par_discipline || {}).length > 0 && <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("Couverture par discipline")}</h2>
          <table className="table table-sm"><thead><tr><th>{t("Discipline")}</th><th className="text-end">{t("Théorie")}</th><th className="text-end">{t("Pratique")}</th><th className="text-end">{t("Heures théorie")}</th></tr></thead>
            <tbody>{Object.entries(c.par_discipline).sort().map(([d, x]) => <tr key={d}><td>{d}</td><td className="text-end">{taux(x.couverture_theorie?.taux)}</td>
              <td className="text-end">{taux(x.couverture_pratique?.taux)}</td><td className="text-end">{taux(x.heures_theorie?.taux)}</td></tr>)}</tbody></table></div></div>}
        <div className="card"><div className="card-body"><h2 className="h6">{t("Détail des documents comptés")}</h2>
          <table className="table table-sm"><thead><tr><th>{t("Source")}</th><th>{t("Statut")}</th><th className="text-end">{t("Couverture théorie")}</th><th className="text-end">{t("Heures théorie")}</th><th /></tr></thead>
            <tbody>{c.detail.map((x) => <tr key={x.fiche_id}><td>{x.nom}{x.nb_fiches ? ` (${t("{v0} fiches", { v0: x.nb_fiches })})` : ""}</td><td><BadgeStatut statut={x.statut} /></td>
              <td className="text-end">{taux(x.indicateurs?.couverture_theorie?.taux)}</td><td className="text-end">{taux(x.indicateurs?.heures_theorie?.taux)}</td>
              <td><Link className="small" to={`/institution/fiches/${x.fiche_id}`}>{t("Voir")}</Link></td></tr>)}</tbody></table></div></div>
      </>}
    </>
  )
}

/** Tableau de bord régional (et vues délégations, synthèses reçues, départements en retard). */
function TableauRegion({ liste = false, recues = false, retards = false, membre }) {
  const camp = useCampagnes("departement")
  const [d, erreur] = useDonnees(() => (camp.id ? rpc("inst_tableau_region", { p_campagne: camp.id }) : Promise.resolve(null)), [camp.id])
  const [info, setInfo] = useState(""), [err, setErr] = useState("")
  if (camp.erreur || erreur) return <Alerte>{camp.erreur || erreur}</Alerte>
  let lignes = d?.departements || []
  if (recues) lignes = lignes.filter((x) => x.statut !== "non_publiee")
  if (retards) lignes = lignes.filter((x) => x.statut === "non_publiee" && x.en_retard)
  const c = d?.compteurs
  async function relancer(ids) {
    setErr(""); try { setInfo(t("{v0} relance(s) envoyée(s).", { v0: await rpc("inst_relancer", { p_campagne: camp.id, p_cibles: ids }) })) } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1 className="h4">{liste ? t("Délégations départementales") : recues ? t("Synthèses départementales reçues") : retards ? t("Départements en retard") : t("Tableau de bord régional")}</h1>
      <SelecteurCampagne {...camp} />
      {!d ? (camp.id ? <Chargement /> : null) : <>
        {!liste && !recues && !retards && <Compteurs items={[["Départements", c.departements], ["Délégations actives", c.delegations_actives], ["Synthèses reçues", c.recues, "primary"],
          ["En retard", c.en_retard, c.en_retard ? "danger" : ""], ["En correction", c.correction, c.correction ? "warning" : ""], ["Examinées", c.examinees, "success"]]} />}
        <Alerte>{err}</Alerte><Alerte type="success">{info}</Alerte>
        {retards && peut(membre, "examen") && lignes.some((x) => x.delegation_id) && <button className="btn btn-sm btn-warning mb-2" onClick={() => relancer(lignes.filter((x) => x.delegation_id).map((x) => x.delegation_id))}>{t("Relancer les délégations en retard")}</button>}
        <table className="table table-sm align-middle"><thead><tr><th>{t("Département")}</th><th>{t("Délégation")}</th><th>{t("Établissements rattachés")}</th><th>{t("Synthèse")}</th><th>{t("Publication")}</th><th>{t("Fiches comptées")}</th><th /></tr></thead>
          <tbody>{lignes.map((x) => (
            <tr key={x.departement_id}><td>{x.departement}</td><td>{x.delegation ? (x.active ? t("active") : t("inactive")) : <span className="text-muted">{t("non enregistrée")}</span>}</td>
              <td>{x.etablissements}</td><td><BadgeStatut statut={x.statut} /></td><td>{x.publie_le ? dateHeure(x.publie_le) : "—"}</td><td>{nombre(x.nb_fiches)}</td>
              <td>{x.fiche_id && x.statut !== "non_publiee" && <Link className="btn btn-sm btn-outline-primary" to={`/institution/fiches/${x.fiche_id}`}>{t("Examiner")}</Link>}</td></tr>))}</tbody></table>
        <p className="small text-muted">{t("Les fiches brutes des établissements ne sont pas accessibles au niveau régional, sauf accès exceptionnel accordé par l'administrateur de NexIA School.")}</p>
      </>}
    </>
  )
}

function Syntheses({ membre }) {
  const naviguer = useNavigate()
  const [liste, erreur] = useDonnees(() => rpc("inst_syntheses"), [])
  const [err, setErr] = useState("")
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  async function preparer(c) { setErr(""); try { naviguer(`/institution/synthese/${await rpc("inst_synthese_preparer", { p_campagne: c.id })}`) } catch (x) { setErr(x.message) } }
  return (
    <>
      <h1 className="h4">{t("Ma synthèse")}</h1><Alerte>{err}</Alerte>
      {!liste.length && <p className="text-muted">{t("Aucune campagne de synthèse n'est configurée.")}</p>}
      <table className="table align-middle"><tbody>{liste.map((c) => (
        <tr key={c.id}><td>{c.exercice} — {periode(c.periode)}</td><td>{t("Échéance : ")}{date(c.echeance_effective)}</td>
          <td>{c.fiche ? <BadgeStatut statut={c.fiche.statut} /> : <span className="small text-muted">{t("Non commencée")}</span>}</td>
          <td className="text-end">{c.fiche ? <Link className="btn btn-sm btn-outline-primary" to={`/institution/synthese/${c.fiche.id}`}>{t("Ouvrir")}</Link>
            : c.ouvert && peut(membre, "synthese") ? <button className="btn btn-sm btn-primary" onClick={() => preparer(c)}>{t("Préparer")}</button> : null}</td></tr>))}</tbody></table>
    </>
  )
}

function EditeurSynthese({ membre }) {
  const { id } = useParams()
  const [f, erreur, recharger] = useDonnees(() => rpc("inst_fiche_lire", { p_fiche: id }), [id])
  const [b, setB] = useState(null), [err, setErr] = useState(""), [info, setInfo] = useState(""), [conso, setConso] = useState(null)
  useEffect(() => { if (f) setB(normaliserBrouillon(f.brouillon)) }, [f])
  const [campEtab] = useDonnees(() => (f ? rpc("inst_campagnes_lire", { p_niveau: f.niveau === "region" ? "departement" : "etablissement" }) : Promise.resolve([])), [f?.id])
  useEffect(() => {
    const c = (campEtab || []).find((x) => x.exercice === f?.exercice && x.periode === f?.periode)
    if (c) rpc("inst_consolidation", { p_campagne: c.id }).then(setConso).catch(() => setConso(null))
  }, [campEtab, f?.exercice, f?.periode])
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!f || !b) return <Chargement />
  const modifiable = ["brouillon", "prete", "correction_demandee", "corrigee"].includes(f.statut) && peut(membre, "synthese")
  const enregistrer = async () => { setErr(""); try { await rpc("inst_fiche_enregistrer", { p_fiche: id, p_donnees: b }); setInfo(t("Enregistré.")) } catch (x) { setErr(x.message) } }
  async function publier() {
    setErr(""); setInfo("")
    try {
      await rpc("inst_fiche_enregistrer", { p_fiche: id, p_donnees: b })
      let r
      try { r = await rpc("inst_fiche_publier", { p_fiche: id, p_confirmer: false }) } catch (x) {
        if (!/confirmez/i.test(x.message) || !confirm(t("La consolidation est partielle (documents manquants). Publier quand même ?"))) throw x
        r = await rpc("inst_fiche_publier", { p_fiche: id, p_confirmer: true })
      }
      setInfo(r.destinataire ? t("Synthèse publiée (version {v0}) et transmise à : {v1}.", { v0: r.version, v1: r.destinataire }) : t("Synthèse publiée (version {v0}).", { v0: r.version }))
      recharger()
    } catch (x) { setErr(x.message) }
  }
  const pub = f.publiee
  return (
    <>
      <Link className="small" to="/institution/synthese">← {t("Mes synthèses")}</Link>
      <div className="d-flex justify-content-between flex-wrap gap-2 mt-1"><h1 className="h4">{f.niveau === "region" ? t("Synthèse régionale") : t("Synthèse départementale")} — {periode(f.periode)} {f.exercice}</h1>
        <div className="d-flex gap-2"><BadgeStatut statut={f.statut} />
          <button className="btn btn-sm btn-outline-secondary" onClick={() => synthesePdf({ fiche: f, donnees: modifiable ? b : pub.donnees, indicateurs: modifiable ? { ...conso, attendus: conso?.attendus } : pub.indicateurs, version: modifiable ? null : pub.version, publieLe: pub?.publie_le, publiePar: pub?.publie_par })}>{modifiable ? t("Aperçu PDF") : t("PDF")}</button></div></div>
      <Alerte>{err}</Alerte><Alerte type="success">{info}</Alerte>
      <div className="card mb-3"><div className="card-body"><h2 className="h6">{modifiable ? t("Consolidation en direct (figée au moment de la publication)") : t("Consolidation publiée")}</h2>
        {modifiable ? (conso ? <><p className="small">{t("Documents reçus : {v0} sur {v1} attendus.", { v0: conso.recus, v1: conso.attendus })}</p><TableIndicateurs indicateurs={conso.indicateurs} consolide /></> : <p className="small text-muted">{t("Aucune donnée reçue pour cette période.")}</p>)
          : <VueSynthese pub={pub} />}</div></div>
      {modifiable && <div className="card mb-3"><div className="card-body">
        {[["observations", "Observations"], ["difficultes", "Difficultés"], ["recommandations", "Recommandations"]].map(([k, l]) => (
          <div className="mb-2" key={k}><label className="form-label small" htmlFor={`syn-${k}`}>{t(l)}</label>
            <textarea className="form-control" id={`syn-${k}`} rows={3} maxLength={4000} value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></div>))}
        <div className="d-flex gap-2"><button className="btn btn-outline-primary btn-sm" onClick={enregistrer}>{t("Enregistrer")}</button>
          <button className="btn btn-primary btn-sm" onClick={publier}>{t("Publier")}</button></div>
      </div></div>}
      <div className="card"><div className="card-body"><HistoriqueFiche fiche={f} /></div></div>
    </>
  )
}

/** Courriers : rédaction, envoi (périmètre vérifié par le serveur), suivi ; courriers reçus de la délégation régionale. */
function Courriers({ membre, delegation }) {
  const [onglet, setOnglet] = useState("envoyes")
  const [envoyes, e1, rechargerEnvoyes] = useDonnees(() => rpc("inst_courriers_envoyes"), [])
  const [recus, e2, rechargerRecus] = useDonnees(() => (delegation.niveau === "departement" ? rpc("inst_courriers_recus") : Promise.resolve([])), [])
  const [ouvert, setOuvert] = useState(null)
  if (e1 || e2) return <Alerte>{e1 || e2}</Alerte>
  return (
    <>
      <h1 className="h4">{t("Courriers")}</h1>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button className={`nav-link ${onglet === "envoyes" ? "active" : ""}`} onClick={() => setOnglet("envoyes")}>{t("Courriers envoyés")}</button></li>
        {peut(membre, "courriers") && <li className="nav-item"><button className={`nav-link ${onglet === "nouveau" ? "active" : ""}`} onClick={() => setOnglet("nouveau")}>{t("Nouveau courrier")}</button></li>}
        {delegation.niveau === "departement" && <li className="nav-item"><button className={`nav-link ${onglet === "recus" ? "active" : ""}`} onClick={() => setOnglet("recus")}>{t("Courriers reçus")}</button></li>}
      </ul>
      {onglet === "nouveau" && <RedactionCourrier delegation={delegation} onEnvoye={() => { rechargerEnvoyes(); setOnglet("envoyes") }} />}
      {onglet === "envoyes" && (!envoyes ? <Chargement /> : <>
        {!envoyes.length && <p className="text-muted">{t("Aucun courrier.")}</p>}
        {envoyes.map((c) => <div className="card mb-2" key={c.id}><div className="card-body py-2">
          <div className="d-flex justify-content-between flex-wrap gap-2"><button className="btn btn-link p-0 text-start" onClick={() => setOuvert(ouvert === c.id ? null : c.id)}>
            {c.reference || t("Brouillon")} — {c.objet}</button>
            <span className="small text-muted">{statutCourrier(c.statut)} · {c.envoye_le ? dateHeure(c.envoye_le) : dateHeure(c.cree_le)}
              {c.statut !== "brouillon" && ` · ${t("{v0} lu(s) / {v1}", { v0: c.destinataires.filter((d) => d.lu_le).length, v1: c.destinataires.length })} · ${t("{v0} réponse(s)", { v0: c.destinataires.filter((d) => d.statut === "repondu").length })}`}</span></div>
          {ouvert === c.id && <div className="mt-2 small">
            <div style={{ whiteSpace: "pre-wrap" }} className="mb-2">{c.corps}</div>
            {c.pieces.map((p) => <Piece key={p} chemin={p} />)}
            <table className="table table-sm mt-2"><tbody>{c.destinataires.map((d) => <tr key={d.id}><td>{d.nom}</td><td>{statutCourrier(d.statut)}</td><td>{d.lu_le ? dateHeure(d.lu_le) : "—"}</td>
              <td>{d.reponses.map((r, i) => <div key={i}><span className="text-muted">{dateHeure(r.le)} · {r.auteur} :</span> {r.texte} {r.pieces.map((p) => <Piece key={p} chemin={p} />)}</div>)}</td></tr>)}</tbody></table>
            <div className="d-flex gap-2"><button className="btn btn-sm btn-outline-secondary" onClick={() => courrierPdf(c, c.destinataires.map((d) => d.nom))}>{t("PDF")}</button>
              {c.statut === "brouillon" && peut(membre, "courriers") && <RedactionCourrier delegation={delegation} brouillon={c} onEnvoye={rechargerEnvoyes} compact />}
              {c.statut === "envoye" && <button className="btn btn-sm btn-outline-secondary" onClick={async () => { await rpc("inst_courrier_archiver", { p_courrier: c.id }); rechargerEnvoyes() }}>{t("Archiver")}</button>}</div>
          </div>}
        </div></div>)}
      </>)}
      {onglet === "recus" && (!recus ? <Chargement /> : <>
        {!recus.length && <p className="text-muted">{t("Aucun courrier.")}</p>}
        <div className="list-group mb-3">{recus.map((c) => <button key={c.destinataire_id} className={`list-group-item list-group-item-action ${ouvert === c.destinataire_id ? "active" : ""}`}
          onClick={async () => { setOuvert(c.destinataire_id); if (!c.lu_le) { await rpc("inst_courrier_lu", { p_destinataire: c.destinataire_id }); rechargerRecus() } }}>{c.reference} — {c.objet} <span className="small">· {c.expediteur?.nom}</span></button>)}</div>
        {(() => { const c = recus.find((x) => x.destinataire_id === ouvert); return c && <LectureCourrier c={c} dossier={`reponses/${delegation.id}`} recharger={rechargerRecus} peutRepondre={peut(membre, "courriers")} /> })()}
      </>)}
    </>
  )
}

function RedactionCourrier({ delegation, brouillon, onEnvoye, compact = false }) {
  const [types] = useDonnees(() => rpc("inst_courrier_types_lire"), [])
  const [perimetre] = useDonnees(() => rpc("inst_perimetre"), [])
  const [f, setF] = useState({ id: brouillon?.id || null, type: brouillon?.type || "rappel", objet: brouillon?.objet || "", corps: brouillon?.corps || "", date_limite: brouillon?.date_limite || "", pieces: brouillon?.pieces || [] })
  const [dest, setDest] = useState([]), [tous, setTous] = useState(false), [fichier, setFichier] = useState(null), [err, setErr] = useState(""), [envoi, setEnvoi] = useState(false)
  const possibles = (perimetre || []).filter((x) => (delegation.niveau === "departement" ? x.rattachement === "verifie" : x.actif))
  async function sauver() {
    const piece = await deposerPiece(`courriers/${delegation.id}`, fichier)
    const p = { ...f, pieces: piece ? [...f.pieces, piece] : f.pieces }
    const id = await rpc("inst_courrier_enregistrer", { p }); setF({ ...p, id }); setFichier(null); return id
  }
  async function action(envoyer) {
    setErr(""); setEnvoi(true)
    try {
      const id = await sauver()
      if (envoyer) {
        if (!confirm(t("Un courrier envoyé ne peut plus être modifié. Envoyer maintenant ?"))) return
        await rpc("inst_courrier_envoyer", { p_courrier: id, p_destinataires: tous ? null : dest, p_tous: tous })
      }
      onEnvoye?.()
    } catch (x) { setErr(x.message) } finally { setEnvoi(false) }
  }
  return (
    <div className={compact ? "w-100 mt-2" : "card"}><div className={compact ? "" : "card-body"}>
      <Alerte>{err}</Alerte>
      <div className="row g-2">
        <div className="col-md-4"><label className="form-label small" htmlFor="c-type">{t("Type")}</label>
          <select className="form-select form-select-sm" id="c-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{(types || []).map((x) => <option key={x.code} value={x.code}>{x.libelle}</option>)}</select></div>
        <div className="col-md-8"><label className="form-label small" htmlFor="c-objet">{t("Objet")}</label>
          <input className="form-control form-control-sm" id="c-objet" maxLength={200} value={f.objet} onChange={(e) => setF({ ...f, objet: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small" htmlFor="c-corps">{t("Corps du courrier")}</label>
          <textarea className="form-control" id="c-corps" rows={8} maxLength={10000} value={f.corps} onChange={(e) => setF({ ...f, corps: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="c-limite">{t("Date limite de réponse")}</label>
          <input className="form-control form-control-sm" id="c-limite" type="date" value={f.date_limite || ""} onChange={(e) => setF({ ...f, date_limite: e.target.value })} /></div>
        <div className="col-md-8"><label className="form-label small" htmlFor="c-piece">{t("Pièce jointe (PDF ou image, 5 Mo)")}</label>
          <input className="form-control form-control-sm" id="c-piece" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
          {f.pieces.length > 0 && <div className="small">{f.pieces.map((p) => <Piece key={p} chemin={p} />)}</div>}</div>
      </div>
      <div className="mt-3"><span className="form-label small d-block">{t("Destinataires")}</span>
        <div className="form-check"><input className="form-check-input" type="checkbox" id="c-tous" checked={tous} onChange={(e) => setTous(e.target.checked)} />
          <label className="form-check-label small" htmlFor="c-tous">{delegation.niveau === "departement" ? t("Tous les établissements de mon département") : t("Toutes les délégations départementales de ma région")}</label></div>
        {!tous && <div className="border rounded p-2" style={{ maxHeight: 200, overflow: "auto" }}>{possibles.map((x) => (
          <div className="form-check" key={x.id}><input className="form-check-input" type="checkbox" id={`d-${x.id}`} checked={dest.includes(x.id)} onChange={(e) => setDest(e.target.checked ? [...dest, x.id] : dest.filter((i) => i !== x.id))} />
            <label className="form-check-label small" htmlFor={`d-${x.id}`}>{x.nom}{x.departement ? ` (${x.departement})` : ""}</label></div>))}
          {!possibles.length && <span className="small text-muted">{t("Aucun destinataire possible pour le moment.")}</span>}</div>}
      </div>
      <div className="d-flex gap-2 mt-3"><button className="btn btn-sm btn-outline-primary" disabled={envoi} onClick={() => action(false)}>{t("Enregistrer le brouillon")}</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => courrierPdf({ ...f, type_libelle: (types || []).find((x) => x.code === f.type)?.libelle, expediteur: { nom: delegation.nom } })}>{t("Aperçu PDF")}</button>
        <button className="btn btn-sm btn-primary" disabled={envoi || !f.objet.trim() || (!tous && !dest.length)} onClick={() => action(true)}>{t("Envoyer")}</button></div>
    </div></div>
  )
}

function FichesBrutes() {
  const [liste, erreur] = useDonnees(() => rpc("inst_fiches_derogation"), [])
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <h1 className="h4">{t("Accès exceptionnels aux fiches des établissements")}</h1>
      <p className="small text-muted">{t("Accordés par l'administrateur de NexIA School, limités dans le temps ; chaque consultation est journalisée.")}</p>
      {!liste.length && <p className="text-muted">{t("Aucun accès exceptionnel en cours.")}</p>}
      {liste.map((g) => <div className="card mb-2" key={g.derogation}><div className="card-body">
        <div className="small text-muted">{t("Jusqu'au {v0} · motif : {v1}", { v0: dateHeure(g.fin), v1: g.motif })}</div>
        <ul className="mb-0">{g.fiches.map((f) => <li key={f.id}><Link to={`/institution/fiches/${f.id}`}>{f.etablissement} — {periode(f.periode)} {f.exercice}</Link></li>)}</ul>
      </div></div>)}
    </>
  )
}

/** IA & API : clés de lecture seule (préfixe nxd_), catégories de données autorisées, historique des appels. */
function IaApi() {
  const [d, erreur, recharger] = useDonnees(() => rpc("inst_ia_cles"), [])
  const [cle, setCle] = useState(""), [libelle, setLibelle] = useState(""), [err, setErr] = useState("")
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!d) return <Chargement />
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`
  return (
    <>
      <h1 className="h4">{t("IA & API")}</h1>
      <p className="small">{t("Connectez votre assistant d'IA (client compatible MCP) pour interroger, en lecture seule, les données de votre circonscription : statuts de transmission, indicateurs consolidés. L'assistant ne peut ni publier, ni modifier, ni valider, ni envoyer.")}</p>
      <p className="small text-muted">{t("Les requêtes de l'assistant sont traitées par le fournisseur d'IA que vous choisissez, selon son propre contrat et sa propre facturation ; un transfert de données hors du Cameroun doit être vérifié au regard de la loi applicable. Aucun nom d'élève n'est transmis.")}</p>
      <Alerte>{err}</Alerte>
      {cle && <div className="alert alert-warning"><div className="small">{t("Votre clé (affichée une seule fois) :")}</div><code className="user-select-all">{cle}</code></div>}
      <div className="card mb-3"><div className="card-body">
        <div className="small mb-2">{t("Adresse du serveur MCP : ")}<code>{url}</code></div>
        <div className="small mb-2">{t("Catégories de données autorisées par l'administrateur : ")}{d.categories.map((c) => t(CATEGORIES_IA[c] || c)).join(", ")}</div>
        <div className="d-flex gap-2"><input className="form-control form-control-sm w-auto" maxLength={80} aria-label={t("Nom de la clé")} placeholder={t("Nom de la clé")} value={libelle} onChange={(e) => setLibelle(e.target.value)} />
          <button className="btn btn-sm btn-primary" onClick={async () => { setErr(""); try { setCle(await rpc("inst_ia_creer_cle", { p_libelle: libelle })); recharger() } catch (x) { setErr(x.message) } }}>{t("Créer une clé")}</button></div>
      </div></div>
      <table className="table table-sm"><thead><tr><th>{t("Clé")}</th><th>{t("Créée le")}</th><th>{t("Expire le")}</th><th>{t("Dernier usage")}</th><th /></tr></thead>
        <tbody>{d.cles.map((k) => <tr key={k.id}><td>{k.libelle || "—"} <code className="small">{k.apercu}</code></td><td>{date(k.cree_le)}</td><td>{date(k.expire_le)}</td><td>{k.dernier_usage ? dateHeure(k.dernier_usage) : "—"}</td>
          <td>{k.revoque_le ? <span className="small text-muted">{t("révoquée")}</span> : <button className="btn btn-sm btn-outline-danger" onClick={async () => { await rpc("inst_ia_revoquer", { p_id: k.id }); recharger() }}>{t("Révoquer")}</button>}</td></tr>)}</tbody></table>
      <h2 className="h6">{t("Derniers appels")}</h2>
      <ul className="small">{d.appels.map((a, i) => <li key={i}>{dateHeure(a.le)} · {a.outil} · {a.resultat}</li>)}</ul>
    </>
  )
}

function ParametresEspace({ espace, recharger }) {
  const { membre, delegation, collaborateurs } = espace
  const [email, setEmail] = useState(""), [perms, setPerms] = useState(["courriers"]), [err, setErr] = useState("")
  const [journal] = useDonnees(() => (membre.role === "titulaire" ? rpc("inst_journal_delegation") : Promise.resolve([])), [])
  return (
    <>
      <h1 className="h4">{t("Paramètres de mon espace")}</h1>
      <div className="card mb-3"><div className="card-body small">
        <div><strong>{delegation.nom}</strong></div>
        <div>{delegation.region}{delegation.departement ? ` › ${delegation.departement}` : ""}</div>
        <div>{membre.prenom} {membre.nom} · {membre.fonction} · {membre.email}</div>
        <div className="text-muted mt-2">{t("Pour un changement de titulaire, contactez l'administrateur de NexIA School : la délégation, ses documents et son historique sont conservés.")}</div>
      </div></div>
      {membre.role === "titulaire" && <div className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Collaborateurs")}</h2>
        {!delegation.collaborateurs_autorises ? <p className="small text-muted mb-0">{t("Les collaborateurs ne sont pas activés pour votre délégation (réglage de l'administrateur de NexIA School).")}</p> : <>
          <Alerte>{err}</Alerte>
          <ul className="small">{(collaborateurs || []).map((c) => <li key={c.id}>{c.email} — {c.permissions.map((p) => t(PERMISSIONS[p])).join(", ") || t("lecture seule")}
            <button className="btn btn-link btn-sm text-danger p-0 ms-2" onClick={async () => { await rpc("inst_collaborateur_retirer", { p_membre: c.id }); recharger() }}>{t("Retirer")}</button></li>)}</ul>
          <div className="d-flex flex-wrap gap-2 align-items-center"><input className="form-control form-control-sm w-auto" type="email" aria-label={t("Adresse e-mail")} placeholder={t("Adresse e-mail du collaborateur")} value={email} onChange={(e) => setEmail(e.target.value)} />
            {Object.entries(PERMISSIONS).map(([k, l]) => <div className="form-check form-check-inline small" key={k}><input className="form-check-input" type="checkbox" id={`p-${k}`} checked={perms.includes(k)}
              onChange={(e) => setPerms(e.target.checked ? [...perms, k] : perms.filter((x) => x !== k))} /><label className="form-check-label" htmlFor={`p-${k}`}>{t(l)}</label></div>)}
            <button className="btn btn-sm btn-primary" onClick={async () => { setErr(""); try { await rpc("inst_collaborateur_ajouter", { p_email: email, p_permissions: perms }); setEmail(""); recharger() } catch (x) { setErr(x.message) } }}>{t("Ajouter")}</button></div>
          <p className="form-text">{t("La personne doit d'abord créer son compte (adresse vérifiée) sur la page d'inscription des délégations.")}</p></>}
      </div></div>}
      {membre.role === "titulaire" && <div className="card"><div className="card-body"><h2 className="h6">{t("Journal de la délégation")}</h2>
        <ul className="small mb-0" style={{ maxHeight: 300, overflow: "auto" }}>{(journal || []).map((j, i) => <li key={i}>{dateHeure(j.le)} · {j.action} · {j.objet}</li>)}</ul></div></div>}
    </>
  )
}
