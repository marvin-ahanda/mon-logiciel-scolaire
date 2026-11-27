// SmartEval — composition chronométrée (côté élève). Le serveur est seul juge du temps :
//  * il démarre la tentative, fixe l'échéance et renvoie son heure (« maintenant ») ; l'appareil n'affiche qu'un compte à rebours ;
//  * chaque sauvegarde et la soumission sont contrôlées par le serveur, qui refuse toute modification après l'échéance ;
//  * l'appareil garde le jeton secret de la tentative (reprise après actualisation ou fermeture) et une copie locale des réponses
//    non encore envoyées : cette copie ne sert qu'à les renvoyer au serveur avant l'échéance, jamais à prolonger le temps.
import { useCallback, useEffect, useRef, useState } from "react"
import { alerteFranchie, compteARebours, decalageServeur, dureeTexte, niveauChrono, tempsRestant } from "../lib/chrono.js"
import { dateHeure } from "../lib/format.js"
import { messageErreur, supabase } from "../supabase.js"
import { t } from "../i18n.jsx"
import { DocumentsAtelecharger, EnteteEvaluation, Question, vide } from "./FormulaireEvaluation.jsx"

const DELAI_SAUVEGARDE = 1500       // ms après la dernière frappe
const DELAI_NOUVEL_ESSAI = 5000     // ms entre deux essais quand le réseau manque
const ESSAIS_MAX = 4                // refus répétés du serveur avant de rendre la main à l'élève
const AVANCE_ENVOI = 1000           // ms : la copie part juste avant zéro, pour que les dernières réponses arrivent à temps
const AVANCE_SAUVEGARDE = 5000      // ms : dernière sauvegarde forcée avant l'échéance

const cleTentative = (jeton) => `smarteval-tentative:${jeton}`
const cleReponses = (jeton) => `smarteval-chrono-reponses:${jeton}`
function lireLocal(cle) { try { return JSON.parse(localStorage.getItem(cle) || "null") } catch { return null } }
function ecrireLocal(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)) } catch { /* stockage indisponible */ } }
function effacerLocal(cle) { try { localStorage.removeItem(cle) } catch { /* rien */ } }

/** Appel au serveur gardant l'indice (hint) des erreurs métier et distinguant une coupure réseau. */
async function appeler(nom, params) {
  let r
  try { r = await supabase.rpc(nom, params) } catch (e) { const x = new Error(messageErreur(e)); x.reseau = true; throw x }
  if (r.error) {
    const x = new Error(messageErreur(r.error))
    x.indice = r.error.hint || ""
    x.reseau = !r.error.code || /fetch|network|load failed/i.test(r.error.message || "")
    throw x
  }
  return r.data
}

function Presentation({ evaluation, identite, setIdentite, erreurs, onCommencer, occupe, erreur, onReprise }) {
  const nbClasses = evaluation.classes.length
  return (
    <>
      <div className="se-carte se-chrono-presentation">
        <h2 className="h5">{t("Avant de commencer")}</h2>
        <dl className="row small mb-2">
          <dt className="col-sm-4">{t("Matière")}</dt><dd className="col-sm-8">{evaluation.matiere || "—"}</dd>
          <dt className="col-sm-4">{nbClasses > 1 ? t("Classes") : t("Classe")}</dt><dd className="col-sm-8">{evaluation.classes.map((c) => c.libelle).join(", ")}</dd>
          <dt className="col-sm-4">{t("Durée de composition")}</dt><dd className="col-sm-8 fw-semibold">{dureeTexte(evaluation.chrono_secondes)}</dd>
          <dt className="col-sm-4">{t("Nombre de questions")}</dt><dd className="col-sm-8">{evaluation.nb_questions}</dd>
          <dt className="col-sm-4">{t("Échéance de l'évaluation")}</dt><dd className="col-sm-8">{dateHeure(evaluation.ferme_le)}</dd>
          {evaluation.supports_nombre > 0 && <><dt className="col-sm-4">{t("Documents")}</dt>
            <dd className="col-sm-8">{t("{v0} document(s) support(s), disponible(s) au démarrage", { v0: evaluation.supports_nombre })}</dd></>}
        </dl>
        {evaluation.consignes && <><div className="small fw-semibold">{t("Consignes")}</div><p className="se-consignes small">{evaluation.consignes}</p></>}
        <div className="alert alert-warning mb-0 se-chrono-avertissement" role="note">
          <strong>{t("Attention : dès que vous cliquez sur Commencer, votre temps de composition démarre. Le chronomètre continue même si vous quittez la page ou fermez votre navigateur.")}</strong>
        </div>
      </div>
      <Identification evaluation={evaluation} identite={identite} setIdentite={setIdentite} erreurs={erreurs} />
      {erreur && <div className="alert alert-danger" role="alert">{erreur}</div>}
      <div className="d-grid gap-2 mb-3">
        <button type="button" className="btn btn-primary btn-lg se-chrono-commencer" onClick={onCommencer} disabled={occupe}>
          {occupe ? <span className="spinner-border spinner-border-sm me-2" /> : "▶ "}{t("COMMENCER L'ÉVALUATION")}</button>
        <button type="button" className="btn btn-link btn-sm" onClick={onReprise}>{t("J'ai déjà commencé sur un autre appareil : reprendre avec mon code")}</button>
      </div>
    </>
  )
}

