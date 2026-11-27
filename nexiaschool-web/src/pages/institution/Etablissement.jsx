// Espace établissement du pilotage institutionnel : localisation administrative, fiches de synthèse statistiques
// (préparation, saisie, enregistrement automatique, aperçu, PDF, publication), historique, courriers reçus et réponses.
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { date, dateHeure } from "../../lib/format.js"
import { CHAMPS_HEURES, CHAMPS_LECONS, SOURCES, afficherValeur, compterAnomalies, ligneVide, lireValeur, normaliserBrouillon, periode, sourceValeur, statutCourrier, tauxLigne } from "../../lib/institution.js"
import { courrierPdf, fichePdf } from "../../lib/institutionPdf.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { BadgeStatut, ChoixLocalisation, HistoriqueFiche, ListeAnomalies, Notifications, Piece, TableIndicateurs, VueFiche, deposerPiece, taux } from "./Composants.jsx"

const MODIFIABLES = ["brouillon", "prete", "correction_demandee", "corrigee"]
const DELAI_ENREGISTREMENT = 2500

export default function FichesStatistiques() {
  const lien = ({ isActive }) => "nav-link" + (isActive ? " active" : "")
  return (
    <>
      <ul className="nav nav-tabs mb-3 no-print">
        <li className="nav-item"><NavLink className={lien} to="/fiches-statistiques" end>{t("Mes fiches statistiques")}</NavLink></li>
        <li className="nav-item"><NavLink className={lien} to="/fiches-statistiques/historique">{t("Historique des publications")}</NavLink></li>
        <li className="nav-item"><NavLink className={lien} to="/fiches-statistiques/notifications">{t("Notifications")}</NavLink></li>
      </ul>
      <Routes>
        <Route index element={<MesFiches />} />
        <Route path="historique" element={<MesFiches historique />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path=":id" element={<EditeurFiche />} />
      </Routes>
    </>
  )
}

/** Rattachement administratif : déclaration par l'établissement, vérification par la délégation (jamais de changement silencieux). */
function Localisation({ loc, recharger }) {
  const [choix, setChoix] = useState({ region_id: loc?.region_id || "", departement_id: loc?.departement_id || "" })
  const [modifier, setModifier] = useState(false), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  async function declarer(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      if (loc?.departement_id && loc.departement_id !== choix.departement_id && !confirm(t("Changer de département remet le rattachement en attente de vérification. Continuer ?"))) return
      await rpc("etablissement_localisation", { p_departement: choix.departement_id }); setModifier(false); recharger()
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  const statut = loc?.statut || "absent"
  return (
    <div className={`card mb-3 ${statut === "verifie" ? "" : "border-warning"}`}><div className="card-body">
      <h2 className="h6">{t("Localisation administrative")}</h2>
      {statut !== "absent" && !modifier && <p className="mb-2">{loc.region} › <strong>{loc.departement}</strong> —{" "}
        {statut === "verifie" ? <span className="text-success">{t("rattachement vérifié")}</span> : <span className="text-warning">{t("en attente de vérification par la délégation départementale ou par l'administrateur de NexIA School")}</span>}</p>}
      {statut !== "absent" && !loc.delegation?.active && <p className="small text-muted">{t("Aucune délégation départementale active n'est encore enregistrée pour ce département : vos fiches resteront enregistrées sans pouvoir être transmises.")}</p>}
      {statut !== "absent" && loc.delegation?.active && <p className="small text-muted">{t("Destinataire de vos fiches : ")}{loc.delegation.nom}</p>}
      {(statut === "absent" || modifier) ? (
        <form onSubmit={declarer}>
          {statut === "absent" && <p className="small">{t("Indiquez la région et le département de votre établissement. Aucune fiche ne peut être publiée tant que ce rattachement n'est pas renseigné et vérifié.")}</p>}
          <Alerte>{erreur}</Alerte>
          <ChoixLocalisation valeur={choix} onChange={setChoix} idPrefixe="etab-loc" />
          <div className="mt-2 d-flex gap-2"><button className="btn btn-primary btn-sm" disabled={envoi || !choix.departement_id}>{t("Déclarer ce rattachement")}</button>
            {modifier && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setModifier(false)}>{t("Annuler")}</button>}</div>
        </form>
      ) : <button className="btn btn-link btn-sm p-0" onClick={() => setModifier(true)}>{t("Modifier le rattachement")}</button>}
    </div></div>
  )
}

function MesFiches({ historique = false }) {
  const naviguer = useNavigate()
  const [donnees, erreur, recharger] = useDonnees(() => rpc("inst_mes_fiches"), [])
  const [erreurAction, setErreurAction] = useState("")
  async function preparer(c) {
    setErreurAction("")
    try { naviguer(`/fiches-statistiques/${await rpc("inst_fiche_preparer", { p_campagne: c.id })}`) } catch (x) { setErreurAction(x.message) }
  }
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!donnees) return <Chargement />
  const campagnes = historique ? donnees.campagnes.filter((c) => c.fiche?.version > 0) : donnees.campagnes
  return (
    <>
      <h1 className="h4">{historique ? t("Historique des publications") : t("Mes fiches de synthèse statistiques")}</h1>
      {!historique && <Localisation loc={donnees.localisation} recharger={recharger} />}
      <Alerte>{erreurAction}</Alerte>
      {!campagnes.length && <p className="text-muted">{historique ? t("Aucune fiche publiée.") : t("Aucune campagne ouverte pour le moment : les périodes et échéances sont fixées par votre délégation départementale. Vous serez prévenu dès qu'une campagne est créée.")}</p>}
      {campagnes.length > 0 && <div className="table-responsive"><table className="table align-middle">
        <thead><tr><th>{t("Année scolaire")}</th><th>{t("Période")}</th><th>{t("Ouverture")}</th><th>{t("Échéance")}</th><th>{t("Statut")}</th><th>{t("Version")}</th><th /></tr></thead>
        <tbody>{campagnes.map((c) => (
          <tr key={c.id}><td>{c.exercice}</td><td>{periode(c.periode)}</td><td>{date(c.ouverture)}</td>
            <td>{date(c.echeance_effective)}{c.etat === "echue" && !c.fiche?.version && <span className="badge text-bg-danger ms-2">{t("échue")}</span>}</td>
            <td>{c.fiche ? <BadgeStatut statut={c.fiche.statut} /> : <span className="text-muted small">{t("Non commencée")}</span>}</td>
            <td>{c.fiche?.version || "—"}</td>
            <td className="text-end">{c.fiche ? <Link className="btn btn-sm btn-outline-primary" to={`/fiches-statistiques/${c.fiche.id}`}>{t("Ouvrir")}</Link>
              : c.etat === "a_venir" ? <span className="small text-muted">{t("À venir")}</span>
              : c.ouvert ? <button className="btn btn-sm btn-primary" onClick={() => preparer(c)}>{t("Nouvelle fiche")}</button> : null}</td>
          </tr>))}</tbody></table></div>}
    </>
  )
}

