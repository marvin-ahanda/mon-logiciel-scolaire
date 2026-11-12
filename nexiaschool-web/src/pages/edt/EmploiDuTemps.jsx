// Paramètres > Emploi du temps : génération automatique en 7 étapes et versions enregistrées (administration).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { t, locale } from "../../i18n.jsx"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../../supabase.js"
import { erreursHoraires } from "../../lib/edt/modele.js"
import { validerImport } from "../../lib/edt/importEdt.js"
import { construireConfig, etatInitial, repondre, reprendreEtat, signature } from "../../lib/edt/etat.js"
import { verifierGrille } from "../../lib/edt/moteur.js"
import { PERIODES_EDT } from "../../lib/edt/vues.js"
import { EtapeDonnees, EtapeHoraires, EtapeImport } from "./EtapesSaisie.jsx"
import { EtapeContraintes, EtapeFaisabilite, EtapeGeneration, useAnalyse } from "./EtapesReglages.jsx"
import Visionneuse from "./Visionneuse.jsx"
import Versions from "./Versions.jsx"
import { tr } from "./communs.jsx"
import "./edt.css"

const ETAPES = ["Horaires", "Import Excel", "Vérification des données", "Contraintes générales", "Faisabilité", "Génération", "Emploi du temps"]

export default function EmploiDuTemps() {
  const { exercice: actif } = useSession()
  const [vue, setVue] = useState("generer")
  const [exerciceId, setExerciceId] = useState(actif?.id || null)
  const [ctx, erreur, recharger] = useDonnees(async () => ({
    exercices: verifier(await supabase.from("exercices").select("id, libelle, actif").order("libelle", { ascending: false })),
    classes: await toutCharger(() => supabase.from("classes").select("id, libelle, ordre").order("ordre").order("libelle")),
    matieres: await toutCharger(() => supabase.from("matieres").select("id, code, libelle").order("libelle")),
    personnels: await toutCharger(() => supabase.from("personnels").select("id, nom, prenom, matricule").order("nom")),
    salles: verifier(await supabase.from("salles").select("id, nom, type, capacite").order("type").order("nom")),
  }), [])
  useEffect(() => { if (!exerciceId && ctx?.exercices?.length) setExerciceId((ctx.exercices.find((x) => x.actif) || ctx.exercices[0]).id) }, [ctx, exerciceId])

  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!ctx) return <Chargement />
  if (!ctx.exercices.length) return <div className="alert alert-warning">{t("Créez d'abord l'année scolaire dans l'onglet « Exercices et séquences ».")}</div>
  if (!ctx.classes.length) return <div className="alert alert-warning">{t("Créez d'abord les classes dans l'onglet « Classes ».")}</div>
  const exercice = ctx.exercices.find((x) => x.id === exerciceId) || ctx.exercices[0]
  return (
    <div className="edt-module">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3 no-print">
        <ul className="nav nav-pills">
          <li className="nav-item"><button type="button" className={`nav-link${vue === "generer" ? " active" : ""}`} onClick={() => setVue("generer")}>{t("Générer un emploi du temps")}</button></li>
          <li className="nav-item"><button type="button" className={`nav-link${vue === "versions" ? " active" : ""}`} onClick={() => setVue("versions")}>{t("Versions enregistrées")}</button></li>
        </ul>
        <div className="d-flex align-items-center gap-2"><label className="small text-muted" htmlFor="edt-annee">{t("Année scolaire")}</label>
          <select className="form-select form-select-sm w-auto" id="edt-annee" value={exercice.id} onChange={(e) => setExerciceId(e.target.value)}>
            {ctx.exercices.map((x) => <option key={x.id} value={x.id}>{x.libelle}{x.actif ? ` (${t("en cours")})` : ""}</option>)}</select></div>
      </div>
      {vue === "generer" ? <Assistant key={exercice.id} ctx={ctx} exercice={exercice} recharger={recharger} versVersions={() => setVue("versions")} />
        : <Versions key={exercice.id} exercice={exercice} reprendre={async (source) => {
            await rpc("edt_brouillon_enregistrer", { p_exercice: exercice.id, p_donnees: { ...source, resultat: null }, p_etape: 1 }); setVue("generer")
          }} />}
    </div>
  )
}

