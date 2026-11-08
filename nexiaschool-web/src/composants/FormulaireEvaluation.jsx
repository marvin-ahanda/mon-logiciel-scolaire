// Formulaire d'une évaluation SmartEval tel que le voient les élèves (même rendu pour l'aperçu de l'enseignant).
// Étapes : saisie -> « Terminer » (contrôle des champs obligatoires) -> récapitulatif -> « Envoyer mon formulaire » -> confirmation.
import { useEffect, useMemo, useRef, useState } from "react"
import { reponseTexte } from "../lib/smarteval.js"
import { dateHeure } from "../lib/format.js"
import { t } from "../i18n.jsx"

/** En-tête de l'établissement (comme sur le bulletin) : coordonnées à gauche, logo au centre, année et séquence à droite. */
export function EnteteEvaluation({ entete = {}, sequence }) {
  return (
    <header className="entete-bulletin entete-evaluation">
      <div><div className="fw-bold">{entete.nom}</div>
        {entete.devise && <div className="small fst-italic">{entete.devise}</div>}
        <div className="small">{[entete.adresse, entete.ville, entete.telephone && `${t("Tél.")} ${entete.telephone}`, entete.site_web].filter(Boolean).join(" · ")}</div></div>
      <div className="text-center">{entete.logo && <img src={entete.logo} alt={`Logo ${entete.nom}`} className="logo-bulletin" />}</div>
      <div className="text-end small">{entete.annee && <>{t("Année scolaire ")}<strong>{entete.annee}</strong><br /></>}{sequence && t("Séquence {v0}", { v0: sequence })}</div>
    </header>
  )
}

const vide = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)