function Cellule({ valeur, onChange, etiquette }) {
  const [texte, setTexte] = useState(afficherValeur(valeur))
  useEffect(() => setTexte(afficherValeur(valeur)), [valeur])
  return <input className="form-control form-control-sm text-end px-1" style={{ minWidth: 58 }} aria-label={etiquette} value={texte} inputMode="decimal"
                onChange={(e) => setTexte(e.target.value)} onBlur={() => onChange(lireValeur(texte))} />
}

function EditeurFiche() {
  const { id } = useParams()
  const { etablissement } = useSession()
  const [fiche, setFiche] = useState(null), [b, setB] = useState(null), [ind, setInd] = useState(null)
  const [erreur, setErreur] = useState(""), [info, setInfo] = useState(""), [etat, setEtat] = useState("")
  const [publier, setPublier] = useState(false), [version, setVersion] = useState(null), [reponse, setReponse] = useState("")
  const minuterie = useRef(null), dernier = useRef(null)

  const charger = useCallback(async (v = null) => {
    try {
      const f = await rpc("inst_fiche_lire", { p_fiche: id, p_version: v })
      setFiche(f); setB(normaliserBrouillon(f.brouillon)); setInd(f.indicateurs_brouillon); setVersion(v)
    } catch (x) { setErreur(x.message) }
  }, [id])
  useEffect(() => { charger() }, [charger])

  const enregistrer = useCallback(async (donnees, prete = false) => {
    setEtat(t("Enregistrement…"))
    try {
      const r = await rpc("inst_fiche_enregistrer", { p_fiche: id, p_donnees: donnees, p_prete: prete })
      setInd(r.indicateurs); setFiche((f) => ({ ...f, statut: r.statut })); setEtat(t("Enregistré à {v0}", { v0: new Date().toLocaleTimeString() }))
    } catch (x) { setEtat(""); setErreur(x.message) }
  }, [id])
  // enregistrement automatique quelques secondes après la dernière modification
  function modifier(nouveau) {
    setB(nouveau); dernier.current = nouveau; setEtat(t("Modifications non enregistrées"))
    clearTimeout(minuterie.current)
    minuterie.current = setTimeout(() => enregistrer(dernier.current), DELAI_ENREGISTREMENT)
  }
  useEffect(() => () => clearTimeout(minuterie.current), [])

  if (erreur && !fiche) return <Alerte>{erreur}</Alerte>
  if (!fiche || !b) return <Chargement />
  const modifiable = MODIFIABLES.includes(fiche.statut) && version === null
  const pub = fiche.publiee
  const ligne = (i, k, v) => modifier({ ...b, lignes: b.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })
  const n = compterAnomalies(ind?.anomalies)

  async function confirmerPublication() {
    clearTimeout(minuterie.current); setErreur(""); setInfo("")
    try {
      await enregistrer(b)
      const r = await rpc("inst_fiche_publier", { p_fiche: id, p_confirmer: true })
      setPublier(false)
      setInfo(t("Fiche publiée (version {v0}) et transmise à : {v1}.", { v0: r.version, v1: r.destinataire }) + (r.en_retard ? ` ${t("Publication enregistrée après l'échéance.")}` : ""))
      charger()
    } catch (x) { setPublier(false); setErreur(x.message) }
  }
  async function repondre() {
    try { await rpc("inst_fiche_commenter", { p_fiche: id, p_texte: reponse }); setReponse(""); charger() } catch (x) { setErreur(x.message) }
  }
  const pdf = (apercu) => fichePdf({ fiche, donnees: apercu ? b : pub.donnees, indicateurs: apercu ? ind : pub.indicateurs,
    version: apercu ? null : pub.version, publieLe: apercu ? null : pub.publie_le, publiePar: apercu ? null : pub.publie_par, typeEtablissement: etablissement?.specialisation })

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
        <div><h1 className="h4 mb-1">{t("Fiche de synthèse statistique")} — {periode(fiche.periode)} {fiche.exercice}</h1>
          <div className="small text-muted"><BadgeStatut statut={fiche.statut} /> · {t("Échéance : ")}{date(fiche.campagne?.echeance_effective)}
            {fiche.version > 0 && ` · ${t("Version publiée : ")}${fiche.version}`}{fiche.appreciation && ` · ${t("Appréciation : ")}${fiche.appreciation}`}</div></div>
        <div className="d-flex flex-wrap gap-2">
          {fiche.versions?.length > 0 && <select className="form-select form-select-sm w-auto" aria-label={t("Version")} value={version ?? ""} onChange={(e) => charger(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{modifiable || !pub ? t("Brouillon en cours") : t("Dernière version")}</option>
            {fiche.versions.map((v) => <option key={v.version} value={v.version}>{t("Version {v0} du {v1}", { v0: v.version, v1: date(v.publie_le) })}</option>)}
          </select>}
          {modifiable && <button className="btn btn-sm btn-outline-secondary" onClick={() => pdf(true)}>{t("Aperçu PDF")}</button>}
          {pub && <button className="btn btn-sm btn-outline-secondary" onClick={() => pdf(false)}>{t("PDF de la version publiée")}</button>}
        </div>
      </div>
      <Alerte>{erreur}</Alerte><Alerte type="success">{info}</Alerte>
      {fiche.statut === "correction_demandee" && <div className="alert alert-warning">{t("Correction demandée par la délégation : voyez le commentaire ci-dessous, corrigez puis republiez.")}</div>}

      {modifiable ? (
        <>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3 sticky-top bg-body py-2 no-print">
            <button className="btn btn-sm btn-outline-primary" onClick={() => { clearTimeout(minuterie.current); enregistrer(b) }}>{t("Enregistrer")}</button>
            <button className="btn btn-sm btn-outline-primary" onClick={() => { clearTimeout(minuterie.current); enregistrer(b, true) }}>{t("Marquer prête à publier")}</button>
            <button className="btn btn-sm btn-primary" onClick={() => { clearTimeout(minuterie.current); enregistrer(b).then(() => setPublier(true)) }}>{t("Publier…")}</button>
            <span className="small text-muted">{etat}</span>
          </div>
          {publier && <div className="card border-primary mb-3"><div className="card-body">
            <h2 className="h6">{t("Avant de publier")}</h2>
            <p className="small mb-2">{t("Résumé : {v0} bloquante(s), {v1} à vérifier, {v2} information(s).", { v0: n.bloquant, v1: n.alerte, v2: n.info })}</p>
            <ListeAnomalies anomalies={ind?.anomalies} />
            <p className="small mt-2 mb-2">{t("La publication crée une version définitive transmise à votre délégation départementale. Elle ne pourra être modifiée qu'après une demande de correction.")}</p>
            <div className="d-flex gap-2"><button className="btn btn-primary btn-sm" disabled={n.bloquant > 0} onClick={confirmerPublication}>{t("Confirmer la publication")}</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setPublier(false)}>{t("Annuler")}</button></div>
          </div></div>}
          <SaisieFiche b={b} modifier={modifier} ligne={ligne} ind={ind} />
        </>
      ) : pub ? (
        <div className="card mb-3"><div className="card-body">
          <p className="small text-muted">{t("Version {v0} publiée le {v1}", { v0: pub.version, v1: dateHeure(pub.publie_le) })}{pub.en_retard ? ` · ${t("après l'échéance")}` : ""}</p>
          <VueFiche donnees={pub.donnees} indicateurs={pub.indicateurs} />
        </div></div>
      ) : null}

      <div className="card"><div className="card-body">
        <HistoriqueFiche fiche={fiche} />
        {fiche.version > 0 && <div className="mt-3"><label className="form-label small" htmlFor="rep-fiche">{t("Répondre à la délégation")}</label>
          <textarea className="form-control form-control-sm mb-2" id="rep-fiche" rows={2} maxLength={3000} value={reponse} onChange={(e) => setReponse(e.target.value)} />
          <button className="btn btn-sm btn-outline-primary" disabled={!reponse.trim()} onClick={repondre}>{t("Envoyer la réponse")}</button></div>}
      </div></div>
    </>
  )
}

