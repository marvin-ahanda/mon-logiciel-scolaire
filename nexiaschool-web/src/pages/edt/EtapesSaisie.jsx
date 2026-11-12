// Étapes 1 à 3 : horaires de l'établissement, import Excel des affectations, aperçu modifiable et contraintes des classes.
import { useMemo, useRef, useState } from "react"
import { t } from "../../i18n.jsx"
import { Alerte } from "../../composants/Communs.jsx"
import { lireFeuilles, telechargerClasseur } from "../../lib/excel.js"
import { COLONNES_EDT, ENTETES_MODELE, lignesModele, lireLignes, OBLIGATOIRES_EDT } from "../../lib/edt/importEdt.js"
import { erreursHoraires, genererPeriodes, hm, JOURS, lignesGrille, minutes, normaliserTexte, TYPES_PAUSE } from "../../lib/edt/modele.js"
import { supabase, verifier } from "../../supabase.js"
import { ChoixJours, Nombre, tr } from "./communs.jsx"

// --- Étape 1 : horaires ------------------------------------------------------------------------------------------
export function EtapeHoraires({ etat, maj }) {
  const h = etat.horaires
  const erreurs = erreursHoraires(h)
  const recalcul = (hh, perso) => (perso ? hh : { ...hh, periodes: genererPeriodes(hh) })
  const changer = (k, v) => maj((e) => ({ ...e, horaires: recalcul({ ...e.horaires, [k]: v }, e.periodesPerso) }))
  const majPause = (i, k, v) => maj((e) => ({ ...e, horaires: recalcul({ ...e.horaires, pauses: e.horaires.pauses.map((x, n) => (n === i ? { ...x, [k]: v } : x)) }, e.periodesPerso) }))
  const ajouterPause = (type) => maj((e) => ({ ...e, horaires: recalcul({ ...e.horaires, pauses: [...e.horaires.pauses,
    { id: `p${Date.now()}`, libelle: type === "interruption" ? t("Pas de cours") : t("Pause"), type, debut: type === "interruption" ? "12:20" : "10:00", fin: type === "interruption" ? h.fin : "10:15", jours: type === "interruption" ? [3] : [] }] }, e.periodesPerso) }))
  const retirerPause = (i) => maj((e) => ({ ...e, horaires: recalcul({ ...e.horaires, pauses: e.horaires.pauses.filter((_, n) => n !== i) }, e.periodesPerso) }))
  const majPeriode = (i, k, v) => maj((e) => ({ ...e, periodesPerso: true, horaires: { ...e.horaires, periodes: e.horaires.periodes.map((x, n) => (n === i ? { ...x, [k]: v } : x)) } }))
  const retirerPeriode = (i) => maj((e) => ({ ...e, periodesPerso: true, horaires: { ...e.horaires, periodes: e.horaires.periodes.filter((_, n) => n !== i) } }))
  const ajouterPeriode = () => maj((e) => {
    const der = e.horaires.periodes.at(-1), d = der ? minutes(der.fin) : minutes(e.horaires.debut)
    const f = Math.min(d + Number(e.horaires.duree || 55), 23 * 60 + 59)
    return { ...e, periodesPerso: true, horaires: { ...e.horaires, periodes: [...e.horaires.periodes, { debut: hm(d), fin: hm(f) }] } }
  })
  const auto = () => maj((e) => ({ ...e, periodesPerso: false, horaires: { ...e.horaires, periodes: genererPeriodes(e.horaires) } }))
  const apercu = lignesGrille(h)

  return (
    <div className="row g-3">
      <div className="col-lg-7">
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Jours et heures de cours")}</h3>
          <div className="mb-3"><div className="form-label">{t("Jours de fonctionnement")}</div>
            <ChoixJours valeur={h.jours} onChange={(v) => changer("jours", v)} id="edt-jours" /></div>
          <div className="row g-2">
            <div className="col-sm-4"><label className="form-label" htmlFor="edt-debut">{t("Début des cours")}</label>
              <input type="time" className="form-control" id="edt-debut" value={h.debut} onChange={(e) => changer("debut", e.target.value)} /></div>
            <div className="col-sm-4"><label className="form-label" htmlFor="edt-fin">{t("Fin des cours")}</label>
              <input type="time" className="form-control" id="edt-fin" value={h.fin} onChange={(e) => changer("fin", e.target.value)} /></div>
            <div className="col-sm-4"><label className="form-label" htmlFor="edt-duree">{t("Durée d'une heure de cours (min)")}</label>
              <input type="number" className="form-control" id="edt-duree" min={10} max={240} value={h.duree} onChange={(e) => changer("duree", Number(e.target.value))} /></div>
          </div>
        </div>
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Pauses, pause de midi et interruptions")}</h3>
          <p className="small text-muted">{t("Une pause sans jour choisi s'applique à tous les jours. Une interruption ferme des créneaux (par exemple le mercredi après-midi).")}</p>
          {h.pauses.map((p, i) => (
            <div key={p.id || i} className="edt-pause-ligne border rounded p-2 mb-2">
              <div className="row g-2 align-items-end">
                <div className="col-sm-4"><label className="form-label small" htmlFor={`pl-${i}`}>{t("Libellé")}</label>
                  <input className="form-control form-control-sm" id={`pl-${i}`} maxLength={40} value={p.libelle} onChange={(e) => majPause(i, "libelle", e.target.value)} /></div>
                <div className="col-sm-3"><label className="form-label small" htmlFor={`pt-${i}`}>{t("Type")}</label>
                  <select className="form-select form-select-sm" id={`pt-${i}`} value={p.type} onChange={(e) => majPause(i, "type", e.target.value)}>
                    {TYPES_PAUSE.map(([k, lib]) => <option key={k} value={k}>{t(lib)}</option>)}</select></div>
                <div className="col-4 col-sm-2"><label className="form-label small" htmlFor={`pd-${i}`}>{t("Début")}</label>
                  <input type="time" className="form-control form-control-sm" id={`pd-${i}`} value={p.debut} onChange={(e) => majPause(i, "debut", e.target.value)} /></div>
                <div className="col-4 col-sm-2"><label className="form-label small" htmlFor={`pf-${i}`}>{t("Fin")}</label>
                  <input type="time" className="form-control form-control-sm" id={`pf-${i}`} value={p.fin} onChange={(e) => majPause(i, "fin", e.target.value)} /></div>
                <div className="col-4 col-sm-1 text-end"><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => retirerPause(i)} aria-label={t("Retirer")}>✕</button></div>
              </div>
              <div className="mt-2 d-flex flex-wrap align-items-center gap-2"><span className="small text-muted">{t("Jours concernés (aucun = tous) :")}</span>
                <ChoixJours jours={h.jours} valeur={p.jours} onChange={(v) => majPause(i, "jours", v)} /></div>
            </div>))}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => ajouterPause("pause")}>{t("+ Ajouter une pause")}</button>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => ajouterPause("interruption")}>{t("+ Ajouter une interruption")}</button>
          </div>
        </div>
      </div>
      <div className="col-lg-5">
        <div className="card card-body mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2"><h3 className="h6 mb-0">{t("Périodes de cours")}</h3>
            {etat.periodesPerso && <button type="button" className="btn btn-sm btn-link" onClick={auto}>{t("Recalculer automatiquement")}</button>}</div>
          <p className="small text-muted">{etat.periodesPerso ? t("Périodes personnalisées : elles ne suivent plus les heures et la durée ci-contre.") : t("Calculées à partir des heures, de la durée et des pauses. Vous pouvez les modifier.")}</p>
          <table className="table table-sm align-middle mb-2"><thead><tr><th>#</th><th>{t("Début")}</th><th>{t("Fin")}</th><th /></tr></thead>
            <tbody>{h.periodes.map((p, i) => (
              <tr key={i}><td>{i + 1}</td>
                <td><input type="time" className="form-control form-control-sm" aria-label={t("Début de la période {v0}", { v0: i + 1 })} value={p.debut} onChange={(e) => majPeriode(i, "debut", e.target.value)} /></td>
                <td><input type="time" className="form-control form-control-sm" aria-label={t("Fin de la période {v0}", { v0: i + 1 })} value={p.fin} onChange={(e) => majPeriode(i, "fin", e.target.value)} /></td>
                <td className="text-end"><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => retirerPeriode(i)} aria-label={t("Retirer")}>✕</button></td></tr>))}
            </tbody></table>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={ajouterPeriode} disabled={h.periodes.length >= 16}>{t("+ Ajouter une période")}</button>
        </div>
        <div className="card card-body">
          <h3 className="h6">{t("Aperçu d'une journée")}</h3>
          <ul className="list-unstyled small mb-0 edt-apercu-jour">
            {apercu.map((l, i) => <li key={i} className={l.type === "pause" ? "pause" : ""}><span>{l.libelle}</span> {l.type === "pause" ? t(l.nom) : t("Période {v0}", { v0: l.p + 1 })}</li>)}
          </ul>
        </div>
      </div>
      {!!erreurs.length && <div className="col-12"><div className="alert alert-warning mb-0"><ul className="mb-0">{erreurs.map((e, i) => <li key={i}>{tr(e)}</li>)}</ul></div></div>}
    </div>
  )
}