function Question({ q, numero, valeur, onChange, erreur, desactive }) {
  const nom = `q-${q.id}`
  const choisir = (v) => onChange(v)
  return (
    <div className={`se-carte se-question${erreur ? " se-erreur" : ""}`} data-question={q.id} id={nom}>
      <div className="se-intitule">{numero}. {q.intitule}{q.obligatoire && <span className="text-danger" title={t("Obligatoire")}> *</span>}
        {Number(q.points) > 0 && <span className="se-points">{t("{v0} point(s)", { v0: Number(q.points) })}</span>}</div>
      {q.aide && <div className="se-aide">{q.aide}</div>}
      <div className="mt-3">
        {q.type === "courte" && <input className="form-control se-ligne" aria-label={q.intitule} placeholder={t("Votre réponse")} maxLength={500}
                                       value={valeur ?? ""} disabled={desactive} onChange={(e) => choisir(e.target.value)} />}
        {q.type === "paragraphe" && <textarea className="form-control" rows={4} aria-label={q.intitule} placeholder={t("Votre réponse")} maxLength={5000}
                                              value={valeur ?? ""} disabled={desactive} onChange={(e) => choisir(e.target.value)} />}
        {q.type === "choix" && q.options.map((o, i) => (
          <div className="form-check se-option" key={i}>
            <input className="form-check-input" type="radio" name={nom} id={`${nom}-${i}`} checked={valeur === i} disabled={desactive} onChange={() => choisir(i)} />
            <label className="form-check-label" htmlFor={`${nom}-${i}`}>{o}</label></div>))}
        {q.type === "choix" && valeur !== undefined && valeur !== null && !desactive &&
          <button type="button" className="btn btn-link btn-sm px-0" onClick={() => choisir(null)}>{t("Effacer la sélection")}</button>}
        {q.type === "cases" && q.options.map((o, i) => {
          const liste = Array.isArray(valeur) ? valeur : []
          return (
            <div className="form-check se-option" key={i}>
              <input className="form-check-input" type="checkbox" id={`${nom}-${i}`} checked={liste.includes(i)} disabled={desactive}
                     onChange={(e) => choisir(e.target.checked ? [...liste, i].sort((a, b) => a - b) : liste.filter((x) => x !== i))} />
              <label className="form-check-label" htmlFor={`${nom}-${i}`}>{o}</label></div>)
        })}
        {q.type === "liste" && (
          <select className="form-select se-liste" aria-label={q.intitule} value={valeur ?? ""} disabled={desactive}
                  onChange={(e) => choisir(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">{t("Choisir")}</option>{q.options.map((o, i) => <option key={i} value={i}>{o}</option>)}</select>)}
        {q.type === "echelle" && (
          <div className="se-echelle">
            <span className="se-echelle-libelle">{q.echelle.libelle_min}</span>
            {Array.from({ length: q.echelle.max - q.echelle.min + 1 }, (_, k) => q.echelle.min + k).map((v) => (
              <label key={v} className="se-echelle-point"><span>{v}</span>
                <input type="radio" className="form-check-input" name={nom} checked={valeur === v} disabled={desactive} onChange={() => choisir(v)} aria-label={String(v)} /></label>))}
            <span className="se-echelle-libelle">{q.echelle.libelle_max}</span>
          </div>)}
      </div>
      {erreur && <div className="text-danger small mt-2">⚠ {erreur}</div>}
    </div>
  )
}

/**
 * evaluation : { titre, consignes, competence, matiere, sequence, classes: [{ id, libelle }], questions, entete }
 * mode : « apercu » (enseignant : rien n'est envoyé) ou « eleve ».
 * onEnvoyer(identite, reponses) : promesse -> accusé de réception { recu, soumis_le, nom, prenom, classe }.
 * brouillon : clé localStorage pour garder les réponses en cours sur l'appareil (connexion instable).
 */
export default function FormulaireEvaluation({ evaluation, mode = "eleve", onEnvoyer, brouillon }) {
  const lire = () => { try { return JSON.parse(localStorage.getItem(brouillon) || "null") } catch { return null } }
  const initial = useMemo(() => (brouillon && lire()) || { identite: { nom: "", prenom: "", classe_id: evaluation.classes.length === 1 ? evaluation.classes[0].id : "" }, reponses: {} },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [])
  const [identite, setIdentite] = useState(initial.identite)
  const [reponses, setReponses] = useState(initial.reponses)
  const [etape, setEtape] = useState("saisie"), [erreurs, setErreurs] = useState({}), [envoi, setEnvoi] = useState(false)
  const [erreurEnvoi, setErreurEnvoi] = useState(""), [recu, setRecu] = useState(null)
  const haut = useRef(null)
  useEffect(() => { if (brouillon && etape !== "envoye") try { localStorage.setItem(brouillon, JSON.stringify({ identite, reponses })) } catch { /* stockage indisponible */ } },
    [identite, reponses, brouillon, etape])
  const apercu = mode === "apercu"
  const classe = evaluation.classes.find((c) => c.id === identite.classe_id)

  function terminer() {
    const e = {}
    if (!identite.nom.trim()) e.nom = t("Indiquez votre nom.")
    if (!identite.prenom.trim()) e.prenom = t("Indiquez votre prénom.")
    if (!identite.classe_id) e.classe = t("Choisissez votre classe.")
    for (const q of evaluation.questions) if (q.obligatoire && vide(reponses[q.id])) e[q.id] = t("Cette question est obligatoire.")
    setErreurs(e)
    if (Object.keys(e).length) {
      const k = Object.keys(e)[0]
      const el = ["nom", "prenom", "classe"].includes(k) ? document.getElementById("se-identite") : document.querySelector(`[data-question="${k}"]`)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    setEtape("recap"); haut.current?.scrollIntoView({ behavior: "smooth" })
  }

  async function envoyer() {
    setErreurEnvoi(""); setEnvoi(true)
    try {
      const r = await onEnvoyer({ nom: identite.nom.trim(), prenom: identite.prenom.trim(), classe_id: identite.classe_id }, reponses)
      setRecu(r); setEtape("envoye")
      if (brouillon) try { localStorage.removeItem(brouillon) } catch { /* rien */ }
      haut.current?.scrollIntoView({ behavior: "smooth" })
    } catch (e) { setErreurEnvoi(e.message) } finally { setEnvoi(false) }
  }

  return (
    <div className="se-formulaire" ref={haut}>
      <div className="se-carte se-feuille-entete"><EnteteEvaluation entete={evaluation.entete} sequence={evaluation.sequence} /></div>
      <div className="se-carte se-carte-titre">
        <h1 className="h3 mb-2">{evaluation.titre}</h1>
        <div className="small text-muted mb-2">{[evaluation.matiere, evaluation.classes.map((c) => c.libelle).join(", "), evaluation.sequence && t("Séquence {v0}", { v0: evaluation.sequence })].filter(Boolean).join(" · ")}</div>
        <div className="se-competence"><span className="fw-semibold">{t("Compétence visée : ")}</span>{evaluation.competence}</div>
        {evaluation.consignes && <p className="mt-2 mb-0 se-consignes">{evaluation.consignes}</p>}
        {etape === "saisie" && <div className="small text-danger mt-3">{t("* Indique une question obligatoire")}</div>}
      </div>

      {etape === "envoye" && recu && (
        <div className="se-carte se-confirmation" role="status">
          <div className="se-confirmation-icone" aria-hidden="true">✓</div>
          <h2 className="h4">{t("Votre formulaire a bien été envoyé.")}</h2>
          <p className="mb-1">{recu.nom} {recu.prenom} · {recu.classe}</p>
          <p className="mb-1">{t("Accusé de réception n° ")}<strong className="font-monospace">{recu.recu}</strong></p>
          <p className="text-muted small mb-0">{t("Reçu le {v0}. Votre enseignant a été prévenu. Vous pouvez fermer cette page.", { v0: dateHeure(recu.soumis_le) })}</p>
        </div>)}

      {etape === "recap" && (
        <div className="se-carte se-recap">
          <h2 className="h5">{t("Vérifiez vos réponses avant de les envoyer")}</h2>
          <dl className="row mb-2 small">
            <dt className="col-sm-3">{t("Nom")}</dt><dd className="col-sm-9">{identite.nom}</dd>
            <dt className="col-sm-3">{t("Prénom")}</dt><dd className="col-sm-9">{identite.prenom}</dd>
            <dt className="col-sm-3">{t("Classe")}</dt><dd className="col-sm-9">{classe?.libelle}</dd>
          </dl>
          <ol className="se-recap-liste">{evaluation.questions.map((q) => (
            <li key={q.id}><div className="fw-semibold">{q.intitule}</div>
              <div className={vide(reponses[q.id]) ? "text-muted fst-italic" : ""}>{vide(reponses[q.id]) ? t("Sans réponse") : reponseTexte(q, reponses[q.id])}</div></li>))}</ol>
          {erreurEnvoi && <div className="alert alert-danger">{erreurEnvoi}</div>}
          {apercu && <div className="alert alert-info small">{t("Aperçu : dans le vrai formulaire, l'élève envoie ici ses réponses et reçoit un accusé de réception.")}</div>}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEtape("saisie")} disabled={envoi}>{t("Modifier mes réponses")}</button>
            <button type="button" className="btn btn-primary" onClick={envoyer} disabled={envoi || apercu}>
              {envoi ? <><span className="spinner-border spinner-border-sm me-1" />{t("Envoi…")}</> : t("Envoyer mon formulaire")}</button>
          </div>
        </div>)}

      {etape === "saisie" && <>
        <div className={`se-carte${erreurs.nom || erreurs.prenom || erreurs.classe ? " se-erreur" : ""}`} id="se-identite">
          <div className="se-intitule mb-3">{t("Identification de l'élève")}</div>
          <div className="row g-3">
            <div className="col-sm-6"><label className="form-label small" htmlFor="se-nom">{t("Nom")} <span className="text-danger">*</span></label>
              <input id="se-nom" className="form-control se-ligne" maxLength={100} autoComplete="family-name" value={identite.nom}
                     onChange={(e) => setIdentite({ ...identite, nom: e.target.value })} />{erreurs.nom && <div className="text-danger small">{erreurs.nom}</div>}</div>
            <div className="col-sm-6"><label className="form-label small" htmlFor="se-prenom">{t("Prénom")} <span className="text-danger">*</span></label>
              <input id="se-prenom" className="form-control se-ligne" maxLength={100} autoComplete="given-name" value={identite.prenom}
                     onChange={(e) => setIdentite({ ...identite, prenom: e.target.value })} />{erreurs.prenom && <div className="text-danger small">{erreurs.prenom}</div>}</div>
            <div className="col-sm-6"><label className="form-label small" htmlFor="se-classe">{t("Classe")} <span className="text-danger">*</span></label>
              <select id="se-classe" className="form-select" value={identite.classe_id} onChange={(e) => setIdentite({ ...identite, classe_id: e.target.value })}>
                <option value="">{t("Choisir")}</option>{evaluation.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
              {erreurs.classe && <div className="text-danger small">{erreurs.classe}</div>}</div>
          </div>
        </div>
        {evaluation.questions.map((q, k) => (
          <Question key={q.id} q={q} numero={k + 1} valeur={reponses[q.id]} erreur={erreurs[q.id]}
                    onChange={(v) => { setReponses((r) => ({ ...r, [q.id]: v })); if (erreurs[q.id]) setErreurs((x) => ({ ...x, [q.id]: undefined })) }} />))}
        {Object.values(erreurs).some(Boolean) && <div className="alert alert-danger">{t("Certaines réponses obligatoires manquent : elles sont signalées en rouge.")}</div>}
        <div className="d-flex justify-content-between align-items-center mb-4">
          <button type="button" className="btn btn-primary px-4" onClick={terminer}>{t("Terminer")}</button>
          <span className="small text-muted">{t("Vos réponses ne sont envoyées qu'après vérification.")}</span>
        </div>
      </>}
    </div>
  )
}