function SaisieFiche({ b, modifier, ligne, ind }) {
  const dig = ind?.inclure_digitalise !== false
  const synthese = (k, v) => modifier({ ...b, synthese: { ...b.synthese, [k]: v }, sources: { ...b.sources, [k]: "manuel" } })
  const assiduite = (qui, k, v) => modifier({ ...b, assiduite: { ...b.assiduite, [qui]: { ...b.assiduite[qui], [k]: v } } })
  return (
    <>
      <div className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Page 1 — Synthèse générale")}</h2>
        <div className="row g-2">{[["eleves", "Élèves"], ["enseignants", "Enseignants"], ["classes", "Classes"], ["disciplines", "Disciplines"]].map(([k, l]) => (
          <div className="col-6 col-md-3" key={k}><label className="form-label small mb-0" htmlFor={`syn-${k}`}>{t(l)}</label>
            <Cellule valeur={b.synthese[k]} etiquette={t(l)} onChange={(v) => synthese(k, v)} />
            <div className="form-text">{t(SOURCES[sourceValeur(b.synthese[k], b.sources[k])])}</div></div>))}
        </div>
        <div className="row g-2 mt-1"><div className="col-md-6"><label className="form-label small mb-0" htmlFor="fiche-resp">{t("Responsable de la publication")}</label>
          <input className="form-control form-control-sm" id="fiche-resp" maxLength={150} value={b.responsable} onChange={(e) => modifier({ ...b, responsable: e.target.value })} /></div></div>
        <p className="form-text mb-0">{t("Saisissez NA pour « non applicable » ; une case vide est une donnée manquante, jamais comptée comme zéro.")}</p>
      </div></div>

      <div className="card mb-3"><div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2"><h2 className="h6 mb-0">{t("Pages 2 et 3 — Couverture des programmes et heures")}</h2>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => modifier({ ...b, lignes: [...b.lignes, ligneVide()] })}>{t("Ajouter une ligne")}</button></div>
        <div className="table-responsive"><table className="table table-sm table-bordered align-middle small mb-0">
          <thead className="table-light"><tr><th>{t("Classe")}</th><th>{t("Discipline")}</th><th>{t("Enseignant")}</th>
            {[...CHAMPS_LECONS, ...CHAMPS_HEURES].map(([k, l]) => <th key={k} className="text-center" style={{ minWidth: 64 }}>{t(l)}</th>)}
            <th>{t("% théorie")}</th><th>{t("% pratique")}</th><th /></tr></thead>
          <tbody>{b.lignes.map((l, i) => (
            <tr key={i}>
              {["classe", "discipline", "enseignant"].map((k) => <td key={k}><input className="form-control form-control-sm" style={{ minWidth: 90 }} aria-label={t(k === "classe" ? "Classe" : k === "discipline" ? "Discipline" : "Enseignant")}
                value={l[k]} maxLength={150} onChange={(e) => ligne(i, k, e.target.value)} /></td>)}
              {[...CHAMPS_LECONS, ...CHAMPS_HEURES].map(([k, lib]) => <td key={k}><Cellule valeur={l[k]} etiquette={`${t(lib)} ${i + 1}`} onChange={(v) => ligne(i, k, v)} /></td>)}
              <td className="text-end">{taux(tauxLigne(l, dig ? ["faites_t", "digit_t"] : ["faites_t"], "prevues_t"))}</td>
              <td className="text-end">{taux(tauxLigne(l, dig ? ["faites_p", "digit_p"] : ["faites_p"], "prevues_p"))}</td>
              <td><button className="btn btn-sm btn-link text-danger p-0" aria-label={t("Retirer la ligne")} onClick={() => modifier({ ...b, lignes: b.lignes.filter((_, j) => j !== i) })}>✕</button></td>
            </tr>))}</tbody></table></div>
        {!b.lignes.length && <p className="small text-muted mt-2">{t("Aucune ligne : ajoutez les classes, disciplines et enseignants, ou renseignez les attributions de l'année scolaire.")}</p>}
      </div></div>

      <div className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Assiduité")}</h2>
        <div className="row g-2">{[["enseignants", "Enseignants"], ["eleves", "Élèves"]].map(([qui, l]) => (
          <div className="col-md-6" key={qui}><div className="small fw-semibold">{t(l)}</div>
            <div className="row g-2"><div className="col-6"><label className="form-label small mb-0">{t("Heures dues")}</label><Cellule valeur={b.assiduite[qui].heures_dues} etiquette={`${t(l)} ${t("Heures dues")}`} onChange={(v) => assiduite(qui, "heures_dues", v)} /></div>
              <div className="col-6"><label className="form-label small mb-0">{t("Heures d'absence")}</label><Cellule valeur={b.assiduite[qui].heures_absence} etiquette={`${t(l)} ${t("Heures d'absence")}`} onChange={(v) => assiduite(qui, "heures_absence", v)} /></div></div>
            {qui === "eleves" && b.sources.absences_eleves === "auto" && <div className="form-text">{t("Heures d'absence pré-remplies depuis l'appel du jour (à vérifier).")}</div>}
          </div>))}</div>
        <label className="form-label small mt-3 mb-0" htmlFor="fiche-obs">{t("Observations de la direction")}</label>
        <textarea className="form-control form-control-sm" id="fiche-obs" rows={3} maxLength={4000} value={b.observations} onChange={(e) => modifier({ ...b, observations: e.target.value })} />
      </div></div>

      <div className="card mb-3"><div className="card-body">
        <h2 className="h6">{t("Aperçu des indicateurs (calcul du serveur)")}</h2>
        {ind ? <><TableIndicateurs indicateurs={ind.indicateurs} formulesValidees={ind.formules_validees} /><ListeAnomalies anomalies={ind.anomalies} /></> : <p className="small text-muted">{t("Enregistrez pour voir les indicateurs.")}</p>}
      </div></div>
    </>
  )
}