// --- Étape 2 : import Excel ----------------------------------------------------------------------------------------
const LIBELLES_COLONNES = { nom: "Nom", prenom: "Prénom(s)", matricule: "Matricule", discipline: "Discipline", classe: "Classe", volume: "Volume horaire",
  jours: "Jours disponibles", creneaux: "Créneaux disponibles" }

export function EtapeImport({ etat, maj, ctx, validation }) {
  const [erreur, setErreur] = useState(""), [lecture, setLecture] = useState(false)
  const fichierRef = useRef(null)
  async function modele() {
    setErreur("")
    try {
      await telechargerClasseur([
        { titre: t("Affectations"), entetes: ENTETES_MODELE.map((x) => t(x)), lignes: lignesModele(ctx.classes), largeurs: [18, 18, 16, 22, 12, 14, 30, 30] },
        { titre: t("Consignes"), entetes: [t("Consignes de remplissage")], largeurs: [110], lignes: [
          [t("Une ligne par enseignant, par classe et par discipline. Un enseignant qui a plusieurs classes occupe plusieurs lignes.")],
          [t("Nom, Discipline, Classe, Volume horaire et Jours disponibles sont obligatoires ; Prénom(s), Matricule et Créneaux disponibles sont facultatifs.")],
          [t("Classe : exactement comme dans Paramètres > Classes. Discipline : de préférence comme dans Paramètres > Matières.")],
          [t("Volume horaire : nombre entier d'heures par semaine (1 à 40).")],
          [t("Jours disponibles : par exemple « Lundi, Mardi, Jeudi », « Lundi-Vendredi » ou « Tous ». Il suffit de les indiquer sur une ligne de l'enseignant ; s'ils sont répétés, ils doivent être identiques.")],
          [t("Créneaux disponibles (facultatif) : par exemple « 07:30-12:20 », « matin », « après-midi » ou « P1-P4 » (périodes 1 à 4). Vide = toute la journée.")],
          [t("Deux enseignants de même nom : indiquez leur matricule.")],
        ] },
      ], "modele-emploi-du-temps")
    } catch (e) { setErreur(e.message) }
  }
  async function lire(f) {
    if (!f) return
    setErreur(""); setLecture(true)
    try {
      const feuilles = await lireFeuilles(f, 5 * 1024 * 1024)
      const essais = feuilles.map((x) => ({ nom: x.nom, ...lireLignes(x.data) })).sort((a, b) => a.manquantes.length - b.manquantes.length || b.lignes.length - a.lignes.length)
      const choisie = essais[0]
      if (!choisie || choisie.manquantes.length) {
        throw new Error(t("Colonnes obligatoires absentes : {v0}. Téléchargez le modèle pour voir la présentation attendue.", { v0: (choisie?.manquantes || OBLIGATOIRES_EDT).map((k) => t(LIBELLES_COLONNES[k])).join(", ") }))
      }
      if (!choisie.lignes.length) throw new Error(t("Aucune ligne de données dans le fichier."))
      maj((e) => ({ ...e, fichier: f.name, lignes: choisie.lignes, resultat: null }))
    } catch (e) { setErreur(e.message) } finally { setLecture(false); if (fichierRef.current) fichierRef.current.value = "" }
  }
  const avecSouci = (validation?.lignes || []).filter((l) => l.erreurs.length || l.avertissements.length)
  return (
    <>
      <div className="card card-body mb-3">
        <h3 className="h6">{t("Fichier des affectations des enseignants")}</h3>
        <p className="small text-muted mb-2">{t("Colonnes attendues : Nom, Prénom(s), Matricule (facultatif), Discipline, Classe, Volume horaire, Jours disponibles, Créneaux disponibles (facultatif). Un enseignant peut occuper plusieurs lignes : elles sont regroupées.")}</p>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button type="button" className="btn btn-outline-success btn-sm" onClick={modele}>{t("Télécharger le modèle Excel")}</button>
          <label className="btn btn-primary btn-sm mb-0" htmlFor="edt-fichier">{etat.lignes.length ? t("Remplacer le fichier") : t("Choisir le fichier Excel (.xlsx)")}</label>
          <input ref={fichierRef} type="file" id="edt-fichier" className="visually-hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => lire(e.target.files?.[0])} />
          {lecture && <span className="small text-muted"><span className="spinner-border spinner-border-sm me-1" />{t("Lecture du fichier…")}</span>}
          {etat.fichier && <span className="small text-muted">{t("Fichier : {v0}", { v0: etat.fichier })}</span>}
        </div>
        <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
      </div>
      {!!etat.lignes.length && validation && (
        <div className="card card-body">
          <h3 className="h6">{t("Rapport de lecture")}</h3>
          <div className="d-flex flex-wrap gap-2 mb-2">
            <span className="badge text-bg-light">{t("{v0} ligne(s)", { v0: validation.recap?.lignes ?? etat.lignes.length })}</span>
            <span className="badge text-bg-light">{t("{v0} enseignant(s)", { v0: validation.recap?.enseignants ?? 0 })}</span>
            <span className={`badge ${validation.nbErreurs ? "text-bg-danger" : "text-bg-success"}`}>{t("{v0} erreur(s)", { v0: validation.nbErreurs })}</span>
            <span className={`badge ${validation.nbAvertissements ? "text-bg-warning" : "text-bg-light"}`}>{t("{v0} avertissement(s)", { v0: validation.nbAvertissements })}</span>
          </div>
          {validation.ok
            ? <div className="alert alert-success small mb-2">{t("Fichier conforme : toutes les lignes sont valides.")}{validation.nbAvertissements ? " " + t("Vérifiez les avertissements ci-dessous.") : ""}</div>
            : <div className="alert alert-danger small mb-2">{t("Le fichier contient des erreurs : aucune donnée n'est retenue tant qu'elles ne sont pas corrigées (ici à l'étape suivante, ou dans le fichier puis en le remplaçant).")}</div>}
          {(validation.global || []).map((g, i) => <div key={i} className="alert alert-danger small">{tr(g)}</div>)}
          <RapportLignes lignes={avecSouci} />
        </div>)}
    </>
  )
}

