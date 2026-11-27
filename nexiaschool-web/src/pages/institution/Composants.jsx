// Éléments partagés du pilotage institutionnel : sélecteurs, statuts, indicateurs, lecture d'une fiche, notifications.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { dateHeure, date } from "../../lib/format.js"
import { CHAMPS_HEURES, CHAMPS_LECONS, COULEURS_STATUT, INDICATEURS, MENTION_FORMULES, periode, statutFiche, tauxLigne } from "../../lib/institution.js"
import { rpc, supabase, verifier } from "../../supabase.js"
import { locale, t } from "../../i18n.jsx"

export const nombre = (v) => (v === null || v === undefined ? "—" : v === "na" ? "NA" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v))
export const taux = (v) => (v === null || v === undefined ? "—" : `${nombre(v)} %`)

export function BadgeStatut({ statut }) {
  return <span className={`badge text-bg-${COULEURS_STATUT[statut] || "secondary"}`}>{statutFiche(statut)}</span>
}

/** Région puis département filtré par région (référentiel actif, lu depuis le serveur). */
export function ChoixLocalisation({ valeur, onChange, departementRequis = true, idPrefixe = "loc", requis = true }) {
  const [regions, setRegions] = useState([]), [departements, setDepartements] = useState([])
  useEffect(() => {
    supabase.from("inst_regions").select("id, nom").order("nom").then((r) => setRegions(r.data || []))
  }, [])
  useEffect(() => {
    if (!valeur?.region_id) return setDepartements([])
    supabase.from("inst_departements").select("id, nom").eq("region_id", valeur.region_id).order("nom").then((r) => setDepartements(r.data || []))
  }, [valeur?.region_id])
  return (
    <div className="row g-2">
      <div className="col-sm-6"><label className="form-label" htmlFor={`${idPrefixe}-region`}>{t("Région")}</label>
        <select className="form-select" id={`${idPrefixe}-region`} value={valeur?.region_id || ""} required={requis}
                onChange={(e) => onChange({ region_id: e.target.value, departement_id: "" })}>
          <option value="">{t("— Choisir —")}</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
        </select></div>
      {departementRequis && <div className="col-sm-6"><label className="form-label" htmlFor={`${idPrefixe}-dep`}>{t("Département")}</label>
        <select className="form-select" id={`${idPrefixe}-dep`} value={valeur?.departement_id || ""} required={requis} disabled={!valeur?.region_id}
                onChange={(e) => onChange({ ...valeur, departement_id: e.target.value })}>
          <option value="">{t("— Choisir —")}</option>
          {departements.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select></div>}
    </div>
  )
}

/** Choix d'une campagne (année scolaire + période) d'un niveau donné. */
export function useCampagnes(niveau) {
  const [campagnes, erreur] = useDonnees(() => rpc("inst_campagnes_lire", { p_niveau: niveau }), [niveau])
  const [id, setId] = useState("")
  useEffect(() => {
    if (!id && campagnes?.length) setId((campagnes.find((c) => c.etat === "ouverte") || campagnes[0]).id)
  }, [campagnes, id])
  return { campagnes: campagnes || [], erreur, id, setId, campagne: (campagnes || []).find((c) => c.id === id) }
}

export function SelecteurCampagne({ campagnes, id, setId }) {
  if (!campagnes.length) return <div className="alert alert-light border small mb-3">{t("Aucune campagne n'est encore configurée par l'administrateur de NexIA School.")}</div>
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      <label className="small text-muted" htmlFor="sel-campagne">{t("Période")}</label>
      <select className="form-select form-select-sm w-auto" id="sel-campagne" value={id} onChange={(e) => setId(e.target.value)}>
        {campagnes.map((c) => <option key={c.id} value={c.id}>{`${c.exercice} — ${periode(c.periode)}`}</option>)}
      </select>
      {(() => { const c = campagnes.find((x) => x.id === id); return c && <span className="small text-muted">{t("Échéance : ")}{date(c.echeance_effective)}{c.prolongation ? ` (${t("prolongée")})` : ""}</span> })()}
    </div>
  )
}