function Identification({ evaluation, identite, setIdentite, erreurs }) {
  const maj = (k) => (e) => setIdentite({ ...identite, [k]: e.target.value })
  return (
    <div className={`se-carte${Object.values(erreurs).some(Boolean) ? " se-erreur" : ""}`} id="se-identite">
      <div className="se-intitule mb-3">{t("Identification de l'élève")}</div>
      <div className="row g-3">
        <div className="col-sm-6"><label className="form-label small" htmlFor="se-nom">{t("Nom")} <span className="text-danger">*</span></label>
          <input id="se-nom" className="form-control se-ligne" maxLength={100} autoComplete="family-name" value={identite.nom} onChange={maj("nom")} />
          {erreurs.nom && <div className="text-danger small">{erreurs.nom}</div>}</div>
        <div className="col-sm-6"><label className="form-label small" htmlFor="se-prenom">{t("Prénom")} <span className="text-danger">*</span></label>
          <input id="se-prenom" className="form-control se-ligne" maxLength={100} autoComplete="given-name" value={identite.prenom} onChange={maj("prenom")} />
          {erreurs.prenom && <div className="text-danger small">{erreurs.prenom}</div>}</div>
        <div className="col-sm-6"><label className="form-label small" htmlFor="se-classe">{t("Classe")} <span className="text-danger">*</span></label>
          <select id="se-classe" className="form-select" value={identite.classe_id} onChange={maj("classe_id")}>
            <option value="">{t("Choisir")}</option>{evaluation.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
          {erreurs.classe && <div className="text-danger small">{erreurs.classe}</div>}</div>
        <div className="col-sm-6"><label className="form-label small" htmlFor="se-matricule">{t("Matricule")} {evaluation.demande_matricule ? <span className="text-danger">*</span> : <span className="text-muted">{t("(facultatif)")}</span>}</label>
          <input id="se-matricule" className="form-control se-ligne" maxLength={40} autoComplete="off" value={identite.matricule} onChange={maj("matricule")} />
          {erreurs.matricule && <div className="text-danger small">{erreurs.matricule}</div>}</div>
      </div>
    </div>
  )
}

function controlerIdentite(evaluation, identite) {
  const e = {}
  if (!identite.nom.trim()) e.nom = t("Indiquez votre nom.")
  if (!identite.prenom.trim()) e.prenom = t("Indiquez votre prénom.")
  if (!identite.classe_id) e.classe = t("Choisissez votre classe.")
  if (evaluation.demande_matricule && !identite.matricule.trim()) e.matricule = t("Indiquez votre matricule.")
  return e
}

const identiteEnvoyee = (i) => ({ nom: i.nom.trim(), prenom: i.prenom.trim(), classe_id: i.classe_id, ...(i.matricule.trim() ? { matricule: i.matricule.trim() } : {}) })

function Reprise({ evaluation, identite, setIdentite, erreurs, code, setCode, onValider, onRetour, occupe, erreur }) {
  return (
    <>
      <div className="se-carte">
        <h2 className="h5">{t("Reprendre ma composition")}</h2>
        <p className="small text-muted mb-0">{t("Saisissez la même identité qu'au démarrage et le code de reprise affiché pendant votre composition. Le temps n'a pas été arrêté.")}</p>
      </div>
      <Identification evaluation={evaluation} identite={identite} setIdentite={setIdentite} erreurs={erreurs} />
      <div className="se-carte">
        <label className="form-label small" htmlFor="se-code-reprise">{t("Code de reprise")}</label>
        <input id="se-code-reprise" className="form-control font-monospace text-uppercase" maxLength={12} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      {erreur && <div className="alert alert-danger" role="alert">{erreur}</div>}
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-outline-secondary" onClick={onRetour} disabled={occupe}>← {t("Retour")}</button>
        <button type="button" className="btn btn-primary" onClick={onValider} disabled={occupe || code.trim().length < 12}>{t("Reprendre")}</button>
      </div>
    </>
  )
}

function Fin({ etat }) {
  const auto = etat.statut === "expiree"
  if (auto && !etat.copie_creee) return (
    <div className="se-carte se-close" role="status">
      <h2 className="h5">{t("Temps écoulé")}</h2>
      <p className="mb-0">{t("Le temps de composition est terminé. Pour cette évaluation, votre enseignant n'a pas activé la soumission automatique : aucune copie n'a été enregistrée.")}</p>
    </div>)
  return (
    <div className="se-carte se-confirmation" role="status">
      <div className="se-confirmation-icone" aria-hidden="true">✓</div>
      <h2 className="h4">{auto ? t("Temps écoulé : vos réponses ont été soumises automatiquement.") : t("Votre évaluation a bien été soumise.")}</h2>
      {etat.identite && <p className="mb-1">{etat.identite.nom} {etat.identite.prenom} · {etat.identite.classe}</p>}
      {etat.recu && <p className="mb-1">{t("Accusé de réception n° ")}<strong className="font-monospace">{etat.recu}</strong></p>}
      <p className="text-muted small mb-0">{t("Fin de composition enregistrée le {v0}. Vous pouvez fermer cette page.", { v0: dateHeure(etat.soumis_le) })}</p>
    </div>)
}

function BarreChrono({ restant, sauvegarde, code }) {
  const niveau = niveauChrono(restant)
  const textes = { cours: t("Sauvegarde en cours…"), ok: t("Réponses sauvegardées"), attente: t("Modifications non encore sauvegardées"),
                   reseau: t("Connexion perdue : vos réponses seront envoyées dès le retour du réseau. Le temps continue de s'écouler.") }
  return (
    <div className={`se-chrono-barre se-chrono-${niveau}`}>
      <div className="d-flex justify-content-between align-items-center gap-2">
        <div><div className="small">{t("Temps restant")}</div>
          <div className="se-chrono-temps font-monospace" role="timer" aria-label={t("Temps restant")}>{compteARebours(restant)}</div></div>
        <div className="text-end small">
          <div className={sauvegarde === "reseau" ? "fw-semibold" : ""} aria-live="polite">{textes[sauvegarde] || ""}</div>
          {code && <div>{t("Code de reprise : ")}<strong className="font-monospace">{code}</strong></div>}
        </div>
      </div>
    </div>
  )
}

/** evaluation : formulaire public (sans questions) ; jeton : lien public de l'évaluation. */
export default function CompositionChronometree({ jeton, evaluation }) {
  const [phase, setPhase] = useState("chargement")     // chargement | presentation | reprise | composition | fin | panne
  const [identite, setIdentite] = useState({ nom: "", prenom: "", matricule: "", classe_id: evaluation.classes.length === 1 ? evaluation.classes[0].id : "" })
  const [erreurs, setErreurs] = useState({}), [erreur, setErreur] = useState(""), [occupe, setOccupe] = useState(false), [code, setCode] = useState("")
  const [etat, setEtat] = useState(null), [reponses, setReponses] = useState({}), [verrou, setVerrou] = useState(false)
  const [restant, setRestant] = useState(0), [alerte, setAlerte] = useState(""), [sauvegarde, setSauvegarde] = useState("ok"), [confirmer, setConfirmer] = useState(false)
  const decalage = useRef(0), tentative = useRef(lireLocal(cleTentative(jeton))), reponsesRef = useRef({}), aEnvoyer = useRef(false)
  const minuterie = useRef(null), envoiEnCours = useRef(false), finEnCours = useRef(false), restantAvant = useRef(Infinity)

  const appliquer = useCallback((r) => {
    decalage.current = decalageServeur(r.maintenant)
    if (r.tentative) tentative.current = { ...tentative.current, jeton: r.tentative, code: r.code_reprise || tentative.current?.code || "" }
    if (tentative.current && r.identite) tentative.current = { ...tentative.current, identite: r.identite }
    setEtat((e) => ({ ...e, ...r }))
    if (r.statut === "en_cours") {
      ecrireLocal(cleTentative(jeton), tentative.current)
      const local = lireLocal(cleReponses(jeton))
      const reprise = local?.tentative === tentative.current?.jeton ? { ...(r.reponses || {}), ...local.reponses } : (r.reponses || {})
      aEnvoyer.current = local?.tentative === tentative.current?.jeton && !!local?.nonEnvoye
      reponsesRef.current = reprise; setReponses(reprise)
      setRestant(tempsRestant(r.expire_le, decalage.current)); setPhase("composition")
    } else {                                    // composition terminée : l'appareil (parfois partagé) est libéré pour l'élève suivant
      effacerLocal(cleReponses(jeton)); effacerLocal(cleTentative(jeton)); setPhase("fin")
    }
  }, [jeton])

  // reprise sur cet appareil (actualisation, navigateur fermé puis rouvert) : toujours confirmée par l'élève (ordinateur partagé)
  const reprendreIci = useCallback(async () => {
    if (!tentative.current?.jeton) { setPhase("presentation"); return }
    setPhase("chargement")
    try { appliquer(await appeler("smarteval_reprendre", { p_jeton: jeton, p_tentative: tentative.current.jeton })) }
    catch (e) {
      if (e.indice === "smarteval:tentative") { effacerLocal(cleTentative(jeton)); tentative.current = null; setPhase("presentation"); return }
      setErreur(e.message); setPhase("panne")                         // panne passagère : le jeton est gardé
    }
  }, [appliquer, jeton])
  useEffect(() => { setPhase(tentative.current?.jeton ? "confirmer" : "presentation") }, [])
  function pasMoi() { effacerLocal(cleTentative(jeton)); effacerLocal(cleReponses(jeton)); tentative.current = null; setPhase("presentation") }

  async function commencer() {
    const e = controlerIdentite(evaluation, identite); setErreurs(e); setErreur("")
    if (Object.keys(e).length) { document.getElementById("se-identite")?.scrollIntoView({ behavior: "smooth", block: "center" }); return }
    setOccupe(true)
    try { appliquer(await appeler("smarteval_demarrer", { p_jeton: jeton, p: identiteEnvoyee(identite) })); window.scrollTo({ top: 0 }) }
    catch (x) { if (x.indice === "smarteval:en_cours") { setPhase("reprise") } setErreur(x.message) }
    finally { setOccupe(false) }
  }

  async function reprendreAvecCode() {
    const e = controlerIdentite(evaluation, identite); setErreurs(e); setErreur("")
    if (Object.keys(e).length) return
    setOccupe(true)
    try {
      const r = await appeler("smarteval_reprendre", { p_jeton: jeton, p_identite: identiteEnvoyee(identite), p_code: code.trim().toUpperCase() })
      tentative.current = { jeton: r.tentative || tentative.current?.jeton, code: code.trim().toUpperCase() }
      appliquer(r); window.scrollTo({ top: 0 })
    } catch (x) { setErreur(x.message) } finally { setOccupe(false) }
  }

  // fin de composition (anticipée ou à l'échéance) : idempotente côté serveur ; nouvel essai tant que le réseau manque
  const terminer = useCallback(async () => {
    if (finEnCours.current) return
    finEnCours.current = true; setVerrou(true); setConfirmer(false); clearTimeout(minuterie.current)
    for (let refus = 0; ;) {
      try {
        const r = await appeler("smarteval_soumettre", { p_jeton: jeton, p: { tentative: tentative.current.jeton, reponses: reponsesRef.current } })
        appliquer(r); window.scrollTo({ top: 0 }); return
      } catch (e) {
        if (e.indice === "smarteval:tentative") { setErreur(t("Cette composition a été reprise sur un autre appareil : continuez sur celui-ci.")); return }
        if (!e.reseau && ++refus >= ESSAIS_MAX) {                  // erreur répétée du serveur : l'élève peut réessayer lui-même
          setErreur(e.message); finEnCours.current = false; setVerrou(false); return
        }
        setSauvegarde("reseau"); await new Promise((ok) => setTimeout(ok, DELAI_NOUVEL_ESSAI))
      }
    }
  }, [appliquer, jeton])

  const sauver = useCallback(async () => {
    if (envoiEnCours.current || finEnCours.current || !tentative.current?.jeton) return
    envoiEnCours.current = true; aEnvoyer.current = false; setSauvegarde("cours")
    const envoyees = reponsesRef.current
    try {
      const r = await appeler("smarteval_sauver", { p_jeton: jeton, p_tentative: tentative.current.jeton, p_reponses: envoyees })
      decalage.current = decalageServeur(r.maintenant)
      setEtat((e) => ({ ...e, expire_le: r.expire_le, sauve_le: r.sauve_le }))
      if (reponsesRef.current === envoyees) { ecrireLocal(cleReponses(jeton), { tentative: tentative.current.jeton, reponses: envoyees, nonEnvoye: false }); setSauvegarde("ok") }
      else {                                                    // nouvelles réponses pendant l'envoi : on renvoie
        aEnvoyer.current = true; clearTimeout(minuterie.current); minuterie.current = setTimeout(() => sauver(), DELAI_SAUVEGARDE)
      }
    } catch (e) {
      aEnvoyer.current = true
      if (e.indice === "smarteval:expire" || e.indice === "smarteval:termine") { envoiEnCours.current = false; terminer(); return }
      if (e.indice === "smarteval:tentative") {                     // reprise sur un autre appareil : celui-ci n'écrit plus
        setVerrou(true); finEnCours.current = true; setErreur(t("Cette composition a été reprise sur un autre appareil : continuez sur celui-ci.")); return
      }
      setSauvegarde(e.reseau ? "reseau" : "attente"); if (!e.reseau) setErreur(e.message)
      clearTimeout(minuterie.current); minuterie.current = setTimeout(() => sauver(), DELAI_NOUVEL_ESSAI)
    } finally { envoiEnCours.current = false }
  }, [jeton, terminer])

  function repondre(id, v) {
    if (verrou) return
    const suivantes = { ...reponsesRef.current, [id]: v }
    reponsesRef.current = suivantes; setReponses(suivantes); aEnvoyer.current = true; setSauvegarde("attente")
    ecrireLocal(cleReponses(jeton), { tentative: tentative.current?.jeton, reponses: suivantes, nonEnvoye: true })
    clearTimeout(minuterie.current); minuterie.current = setTimeout(() => sauver(), DELAI_SAUVEGARDE)
  }

  // compte à rebours (affichage) ; à zéro : verrouillage puis soumission par le serveur
  useEffect(() => {
    if (phase !== "composition" || !etat?.expire_le) return
    if (aEnvoyer.current) { clearTimeout(minuterie.current); minuterie.current = setTimeout(() => sauver(), 300) }
    const tic = () => {
      const r = tempsRestant(etat.expire_le, decalage.current)
      const a = restantAvant.current === Infinity ? null : alerteFranchie(restantAvant.current, r)   // pas d'annonce au démarrage ni à la reprise
      restantAvant.current = r
      if (a) { setAlerte(t("Il vous reste {v0}.", { v0: dureeTexte(a / 1000) })); setTimeout(() => setAlerte(""), 8000) }
      setRestant(r)
      if (r <= AVANCE_SAUVEGARDE && aEnvoyer.current && !envoiEnCours.current) { clearTimeout(minuterie.current); sauver() }
      if (r <= AVANCE_ENVOI) terminer()
    }
    tic(); const id = setInterval(tic, 500)
    const enLigne = () => { if (aEnvoyer.current) sauver() }
    window.addEventListener("online", enLigne)
    return () => { clearInterval(id); window.removeEventListener("online", enLigne) }
  }, [phase, etat?.expire_le, sauver, terminer])
  useEffect(() => () => clearTimeout(minuterie.current), [])

  const entete = <>
    <div className="se-carte se-feuille-entete"><EnteteEvaluation entete={evaluation.entete} sequence={evaluation.sequence} /></div>
    <div className="se-carte se-carte-titre">
      <h1 className="h3 mb-2">{evaluation.titre}</h1>
      <div className="small text-muted mb-2">{[evaluation.matiere, evaluation.classes.map((c) => c.libelle).join(", "), evaluation.sequence && t("Séquence {v0}", { v0: evaluation.sequence })].filter(Boolean).join(" · ")}</div>
      <div className="se-competence"><span className="fw-semibold">{t("Compétence visée : ")}</span>{evaluation.competence}</div>
      <div className="small mt-2">⏱ {t("Composition chronométrée : {v0} par élève.", { v0: dureeTexte(evaluation.chrono_secondes) })}</div>
    </div>
  </>

  if (phase === "confirmer") {
    const qui = tentative.current?.identite
    return (
      <div className="se-formulaire">{entete}
        <div className="se-carte" role="alertdialog" aria-labelledby="se-confirmer-reprise">
          <h2 className="h5" id="se-confirmer-reprise">{t("Une composition est en cours sur cet appareil")}</h2>
          {qui && <p className="mb-2">{t("Au nom de : ")}<strong>{qui.nom} {qui.prenom}</strong> · {qui.classe}</p>}
          <p className="small text-muted">{t("Si ce n'est pas vous (ordinateur partagé), choisissez « Ce n'est pas moi » : la composition de cet élève continue et il pourra la reprendre avec son code.")}</p>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={reprendreIci}>{t("C'est moi : reprendre ma composition")}</button>
            <button type="button" className="btn btn-outline-secondary" onClick={pasMoi}>{t("Ce n'est pas moi")}</button>
          </div>
        </div>
      </div>)
  }
  if (phase === "chargement") return <div className="se-formulaire">{entete}<div className="text-center py-3"><span className="spinner-border" /></div></div>
  if (phase === "panne") return (
    <div className="se-formulaire">{entete}
      <div className="alert alert-warning">{erreur} <button type="button" className="btn btn-sm btn-outline-primary ms-2" onClick={() => { setErreur(""); setPhase("chargement"); reprendreIci() }}>{t("Réessayer")}</button></div>
    </div>)
  if (phase === "presentation") return <div className="se-formulaire">{entete}
    <Presentation evaluation={evaluation} identite={identite} setIdentite={setIdentite} erreurs={erreurs} onCommencer={commencer} occupe={occupe} erreur={erreur}
                  onReprise={() => { setErreur(""); setPhase("reprise") }} /></div>
  if (phase === "reprise") return <div className="se-formulaire">{entete}
    <Reprise evaluation={evaluation} identite={identite} setIdentite={setIdentite} erreurs={erreurs} code={code} setCode={setCode} onValider={reprendreAvecCode}
             onRetour={() => { setErreur(""); setPhase("presentation") }} occupe={occupe} erreur={erreur} /></div>
  if (phase === "fin") return <div className="se-formulaire">{entete}<Fin etat={etat} /></div>

  const questions = etat?.questions || []
  const sansReponse = questions.filter((q) => vide(reponses[q.id])).length
  return (
    <div className="se-formulaire">
      <BarreChrono restant={restant} sauvegarde={sauvegarde} code={tentative.current?.code} />
      {alerte && <div className="alert alert-warning py-2 small se-chrono-alerte" role="status">{alerte}</div>}
      {entete}
      {tentative.current?.code && <div className="alert alert-info small">{t("Notez votre code de reprise : {v0}. Il permet de reprendre votre composition sur un autre appareil (le temps continue de s'écouler).", { v0: tentative.current.code })}</div>}
      <DocumentsAtelecharger supports={etat?.supports} />
      {verrou && <div className="alert alert-secondary" role="status"><span className="spinner-border spinner-border-sm me-2" />{t("Envoi de votre copie…")}</div>}
      {erreur && <div className="alert alert-danger" role="alert">{erreur}</div>}
      {questions.map((q, k) => <Question key={q.id} q={q} numero={k + 1} valeur={reponses[q.id]} desactive={verrou} onChange={(v) => repondre(q.id, v)} />)}
      {!verrou && !confirmer && <div className="d-flex justify-content-between align-items-center mb-4">
        <button type="button" className="btn btn-primary px-4" onClick={() => setConfirmer(true)}>{t("Soumettre mon évaluation")}</button>
        <span className="small text-muted">{t("Vos réponses sont sauvegardées automatiquement.")}</span>
      </div>}
      {confirmer && !verrou && <div className="se-carte se-recap" role="alertdialog" aria-labelledby="se-confirmer-titre">
        <h2 className="h6" id="se-confirmer-titre">{t("Soumettre définitivement votre évaluation ?")}</h2>
        <p className="small mb-2">{sansReponse ? t("{v0} question(s) sans réponse. ", { v0: sansReponse }) : ""}{t("Après l'envoi, vous ne pourrez plus modifier vos réponses.")}</p>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmer(false)}>{t("Continuer à composer")}</button>
          <button type="button" className="btn btn-primary" onClick={terminer}>{t("Confirmer l'envoi")}</button>
        </div>
      </div>}
    </div>
  )
}