function RapportLignes({ lignes }) {
  const [tout, setTout] = useState(false)
  if (!lignes.length) return null
  const vues = tout ? lignes : lignes.slice(0, 30)
  return (
    <>
      <div className="table-responsive"><table className="table table-sm small align-middle mb-1">
        <thead><tr><th>{t("Ligne")}</th><th>{t("Enseignant")}</th><th>{t("Classe")}</th><th>{t("Discipline")}</th><th>{t("Problème")}</th></tr></thead>
        <tbody>{vues.map((l) => (
          <tr key={l.numero} className={l.erreurs.length ? "table-danger" : "table-warning"}>
            <td>{l.numero}</td><td>{[l.valeurs.nom, l.valeurs.prenom].filter(Boolean).join(" ")}</td><td>{l.valeurs.classe}</td><td>{l.valeurs.discipline}</td>
            <td><ul className="mb-0 ps-3">{l.erreurs.map((e, i) => <li key={"e" + i}><strong>{t("Erreur")}</strong> : {tr(e)}</li>)}
              {l.avertissements.map((e, i) => <li key={"a" + i}>{t("Avertissement")} : {tr(e)}</li>)}</ul></td>
          </tr>))}</tbody></table></div>
      {lignes.length > 30 && <button type="button" className="btn btn-sm btn-link" onClick={() => setTout(!tout)}>{tout ? t("Réduire") : t("Afficher les {v0} lignes signalées", { v0: lignes.length })}</button>}
    </>
  )
}