/** Courriers reçus de la délégation départementale, lecture, réponses (avec pièces jointes), PDF. */
export function CourriersInstitutionnels() {
  const { etablissement } = useSession()
  const [liste, erreur, recharger] = useDonnees(() => rpc("inst_courriers_recus"), [])
  const [ouvert, setOuvert] = useState(null), [onglet, setOnglet] = useState("recus")
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  const visibles = onglet === "reponses" ? liste.filter((c) => c.reponses.length) : liste.filter((c) => c.statut_reception !== "archive")
  return (
    <>
      <h1 className="h4">{t("Courriers institutionnels")}</h1>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button className={`nav-link ${onglet === "recus" ? "active" : ""}`} onClick={() => setOnglet("recus")}>{t("Courriers reçus")}</button></li>
        <li className="nav-item"><button className={`nav-link ${onglet === "reponses" ? "active" : ""}`} onClick={() => setOnglet("reponses")}>{t("Courriers envoyés et réponses")}</button></li>
      </ul>
      {!visibles.length && <p className="text-muted">{t("Aucun courrier.")}</p>}
      <div className="list-group mb-3">{visibles.map((c) => (
        <button key={c.destinataire_id} className={`list-group-item list-group-item-action ${ouvert === c.destinataire_id ? "active" : ""} ${c.lu_le ? "" : "fw-semibold"}`}
                onClick={async () => { setOuvert(c.destinataire_id); if (!c.lu_le) { await rpc("inst_courrier_lu", { p_destinataire: c.destinataire_id }); recharger() } }}>
          <div className="d-flex justify-content-between gap-2"><span>{c.reference} — {c.objet}</span><span className="small">{statutCourrier(c.statut_reception)}</span></div>
          <div className="small">{c.expediteur?.nom} · {dateHeure(c.envoye_le)}{c.date_limite ? ` · ${t("réponse avant le ")}${date(c.date_limite)}` : ""}</div>
        </button>))}</div>
      {(() => { const c = liste.find((x) => x.destinataire_id === ouvert); return c && <LectureCourrier c={c} dossier={`reponses/${etablissement?.id}`} recharger={recharger} /> })()}
    </>
  )
}

