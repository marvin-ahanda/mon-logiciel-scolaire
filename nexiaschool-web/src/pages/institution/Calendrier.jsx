// Espace des délégations : « Campagnes et formules » (calendrier fixé par la délégation elle-même) et
// « Accès exceptionnels » (accordés et révoqués par la délégation régionale). Le serveur vérifie tous les droits.
import { useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { date, dateHeure } from "../../lib/format.js"
import { PERIODES, periode } from "../../lib/institution.js"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"

export const ETATS_CAMPAGNE = { a_venir: "À venir", ouverte: "Ouverte", echue: "Échue", fermee: "Fermée" }
const COULEURS_ETAT = { a_venir: "info", ouverte: "success", echue: "warning", fermee: "secondary" }
const ALERTES_DEFAUT = "7, 3, 1, 0, -1"

/** Contrôle de la saisie, avec les mêmes règles que le serveur : message à afficher, ou "" si tout est valable. */
export function controlerCampagne(f) {
  const annee = (f.exercice || "").trim()
  const m = annee.match(/^(\d{4})-(\d{4})$/)
  if (!f.id && (!m || Number(m[2]) !== Number(m[1]) + 1)) return t("Année scolaire : écrivez deux années qui se suivent, séparées par un tiret, par exemple 2026-2027.")
  if (!f.ouverture) return t("Indiquez la date d'ouverture de la campagne.")
  if (!f.echeance) return t("Indiquez la date d'échéance de la campagne.")
  if (f.echeance < f.ouverture) return t("L'échéance doit être le jour de l'ouverture ou après.")
  if (f.prolongation && f.prolongation < f.echeance) return t("La prolongation doit être le jour de l'échéance ou après.")
  return ""
}

/** Année scolaire proposée par défaut : celle qui commence en septembre. */
export function anneeCourante(aujourdhui = new Date()) {
  const a = aujourdhui.getFullYear() - (aujourdhui.getMonth() < 8 ? 1 : 0)
  return `${a}-${a + 1}`
}

const vide = (annee) => ({ exercice: annee, periode: "t1", ouverture: "", echeance: "", prolongation: "", ouvert: true, alertes: ALERTES_DEFAUT })
const versServeur = (f) => ({ ...f, exercice: (f.exercice || "").trim(), alertes_jours: f.alertes.split(",").map((x) => x.trim()).filter(Boolean) })

/** Formulaire de campagne (création ou modification), commun à la Console et aux délégations. */
export function FormulaireCampagne({ valeur, setValeur, annees = [], onEnregistrer, onAnnuler, occupe, niveauChoix }) {
  const f = valeur
  const maj = (k) => (e) => setValeur({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })
  return (
    <div className="row g-2">
      {niveauChoix}
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-annee">{t("Année scolaire")}</label>
        <input id="camp-annee" className="form-control form-control-sm" list="camp-annees" disabled={!!f.id} value={f.exercice} onChange={maj("exercice")} />
        <datalist id="camp-annees">{annees.map((a) => <option key={a} value={a} />)}</datalist>
        <div className="form-text">{t("Exemple : 2026-2027")}</div></div>
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-periode">{t("Période")}</label>
        <select id="camp-periode" className="form-select form-select-sm" disabled={!!f.id} value={f.periode} onChange={maj("periode")}>
          {Object.keys(PERIODES).map((k) => <option key={k} value={k}>{periode(k)}</option>)}</select></div>
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-ouverture">{t("Ouverture")} *</label>
        <input id="camp-ouverture" type="date" className="form-control form-control-sm" value={f.ouverture} onChange={maj("ouverture")} /></div>
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-echeance">{t("Échéance")} *</label>
        <input id="camp-echeance" type="date" className="form-control form-control-sm" min={f.ouverture || undefined} value={f.echeance} onChange={maj("echeance")} /></div>
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-prolongation">{t("Prolongation (facultative)")}</label>
        <input id="camp-prolongation" type="date" className="form-control form-control-sm" min={f.echeance || undefined} value={f.prolongation || ""} onChange={maj("prolongation")} /></div>
      <div className="col-sm-4 col-lg-2"><label className="form-label small" htmlFor="camp-alertes">{t("Rappels (jours avant l'échéance)")}</label>
        <input id="camp-alertes" className="form-control form-control-sm" value={f.alertes} onChange={maj("alertes")} />
        <div className="form-text">{t("0 = le jour même, −1 = le lendemain")}</div></div>
      <div className="col-12 d-flex flex-wrap align-items-center gap-3">
        <div className="form-check mb-0"><input id="camp-ouvert" type="checkbox" className="form-check-input" checked={f.ouvert} onChange={maj("ouvert")} />
          <label className="form-check-label small" htmlFor="camp-ouvert">{t("Campagne ouverte (décochez pour la fermer)")}</label></div>
        <button type="button" className="btn btn-sm btn-primary" disabled={occupe} onClick={onEnregistrer}>{f.id ? t("Enregistrer les modifications") : t("Créer la campagne")}</button>
        {f.id && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onAnnuler}>{t("Annuler")}</button>}
      </div>
    </div>
  )
}