/** Tableau des indicateurs (taux pondérés, nombre de lignes ou de fiches comptées, manquants). */
export function TableIndicateurs({ indicateurs, consolide = false, formulesValidees = true }) {
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-2">
        <thead><tr><th>{t("Indicateur")}</th><th className="text-end">{t("Réalisé")}</th><th className="text-end">{t("Prévu / dû")}</th>
          <th className="text-end">{t("Taux")}</th><th className="text-end">{consolide ? t("Fiches comptées") : t("Lignes comptées")}</th>
          <th className="text-end">{t("Manquantes")}</th></tr></thead>
        <tbody>{INDICATEURS.map(([k, l]) => {
          const x = indicateurs?.[k] || {}
          return <tr key={k}><td>{t(l)}</td><td className="text-end">{nombre(x.num)}</td><td className="text-end">{nombre(x.den)}</td>
            <td className="text-end fw-semibold">{taux(x.taux)}</td><td className="text-end">{nombre(consolide ? x.fiches : x.lignes)}</td>
            <td className="text-end">{nombre(consolide ? x.fiches_sans_donnee : x.manquantes)}</td></tr>
        })}</tbody>
      </table>
      {!formulesValidees && <p className="small text-muted mb-0">{t(MENTION_FORMULES)}</p>}
    </div>
  )
}

export function ListeAnomalies({ anomalies = [] }) {
  if (!anomalies.length) return <p className="small text-success mb-0">{t("Aucune anomalie détectée.")}</p>
  const classe = { bloquant: "danger", alerte: "warning", info: "secondary" }
  return (
    <ul className="list-unstyled small mb-0">{anomalies.map((a, i) => (
      <li key={i} className="mb-1"><span className={`badge text-bg-${classe[a.niveau]} me-2`}>{a.niveau === "bloquant" ? t("Bloquant") : a.niveau === "alerte" ? t("À vérifier") : t("Information")}</span>{a.message}</li>))}
    </ul>
  )
}

/** Lecture d'une fiche publiée (version) : synthèse, indicateurs, lignes, assiduité, observations. */
export function VueFiche({ donnees, indicateurs }) {
  if (!donnees) return null
  const ind = indicateurs?.indicateurs || {}, s = indicateurs?.synthese || {}
  const dig = indicateurs?.inclure_digitalise !== false
  return (
    <>
      <div className="row g-2 mb-3">{[["eleves", "Élèves"], ["enseignants", "Enseignants"], ["classes", "Classes"], ["disciplines", "Disciplines"]].map(([k, l]) => (
        <div className="col-6 col-md-3" key={k}><div className="border rounded p-2 text-center"><div className="h5 mb-0">{nombre(s[k])}</div><div className="small text-muted">{t(l)}</div></div></div>))}
      </div>
      <TableIndicateurs indicateurs={ind} formulesValidees={indicateurs?.formules_validees} />
      {(donnees.periodes_manquantes || []).length > 0 && <div className="alert alert-warning small">{t("Bilan annuel : trimestres non publiés, non cumulés : {v0}", { v0: donnees.periodes_manquantes.map(periode).join(", ") })}</div>}
      <h3 className="h6 mt-3">{t("Couverture des programmes et heures")}</h3>
      <div className="table-responsive"><table className="table table-sm table-bordered small align-middle">
        <thead className="table-light"><tr><th>{t("Classe")}</th><th>{t("Discipline")}</th><th>{t("Enseignant")}</th>
          {[...CHAMPS_LECONS, ...CHAMPS_HEURES].map(([k, l]) => <th key={k} className="text-end">{t(l)}</th>)}
          <th className="text-end">{t("% théorie")}</th><th className="text-end">{t("% pratique")}</th></tr></thead>
        <tbody>{(donnees.lignes || []).map((l, i) => (
          <tr key={i}><td>{l.classe}</td><td>{l.discipline}</td><td>{l.enseignant}</td>
            {[...CHAMPS_LECONS, ...CHAMPS_HEURES].map(([k]) => <td key={k} className="text-end">{nombre(l[k])}</td>)}
            <td className="text-end">{taux(tauxLigne(l, dig ? ["faites_t", "digit_t"] : ["faites_t"], "prevues_t"))}</td>
            <td className="text-end">{taux(tauxLigne(l, dig ? ["faites_p", "digit_p"] : ["faites_p"], "prevues_p"))}</td></tr>))}
        </tbody></table></div>
      {donnees.observations && <><h3 className="h6">{t("Observations")}</h3><p className="small" style={{ whiteSpace: "pre-wrap" }}>{donnees.observations}</p></>}
      {donnees.difficultes && <><h3 className="h6">{t("Difficultés")}</h3><p className="small" style={{ whiteSpace: "pre-wrap" }}>{donnees.difficultes}</p></>}
      {donnees.recommandations && <><h3 className="h6">{t("Recommandations")}</h3><p className="small" style={{ whiteSpace: "pre-wrap" }}>{donnees.recommandations}</p></>}
    </>
  )
}