// --- Étape 3 : aperçu modifiable, contraintes des classes, salles ------------------------------------------------
export function EtapeDonnees({ etat, maj, ctx, validation, recharger, setEtape }) {
  const [onglet, setOnglet] = useState("affectations")
  return (
    <>
      <ul className="nav nav-pills mb-3 flex-nowrap overflow-auto">
        {[["affectations", t("Affectations importées")], ["classes", t("Contraintes par classe")], ["salles", t("Salles spécialisées")]].map(([k, lib]) => (
          <li key={k} className="nav-item"><button type="button" className={`nav-link${onglet === k ? " active" : ""}`} onClick={() => setOnglet(k)}>{lib}</button></li>))}
      </ul>
      {onglet === "affectations" && <Affectations etat={etat} maj={maj} validation={validation} setEtape={setEtape} />}
      {onglet === "classes" && <ContraintesClasses etat={etat} maj={maj} ctx={ctx} validation={validation} />}
      {onglet === "salles" && <Salles ctx={ctx} recharger={recharger} etat={etat} />}
    </>
  )
}

const PAGE = 40
function Affectations({ etat, maj, validation, setEtape }) {
  const [filtre, setFiltre] = useState("tout"), [recherche, setRecherche] = useState(""), [page, setPage] = useState(0)
  const parNumero = useMemo(() => new Map((validation?.lignes || []).map((l) => [l.numero, l])), [validation])
  const q = normaliserTexte(recherche)
  const lignes = etat.lignes.filter((l) => {
    const v = parNumero.get(l.numero)
    if (filtre === "erreurs" && !v?.erreurs.length) return false
    if (filtre === "avertissements" && !v?.avertissements.length) return false
    return !q || normaliserTexte(Object.values(l.valeurs).join(" ")).includes(q)
  })
  const pages = Math.max(1, Math.ceil(lignes.length / PAGE)), p = Math.min(page, pages - 1)
  const majCase = (numero, k, v) => maj((e) => ({ ...e, resultat: null, lignes: e.lignes.map((l) => (l.numero === numero ? { ...l, valeurs: { ...l.valeurs, [k]: v } } : l)) }))
  const supprimer = (numero) => maj((e) => ({ ...e, resultat: null, lignes: e.lignes.filter((l) => l.numero !== numero) }))
  const ajouter = () => maj((e) => ({ ...e, resultat: null, lignes: [...e.lignes, { numero: Math.max(1, ...e.lignes.map((l) => l.numero)) + 1, valeurs: Object.fromEntries(Object.keys(COLONNES_EDT).map((k) => [k, ""])) }] }))
  const r = validation?.recap
  const parEns = useMemo(() => {
    if (!validation?.ok) return []
    const m = new Map()
    for (const a of validation.affectations) m.set(a.enseignant, (m.get(a.enseignant) || 0) + a.volume)
    return validation.enseignants.map((e) => ({ ...e, heures: m.get(e.cle) || 0, classes: new Set(validation.affectations.filter((a) => a.enseignant === e.cle).map((a) => a.classe)).size }))
  }, [validation])
  const parClasse = useMemo(() => {
    if (!validation?.ok) return []
    const m = new Map()
    for (const a of validation.affectations) { const x = m.get(a.classe_id) || { classe: a.classe, heures: 0, disciplines: 0 }; x.heures += a.volume; x.disciplines++; m.set(a.classe_id, x) }
    return [...m.values()].sort((a, b) => a.classe.localeCompare(b.classe, "fr", { numeric: true }))
  }, [validation])

  if (!etat.lignes.length) return <div className="alert alert-info">{t("Importez d'abord le fichier des affectations (étape 2).")}</div>
  return (
    <>
      <div className="row g-2 mb-3">
        {[[t("Enseignants"), r?.enseignants], [t("Classes"), r?.classes], [t("Heures de cours par semaine"), r?.heures], [t("Lignes"), r?.lignes]].map(([lib, v]) => (
          <div key={lib} className="col-6 col-md-3"><div className="card card-body py-2 text-center"><div className="fs-4 fw-semibold">{v ?? "—"}</div><div className="small text-muted">{lib}</div></div></div>))}
      </div>
      {validation && !validation.ok && <div className="alert alert-danger small">{t("{v0} erreur(s) à corriger avant de continuer. Modifiez les cases en rouge ou supprimez les lignes concernées.", { v0: validation.nbErreurs })}</div>}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
        <select className="form-select form-select-sm w-auto" aria-label={t("Filtrer")} value={filtre} onChange={(e) => { setFiltre(e.target.value); setPage(0) }}>
          <option value="tout">{t("Toutes les lignes")}</option><option value="erreurs">{t("Lignes avec erreurs")}</option><option value="avertissements">{t("Lignes avec avertissements")}</option></select>
        <input type="search" className="form-control form-control-sm edt-recherche" placeholder={t("Rechercher")} aria-label={t("Rechercher")} value={recherche} onChange={(e) => { setRecherche(e.target.value); setPage(0) }} />
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={ajouter}>{t("+ Ajouter une ligne")}</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEtape(2)}>{t("Remplacer le fichier")}</button>
      </div>
      <div className="table-responsive edt-tableau-saisie">
        <table className="table table-sm align-middle small">
          <thead><tr><th>{t("Ligne")}</th>{Object.keys(COLONNES_EDT).map((k) => <th key={k}>{t(LIBELLES_COLONNES[k])}</th>)}<th>{t("État")}</th><th /></tr></thead>
          <tbody>{lignes.slice(p * PAGE, p * PAGE + PAGE).map((l) => {
            const v = parNumero.get(l.numero)
            return (
              <tr key={l.numero} className={v?.erreurs.length ? "table-danger" : v?.avertissements.length ? "table-warning" : ""}>
                <td>{l.numero}</td>
                {Object.keys(COLONNES_EDT).map((k) => <td key={k}><input className="form-control form-control-sm" aria-label={`${t(LIBELLES_COLONNES[k])} — ${t("ligne {v0}", { v0: l.numero })}`}
                  value={l.valeurs[k] ?? ""} onChange={(e) => majCase(l.numero, k, e.target.value)} /></td>)}
                <td className="edt-etat-ligne">{v?.erreurs.map((e, i) => <div key={i} className="text-danger">{tr(e)}</div>)}
                  {v?.avertissements.map((e, i) => <div key={"a" + i} className="text-body-secondary">{tr(e)}</div>)}
                  {v && !v.erreurs.length && !v.avertissements.length && <span className="text-success">✓</span>}</td>
                <td><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => supprimer(l.numero)} aria-label={t("Supprimer la ligne {v0}", { v0: l.numero })}>✕</button></td>
              </tr>)
          })}</tbody>
        </table>
      </div>
      {pages > 1 && <div className="d-flex gap-2 align-items-center mb-3"><button type="button" className="btn btn-sm btn-outline-secondary" disabled={p === 0} onClick={() => setPage(p - 1)}>‹</button>
        <span className="small">{t("Page {v0} sur {v1}", { v0: p + 1, v1: pages })}</span>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>›</button></div>}
      {validation?.ok && <div className="row g-3">
        <div className="col-md-6"><details className="card card-body"><summary className="fw-semibold">{t("Récapitulatif par enseignant ({v0})", { v0: parEns.length })}</summary>
          <table className="table table-sm small mt-2 mb-0"><thead><tr><th>{t("Enseignant")}</th><th>{t("Classes")}</th><th>{t("Heures")}</th></tr></thead>
            <tbody>{parEns.map((e) => <tr key={e.cle}><td>{e.nom} {e.prenom}</td><td>{e.classes}</td><td>{e.heures}</td></tr>)}</tbody></table></details></div>
        <div className="col-md-6"><details className="card card-body"><summary className="fw-semibold">{t("Récapitulatif par classe ({v0})", { v0: parClasse.length })}</summary>
          <table className="table table-sm small mt-2 mb-0"><thead><tr><th>{t("Classe")}</th><th>{t("Disciplines")}</th><th>{t("Heures")}</th></tr></thead>
            <tbody>{parClasse.map((c) => <tr key={c.classe}><td>{c.classe}</td><td>{c.disciplines}</td><td>{c.heures}</td></tr>)}</tbody></table></details></div>
      </div>}
    </>
  )
}