/** Lecture d'un courrier reçu et réponse (établissement ou délégation départementale). */
export function LectureCourrier({ c, dossier, recharger, peutRepondre = true }) {
  const [texte, setTexte] = useState(""), [fichier, setFichier] = useState(null), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  async function repondre(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const piece = await deposerPiece(dossier, fichier)
      await rpc("inst_courrier_repondre", { p_destinataire: c.destinataire_id, p_texte: texte, p_pieces: piece ? [piece] : [] })
      setTexte(""); setFichier(null); recharger()
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="card"><div className="card-body">
      <div className="d-flex justify-content-between gap-2"><h2 className="h5">{c.objet}</h2>
        <div className="d-flex gap-2"><button className="btn btn-sm btn-outline-secondary" onClick={() => courrierPdf(c)}>{t("PDF")}</button>
          <button className="btn btn-sm btn-outline-secondary" onClick={async () => { await rpc("inst_courrier_archiver", { p_courrier: c.id }); recharger() }}>{t("Archiver")}</button></div></div>
      <p className="small text-muted">{c.reference} · {c.type_libelle} · {c.expediteur?.nom} · {c.auteur}{c.fonction ? `, ${c.fonction}` : ""} · {dateHeure(c.envoye_le)}</p>
      <div style={{ whiteSpace: "pre-wrap" }} className="mb-2">{c.corps}</div>
      {c.pieces.length > 0 && <p className="small">{t("Pièces jointes : ")}{c.pieces.map((p) => <Piece key={p} chemin={p} />)}</p>}
      {c.reponses.map((r, i) => <div key={i} className="border rounded p-2 small mb-2"><div className="text-muted">{dateHeure(r.le)} · {r.auteur}</div>
        <div style={{ whiteSpace: "pre-wrap" }}>{r.texte}</div>{r.pieces.map((p) => <Piece key={p} chemin={p} />)}</div>)}
      {peutRepondre && <form onSubmit={repondre}>
        <Alerte>{erreur}</Alerte>
        <label className="form-label small" htmlFor="rep-courrier">{t("Votre réponse")}</label>
        <textarea className="form-control mb-2" id="rep-courrier" rows={3} required maxLength={10000} value={texte} onChange={(e) => setTexte(e.target.value)} />
        <input className="form-control form-control-sm mb-2" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label={t("Pièce jointe")} onChange={(e) => setFichier(e.target.files?.[0] || null)} />
        <button className="btn btn-primary btn-sm" disabled={envoi}>{envoi ? t("Envoi…") : t("Envoyer la réponse")}</button>
      </form>}
    </div></div>
  )
}