/** Tableau des campagnes (état, échéance effective, périmètre). */
export function TableauCampagnes({ campagnes, onModifier, peutModifier = () => true, avecPortee = false }) {
  if (!campagnes.length) return <p className="text-muted small">{t("Aucune campagne pour le moment.")}</p>
  return (
    <div className="table-responsive"><table className="table table-sm align-middle small">
      <thead><tr><th>{t("Année scolaire")}</th><th>{t("Période")}</th><th>{t("Ouverture")}</th><th>{t("Échéance")}</th><th>{t("Prolongation")}</th>
        <th>{t("État")}</th>{avecPortee && <th>{t("Fixée par")}</th>}<th /></tr></thead>
      <tbody>{campagnes.map((c) => <tr key={c.id}>
        <td>{c.exercice}</td><td>{periode(c.periode)}</td><td>{date(c.ouverture)}</td><td>{date(c.echeance)}</td><td>{c.prolongation ? date(c.prolongation) : "—"}</td>
        <td><span className={`badge text-bg-${COULEURS_ETAT[c.etat] || "secondary"}`}>{t(ETATS_CAMPAGNE[c.etat] || c.etat)}</span></td>
        {avecPortee && <td>{c.nationale ? t("NexIA School (national)") : c.auteur || c.departement || c.region}</td>}
        <td className="text-end">{peutModifier(c) && <button type="button" className="btn btn-sm btn-link" onClick={() => onModifier(c)}>{t("Modifier")}</button>}</td>
      </tr>)}</tbody>
    </table></div>
  )
}