/** Historique des statuts et commentaires horodatés d'une fiche. */
export function HistoriqueFiche({ fiche }) {
  return (
    <div className="row g-3">
      <div className="col-lg-6"><h3 className="h6">{t("Historique des statuts")}</h3>
        <ul className="list-unstyled small mb-0">{(fiche.historique || []).map((h, i) => (
          <li key={i} className="mb-1"><span className="text-muted">{dateHeure(h.le)}</span> — {statutFiche(h.a)}{h.motif ? ` · ${h.motif}` : ""}</li>))}</ul></div>
      <div className="col-lg-6"><h3 className="h6">{t("Commentaires")}</h3>
        {!(fiche.commentaires || []).length && <p className="small text-muted">{t("Aucun commentaire.")}</p>}
        <ul className="list-unstyled small mb-0">{(fiche.commentaires || []).map((c, i) => (
          <li key={i} className={`mb-2 p-2 rounded border ${c.type === "correction" ? "border-warning" : ""}`}>
            <div className="text-muted">{dateHeure(c.le)} · {c.auteur} · {t("version")} {c.version}{c.type === "correction" ? ` · ${t("Demande de correction")}` : ""}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{c.texte}</div>
            {(c.elements || []).length > 0 && <div className="text-muted">{t("Éléments concernés : ")}{c.elements.join(", ")}</div>}
          </li>))}</ul></div>
    </div>
  )
}

/** Notifications internes de l'espace (établissement ou délégation). */
export function Notifications({ onLu }) {
  const [liste, erreur, recharger] = useDonnees(() => rpc("inst_notifications_lire"), [])
  async function toutLire() { await rpc("inst_notification_lue", { p_id: null }); recharger(); onLu?.() }
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">{t("Notifications")}</h1>
        {liste.some((n) => !n.lu) && <button className="btn btn-sm btn-outline-secondary" onClick={toutLire}>{t("Tout marquer comme lu")}</button>}
      </div>
      {!liste.length && <p className="text-muted">{t("Aucune notification.")}</p>}
      <ul className="list-group">{liste.map((n) => (
        <li key={n.id} className={`list-group-item ${n.lu ? "" : "list-group-item-light fw-semibold"}`}>
          <div className="d-flex justify-content-between gap-2"><span>{n.lien ? <Link to={n.lien}>{n.titre}</Link> : n.titre}</span>
            <span className="small text-muted text-nowrap">{dateHeure(n.cree_le)}</span></div>
          {n.corps && <div className="small text-muted fw-normal">{n.corps}</div>}
        </li>))}</ul>
      <p className="small text-muted mt-3">{t("Les notifications sont affichées dans l'application ; aucun e-mail n'est envoyé par ce module.")}</p>
    </>
  )
}

/** Lien de téléchargement d'une pièce du compartiment privé « institution » (lien signé de courte durée). */
export function Piece({ chemin }) {
  async function ouvrir() {
    const { signedUrl } = verifier(await supabase.storage.from("institution").createSignedUrl(chemin, 120))
    window.open(signedUrl, "_blank", "noopener")
  }
  return <button type="button" className="btn btn-link btn-sm p-0 me-2" onClick={ouvrir}>{chemin.split("/").pop()}</button>
}

/** Dépôt d'une pièce (PDF ou image, 5 Mo) dans le dossier autorisé ; renvoie son chemin. */
export async function deposerPiece(dossier, fichier) {
  if (!fichier) return null
  if (fichier.size > 5 * 1024 * 1024) throw new Error(t("Fichier trop volumineux (5 Mo au maximum)."))
  if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(fichier.type)) throw new Error(t("Formats acceptés : PDF, JPEG, PNG, WebP."))
  const nom = `${Date.now()}-${fichier.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.]+/g, "-").slice(-80)}`
  const chemin = `${dossier}/${nom}`
  verifier(await supabase.storage.from("institution").upload(chemin, fichier, { contentType: fichier.type, upsert: false }))
  return chemin
}