function ContraintesClasses({ etat, maj, ctx, validation }) {
  const classes = useMemo(() => {
    const m = new Map()
    for (const a of validation?.affectations || []) {
      const c = m.get(a.classe_id) || { id: a.classe_id, libelle: a.classe, disciplines: new Set() }
      c.disciplines.add(a.discipline); m.set(a.classe_id, c)
    }
    return [...m.values()].sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true }))
  }, [validation])
  const [id, setId] = useState(null)
  const courant = classes.find((c) => c.id === id) || classes[0]
  if (!validation?.ok) return <div className="alert alert-warning">{t("Corrigez d'abord les erreurs des affectations importées.")}</div>
  if (!courant) return null
  const c = etat.classes[courant.id] || {}
  const pm = c.permanences || {}
  const h = etat.horaires
  const types = [...new Set(ctx.salles.map((s) => s.type).filter(Boolean))].sort()
  const majC = (f) => maj((e) => ({ ...e, resultat: null, classes: { ...e.classes, [courant.id]: f({ ...(e.classes[courant.id] || {}) }) } }))
  const majPm = (k, v) => majC((x) => ({ ...x, permanences: { ...(x.permanences || {}), [k]: v } }))
  const interdits = new Set(c.interdits || [])
  const basculer = (cle) => majC((x) => { const s = new Set(x.interdits || []); s.has(cle) ? s.delete(cle) : s.add(cle); return { ...x, interdits: [...s] } })
  const matin = new Set(c.matin || [])
  function appliquerATous() {
    if (!confirm(t("Appliquer les réglages de la classe {v0} (y compris les créneaux interdits et les permanences) à toutes les classes ?", { v0: courant.libelle }))) return
    maj((e) => { const src = e.classes[courant.id] || {}; const n = { ...e.classes }; for (const k of classes) n[k.id] = structuredClone(src); return { ...e, resultat: null, classes: n } })
  }
  const g = etat.generales.classe
  return (
    <div className="row g-3">
      <div className="col-lg-3">
        <label className="form-label" htmlFor="edt-classe-choix">{t("Classe")}</label>
        <select className="form-select" id="edt-classe-choix" value={courant.id} onChange={(e) => setId(e.target.value)} size={Math.min(12, classes.length)}>
          {classes.map((k) => <option key={k.id} value={k.id}>{k.libelle}{etat.classes[k.id] && Object.keys(etat.classes[k.id]).length ? " •" : ""}</option>)}</select>
        <p className="small text-muted mt-2">{t("• : réglages propres à la classe. Sans réglage, les valeurs générales (étape 4) s'appliquent.")}</p>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={appliquerATous}>{t("Appliquer à toutes les classes")}</button>
      </div>
      <div className="col-lg-9">
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Limites de la classe {v0}", { v0: courant.libelle })}</h3>
          <div className="row g-2">
            <div className="col-sm-6"><label className="form-label small" htmlFor="c-maxj">{t("Heures de cours par jour au maximum")}</label>
              <Nombre id="c-maxj" valeur={c.max_jour} placeholder={g.max_jour} onChange={(v) => majC((x) => ({ ...x, max_jour: v }))} /></div>
            <div className="col-sm-6"><label className="form-label small" htmlFor="c-maxc">{t("Heures consécutives d'une même matière au maximum")}</label>
              <Nombre id="c-maxc" valeur={c.max_consecutives} placeholder={g.max_consecutives} onChange={(v) => majC((x) => ({ ...x, max_consecutives: v }))} /></div>
          </div>
        </div>
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Permanences")}</h3>
          <p className="small text-muted">{t("Heures où la classe est présente sans cours (étude surveillée). Elles apparaissent comme « Permanence » dans l'emploi du temps.")}</p>
          <div className="row g-2 align-items-end">
            <div className="col-sm-3"><label className="form-label small" htmlFor="pm-h">{t("Heures par semaine")}</label>
              <Nombre id="pm-h" min={0} max={20} valeur={pm.heures} placeholder={0} onChange={(v) => majPm("heures", v)} /></div>
            <div className="col-sm-3"><label className="form-label small" htmlFor="pm-d">{t("Pas avant")}</label>
              <select className="form-select form-select-sm" id="pm-d" value={pm.debut || ""} onChange={(e) => majPm("debut", e.target.value)}>
                <option value="">—</option>{h.periodes.map((x, i) => <option key={i} value={x.debut}>{x.debut}</option>)}</select></div>
            <div className="col-sm-3"><label className="form-label small" htmlFor="pm-f">{t("Pas après")}</label>
              <select className="form-select form-select-sm" id="pm-f" value={pm.fin || ""} onChange={(e) => majPm("fin", e.target.value)}>
                <option value="">—</option>{h.periodes.map((x, i) => <option key={i} value={x.fin}>{x.fin}</option>)}</select></div>
          </div>
          <div className="mt-2 d-flex flex-wrap gap-2 align-items-center"><span className="small text-muted">{t("Jours autorisés (aucun = tous) :")}</span>
            <ChoixJours jours={h.jours} valeur={pm.jours} onChange={(v) => majPm("jours", v)} /></div>
        </div>
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Matières à placer de préférence le matin")}</h3>
          <div className="d-flex flex-wrap gap-2">{[...courant.disciplines].sort().map((d) => (
            <label key={d} className="form-check form-check-inline small mb-0"><input type="checkbox" className="form-check-input" checked={matin.has(d)}
              onChange={() => majC((x) => { const s = new Set(x.matin || []); s.has(d) ? s.delete(d) : s.add(d); return { ...x, matin: [...s] } })} /> {d}</label>))}</div>
        </div>
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Salles spécialisées exigées")}</h3>
          {!types.length ? <p className="small text-muted mb-0">{t("Aucune salle spécialisée déclarée : ajoutez-en dans l'onglet « Salles spécialisées ».")}</p>
            : <div className="row g-2">{[...courant.disciplines].sort().map((d) => (
              <div key={d} className="col-sm-6 col-lg-4"><label className="form-label small" htmlFor={`sl-${d}`}>{d}</label>
                <select className="form-select form-select-sm" id={`sl-${d}`} value={c.salles?.[d] || ""}
                        onChange={(e) => majC((x) => { const s = { ...(x.salles || {}) }; e.target.value ? (s[d] = e.target.value) : delete s[d]; return { ...x, salles: s } })}>
                  <option value="">{t("Salle de la classe")}</option>{types.map((ty) => <option key={ty} value={ty}>{ty}</option>)}</select></div>))}</div>}
        </div>
        <div className="card card-body">
          <h3 className="h6">{t("Créneaux interdits à la classe")}</h3>
          <p className="small text-muted">{t("Cochez les créneaux où la classe ne peut pas avoir cours (sortie, activité, salle indisponible…).")}</p>
          <div className="table-responsive"><table className="table table-sm table-bordered small text-center edt-interdits mb-0">
            <thead><tr><th />{h.jours.map((j) => <th key={j}>{t(JOURS.find(([x]) => x === j)[1])}</th>)}</tr></thead>
            <tbody>{h.periodes.map((x, p) => <tr key={p}><th className="text-nowrap">{x.debut}</th>{h.jours.map((j) => {
              const cle = `${j}-${p}`
              return <td key={j} className={interdits.has(cle) ? "table-danger" : ""}><input type="checkbox" className="form-check-input" aria-label={t("Interdire {v0} à {v1}", { v0: t(JOURS.find(([y]) => y === j)[1]), v1: x.debut })}
                checked={interdits.has(cle)} onChange={() => basculer(cle)} /></td>
            })}</tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  )
}

const TYPES_SALLE = ["Laboratoire", "Salle informatique", "Atelier", "Salle de sport", "Salle de musique", "Salle d'arts plastiques", "Bibliothèque"]
function Salles({ ctx, recharger, etat }) {
  const [f, setF] = useState({ nom: "", type: "", capacite: "" }), [msg, setMsg] = useState({})
  const utilises = new Set(Object.values(etat.classes || {}).flatMap((c) => Object.values(c.salles || {})))
  async function ajouter(e) {
    e.preventDefault(); setMsg({})
    try {
      if (!f.nom.trim() || !f.type.trim()) throw new Error(t("Indiquez le nom et le type de la salle."))
      verifier(await supabase.from("salles").insert({ nom: f.nom.trim(), type: f.type.trim(), capacite: f.capacite ? Number(f.capacite) : null }))
      setF({ nom: "", type: f.type, capacite: "" }); await recharger(); setMsg({ ok: t("Salle ajoutée.") })
    } catch (err) { setMsg({ erreur: err.message }) }
  }
  async function retirer(s) {
    if (!confirm(t("Supprimer la salle {v0} ?", { v0: s.nom }))) return
    try { verifier(await supabase.from("salles").delete().eq("id", s.id)); await recharger() } catch (err) { setMsg({ erreur: err.message }) }
  }
  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <form className="card card-body" onSubmit={ajouter}>
          <h3 className="h6">{t("Ajouter une salle spécialisée")}</h3>
          <p className="small text-muted">{t("Les salles d'un même type sont interchangeables : le moteur en attribue une libre à chaque cours qui exige ce type.")}</p>
          <label className="form-label small" htmlFor="sa-nom">{t("Nom")}</label>
          <input className="form-control form-control-sm mb-2" id="sa-nom" maxLength={60} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder={t("ex. Laboratoire 1")} />
          <label className="form-label small" htmlFor="sa-type">{t("Type")}</label>
          <input className="form-control form-control-sm mb-2" id="sa-type" list="sa-types" maxLength={60} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} />
          <datalist id="sa-types">{TYPES_SALLE.map((x) => <option key={x} value={t(x)} />)}</datalist>
          <label className="form-label small" htmlFor="sa-cap">{t("Capacité (facultatif)")}</label>
          <input type="number" className="form-control form-control-sm mb-3" id="sa-cap" min={1} max={1000} value={f.capacite} onChange={(e) => setF({ ...f, capacite: e.target.value })} />
          <div><button className="btn btn-primary btn-sm">{t("Ajouter")}</button></div>
          <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
        </form>
      </div>
      <div className="col-lg-7">
        <div className="card card-body">
          <h3 className="h6">{t("Salles de l'établissement ({v0})", { v0: ctx.salles.length })}</h3>
          {!ctx.salles.length ? <p className="small text-muted mb-0">{t("Aucune salle déclarée.")}</p>
            : <table className="table table-sm small align-middle mb-0"><thead><tr><th>{t("Nom")}</th><th>{t("Type")}</th><th>{t("Capacité")}</th><th /></tr></thead>
              <tbody>{ctx.salles.map((s) => <tr key={s.id}><td>{s.nom}</td><td>{s.type}{utilises.has(s.type) && <span className="badge text-bg-light ms-1">{t("exigé")}</span>}</td><td>{s.capacite || ""}</td>
                <td className="text-end"><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => retirer(s)} aria-label={t("Supprimer la salle {v0}", { v0: s.nom })}>✕</button></td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  )
}