/** « Campagnes et formules » de la délégation : la DDES fixe les campagnes de ses établissements, la DRES celles des synthèses départementales. */
export function CampagnesDelegation() {
  const [d, erreur, recharger] = useDonnees(() => rpc("inst_campagnes_gerer"), [])
  const [f, setF] = useState(null), [msg, setMsg] = useState({ type: "", texte: "" }), [occupe, setOccupe] = useState(false)
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!d) return <Chargement />
  const etab = d.niveau === "etablissement"
  const form = f || vide(d.annees[0] || anneeCourante())
  async function enregistrer() {
    const e = controlerCampagne(form)
    if (e) { setMsg({ type: "danger", texte: e }); return }
    setOccupe(true); setMsg({ type: "", texte: "" })
    try {
      await rpc("inst_campagne_enregistrer", { p: versServeur(form) })
      setMsg({ type: "success", texte: form.id ? t("Calendrier mis à jour : les destinataires ont été prévenus si les dates ont changé.")
                                             : t("Campagne créée : {v0} destinataire(s) prévenu(s).", { v0: d.destinataires }) })
      setF(null); recharger()
    } catch (x) { setMsg({ type: "danger", texte: x.message }) } finally { setOccupe(false) }
  }
  const modifier = (c) => { setMsg({ type: "", texte: "" }); setF({ id: c.id, exercice: c.exercice, periode: c.periode, ouverture: c.ouverture, echeance: c.echeance,
    prolongation: c.prolongation || "", ouvert: c.ouvert, alertes: c.alertes_jours.join(", ") }); window.scrollTo({ top: 0, behavior: "smooth" }) }
  return (
    <>
      <h1 className="h4">{t("Campagnes et formules")}</h1>
      <p className="small text-muted">{etab
        ? t("Vous fixez ici la période et l'échéance de réception des fiches statistiques des établissements de votre département, selon le calendrier administratif de votre délégation. À la création, les administrateurs des établissements rattachés sont prévenus.")
        : t("Vous fixez ici la période et l'échéance de réception des synthèses des délégations départementales de votre région. À la création, les délégations départementales sont prévenues.")}</p>
      <Alerte type={msg.type || "danger"} onFermer={() => setMsg({ type: "", texte: "" })}>{msg.texte}</Alerte>
      {d.peut_modifier
        ? <div className="card mb-3"><div className="card-body">
            <h2 className="h6">{form.id ? t("Modifier la campagne {v0} — {v1}", { v0: form.exercice, v1: periode(form.periode) }) : t("Nouvelle campagne")}</h2>
            <FormulaireCampagne valeur={form} setValeur={setF} annees={d.annees} onEnregistrer={enregistrer} onAnnuler={() => setF(null)} occupe={occupe} />
          </div></div>
        : <div className="alert alert-light border small">{t("Seul le titulaire de la délégation crée ou modifie les campagnes.")}</div>}
      <h2 className="h6">{etab ? t("Campagnes des fiches des établissements") : t("Campagnes des synthèses départementales")}</h2>
      <TableauCampagnes campagnes={d.campagnes} avecPortee onModifier={modifier} peutModifier={(c) => d.peut_modifier && c.modifiable} />
      <p className="small text-muted">{t("Une campagne fixée par NexIA School (nationale) s'applique tant que votre délégation n'en fixe pas une pour la même année et la même période.")}</p>
      <div className="card mt-3"><div className="card-body small">
        <h2 className="h6">{t("Formules de calcul (communes à toutes les délégations)")}</h2>
        <p className="mb-1">{t("Couverture des programmes = leçons faites / leçons prévues ; heures = heures faites / heures dues ; assiduité = (heures dues − absences) / heures dues. Consolidation : somme des numérateurs / somme des dénominateurs (jamais la moyenne des taux).")}</p>
        <p className="mb-1">{d.parametres.inclure_digitalise ? t("Les leçons digitalisées sont comptées dans la couverture.") : t("Les leçons digitalisées ne sont pas comptées dans la couverture.")}</p>
        <p className="mb-0 text-muted">{d.parametres.formules_validees ? t("Formules validées.") : t("Formules à valider par l'autorité compétente.")}
          {" "}{t("Elles sont identiques pour toutes les délégations afin que les résultats restent comparables.")}</p>
      </div></div>
    </>
  )
}