/** Parcours guidé : l'état (brouillon) est enregistré automatiquement sur le serveur ; revenir en arrière ne perd rien. */
function Assistant({ ctx, exercice, recharger, versVersions }) {
  const { etablissement } = useSession()
  const [etat, setEtat] = useState(null), [etape, setEtapeBrute] = useState(1)
  const [sauve, setSauve] = useState(null), [erreurSauve, setErreurSauve] = useState("")
  const [chargement, setChargement] = useState("")
  const minuteur = useRef(null), dernier = useRef("")

  useEffect(() => {
    let actif = true
    rpc("edt_brouillon_lire", { p_exercice: exercice.id }).then((b) => {
      if (!actif) return
      const e = b ? reprendreEtat(b.donnees) : etatInitial()
      dernier.current = JSON.stringify(e)
      setEtat(e); setEtapeBrute(b?.etape || 1); setSauve(b ? { maj: b.maj, par: b.maj_par } : null)
    }).catch((e) => actif && setChargement(e.message))
    return () => { actif = false }
  }, [exercice.id])

  const enregistrer = useCallback(async (e, n) => {
    const texte = JSON.stringify(e)
    try {
      const r = await rpc("edt_brouillon_enregistrer", { p_exercice: exercice.id, p_donnees: e, p_etape: n })
      dernier.current = texte; setSauve({ maj: r.maj }); setErreurSauve("")
    } catch (err) { setErreurSauve(err.message) }
  }, [exercice.id])
  // enregistrement automatique (1,5 s après la dernière modification)
  useEffect(() => {
    if (!etat || JSON.stringify(etat) === dernier.current) return
    clearTimeout(minuteur.current)
    minuteur.current = setTimeout(() => enregistrer(etat, etape), 1500)
    return () => clearTimeout(minuteur.current)
  }, [etat, etape, enregistrer])

  const maj = useCallback((f) => setEtat((e) => f(e)), [])
  const ctxValidation = useMemo(() => ({ classes: ctx.classes, matieres: ctx.matieres, personnels: ctx.personnels, horaires: etat?.horaires }), [ctx, etat?.horaires])
  const validation = useMemo(() => (etat && etat.lignes.length ? validerImport(etat.lignes, ctxValidation) : null), [etat?.lignes, ctxValidation]) // eslint-disable-line react-hooks/exhaustive-deps
  const config = useMemo(() => (etat ? construireConfig(etat, ctx.salles, validation) : null), [etat, ctx.salles, validation])
  const sig = useMemo(() => (config ? signature(config) : 0), [config])
  const analyse = useAnalyse(config, etape >= 4 && !!validation?.ok)
  const resultatValide = !!(etat?.resultat && etat.resultat.signature === sig)

  if (chargement) return <Alerte>{chargement}</Alerte>
  if (!etat) return <Chargement />
  // étapes accessibles : on passe à l'étape n + 1 seulement si l'étape n est correcte
  const conditions = [!erreursHoraires(etat.horaires).length, etat.lignes.length > 0, !!validation?.ok, true, !!analyse?.ok, resultatValide]
  let max = 1
  while (max < 7 && conditions[max - 1]) max++
  const setEtape = (n) => { const m = Math.max(1, Math.min(n, max)); setEtapeBrute(m); enregistrer(etat, m); window.scrollTo({ top: 0, behavior: "smooth" }) }
  // après le choix d'une proposition, l'étape 7 s'ouvre dès que le résultat est pris en compte
  const versResultat = () => { setEtapeBrute(7); window.scrollTo({ top: 0, behavior: "smooth" }) }
  const vue = Math.min(etape, max)
  const repondreQ = (q, v) => maj((e) => repondre(e, validation, q, v))
  const suivantPossible = vue < 7 && vue + 1 <= max

  return (
    <>
      <ol className="edt-etapes no-print" aria-label={t("Progression")}>
        {ETAPES.map((lib, i) => {
          const n = i + 1, etatEtape = n === vue ? "courante" : n < vue || (n <= max && n !== vue) ? "faite" : "bloquee"
          return (
            <li key={n} className={`edt-etape ${etatEtape}`}>
              <button type="button" disabled={n > max} aria-current={n === vue ? "step" : undefined} onClick={() => setEtape(n)}>
                <span className="edt-num">{n}</span><span className="edt-lib">{t(lib)}</span></button>
            </li>)
        })}
      </ol>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3 no-print">
        <h2 className="h5 mb-0">{t("Étape {v0} sur 7 : {v1}", { v0: vue, v1: t(ETAPES[vue - 1]) })}</h2>
        <span className="small text-muted">{erreurSauve ? <span className="text-danger">{t("Brouillon non enregistré : {v0}", { v0: erreurSauve })}</span>
          : sauve ? t("Brouillon enregistré le {v0}", { v0: new Date(sauve.maj).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) }) : t("Brouillon enregistré automatiquement")}</span>
      </div>
      {etat.resultat && !resultatValide && vue < 7 && vue !== 6 &&
        <div className="alert alert-info small no-print">{t("Les données ont changé depuis la dernière génération : relancez la génération (étape 6) pour en tenir compte.")}</div>}

      {vue === 1 && <EtapeHoraires etat={etat} maj={maj} />}
      {vue === 2 && <EtapeImport etat={etat} maj={maj} ctx={ctx} validation={validation} />}
      {vue === 3 && <EtapeDonnees etat={etat} maj={maj} ctx={ctx} validation={validation} recharger={recharger} setEtape={setEtape} />}
      {vue === 4 && <EtapeContraintes etat={etat} maj={maj} config={config} />}
      {vue === 5 && <EtapeFaisabilite etat={etat} config={config} repondreQ={repondreQ} setEtape={setEtape} analyse={analyse} />}
      {vue === 6 && <EtapeGeneration etat={etat} maj={maj} config={config} setEtape={(n) => (n === 7 ? versResultat() : setEtape(n))} repondreQ={repondreQ} />}
      {vue === 7 && resultatValide && <Resultat etat={etat} maj={maj} config={config} exercice={exercice} etablissement={etablissement} versVersions={versVersions} />}

      <div className="d-flex justify-content-between mt-4 no-print">
        <button type="button" className="btn btn-outline-secondary" disabled={vue === 1} onClick={() => setEtape(vue - 1)}>{t("‹ Étape précédente")}</button>
        {vue < 7 && <button type="button" className="btn btn-primary" disabled={!suivantPossible} onClick={() => setEtape(vue + 1)}
          title={suivantPossible ? "" : t("Complétez cette étape pour continuer.")}>{t("Étape suivante ›")}</button>}
      </div>
    </>
  )
}