/** « Accès exceptionnels » de la délégation régionale : accorder, révoquer, consulter les fiches concernées. */
export function AccesExceptionnels() {
  const [d, erreur, recharger] = useDonnees(() => rpc("inst_derogations"), [])
  const [fiches, erreurFiches, rechargerFiches] = useDonnees(() => rpc("inst_fiches_derogation"), [])
  const [f, setF] = useState({ departement: "", etablissement: "", jours: 7, motif: "" })
  const [msg, setMsg] = useState({ type: "", texte: "" }), [occupe, setOccupe] = useState(false)
  if (erreur || erreurFiches) return <Alerte>{erreur || erreurFiches}</Alerte>
  if (!d || !fiches) return <Chargement />
  const etabs = d.etablissements.filter((e) => !f.departement || e.departement_id === f.departement)
  async function agir(appel, succes) {
    setOccupe(true); setMsg({ type: "", texte: "" })
    try { await appel(); setMsg({ type: "success", texte: succes }); recharger(); rechargerFiches() }
    catch (x) { setMsg({ type: "danger", texte: x.message }) } finally { setOccupe(false) }
  }
  function accorder() {
    if (!f.departement && !f.etablissement) { setMsg({ type: "danger", texte: t("Choisissez un département ou un établissement de votre région.") }); return }
    if (f.motif.trim().length < 5) { setMsg({ type: "danger", texte: t("Indiquez le motif de l'accès (5 à 500 caractères).") }); return }
    agir(() => rpc("inst_derogation_accorder", { p_departement: f.departement || null, p_etablissement: f.etablissement || null, p_jours: Number(f.jours), p_motif: f.motif.trim() })
      .then(() => setF({ departement: "", etablissement: "", jours: 7, motif: "" })), t("Accès accordé : la délégation départementale concernée a été prévenue."))
  }
  return (
    <>
      <h1 className="h4">{t("Accès exceptionnels aux fiches des établissements")}</h1>
      <p className="small text-muted">{t("En temps normal, votre délégation ne reçoit que les synthèses départementales. Un accès exceptionnel vous ouvre, pour une durée limitée (90 jours au plus) et pour un motif précis, les fiches brutes des établissements d'un département ou d'un établissement de votre région. La délégation départementale concernée est prévenue ; chaque consultation est journalisée.")}</p>
      <Alerte type={msg.type || "danger"} onFermer={() => setMsg({ type: "", texte: "" })}>{msg.texte}</Alerte>
      {d.peut_modifier
        ? <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("Accorder un accès")}</h2>
            <div className="row g-2">
              <div className="col-md-3"><label className="form-label small" htmlFor="der-dep">{t("Département")}</label>
                <select id="der-dep" className="form-select form-select-sm" value={f.departement} onChange={(e) => setF({ ...f, departement: e.target.value, etablissement: "" })}>
                  <option value="">{t("Choisir")}</option>{d.departements.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></div>
              <div className="col-md-3"><label className="form-label small" htmlFor="der-etab">{t("Établissement (facultatif)")}</label>
                <select id="der-etab" className="form-select form-select-sm" value={f.etablissement} onChange={(e) => setF({ ...f, etablissement: e.target.value })}>
                  <option value="">{t("Tout le département")}</option>{etabs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></div>
              <div className="col-md-2"><label className="form-label small" htmlFor="der-jours">{t("Durée (jours)")}</label>
                <input id="der-jours" type="number" min={1} max={90} className="form-control form-control-sm" value={f.jours} onChange={(e) => setF({ ...f, jours: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small" htmlFor="der-motif">{t("Motif")}</label>
                <input id="der-motif" className="form-control form-control-sm" maxLength={500} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></div>
            </div>
            <button type="button" className="btn btn-sm btn-primary mt-2" disabled={occupe} onClick={accorder}>{t("Accorder l'accès")}</button>
          </div></div>
        : <div className="alert alert-light border small">{t("Seul le titulaire de la délégation accorde ou révoque un accès exceptionnel.")}</div>}

      <h2 className="h6">{t("Fiches accessibles en ce moment")}</h2>
      {!fiches.length && <p className="text-muted small">{t("Aucun accès exceptionnel en cours.")}</p>}
      {fiches.map((g) => <div className="card mb-2" key={g.derogation}><div className="card-body py-2">
        <div className="small text-muted">{t("Jusqu'au {v0} · motif : {v1}", { v0: dateHeure(g.fin), v1: g.motif })}</div>
        {!g.fiches.length && <div className="small text-muted">{t("Aucune fiche publiée dans ce périmètre pour le moment.")}</div>}
        <ul className="mb-0">{g.fiches.map((x) => <li key={x.id}><Link to={`/institution/fiches/${x.id}`}>{x.etablissement} — {periode(x.periode)} {x.exercice}</Link></li>)}</ul>
      </div></div>)}

      <h2 className="h6 mt-3">{t("Historique des accès")}</h2>
      {!d.derogations.length ? <p className="text-muted small">{t("Aucun accès accordé.")}</p>
        : <div className="table-responsive"><table className="table table-sm align-middle small">
            <thead><tr><th>{t("Périmètre")}</th><th>{t("Motif")}</th><th>{t("Début")}</th><th>{t("Fin")}</th><th>{t("État")}</th><th /></tr></thead>
            <tbody>{d.derogations.map((g) => <tr key={g.id}>
              <td>{g.etablissement || g.departement}{g.etablissement && <span className="text-muted"> · {g.departement}</span>}</td><td>{g.motif}</td>
              <td>{dateHeure(g.debut)}</td><td>{dateHeure(g.fin)}</td>
              <td>{g.revoquee_le ? t("Révoqué le {v0}", { v0: dateHeure(g.revoquee_le) }) : g.active ? <span className="badge text-bg-success">{t("Actif")}</span> : t("Expiré")}</td>
              <td className="text-end">{g.active && d.peut_modifier && <button type="button" className="btn btn-sm btn-outline-danger" disabled={occupe}
                onClick={() => agir(() => rpc("inst_derogation_revoquer", { p_id: g.id }), t("Accès révoqué."))}>{t("Révoquer")}</button>}</td>
            </tr>)}</tbody></table></div>}
    </>
  )
}