/** Étape 7 : présentation, contrôle final et enregistrement d'une version. */
function Resultat({ etat, maj, config, exercice, etablissement, versVersions }) {
  const r = etat.resultat
  const [nom, setNom] = useState(() => etat.nom || t("Proposition du {v0}", { v0: new Date().toLocaleDateString(locale()) }))
  const [periode, setPeriode] = useState(etat.periode || "annee")
  const [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)
  const violations = useMemo(() => verifierGrille(config, r.grille), [config, r.grille])
  const entete = { etablissement: etablissement.nom, annee: exercice.libelle, periode, version: nom }
  async function enregistrerVersion() {
    setMsg({}); setEnvoi(true)
    try {
      const source = { horaires: etat.horaires, periodesPerso: etat.periodesPerso, fichier: etat.fichier, lignes: etat.lignes, reglagesEnseignants: etat.reglagesEnseignants, classes: etat.classes, generales: etat.generales }
      const v = await rpc("edt_enregistrer", { p: { exercice_id: exercice.id, periode, nom: nom.trim(), config: { ...config, source }, grille: r.grille,
        bilan: { criteres: r.criteres, cout: Math.round(r.cout), graine: r.graine, duree: r.duree, heures: r.grille.length } } })
      maj((e) => ({ ...e, nom: nom.trim(), periode }))
      setMsg({ ok: t("Version n° {v0} enregistrée (provisoire). Rendez-la officielle depuis « Versions enregistrées ».", { v0: v.numero }) })
    } catch (e) { setMsg({ erreur: e.message }) } finally { setEnvoi(false) }
  }
  const q = r.criteres
  return (
    <>
      {violations.length ? <div className="alert alert-danger">{t("Contrôle final : contrainte obligatoire non respectée.")}<ul className="mb-0">{violations.map((v, i) => <li key={i}>{tr(v)}</li>)}</ul></div>
        : <div className="alert alert-success small no-print">{t("Contrôle final réussi : toutes les contraintes obligatoires sont respectées ({v0} heures placées).", { v0: r.grille.length })}
          {" "}{t("Heures creuses : {v0} (classes), {v1} (enseignants) · répétitions dans la journée : {v2}.", { v0: q.trousClasses, v1: q.trousEnseignants, v2: q.repetitions })}</div>}
      <div className="card card-body mb-3 no-print">
        <h3 className="h6">{t("Enregistrer cette version")}</h3>
        <div className="row g-2 align-items-end">
          <div className="col-md-5"><label className="form-label small" htmlFor="v-nom">{t("Nom de la version")}</label>
            <input className="form-control form-control-sm" id="v-nom" maxLength={100} value={nom} onChange={(e) => setNom(e.target.value)} /></div>
          <div className="col-md-3"><label className="form-label small" htmlFor="v-per">{t("Période")}</label>
            <select className="form-select form-select-sm" id="v-per" value={periode} onChange={(e) => setPeriode(e.target.value)}>
              {PERIODES_EDT.map(([k, lib]) => <option key={k} value={k}>{t(lib)}</option>)}</select></div>
          <div className="col-md-4 d-flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={envoi || !nom.trim() || !!violations.length} onClick={enregistrerVersion}>{envoi ? t("Vérification par le serveur…") : t("Enregistrer la version")}</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={versVersions}>{t("Versions enregistrées")}</button>
          </div>
        </div>
        <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      </div>
      <Visionneuse cfg={config} grille={r.grille} entete={entete} />
    </>
  )
}
